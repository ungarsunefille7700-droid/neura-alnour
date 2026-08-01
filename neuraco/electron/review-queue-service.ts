import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoCloudTask,
  NeuraCoGitReview,
  NeuraCoGitTestResult,
  NeuraCoMultiAgentRequest,
  NeuraCoMultiAgentResult,
  NeuraCoProject,
  NeuraCoProjectPermissions,
  NeuraCoReviewCommentInput,
  NeuraCoReviewAllDecisionInput,
  NeuraCoReviewFileDecisionInput,
  NeuraCoReviewHunkDecisionInput,
  NeuraCoReviewItem,
  NeuraCoReviewRisk,
  NeuraCoReviewStatus
} from './ipc-contract';
import { parseUnifiedDiff } from './diff-review';
import { redactSecrets } from './secret-redaction';

const MAX_ITEMS = 500;
const MAX_COMMENTS = 200;
const MAX_TEXT = 20_000;
const SAFE_ID = /^[A-Za-z0-9_-]{8,160}$/;
const VALID_STATUSES = new Set<NeuraCoReviewStatus>([
  'pending',
  'reviewing',
  'changes_requested',
  'approved',
  'refused',
  'merged',
  'archived'
]);

interface ReviewQueueStore {
  version: 1;
  items: NeuraCoReviewItem[];
}

const uniqueStrings = (values: string[], max = 100): string[] => (
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, max)
);

const riskFrom = (risks: string[]): NeuraCoReviewRisk => {
  const joined = risks.join(' ').toLowerCase();
  if (/(critical|critique|secret|credential|destruct|data loss|perte de donnees)/.test(joined)) {
    return 'critical';
  }
  if (/(high|eleve|securite|security|auth|paiement|payment|migration)/.test(joined)) {
    return 'high';
  }
  return risks.length > 0 ? 'medium' : 'low';
};

const permissionSummary = (permissions: NeuraCoProjectPermissions): string[] => (
  uniqueStrings([
    `mode:${permissions.mode}`,
    ...permissions.allowedActions.map((action) => `action:${action}`),
    ...permissions.allowedApplications.map((application) => `application:${application}`)
  ], 40)
);

const diffFiles = (review: NeuraCoGitReview): string[] => (
  uniqueStrings(
    [...review.diff.patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)]
      .map((match) => match[2] || match[1])
  )
);

const hydrateDiffFiles = (item: NeuraCoReviewItem): NeuraCoReviewItem => {
  if (!item.diff?.patch || item.diffFiles?.length) return item;
  return {
    ...item,
    diffFiles: parseUnifiedDiff(item.diff.patch)
  };
};

const safeText = (value: string, max = MAX_TEXT): string => (
  redactSecrets(String(value || '')).slice(0, max)
);

const writeAtomically = async (target: string, value: ReviewQueueStore): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  try {
    await rename(temporary, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EEXIST', 'EPERM'].includes(code || '')) throw error;
    await rm(target, { force: true });
    await rename(temporary, target);
  }
};

