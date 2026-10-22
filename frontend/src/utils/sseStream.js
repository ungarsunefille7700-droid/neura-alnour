// Server-Sent Events reader shared by the chat, Work and language tutor streams.
// The backend sends one JSON object per event: `data: {...}\n\n`.

// Parses one raw event block. Returns the JSON payload, or null when the block
// has no data field or its data is not valid JSON.
export const parseSseEvent = (rawEvent) => {
  const dataLines = [];
  for (const line of String(rawEvent || '').split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return JSON.parse(dataLines.join('\n'));
  } catch {
    return null;
  }
};

// Reads `response.body` to the end and calls `onEvent(payload)` once per event,
// in order. The event left in the buffer when the stream closes is processed
// even without a trailing blank line. An exception thrown by `onEvent` stops
// reading, cancels the stream and is rethrown to the caller.
export const readSseEvents = async (response, onEvent) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (final) => {
    buffer = buffer.replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = final ? '' : blocks.pop();
    for (const block of blocks) {
      const payload = parseSseEvent(block);
      if (payload) onEvent(payload);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      dispatch(false);
    }
    // Flush bytes of a multi-byte character still held by the decoder, then
    // the last event when the server closed without a trailing separator.
    buffer += decoder.decode();
    dispatch(true);
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed or errored.
    }
    throw error;
  }
};

// An Error whose message can be shown to the user as is (server detail or our
// own French text), unlike network/runtime errors such as "Failed to fetch".
export const streamError = (message) => {
  const error = new Error(message);
  error.userFacing = true;
  return error;
};

export const streamErrorMessage = (error, fallbackMessage) => (
  error?.userFacing && error.message ? error.message : fallbackMessage
);

// Builds an Error for a non-2xx streaming response, keeping the HTTP status and
// the server `detail` (string or `{ message }`) when the body is JSON.
export const streamHttpError = async (response, fallbackMessage) => {
  let detail = null;
  try {
    detail = (await response.json())?.detail ?? null;
  } catch {
    detail = null;
  }
  const message = typeof detail === 'string'
    ? detail
    : (detail && typeof detail.message === 'string' ? detail.message : fallbackMessage);
  const error = streamError(message);
  error.status = response.status;
  error.detail = detail;
  return error;
};
