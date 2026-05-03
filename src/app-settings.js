const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  language: 'pt'
};

class AppSettings {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = { ...DEFAULTS, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error('AppSettings load error:', e);
      this.data = { ...DEFAULTS };
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  get() { return { ...this.data }; }

  set(patch) {
    Object.assign(this.data, patch || {});
    this._save();
    return this.get();
  }
}

module.exports = { AppSettings };
