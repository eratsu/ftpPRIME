const ftp = require('basic-ftp');
const SftpClient = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

/**
 * Unified FTP/SFTP client wrapper.
 * project.protocol: 'ftp' | 'sftp'
 * project.host, port, user, password, remotePath, secure (for ftp tls)
 */
class FtpService {
  constructor(project, logger = () => {}) {
    this.project = project;
    this.log = logger;
    this.protocol = (project.protocol || 'ftp').toLowerCase();
    this.client = null;
  }

  async connect() {
    if (this.protocol === 'sftp') {
      this.client = new SftpClient();
      await this.client.connect({
        host: this.project.host,
        port: Number(this.project.port) || 22,
        username: this.project.user,
        password: this.project.password
      });
    } else {
      this.client = new ftp.Client();
      this.client.ftp.verbose = false;
      await this.client.access({
        host: this.project.host,
        port: Number(this.project.port) || 21,
        user: this.project.user,
        password: this.project.password,
        secure: !!this.project.secure
      });
    }
  }

  async disconnect() {
    try {
      if (!this.client) return;
      if (this.protocol === 'sftp') await this.client.end();
      else this.client.close();
    } catch (e) { /* ignore */ }
    this.client = null;
  }

  _remote(p) {
    const base = (this.project.remotePath || '/').replace(/\\/g, '/');
    const rel = p.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel) return base;
    return (base.endsWith('/') ? base : base + '/') + rel;
  }

  async ensureRemoteDir(remoteDir) {
    const normalized = remoteDir.replace(/\\/g, '/');
    if (this.protocol === 'sftp') {
      try {
        const exists = await this.client.exists(normalized);
        if (!exists) await this.client.mkdir(normalized, true);
      } catch (e) {
        await this.client.mkdir(normalized, true);
      }
    } else {
      await this.client.ensureDir(normalized);
      // ensureDir leaves cwd at that dir; reset to root for safety
      await this.client.cd('/');
    }
  }

  async uploadFile(localPath, relPath) {
    const remote = this._remote(relPath);
    const remoteDir = path.posix.dirname(remote);
    await this.ensureRemoteDir(remoteDir);
    if (this.protocol === 'sftp') {
      await this.client.fastPut(localPath, remote);
    } else {
      await this.client.uploadFrom(localPath, remote);
    }
    this.log({ level: 'info', msg: `Upload: ${relPath}` });
  }

  async downloadFile(localPath, relPath) {
    const remote = this._remote(relPath);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    if (this.protocol === 'sftp') {
      await this.client.fastGet(remote, localPath);
    } else {
      await this.client.downloadTo(localPath, remote);
    }
    this.log({ level: 'info', msg: `Download: ${relPath}` });
  }

  /**
   * List files recursively from remote base.
   * Returns array of { relPath, size, modifiedAt, type }
   */
  async listRemoteRecursive(subPath = '') {
    const results = [];
    const base = this._remote(subPath);
    const walk = async (dir, prefix) => {
      let entries = [];
      try {
        if (this.protocol === 'sftp') {
          entries = await this.client.list(dir);
          entries = entries.map((e) => ({
            name: e.name,
            isDir: e.type === 'd',
            size: e.size,
            modifiedAt: e.modifyTime ? new Date(e.modifyTime) : null
          }));
        } else {
          const raw = await this.client.list(dir);
          entries = raw.map((e) => ({
            name: e.name,
            isDir: e.type === 2 || e.isDirectory,
            size: e.size,
            modifiedAt: e.modifiedAt || (e.rawModifiedAt ? new Date(e.rawModifiedAt) : null)
          }));
        }
      } catch (e) {
        this.log({ level: 'warn', msg: `list fail ${dir}: ${e.message}` });
        return;
      }
      for (const ent of entries) {
        if (ent.name === '.' || ent.name === '..') continue;
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        const full = dir.endsWith('/') ? dir + ent.name : dir + '/' + ent.name;
        if (ent.isDir) {
          results.push({ relPath: rel, type: 'dir' });
          await walk(full, rel);
        } else {
          results.push({ relPath: rel, type: 'file', size: ent.size, modifiedAt: ent.modifiedAt });
        }
      }
    };
    await walk(base, '');
    return results;
  }
}

module.exports = { FtpService };
