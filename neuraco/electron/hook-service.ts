import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoHook,
  NeuraCoHookEvent,
  NeuraCoHookInput,
  NeuraCoHookRun,
  NeuraCoHooksState,
  NeuraCoProject
} from './ipc-contract';
import { createSandboxedEnvironment } from './sandbox-environment';
import { redactSecrets } from './secret-redaction';

const MAX_RUNS = 500;
const MAX_CONTEXT = 20_000;
const MAX_OUTPUT = 20_000;
const EVENTS: NeuraCoHookEvent[] = [
  'before_instruction',
  'before_tool',
  'after_tool',
  'before_command',
  'after_command',
  'before_modification',
  'after_modification',
  'before_merge',
  'task_completed',
  'on_error'
];

interface HookStore {
  version: 1;
  hooks: NeuraCoHook[];
  runs: NeuraCoHookRun[];
}

export interface NeuraCoHookExecutionContext {
  projectId?: string;
  projectName?: string;
  instruction?: string;
  command?: string;
  tool?: string;
  file?: string;
  content?: string;
  branch?: string;
  taskId?: string;
  status?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface NeuraCoHookExecutionResult {
  blocked: boolean;
  approvalRequired: boolean;
  notifications: string[];
  runs: NeuraCoHookRun[];
}

const EMPTY_STORE: HookStore = {
  version: 1,
  hooks: [],
  runs: []
};

const SYSTEM_HOOKS: NeuraCoHook[] = [
  {
    id: 'security-secret-protection',
    name: 'Protection obligatoire des secrets',
    event: 'before_instruction',
    action: 'block_pattern',
    pattern: '[détection interne]',
    failureMode: 'block',
    enabled: true,
    security: true,
    immutable: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'security-command-policy',
    name: 'Politique obligatoire des commandes',
    event: 'before_command',
    action: 'block_pattern',
    pattern: '[politique interne]',
    failureMode: 'block',
    enabled: true,
    security: true,
    immutable: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
];

const FORBIDDEN_COMMAND = (
  /(?:^|\s)(?:rm\s+-rf\s+[\/~]|format(?:\.com)?\s+[a-z]:|diskpart\b|shutdown\b|bcdedit\b|cipher\s+\/w:|Remove-Item\b[^\r\n]*-(?:Recurse|Force)[^\r\n]*(?:[a-z]:\\|\/))(?:\s|$)/i
);

const safeText = (value: unknown, label: string, max = 500): string => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new Error(`${label} est invalide.`);
  return result;
};

const safeArgs = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('Arguments de hook invalides.');
  }
  return value.map((entry) => safeText(entry, 'Argument', 1_000));
};

const normalizeInput = (
  input: NeuraCoHookInput,
  projectId?: string
): NeuraCoHookInput & { projectId?: string } => {
  const event = input?.event;
  if (!EVENTS.includes(event)) throw new Error('Événement de hook invalide.');
  const action = input?.action;
  if (!['log', 'block_pattern', 'command', 'approval', 'notification'].includes(action)) {
    throw new Error('Action de hook invalide.');
  }
  let pattern: string | undefined;
  if (action === 'block_pattern') {
    pattern = safeText(input.pattern, 'Motif', 300);
    try {
      new RegExp(pattern, 'iu');
    } catch {
      throw new Error('Expression régulière du hook invalide.');
    }
  }
  const command = action === 'command'
    ? safeText(input.command, 'Commande', 1_000)
    : undefined;
  const timeoutMs = Math.max(
    1_000,
    Math.min(120_000, Math.round(Number(input.timeoutMs) || 30_000))
  );
  return {
    id: input.id,
    name: safeText(input.name, 'Nom du hook', 120),
    event,
    action,
    pattern,
    command,
    args: action === 'command' ? safeArgs(input.args) : [],
    timeoutMs,
    failureMode: input.failureMode === 'warn' ? 'warn' : 'block',
    projectId
  };
};

const contextText = (context: NeuraCoHookExecutionContext): string => (
  JSON.stringify(context).slice(0, MAX_CONTEXT)
);

const containsSecret = (value: string): boolean => redactSecrets(value) !== value;

