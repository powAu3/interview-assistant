const test = require('node:test');
const assert = require('node:assert/strict');

const invoked = [];
const fakeIpcRenderer = {
  invoke(channel, ...args) {
    invoked.push(channel);
    return Promise.resolve();
  },
  send() {},
  sendSync() { return undefined; },
  on() {},
  removeListener() {},
};

const fakeContextBridge = {
  exposed: null,
  exposeInMainWorld(name, api) {
    fakeContextBridge.exposed = { name, api };
  },
};

require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    contextBridge: fakeContextBridge,
    ipcRenderer: fakeIpcRenderer,
  },
};

delete require.cache[require.resolve('./preload')];
require('./preload');

const api = fakeContextBridge.exposed.api;

test('preload exposes minimizeWindow that invokes minimize-window channel', async () => {
  invoked.length = 0;
  await api.minimizeWindow();
  assert.equal(invoked[0], 'minimize-window');
});

test('preload exposes quitApp that invokes quit-app channel', async () => {
  invoked.length = 0;
  await api.quitApp();
  assert.equal(invoked[0], 'quit-app');
});

test('preload exposes all required window control methods', () => {
  assert.equal(typeof api.hideWindow, 'function');
  assert.equal(typeof api.minimizeWindow, 'function');
  assert.equal(typeof api.quitApp, 'function');
  assert.equal(typeof api.showWindow, 'function');
});
