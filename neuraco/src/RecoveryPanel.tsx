import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  Bot,
  Clock3,
  DatabaseBackup,
  FileArchive,
  LoaderCircle,
  Play,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react';
import type {
  NeuraCoCheckpoint,
  NeuraCoCheckpointRetention,
  NeuraCoCheckpointRestoreTarget,
  NeuraCoRecoverableTask,
  NeuraCoRecoverableTaskInspection,
  NeuraCoTaskResumeStrategy,
  NeuraCoTrashEntry
} from '../electron/ipc-contract';
import { formatImageBytes } from './image-attachments';

interface RecoveryPanelProps {
  checkpoints: NeuraCoCheckpoint[];
  retention?: NeuraCoCheckpointRetention;
  trash: NeuraCoTrashEntry[];
  recoverableTasks: NeuraCoRecoverableTask[];
  busy: boolean;
  emergencyShortcut: string;
  onClose: () => void;
  onCreateCheckpoint: () => Promise<void>;
  onRestoreCheckpoint: (
    id: string,
    target: NeuraCoCheckpointRestoreTarget
  ) => Promise<void>;
  onUpdateRetention: (maxPerProject: number) => Promise<void>;
  onRestoreTrash: (id: string) => Promise<void>;
  onInspectTask: (id: string) => Promise<NeuraCoRecoverableTaskInspection>;
  onResumeTask: (id: string, strategy: NeuraCoTaskResumeStrategy) => Promise<void>;
  onDiscardTask: (id: string) => Promise<void>;
  onSaveEmergencyShortcut: (accelerator: string) => Promise<void>;
}

const formatDate = (value: string): string => (
  new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
);

