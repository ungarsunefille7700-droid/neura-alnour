import { useEffect, useState } from 'react';
import {
  Bell,
  CalendarClock,
  Cloud,
  Laptop,
  Pencil,
  Play,
  Save,
  Trash2
} from 'lucide-react';
import type {
  NeuraCoAgentDefinition,
  NeuraCoProject,
  NeuraCoRoutine,
  NeuraCoRoutineInput,
  NeuraCoModelOption,
  NeuraCoRoutinesState,
  NeuraCoRoutineTrigger
} from '../electron/ipc-contract';
import { FALLBACK_NEURACO_MODELS } from '../electron/model-utils';
import ModelOptions from './ModelOptions';

interface RoutinesPanelProps {
  project: NeuraCoProject;
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
  modelOptions?: readonly NeuraCoModelOption[];
}

const TRIGGERS: Array<[NeuraCoRoutineTrigger, string]> = [
  ['time', 'Chaque jour à une heure'],
  ['day', 'Certains jours'],
  ['app_open', 'Ouverture de l’application'],
  ['new_commit', 'Nouveau commit'],
  ['new_pull_request', 'Nouvelle pull request'],
  ['ci_failure', 'Échec CI ou test'],
  ['new_issue', 'Nouvelle issue'],
  ['file_change', 'Changement de fichier'],
  ['api', 'Appel API'],
  ['manual', 'Action manuelle']
];

const WEEKDAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const blank = (projectId: string): NeuraCoRoutineInput => ({
  name: '',
  instruction: '',
  projectIds: [projectId],
  agentIds: [],
  model: 'auto',
  schedule: {
    trigger: 'manual',
    time: '09:00',
    weekdays: [1],
    filePattern: '**/*'
  },
  tools: [],
  budgetCredits: 20,
  autonomy: 'supervised',
  notificationConditions: ['on_success', 'on_failure'],
  executionMode: 'local',
  cloudConsent: false
});

const runStatus = {
  running: 'En cours',
  completed: 'Terminée',
  failed: 'Échec',
  skipped: 'Ignorée'
} as const;

