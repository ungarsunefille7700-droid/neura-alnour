import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FlaskConical,
  LockKeyhole,
  Save,
  ShieldAlert,
  Trash2,
  Unplug
} from 'lucide-react';
import type {
  NeuraCoHook,
  NeuraCoHookAction,
  NeuraCoHookEvent,
  NeuraCoHookInput,
  NeuraCoHooksState
} from '../electron/ipc-contract';

interface HooksPanelProps {
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
}

const EVENT_LABELS: Record<NeuraCoHookEvent, string> = {
  before_instruction: 'Avant une instruction',
  before_tool: 'Avant un outil',
  after_tool: 'Après un outil',
  before_command: 'Avant une commande',
  after_command: 'Après une commande',
  before_modification: 'Avant une modification',
  after_modification: 'Après une modification',
  before_merge: 'Avant une fusion',
  task_completed: 'Fin de tâche',
  on_error: 'En cas d’erreur'
};

const ACTION_LABELS: Record<NeuraCoHookAction, string> = {
  log: 'Journaliser',
  block_pattern: 'Bloquer un motif',
  command: 'Exécuter une commande',
  approval: 'Demander une approbation',
  notification: 'Envoyer une notification'
};

const initialDraft = (): NeuraCoHookInput => ({
  name: '',
  event: 'before_command',
  action: 'log',
  pattern: '',
  command: '',
  args: [],
  timeoutMs: 30_000,
  failureMode: 'block'
});

