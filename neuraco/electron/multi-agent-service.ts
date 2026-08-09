import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authenticatedApiRequest } from './auth-service';
import type {
  NeuraCoAgentDefinition,
  NeuraCoAgentCoordinationMessage,
  NeuraCoAgentFileReservation,
  NeuraCoAgentFileContext,
  NeuraCoCoordinationKind,
  NeuraCoCoordinationLimits,
  NeuraCoCustomAgentInput,
  NeuraCoMultiAgentProgress,
  NeuraCoMultiAgentRequest,
  NeuraCoMultiAgentResult,
  NeuraCoMultiAgentTask
} from './ipc-contract';

const MAX_CUSTOM_AGENTS = 50;
const MAX_PLAN_TASKS = 12;
const MAX_CONTEXT_FILES = 16;
const MAX_MEMORY_ITEMS = 10;
const MAX_COORDINATION_MESSAGES = 40;
const MAX_COORDINATION_MESSAGES_PER_PAIR = 6;
const MAX_COORDINATION_DURATION_MS = 120_000;
const SAFE_AGENT_ID = /^[a-z0-9_-]{2,120}$/i;
const SAFE_TASK_ID = /^[a-z0-9_-]{8,120}$/i;
const SAFE_COLOR = /^#[0-9a-f]{6}$/i;
const ALLOWED_MODELS = new Set([
  'auto',
  'claude-sonnet-4-5',
  'gpt-4o',
  'gemini-2.5-flash'
]);

export const BUILT_IN_AGENTS: readonly NeuraCoAgentDefinition[] = Object.freeze([
  {
    id: 'architect',
    name: 'Architecte',
    role: 'Architecture logicielle et découpage',
    instructions: 'Analyse les dépendances, les contrats et les risques avant toute proposition.',
    model: 'claude-sonnet-4-5',
    tools: ['project-context', 'reasoning'],
    allowedApplications: [],
    allowedFolders: [],
    budget: 8,
    autonomy: 'ask',
    memory: 'project',
    color: '#2563eb',
    icon: 'blocks',
    builtIn: true
  },
  {
    id: 'explorer',
    name: 'Explorateur',
    role: 'Exploration du projet et recherche de contexte',
    instructions: 'Repère les fichiers existants et les relations sans inventer de chemins.',
    model: 'gemini-2.5-flash',
    tools: ['project-context', 'search'],
    allowedApplications: [],
    allowedFolders: [],
    budget: 5,
    autonomy: 'ask',
    memory: 'session',
    color: '#0891b2',
    icon: 'search',
    builtIn: true
  },
  {
    id: 'developer',
    name: 'Développeur',
    role: 'Développement général',
    instructions: 'Produit une solution concrète, cohérente avec le code réellement fourni.',
    model: 'claude-sonnet-4-5',
    tools: ['project-context', 'code'],
    allowedApplications: [],
    allowedFolders: [],
    budget: 8,
    autonomy: 'ask',
    memory: 'project',
    color: '#7c3aed',
    icon: 'code',
    builtIn: true
  },
  {
    id: 'frontend',
    name: 'Frontend',
    role: 'Développement frontend et expérience utilisateur',
    instructions: 'Vérifie les états, le responsive, l’accessibilité et les contrats API.',
    model: 'claude-sonnet-4-5',
    tools: ['project-context', 'code', 'browser'],
    allowedApplications: [],
    allowedFolders: ['frontend', 'src'],
    budget: 7,
    autonomy: 'scoped',
    memory: 'project',
    color: '#db2777',
    icon: 'layout',
    builtIn: true
  },
  {
    id: 'backend',
    name: 'Backend',
    role: 'Développement backend et API',
    instructions: 'Contrôle validation, autorisations, erreurs, données et compatibilité des API.',
    model: 'claude-sonnet-4-5',
    tools: ['project-context', 'code', 'tests'],
    allowedApplications: [],
    allowedFolders: ['backend', 'server'],
    budget: 7,
    autonomy: 'scoped',
    memory: 'project',
    color: '#059669',
    icon: 'server',
    builtIn: true
  },
  {
    id: 'fivem',
    name: 'FiveM',
    role: 'Développement FiveM',
    instructions: 'Respecte les manifests, ressources, performances serveur/client et frameworks déclarés.',
    model: 'claude-sonnet-4-5',
    tools: ['project-context', 'code'],
    allowedApplications: [],
    allowedFolders: ['fivem', 'resources'],
    budget: 7,
    autonomy: 'ask',
    memory: 'project',
    color: '#f97316',
    icon: 'gamepad',
    builtIn: true
  },
  {
    id: 'tests',
    name: 'Tests',
    role: 'Tests et validation',
    instructions: 'Propose des tests reproductibles et ne prétend jamais avoir exécuté un test non lancé.',
    model: 'gpt-4o',
    tools: ['project-context', 'tests'],
    allowedApplications: [],
    allowedFolders: [],
    budget: 6,
    autonomy: 'ask',
    memory: 'session',
    color: '#16a34a',
    icon: 'flask',
    builtIn: true
  },
  {
    id: 'reviewer',
    name: 'Réviseur',
    role: 'Revue indépendante',
    instructions: 'Recherche contradictions, régressions, conflits et validations non prouvées.',
    model: 'claude-sonnet-4-5',
    tools: ['project-context', 'review'],
    allowedApplications: [],
    allowedFolders: [],
    budget: 7,
    autonomy: 'ask',
    memory: 'off',
    color: '#dc2626',
    icon: 'scan',
    builtIn: true
  },
  {
    id: 'security',
    name: 'Sécurité',
    role: 'Sécurité applicative',
    instructions: 'Détecte les fuites de secrets, validations faibles, permissions et surfaces d’attaque.',
    model: 'claude-sonnet-4-5',
    tools: ['project-context', 'security'],
    allowedApplications: [],
    allowedFolders: [],
    budget: 7,
    autonomy: 'ask',
    memory: 'project',
    color: '#b91c1c',
    icon: 'shield',
    builtIn: true
  },
  {
    id: 'browser',
    name: 'Navigateur',
    role: 'Validation navigateur',
    instructions: 'Analyse les parcours Web, états réseau et compatibilités sans inventer de résultat.',
    model: 'gpt-4o',
    tools: ['browser', 'project-context'],
    allowedApplications: ['browser'],
    allowedFolders: [],
    budget: 5,
    autonomy: 'ask',
    memory: 'session',
    color: '#0284c7',
    icon: 'globe',
    builtIn: true
  },
  {
    id: 'documentation',
    name: 'Documentation',
    role: 'Documentation technique',
    instructions: 'Documente uniquement les comportements vérifiés et les prérequis explicites.',
    model: 'gemini-2.5-flash',
    tools: ['project-context', 'documentation'],
    allowedApplications: [],
    allowedFolders: ['docs'],
    budget: 4,
    autonomy: 'ask',
    memory: 'project',
    color: '#475569',
    icon: 'book',
    builtIn: true
  },
  {
    id: 'devops',
    name: 'DevOps',
    role: 'Build, déploiement et automatisation',
    instructions: 'Contrôle les environnements, builds, pipelines et retours arrière.',
    model: 'claude-sonnet-4-5',
    tools: ['project-context', 'terminal', 'git'],
    allowedApplications: [],
    allowedFolders: [],
    budget: 7,
    autonomy: 'ask',
    memory: 'project',
    color: '#0f766e',
    icon: 'workflow',
    builtIn: true
  },
  {
    id: 'blender-3d',
    name: 'Blender / 3D',
    role: 'Production Blender, 3ds Max et assets 3D',
    instructions: 'Respecte les formats, unités, matériaux, UV, LOD et contraintes de livraison.',
    model: 'gpt-4o',
    tools: ['project-context', '3d'],
    allowedApplications: ['Blender', '3ds Max'],
    allowedFolders: [],
    budget: 7,
    autonomy: 'ask',
    memory: 'project',
    color: '#ea580c',
    icon: 'box',
    builtIn: true
  },
  {
    id: 'cowork',
    name: 'Cowork',
    role: 'Coordination de travail général',
    instructions: 'Coordonne les livrables, décisions, documents et prochaines actions vérifiables.',
    model: 'claude-sonnet-4-5',
    tools: ['project-context', 'documentation', 'review'],
    allowedApplications: [],
    allowedFolders: [],
    budget: 6,
    autonomy: 'ask',
    memory: 'project',
    color: '#9333ea',
    icon: 'users',
    builtIn: true
  }
]);

