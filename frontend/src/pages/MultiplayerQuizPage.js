import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import {
  ArrowLeft, Check, Clipboard, Clock3, Globe2, Loader2, LockKeyhole,
  LogOut, Radio, RefreshCw, ShieldCheck, Signal, Sparkles, Trophy, Users,
  Wifi, WifiOff, Zap, Volume2, VolumeX
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

const BACKEND = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');
const API = `${BACKEND}/api`;
const WS_BASE = BACKEND.replace(/^http/, 'ws');
const CAPACITIES = [2, 4, 6, 8, 10];
const GAME_CATEGORIES = [
  ['general', 'Toutes catégories'], ['piliers', 'Piliers'], ['coran', 'Coran'],
  ['priere', 'Prière'], ['ramadan', 'Ramadan'], ['prophetes', 'Prophètes'], ['croyance', 'Croyance']
];
const DIFFICULTIES = [
  ['debutant', 'Débutant'], ['facile', 'Facile'], ['moyen', 'Moyen'],
  ['difficile', 'Difficile'], ['expert', 'Expert']
];
const REACTIONS = [
  ['well_played', 'Bien joué !'],
  ['bravo', 'Bravo !'],
  ['congrats', 'Félicitations !'],
  ['good_luck', 'Bonne chance !'],
  ['nice_answer', 'Belle réponse !'],
];

function roomError(error, fallback) {
  return error?.response?.data?.detail || fallback;
}

export default function MultiplayerQuizPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [screen, setScreen] = useState('menu');
  const [room, setRoom] = useState(null);
  const [publicRooms, setPublicRooms] = useState([]);
  const [capacity, setCapacity] = useState(4);
  const [visibility, setVisibility] = useState('public');
  const [category, setCategory] = useState('general');
  const [difficulty, setDifficulty] = useState('moyen');
  const [questionCount, setQuestionCount] = useState(10);
  const [questionTime, setQuestionTime] = useState(15);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [socketState, setSocketState] = useState('disconnected');
  const [ping, setPing] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [reaction, setReaction] = useState(null);
  const [launched, setLaunched] = useState(false);
  const [gameAnswer, setGameAnswer] = useState(null);
  const [gameAnswerResult, setGameAnswerResult] = useState(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [soundsEnabled, setSoundsEnabled] = useState(true);

  const socketRef = useRef(null);
  const heartbeatRef = useRef(null);
  const reconnectRef = useRef(null);
  const roomRef = useRef(null);
  const leavingRef = useRef(false);
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  useEffect(() => { roomRef.current = room; }, [room]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setGameAnswer(null);
    setGameAnswerResult(null);
  }, [room?.game?.current_index]);

  const loadPublicRooms = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/multiplayer/rooms/public`, { headers: authHeaders });
      setPublicRooms(response.data || []);
    } catch (error) {
      setPublicRooms([]);
    }
  }, [authHeaders]);

  useEffect(() => { loadPublicRooms(); }, [loadPublicRooms]);

  const closeSocket = useCallback(() => {
    window.clearInterval(heartbeatRef.current);
    window.clearTimeout(reconnectRef.current);
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const openSocket = useCallback(async (roomCode) => {
    if (!roomCode || leavingRef.current) return;
    closeSocket();
    setSocketState('connecting');
    try {
      const ticketResponse = await axios.post(
        `${API}/multiplayer/socket-ticket`, {}, { headers: authHeaders }
      );
      const socket = new WebSocket(
        `${WS_BASE}/api/multiplayer/ws/${encodeURIComponent(roomCode)}?ticket=${encodeURIComponent(ticketResponse.data.ticket)}`
      );
      socketRef.current = socket;
      socket.onopen = () => {
        setSocketState('connected');
        heartbeatRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping', sent_at: Date.now() }));
          }
        }, 10000);
      };
      socket.onmessage = (event) => {
        let payload;
        try { payload = JSON.parse(event.data); } catch (error) { return; }
        if (payload.room) setRoom(payload.room);
        if (payload.type === 'pong' && payload.sent_at) setPing(Math.max(0, Date.now() - payload.sent_at));
        if (payload.type === 'countdown') setCountdown(payload.value);
        if (payload.type === 'countdown_cancelled') setCountdown(null);
        if (payload.type === 'game_start' || payload.type === 'game_welcome') {
          setCountdown(null);
          setLaunched(true);
        }
        if (payload.type === 'reaction') {
          setReaction(`${payload.name} : ${payload.label}`);
          window.setTimeout(() => setReaction(null), 2500);
        }
      };
      socket.onerror = () => setSocketState('error');
      socket.onclose = () => {
        window.clearInterval(heartbeatRef.current);
        setSocketState('disconnected');
        if (!leavingRef.current && roomRef.current?.code) {
          reconnectRef.current = window.setTimeout(() => openSocket(roomRef.current.code), 2000);
        }
      };
    } catch (error) {
      setSocketState('error');
      reconnectRef.current = window.setTimeout(() => openSocket(roomCode), 3000);
    }
  }, [authHeaders, closeSocket]);

  useEffect(() => () => closeSocket(), [closeSocket]);

  const enterRoom = async (nextRoom) => {
    leavingRef.current = false;
    setRoom(nextRoom);
    setLaunched(nextRoom.status === 'ready');
    setCountdown(null);
    setScreen('lobby');
    await openSocket(nextRoom.code);
  };

  const createRoom = async () => {
    setBusy(true);
    try {
      const response = await axios.post(
        `${API}/multiplayer/rooms`,
        {
          max_players: capacity,
          visibility,
          category,
          difficulty,
          question_count: questionCount,
          question_time: questionTime,
        },
        { headers: authHeaders }
      );
      await enterRoom(response.data);
    } catch (error) {
      toast.error(roomError(error, 'Impossible de créer la salle.'));
    } finally {
      setBusy(false);
    }
  };

  const quickMatch = async () => {
    setBusy(true);
    try {
      const response = await axios.post(`${API}/multiplayer/quick-match`, {}, { headers: authHeaders });
      await enterRoom(response.data);
    } catch (error) {
      toast.error(roomError(error, 'La recherche de joueurs a échoué.'));
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (code = joinCode) => {
    const normalized = code.trim().toUpperCase();
    if (normalized.length !== 6) {
      toast.error('Le code doit contenir 6 caractères.');
      return;
    }
    setBusy(true);
    try {
      const response = await axios.post(
        `${API}/multiplayer/rooms/join`, { code: normalized }, { headers: authHeaders }
      );
      await enterRoom(response.data);
    } catch (error) {
      toast.error(roomError(error, 'Impossible de rejoindre la salle.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleReady = async () => {
    const me = room?.players?.find((player) => player.user_id === user?.id);
    if (!me || busy) return;
    setBusy(true);
    try {
      const response = await axios.post(
        `${API}/multiplayer/rooms/${room.code}/ready`,
        { ready: !me.ready },
        { headers: authHeaders }
      );
      setRoom(response.data);
    } catch (error) {
      toast.error(roomError(error, 'Impossible de modifier votre statut.'));
    } finally {
      setBusy(false);
    }
  };

  const sendReaction = async (reactionKey) => {
    try {
      await axios.post(
        `${API}/multiplayer/rooms/${room.code}/reaction`,
        { reaction: reactionKey },
        { headers: authHeaders }
      );
    } catch (error) {
      toast.error('Réaction indisponible.');
    }
  };

  const leaveRoom = async () => {
    if (!room) return;
    leavingRef.current = true;
    closeSocket();
    try {
      await axios.post(
        `${API}/multiplayer/rooms/${room.code}/leave`, {}, { headers: authHeaders }
      );
    } catch (error) {
      // The local exit must remain usable even during a transient network error.
    }
    setRoom(null);
    setScreen('menu');
    setLaunched(false);
    setCountdown(null);
    setSocketState('disconnected');
    loadPublicRooms();
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast.success('Code copié.');
    } catch (error) {
      toast.error(`Code de la salle : ${room.code}`);
    }
  };

  const playFeedbackSound = useCallback((correct) => {
    if (!soundsEnabled || typeof window === 'undefined') return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = correct ? 720 : 210;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
      window.setTimeout(() => context.close(), 280);
    } catch (error) {
      // Sound feedback is optional and must never block the game.
    }
  }, [soundsEnabled]);

  const submitGameAnswer = async (answerIndex) => {
    if (!room?.game || gameAnswer !== null || busy) return;
    setGameAnswer(answerIndex);
    setBusy(true);
    try {
      const response = await axios.post(
        `${API}/multiplayer/rooms/${room.code}/answer`,
        { question_index: room.game.current_index, answer: answerIndex },
        { headers: authHeaders }
      );
      setGameAnswerResult(response.data);
      playFeedbackSound(Boolean(response.data.correct));
    } catch (error) {
      setGameAnswer(null);
      toast.error(roomError(error, 'Reponse refusee par le serveur.'));
    } finally {
      setBusy(false);
    }
  };

  const reportCurrentQuestion = async () => {
    if (!room?.game?.question) return;
    const reason = window.prompt('Pourquoi signaler cette question ?');
    if (!reason?.trim()) return;
    try {
      await axios.post(
        `${API}/multiplayer/questions/report`,
        {
          room_code: room.code,
          question_id: room.game.question.id || `${room.code}-${room.game.current_index}`,
          reason: reason.trim().slice(0, 120),
          details: room.game.question.question,
        },
        { headers: authHeaders }
      );
      toast.success('Signalement envoye au panel admin.');
    } catch (error) {
      toast.error('Signalement impossible pour le moment.');
    }
  };

  const reportPlayer = async (player) => {
    if (!room || !player || player.user_id === user?.id) return;
    const reason = window.prompt(`Pourquoi signaler ${player.name} ?`);
    if (!reason?.trim()) return;
    try {
      await axios.post(
        `${API}/multiplayer/rooms/${room.code}/report-player`,
        { target_user_id: player.user_id, reason: reason.trim().slice(0, 120), details: 'Signalement depuis le quiz multijoueur' },
        { headers: authHeaders }
      );
      toast.success('Signalement envoye au panel admin.');
    } catch (error) {
      toast.error(error?.response?.data?.detail || 'Signalement impossible.');
    }
  };

  if (screen === 'lobby' && room && (room.status === 'playing' || room.status === 'finished')) {
    const game = room.game || {};
    const me = room.players.find((player) => player.user_id === user?.id);
    const rankings = [...room.players].sort((a, b) => (
      (b.score || 0) - (a.score || 0) ||
      (b.correct_count || 0) - (a.correct_count || 0) ||
      (a.total_response_ms || 0) - (b.total_response_ms || 0)
    ));
    const endsAt = game.question_ends_at ? new Date(game.question_ends_at).getTime() : null;
    const remainingMs = endsAt ? Math.max(0, endsAt - clockNow) : 0;
    const remainingSec = Math.ceil(remainingMs / 1000);
    const totalQuestionMs = Math.max(1, (room.question_time || 15) * 1000);
    const timerPct = Math.max(0, Math.min(100, (remainingMs / totalQuestionMs) * 100));
    const isQuestionPhase = game.phase === 'question' && game.question;
    const showReveal = ['reveal', 'ranking', 'finished'].includes(game.phase);
    const correctAnswer = Number(game.correct_answer);
    const currentAnswered = Array.isArray(game.round_answers)
      ? game.round_answers.some((answer) => answer.user_id === user?.id)
      : false;
    const winnerIds = new Set(game.winner_ids || []);

    const narratorText = (() => {
      if (game.phase === 'welcome') return 'Bienvenue dans le Quiz Islamique. Reste concentre, les questions arrivent.';
      if (game.phase === 'question') return game.is_tiebreak ? 'Question decisive : seuls les joueurs a egalite peuvent marquer.' : 'Lis bien la question. Le score est calcule par le serveur.';
      if (game.phase === 'reveal') return 'Correction : observe la bonne reponse et la source indiquee.';
      if (game.phase === 'ranking') return 'Classement en direct avant la prochaine question.';
      if (game.phase === 'finished') return winnerIds.has(user?.id) ? 'Victoire. QuAllah mette de la baraka dans ton apprentissage.' : 'Partie terminee. Chaque erreur est une occasion dapprendre.';
      return 'Synchronisation de la partie...';
    })();

    return (
      <main className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-background/95 sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={leaveRoom} className="p-2 rounded-md hover:bg-muted" aria-label="Quitter la partie">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <Trophy className="w-5 h-5 text-primary" />
            <span className="font-semibold">Partie {room.code}</span>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <button
                onClick={() => setSoundsEnabled((value) => !value)}
                className="p-2 rounded-md hover:bg-muted"
                aria-label={soundsEnabled ? 'Desactiver les sons' : 'Activer les sons'}
              >
                {soundsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              {socketState === 'connected' ? <Wifi className="w-4 h-4 text-emerald-500" /> : <WifiOff className="w-4 h-4 text-amber-500" />}
              <span className="hidden sm:inline">{socketState === 'connected' ? 'Temps reel' : 'Reconnexion'}</span>
            </div>
          </div>
        </header>

        <section className="max-w-6xl mx-auto px-4 py-6 grid lg:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-3">
                <span className="px-2.5 py-1 rounded-md bg-muted">{room.category || 'general'}</span>
                <span className="px-2.5 py-1 rounded-md bg-muted">{room.difficulty || 'moyen'}</span>
                <span className="px-2.5 py-1 rounded-md bg-muted">{room.question_count || game.total_questions || 0} questions</span>
                {game.is_tiebreak && <span className="px-2.5 py-1 rounded-md bg-amber-500/15 text-amber-400">Question decisive</span>}
              </div>
              <p className="text-sm text-primary font-medium mb-1">Animateur NEURA</p>
              <p className="text-lg">{narratorText}</p>
            </div>

            {isQuestionPhase && (
              <div className="rounded-lg border border-border bg-card p-5" data-testid="multiplayer-game-question">
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-sm text-muted-foreground">
                    Question {(game.current_index || 0) + 1}/{game.total_questions || room.question_count}
                  </div>
                  <div className="ml-auto text-sm font-semibold text-primary">{remainingSec}s</div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden mb-5">
                  <div className="h-full bg-primary transition-all duration-200" style={{ width: `${timerPct}%` }} />
                </div>
                <h1 className="text-2xl font-bold leading-snug mb-5">{game.question.question}</h1>
                <div className="grid gap-3">
                  {(game.question.options || []).map((option, index) => {
                    const selected = gameAnswer === index;
                    return (
                      <button
                        key={`${game.current_index}-${index}`}
                        onClick={() => submitGameAnswer(index)}
                        disabled={busy || gameAnswer !== null || currentAnswered}
                        className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                          selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-muted'
                        } disabled:cursor-not-allowed`}
                      >
                        <span className="font-semibold mr-2">{String.fromCharCode(65 + index)}.</span>{option}
                      </button>
                    );
                  })}
                </div>
                {gameAnswerResult && (
                  <p className={`mt-4 text-sm font-medium ${gameAnswerResult.correct ? 'text-emerald-500' : 'text-amber-400'}`}>
                    {gameAnswerResult.correct
                      ? `Bonne reponse +${gameAnswerResult.points} points`
                      : 'Reponse enregistree. La correction arrive apres le chrono.'}
                  </p>
                )}
              </div>
            )}

            {showReveal && game.question && (
              <div className="rounded-lg border border-border bg-card p-5" data-testid="multiplayer-game-reveal">
                <p className="text-sm text-primary font-medium mb-2">Correction</p>
                <h2 className="text-xl font-semibold mb-3">{game.question.question}</h2>
                <div className="space-y-2">
                  {(game.question.options || []).map((option, index) => (
                    <div
                      key={`${game.current_index}-reveal-${index}`}
                      className={`rounded-md px-4 py-3 border ${
                        index === correctAnswer ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-border bg-background'
                      }`}
                    >
                      <span className="font-semibold mr-2">{String.fromCharCode(65 + index)}.</span>{option}
                    </div>
                  ))}
                </div>
                {game.explanation && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{game.explanation}</p>}
                {game.source && <p className="mt-2 text-xs text-primary">Source : {game.source}</p>}
                <button onClick={reportCurrentQuestion} className="mt-4 text-xs text-amber-400 hover:text-amber-300">
                  Signaler cette question
                </button>
              </div>
            )}

            {game.phase === 'finished' && (
              <div className="rounded-lg border border-border bg-card p-5" data-testid="multiplayer-game-finished">
                <p className="text-sm text-primary font-medium mb-2">Podium final</p>
                <h1 className="text-3xl font-bold mb-5">Partie terminee</h1>
                <div className="grid sm:grid-cols-3 gap-3 mb-5">
                  {rankings.slice(0, 3).map((player, index) => (
                    <div key={player.user_id} className="rounded-lg border border-border bg-background p-4 text-center">
                      <p className="text-3xl font-bold text-primary">#{index + 1}</p>
                      <p className="font-semibold mt-2 truncate">{player.name}</p>
                      <p className="text-sm text-muted-foreground">{player.score || 0} points</p>
                    </div>
                  ))}
                </div>
                <div className="grid sm:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-md bg-muted p-3"><p className="text-muted-foreground">Score</p><p className="font-bold">{me?.score || 0}</p></div>
                  <div className="rounded-md bg-muted p-3"><p className="text-muted-foreground">Bonnes reponses</p><p className="font-bold">{me?.correct_count || 0}</p></div>
                  <div className="rounded-md bg-muted p-3"><p className="text-muted-foreground">Meilleure serie</p><p className="font-bold">{me?.best_streak || 0}</p></div>
                  <div className="rounded-md bg-muted p-3"><p className="text-muted-foreground">XP gagne</p><p className="font-bold">+{me?.xp_earned || 0}</p></div>
                </div>
                {Array.isArray(me?.badges_earned) && me.badges_earned.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {me.badges_earned.map((badge) => (
                      <span key={badge} className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm">{badge}</span>
                    ))}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-3 mt-6">
                  <Button onClick={leaveRoom}>Creer ou rejoindre une nouvelle partie</Button>
                  <Button variant="outline" onClick={() => navigate('/quiz')}>Retour au quiz</Button>
                  <Button variant="ghost" onClick={() => navigate('/')}>Accueil</Button>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="font-semibold mb-4">Classement live</h2>
              <div className="space-y-3" data-testid="multiplayer-live-ranking">
                {rankings.map((player, index) => (
                  <div key={player.user_id} className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold">#{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {player.name}
                        {player.abandoned && <span className="ml-2 text-xs text-amber-400">abandonne</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {player.correct_count || 0} juste(s) - serie {player.streak || 0}
                      </p>
                      {player.user_id !== user?.id && (
                        <button onClick={() => reportPlayer(player)} className="text-[11px] text-amber-400 hover:text-amber-300">
                          Signaler
                        </button>
                      )}
                    </div>
                    <span className="font-bold text-primary">{player.score || 0}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="font-semibold mb-3">Reactions respectueuses</h2>
              <div className="flex flex-wrap gap-2">
                {REACTIONS.map(([key, label]) => (
                  <button key={key} onClick={() => sendReaction(key)} className="text-xs px-2.5 py-1.5 rounded-md bg-muted hover:bg-primary/10 hover:text-primary">
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">Aucun chat libre : le quiz reste calme et propre.</p>
            </div>
          </aside>
        </section>

        {reaction && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-full bg-primary text-primary-foreground px-5 py-3 shadow-xl text-sm">
            {reaction}
          </div>
        )}
      </main>
    );
  }

  if (screen === 'lobby' && room) {
    const me = room.players.find((player) => player.user_id === user?.id);
    const readyCount = room.players.filter((player) => player.ready && player.connected).length;
    const waitingCount = room.players.length - readyCount;
    return (
      <main className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-background/95 sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={leaveRoom} className="p-2 rounded-md hover:bg-muted" aria-label="Quitter la salle">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <Trophy className="w-5 h-5 text-primary" />
            <span className="font-semibold">Salle {room.code}</span>
            <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
              {(user?.is_vip || user?.subscription === 'neura_ultra') && (
                <Link to="/founder-admin" className="hidden sm:inline-flex items-center gap-1 hover:text-foreground">
                  <ShieldCheck className="w-4 h-4" /> Admin
                </Link>
              )}
              <span className="inline-flex items-center gap-1">
                {socketState === 'connected' ? <Wifi className="w-4 h-4 text-emerald-500" /> : <WifiOff className="w-4 h-4 text-amber-500" />}
                {socketState === 'connected' ? 'Temps réel' : 'Reconnexion'}
              </span>
              {ping !== null && <span className="hidden sm:inline">{ping} ms</span>}
            </div>
          </div>
        </header>

        <section className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-col lg:flex-row lg:items-end gap-5 pb-6 border-b border-border">
            <div>
              <p className="text-sm text-primary font-medium mb-1">Lobby sécurisé</p>
              <h1 className="text-3xl sm:text-4xl font-bold">Quiz multijoueur</h1>
              <p className="text-muted-foreground mt-2">
                {launched ? 'Tous les joueurs sont synchronisés. La salle est prête.' :
                  waitingCount > 0 ? `En attente de ${waitingCount} joueur(s) prêt(s).` : 'Préparation du lancement…'}
              </p>
            </div>
            <div className="lg:ml-auto flex flex-wrap gap-2 text-sm">
              <span className="px-3 py-2 rounded-md bg-muted inline-flex items-center gap-2">
                {room.visibility === 'private' ? <LockKeyhole className="w-4 h-4" /> : <Globe2 className="w-4 h-4" />}
                {room.visibility === 'private' ? 'Privée' : 'Publique'}
              </span>
              <button onClick={copyCode} className="px-3 py-2 rounded-md bg-muted inline-flex items-center gap-2 hover:bg-muted/70">
                <Clipboard className="w-4 h-4" /> {room.code}
              </button>
              <span className="px-3 py-2 rounded-md bg-muted inline-flex items-center gap-2">
                <Users className="w-4 h-4" /> {room.player_count}/{room.max_players}
              </span>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1fr_300px] gap-6 pt-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Joueurs</h2>
                <span className="text-sm text-muted-foreground">{readyCount}/{room.players.length} prêts</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3" data-testid="multiplayer-player-list">
                {room.players.map((player) => (
                  <div key={player.user_id} className="border border-border rounded-lg p-4 flex items-center gap-3 bg-card">
                    <div className="w-11 h-11 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold">
                      {(player.name || 'J').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {player.name} {player.user_id === room.creator_id && <span className="text-xs text-primary">Hôte</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">Niveau {player.level} · {player.xp} XP</p>
                    </div>
                    <div className="ml-auto text-right">
                      <span className={`text-xs font-medium ${player.ready && player.connected ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                        {player.ready && player.connected ? 'Prêt' : player.connected ? 'En attente' : 'Hors ligne'}
                      </span>
                      <span className={`block w-2 h-2 rounded-full ml-auto mt-1 ${player.connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                      {player.user_id !== user?.id && (
                        <button onClick={() => reportPlayer(player)} className="block text-[11px] text-amber-400 hover:text-amber-300 mt-2">
                          Signaler
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <aside className="border-l-0 lg:border-l border-border lg:pl-6">
              <div className="mb-6">
                <h2 className="font-semibold mb-3">État de la salle</h2>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> Validation côté serveur</p>
                  <p className="flex items-center gap-2"><Radio className="w-4 h-4 text-primary" /> Synchronisation temps réel</p>
                  <p className="flex items-center gap-2"><Signal className="w-4 h-4 text-primary" /> Présence vérifiée</p>
                </div>
              </div>
              <div>
                <h2 className="font-semibold mb-3">Réactions</h2>
                <div className="flex flex-wrap gap-2">
                  {REACTIONS.map(([key, label]) => (
                    <button key={key} onClick={() => sendReaction(key)} className="text-xs px-2.5 py-1.5 rounded-md bg-muted hover:bg-primary/10 hover:text-primary">
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3">Aucun message libre entre joueurs.</p>
              </div>
            </aside>
          </div>

          <div className="mt-8 border-t border-border pt-5 flex flex-col sm:flex-row gap-3 sm:items-center">
            <Button
              onClick={toggleReady}
              disabled={busy || !me?.connected || launched}
              size="lg"
              className={`sm:min-w-48 ${me?.ready ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
              data-testid="multiplayer-ready-btn"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {me?.ready ? 'Prêt · annuler' : 'Je suis prêt'}
            </Button>
            <p className="text-sm text-muted-foreground">
              La salle démarre automatiquement dès que tous les joueurs présents sont prêts.
            </p>
            <Button variant="outline" onClick={leaveRoom} className="sm:ml-auto">
              <LogOut className="w-4 h-4 mr-2" /> Quitter
            </Button>
          </div>
        </section>

        {countdown !== null && (
          <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center">
            <div className="text-center">
              <Sparkles className="w-10 h-10 text-primary mx-auto mb-5" />
              <p className="text-lg">Tous les joueurs sont prêts</p>
              <p className="text-8xl font-bold text-primary mt-4" data-testid="multiplayer-countdown">{countdown}</p>
            </div>
          </div>
        )}
        {reaction && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-full bg-primary text-primary-foreground px-5 py-3 shadow-xl text-sm">
            {reaction}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/quiz')} className="p-2 rounded-md hover:bg-muted" aria-label="Retour au quiz">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Trophy className="w-5 h-5 text-primary" />
          <span className="font-semibold">Quiz multijoueur</span>
          <div className="ml-auto flex items-center gap-3">
            {(user?.is_vip || user?.subscription === 'neura_ultra') && (
              <Link to="/founder-admin" className="text-sm text-primary hover:text-primary/80">Panel fondateur</Link>
            )}
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Accueil</Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 py-10">
        <div className="max-w-3xl">
          <p className="text-sm text-primary font-medium mb-2">Compétition islamique en temps réel</p>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight">Apprendre ensemble, en direct.</h1>
          <p className="text-lg text-muted-foreground mt-4">
            Créez une salle, invitez vos proches ou trouvez automatiquement des joueurs. La partie attend que tout le monde soit prêt.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-9">
          <button onClick={quickMatch} disabled={busy} className="text-left border border-primary/40 bg-primary/5 rounded-lg p-5 hover:bg-primary/10 transition-colors">
            <Zap className="w-7 h-7 text-primary mb-6" />
            <h2 className="font-semibold text-lg">Partie rapide</h2>
            <p className="text-sm text-muted-foreground mt-1">Rejoindre automatiquement une salle publique.</p>
          </button>
          <button onClick={() => setScreen(screen === 'create' ? 'menu' : 'create')} className="text-left border border-border rounded-lg p-5 hover:bg-muted/40 transition-colors">
            <Users className="w-7 h-7 text-primary mb-6" />
            <h2 className="font-semibold text-lg">Créer une salle</h2>
            <p className="text-sm text-muted-foreground mt-1">Choisir la capacité et la confidentialité.</p>
          </button>
          <button onClick={() => setScreen(screen === 'join' ? 'menu' : 'join')} className="text-left border border-border rounded-lg p-5 hover:bg-muted/40 transition-colors">
            <LockKeyhole className="w-7 h-7 text-primary mb-6" />
            <h2 className="font-semibold text-lg">Rejoindre par code</h2>
            <p className="text-sm text-muted-foreground mt-1">Entrer le code privé à six caractères.</p>
          </button>
        </div>

        {screen === 'create' && (
          <section className="mt-6 border-y border-border py-6" data-testid="multiplayer-create-form">
            <h2 className="font-semibold text-lg mb-4">Nouvelle salle</h2>
            <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
              <label className="block">
                <span className="block text-sm text-muted-foreground mb-2">Nombre de joueurs</span>
                <select value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="h-11 bg-muted rounded-md px-3 min-w-40">
                  {CAPACITIES.map((value) => <option key={value} value={value}>{value} joueurs</option>)}
                </select>
              </label>
              <div>
                <span className="block text-sm text-muted-foreground mb-2">Visibilité</span>
                <div className="flex gap-2">
                  <button onClick={() => setVisibility('public')} className={`h-11 px-4 rounded-md ${visibility === 'public' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>Publique</button>
                  <button onClick={() => setVisibility('private')} className={`h-11 px-4 rounded-md ${visibility === 'private' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>Privée</button>
                </div>
              </div>
              <label className="block">
                <span className="block text-sm text-muted-foreground mb-2">Categorie</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 bg-muted rounded-md px-3 min-w-44">
                  {GAME_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm text-muted-foreground mb-2">Difficulte</span>
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="h-11 bg-muted rounded-md px-3 min-w-36">
                  {DIFFICULTIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm text-muted-foreground mb-2">Questions</span>
                <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} className="h-11 bg-muted rounded-md px-3 min-w-32">
                  {[3, 5, 10, 15].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm text-muted-foreground mb-2">Temps</span>
                <select value={questionTime} onChange={(event) => setQuestionTime(Number(event.target.value))} className="h-11 bg-muted rounded-md px-3 min-w-32">
                  {[10, 15, 20, 30].map((value) => <option key={value} value={value}>{value}s</option>)}
                </select>
              </label>
              <Button onClick={createRoom} disabled={busy} className="h-11 sm:ml-auto">
                {busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Créer
              </Button>
            </div>
          </section>
        )}

        {screen === 'join' && (
          <section className="mt-6 border-y border-border py-6" data-testid="multiplayer-join-form">
            <h2 className="font-semibold text-lg mb-4">Code de la salle</h2>
            <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                placeholder="QX8M92"
                aria-label="Code de la salle"
                className="h-12 flex-1 rounded-md bg-muted border border-border px-4 uppercase tracking-[0.3em] font-mono outline-none focus:ring-2 focus:ring-primary"
              />
              <Button onClick={() => joinRoom()} disabled={busy} className="h-12 px-6">Rejoindre</Button>
            </div>
          </section>
        )}

        <section className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">Salles publiques</h2>
              <p className="text-sm text-muted-foreground">Salons disponibles en attente de joueurs.</p>
            </div>
            <button onClick={loadPublicRooms} className="p-2 rounded-md hover:bg-muted" aria-label="Actualiser les salles">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {publicRooms.length ? (
            <div className="divide-y divide-border border-y border-border">
              {publicRooms.map((publicRoom) => (
                <div key={publicRoom.room_id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Radio className="w-5 h-5" /></div>
                  <div>
                    <p className="font-medium">Salle {publicRoom.code}</p>
                    <p className="text-sm text-muted-foreground">{publicRoom.player_count}/{publicRoom.max_players} joueurs</p>
                  </div>
                  <Button variant="outline" onClick={() => joinRoom(publicRoom.code)} className="sm:ml-auto">Rejoindre</Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="border-y border-border py-10 text-center text-muted-foreground">
              <Clock3 className="w-7 h-7 mx-auto mb-3" />
              <p>Aucune salle publique disponible pour le moment.</p>
            </div>
          )}
        </section>
      </section>
      {busy && screen === 'menu' && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
          <div className="inline-flex items-center gap-3"><Loader2 className="w-5 h-5 animate-spin text-primary" /> Recherche de joueurs…</div>
        </div>
      )}
    </main>
  );
}
