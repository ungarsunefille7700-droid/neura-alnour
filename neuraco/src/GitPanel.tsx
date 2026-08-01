import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  FileDiff,
  FlaskConical,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  NeuraCoGitDiff,
  NeuraCoGitReview,
  NeuraCoGitStatus,
  NeuraCoGitTestCommand,
  NeuraCoGitTestResult,
  NeuraCoGitWorktree,
  NeuraCoForgeInbox,
  NeuraCoForgeInboxItem,
  NeuraCoForgeIssue,
  NeuraCoForgePullRequestResult,
  NeuraCoProjectSnapshot
} from '../electron/ipc-contract';

interface GitPanelProps {
  snapshot: NeuraCoProjectSnapshot;
  emergencyStopped: boolean;
  onProjectRefresh: () => Promise<void>;
  onStatus: (message: string) => void;
  onDelegateIssue: (issue: NeuraCoForgeIssue) => Promise<void>;
}

const shortHash = (value: string): string => value ? value.slice(0, 8) : '—';

export default function GitPanel({
  snapshot,
  emergencyStopped,
  onProjectRefresh,
  onStatus,
  onDelegateIssue
}: GitPanelProps) {
  const [gitStatus, setGitStatus] = useState<NeuraCoGitStatus>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [diff, setDiff] = useState<NeuraCoGitDiff>();
  const [commands, setCommands] = useState<NeuraCoGitTestCommand[]>([]);
  const [tests, setTests] = useState<NeuraCoGitTestResult[]>([]);
  const [review, setReview] = useState<NeuraCoGitReview>();
  const [taskId, setTaskId] = useState(`task-${Date.now()}`);
  const [agentId, setAgentId] = useState('developer');
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [forgeInbox, setForgeInbox] = useState<NeuraCoForgeInbox>();
  const [forgeFilter, setForgeFilter] = useState<'all' | NeuraCoForgeInboxItem['kind']>('all');
  const [selectedIssue, setSelectedIssue] = useState<NeuraCoForgeIssue>();
  const [pullRequestTitle, setPullRequestTitle] = useState('');
  const [pullRequestBody, setPullRequestBody] = useState('');
  const [pullRequestDraft, setPullRequestDraft] = useState(true);
  const [pullRequest, setPullRequest] = useState<NeuraCoForgePullRequestResult>();

  const selected = useMemo(() => (
    gitStatus?.worktrees.find((worktree) => worktree.path === selectedPath)
    || gitStatus?.worktrees[0]
  ), [gitStatus, selectedPath]);

  const execute = async <T,>(
    label: string,
    action: () => Promise<T>
  ): Promise<T | undefined> => {
    setBusy(label);
    setError(undefined);
    try {
      return await action();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : `${label} a échoué.`;
      setError(message);
      onStatus(message);
      return undefined;
    } finally {
      setBusy(undefined);
    }
  };

  const refresh = async () => {
    if (!window.neuraco) return;
    const status = await execute('Actualisation Git', () => window.neuraco!.getGitStatus());
    if (!status) return;
    setGitStatus(status);
    setSelectedPath((current) => {
      if (current && status.worktrees.some((worktree) => worktree.path === current)) return current;
      return status.worktrees.find((worktree) => !worktree.isMain)?.path
        || status.worktrees[0]?.path;
    });
  };

  useEffect(() => {
    void refresh();
    if (window.neuraco) {
      void window.neuraco.getForgeConnection().then((connection) => {
        setForgeInbox({
          connection,
          items: [],
          warnings: [],
          fetchedAt: new Date().toISOString()
        });
      }).catch(() => undefined);
    }
  }, [snapshot.project.id]);

  useEffect(() => {
    if (!window.neuraco || !selected) return;
    setDiff(undefined);
    setTests([]);
    setReview(undefined);
    setPullRequest(undefined);
    setPullRequestTitle('');
    setPullRequestBody('');
    void window.neuraco.listGitTestCommands(
      selected.isMain ? undefined : selected.path
    ).then(setCommands).catch((commandError) => {
      setError(commandError instanceof Error ? commandError.message : 'Tests indisponibles.');
    });
  }, [selected?.path]);

  const createWorktree = async () => {
    if (!window.neuraco || emergencyStopped) return;
    const created = await execute('Création du worktree', () => (
      window.neuraco!.createGitWorktree({ taskId, agentId })
    ));
    if (!created) return;
    await refresh();
    setSelectedPath(created.path);
    setTaskId(`task-${Date.now()}`);
    onStatus(`Worktree isolé créé sur ${created.branch}.`);
  };

  const loadDiff = async () => {
    if (!window.neuraco || !selected) return;
    const loaded = await execute('Lecture du diff', () => (
      window.neuraco!.getGitDiff(selected.isMain ? undefined : selected.branch)
    ));
    if (loaded) setDiff(loaded);
  };

  const commit = async () => {
    if (!window.neuraco || !selected || selected.isMain || !commitMessage.trim()) return;
    const result = await execute('Création du commit', () => (
      window.neuraco!.commitGitWorktree(selected.path, commitMessage)
    ));
    if (!result) return;
    setCommitMessage('');
    setTests([]);
    setReview(undefined);
    await refresh();
    await loadDiff();
    onStatus(`Commit ${shortHash(result.commit)} créé sur ${result.branch}.`);
  };

  const runAllTests = async () => {
    if (!window.neuraco || !selected || emergencyStopped) return;
    const results = await execute('Exécution des tests', () => (
      window.neuraco!.runGitTestSuite(selected.isMain ? undefined : selected.path)
    ));
    if (!results) return;
    setTests(results);
    setReview(undefined);
    const passed = results.filter((test) => test.passed).length;
    onStatus(`${passed}/${results.length} commande(s) Git validée(s).`);
  };

  const runReview = async () => {
    if (!window.neuraco || !selected || selected.isMain || emergencyStopped) return;
    const reviewed = await execute('Revue indépendante', () => (
      window.neuraco!.reviewGitBranch(selected.branch)
    ));
    if (reviewed) {
      setReview(reviewed);
      setDiff(reviewed.diff);
      onStatus(
        reviewed.approved
          ? `Revue favorable par ${reviewed.model}.`
          : `La revue ${reviewed.model} bloque la fusion.`
      );
    }
  };

  const merge = async () => {
    if (!window.neuraco || !selected || selected.isMain || emergencyStopped) return;
    const result = await execute('Fusion contrôlée', () => (
      window.neuraco!.mergeGitBranch(selected.branch)
    ));
    if (!result) return;
    await refresh();
    await onProjectRefresh();
    onStatus(`Fusion validée dans ${result.targetBranch}: ${shortHash(result.commit)}.`);
  };

  const remove = async (worktree: NeuraCoGitWorktree) => {
    if (!window.neuraco || worktree.isMain || emergencyStopped) return;
    const removed = await execute('Suppression du worktree', () => (
      window.neuraco!.removeGitWorktree(worktree.path)
    ));
    if (removed) {
      await refresh();
      onStatus(`Worktree ${worktree.branch} supprimé.`);
    }
  };

  const refreshForgeInbox = async () => {
    if (!window.neuraco || emergencyStopped) return;
    const inbox = await execute('Actualisation GitHub/GitLab', () => (
      window.neuraco!.getForgeInbox()
    ));
    if (!inbox) return;
    setForgeInbox(inbox);
    onStatus(
      inbox.connection.authenticated
        ? `${inbox.items.length} élément(s) distant(s) chargé(s).`
        : inbox.connection.message
    );
  };

  const inspectIssue = async (item: NeuraCoForgeInboxItem) => {
    if (!window.neuraco || item.kind !== 'issue' || !item.number) return;
    const issue = await execute(`Lecture de l’issue #${item.number}`, () => (
      window.neuraco!.getForgeIssue(item.number!)
    ));
    if (issue) setSelectedIssue(issue);
  };

  const delegateIssue = async () => {
    if (!selectedIssue || emergencyStopped) return;
    await onDelegateIssue(selectedIssue);
    setSelectedIssue(undefined);
  };

  const openRemoteItem = async (item: NeuraCoForgeInboxItem) => {
    if (!window.neuraco || !item.url) return;
    await execute('Ouverture du lien distant', () => window.neuraco!.newBrowserTab(item.url));
    onStatus('Le lien est prêt dans l’onglet Navigateur de NeuraCo.');
  };

  const createPullRequest = async () => {
    if (
      !window.neuraco
      || !selected
      || selected.isMain
      || !pullRequestTitle.trim()
      || emergencyStopped
    ) return;
    const created = await execute('Création de la pull request', () => (
      window.neuraco!.createForgePullRequest({
        branch: selected.branch,
        baseBranch: diff?.baseBranch || gitStatus.branch,
        title: pullRequestTitle.trim(),
        body: pullRequestBody.trim(),
        draft: pullRequestDraft
      })
    ));
    if (!created) return;
    setPullRequest(created);
    onStatus(`Pull request #${created.number || ''} créée et laissée à examiner.`);
  };

  const filteredForgeItems = (forgeInbox?.items || []).filter((item) => (
    forgeFilter === 'all' || item.kind === forgeFilter
  ));

  if (!gitStatus) {
    return (
      <div className="git-panel-loading">
        <LoaderCircle size={24} />
        Vérification de Git…
      </div>
    );
  }

  if (!gitStatus.installed || !gitStatus.repository) {
    return (
      <div className="git-panel-empty">
        <GitBranch size={34} />
        <h2>{gitStatus.installed ? 'Projet sans dépôt Git' : 'Git indisponible'}</h2>
        <p>{gitStatus.error}</p>
        <button type="button" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          Revérifier
        </button>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <header className="git-panel-header">
        <div>
          <GitBranch size={19} />
          <span>
            <strong>{gitStatus.branch}</strong>
            <small>
              {shortHash(gitStatus.head)} · {gitStatus.dirty ? 'modifications locales' : 'propre'}
            </small>
          </span>
        </div>
        <div className="git-status-counts">
          <span>{gitStatus.staged} indexé(s)</span>
          <span>{gitStatus.unstaged} modifié(s)</span>
          <span>{gitStatus.untracked} non suivi(s)</span>
          <button type="button" title="Actualiser Git" onClick={() => void refresh()}>
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {error && <div className="git-panel-error">{error}</div>}

      <section className="forge-inbox">
        <header>
          <div>
            <Bell size={16} />
            <span>
              <strong>Boîte de réception distante</strong>
              <small>{forgeInbox?.connection.message || 'Détection de GitHub/GitLab…'}</small>
            </span>
          </div>
          <button
            type="button"
            disabled={Boolean(busy) || emergencyStopped}
            onClick={() => void refreshForgeInbox()}
          >
            <RefreshCw size={14} />
            Actualiser
          </button>
        </header>

        {forgeInbox?.connection.authenticated && (
          <>
            <div className="forge-filters" role="tablist" aria-label="Filtrer la boîte de réception">
              {([
                ['all', 'Tout'],
                ['issue', 'Issues'],
                ['pull_request', 'PR/MR'],
                ['comment', 'Commentaires'],
                ['ci', 'CI'],
                ['security', 'Sécurité'],
                ['dependency', 'Dépendances']
              ] as const).map(([kind, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={forgeFilter === kind}
                  className={forgeFilter === kind ? 'is-selected' : ''}
                  key={kind}
                  onClick={() => setForgeFilter(kind)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="forge-inbox-list">
              {filteredForgeItems.length === 0 ? (
                <p>
                  {forgeInbox.items.length === 0
                    ? 'Actualisez pour charger les événements distants.'
                    : 'Aucun élément dans ce filtre.'}
                </p>
              ) : filteredForgeItems.map((item) => (
                <article key={item.id}>
                  <span className={`forge-kind forge-kind-${item.kind}`}>
                    {item.kind === 'issue' && <CircleDot size={14} />}
                    {item.kind === 'pull_request' && <GitPullRequest size={14} />}
                    {item.kind === 'comment' && <MessageSquare size={14} />}
                    {item.kind === 'ci' && <AlertTriangle size={14} />}
                    {item.kind === 'security' && <ShieldAlert size={14} />}
                    {item.kind === 'dependency' && <ShieldAlert size={14} />}
                  </span>
                  <button
                    type="button"
                    className="forge-item-main"
                    onClick={() => item.kind === 'issue'
                      ? void inspectIssue(item)
                      : void openRemoteItem(item)}
                  >
                    <strong>{item.title}</strong>
                    <small>
                      {item.number ? `#${item.number} · ` : ''}
                      {item.author || item.branch || item.state}
                    </small>
                  </button>
                  {item.url && (
                    <button
                      type="button"
                      className="forge-open"
                      title="Ouvrir dans le navigateur NeuraCo"
                      onClick={() => void openRemoteItem(item)}
                    >
                      <ExternalLink size={14} />
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        {forgeInbox && forgeInbox.warnings.length > 0 && (
          <details className="forge-warnings">
            <summary>{forgeInbox.warnings.length} source(s) distante(s) indisponible(s)</summary>
            <ul>
              {forgeInbox.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </details>
        )}
      </section>

      <div className="git-panel-body">
        <aside className="git-worktrees">
          <section className="git-create-worktree">
            <header>
              <strong>Nouveau worktree isolé</strong>
              <small>Une branche distincte par agent.</small>
            </header>
            <label>
              Tâche
              <input value={taskId} onChange={(event) => setTaskId(event.target.value)} />
            </label>
            <label>
              Agent
              <input value={agentId} onChange={(event) => setAgentId(event.target.value)} />
            </label>
            <button
              type="button"
              disabled={Boolean(busy) || emergencyStopped || taskId.length < 2 || agentId.length < 2}
              onClick={() => void createWorktree()}
            >
              <Plus size={15} />
              Créer
            </button>
          </section>

          <div className="git-worktree-list">
            {gitStatus.worktrees.map((worktree) => (
              <button
                type="button"
                key={worktree.path}
                className={selected?.path === worktree.path ? 'is-selected' : ''}
                onClick={() => setSelectedPath(worktree.path)}
              >
                <GitBranch size={15} />
                <span>
                  <strong>{worktree.branch}</strong>
                  <small>
                    {worktree.isMain ? 'Projet principal' : 'Worktree agent'}
                    {' · '}
                    {worktree.dirty ? 'modifié' : 'propre'}
                  </small>
                </span>
                <em>{shortHash(worktree.head)}</em>
              </button>
            ))}
          </div>
        </aside>

        <main className="git-worktree-detail">
          {selected && (
            <>
              <header>
                <div>
                  <strong>{selected.branch}</strong>
                  <small title={selected.path}>{selected.path}</small>
                </div>
                <div>
                  {!selected.isMain && (
                    <>
                      <button
                        type="button"
                        title="Ouvrir dans l’Explorateur Windows"
                        onClick={() => void window.neuraco?.openGitWorktree(selected.path)}
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button
                        type="button"
                        title="Supprimer ce worktree propre"
                        disabled={selected.dirty || Boolean(busy)}
                        onClick={() => void remove(selected)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </header>

              {!selected.isMain && (
                <div className="git-commit-row">
                  <input
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    placeholder="Message du commit vérifiable"
                    disabled={Boolean(busy)}
                  />
                  <button
                    type="button"
                    disabled={!selected.dirty || !commitMessage.trim() || Boolean(busy)}
                    onClick={() => void commit()}
                  >
                    <GitCommit size={15} />
                    Commit
                  </button>
                </div>
              )}

              <div className="git-validation-actions">
                <button type="button" disabled={Boolean(busy)} onClick={() => void loadDiff()}>
                  <FileDiff size={15} />
                  Afficher le diff
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || commands.length === 0 || emergencyStopped}
                  onClick={() => void runAllTests()}
                >
                  <FlaskConical size={15} />
                  Tous les tests ({commands.length})
                </button>
                {!selected.isMain && (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(busy) || !diff?.filesChanged || emergencyStopped}
                      onClick={() => void runReview()}
                    >
                      <CheckCircle2 size={15} />
                      Revue indépendante
                    </button>
                    <button
                      type="button"
                      className="git-merge-button"
                      disabled={
                        Boolean(busy)
                        || !review?.approved
                        || tests.length === 0
                        || tests.some((test) => !test.passed)
                        || emergencyStopped
                      }
                      onClick={() => void merge()}
                    >
                      <GitMerge size={15} />
                      Fusionner
                    </button>
                  </>
                )}
              </div>

              {busy && (
                <div className="git-busy">
                  <LoaderCircle size={15} />
                  {busy}…
                </div>
              )}

              {commands.length > 0 && (
                <div className="git-command-list">
                  {commands.map((command) => (
                    <span key={command.id}>{command.label} · {command.command}</span>
                  ))}
                </div>
              )}

              {tests.length > 0 && (
                <div className="git-test-results">
                  {tests.map((test) => (
                    <details key={test.id} className={test.passed ? 'is-passed' : 'is-failed'}>
                      <summary>
                        {test.passed
                          ? <CheckCircle2 size={14} />
                          : <XCircle size={14} />}
                        <strong>{test.command}</strong>
                        <span>{test.durationMs} ms</span>
                      </summary>
                      <pre>{test.output || 'Commande terminée sans sortie.'}</pre>
                    </details>
                  ))}
                </div>
              )}

              {review && (
                <section className={`git-review ${review.approved ? 'is-approved' : 'is-refused'}`}>
                  <header>
                    {review.approved
                      ? <CheckCircle2 size={15} />
                      : <XCircle size={15} />}
                    <strong>{review.approved ? 'Revue favorable' : 'Fusion bloquée'}</strong>
                    <span>{review.model}</span>
                  </header>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{review.message}</ReactMarkdown>
                </section>
              )}

              {!selected.isMain && review?.approved && tests.length > 0
                && tests.every((test) => test.passed) && (
                <section className="forge-pull-request">
                  <header>
                    <GitPullRequest size={16} />
                    <span>
                      <strong>Soumettre à validation distante</strong>
                      <small>
                        La branche sera retestée et revue côté processus principal avant publication.
                        Elle ne sera jamais fusionnée automatiquement.
                      </small>
                    </span>
                  </header>
                  <input
                    value={pullRequestTitle}
                    onChange={(event) => setPullRequestTitle(event.target.value)}
                    placeholder="Titre de la pull request"
                    maxLength={240}
                  />
                  <textarea
                    value={pullRequestBody}
                    onChange={(event) => setPullRequestBody(event.target.value)}
                    placeholder="Résumé, tests effectués et risques connus"
                    rows={4}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={pullRequestDraft}
                      onChange={(event) => setPullRequestDraft(event.target.checked)}
                    />
                    Créer en brouillon
                  </label>
                  <button
                    type="button"
                    disabled={Boolean(busy) || !pullRequestTitle.trim()}
                    onClick={() => void createPullRequest()}
                  >
                    <GitPullRequest size={15} />
                    Créer la PR/MR
                  </button>
                  {pullRequest && (
                    <button
                      type="button"
                      className="forge-pr-result"
                      onClick={() => void openRemoteItem({
                        id: `created:${pullRequest.url}`,
                        kind: 'pull_request',
                        title: pullRequest.title,
                        summary: '',
                        state: pullRequest.draft ? 'draft' : 'open',
                        url: pullRequest.url,
                        requiresReview: true
                      })}
                    >
                      <CheckCircle2 size={14} />
                      Ouvrir la PR/MR #{pullRequest.number || ''}
                    </button>
                  )}
                </section>
              )}

              {diff && (
                <section className="git-diff">
                  <header>
                    <strong>{diff.filesChanged} fichier(s)</strong>
                    <span>+{diff.insertions} / -{diff.deletions}</span>
                    {diff.truncated && <em>Diff tronqué à 200 Ko</em>}
                  </header>
                  <pre>{diff.patch || 'Aucune différence.'}</pre>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      {selectedIssue && (
        <div className="forge-issue-overlay" role="dialog" aria-modal="true">
          <section className="forge-issue-dialog">
            <header>
              <span>
                <strong>Issue #{selectedIssue.number} · {selectedIssue.title}</strong>
                <small>{selectedIssue.repository} · {selectedIssue.author || 'auteur inconnu'}</small>
              </span>
              <button type="button" onClick={() => setSelectedIssue(undefined)}>
                <XCircle size={17} />
              </button>
            </header>
            <div className="forge-issue-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {selectedIssue.body || '_Aucune description._'}
              </ReactMarkdown>
            </div>
            <ol className="forge-delegation-plan">
              <li>Analyser l’issue et ses commentaires.</li>
              <li>Présenter un plan, les fichiers concernés et les risques.</li>
              <li>Attendre votre validation dans le prévol NeuraCo.</li>
              <li>Travailler dans un worktree isolé, puis tester et préparer le commit.</li>
              <li>Ouvrir une PR/MR à examiner, sans fusion automatique.</li>
            </ol>
            <footer>
              <button type="button" onClick={() => setSelectedIssue(undefined)}>
                Annuler
              </button>
              <button
                type="button"
                disabled={emergencyStopped || Boolean(busy)}
                onClick={() => void delegateIssue()}
              >
                Déléguer avec prévalidation
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
