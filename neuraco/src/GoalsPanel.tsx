import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CalendarDays,
  Check,
  CirclePause,
  Flag,
  Plus,
  RefreshCw,
  Target,
  X
} from 'lucide-react';
import type {
  NeuraCoAgentDefinition,
  NeuraCoGoal,
  NeuraCoGoalCreate,
  NeuraCoGoalPriority,
  NeuraCoGoalStatus,
  NeuraCoGoalStepStatus,
  NeuraCoProjectSnapshot
} from '../electron/ipc-contract';

interface GoalsPanelProps {
  snapshot: NeuraCoProjectSnapshot;
  onStatus: (message: string) => void;
}

const priorityLabels: Record<NeuraCoGoalPriority, string> = {
  low: 'Basse',
  medium: 'Normale',
  high: 'Élevée',
  critical: 'Critique'
};

const statusLabels: Record<NeuraCoGoalStatus, string> = {
  active: 'Actif',
  paused: 'En pause',
  completed: 'Terminé',
  archived: 'Archivé'
};

const stepLabels: Record<NeuraCoGoalStepStatus, string> = {
  pending: 'À faire',
  running: 'En cours',
  completed: 'Terminée',
  blocked: 'Bloquée'
};

const emptyDraft = (projectId: string): NeuraCoGoalCreate => ({
  title: '',
  expectedResult: '',
  description: '',
  steps: [],
  successCriteria: [],
  priority: 'medium',
  budget: 20,
  projectIds: [projectId],
  agentIds: [],
  targetDate: undefined
});

const lines = (value: string): string[] => (
  value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
);

