import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoGoal,
  NeuraCoGoalCreate,
  NeuraCoGoalPriority,
  NeuraCoGoalStatus,
  NeuraCoGoalStepStatus,
  NeuraCoGoalUpdate,
  NeuraCoMultiAgentTask
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

const MAX_GOALS = 200;
const MAX_STEPS = 100;
const MAX_CRITERIA = 60;
const MAX_PROPOSALS = 100;
const SAFE_ID = /^[A-Za-z0-9_-]{8,160}$/;
const PRIORITIES = new Set<NeuraCoGoalPriority>(['low', 'medium', 'high', 'critical']);
const GOAL_STATUSES = new Set<NeuraCoGoalStatus>([
  'active',
  'paused',
  'completed',
  'archived'
]);
const STEP_STATUSES = new Set<NeuraCoGoalStepStatus>([
  'pending',
  'running',
  'completed',
  'blocked'
]);

interface GoalStore {
  version: 1;
  goals: NeuraCoGoal[];
}

const safeText = (value: unknown, max: number): string => (
  redactSecrets(String(value || '')).trim().slice(0, max)
);

const uniqueStrings = (values: unknown, max: number): string[] => (
  Array.isArray(values)
    ? [...new Set(values.map((value) => safeText(value, 300)).filter(Boolean))].slice(0, max)
    : []
);

const validDate = (value: unknown): string | undefined => {
  const raw = safeText(value, 50);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error('La date cible est invalide.');
  return parsed.toISOString();
};

const progressOf = (goal: NeuraCoGoal): number => {
  const completedSteps = goal.steps.filter((step) => step.status === 'completed').length;
  const satisfiedCriteria = goal.successCriteria.filter((criterion) => criterion.satisfied).length;
  const total = goal.steps.length + goal.successCriteria.length;
  if (total === 0) return 0;
  return Math.round(((completedSteps + satisfiedCriteria) / total) * 100);
};

const normalizeGoal = (goal: NeuraCoGoal): NeuraCoGoal => ({
  ...goal,
  steps: Array.isArray(goal.steps) ? goal.steps.slice(0, MAX_STEPS) : [],
  successCriteria: Array.isArray(goal.successCriteria)
    ? goal.successCriteria.slice(0, MAX_CRITERIA)
    : [],
  proposals: Array.isArray(goal.proposals) ? goal.proposals.slice(-MAX_PROPOSALS) : [],
  progress: progressOf(goal)
});

const writeAtomically = async (target: string, store: GoalStore): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  try {
    await rename(temporary, target);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
    await rm(target, { force: true });
    await rename(temporary, target);
  }
};

