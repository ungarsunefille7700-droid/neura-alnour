import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  ArrowLeft, BookOpen, Check, ChevronRight, FileText, GraduationCap, Heart,
  HelpCircle, History, Loader2, MessageCircle, Mic, Search, Send, ShieldAlert,
  Sparkles, Star, Volume2, VolumeX
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const LEVELS = [
  { value: 'debutant', label: 'Debutant total' },
  { value: 'notions', label: 'Quelques connaissances' },
  { value: 'intermediaire', label: 'Intermediaire' },
  { value: 'avance', label: 'Avance' },
];

const FALLBACK_TOPICS = [
  { id: 'croyance', level: 1, title: 'La croyance', summary: 'Les fondements de la foi', icon: Star },
  { id: 'ablutions', level: 2, title: 'Les ablutions', summary: 'Comprendre et accomplir le wudu', icon: Sparkles },
  { id: 'priere', level: 3, title: 'La priere', summary: 'Apprendre la salat etape par etape', icon: GraduationCap },
  { id: 'jeune', level: 4, title: 'Le jeune', summary: 'Les bases du jeune et du Ramadan', icon: Heart },
  { id: 'zakat', level: 5, title: 'La zakat', summary: 'Sens, principes et responsabilite', icon: Heart },
  { id: 'hajj', level: 6, title: 'Le pelerinage', summary: 'Decouvrir les etapes du hajj', icon: History },
  { id: 'comportement', level: 7, title: 'Le comportement', summary: 'Ethique, famille et relations', icon: Heart },
  { id: 'invocations', level: 8, title: 'Les invocations', summary: 'Adhkar et duas du quotidien', icon: MessageCircle },
  { id: 'prophetes', level: 9, title: 'Les prophetes', summary: 'Leur histoire et leurs enseignements', icon: BookOpen },
];

const RESOURCES = [
  { title: 'Lire le Coran', subtitle: 'Lecteur complet existant', path: '/quran', icon: BookOpen },
  { title: 'Cours existants', subtitle: 'Lecons structurees', path: '/learn', icon: GraduationCap },
  { title: 'Quiz', subtitle: 'Tester ses connaissances', path: '/quiz', icon: HelpCircle },
  { title: 'Invocations', subtitle: 'Duas du quotidien', path: '/duas', icon: Heart },
];

function chapterIcon(level) {
  const icons = [Star, Sparkles, GraduationCap, Heart, History, BookOpen, MessageCircle];
  return icons[(Number(level || 1) - 1) % icons.length];
}

