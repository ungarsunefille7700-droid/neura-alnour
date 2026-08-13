import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoRoutine,
  NeuraCoRoutineInput,
  NeuraCoRoutineRun,
  NeuraCoRoutinesState,
  NeuraCoRoutineSchedule,
  NeuraCoRoutineTrigger
} from './ipc-contract';
import { isNeuraCoAgentModel } from './model-utils';
import { redactSecrets } from './secret-redaction';

const MAX_ROUTINES = 100;
const MAX_RUNS = 500;
const SCHEDULER_INTERVAL_MS = 30_000;
const TRIGGERS = new Set<NeuraCoRoutineTrigger>([
  'time',
  'day',
  'app_open',
  'new_commit',
  'new_pull_request',
  'ci_failure',
  'new_issue',
  'file_change',
  'api',
  'manual'
]);

interface RoutineStore {
  version: 1;
  routines: NeuraCoRoutine[];
  runs: NeuraCoRoutineRun[];
}

interface RoutineExecutionResult {
  summary: string;
  provider?: string;
  model?: string;
  creditsConsumed?: number;
}

interface RoutineServiceOptions {
  execute: (
    routine: NeuraCoRoutine,
    trigger: NeuraCoRoutineTrigger,
    metadata: Record<string, unknown>
  ) => Promise<RoutineExecutionResult>;
  isLocalExecutionAvailable?: () => boolean;
}

const emptyStore = (): RoutineStore => ({
  version: 1,
  routines: [],
  runs: []
});

const cleanText = (value: unknown, label: string, max: number): string => {
  const cleaned = redactSecrets(String(value || '').trim()).slice(0, max);
  if (!cleaned) throw new Error(`${label} est obligatoire.`);
  return cleaned;
};

const cleanList = (
  value: unknown,
  label: string,
  maxItems: number,
  maxLength = 160
): string[] => {
  if (!Array.isArray(value)) throw new Error(`${label} est invalide.`);
  return [...new Set(value.map((item) => (
    cleanText(item, label, maxLength)
  )))].slice(0, maxItems);
};

const validTime = (value: unknown): string => {
  const time = String(value || '');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Horaire de routine invalide.');
  }
  return time;
};

const normalizeSchedule = (
  value: NeuraCoRoutineSchedule
): NeuraCoRoutineSchedule => {
  if (!value || !TRIGGERS.has(value.trigger)) {
    throw new Error('Déclencheur de routine invalide.');
  }
  const schedule: NeuraCoRoutineSchedule = { trigger: value.trigger };
  if (value.trigger === 'time' || value.trigger === 'day') {
    schedule.time = validTime(value.time);
  }
  if (value.trigger === 'day') {
    const weekdays = Array.isArray(value.weekdays)
      ? [...new Set(value.weekdays.map(Number).filter((day) => (
          Number.isInteger(day) && day >= 0 && day <= 6
        )))]
      : [];
    if (weekdays.length === 0) throw new Error('Sélectionnez au moins un jour.');
    schedule.weekdays = weekdays.sort();
  }
  if (value.trigger === 'file_change') {
    schedule.filePattern = cleanText(
      value.filePattern || '**/*',
      'Motif de fichier',
      300
    );
  }
  return schedule;
};

const normalizeInput = (input: NeuraCoRoutineInput): NeuraCoRoutineInput => {
  const executionMode = input.executionMode === 'cloud' ? 'cloud' : 'local';
  if (executionMode === 'cloud' && input.cloudConsent !== true) {
    throw new Error('Le mode cloud exige un consentement explicite.');
  }
  const model = isNeuraCoAgentModel(input.model) ? input.model : 'auto';
  const autonomy = ['supervised', 'balanced', 'autonomous'].includes(input.autonomy)
    ? input.autonomy
    : 'supervised';
  const notificationConditions = cleanList(
    input.notificationConditions || [],
    'Conditions de notification',
    4
  ).filter((condition) => (
    ['on_start', 'on_success', 'on_failure', 'on_approval'].includes(condition)
  )) as NeuraCoRoutineInput['notificationConditions'];
  return {
    id: input.id,
    name: cleanText(input.name, 'Nom', 120),
    instruction: cleanText(input.instruction, 'Instruction', 20_000),
    projectIds: cleanList(input.projectIds, 'Projets', 20),
    agentIds: cleanList(input.agentIds || [], 'Agents', 20),
    model: model as NeuraCoRoutineInput['model'],
    schedule: normalizeSchedule(input.schedule),
    tools: cleanList(input.tools || [], 'Outils', 30),
    budgetCredits: Math.max(
      1,
      Math.min(1_000_000, Math.round(Number(input.budgetCredits) || 1))
    ),
    autonomy: autonomy as NeuraCoRoutineInput['autonomy'],
    notificationConditions,
    executionMode,
    cloudConsent: executionMode === 'cloud'
  };
};

