import { createSpeechStream, isEchoOfReply, takeSpeakablePieces } from './voice';

describe('takeSpeakablePieces', () => {
  test('the first sentence is released as soon as it is complete', () => {
    const [pieces, rest] = takeSpeakablePieces("D'accord, je t'explique. La prière du", { first: true });
    expect(pieces).toEqual(["D'accord, je t'explique."]);
    expect(rest).toBe('La prière du');
  });

  test('nothing is released before the end of the first sentence', () => {
    expect(takeSpeakablePieces('La prière du matin', { first: true })[0]).toEqual([]);
  });

  test('code blocks are never read, even before their closing fence arrives', () => {
    const [pieces, rest] = takeSpeakablePieces('Voici le code. ```js\nconst a = 1;', { first: true });
    expect(pieces).toEqual(['Voici le code.']);
    expect(rest).toContain('```js');
    const [later] = takeSpeakablePieces(`${rest}\n${'```'} Et voilà, c'est tout !`, { final: true });
    expect(later.join(' ')).not.toContain('const');
    expect(later.join(' ')).toContain("Et voilà, c'est tout !");
  });

  test('the end of the reply releases what is left', () => {
    expect(takeSpeakablePieces('Bonne journée', { final: true })[0]).toEqual(['Bonne journée']);
  });
});

describe('createSpeechStream', () => {
  const played = [];
  let resolvers;

  beforeEach(() => {
    played.length = 0;
    resolvers = [];
    global.URL.createObjectURL = jest.fn((blob) => `blob:${blob.text}`);
    global.URL.revokeObjectURL = jest.fn();
    global.fetch = jest.fn(async (url, init) => {
      const { text } = JSON.parse(init.body);
      return { ok: true, blob: async () => ({ text }) };
    });
    global.Audio = jest.fn((src) => {
      const audio = {
        play: () => { played.push(src); resolvers.push(() => audio.onended()); return Promise.resolve(); },
        pause: jest.fn(),
      };
      return audio;
    });
  });

  afterEach(() => {
    delete global.fetch;
    delete global.Audio;
  });

  const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  test('starts speaking the first sentence while the reply is still being written', async () => {
    const stream = createSpeechStream({ voice: 'onyx', language: 'rif' });
    stream.push("Azul ! Je suis ");
    await tick();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      text: 'Azul !', voice: 'onyx', language: 'rif',
    }));
    expect(played).toEqual(['blob:Azul !']);

    stream.push('ton professeur de tarifit. On commence ?');
    stream.end();
    await tick();
    resolvers.shift()();
    await tick();
    await tick();
    expect(played).toEqual(['blob:Azul !', 'blob:Je suis ton professeur de tarifit. On commence ?']);
    resolvers.shift()();
    await stream.finished;
  });

  test('a reply that did not stream is read in full at the end', async () => {
    const stream = createSpeechStream({ voice: 'nova' });
    stream.end('Il y en a cinq.');
    await tick();
    expect(played).toEqual(['blob:Il y en a cinq.']);
    resolvers.shift()();
    await stream.finished;
  });
});

describe('createSpeechStream pacing', () => {
  let requested;
  let playing;

  beforeEach(() => {
    requested = [];
    playing = [];
    global.URL.createObjectURL = jest.fn((blob) => `blob:${blob.text}`);
    global.URL.revokeObjectURL = jest.fn();
    global.fetch = jest.fn(async (url, init) => {
      const { text } = JSON.parse(init.body);
      requested.push(text);
      if (text.startsWith('PANNE')) return { ok: false, status: 503, json: async () => ({ detail: 'Voix indisponible.' }) };
      return { ok: true, blob: async () => ({ text }) };
    });
    global.Audio = jest.fn((src) => {
      const audio = { play: () => { playing.push({ src, end: () => audio.onended() }); return Promise.resolve(); }, pause: jest.fn() };
      return audio;
    });
  });

  afterEach(() => {
    delete global.fetch;
    delete global.Audio;
  });

  const tick = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); }); };
  const sentence = (n) => `Phrase numéro ${n} ${'assez longue pour être lue seule à voix haute, '.repeat(3)}fin.`;

  test('only the next two sentences are requested ahead, not the whole answer at once', async () => {
    const stream = createSpeechStream({ voice: 'nova' });
    stream.end([1, 2, 3, 4, 5, 6].map(sentence).join(' '));
    await tick();
    expect(requested.length).toBeLessThanOrEqual(3);
    while (playing.length) {
      playing.shift().end();
      // eslint-disable-next-line no-await-in-loop
      await tick();
    }
    await stream.finished;
    expect(requested).toHaveLength(6);
  });

  test('a sentence whose voice fails is retried once, then skipped: the rest is still read', async () => {
    const stream = createSpeechStream({ voice: 'nova', language: 'rif', languageName: 'tarifit (rifain)' });
    stream.end(`${sentence(1)} PANNE ${sentence(2).slice(6)} ${sentence(3)}`.replace(' PANNE', '. PANNE'));
    await tick();
    while (playing.length) {
      playing.shift().end();
      // eslint-disable-next-line no-await-in-loop
      await tick();
    }
    await stream.finished;
    const failed = requested.filter((text) => text.startsWith('PANNE'));
    expect(failed).toHaveLength(2);
    expect(requested.some((text) => text.startsWith('Phrase numéro 3'))).toBe(true);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).language_name).toBe('tarifit (rifain)');
  });
});

describe('isEchoOfReply', () => {
  const reply = 'La meilleure invocation du matin est Sayyid al-Istighfar, qu’on récite au réveil.';
  test('the AI’s own words heard back are an echo', () => {
    expect(isEchoOfReply('la meilleure invocation du matin est sayyid al istighfar', reply)).toBe(true);
  });
  test('a real question, even on the same subject, is not', () => {
    expect(isEchoOfReply('et le soir, quelle invocation je dois dire ?', reply)).toBe(false);
    expect(isEchoOfReply('oui', reply)).toBe(false);
    expect(isEchoOfReply('merci beaucoup pour tout', '')).toBe(false);
  });
});
