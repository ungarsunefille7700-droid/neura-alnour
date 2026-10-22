import { TextDecoder, TextEncoder } from 'util';
import {
  parseSseEvent,
  readSseEvents,
  streamError,
  streamErrorMessage,
  streamHttpError
} from './sseStream';

// jsdom (Jest 27) does not expose TextDecoder; browsers do.
global.TextDecoder = global.TextDecoder || TextDecoder;

const encoder = new TextEncoder();

// Fake fetch Response whose body yields the given chunks (strings or byte arrays).
const streamResponse = (chunks, { failAfter } = {}) => {
  const queue = chunks.map((chunk) => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
  const reader = {
    cancel: jest.fn().mockResolvedValue(undefined),
    read: jest.fn(async () => {
      if (failAfter !== undefined && reader.read.mock.calls.length > failAfter) {
        throw new TypeError('network error');
      }
      return queue.length ? { done: false, value: queue.shift() } : { done: true, value: undefined };
    })
  };
  return { body: { getReader: () => reader }, reader };
};

const collect = async (chunks, options) => {
  const events = [];
  const response = streamResponse(chunks, options);
  await readSseEvents(response, (event) => events.push(event));
  return { events, response };
};

describe('parseSseEvent', () => {
  test('parses a data line', () => {
    expect(parseSseEvent('data: {"type":"delta","content":"a"}')).toEqual({ type: 'delta', content: 'a' });
  });

  test('ignores comments, other fields and invalid JSON', () => {
    expect(parseSseEvent(': keep-alive')).toBeNull();
    expect(parseSseEvent('data: {not json')).toBeNull();
    expect(parseSseEvent('event: message\ndata: {"type":"done"}')).toEqual({ type: 'done' });
  });
});

describe('readSseEvents', () => {
  test('reads one complete event', async () => {
    const { events } = await collect(['data: {"type":"delta","content":"Salam"}\n\n']);
    expect(events).toEqual([{ type: 'delta', content: 'Salam' }]);
  });

  test('reassembles an event split across chunks', async () => {
    const { events } = await collect(['data: {"type":"del', 'ta","cont', 'ent":"Bonjour"}\n', '\n']);
    expect(events).toEqual([{ type: 'delta', content: 'Bonjour' }]);
  });

  test('reads several events from one chunk, in order', async () => {
    const { events } = await collect([
      'data: {"type":"conversation","conversation_id":"c1"}\n\ndata: {"type":"delta","content":"A"}\n\ndata: {"type":"delta","content":"B"}\n\n'
    ]);
    expect(events.map((event) => event.type)).toEqual(['conversation', 'delta', 'delta']);
    expect(events.map((event) => event.content).join('')).toBe('AB');
  });

  test('processes the last event when the stream ends without a separator', async () => {
    const { events } = await collect([
      'data: {"type":"delta","content":"fin"}\n\n',
      'data: {"type":"done","conversation_id":"c1"}'
    ]);
    expect(events).toEqual([
      { type: 'delta', content: 'fin' },
      { type: 'done', conversation_id: 'c1' }
    ]);
  });

  test('decodes a multi-byte character split between chunks', async () => {
    const bytes = encoder.encode('data: {"type":"delta","content":"نور é"}\n\n');
    // Cut inside the two-byte Arabic letter "ن".
    const cut = bytes.indexOf(0xd9) + 1;
    const { events } = await collect([bytes.slice(0, cut), bytes.slice(cut)]);
    expect(events).toEqual([{ type: 'delta', content: 'نور é' }]);
  });

  test('decodes a character split in the last event that has no trailing separator', async () => {
    const bytes = encoder.encode('data: {"type":"delta","content":"ﷺ"}');
    const { events } = await collect([bytes.slice(0, bytes.length - 3), bytes.slice(bytes.length - 3)]);
    expect(events).toEqual([{ type: 'delta', content: 'ﷺ' }]);
  });

  test('accepts CRLF separators, including one split across chunks', async () => {
    const { events } = await collect(['data: {"type":"delta","content":"x"}\r', '\n\r\ndata: {"type":"done"}\r\n\r\n']);
    expect(events).toEqual([{ type: 'delta', content: 'x' }, { type: 'done' }]);
  });

  test('does not emit an event twice', async () => {
    const { events } = await collect(['data: {"type":"delta","content":"1"}\n\n', '\n\n', 'data: {"type":"delta","content":"2"}\n\n']);
    expect(events.map((event) => event.content)).toEqual(['1', '2']);
  });

  test('ignores an incomplete trailing event that is not valid JSON', async () => {
    const { events } = await collect(['data: {"type":"delta","content":"ok"}\n\ndata: {"type":"del']);
    expect(events).toEqual([{ type: 'delta', content: 'ok' }]);
  });

  test('stops, cancels the stream and rethrows when the handler throws', async () => {
    const response = streamResponse([
      'data: {"type":"error","detail":"Quota"}\n\ndata: {"type":"delta","content":"late"}\n\n'
    ]);
    const seen = [];
    await expect(readSseEvents(response, (event) => {
      seen.push(event.type);
      if (event.type === 'error') throw streamError(event.detail);
    })).rejects.toThrow('Quota');
    expect(seen).toEqual(['error']);
    expect(response.reader.cancel).toHaveBeenCalled();
  });

  test('propagates a network failure after the events already received', async () => {
    const events = [];
    const response = streamResponse(['data: {"type":"delta","content":"partiel"}\n\n', 'data: x'], { failAfter: 1 });
    await expect(readSseEvents(response, (event) => events.push(event))).rejects.toThrow('network error');
    expect(events).toEqual([{ type: 'delta', content: 'partiel' }]);
  });
});

describe('stream errors', () => {
  test('shows server text but hides technical errors', () => {
    expect(streamErrorMessage(streamError('Limite atteinte'), 'Erreur')).toBe('Limite atteinte');
    expect(streamErrorMessage(new TypeError('Failed to fetch'), 'Erreur')).toBe('Erreur');
  });

  test('builds an HTTP error from a FastAPI detail string or object', async () => {
    const plain = await streamHttpError({ status: 401, json: async () => ({ detail: 'Token expiré' }) }, 'Erreur');
    expect(plain).toMatchObject({ message: 'Token expiré', status: 401, userFacing: true });

    const quota = { blocked: true };
    const object = await streamHttpError({ status: 429, json: async () => ({ detail: { message: 'Quota', quota } }) }, 'Erreur');
    expect(object.message).toBe('Quota');
    expect(object.detail.quota).toBe(quota);

    const validation = await streamHttpError({ status: 422, json: async () => ({ detail: [{ msg: 'x' }] }) }, 'Erreur');
    expect(validation.message).toBe('Erreur');

    const notJson = await streamHttpError({ status: 502, json: async () => { throw new Error('html'); } }, 'Erreur');
    expect(notJson).toMatchObject({ message: 'Erreur', status: 502 });
  });
});
