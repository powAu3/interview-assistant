const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  updateShortcuts: (shortcuts) => ipcRenderer.invoke('update-shortcuts', shortcuts),
  resetShortcuts: () => ipcRenderer.invoke('reset-shortcuts'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  toggleContentProtection: () => ipcRenderer.invoke('toggle-content-protection'),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  syncOverlayWindow: (payload) => ipcRenderer.invoke('sync-overlay-window', payload),
  moveOverlayWindow: (dx, dy) => ipcRenderer.invoke('move-overlay-window', dx, dy),
  overlayDragStart: () => ipcRenderer.sendSync('overlay-drag-start'),
  overlayDragEnd: () => ipcRenderer.send('overlay-drag-end'),
  getOverlayState: () => ipcRenderer.invoke('get-overlay-state'),
  onOverlayState: (listener) => {
    ipcRenderer.removeAllListeners('overlay-state');
    ipcRenderer.on('overlay-state', (_event, payload) => listener(payload));
  },
  removeOverlayStateListener: () => ipcRenderer.removeAllListeners('overlay-state'),
});
