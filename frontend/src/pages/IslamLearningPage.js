import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  ArrowLeft, BookOpen, Check, ChevronRight, GraduationCap, Heart,
  HelpCircle, History, Loader2, MessageCircle, Send, ShieldAlert,
  Sparkles, Star
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const LEVELS = [
  { value: 'débutant', label: 'Débutant' },
  { value: 'intermédiaire', label: 'Intermédiaire' },
  { value: 'avancé', label: 'Avancé' },
];

const TOPICS = [
  { id: 'croyance', title: 'La croyance', subtitle: 'Les fondements de la foi', icon: Star },
  { id: 'ablutions', title: 'Les ablutions', subtitle: 'Comprendre et accomplir le wudu', icon: Sparkles },
  { id: 'priere', title: 'La prière', subtitle: 'Apprendre la salat étape par étape', icon: GraduationCap },
  { id: 'jeune', title: 'Le jeûne', subtitle: 'Les bases du jeûne et du Ramadan', icon: Heart },
  { id: 'zakat', title: 'La zakat', subtitle: 'Sens, principes et responsabilité', icon: Heart },
  { id: 'hajj', title: 'Le pèlerinage', subtitle: 'Découvrir les étapes du hajj', icon: History },
  { id: 'comportement', title: 'Le comportement', subtitle: 'Éthique, famille et relations', icon: Heart },
  { id: 'invocations', title: 'Les invocations', subtitle: 'Adhkar et duas du quotidien', icon: MessageCircle },
  { id: 'prophetes', title: 'Les prophètes', subtitle: 'Leur histoire et leurs enseignements', icon: BookOpen },
];

const RESOURCES = [
  { title: 'Lire le Coran', subtitle: 'Lecteur complet déjà disponible', path: '/quran', icon: BookOpen },
  { title: 'Suivre les leçons', subtitle: 'Cours structurés existants', path: '/learn', icon: GraduationCap },
  { title: 'Tester ses connaissances', subtitle: 'Quiz et exercices', path: '/quiz', icon: HelpCircle },
  { title: 'Lire les invocations', subtitle: 'Duas du quotidien', path: '/duas', icon: Heart },
];

