const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
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
let tray = null;
let pythonProcess = null;
let isQuitting = false;
let shortcuts = {};

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

  // Windows 下最小化也隐藏到托盘
  if (process.platform === 'win32') {
    mainWindow.on('minimize', (e) => {
      e.preventDefault();
      mainWindow.hide();
    });
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
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    } catch (error) {
      console.error('askFromServerScreen failed:', error);
    }
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
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
  }
});