interface SpecialistApiResponse {
  message: string;
  provider: string;
  model: string;
  model_display: string;
  task_id: string;
  agent_id: string;
  agent_name: string;
  phase: 'orchestrator' | 'specialist' | 'reviewer';
  files_used: string[];
  budget: number;
  duration_ms: number;
  entitlement_plan: string;
  usage?: {
    credits_consumed?: number;
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
}

interface PlannedTask {
  id: string;
  agentRole: string;
  objective: string;
  files: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  budget: number;
}

interface ParsedPlan {
  summary: string;
  risks: string[];
  tasks: PlannedTask[];
}

interface SpecialistCoordinationDraft {
  toAgentId: string;
  kind: NeuraCoCoordinationKind;
  subject: string;
  body: string;
  relatedTaskId?: string;
  inReplyTo?: string;
}

interface ParsedSpecialistResult {
  result: string;
  intermediateResult?: string;
  questions: string[];
  blockers: string[];
  testState: NonNullable<NeuraCoMultiAgentTask['testState']>;
  coordination: SpecialistCoordinationDraft[];
}

const COORDINATION_KINDS = new Set<NeuraCoCoordinationKind>([
  'information',
  'verification_request',
  'task_handoff',
  'conflict',
  'context_request',
  'response',
  'subtask_proposal',
  'decision',
  'result',
  'warning',
  'summary',
  'escalation'
]);

interface MultiAgentServiceOptions {
  storePath: string;
  executePhase?: (
    body: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<SpecialistApiResponse>;
}

const normalizeText = (value: string): string => (
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
);

const sanitizeStringList = (value: unknown, maxItems = 32): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 240))
      .filter(Boolean)
  )].slice(0, maxItems);
};

