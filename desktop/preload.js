const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  updateShortcuts: (shortcuts) => ipcRenderer.invoke('update-shortcuts', shortcuts),
  resetShortcuts: () => ipcRenderer.invoke('reset-shortcuts'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  toggleContentProtection: () => ipcRenderer.invoke('toggle-content-protection'),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  syncOverlayWindow: (payload) => ipcRenderer.invoke('sync-overlay-window', payload),
  resizeOverlayWindow: (payload) => ipcRenderer.invoke('resize-overlay-window', payload),
  destroyOverlay: () => ipcRenderer.invoke('destroy-overlay'),
  moveOverlayWindow: (dx, dy) => ipcRenderer.invoke('move-overlay-window', dx, dy),
  overlayDragStart: () => ipcRenderer.sendSync('overlay-drag-start'),
  overlayDragEnd: () => ipcRenderer.send('overlay-drag-end'),
  getOverlayState: () => ipcRenderer.invoke('get-overlay-state'),
  listSystemTtsVoices: () => ipcRenderer.invoke('list-system-tts-voices'),
  synthesizeSystemTts: (payload) => ipcRenderer.invoke('synthesize-system-tts', payload),
  onOverlayState: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('overlay-state', wrapped);
    return () => ipcRenderer.removeListener('overlay-state', wrapped);
  },
  onShortcuts: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('shortcuts-state', wrapped);
    return () => ipcRenderer.removeListener('shortcuts-state', wrapped);
  },
  onFocusTabCommand: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('focus-tab-command', wrapped);
    return () => ipcRenderer.removeListener('focus-tab-command', wrapped);
  },
  onOverlayQuestionCommand: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('overlay-question-command', wrapped);
    return () => ipcRenderer.removeListener('overlay-question-command', wrapped);
  },
  removeOverlayStateListener: (listener) => {
    if (listener) ipcRenderer.removeListener('overlay-state', listener);
  },
});