export default function IslamLearningPage() {
  const navigate = useNavigate();
  const { user, getAuthHeader } = useAuth();
  const [view, setView] = useState('parcours');
  const [level, setLevel] = useState('debutant');
  const [topics, setTopics] = useState(FALLBACK_TOPICS);
  const [progress, setProgress] = useState({ completed_topics: [], favorite_topics: [], current_topic: null });
  const [notes, setNotes] = useState([]);
  const [goals, setGoals] = useState(null);
  const [certificate, setCertificate] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(true);
  const bottomRef = useRef(null);
  const recognitionRef = useRef(null);
  const headers = useMemo(() => getAuthHeader(), [getAuthHeader]);
  const isSignedIn = Boolean(user);

  const refreshMeta = async () => {
    if (!isSignedIn) return;
    const [goalsRes, certificateRes] = await Promise.all([
      axios.get(`${API}/islam-learning/goals`, { headers }),
      axios.get(`${API}/islam-learning/certificate`, { headers }),
    ]);
    setGoals(goalsRes.data);
    setCertificate(certificateRes.data);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const chaptersRes = await axios.get(`${API}/islam-learning/chapters`);
        const chapters = (chaptersRes.data || []).map((chapter) => ({
          ...chapter,
          icon: chapterIcon(chapter.level),
        }));
        setTopics(chapters.length ? chapters : FALLBACK_TOPICS);
        if (isSignedIn) {
          const [progressRes, notesRes, goalsRes, certificateRes] = await Promise.all([
            axios.get(`${API}/islam-learning/progress`, { headers }),
            axios.get(`${API}/islam-learning/notes`, { headers }),
            axios.get(`${API}/islam-learning/goals`, { headers }),
            axios.get(`${API}/islam-learning/certificate`, { headers }),
          ]);
          setProgress({ favorite_topics: [], completed_topics: [], ...(progressRes.data || {}) });
          setLevel(progressRes.data?.level || 'debutant');
          setNotes(notesRes.data || []);
          setGoals(goalsRes.data);
          setCertificate(certificateRes.data);
        } else {
          setProgress({ completed_topics: [], favorite_topics: [], current_topic: null });
          setNotes([]);
          setGoals({ goals: [], completed_chapters: 0, total_chapters: chapters.length || FALLBACK_TOPICS.length });
          setCertificate(null);
        }
      } catch (error) {
        console.error('Islam learning load error:', error);
      } finally {
        setLoadingProgress(false);
      }
    };
    load();
  }, [headers, isSignedIn]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => () => {
    recognitionRef.current?.abort?.();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const visibleTopics = topics.filter((topic) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return topic.title?.toLowerCase().includes(term) || topic.summary?.toLowerCase().includes(term);
  });

  const speak = (text) => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[#*_`>\[\]()]/g, ' '));
    utterance.lang = 'fr-FR';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const startVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || busy || listening) {
      if (!SpeechRecognition) {
        setMessages((current) => [...current, {
          role: 'assistant',
          content: "Ton navigateur ne permet pas encore la reconnaissance vocale ici. Tu peux continuer par message écrit.",
        }]);
      }
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 3;
    recognitionRef.current = recognition;
    let finalText = '';
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      finalText = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join(' ')
        .trim();
      if (finalText) setInput(finalText);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      setListening(false);
      if (finalText.trim()) sendMessage(finalText.trim(), selectedTopic, true);
    };
    recognition.start();
  };

  const sendMessage = async (text, topic = selectedTopic, voiceReply = false) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    if (!isSignedIn) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: "Connecte-toi gratuitement pour utiliser le professeur IA, garder ton historique et reprendre ton apprentissage plus tard. Les cours restent lisibles sans abonnement.",
        },
      ]);
      setView('assistant');
      return;
    }
    setInput('');
    setMessages((current) => [...current, { role: 'user', content }]);
    setBusy(true);
    try {
      const response = await axios.post(
        `${API}/islam-learning/chat`,
        { content, level, topic: topic?.title || null, session_id: sessionId },
        { headers, timeout: 120000 }
      );
      setSessionId(response.data.session_id);
      const assistantResponse = response.data.response;
      setMessages((current) => [...current, { role: 'assistant', content: assistantResponse }]);
      if (voiceReply) speak(assistantResponse);
      return assistantResponse;
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: 'Le professeur est temporairement indisponible. Reessaie dans un instant.' },
      ]);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startTopic = (topic) => {
    setSelectedTopic(topic);
    setNoteDraft(notes.find((note) => note.chapter_id === topic.id)?.content || '');
    setView('assistant');
    if (messages.length === 0) {
      sendMessage(
        `Commence une lecon structuree sur "${topic.title}", adaptee a mon niveau. Cite les sources quand possible, reste prudent, termine par une question de revision.`,
        topic
      );
    }
  };

  const toggleTopicCompletion = async () => {
    if (!selectedTopic) return;
    if (!isSignedIn) return;
    const isCompleted = progress.completed_topics?.includes(selectedTopic.id);
    try {
      const response = await axios.post(
        `${API}/islam-learning/progress`,
        { topic: selectedTopic.id, completed: !isCompleted, level },
        { headers }
      );
      setProgress({ favorite_topics: [], completed_topics: [], ...(response.data || {}) });
      await refreshMeta();
    } catch (error) {
      console.error('Islam progress save error:', error);
    }
  };

  const saveNote = async () => {
    if (!selectedTopic) return;
    if (!isSignedIn) return;
    try {
      const response = await axios.post(
        `${API}/islam-learning/notes`,
        { chapter_id: selectedTopic.id, content: noteDraft },
        { headers }
      );
      setNotes((current) => [response.data, ...current.filter((note) => note.chapter_id !== selectedTopic.id)]);
      await refreshMeta();
    } catch (error) {
      console.error('Islam note save error:', error);
    }
  };

  const toggleFavorite = async (topic, event) => {
    event.stopPropagation();
    if (!isSignedIn) {
      setSelectedTopic(topic);
      setView('assistant');
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: "Connecte-toi gratuitement pour enregistrer tes favoris, tes notes et ta progression.",
        },
      ]);
      return;
    }
    const favorite = !progress.favorite_topics?.includes(topic.id);
    try {
      const response = await axios.post(
        `${API}/islam-learning/favorites`,
        { chapter_id: topic.id, favorite },
        { headers }
      );
      setProgress({ favorite_topics: [], completed_topics: [], ...(response.data || {}) });
    } catch (error) {
      console.error('Islam favorite error:', error);
    }
  };

  const completedCount = progress.completed_topics?.length || 0;
  const progressPercent = Math.round((completedCount / Math.max(1, topics.length)) * 100);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-muted" aria-label="Retour">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary" />
            <span className="font-semibold">Academie de l'Islam</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="islam-level" className="text-sm text-muted-foreground">Niveau</label>
            <select
              id="islam-level"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="rounded-lg bg-muted px-3 py-2 text-sm border-0 outline-none"
            >
              {LEVELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
        <section className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Apprendre pas a pas</h1>
          <p className="text-muted-foreground max-w-3xl">
            Parcours progressif, professeur IA prudent, notes personnelles, favoris, objectifs et certificat de fin de parcours.
          </p>
          {!isSignedIn && (
            <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm text-muted-foreground">
              Les cours d'islam sont accessibles gratuitement. Connecte-toi gratuitement pour activer le professeur IA, les notes, les favoris et la sauvegarde de progression.
              <Link to="/auth" className="ml-2 font-medium text-primary hover:underline">Se connecter</Link>
            </div>
          )}
          <div className="mt-5 max-w-xl">
            <div className="flex justify-between text-sm mb-2">
              <span>{loadingProgress ? 'Chargement...' : `${completedCount} / ${topics.length} chapitres termines`}</span>
              <span>{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        </section>

        <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-lg w-fit mb-7" role="tablist">
          {[
            ['parcours', 'Parcours'],
            ['assistant', 'Professeur IA'],
            ['stats', 'Progression'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`px-4 py-2 rounded-md text-sm font-medium ${view === key ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'parcours' && (
          <div className="space-y-10">
            <div className="relative max-w-xl">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher un cours, chapitre ou sujet..."
                className="w-full h-11 rounded-md bg-muted border border-border pl-10 pr-3 outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <section>
              <h2 className="text-xl font-semibold mb-4">Parcours d'apprentissage</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleTopics.map((topic) => {
                  const Icon = topic.icon || BookOpen;
                  const completed = progress.completed_topics?.includes(topic.id);
                  const favorite = progress.favorite_topics?.includes(topic.id);
                  return (
                    <button
                      key={topic.id}
                      onClick={() => startTopic(topic)}
                      className="text-left border border-border rounded-lg p-4 hover:border-primary/60 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          {completed ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Niveau {topic.level}</p>
                          <h3 className="font-semibold">{topic.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{topic.summary || topic.subtitle}</p>
                          {topic.source_note && <p className="text-xs text-primary mt-2">Source : {topic.source_note}</p>}
                        </div>
                        <button onClick={(event) => toggleFavorite(topic, event)} className={`ml-auto mt-1 ${favorite ? 'text-yellow-500' : 'text-muted-foreground'}`} aria-label="Favori">
                          <Star className="w-4 h-4" />
                        </button>
                        <ChevronRight className="w-4 h-4 mt-2 text-muted-foreground shrink-0" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-4">Outils gratuits deja disponibles</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {RESOURCES.map((resource) => {
                  const Icon = resource.icon;
                  return (
                    <Link key={resource.path} to={resource.path} className="border border-border rounded-lg p-4 hover:border-primary/60 transition-colors">
                      <Icon className="w-5 h-5 text-primary mb-3" />
                      <h3 className="font-semibold text-sm">{resource.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{resource.subtitle}</p>
                    </Link>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {view === 'assistant' && (
          <section className="grid lg:grid-cols-[1fr_320px] gap-5">
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Professeur pedagogique</h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedTopic ? `Theme actuel : ${selectedTopic.title}` : 'Choisis un theme ou pose directement ta question.'}
                  </p>
                </div>
                {selectedTopic && messages.some((message) => message.role === 'assistant') && (
                  <Button variant="outline" className="ml-auto" onClick={toggleTopicCompletion} disabled={!isSignedIn}>
                    <Check className="w-4 h-4 mr-2" />
                    {progress.completed_topics?.includes(selectedTopic.id) ? 'Marquer a revoir' : 'Etape terminee'}
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={speaking ? stopSpeaking : startVoiceInput}
                  disabled={busy || !isSignedIn}
                  className={!selectedTopic && !messages.length ? 'ml-auto' : ''}
                >
                  {speaking ? <VolumeX className="w-4 h-4 mr-2" /> : <Mic className="w-4 h-4 mr-2" />}
                  {speaking ? 'Arreter la voix' : listening ? 'Je t ecoute...' : 'Parler au professeur'}
                </Button>
              </div>

              <div className="border border-border rounded-lg min-h-[420px] flex flex-col">
                <div className="flex-1 p-4 md:p-6 space-y-4 overflow-y-auto max-h-[60vh]">
                  {messages.length === 0 && (
                    <div className="text-center py-14 max-w-lg mx-auto">
                      <MessageCircle className="w-10 h-10 text-primary mx-auto mb-3" />
                      <h3 className="font-semibold mb-2">Que souhaites-tu apprendre ?</h3>
                      <p className="text-sm text-muted-foreground">Demande une explication, une lecon, un exercice ou une revision adaptee a ton niveau.</p>
                    </div>
                  )}
                  {messages.map((message, index) => (
                    <div key={index} className={message.role === 'user' ? 'text-right' : ''}>
                      <div className={`inline-block max-w-[90%] text-left rounded-lg px-4 py-3 ${message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                        {message.role === 'assistant' ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                            <button
                              type="button"
                              onClick={() => speak(message.content)}
                              className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Volume2 className="w-3.5 h-3.5" /> Ecouter
                            </button>
                          </div>
                        ) : <span className="whitespace-pre-wrap">{message.content}</span>}
                      </div>
                    </div>
                  ))}
                  {busy && (
                    <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> Preparation de la reponse...
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                <div className="border-t border-border p-3">
                  <div className="flex flex-wrap gap-2 mb-3">
                    <button onClick={() => sendMessage('Fais-moi reviser ce que jai appris avec 3 questions.')} className="text-xs rounded-full bg-muted px-3 py-1.5">Revision</button>
                    <button onClick={() => sendMessage('Explique-moi ce sujet avec des mots tres simples.')} className="text-xs rounded-full bg-muted px-3 py-1.5">Expliquer simplement</button>
                    <button onClick={() => sendMessage('Donne-moi un exercice pratique adapte a mon niveau.')} className="text-xs rounded-full bg-muted px-3 py-1.5">Exercice</button>
                  </div>
                  <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }} className="flex items-end gap-2">
                    <textarea
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          sendMessage();
                        }
                      }}
                      rows={1}
                      placeholder="Pose ta question sur l'Islam..."
                      className="flex-1 resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary max-h-32"
                    />
                    <Button type="button" variant="outline" onClick={startVoiceInput} disabled={busy || listening || !isSignedIn} size="icon" aria-label="Parler">
                      {listening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                    </Button>
                    <Button type="submit" disabled={busy || !input.trim()} size="icon" aria-label="Envoyer">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </form>
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="font-semibold inline-flex items-center gap-2 mb-3"><FileText className="w-4 h-4 text-primary" /> Notes personnelles</h3>
                <textarea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder={!isSignedIn ? 'Connecte-toi gratuitement pour sauvegarder tes notes.' : selectedTopic ? `Note sur ${selectedTopic.title}` : 'Choisis un chapitre pour prendre une note.'}
                  disabled={!selectedTopic || !isSignedIn}
                  className="w-full h-32 rounded-md bg-muted border border-border p-3 text-sm resize-none outline-none focus:ring-2 focus:ring-primary"
                />
                <Button onClick={saveNote} disabled={!selectedTopic || !isSignedIn} className="w-full mt-3">Sauvegarder la note</Button>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <div className="flex gap-3">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                  <p>Assistant pedagogique uniquement. Pour une fatwa ou situation grave, consulte une personne de science qualifiee.</p>
                </div>
              </div>
            </aside>
          </section>
        )}

        {view === 'stats' && (
          <section className="grid lg:grid-cols-2 gap-5">
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-xl font-semibold mb-4">Objectifs</h2>
              <div className="space-y-3">
                {(goals?.goals || []).map((goal) => (
                  <div key={goal.id} className="flex items-center gap-3">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center ${goal.done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      {goal.done ? <Check className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                    </span>
                    <span>{goal.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-xl font-semibold mb-4">Certificat</h2>
              {certificate?.available ? (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-5">
                  <GraduationCap className="w-8 h-8 text-primary mb-3" />
                  <p className="font-semibold">{certificate.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">Attribue a {certificate.user_name || 'Utilisateur'}.</p>
                </div>
              ) : (
                <p className="text-muted-foreground">Termine les {topics.length} chapitres pour debloquer le certificat numerique.</p>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
