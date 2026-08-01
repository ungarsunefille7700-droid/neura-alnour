import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoGitStatus,
  NeuraCoMultiAgentProgress,
  NeuraCoMultiAgentResult,
  NeuraCoPermissionAction,
  NeuraCoPermissionMode,
  NeuraCoProject,
  NeuraCoProjectFileNode,
  NeuraCoProjectSnapshot,
  NeuraCoRecoverableProjectState,
  NeuraCoRecoverableTask,
  NeuraCoRecoverableTaskDifference,
  NeuraCoRecoverableTaskInspection,
  NeuraCoRecoverableTaskKind,
  NeuraCoRecoverableTaskResume,
  NeuraCoRecoverableTaskStep,
  NeuraCoTaskResumeStrategy
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

const MAX_TASKS = 200;
const MAX_FILES = 10_000;
const MAX_TEXT = 12_000;

interface RecoveryDocument {
  version: 1;
  tasks: Record<string, NeuraCoRecoverableTask>;
}

interface RecoverableTaskStart {
  id: string;
  project: NeuraCoProject;
  kind: NeuraCoRecoverableTaskKind;
  objective: string;
  agents: string[];
  budgetAllocated: number;
  permissionMode: NeuraCoPermissionMode;
  allowedActions: NeuraCoPermissionAction[];
  checkpointIds: string[];
  projectState: NeuraCoRecoverableProjectState;
  worktrees: NeuraCoRecoverableTask['worktrees'];
  files?: string[];
}

const emptyDocument = (): RecoveryDocument => ({ version: 1, tasks: {} });

const safeText = (value: unknown, maximum = MAX_TEXT): string => (
  redactSecrets(String(value || '')).trim().slice(0, maximum)
);

const safeId = (value: unknown): string => (
  String(value || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 180)
);

const flattenProjectFiles = (
  nodes: NeuraCoProjectFileNode[],
  output: Array<{ path: string; size: number }> = []
): Array<{ path: string; size: number }> => {
  for (const node of nodes) {
    if (output.length >= MAX_FILES) break;
    if (node.kind === 'file') {
      output.push({
        path: String(node.relativePath || '').replace(/\\/g, '/').slice(0, 1_000),
        size: Math.max(0, Math.floor(Number(node.size) || 0))
      });
    } else if (node.children) {
      flattenProjectFiles(node.children, output);
    }
  }
  return output;
};

export const captureRecoverableProjectState = (
  snapshot: NeuraCoProjectSnapshot,
  gitStatus?: NeuraCoGitStatus
): NeuraCoRecoverableProjectState => {
  const files = flattenProjectFiles(snapshot.files)
    .filter((file) => file.path)
    .sort((left, right) => left.path.localeCompare(right.path));
  const branch = gitStatus?.repository ? safeText(gitStatus.branch, 200) : undefined;
  const head = gitStatus?.repository ? safeText(gitStatus.head, 200) : undefined;
  const dirty = Boolean(gitStatus?.repository && gitStatus.dirty);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    branch,
    head,
    dirty,
    files
  })).digest('hex');
  return {
    fingerprint,
    branch,
    head,
    dirty,
    files,
    capturedAt: new Date().toISOString()
  };
};

const cleanStep = (step: NeuraCoRecoverableTaskStep): NeuraCoRecoverableTaskStep => ({
  id: safeId(step.id) || `step-${Date.now()}`,
  title: safeText(step.title, 2_000) || 'Étape sans titre',
  status: [
    'queued',
    'waiting',
    'running',
    'completed',
    'failed',
    'blocked',
    'cancelled'
  ].includes(step.status) ? step.status : 'queued',
  agent: safeText(step.agent, 240) || undefined,
  files: Array.isArray(step.files)
    ? [...new Set(step.files.map((file) => safeText(file, 1_000)).filter(Boolean))].slice(0, 128)
    : [],
  result: safeText(step.result, 8_000) || undefined
});

