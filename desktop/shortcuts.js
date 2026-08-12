const fs = require('fs');
const path = require('path');

const ShortcutStatus = {
  Registered: 'registered',
  Failed: 'failed',
  Available: 'available',
};

const DEFAULT_SHORTCUTS = {
  hideOrShowWindow: {
    action: 'hideOrShowWindow',
    key: 'CommandOrControl+B',
    defaultKey: 'CommandOrControl+B',
    label: '隐藏/显示窗口',
    category: '窗口',
  },
  hardClearSession: {
    action: 'hardClearSession',
    key: 'CommandOrControl+.',
    defaultKey: 'CommandOrControl+.',
    label: '硬清空',
    category: '实时辅助',
  },
  askFromServerScreen: {
    action: 'askFromServerScreen',
    key: 'CommandOrControl+/',
    defaultKey: 'CommandOrControl+/',
    label: '服务端截图审题',
    category: '实时辅助',
  },
  cancelAnswer: {
    action: 'cancelAnswer',
    key: 'CommandOrControl+Escape',
    defaultKey: 'CommandOrControl+Escape',
    label: '取消生成',
    category: '实时辅助',
  },
  addMultiServerScreenShot: {
    action: 'addMultiServerScreenShot',
    key: 'CommandOrControl+Shift+/',
    defaultKey: 'CommandOrControl+Shift+/',
    label: '多图截图判题',
    category: '实时辅助',
  },
  toggleInterviewOverlay: {
    action: 'toggleInterviewOverlay',
    key: 'CommandOrControl+O',
    defaultKey: 'CommandOrControl+O',
    label: '显示/隐藏悬浮窗',
    category: '实时辅助',
  },
  moveOverlayToMouse: {
    action: 'moveOverlayToMouse',
    key: 'CommandOrControl+M',
    defaultKey: 'CommandOrControl+M',
    label: '移动悬浮窗到鼠标位置',
    category: '实时辅助',
  },
  focusPrevTab: {
    action: 'focusPrevTab',
    key: 'CommandOrControl+Left',
    defaultKey: 'CommandOrControl+Left',
    label: '专注面板上一栏',
    category: '专注面板',
  },
  focusNextTab: {
    action: 'focusNextTab',
    key: 'CommandOrControl+Right',
    defaultKey: 'CommandOrControl+Right',
    label: '专注面板下一栏',
    category: '专注面板',
  },
  overlayPrevQuestion: {
    action: 'overlayPrevQuestion',
    key: 'CommandOrControl+Up',
    defaultKey: 'CommandOrControl+Up',
    label: '悬浮窗上一题',
    category: '悬浮窗',
  },
  overlayNextQuestion: {
    action: 'overlayNextQuestion',
    key: 'CommandOrControl+Down',
    defaultKey: 'CommandOrControl+Down',
    label: '悬浮窗下一题',
    category: '悬浮窗',
  },
  askScreenForceThink: {
    action: 'askScreenForceThink',
    key: 'CommandOrControl+Alt+/',
    defaultKey: 'CommandOrControl+Alt+/',
    label: '截图审题（强制思考）',
    category: '实时辅助',
  },
  askScreenForceNoThink: {
    action: 'askScreenForceNoThink',
    key: 'CommandOrControl+Alt+.',
    defaultKey: 'CommandOrControl+Alt+.',
    label: '截图审题（强制非思考）',
    category: '实时辅助',
  },
  toggleThinkMode: {
    action: 'toggleThinkMode',
    key: 'CommandOrControl+Shift+T',
    defaultKey: 'CommandOrControl+Shift+T',
    label: '切换思考模式',
    category: '实时辅助',
  },
};

const SUPPORTED_KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
  '.', '/', '\\', '-', '=', ',', ';', "'", '[', ']', '`',
  'Enter',
  'Escape',
  'Up', 'Down', 'Left', 'Right',
]);

function createShortcutState(overrides = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_SHORTCUTS).map(([action, shortcut]) => [
      action,
      {
        ...shortcut,
        status: ShortcutStatus.Available,
        ...overrides[action],
      },
    ]),
  );
}

function getShortcutsFilePath(app) {
  return path.join(app.getPath('userData'), 'shortcuts.json');
}

function isValidShortcutKey(key) {
  if (typeof key !== 'string' || !key.trim()) return false;
  const parts = key.trim().split('+');
  // Frontend emits: CommandOrControl + optional Shift + optional Alt + supported key.
  if (parts.length < 2 || parts.length > 4) return false;
  if (parts[0] !== 'CommandOrControl') return false;
  const keyPart = parts[parts.length - 1];
  const modifiers = parts.slice(1, -1);
  if (!SUPPORTED_KEYS.has(keyPart)) return false;
  const modifierKey = modifiers.join('+');
  return modifierKey === '' || modifierKey === 'Shift' || modifierKey === 'Alt' || modifierKey === 'Shift+Alt';
}

function validateShortcutMap(shortcuts) {
  const seen = new Set();
  for (const shortcut of Object.values(shortcuts)) {
    if (!isValidShortcutKey(shortcut.key)) {
      return { ok: false, error: `非法快捷键：${shortcut.key}` };
    }
    if (seen.has(shortcut.key)) {
      return { ok: false, error: `快捷键重复：${shortcut.key}` };
    }
    seen.add(shortcut.key);
  }
  return { ok: true };
}

function loadShortcutConfig(app) {
  const shortcuts = createShortcutState();
  const filePath = getShortcutsFilePath(app);
  try {
    if (!fs.existsSync(filePath)) return shortcuts;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const [action, shortcut] of Object.entries(shortcuts)) {
      const nextKey = raw?.[action]?.key;
      if (isValidShortcutKey(nextKey)) {
        shortcut.key = nextKey;
      }
    }
    return shortcuts;
  } catch {
    return shortcuts;
  }
}

function saveShortcutConfig(app, shortcuts) {
  const filePath = getShortcutsFilePath(app);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = Object.fromEntries(
    Object.entries(shortcuts).map(([action, shortcut]) => [
      action,
      { key: shortcut.key },
    ]),
  );
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

module.exports = {
  DEFAULT_SHORTCUTS,
  ShortcutStatus,
  createShortcutState,
  getShortcutsFilePath,
  isValidShortcutKey,
  loadShortcutConfig,
  saveShortcutConfig,
  validateShortcutMap,
};