export default function RoutinesPanel({
  project,
  emergencyStopped,
  onStatus,
  modelOptions
}: RoutinesPanelProps) {
  const availableModels = modelOptions?.length
    ? modelOptions
    : FALLBACK_NEURACO_MODELS;
  const [state, setState] = useState<NeuraCoRoutinesState>();
  const [agents, setAgents] = useState<NeuraCoAgentDefinition[]>([]);
  const [draft, setDraft] = useState<NeuraCoRoutineInput>(() => blank(project.id));
  const [toolsText, setToolsText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!window.neuraco) return;
    setBusy(true);
    try {
      const [next, availableAgents] = await Promise.all([
        window.neuraco.getRoutinesState(),
        window.neuraco.listAgents()
      ]);
      setState(next);
      setAgents(availableAgents);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Chargement des routines impossible.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setDraft(blank(project.id));
    setToolsText('');
    void load();
  }, [project.id]);

  const mutate = async (
    operation: () => Promise<NeuraCoRoutinesState>,
    message: string
  ) => {
    setBusy(true);
    try {
      setState(await operation());
      onStatus(message);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Opération de routine impossible.');
    } finally {
      setBusy(false);
    }
  };

  const edit = (routine: NeuraCoRoutine) => {
    setDraft({
      id: routine.id,
      name: routine.name,
      instruction: routine.instruction,
      projectIds: routine.projectIds,
      agentIds: routine.agentIds,
      model: routine.model,
      schedule: { ...routine.schedule },
      tools: routine.tools,
      budgetCredits: routine.budgetCredits,
      autonomy: routine.autonomy,
      notificationConditions: routine.notificationConditions,
      executionMode: routine.executionMode,
      cloudConsent: routine.cloudConsent
    });
    setToolsText(routine.tools.join(', '));
  };

  const save = () => {
    const input: NeuraCoRoutineInput = {
      ...draft,
      projectIds: [project.id],
      tools: toolsText.split(',').map((tool) => tool.trim()).filter(Boolean),
      cloudConsent: draft.executionMode === 'cloud' && draft.cloudConsent
    };
    void mutate(
      () => window.neuraco!.saveRoutine(input),
      draft.id
        ? 'Routine mise à jour.'
        : 'Routine créée et désactivée par défaut.'
    ).then(() => {
      setDraft(blank(project.id));
      setToolsText('');
    });
  };

  if (!state) {
    return (
      <div className="routines-view">
        <div className="routines-loading">Chargement des routines…</div>
      </div>
    );
  }

  const disabled = busy || emergencyStopped;
  const toggleAgent = (agentId: string) => {
    setDraft({
      ...draft,
      agentIds: draft.agentIds.includes(agentId)
        ? draft.agentIds.filter((id) => id !== agentId)
        : [...draft.agentIds, agentId]
    });
  };

  return (
    <div className="routines-view">
      <header className="routines-toolbar">
        <div>
          <CalendarClock size={18} />
          <div>
            <strong>Automatisations</strong>
            <span>
              {state.routines.filter((routine) => routine.enabled).length} active(s) ·{' '}
              planificateur {state.schedulerActive ? 'actif' : 'arrêté'}
            </span>
          </div>
        </div>
      </header>

      <div className="routines-local-note">
        <Laptop size={15} />
        <span>{state.localOnlyNotice}</span>
      </div>

      <section className="routines-section">
        <header>
          <h2>{draft.id ? 'Modifier la routine' : 'Nouvelle routine'}</h2>
          <span>Une routine reste inactive jusqu’à son activation explicite.</span>
        </header>
        <div className="routine-editor">
          <label>
            <span>Nom</span>
            <input
              value={draft.name}
              disabled={disabled}
              placeholder="Rapport quotidien"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="routine-instruction">
            <span>Instruction</span>
            <textarea
              value={draft.instruction}
              disabled={disabled}
              placeholder="Analyse les erreurs récentes et prépare un rapport vérifiable."
              onChange={(event) => setDraft({ ...draft, instruction: event.target.value })}
            />
          </label>
          <label>
            <span>Déclencheur</span>
            <select
              value={draft.schedule.trigger}
              disabled={disabled}
              onChange={(event) => setDraft({
                ...draft,
                schedule: {
                  ...draft.schedule,
                  trigger: event.target.value as NeuraCoRoutineTrigger
                }
              })}
            >
              {TRIGGERS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {['time', 'day'].includes(draft.schedule.trigger) && (
            <label>
              <span>Heure locale</span>
              <input
                type="time"
                value={draft.schedule.time || '09:00'}
                disabled={disabled}
                onChange={(event) => setDraft({
                  ...draft,
                  schedule: { ...draft.schedule, time: event.target.value }
                })}
              />
            </label>
          )}
          {draft.schedule.trigger === 'day' && (
            <fieldset className="routine-weekdays">
              <legend>Jours</legend>
              {WEEKDAYS.map((label, day) => (
                <label key={label}>
                  <input
                    type="checkbox"
                    checked={(draft.schedule.weekdays || []).includes(day)}
                    disabled={disabled}
                    onChange={() => {
                      const current = draft.schedule.weekdays || [];
                      setDraft({
                        ...draft,
                        schedule: {
                          ...draft.schedule,
                          weekdays: current.includes(day)
                            ? current.filter((item) => item !== day)
                            : [...current, day]
                        }
                      });
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          {draft.schedule.trigger === 'file_change' && (
            <label>
              <span>Fichiers surveillés</span>
              <input
                value={draft.schedule.filePattern || '**/*'}
                disabled={disabled}
                placeholder="src/**/*.ts"
                onChange={(event) => setDraft({
                  ...draft,
                  schedule: { ...draft.schedule, filePattern: event.target.value }
                })}
              />
            </label>
          )}
          <label>
            <span>Modèle</span>
            <select
              value={draft.model}
              disabled={disabled}
              onChange={(event) => setDraft({
                ...draft,
                model: event.target.value as NeuraCoRoutineInput['model']
              })}
            >
              <ModelOptions
                models={availableModels}
                includeAuto
                autoLabel="Automatique"
                currentValue={draft.model}
              />
            </select>
          </label>
          <label>
            <span>Budget maximal (crédits)</span>
            <input
              type="number"
              min={1}
              max={1000000}
              value={draft.budgetCredits}
              disabled={disabled}
              onChange={(event) => setDraft({
                ...draft,
                budgetCredits: Number(event.target.value)
              })}
            />
          </label>
          <label>
            <span>Autonomie</span>
            <select
              value={draft.autonomy}
              disabled={disabled}
              onChange={(event) => setDraft({
                ...draft,
                autonomy: event.target.value as NeuraCoRoutineInput['autonomy']
              })}
            >
              <option value="supervised">Supervisée</option>
              <option value="balanced">Équilibrée</option>
              <option value="autonomous">Autonome</option>
            </select>
          </label>
          <label>
            <span>Outils autorisés</span>
            <input
              value={toolsText}
              disabled={disabled}
              placeholder="files, terminal, git"
              onChange={(event) => setToolsText(event.target.value)}
            />
          </label>
          <fieldset className="routine-agents">
            <legend>Agents</legend>
            {agents.map((agent) => (
              <label key={agent.id}>
                <input
                  type="checkbox"
                  checked={draft.agentIds.includes(agent.id)}
                  disabled={disabled}
                  onChange={() => toggleAgent(agent.id)}
                />
                <span>{agent.name}<small>{agent.role}</small></span>
              </label>
            ))}
          </fieldset>
          <fieldset className="routine-notifications">
            <legend><Bell size={13} /> Notifications</legend>
            {([
              ['on_start', 'Démarrage'],
              ['on_success', 'Succès'],
              ['on_failure', 'Échec'],
              ['on_approval', 'Approbation']
            ] as const).map(([condition, label]) => (
              <label key={condition}>
                <input
                  type="checkbox"
                  checked={draft.notificationConditions.includes(condition)}
                  disabled={disabled}
                  onChange={() => setDraft({
                    ...draft,
                    notificationConditions: draft.notificationConditions.includes(condition)
                      ? draft.notificationConditions.filter((item) => item !== condition)
                      : [...draft.notificationConditions, condition]
                  })}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="routine-execution">
            <legend>Exécution</legend>
            <label>
              <input
                type="radio"
                name="routine-execution"
                checked={draft.executionMode === 'local'}
                disabled={disabled}
                onChange={() => setDraft({
                  ...draft,
                  executionMode: 'local',
                  cloudConsent: false
                })}
              />
              <Laptop size={13} /> Locale
            </label>
            <label>
              <input
                type="radio"
                name="routine-execution"
                checked={draft.executionMode === 'cloud'}
                disabled={disabled}
                onChange={() => setDraft({
                  ...draft,
                  executionMode: 'cloud',
                  cloudConsent: false
                })}
              />
              <Cloud size={13} /> Cloud facultatif
            </label>
            {draft.executionMode === 'cloud' && (
              <label className="routine-cloud-consent">
                <input
                  type="checkbox"
                  checked={draft.cloudConsent}
                  disabled={disabled}
                  onChange={(event) => setDraft({
                    ...draft,
                    cloudConsent: event.target.checked
                  })}
                />
                J’autorise explicitement l’envoi de cette instruction au cloud.
              </label>
            )}
          </fieldset>
          <div className="routine-editor-actions">
            <button
              type="button"
              disabled={
                disabled
                || draft.name.trim().length < 3
                || draft.instruction.trim().length < 3
                || (draft.executionMode === 'cloud' && !draft.cloudConsent)
              }
              onClick={save}
            >
              <Save size={14} /> {draft.id ? 'Enregistrer' : 'Créer'}
            </button>
            {draft.id && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setDraft(blank(project.id));
                  setToolsText('');
                }}
              >
                Annuler
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="routines-section">
        <header>
          <h2>Routines configurées</h2>
          <span>{state.routines.length} routine(s) pour ce poste.</span>
        </header>
        {state.routines.length === 0 ? (
          <div className="routines-empty">Aucune routine configurée.</div>
        ) : (
          <div className="routines-list">
            {state.routines.map((routine) => (
              <article
                key={routine.id}
                className={`routine-entry ${routine.enabled ? 'is-enabled' : ''}`}
              >
                <header>
                  <div>
                    {routine.executionMode === 'cloud'
                      ? <Cloud size={15} />
                      : <Laptop size={15} />}
                    <div>
                      <strong>{routine.name}</strong>
                      <span>
                        {TRIGGERS.find(([value]) => value === routine.schedule.trigger)?.[1]}
                        {' · '}{routine.model}
                      </span>
                    </div>
                  </div>
                  <span className={routine.enabled ? 'is-active' : ''}>
                    {routine.enabled ? 'Active' : 'Inactive'}
                  </span>
                </header>
                <p>{routine.instruction}</p>
                <dl>
                  <div><dt>Budget</dt><dd>{routine.budgetCredits} crédits</dd></div>
                  <div><dt>Autonomie</dt><dd>{routine.autonomy}</dd></div>
                  <div><dt>Agents</dt><dd>{routine.agentIds.length || 'Auto'}</dd></div>
                  <div><dt>Prochaine</dt><dd>
                    {routine.nextRunAt
                      ? new Date(routine.nextRunAt).toLocaleString('fr-FR')
                      : 'Événement'}
                  </dd></div>
                </dl>
                <footer>
                  <button type="button" disabled={disabled} onClick={() => edit(routine)}>
                    <Pencil size={13} /> Modifier
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void mutate(
                      () => window.neuraco!.setRoutineEnabled(
                        routine.id,
                        !routine.enabled
                      ),
                      routine.enabled ? 'Routine désactivée.' : 'Routine activée.'
                    )}
                  >
                    {routine.enabled ? 'Désactiver' : 'Activer'}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setBusy(true);
                      void window.neuraco!.runRoutine(routine.id)
                        .then((run) => {
                          onStatus(`${routine.name} : ${run.summary}`);
                          return load();
                        })
                        .catch((error) => onStatus(
                          error instanceof Error ? error.message : 'Routine impossible.'
                        ))
                        .finally(() => setBusy(false));
                    }}
                  >
                    <Play size={13} /> Exécuter
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    disabled={disabled}
                    onClick={() => void mutate(
                      () => window.neuraco!.deleteRoutine(routine.id),
                      'Routine supprimée.'
                    )}
                  >
                    <Trash2 size={13} /> Supprimer
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="routines-section">
        <header>
          <h2>Exécutions récentes</h2>
          <span>Résultats et consommation réelle.</span>
        </header>
        {state.recentRuns.length === 0 ? (
          <div className="routines-empty">Aucune exécution enregistrée.</div>
        ) : (
          <div className="routine-runs">
            {state.recentRuns.map((run) => (
              <div key={run.id} className={`routine-run is-${run.status}`}>
                <strong>{run.routineName}</strong>
                <span>{runStatus[run.status]} · {run.summary}</span>
                <small>
                  {run.trigger} · {run.executionMode}
                  {run.model ? ` · ${run.model}` : ''}
                  {run.creditsConsumed !== undefined
                    ? ` · ${run.creditsConsumed} crédits`
                    : ''}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
