import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  CheckCheck,
  CircleX,
  FilePenLine,
  GitMerge,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  SearchCode
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  NeuraCoProjectSnapshot,
  NeuraCoReviewChangeKind,
  NeuraCoReviewFileDecision,
  NeuraCoReviewItem,
  NeuraCoReviewStatus
} from '../electron/ipc-contract';

interface ReviewQueuePanelProps {
  snapshot: NeuraCoProjectSnapshot;
  emergencyStopped: boolean;
  onProjectRefresh: () => Promise<void>;
  onStatus: (message: string) => void;
  onOpenFile: (filePath: string) => void;
}

const STATUS_LABELS: Record<NeuraCoReviewStatus, string> = {
  pending: 'À examiner',
  reviewing: 'En cours de révision',
  changes_requested: 'Modifications demandées',
  approved: 'Approuvé',
  refused: 'Refusé',
  merged: 'Fusionné',
  archived: 'Archivé'
};

const RISK_LABELS = {
  low: 'Faible',
  medium: 'Moyen',
  high: 'Élevé',
  critical: 'Critique'
} as const;

const CHANGE_LABELS: Record<NeuraCoReviewChangeKind, string> = {
  proposed: 'proposé',
  modified: 'modifié',
  created: 'créé',
  deleted: 'supprimé',
  renamed: 'renommé'
};

