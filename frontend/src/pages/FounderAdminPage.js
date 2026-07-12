import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import {
  ArrowLeft, BarChart3, Crown, Gift, History, Loader2, Search,
  ShieldCheck, Trophy, Users, AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const PERIODS = [
  ['today', "Aujourd'hui"],
  ['week', 'Semaine'],
  ['month', 'Mois'],
  ['year', 'Annee'],
  ['all', 'Toujours'],
];

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-2">{value ?? 0}</p>
    </div>
  );
}

export default function FounderAdminPage() {
  const { getAuthHeader, user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [period, setPeriod] = useState('month');
  const [reports, setReports] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [logs, setLogs] = useState([]);
  const [giftPlan, setGiftPlan] = useState('neura_ultra');
  const [giftMonths, setGiftMonths] = useState(1);

  const headers = useMemo(() => getAuthHeader(), [getAuthHeader]);

  const loadDashboard = useCallback(async () => {
    const [overviewRes, usersRes, leaderboardRes, reportsRes, rewardsRes, logsRes] = await Promise.all([
      axios.get(`${API}/founder-admin/overview`, { headers }),
      axios.get(`${API}/founder-admin/users`, { headers }),
      axios.get(`${API}/founder-admin/leaderboards?period=${period}`, { headers }),
      axios.get(`${API}/founder-admin/question-reports`, { headers }),
      axios.get(`${API}/founder-admin/rewards`, { headers }),
      axios.get(`${API}/founder-admin/logs`, { headers }),
    ]);
    setOverview(overviewRes.data);
    setUsers(usersRes.data || []);
    setLeaderboard(leaderboardRes.data?.rows || []);
    setReports(reportsRes.data || []);
    setRewards(rewardsRes.data || []);
    setLogs(logsRes.data || []);
  }, [headers, period]);

  useEffect(() => {
    setLoading(true);
    loadDashboard()
      .catch((error) => {
        if (error?.response?.status === 403) {
          toast.error('Acces reserve aux fondateurs et administrateurs.');
          navigate('/');
        } else {
          toast.error('Panel admin indisponible.');
        }
      })
      .finally(() => setLoading(false));
  }, [loadDashboard, navigate]);

  const searchUsers = async (value) => {
    setSearch(value);
    try {
      const response = await axios.get(`${API}/founder-admin/users?search=${encodeURIComponent(value)}`, { headers });
      setUsers(response.data || []);
    } catch (error) {
      toast.error('Recherche impossible.');
    }
  };

  const openUser = async (target) => {
    try {
      const response = await axios.get(`${API}/founder-admin/users/${target.id}`, { headers });
      setSelectedUser(response.data);
    } catch (error) {
      toast.error('Profil utilisateur indisponible.');
    }
  };

  const giftSubscription = async () => {
    if (!selectedUser) return;
    try {
      await axios.post(
        `${API}/founder-admin/rewards/subscription`,
        { user_id: selectedUser.id, plan: giftPlan, months: Number(giftMonths), reason: 'Recompense fondateur' },
        { headers }
      );
      toast.success('Abonnement offert et enregistre.');
      await loadDashboard();
      await openUser(selectedUser);
    } catch (error) {
      toast.error(error?.response?.data?.detail || 'Impossible doffrir labonnement.');
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary mr-3" /> Chargement du panel...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border sticky top-0 z-30 bg-background/95">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/quiz/multiplayer')} className="p-2 rounded-md hover:bg-muted" aria-label="Retour">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Crown className="w-5 h-5 text-yellow-500" />
          <div>
            <p className="font-semibold">Panel Fondateur</p>
            <p className="text-xs text-muted-foreground">{user?.email} - role {overview?.role}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {[
              ['dashboard', 'Dashboard', BarChart3],
              ['users', 'Utilisateurs', Users],
              ['leaderboard', 'Classements', Trophy],
              ['reports', 'Signalements', AlertTriangle],
              ['logs', 'Logs', History],
            ].map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-2 rounded-md text-sm inline-flex items-center gap-2 ${tab === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'dashboard' && (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-primary font-medium">Administration Quiz Multijoueur</p>
              <h1 className="text-3xl font-bold mt-1">Vue globale</h1>
              <p className="text-muted-foreground mt-2">Actions sensibles protegees cote serveur et journalisees.</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Utilisateurs" value={overview?.users_total} />
              <Stat label="Connectes" value={overview?.users_connected} />
              <Stat label="Joueurs en partie" value={overview?.players_in_game} />
              <Stat label="Abonnes" value={overview?.subscribers} />
              <Stat label="Parties aujourd'hui" value={overview?.games_today} />
              <Stat label="Parties semaine" value={overview?.games_week} />
              <Stat label="Parties mois" value={overview?.games_month} />
              <Stat label="Signalements ouverts" value={overview?.open_reports} />
              <Stat label="Quiz total" value={overview?.total_quiz} />
              <Stat label="Questions repondues" value={overview?.total_questions} />
              <Stat label="Recompenses" value={overview?.rewards_total} />
              <Stat label="Saison" value={overview?.season} />
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div className="grid lg:grid-cols-[1fr_380px] gap-6">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(event) => searchUsers(event.target.value)}
                    placeholder="Rechercher pseudo, nom, email ou ID..."
                    className="w-full h-11 rounded-md bg-muted border border-border pl-10 pr-3 outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
              <div className="border-y border-border divide-y divide-border">
                {users.map((item) => (
                  <button key={item.id} onClick={() => openUser(item)} className="w-full py-3 flex items-center gap-3 text-left hover:bg-muted/40">
                    <img src={item.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name || 'U')}`} alt="" className="w-10 h-10 rounded-full" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{item.name || 'Utilisateur'}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.email || item.id}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${item.status === 'offline' ? 'bg-muted text-muted-foreground' : 'bg-emerald-500/15 text-emerald-500'}`}>
                      {item.status}
                    </span>
                    <span className="text-sm text-muted-foreground">{item.quiz_wins || 0}V / {item.quiz_games || 0} parties</span>
                  </button>
                ))}
              </div>
            </div>

            <aside className="rounded-lg border border-border bg-card p-5 min-h-80">
              {selectedUser ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <img src={selectedUser.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedUser.name || 'U')}`} alt="" className="w-12 h-12 rounded-full" />
                    <div>
                      <h2 className="font-semibold">{selectedUser.name}</h2>
                      <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Stat label="XP" value={selectedUser.quiz_xp || 0} />
                    <Stat label="Niveau" value={selectedUser.quiz_level || 1} />
                    <Stat label="Parties" value={selectedUser.history?.length || 0} />
                    <Stat label="Badges" value={selectedUser.badges?.length || 0} />
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <h3 className="font-semibold mb-3 inline-flex items-center gap-2"><Gift className="w-4 h-4 text-primary" /> Offrir un abonnement</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={giftPlan} onChange={(event) => setGiftPlan(event.target.value)} className="h-10 rounded-md bg-muted px-3">
                        <option value="neura_plus">Neura+</option>
                        <option value="neura_ultra">Neura Ultra</option>
                      </select>
                      <select value={giftMonths} onChange={(event) => setGiftMonths(event.target.value)} className="h-10 rounded-md bg-muted px-3">
                        {[1, 3, 6, 12].map((value) => <option key={value} value={value}>{value} mois</option>)}
                      </select>
                    </div>
                    <Button onClick={giftSubscription} className="w-full mt-3">Confirmer le cadeau</Button>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Historique recent</h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {(selectedUser.history || []).map((item) => (
                        <div key={item.id} className="text-sm rounded-md bg-muted p-3">
                          <p>{item.score} pts - position #{item.position} - {item.won ? 'victoire' : 'partie terminee'}</p>
                          <p className="text-xs text-muted-foreground">{item.played_at}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-center text-muted-foreground">
                  <div>
                    <ShieldCheck className="w-8 h-8 mx-auto mb-3 text-primary" />
                    Selectionne un utilisateur pour voir son profil complet.
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {tab === 'leaderboard' && (
          <div>
            <div className="flex flex-wrap gap-2 mb-4">
              {PERIODS.map(([key, label]) => (
                <button key={key} onClick={() => setPeriod(key)} className={`px-3 py-2 rounded-md text-sm ${period === key ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="border-y border-border divide-y divide-border">
              {leaderboard.map((row) => (
                <div key={row.user_id} className="py-3 flex items-center gap-3">
                  <span className="w-10 text-lg font-bold text-primary">#{row.position}</span>
                  <div className="flex-1">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.games} parties - {row.wins} victoires - precision {row.accuracy}%</p>
                  </div>
                  <span className="font-bold">{row.score} pts</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'reports' && (
          <div className="border-y border-border divide-y divide-border">
            {reports.map((report) => (
              <div key={report.id} className="py-4">
                <p className="font-medium">{report.reason}</p>
                <p className="text-sm text-muted-foreground">{report.details || 'Aucun detail'} - question {report.question_id || 'inconnue'}</p>
                <p className="text-xs text-muted-foreground">{report.user_email} - {report.created_at}</p>
              </div>
            ))}
            {!reports.length && <p className="py-8 text-center text-muted-foreground">Aucun signalement.</p>}
          </div>
        )}

        {tab === 'logs' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div>
              <h2 className="font-semibold mb-3">Logs admin</h2>
              <div className="border-y border-border divide-y divide-border">
                {logs.map((log) => (
                  <div key={log.id} className="py-3 text-sm">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-muted-foreground">{log.actor_email} - {log.created_at}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 className="font-semibold mb-3">Recompenses</h2>
              <div className="border-y border-border divide-y divide-border">
                {rewards.map((reward) => (
                  <div key={reward.id} className="py-3 text-sm">
                    <p className="font-medium">{reward.plan} offert a {reward.target_email}</p>
                    <p className="text-muted-foreground">{reward.months} mois - {reward.created_at}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
