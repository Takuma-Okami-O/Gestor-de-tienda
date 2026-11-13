const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gestorFS', { saveBackup: (name, text) => ipcRenderer.invoke('rb:save', name, text) });