export default function ReviewQueuePanel({
  snapshot,
  emergencyStopped,
  onProjectRefresh,
  onStatus,
  onOpenFile
}: ReviewQueuePanelProps) {
  const [items, setItems] = useState<NeuraCoReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [commentFile, setCommentFile] = useState('');
  const [commentLine, setCommentLine] = useState(1);
  const [commentBody, setCommentBody] = useState('');

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0],
    [items, selectedId]
  );

  const refresh = async () => {
    if (!window.neuraco) return;
    setBusy('Chargement');
    setError(undefined);
    try {
      const loaded = await window.neuraco.listReviewQueue(includeArchived);
      setItems(loaded);
      setSelectedId((current) => (
        loaded.some((item) => item.id === current) ? current : loaded[0]?.id
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'File de révision indisponible.');
    } finally {
      setBusy(undefined);
    }
  };

  useEffect(() => {
    void refresh();
  }, [includeArchived, snapshot.project.id]);

  useEffect(() => {
    setCommentFile(selected?.files[0]?.path || '');
  }, [selected?.id]);

  const replaceItem = (updated: NeuraCoReviewItem) => {
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const execute = async (
    label: string,
    operation: () => Promise<void>
  ) => {
    if (busy || emergencyStopped) return;
    setBusy(label);
    setError(undefined);
    try {
      await operation();
      onStatus(`${label} terminé.`);
    } catch (operationError) {
      const message = operationError instanceof Error
        ? operationError.message
        : `${label} a échoué.`;
      setError(message);
      onStatus(message);
    } finally {
      setBusy(undefined);
    }
  };

  const setStatus = async (status: NeuraCoReviewStatus) => {
    if (!window.neuraco || !selected) return;
    await execute(STATUS_LABELS[status], async () => {
      replaceItem(await window.neuraco!.updateReviewStatus(selected.id, status));
      if (status === 'archived' && !includeArchived) await refresh();
    });
  };

  const decideFile = async (
    filePath: string,
    decision: NeuraCoReviewFileDecision
  ) => {
    if (!window.neuraco || !selected) return;
    await execute('Décision de fichier', async () => {
      replaceItem(await window.neuraco!.decideReviewFile({
        itemId: selected.id,
        filePath,
        decision
      }));
    });
  };

  const decideHunk = async (
    filePath: string,
    hunkId: string,
    decision: NeuraCoReviewFileDecision
  ) => {
    if (!window.neuraco || !selected) return;
    await execute('Décision de bloc', async () => {
      replaceItem(await window.neuraco!.decideReviewHunk({
        itemId: selected.id,
        filePath,
        hunkId,
        decision
      }));
    });
  };

  const decideAll = async (decision: 'accepted' | 'refused') => {
    if (!window.neuraco || !selected) return;
    await execute(
      decision === 'accepted' ? 'Acceptation complète' : 'Refus complet',
      async () => {
        replaceItem(await window.neuraco!.decideAllReviewChanges({
          itemId: selected.id,
          decision
        }));
      }
    );
  };

  const addComment = async () => {
    if (!window.neuraco || !selected || !commentFile || !commentBody.trim()) return;
    await execute('Commentaire', async () => {
      replaceItem(await window.neuraco!.addReviewComment({
        itemId: selected.id,
        filePath: commentFile,
        line: commentLine,
        body: commentBody.trim()
      }));
      setCommentBody('');
    });
  };

  const branchWorktreePath = async (branch: string): Promise<string | undefined> => {
    const git = await window.neuraco!.getGitStatus();
    return git.worktrees.find((worktree) => worktree.branch === branch)?.path;
  };

  const runTests = async () => {
    if (!window.neuraco || !selected?.branch) return;
    await execute('Tests de la branche', async () => {
      const tests = await window.neuraco!.runGitTestSuite(
        await branchWorktreePath(selected.branch!)
      );
      replaceItem(await window.neuraco!.recordReviewTests(selected.id, tests));
      if (tests.some((test) => !test.passed)) {
        throw new Error('Au moins un test a échoué. La fusion reste bloquée.');
      }
    });
  };

  const merge = async () => {
    if (!window.neuraco || !selected?.branch) return;
    await execute('Fusion contrôlée', async () => {
      let reviewItem = selected;
      if (!reviewItem.checkpointId) {
        const checkpoint = await window.neuraco!.createCheckpoint(
          `Avant la fusion Git de ${selected.branch}`
        );
        reviewItem = await window.neuraco!.attachReviewCheckpoint(
          selected.id,
          checkpoint.id
        );
        replaceItem(reviewItem);
      }
      const tests = await window.neuraco!.runGitTestSuite(
        await branchWorktreePath(selected.branch!)
      );
      reviewItem = await window.neuraco!.recordReviewTests(selected.id, tests);
      replaceItem(reviewItem);
      if (tests.some((test) => !test.passed)) {
        throw new Error('La fusion est bloquée car un test a échoué.');
      }
      const independentReview = await window.neuraco!.reviewGitBranch(selected.branch!);
      if (!independentReview.approved) {
        replaceItem(await window.neuraco!.updateReviewStatus(
          selected.id,
          'changes_requested'
        ));
        throw new Error('La revue indépendante a refusé la fusion.');
      }
      replaceItem(await window.neuraco!.updateReviewStatus(selected.id, 'approved'));
      await window.neuraco!.mergeGitBranch(selected.branch!);
      replaceItem(await window.neuraco!.updateReviewStatus(selected.id, 'merged'));
      await onProjectRefresh();
    });
  };

  const restore = async () => {
    if (!window.neuraco || !selected?.checkpointId) return;
    await execute('Restauration', async () => {
      await window.neuraco!.restoreCheckpoint(selected.checkpointId!);
      replaceItem(await window.neuraco!.updateReviewStatus(selected.id, 'archived'));
      await onProjectRefresh();
    });
  };

  const rerun = async () => {
    if (!window.neuraco || !selected?.rerun) return;
    await execute('Relance des agents', async () => {
      const files = await Promise.all(
        selected.rerun!.filePaths.slice(0, 16).map((filePath) => (
          window.neuraco!.readProjectFile(filePath)
        ))
      );
      await window.neuraco!.runMultiAgentTask({
        objective: [
          selected.rerun!.objective,
          'Une correction a été demandée depuis la file de révision.',
          ...selected.comments.map((comment) => (
            `${comment.filePath}:${comment.line} - ${comment.body}`
          ))
        ].join('\n\n').slice(0, 12_000),
        projectId: snapshot.project.id,
        projectName: snapshot.project.name,
        selectedAgentIds: selected.rerun!.selectedAgentIds,
        maxAgents: selected.rerun!.maxAgents,
        budget: selected.rerun!.budget,
        files: files.map((file) => ({
          path: file.relativePath,
          content: file.content,
          language: file.language
        }))
      });
      await window.neuraco!.updateReviewStatus(selected.id, 'changes_requested');
      await refresh();
    });
  };

  return (
    <div className="review-queue-view">
      <header className="review-queue-heading">
        <div>
          <SearchCode size={20} />
          <span>
            <strong>À examiner</strong>
            <small>Résultats isolés avant correction, validation ou fusion.</small>
          </span>
        </div>
        <label>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Archives
        </label>
        <button type="button" onClick={() => void refresh()} title="Actualiser">
          <RefreshCw size={15} />
        </button>
      </header>

      <div className="review-queue-body">
        <aside className="review-queue-list">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={selected?.id === item.id ? 'is-selected' : ''}
              onClick={() => setSelectedId(item.id)}
            >
              <span>
                <strong>{item.task}</strong>
                <small>{item.projectName} · {item.agent}</small>
              </span>
              <em className={`is-${item.status}`}>{STATUS_LABELS[item.status]}</em>
            </button>
          ))}
          {!busy && items.length === 0 && (
            <p>Aucun résultat en attente de révision.</p>
          )}
        </aside>

        <main className="review-queue-detail">
          {error && <div className="multi-agent-error">{error}</div>}
          {selected ? (
            <>
              <header>
                <div>
                  <strong>{selected.task}</strong>
                  <span>{STATUS_LABELS[selected.status]}</span>
                </div>
                <p>
                  {selected.agent} · {new Date(selected.createdAt).toLocaleString()}
                  {' · '}{Math.round(selected.durationMs / 1000)} s
                  {' · '}{selected.creditsUsed} crédit(s)
                </p>
              </header>

              <div className="review-metadata">
                <span>Risque : <b className={`risk-${selected.risk}`}>
                  {RISK_LABELS[selected.risk]}
                </b></span>
                <span>Source : {selected.source}</span>
                <span>Permissions : {selected.permissions.join(', ') || 'aucune'}</span>
                {selected.branch && <span>Branche : <code>{selected.branch}</code></span>}
              </div>

              <section className="review-summary">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.summary}</ReactMarkdown>
                <details>
                  <summary>Résultat complet</summary>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.result}</ReactMarkdown>
                </details>
                {selected.risks.length > 0 && (
                  <p><strong>Risques :</strong> {selected.risks.join(' · ')}</p>
                )}
              </section>

              <section className="review-files">
                <div className="review-section-heading">
                  <h3>Fichiers</h3>
                  {selected.files.length > 0 && (
                    <span>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void decideAll('accepted')}
                      >
                        <CheckCheck size={13} /> Accepter tout
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void decideAll('refused')}
                      >
                        <CircleX size={13} /> Refuser tout
                      </button>
                    </span>
                  )}
                </div>
                {selected.files.map((file) => (
                  <div key={file.path}>
                    <code>{file.path}</code>
                    <span>{CHANGE_LABELS[file.changeKind]}</span>
                    <button
                      type="button"
                      onClick={() => onOpenFile(file.path)}
                      title="Modifier manuellement dans l’éditeur"
                    >
                      <FilePenLine size={13} />
                    </button>
                    <select
                      value={file.decision}
                      disabled={Boolean(busy)}
                      onChange={(event) => void decideFile(
                        file.path,
                        event.target.value as NeuraCoReviewFileDecision
                      )}
                    >
                      <option value="pending">À décider</option>
                      <option value="accepted">Accepter</option>
                      <option value="refused">Refuser</option>
                    </select>
                  </div>
                ))}
                {selected.files.length === 0 && <p>Aucun fichier local modifié.</p>}
              </section>

              <section className="review-tests">
                <h3>Tests</h3>
                {selected.tests.map((test) => (
                  <details key={test.label}>
                    <summary>{test.status} · {test.label}</summary>
                    {test.output && <pre>{test.output}</pre>}
                  </details>
                ))}
                {selected.tests.length === 0 && <p>Aucun test exécuté.</p>}
              </section>

              {selected.diff?.patch && (
                <section className="review-diff">
                  <div className="review-section-heading">
                    <h3>Différences avant / après</h3>
                    <span className="review-diff-totals">
                      <b>+{selected.diff.insertions}</b>
                      <em>-{selected.diff.deletions}</em>
                      {selected.diff.truncated && <i>Diff tronqué</i>}
                    </span>
                  </div>
                  {selected.diffFiles?.map((file) => (
                    <article className="review-diff-file" key={file.path}>
                      <header>
                        <span>
                          <code>{file.path}</code>
                          {file.changeKind === 'renamed' && (
                            <small>{file.oldPath} → {file.newPath}</small>
                          )}
                        </span>
                        <span>
                          <small>{CHANGE_LABELS[file.changeKind]}</small>
                          <b>+{file.addedLines}</b>
                          <em>-{file.removedLines}</em>
                          <button
                            type="button"
                            onClick={() => void decideFile(file.path, 'accepted')}
                            disabled={Boolean(busy)}
                          >
                            Accepter le fichier
                          </button>
                          <button
                            type="button"
                            onClick={() => void decideFile(file.path, 'refused')}
                            disabled={Boolean(busy)}
                          >
                            Refuser le fichier
                          </button>
                        </span>
                      </header>
                      {file.hunks.map((hunk) => {
                        const before = hunk.lines.filter((line) => line.kind !== 'addition');
                        const after = hunk.lines.filter((line) => line.kind !== 'deletion');
                        return (
                          <section className="review-diff-hunk" key={hunk.id}>
                            <header>
                              <code>{hunk.header}</code>
                              <span>
                                <b>+{hunk.addedLines}</b>
                                <em>-{hunk.removedLines}</em>
                                <select
                                  value={hunk.decision}
                                  disabled={Boolean(busy)}
                                  onChange={(event) => void decideHunk(
                                    file.path,
                                    hunk.id,
                                    event.target.value as NeuraCoReviewFileDecision
                                  )}
                                  aria-label={`Décision du bloc ${hunk.header}`}
                                >
                                  <option value="pending">À décider</option>
                                  <option value="accepted">Accepter le bloc</option>
                                  <option value="refused">Refuser le bloc</option>
                                </select>
                              </span>
                            </header>
                            <div className="review-diff-columns">
                              <div>
                                <strong>Avant</strong>
                                <pre>
                                  {before.map((line, index) => (
                                    <button
                                      type="button"
                                      key={`${hunk.id}-before-${index}`}
                                      className={line.kind}
                                      onClick={() => {
                                        setCommentFile(file.oldPath);
                                        setCommentLine(line.oldLine || hunk.oldStart);
                                      }}
                                      title="Commenter cette ligne"
                                    >
                                      <i>{line.oldLine || ''}</i>
                                      <code>{line.content || ' '}</code>
                                    </button>
                                  ))}
                                </pre>
                              </div>
                              <div>
                                <strong>Après</strong>
                                <pre>
                                  {after.map((line, index) => (
                                    <button
                                      type="button"
                                      key={`${hunk.id}-after-${index}`}
                                      className={line.kind}
                                      onClick={() => {
                                        setCommentFile(file.newPath);
                                        setCommentLine(line.newLine || hunk.newStart);
                                      }}
                                      title="Commenter cette ligne"
                                    >
                                      <i>{line.newLine || ''}</i>
                                      <code>{line.content || ' '}</code>
                                    </button>
                                  ))}
                                </pre>
                              </div>
                            </div>
                          </section>
                        );
                      })}
                    </article>
                  ))}
                  {!selected.diffFiles?.length && (
                    <details>
                      <summary>Patch brut (format non structuré)</summary>
                      <pre>{selected.diff.patch}</pre>
                    </details>
                  )}
                </section>
              )}

              <section className="review-comments">
                <h3><MessageSquare size={15} /> Commentaires de ligne</h3>
                {selected.comments.map((comment) => (
                  <p key={comment.id}>
                    <code>{comment.filePath}:{comment.line}</code> {comment.body}
                  </p>
                ))}
                {selected.files.length > 0 && (
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    void addComment();
                  }}>
                    <select
                      value={commentFile}
                      onChange={(event) => setCommentFile(event.target.value)}
                    >
                      {selected.files.map((file) => (
                        <option key={file.path} value={file.path}>{file.path}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={commentLine}
                      onChange={(event) => setCommentLine(Number(event.target.value))}
                      aria-label="Ligne"
                    />
                    <input
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      placeholder="Demander à l’agent de corriger ce passage…"
                    />
                    <button type="submit" disabled={!commentBody.trim() || Boolean(busy)}>
                      Ajouter
                    </button>
                  </form>
                )}
              </section>

              <footer className="review-actions">
                <button type="button" onClick={() => void setStatus('reviewing')}>
                  <SearchCode size={14} /> Examiner
                </button>
                <button type="button" onClick={() => void setStatus('changes_requested')}>
                  <RefreshCw size={14} /> Demander une correction
                </button>
                {selected.rerun && (
                  <button type="button" onClick={() => void rerun()}>
                    <Play size={14} /> Relancer les agents
                  </button>
                )}
                {selected.branch && (
                  <button type="button" onClick={() => void runTests()}>
                    <Play size={14} /> Lancer les tests
                  </button>
                )}
                <button type="button" onClick={() => void setStatus('approved')}>
                  <Check size={14} /> Approuver
                </button>
                <button type="button" onClick={() => void setStatus('refused')}>
                  <CircleX size={14} /> Refuser
                </button>
                {selected.branch && (
                  <button type="button" className="is-primary" onClick={() => void merge()}>
                    <GitMerge size={14} /> Tester, réviser et fusionner
                  </button>
                )}
                {selected.checkpointId && (
                  <button type="button" onClick={() => void restore()}>
                    <RotateCcw size={14} /> Restaurer
                  </button>
                )}
                <button type="button" onClick={() => void setStatus('archived')}>
                  <Archive size={14} /> Archiver
                </button>
              </footer>
            </>
          ) : (
            <div className="multi-agent-empty">
              <SearchCode size={30} />
              <p>Les tâches terminées apparaîtront ici avant toute application.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