const cleanTask = (task: NeuraCoRecoverableTask): NeuraCoRecoverableTask => ({
  ...task,
  id: safeId(task.id),
  projectId: safeId(task.projectId),
  projectName: safeText(task.projectName, 240),
  objective: safeText(task.objective),
  plan: safeText(task.plan, 8_000) || undefined,
  interruptionReason: safeText(task.interruptionReason, 2_000) || undefined,
  steps: Array.isArray(task.steps) ? task.steps.slice(0, 100).map(cleanStep) : [],
  agents: Array.isArray(task.agents)
    ? [...new Set(task.agents.map((agent) => safeText(agent, 240)).filter(Boolean))].slice(0, 32)
    : [],
  worktrees: Array.isArray(task.worktrees) ? task.worktrees.slice(0, 32).map((worktree) => ({
    path: safeText(worktree.path, 2_000),
    branch: safeText(worktree.branch, 240),
    head: safeText(worktree.head, 240)
  })) : [],
  filesModified: Array.isArray(task.filesModified)
    ? [...new Set(task.filesModified.map((file) => safeText(file, 1_000)).filter(Boolean))].slice(0, 500)
    : [],
  commands: Array.isArray(task.commands)
    ? task.commands.map((command) => safeText(command, 2_000)).filter(Boolean).slice(0, 200)
    : [],
  results: Array.isArray(task.results)
    ? task.results.map((result) => safeText(result, 8_000)).filter(Boolean).slice(-100)
    : [],
  budgetAllocated: Math.max(0, Number(task.budgetAllocated) || 0),
  budgetConsumed: Math.max(0, Number(task.budgetConsumed) || 0),
  allowedActions: Array.isArray(task.allowedActions)
    ? task.allowedActions.filter((action): action is NeuraCoPermissionAction => (
      ['read_file', 'write_file', 'terminal', 'network', 'application'].includes(action)
    ))
    : [],
  checkpointIds: Array.isArray(task.checkpointIds)
    ? task.checkpointIds.map(safeId).filter(Boolean).slice(-50)
    : [],
  projectState: {
    ...task.projectState,
    fingerprint: safeId(task.projectState?.fingerprint),
    branch: safeText(task.projectState?.branch, 200) || undefined,
    head: safeText(task.projectState?.head, 200) || undefined,
    dirty: Boolean(task.projectState?.dirty),
    files: Array.isArray(task.projectState?.files)
      ? task.projectState.files.slice(0, MAX_FILES).map((file) => ({
        path: safeText(file.path, 1_000),
        size: Math.max(0, Math.floor(Number(file.size) || 0))
      })).filter((file) => file.path)
      : [],
    capturedAt: safeText(task.projectState?.capturedAt, 80) || new Date().toISOString()
  },
  createdAt: safeText(task.createdAt, 80) || new Date().toISOString(),
  updatedAt: safeText(task.updatedAt, 80) || new Date().toISOString()
});

export const compareRecoverableProjectState = (
  previous: NeuraCoRecoverableProjectState,
  current: NeuraCoRecoverableProjectState,
  expectedWorktrees: NeuraCoRecoverableTask['worktrees'],
  currentWorktrees: NeuraCoRecoverableTask['worktrees']
): NeuraCoRecoverableTaskDifference[] => {
  const differences: NeuraCoRecoverableTaskDifference[] = [];
  if (previous.branch !== current.branch) {
    differences.push({
      kind: 'branch',
      before: previous.branch,
      after: current.branch,
      message: `Branche changée : ${previous.branch || 'aucune'} → ${current.branch || 'aucune'}.`
    });
  }
  if (previous.head !== current.head) {
    differences.push({
      kind: 'head',
      before: previous.head,
      after: current.head,
      message: 'Le commit de référence du projet a changé.'
    });
  }
  const beforeFiles = new Map(previous.files.map((file) => [file.path, file.size]));
  const afterFiles = new Map(current.files.map((file) => [file.path, file.size]));
  for (const [file, size] of beforeFiles) {
    if (!afterFiles.has(file)) {
      differences.push({
        kind: 'file_removed',
        path: file,
        before: String(size),
        message: `Fichier supprimé depuis l’interruption : ${file}.`
      });
    } else if (afterFiles.get(file) !== size) {
      differences.push({
        kind: 'file_changed',
        path: file,
        before: String(size),
        after: String(afterFiles.get(file)),
        message: `Taille modifiée depuis l’interruption : ${file}.`
      });
    }
    if (differences.length >= 100) break;
  }
  if (differences.length < 100) {
    for (const [file, size] of afterFiles) {
      if (!beforeFiles.has(file)) {
        differences.push({
          kind: 'file_added',
          path: file,
          after: String(size),
          message: `Nouveau fichier depuis l’interruption : ${file}.`
        });
      }
      if (differences.length >= 100) break;
    }
  }
  const liveBranches = new Set(currentWorktrees.map((worktree) => worktree.branch));
  for (const worktree of expectedWorktrees) {
    if (worktree.branch && !liveBranches.has(worktree.branch)) {
      differences.push({
        kind: 'worktree',
        path: worktree.path,
        before: worktree.branch,
        message: `Worktree attendu introuvable : ${worktree.branch}.`
      });
    }
  }
  return differences;
};

