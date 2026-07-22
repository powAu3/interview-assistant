const test = require('node:test');
const assert = require('node:assert/strict');

const { createMultiScreenBatch } = require('./multiScreenBatch');

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createFakeTimers() {
  let nextId = 1;
  const scheduled = new Map();

  return {
    setTimeoutFn(callback, delayMs) {
      const id = nextId++;
      scheduled.set(id, { callback, delayMs });
      return id;
    },
    clearTimeoutFn(id) {
      scheduled.delete(id);
    },
    takeOnly() {
      assert.equal(scheduled.size, 1);
      const [id, task] = scheduled.entries().next().value;
      scheduled.delete(id);
      return task;
    },
    size() {
      return scheduled.size;
    },
  };
}

test('screenshots queued during submission are flushed after the active request finishes', async () => {
  const firstRequest = createDeferred();
  const timers = createFakeTimers();
  const submissions = [];
  const batch = createMultiScreenBatch({
    submitImages: async (images) => {
      submissions.push(images);
      if (submissions.length === 1) await firstRequest.promise;
    },
    retryDelayMs: 25,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  batch.add('screen-1', 1000);
  const firstIdleTimer = timers.takeOnly();
  assert.equal(firstIdleTimer.delayMs, 1000);
  firstIdleTimer.callback();
  await Promise.resolve();
  assert.deepEqual(submissions, [['screen-1']]);
  assert.equal(batch.getSnapshot().submitting, true);

  batch.add('screen-2', 1000);
  const secondIdleTimer = timers.takeOnly();
  secondIdleTimer.callback();
  await Promise.resolve();

  const retryTimer = timers.takeOnly();
  assert.equal(retryTimer.delayMs, 25);
  assert.equal(batch.getSnapshot().pendingCount, 1);

  firstRequest.resolve();
  await Promise.resolve();
  await Promise.resolve();
  retryTimer.callback();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(submissions, [['screen-1'], ['screen-2']]);
  assert.deepEqual(batch.getSnapshot(), {
    pendingCount: 0,
    submitting: false,
    scheduled: false,
  });
});

test('a later screenshot keeps its full idle deadline when the active request finishes first', async () => {
  const firstRequest = createDeferred();
  const timers = createFakeTimers();
  const submissions = [];
  const batch = createMultiScreenBatch({
    submitImages: async (images) => {
      submissions.push(images);
      if (submissions.length === 1) await firstRequest.promise;
    },
    retryDelayMs: 25,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  batch.add('screen-1', 1000);
  timers.takeOnly().callback();
  await Promise.resolve();

  batch.add('screen-2', 1500);
  firstRequest.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const secondIdleTimer = timers.takeOnly();
  assert.equal(secondIdleTimer.delayMs, 1500);
  assert.deepEqual(submissions, [['screen-1']]);

  secondIdleTimer.callback();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(submissions, [['screen-1'], ['screen-2']]);
  assert.equal(timers.size(), 0);
});
