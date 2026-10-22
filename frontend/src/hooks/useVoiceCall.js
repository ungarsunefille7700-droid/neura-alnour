import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSpeechStream, isEchoOfReply, isLikelyNoise, recordUtterance, speakWithVoice, transcribeAudio,
  voiceCallSupported, voiceErrorMessage,
} from '@/utils/voice';

const wait = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

// While the AI speaks, the microphone stays open: if the user starts talking, the voice
// stops at once and what they say becomes the next message (like ChatGPT's voice mode).
// Higher sensitivity limits so the AI's own voice from the speakers is not taken for theirs.
const BARGE_IN = {
  silenceMs: 1100, idleMs: 10 * 60 * 1000, maxMs: 60000, threshold: 0.06, ambientFactor: 3,
  maxThreshold: 0.2, minSpeechMs: 400,
};
// After the AI stops talking, the speakers' echo dies out before listening again.
const ECHO_TAIL_MS = 350;

// Hands-free conversation: listen → transcribe → onUtterance(text) → read the reply
// aloud with the chosen voice → listen again, until hang up.
// onUtterance(text, { onDelta }) must resolve with the reply text (or '' when there is
// none); calling onDelta(chunk) while the reply streams lets the voice start on the
// first sentence instead of waiting for the whole reply.
// canListen(): false while the user is typing — the microphone then pauses, so the
// keyboard is never taken for speech. context(): vocabulary that helps transcription
// (never the AI's reply: the transcriber would "hear" it in the silence).
// accentLanguage / accentName: the language learned, so the voice speaks it with its accent.
export default function useVoiceCall({
  getAuthHeader, onUtterance, voice, language, canListen, context, accentLanguage, accentName,
}) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | paused | listening | transcribing | thinking | speaking
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const activeRef = useRef(false);
  const controllerRef = useRef(null);
  const bargeRef = useRef(null);
  const settingsRef = useRef({});
  settingsRef.current = {
    getAuthHeader, onUtterance, voice, language, canListen, context, accentLanguage, accentName,
  };
  const listeningAllowed = () => !settingsRef.current.canListen || settingsRef.current.canListen();

  const newController = () => {
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    return controllerRef.current;
  };

  const stop = useCallback(() => {
    activeRef.current = false;
    controllerRef.current?.abort();
    controllerRef.current = null;
    bargeRef.current?.abort();
    bargeRef.current = null;
    setActive(false);
    setPhase('idle');
    setLevel(0);
  }, []);

  useEffect(() => () => {
    activeRef.current = false;
    controllerRef.current?.abort();
    bargeRef.current?.abort();
  }, []);

  const speak = useCallback(async (text, { signal } = {}) => {
    const {
      getAuthHeader: headers, voice: chosen, accentLanguage: accent, accentName: name,
    } = settingsRef.current;
    await speakWithVoice(text, { voice: chosen, headers: headers(), signal, language: accent, languageName: name });
  }, []);

  const loop = useCallback(async () => {
    let silentRounds = 0;
    let lastReply = '';
    let pending = null; // what the user said while interrupting the AI
    while (activeRef.current) {
      let recording = pending;
      pending = null;
      if (!recording) {
        if (!listeningAllowed()) {
          setPhase('paused');
          // eslint-disable-next-line no-await-in-loop
          await wait(300);
          continue; // eslint-disable-line no-continue
        }
        const listen = newController();
        setPhase('listening');
        try {
          // eslint-disable-next-line no-await-in-loop
          recording = await recordUtterance({ signal: listen.signal, onLevel: setLevel, silenceMs: 1100 });
        } catch (recordError) {
          setError(voiceErrorMessage(recordError));
          stop();
          return;
        }
        setLevel(0);
        if (!activeRef.current) return;
        // Typing started during the recording: it may contain keyboard noise.
        if (!listeningAllowed()) continue; // eslint-disable-line no-continue
      }
      if (!recording.heard || !recording.blob) {
        silentRounds += 1;
        if (silentRounds >= 3) {
          setError('Je n’entends rien : appel terminé. Vérifie le micro puis rappelle.');
          stop();
          return;
        }
        continue; // eslint-disable-line no-continue
      }
      silentRounds = 0;
      const {
        getAuthHeader: headers, language: lang, onUtterance: handle, context: getContext,
      } = settingsRef.current;
      const turn = newController();
      setPhase('transcribing');
      let text = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        text = await transcribeAudio(recording.blob, {
          headers: headers(), language: lang, prompt: getContext?.(), signal: turn.signal,
        });
      } catch (transcribeError) {
        if (!activeRef.current) return;
        setError(voiceErrorMessage(transcribeError));
        continue; // eslint-disable-line no-continue
      }
      if (!activeRef.current) return;
      // Noise transcribed as "Merci." / "Sous-titres…", or the AI's own voice heard back:
      // never a message from the user.
      if (!text || isLikelyNoise(text) || isEchoOfReply(text, lastReply) || !listeningAllowed()) {
        continue; // eslint-disable-line no-continue
      }
      setError('');
      setPhase('thinking');
      const { voice: chosen, accentLanguage: accent, accentName: name } = settingsRef.current;
      const speech = createSpeechStream({
        voice: chosen, headers: headers(), signal: turn.signal, language: accent, languageName: name,
      });

      // Barge-in: listen while the AI speaks; the user's first words cut the voice.
      let interrupted = false;
      let bargeIn = null;
      const watch = new AbortController();
      bargeRef.current = watch;
      const startWatching = () => {
        if (bargeIn || !activeRef.current) return;
        bargeIn = recordUtterance({
          ...BARGE_IN,
          signal: watch.signal,
          onLevel: setLevel,
          onSpeechStart: () => {
            if (!activeRef.current || interrupted) return;
            interrupted = true;
            turn.abort(); // stops the voice at once
            setPhase('listening');
          },
        }).catch(() => null);
      };

      let streamed = false;
      const onDelta = (chunk) => {
        if (!chunk || !activeRef.current || interrupted) return;
        if (!streamed) {
          streamed = true;
          setPhase('speaking');
          startWatching();
        }
        speech.push(chunk);
      };
      let reply = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        reply = await handle(text, { onDelta });
      } catch (replyError) {
        reply = '';
      }
      lastReply = reply || lastReply;
      speech.end(reply);
      if (!activeRef.current) { watch.abort(); return; }
      if (!interrupted && (reply || streamed)) {
        setPhase('speaking');
        startWatching();
        try {
          // eslint-disable-next-line no-await-in-loop
          await speech.finished;
        } catch (speakError) {
          if (activeRef.current && !interrupted) setError(voiceErrorMessage(speakError));
        }
      }
      if (interrupted) {
        // Keep listening until the user has finished their sentence, then answer it.
        // eslint-disable-next-line no-await-in-loop
        pending = await bargeIn;
        setLevel(0);
      } else {
        watch.abort();
        // eslint-disable-next-line no-await-in-loop
        if (bargeIn) await bargeIn;
        setLevel(0);
        // eslint-disable-next-line no-await-in-loop
        await wait(ECHO_TAIL_MS);
      }
      if (bargeRef.current === watch) bargeRef.current = null;
    }
  }, [stop]);

  const start = useCallback(() => {
    if (activeRef.current) return;
    if (!voiceCallSupported()) {
      setError('Ce navigateur ne permet pas l’appel vocal. Essaie avec Chrome, Edge ou Safari récents.');
      return;
    }
    setError('');
    activeRef.current = true;
    setActive(true);
    loop();
  }, [loop]);

  // While speaking, the user can also cut the voice with the button.
  const interrupt = useCallback(() => {
    if (activeRef.current && phase === 'speaking') controllerRef.current?.abort();
  }, [phase]);

  return { active, phase, level, error, setError, start, stop, interrupt, speak };
}
