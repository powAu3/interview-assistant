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
};

const SUPPORTED_KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
  '.', '/', '\\', '-', '=', ',', ';', "'", '[', ']', '`',
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
  if (parts.length !== 2) return false;
  if (parts[0] !== 'CommandOrControl') return false;
  return SUPPORTED_KEYS.has(parts[1]);
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
