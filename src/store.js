const fs = require('fs');
const path = require('path');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { projects: [] };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
        if (!Array.isArray(this.data.projects)) this.data.projects = [];
      }
    } catch (e) {
      console.error('Store load error:', e);
      this.data = { projects: [] };
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  listProjects() {
    return this.data.projects;
  }

  getProject(id) {
    return this.data.projects.find((p) => p.id === id);
  }

  saveProject(project) {
    const idx = this.data.projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) this.data.projects[idx] = project;
    else this.data.projects.push(project);
    this._save();
    return project;
  }

  deleteProject(id) {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this._save();
  }

  updateProject(id, patch) {
    const p = this.getProject(id);
    if (!p) return null;
    Object.assign(p, patch);
    this._save();
    return p;
  }
}

module.exports = { Store };