const runCommandHook = async (
  hook: NeuraCoHook,
  context: NeuraCoHookExecutionContext,
  project?: NeuraCoProject
): Promise<{ status: NeuraCoHookRun['status']; summary: string; output?: string }> => {
  const child = spawn(hook.command!, hook.args || [], {
    cwd: project?.rootPath || process.cwd(),
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: createSandboxedEnvironment()
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${String(chunk)}`.slice(-MAX_OUTPUT);
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-MAX_OUTPUT);
  });
  child.stdin.end(redactSecrets(contextText(context)));
  const timeoutMs = hook.timeoutMs || 30_000;
  const exit = await new Promise<{ code: number | null; timedOut: boolean }>(
    (resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, timedOut });
      });
    }
  );
  const output = redactSecrets(`${stdout}${stderr ? `\n${stderr}` : ''}`)
    .trim()
    .slice(-MAX_OUTPUT);
  if (exit.timedOut) {
    return {
      status: hook.failureMode === 'warn' ? 'failed' : 'blocked',
      summary: `Hook interrompu après ${timeoutMs} ms.`,
      output
    };
  }
  if (exit.code !== 0) {
    return {
      status: hook.failureMode === 'warn' ? 'failed' : 'blocked',
      summary: `Hook terminé avec le code ${exit.code ?? 'inconnu'}.`,
      output
    };
  }
  return {
    status: 'passed',
    summary: 'Commande du hook terminée avec succès.',
    output
  };
};

const publicState = (store: HookStore): NeuraCoHooksState => ({
  hooks: [...SYSTEM_HOOKS, ...store.hooks].map((hook) => ({
    ...hook,
    args: [...(hook.args || [])]
  })),
  recentRuns: store.runs.slice(0, 100).map((run) => ({ ...run })),
  securityHookCount: SYSTEM_HOOKS.length,
  activeCustomHookCount: store.hooks.filter((hook) => hook.enabled).length
});

export class HookService {
  private queue = Promise.resolve();

  constructor(private readonly storePath: string) {}

  private async readStore(): Promise<HookStore> {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf8')) as HookStore;
      return {
        version: 1,
        hooks: Array.isArray(parsed.hooks) ? parsed.hooks : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : []
      };
    } catch {
      return structuredClone(EMPTY_STORE);
    }
  }

  private async writeStore(store: HookStore): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(store, null, 2), 'utf8');
  }

  private async mutate<T>(
    operation: (store: HookStore) => Promise<T> | T
  ): Promise<T> {
    let result!: T;
    const task = this.queue.catch(() => undefined).then(async () => {
      const store = await this.readStore();
      result = await operation(store);
      await this.writeStore(store);
    });
    this.queue = task.then(() => undefined, () => undefined);
    await task;
    return result;
  }

  async state(): Promise<NeuraCoHooksState> {
    return publicState(await this.readStore());
  }

  async save(
    input: NeuraCoHookInput,
    projectId?: string
  ): Promise<NeuraCoHooksState> {
    const normalized = normalizeInput(input, projectId);
    return this.mutate((store) => {
      const previous = normalized.id
        ? store.hooks.find((hook) => hook.id === normalized.id)
        : undefined;
      if (normalized.id && !previous) throw new Error('Hook introuvable.');
      const now = new Date().toISOString();
      const hook: NeuraCoHook = {
        ...normalized,
        id: previous?.id || randomUUID(),
        enabled: previous?.enabled ?? false,
        security: false,
        immutable: false,
        createdAt: previous?.createdAt || now,
        updatedAt: now
      };
      store.hooks = [
        ...store.hooks.filter((entry) => entry.id !== hook.id),
        hook
      ].sort((left, right) => left.name.localeCompare(right.name));
      return publicState(store);
    });
  }

  async setEnabled(
    hookId: string,
    enabled: boolean
  ): Promise<NeuraCoHooksState> {
    if (SYSTEM_HOOKS.some((hook) => hook.id === hookId)) {
      throw new Error('Un hook de sécurité obligatoire ne peut pas être désactivé.');
    }
    return this.mutate((store) => {
      const hook = store.hooks.find((entry) => entry.id === hookId);
      if (!hook) throw new Error('Hook introuvable.');
      hook.enabled = enabled;
      hook.updatedAt = new Date().toISOString();
      return publicState(store);
    });
  }

  async delete(hookId: string): Promise<NeuraCoHooksState> {
    if (SYSTEM_HOOKS.some((hook) => hook.id === hookId)) {
      throw new Error('Un hook de sécurité obligatoire ne peut pas être supprimé.');
    }
    return this.mutate((store) => {
      if (!store.hooks.some((hook) => hook.id === hookId)) {
        throw new Error('Hook introuvable.');
      }
      store.hooks = store.hooks.filter((hook) => hook.id !== hookId);
      return publicState(store);
    });
  }

  async execute(
    event: NeuraCoHookEvent,
    context: NeuraCoHookExecutionContext,
    project?: NeuraCoProject,
    onlyHookId?: string
  ): Promise<NeuraCoHookExecutionResult> {
    if (!EVENTS.includes(event)) throw new Error('Événement de hook invalide.');
    const store = await this.readStore();
    const customHooks = store.hooks.filter((hook) => (
      hook.enabled
      && hook.event === event
      && (!hook.projectId || hook.projectId === project?.id)
      && (!onlyHookId || hook.id === onlyHookId)
    ));
    const candidates = onlyHookId
      ? customHooks
      : [...SYSTEM_HOOKS.filter((hook) => (
          hook.event === event
          || (
            hook.id === 'security-secret-protection'
            && [
              'before_tool',
              'before_command',
              'before_modification'
            ].includes(event)
          )
        )), ...customHooks];
    if (onlyHookId && candidates.length === 0) {
      throw new Error('Hook actif introuvable pour ce test.');
    }
    const runs: NeuraCoHookRun[] = [];
    const notifications: string[] = [];
    const serialized = contextText(context);
    for (const hook of candidates) {
      const startedAt = Date.now();
      let status: NeuraCoHookRun['status'] = 'passed';
      let summary = 'Hook exécuté.';
      let output: string | undefined;
      if (hook.id === 'security-secret-protection') {
        if (containsSecret(serialized)) {
          status = 'blocked';
          summary = 'Secret ou identifiant sensible détecté et bloqué.';
        } else {
          summary = 'Aucun secret détecté.';
        }
      } else if (hook.id === 'security-command-policy') {
        if (FORBIDDEN_COMMAND.test(String(context.command || ''))) {
          status = 'blocked';
          summary = 'Commande interdite par la politique de sécurité.';
        } else {
          summary = 'Commande conforme à la politique obligatoire.';
        }
      } else if (hook.action === 'block_pattern') {
        const matched = new RegExp(hook.pattern!, 'iu').test(serialized);
        status = matched ? 'blocked' : 'passed';
        summary = matched
          ? 'Le motif interdit du hook a été détecté.'
          : 'Le motif interdit est absent.';
      } else if (hook.action === 'approval') {
        status = 'approval_required';
        summary = `Approbation demandée par le hook « ${hook.name} ».`;
      } else if (hook.action === 'notification') {
        summary = `Notification demandée par le hook « ${hook.name} ».`;
        notifications.push(summary);
      } else if (hook.action === 'log') {
        summary = `Événement ${event} journalisé.`;
      } else if (hook.action === 'command') {
        const commandResult = await runCommandHook(hook, context, project);
        status = commandResult.status;
        summary = commandResult.summary;
        output = commandResult.output;
      }
      runs.push({
        id: randomUUID(),
        hookId: hook.id,
        hookName: hook.name,
        event,
        status,
        summary,
        output,
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString()
      });
      if (status === 'blocked') break;
    }
    await this.mutate((current) => {
      current.runs = [...runs, ...current.runs].slice(0, MAX_RUNS);
    });
    return {
      blocked: runs.some((run) => run.status === 'blocked'),
      approvalRequired: runs.some((run) => run.status === 'approval_required'),
      notifications,
      runs
    };
  }

  async test(
    hookId: string,
    project?: NeuraCoProject
  ): Promise<NeuraCoHookRun> {
    const state = await this.state();
    const hook = state.hooks.find((entry) => entry.id === hookId);
    if (!hook || hook.security) {
      throw new Error('Seuls les hooks personnalisés peuvent être testés.');
    }
    const wasEnabled = hook.enabled;
    if (!wasEnabled) await this.setEnabled(hookId, true);
    try {
      const result = await this.execute(
        hook.event,
        {
          projectId: project?.id,
          projectName: project?.name,
          instruction: 'Contexte de test NeuraCo',
          command: 'node --version',
          tool: 'hook-test',
          file: 'test.txt',
          branch: 'test',
          taskId: 'hook-test'
        },
        project,
        hookId
      );
      return result.runs[0];
    } finally {
      if (!wasEnabled) await this.setEnabled(hookId, false);
    }
  }
}

