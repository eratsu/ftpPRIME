const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let pty = null;
try {
  pty = require('@homebridge/node-pty-prebuilt-multiarch');
} catch (e) {
  console.error('node-pty unavailable, terminal will be disabled:', e.message);
}

const { Store } = require('./src/store');
const { AppSettings } = require('./src/app-settings');
const { VersionManager } = require('./src/version-manager');
const { AutoUploader } = require('./src/watcher');
const sync = require('./src/sync-engine');

let mainWindow = null;
let tray = null;
let store = null;
let appSettings = null;
let isQuitting = false;
const autoUploaders = new Map(); // projectId -> AutoUploader

const APP_ICON = path.join(__dirname, 'src', 'imgs', 'ftpprime-icon.png');
app.setName('ftpPRIME');
if (process.platform === 'win32') app.setAppUserModelId('com.ftpprime.app');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f172a',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer gone:', details);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error('Preload error:', preloadPath, error);
  });

  // Minimize-to-tray: on window close, hide instead of quitting.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (tray && !mainWindow._trayHintShown) {
        mainWindow._trayHintShown = true;
        try {
          tray.displayBalloon({
            title: 'ftpPRIME continua rodando',
            content: 'Uploads automáticos e terminal continuam ativos. Clique no ícone da bandeja para mostrar ou sair.'
          });
        } catch {}
      }
    }
  });
}

function createTray() {
  if (tray) return;
  let img;
  try {
    img = nativeImage.createFromPath(APP_ICON);
    if (img.isEmpty()) throw new Error('empty image');
    // Resize to standard tray icon size (Windows uses 16x16, HiDPI 32x32).
    img = img.resize({ width: 16, height: 16 });
  } catch {
    img = nativeImage.createEmpty();
  }
  tray = new Tray(img);
  tray.setToolTip('ftpPRIME');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Mostrar ftpPRIME',
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    },
    { type: 'separator' },
    {
      label: 'Fechar',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });
}

