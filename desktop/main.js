const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
const {
  ShortcutStatus,
  createShortcutState,
  loadShortcutConfig,
  saveShortcutConfig,
  validateShortcutMap,
} = require('./shortcuts');

const pkg = require('./package.json');

/** 应用显示名：环境变量 ELECTRON_APP_DISPLAY_NAME > desktop/app-title.json > package.json appDisplayName > 默认 */
function loadAppDisplayName() {
  const env = process.env.ELECTRON_APP_DISPLAY_NAME;
  if (env && String(env).trim()) return String(env).trim();
  const titlePath = path.join(__dirname, 'app-title.json');
  try {
    const raw = fs.readFileSync(titlePath, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j.appDisplayName === 'string' && j.appDisplayName.trim()) {
      return j.appDisplayName.trim();
    }
  } catch {
    /* 无文件或解析失败 */
  }
  if (pkg.appDisplayName && String(pkg.appDisplayName).trim()) {
    return String(pkg.appDisplayName).trim();
  }
  return '学习助手';
}

const APP_DISPLAY_NAME = loadAppDisplayName();

const ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const PORT = parseInt(process.env.PORT || '18080', 10);
const SERVER_URL = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let pythonProcess = null;
let isQuitting = false;
let shortcuts = {};
let _overlayDragging = false;
let _blurTimer = null;
let overlayPositionSaveTimer = null;
let lastOverlayState = {
  enabled: false,
  visible: false,
  mode: 'panel',
  opacity: 0.82,
  panelFontSize: 13,
  panelWidth: 420,
  panelShowBg: true,
  panelFontColor: '#ffffff',
  panelHeight: 0,
  lyricLines: 2,
  lyricFontSize: 23,
  lyricWidth: 760,
  lyricColor: '#ffffff',
};

const OVERLAY_PRESETS = {
  panel: { width: 480, height: 320, minWidth: 380, minHeight: 220, resizable: false },
  lyrics: { width: 760, height: 160, minWidth: 420, minHeight: 120, resizable: false },
};

function getOverlayStateFilePath() {
  return path.join(app.getPath('userData'), 'overlay-window.json');
}

function loadOverlayWindowState() {
  try {
    const raw = fs.readFileSync(getOverlayStateFilePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
  } catch {
    /* ignore */
  }
  return { positions: {} };
}

function saveOverlayWindowState(data) {
  try {
    fs.writeFileSync(getOverlayStateFilePath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.warn('saveOverlayWindowState failed:', error);
  }
}

function computeLyricWindowSize(state = lastOverlayState) {
  const width = Math.max(420, Math.min(1200, Math.round(Number(state.lyricWidth) || 760)));
  const lineCount = Math.max(1, Math.min(8, Math.round(Number(state.lyricLines) || 2)));
  const fontSize = Math.max(1, Math.round(Number(state.lyricFontSize) || 23));
  const height = Math.max(60, Math.round(fontSize * lineCount * 1.55 + 40));
  return { width, height };
}

function getOverlayPreset(mode = 'panel', state = lastOverlayState) {
  if (mode === 'lyrics') {
    const { width, height } = computeLyricWindowSize(state);
    return { width, height, minWidth: 420, minHeight: 120, resizable: false };
  }
  return OVERLAY_PRESETS.panel;
}

function getStoredOverlayPosition(mode = 'panel') {
  const preset = getOverlayPreset(mode);
  const saved = loadOverlayWindowState();
  const pos = saved?.positions?.[mode];
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  const displays = screen.getAllDisplays();
  const fitsSomeDisplay = displays.some((display) => {
    const area = display.workArea;
    return (
      pos.x >= area.x - 40
      && pos.x <= area.x + area.width - 80
      && pos.y >= area.y - 40
      && pos.y <= area.y + area.height - 60
    );
  });
  if (fitsSomeDisplay) return { x: pos.x, y: pos.y };
  const primary = screen.getPrimaryDisplay().workArea;
  return {
    x: primary.x + Math.max(16, Math.round((primary.width - preset.width) / 2)),
    y: primary.y + Math.max(16, Math.round((primary.height - preset.height) * 0.18)),
  };
}

function persistOverlayPosition(mode = 'panel') {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const bounds = overlayWindow.getBounds();
  const saved = loadOverlayWindowState();
  saved.positions = saved.positions || {};
  saved.positions[mode] = { x: bounds.x, y: bounds.y };
  saveOverlayWindowState(saved);
}

function schedulePersistOverlayPosition(mode = 'panel') {
  if (overlayPositionSaveTimer) clearTimeout(overlayPositionSaveTimer);
  overlayPositionSaveTimer = setTimeout(() => {
    overlayPositionSaveTimer = null;
    persistOverlayPosition(mode);
  }, 180);
}

function createTrayIcon() {
  const size = 16;
  const canvas = nativeImage.createFromBuffer(
    Buffer.alloc(size * size * 4, 0),
    { width: size, height: size }
  );
  return canvas;
}

function waitForServer(timeout = 40000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`${SERVER_URL}/api/options`, { timeout: 1000 }, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > timeout) return reject(new Error('Server start timeout'));
      setTimeout(check, 300);
    };
    check();
  });
}

