import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  CircleStop,
  LockKeyhole,
  MessageSquare,
  Network,
  Plus,
  Save,
  Trash2,
  UsersRound,
  X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  NeuraCoAgentCoordinationMessage,
  NeuraCoAgentDefinition,
  NeuraCoAgentFileReservation,
  NeuraCoCoordinationLimits,
  NeuraCoCustomAgentInput,
  NeuraCoGoal,
  NeuraCoMultiAgentProgress,
  NeuraCoMultiAgentResult,
  NeuraCoMultiAgentTask,
  NeuraCoProjectFileNode,
  NeuraCoProjectSnapshot
} from '../electron/ipc-contract';

interface MultiAgentPanelProps {
  snapshot: NeuraCoProjectSnapshot;
  files: NeuraCoProjectFileNode[];
  emergencyStopped: boolean;
  onStatus: (message: string) => void;
}

const emptyCustomAgent = (): NeuraCoCustomAgentInput => ({
  id: '',
  name: '',
  role: '',
  instructions: '',
  model: 'auto',
  tools: [],
  allowedApplications: [],
  allowedFolders: [],
  budget: 5,
  autonomy: 'ask',
  memory: 'session',
  color: '#2563eb',
  icon: 'bot'
});

const splitList = (value: string): string[] => (
  value.split(',').map((item) => item.trim()).filter(Boolean)
);

const uniqueTaskId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const statusLabel = (task: NeuraCoMultiAgentTask): string => {
  if (task.status === 'queued') return 'En attente';
  if (task.status === 'waiting') return 'Dépendance';
  if (task.status === 'running') return 'En cours';
  if (task.status === 'completed') return 'Terminé';
  if (task.status === 'blocked') return 'Bloqué';
  if (task.status === 'cancelled') return 'Annulé';
  return 'Échec';
};

