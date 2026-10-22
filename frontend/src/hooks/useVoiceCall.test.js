import { act } from 'react';
import { createRoot } from 'react-dom/client';
import useVoiceCall from './useVoiceCall';
import { recordUtterance, speakWithVoice, transcribeAudio } from '@/utils/voice';
import { isLikelyNoise, speakableText, speechPieces } from '@/utils/voice';

// Spoken replies: each call creates a speech stream that records what it was given.
// mockLongSpeech: the voice keeps talking until it is cut (signal aborted).
const mockStreams = [];
let mockLongSpeech = false;
const mockCreateSpeechStream = (options) => {
  const stream = {
    options, pushed: '', ended: null,
    finished: mockLongSpeech
      ? new Promise((resolve) => { options.signal?.addEventListener('abort', resolve); })
      : Promise.resolve(),
    push: (text) => { stream.pushed += text; },
    end: (full) => { stream.ended = full; },
  };
  mockStreams.push(stream);
  return stream;
};

jest.mock('@/utils/voice', () => {
  const actual = jest.requireActual('@/utils/voice');
  return {
    ...actual,
    voiceCallSupported: () => true,
    recordUtterance: jest.fn(),
    transcribeAudio: jest.fn(),
    speakWithVoice: jest.fn(),
    createSpeechStream: (options) => mockCreateSpeechStream(options),
  };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let call;

const Probe = ({ onUtterance, voice, canListen }) => {
  call = useVoiceCall({ getAuthHeader: () => ({ Authorization: 'Bearer t' }), onUtterance, voice, canListen });
  return null;
};

const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
  mockLongSpeech = false;
});

// A microphone like the real one: stops (with nothing heard) when its signal aborts.
// Listening turns follow `turns`; recordings started with onSpeechStart (barge-in
// watchers while the AI speaks) are kept in `watchers` for the test to drive.
const fakeMicrophone = (turns) => {
  const watchers = [];
  recordUtterance.mockImplementation((options) => new Promise((resolve) => {
    options.signal?.addEventListener('abort', () => resolve({ blob: null, heard: false }));
    if (options.onSpeechStart) { watchers.push({ options, resolve }); return; }
    const next = turns.shift();
    if (next) resolve(next);
  }));
  return watchers;
};
const settle = async (ms = 450) => {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, ms); }); });
  await flush();
};

test('listens, sends what was said, reads the reply with the chosen voice, then listens again', async () => {
  const blob = new Blob(['a'], { type: 'audio/webm' });
  const watchers = fakeMicrophone([{ blob, heard: true }]);
  transcribeAudio.mockResolvedValue('salam, comment ça va ?');
  const onUtterance = jest.fn().mockResolvedValue('Très bien, et toi ?');

  await act(async () => { root.render(<Probe onUtterance={onUtterance} voice="onyx" />); });
  await act(async () => { call.start(); });
  await settle();

  expect(onUtterance).toHaveBeenCalledWith('salam, comment ça va ?', expect.objectContaining({ onDelta: expect.any(Function) }));
  const stream = mockStreams[mockStreams.length - 1];
  expect(stream.options).toEqual(expect.objectContaining({ voice: 'onyx' }));
  expect(stream.ended).toBe('Très bien, et toi ?');
  // The microphone watched for an interruption while the AI spoke, then let go of it.
  expect(watchers).toHaveLength(1);
  expect(watchers[0].options.signal.aborted).toBe(true);
  expect(call.phase).toBe('listening');

  await act(async () => { call.stop(); });
  await flush();
  expect(call.active).toBe(false);
  expect(onUtterance).toHaveBeenCalledTimes(1);
});

test('talking while the AI speaks cuts its voice at once and answers the interruption', async () => {
  mockLongSpeech = true;
  const blob = new Blob(['a'], { type: 'audio/webm' });
  const watchers = fakeMicrophone([{ blob, heard: true }]);
  transcribeAudio
    .mockResolvedValueOnce('raconte-moi l’histoire du prophète Youssouf')
    .mockResolvedValueOnce('attends, plus court stp');
  const onUtterance = jest.fn()
    .mockImplementationOnce(async (text, { onDelta }) => { onDelta('Il était une fois, en Canaan… '); return 'Il était une fois, en Canaan…'; })
    .mockResolvedValueOnce('D’accord, en bref : Youssouf a été sauvé.');

  await act(async () => { root.render(<Probe onUtterance={onUtterance} voice="nova" />); });
  await act(async () => { call.start(); });
  await flush();
  expect(call.phase).toBe('speaking');
  expect(watchers).toHaveLength(1);
  const longStream = mockStreams[mockStreams.length - 1];

  // The user starts talking: the voice is cut immediately…
  await act(async () => { watchers[0].options.onSpeechStart(); });
  expect(longStream.options.signal.aborted).toBe(true);
  expect(call.phase).toBe('listening');
  // …and what they say once they stop is the next message.
  await act(async () => { watchers[0].resolve({ blob, heard: true }); });
  await flush();
  expect(onUtterance).toHaveBeenLastCalledWith('attends, plus court stp', expect.anything());

  await act(async () => { call.stop(); });
  await flush();
});

test('the AI never answers its own voice heard back through the speakers', async () => {
  const blob = new Blob(['a'], { type: 'audio/webm' });
  fakeMicrophone([{ blob, heard: true }, { blob, heard: true }]);
  transcribeAudio
    .mockResolvedValueOnce('quelle est la meilleure invocation du matin ?')
    .mockResolvedValueOnce('La meilleure invocation du matin est Sayyid al-Istighfar.');
  const onUtterance = jest.fn().mockResolvedValue('La meilleure invocation du matin est Sayyid al-Istighfar, qu’on récite au réveil.');

  await act(async () => { root.render(<Probe onUtterance={onUtterance} voice="nova" />); });
  await act(async () => { call.start(); });
  await settle(900);
  expect(transcribeAudio).toHaveBeenCalledTimes(2);
  expect(onUtterance).toHaveBeenCalledTimes(1);
  await act(async () => { call.stop(); });
  await flush();
});

