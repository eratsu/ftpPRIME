const fs = require('fs');
const path = require('path');

/**
 * Stores file versions under <projectRoot>/.ftpsender/versions/<hashedRel>/<timestamp>[.ext]
 * Keeps index.json per project with metadata.
 */
class VersionManager {
  constructor(projectRoot) {
    this.root = path.join(projectRoot, '.ftpsender');
    this.versionsDir = path.join(this.root, 'versions');
    this.indexPath = path.join(this.root, 'index.json');
    this.uploadLogPath = path.join(this.root, 'uploads.json');
    fs.mkdirSync(this.versionsDir, { recursive: true });
    this._loadIndex();
    this._loadUploadLog();
  }

  _loadIndex() {
    try {
      this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    } catch {
      this.index = {}; // relPath -> [{ id, ts, size, action }]
    }
  }

  _saveIndex() {
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  _loadUploadLog() {
    try {
      this.uploads = JSON.parse(fs.readFileSync(this.uploadLogPath, 'utf8'));
    } catch {
      this.uploads = {}; // relPath -> { lastUploadAt, lastAction }
    }
  }

  _saveUploadLog() {
    fs.writeFileSync(this.uploadLogPath, JSON.stringify(this.uploads, null, 2));
  }

  _safeKey(relPath) {
    return relPath.replace(/\\/g, '/').replace(/[^\w./-]/g, '_');
  }

  /**
   * Snapshot a file before an action (upload/download/restore).
   * Returns version id or null if source doesn't exist.
   */
  snapshot(localFilePath, relPath, action = 'upload') {
    if (!fs.existsSync(localFilePath)) return null;
    const stat = fs.statSync(localFilePath);
    if (!stat.isFile()) return null;
    const key = this._safeKey(relPath);
    const dir = path.join(this.versionsDir, key);
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const ext = path.extname(relPath);
    const id = `${ts}${ext}`;
    const dest = path.join(dir, id);
    fs.copyFileSync(localFilePath, dest);
    if (!this.index[relPath]) this.index[relPath] = [];
    this.index[relPath].push({ id, ts, size: stat.size, action });
    // cap to 50 versions per file
    if (this.index[relPath].length > 50) {
      const removed = this.index[relPath].splice(0, this.index[relPath].length - 50);
      for (const r of removed) {
        try { fs.unlinkSync(path.join(dir, r.id)); } catch {}
      }
    }
    this._saveIndex();
    return id;
  }

  recordUpload(relPath, action = 'upload') {
    this.uploads[relPath] = { lastUploadAt: Date.now(), lastAction: action };
    this._saveUploadLog();
  }

  listVersions(relPath) {
    return (this.index[relPath] || []).slice().sort((a, b) => b.ts - a.ts);
  }

  getVersionPath(relPath, versionId) {
    const key = this._safeKey(relPath);
    return path.join(this.versionsDir, key, versionId);
  }

  restoreVersion(projectRoot, relPath, versionId) {
    const src = this.getVersionPath(relPath, versionId);
    if (!fs.existsSync(src)) throw new Error('Version file not found');
    const dest = path.join(projectRoot, relPath);
    // snapshot current before restore
    if (fs.existsSync(dest)) this.snapshot(dest, relPath, 'pre-restore');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return dest;
  }

  readVersion(relPath, versionId, maxBytes = 2 * 1024 * 1024) {
    const src = this.getVersionPath(relPath, versionId);
    if (!fs.existsSync(src)) throw new Error('Version file not found');
    const stat = fs.statSync(src);
    const buf = fs.readFileSync(src);
    // Heuristic: binary if contains NUL bytes in first 8KB
    const sample = buf.subarray(0, Math.min(buf.length, 8192));
    let isBinary = false;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) { isBinary = true; break; }
    }
    const truncated = buf.length > maxBytes;
    const content = isBinary
      ? null
      : (truncated ? buf.subarray(0, maxBytes) : buf).toString('utf8');
    return {
      size: stat.size,
      isBinary,
      truncated,
      ext: path.extname(relPath).replace(/^\./, '').toLowerCase(),
      content
    };
  }

  getUploadInfo(relPath) {
    return this.uploads[relPath] || null;
  }

  getAllUploadInfo() {
    return this.uploads;
  }
}

module.exports = { VersionManager };
