import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import {
  ArrowLeft, Check, Clipboard, Clock3, Globe2, Loader2, LockKeyhole,
  LogOut, Radio, RefreshCw, ShieldCheck, Signal, Sparkles, Trophy, Users,
  Wifi, WifiOff, Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

const BACKEND = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');
const API = `${BACKEND}/api`;
const WS_BASE = BACKEND.replace(/^http/, 'ws');
const CAPACITIES = [2, 4, 6, 8, 10];
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
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [socketState, setSocketState] = useState('disconnected');
  const [ping, setPing] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [reaction, setReaction] = useState(null);
  const [launched, setLaunched] = useState(false);

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
        if (payload.type === 'game_start') {
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
        { max_players: capacity, visibility },
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
          <Link to="/" className="ml-auto text-sm text-muted-foreground hover:text-foreground">Accueil</Link>
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
