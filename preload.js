const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Projects CRUD
  listProjects: () => ipcRenderer.invoke('projects:list'),
  saveProject: (project) => ipcRenderer.invoke('projects:save', project),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),

  // Folder picker
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),

  // Connection test
  testConnection: (project) => ipcRenderer.invoke('ftp:test', project),

  // Sync
  syncUpload: (id) => ipcRenderer.invoke('sync:upload', id),
  syncDownload: (id) => ipcRenderer.invoke('sync:download', id),
  uploadFile: (id, relPath) => ipcRenderer.invoke('sync:uploadOne', id, relPath),

  // Auto-upload
  startAutoUpload: (id) => ipcRenderer.invoke('auto:start', id),
  stopAutoUpload: (id) => ipcRenderer.invoke('auto:stop', id),
  autoStatus: (id) => ipcRenderer.invoke('auto:status', id),

  // File history / versions
  listFiles: (id) => ipcRenderer.invoke('files:list', id),
  listVersions: (id, relPath) => ipcRenderer.invoke('versions:list', id, relPath),
  restoreVersion: (id, relPath, versionId) => ipcRenderer.invoke('versions:restore', id, relPath, versionId),

  // Log stream
  onLog: (cb) => {
    const listener = (_e, entry) => cb(entry);
    ipcRenderer.on('log', listener);
    return () => ipcRenderer.removeListener('log', listener);
  },
  onFileActivity: (cb) => {
    const listener = (_e, entry) => cb(entry);
    ipcRenderer.on('file-activity', listener);
    return () => ipcRenderer.removeListener('file-activity', listener);
  },

  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  readVersion: (id, relPath, versionId) => ipcRenderer.invoke('versions:read', id, relPath, versionId),

  // App settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  exportProjects: () => ipcRenderer.invoke('settings:exportProjects'),
  importProjects: (mode) => ipcRenderer.invoke('settings:importProjects', mode),

  // Terminal
  termStart: (id) => ipcRenderer.invoke('term:start', id),
  termWrite: (id, data) => ipcRenderer.invoke('term:write', id, data),
  termResize: (id, cols, rows) => ipcRenderer.invoke('term:resize', id, cols, rows),
  termKill: (id) => ipcRenderer.invoke('term:kill', id),
  onTermData: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('term:data', listener);
    return () => ipcRenderer.removeListener('term:data', listener);
  },
  onTermExit: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('term:exit', listener);
    return () => ipcRenderer.removeListener('term:exit', listener);
  }
});
