const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 640,
    backgroundColor: '#0f172a', title: 'Gestor de Tienda', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') }
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
// Respaldo diario: Documentos\Gestor de Tienda\Respaldos (se conservan los últimos 4 días)
ipcMain.handle('rb:save', async (e, name, text) => {
  let remote = ''; try { remote = require('./remote.json').url || ''; } catch { }
  const from = (e.senderFrame && e.senderFrame.url) || '';
  if (!(from.startsWith('file:') || (remote && from.startsWith(new URL(remote).origin)))) throw new Error('origen no permitido');
  if (typeof name !== 'string' || !/^respaldo-[\w-]+-\d{4}-\d{2}-\d{2}\.json$/.test(name) || typeof text !== 'string') throw new Error('nombre no válido');
  const dir = path.join(app.getPath('documents'), 'Gestor de Tienda', 'Respaldos');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name); fs.writeFileSync(file, text, 'utf8');
  const olds = fs.readdirSync(dir).map(n => ({ n, m: /^respaldo-.+-(\d{4}-\d{2}-\d{2})\.json$/.exec(n) })).filter(x => x.m).sort((a, b) => b.m[1].localeCompare(a.m[1])).slice(4);
  for (const x of olds) { try { fs.unlinkSync(path.join(dir, x.n)); } catch { } }
  return { path: file, bytes: Buffer.byteLength(text) };
});
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
