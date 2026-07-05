const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  createOverlayChromeOptions,
  getPromptOverlayInitialWidth,
  relayChildOutput,
  writeToStreamSafely,
} = require('./windowOptions');

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

test('prompt overlay width falls back safely when persisted width is invalid', () => {
  assert.equal(getPromptOverlayInitialWidth(undefined), 900);
  assert.equal(getPromptOverlayInitialWidth('not-a-number'), 900);
  assert.equal(getPromptOverlayInitialWidth('880.6'), 881);
  assert.equal(getPromptOverlayInitialWidth(10), 180);
  assert.equal(getPromptOverlayInitialWidth(9999), 1500);
});

test('writeToStreamSafely swallows broken pipe writes', () => {
  const stream = {
    writable: true,
    destroyed: false,
    write() {
      const error = new Error('broken pipe');
      error.code = 'EPIPE';
      throw error;
    },
  };

  assert.equal(writeToStreamSafely(stream, 'hello'), false);
});

test('relayChildOutput prefixes text and never throws on target write failure', () => {
  const childStream = new EventEmitter();
  const writes = [];
  let shouldThrow = false;
  const stream = {
    writable: true,
    destroyed: false,
    write(chunk) {
      if (shouldThrow) {
        throw new Error('boom');
      }
      writes.push(chunk);
      return true;
    },
  };

  const dispose = relayChildOutput(childStream, stream, '[py] ');
  childStream.emit('data', Buffer.from('line 1'));
  shouldThrow = true;
  assert.doesNotThrow(() => childStream.emit('data', 'line 2'));
  dispose();
  shouldThrow = false;
  childStream.emit('data', 'line 3');

  assert.deepEqual(writes, ['[py] line 1']);
});
