const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { FtpService } = require('./ftp-service');
const { VersionManager } = require('./version-manager');
const { normalizeIgnores, isIgnored } = require('./sync-engine');

class AutoUploader {
  constructor(project, logger, onActivity) {
    this.project = project;
    this.log = logger || (() => {});
    this.onActivity = onActivity || (() => {});
    this.watcher = null;
    this.queue = [];
    this.processing = false;
    this.ignores = normalizeIgnores(project.ignores);
  }

  start() {
    if (this.watcher) return;
    const root = this.project.localPath;
    this.watcher = chokidar.watch(root, {
      ignored: (p) => {
        const rel = path.relative(root, p).replace(/\\/g, '/');
        if (!rel) return false;
        return isIgnored(rel, this.ignores);
      },
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100
      }
    });

    const handle = (event) => (full) => {
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (!rel) return;
      if (isIgnored(rel, this.ignores)) return;
      this.log({ level: 'info', msg: `Detected ${event}: ${rel}` });
      this.enqueue({ event, relPath: rel });
    };
    this.watcher
      .on('add', handle('add'))
      .on('change', handle('change'))
      .on('unlink', handle('unlink'))
      .on('error', (err) => this.log({ level: 'error', msg: `watcher: ${err.message}` }));
    this.log({ level: 'info', msg: `Auto-upload ativo em ${root}` });
  }

  /**
   * Enqueue files whose mtime is newer than their last recorded upload.
   * Used when auto-upload is turned on to "catch up" files missed while it was off.
   *
   * Baseline per file:
   *   1. uploads.json[relPath].lastUploadAt (most specific)
   *   2. project.lastSyncAt (full-project upload/download timestamp)
   *   3. none -> skip (project never synced; user should run "Upload tudo" first)
   */
  queueModifiedSinceLastUpload() {
    const vm = new VersionManager(this.project.localPath);
    const uploads = vm.getAllUploadInfo();
    const { walkLocal } = require('./sync-engine');
    const files = walkLocal(this.project.localPath, this.ignores).filter((f) => f.type === 'file');
    const projectBaseline = this.project.lastSyncAt || 0;
    let count = 0;
    let skippedNoBaseline = 0;
    for (const f of files) {
      const info = uploads[f.relPath];
      const fileBaseline = info ? info.lastUploadAt : 0;
      const baseline = fileBaseline || projectBaseline;
      if (!baseline) {
        // No sync history at all -> do not auto-send to avoid blasting everything.
        skippedNoBaseline++;
        continue;
      }
      // Small tolerance (1s) to avoid FS-vs-Date.now jitter edge cases.
      if (f.mtime > baseline + 1000) {
        this.enqueue({ event: 'change', relPath: f.relPath });
        count++;
      }
    }
    if (count > 0) {
      this.log({ level: 'info', msg: `Catch-up auto-upload: ${count} arquivo(s) modificado(s) desde o último envio` });
    }
    if (skippedNoBaseline > 0) {
      this.log({ level: 'warn', msg: `Catch-up: ${skippedNoBaseline} arquivo(s) sem histórico de envio (ignorados - faça "Upload tudo" primeiro para criar baseline)` });
    }
    return count;
  }

  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.log({ level: 'info', msg: 'Auto-upload parado' });
    }
  }

  enqueue(task) {
    // dedupe
    this.queue = this.queue.filter((t) => t.relPath !== task.relPath);
    this.queue.push(task);
    this._drain();
  }

  async _drain() {
    if (this.processing) return;
    this.processing = true;
    const vm = new VersionManager(this.project.localPath);
    const ftp = new FtpService(this.project, this.log);
    try {
      await ftp.connect();
      while (this.queue.length) {
        const task = this.queue.shift();
        try {
          if (task.event === 'unlink') {
            this.log({ level: 'warn', msg: `(ignorado) arquivo removido localmente: ${task.relPath}` });
            this.onActivity({ relPath: task.relPath, action: 'local-delete', ts: Date.now() });
            continue;
          }
          const localFull = path.join(this.project.localPath, task.relPath);
          if (!fs.existsSync(localFull)) continue;
          vm.snapshot(localFull, task.relPath, 'auto-upload');
          await ftp.uploadFile(localFull, task.relPath);
          vm.recordUpload(task.relPath, 'auto-upload');
          this.onActivity({ relPath: task.relPath, action: 'uploaded', ts: Date.now() });
        } catch (e) {
          this.log({ level: 'error', msg: `auto-upload ${task.relPath}: ${e.message}` });
          this.onActivity({ relPath: task.relPath, action: 'error', ts: Date.now(), error: e.message });
        }
      }
    } catch (e) {
      this.log({ level: 'error', msg: `conexão auto: ${e.message}` });
    } finally {
      await ftp.disconnect();
      this.processing = false;
    }
  }
}

module.exports = { AutoUploader };
