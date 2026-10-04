const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let backend, window;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    const { createApp } = await import(pathToFileURL(path.join(__dirname, '../src/server.mjs')).href);
    backend = await createApp({ dataDir: app.getPath('userData') });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
    ]));
    const origin = new URL(backend.url).origin;
    function openWindow() {
      window = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 620, backgroundColor: '#111318', title: 'AgentBridge', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
      window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
      window.webContents.session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => requestingOrigin === origin && permission === 'clipboard-sanitized-write');
      window.loadURL(backend.url);
      window.on('closed', () => { window = null; });
    }
    openWindow();
    app.on('activate', () => { if (!window) openWindow(); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  let stopping = false;
  app.on('before-quit', event => {
    if (backend && !stopping) { event.preventDefault(); stopping = true; backend.close().finally(() => app.quit()); }
  });
}
