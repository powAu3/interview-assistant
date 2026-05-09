const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createShortcutState,
  getShortcutsFilePath,
  isValidShortcutKey,
  loadShortcutConfig,
  saveShortcutConfig,
  validateShortcutMap,
} = require('./shortcuts');

function makeFakeApp(tmpDir) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return tmpDir;
    },
  };
}

test('isValidShortcutKey accepts CommandOrControl with optional Shift and Alt plus supported key', () => {
  assert.equal(isValidShortcutKey('CommandOrControl+B'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+.'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+/'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Shift+J'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Alt+J'), true);
  assert.equal(isValidShortcutKey('CommandOrControl+Shift+Alt+J'), true);
  assert.equal(isValidShortcutKey('Alt+B'), false);
  assert.equal(isValidShortcutKey('CommandOrControl+Alt+Shift+B'), false);
  assert.equal(isValidShortcutKey('CommandOrControl+Shift+Shift+B'), false);
  assert.equal(isValidShortcutKey('CommandOrControl+Meta+B'), false);
  assert.equal(isValidShortcutKey('CommandOrControl+Backspace'), false);
});

test('validateShortcutMap rejects duplicate keys', () => {
  const shortcuts = createShortcutState({
    hardClearSession: { key: 'CommandOrControl+B' },
  });
  const result = validateShortcutMap(shortcuts);
  assert.equal(result.ok, false);
  assert.match(result.error, /重复/);
});

test('load and save shortcut config roundtrip', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-shortcuts-'));
  const app = makeFakeApp(tmpDir);
  const shortcuts = createShortcutState({
    askFromServerScreen: { key: 'CommandOrControl+/' },
    hardClearSession: { key: 'CommandOrControl+.' },
    toggleInterviewOverlay: { key: 'CommandOrControl+Shift+Alt+O' },
  });

  saveShortcutConfig(app, shortcuts);
  const loaded = loadShortcutConfig(app);

  assert.equal(loaded.askFromServerScreen.key, 'CommandOrControl+/');
  assert.equal(loaded.hardClearSession.key, 'CommandOrControl+.');
  assert.equal(loaded.toggleInterviewOverlay.key, 'CommandOrControl+Shift+Alt+O');
  assert.ok(fs.existsSync(getShortcutsFilePath(app)));
});