export default function GoalsPanel({ snapshot, onStatus }: GoalsPanelProps) {
  const [goals, setGoals] = useState<NeuraCoGoal[]>([]);
  const [agents, setAgents] = useState<NeuraCoAgentDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<NeuraCoGoalCreate>(
    emptyDraft(snapshot.project.id)
  );
  const [stepsText, setStepsText] = useState('');
  const [criteriaText, setCriteriaText] = useState('');

  const selected = useMemo(
    () => goals.find((goal) => goal.id === selectedId) || goals[0],
    [goals, selectedId]
  );

  const refresh = async () => {
    if (!window.neuraco) return;
    setBusy(true);
    setError(undefined);
    try {
      const [loadedGoals, loadedAgents] = await Promise.all([
        window.neuraco.listGoals(),
        window.neuraco.listAgents()
      ]);
      setGoals(loadedGoals);
      setAgents(loadedAgents);
      setSelectedId((current) => (
        loadedGoals.some((goal) => goal.id === current) ? current : loadedGoals[0]?.id
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Objectifs indisponibles.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setDraft(emptyDraft(snapshot.project.id));
    void refresh();
  }, [snapshot.project.id]);

  const replaceGoal = (goal: NeuraCoGoal) => {
    setGoals((current) => current.map((item) => item.id === goal.id ? goal : item));
  };

  const createGoal = async () => {
    if (!window.neuraco || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const goal = await window.neuraco.createGoal({
        ...draft,
        steps: lines(stepsText),
        successCriteria: lines(criteriaText),
        projectIds: [snapshot.project.id]
      });
      setGoals((current) => [goal, ...current]);
      setSelectedId(goal.id);
      setDraft(emptyDraft(snapshot.project.id));
      setStepsText('');
      setCriteriaText('');
      setCreating(false);
      onStatus(`Objectif « ${goal.title} » créé.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (status: NeuraCoGoalStatus) => {
    if (!window.neuraco || !selected || busy) return;
    setBusy(true);
    try {
      replaceGoal(await window.neuraco.updateGoal(selected.id, { status }));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Mise à jour impossible.');
    } finally {
      setBusy(false);
    }
  };

  const updateStep = async (stepId: string, status: NeuraCoGoalStepStatus) => {
    if (!window.neuraco || !selected || busy) return;
    setBusy(true);
    try {
      replaceGoal(await window.neuraco.updateGoalStep(selected.id, stepId, status));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Étape indisponible.');
    } finally {
      setBusy(false);
    }
  };

  const updateCriterion = async (criterionId: string, satisfied: boolean) => {
    if (!window.neuraco || !selected || busy) return;
    setBusy(true);
    try {
      replaceGoal(await window.neuraco.updateGoal(selected.id, {
        criterionId,
        criterionSatisfied: satisfied
      }));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Critère indisponible.');
    } finally {
      setBusy(false);
    }
  };

  const resolveProposal = async (
    proposalId: string,
    decision: 'approved' | 'rejected'
  ) => {
    if (!window.neuraco || !selected || busy) return;
    setBusy(true);
    try {
      replaceGoal(await window.neuraco.resolveGoalProposal(
        selected.id,
        proposalId,
        decision
      ));
      onStatus(
        decision === 'approved'
          ? 'La proposition a été ajoutée aux étapes.'
          : 'La proposition a été refusée.'
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Décision impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="goals-view">
      <header className="goals-heading">
        <div>
          <Target size={20} />
          <span>
            <strong>Objectifs</strong>
            <small>Résultats, étapes, critères, budget et progression vérifiable.</small>
          </span>
        </div>
        <button type="button" onClick={() => setCreating(true)}>
          <Plus size={15} /> Nouvel objectif
        </button>
        <button type="button" title="Actualiser" onClick={() => void refresh()}>
          <RefreshCw size={15} />
        </button>
      </header>

      {error && <div className="multi-agent-error">{error}</div>}

      <div className="goals-body">
        <aside className="goals-list">
          {goals.map((goal) => (
            <button
              type="button"
              key={goal.id}
              className={selected?.id === goal.id ? 'is-selected' : ''}
              onClick={() => setSelectedId(goal.id)}
            >
              <span>
                <strong>{goal.title}</strong>
                <small>{statusLabels[goal.status]} · {priorityLabels[goal.priority]}</small>
              </span>
              <em>{goal.progress}%</em>
              <i><b style={{ width: `${goal.progress}%` }} /></i>
            </button>
          ))}
          {!busy && goals.length === 0 && (
            <p>Créez un objectif pour suivre un résultat concret.</p>
          )}
        </aside>

        <main className="goals-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <Flag size={17} />
                  <span>
                    <strong>{selected.title}</strong>
                    <small>{selected.expectedResult}</small>
                  </span>
                </div>
                <b>{selected.progress}%</b>
              </header>
              <div className="goal-progress">
                <i style={{ width: `${selected.progress}%` }} />
              </div>
              <div className="goal-meta">
                <span>Priorité : {priorityLabels[selected.priority]}</span>
                <span>Budget : {selected.budget}</span>
                <span>Agents : {selected.agentIds.length || 'aucun'}</span>
                {selected.targetDate && (
                  <span>
                    <CalendarDays size={12} />
                    {new Date(selected.targetDate).toLocaleDateString()}
                  </span>
                )}
              </div>
              {selected.description && <p className="goal-description">{selected.description}</p>}

              <section className="goal-section">
                <h3>Étapes</h3>
                {selected.steps.map((step) => (
                  <div className={`goal-step is-${step.status}`} key={step.id}>
                    <span>
                      <strong>{step.title}</strong>
                      {step.description && <small>{step.description}</small>}
                    </span>
                    <select
                      value={step.status}
                      disabled={busy}
                      onChange={(event) => void updateStep(
                        step.id,
                        event.target.value as NeuraCoGoalStepStatus
                      )}
                    >
                      {Object.entries(stepLabels).map(([status, label]) => (
                        <option key={status} value={status}>{label}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {selected.steps.length === 0 && <p>Aucune étape validée.</p>}
              </section>

              <section className="goal-section">
                <h3>Critères de réussite</h3>
                {selected.successCriteria.map((criterion) => (
                  <label className="goal-criterion" key={criterion.id}>
                    <input
                      type="checkbox"
                      checked={criterion.satisfied}
                      disabled={busy}
                      onChange={(event) => void updateCriterion(
                        criterion.id,
                        event.target.checked
                      )}
                    />
                    <span>{criterion.label}</span>
                  </label>
                ))}
                {selected.successCriteria.length === 0 && <p>Aucun critère défini.</p>}
              </section>

              <section className="goal-section goal-proposals">
                <h3>Propositions des agents</h3>
                {selected.proposals.filter((proposal) => proposal.status === 'pending')
                  .map((proposal) => (
                    <article key={proposal.id}>
                      <span>
                        <strong>{proposal.title}</strong>
                        <small>Proposé par {proposal.proposedBy}</small>
                        {proposal.description && <p>{proposal.description}</p>}
                      </span>
                      <button
                        type="button"
                        title="Refuser la proposition"
                        onClick={() => void resolveProposal(proposal.id, 'rejected')}
                      >
                        <X size={14} />
                      </button>
                      <button
                        type="button"
                        className="is-primary"
                        title="Ajouter cette étape"
                        onClick={() => void resolveProposal(proposal.id, 'approved')}
                      >
                        <Check size={14} />
                      </button>
                    </article>
                  ))}
                {!selected.proposals.some((proposal) => proposal.status === 'pending') && (
                  <p>Aucune proposition en attente. Les agents ne peuvent rien ajouter seuls.</p>
                )}
              </section>

              <footer className="goal-actions">
                <button type="button" onClick={() => void updateStatus('active')}>
                  <Target size={14} /> Activer
                </button>
                <button type="button" onClick={() => void updateStatus('paused')}>
                  <CirclePause size={14} /> Mettre en pause
                </button>
                <button type="button" onClick={() => void updateStatus('completed')}>
                  <Check size={14} /> Terminer
                </button>
                <button type="button" onClick={() => void updateStatus('archived')}>
                  <Archive size={14} /> Archiver
                </button>
              </footer>
            </>
          ) : (
            <div className="multi-agent-empty">
              <Target size={30} />
              <p>Aucun objectif pour ce projet.</p>
            </div>
          )}
        </main>
      </div>

      {creating && (
        <div className="goal-dialog-backdrop">
          <form className="goal-dialog" onSubmit={(event) => {
            event.preventDefault();
            void createGoal();
          }}>
            <header>
              <div>
                <Target size={18} />
                <strong>Nouvel objectif</strong>
              </div>
              <button type="button" title="Fermer" onClick={() => setCreating(false)}>
                <X size={15} />
              </button>
            </header>
            <label>
              Titre
              <input
                required
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label>
              Résultat attendu
              <textarea
                required
                value={draft.expectedResult}
                onChange={(event) => setDraft({ ...draft, expectedResult: event.target.value })}
              />
            </label>
            <label>
              Description
              <textarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </label>
            <div className="goal-dialog-grid">
              <label>
                Priorité
                <select
                  value={draft.priority}
                  onChange={(event) => setDraft({
                    ...draft,
                    priority: event.target.value as NeuraCoGoalPriority
                  })}
                >
                  {Object.entries(priorityLabels).map(([priority, label]) => (
                    <option key={priority} value={priority}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                Budget
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={draft.budget}
                  onChange={(event) => setDraft({
                    ...draft,
                    budget: Number(event.target.value)
                  })}
                />
              </label>
              <label>
                Date cible
                <input
                  type="date"
                  value={draft.targetDate?.slice(0, 10) || ''}
                  onChange={(event) => setDraft({
                    ...draft,
                    targetDate: event.target.value || undefined
                  })}
                />
              </label>
            </div>
            <label>
              Étapes, une par ligne
              <textarea value={stepsText} onChange={(event) => setStepsText(event.target.value)} />
            </label>
            <label>
              Critères de réussite, un par ligne
              <textarea
                value={criteriaText}
                onChange={(event) => setCriteriaText(event.target.value)}
              />
            </label>
            <fieldset>
              <legend>Agents concernés</legend>
              {agents.map((agent) => (
                <label key={agent.id}>
                  <input
                    type="checkbox"
                    checked={draft.agentIds.includes(agent.id)}
                    onChange={(event) => setDraft({
                      ...draft,
                      agentIds: event.target.checked
                        ? [...draft.agentIds, agent.id]
                        : draft.agentIds.filter((id) => id !== agent.id)
                    })}
                  />
                  {agent.name}
                </label>
              ))}
            </fieldset>
            <footer>
              <button type="button" onClick={() => setCreating(false)}>Annuler</button>
              <button
                type="submit"
                className="is-primary"
                disabled={busy || !draft.title.trim() || !draft.expectedResult.trim()}
              >
                Créer l’objectif
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