export const nextScheduledRun = (
  schedule: NeuraCoRoutineSchedule,
  after = new Date()
): string | undefined => {
  if (!['time', 'day'].includes(schedule.trigger) || !schedule.time) return undefined;
  const [hours, minutes] = schedule.time.split(':').map(Number);
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setHours(hours, minutes, 0, 0);
  if (candidate.getTime() <= after.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  if (schedule.trigger === 'day') {
    const weekdays = new Set(schedule.weekdays || []);
    for (let index = 0; index < 8 && !weekdays.has(candidate.getDay()); index += 1) {
      candidate.setDate(candidate.getDate() + 1);
    }
  }
  return candidate.toISOString();
};

const wildcardMatch = (pattern: string, value: string): boolean => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\?/g, '.')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`, 'iu').test(value.replace(/\\/g, '/'));
};

const stateFrom = (
  store: RoutineStore,
  schedulerActive: boolean
): NeuraCoRoutinesState => ({
  routines: store.routines.map((routine) => ({ ...routine })),
  recentRuns: store.runs.slice(0, 100).map((run) => ({ ...run })),
  schedulerActive,
  localOnlyNotice:
    'Les routines locales sont exécutées uniquement lorsque NeuraCo et le PC sont actifs.'
});

export class RoutineService {
  private queue: Promise<void> = Promise.resolve();
  private scheduler?: NodeJS.Timeout;
  private readonly running = new Set<string>();

  constructor(
    private readonly storePath: string,
    private readonly options: RoutineServiceOptions
  ) {}

  private async readStore(): Promise<RoutineStore> {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf8')) as RoutineStore;
      return {
        version: 1,
        routines: Array.isArray(parsed.routines) ? parsed.routines : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : []
      };
    } catch {
      return emptyStore();
    }
  }

  private async writeStore(store: RoutineStore): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(store, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporary, this.storePath);
  }

  private mutate<T>(operation: (store: RoutineStore) => Promise<T> | T): Promise<T> {
    let output!: T;
    const scheduled = this.queue.catch(() => undefined).then(async () => {
      const store = await this.readStore();
      output = await operation(store);
      store.routines = store.routines.slice(0, MAX_ROUTINES);
      store.runs = store.runs.slice(0, MAX_RUNS);
      await this.writeStore(store);
    });
    this.queue = scheduled.then(() => undefined, () => undefined);
    return scheduled.then(() => output);
  }

  async state(): Promise<NeuraCoRoutinesState> {
    await this.queue;
    return stateFrom(await this.readStore(), Boolean(this.scheduler));
  }

  async save(input: NeuraCoRoutineInput): Promise<NeuraCoRoutinesState> {
    const normalized = normalizeInput(input);
    return this.mutate((store) => {
      const previous = normalized.id
        ? store.routines.find((routine) => routine.id === normalized.id)
        : undefined;
      if (normalized.id && !previous) throw new Error('Routine introuvable.');
      if (!previous && store.routines.length >= MAX_ROUTINES) {
        throw new Error('La limite de routines est atteinte.');
      }
      const now = new Date().toISOString();
      const routine: NeuraCoRoutine = {
        ...normalized,
        id: previous?.id || randomUUID(),
        enabled: previous?.enabled ?? false,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        lastRunAt: previous?.lastRunAt,
        nextRunAt: normalized.schedule.trigger === 'time'
          || normalized.schedule.trigger === 'day'
          ? nextScheduledRun(normalized.schedule)
          : undefined
      };
      store.routines = [
        ...store.routines.filter((entry) => entry.id !== routine.id),
        routine
      ].sort((left, right) => left.name.localeCompare(right.name));
      return stateFrom(store, Boolean(this.scheduler));
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<NeuraCoRoutinesState> {
    return this.mutate((store) => {
      const routine = store.routines.find((entry) => entry.id === id);
      if (!routine) throw new Error('Routine introuvable.');
      if (enabled && routine.executionMode === 'cloud' && !routine.cloudConsent) {
        throw new Error('Consentement cloud manquant.');
      }
      routine.enabled = enabled;
      routine.updatedAt = new Date().toISOString();
      routine.nextRunAt = enabled
        ? nextScheduledRun(routine.schedule)
        : undefined;
      return stateFrom(store, Boolean(this.scheduler));
    });
  }

  async delete(id: string): Promise<NeuraCoRoutinesState> {
    return this.mutate((store) => {
      if (!store.routines.some((routine) => routine.id === id)) {
        throw new Error('Routine introuvable.');
      }
      if (this.running.has(id)) throw new Error('Cette routine est en cours.');
      store.routines = store.routines.filter((routine) => routine.id !== id);
      return stateFrom(store, Boolean(this.scheduler));
    });
  }

  private async execute(
    routine: NeuraCoRoutine,
    trigger: NeuraCoRoutineTrigger,
    metadata: Record<string, unknown>
  ): Promise<NeuraCoRoutineRun> {
    if (this.running.has(routine.id)) {
      return {
        id: randomUUID(),
        routineId: routine.id,
        routineName: routine.name,
        trigger,
        executionMode: routine.executionMode,
        status: 'skipped',
        summary: 'Routine déjà en cours.',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
    }
    if (
      routine.executionMode === 'local'
      && this.options.isLocalExecutionAvailable
      && !this.options.isLocalExecutionAvailable()
    ) {
      const skipped: NeuraCoRoutineRun = {
        id: randomUUID(),
        routineId: routine.id,
        routineName: routine.name,
        trigger,
        executionMode: 'local',
        status: 'skipped',
        summary: 'PC ou application indisponible pour cette routine locale.',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      await this.mutate((store) => {
        store.runs.unshift(skipped);
      });
      return skipped;
    }
    const run: NeuraCoRoutineRun = {
      id: randomUUID(),
      routineId: routine.id,
      routineName: routine.name,
      trigger,
      executionMode: routine.executionMode,
      status: 'running',
      summary: 'Routine en cours.',
      startedAt: new Date().toISOString()
    };
    this.running.add(routine.id);
    await this.mutate((store) => {
      store.runs.unshift(run);
    });
    try {
      const result = await this.options.execute(routine, trigger, metadata);
      Object.assign(run, {
        status: 'completed',
        summary: redactSecrets(result.summary).slice(0, 2_000),
        provider: result.provider,
        model: result.model,
        creditsConsumed: result.creditsConsumed,
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      Object.assign(run, {
        status: 'failed',
        summary: redactSecrets(
          error instanceof Error ? error.message : 'Exécution de routine impossible.'
        ).slice(0, 2_000),
        completedAt: new Date().toISOString()
      });
    } finally {
      this.running.delete(routine.id);
      await this.mutate((store) => {
        const storedRun = store.runs.find((entry) => entry.id === run.id);
        if (storedRun) Object.assign(storedRun, run);
        const storedRoutine = store.routines.find((entry) => entry.id === routine.id);
        if (storedRoutine) {
          storedRoutine.lastRunAt = run.completedAt;
          storedRoutine.nextRunAt = nextScheduledRun(
            storedRoutine.schedule,
            new Date(run.completedAt || Date.now())
          );
        }
      });
    }
    return { ...run };
  }

  async runManual(id: string): Promise<NeuraCoRoutineRun> {
    const routine = (await this.readStore()).routines.find((entry) => entry.id === id);
    if (!routine) throw new Error('Routine introuvable.');
    return this.execute(routine, 'manual', {});
  }

  async trigger(
    trigger: NeuraCoRoutineTrigger,
    metadata: Record<string, unknown> = {}
  ): Promise<NeuraCoRoutineRun[]> {
    if (!TRIGGERS.has(trigger)) throw new Error('Déclencheur invalide.');
    const projectId = String(metadata.projectId || '');
    const filePath = String(metadata.filePath || '');
    const routines = (await this.readStore()).routines.filter((routine) => (
      routine.enabled
      && routine.schedule.trigger === trigger
      && (!projectId || routine.projectIds.length === 0 || routine.projectIds.includes(projectId))
      && (
        trigger !== 'file_change'
        || wildcardMatch(routine.schedule.filePattern || '**/*', filePath)
      )
    ));
    return Promise.all(routines.map((routine) => (
      this.execute(routine, trigger, metadata)
    )));
  }

  async processDue(now = new Date()): Promise<NeuraCoRoutineRun[]> {
    const routines = (await this.readStore()).routines.filter((routine) => (
      routine.enabled
      && ['time', 'day'].includes(routine.schedule.trigger)
      && Boolean(routine.nextRunAt)
      && Date.parse(routine.nextRunAt!) <= now.getTime()
    ));
    return Promise.all(routines.map((routine) => (
      this.execute(routine, routine.schedule.trigger, {
        scheduledFor: routine.nextRunAt
      })
    )));
  }

  startScheduler(): void {
    if (this.scheduler) return;
    this.scheduler = setInterval(() => {
      void this.processDue().catch((error) => {
        console.error('NeuraCo routine scheduler failed', error);
      });
    }, SCHEDULER_INTERVAL_MS);
    this.scheduler.unref?.();
  }

  stopScheduler(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = undefined;
  }
}