function startPythonBackend() {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  pythonProcess = spawn(python, [
    path.join(ROOT, 'start.py'),
    '--mode', 'network',
    '--no-build',
    '--port', String(PORT),
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  pythonProcess.stdout.on('data', (d) => process.stdout.write(`[py] ${d}`));
  pythonProcess.stderr.on('data', (d) => process.stderr.write(`[py] ${d}`));
  pythonProcess.on('close', (code) => {
    console.log(`[py] exited with code ${code}`);
    pythonProcess = null;
    if (!isQuitting) {
      if (mainWindow) {
        const { dialog } = require('electron');
        dialog.showErrorBox('后端已退出', `Python 后端进程异常退出 (code ${code})。\n可能原因：端口 ${PORT} 被占用。\n请关闭占用该端口的进程后重试。`);
      }
      app.quit();
    }
  });
}

function createWindow() {
  const isWindows = process.platform === 'win32';
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: APP_DISPLAY_NAME,
    show: false,
    // Windows 下不在任务栏显示，只在托盘
    skipTaskbar: isWindows,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setContentProtection(true);

  // 每次启动清除缓存，确保加载到最新的前端构建（避免设置里识别引擎等不更新）
  mainWindow.webContents.session.clearCache().then(() => {
    mainWindow.loadURL(SERVER_URL);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const t = JSON.stringify(APP_DISPLAY_NAME);
    mainWindow.webContents.executeJavaScript(`document.title = ${t}`).catch(() => {});
    mainWindow.setTitle(APP_DISPLAY_NAME);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Windows 下最小化 = 隐藏到托盘
  mainWindow.on('minimize', (e) => {
    if (process.platform === 'win32') {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // 关闭按钮 = 真正退出
  mainWindow.on('close', () => {
    isQuitting = true;
  });
}

function applyOverlayPreset(mode = 'panel') {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const preset = getOverlayPreset(mode);
  const bounds = overlayWindow.getBounds();
  const storedPos = getStoredOverlayPosition(mode);
  overlayWindow.setResizable(Boolean(preset.resizable));
  overlayWindow.setMinimumSize(preset.minWidth, preset.minHeight);
  overlayWindow.setBounds({
    x: storedPos?.x ?? bounds.x,
    y: storedPos?.y ?? bounds.y,
    width: preset.width,
    height: preset.height,
  });
  overlayWindow._overlayMode = mode;
}

function createOverlayWindow(mode = 'panel') {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    applyOverlayPreset(mode);
    return overlayWindow;
  }

  const preset = getOverlayPreset(mode);
  const storedPos = getStoredOverlayPosition(mode);
  overlayWindow = new BrowserWindow({
    width: preset.width,
    height: preset.height,
    ...(storedPos ? storedPos : {}),
    minWidth: preset.minWidth,
    minHeight: preset.minHeight,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: preset.resizable,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hiddenInMissionControl: true,
    show: false,
    focusable: true,
    title: `${APP_DISPLAY_NAME} Overlay`,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setContentProtection(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow._overlayMode = mode;
  overlayWindow._overlayReady = false;
  overlayWindow.loadURL(`${SERVER_URL}?overlay=1`);
  overlayWindow.webContents.on('did-finish-load', () => {
    if (lastOverlayState) {
      overlayWindow?.webContents.send('overlay-state', lastOverlayState);
    }
    setTimeout(() => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      overlayWindow._overlayReady = true;
      if (overlayWindow._pendingShow) {
        overlayWindow._pendingShow = false;
        showOverlayWindow();
      }
    }, process.platform === 'win32' ? 120 : 0);
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    _overlayDragging = false;
    if (_blurTimer) { clearTimeout(_blurTimer); _blurTimer = null; }
  });
  overlayWindow.on('moved', () => {
    const currentMode = overlayWindow?._overlayMode || lastOverlayState.mode || 'panel';
    schedulePersistOverlayPosition(currentMode);
  });
  overlayWindow.on('focus', () => {
    if (_blurTimer) clearTimeout(_blurTimer);
    _blurTimer = setTimeout(() => {
      _blurTimer = null;
      if (!_overlayDragging && overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.blur();
      }
    }, 150);
  });

  return overlayWindow;
}

function sendOverlayState(payload) {
  lastOverlayState = payload;
  [mainWindow, overlayWindow].forEach((win) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('overlay-state', payload);
  });
}

function showOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!overlayWindow._overlayReady) {
    overlayWindow._pendingShow = true;
    return;
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    overlayWindow.showInactive();
  } else {
    overlayWindow.show();
  }
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function postBackend(pathname, body = '{}') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${SERVER_URL}${pathname}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(raw ? JSON.parse(raw) : { ok: true });
            return;
          }
          reject(new Error(raw || res.statusMessage || `HTTP ${res.statusCode}`));
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    icon = createTrayIcon();
  }

  tray = new Tray(icon);
  tray.setToolTip(APP_DISPLAY_NAME);

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '隐藏到托盘', click: () => toggleWindow() },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: false,
      click: (menuItem) => {
        mainWindow?.setAlwaysOnTop(menuItem.checked, 'floating');
      },
    },
    {
      label: '屏幕共享隐身',
      type: 'checkbox',
      checked: true,
      click: (menuItem) => {
        mainWindow?.setContentProtection(menuItem.checked);
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
  // Windows 双击托盘图标也能显示
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function registerShortcuts() {
  shortcuts = loadShortcutConfig(app);
  Object.values(shortcuts).forEach((shortcut) => {
    const callback = shortcutCallbacks[shortcut.action];
    if (!callback) return;
    if (globalShortcut.register(shortcut.key, callback)) {
      shortcut.status = ShortcutStatus.Registered;
    } else {
      shortcut.status = ShortcutStatus.Failed;
    }
  });
}

function unregisterShortcut(action) {
  const shortcut = shortcuts[action];
  if (!shortcut) return;
  globalShortcut.unregister(shortcut.key);
  shortcut.status = ShortcutStatus.Available;
}

function unregisterAllManagedShortcuts() {
  Object.keys(shortcuts).forEach((action) => unregisterShortcut(action));
}

function registerShortcutSet(nextShortcuts) {
  const validation = validateShortcutMap(nextShortcuts);
  if (!validation.ok) {
    return { ok: false, error: validation.error, shortcuts };
  }

  const prevShortcuts = shortcuts;
  unregisterAllManagedShortcuts();

  const nextState = JSON.parse(JSON.stringify(nextShortcuts));
  let failedKey = null;
  for (const shortcut of Object.values(nextState)) {
    const callback = shortcutCallbacks[shortcut.action];
    if (!callback) continue;
    if (globalShortcut.register(shortcut.key, callback)) {
      shortcut.status = ShortcutStatus.Registered;
    } else {
      shortcut.status = ShortcutStatus.Failed;
      failedKey = shortcut.key;
      break;
    }
  }

  if (failedKey) {
    Object.values(nextState).forEach((shortcut) => globalShortcut.unregister(shortcut.key));
    shortcuts = prevShortcuts;
    Object.values(shortcuts).forEach((shortcut) => {
      const callback = shortcutCallbacks[shortcut.action];
      if (!callback) return;
      globalShortcut.register(shortcut.key, callback);
      shortcut.status = ShortcutStatus.Registered;
    });
    return { ok: false, error: `快捷键注册失败：${failedKey}`, shortcuts };
  }

  shortcuts = nextState;
  saveShortcutConfig(app, shortcuts);
  return { ok: true, shortcuts };
}

const shortcutCallbacks = {
  hideOrShowWindow: () => toggleWindow(),
  hardClearSession: async () => {
    try {
      await postBackend('/api/clear');
    } catch (error) {
      console.error('hardClearSession failed:', error);
    }
  },
  askFromServerScreen: async () => {
    try {
      await postBackend('/api/ask-from-server-screen');
    } catch (error) {
      console.error('askFromServerScreen failed:', error);
    }
  },
  toggleInterviewOverlay: () => {
    const nextEnabled = !Boolean(lastOverlayState.enabled);
    const nextState = {
      ...lastOverlayState,
      enabled: nextEnabled,
      visible: nextEnabled,
    };
    sendOverlayState(nextState);
    if (!nextEnabled) {
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
      return;
    }
    const win = createOverlayWindow(nextState.mode);
    applyOverlayPreset(nextState.mode);
    if (nextState.visible) showOverlayWindow();
    else if (win && !win.isDestroyed()) win.hide();
  },
  moveOverlayToMouse: () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    overlayWindow.setPosition(
      Math.round(cursor.x + 16),
      Math.round(cursor.y + 16),
    );
    const mode = overlayWindow._overlayMode || lastOverlayState.mode || 'panel';
    schedulePersistOverlayPosition(mode);
  },
};

ipcMain.handle('hide-window', () => mainWindow?.hide());
ipcMain.handle('show-window', () => { mainWindow?.show(); mainWindow?.focus(); });
ipcMain.handle('get-shortcuts', () => shortcuts);
ipcMain.handle('update-shortcuts', (_event, updates) => {
  const next = JSON.parse(JSON.stringify(shortcuts));
  for (const update of updates || []) {
    if (!next[update.action]) continue;
    next[update.action].key = update.key;
  }
  return registerShortcutSet(next);
});
ipcMain.handle('reset-shortcuts', () => {
  try { fs.unlinkSync(path.join(app.getPath('userData'), 'shortcuts.json')); } catch {}
  const defaults = createShortcutState();
  return registerShortcutSet(defaults);
});
ipcMain.handle('toggle-always-on-top', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next, 'floating');
  return next;
});
ipcMain.handle('toggle-content-protection', () => {
  if (!mainWindow) return true;
  const webContents = mainWindow.webContents;
  const isProtected = mainWindow._contentProtection !== false;
  mainWindow._contentProtection = !isProtected;
  mainWindow.setContentProtection(!isProtected);
  return !isProtected;
});
ipcMain.handle('get-window-state', () => ({
  alwaysOnTop: mainWindow?.isAlwaysOnTop() ?? false,
  contentProtection: mainWindow?._contentProtection !== false,
  visible: mainWindow?.isVisible() ?? false,
}));
ipcMain.handle('sync-overlay-window', (_event, payload = {}) => {
  const style = {
    mode: payload.mode === 'lyrics' ? 'lyrics' : 'panel',
    opacity: Math.max(0, Math.min(1, Number(payload.opacity) || 0)),
    panelFontSize: Math.max(1, Math.round(Number(payload.panelFontSize) || 13)),
    panelWidth: Math.max(180, Math.round(Number(payload.panelWidth) || 420)),
    panelShowBg: payload.panelShowBg !== false,
    panelFontColor: typeof payload.panelFontColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(payload.panelFontColor) ? payload.panelFontColor : '#ffffff',
    panelHeight: Math.max(0, Math.min(1200, Math.round(Number(payload.panelHeight) || 0))),
    lyricLines: Math.max(1, Math.min(8, Math.round(Number(payload.lyricLines) || 2))),
    lyricFontSize: Math.max(1, Math.round(Number(payload.lyricFontSize) || 23)),
    lyricWidth: Math.max(420, Math.min(1200, Math.round(Number(payload.lyricWidth) || 760))),
    lyricColor: typeof payload.lyricColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(payload.lyricColor) ? payload.lyricColor : '#ffffff',
  };

  // enabled / visible 是「可选」字段：
  // - 渲染端 toggle 开关时显式传 (UI 路径，必须能从 false 切到 true 创建窗口)
  // - 仅样式变更时不传，沿用 lastOverlayState 中的当前值，避免 style update 误关 overlay
  // 这是为了修复 71ad03d 之后「Toggle UI 永远不通知 main」的回归 (overlay 只能靠 Ctrl+O 启动)。
  const nextEnabled = typeof payload.enabled === 'boolean' ? payload.enabled : Boolean(lastOverlayState.enabled);
  const nextVisible = typeof payload.visible === 'boolean' ? payload.visible : Boolean(lastOverlayState.visible);

  const state = { ...lastOverlayState, ...style, enabled: nextEnabled, visible: nextVisible };
  const enabledChanged = Boolean(lastOverlayState.enabled) !== state.enabled;
  const visibleChanged = Boolean(lastOverlayState.visible) !== state.visible;
  const modeChanged = lastOverlayState.mode !== state.mode;

  lastOverlayState = state;
  sendOverlayState(state);

  if (!state.enabled) {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    return { ok: true, visible: false };
  }

  // 启用 + 模式变更 + 窗口已被销毁 三种情况都需要 (重新)创建 overlay 窗口。
  // 仅样式变更时跳过创建，保留 71ad03d 引入的「不为 style 重建窗口」性能优化。
  const needCreate = enabledChanged || modeChanged || !overlayWindow || overlayWindow.isDestroyed();
  if (needCreate) {
    createOverlayWindow(state.mode);
    applyOverlayPreset(state.mode);
  }

  if (state.visible) {
    showOverlayWindow();
  } else if (visibleChanged && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  return { ok: true, visible: state.visible };
});
ipcMain.handle('get-overlay-state', () => lastOverlayState);
ipcMain.handle('move-overlay-window', (_event, dx, dy) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const [x, y] = overlayWindow.getPosition();
  overlayWindow.setPosition(x + Math.round(dx), y + Math.round(dy));
});
ipcMain.on('overlay-drag-start', (event) => {
  _overlayDragging = true;
  if (_blurTimer) { clearTimeout(_blurTimer); _blurTimer = null; }
  event.returnValue = true;
});
ipcMain.on('overlay-drag-end', () => {
  _overlayDragging = false;
  if (_blurTimer) { clearTimeout(_blurTimer); _blurTimer = null; }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.blur();
});

function createAppMenu() {
  if (process.platform !== 'darwin') return;
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { label: '隐藏/显示窗口', click: () => toggleWindow() },
        { type: 'separator' },
        { role: 'hide', label: '隐藏应用' },
        { role: 'unhide', label: '显示应用' },
        { type: 'separator' },
        { label: '退出', accelerator: 'CommandOrControl+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  try {
    app.setName(APP_DISPLAY_NAME);
  } catch {
    /* 个别平台/版本可能不支持 */
  }
  createAppMenu();
  console.log('Starting Python backend...');
  startPythonBackend();

  try {
    await waitForServer();
    console.log('Backend ready, creating window...');
  } catch (err) {
    console.error('Failed to start backend:', err.message);
    app.quit();
    return;
  }

  createWindow();
  createTray();
  registerShortcuts();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  mainWindow?.show();
  mainWindow?.focus();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (overlayPositionSaveTimer) {
    clearTimeout(overlayPositionSaveTimer);
    overlayPositionSaveTimer = null;
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
  }
});
