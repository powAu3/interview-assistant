const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Windows: 透明 BrowserWindow 需要 DWM 硬件加速。
// 历史遗留 disableHardwareAcceleration() 已移除 ——
// 它会让 setContentProtection 退化成「窗口被捕获时显示黑色」(WDA_MONITOR)，
// 而非 Win10 2004+ 才支持的「直接从屏幕捕获中排除」(WDA_EXCLUDEFROMCAPTURE)，
// 后者才是真正的屏幕共享隐身。
// 如个别老 Win7/Win8 设备透明窗口出现渲染异常，可设环境变量 ELECTRON_DISABLE_HW_ACCEL=1 回退。
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  if (process.env.ELECTRON_DISABLE_HW_ACCEL === '1') {
    app.disableHardwareAcceleration();
  }
}

// 跨平台：阻止系统 occlusion / window list 计算把 overlay 暴露给屏幕共享 / 录屏 API。
// 与 BrowserWindow 的 setContentProtection(true) (+ macOS type:'panel') 形成多重防御。
//
// macOS 真正生效的方案 (Electron PR #34362, refs issue #19880):
// 1. enable ScreenCaptureKitMac —— 切换到 macOS 12.3+ 的 ScreenCaptureKit 实现，
//    PR #34362 在这个 capturer 路径里 *硬编码* 跳过 setContentProtection(true) 的窗口，
//    是目前唯一让 overlay 在「always-on-top + transparent」配置下真正隐身的方案。
// 2. disable IOSurfaceCapturer / DesktopCaptureMacV2 —— 关掉旧 capturer 防回退,
//    它们绕过 NSWindowSharingNone 让 setContentProtection 失效 (这正是 overlay 截图可见的根因)。
// 3. disable CalculateNativeWinOcclusion —— 防 OS 把 overlay 列入 window list,
//    被 CGWindowListCreateImage 类老 API 抓到。
//
// 三件齐备后, ScreenCaptureKit / CGWindowListCreateImage / Lark/钉钉/Zoom 屏幕共享、
// macOS 系统截图 (Cmd+Shift+5) 都不再录到 overlay。
app.commandLine.appendSwitch('enable-features', 'ScreenCaptureKitMac');
app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion,IOSurfaceCapturer,DesktopCaptureMacV2',
);
const {
  ShortcutStatus,
  createShortcutState,
  loadShortcutConfig,
  saveShortcutConfig,
  validateShortcutMap,
} = require('./shortcuts');
const { createOverlayChromeOptions } = require('./windowOptions');

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
  initialized: false,
  enabled: false,
  visible: false,
  opacity: 0.88,
  fontSize: 14,
  fontColor: '#e2e8f0',
  showBg: true,
  maxLines: 0,
};

function parseSayVoiceList(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const hashIdx = line.indexOf('#');
      const left = (hashIdx >= 0 ? line.slice(0, hashIdx) : line).trim();
      const parts = left.split(/\s+/);
      if (parts.length < 2) return null;
      const locale = parts[parts.length - 1];
      const name = left.slice(0, left.length - locale.length).trim();
      if (!name) return null;
      let genderHint = 'unknown';
      const lower = name.toLowerCase();
      if (/(grandma|flo|meijia|shelley|sandy|kathy|kyoko|monica|anna)/.test(lower)) genderHint = 'female';
      if (/(grandpa|eddy|reed|ralph|fred|daniel|albert|jorge)/.test(lower)) genderHint = 'male';
      return {
        voiceURI: `say:${name}`,
        name,
        lang: locale.replace('_', '-'),
        source: 'macos-say',
        genderHint,
      };
    })
    .filter(Boolean);
}

function listSystemTtsVoices() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve([]);
    const child = spawn('say', ['-v', '?']);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        console.warn('listSystemTtsVoices failed:', stderr);
        return resolve([]);
      }
      resolve(parseSayVoiceList(stdout));
    });
  });
}