export class GoalService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storePath: string) {}

  private async readStore(): Promise<GoalStore> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      if (raw.length > 6 * 1024 * 1024) throw new Error('Goal store too large');
      const parsed = JSON.parse(raw) as Partial<GoalStore>;
      return {
        version: 1,
        goals: Array.isArray(parsed.goals)
          ? parsed.goals
            .filter((goal) => goal && SAFE_ID.test(String(goal.id)))
            .slice(-MAX_GOALS)
            .map((goal) => normalizeGoal(goal))
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('NeuraCo goals could not be read', error);
      }
      return { version: 1, goals: [] };
    }
  }

  private async mutate<T>(operation: (store: GoalStore) => T | Promise<T>): Promise<T> {
    const pending = this.writeQueue.catch(() => undefined).then(async () => {
      const store = await this.readStore();
      const result = await operation(store);
      store.goals = store.goals.slice(-MAX_GOALS).map(normalizeGoal);
      await writeAtomically(this.storePath, store);
      return result;
    });
    this.writeQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async list(projectId?: string): Promise<NeuraCoGoal[]> {
    const store = await this.readStore();
    return store.goals
      .filter((goal) => !projectId || goal.projectIds.includes(projectId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(input: NeuraCoGoalCreate): Promise<NeuraCoGoal> {
    const title = safeText(input.title, 200);
    const expectedResult = safeText(input.expectedResult, 2000);
    const description = safeText(input.description, 8000);
    if (!title || !expectedResult) {
      throw new Error('Le titre et le résultat attendu sont obligatoires.');
    }
    const now = new Date().toISOString();
    const steps = uniqueStrings(input.steps, MAX_STEPS);
    const criteria = uniqueStrings(input.successCriteria, MAX_CRITERIA);
    const priority = PRIORITIES.has(input.priority) ? input.priority : 'medium';
    const budget = Math.max(0, Math.min(100_000, Number(input.budget) || 0));
    const goal: NeuraCoGoal = {
      id: randomUUID(),
      title,
      expectedResult,
      description,
      steps: steps.map((step, index) => ({
        id: randomUUID(),
        title: step,
        status: 'pending',
        order: index,
        createdAt: now
      })),
      successCriteria: criteria.map((criterion) => ({
        id: randomUUID(),
        label: criterion,
        satisfied: false
      })),
      priority,
      budget,
      projectIds: uniqueStrings(input.projectIds, 30),
      agentIds: uniqueStrings(input.agentIds, 30),
      targetDate: validDate(input.targetDate),
      status: 'active',
      progress: 0,
      proposals: [],
      createdAt: now,
      updatedAt: now
    };
    return this.mutate((store) => {
      store.goals.push(goal);
      return normalizeGoal(goal);
    });
  }

  private async updateExisting(
    goalId: string,
    operation: (goal: NeuraCoGoal) => void
  ): Promise<NeuraCoGoal> {
    if (!SAFE_ID.test(goalId)) throw new Error('Identifiant d’objectif invalide.');
    return this.mutate((store) => {
      const goal = store.goals.find((candidate) => candidate.id === goalId);
      if (!goal) throw new Error('Objectif introuvable.');
      operation(goal);
      goal.updatedAt = new Date().toISOString();
      goal.progress = progressOf(goal);
      return goal;
    });
  }

  update(goalId: string, input: NeuraCoGoalUpdate): Promise<NeuraCoGoal> {
    return this.updateExisting(goalId, (goal) => {
      if (input.title !== undefined) {
        const value = safeText(input.title, 200);
        if (!value) throw new Error('Le titre ne peut pas être vide.');
        goal.title = value;
      }
      if (input.expectedResult !== undefined) {
        const value = safeText(input.expectedResult, 2000);
        if (!value) throw new Error('Le résultat attendu ne peut pas être vide.');
        goal.expectedResult = value;
      }
      if (input.description !== undefined) goal.description = safeText(input.description, 8000);
      if (input.priority !== undefined && PRIORITIES.has(input.priority)) {
        goal.priority = input.priority;
      }
      if (input.budget !== undefined) {
        goal.budget = Math.max(0, Math.min(100_000, Number(input.budget) || 0));
      }
      if (input.projectIds !== undefined) goal.projectIds = uniqueStrings(input.projectIds, 30);
      if (input.agentIds !== undefined) goal.agentIds = uniqueStrings(input.agentIds, 30);
      if (input.targetDate !== undefined) {
        goal.targetDate = input.targetDate === null ? undefined : validDate(input.targetDate);
      }
      if (input.status !== undefined && GOAL_STATUSES.has(input.status)) {
        goal.status = input.status;
      }
      if (input.criterionId !== undefined) {
        const criterion = goal.successCriteria.find((item) => item.id === input.criterionId);
        if (!criterion) throw new Error('Critère de réussite introuvable.');
        criterion.satisfied = Boolean(input.criterionSatisfied);
        criterion.verifiedAt = criterion.satisfied ? new Date().toISOString() : undefined;
      }
    });
  }

  updateStep(
    goalId: string,
    stepId: string,
    status: NeuraCoGoalStepStatus
  ): Promise<NeuraCoGoal> {
    if (!SAFE_ID.test(stepId) || !STEP_STATUSES.has(status)) {
      throw new Error('Mise à jour d’étape invalide.');
    }
    return this.updateExisting(goalId, (goal) => {
      const step = goal.steps.find((candidate) => candidate.id === stepId);
      if (!step) throw new Error('Étape introuvable.');
      step.status = status;
      step.completedAt = status === 'completed' ? new Date().toISOString() : undefined;
    });
  }

  async delete(goalId: string): Promise<NeuraCoGoal[]> {
    if (!SAFE_ID.test(goalId)) throw new Error('Identifiant d’objectif invalide.');
    return this.mutate((store) => {
      store.goals = store.goals.filter((goal) => goal.id !== goalId);
      return store.goals;
    });
  }

  proposeFromTasks(
    goalId: string,
    sourceTaskId: string,
    tasks: NeuraCoMultiAgentTask[]
  ): Promise<NeuraCoGoal> {
    return this.updateExisting(goalId, (goal) => {
      const existing = new Set([
        ...goal.steps.map((step) => step.title.toLowerCase()),
        ...goal.proposals.map((proposal) => proposal.title.toLowerCase())
      ]);
      for (const task of tasks.slice(0, 20)) {
        const title = safeText(task.objective, 500);
        if (!title || existing.has(title.toLowerCase())) continue;
        goal.proposals.push({
          id: randomUUID(),
          title,
          description: safeText(task.message || task.intermediateResult, 2000) || undefined,
          proposedBy: safeText(task.agentName, 200) || 'Agent NeuraCo',
          sourceTaskId: safeText(sourceTaskId, 160),
          status: 'pending',
          createdAt: new Date().toISOString()
        });
        existing.add(title.toLowerCase());
      }
      goal.proposals = goal.proposals.slice(-MAX_PROPOSALS);
    });
  }

  resolveProposal(
    goalId: string,
    proposalId: string,
    decision: 'approved' | 'rejected'
  ): Promise<NeuraCoGoal> {
    if (!SAFE_ID.test(proposalId) || !['approved', 'rejected'].includes(decision)) {
      throw new Error('Décision de proposition invalide.');
    }
    return this.updateExisting(goalId, (goal) => {
      const proposal = goal.proposals.find((candidate) => candidate.id === proposalId);
      if (!proposal || proposal.status !== 'pending') {
        throw new Error('Proposition en attente introuvable.');
      }
      proposal.status = decision;
      proposal.resolvedAt = new Date().toISOString();
      if (decision === 'approved') {
        goal.steps.push({
          id: randomUUID(),
          title: proposal.title,
          description: proposal.description,
          status: 'pending',
          order: goal.steps.length,
          createdAt: proposal.resolvedAt
        });
      }
    });
  }
}
