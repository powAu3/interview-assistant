const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const PORT = parseInt(process.env.PORT || '18080', 10);
const SERVER_URL = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let tray = null;
let pythonProcess = null;
let isQuitting = false;

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
    if (!isQuitting) app.quit();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: '学习助手',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setContentProtection(true);

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
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

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    icon = createTrayIcon();
  }

  tray = new Tray(icon);
  tray.setToolTip('学习助手');

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '隐藏窗口 (Ctrl+B)', click: () => mainWindow?.hide() },
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
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+B', toggleWindow);
}

ipcMain.handle('hide-window', () => mainWindow?.hide());
ipcMain.handle('show-window', () => { mainWindow?.show(); mainWindow?.focus(); });
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

app.whenReady().then(async () => {
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
  if (process.platform !== 'darwin') app.quit();
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
