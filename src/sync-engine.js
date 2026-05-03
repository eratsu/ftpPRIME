const fs = require('fs');
const path = require('path');
const micromatch = require('micromatch');
const { FtpService } = require('./ftp-service');
const { VersionManager } = require('./version-manager');

const DEFAULT_IGNORES = ['.ftpsender', '.ftpsender/**', '.git', '.git/**', 'node_modules', 'node_modules/**'];

function normalizeIgnores(patterns) {
  const out = new Set(DEFAULT_IGNORES);
  for (const raw of patterns || []) {
    const p = String(raw).trim();
    if (!p) continue;
    out.add(p);
    if (!p.includes('*') && !p.includes('/')) {
      // plain name -> match anywhere
      out.add(`**/${p}`);
      out.add(`**/${p}/**`);
    } else if (!p.includes('*')) {
      out.add(`${p}/**`);
    }
  }
  return Array.from(out);
}

function isIgnored(relPath, patterns) {
  const norm = relPath.replace(/\\/g, '/');
  return micromatch.isMatch(norm, patterns, { dot: true });
}

function walkLocal(root, ignores) {
  const results = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (isIgnored(rel, ignores)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        results.push({ relPath: rel, type: 'dir' });
        walk(full, rel);
      } else if (ent.isFile()) {
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        results.push({ relPath: rel, type: 'file', size: stat.size, mtime: stat.mtimeMs });
      }
    }
  };
  walk(root, '');
  return results;
}

async function uploadAll(project, logger) {
  const ignores = normalizeIgnores(project.ignores);
  const vm = new VersionManager(project.localPath);
  const files = walkLocal(project.localPath, ignores).filter((f) => f.type === 'file');
  const ftp = new FtpService(project, logger);
  await ftp.connect();
  try {
    for (const f of files) {
      const localFull = path.join(project.localPath, f.relPath);
      vm.snapshot(localFull, f.relPath, 'upload');
      await ftp.uploadFile(localFull, f.relPath);
      vm.recordUpload(f.relPath, 'upload');
    }
  } finally {
    await ftp.disconnect();
  }
  return { count: files.length };
}

async function uploadOne(project, relPath, logger) {
  const vm = new VersionManager(project.localPath);
  const localFull = path.join(project.localPath, relPath);
  if (!fs.existsSync(localFull)) return { skipped: true };
  const ftp = new FtpService(project, logger);
  await ftp.connect();
  try {
    vm.snapshot(localFull, relPath, 'upload');
    await ftp.uploadFile(localFull, relPath);
    vm.recordUpload(relPath, 'upload');
  } finally {
    await ftp.disconnect();
  }
  return { ok: true };
}

async function downloadAll(project, logger) {
  const ignores = normalizeIgnores(project.ignores);
  const vm = new VersionManager(project.localPath);
  const ftp = new FtpService(project, logger);
  await ftp.connect();
  let count = 0;
  try {
    const remote = await ftp.listRemoteRecursive();
    for (const entry of remote) {
      if (entry.type !== 'file') continue;
      if (isIgnored(entry.relPath, ignores)) continue;
      const localFull = path.join(project.localPath, entry.relPath);
      if (fs.existsSync(localFull)) vm.snapshot(localFull, entry.relPath, 'pre-download');
      await ftp.downloadFile(localFull, entry.relPath);
      vm.recordUpload(entry.relPath, 'download');
      count++;
    }
  } finally {
    await ftp.disconnect();
  }
  return { count };
}

async function testConnection(project) {
  const ftp = new FtpService(project);
  await ftp.connect();
  await ftp.disconnect();
  return true;
}

module.exports = {
  uploadAll,
  uploadOne,
  downloadAll,
  testConnection,
  walkLocal,
  normalizeIgnores,
  isIgnored
};
