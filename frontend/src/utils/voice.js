// Voice calls: microphone recording with automatic end of sentence, server
// transcription (Whisper) and server voices (OpenAI TTS) chosen by the user.

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const VOICES = [
  { id: 'nova', label: 'Nova', gender: 'female' },
  { id: 'shimmer', label: 'Shimmer', gender: 'female' },
  { id: 'coral', label: 'Coral', gender: 'female' },
  { id: 'sage', label: 'Sage', gender: 'female' },
  { id: 'onyx', label: 'Onyx', gender: 'male' },
  { id: 'echo', label: 'Echo', gender: 'male' },
  { id: 'ash', label: 'Ash', gender: 'male' },
  { id: 'fable', label: 'Fable', gender: 'male' },
  { id: 'alloy', label: 'Alloy', gender: 'neutral' },
];

export const VOICE_GROUPS = [
  { label: 'Voix féminines', gender: 'female' },
  { label: 'Voix masculines', gender: 'male' },
  { label: 'Voix neutre', gender: 'neutral' },
].map((group) => ({ ...group, voices: VOICES.filter((voice) => voice.gender === group.gender) }));

const VOICE_KEY = 'neura_voice';
export const DEFAULT_VOICE = 'nova';

export const getVoicePreference = (scope = 'chat') => {
  try {
    const value = localStorage.getItem(`${VOICE_KEY}_${scope}`);
    return VOICES.some((voice) => voice.id === value) ? value : DEFAULT_VOICE;
  } catch (error) {
    return DEFAULT_VOICE;
  }
};

export const saveVoicePreference = (voice, scope = 'chat') => {
  try { localStorage.setItem(`${VOICE_KEY}_${scope}`, voice); } catch (error) { /* storage unavailable */ }
};

export const voiceCallSupported = () => (
  typeof window !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia)
  && typeof window.MediaRecorder !== 'undefined'
);

const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

const pickRecordingType = () => {
  if (typeof window.MediaRecorder?.isTypeSupported !== 'function') return '';
  return RECORDING_TYPES.find((type) => window.MediaRecorder.isTypeSupported(type)) || '';
};

// Records one sentence: stops after `silenceMs` of silence once speech was heard,
// after `idleMs` without any speech, or after `maxMs`. Resolves {blob, heard}.
// Speech = at least `minSpeechMs` above the room's noise level (measured during the
// first half second), so clicks and short noises are not taken for a sentence.
// `signal` cancels (nothing is kept); `finishSignal` ends early and keeps the recording.
// `onSpeechStart` fires once, as soon as speech is detected (to cut the AI's voice).
// While the AI speaks, pass a higher `threshold`/`ambientFactor` so its own voice coming
// back through the speakers is not taken for the user's.
export const recordUtterance = ({
  signal, finishSignal, onLevel, onSpeechStart, silenceMs = 1800, idleMs = 9000, maxMs = 45000,
  threshold = 0.025, ambientFactor = 2.5, maxThreshold = 0.08, minSpeechMs = 450,
} = {}) => new Promise((resolve, reject) => {
  let stream;
  let audioContext;
  let timer;
  let recorder;
  const chunks = [];
  let heard = false;
  const startedAt = Date.now();
  let lastSound = startedAt;
  let loudMs = 0;
  const ambient = [];

  const cleanup = () => {
    window.clearInterval(timer);
    stream?.getTracks().forEach((track) => track.stop());
    audioContext?.close().catch(() => {});
    signal?.removeEventListener('abort', stop);
    finishSignal?.removeEventListener('abort', stop);
  };
  function stop() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else cleanup();
  }

  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    .then((media) => {
      stream = media;
      if (signal?.aborted) { cleanup(); resolve({ blob: null, heard: false }); return; }
      const type = pickRecordingType();
      recorder = type ? new window.MediaRecorder(stream, { mimeType: type }) : new window.MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onstop = () => {
        cleanup();
        const mime = (recorder.mimeType || type || 'audio/webm').split(';')[0];
        resolve({ blob: chunks.length ? new Blob(chunks, { type: mime }) : null, heard: heard && !signal?.aborted });
      };
      recorder.start(250);
      signal?.addEventListener('abort', stop);
      finishSignal?.addEventListener('abort', stop);

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        // No level meter: fixed-length recording.
        timer = window.setInterval(() => { if (Date.now() - startedAt > 8000) { heard = true; stop(); } }, 200);
        return;
      }
      audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
        const level = Math.sqrt(sum / samples.length);
        onLevel?.(Math.min(1, level * 8));
        const now = Date.now();
        if (now - startedAt < 500) { ambient.push(level); return; }
        const sorted = [...ambient].sort((a, b) => a - b);
        const noise = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
        const limit = Math.min(maxThreshold, Math.max(threshold, noise * ambientFactor));
        if (level > limit) {
          loudMs += 100;
          lastSound = now;
          if (loudMs >= minSpeechMs && !heard) {
            heard = true;
            onSpeechStart?.();
          }
        } else if (!heard) {
          // Speech must be continuous: a few loud blips (a door, a cough) do not add up.
          loudMs = Math.max(0, loudMs - 50);
        }
        if ((heard && now - lastSound > silenceMs) || (!heard && now - startedAt > idleMs) || now - startedAt > maxMs) {
          stop();
        }
      }, 100);
    })
    .catch((error) => { cleanup(); reject(error); });
});

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const errorFrom = async (response, fallback) => {
  try {
    const data = await response.json();
    const detail = data?.detail;
    return new Error(typeof detail === 'string' ? detail : detail?.message || fallback);
  } catch (error) {
    return new Error(fallback);
  }
};