const sanitizeCustomAgent = (
  input: NeuraCoCustomAgentInput
): NeuraCoAgentDefinition => {
  const id = String(input?.id || '').trim().toLowerCase();
  if (!SAFE_AGENT_ID.test(id) || BUILT_IN_AGENTS.some((agent) => agent.id === id)) {
    throw new Error('Identifiant d’agent personnalisé invalide ou réservé.');
  }
  const name = String(input?.name || '').trim().slice(0, 120);
  const role = String(input?.role || '').trim().slice(0, 240);
  if (!name || !role) throw new Error('Le nom et le rôle de l’agent sont obligatoires.');
  const model = ALLOWED_MODELS.has(input.model) ? input.model : 'auto';
  const autonomy = ['ask', 'scoped', 'full'].includes(input.autonomy)
    ? input.autonomy
    : 'ask';
  const memory = ['off', 'session', 'project'].includes(input.memory)
    ? input.memory
    : 'session';
  return {
    id,
    name,
    role,
    instructions: String(input.instructions || '').trim().slice(0, 8000),
    model,
    tools: sanitizeStringList(input.tools),
    allowedApplications: sanitizeStringList(input.allowedApplications),
    allowedFolders: sanitizeStringList(input.allowedFolders),
    budget: Math.min(100, Math.max(1, Math.floor(Number(input.budget) || 1))),
    autonomy,
    memory,
    color: SAFE_COLOR.test(input.color || '') ? input.color : '#2563eb',
    icon: String(input.icon || 'bot').trim().slice(0, 40) || 'bot',
    builtIn: false
  };
};

const writeJsonAtomically = async (target: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  try {
    await rename(temporary, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EEXIST', 'EPERM'].includes(code || '')) throw error;
    await rm(target, { force: true });
    await rename(temporary, target);
  }
};

const extractJsonObject = (message: string): unknown => {
  const first = message.indexOf('{');
  const last = message.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Le plan de l’orchestrateur n’est pas un JSON valide.');
  return JSON.parse(message.slice(first, last + 1));
};

export const parseOrchestratorPlan = (
  message: string,
  allowedFiles: string[],
  maxTasks: number,
  budget: number
): ParsedPlan => {
  const raw = extractJsonObject(message) as {
    summary?: unknown;
    risks?: unknown;
    tasks?: unknown;
  };
  const fileLookup = new Map(
    allowedFiles.map((file) => [file.replace(/\\/g, '/').toLowerCase(), file])
  );
  if (!Array.isArray(raw.tasks)) throw new Error('Le plan ne contient aucune tâche exploitable.');
  let remainingBudget = Math.max(1, Math.floor(budget));
  const provisionalTasks = raw.tasks.slice(0, Math.min(MAX_PLAN_TASKS, maxTasks)).flatMap(
    (item, index): PlannedTask[] => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Record<string, unknown>;
      const objective = String(candidate.objective || '').trim().slice(0, 6000);
      if (!objective || remainingBudget < 1) return [];
      const requested = Math.min(
        remainingBudget,
        Math.max(1, Math.floor(Number(candidate.budget) || 1))
      );
      remainingBudget -= requested;
      const files = sanitizeStringList(candidate.files, MAX_CONTEXT_FILES).flatMap((file) => {
        const existing = fileLookup.get(file.replace(/\\/g, '/').toLowerCase());
        return existing ? [existing] : [];
      });
      return [{
        id: String(candidate.id || `specialist-${index + 1}`)
          .replace(/[^a-z0-9_-]/gi, '-')
          .slice(0, 100) || `specialist-${index + 1}`,
        agentRole: String(candidate.agentRole || 'Développeur').trim().slice(0, 240),
        objective,
        files,
        dependencies: sanitizeStringList(candidate.dependencies, MAX_PLAN_TASKS)
          .map((dependency) => dependency.replace(/[^a-z0-9_-]/gi, '-').slice(0, 100))
          .filter(Boolean),
        acceptanceCriteria: sanitizeStringList(candidate.acceptanceCriteria, 12),
        budget: requested
      }];
    }
  );
  const taskIds = new Set(provisionalTasks.map((task) => task.id));
  const tasks = provisionalTasks.map((task) => ({
    ...task,
    dependencies: [...new Set(task.dependencies)]
      .filter((dependency) => dependency !== task.id && taskIds.has(dependency))
  }));
  if (tasks.length === 0) throw new Error('Le plan ne contient aucune tâche exploitable.');
  return {
    summary: String(raw.summary || 'Plan multi-agents').trim().slice(0, 6000),
    risks: sanitizeStringList(raw.risks, 20),
    tasks
  };
};

export const planConflictFreeWaves = (
  tasks: Array<Pick<PlannedTask, 'id' | 'files'>>
): string[][] => {
  const waves: Array<{ ids: string[]; files: Set<string> }> = [];
  for (const task of tasks) {
    const normalizedFiles = new Set(
      task.files.map((file) => file.replace(/\\/g, '/').toLowerCase())
    );
    const target = waves.find((wave) => (
      [...normalizedFiles].every((file) => !wave.files.has(file))
    ));
    if (target) {
      target.ids.push(task.id);
      normalizedFiles.forEach((file) => target.files.add(file));
    } else {
      waves.push({ ids: [task.id], files: normalizedFiles });
    }
  }
  return waves.map((wave) => wave.ids);
};