function synthesizeSystemTts({ text, voiceName = '', rate = 180 }) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      return reject(new Error('System TTS is currently only implemented on macOS'));
    }
    const cleanText = String(text || '').trim();
    if (!cleanText) return reject(new Error('TTS text is empty'));
    const outputPath = path.join(app.getPath('temp'), `ia-practice-tts-${Date.now()}-${Math.random().toString(16).slice(2)}.aiff`);
    const args = ['-o', outputPath, '-r', String(Math.max(90, Math.min(260, Math.round(Number(rate) || 180))))];
    if (voiceName) args.push('-v', voiceName);
    args.push(cleanText);

    const child = spawn('say', args);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        try { fs.unlinkSync(outputPath); } catch {}
        return reject(new Error(stderr || `say exited with code ${code}`));
      }
      try {
        const audio = fs.readFileSync(outputPath);
        try { fs.unlinkSync(outputPath); } catch {}
        resolve({
          provider: 'system',
          voice: voiceName || '',
          audio_base64: audio.toString('base64'),
          content_type: 'audio/aiff',
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

const OVERLAY_PRESET = { width: 480, height: 320, minWidth: 300, minHeight: 100, resizable: true };

let _frontReassertTimer = null;
const FRONT_REASSERT_LEVEL = 1;
const FRONT_REASSERT_DURATION = 5000;
const FRONT_REASSERT_INTERVAL = 500;

function applyTopMost(win) {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver', FRONT_REASSERT_LEVEL);
  win.setContentProtection(true);
  win.moveTop();
}

function keepWindowInFront(win) {
  if (_frontReassertTimer) { clearInterval(_frontReassertTimer); _frontReassertTimer = null; }
  if (!win || win.isDestroyed()) return;
  const start = Date.now();
  applyTopMost(win);
  _frontReassertTimer = setInterval(() => {
    if (!win || win.isDestroyed() || Date.now() - start > FRONT_REASSERT_DURATION) {
      clearInterval(_frontReassertTimer);
      _frontReassertTimer = null;
      return;
    }
    applyTopMost(win);
  }, FRONT_REASSERT_INTERVAL);
}

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

function getStoredOverlayPosition() {
  const saved = loadOverlayWindowState();
  const pos = saved?.position;
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
    x: primary.x + Math.max(16, Math.round((primary.width - OVERLAY_PRESET.width) / 2)),
    y: primary.y + Math.max(16, Math.round((primary.height - OVERLAY_PRESET.height) * 0.18)),
  };
}

function persistOverlayPosition() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const bounds = overlayWindow.getBounds();
  const saved = loadOverlayWindowState();
  saved.position = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
  saveOverlayWindowState(saved);
}

function schedulePersistOverlayPosition() {
  if (overlayPositionSaveTimer) clearTimeout(overlayPositionSaveTimer);
  overlayPositionSaveTimer = setTimeout(() => {
    overlayPositionSaveTimer = null;
    persistOverlayPosition();
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
    frame: false,
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

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  const storedPos = getStoredOverlayPosition();
  const saved = loadOverlayWindowState();
  const storedSize = saved?.position;
  const minOverlayWidth = OVERLAY_PRESET.minWidth || OVERLAY_PRESET.width;
  const minOverlayHeight = OVERLAY_PRESET.minHeight || OVERLAY_PRESET.height;
  const w = Math.max((storedSize?.w > 0) ? storedSize.w : OVERLAY_PRESET.width, minOverlayWidth);
  const h = Math.max((storedSize?.h > 0) ? storedSize.h : OVERLAY_PRESET.height, minOverlayHeight);

  // 透明浮窗: 视觉上能看到桌面, 需要 transparent: true + alpha=0 背景.
  // 注意: setContentProtection 在 macOS 的透明窗口上只是 best effort,
  // 对部分截图路径 (尤其是 ScreenCaptureKit) 可能无效; 这是 OS 级限制.
  overlayWindow = new BrowserWindow({
    width: w,
    height: h,
    ...(storedPos ? storedPos : {}),
    minWidth: OVERLAY_PRESET.minWidth,
    minHeight: OVERLAY_PRESET.minHeight,
    ...createOverlayChromeOptions(process.platform, OVERLAY_PRESET.resizable),
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hiddenInMissionControl: true,
    show: false,
    autoHideMenuBar: true,
    roundedCorners: true,
    title: `${APP_DISPLAY_NAME} Overlay`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Content protection 必须尽早调用 —— 等到 ready-to-show 时,
  // 窗口可能已经被 window server 登记过一次, 导致 NSWindowSharingNone 漏掉初始帧
  overlayWindow.setContentProtection(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', FRONT_REASSERT_LEVEL);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  if (process.platform === 'darwin') {
    // macOS: NSWindowCollectionBehaviorCanJoinAllSpaces + Transient
    // 让窗口不进入 Cmd+Tab, Mission Control, Exposé, 以及 CGWindowList
    try {
      overlayWindow.setHiddenInMissionControl(true);
    } catch { /* older electron */ }
  }

  overlayWindow._overlayReady = false;

  overlayWindow.once('ready-to-show', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.setContentProtection(true);
    overlayWindow.setFocusable(false);
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', FRONT_REASSERT_LEVEL);
  });
  overlayWindow.loadURL(`${SERVER_URL}?overlay=1`);
  overlayWindow.webContents.on('did-finish-load', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.setContentProtection(true);
    overlayWindow.setFocusable(false);
    if (lastOverlayState) {
      overlayWindow.webContents.send('overlay-state', lastOverlayState);
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
  overlayWindow.on('show', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.setContentProtection(true);
    overlayWindow.setFocusable(false);
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    _overlayDragging = false;
    if (_blurTimer) { clearTimeout(_blurTimer); _blurTimer = null; }
    if (_frontReassertTimer) { clearInterval(_frontReassertTimer); _frontReassertTimer = null; }
  });
  overlayWindow.on('moved', () => schedulePersistOverlayPosition());
  overlayWindow.on('resize', () => schedulePersistOverlayPosition());
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
  overlayWindow.setFocusable(false);
  if (process.platform === 'darwin' || process.platform === 'win32') {
    overlayWindow.showInactive();
  } else {
    overlayWindow.show();
  }
  overlayWindow.setContentProtection(true);
  keepWindowInFront(overlayWindow);
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
    const nextVisible = !Boolean(lastOverlayState.visible);
    const nextState = {
      ...lastOverlayState,
      initialized: true,
      enabled: nextVisible || lastOverlayState.enabled,
      visible: nextVisible,
    };
    sendOverlayState(nextState);

    if (nextVisible) {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow._hiddenByOverlay = true;
        mainWindow.hide();
      }
      createOverlayWindow();
      showOverlayWindow();
    } else {
      // 快捷键仅切换 overlay 可见性, 主窗口保持原状 (用户可通过 Cmd+B 或托盘唤回).
      // 只有 ControlBar 的 "结束面试" 按钮会走 sync-overlay-window IPC 恢复主窗口.
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    }
  },
  moveOverlayToMouse: () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = overlayWindow.getBounds();
    const display = screen.getDisplayNearestPoint(cursor);
    const area = display.workArea;
    const margin = 12;
    const offsetX = 20;
    const offsetY = 20;
    const nextX = Math.max(
      area.x + margin,
      Math.min(cursor.x - offsetX, area.x + area.width - bounds.width - margin),
    );
    const nextY = Math.max(
      area.y + margin,
      Math.min(cursor.y - offsetY, area.y + area.height - bounds.height - margin),
    );
    overlayWindow.setPosition(nextX, nextY);
    schedulePersistOverlayPosition();
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
  const style = {};
  if ('opacity' in payload) {
    const opacity = Number(payload.opacity);
    if (Number.isFinite(opacity)) style.opacity = Math.max(0, Math.min(1, opacity));
  }
  if ('fontSize' in payload) {
    const fontSize = Number(payload.fontSize);
    if (Number.isFinite(fontSize)) style.fontSize = Math.max(10, Math.min(48, Math.round(fontSize)));
  }
  if ('fontColor' in payload && typeof payload.fontColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(payload.fontColor)) {
    style.fontColor = payload.fontColor;
  }
  if ('showBg' in payload && typeof payload.showBg === 'boolean') {
    style.showBg = payload.showBg;
  }
  if ('maxLines' in payload) {
    const maxLines = Number(payload.maxLines);
    if (Number.isFinite(maxLines)) style.maxLines = Math.max(0, Math.min(50, Math.round(maxLines)));
  }

  const nextEnabled = typeof payload.enabled === 'boolean' ? payload.enabled : Boolean(lastOverlayState.enabled);
  const nextVisible = typeof payload.visible === 'boolean' ? payload.visible : Boolean(lastOverlayState.visible);

  const state = { ...lastOverlayState, ...style, enabled: nextEnabled, visible: nextVisible };
  state.initialized = true;
  const visibleChanged = Boolean(lastOverlayState.visible) !== state.visible;

  lastOverlayState = state;
  sendOverlayState(state);

  if (visibleChanged) {
    if (state.visible) {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow._hiddenByOverlay = true;
        mainWindow.hide();
      }
    } else {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow._hiddenByOverlay) {
        mainWindow._hiddenByOverlay = false;
        mainWindow.show();
        mainWindow.focus();
      }
    }
  }

  if (!state.visible) {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    return { ok: true, visible: false };
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }

  showOverlayWindow();
  return { ok: true, visible: true };
});
ipcMain.handle('get-overlay-state', () => lastOverlayState);
ipcMain.handle('list-system-tts-voices', async () => listSystemTtsVoices());
ipcMain.handle('synthesize-system-tts', async (_event, payload = {}) =>
  synthesizeSystemTts({
    text: payload.text,
    voiceName: payload.voiceName,
    rate: payload.rate,
  })
);
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

