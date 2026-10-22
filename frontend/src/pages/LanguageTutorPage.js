import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { LANGUAGES } from '@/i18n/languages';
import { TUTOR_LANGUAGE_GROUPS, detectRequestedLanguage, frenchLanguageName } from '@/utils/tutorLanguages';
import { selectBestVoice, speechChunks, speechLang } from '@/utils/speech';
import { readSseEvents, streamError, streamErrorMessage, streamHttpError } from '@/utils/sseStream';
import {
  getVoicePreference, recordUtterance, saveVoicePreference, speakWithVoice, transcribeAudio,
  voiceCallSupported, voiceErrorMessage,
} from '@/utils/voice';
import useVoiceCall from '@/hooks/useVoiceCall';
import VoiceCallPanel, { VoicePicker } from '@/components/VoiceCallPanel';
import {
  Mic, Send, Phone, Volume2, Square, GraduationCap, ArrowLeft, Loader2, Plus, Trash2
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TUTOR_UNAVAILABLE_MESSAGE = 'Service IA temporairement indisponible. Réessaie.';
const TUTOR_INTERRUPTED_MESSAGE = 'Réponse interrompue avant la fin. Réessaie.';

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
  const { token, getAuthHeader, handleUnauthorizedResponse } = useAuth();
  const navigate = useNavigate();

  const [language, setLanguage] = useState(() => localStorage.getItem('neura_tutor_lang') || 'en');
  const [level, setLevel] = useState(() => localStorage.getItem('neura_tutor_level') || 'débutant');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const [dictation, setDictation] = useState(null); // null | 'listening' | 'transcribing'
  const [speaking, setSpeaking] = useState(false);
  const [tutorVoice, setTutorVoice] = useState(() => getVoicePreference('tutor'));
  const lastTypedAtRef = useRef(0);
  const inputValueRef = useRef('');
  const messagesRef = useRef([]);
  inputValueRef.current = input;
  messagesRef.current = messages;
  const [voices, setVoices] = useState([]);
  const [voiceNotice, setVoiceNotice] = useState('');
  const [progress, setProgress] = useState([]);
  // Saved conversations of the current language (each language keeps its own).
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const conversationSeqRef = useRef(0);

  const dictationAbortRef = useRef(null);
  const dictationFinishRef = useRef(null);
  const speechAbortRef = useRef(null);
  const bottomRef = useRef(null);
  // Voice callbacks (end of recording, end of speech) outlive the render that
  // created them; these refs give them the current session, busy flag and
  // handlers instead of the values captured when the call started.
  const sessionIdRef = useRef(null);
  const busyRef = useRef(false);
  const sendRef = useRef(null);
  const requestRef = useRef(null);
  useEffect(() => () => {
    // Leaving the page ends the call: stop the microphone, the voice and the request.
    dictationAbortRef.current?.abort();
    speechAbortRef.current?.abort();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    requestRef.current?.abort();
  }, []);
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

  const fetchSessions = useCallback(async (code) => {
    const name = (LANGUAGES.find((l) => l.code === code) || {}).name || 'English';
    const response = await axios.get(`${API}/language-tutor/sessions`, {
      headers: getAuthHeader(), params: { language: name },
    });
    return Array.isArray(response.data) ? response.data : [];
  }, [getAuthHeader]);

  const selectSession = useCallback((sessionId) => {
    sessionIdRef.current = sessionId;
    setCurrentSessionId(sessionId);
  }, []);

  const showConversation = useCallback(async (sessionId, seq) => {
    const response = await axios.get(
      `${API}/language-tutor/sessions/${sessionId}/messages`, { headers: getAuthHeader() }
    );
    if (seq !== conversationSeqRef.current) return;
    setMessages((response.data || []).map(({ role, content }) => ({ role, content })));
    selectSession(sessionId);
  }, [getAuthHeader, selectSession]);

  const openConversation = useCallback(async (sessionId) => {
    const seq = ++conversationSeqRef.current;
    setLoadingConversation(true);
    try {
      await showConversation(sessionId, seq);
    } catch (error) {
      if (seq === conversationSeqRef.current) setVoiceNotice('Impossible de charger cette conversation.');
    } finally {
      if (seq === conversationSeqRef.current) setLoadingConversation(false);
    }
  }, [showConversation]);

  // Shows the most recent saved conversation of a language (or an empty one).
  const loadLanguageConversations = useCallback(async (code) => {
    const seq = ++conversationSeqRef.current;
    setLoadingConversation(true);
    try {
      const list = await fetchSessions(code);
      if (seq !== conversationSeqRef.current) return;
      setSessions(list);
      if (!list.length) {
        setMessages([]);
        selectSession(null);
        return;
      }
      await showConversation(list[0].session_id, seq);
    } catch (error) {
      if (seq !== conversationSeqRef.current) return;
      setSessions([]);
      setMessages([]);
      selectSession(null);
    } finally {
      if (seq === conversationSeqRef.current) setLoadingConversation(false);
    }
  }, [fetchSessions, selectSession, showConversation]);

  useEffect(() => {
    if (!token) return;
    loadLanguageConversations(language);
    // Only on arrival: a language change loads its conversations explicitly.
  }, [token]);
  const langNative = (LANGUAGES.find((l) => l.code === language) || {}).native || 'English';
  const langFrench = frenchLanguageName(LANGUAGES.find((l) => l.code === language)) || langNative;

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const speechLocale = speechLang(language);
  const matchingVoice = selectBestVoice(voices, speechLocale);
  const savedProgress = progress.find((item) => item.language === langName);

  // Browser voice, used only when the server voice is unavailable.
  const speakWithBrowser = useCallback((text, signal) => new Promise((resolve) => {
    if (!ttsSupported || !text) { resolve(); return; }
    try {
      window.speechSynthesis.cancel();
      const chunks = speechChunks(text);
      let index = 0;
      const playNext = () => {
        if (index >= chunks.length || signal?.aborted) { resolve(); return; }
        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = speechLocale;
        utterance.rate = 0.95;
        if (matchingVoice) utterance.voice = matchingVoice;
        utterance.onend = () => { index += 1; playNext(); };
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      };
      playNext();
    } catch (e) { resolve(); }
  }), [matchingVoice, speechLocale, ttsSupported]);

  const speak = useCallback(async (text) => {
    if (!text) return;
    speechAbortRef.current?.abort();
    const controller = new AbortController();
    speechAbortRef.current = controller;
    setSpeaking(true);
    try {
      await speakWithVoice(text, {
        voice: tutorVoice, headers: getAuthHeader(), signal: controller.signal, language, languageName: langFrench,
      });
    } catch (error) {
      if (!controller.signal.aborted) await speakWithBrowser(text, controller.signal);
    } finally {
      if (speechAbortRef.current === controller) {
        speechAbortRef.current = null;
        setSpeaking(false);
      }
    }
  }, [getAuthHeader, language, langFrench, speakWithBrowser, tutorVoice]);

  const stopSpeaking = () => {
    speechAbortRef.current?.abort();
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  // --- Send a message ---
  // onDelta (voice call) receives the reply while it streams.
  const send = useCallback(async (text, fromVoice = false, onDelta = null) => {
    const msg = (text != null ? text : input).trim();
    if (!msg || busyRef.current || loadingConversation) return '';
    setInput('');
    busyRef.current = true;
    setBusy(true);
    // "Je veux apprendre le rifain": switch the tutor to that language first,
    // reopening the conversation already saved for it.
    const requestedCode = detectRequestedLanguage(msg, language);
    const requested = requestedCode && LANGUAGES.find((l) => l.code === requestedCode);
    const targetName = requested ? requested.name : langName;
    const targetCode = requested ? requested.code : language;
    if (requested) {
      setLanguage(requested.code);
      localStorage.setItem('neura_tutor_lang', requested.code);
      setVoiceNotice('');
      await loadLanguageConversations(requested.code);
      setMessages((p) => [
        ...p,
        { role: 'assistant', content: `🔄 Langue changée : ${frenchLanguageName(requested)}.` },
        { role: 'user', content: msg },
      ]);
    } else {
      setMessages((p) => [...p, { role: 'user', content: msg }]);
    }
    setStreamStarted(false);
    const assistantId = `tutor-${Date.now()}`;
    let accumulated = '';
    const controller = new AbortController();
    requestRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(`${API}/language-tutor/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          content: msg, language: targetName, level, session_id: sessionIdRef.current, voice: fromVoice,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        handleUnauthorizedResponse(response.status);
        throw await streamHttpError(response, TUTOR_UNAVAILABLE_MESSAGE);
      }
      if (!response.body) throw streamError(TUTOR_UNAVAILABLE_MESSAGE);

      await readSseEvents(response, (event) => {
          if (controller.signal.aborted) return;
          if (event.type === 'session' && event.session_id) {
            selectSession(event.session_id);
          } else if (event.type === 'delta' && event.content) {
            accumulated += event.content;
            onDelta?.(event.content);
            setStreamStarted(true);
            setMessages((current) => {
              const exists = current.some((item) => item.id === assistantId);
              if (!exists) return [...current, { id: assistantId, role: 'assistant', content: accumulated }];
              return current.map((item) => (
                item.id === assistantId ? { ...item, content: accumulated } : item
              ));
            });
          } else if (event.type === 'error') {
            throw streamError(event.detail || TUTOR_UNAVAILABLE_MESSAGE);
          }
      });
      if (controller.signal.aborted) throw streamError(TUTOR_INTERRUPTED_MESSAGE);
      if (!accumulated.trim()) throw streamError(TUTOR_UNAVAILABLE_MESSAGE);
      setProgress((current) => [
        { language: targetName, level, updated_at: new Date().toISOString() },
        ...current.filter((item) => item.language !== targetName),
      ]);
      fetchSessions(targetCode).then(setSessions).catch(() => {});
      return accumulated;
    } catch (e) {
      if (!accumulated) {
        setMessages((p) => [...p, { role: 'assistant', content: `⚠️ ${streamErrorMessage(e, TUTOR_UNAVAILABLE_MESSAGE)}` }]);
      } else {
        // Partial answer already displayed: say clearly that it is incomplete.
        setMessages((current) => current.map((item) => (
          item.id === assistantId ? { ...item, content: `${accumulated}\n\n⚠️ ${TUTOR_INTERRUPTED_MESSAGE}` } : item
        )));
      }
      return accumulated;
    } finally {
      window.clearTimeout(timeoutId);
      if (requestRef.current === controller) requestRef.current = null;
      busyRef.current = false;
      setBusy(false);
      setStreamStarted(false);
    }
  }, [input, language, langName, level, loadingConversation, getAuthHeader, handleUnauthorizedResponse,
    loadLanguageConversations, fetchSessions, selectSession]);
  sendRef.current = send;

  // --- Voice: dictation (one sentence) and hands-free call ---
  const call = useVoiceCall({
    getAuthHeader,
    voice: tutorVoice,
    accentLanguage: language,
    accentName: langFrench,
    onUtterance: (spoken, { onDelta } = {}) => sendRef.current?.(spoken, true, onDelta) || '',
    // The microphone pauses while the learner types (keyboard noise).
    canListen: () => !inputValueRef.current.trim() && Date.now() - lastTypedAtRef.current > 2500,
    // Only the language: given the tutor's last reply, the transcriber "hears" it in the silence.
    context: () => `${langName}.`,
  });

  const dictate = async () => {
    if (dictation === 'listening') { dictationFinishRef.current?.abort(); return; }
    if (dictation || busyRef.current) return;
    if (!voiceCallSupported()) {
      setVoiceNotice('Ce navigateur ne permet pas d’enregistrer la voix. Essaie avec Chrome, Edge ou Safari récents.');
      return;
    }
    const controller = new AbortController();
    const finish = new AbortController();
    dictationAbortRef.current = controller;
    dictationFinishRef.current = finish;
    setVoiceNotice('');
    setDictation('listening');
    try {
      const recording = await recordUtterance({ signal: controller.signal, finishSignal: finish.signal });
      if (controller.signal.aborted) return;
      if (!recording.blob || !recording.heard) {
        setVoiceNotice('Je n’ai rien entendu. Rapproche-toi du micro et réessaie.');
        return;
      }
      setDictation('transcribing');
      const said = await transcribeAudio(recording.blob, { headers: getAuthHeader(), signal: controller.signal });
      if (said) sendRef.current?.(said, true);
      else setVoiceNotice('Je n’ai pas compris. Réessaie en parlant un peu plus fort.');
    } catch (error) {
      const message = voiceErrorMessage(error);
      if (message) setVoiceNotice(message);
    } finally {
      if (dictationAbortRef.current === controller) {
        dictationAbortRef.current = null;
        dictationFinishRef.current = null;
        setDictation(null);
      }
    }
  };

  const toggleCall = () => {
    if (call.active) {
      call.stop();
      return;
    }
    stopSpeaking();
    dictationAbortRef.current?.abort();
    setMessages((p) => p.length ? p : [{ role: 'assistant', content: `📞 Appel démarré — parle-moi en ${langFrench} (ou dans ta langue si tu bloques). Je t'écoute…` }]);
    call.start();
  };

  const changeTutorVoice = (voice) => {
    setTutorVoice(voice);
    saveVoicePreference(voice, 'tutor');
  };

  const changeLang = (code) => {
    setLanguage(code);
    localStorage.setItem('neura_tutor_lang', code);
    setVoiceNotice('');
    loadLanguageConversations(code);
  };
  const startNewConversation = () => {
    conversationSeqRef.current += 1;
    setLoadingConversation(false);
    setMessages([]);
    selectSession(null);
  };
  const deleteConversation = async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !window.confirm('Supprimer cette conversation ?')) return;
    try {
      await axios.delete(`${API}/language-tutor/sessions/${sessionId}`, { headers: getAuthHeader() });
      loadLanguageConversations(language);
    } catch (error) {
      setVoiceNotice('Impossible de supprimer cette conversation.');
    }
  };
  const sessionLabel = (session) => {
    const date = session.updated_at ? new Date(session.updated_at) : null;
    const when = date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
      : '';
    return `${session.title || 'Conversation'}${when ? ` · ${when}` : ''}`;
  };
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
            disabled={busy}
            aria-label="Langue à apprendre"
            className="rounded-full bg-muted px-3 py-1 border-0 outline-none cursor-pointer max-w-[220px] disabled:opacity-60" data-testid="tutor-lang">
            {TUTOR_LANGUAGE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
              </optgroup>
            ))}
          </select>
          <select value={level} onChange={(e) => changeLevel(e.target.value)}
            className="rounded-full bg-muted px-3 py-1 border-0 outline-none cursor-pointer" data-testid="tutor-level">
            {LEVELS.map((lv) => <option key={lv.key} value={lv.key}>{lv.label}</option>)}
          </select>
          <VoicePicker value={tutorVoice} onChange={changeTutorVoice} onPreview={() => speak('Salam alaykoum ! Voici ma voix de professeur.')} previewing={speaking} />
          {savedProgress && <span className="hidden lg:inline text-xs text-muted-foreground">Progression enregistrée</span>}
        </div>
      </div>

      {/* Saved conversations of this language */}
      <div className="border-b border-border px-3 py-2 flex flex-wrap items-center gap-2 text-sm" data-testid="tutor-conversations">
        <span className="text-muted-foreground">Mes conversations en {langFrench} :</span>
        {sessions.length > 0 ? (
          <select
            value={currentSessionId || ''}
            onChange={(e) => (e.target.value ? openConversation(e.target.value) : startNewConversation())}
            disabled={busy || loadingConversation}
            aria-label="Conversation"
            className="rounded-full bg-muted px-3 py-1 border-0 outline-none cursor-pointer max-w-[260px] disabled:opacity-60"
            data-testid="tutor-session-select"
          >
            {!currentSessionId && <option value="">Nouvelle conversation</option>}
            {sessions.map((session) => (
              <option key={session.session_id} value={session.session_id}>{sessionLabel(session)}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-muted-foreground">aucune pour l’instant, elles sont enregistrées automatiquement</span>
        )}
        <button type="button" onClick={startNewConversation} disabled={busy || (!currentSessionId && !messages.length)}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 hover:text-primary disabled:opacity-50"
          data-testid="tutor-new-conversation">
          <Plus className="w-3.5 h-3.5" /> Nouvelle
        </button>
        {currentSessionId && (
          <button type="button" onClick={deleteConversation} disabled={busy}
            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-destructive disabled:opacity-50"
            aria-label="Supprimer la conversation" data-testid="tutor-delete-conversation">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        {loadingConversation && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.length === 0 && !loadingConversation && (
          <div className="max-w-xl mx-auto text-center mt-12">
            <GraduationCap className="w-12 h-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Ton prof particulier 24h/24</h2>
            <p className="text-muted-foreground mb-4">Apprends : <b>{langFrench}</b> par écrit ou en <b>conversation vocale</b>. Le prof corrige tes fautes, t'explique, te fait des exercices et te fait parler.</p>
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
                  <button onClick={() => speak(m.content)} className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Volume2 className="w-3 h-3" /> Écouter
                  </button>
                </div>
              ) : <span className="whitespace-pre-wrap">{m.content}</span>}
            </div>
          </div>
        ))}
        {busy && !streamStarted && <div className="max-w-3xl mx-auto"><div className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 bg-muted/50 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Le prof réfléchit…</div></div>}
        {dictation && <div className="max-w-3xl mx-auto"><div className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 bg-primary/10 text-primary">{dictation === 'listening' ? <><Mic className="w-4 h-4 animate-pulse" /> Je t'écoute… parle, puis touche ■ ou tais-toi pour envoyer.</> : <><Loader2 className="w-4 h-4 animate-spin" /> Je note ce que tu as dit…</>}</div></div>}
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
        {call.active && (
          <div className="max-w-3xl mx-auto">
            <VoiceCallPanel call={call} voice={tutorVoice} onVoiceChange={changeTutorVoice} title={`Appel avec ton prof · ${langFrench}`} />
          </div>
        )}
        {!call.active && call.error && <p className="max-w-3xl mx-auto mb-2 text-sm text-amber-600 dark:text-amber-400">{call.error}</p>}
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          {!call.active && (
            <Button type="button" onClick={toggleCall}
              className="rounded-full h-11 px-4 gap-2 bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-md hover:shadow-lg hover:shadow-emerald-500/30"
              data-testid="tutor-call-btn" title="Conversation vocale avec le prof">
              <Phone className="w-4 h-4" /> Appeler
            </Button>
          )}
          <Button type="button" onClick={dictate} disabled={call.active || (busy && !dictation)}
            variant={dictation ? 'default' : 'outline'} className="rounded-full h-11 w-11 p-0"
            title={dictation === 'listening' ? 'Terminer et envoyer' : 'Parler (voix)'} data-testid="tutor-mic-btn">
            {dictation === 'listening' ? <Square className="w-5 h-5" /> : dictation ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
          </Button>
          <textarea value={input} onChange={(e) => { lastTypedAtRef.current = Date.now(); setInput(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Écris en ${langFrench} ou dans ta langue…`} rows={1}
            className="flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary max-h-32" />
          <Button type="submit" disabled={busy || !input.trim()} className="rounded-full h-11 w-11 p-0">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
      </form>
    </div>
  );
}