// `prompt` gives Whisper context (previous answer, vocabulary) for better accuracy.
export const transcribeAudio = async (blob, { headers, language, prompt, signal } = {}) => {
  const response = await fetch(`${API}/voice/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      audio_base64: await blobToBase64(blob),
      mime_type: blob.type || 'audio/webm',
      language,
      prompt: prompt ? String(prompt).slice(-400) : undefined,
    }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response, 'Transcription indisponible.');
  const data = await response.json();
  return (data.text || '').trim();
};

// Sentences Whisper invents from silence or noise (keyboard, breath): never send them.
const HALLUCINATIONS = [
  /sous-titr/i, /amara\.org/i, /merci d.avoir regard/i, /thanks? (you )?for watching/i,
  /abonnez-vous/i, /subscribe/i, /^\W*(merci|thank you|thanks|ok|bye|au revoir)\W*$/i,
];

export const isLikelyNoise = (text) => {
  const value = String(text || '').trim();
  if (value.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return true;
  return HALLUCINATIONS.some((pattern) => pattern.test(value));
};

// Text that sounds right when read aloud: no code, links or markdown symbols.
const comparableWords = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .split(/\s+/)
  .filter((word) => word.length > 1);

// True when a transcription is just the AI's own last reply heard back through the
// speakers (or invented from it by the transcriber): it must never be sent as the user's.
export const isEchoOfReply = (text, reply) => {
  const said = comparableWords(text);
  if (said.length < 3 || !reply) return false;
  const known = new Set(comparableWords(reply));
  const found = said.filter((word) => known.has(word)).length;
  return found / said.length >= 0.7;
};

export const speakableText = (text) => String(text || '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/`([^`]*)`/g, '$1')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/[*_#>|~]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Splits into pieces of at most `size` characters, on sentence ends when possible.
export const speechPieces = (text, size = 600) => {
  const pieces = [];
  let current = '';
  (text.match(/[^.!?…]+[.!?…]*\s*/g) || [text]).forEach((sentence) => {
    if ((current + sentence).length > size && current) {
      pieces.push(current.trim());
      current = '';
    }
    if (sentence.length > size) {
      for (let i = 0; i < sentence.length; i += size) pieces.push(sentence.slice(i, i + size).trim());
    } else {
      current += sentence;
    }
  });
  if (current.trim()) pieces.push(current.trim());
  return pieces.filter(Boolean);
};

const fetchSpeech = async (text, { voice, headers, signal, speed, language, languageName }) => {
  const response = await fetch(`${API}/voice/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ text, voice, speed, language, language_name: languageName || undefined }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response, 'Voix indisponible.');
  return URL.createObjectURL(await response.blob());
};

const playUrl = (url, signal) => new Promise((resolve, reject) => {
  const audio = new Audio(url);
  const done = () => { signal?.removeEventListener('abort', abort); URL.revokeObjectURL(url); };
  function abort() { audio.pause(); done(); resolve(); }
  audio.onended = () => { done(); resolve(); };
  audio.onerror = () => { done(); reject(new Error('Lecture audio impossible.')); };
  signal?.addEventListener('abort', abort);
  audio.play().catch((error) => { done(); reject(error); });
});

// Reads a text aloud with the chosen voice; the next piece is fetched while one plays.
// `language` (code of the language learned, e.g. "rif") gives the voice its native accent.
export const speakWithVoice = async (text, {
  voice = DEFAULT_VOICE, headers, signal, speed = 1, language, languageName,
} = {}) => {
  // A short first piece starts the voice sooner; the rest is prepared while it plays.
  const [first, ...rest] = speechPieces(speakableText(text), 180);
  const pieces = first ? [first, ...speechPieces(rest.join(' '), 600)] : [];
  if (!pieces.length) return;
  let next = fetchSpeech(pieces[0], { voice, headers, signal, speed, language, languageName });
  for (let i = 0; i < pieces.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const url = await next;
    if (signal?.aborted) { URL.revokeObjectURL(url); return; }
    next = i + 1 < pieces.length
      ? fetchSpeech(pieces[i + 1], { voice, headers, signal, speed, language, languageName }) : null;
    try {
      // eslint-disable-next-line no-await-in-loop
      await playUrl(url, signal);
    } catch (error) {
      next?.catch(() => {});
      throw error;
    }
    if (signal?.aborted) { next?.catch(() => {}); return; }
  }
};

export const voiceErrorMessage = (error) => {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'Le micro est bloqué. Autorise-le dans le navigateur (icône à gauche de l’adresse), puis réessaie.';
  }
  if (error?.name === 'NotFoundError') return 'Aucun micro détecté sur cet appareil.';
  if (error?.name === 'AbortError') return '';
  return error?.message || 'Appel vocal indisponible pour le moment.';
};

// Splits the text that is ready to be read aloud from a reply still being written.
// Returns [pieces, rest]: the first piece is short (first sentence) so the voice
// starts fast; code blocks are skipped, even when their closing fence has not arrived.
export const takeSpeakablePieces = (buffer, { first = false, final = false } = {}) => {
  let text = buffer;
  const fences = (text.match(/```/g) || []).length;
  let held = '';
  if (fences % 2 === 1) {
    // Unclosed code block: keep it (and what follows) until it closes.
    const open = text.lastIndexOf('```');
    held = text.slice(open);
    text = text.slice(0, open);
  }
  text = text.replace(/```[\s\S]*?```/g, ' ');
  const pieces = [];
  let rest = text;
  let isFirst = first;
  for (;;) {
    // A greeting (« Salam ! ») is voiced right away; later pieces are longer.
    const minimum = isFirst ? 4 : 120;
    const maximum = isFirst ? 160 : 400;
    const end = /[.!?…:;\n]+[\s"»)]*/g;
    let cut = -1;
    let match;
    while ((match = end.exec(rest)) !== null) {
      const position = match.index + match[0].length;
      if (position >= minimum) { cut = position; break; }
    }
    if (cut === -1 && rest.length > maximum) {
      const comma = rest.lastIndexOf(', ', maximum);
      cut = comma > minimum ? comma + 2 : (rest.lastIndexOf(' ', maximum) + 1 || maximum);
    }
    if (cut === -1) break;
    const piece = speakableText(rest.slice(0, cut));
    if (piece) pieces.push(piece);
    rest = rest.slice(cut);
    isFirst = false;
  }
  if (final && !held) {
    const piece = speakableText(rest);
    if (piece) pieces.push(piece);
    rest = '';
  }
  return [pieces, rest + held];
};

// Reads a reply aloud WHILE it is being written: push() the text as it streams,
// end() when it is complete. Each sentence is voiced as soon as it is ready; only the
// next AHEAD pieces are requested in advance (asking for every sentence at once
// overloads the voice service and delays everything). A piece that fails is retried
// once, then skipped, so one error never cuts the rest of the answer.
// `finished` resolves at the end (or when `signal` aborts: the user cut the voice).
const AHEAD = 2;
export const createSpeechStream = ({
  voice = DEFAULT_VOICE, headers, signal, language, languageName, speed = 1,
} = {}) => {
  let buffer = '';
  let spokeFirst = false;
  let ended = false;
  let started = false;
  let wake = null;
  const texts = [];
  const requests = new Map();
  let index = 0;

  const request = (i) => {
    if (i >= texts.length || requests.has(i)) return;
    const options = { voice, headers, signal, speed, language, languageName };
    const audio = fetchSpeech(texts[i], options).catch((error) => {
      if (signal?.aborted) throw error;
      return fetchSpeech(texts[i], options);
    });
    audio.catch(() => {});
    requests.set(i, audio);
  };

  const enqueue = (pieces) => {
    texts.push(...pieces);
    if (pieces.length) spokeFirst = true;
    if (wake) { wake(); wake = null; }
  };

  const player = (async () => {
    let failures = 0;
    for (;;) {
      if (signal?.aborted) return;
      if (index >= texts.length) {
        if (ended) return;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { wake = resolve; });
        continue; // eslint-disable-line no-continue
      }
      started = true;
      for (let i = index; i < index + AHEAD; i += 1) request(i);
      const current = requests.get(index);
      requests.delete(index);
      index += 1;
      let url;
      try {
        // eslint-disable-next-line no-await-in-loop
        url = await current;
      } catch (error) {
        if (signal?.aborted) return;
        failures += 1;
        if (failures >= 3) throw error;
        continue; // eslint-disable-line no-continue
      }
      if (signal?.aborted) { URL.revokeObjectURL(url); return; }
      request(index);
      try {
        // eslint-disable-next-line no-await-in-loop
        await playUrl(url, signal);
      } catch (error) {
        if (signal?.aborted) return;
        failures += 1;
        if (failures >= 3) throw error;
      }
    }
  })().finally(() => {
    requests.forEach((pending) => pending.then((url) => URL.revokeObjectURL(url)).catch(() => {}));
    requests.clear();
  });

  return {
    push(delta) {
      if (ended || !delta) return;
      buffer += delta;
      const [pieces, rest] = takeSpeakablePieces(buffer, { first: !spokeFirst });
      buffer = rest;
      enqueue(pieces);
    },
    end(fullText) {
      if (ended) return;
      // Nothing streamed (direct answer, error): read the full reply instead.
      if (!started && !texts.length && !buffer && fullText) buffer = fullText;
      const [pieces] = takeSpeakablePieces(buffer, { first: !spokeFirst, final: true });
      buffer = '';
      ended = true;
      enqueue(pieces);
      if (wake) { wake(); wake = null; }
    },
    finished: player,
  };
};