export class TaskRecoveryService {
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly storePath: string) {}

  private async readDocument(): Promise<RecoveryDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf8')) as RecoveryDocument;
      if (parsed?.version !== 1 || !parsed.tasks || typeof parsed.tasks !== 'object') {
        return emptyDocument();
      }
      const tasks = Object.fromEntries(
        Object.entries(parsed.tasks)
          .filter(([, task]) => task && typeof task === 'object')
          .map(([id, task]) => [id, cleanTask(task)])
      );
      return { version: 1, tasks };
    } catch {
      return emptyDocument();
    }
  }

  private async writeDocument(document: RecoveryDocument): Promise<void> {
    const ordered = Object.values(document.tasks)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_TASKS);
    const next: RecoveryDocument = {
      version: 1,
      tasks: Object.fromEntries(ordered.map((task) => [task.id, cleanTask(task)]))
    };
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporary, this.storePath);
  }

  private mutate<T>(
    operation: (document: RecoveryDocument) => Promise<T> | T
  ): Promise<T> {
    const scheduled = this.writeChain.then(async () => {
      const document = await this.readDocument();
      const result = await operation(document);
      await this.writeDocument(document);
      return result;
    });
    this.writeChain = scheduled.catch(() => undefined);
    return scheduled;
  }

  async start(input: RecoverableTaskStart): Promise<NeuraCoRecoverableTask> {
    return this.mutate((document) => {
      const now = new Date().toISOString();
      const task = cleanTask({
        id: input.id,
        projectId: input.project.id,
        projectName: input.project.name,
        kind: input.kind,
        objective: input.objective,
        status: 'running',
        steps: [],
        agents: input.agents,
        worktrees: input.worktrees,
        filesModified: input.files || [],
        commands: [],
        results: [],
        budgetAllocated: input.budgetAllocated,
        budgetConsumed: 0,
        permissionMode: input.permissionMode,
        allowedActions: input.allowedActions,
        checkpointIds: input.checkpointIds,
        projectState: input.projectState,
        createdAt: now,
        updatedAt: now
      });
      document.tasks[task.id] = task;
      return task;
    });
  }

  async progress(
    taskId: string,
    progress: NeuraCoMultiAgentProgress
  ): Promise<NeuraCoRecoverableTask | null> {
    return this.mutate((document) => {
      const task = document.tasks[taskId];
      if (!task) return null;
      task.updatedAt = new Date().toISOString();
      task.plan = ['planned', 'planning'].includes(progress.phase)
        ? safeText(progress.message, 8_000)
        : task.plan;
      if (progress.task) {
        const step = cleanStep({
          id: progress.task.id,
          title: progress.task.objective,
          status: progress.task.status,
          agent: progress.task.agentName,
          files: progress.task.files,
          result: progress.task.message || progress.task.intermediateResult
        });
        const index = task.steps.findIndex((item) => item.id === step.id);
        if (index >= 0) task.steps[index] = step;
        else task.steps.push(step);
        task.agents = [...new Set([...task.agents, step.agent || ''].filter(Boolean))];
        task.filesModified = [...new Set([...task.filesModified, ...step.files])].slice(0, 500);
        if (step.result) task.results = [...task.results, step.result].slice(-100);
      }
      return cleanTask(task);
    });
  }

  async complete(
    taskId: string,
    result: NeuraCoMultiAgentResult | {
      summary: string;
      files?: string[];
      creditsConsumed?: number;
    }
  ): Promise<NeuraCoRecoverableTask | null> {
    return this.mutate((document) => {
      const task = document.tasks[taskId];
      if (!task) return null;
      task.status = 'completed';
      task.interruptionReason = undefined;
      task.updatedAt = new Date().toISOString();
      task.results = [...task.results, safeText(result.summary, 8_000)].filter(Boolean).slice(-100);
      task.budgetConsumed = Number(result.creditsConsumed || 0);
      if ('tasks' in result) {
        task.steps = result.tasks.map((step) => cleanStep({
          id: step.id,
          title: step.objective,
          status: step.status,
          agent: step.agentName,
          files: step.files,
          result: step.message || step.intermediateResult
        }));
        task.filesModified = [...new Set(result.tasks.flatMap((step) => step.files))].slice(0, 500);
      } else if (result.files) {
        task.filesModified = [...new Set([...task.filesModified, ...result.files])].slice(0, 500);
      }
      return cleanTask(task);
    });
  }

  async interrupt(taskId: string, reason: string): Promise<NeuraCoRecoverableTask | null> {
    return this.mutate((document) => {
      const task = document.tasks[taskId];
      if (!task) return null;
      task.status = 'interrupted';
      task.interruptionReason = safeText(reason, 2_000) || 'Tâche interrompue.';
      task.updatedAt = new Date().toISOString();
      return cleanTask(task);
    });
  }

  async list(
    projectId: string,
    includeCompleted = false,
    activeTaskIds: ReadonlySet<string> = new Set()
  ): Promise<NeuraCoRecoverableTask[]> {
    return this.mutate((document) => {
      for (const task of Object.values(document.tasks)) {
        if (
          task.projectId === projectId
          && task.status === 'running'
          && task.kind !== 'cloud'
          && !activeTaskIds.has(task.id)
        ) {
          task.status = 'interrupted';
          task.interruptionReason = 'NeuraCo ou Windows a été interrompu pendant cette tâche.';
          task.updatedAt = new Date().toISOString();
        }
      }
      return Object.values(document.tasks)
        .filter((task) => (
          task.projectId === projectId
          && (includeCompleted || ['interrupted', 'resuming', 'running'].includes(task.status))
        ))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(cleanTask);
    });
  }

  async inspect(
    projectId: string,
    taskId: string,
    currentProjectState: NeuraCoRecoverableProjectState,
    currentWorktrees: NeuraCoRecoverableTask['worktrees']
  ): Promise<NeuraCoRecoverableTaskInspection> {
    await this.writeChain;
    const task = (await this.readDocument()).tasks[taskId];
    if (!task || task.projectId !== projectId) {
      throw new Error('Tâche récupérable introuvable pour ce projet.');
    }
    const differences = compareRecoverableProjectState(
      task.projectState,
      currentProjectState,
      task.worktrees,
      currentWorktrees
    );
    return {
      task: cleanTask(task),
      compatible: differences.length === 0,
      currentProjectState,
      differences
    };
  }

  async resume(
    projectId: string,
    taskId: string,
    strategy: NeuraCoTaskResumeStrategy,
    currentProjectState: NeuraCoRecoverableProjectState,
    currentWorktrees: NeuraCoRecoverableTask['worktrees']
  ): Promise<NeuraCoRecoverableTaskResume> {
    if (!['continue_with_changes', 'restart_from_current'].includes(strategy)) {
      throw new Error('Stratégie de reprise invalide.');
    }
    const inspection = await this.inspect(
      projectId,
      taskId,
      currentProjectState,
      currentWorktrees
    );
    const updated = await this.mutate((document) => {
      const task = document.tasks[taskId];
      if (!task || task.projectId !== projectId) {
        throw new Error('Tâche récupérable introuvable pour ce projet.');
      }
      task.status = 'resuming';
      task.interruptionReason = undefined;
      task.updatedAt = new Date().toISOString();
      if (strategy === 'restart_from_current') {
        task.projectState = currentProjectState;
        task.worktrees = currentWorktrees;
        task.steps = task.steps.map((step) => (
          step.status === 'completed'
            ? step
            : { ...step, status: 'queued' as const, result: undefined }
        ));
      }
      return cleanTask(task);
    });
    const completed = updated.steps.filter((step) => step.status === 'completed');
    const remaining = updated.steps.filter((step) => step.status !== 'completed');
    const resumePrompt = [
      `Reprends la tâche récupérable ${updated.id}.`,
      `Objectif initial : ${updated.objective}`,
      updated.plan ? `Plan enregistré : ${updated.plan}` : '',
      completed.length > 0
        ? `Étapes terminées :\n${completed.map((step) => `- ${step.title}`).join('\n')}`
        : 'Aucune étape terminée enregistrée.',
      remaining.length > 0
        ? `Étapes restantes :\n${remaining.map((step) => `- ${step.title}`).join('\n')}`
        : 'Revalide le résultat final et les preuves.',
      updated.results.length > 0
        ? `Derniers résultats :\n${updated.results.slice(-5).join('\n\n')}`
        : '',
      inspection.differences.length > 0
        ? `Différences du projet acceptées par l’utilisateur :\n${
          inspection.differences.map((difference) => `- ${difference.message}`).join('\n')
        }`
        : 'Le projet est compatible avec l’état enregistré.',
      `Stratégie choisie : ${strategy}.`,
      'Vérifie à nouveau le projet et les autorisations avant toute action. '
        + 'Ne répète pas une étape déjà terminée sans raison vérifiable.'
    ].filter(Boolean).join('\n\n').slice(0, MAX_TEXT);
    return {
      task: updated,
      strategy,
      resumePrompt,
      differences: inspection.differences
    };
  }

  async discard(
    projectId: string,
    taskId: string,
    activeTaskIds: ReadonlySet<string> = new Set()
  ): Promise<NeuraCoRecoverableTask[]> {
    await this.mutate((document) => {
      const task = document.tasks[taskId];
      if (!task || task.projectId !== projectId) {
        throw new Error('Tâche récupérable introuvable pour ce projet.');
      }
      task.status = 'abandoned';
      task.updatedAt = new Date().toISOString();
    });
    return this.list(projectId, false, activeTaskIds);
  }
}
