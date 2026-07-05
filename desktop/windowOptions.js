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

function getPromptOverlayInitialWidth(promptMaxWidth, fallbackWidth = 900) {
  const value = Number(promptMaxWidth);
  if (!Number.isFinite(value) || value <= 0) return fallbackWidth;
  return Math.max(180, Math.min(1500, Math.round(value)));
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
  createOverlayChromeOptions,
  getPromptOverlayInitialWidth,
  relayChildOutput,
  writeToStreamSafely,
};