export class ReviewQueueService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storePath: string) {}

  private async readStore(): Promise<ReviewQueueStore> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      if (raw.length > 8 * 1024 * 1024) throw new Error('Review queue store too large');
      const parsed = JSON.parse(raw) as Partial<ReviewQueueStore>;
      return {
        version: 1,
        items: Array.isArray(parsed.items)
          ? parsed.items
            .filter((item) => item && SAFE_ID.test(String(item.id)))
            .slice(-MAX_ITEMS)
            .map(hydrateDiffFiles)
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('NeuraCo review queue could not be read', error);
      }
      return { version: 1, items: [] };
    }
  }

  private async mutate<T>(
    operation: (store: ReviewQueueStore) => T | Promise<T>
  ): Promise<T> {
    const pending = this.writeQueue.catch(() => undefined).then(async () => {
      const store = await this.readStore();
      const result = await operation(store);
      store.items = store.items.slice(-MAX_ITEMS);
      await writeAtomically(this.storePath, store);
      return result;
    });
    this.writeQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async list(projectId: string, includeArchived = false): Promise<NeuraCoReviewItem[]> {
    const store = await this.readStore();
    return store.items
      .filter((item) => item.projectId === projectId)
      .filter((item) => includeArchived || item.status !== 'archived')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async upsert(item: NeuraCoReviewItem): Promise<NeuraCoReviewItem> {
    return this.mutate((store) => {
      const existing = store.items.find((candidate) => (
        candidate.projectId === item.projectId
        && candidate.source === item.source
        && candidate.sourceId === item.sourceId
      ));
      if (existing) {
        const decisions = new Map(
          existing.files.map((file) => [file.path, file.decision])
        );
        const hunkDecisions = new Map(
          (existing.diffFiles || []).flatMap((file) => (
            file.hunks.map((hunk) => [hunk.id, hunk.decision] as const)
          ))
        );
        const preserved = {
          id: existing.id,
          status: existing.status,
          comments: existing.comments,
          checkpointId: existing.checkpointId,
          files: item.files.map((file) => ({
            ...file,
            decision: decisions.get(file.path) || file.decision
          })),
          diffFiles: item.diffFiles?.map((file) => ({
            ...file,
            hunks: file.hunks.map((hunk) => ({
              ...hunk,
              decision: hunkDecisions.get(hunk.id) || hunk.decision
            }))
          }))
        };
        Object.assign(existing, item, preserved, {
          updatedAt: new Date().toISOString()
        });
        return existing;
      }
      store.items.push(item);
      return item;
    });
  }

  async enqueueMultiAgent(
    project: NeuraCoProject,
    request: NeuraCoMultiAgentRequest,
    result: NeuraCoMultiAgentResult,
    permissions: NeuraCoProjectPermissions
  ): Promise<NeuraCoReviewItem> {
    const now = new Date().toISOString();
    const risks = uniqueStrings(result.risks, 40);
    const files = uniqueStrings(result.tasks.flatMap((task) => task.files), 120);
    return this.upsert({
      id: randomUUID(),
      source: 'multi_agent',
      sourceId: result.taskId,
      projectId: project.id,
      projectName: project.name,
      task: safeText(request.objective, 1000),
      agent: result.tasks.map((task) => task.agentName).join(', ').slice(0, 500),
      createdAt: now,
      updatedAt: now,
      durationMs: Math.max(0, result.durationMs),
      creditsUsed: Math.max(0, result.creditsConsumed),
      files: files.map((filePath) => ({
        path: filePath,
        changeKind: 'proposed',
        decision: 'pending'
      })),
      tests: result.tasks.map((task) => ({
        label: `${task.agentName}: ${task.objective}`.slice(0, 500),
        status: task.testState === 'passed'
          ? 'passed'
          : task.testState === 'failed'
            ? 'failed'
            : task.testState === 'blocked'
              ? 'blocked'
              : 'not_run'
      })),
      risk: riskFrom(risks),
      risks,
      permissions: permissionSummary(permissions),
      status: 'pending',
      comments: [],
      summary: safeText(result.summary, 4000),
      result: safeText(result.review),
      rerun: {
        objective: safeText(request.objective, 12_000),
        selectedAgentIds: uniqueStrings(request.selectedAgentIds, 8),
        maxAgents: Math.min(8, Math.max(1, request.maxAgents)),
        budget: Math.min(100, Math.max(3, request.budget)),
        filePaths: files.slice(0, 16)
      }
    });
  }

  async enqueueGit(
    project: NeuraCoProject,
    review: NeuraCoGitReview,
    permissions: NeuraCoProjectPermissions
  ): Promise<NeuraCoReviewItem> {
    const parsedDiffFiles = parseUnifiedDiff(review.diff.patch);
    const files = parsedDiffFiles.length > 0
      ? parsedDiffFiles.map((file) => file.path)
      : diffFiles(review);
    return this.upsert({
      id: randomUUID(),
      source: 'git',
      sourceId: review.branch,
      projectId: project.id,
      projectName: project.name,
      task: `Reviser la branche ${review.branch}`,
      agent: 'Reviseur Git',
      createdAt: review.reviewedAt,
      updatedAt: review.reviewedAt,
      durationMs: 0,
      creditsUsed: Math.max(0, review.creditsConsumed),
      files: files.map((filePath) => ({
        path: filePath,
        changeKind: parsedDiffFiles.find((file) => file.path === filePath)?.changeKind || 'modified',
        decision: 'pending'
      })),
      tests: [],
      risk: review.approved ? 'low' : 'high',
      risks: review.approved ? [] : ['La revue independante a refuse la fusion.'],
      permissions: permissionSummary(permissions),
      status: 'pending',
      comments: [],
      summary: safeText(review.diff.stat, 4000),
      result: safeText(review.message),
      branch: review.branch,
      diff: {
        ...review.diff,
        patch: safeText(review.diff.patch, 200_000)
      },
      diffFiles: parsedDiffFiles
    });
  }

  async enqueueCloud(
    project: NeuraCoProject,
    task: NeuraCoCloudTask,
    permissions: NeuraCoProjectPermissions
  ): Promise<NeuraCoReviewItem | null> {
    if (task.status !== 'completed' || !task.result) return null;
    return this.upsert({
      id: randomUUID(),
      source: 'cloud',
      sourceId: task.id,
      projectId: project.id,
      projectName: project.name,
      task: `Tache Cloud ${task.id}`,
      agent: task.modelDisplay || task.model || 'Agent Cloud',
      createdAt: task.createdAt,
      updatedAt: task.completedAt || task.updatedAt,
      durationMs: task.startedAt && task.completedAt
        ? Math.max(0, Date.parse(task.completedAt) - Date.parse(task.startedAt))
        : 0,
      creditsUsed: Math.max(0, Number(task.usage?.credits_consumed || 0)),
      files: [],
      tests: [],
      risk: 'medium',
      risks: ['Le resultat Cloud doit etre examine avant toute application locale.'],
      permissions: permissionSummary(permissions),
      status: 'pending',
      comments: [],
      summary: `Resultat Cloud termine pour ${project.name}.`,
      result: safeText(task.result)
    });
  }

  private async update(
    itemId: string,
    updater: (item: NeuraCoReviewItem) => void
  ): Promise<NeuraCoReviewItem> {
    if (!SAFE_ID.test(itemId)) throw new Error('Identifiant de revision invalide.');
    return this.mutate((store) => {
      const item = store.items.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error('Element de revision introuvable.');
      updater(item);
      item.updatedAt = new Date().toISOString();
      return item;
    });
  }

  updateStatus(itemId: string, status: NeuraCoReviewStatus): Promise<NeuraCoReviewItem> {
    if (!VALID_STATUSES.has(status)) throw new Error('Statut de revision invalide.');
    return this.update(itemId, (item) => {
      if (status === 'approved' && item.files.some((file) => file.decision === 'refused')) {
        throw new Error('Un resultat contenant un fichier refuse ne peut pas etre approuve.');
      }
      if (
        status === 'approved'
        && item.diffFiles?.some((file) => file.hunks.some((hunk) => hunk.decision === 'refused'))
      ) {
        throw new Error('Un resultat contenant un bloc refuse ne peut pas etre approuve.');
      }
      item.status = status;
    });
  }

  addComment(input: NeuraCoReviewCommentInput): Promise<NeuraCoReviewItem> {
    const body = safeText(input.body, 4000).trim();
    const filePath = String(input.filePath || '').trim().slice(0, 1000);
    const line = Math.max(1, Math.min(1_000_000, Math.trunc(Number(input.line) || 1)));
    if (!body || !filePath) throw new Error('Le fichier et le commentaire sont obligatoires.');
    return this.update(input.itemId, (item) => {
      item.comments = [
        ...item.comments,
        {
          id: randomUUID(),
          filePath,
          line,
          body,
          createdAt: new Date().toISOString()
        }
      ].slice(-MAX_COMMENTS);
      if (item.status === 'pending') item.status = 'reviewing';
    });
  }

  decideFile(input: NeuraCoReviewFileDecisionInput): Promise<NeuraCoReviewItem> {
    return this.update(input.itemId, (item) => {
      const file = item.files.find((candidate) => candidate.path === input.filePath);
      if (!file) throw new Error('Fichier absent de cette revision.');
      if (!['pending', 'accepted', 'refused'].includes(input.decision)) {
        throw new Error('Decision de fichier invalide.');
      }
      file.decision = input.decision;
      const diffFile = item.diffFiles?.find((candidate) => candidate.path === input.filePath);
      if (diffFile) {
        diffFile.hunks = diffFile.hunks.map((hunk) => ({
          ...hunk,
          decision: input.decision
        }));
      }
      if (input.decision === 'refused') item.status = 'changes_requested';
    });
  }

  decideHunk(input: NeuraCoReviewHunkDecisionInput): Promise<NeuraCoReviewItem> {
    return this.update(input.itemId, (item) => {
      if (!['pending', 'accepted', 'refused'].includes(input.decision)) {
        throw new Error('Decision de bloc invalide.');
      }
      const file = item.diffFiles?.find((candidate) => candidate.path === input.filePath);
      const hunk = file?.hunks.find((candidate) => candidate.id === input.hunkId);
      if (!file || !hunk) throw new Error('Bloc absent de cette revision.');
      hunk.decision = input.decision;
      const fileDecision = item.files.find((candidate) => candidate.path === input.filePath);
      if (fileDecision) {
        fileDecision.decision = file.hunks.every((candidate) => candidate.decision === 'accepted')
          ? 'accepted'
          : file.hunks.some((candidate) => candidate.decision === 'refused')
            ? 'refused'
            : 'pending';
      }
      if (input.decision === 'refused') item.status = 'changes_requested';
    });
  }

  decideAll(input: NeuraCoReviewAllDecisionInput): Promise<NeuraCoReviewItem> {
    if (!['accepted', 'refused'].includes(input.decision)) {
      throw new Error('Decision globale invalide.');
    }
    return this.update(input.itemId, (item) => {
      item.files = item.files.map((file) => ({ ...file, decision: input.decision }));
      item.diffFiles = item.diffFiles?.map((file) => ({
        ...file,
        hunks: file.hunks.map((hunk) => ({ ...hunk, decision: input.decision }))
      }));
      if (input.decision === 'refused') item.status = 'changes_requested';
    });
  }

  recordTests(itemId: string, tests: NeuraCoGitTestResult[]): Promise<NeuraCoReviewItem> {
    return this.update(itemId, (item) => {
      item.tests = tests.slice(0, 30).map((test) => ({
        label: safeText(test.command, 1000),
        status: test.passed ? 'passed' : 'failed',
        output: safeText(test.output, 8000),
        durationMs: Math.max(0, test.durationMs)
      }));
      if (tests.some((test) => !test.passed)) {
        item.status = 'changes_requested';
      } else if (tests.length > 0 && item.status === 'pending') {
        item.status = 'reviewing';
      }
    });
  }

  attachCheckpoint(itemId: string, checkpointId: string): Promise<NeuraCoReviewItem> {
    if (!SAFE_ID.test(checkpointId)) throw new Error('Identifiant de checkpoint invalide.');
    return this.update(itemId, (item) => {
      item.checkpointId = checkpointId;
    });
  }
}
