(function () {
'use strict';

// Global error surfacing so we can diagnose issues without DevTools.
window.addEventListener('error', (e) => {
  const msg = `JS ERROR: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`;
  console.error(msg, e.error);
  try {
    const bar = document.getElementById('errorBar') || (() => {
      const b = document.createElement('div');
      b.id = 'errorBar';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ef4444;color:#fff;padding:8px 12px;font:12px monospace;z-index:9999;white-space:pre-wrap;';
      document.body.appendChild(b);
      return b;
    })();
    bar.textContent = (bar.textContent ? bar.textContent + '\n' : '') + msg;
  } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});

const api = window.api;
// Fallback so missing icons.js never breaks the app:
const icon = typeof window.icon === 'function'
  ? window.icon
  : () => '<span style="display:inline-block;width:12px;"></span>';

const state = {
  projects: [],
  currentId: null,     // saved project id OR '__new__'
  draft: null,         // unsaved new project draft
  files: [],
  filter: ''
};

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
function formatDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}
function toast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3500);
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Render all <span class="icon-slot" data-icon="..."> into SVGs.
function renderIcons(root) {
  const scope = root || document;
  scope.querySelectorAll('.icon-slot, [data-icon]').forEach((el) => {
    if (el.dataset.rendered === '1') return;
    const name = el.dataset.icon;
    const size = el.dataset.size ? Number(el.dataset.size) : 16;
    if (!name) return;
    el.innerHTML = icon(name, { size });
    el.dataset.rendered = '1';
  });
}

function getCurrent() {
  if (state.currentId === '__new__') return state.draft;
  return state.projects.find((p) => p.id === state.currentId) || null;
}

// ---------- Project list ----------
async function loadProjects() {
  try {
    state.projects = await api.listProjects();
  } catch (e) {
    console.error('listProjects failed', e);
    state.projects = [];
  }
  renderProjects();
  if (state.currentId === '__new__') {
    renderCurrent();
  } else if (state.currentId && !state.projects.find((p) => p.id === state.currentId)) {
    state.currentId = null;
    renderCurrent();
  } else {
    renderCurrent();
  }
}

function renderProjects() {
  const list = $('#projectList');
  list.innerHTML = '';
  const items = [...state.projects];
  if (state.currentId === '__new__' && state.draft) {
    items.push({ ...state.draft, id: '__new__', _new: true });
  }
  if (!items.length) {
    list.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Nenhum projeto ainda</div>';
    return;
  }
  for (const p of items) {
    const el = document.createElement('div');
    el.className = 'project-item' + (p.id === state.currentId ? ' active' : '');
    const name = p._new ? (p.name || '(novo)') + ' *' : (p.name || '(sem nome)');
    el.innerHTML = `
      <div class="pname">
        <span class="dot ${p.autoUpload ? 'on' : ''}"></span>
        ${escapeHtml(name)}
      </div>
      <div class="ppath">${escapeHtml(p.localPath || '(pasta nao definida)')}</div>
    `;
    el.onclick = () => { state.currentId = p.id; renderProjects(); renderCurrent(); };
    list.appendChild(el);
  }
}

// ---------- Current project ----------
function renderCurrent() {
  // Any time a project is (de)selected, settings view closes.
  $('#settingsView').classList.add('hidden');
  const p = getCurrent();
  if (!p) {
    $('#emptyState').classList.remove('hidden');
    $('#projectView').classList.add('hidden');
    return;
  }
  $('#emptyState').classList.add('hidden');
  $('#projectView').classList.remove('hidden');
  $('#projHeaderName').textContent = p.name || '(sem nome)';
  $('#projHeaderPath').textContent = p.localPath || '(pasta nao definida)';
  const openBtn = $('#openFolderBtn');
  if (openBtn) openBtn.classList.toggle('hidden', !p.localPath || state.currentId === '__new__');
  $('#autoToggle').checked = !!p.autoUpload;

  $('#cfgName').value = p.name || '';
  $('#cfgLocalPath').value = p.localPath || '';
  $('#cfgProtocol').value = p.protocol || 'sftp';
  $('#cfgPort').value = p.port || (p.protocol === 'sftp' ? 22 : 21);
  $('#cfgHost').value = p.host || '';
  $('#cfgUser').value = p.user || '';
  $('#cfgPassword').value = p.password || '';
  $('#cfgRemotePath').value = p.remotePath || '/';
  $('#cfgSecure').checked = !!p.secure;
  $('#cfgIgnores').value = (p.ignores || []).join('\n');

  // new projects must configure first
  if (state.currentId === '__new__') {
    switchTab('config');
  }

  refreshFiles();
}

