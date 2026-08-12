function createOverlayChromeOptions(platform, preferredResizable) {
  const isWindows = platform === 'win32';

  return {
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    // Windows transparent frameless windows can expose the native thick frame as
    // a white title strip. Removing it also removes native edge resizing there.
    resizable: isWindows ? false : Boolean(preferredResizable),
    ...(isWindows ? { thickFrame: false } : {}),
  };
}

const PROMPT_OVERLAY_DEFAULT_WIDTH = 820;
const PROMPT_OVERLAY_MAX_WIDTH = 820;

function getPromptOverlayInitialWidth(promptMaxWidth, fallbackWidth = PROMPT_OVERLAY_DEFAULT_WIDTH) {
  const value = Number(promptMaxWidth);
  const fallback = Number(fallbackWidth);
  const effective = Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.max(180, Math.min(PROMPT_OVERLAY_MAX_WIDTH, Math.round(effective)));
}

function consumePendingOverlayShow(win, visible) {
  if (!win) return false;
  const shouldShow = Boolean(win._pendingShow && visible);
  win._pendingShow = false;
  return shouldShow;
}

function writeToStreamSafely(stream, chunk) {
  if (!stream || typeof stream.write !== 'function') return false;
  if (stream.destroyed || stream.writable === false) return false;
  try {
    stream.write(chunk);
    return true;
  } catch {
    return false;
  }
}

function relayChildOutput(childStream, targetStream, prefix = '') {
  if (!childStream || typeof childStream.on !== 'function') return () => {};
  const onData = (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    writeToStreamSafely(targetStream, `${prefix}${text}`);
  };
  childStream.on('data', onData);
  return () => {
    if (typeof childStream.off === 'function') childStream.off('data', onData);
    else if (typeof childStream.removeListener === 'function') childStream.removeListener('data', onData);
  };
}

module.exports = {
  PROMPT_OVERLAY_DEFAULT_WIDTH,
  PROMPT_OVERLAY_MAX_WIDTH,
  consumePendingOverlayShow,
  createOverlayChromeOptions,
  getPromptOverlayInitialWidth,
  relayChildOutput,
  writeToStreamSafely,
};