function log(entry) {
  const payload = { ts: Date.now(), level: 'info', ...entry };
  console.log(`[${payload.level}] ${payload.msg}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', payload);
  }
}

function emitActivity(projectId, activity) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('file-activity', { projectId, ...activity });
  }
}

// Ensure a single instance to avoid cache lock conflicts on Windows.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Disable HTTP disk cache (this app doesn't need it) to prevent
  // "Unable to move the cache: Acesso negado" on Windows.
  app.commandLine.appendSwitch('disable-http-cache');

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    store = new Store(path.join(userData, 'projects.json'));
    appSettings = new AppSettings(path.join(userData, 'settings.json'));
    createTray();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    });
  });
}

// Do NOT auto-quit when all windows are closed; we live in the tray.
// Cleanup is done on `before-quit` (tray -> Fechar).
app.on('before-quit', async () => {
  isQuitting = true;
  for (const u of autoUploaders.values()) {
    try { await u.stop(); } catch {}
  }
  for (const t of terminals.values()) {
    try { t.proc.kill(); } catch {}
  }
});

// ---------- IPC ----------
ipcMain.handle('projects:list', () => {
  return store.listProjects().map((p) => ({
    ...p,
    autoUpload: autoUploaders.has(p.id)
  }));
});

ipcMain.handle('projects:save', (_e, project) => {
  if (!project.id) project.id = crypto.randomUUID();
  if (!project.createdAt) project.createdAt = Date.now();
  project.updatedAt = Date.now();
  store.saveProject(project);
  // if watcher running, restart with new config
  if (autoUploaders.has(project.id)) {
    const old = autoUploaders.get(project.id);
    old.stop().then(() => {
      const nu = new AutoUploader(project, log, (a) => emitActivity(project.id, a));
      nu.start();
      autoUploaders.set(project.id, nu);
    });
  }
  return project;
});

ipcMain.handle('projects:delete', async (_e, id) => {
  if (autoUploaders.has(id)) {
    await autoUploaders.get(id).stop();
    autoUploaders.delete(id);
  }
  store.deleteProject(id);
  return true;
});

ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('ftp:test', async (_e, project) => {
  try {
    await sync.testConnection(project);
    log({ level: 'info', msg: `Conexão OK: ${project.protocol}://${project.host}` });
    return { ok: true };
  } catch (e) {
    log({ level: 'error', msg: `Falha conexão: ${e.message}` });
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('sync:upload', async (_e, id) => {
  const project = store.getProject(id);
  if (!project) return { ok: false, error: 'Projeto não encontrado' };
  try {
    log({ level: 'info', msg: `▲ Upload iniciado: ${project.name}` });
    const r = await sync.uploadAll(project, log);
    log({ level: 'info', msg: `▲ Upload concluído: ${r.count} arquivos` });
    store.updateProject(id, { lastSyncAt: Date.now(), lastSyncType: 'upload' });
    return { ok: true, ...r };
  } catch (e) {
    log({ level: 'error', msg: `Upload falhou: ${e.message}` });
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('sync:uploadOne', async (_e, id, relPath) => {
  const project = store.getProject(id);
  if (!project) return { ok: false, error: 'Projeto não encontrado' };
  try {
    log({ level: 'info', msg: `▲ Upload único: ${relPath}` });
    const r = await sync.uploadOne(project, relPath, log);
    if (r.skipped) {
      log({ level: 'warn', msg: `Upload ignorado (arquivo inexistente): ${relPath}` });
      return { ok: false, error: 'arquivo não encontrado localmente' };
    }
    log({ level: 'info', msg: `▲ Upload OK: ${relPath}` });
    emitActivity(id, { relPath, action: 'uploaded', ts: Date.now() });
    return { ok: true };
  } catch (e) {
    log({ level: 'error', msg: `Upload falhou (${relPath}): ${e.message}` });
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('sync:download', async (_e, id) => {
  const project = store.getProject(id);
  if (!project) return { ok: false, error: 'Projeto não encontrado' };
  try {
    log({ level: 'info', msg: `▼ Download iniciado: ${project.name}` });
    const r = await sync.downloadAll(project, log);
    log({ level: 'info', msg: `▼ Download concluído: ${r.count} arquivos` });
    store.updateProject(id, { lastSyncAt: Date.now(), lastSyncType: 'download' });
    return { ok: true, ...r };
  } catch (e) {
    log({ level: 'error', msg: `Download falhou: ${e.message}` });
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('auto:start', (_e, id) => {
  const project = store.getProject(id);
  if (!project) return { ok: false, error: 'Projeto não encontrado' };
  if (autoUploaders.has(id)) return { ok: true, alreadyRunning: true };
  const uploader = new AutoUploader(project, log, (a) => emitActivity(id, a));
  uploader.start();
  // Catch-up: enfileira arquivos alterados enquanto o auto-upload estava desligado.
  let pendingCount = 0;
  try { pendingCount = uploader.queueModifiedSinceLastUpload(); }
  catch (e) { log({ level: 'warn', msg: `Catch-up falhou: ${e.message}` }); }
  autoUploaders.set(id, uploader);
  return { ok: true, pendingCount };
});

ipcMain.handle('auto:stop', async (_e, id) => {
  const up = autoUploaders.get(id);
  if (!up) return { ok: true };
  await up.stop();
  autoUploaders.delete(id);
  return { ok: true };
});

ipcMain.handle('auto:status', (_e, id) => ({ running: autoUploaders.has(id) }));

ipcMain.handle('files:list', (_e, id) => {
  const project = store.getProject(id);
  if (!project) return [];
  const ignores = sync.normalizeIgnores(project.ignores);
  const files = sync.walkLocal(project.localPath, ignores).filter((f) => f.type === 'file');
  const vm = new VersionManager(project.localPath);
  const uploads = vm.getAllUploadInfo();
  return files.map((f) => {
    const info = uploads[f.relPath];
    const versions = vm.listVersions(f.relPath);
    return {
      relPath: f.relPath,
      size: f.size,
      mtime: f.mtime,
      lastUploadAt: info ? info.lastUploadAt : null,
      lastAction: info ? info.lastAction : null,
      versionCount: versions.length
    };
  });
});

ipcMain.handle('versions:list', (_e, id, relPath) => {
  const project = store.getProject(id);
  if (!project) return [];
  const vm = new VersionManager(project.localPath);
  return vm.listVersions(relPath);
});

ipcMain.handle('versions:read', (_e, id, relPath, versionId) => {
  const project = store.getProject(id);
  if (!project) return { ok: false, error: 'Projeto não encontrado' };
  try {
    const vm = new VersionManager(project.localPath);
    const data = vm.readVersion(relPath, versionId);
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('versions:restore', (_e, id, relPath, versionId) => {
  const project = store.getProject(id);
  if (!project) return { ok: false, error: 'Projeto não encontrado' };
  try {
    const vm = new VersionManager(project.localPath);
    const dest = vm.restoreVersion(project.localPath, relPath, versionId);
    log({ level: 'info', msg: `Restaurado ${relPath} <- ${versionId}` });
    return { ok: true, dest };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('settings:get', () => {
  return appSettings ? appSettings.get() : { language: 'pt' };
});

ipcMain.handle('settings:set', (_e, patch) => {
  if (!appSettings) return null;
  return appSettings.set(patch || {});
});

ipcMain.handle('settings:exportProjects', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar projetos',
    defaultPath: `ftpprime-projects-${new Date().toISOString().slice(0,10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    const projects = store.listProjects().map((p) => {
      const copy = { ...p };
      delete copy.lastSyncAt;
      delete copy.lastSyncType;
      return copy;
    });
    const payload = {
      app: 'ftpPRIME',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects
    };
    fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    log({ level: 'info', msg: `Configurações exportadas para ${res.filePath}` });
    return { ok: true, path: res.filePath, count: projects.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('settings:importProjects', async (_e, mode) => {
  // mode: 'merge' | 'replace'
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar projetos',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  try {
    const raw = fs.readFileSync(res.filePaths[0], 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.projects)) {
      return { ok: false, error: 'Arquivo inválido: não contém array "projects"' };
    }
    const count = data.projects.filter((p) => p && p.id).length;
    const isReplace = mode === 'replace';
    const confirmMsg = isReplace
      ? `Isto vai SUBSTITUIR todos os ${store.listProjects().length} projeto(s) atuais por ${count} do arquivo. Continuar?`
      : `Mesclar ${count} projeto(s)? Projetos com mesmo ID serão atualizados.`;
    const confirmRes = await dialog.showMessageBox(mainWindow, {
      type: isReplace ? 'warning' : 'question',
      buttons: ['Cancelar', isReplace ? 'Substituir' : 'Mesclar'],
      defaultId: isReplace ? 0 : 1,
      cancelId: 0,
      title: 'Confirmar importação',
      message: confirmMsg
    });
    if (confirmRes.response === 0) return { ok: false, canceled: true };

    if (isReplace) {
      for (const [id, up] of autoUploaders.entries()) {
        try { await up.stop(); } catch {}
        autoUploaders.delete(id);
      }
      store.data.projects = [];
    }
    let imported = 0;
    for (const p of data.projects) {
      if (!p || !p.id) continue;
      const clean = { ...p };
      delete clean.autoUpload;
      store.saveProject(clean);
      imported++;
    }
    log({ level: 'info', msg: `Importados ${imported} projeto(s) de ${res.filePaths[0]} (${mode})` });
    return { ok: true, count: imported };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('shell:openPath', async (_e, p) => {
  if (!p) return { ok: false, error: 'caminho vazio' };
  try {
    if (!fs.existsSync(p)) return { ok: false, error: 'pasta não encontrada' };
    const result = await shell.openPath(p);
    if (result) return { ok: false, error: result };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Terminal (real PTY per project) ----------
const terminals = new Map(); // projectId -> { proc }

function terminalSend(projectId, channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, { projectId, data });
  }
}

function defaultShell() {
  // Prefer PowerShell 7 if available, else Windows PowerShell, else cmd.
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
    process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    process.env.ComSpec || 'cmd.exe'
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'cmd.exe';
}

ipcMain.handle('term:start', (_e, id) => {
  if (!pty) return { ok: false, error: 'node-pty não disponível' };
  if (terminals.has(id)) return { ok: true, already: true };
  const project = id ? store.getProject(id) : null;
  const cwd = project && project.localPath && fs.existsSync(project.localPath)
    ? project.localPath
    : process.env.USERPROFILE || process.cwd();
  const shell = defaultShell();
  try {
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: true
    });
    proc.onData((data) => terminalSend(id, 'term:data', data));
    proc.onExit(({ exitCode }) => {
      terminals.delete(id);
      terminalSend(id, 'term:exit', `\r\n[processo encerrado com código ${exitCode}]\r\n`);
    });
    terminals.set(id, { proc });
    return { ok: true, cwd, shell };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('term:write', (_e, id, data) => {
  const t = terminals.get(id);
  if (!t) return { ok: false, error: 'terminal not running' };
  try { t.proc.write(data); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('term:resize', (_e, id, cols, rows) => {
  const t = terminals.get(id);
  if (!t) return { ok: false };
  try { t.proc.resize(Math.max(2, cols | 0), Math.max(2, rows | 0)); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('term:kill', (_e, id) => {
  const t = terminals.get(id);
  if (!t) return { ok: true };
  try { t.proc.kill(); } catch {}
  terminals.delete(id);
  return { ok: true };
});
