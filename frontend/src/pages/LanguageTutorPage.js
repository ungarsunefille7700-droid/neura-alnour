import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { LANGUAGES } from '@/i18n/languages';
import {
  Mic, Send, Phone, PhoneOff, Volume2, Square, GraduationCap, ArrowLeft, Loader2, Sparkles
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Best-effort BCP-47 code for browser speech (STT/TTS).
function speechLang(code) {
  const map = {
    'ary': 'ar-MA', 'arq': 'ar-DZ', 'aeb': 'ar-TN', 'ar-MA': 'ar-MA', 'ar-TN': 'ar-TN',
    'kab': 'ar-DZ', 'shy': 'ar-DZ', 'cnu': 'ar-DZ', 'mzb': 'ar-DZ', 'thv': 'ar-DZ', 'ber-DZ': 'ar-DZ',
    'rif': 'ar-MA', 'shi': 'ar-MA', 'zgh': 'ar-MA', 'tzm': 'ar-MA', 'ber': 'ar-MA', 'jbn': 'ar-TN',
    'ar': 'ar-SA', 'en': 'en-US', 'fr': 'fr-FR', 'zh': 'zh-CN', 'pt': 'pt-PT',
  };
  return map[code] || code.split('-')[0];
}

function selectBestVoice(voices, locale) {
  const target = locale.toLowerCase();
  const language = target.split('-')[0];
  const qualityPattern = /natural|neural|enhanced|premium|online|google|microsoft|siri/i;
  return voices
    .filter((voice) => voice.lang && voice.lang.toLowerCase().split('-')[0] === language)
    .sort((a, b) => {
      const score = (voice) => {
        const voiceLang = voice.lang.toLowerCase();
        return (voiceLang === target ? 100 : 0)
          + (qualityPattern.test(voice.name) ? 25 : 0)
          + (!voice.localService ? 10 : 0)
          + (voice.default ? 5 : 0);
      };
      return score(b) - score(a);
    })[0];
}

function speechChunks(text, maxLength = 220) {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]?/g) || [clean];
  const chunks = [];
  let current = '';
  sentences.forEach((sentence) => {
    const next = `${current} ${sentence.trim()}`.trim();
    if (current && next.length > maxLength) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

const LEVELS = [
  { key: 'débutant', label: 'Débutant' },
  { key: 'intermédiaire', label: 'Intermédiaire' },
  { key: 'avancé', label: 'Avancé' },
];

const QUICK = [
  { label: 'Corrige-moi', text: 'Corrige ma dernière phrase et explique mes erreurs.' },
  { label: 'Exercices', text: 'Donne-moi 3 exercices adaptés à mon niveau.' },
  { label: 'Quiz', text: 'Fais-moi un petit quiz de 3 questions.' },
  { label: 'Explique', text: 'Explique-moi la dernière phrase que tu as dite, mot par mot.' },
  { label: 'Fais-moi parler', text: 'Pose-moi une question pour me faire parler davantage.' },
  { label: 'Expressions', text: 'Apprends-moi 3 expressions utiles de la vraie vie.' },
];

export default function LanguageTutorPage() {
  const { token, getAuthHeader } = useAuth();
  const navigate = useNavigate();

  const [language, setLanguage] = useState(() => localStorage.getItem('neura_tutor_lang') || 'en');
  const [level, setLevel] = useState(() => localStorage.getItem('neura_tutor_level') || 'débutant');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const [listening, setListening] = useState(false);
  const [callMode, setCallMode] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const [voiceNotice, setVoiceNotice] = useState('');
  const [progress, setProgress] = useState([]);

  const recognitionRef = useRef(null);
  const recognitionTextRef = useRef('');
  const recognitionSentRef = useRef(false);
  const recognitionConfidenceRef = useRef(1);
  const recognitionFallbackRef = useRef(false);
  const bottomRef = useRef(null);
  const callModeRef = useRef(false);
  useEffect(() => { callModeRef.current = callMode; }, [callMode]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return undefined;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);
  useEffect(() => {
    if (!token) return;
    axios.get(`${API}/language-tutor/progress`, { headers: getAuthHeader() })
      .then((response) => setProgress(response.data || []))
      .catch(() => setProgress([]));
  }, [token]);

  const langName = (LANGUAGES.find((l) => l.code === language) || {}).name || 'English';
  const langNative = (LANGUAGES.find((l) => l.code === language) || {}).native || 'English';

  const sttSupported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const speechLocale = speechLang(language);
  const matchingVoice = selectBestVoice(voices, speechLocale);
  const savedProgress = progress.find((item) => item.language === langName);

  // --- Text to speech ---
  const speak = useCallback((text, onEnd) => {
    if (!ttsSupported || !text) { onEnd && onEnd(); return; }
    try {
      window.speechSynthesis.cancel();
      const chunks = speechChunks(text);
      if (!chunks.length) { onEnd && onEnd(); return; }
      let index = 0;
      const finish = () => { setSpeaking(false); onEnd && onEnd(); };
      const playNext = () => {
        if (index >= chunks.length) { finish(); return; }
        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = speechLocale;
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = 1;
        if (matchingVoice) utterance.voice = matchingVoice;
        utterance.onstart = () => setSpeaking(true);
        utterance.onend = () => { index += 1; playNext(); };
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      };
      playNext();
    } catch (e) { onEnd && onEnd(); }
  }, [matchingVoice, speechLocale, ttsSupported]);

  const stopSpeaking = () => { if (ttsSupported) window.speechSynthesis.cancel(); setSpeaking(false); };

  // --- Send a message ---
  const send = useCallback(async (text, fromVoice = false) => {
    const msg = (text != null ? text : input).trim();
    if (!msg || busy) return;
    setInput('');
    setMessages((p) => [...p, { role: 'user', content: msg }]);
    setBusy(true);
    setStreamStarted(false);
    const assistantId = `tutor-${Date.now()}`;
    let accumulated = '';
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(`${API}/language-tutor/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          content: msg, language: langName, level, session_id: sessionId, voice: fromVoice,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('stream unavailable');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const rawEvent of events) {
          const line = rawEvent.trim();
          if (!line.startsWith('data:')) continue;
          let event;
          try { event = JSON.parse(line.slice(5).trim()); } catch (error) { continue; }
          if (event.type === 'session' && event.session_id) {
            setSessionId(event.session_id);
          } else if (event.type === 'delta' && event.content) {
            accumulated += event.content;
            setStreamStarted(true);
            setMessages((current) => {
              const exists = current.some((item) => item.id === assistantId);
              if (!exists) return [...current, { id: assistantId, role: 'assistant', content: accumulated }];
              return current.map((item) => (
                item.id === assistantId ? { ...item, content: accumulated } : item
              ));
            });
          } else if (event.type === 'error') {
            throw new Error(event.detail || 'stream failed');
          }
        }
      }
      if (!accumulated.trim()) throw new Error('empty stream');
      setProgress((current) => [
        { language: langName, level, updated_at: new Date().toISOString() },
        ...current.filter((item) => item.language !== langName),
      ]);
      // In call mode: speak the reply, then listen again.
      if (callModeRef.current) {
        speak(accumulated, () => { if (callModeRef.current) startListening(true); });
      }
    } catch (e) {
      if (!accumulated) {
        setMessages((p) => [...p, { role: 'assistant', content: '⚠️ Service IA temporairement indisponible. Réessaie.' }]);
      }
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false);
      setStreamStarted(false);
    }
  }, [input, busy, langName, level, sessionId, getAuthHeader, speak]);

  // --- Speech to text ---
  const startListening = useCallback((fallbackLocale = null) => {
    if (!sttSupported) return;
    try {
      try { recognitionRef.current?.abort(); } catch (error) {}
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      const primaryLocale = speechLang(language);
      rec.lang = fallbackLocale || primaryLocale;
      rec.interimResults = true;
      rec.maxAlternatives = 5;
      rec.continuous = Boolean(callModeRef.current);
      recognitionTextRef.current = '';
      recognitionSentRef.current = false;
      recognitionConfidenceRef.current = 1;
      recognitionFallbackRef.current = Boolean(fallbackLocale);
      rec.onstart = () => {
        setListening(true);
        setVoiceNotice(fallbackLocale ? 'Je retente en français pour mieux comprendre...' : '');
      };
      rec.onerror = (event) => {
        setListening(false);
        const notices = {
          'language-not-supported': `La reconnaissance vocale ${langNative} n'est pas disponible dans ce navigateur. Le chat écrit reste pleinement fonctionnel.`,
          'not-allowed': "L'accès au microphone est refusé. Autorise le microphone dans le navigateur puis réessaie.",
          'service-not-allowed': "Le service vocal du navigateur est désactivé. Vérifie les autorisations du navigateur.",
          'network': "La reconnaissance vocale est momentanément indisponible. Vérifie la connexion puis réessaie.",
          'no-speech': "Je n'ai pas entendu de phrase. Rapproche-toi du microphone et parle clairement.",
        };
        if (event.error === 'no-speech' && callModeRef.current) {
          window.setTimeout(() => {
            if (callModeRef.current) startListening(fallbackLocale);
          }, 700);
          return;
        }
        if (event.error !== 'aborted') {
          setVoiceNotice(notices[event.error] || "Je n'ai pas bien compris. Réessaie en parlant un peu plus lentement.");
        }
      };
      rec.onspeechend = () => { try { rec.stop(); } catch (error) {} };
      rec.onend = () => {
        setListening(false);
        const said = recognitionTextRef.current.trim();
        if (said && !recognitionSentRef.current) {
          const shouldRetryFrench = (
            !recognitionFallbackRef.current
            && primaryLocale.toLowerCase() !== 'fr-fr'
            && recognitionConfidenceRef.current < 0.55
          );
          if (shouldRetryFrench) {
            window.setTimeout(() => {
              if (!recognitionSentRef.current) startListening('fr-FR');
            }, 250);
            return;
          }
          recognitionSentRef.current = true;
          setVoiceNotice('');
          send(said, true);
        }
      };
      rec.onresult = (ev) => {
        let finalText = recognitionTextRef.current;
        let interimText = '';
        for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
          const result = ev.results[i];
          let best = result[0];
          for (let alt = 1; alt < result.length; alt += 1) {
            if ((result[alt].confidence || 0) > (best.confidence || 0)) best = result[alt];
          }
          if (typeof best.confidence === 'number' && best.confidence > 0) {
            recognitionConfidenceRef.current = Math.min(recognitionConfidenceRef.current, best.confidence);
          }
          if (result.isFinal) finalText = `${finalText} ${best.transcript}`.trim();
          else interimText = `${interimText} ${best.transcript}`.trim();
        }
        recognitionTextRef.current = finalText;
        const heard = `${finalText} ${interimText}`.trim();
        if (heard) setVoiceNotice(`Entendu : « ${heard} »`);
      };
      recognitionRef.current = rec;
      rec.start();
    } catch (e) {
      setListening(false);
      setVoiceNotice("Impossible de démarrer le microphone. Vérifie son autorisation puis réessaie.");
    }
  }, [language, langNative, sttSupported, send]);

  const stopListening = () => { try { recognitionRef.current && recognitionRef.current.stop(); } catch (e) {} setListening(false); };

  const toggleCall = () => {
    if (callMode) {
      setCallMode(false); stopListening(); stopSpeaking();
    } else {
      setCallMode(true);
      setMessages((p) => p.length ? p : [{ role: 'assistant', content: `📞 Appel démarré — parle-moi en ${langNative} (ou en français si tu bloques). Je t'écoute…` }]);
      startListening(true);
    }
  };

  const changeLang = (code) => { setLanguage(code); localStorage.setItem('neura_tutor_lang', code); setMessages([]); setSessionId(null); setVoiceNotice(''); };
  const changeLevel = (lv) => { setLevel(lv); localStorage.setItem('neura_tutor_level', lv); };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="border-b border-border p-3 flex flex-wrap items-center gap-3">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-muted"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex items-center gap-2 font-bold"><GraduationCap className="w-5 h-5 text-primary" /> Prof de langue IA</div>
        <div className="flex items-center gap-2 ml-auto text-sm">
          <span className="text-muted-foreground">Langue :</span>
          <select value={language} onChange={(e) => changeLang(e.target.value)}
            className="rounded-full bg-muted px-3 py-1 border-0 outline-none cursor-pointer max-w-[150px]" data-testid="tutor-lang">
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
          </select>
          <select value={level} onChange={(e) => changeLevel(e.target.value)}
            className="rounded-full bg-muted px-3 py-1 border-0 outline-none cursor-pointer" data-testid="tutor-level">
            {LEVELS.map((lv) => <option key={lv.key} value={lv.key}>{lv.label}</option>)}
          </select>
          {savedProgress && <span className="hidden lg:inline text-xs text-muted-foreground">Progression enregistrée</span>}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.length === 0 && (
          <div className="max-w-xl mx-auto text-center mt-12">
            <GraduationCap className="w-12 h-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Ton prof particulier 24h/24</h2>
            <p className="text-muted-foreground mb-4">Apprends le <b>{langNative}</b> par écrit ou en <b>conversation vocale</b>. Le prof corrige tes fautes, t'explique, te fait des exercices et te fait parler.</p>
            {savedProgress && <p className="text-sm text-primary mb-3">Reprise disponible · niveau {savedProgress.level}</p>}
            <p className="text-sm text-muted-foreground">Choisis ta langue + ton niveau en haut, puis écris ou clique sur <b>📞 Appeler le prof</b>.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-3xl mx-auto w-full ${m.role === 'user' ? 'text-right' : ''}`}>
            <div className={`inline-block text-left rounded-2xl px-4 py-3 ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>
              {m.role === 'assistant' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  {ttsSupported && (
                    <button onClick={() => speak(m.content)} className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <Volume2 className="w-3 h-3" /> Écouter
                    </button>
                  )}
                </div>
              ) : <span className="whitespace-pre-wrap">{m.content}</span>}
            </div>
          </div>
        ))}
        {busy && !streamStarted && <div className="max-w-3xl mx-auto"><div className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 bg-muted/50 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Le prof réfléchit…</div></div>}
        {listening && <div className="max-w-3xl mx-auto"><div className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 bg-primary/10 text-primary"><Mic className="w-4 h-4 animate-pulse" /> Je t'écoute… parle !</div></div>}
        {speaking && <div className="max-w-3xl mx-auto"><div className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 bg-primary/10 text-primary"><Volume2 className="w-4 h-4 animate-pulse" /> Le prof parle… <button onClick={stopSpeaking} className="underline">stop</button></div></div>}
        {voiceNotice && <div className="max-w-3xl mx-auto text-sm text-amber-700 dark:text-amber-400">{voiceNotice}</div>}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      <div className="px-3 md:px-6 pb-1 flex flex-wrap gap-2 justify-center">
        {QUICK.map((q, i) => (
          <button key={i} onClick={() => send(q.text)} disabled={busy}
            className="text-xs rounded-full bg-muted px-3 py-1 text-muted-foreground hover:text-foreground transition-colors">
            {q.label}
          </button>
        ))}
      </div>

      {/* Input + voice */}
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-border p-3 md:p-4">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <Button type="button" onClick={toggleCall}
            className={`rounded-full h-11 px-4 gap-2 ${callMode ? 'bg-destructive hover:bg-destructive/90' : ''}`}
            data-testid="tutor-call-btn" title="Conversation vocale en temps réel">
            {callMode ? <><PhoneOff className="w-4 h-4" /> Raccrocher</> : <><Phone className="w-4 h-4" /> Appeler</>}
          </Button>
          {sttSupported && (
            <Button type="button" onClick={() => (listening ? stopListening() : startListening(false))}
              variant={listening ? 'default' : 'outline'} className="rounded-full h-11 w-11 p-0" title="Parler (voix)">
              {listening ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>
          )}
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Écris en ${langNative} ou en français…`} rows={1}
            className="flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary max-h-32" />
          <Button type="submit" disabled={busy || !input.trim()} className="rounded-full h-11 w-11 p-0">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
        {!sttSupported && <p className="text-center text-xs text-muted-foreground mt-2">🎤 La voix nécessite Chrome/Edge. Le chat écrit fonctionne partout.</p>}
        {ttsSupported && voices.length > 0 && !matchingVoice && <p className="text-center text-xs text-muted-foreground mt-2">Aucune voix native {langNative} n’est installée sur cet appareil. Le chat écrit fonctionne normalement.</p>}
      </form>
    </div>
  );
}
