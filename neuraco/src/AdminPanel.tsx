import { useEffect, useMemo, useState } from 'react';
import {
  BadgePercent,
  CircleAlert,
  History,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  ServerCog,
  Users
} from 'lucide-react';
import type {
  NeuraCoAdminConfig,
  NeuraCoAdminIncident,
  NeuraCoAdminLog,
  NeuraCoAdminPricingHistory,
  NeuraCoAdminPromotion,
  NeuraCoAdminState,
  NeuraCoAdminUser
} from '../electron/ipc-contract';

type AdminTab = 'configuration' | 'operations' | 'audit';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const numberValue = (value: string, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const requestKey = (): string => (
  globalThis.crypto?.randomUUID?.() || `admin-${Date.now()}-${Math.random()}`
);

const AdminPanel = () => {
  const [tab, setTab] = useState<AdminTab>('configuration');
  const [state, setState] = useState<NeuraCoAdminState | null>(null);
  const [draft, setDraft] = useState<NeuraCoAdminConfig | null>(null);
  const [incidents, setIncidents] = useState<NeuraCoAdminIncident[]>([]);
  const [promotions, setPromotions] = useState<NeuraCoAdminPromotion[]>([]);
  const [history, setHistory] = useState<NeuraCoAdminPricingHistory[]>([]);
  const [logs, setLogs] = useState<NeuraCoAdminLog[]>([]);
  const [users, setUsers] = useState<NeuraCoAdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [reason, setReason] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [creditUserId, setCreditUserId] = useState('');
  const [creditAmount, setCreditAmount] = useState(0);
  const [creditReason, setCreditReason] = useState('');
  const [refund, setRefund] = useState({
    paymentReference: '',
    providerRefundId: '',
    credits: 0,
    reason: ''
  });
  const [incidentForm, setIncidentForm] = useState({
    title: '',
    message: '',
    severity: 'warning' as NeuraCoAdminIncident['severity']
  });
  const [promotionForm, setPromotionForm] = useState({
    code: '',
    description: '',
    discount: 10
  });

  const load = async () => {
    if (!window.neuraco) return;
    setLoading(true);
    setFeedback('');
    try {
      const [nextState, nextIncidents, nextPromotions, nextHistory, nextLogs] = await Promise.all([
        window.neuraco.getAdminState(),
        window.neuraco.listAdminIncidents(),
        window.neuraco.listAdminPromotions(),
        window.neuraco.getAdminPricingHistory(),
        window.neuraco.listAdminLogs()
      ]);
      setState(nextState);
      setDraft(clone(nextState.config));
      setIncidents(nextIncidents);
      setPromotions(nextPromotions);
      setHistory(nextHistory);
      setLogs(nextLogs);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Administration NeuraCo indisponible.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toolsText = useMemo(() => (
    Object.entries(draft?.tools || {})
      .map(([tool, credits]) => `${tool}=${credits}`)
      .join('\n')
  ), [draft?.tools]);

  const setConfig = (updater: (current: NeuraCoAdminConfig) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = clone(current);
      updater(next);
      return next;
    });
  };

  const saveConfiguration = async () => {
    if (!draft || !window.neuraco) return;
    if (reason.trim().length < 3) {
      setFeedback('Indiquez une raison précise avant d’enregistrer.');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const response = await window.neuraco.updateAdminConfig({
        expected_revision: draft.revision,
        reason: reason.trim(),
        version: draft.version,
        plans: draft.plans,
        models: draft.models,
        billing: draft.billing,
        providers: draft.providers,
        tools: draft.tools,
        plugins: draft.plugins,
        maintenance: draft.maintenance,
        release: draft.release
      });
      setDraft(clone(response.config));
      setState((current) => current ? { ...current, config: response.config } : current);
      setReason('');
      setHistory(await window.neuraco.getAdminPricingHistory());
      setLogs(await window.neuraco.listAdminLogs());
      setFeedback(`Configuration enregistrée, révision ${response.config.revision}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const searchUsers = async () => {
    if (!window.neuraco) return;
    setBusy(true);
    try {
      setUsers(await window.neuraco.listAdminUsers(userSearch));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Recherche impossible.');
    } finally {
      setBusy(false);
    }
  };

  const adjustCredits = async () => {
    if (!window.neuraco || !creditUserId || !creditReason.trim() || creditAmount === 0) return;
    setBusy(true);
    try {
      const result = await window.neuraco.adjustAdminCredits({
        user_id: creditUserId,
        amount: creditAmount,
        reason: creditReason.trim(),
        idempotency_key: requestKey()
      });
      setFeedback(`Solde mis à jour : ${result.entry.balance_after ?? 'confirmé'} crédits.`);
      setCreditAmount(0);
      setCreditReason('');
      setLogs(await window.neuraco.listAdminLogs());
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Ajustement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const recordRefund = async () => {
    if (!window.neuraco) return;
    setBusy(true);
    try {
      await window.neuraco.recordAdminRefund({
        payment_reference: refund.paymentReference.trim(),
        provider_refund_id: refund.providerRefundId.trim(),
        credits_to_remove: refund.credits,
        reason: refund.reason.trim()
      });
      setRefund({ paymentReference: '', providerRefundId: '', credits: 0, reason: '' });
      setFeedback('Remboursement externe enregistré et registre de crédits synchronisé.');
      setLogs(await window.neuraco.listAdminLogs());
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Remboursement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const createIncident = async () => {
    if (!window.neuraco) return;
    setBusy(true);
    try {
      await window.neuraco.createAdminIncident({
        ...incidentForm,
        status: 'investigating'
      });
      setIncidentForm({ title: '', message: '', severity: 'warning' });
      setIncidents(await window.neuraco.listAdminIncidents());
      setFeedback('Incident publié.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  const createPromotion = async () => {
    if (!window.neuraco) return;
    setBusy(true);
    try {
      await window.neuraco.createAdminPromotion({
        code: promotionForm.code.trim(),
        description: promotionForm.description.trim(),
        discount_percent: promotionForm.discount,
        plans: ['pro', 'neura_plus', 'neura_ultra']
      });
      setPromotionForm({ code: '', description: '', discount: 10 });
      setPromotions(await window.neuraco.listAdminPromotions());
      setFeedback('Promotion créée.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="workspace-loading">Chargement de l’administration…</div>;
  if (!draft || !state) {
    return <p className="account-feedback is-error" role="alert">{feedback || 'Accès refusé.'}</p>;
  }

  return (
    <div className="settings-page admin-page">
      <header className="settings-heading">
        <div>
          <h1>Administration NeuraCo</h1>
          <p>Configuration serveur, opérations et journal immuable. Rôle : {state.role}.</p>
        </div>
        <button className="button" type="button" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={16} /> Actualiser
        </button>
      </header>

      <nav className="admin-tabs" aria-label="Sections d’administration">
        <button className={tab === 'configuration' ? 'is-active' : ''} onClick={() => setTab('configuration')}>
          <ServerCog size={16} /> Configuration
        </button>
        <button className={tab === 'operations' ? 'is-active' : ''} onClick={() => setTab('operations')}>
          <Users size={16} /> Opérations
        </button>
        <button className={tab === 'audit' ? 'is-active' : ''} onClick={() => setTab('audit')}>
          <History size={16} /> Audit
        </button>
      </nav>

      <div className="admin-metrics" aria-label="Résumé administration">
        <span><strong>{state.counts.users}</strong> utilisateurs</span>
        <span><strong>{state.counts.active_incidents}</strong> incidents actifs</span>
        <span><strong>{state.counts.active_promotions}</strong> promotions actives</span>
        <span><strong>{draft.revision}</strong> révision</span>
      </div>

      {tab === 'configuration' && (
        <>
          <section className="settings-group">
            <h2>Maintenance et fournisseurs</h2>
            <div className="admin-form-grid">
              <label className="admin-check-row">
                <span><strong>Maintenance</strong><small>Bloque les nouvelles tâches avant toute consommation.</small></span>
                <input type="checkbox" checked={draft.maintenance.enabled} onChange={(event) => setConfig((next) => { next.maintenance.enabled = event.target.checked; })} />
              </label>
              <label className="admin-field admin-field-wide">
                <span>Message de maintenance</span>
                <input value={draft.maintenance.message} maxLength={500} onChange={(event) => setConfig((next) => { next.maintenance.message = event.target.value; })} />
              </label>
              {Object.entries(draft.providers).map(([provider, config]) => (
                <label className="admin-check-row" key={provider}>
                  <span><strong>{provider}</strong><small>Fournisseur disponible pour les nouvelles tâches.</small></span>
                  <input type="checkbox" checked={config.enabled} onChange={(event) => setConfig((next) => { next.providers[provider].enabled = event.target.checked; })} />
                </label>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <h2>Modèles et tarifs fournisseurs</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Modèle</th><th>Fournisseur</th><th>Entrée</th><th>Cache</th><th>Sortie</th><th>Désactivé</th></tr></thead>
                <tbody>{Object.entries(draft.models).map(([model, config]) => (
                  <tr key={model}>
                    <td><strong>{model}</strong></td><td>{config.provider}</td>
                    {(['input', 'cached_input', 'output'] as const).map((field) => (
                      <td key={field}><input type="number" min="0" step="0.01" value={config[field]} onChange={(event) => setConfig((next) => { next.models[model][field] = numberValue(event.target.value); })} /></td>
                    ))}
                    <td><input type="checkbox" checked={config.disabled} aria-label={`Désactiver ${model}`} onChange={(event) => setConfig((next) => { next.models[model].disabled = event.target.checked; })} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          <section className="settings-group">
            <h2>Plans et limites</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Plan</th><th>5 heures</th><th>7 jours</th><th>Mensuel</th><th>Finalisation</th></tr></thead>
                <tbody>{Object.entries(draft.plans).map(([plan, config]) => (
                  <tr key={plan}><td><strong>{config.label}</strong></td>
                    {(['five_hour', 'seven_day', 'monthly', 'finalization'] as const).map((field) => (
                      <td key={field}><input type="number" min="0" step="1" value={config[field]} onChange={(event) => setConfig((next) => { next.plans[plan][field] = numberValue(event.target.value); })} /></td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          <section className="settings-group">
            <h2>Conversion, marge, plugins et versions</h2>
            <div className="admin-form-grid">
              <label className="admin-field"><span>Crédits par USD</span><input type="number" min="0.01" step="0.01" value={draft.billing.credits_per_usd} onChange={(event) => setConfig((next) => { next.billing.credits_per_usd = numberValue(event.target.value, 1); })} /></label>
              <label className="admin-field"><span>Marge (%)</span><input type="number" min="0" step="0.1" value={draft.billing.margin_percent} onChange={(event) => setConfig((next) => { next.billing.margin_percent = numberValue(event.target.value); })} /></label>
              <label className="admin-check-row"><span><strong>Plugins locaux non signés</strong><small>Les plugins bloqués restent toujours refusés.</small></span><input type="checkbox" checked={draft.plugins.allow_unsigned_local} onChange={(event) => setConfig((next) => { next.plugins.allow_unsigned_local = event.target.checked; })} /></label>
              <label className="admin-field admin-field-wide"><span>Identifiants de plugins bloqués (un par ligne)</span><textarea value={draft.plugins.blocked_ids.join('\n')} onChange={(event) => setConfig((next) => { next.plugins.blocked_ids = event.target.value.split(/\r?\n/).map((value) => value.trim().toLowerCase()).filter(Boolean); })} /></label>
              <label className="admin-field"><span>Dernière version</span><input value={draft.release.latest_version} onChange={(event) => setConfig((next) => { next.release.latest_version = event.target.value; })} /></label>
              <label className="admin-field"><span>Version minimale</span><input value={draft.release.minimum_supported_version} onChange={(event) => setConfig((next) => { next.release.minimum_supported_version = event.target.value; })} /></label>
              <label className="admin-field"><span>Déploiement (%)</span><input type="number" min="0" max="100" value={draft.release.rollout_percent} onChange={(event) => setConfig((next) => { next.release.rollout_percent = numberValue(event.target.value); })} /></label>
              <label className="admin-field admin-field-wide"><span>Tarifs d’outils (outil=crédits)</span><textarea value={toolsText} onChange={(event) => setConfig((next) => { next.tools = Object.fromEntries(event.target.value.split(/\r?\n/).map((line) => line.split('=')).filter(([key, value]) => key?.trim() && Number.isFinite(Number(value))).map(([key, value]) => [key.trim(), Number(value)])); })} /></label>
              <label className="admin-field admin-field-wide"><span>Raison obligatoire</span><input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Pourquoi ce changement est nécessaire" /></label>
            </div>
            <button className="button button-primary" type="button" onClick={() => void saveConfiguration()} disabled={busy || reason.trim().length < 3}>
              <Save size={16} /> Enregistrer la configuration
            </button>
          </section>
        </>
      )}

      {tab === 'operations' && (
        <>
          <section className="settings-group">
            <h2>Utilisateurs et crédits</h2>
            <div className="admin-inline-form"><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="E-mail, nom ou identifiant" /><button className="button" onClick={() => void searchUsers()}><Search size={16} /> Rechercher</button></div>
            {users.length > 0 && <div className="admin-user-list">{users.map((entry) => <button key={entry.id} onClick={() => setCreditUserId(entry.id)} className={creditUserId === entry.id ? 'is-active' : ''}><strong>{entry.email}</strong><span>{entry.subscription || 'free'} · {entry.role || 'user'}</span></button>)}</div>}
            <div className="admin-form-grid">
              <label className="admin-field"><span>Utilisateur</span><input value={creditUserId} onChange={(event) => setCreditUserId(event.target.value)} /></label>
              <label className="admin-field"><span>Crédits (+ ou -)</span><input type="number" value={creditAmount} onChange={(event) => setCreditAmount(numberValue(event.target.value))} /></label>
              <label className="admin-field admin-field-wide"><span>Motif</span><input value={creditReason} onChange={(event) => setCreditReason(event.target.value)} /></label>
            </div>
            <button className="button button-primary" disabled={busy || !creditUserId || !creditReason.trim() || creditAmount === 0} onClick={() => void adjustCredits()}><ReceiptText size={16} /> Ajuster les crédits</button>
          </section>

          <section className="settings-group">
            <h2>Incidents</h2>
            <div className="admin-form-grid"><label className="admin-field"><span>Titre</span><input value={incidentForm.title} onChange={(event) => setIncidentForm((current) => ({ ...current, title: event.target.value }))} /></label><label className="admin-field"><span>Sévérité</span><select value={incidentForm.severity} onChange={(event) => setIncidentForm((current) => ({ ...current, severity: event.target.value as NeuraCoAdminIncident['severity'] }))}><option value="info">Info</option><option value="warning">Avertissement</option><option value="critical">Critique</option></select></label><label className="admin-field admin-field-wide"><span>Message</span><textarea value={incidentForm.message} onChange={(event) => setIncidentForm((current) => ({ ...current, message: event.target.value }))} /></label></div>
            <button className="button" disabled={busy || incidentForm.title.length < 3 || incidentForm.message.length < 3} onClick={() => void createIncident()}><CircleAlert size={16} /> Publier l’incident</button>
            <div className="admin-record-list">{incidents.map((incident) => <article key={incident.id}><div><strong>{incident.title}</strong><p>{incident.message}</p></div><select value={incident.status} onChange={async (event) => { await window.neuraco!.updateAdminIncident(incident.id, { status: event.target.value as NeuraCoAdminIncident['status'] }); setIncidents(await window.neuraco!.listAdminIncidents()); }}><option value="investigating">Investigation</option><option value="identified">Identifié</option><option value="monitoring">Surveillance</option><option value="resolved">Résolu</option></select></article>)}</div>
          </section>

          <section className="settings-group">
            <h2>Promotions</h2>
            <div className="admin-form-grid"><label className="admin-field"><span>Code</span><input value={promotionForm.code} onChange={(event) => setPromotionForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} /></label><label className="admin-field"><span>Réduction (%)</span><input type="number" min="1" max="100" value={promotionForm.discount} onChange={(event) => setPromotionForm((current) => ({ ...current, discount: numberValue(event.target.value, 1) }))} /></label><label className="admin-field admin-field-wide"><span>Description</span><input value={promotionForm.description} onChange={(event) => setPromotionForm((current) => ({ ...current, description: event.target.value }))} /></label></div>
            <button className="button" disabled={busy || promotionForm.code.length < 3 || promotionForm.description.length < 3} onClick={() => void createPromotion()}><BadgePercent size={16} /> Créer la promotion</button>
            <div className="admin-record-list">{promotions.map((promotion) => <article key={promotion.id}><div><strong>{promotion.code} · {promotion.discount_percent}%</strong><p>{promotion.description}</p></div><button className="button" onClick={async () => { await window.neuraco!.updateAdminPromotion(promotion.id, !promotion.active); setPromotions(await window.neuraco!.listAdminPromotions()); }}>{promotion.active ? 'Désactiver' : 'Activer'}</button></article>)}</div>
          </section>

          <section className="settings-group">
            <h2>Remboursement déjà exécuté chez le fournisseur</h2>
            <p>Cette action ne déclenche aucun paiement. Elle enregistre l’identifiant du remboursement externe et synchronise uniquement les crédits disponibles.</p>
            <div className="admin-form-grid"><label className="admin-field"><span>Référence du paiement</span><input value={refund.paymentReference} onChange={(event) => setRefund((current) => ({ ...current, paymentReference: event.target.value }))} /></label><label className="admin-field"><span>ID remboursement fournisseur</span><input value={refund.providerRefundId} onChange={(event) => setRefund((current) => ({ ...current, providerRefundId: event.target.value }))} /></label><label className="admin-field"><span>Crédits à retirer</span><input type="number" min="0" value={refund.credits} onChange={(event) => setRefund((current) => ({ ...current, credits: numberValue(event.target.value) }))} /></label><label className="admin-field"><span>Motif</span><input value={refund.reason} onChange={(event) => setRefund((current) => ({ ...current, reason: event.target.value }))} /></label></div>
            <button className="button" disabled={busy || refund.paymentReference.length < 3 || refund.providerRefundId.length < 3 || refund.reason.length < 3} onClick={() => void recordRefund()}><ReceiptText size={16} /> Enregistrer</button>
          </section>
        </>
      )}

      {tab === 'audit' && (
        <>
          <section className="settings-group"><h2>Historique tarifaire immuable</h2><div className="admin-record-list">{history.map((entry) => <article key={entry.id}><div><strong>Révision {entry.revision} · {entry.status}</strong><p>{entry.reason}</p></div><time>{new Date(entry.created_at).toLocaleString()}</time></article>)}</div></section>
          <section className="settings-group"><h2>Journal d’administration</h2><div className="admin-record-list">{logs.map((entry) => <article key={entry.id}><div><strong>{entry.action}</strong><p>{entry.actor_email || 'serveur'} {entry.target_user_id ? `→ ${entry.target_user_id}` : ''}</p></div><time>{new Date(entry.created_at).toLocaleString()}</time></article>)}</div></section>
        </>
      )}

      {feedback && <p className={feedback.toLowerCase().includes('impossible') || feedback.toLowerCase().includes('refus') ? 'account-feedback is-error' : 'account-feedback'} role="status">{feedback}</p>}
    </div>
  );
};

export default AdminPanel;
