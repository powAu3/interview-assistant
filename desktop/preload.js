const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  toggleContentProtection: () => ipcRenderer.invoke('toggle-content-protection'),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
});