export default function MultiAgentPanel({
  snapshot,
  files,
  emergencyStopped,
  onStatus
}: MultiAgentPanelProps) {
  const [agents, setAgents] = useState<NeuraCoAgentDefinition[]>([]);
  const [goals, setGoals] = useState<NeuraCoGoal[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([
    'architect',
    'developer',
    'tests'
  ]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState(20);
  const [maxAgents, setMaxAgents] = useState(3);
  const [loading, setLoading] = useState(true);
  const [runningTaskId, setRunningTaskId] = useState<string>();
  const [progress, setProgress] = useState<NeuraCoMultiAgentProgress>();
  const [tasks, setTasks] = useState<NeuraCoMultiAgentTask[]>([]);
  const [coordinationMessages, setCoordinationMessages] = useState<
    NeuraCoAgentCoordinationMessage[]
  >([]);
  const [fileReservations, setFileReservations] = useState<
    NeuraCoAgentFileReservation[]
  >([]);
  const [coordinationLimits, setCoordinationLimits] = useState<
    NeuraCoCoordinationLimits
  >();
  const [result, setResult] = useState<NeuraCoMultiAgentResult>();
  const [error, setError] = useState<string>();
  const [customOpen, setCustomOpen] = useState(false);
  const [customAgent, setCustomAgent] = useState<NeuraCoCustomAgentInput>(
    emptyCustomAgent
  );
  const [customBusy, setCustomBusy] = useState(false);
  const [fileFilter, setFileFilter] = useState('');

  const filteredFiles = useMemo(() => {
    const query = fileFilter.trim().toLowerCase();
    return files
      .filter((file) => file.kind === 'file')
      .filter((file) => !query || file.relativePath.toLowerCase().includes(query))
      .slice(0, 250);
  }, [fileFilter, files]);

  const refreshAgents = async () => {
    if (!window.neuraco) return;
    setLoading(true);
    try {
      const [loadedAgents, loadedGoals] = await Promise.all([
        window.neuraco.listAgents(),
        window.neuraco.listGoals()
      ]);
      setAgents(loadedAgents);
      setGoals(loadedGoals.filter((goal) => goal.status === 'active'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les agents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAgents();
  }, []);

  useEffect(() => {
    const unsubscribe = window.neuraco?.onMultiAgentProgress((event) => {
      if (runningTaskId && event.taskId !== runningTaskId) return;
      setProgress(event);
      if (event.coordinationMessages) {
        setCoordinationMessages(event.coordinationMessages);
      }
      if (event.fileReservations) {
        setFileReservations(event.fileReservations);
      }
      if (event.coordinationLimits) {
        setCoordinationLimits(event.coordinationLimits);
      }
      if (event.task) {
        setTasks((current) => {
          const existing = current.findIndex((task) => task.id === event.task?.id);
          if (existing < 0) return [...current, event.task as NeuraCoMultiAgentTask];
          const next = [...current];
          next[existing] = event.task as NeuraCoMultiAgentTask;
          return next;
        });
      }
    });
    return unsubscribe;
  }, [runningTaskId]);

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((current) => (
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId].slice(0, 8)
    ));
  };

  const toggleFile = (relativePath: string) => {
    setSelectedFiles((current) => (
      current.includes(relativePath)
        ? current.filter((file) => file !== relativePath)
        : current.length < 16
          ? [...current, relativePath]
          : current
    ));
  };

  const run = async () => {
    if (!window.neuraco || emergencyStopped || runningTaskId) return;
    if (!objective.trim()) {
      setError('Décrivez un objectif concret avant de lancer l’équipe.');
      return;
    }
    if (selectedAgents.length === 0) {
      setError('Sélectionnez au moins un agent.');
      return;
    }
    setError(undefined);
    setResult(undefined);
    setTasks([]);
    setCoordinationMessages([]);
    setFileReservations([]);
    setCoordinationLimits(undefined);
    const taskId = uniqueTaskId();
    setRunningTaskId(taskId);
    setProgress({
      taskId,
      phase: 'planning',
      message: 'Lecture des fichiers explicitement sélectionnés.',
      completed: 0,
      total: 1
    });
    try {
      const contexts = await Promise.all(
        selectedFiles.slice(0, 16).map((relativePath) => (
          window.neuraco!.readProjectFile(relativePath)
        ))
      );
      const completed = await window.neuraco.runMultiAgentTask({
        taskId,
        goalId: selectedGoalId || undefined,
        objective: objective.trim(),
        projectId: snapshot.project.id,
        projectName: snapshot.project.name,
        selectedAgentIds: selectedAgents,
        maxAgents: Math.min(maxAgents, selectedAgents.length),
        budget,
        files: contexts.map((file) => ({
          path: file.relativePath,
          content: file.content,
          language: file.language
        }))
      });
      setResult(completed);
      setTasks(completed.tasks);
      setCoordinationMessages(completed.coordinationMessages);
      setFileReservations(completed.fileReservations);
      setCoordinationLimits(completed.coordinationLimits);
      onStatus(
        `Équipe terminée: ${completed.tasks.length} tâche(s), `
        + `${completed.budgetUsed} unité(s) de budget, `
        + `${completed.creditsConsumed} crédit(s), revue ${completed.model}.`
      );
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : 'Échec de l’orchestration.';
      setError(message);
      onStatus(message);
    } finally {
      setRunningTaskId(undefined);
    }
  };

  const cancel = async () => {
    if (!window.neuraco || !runningTaskId) return;
    await window.neuraco.cancelMultiAgentTask(runningTaskId);
  };

  const saveCustom = async () => {
    if (!window.neuraco || customBusy) return;
    setCustomBusy(true);
    setError(undefined);
    try {
      await window.neuraco.saveCustomAgent(customAgent);
      setCustomAgent(emptyCustomAgent());
      setCustomOpen(false);
      await refreshAgents();
      onStatus('Agent personnalisé enregistré localement.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Agent invalide.');
    } finally {
      setCustomBusy(false);
    }
  };

  const deleteCustom = async (agentId: string) => {
    if (!window.neuraco || customBusy) return;
    setCustomBusy(true);
    try {
      await window.neuraco.deleteCustomAgent(agentId);
      setSelectedAgents((current) => current.filter((id) => id !== agentId));
      await refreshAgents();
    } finally {
      setCustomBusy(false);
    }
  };

  return (
    <div className="multi-agent-view">
      <header className="multi-agent-heading">
        <div>
          <UsersRound size={20} />
          <span>
            <strong>Équipe multi-agents</strong>
            <small>Planification, spécialistes isolés et revue indépendante.</small>
          </span>
        </div>
        <button type="button" onClick={() => setCustomOpen(true)}>
          <Plus size={15} />
          Agent personnalisé
        </button>
      </header>

      <div className="multi-agent-body">
        <section className="multi-agent-setup">
          <label htmlFor="multi-agent-goal">Objectif suivi</label>
          <select
            id="multi-agent-goal"
            value={selectedGoalId}
            disabled={Boolean(runningTaskId)}
            onChange={(event) => {
              const goalId = event.target.value;
              setSelectedGoalId(goalId);
              const goal = goals.find((item) => item.id === goalId);
              if (goal && !objective.trim()) {
                setObjective([
                  goal.title,
                  `Résultat attendu : ${goal.expectedResult}`,
                  goal.description
                ].filter(Boolean).join('\n\n'));
                setBudget(goal.budget || budget);
                if (goal.agentIds.length > 0) {
                  setSelectedAgents(goal.agentIds.slice(0, 8));
                }
              }
            }}
          >
            <option value="">Aucun objectif lié</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title} · {goal.progress}%
              </option>
            ))}
          </select>
          <small className="multi-agent-goal-note">
            Les nouvelles étapes proposées resteront en attente dans le Mode Objectif.
          </small>

          <label htmlFor="multi-agent-objective">Objectif</label>
          <textarea
            id="multi-agent-objective"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Décrivez le résultat attendu, les contraintes et ce qui doit être vérifié."
            disabled={Boolean(runningTaskId)}
          />

          <div className="multi-agent-controls">
            <label>
              Budget
              <input
                type="number"
                min={3}
                max={100}
                value={budget}
                onChange={(event) => setBudget(Number(event.target.value))}
                disabled={Boolean(runningTaskId)}
              />
            </label>
            <label>
              Agents maximum
              <input
                type="number"
                min={1}
                max={8}
                value={maxAgents}
                onChange={(event) => setMaxAgents(Number(event.target.value))}
                disabled={Boolean(runningTaskId)}
              />
            </label>
            <span>{selectedFiles.length}/16 fichiers joints</span>
          </div>

          <div className="multi-agent-section-title">
            <strong>Agents autorisés</strong>
            <span>{selectedAgents.length} sélectionné(s)</span>
          </div>
          <div className="agent-definition-list" aria-busy={loading}>
            {agents.map((agent) => (
              <label
                key={agent.id}
                className={`agent-definition ${selectedAgents.includes(agent.id) ? 'is-selected' : ''}`}
                style={{ '--agent-color': agent.color } as React.CSSProperties}
              >
                <input
                  type="checkbox"
                  checked={selectedAgents.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                  disabled={Boolean(runningTaskId)}
                />
                <span className="agent-color" />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.role}</small>
                </span>
                <em>{agent.model === 'auto' ? 'Auto' : agent.model}</em>
                {!agent.builtIn && (
                  <button
                    type="button"
                    title="Supprimer cet agent personnalisé"
                    onClick={(event) => {
                      event.preventDefault();
                      void deleteCustom(agent.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </label>
            ))}
          </div>

          <div className="multi-agent-section-title">
            <strong>Contexte explicite</strong>
            <span>Seuls ces fichiers seront envoyés aux agents.</span>
          </div>
          <input
            className="multi-agent-file-filter"
            value={fileFilter}
            onChange={(event) => setFileFilter(event.target.value)}
            placeholder="Filtrer les fichiers du projet…"
          />
          <div className="multi-agent-files">
            {filteredFiles.map((file) => (
              <label key={file.relativePath}>
                <input
                  type="checkbox"
                  checked={selectedFiles.includes(file.relativePath)}
                  onChange={() => toggleFile(file.relativePath)}
                  disabled={
                    Boolean(runningTaskId)
                    || (!selectedFiles.includes(file.relativePath) && selectedFiles.length >= 16)
                  }
                />
                <span title={file.relativePath}>{file.relativePath}</span>
              </label>
            ))}
          </div>

          <div className="multi-agent-run">
            {runningTaskId ? (
              <button type="button" className="is-cancel" onClick={() => void cancel()}>
                <CircleStop size={16} />
                Annuler l’équipe
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void run()}
                disabled={emergencyStopped || loading}
              >
                <UsersRound size={16} />
                Lancer l’équipe
              </button>
            )}
          </div>
        </section>

        <section className="multi-agent-results" aria-live="polite">
          <header>
            <strong>Exécution</strong>
            {progress && (
              <span>
                {progress.completed}/{progress.total} · {progress.phase}
              </span>
            )}
          </header>
          {progress ? (
            <div className="multi-agent-progress">
              <i
                style={{
                  width: `${progress.total > 0
                    ? Math.round((progress.completed / progress.total) * 100)
                    : 4}%`
                }}
              />
              <p>{progress.message}</p>
            </div>
          ) : (
            <div className="multi-agent-empty">
              <Bot size={30} />
              <p>L’orchestrateur affichera ici le plan, les agents et leur progression réelle.</p>
            </div>
          )}
          {error && <div className="multi-agent-error">{error}</div>}
          {tasks.length > 0 && (
            <div className="multi-agent-task-list">
              {tasks.map((task) => (
                <article key={task.id} className={`is-${task.status}`}>
                  <header>
                    <span className="task-status-icon">
                      {task.status === 'completed'
                        ? <CheckCircle2 size={15} />
                        : <Bot size={15} />}
                    </span>
                    <strong>{task.agentName}</strong>
                    <em>{statusLabel(task)}</em>
                  </header>
                  <p>{task.objective}</p>
                  <small>{task.files.join(', ') || 'Aucun fichier transmis'}</small>
                  {task.dependencies.length > 0 && (
                    <span>Dépend de : {task.dependencies.join(', ')}</span>
                  )}
                  {task.acceptanceCriteria.length > 0 && (
                    <details>
                      <summary>Critères d’acceptation</summary>
                      <ul>
                        {task.acceptanceCriteria.map((criterion) => (
                          <li key={criterion}>{criterion}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {(task.blockers?.length || task.questions?.length) ? (
                    <details>
                      <summary>Questions et blocages</summary>
                      {task.questions?.map((question) => <p key={question}>{question}</p>)}
                      {task.blockers?.map((blocker) => <p key={blocker}>{blocker}</p>)}
                    </details>
                  ) : null}
                  <span>Tests : {task.testState || 'not_requested'}</span>
                  {task.model && (
                    <span>
                      {task.model} · budget {task.budget}
                      {task.creditsConsumed != null
                        ? ` · ${task.creditsConsumed} crédit(s)`
                        : ''}
                    </span>
                  )}
                  {task.message && (
                    <details>
                      <summary>Résultat</summary>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.message}</ReactMarkdown>
                    </details>
                  )}
                </article>
              ))}
            </div>
          )}
          {(coordinationMessages.length > 0 || fileReservations.length > 0) && (
            <section className="agent-coordination">
              <header>
                <div>
                  <Network size={16} />
                  <strong>Coordination de l’équipe</strong>
                </div>
                {coordinationLimits && (
                  <span>
                    {coordinationLimits.messagesUsed}/{coordinationLimits.maxMessages} messages
                    {' · '}
                    {coordinationLimits.escalations} escalade(s)
                  </span>
                )}
              </header>

              {fileReservations.length > 0 && (
                <div className="agent-reservations">
                  <strong><LockKeyhole size={14} /> Fichiers réservés</strong>
                  {fileReservations.map((reservation) => (
                    <p key={`${reservation.taskId}:${reservation.path}`}>
                      <code>{reservation.path}</code>
                      <span>
                        {reservation.agentName}
                        {' · '}
                        {reservation.releasedAt ? 'libéré' : 'réservé'}
                      </span>
                    </p>
                  ))}
                </div>
              )}

              {coordinationMessages.length > 0 && (
                <div className="agent-mailbox">
                  <strong><MessageSquare size={14} /> Boîte de messages interne</strong>
                  {coordinationMessages.map((message) => (
                    <article key={message.id}>
                      <header>
                        <b>{message.fromAgentName}</b>
                        <span>→ {message.toAgentName}</span>
                        <em>{message.kind}</em>
                      </header>
                      <strong>{message.subject}</strong>
                      <p>{message.body}</p>
                    </article>
                  ))}
                </div>
              )}

              {coordinationLimits?.limitReached && (
                <p className="coordination-warning">
                  Limite de coordination atteinte. Les demandes restantes sont remontées à
                  l’orchestrateur au lieu de créer une boucle.
                </p>
              )}
            </section>
          )}
          {result && (
            <div className="multi-agent-review">
              <header>
                <CheckCircle2 size={16} />
                <strong>Revue indépendante</strong>
                <span>{result.model} · {result.creditsConsumed} crédit(s)</span>
              </header>
              {result.risks.length > 0 && (
                <p><strong>Risques:</strong> {result.risks.join(' · ')}</p>
              )}
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.review}</ReactMarkdown>
            </div>
          )}
        </section>
      </div>

      {customOpen && (
        <div className="workspace-modal-backdrop">
          <section className="custom-agent-dialog" role="dialog" aria-modal="true">
            <header>
              <div>
                <Bot size={18} />
                <strong>Agent personnalisé</strong>
              </div>
              <button type="button" onClick={() => setCustomOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <div className="custom-agent-form">
              <label>
                Identifiant
                <input
                  value={customAgent.id}
                  onChange={(event) => setCustomAgent({
                    ...customAgent,
                    id: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
                  })}
                  placeholder="audit-mobile"
                />
              </label>
              <label>
                Nom
                <input
                  value={customAgent.name}
                  onChange={(event) => setCustomAgent({ ...customAgent, name: event.target.value })}
                  placeholder="Auditeur mobile"
                />
              </label>
              <label className="is-wide">
                Rôle
                <input
                  value={customAgent.role}
                  onChange={(event) => setCustomAgent({ ...customAgent, role: event.target.value })}
                  placeholder="Validation des parcours mobiles"
                />
              </label>
              <label className="is-wide">
                Instructions
                <textarea
                  value={customAgent.instructions}
                  onChange={(event) => setCustomAgent({
                    ...customAgent,
                    instructions: event.target.value
                  })}
                />
              </label>
              <label>
                Modèle
                <select
                  value={customAgent.model}
                  onChange={(event) => setCustomAgent({ ...customAgent, model: event.target.value })}
                >
                  <option value="auto">Meilleur disponible</option>
                  <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                </select>
              </label>
              <label>
                Budget
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={customAgent.budget}
                  onChange={(event) => setCustomAgent({
                    ...customAgent,
                    budget: Number(event.target.value)
                  })}
                />
              </label>
              <label>
                Autonomie
                <select
                  value={customAgent.autonomy}
                  onChange={(event) => setCustomAgent({
                    ...customAgent,
                    autonomy: event.target.value as NeuraCoCustomAgentInput['autonomy']
                  })}
                >
                  <option value="ask">Toujours demander</option>
                  <option value="scoped">Périmètre autorisé</option>
                  <option value="full">Accès complet contrôlé</option>
                </select>
              </label>
              <label>
                Mémoire
                <select
                  value={customAgent.memory}
                  onChange={(event) => setCustomAgent({
                    ...customAgent,
                    memory: event.target.value as NeuraCoCustomAgentInput['memory']
                  })}
                >
                  <option value="off">Désactivée</option>
                  <option value="session">Session</option>
                  <option value="project">Projet</option>
                </select>
              </label>
              <label className="is-wide">
                Outils, séparés par des virgules
                <input
                  value={customAgent.tools.join(', ')}
                  onChange={(event) => setCustomAgent({
                    ...customAgent,
                    tools: splitList(event.target.value)
                  })}
                />
              </label>
              <label className="is-wide">
                Dossiers autorisés
                <input
                  value={customAgent.allowedFolders.join(', ')}
                  onChange={(event) => setCustomAgent({
                    ...customAgent,
                    allowedFolders: splitList(event.target.value)
                  })}
                />
              </label>
              <label className="is-wide">
                Logiciels autorisés
                <input
                  value={customAgent.allowedApplications.join(', ')}
                  onChange={(event) => setCustomAgent({
                    ...customAgent,
                    allowedApplications: splitList(event.target.value)
                  })}
                />
              </label>
              <label>
                Couleur
                <input
                  type="color"
                  value={customAgent.color}
                  onChange={(event) => setCustomAgent({ ...customAgent, color: event.target.value })}
                />
              </label>
              <label>
                Icône
                <input
                  value={customAgent.icon}
                  onChange={(event) => setCustomAgent({ ...customAgent, icon: event.target.value })}
                />
              </label>
            </div>
            <footer>
              <button type="button" onClick={() => setCustomOpen(false)}>Annuler</button>
              <button
                type="button"
                className="is-primary"
                disabled={customBusy || !customAgent.id || !customAgent.name || !customAgent.role}
                onClick={() => void saveCustom()}
              >
                <Save size={15} />
                Enregistrer
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
