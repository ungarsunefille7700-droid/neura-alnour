import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Copy, KeyRound, Loader2, RefreshCw, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/utils/apiError';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/gateway`;
const PUBLIC_BASE = `${process.env.REACT_APP_BACKEND_URL}/v1`;
const DEFAULT_FORM = { name: '', requests_per_minute: 20, daily_neurons: 500, max_concurrent: 2 };

const formatNumber = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('fr-FR'));

function Tile({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-2">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

// Neura Gateway administration: own nan_ API keys, daily free Neuron budget, usage.
export default function ApiKeysPanel({ headers }) {
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, keysRes, statsRes] = await Promise.all([
        axios.get(`${API}/status`, { headers }),
        axios.get(`${API}/keys`, { headers }),
        axios.get(`${API}/stats?days=7`, { headers }),
      ]);
      setStatus(statusRes.data);
      setKeys(keysRes.data || []);
      setStats(statsRes.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Impossible de charger la Neura Gateway.'));
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const createKey = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const response = await axios.post(`${API}/keys`, {
        name: form.name.trim(),
        requests_per_minute: Number(form.requests_per_minute),
        daily_neurons: Number(form.daily_neurons),
        max_concurrent: Number(form.max_concurrent),
      }, { headers });
      setNewSecret(response.data.key);
      setForm(DEFAULT_FORM);
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Création de la clé impossible.'));
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (key) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Révoquer définitivement la clé « ${key.name} » ? Les applications qui l'utilisent seront bloquées.`)) return;
    try {
      await axios.post(`${API}/keys/${key.id}/revoke`, {}, { headers });
      toast.success('Clé révoquée.');
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Révocation impossible.'));
    }
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(newSecret);
      toast.success('Clé copiée.');
    } catch {
      toast.error('Copie impossible : sélectionne la clé et copie-la à la main.');
    }
  };

  if (loading && !status) {
    return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const engine = status?.engine;
  const budget = stats?.budget || status?.budget;
  const usedPercent = budget ? Math.min(100, Math.round((budget.used / budget.daily_limit) * 100)) : 0;
  const today = budget ? stats?.days?.[budget.day] : null;

  return (
    <div className="space-y-8" data-testid="api-keys-panel">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-sm text-primary font-medium">Neura Gateway</p>
          <h1 className="text-3xl font-bold mt-1">API & moteur d'IA</h1>
          <p className="text-muted-foreground mt-2">
            Moteur : <strong>{engine?.provider === 'emergent' || !engine ? 'ancien fournisseur (Emergent)' : engine.provider}</strong>
            {engine?.model ? ` · ${engine.model}` : ''}
            {engine && engine.provider !== 'emergent' && (engine.legacy_ai ? ' · secours payant autorisé' : ' · mode 100 % gratuit')}
          </p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </Button>
      </div>

      {budget ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between text-sm">
              <span>Neurons gratuits utilisés aujourd'hui</span>
              <span className="font-semibold" data-testid="budget-used">
                {formatNumber(Math.round(budget.used))} / {formatNumber(budget.daily_limit)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted mt-3 overflow-hidden">
              <div
                className={`h-full ${usedPercent >= 90 ? 'bg-red-500' : usedPercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Remise à zéro à minuit UTC. Au-delà de la limite, les nouvelles demandes sont refusées : aucune facturation possible.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile label="Requêtes aujourd'hui" value={formatNumber(today?.requests ?? budget.requests)} />
            <Tile label="Réponses servies par le cache" value={formatNumber(stats?.cache_hits)} hint="7 derniers jours" />
            <Tile label="Temps de réponse médian" value={stats?.latency_ms_p50 ? `${(stats.latency_ms_p50 / 1000).toFixed(1)} s` : '—'} />
            <Tile label="File d'attente" value={`${status?.queue?.active ?? 0} en cours · ${status?.queue?.waiting ?? 0} en attente`} hint={`Refusées (saturation) : ${formatNumber(status?.queue?.rejected)}`} />
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Aucun moteur Neura configuré : l'app utilise toujours l'ancien fournisseur. Les clés peuvent être créées dès maintenant,
          elles fonctionneront quand le moteur sera activé.
        </p>
      )}

      <div className="grid lg:grid-cols-[380px_1fr] gap-6">
        <form onSubmit={createKey} className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="api-key-form">
          <h2 className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4" /> Nouvelle clé API</h2>
          <label className="block text-sm">
            Nom
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              maxLength={60}
              placeholder="Ex. : NeuraCo, site partenaire…"
              className="mt-1 w-full h-10 rounded-md bg-muted border border-border px-3"
              data-testid="api-key-name"
            />
          </label>
          {[
            ['requests_per_minute', 'Requêtes par minute', 1, 300],
            ['daily_neurons', 'Neurons par jour', 1, 10000],
            ['max_concurrent', 'Requêtes simultanées', 1, 20],
          ].map(([field, label, min, max]) => (
            <label key={field} className="block text-sm">
              {label}
              <input
                type="number"
                min={min}
                max={max}
                value={form[field]}
                onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                className="mt-1 w-full h-10 rounded-md bg-muted border border-border px-3"
              />
            </label>
          ))}
          <Button type="submit" className="w-full" disabled={creating || !form.name.trim()} data-testid="api-key-create">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Créer la clé'}
          </Button>
          {newSecret && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2" data-testid="api-key-secret">
              <p className="text-sm font-medium">Copie cette clé maintenant : elle ne sera plus jamais affichée.</p>
              <code className="block break-all text-xs bg-background rounded p-2 select-all">{newSecret}</code>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={copySecret}><Copy className="w-4 h-4 mr-1" /> Copier</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setNewSecret('')}>J'ai copié la clé</Button>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Adresse de l'API (compatible OpenAI) : <code className="break-all">{PUBLIC_BASE}</code>
          </p>
        </form>

        <div>
          <h2 className="font-semibold mb-3">Clés ({keys.length})</h2>
          <div className="border-y border-border divide-y divide-border">
            {keys.map((key) => (
              <div key={key.id} className="py-3 flex flex-wrap items-center gap-3" data-testid="api-key-row">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {key.name}{' '}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${key.status === 'active' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
                      {key.status === 'active' ? 'active' : 'révoquée'}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">{key.prefix}…{key.last4}</p>
                  <p className="text-xs text-muted-foreground">
                    {key.limits?.requests_per_minute} req/min · {formatNumber(key.limits?.daily_neurons)} Neurons/jour · {key.limits?.max_concurrent} simultanées
                    {' · '}aujourd'hui : {formatNumber(key.today?.requests ?? 0)} req, {formatNumber(Math.round(key.today?.used ?? 0))} Neurons
                    {' · '}total : {formatNumber(key.total_requests)} req
                  </p>
                </div>
                {key.status === 'active' && (
                  <Button size="sm" variant="outline" onClick={() => revokeKey(key)} data-testid="api-key-revoke">
                    <ShieldOff className="w-4 h-4 mr-1" /> Révoquer
                  </Button>
                )}
              </div>
            ))}
            {!keys.length && <p className="py-8 text-center text-muted-foreground">Aucune clé pour l'instant.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
