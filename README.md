# ftpPRIME

The best and most complete desktop application for syncing projects via **FTP / SFTP** with:

- Pick a local folder as a "project" and configure FTP/SFTP credentials per project (multiple projects in parallel)
- **One-click** sync: full Upload (local → server) or full Download (server → local)
- **Inline per-file upload** — upload icon next to each item in the list to force an individual send
- **Auto-upload**: when enabled, the app watches the folder (via chokidar) and automatically sends every modified/created file
- **Automatic catch-up**: when you re-enable auto-upload, files that changed while it was off get queued and sent
- **Ignore patterns** per project (accepts plain names or globs: `node_modules`, `*.log`, `dist/**`)
- **Last upload** date/time per file plus the last action taken
- **Local version control**: every upload/download takes a snapshot of the file before the action, allowing you to **view** the contents of a version and **restore** previous versions
- **Built-in terminal** per project — real PTY (ConPTY on Windows) with xterm.js, supporting PowerShell 7 / Windows PowerShell / cmd, interactive CLIs (git, claude, npm, TUIs), ANSI colors, Ctrl+C, etc.
- **Minimize to tray** — closing the window keeps the app running in the tray; auto-uploads, watchers, and terminal sessions stay alive. To fully quit: right-click the tray icon → **Quit**
- **Open project folder** in Explorer with one click on the icon next to the path
- **Settings** (gear button at the top) including:
  - **Language selection** — 14 languages: Português, English, Español, Italiano, Français, Deutsch, Русский, Polski, Қазақша, 日本語, 中文, 한국어, हिन्दी, العربية (RTL layout automatic for Arabic)
  - **Export configuration** of all projects to a JSON file
  - **Import configuration** from a JSON file (with confirmation before overwriting)
- Real-time logs and connection test

## Installation

Requires Node.js 18+.

```bash
npm install
npm start        # production
npm run dev      # with --enable-logging
```

### Native dependencies

- **`@homebridge/node-pty-prebuilt-multiarch`** ships prebuilt PTY binaries, so you **do not need** Python / Visual Studio Build Tools installed.
- **xterm.js** (`@xterm/xterm` + `@xterm/addon-fit`) is copied to `src/vendor/` and loaded under CSP `'self'`.

## How version control works

Each project gets a `.ftpsender/` folder inside the local folder containing:

- `versions/<file>/<timestamp>` — binary snapshots
- `index.json` — version index per file
- `uploads.json` — last upload date/time per file

This folder is **automatically ignored** during upload. Up to 50 versions per file are kept (oldest are pruned).

In the **Versions** modal you have two buttons per item:

- **View** — opens a viewer with line numbers; binary files are detected (NUL-byte scan) and files larger than 2 MB are truncated.
- **Restore** — the current file is first saved as a new version (`pre-restore`) and the selected version is copied into place. Then run "Upload all" or let auto-upload push it to the server.

## How auto-upload catch-up works

When you re-enable auto-upload after some time off, the app scans the folder and queues only files whose `mtime` is newer than the baseline, where:

1. **Preferred baseline:** `uploads.json[file].lastUploadAt` (file-specific timestamp)
2. **Fallback:** `project.lastSyncAt` (last "Upload/Download all")
3. **No history:** the file is skipped (a warning is logged). Run "Upload all" to seed a baseline.

A 1-second tolerance is applied to avoid filesystem jitter.

## Internationalization (i18n)

- Strings live in `src/locales.js` organized by key (e.g. `app.newProject`, `file.upload`, `toast.uploadDone`).
- The `window.i18n` runtime applies texts via `data-i18n`, `data-i18n-title`, and `data-i18n-placeholder` attributes on HTML elements.
- Available languages: `pt`, `en`, `es`, `it`, `fr`, `de`, `ru`, `pl`, `kk`, `ja`, `zh`, `ko`, `hi`, `ar`.
- For Arabic (`ar`), `document.documentElement.dir` is automatically set to `rtl` and the gear button / layout adjust via the `[dir="rtl"]` selector in `styles.css`.
- The chosen language is persisted in `%APPDATA%/ftpsender/settings.json` and restored on the next start.

## Security

- Credentials are stored in plain text at `%APPDATA%/ftpsender/projects.json` (Windows).  
  *In production, consider integrating with `keytar` or similar.*
- **Export/Import** writes/reads projects as JSON — the file contains plain-text credentials, **store it carefully**.
- FTPS (TLS) is supported by checking the box in FTP mode.
- **Single-instance lock**: only one instance can run at a time (avoids Chromium cache conflicts on Windows). Launching a second instance focuses the existing window and exits.
- **HTTP cache disabled** (`disable-http-cache`) — the app does not need it, and this eliminates the `Unable to move the cache: Access denied` error on Windows.

## Structure

```
main.js                 # Electron main process + IPC + tray + PTY
preload.js              # Secure bridge to the renderer (contextBridge)
src/
  index.html            # UI
  styles.css
  renderer.js           # UI logic + i18n runtime
  icons.js              # Inline SVG icons (lucide-style)
  locales.js            # Translations for 14 languages
  store.js              # Project persistence (%APPDATA%)
  app-settings.js       # Preferences persistence (language, etc.)
  ftp-service.js        # Unified FTP/SFTP client
  sync-engine.js        # walkLocal, uploadAll, uploadOne, downloadAll, ignores
  version-manager.js    # Snapshots, restore, readVersion
  watcher.js            # Auto-upload (chokidar) + catch-up
  vendor/               # xterm.js + addon-fit (loaded under CSP 'self')
  imgs/
    ftpprime-icon.png   # Application icon (window + tray)
```

## Shortcuts and tips

- Create a new project, pick the local folder, configure host/user/password and **save**.
- Click **Test connection** to validate credentials.
- Use **Upload all** / **Download all** for one-shot sync.
- Enable **Auto-upload** for continuous sending while you work.
- Click the **upload icon** (▲) next to a file to force an individual send.
- Click **Versions** on any file to **View** the contents or **Restore**.
- The **Terminal** tab opens a real shell with cwd at the project folder — handy for git, npm, claude-code, etc.
- Closing the window **minimizes to the tray**. To quit: click the tray icon → **Quit**.
- Click the **gear** at the top of the sidebar to switch language or export/import projects.
- `ESC` closes the versions modal and the viewer.