test('hangs up by itself after three silent turns', async () => {
  recordUtterance.mockResolvedValue({ blob: null, heard: false });
  await act(async () => { root.render(<Probe onUtterance={jest.fn()} voice="nova" />); });
  await act(async () => { call.start(); });
  await flush();
  expect(recordUtterance).toHaveBeenCalledTimes(3);
  expect(call.active).toBe(false);
  expect(call.error).toMatch(/Je n’entends rien/);
});

test('a blocked microphone ends the call with a clear message', async () => {
  recordUtterance.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  await act(async () => { root.render(<Probe onUtterance={jest.fn()} voice="nova" />); });
  await act(async () => { call.start(); });
  await flush();
  expect(call.active).toBe(false);
  expect(call.error).toMatch(/micro est bloqué/);
});

describe('text read aloud', () => {
  test('drops code, links and markdown', () => {
    expect(speakableText('**Bonjour** ! Voir https://x.y et ```js\nconst a=1\n``` [lien](http://a.b)'))
      .toBe('Bonjour ! Voir et lien');
  });

  test('long answers are cut on sentences, under the size limit', () => {
    const text = `${'Phrase courte. '.repeat(80)}`;
    const pieces = speechPieces(text, 300);
    expect(pieces.length).toBeGreaterThan(1);
    pieces.forEach((piece) => expect(piece.length).toBeLessThanOrEqual(300));
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(text.trim());
  });
});

test('the microphone pauses while the user types, and nothing typed-over is sent', async () => {
  jest.useFakeTimers();
  try {
    let typing = true;
    const blob = new Blob(['a'], { type: 'audio/webm' });
    recordUtterance.mockResolvedValue({ blob, heard: true });
    transcribeAudio.mockResolvedValue('bruit de clavier');
    const onUtterance = jest.fn().mockResolvedValue('');
    await act(async () => { root.render(<Probe onUtterance={onUtterance} voice="nova" canListen={() => !typing} />); });
    await act(async () => { call.start(); });
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(call.phase).toBe('paused');
    expect(recordUtterance).not.toHaveBeenCalled();

    // Typing starts again while a sentence is being recorded: that recording is dropped.
    let finishRecording;
    recordUtterance.mockImplementationOnce(() => new Promise((resolve) => { finishRecording = resolve; }));
    typing = false;
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(call.phase).toBe('listening');
    typing = true;
    await act(async () => { finishRecording({ blob, heard: true }); });
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(onUtterance).not.toHaveBeenCalled();
    await act(async () => { call.stop(); });
  } finally {
    jest.useRealTimers();
  }
});

test('sentences invented from noise are never sent', async () => {
  const blob = new Blob(['a'], { type: 'audio/webm' });
  let lastListen;
  recordUtterance
    .mockResolvedValueOnce({ blob, heard: true })
    .mockResolvedValueOnce({ blob, heard: true })
    .mockImplementationOnce(() => new Promise((resolve) => { lastListen = resolve; }));
  transcribeAudio
    .mockResolvedValueOnce("Sous-titres réalisés par la communauté d'Amara.org")
    .mockResolvedValueOnce('Merci.');
  const onUtterance = jest.fn();
  await act(async () => { root.render(<Probe onUtterance={onUtterance} voice="nova" />); });
  await act(async () => { call.start(); });
  await flush();
  expect(transcribeAudio).toHaveBeenCalledTimes(2);
  expect(onUtterance).not.toHaveBeenCalled();
  await act(async () => { call.stop(); });
  await act(async () => { lastListen({ blob: null, heard: false }); });
});

describe('isLikelyNoise', () => {
  test.each(['Merci.', ' ok ', "Sous-titres réalisés par la communauté d'Amara.org", 'Thank you for watching!', '...', 'a'])(
    'noise: %s', (text) => expect(isLikelyNoise(text)).toBe(true),
  );
  test.each(['Merci pour ta réponse, et la prière du matin ?', 'Azul, mamec tgid ?', 'كيف حالك'])(
    'real sentence: %s', (text) => expect(isLikelyNoise(text)).toBe(false),
  );
});

test('the reply is read with the accent of the language being learned', async () => {
  let lastListen;
  recordUtterance
    .mockResolvedValueOnce({ blob: new Blob(['a'], { type: 'audio/webm' }), heard: true })
    .mockImplementationOnce(() => new Promise((resolve) => { lastListen = resolve; }));
  transcribeAudio.mockResolvedValue('azul');
  speakWithVoice.mockResolvedValue();
  const AccentProbe = () => {
    call = useVoiceCall({
      getAuthHeader: () => ({}), onUtterance: async () => 'Azul fellawen', voice: 'onyx', accentLanguage: 'rif',
    });
    return null;
  };
  await act(async () => { root.render(<AccentProbe />); });
  await act(async () => { call.start(); });
  await flush();
  const stream = mockStreams[mockStreams.length - 1];
  expect(stream.options).toEqual(expect.objectContaining({ voice: 'onyx', language: 'rif' }));
  expect(stream.ended).toBe('Azul fellawen');
  await act(async () => { call.stop(); });
  await act(async () => { lastListen({ blob: null, heard: false }); });
});