export default function HooksPanel({
  emergencyStopped,
  onStatus
}: HooksPanelProps) {
  const [state, setState] = useState<NeuraCoHooksState>();
  const [draft, setDraft] = useState<NeuraCoHookInput>(initialDraft);
  const [argsText, setArgsText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!window.neuraco) return;
    setBusy(true);
    try {
      setState(await window.neuraco.getHooksState());
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Chargement des hooks impossible.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const mutate = async (
    operation: () => Promise<NeuraCoHooksState>,
    message: string
  ) => {
    setBusy(true);
    try {
      setState(await operation());
      onStatus(message);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Opération de hook impossible.');
    } finally {
      setBusy(false);
    }
  };

  const edit = (hook: NeuraCoHook) => {
    if (hook.immutable) return;
    setDraft({
      id: hook.id,
      name: hook.name,
      event: hook.event,
      action: hook.action,
      pattern: hook.pattern || '',
      command: hook.command || '',
      args: hook.args || [],
      timeoutMs: hook.timeoutMs || 30_000,
      failureMode: hook.failureMode || 'block'
    });
    setArgsText((hook.args || []).join(', '));
  };

  const save = () => {
    const input = {
      ...draft,
      args: argsText.split(',').map((entry) => entry.trim()).filter(Boolean)
    };
    void mutate(
      () => window.neuraco!.saveHook(input),
      draft.id ? 'Hook mis à jour.' : 'Hook créé, désactivé par défaut.'
    ).then(() => {
      setDraft(initialDraft());
      setArgsText('');
    });
  };

  if (!state) {
    return <div className="hooks-view"><div className="hooks-loading">Chargement des hooks…</div></div>;
  }

  const disabled = busy || emergencyStopped;

  return (
    <div className="hooks-view">
      <header className="hooks-toolbar">
        <div>
          <ShieldAlert size={18} />
          <div>
            <strong>Hooks</strong>
            <span>
              {state.securityHookCount} protection(s) obligatoire(s) ·{' '}
              {state.activeCustomHookCount} hook(s) personnalisé(s) actif(s)
            </span>
          </div>
        </div>
      </header>

      <div className="hooks-safety-note">
        <LockKeyhole size={15} />
        <span>
          Les hooks de sécurité sont exécutés avant les hooks personnalisés.
          Ils ne peuvent être ni désactivés, ni supprimés, ni ignorés par un agent.
        </span>
      </div>

      <section className="hooks-section">
        <header>
          <h2>{draft.id ? 'Modifier le hook' : 'Nouveau hook'}</h2>
          <span>Les commandes sont lancées sans shell et sans variables sensibles.</span>
        </header>
        <div className="hook-editor">
          <input
            aria-label="Nom du hook"
            value={draft.name}
            placeholder="Nom du hook"
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <select
            aria-label="Événement du hook"
            value={draft.event}
            disabled={disabled}
            onChange={(event) => setDraft({
              ...draft,
              event: event.target.value as NeuraCoHookEvent
            })}
          >
            {Object.entries(EVENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="Action du hook"
            value={draft.action}
            disabled={disabled}
            onChange={(event) => setDraft({
              ...draft,
              action: event.target.value as NeuraCoHookAction
            })}
          >
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {draft.action === 'block_pattern' && (
            <input
              aria-label="Motif bloqué"
              value={draft.pattern || ''}
              placeholder="Expression régulière interdite"
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
            />
          )}
          {draft.action === 'command' && (
            <>
              <input
                aria-label="Commande du hook"
                value={draft.command || ''}
                placeholder="Exécutable"
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, command: event.target.value })}
              />
              <input
                aria-label="Arguments du hook"
                value={argsText}
                placeholder="Arguments séparés par des virgules"
                disabled={disabled}
                onChange={(event) => setArgsText(event.target.value)}
              />
              <input
                aria-label="Délai du hook"
                type="number"
                min={1000}
                max={120000}
                step={1000}
                value={draft.timeoutMs}
                disabled={disabled}
                onChange={(event) => setDraft({
                  ...draft,
                  timeoutMs: Number(event.target.value)
                })}
              />
            </>
          )}
          <select
            aria-label="Politique d’échec du hook"
            value={draft.failureMode}
            disabled={disabled}
            onChange={(event) => setDraft({
              ...draft,
              failureMode: event.target.value as 'block' | 'warn'
            })}
          >
            <option value="block">Bloquer en cas d’échec</option>
            <option value="warn">Avertir sans bloquer</option>
          </select>
          <button
            type="button"
            disabled={disabled || draft.name.trim().length < 3}
            onClick={save}
          >
            <Save size={14} />
            {draft.id ? 'Enregistrer' : 'Créer'}
          </button>
          {draft.id && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setDraft(initialDraft());
                setArgsText('');
              }}
            >
              Annuler
            </button>
          )}
        </div>
      </section>

      <section className="hooks-section">
        <header>
          <h2>Hooks configurés</h2>
          <span>{state.hooks.length} hook(s), protections système incluses.</span>
        </header>
        <div className="hooks-list">
          {state.hooks.map((hook) => (
            <article key={hook.id} className={`hook-entry ${hook.enabled ? 'is-enabled' : ''}`}>
              <header>
                <div>
                  {hook.security ? <LockKeyhole size={15} /> : <Unplug size={15} />}
                  <div>
                    <strong>{hook.name}</strong>
                    <span>{EVENT_LABELS[hook.event]} · {ACTION_LABELS[hook.action]}</span>
                  </div>
                </div>
                <span className={hook.security ? 'hook-security' : 'hook-custom'}>
                  {hook.security ? 'Obligatoire' : hook.enabled ? 'Actif' : 'Inactif'}
                </span>
              </header>
              {hook.pattern && <code>{hook.pattern}</code>}
              {hook.command && (
                <code>{hook.command} {(hook.args || []).join(' ')}</code>
              )}
              <footer>
                {hook.immutable ? (
                  <span><CheckCircle2 size={13} /> Non modifiable</span>
                ) : (
                  <>
                    <button type="button" disabled={disabled} onClick={() => edit(hook)}>
                      Modifier
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void mutate(
                        () => window.neuraco!.setHookEnabled(hook.id, !hook.enabled),
                        hook.enabled ? 'Hook désactivé.' : 'Hook activé.'
                      )}
                    >
                      {hook.enabled ? 'Désactiver' : 'Activer'}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setBusy(true);
                        void window.neuraco!.testHook(hook.id)
                          .then((run) => {
                            onStatus(`${run.hookName} : ${run.summary}`);
                            return load();
                          })
                          .catch((error) => onStatus(
                            error instanceof Error ? error.message : 'Test du hook impossible.'
                          ))
                          .finally(() => setBusy(false));
                      }}
                    >
                      <FlaskConical size={13} />
                      Tester
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      disabled={disabled}
                      onClick={() => void mutate(
                        () => window.neuraco!.deleteHook(hook.id),
                        'Hook supprimé.'
                      )}
                    >
                      <Trash2 size={13} />
                      Supprimer
                    </button>
                  </>
                )}
              </footer>
            </article>
          ))}
        </div>
      </section>

      <section className="hooks-section">
        <header>
          <h2>Exécutions récentes</h2>
          <span>Contexte sensible exclu de l’historique.</span>
        </header>
        {state.recentRuns.length === 0 ? (
          <div className="hooks-empty">Aucun hook exécuté pour le moment.</div>
        ) : (
          <div className="hook-runs">
            {state.recentRuns.map((run) => (
              <div key={run.id} className={`hook-run is-${run.status}`}>
                <strong>{run.hookName}</strong>
                <span>{run.summary}</span>
                <small>
                  {EVENT_LABELS[run.event]} · {run.durationMs} ms ·{' '}
                  {new Date(run.createdAt).toLocaleString('fr-FR')}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