export const planDependencyWaves = (
  tasks: Array<Pick<PlannedTask, 'id' | 'files' | 'dependencies'>>
): { waves: string[][]; blocked: string[] } => {
  const pending = new Map(tasks.map((task) => [task.id, task]));
  const completed = new Set<string>();
  const waves: string[][] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((task) => (
      task.dependencies.every((dependency) => completed.has(dependency))
    ));
    if (ready.length === 0) {
      return { waves, blocked: [...pending.keys()] };
    }
    const wave: string[] = [];
    const reserved = new Set<string>();
    for (const task of ready) {
      const normalized = task.files.map((file) => file.replace(/\\/g, '/').toLowerCase());
      if (normalized.some((file) => reserved.has(file))) continue;
      wave.push(task.id);
      normalized.forEach((file) => reserved.add(file));
    }
    if (wave.length === 0) wave.push(ready[0].id);
    waves.push(wave);
    wave.forEach((taskId) => {
      pending.delete(taskId);
      completed.add(taskId);
    });
  }
  return { waves, blocked: [] };
};

const parseSpecialistResult = (
  message: string,
  validAgentIds: Set<string>,
  validTaskIds: Set<string>
): ParsedSpecialistResult => {
  const fallback: ParsedSpecialistResult = {
    result: message.trim().slice(0, 12_000),
    questions: [],
    blockers: [],
    testState: 'not_requested',
    coordination: []
  };
  try {
    const raw = extractJsonObject(message) as Record<string, unknown>;
    const result = String(raw.result || raw.message || '').trim().slice(0, 12_000);
    if (!result) return fallback;
    const rawTestState = String(raw.testState || '');
    const testState = ['not_requested', 'pending', 'passed', 'failed', 'blocked']
      .includes(rawTestState)
      ? rawTestState as ParsedSpecialistResult['testState']
      : 'not_requested';
    const coordination = Array.isArray(raw.coordination)
      ? raw.coordination.slice(0, 12).flatMap((item): SpecialistCoordinationDraft[] => {
        if (!item || typeof item !== 'object') return [];
        const candidate = item as Record<string, unknown>;
        const toAgentId = String(candidate.toAgentId || '').trim();
        const kind = String(candidate.kind || 'information') as NeuraCoCoordinationKind;
        const body = String(candidate.body || '').trim().slice(0, 2000);
        if (!body || !COORDINATION_KINDS.has(kind) || !validAgentIds.has(toAgentId)) {
          return [];
        }
        const relatedTaskId = String(candidate.relatedTaskId || '').trim();
        const inReplyTo = String(candidate.inReplyTo || '').trim();
        return [{
          toAgentId,
          kind,
          subject: String(candidate.subject || kind).trim().slice(0, 180),
          body,
          relatedTaskId: validTaskIds.has(relatedTaskId) ? relatedTaskId : undefined,
          inReplyTo: SAFE_TASK_ID.test(inReplyTo) ? inReplyTo : undefined
        }];
      })
      : [];
    return {
      result,
      intermediateResult: String(raw.intermediateResult || '').trim().slice(0, 4000) || undefined,
      questions: sanitizeStringList(raw.questions, 8),
      blockers: sanitizeStringList(raw.blockers, 8),
      testState,
      coordination
    };
  } catch {
    return fallback;
  }
};

const chooseAgent = (
  role: string,
  agents: NeuraCoAgentDefinition[],
  index: number
): NeuraCoAgentDefinition => {
  const normalizedRole = normalizeText(role);
  const direct = agents.find((agent) => {
    const name = normalizeText(agent.name);
    const agentRole = normalizeText(agent.role);
    return normalizedRole.includes(name)
      || name.includes(normalizedRole)
      || normalizedRole.split(/\s+/).some((word) => word.length > 4 && agentRole.includes(word));
  });
  return direct || agents[index % agents.length] || BUILT_IN_AGENTS[2];
};