// 优雅停止后端：发 SIGTERM,等 timeout 后兜底 SIGKILL,
// 让 SQLite/FTS5 有机会刷盘 wal/-shm,避免下次启动恢复缓慢或索引异常。
let pythonStopPromise = null;
function gracefulStopPython(timeoutMs = 5000) {
  if (pythonStopPromise) return pythonStopPromise;
  const proc = pythonProcess;
  if (!proc) return Promise.resolve();
  pythonStopPromise = new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; resolve(); };
    proc.once('exit', finish);
    try { proc.kill('SIGTERM'); } catch (err) { console.warn('[py] SIGTERM failed:', err.message); }
    setTimeout(() => {
      if (settled) return;
      try {
        if (!proc.killed) {
          console.warn('[py] graceful timeout, escalating to SIGKILL');
          proc.kill('SIGKILL');
        }
      } catch (err) {
        console.warn('[py] SIGKILL failed:', err.message);
      }
      finish();
    }, timeoutMs);
  });
  return pythonStopPromise;
}

app.on('before-quit', (event) => {
  isQuitting = true;
  if (!pythonProcess || pythonStopPromise) return;
  event.preventDefault();
  gracefulStopPython().then(() => {
    pythonProcess = null;
    app.quit();
  });
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

  setImmediate(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) return;
    try {
      createOverlayWindow();
    } catch (error) {
      console.warn('overlay preheat failed:', error?.message || error);
    }
  });
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
  // 兜底:before-quit 通常已经 graceful 停过 pythonProcess,
  // 这里 fallback 防止异常路径泄漏子进程。
  if (pythonProcess) {
    try { pythonProcess.kill('SIGKILL'); } catch (_) { /* ignore */ }
    pythonProcess = null;
  }
});