export default function RecoveryPanel({
  checkpoints,
  retention,
  trash,
  recoverableTasks,
  busy,
  emergencyShortcut,
  onClose,
  onCreateCheckpoint,
  onRestoreCheckpoint,
  onUpdateRetention,
  onRestoreTrash,
  onInspectTask,
  onResumeTask,
  onDiscardTask,
  onSaveEmergencyShortcut
}: RecoveryPanelProps) {
  const [shortcut, setShortcut] = useState(emergencyShortcut);
  const [inspection, setInspection] = useState<NeuraCoRecoverableTaskInspection>();
  const [inspectingTaskId, setInspectingTaskId] = useState<string>();
  const [inspectionError, setInspectionError] = useState<string>();
  const [restoreTargets, setRestoreTargets] = useState<
    Record<string, NeuraCoCheckpointRestoreTarget>
  >({});
  const [retentionDraft, setRetentionDraft] = useState(
    String(retention?.maxPerProject || 30)
  );

  useEffect(() => setShortcut(emergencyShortcut), [emergencyShortcut]);
  useEffect(() => {
    if (retention) setRetentionDraft(String(retention.maxPerProject));
  }, [retention]);

  const inspectTask = async (taskId: string) => {
    setInspectingTaskId(taskId);
    setInspectionError(undefined);
    try {
      setInspection(await onInspectTask(taskId));
    } catch (error) {
      setInspectionError(
        error instanceof Error ? error.message : 'Vérification de reprise impossible.'
      );
    } finally {
      setInspectingTaskId(undefined);
    }
  };

  return (
    <div className="recovery-overlay" role="presentation">
      <section
        className="recovery-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
      >
        <header>
          <div>
            <DatabaseBackup size={20} />
            <div>
              <h2 id="recovery-title">Protection et restauration</h2>
              <p>Checkpoints locaux et corbeille récupérable du projet.</p>
            </div>
          </div>
          <button type="button" title="Fermer" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="recovery-content">
          <section className="recoverable-tasks">
            <header>
              <div>
                <Bot size={17} />
                <div>
                  <h3>Reprendre une tâche interrompue</h3>
                  <p>
                    Objectif, étapes, agents, budget, autorisations et état du projet
                    sont conservés localement.
                  </p>
                </div>
              </div>
            </header>
            {recoverableTasks.length === 0 ? (
              <div className="recovery-empty">Aucune tâche interrompue à reprendre.</div>
            ) : (
              <ul className="recovery-list recoverable-task-list">
                {recoverableTasks.map((task) => {
                  const completed = task.steps.filter(
                    (step) => step.status === 'completed'
                  ).length;
                  return (
                    <li key={task.id}>
                      <span className="recovery-item-icon">
                        {task.status === 'running'
                          ? <LoaderCircle className="is-spinning" size={16} />
                          : <Play size={16} />}
                      </span>
                      <div>
                        <strong>{task.objective}</strong>
                        <small>
                          {formatDate(task.updatedAt)} · {task.kind.replace('_', ' ')}
                          {' · '}
                          {completed}/{task.steps.length || '?'} étape(s)
                          {' · '}
                          {task.budgetConsumed}/{task.budgetAllocated || '?'} crédit(s)
                        </small>
                        {task.interruptionReason && <em>{task.interruptionReason}</em>}
                      </div>
                      <button
                        type="button"
                        disabled={busy || Boolean(inspectingTaskId)}
                        onClick={() => void inspectTask(task.id)}
                      >
                        {inspectingTaskId === task.id
                          ? <LoaderCircle className="is-spinning" size={15} />
                          : <Play size={15} />}
                        Vérifier
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        title="Archiver cette proposition de reprise"
                        onClick={() => void onDiscardTask(task.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {inspectionError && (
              <div className="recoverable-task-error">{inspectionError}</div>
            )}
            {inspection && (
              <div className="recoverable-task-inspection">
                <header>
                  {inspection.compatible
                    ? <DatabaseBackup size={16} />
                    : <AlertTriangle size={16} />}
                  <span>
                    <strong>
                      {inspection.compatible
                        ? 'Projet compatible avec la sauvegarde'
                        : 'Le projet a changé depuis l’interruption'}
                    </strong>
                    <small>
                      {inspection.compatible
                        ? 'La reprise peut continuer depuis la dernière étape enregistrée.'
                        : 'Examinez les différences et choisissez explicitement la stratégie.'}
                    </small>
                  </span>
                </header>
                {inspection.differences.length > 0 && (
                  <ul>
                    {inspection.differences.map((difference, index) => (
                      <li key={`${difference.kind}:${difference.path || index}`}>
                        {difference.message}
                      </li>
                    ))}
                  </ul>
                )}
                <footer>
                  <button type="button" onClick={() => setInspection(undefined)}>
                    Annuler
                  </button>
                  {inspection.compatible ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onResumeTask(
                        inspection.task.id,
                        'continue_with_changes'
                      )}
                    >
                      Reprendre
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onResumeTask(
                          inspection.task.id,
                          'continue_with_changes'
                        )}
                      >
                        Continuer avec les changements
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onResumeTask(
                          inspection.task.id,
                          'restart_from_current'
                        )}
                      >
                        Replanifier depuis l’état actuel
                      </button>
                    </>
                  )}
                </footer>
              </div>
            )}
          </section>

          <section className="emergency-shortcut-settings">
            <header>
              <div>
                <RotateCcw size={17} />
                <div>
                  <h3>Arrêt d’urgence global</h3>
                  <p>Fonctionne même lorsque NeuraCo contrôle une autre application.</p>
                </div>
              </div>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveEmergencyShortcut(shortcut);
              }}
            >
              <label htmlFor="emergency-shortcut">Raccourci Electron</label>
              <input
                id="emergency-shortcut"
                value={shortcut}
                onChange={(event) => setShortcut(event.target.value)}
                spellCheck={false}
              />
              <button type="submit" disabled={busy || shortcut.trim() === emergencyShortcut}>
                Enregistrer
              </button>
            </form>
          </section>

          <section>
            <header>
              <div>
                <FileArchive size={17} />
                <div>
                  <h3>Checkpoints</h3>
                  <p>
                    Protection locale supplémentaire : les secrets et dépendances lourdes
                    sont exclus. Git reste la source de versionnement du projet.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onCreateCheckpoint()}
              >
                <DatabaseBackup size={15} />
                Créer maintenant
              </button>
            </header>
            {retention && (
              <form
                className="checkpoint-retention"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onUpdateRetention(Number(retentionDraft));
                }}
              >
                <label htmlFor="checkpoint-retention">
                  Historique conservé par projet
                </label>
                <input
                  id="checkpoint-retention"
                  type="number"
                  min={retention.minimum}
                  max={retention.maximum}
                  value={retentionDraft}
                  onChange={(event) => setRetentionDraft(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={
                    busy
                    || Number(retentionDraft) === retention.maxPerProject
                    || Number(retentionDraft) < retention.minimum
                    || Number(retentionDraft) > retention.maximum
                  }
                >
                  Enregistrer
                </button>
                <small>
                  Entre {retention.minimum} et {retention.maximum}. Les plus anciens
                  sont supprimés automatiquement.
                </small>
              </form>
            )}
            {checkpoints.length === 0 ? (
              <div className="recovery-empty">Aucun checkpoint pour ce projet.</div>
            ) : (
              <ul className="recovery-list">
                {checkpoints.map((checkpoint) => (
                  <li key={checkpoint.id}>
                    <span className="recovery-item-icon"><Clock3 size={16} /></span>
                    <div>
                      <strong>{checkpoint.reason}</strong>
                      <small>
                        {formatDate(checkpoint.createdAt)} · {checkpoint.type === 'project'
                          ? 'Projet'
                          : checkpoint.relativePath}
                        {' · '}
                        {formatImageBytes(checkpoint.size)}
                      </small>
                      <small>
                        Fichiers
                        {checkpoint.hasConversation ? ' · Conversation' : ''}
                        {checkpoint.hasTaskSettings ? ' · Réglages de tâche' : ''}
                      </small>
                    </div>
                    <select
                      aria-label={`Portée de restauration ${checkpoint.reason}`}
                      value={restoreTargets[checkpoint.id] || 'all'}
                      onChange={(event) => setRestoreTargets((current) => ({
                        ...current,
                        [checkpoint.id]: event.target.value as NeuraCoCheckpointRestoreTarget
                      }))}
                      disabled={busy}
                    >
                      <option value="all">Tout restaurer</option>
                      <option value="files">Fichiers uniquement</option>
                      <option
                        value="conversation"
                        disabled={!checkpoint.hasConversation}
                      >
                        Conversation uniquement
                      </option>
                      <option
                        value="task_settings"
                        disabled={!checkpoint.hasTaskSettings}
                      >
                        Réglages uniquement
                      </option>
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      title="Restaurer ce checkpoint"
                      onClick={() => void onRestoreCheckpoint(
                        checkpoint.id,
                        restoreTargets[checkpoint.id] || 'all'
                      )}
                    >
                      <RotateCcw size={15} />
                      Restaurer
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <header>
              <div>
                <Trash2 size={17} />
                <div>
                  <h3>Corbeille NeuraCo</h3>
                  <p>Les suppressions restent récupérables et séparées du projet.</p>
                </div>
              </div>
            </header>
            {trash.length === 0 ? (
              <div className="recovery-empty">La corbeille du projet est vide.</div>
            ) : (
              <ul className="recovery-list">
                {trash.map((entry) => (
                  <li key={entry.id}>
                    <span className="recovery-item-icon"><ArchiveRestore size={16} /></span>
                    <div>
                      <strong>{entry.relativePath}</strong>
                      <small>
                        {formatDate(entry.deletedAt)} · {entry.kind === 'file' ? 'Fichier' : 'Dossier'}
                        {entry.size > 0 ? ` · ${formatImageBytes(entry.size)}` : ''}
                      </small>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      title="Restaurer cet élément"
                      onClick={() => void onRestoreTrash(entry.id)}
                    >
                      <ArchiveRestore size={15} />
                      Restaurer
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
