import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  Calculator,
  CheckCircle2,
  Download,
  ExternalLink,
  FileDown,
  FileCheck2,
  Gauge,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  WalletCards
} from 'lucide-react';
import type {
  NeuraCoActivityEntry,
  NeuraCoTaskReport,
  NeuraCoUpdateManifest,
  NeuraCoUpdatePreferences,
  NeuraCoUpdateRollback,
  NeuraCoUpdateState,
  NeuraCoUsageEstimate,
  NeuraCoUsageEstimateRequest,
  NeuraCoUsageSummary
} from '../electron/ipc-contract';

interface UsagePanelProps {
  onStatus: (message: string | null) => void;
}

const formatCredits = (value: number): string => (
  new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: 2
  }).format(value)
);

const formatDate = (value?: string | null): string => {
  if (!value) return 'Non planifié';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date indisponible';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

const windowLabel = {
  five_hour: 'Fenêtre 5 heures',
  seven_day: 'Fenêtre 7 jours',
  monthly: 'Période de facturation'
} as const;

const defaultEstimate: NeuraCoUsageEstimateRequest = {
  mode: 'balanced',
  model: 'claude-sonnet-4-5',
  promptCharacters: 4000,
  maxOutputTokens: 4096,
  agents: 1,
  imageCount: 0
};

export default function UsagePanel({ onStatus }: UsagePanelProps) {
  const [summary, setSummary] = useState<NeuraCoUsageSummary | null>(null);
  const [activity, setActivity] = useState<NeuraCoActivityEntry[]>([]);
  const [report, setReport] = useState<NeuraCoTaskReport | null>(null);
  const [estimateRequest, setEstimateRequest] = useState(defaultEstimate);
  const [estimate, setEstimate] = useState<NeuraCoUsageEstimate | null>(null);
  const [customAmount, setCustomAmount] = useState(20);
  const [busy, setBusy] = useState<string | null>(null);
  const [updateManifest, setUpdateManifest] = useState<NeuraCoUpdateManifest | null>(null);
  const [updateState, setUpdateState] = useState<NeuraCoUpdateState | null>(null);
  const [updatePreferences, setUpdatePreferences] = useState<NeuraCoUpdatePreferences | null>(null);
  const [updateRollback, setUpdateRollback] = useState<NeuraCoUpdateRollback | null>(null);
  const [settings, setSettings] = useState({
    allowPurchasedCredits: false,
    taskCap: '',
    dailyCap: '',
    monthlyCap: '',
    agentCap: '',
    maxAgents: '',
    maxModel: '',
    autoReloadEnabled: false
  });

  const syncSettings = (value: NeuraCoUsageSummary) => {
    setSettings({
      allowPurchasedCredits: value.settings.allow_purchased_credits,
      taskCap: value.settings.task_cap == null ? '' : String(value.settings.task_cap),
      dailyCap: value.settings.daily_cap == null ? '' : String(value.settings.daily_cap),
      monthlyCap: value.settings.monthly_cap == null ? '' : String(value.settings.monthly_cap),
      agentCap: value.settings.agent_cap == null ? '' : String(value.settings.agent_cap),
      maxAgents: value.settings.max_agents == null ? '' : String(value.settings.max_agents),
      maxModel: value.settings.max_model || '',
      autoReloadEnabled: value.settings.auto_reload_enabled
    });
  };

  const load = async () => {
    if (!window.neuraco) return;
    setBusy('load');
    try {
      const [usage, entries] = await Promise.all([
        window.neuraco.getUsage(),
        window.neuraco.listActivity(250)
      ]);
      setSummary(usage);
      syncSettings(usage);
      setActivity(entries.slice().reverse());
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Utilisation indisponible.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void load();
    void window.neuraco?.getUpdatePreferences().then(setUpdatePreferences).catch(() => undefined);
    void window.neuraco?.getUpdateRollback().then(setUpdateRollback).catch(() => undefined);
    const unsubscribeUsage = window.neuraco?.onUsageEvent((value) => {
      setSummary(value);
      syncSettings(value);
    });
    const unsubscribeUpdate = window.neuraco?.onUpdateEvent(setUpdateState);
    return () => {
      unsubscribeUsage?.();
      unsubscribeUpdate?.();
    };
  }, []);

  const windows = useMemo(() => (
    summary
      ? (Object.keys(windowLabel) as Array<keyof typeof windowLabel>).map((key) => ({
          key,
          label: windowLabel[key],
          value: summary.windows[key]
        }))
      : []
  ), [summary]);

  const saveSettings = async () => {
    if (!window.neuraco) return;
    setBusy('settings');
    try {
      const numberOrNull = (value: string) => (
        value.trim() === '' ? null : Number(value)
      );
      const updated = await window.neuraco.updateUsageSettings({
        allowPurchasedCredits: settings.allowPurchasedCredits,
        taskCap: numberOrNull(settings.taskCap),
        dailyCap: numberOrNull(settings.dailyCap),
        monthlyCap: numberOrNull(settings.monthlyCap),
        agentCap: numberOrNull(settings.agentCap),
        maxAgents: numberOrNull(settings.maxAgents),
        maxModel: settings.maxModel
          ? settings.maxModel as 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash'
          : null,
        autoReloadEnabled: settings.autoReloadEnabled
      });
      setSummary(updated);
      syncSettings(updated);
      onStatus('Limites d’utilisation enregistrées par le serveur.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setBusy(null);
    }
  };

  const calculate = async () => {
    if (!window.neuraco) return;
    setBusy('estimate');
    try {
      setEstimate(await window.neuraco.estimateUsage(estimateRequest));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Estimation impossible.');
    } finally {
      setBusy(null);
    }
  };

  const buyCredits = async (amount: number) => {
    if (!window.neuraco) return;
    setBusy('checkout');
    try {
      const checkout = await window.neuraco.createCreditCheckout(amount);
      onStatus(
        `Paiement Stripe ouvert : ${checkout.credits} crédits pour `
        + `${checkout.amount_eur.toFixed(2)} €.`
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Paiement non créé.');
    } finally {
      setBusy(null);
    }
  };

  const buildReport = async () => {
    if (!window.neuraco) return;
    setBusy('report');
    try {
      setReport(await window.neuraco.buildTaskReport());
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Rapport indisponible.');
    } finally {
      setBusy(null);
    }
  };

  const exportReport = async () => {
    if (!window.neuraco) return;
    setBusy('export');
    try {
      const target = await window.neuraco.exportTaskReport();
      if (target) onStatus(`Rapport exporté : ${target}`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Export impossible.');
    } finally {
      setBusy(null);
    }
  };

  const openEvidence = async (evidenceId: string) => {
    if (!window.neuraco) return;
    setBusy(`evidence:${evidenceId}`);
    try {
      await window.neuraco.openEvidence(evidenceId);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Preuve indisponible.');
    } finally {
      setBusy(null);
    }
  };

  const checkUpdate = async () => {
    if (!window.neuraco) return;
    setBusy('update');
    try {
      const manifest = await window.neuraco.checkForUpdates();
      setUpdateManifest(manifest);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Vérification impossible.');
    } finally {
      setBusy(null);
    }
  };

  const downloadUpdate = async () => {
    if (!window.neuraco) return;
    setBusy('download');
    try {
      setUpdateState(await window.neuraco.downloadUpdate());
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Téléchargement impossible.');
    } finally {
      setBusy(null);
    }
  };

  const saveUpdatePreferences = async (
    update: Partial<NeuraCoUpdatePreferences>
  ) => {
    if (!window.neuraco) return;
    setBusy('update-preferences');
    try {
      setUpdatePreferences(await window.neuraco.updateUpdatePreferences(update));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Préférences de mise à jour indisponibles.');
    } finally {
      setBusy(null);
    }
  };

  const rollbackUpdate = async () => {
    if (!window.neuraco || !updateRollback?.available) return;
    setBusy('rollback');
    try {
      setUpdateState(await window.neuraco.rollbackUpdate());
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Retour à la version précédente impossible.');
    } finally {
      setBusy(null);
    }
  };

  if (!summary && busy === 'load') {
    return (
      <div className="usage-loading">
        <LoaderCircle size={22} />
        Chargement des limites serveur…
      </div>
    );
  }

  return (
    <div className="usage-panel">
      <header className="usage-header">
        <div>
          <Gauge size={19} />
          <div>
            <h2>Utilisation et contrôle</h2>
            <p>Compteurs, dépenses, rapports et mises à jour vérifiés par le serveur.</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={Boolean(busy)}>
          <RefreshCw size={15} />
          Actualiser
        </button>
      </header>

      {summary && (
        <>
          <section className="usage-plan-strip">
            <div>
              <strong>{summary.plan.label}</strong>
              <span>{summary.plan.multiplier}× de capacité</span>
            </div>
            <div>
              <strong>{formatCredits(summary.purchased.available)} crédits</strong>
              <span>achetés disponibles</span>
            </div>
            <div>
              <strong>{formatDate(summary.billing_period.renews_at)}</strong>
              <span>prochain renouvellement</span>
            </div>
            <div>
              <strong>{formatDate(summary.next_recovery_at)}</strong>
              <span>prochaine récupération</span>
            </div>
          </section>

          <section className="usage-windows">
            {windows.map(({ key, label, value }) => (
              <article key={key}>
                <header>
                  <span>{label}</span>
                  <strong>{formatCredits(value.remaining)} restants</strong>
                </header>
                <div className="usage-meter" aria-label={`${label} ${value.remaining_percent}%`}>
                  <i style={{ width: `${Math.max(0, Math.min(100, value.remaining_percent))}%` }} />
                </div>
                <footer>
                  <span>{formatCredits(value.used)} utilisés</span>
                  <span>{formatCredits(value.reserved)} réservés</span>
                  <span>{formatCredits(value.limit)} au total</span>
                </footer>
              </article>
            ))}
          </section>
        </>
      )}

      <div className="usage-columns">
        <section className="usage-section">
          <header>
            <ShieldCheck size={17} />
            <div>
              <h3>Autorisation et plafonds</h3>
              <p>Les crédits achetés ne sont consommés qu’après autorisation explicite.</p>
            </div>
          </header>
          <label className="usage-toggle">
            <span>
              <strong>Autoriser les crédits achetés</strong>
              <small>Complète les crédits inclus lorsqu’ils sont insuffisants.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.allowPurchasedCredits}
              onChange={(event) => setSettings((current) => ({
                ...current,
                allowPurchasedCredits: event.target.checked
              }))}
            />
          </label>
          <div className="usage-cap-grid">
            <label>
              <span>Maximum par tâche</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.taskCap}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  taskCap: event.target.value
                }))}
                placeholder="Aucun"
              />
            </label>
            <label>
              <span>Maximum journalier</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.dailyCap}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  dailyCap: event.target.value
                }))}
                placeholder="Aucun"
              />
            </label>
            <label>
              <span>Maximum période</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.monthlyCap}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  monthlyCap: event.target.value
                }))}
                placeholder="Aucun"
              />
            </label>
            <label>
              <span>Maximum par agent</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.agentCap}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  agentCap: event.target.value
                }))}
                placeholder="Aucun"
              />
            </label>
            <label>
              <span>Agents actifs maximum</span>
              <input
                type="number"
                min="1"
                max="16"
                step="1"
                value={settings.maxAgents}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  maxAgents: event.target.value
                }))}
                placeholder="Aucun"
              />
            </label>
            <label>
              <span>Modèle maximal</span>
              <select
                value={settings.maxModel}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  maxModel: event.target.value
                }))}
              >
                <option value="">Aucune limite</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
              </select>
            </label>
          </div>
          <label className="usage-toggle is-disabled">
            <span>
              <strong>Recharge automatique</strong>
              <small>
                {summary?.settings.auto_reload_available
                  ? 'Disponible avec un moyen de paiement serveur.'
                  : 'Désactivée : aucun mandat de paiement serveur n’est configuré.'}
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.autoReloadEnabled}
              disabled={!summary?.settings.auto_reload_available}
              onChange={(event) => setSettings((current) => ({
                ...current,
                autoReloadEnabled: event.target.checked
              }))}
            />
          </label>
          <button
            type="button"
            className="usage-primary"
            disabled={busy === 'settings'}
            onClick={() => void saveSettings()}
          >
            <Save size={15} />
            Enregistrer
          </button>
        </section>

        <section className="usage-section">
          <header>
            <WalletCards size={17} />
            <div>
              <h3>Crédits supplémentaires</h3>
              <p>Paiement unique hébergé par Stripe. Pas d’abonnement ajouté.</p>
            </div>
          </header>
          <div className="usage-packs">
            {[20, 40, 80].map((amount) => (
              <button
                type="button"
                key={amount}
                disabled={busy === 'checkout'}
                onClick={() => void buyCredits(amount)}
              >
                <strong>{amount} €</strong>
                <span>{amount * 25} crédits</span>
              </button>
            ))}
          </div>
          <div className="usage-custom-pack">
            <label>
              <span>Montant personnalisé</span>
              <input
                type="number"
                min="5"
                max="200"
                step="1"
                value={customAmount}
                onChange={(event) => setCustomAmount(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              disabled={busy === 'checkout'}
              onClick={() => void buyCredits(customAmount)}
            >
              Continuer
            </button>
          </div>
          <small className="usage-secure-note">
            <ShieldCheck size={13} />
            La clé Stripe reste côté serveur. NeuraCo ouvre uniquement l’URL de paiement vérifiée.
          </small>
        </section>
      </div>

      <div className="usage-columns">
        <section className="usage-section">
          <header>
            <Calculator size={17} />
            <div>
              <h3>Estimation avant tâche</h3>
              <p>Fourchette serveur. La facturation finale utilise les jetons réellement retournés.</p>
            </div>
          </header>
          <div className="usage-estimator-grid">
            <label>
              <span>Modèle</span>
              <select
                value={estimateRequest.model}
                onChange={(event) => setEstimateRequest((current) => ({
                  ...current,
                  model: event.target.value as NeuraCoUsageEstimateRequest['model']
                }))}
              >
                <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </select>
            </label>
            <label>
              <span>Mode</span>
              <select
                value={estimateRequest.mode}
                onChange={(event) => setEstimateRequest((current) => ({
                  ...current,
                  mode: event.target.value as NeuraCoUsageEstimateRequest['mode']
                }))}
              >
                <option value="economic">Économique</option>
                <option value="balanced">Équilibré</option>
                <option value="quality">Qualité</option>
                <option value="custom">Personnalisé</option>
              </select>
            </label>
            <label>
              <span>Agents</span>
              <input
                type="number"
                min="1"
                max="8"
                value={estimateRequest.agents}
                onChange={(event) => setEstimateRequest((current) => ({
                  ...current,
                  agents: Number(event.target.value)
                }))}
              />
            </label>
            <label>
              <span>Sortie maximale</span>
              <input
                type="number"
                min="256"
                max="32768"
                step="256"
                value={estimateRequest.maxOutputTokens}
                onChange={(event) => setEstimateRequest((current) => ({
                  ...current,
                  maxOutputTokens: Number(event.target.value)
                }))}
              />
            </label>
          </div>
          <button
            type="button"
            className="usage-primary"
            disabled={busy === 'estimate'}
            onClick={() => void calculate()}
          >
            <Calculator size={15} />
            Calculer
          </button>
          {estimate && (
            <div className="usage-estimate-result">
              <strong>
                {formatCredits(estimate.minimum_credits)} à{' '}
                {formatCredits(estimate.maximum_credits)} crédits
              </strong>
              <span>{estimate.provider} · {estimate.model} · {estimate.environment}</span>
              {!estimate.can_start_with_included && (
                <small>
                  {formatCredits(estimate.purchased_credits_required)} crédits achetés requis.
                </small>
              )}
            </div>
          )}
        </section>

        <section className="usage-section">
          <header>
            <Activity size={17} />
            <div>
              <h3>Rapport de travail</h3>
              <p>Actions, fichiers, applications, tests, erreurs et crédits.</p>
            </div>
          </header>
          <div className="usage-report-actions">
            <button type="button" onClick={() => void buildReport()} disabled={busy === 'report'}>
              <Activity size={15} />
              Générer
            </button>
            <button type="button" onClick={() => void exportReport()} disabled={busy === 'export'}>
              <FileDown size={15} />
              Exporter
            </button>
          </div>
          {report && (
            <>
              <dl className="usage-report-summary">
                <div><dt>Durée</dt><dd>{report.durationMs} ms</dd></div>
                <div><dt>Agents</dt><dd>{report.agents.length}</dd></div>
                <div><dt>Fichiers</dt><dd>{report.filesModified.length + report.filesCreated.length}</dd></div>
                <div><dt>Tests</dt><dd>{report.tests.length}</dd></div>
                <div><dt>Preuves</dt><dd>{report.evidence.length}</dd></div>
                <div><dt>Erreurs</dt><dd>{report.errors.length}</dd></div>
                <div><dt>Crédits</dt><dd>{formatCredits(report.creditsConsumed)}</dd></div>
                <div>
                  <dt>Journal</dt>
                  <dd>
                    {report.integrity
                      ? report.integrity.verified
                        ? 'Vérifié'
                        : 'Altéré'
                      : 'Hérité'}
                  </dd>
                </div>
              </dl>
              <div className="usage-evidence">
                <header>
                  <FileCheck2 size={14} />
                  <span>
                    <strong>Preuves machine</strong>
                    <small>Une affirmation de l’agent seule n’est jamais validée.</small>
                  </span>
                </header>
                {report.evidence.map((evidence) => (
                  <details key={evidence.id} className={`is-${evidence.status}`}>
                    <summary>
                      <span>
                        <strong>{evidence.title}</strong>
                        <small>{evidence.kind} · {evidence.status}</small>
                      </span>
                      {evidence.filePath && (
                        <button
                          type="button"
                          title="Afficher le fichier de preuve"
                          disabled={busy === `evidence:${evidence.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            void openEvidence(evidence.id);
                          }}
                        >
                          <ExternalLink size={13} />
                        </button>
                      )}
                    </summary>
                    <p>{evidence.summary}</p>
                    {evidence.command && <code>{evidence.command}</code>}
                    {evidence.url && <small>{evidence.url}</small>}
                    {evidence.filePath && <small>{evidence.filePath}</small>}
                    {evidence.output && <pre>{evidence.output}</pre>}
                  </details>
                ))}
                {report.evidence.length === 0 && (
                  <p>Aucune preuve machine enregistrée dans ce rapport.</p>
                )}
              </div>
            </>
          )}
          <div className="usage-activity">
            {activity.slice(0, 8).map((entry) => (
              <div key={entry.id}>
                <i className={`is-${entry.status}`} />
                <span>
                  <strong>{entry.summary}</strong>
                  <small>{formatDate(entry.timestamp)} · {entry.category}</small>
                </span>
              </div>
            ))}
            {activity.length === 0 && <p>Aucune activité locale enregistrée.</p>}
          </div>
        </section>
      </div>

      {summary && (
        <section className="usage-section usage-ledger">
          <header>
            <WalletCards size={17} />
            <div>
              <h3>Registre de consommation</h3>
              <p>
                Débits réglés, achats et remboursements issus du registre serveur
                immuable.
              </p>
            </div>
          </header>
          <div className="usage-ledger-list">
            {summary.recent.map((entry, index) => (
              <div key={`${entry.created_at}-${entry.task_id || entry.type}-${index}`}>
                <span>
                  <strong>
                    {entry.type === 'consumption'
                      ? `${entry.provider || 'IA'} · ${entry.model || 'modèle inconnu'}`
                      : entry.type}
                  </strong>
                  <small>
                    {formatDate(entry.created_at)}
                    {entry.agent ? ` · ${entry.agent}` : ''}
                    {entry.pricing_version ? ` · tarif ${entry.pricing_version}` : ''}
                  </small>
                </span>
                <span>
                  <strong>
                    {entry.credits_consumed
                      ? `−${formatCredits(entry.credits_consumed)}`
                      : `+${formatCredits(entry.credits_added || 0)}`}
                  </strong>
                  {entry.credit_breakdown && (
                    <small>
                      IA {formatCredits(entry.credit_breakdown.ai)}
                      {' · '}infrastructure {formatCredits(entry.credit_breakdown.infrastructure)}
                      {' · '}outils {formatCredits(entry.credit_breakdown.tools)}
                    </small>
                  )}
                </span>
              </div>
            ))}
            {summary.recent.length === 0 && (
              <p>Aucune opération comptable enregistrée.</p>
            )}
          </div>
        </section>
      )}

      <section className="usage-section usage-update">
        <header>
          <ArrowDownToLine size={17} />
          <div>
            <h3>Mises à jour sécurisées</h3>
            <p>Manifestes serveur, SHA-256 et signature Windows obligatoires avant installation.</p>
          </div>
        </header>
        {updatePreferences && (
          <div className="usage-update-options">
            <label>
              <span>Canal</span>
              <select
                value={updatePreferences.channel}
                disabled={busy === 'update-preferences'}
                onChange={(event) => void saveUpdatePreferences({
                  channel: event.target.value as NeuraCoUpdatePreferences['channel']
                })}
              >
                <option value="stable">Stable</option>
                <option value="beta">Bêta</option>
              </select>
            </label>
            <label className="usage-update-toggle">
              <input
                type="checkbox"
                checked={updatePreferences.autoCheck}
                disabled={busy === 'update-preferences'}
                onChange={(event) => void saveUpdatePreferences({ autoCheck: event.target.checked })}
              />
              Vérifier automatiquement
            </label>
            <label className="usage-update-toggle">
              <input
                type="checkbox"
                checked={updatePreferences.autoDownload}
                disabled={busy === 'update-preferences'}
                onChange={(event) => void saveUpdatePreferences({ autoDownload: event.target.checked })}
              />
              Télécharger automatiquement
            </label>
            <label>
              <span>Intervalle</span>
              <select
                value={updatePreferences.checkIntervalHours}
                disabled={busy === 'update-preferences'}
                onChange={(event) => void saveUpdatePreferences({
                  checkIntervalHours: Number(event.target.value)
                })}
              >
                {[1, 3, 6, 12, 24, 48].map((hours) => (
                  <option key={hours} value={hours}>{hours} h</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="usage-update-row">
          <button type="button" onClick={() => void checkUpdate()} disabled={busy === 'update'}>
            <RefreshCw size={15} />
            Vérifier
          </button>
          {updateManifest?.available && (
            <button
              type="button"
              onClick={() => void downloadUpdate()}
              disabled={busy === 'download'}
            >
              <Download size={15} />
              Télécharger {updateManifest.latest_version}
            </button>
          )}
          {updateState?.phase === 'ready' && (
            <button
              type="button"
              className="usage-primary"
              onClick={() => void window.neuraco?.installUpdate()}
            >
              <CheckCircle2 size={15} />
              Installer
            </button>
          )}
          {updateRollback?.available && (
            <button
              type="button"
              onClick={() => void rollbackUpdate()}
              disabled={busy === 'rollback'}
            >
              <RotateCcw size={15} />
              Restaurer {updateRollback.version}
            </button>
          )}
          <span>
            {updateState?.message
              || (updateManifest
                ? updateManifest.available
                  ? `Version ${updateManifest.latest_version} disponible`
                  : 'Version actuelle vérifiée'
                : 'Aucune vérification récente')}
          </span>
          {updateState?.phase === 'downloading' && (
            <div className="usage-update-progress">
              <i style={{ width: `${updateState.progress}%` }} />
            </div>
          )}
        </div>
        {updateManifest?.notes && updateManifest.notes.length > 0 && (
          <div className="usage-update-notes">
            <strong>Notes de la version {updateManifest.latest_version}</strong>
            <ul>{updateManifest.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          </div>
        )}
      </section>
    </div>
  );
}