const redactMemory = (value: string): string => (
  value
    .replace(
      /(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[MASQUÉ]'
    )
    .slice(0, 2000)
);

export class MultiAgentService {
  private readonly storePath: string;
  private readonly memoryPath: string;
  private readonly executePhase: NonNullable<MultiAgentServiceOptions['executePhase']>;
  private readonly sessionMemory = new Map<string, string[]>();
  private memoryWriteQueue: Promise<void> = Promise.resolve();

  constructor(options: MultiAgentServiceOptions) {
    this.storePath = options.storePath;
    this.memoryPath = path.join(path.dirname(options.storePath), 'multi-agent-memory.json');
    this.executePhase = options.executePhase || (async (body, signal) => (
      authenticatedApiRequest<SpecialistApiResponse>('/neuraco/agents/execute', {
        method: 'POST',
        signal,
        body: JSON.stringify(body)
      })
    ));
  }

  private async readCustomAgents(): Promise<NeuraCoAgentDefinition[]> {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, MAX_CUSTOM_AGENTS).flatMap((item) => {
        try {
          return [sanitizeCustomAgent(item as NeuraCoCustomAgentInput)];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  async listAgents(): Promise<NeuraCoAgentDefinition[]> {
    return [...BUILT_IN_AGENTS.map((agent) => ({ ...agent })), ...await this.readCustomAgents()];
  }

  async saveAgent(input: NeuraCoCustomAgentInput): Promise<NeuraCoAgentDefinition> {
    const agent = sanitizeCustomAgent(input);
    const agents = await this.readCustomAgents();
    const existing = agents.findIndex((item) => item.id === agent.id);
    if (existing >= 0) agents[existing] = agent;
    else agents.push(agent);
    if (agents.length > MAX_CUSTOM_AGENTS) {
      throw new Error(`NeuraCo accepte au maximum ${MAX_CUSTOM_AGENTS} agents personnalisés.`);
    }
    await writeJsonAtomically(this.storePath, agents);
    return agent;
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    if (!SAFE_AGENT_ID.test(agentId) || BUILT_IN_AGENTS.some((agent) => agent.id === agentId)) {
      return false;
    }
    const agents = await this.readCustomAgents();
    const next = agents.filter((agent) => agent.id !== agentId);
    if (next.length === agents.length) return false;
    await writeJsonAtomically(this.storePath, next);
    return true;
  }

  private async readProjectMemory(projectId: string): Promise<Record<string, string[]>> {
    try {
      const parsed = JSON.parse(await readFile(this.memoryPath, 'utf8')) as Record<
        string,
        Record<string, string[]>
      >;
      return parsed?.[projectId] || {};
    } catch {
      return {};
    }
  }

  private async remember(
    projectId: string,
    agent: NeuraCoAgentDefinition,
    message: string
  ): Promise<void> {
    if (agent.memory === 'off') return;
    const item = redactMemory(message);
    const key = `${projectId}:${agent.id}`;
    if (agent.memory === 'session') {
      this.sessionMemory.set(
        key,
        [...(this.sessionMemory.get(key) || []), item].slice(-MAX_MEMORY_ITEMS)
      );
      return;
    }
    this.memoryWriteQueue = this.memoryWriteQueue.then(async () => {
      let all: Record<string, Record<string, string[]>> = {};
      try {
        all = JSON.parse(await readFile(this.memoryPath, 'utf8'));
      } catch {
        all = {};
      }
      const project = all[projectId] || {};
      project[agent.id] = [...(project[agent.id] || []), item].slice(-MAX_MEMORY_ITEMS);
      all[projectId] = project;
      await writeJsonAtomically(this.memoryPath, all);
    });
    await this.memoryWriteQueue;
  }

  private async memoryFor(
    projectId: string,
    agent: NeuraCoAgentDefinition
  ): Promise<string> {
    if (agent.memory === 'off') return '';
    const key = `${projectId}:${agent.id}`;
    const items = agent.memory === 'session'
      ? this.sessionMemory.get(key) || []
      : (await this.readProjectMemory(projectId))[agent.id] || [];
    if (items.length === 0) return '';
    return `\n\nMémoire ${agent.memory} vérifiée de cet agent:\n${items.join('\n---\n')}`;
  }

  private phaseBody(
    request: NeuraCoMultiAgentRequest,
    taskId: string,
    agent: NeuraCoAgentDefinition,
    phase: SpecialistApiResponse['phase'],
    objective: string,
    budget: number,
    files: NeuraCoAgentFileContext[]
  ): Record<string, unknown> {
    return {
      task_id: taskId,
      agent_id: agent.id,
      agent_name: agent.name,
      agent_role: agent.role,
      agent_instructions: agent.instructions,
      objective,
      project_id: request.projectId,
      project_name: request.projectName,
      phase,
      budget,
      model: request.preferredModel && request.preferredModel !== 'auto'
        ? request.preferredModel
        : ALLOWED_MODELS.has(agent.model) ? agent.model : 'auto',
      effort: request.effort || 'normal',
      communication_style: request.communicationStyle || 'normal',
      response_speed: request.responseSpeed || 'standard',
      files: files.map((file) => ({
        path: file.path,
        content: file.content,
        language: file.language || 'text'
      }))
    };
  }

  async run(
    rawRequest: NeuraCoMultiAgentRequest,
    signal: AbortSignal,
    onProgress: (event: NeuraCoMultiAgentProgress) => void
  ): Promise<NeuraCoMultiAgentResult> {
    const startedAt = Date.now();
    const taskId = rawRequest.taskId || randomUUID();
    if (!SAFE_TASK_ID.test(taskId)) throw new Error('Identifiant de tâche multi-agents invalide.');
    const objective = String(rawRequest.objective || '').trim();
    if (!objective || objective.length > 12_000) {
      throw new Error('L’objectif doit contenir entre 1 et 12 000 caractères.');
    }
    if (!/^[a-f0-9]{24}$/i.test(rawRequest.projectId)) {
      throw new Error('Identifiant de projet NeuraCo invalide.');
    }
    const budget = Math.min(100, Math.max(3, Math.floor(Number(rawRequest.budget) || 3)));
    const maxAgents = Math.min(8, Math.max(1, Math.floor(Number(rawRequest.maxAgents) || 1)));
    const files = (Array.isArray(rawRequest.files) ? rawRequest.files : [])
      .filter((file) => file && typeof file.path === 'string' && typeof file.content === 'string')
      .slice(0, MAX_CONTEXT_FILES);
    const request = { ...rawRequest, taskId, objective, budget, maxAgents, files };
    const allAgents = await this.listAgents();
    const selected = allAgents.filter((agent) => rawRequest.selectedAgentIds.includes(agent.id));
    const available = selected.length > 0
      ? selected.slice(0, maxAgents)
      : allAgents.filter((agent) => ['architect', 'developer', 'tests'].includes(agent.id))
        .slice(0, maxAgents);
    const orchestrator = BUILT_IN_AGENTS[0];
    const reviewer = BUILT_IN_AGENTS.find((agent) => agent.id === 'reviewer') || BUILT_IN_AGENTS[0];
    onProgress({
      taskId,
      phase: 'planning',
      message: 'L’orchestrateur analyse l’objectif et les fichiers autorisés.',
      completed: 0,
      total: 1
    });
    const planResponse = await this.executePhase(
      this.phaseBody(request, taskId, orchestrator, 'orchestrator', objective, Math.min(15, budget), files),
      signal
    );
    let creditsConsumed = Number(planResponse.usage?.credits_consumed || 0);
    const plan = parseOrchestratorPlan(
      planResponse.message,
      files.map((file) => file.path),
      Math.min(maxAgents, MAX_PLAN_TASKS),
      budget
    );
    const assigned = plan.tasks.map((task, index) => ({
      task,
      agent: chooseAgent(task.agentRole, available, index)
    }));
    const tasks: NeuraCoMultiAgentTask[] = assigned.map(({ task, agent }) => ({
      id: task.id,
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      objective: task.objective,
      files: task.files,
      dependencies: task.dependencies,
      acceptanceCriteria: task.acceptanceCriteria,
      budget: task.budget,
      status: task.dependencies.length > 0 ? 'waiting' : 'queued',
      questions: [],
      blockers: [],
      testState: 'not_requested'
    }));
    const coordinationMessages: NeuraCoAgentCoordinationMessage[] = [];
    const fileReservations: NeuraCoAgentFileReservation[] = [];
    const pairMessageCounts = new Map<string, number>();
    const messageFingerprints = new Set<string>();
    const coordinationStartedAt = Date.now();
    const coordinationLimits: NeuraCoCoordinationLimits = {
      maxMessages: Math.min(
        MAX_COORDINATION_MESSAGES,
        Math.max(8, budget * 2)
      ),
      maxMessagesPerPair: MAX_COORDINATION_MESSAGES_PER_PAIR,
      maxDurationMs: MAX_COORDINATION_DURATION_MS,
      messagesUsed: 0,
      escalations: 0,
      limitReached: false
    };
    const agentNames = new Map<string, string>([
      ...available.map((agent) => [agent.id, agent.name] as const),
      ['orchestrator', orchestrator.name],
      ['reviewer', reviewer.name],
      ['team', 'Equipe']
    ]);
    const addCoordinationMessage = (
      fromAgent: NeuraCoAgentDefinition,
      toAgentId: string,
      kind: NeuraCoCoordinationKind,
      subject: string,
      body: string,
      relatedTaskId?: string,
      inReplyTo?: string
    ): NeuraCoAgentCoordinationMessage | undefined => {
      if (
        Date.now() - coordinationStartedAt > coordinationLimits.maxDurationMs
        || coordinationMessages.length >= coordinationLimits.maxMessages
      ) {
        coordinationLimits.limitReached = true;
        return undefined;
      }
      const target = agentNames.has(toAgentId) ? toAgentId : 'orchestrator';
      const pairKey = `${fromAgent.id}->${target}`;
      const pairCount = pairMessageCounts.get(pairKey) || 0;
      if (pairCount >= coordinationLimits.maxMessagesPerPair) {
        coordinationLimits.limitReached = true;
        return undefined;
      }
      const safeBody = redactMemory(body).slice(0, 2000);
      const fingerprint = `${pairKey}:${kind}:${normalizeText(safeBody).slice(0, 400)}`;
      if (!safeBody || messageFingerprints.has(fingerprint)) return undefined;
      const entry: NeuraCoAgentCoordinationMessage = {
        id: randomUUID(),
        taskId,
        fromAgentId: fromAgent.id,
        fromAgentName: fromAgent.name,
        toAgentId: target,
        toAgentName: agentNames.get(target) || 'Orchestrateur',
        kind,
        subject: subject.trim().slice(0, 180) || kind,
        body: safeBody,
        relatedTaskId,
        inReplyTo,
        createdAt: new Date().toISOString()
      };
      coordinationMessages.push(entry);
      messageFingerprints.add(fingerprint);
      pairMessageCounts.set(pairKey, pairCount + 1);
      coordinationLimits.messagesUsed = coordinationMessages.length;
      if (target === 'orchestrator' || kind === 'escalation') {
        coordinationLimits.escalations += 1;
      }
      return entry;
    };
    const progressContext = () => ({
      coordinationMessages: coordinationMessages.map((message) => ({ ...message })),
      fileReservations: fileReservations.map((reservation) => ({ ...reservation })),
      coordinationLimits: { ...coordinationLimits }
    });
    onProgress({
      taskId,
      phase: 'planned',
      message: `${tasks.length} tâche(s) planifiée(s) dans des vagues sans conflit de fichiers.`,
      completed: 0,
      total: tasks.length
    });
    const dependencyPlan = planDependencyWaves(plan.tasks);
    const waves = dependencyPlan.waves;
    for (const blockedId of dependencyPlan.blocked) {
      const blockedTask = tasks.find((task) => task.id === blockedId);
      const assignment = assigned.find(({ task }) => task.id === blockedId);
      if (!blockedTask || !assignment) continue;
      blockedTask.status = 'blocked';
      blockedTask.blockers = ['Cycle de dependances detecte dans le plan.'];
      addCoordinationMessage(
        assignment.agent,
        'orchestrator',
        'escalation',
        'Cycle de dependances',
        `La tache ${blockedTask.id} ne peut pas demarrer car ses dependances forment un cycle.`,
        blockedTask.id
      );
    }
    let completed = 0;
    for (const wave of waves) {
      await Promise.all(wave.map(async (plannedId) => {
        const taskIndex = tasks.findIndex((task) => task.id === plannedId);
        const assignment = assigned[taskIndex];
        const current = tasks[taskIndex];
        if (!assignment || !current) return;
        const failedDependencies = current.dependencies.filter((dependencyId) => {
          const dependency = tasks.find((task) => task.id === dependencyId);
          return !dependency || dependency.status !== 'completed';
        });
        if (failedDependencies.length > 0) {
          current.status = 'blocked';
          current.blockers = [
            `Dependance non terminee: ${failedDependencies.join(', ')}`
          ];
          addCoordinationMessage(
            assignment.agent,
            'orchestrator',
            'escalation',
            'Dependance bloquante',
            `La tache ${current.id} attend ${failedDependencies.join(', ')}.`,
            current.id
          );
          completed += 1;
          onProgress({
            taskId,
            phase: 'specialists',
            message: `${assignment.agent.name}: blocked.`,
            completed,
            total: tasks.length,
            task: { ...current },
            ...progressContext()
          });
          return;
        }
        if (signal.aborted) {
          current.status = 'cancelled';
          return;
        }
        current.status = 'running';
        const reservations: NeuraCoAgentFileReservation[] = current.files.map((file) => ({
          path: file,
          taskId: current.id,
          agentId: assignment.agent.id,
          agentName: assignment.agent.name,
          reservedAt: new Date().toISOString()
        }));
        fileReservations.push(...reservations);
        onProgress({
          taskId,
          phase: 'specialists',
          message: `${assignment.agent.name} travaille sur une tâche isolée.`,
          completed,
          total: tasks.length,
          task: { ...current },
          ...progressContext()
        });
        const taskFiles = files.filter((file) => current.files.includes(file.path));
        const memory = await this.memoryFor(request.projectId, assignment.agent);
        const incomingMessages = coordinationMessages.filter((message) => (
          message.toAgentId === assignment.agent.id || message.toAgentId === 'team'
        )).slice(-12);
        const dependencyResults = current.dependencies.flatMap((dependencyId) => {
          const dependency = tasks.find((task) => task.id === dependencyId);
          if (!dependency?.message) return [];
          return [
            `Resultat de ${dependency.agentName} pour ${dependency.id}:\n`
            + String(dependency.message).slice(0, 2200)
          ];
        });
        const coordinationObjective = [
          current.objective,
          `Identifiant de ta tache: ${current.id}`,
          `Agents de l'equipe: ${available.map((agent) => `${agent.id} (${agent.name})`).join(', ')}`,
          current.dependencies.length > 0
            ? `Dependances satisfaites: ${current.dependencies.join(', ')}`
            : 'Aucune dependance.',
          current.acceptanceCriteria.length > 0
            ? `Criteres d'acceptation:\n- ${current.acceptanceCriteria.join('\n- ')}`
            : "Aucun critere d'acceptation supplementaire.",
          dependencyResults.length > 0
            ? `Resultats transmis directement par les agents dependants:\n${dependencyResults.join('\n\n')}`
            : '',
          incomingMessages.length > 0
            ? `Boite de messages interne:\n${incomingMessages.map((message) => (
              `[${message.kind}] ${message.fromAgentName}: ${message.subject}\n${message.body}`
            )).join('\n\n')}`
            : '',
          [
            'Reponds avec un objet JSON valide contenant:',
            '- result: resultat concret sans raisonnement prive;',
            '- intermediateResult: resume intermediaire facultatif;',
            '- questions: liste de questions de coordination;',
            '- blockers: liste de blocages;',
            '- testState: not_requested, pending, passed, failed ou blocked;',
            '- coordination: liste facultative de messages avec toAgentId, kind, subject, body, relatedTaskId.',
            'Kinds autorises: information, verification_request, task_handoff, conflict, context_request,',
            'response, subtask_proposal, decision, result, warning, summary, escalation.',
            "N'envoie que des messages utiles a la progression et aucun raisonnement prive."
          ].join('\n')
        ].filter(Boolean).join('\n\n').slice(0, 11_800);
        try {
          const response = await this.executePhase(
            this.phaseBody(
              request,
              taskId,
              { ...assignment.agent, instructions: assignment.agent.instructions + memory },
              'specialist',
              coordinationObjective,
              current.budget,
              taskFiles
            ),
            signal
          );
          const parsed = parseSpecialistResult(
            response.message,
            new Set([...available.map((agent) => agent.id), 'orchestrator', 'reviewer', 'team']),
            new Set(tasks.map((task) => task.id))
          );
          current.status = 'completed';
          current.message = parsed.result;
          current.intermediateResult = parsed.intermediateResult;
          current.questions = parsed.questions;
          current.blockers = parsed.blockers;
          current.testState = parsed.testState;
          current.provider = response.provider;
          current.model = response.model;
          current.durationMs = response.duration_ms;
          current.creditsConsumed = Number(response.usage?.credits_consumed || 0);
          creditsConsumed += current.creditsConsumed;
          for (const draft of parsed.coordination) {
            addCoordinationMessage(
              assignment.agent,
              draft.toAgentId,
              draft.kind,
              draft.subject,
              draft.body,
              draft.relatedTaskId || current.id,
              draft.inReplyTo
            );
          }
          for (const question of parsed.questions) {
            addCoordinationMessage(
              assignment.agent,
              'orchestrator',
              'context_request',
              'Contexte demande',
              question,
              current.id
            );
          }
          for (const blocker of parsed.blockers) {
            addCoordinationMessage(
              assignment.agent,
              'orchestrator',
              'escalation',
              'Blocage signale',
              blocker,
              current.id
            );
          }
          const dependents = tasks.filter((task) => task.dependencies.includes(current.id));
          for (const dependent of dependents) {
            addCoordinationMessage(
              assignment.agent,
              dependent.agentId,
              'result',
              `Resultat disponible: ${current.id}`,
              parsed.intermediateResult || parsed.result.slice(0, 1800),
              dependent.id
            );
          }
          await this.remember(request.projectId, assignment.agent, parsed.result);
        } catch (error) {
          current.status = signal.aborted ? 'cancelled' : 'failed';
          current.message = error instanceof Error ? error.message : 'Échec de l’agent.';
        } finally {
          const releasedAt = new Date().toISOString();
          reservations.forEach((reservation) => {
            reservation.releasedAt = releasedAt;
          });
        }
        completed += 1;
        onProgress({
          taskId,
          phase: signal.aborted ? 'cancelled' : 'specialists',
          message: `${assignment.agent.name}: ${current.status}.`,
          completed,
          total: tasks.length,
          task: { ...current },
          ...progressContext()
        });
      }));
      if (signal.aborted) break;
    }
    if (signal.aborted) {
      throw new DOMException('Tâche multi-agents annulée.', 'AbortError');
    }
    onProgress({
      taskId,
      phase: 'reviewing',
      message: 'Le réviseur indépendant contrôle les résultats et les conflits.',
      completed,
      total: tasks.length
    });
    const reviewInput = [
      `Objectif initial: ${objective}`,
      `Plan: ${plan.summary}`,
      `Risques initiaux: ${plan.risks.join('; ') || 'aucun déclaré'}`,
      ...tasks.map((task) => (
        `\nAgent ${task.agentName} (${task.status})\n`
        + `Fichiers: ${task.files.join(', ') || 'aucun'}\n`
        + `Résultat:\n${String(task.message || '').slice(0, 3500)}`
      )),
      ...coordinationMessages.map((message) => (
        `\nCoordination ${message.fromAgentName} -> ${message.toAgentName} `
        + `[${message.kind}]: ${message.subject}\n${message.body}`
      ))
    ].join('\n').slice(0, 11_500);
    const reviewResponse = await this.executePhase(
      this.phaseBody(
        request,
        taskId,
        reviewer,
        'reviewer',
        reviewInput,
        Math.min(15, Math.max(3, budget - tasks.reduce((sum, task) => sum + task.budget, 0))),
        files
      ),
      signal
    );
    creditsConsumed += Number(reviewResponse.usage?.credits_consumed || 0);
    const result: NeuraCoMultiAgentResult = {
      taskId,
      summary: plan.summary,
      risks: plan.risks,
      tasks,
      review: reviewResponse.message,
      provider: reviewResponse.provider,
      model: reviewResponse.model,
      durationMs: Date.now() - startedAt,
      budgetUsed: tasks.reduce((sum, task) => sum + task.budget, 0),
      creditsConsumed: Math.round(creditsConsumed * 100) / 100,
      entitlementPlan: reviewResponse.entitlement_plan,
      coordinationMessages,
      fileReservations,
      coordinationLimits: { ...coordinationLimits }
    };
    onProgress({
      taskId,
      phase: 'completed',
      message: 'Orchestration terminée et revue indépendante disponible.',
      completed: tasks.length,
      total: tasks.length,
      ...progressContext()
    });
    return result;
  }
}