// ---------- Files ----------
async function refreshFiles() {
  const p = getCurrent();
  if (!p || state.currentId === '__new__') {
    state.files = [];
    renderFiles();
    return;
  }
  try {
    state.files = await api.listFiles(p.id);
  } catch (e) {
    state.files = [];
  }
  renderFiles();
}

function renderFiles() {
  const tbody = $('#fileTbody');
  tbody.innerHTML = '';
  const filter = state.filter.toLowerCase();
  const rows = state.files.filter((f) => !filter || f.relPath.toLowerCase().includes(filter));
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px;">${escapeHtml(window.i18n.t('files.empty'))}</td></tr>`;
    return;
  }
  for (const f of rows) {
    const tr = document.createElement('tr');
    const actionBadge = f.lastAction
      ? `<span class="badge ${f.lastAction.indexOf('upload') >= 0 ? 'success' : 'warn'}">${escapeHtml(f.lastAction)}</span>`
      : '<span class="badge">nunca</span>';
    tr.innerHTML = `
      <td class="pathcell">
        <div class="pathcell-inner">
          <button class="icon-btn-sm upload-one-btn" data-act="upload-one" data-path="${escapeHtml(f.relPath)}" title="${escapeHtml(window.i18n.t('files.uploadOneTitle'))}">
            <span class="icon-slot" data-icon="upload" data-size="14"></span>
          </button>
          <span class="pathcell-name">${escapeHtml(f.relPath)}</span>
        </div>
      </td>
      <td>${formatSize(f.size)}</td>
      <td>${formatDate(f.lastUploadAt)}</td>
      <td>${actionBadge}</td>
      <td>${f.versionCount || 0}</td>
      <td style="text-align:right;">
        <button class="btn btn-sm" data-act="versions" data-path="${escapeHtml(f.relPath)}">
          <span class="icon-slot" data-icon="history"></span>
          <span>${escapeHtml(window.i18n.t('files.versions'))}</span>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  renderIcons(tbody);
  tbody.querySelectorAll('button[data-act="versions"]').forEach((b) => {
    b.onclick = () => openVersions(b.dataset.path);
  });
  tbody.querySelectorAll('button[data-act="upload-one"]').forEach((b) => {
    b.onclick = async () => {
      const p = getCurrent();
      if (!p || state.currentId === '__new__') return;
      const relPath = b.dataset.path;
      b.disabled = true;
      const original = b.innerHTML;
      b.innerHTML = '...';
      try {
        const res = await api.uploadFile(p.id, relPath);
        if (res && res.ok) {
          toast(window.i18n.t('toast.uploadedOne', { path: relPath }), 'success');
          await refreshFiles();
        } else {
          toast(window.i18n.t('toast.uploadError', { err: (res && res.error) || 'falha ao enviar' }), 'error');
        }
      } finally {
        b.disabled = false;
        b.innerHTML = original;
      }
    };
  });
}

// ---------- Versions ----------
async function openVersions(relPath) {
  const p = getCurrent();
  if (!p || state.currentId === '__new__') return;
  const versions = await api.listVersions(p.id, relPath);
  $('#versionsFileName').textContent = relPath;
  const body = $('#versionsBody');
  if (!versions.length) {
    body.innerHTML = '<div class="muted">Nenhuma versao salva ainda. Versoes sao criadas a cada upload/download.</div>';
  } else {
    body.innerHTML = versions.map((v) => `
      <div class="version-item">
        <div>
          <div class="vinfo">${formatDate(v.ts)} - ${formatSize(v.size)}</div>
          <div class="vaction">${escapeHtml(v.action || '')} - id: ${escapeHtml(v.id)}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-view" data-ver="${escapeHtml(v.id)}">
            <span class="icon-slot" data-icon="eye"></span>
            <span>Visualizar</span>
          </button>
          <button class="btn btn-primary btn-restore" data-ver="${escapeHtml(v.id)}">Restaurar</button>
        </div>
      </div>
    `).join('');
    renderIcons(body);
    body.querySelectorAll('button.btn-restore').forEach((b) => {
      b.onclick = async () => {
        if (!confirm(`Restaurar esta versao de ${relPath}?\nA versao atual sera salva antes.`)) return;
        const res = await api.restoreVersion(p.id, relPath, b.dataset.ver);
        if (res.ok) {
          toast('Versao restaurada localmente. Faca upload para enviar ao servidor.', 'success');
          closeVersions();
          refreshFiles();
        } else {
          toast('Erro: ' + res.error, 'error');
        }
      };
    });
    body.querySelectorAll('button.btn-view').forEach((b) => {
      b.onclick = () => openViewer(p.id, relPath, b.dataset.ver);
    });
  }
  $('#versionsModal').classList.remove('hidden');
}
function closeVersions() { $('#versionsModal').classList.add('hidden'); }

async function openViewer(projectId, relPath, versionId) {
  $('#viewerFileName').textContent = relPath;
  $('#viewerMeta').textContent = 'carregando...';
  const body = $('#viewerBody');
  body.innerHTML = '<div class="binary-notice">Carregando...</div>';
  $('#viewerModal').classList.remove('hidden');
  const res = await api.readVersion(projectId, relPath, versionId);
  if (!res || !res.ok) {
    body.innerHTML = `<div class="binary-notice">Erro: ${escapeHtml((res && res.error) || 'desconhecido')}</div>`;
    $('#viewerMeta').textContent = '';
    return;
  }
  const metaParts = [formatSize(res.size)];
  if (res.ext) metaParts.push(res.ext);
  if (res.truncated) metaParts.push('truncado (2MB)');
  if (res.isBinary) metaParts.push('binário');
  $('#viewerMeta').textContent = metaParts.join(' - ');
  if (res.isBinary) {
    body.innerHTML = `<div class="binary-notice">Arquivo binário (${formatSize(res.size)}) - visualização não disponível.</div>`;
    return;
  }
  const lines = String(res.content).split('\n');
  const gutter = lines.map((_, i) => i + 1).join('\n');
  body.innerHTML = `
    <div class="line-numbers">
      <pre class="gutter">${escapeHtml(gutter)}</pre>
      <pre class="code">${escapeHtml(res.content)}</pre>
    </div>
  `;
}
function closeViewer() { $('#viewerModal').classList.add('hidden'); }

// ---------- App settings ----------
function openSettings() {
  state.currentId = null;
  state.draft = null;
  $('#emptyState').classList.add('hidden');
  $('#projectView').classList.add('hidden');
  $('#settingsView').classList.remove('hidden');
  renderProjects();
}

async function applyLanguage(lang) {
  if (!lang || !window.LOCALES[lang]) lang = 'pt';
  window.i18n.current = lang;
  window.i18n.apply(document);
  const htmlLangMap = {
    pt: 'pt-BR', en: 'en', es: 'es', it: 'it', fr: 'fr', de: 'de',
    ru: 'ru', pl: 'pl', kk: 'kk', ja: 'ja', zh: 'zh-CN', ko: 'ko',
    hi: 'hi', ar: 'ar'
  };
  document.documentElement.lang = htmlLangMap[lang] || lang;
  // RTL only for Arabic.
  document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';
  const sel = $('#settingLanguage');
  if (sel) sel.value = lang;
}

// ---------- New project ----------
function newProject() {
  state.draft = {
    id: '__new__',
    name: 'Novo Projeto',
    localPath: '',
    protocol: 'sftp',
    port: 22,
    host: '',
    user: '',
    password: '',
    remotePath: '/',
    secure: false,
    ignores: ['node_modules', '.git', '.env', '*.log'],
    autoUpload: false
  };
  state.currentId = '__new__';
  renderProjects();
  renderCurrent();
}

// ---------- Tabs ----------
function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  if (name === 'terminal') {
    ensureTerminalStarted().then(() => {
      try { term.fitAddon && term.fitAddon.fit(); } catch {}
      if (term.xterm) term.xterm.focus();
    });
  }
}

// ---------- Terminal (xterm.js + node-pty on main) ----------
const term = {
  xterm: null,
  fitAddon: null,
  currentId: null,     // project id OR '__global__'
  started: new Set()   // ids with an active PTY
};

function updateTermStatus(text) {
  const el = $('#termStatus');
  if (el) el.textContent = text;
}

function initXterm() {
  if (term.xterm) return;
  const container = $('#termContainer');
  if (!container || typeof Terminal === 'undefined') return;
  term.xterm = new Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    theme: {
      background: '#000000',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4'
    },
    scrollback: 5000,
    convertEol: false,
    allowProposedApi: true
  });
  try {
    const FitCtor = (window.FitAddon && window.FitAddon.FitAddon) || null;
    if (FitCtor) {
      term.fitAddon = new FitCtor();
      term.xterm.loadAddon(term.fitAddon);
    }
  } catch (e) { console.warn('FitAddon not available:', e); }
  term.xterm.open(container);
  try { term.fitAddon && term.fitAddon.fit(); } catch {}

  // Forward every keystroke to the PTY (supports arrows, Ctrl+C, etc.)
  term.xterm.onData((data) => {
    if (!term.currentId) return;
    const id = term.currentId === '__global__' ? null : term.currentId;
    api.termWrite(id, data);
  });

  // Resize PTY when the xterm layout changes
  term.xterm.onResize(({ cols, rows }) => {
    if (!term.currentId) return;
    const id = term.currentId === '__global__' ? null : term.currentId;
    api.termResize(id, cols, rows);
  });

  // Window resize -> re-fit
  window.addEventListener('resize', () => {
    try { term.fitAddon && term.fitAddon.fit(); } catch {}
  });
}

async function ensureTerminalStarted() {
  initXterm();
  const cur = getCurrent();
  const id = (cur && state.currentId !== '__new__') ? cur.id : '__global__';
  term.currentId = id;
  if (term.started.has(id)) { updateTermStatus('ativo'); return id; }
  updateTermStatus('iniciando...');
  const res = await api.termStart(id === '__global__' ? null : id);
  if (res && res.ok) {
    term.started.add(id);
    updateTermStatus(`ativo (${res.shell ? res.shell.split(/[\\/]/).pop() : 'shell'})`);
    // After start, send initial size from xterm
    try {
      if (term.xterm) {
        await api.termResize(id === '__global__' ? null : id, term.xterm.cols, term.xterm.rows);
      }
    } catch {}
  } else {
    updateTermStatus('erro: ' + (res && res.error));
    if (term.xterm) term.xterm.writeln(`\x1b[31m[erro ao iniciar terminal: ${res && res.error}]\x1b[0m`);
  }
  return id;
}

function termClear() {
  if (term.xterm) term.xterm.clear();
}

// ---------- Logs ----------
function appendLog(entry) {
  const view = $('#logView');
  const line = document.createElement('div');
  line.className = `log-line ${entry.level || 'info'}`;
  const ts = new Date(entry.ts || Date.now()).toLocaleTimeString();
  line.innerHTML = `<span class="ts">${ts}</span>${escapeHtml(entry.msg || '')}`;
  view.appendChild(line);
  view.scrollTop = view.scrollHeight;
  while (view.childElementCount > 500) view.removeChild(view.firstChild);
}

// ---------- Init ----------
function bindEvents() {
  $('#newProjectBtn').addEventListener('click', newProject);

  $('#openSettingsBtn').addEventListener('click', openSettings);

  $('#settingLanguage').addEventListener('change', async (e) => {
    const lang = e.target.value;
    await applyLanguage(lang);
    try { await api.setSettings({ language: lang }); } catch {}
  });

  $('#btnExportProjects').addEventListener('click', async () => {
    const res = await api.exportProjects();
    if (res.canceled) return;
    if (res.ok) toast(window.i18n.t('app.exportedOk', { path: res.path }), 'success');
    else toast(window.i18n.t('toast.uploadError', { err: res.error || 'falha' }), 'error');
  });

  const doImport = async (mode) => {
    // Dialog first - if user picks a file, then confirm
    const res = await api.importProjects(mode);
    if (res.canceled) return;
    if (res.ok) {
      toast(window.i18n.t('app.importedOk', { count: res.count }), 'success');
      await loadProjects();
      openSettings(); // stay on settings view after import
    } else {
      toast(window.i18n.t('toast.uploadError', { err: res.error || 'falha' }), 'error');
    }
  };
  $('#btnImportMerge').addEventListener('click', () => doImport('merge'));
  $('#btnImportReplace').addEventListener('click', () => doImport('replace'));

  $('#openFolderBtn').addEventListener('click', async () => {
    const cur = getCurrent();
    if (!cur || !cur.localPath) return;
    const res = await api.openPath(cur.localPath);
    if (!res.ok) toast(window.i18n.t('toast.folderError', { err: res.error }), 'error');
  });

  $('#pickFolderBtn').addEventListener('click', async () => {
    const folder = await api.pickFolder();
    if (folder) $('#cfgLocalPath').value = folder;
  });

  $('#configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = getCurrent();
    const ignores = $('#cfgIgnores').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const payload = {
      id: state.currentId === '__new__' ? null : (cur && cur.id),
      name: $('#cfgName').value.trim(),
      localPath: $('#cfgLocalPath').value.trim(),
      protocol: $('#cfgProtocol').value,
      port: Number($('#cfgPort').value) || ($('#cfgProtocol').value === 'sftp' ? 22 : 21),
      host: $('#cfgHost').value.trim(),
      user: $('#cfgUser').value,
      password: $('#cfgPassword').value,
      remotePath: $('#cfgRemotePath').value.trim() || '/',
      secure: $('#cfgSecure').checked,
      ignores
    };
    if (!payload.name) { toast('Informe um nome', 'error'); return; }
    if (!payload.localPath) { toast('Selecione a pasta local', 'error'); return; }
    if (!payload.host) { toast('Informe o host', 'error'); return; }
    try {
      const saved = await api.saveProject(payload);
      state.draft = null;
      state.currentId = saved.id;
      await loadProjects();
      toast(window.i18n.t('toast.saved'), 'success');
    } catch (err) {
      toast('Erro: ' + err.message, 'error');
    }
  });

  $('#deleteBtn').addEventListener('click', async () => {
    if (state.currentId === '__new__') {
      state.draft = null;
      state.currentId = null;
      renderProjects(); renderCurrent();
      return;
    }
    const cur = getCurrent();
    if (!cur) return;
    if (!confirm(`Excluir projeto "${cur.name}"? As versoes locais serao mantidas na pasta.`)) return;
    await api.deleteProject(cur.id);
    state.currentId = null;
    await loadProjects();
    toast('Projeto excluido');
  });

  $('#testBtn').addEventListener('click', async () => {
    if (state.currentId === '__new__') { toast('Salve o projeto primeiro', 'error'); return; }
    const cur = getCurrent();
    if (!cur) return;
    toast('Testando conexao...');
    const res = await api.testConnection(cur);
    if (res.ok) toast('Conexao OK', 'success');
    else toast('Falha: ' + res.error, 'error');
  });

  $('#uploadBtn').addEventListener('click', async () => {
    if (state.currentId === '__new__') { toast('Salve o projeto primeiro', 'error'); return; }
    const cur = getCurrent();
    if (!cur) return;
    $('#uploadBtn').disabled = true;
    toast('Upload iniciado...');
    const res = await api.syncUpload(cur.id);
    $('#uploadBtn').disabled = false;
    if (res.ok) toast(`Upload concluido: ${res.count} arquivos`, 'success');
    else toast('Erro: ' + res.error, 'error');
    refreshFiles();
  });

  $('#downloadBtn').addEventListener('click', async () => {
    if (state.currentId === '__new__') { toast('Salve o projeto primeiro', 'error'); return; }
    const cur = getCurrent();
    if (!cur) return;
    if (!confirm('Baixar todos os arquivos do servidor? Arquivos locais existentes serao sobrescritos (uma versao sera salva antes).')) return;
    $('#downloadBtn').disabled = true;
    toast('Download iniciado...');
    const res = await api.syncDownload(cur.id);
    $('#downloadBtn').disabled = false;
    if (res.ok) toast(`Download concluido: ${res.count} arquivos`, 'success');
    else toast('Erro: ' + res.error, 'error');
    refreshFiles();
  });

  $('#autoToggle').addEventListener('change', async (e) => {
    if (state.currentId === '__new__') {
      e.target.checked = false;
      toast(window.i18n.t('toast.saveProjectFirst'), 'error');
      return;
    }
    const cur = getCurrent();
    if (!cur) return;
    if (e.target.checked) {
      const res = await api.startAutoUpload(cur.id);
      if (res.ok) {
        const msg = res.pendingCount > 0
          ? window.i18n.t('toast.autoOnPending', { count: res.pendingCount })
          : window.i18n.t('toast.autoOn');
        toast(msg, 'success');
      } else { toast(window.i18n.t('toast.uploadError', { err: res.error }), 'error'); e.target.checked = false; }
    } else {
      await api.stopAutoUpload(cur.id);
      toast(window.i18n.t('toast.autoOff'));
    }
    await loadProjects();
  });

  $('#fileFilter').addEventListener('input', (e) => { state.filter = e.target.value; renderFiles(); });
  $('#refreshFilesBtn').addEventListener('click', refreshFiles);
  $('#clearLogsBtn').addEventListener('click', () => { $('#logView').innerHTML = ''; });
  $('#closeVersionsBtn').addEventListener('click', closeVersions);
  $('#versionsModal').addEventListener('click', (e) => { if (e.target.id === 'versionsModal') closeVersions(); });
  $('#closeViewerBtn').addEventListener('click', closeViewer);
  $('#viewerModal').addEventListener('click', (e) => { if (e.target.id === 'viewerModal') closeViewer(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#viewerModal').classList.contains('hidden')) closeViewer();
      else if (!$('#versionsModal').classList.contains('hidden')) closeVersions();
    }
  });

  $$('.tab').forEach((t) => { t.addEventListener('click', () => switchTab(t.dataset.tab)); });

  api.onLog(appendLog);
  api.onFileActivity((act) => {
    if (act.projectId === state.currentId) refreshFiles();
  });

  // Terminal bindings
  const termClearBtn = $('#termClearBtn');
  const termRestartBtn = $('#termRestartBtn');
  if (termClearBtn) termClearBtn.addEventListener('click', termClear);
  if (termRestartBtn) termRestartBtn.addEventListener('click', async () => {
    const id = term.currentId;
    if (id) {
      await api.termKill(id === '__global__' ? null : id);
      term.started.delete(id);
    }
    termClear();
    await ensureTerminalStarted();
  });

  api.onTermData((payload) => {
    if (!term.xterm || !term.currentId) return;
    const matches = (payload.projectId === term.currentId)
      || (term.currentId === '__global__' && !payload.projectId);
    if (matches) term.xterm.write(payload.data);
  });
  api.onTermExit((payload) => {
    const matches = (payload.projectId === term.currentId)
      || (term.currentId === '__global__' && !payload.projectId);
    if (matches) {
      if (term.xterm) term.xterm.write(payload.data || '\r\n[terminal encerrado]\r\n');
      term.started.delete(term.currentId);
      updateTermStatus('parado');
    }
  });
}

async function init() {
  // 1. bindEvents FIRST so clicks always work, even if later steps fail.
  try { bindEvents(); } catch (e) { console.error('bindEvents failed:', e); }
  try { renderIcons(); } catch (e) { console.error('renderIcons failed:', e); }
  try {
    const settings = await api.getSettings();
    await applyLanguage(settings && settings.language ? settings.language : 'pt');
  } catch (e) { console.error('applyLanguage failed:', e); }
  try { await loadProjects(); } catch (e) { console.error('loadProjects failed:', e); }
  console.log('[renderer] init complete. api?', !!window.api, 'icon?', typeof window.icon);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
