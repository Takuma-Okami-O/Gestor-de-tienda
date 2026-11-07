const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 640,
    backgroundColor: '#0f172a', title: 'Gestor de Tienda', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  Menu.setApplicationMenu(null);
  // Actualizaciones automáticas: abre la versión publicada en internet (siempre la más nueva).
  // Si no hay internet o falla, usa la copia incluida en el programa.
  let remote = '';
  try { remote = require('./remote.json').url || ''; } catch { }
  const local = () => win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  if (remote) {
    win.webContents.on('did-fail-load', (e, code, d, url, main) => { if (main && /^https?:/i.test(url) && code !== -3) local(); });
    win.loadURL(remote);
  } else local();
  // enlaces externos (WhatsApp, etc.) se abren en el navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && !(remote && url.startsWith(remote))) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
}
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
