import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { ArrowLeft, Box, Check, Gift, Loader2, Sparkles, Star, Trophy, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function periodLabel(period) {
  return { daily: 'Quotidienne', weekly: 'Hebdomadaire', monthly: 'Mensuelle' }[period] || period;
}

export default function GamificationPage() {
  const navigate = useNavigate();
  const { getAuthHeader } = useAuth();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    const response = await axios.get(`${API}/gamification/status`, { headers: getAuthHeader() });
    setStatus(response.data);
  }, [getAuthHeader]);

  useEffect(() => {
    loadStatus().catch(() => toast.error('Impossible de charger les missions.'));
  }, [loadStatus]);

  const claimMission = async (mission) => {
    setBusy(true);
    try {
      const response = await axios.post(`${API}/gamification/missions/${mission.id}/claim`, {}, { headers: getAuthHeader() });
      toast.success(response.data.chest ? 'Mission validee + coffre rare obtenu.' : 'Mission validee, XP ajoutee.');
      await loadStatus();
    } catch (error) {
      toast.error(error?.response?.data?.detail || 'Mission indisponible.');
    } finally {
      setBusy(false);
    }
  };

  const openChest = async (chest) => {
    setBusy(true);
    try {
      const response = await axios.post(`${API}/gamification/chests/${chest.id}/open`, {}, { headers: getAuthHeader() });
      toast.success(`Coffre ouvert : ${response.data.reward.rarity}, +${response.data.reward.xp} XP.`);
      await loadStatus();
    } catch (error) {
      toast.error(error?.response?.data?.detail || 'Coffre indisponible.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-primary mr-3" /> Chargement des missions...
      </main>
    );
  }

  const closedChests = status.chests?.filter((chest) => chest.status !== 'opened') || [];
  const openedChests = status.chests?.filter((chest) => chest.status === 'opened') || [];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/quiz')} className="p-2 rounded-md hover:bg-muted" aria-label="Retour">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Gift className="w-5 h-5 text-primary" />
          <span className="font-semibold">Missions et recompenses</span>
          <Link to="/" className="ml-auto text-sm text-muted-foreground hover:text-foreground">Accueil</Link>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <Zap className="w-6 h-6 text-primary mb-3" />
            <p className="text-sm text-muted-foreground">XP total</p>
            <p className="text-3xl font-bold">{status.xp || 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <Trophy className="w-6 h-6 text-yellow-500 mb-3" />
            <p className="text-sm text-muted-foreground">Niveau</p>
            <p className="text-3xl font-bold">{status.level || 1}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <Box className="w-6 h-6 text-primary mb-3" />
            <p className="text-sm text-muted-foreground">Coffres fermes</p>
            <p className="text-3xl font-bold">{closedChests.length}</p>
          </div>
        </div>

        <section>
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <h1 className="text-2xl font-bold">Missions</h1>
              <p className="text-sm text-muted-foreground">Objectif : encourager l'apprentissage regulier, sans desequilibre.</p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {status.missions?.map((mission) => {
              const percent = Math.round((mission.progress / Math.max(1, mission.target)) * 100);
              return (
                <div key={mission.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                      {mission.claimed ? <Check className="w-5 h-5" /> : <Star className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{mission.title}</h2>
                        <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">{periodLabel(mission.period)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">+{mission.xp} XP</p>
                      {mission.locked_reason ? (
                        <p className="text-xs text-amber-400 mt-2">{mission.locked_reason}</p>
                      ) : (
                        <>
                          <Progress value={percent} className="h-2 mt-3" />
                          <p className="text-xs text-muted-foreground mt-2">{mission.progress}/{mission.target}</p>
                        </>
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={busy || !mission.completed || mission.claimed}
                      onClick={() => claimMission(mission)}
                    >
                      {mission.claimed ? 'Recu' : 'Reclamer'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid lg:grid-cols-2 gap-5">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-xl font-semibold mb-2 inline-flex items-center gap-2"><Box className="w-5 h-5 text-primary" /> Coffres rares</h2>
            <p className="text-sm text-muted-foreground mb-4">Les coffres tombent rarement. Les bonus quiz sont faibles et limites a +10.</p>
            <div className="space-y-3">
              {closedChests.map((chest) => (
                <div key={chest.id} className="flex items-center gap-3 rounded-md bg-muted p-3">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <div className="flex-1">
                    <p className="font-medium">Coffre ferme</p>
                    <p className="text-xs text-muted-foreground">Source : {chest.source}</p>
                  </div>
                  <Button size="sm" onClick={() => openChest(chest)} disabled={busy}>Ouvrir</Button>
                </div>
              ))}
              {!closedChests.length && <p className="text-sm text-muted-foreground">Aucun coffre ferme pour le moment.</p>}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-xl font-semibold mb-4">Historique des coffres</h2>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {openedChests.map((chest) => (
                <div key={chest.id} className="rounded-md bg-muted p-3 text-sm">
                  <p className="font-medium">{chest.rarity} - +{chest.xp} XP - bonus quiz +{chest.quiz_bonus}</p>
                  <p className="text-xs text-muted-foreground">{chest.opened_at}</p>
                </div>
              ))}
              {!openedChests.length && <p className="text-sm text-muted-foreground">Aucun coffre ouvert.</p>}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
