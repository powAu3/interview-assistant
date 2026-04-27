const test = require('node:test');
const assert = require('node:assert/strict');

const { createOverlayChromeOptions } = require('./windowOptions');

test('Windows overlay disables the native thick frame that can expose a white title strip', () => {
  const options = createOverlayChromeOptions('win32', true);

  assert.equal(options.frame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.thickFrame, false);
  assert.equal(options.resizable, false);
});

test('non-Windows overlay keeps the existing native resize behavior', () => {
  const options = createOverlayChromeOptions('darwin', true);

  assert.equal(options.frame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.thickFrame, undefined);
  assert.equal(options.resizable, true);
});
