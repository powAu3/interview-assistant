function createMultiScreenBatch({
  submitImages,
  retryDelayMs = 100,
  onError = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  if (typeof submitImages !== 'function') {
    throw new TypeError('submitImages must be a function');
  }

  const state = {
    images: [],
    timer: null,
    submitting: false,
  };

  function clearScheduledFlush() {
    if (state.timer === null) return;
    clearTimeoutFn(state.timer);
    state.timer = null;
  }

  function scheduleFlush(delayMs) {
    clearScheduledFlush();
    const normalizedDelay = Number.isFinite(Number(delayMs))
      ? Math.max(0, Number(delayMs))
      : 0;
    state.timer = setTimeoutFn(() => {
      state.timer = null;
      void flush();
    }, normalizedDelay);
  }

  async function flush() {
    clearScheduledFlush();

    if (state.submitting) {
      // The current request already owns the submit lane. If another batch has
      // reached its idle deadline, retry it shortly instead of dropping the
      // only timer that could ever flush those screenshots.
      if (state.images.length > 0) scheduleFlush(retryDelayMs);
      return false;
    }

    const images = state.images.splice(0);
    if (images.length === 0) return false;

    state.submitting = true;
    try {
      await submitImages(images);
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      state.submitting = false;
      // Screenshots may have arrived while the request was in flight. Usually
      // add() has already scheduled their idle timer; this fallback covers a
      // timer that fired while submission was still busy.
      if (state.images.length > 0 && state.timer === null) {
        scheduleFlush(retryDelayMs);
      }
    }
  }

  function add(image, idleMs) {
    state.images.push(image);
    scheduleFlush(idleMs);
  }

  function dispose() {
    clearScheduledFlush();
    state.images.length = 0;
  }

  function getSnapshot() {
    return {
      pendingCount: state.images.length,
      submitting: state.submitting,
      scheduled: state.timer !== null,
    };
  }

  return { add, flush, dispose, getSnapshot };
}

module.exports = { createMultiScreenBatch };