export default function IslamLearningPage() {
  const navigate = useNavigate();
  const { user, getAuthHeader } = useAuth();
  const [view, setView] = useState('parcours');
  const [level, setLevel] = useState('débutant');
  const [progress, setProgress] = useState({ completed_topics: [], current_topic: null });
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    const loadProgress = async () => {
      try {
        const response = await axios.get(`${API}/islam-learning/progress`, {
          headers: getAuthHeader(),
        });
        setProgress(response.data);
        setLevel(response.data.level || 'débutant');
      } catch (error) {
        console.error('Islam learning progress error:', error);
      } finally {
        setLoadingProgress(false);
      }
    };
    loadProgress();
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const sendMessage = async (text, topic = selectedTopic) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', content }]);
    setBusy(true);
    try {
      const response = await axios.post(
        `${API}/islam-learning/chat`,
        { content, level, topic: topic?.title || null, session_id: sessionId },
        { headers: getAuthHeader(), timeout: 120000 }
      );
      setSessionId(response.data.session_id);
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: response.data.response },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: 'Le professeur est temporairement indisponible. Réessaie dans un instant.' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const startTopic = (topic) => {
    setSelectedTopic(topic);
    setView('assistant');
    if (messages.length === 0) {
      sendMessage(
        `Commence une leçon structurée sur « ${topic.title} », adaptée à mon niveau. ` +
        'Explique les bases simplement, cite les sources vérifiables et termine par une question de révision.',
        topic
      );
    }
  };

  const toggleTopicCompletion = async () => {
    if (!selectedTopic) return;
    const isCompleted = progress.completed_topics?.includes(selectedTopic.id);
    try {
      const response = await axios.post(
        `${API}/islam-learning/progress`,
        { topic: selectedTopic.id, completed: !isCompleted, level },
        { headers: getAuthHeader() }
      );
      setProgress(response.data);
    } catch (error) {
      console.error('Islam learning progress save error:', error);
    }
  };

  const completedCount = progress.completed_topics?.length || 0;
  const progressPercent = Math.round((completedCount / TOPICS.length) * 100);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-muted"
            aria-label="Retour à l'accueil"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary" />
            <span className="font-semibold">Apprentissage de l’Islam</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="islam-level" className="text-sm text-muted-foreground">Niveau</label>
            <select
              id="islam-level"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="rounded-lg bg-muted px-3 py-2 text-sm border-0 outline-none"
            >
              {LEVELS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
        <section className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Apprendre pas à pas</h1>
          <p className="text-muted-foreground max-w-3xl">
            Suis un parcours structuré, révise tes connaissances et pose tes questions à un assistant pédagogique prudent.
          </p>
          <div className="mt-5 max-w-xl">
            <div className="flex justify-between text-sm mb-2">
              <span>{loadingProgress ? 'Chargement de la progression…' : `${completedCount} étape${completedCount > 1 ? 's' : ''} terminée${completedCount > 1 ? 's' : ''}`}</span>
              <span>{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        </section>

        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit mb-7" role="tablist">
          <button
            onClick={() => setView('parcours')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${view === 'parcours' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
          >
            Parcours
          </button>
          <button
            onClick={() => setView('assistant')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${view === 'assistant' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
          >
            Assistant pédagogique
          </button>
        </div>

        {view === 'parcours' ? (
          <div className="space-y-10">
            <section>
              <h2 className="text-xl font-semibold mb-4">Parcours d’apprentissage</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {TOPICS.map((topic) => {
                  const Icon = topic.icon;
                  const completed = progress.completed_topics?.includes(topic.id);
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
                          <h3 className="font-semibold">{topic.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{topic.subtitle}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 ml-auto mt-2 text-muted-foreground shrink-0" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-4">Outils déjà disponibles</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {RESOURCES.map((resource) => {
                  const Icon = resource.icon;
                  return (
                    <Link
                      key={resource.path}
                      to={resource.path}
                      className="border border-border rounded-lg p-4 hover:border-primary/60 transition-colors"
                    >
                      <Icon className="w-5 h-5 text-primary mb-3" />
                      <h3 className="font-semibold text-sm">{resource.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{resource.subtitle}</p>
                    </Link>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Ces liens ouvrent les fonctionnalités existantes sans modifier leur contenu ni leur fonctionnement.
              </p>
            </section>
          </div>
        ) : (
          <section className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div>
                <h2 className="text-xl font-semibold">Assistant pédagogique</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedTopic ? `Thème actuel : ${selectedTopic.title}` : 'Choisis un thème ou pose directement ta question.'}
                </p>
              </div>
              {selectedTopic && messages.some((message) => message.role === 'assistant') && (
                <Button variant="outline" className="ml-auto" onClick={toggleTopicCompletion}>
                  <Check className="w-4 h-4 mr-2" />
                  {progress.completed_topics?.includes(selectedTopic.id) ? 'Marquer à revoir' : 'Étape terminée'}
                </Button>
              )}
            </div>

            <div className="border border-border rounded-lg min-h-[420px] flex flex-col">
              <div className="flex-1 p-4 md:p-6 space-y-4 overflow-y-auto max-h-[60vh]">
                {messages.length === 0 && (
                  <div className="text-center py-14 max-w-lg mx-auto">
                    <MessageCircle className="w-10 h-10 text-primary mx-auto mb-3" />
                    <h3 className="font-semibold mb-2">Que souhaites-tu apprendre ?</h3>
                    <p className="text-sm text-muted-foreground">
                      Demande une explication, une leçon, un exercice ou une révision adaptée à ton niveau.
                    </p>
                  </div>
                )}
                {messages.map((message, index) => (
                  <div key={index} className={message.role === 'user' ? 'text-right' : ''}>
                    <div className={`inline-block max-w-[90%] text-left rounded-lg px-4 py-3 ${message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                      {message.role === 'assistant' ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                      ) : <span className="whitespace-pre-wrap">{message.content}</span>}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Préparation de la réponse…
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-border p-3">
                <div className="flex flex-wrap gap-2 mb-3">
                  <button onClick={() => sendMessage('Fais-moi réviser ce que j’ai appris avec 3 questions.')} className="text-xs rounded-full bg-muted px-3 py-1.5">Révision</button>
                  <button onClick={() => sendMessage('Explique-moi ce sujet avec des mots plus simples.')} className="text-xs rounded-full bg-muted px-3 py-1.5">Expliquer simplement</button>
                  <button onClick={() => sendMessage('Donne-moi un exercice pratique adapté à mon niveau.')} className="text-xs rounded-full bg-muted px-3 py-1.5">Exercice</button>
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
                    placeholder="Pose ta question sur l’Islam…"
                    className="flex-1 resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary max-h-32"
                  />
                  <Button type="submit" disabled={busy || !input.trim()} size="icon" aria-label="Envoyer">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </form>
              </div>
            </div>

            <div className="mt-4 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
              <p>
                Cet assistant est pédagogique et ne remplace pas une personne de science. Pour une fatwa ou une situation grave et personnelle, consulte un imam ou un savant qualifié.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
