import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import path from 'node:path';
import type {
  NeuraCoCheckpointTaskSettings,
  NeuraCoConversationThread,
  NeuraCoConversationThreadCreate,
  NeuraCoConversationThreadSummary,
  NeuraCoLocalSession,
  NeuraCoLocalSessionSave,
  NeuraCoPersistedChatMessage,
  NeuraCoProject
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

interface ProjectThreads {
  activeThreadId: string;
  threads: Record<string, NeuraCoConversationThread>;
}

interface SessionDocument {
  version: 2;
  projects: Record<string, ProjectThreads>;
}

interface LegacySessionDocument {
  version: 1;
  sessions: Record<string, NeuraCoLocalSession>;
}

const MAX_MESSAGES = 200;
const MAX_CONTENT_LENGTH = 50_000;
const MAX_FILES_PER_MESSAGE = 32;
const MAX_THREADS_PER_PROJECT = 200;
const COMPRESSION_THRESHOLD_BYTES = 64 * 1024;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const emptyDocument = (): SessionDocument => ({ version: 2, projects: {} });

const safeText = (value: unknown, maxLength: number): string => (
  typeof value === 'string' ? value.slice(0, maxLength) : ''
);

const normalizeTaskSettings = (
  value: NeuraCoCheckpointTaskSettings | undefined,
  executionMode: NeuraCoCheckpointTaskSettings['executionMode']
): NeuraCoCheckpointTaskSettings | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const taskModes = [
    'automatic',
    'question',
    'plan',
    'code',
    'cowork',
    'research',
    '3d',
    'fivem',
    'frontend',
    'audit'
  ] as const;
  const effortLevels = ['rapid', 'normal', 'deep', 'maximum'] as const;
  const communicationStyles = ['direct', 'normal', 'detailed', 'pedagogical'] as const;
  return {
    taskMode: taskModes.includes(value.taskMode as typeof taskModes[number])
      ? value.taskMode
      : 'automatic',
    effort: effortLevels.includes(value.effort as typeof effortLevels[number])
      ? value.effort
      : 'normal',
    communicationStyle: communicationStyles.includes(
      value.communicationStyle as typeof communicationStyles[number]
    )
      ? value.communicationStyle
      : 'normal',
    executionMode: ['local', 'cloud', 'hybrid'].includes(value.executionMode)
      ? value.executionMode
      : executionMode,
    includeActiveFile: value.includeActiveFile !== false
  };
};

const mainThreadId = (projectId: string): string => {
  const safeProject = projectId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
  return `main_${safeProject || 'project'}`;
};

const sanitizeMessages = (
  messages: NeuraCoLocalSessionSave['messages']
): NeuraCoPersistedChatMessage[] => {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-MAX_MESSAGES).flatMap((message) => {
    if (
      !message
      || !['user', 'assistant', 'system'].includes(message.role)
      || typeof message.content !== 'string'
    ) {
      return [];
    }
    const content = redactSecrets(message.content.slice(0, MAX_CONTENT_LENGTH));
    if (!content) return [];
    return [{
      id: safeText(message.id, 160) || `restored-${Date.now()}`,
      role: message.role,
      content,
      model: safeText(message.model, 240) || undefined,
      files: Array.isArray(message.files)
        ? message.files
          .filter((file): file is string => typeof file === 'string')
          .slice(0, MAX_FILES_PER_MESSAGE)
          .map((file) => redactSecrets(file.slice(0, 1000)))
        : undefined
    }];
  });
};

const normalizeThread = (
  project: Pick<NeuraCoProject, 'id' | 'name'>,
  thread: Partial<NeuraCoConversationThread>,
  fallbackId: string
): NeuraCoConversationThread => {
  const now = new Date().toISOString();
  const threadId = safeText(thread.threadId, 120) || fallbackId;
  const executionMode = ['cloud', 'hybrid'].includes(thread.executionMode || '')
    ? thread.executionMode as 'cloud' | 'hybrid'
    : 'local';
  return {
    projectId: project.id,
    projectName: project.name,
    threadId,
    title: safeText(thread.title, 120) || 'Fil principal',
    archived: Boolean(thread.archived),
    parentThreadId: safeText(thread.parentThreadId, 120) || undefined,
    forkedFromMessageId: safeText(thread.forkedFromMessageId, 160) || undefined,
    checkpointId: safeText(thread.checkpointId, 160) || undefined,
    sessionId: safeText(thread.sessionId, 120) || undefined,
    executionMode,
    cloudTaskId: safeText(thread.cloudTaskId, 120) || undefined,
    taskSettings: normalizeTaskSettings(thread.taskSettings, executionMode),
    messages: sanitizeMessages(thread.messages || []),
    createdAt: safeText(thread.createdAt, 80) || now,
    updatedAt: safeText(thread.updatedAt, 80) || now
  };
};

const initialThread = (
  project: Pick<NeuraCoProject, 'id' | 'name'>,
  title = 'Fil principal'
): NeuraCoConversationThread => normalizeThread(
  project,
  {
    threadId: mainThreadId(project.id),
    title,
    archived: false,
    executionMode: 'local',
    messages: []
  },
  mainThreadId(project.id)
);

const threadSummary = (
  thread: NeuraCoConversationThread,
  activeThreadId: string
): NeuraCoConversationThreadSummary => {
  const lastMessage = thread.messages.at(-1)?.content.trim();
  return {
    threadId: thread.threadId,
    title: thread.title,
    archived: thread.archived,
    active: thread.threadId === activeThreadId,
    parentThreadId: thread.parentThreadId,
    checkpointId: thread.checkpointId,
    messageCount: thread.messages.length,
    lastMessagePreview: lastMessage
      ? lastMessage.replace(/\s+/g, ' ').slice(0, 180)
      : undefined,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  };
};

export class LocalSessionStore {
  constructor(private readonly storePath: string) {}

  private migrateLegacy(parsed: LegacySessionDocument): SessionDocument {
    const document = emptyDocument();
    for (const [projectId, session] of Object.entries(parsed.sessions || {})) {
      if (!session || session.projectId !== projectId) continue;
      const project = { id: projectId, name: session.projectName || projectId };
      const thread = normalizeThread(project, {
        ...session,
        threadId: mainThreadId(projectId),
        title: 'Fil principal',
        archived: false,
        createdAt: session.updatedAt
      }, mainThreadId(projectId));
      document.projects[projectId] = {
        activeThreadId: thread.threadId,
        threads: { [thread.threadId]: thread }
      };
    }
    return document;
  }

  private async readDocument(): Promise<SessionDocument> {
    try {
      const payload = await readFile(this.storePath);
      const source = payload[0] === 0x1f && payload[1] === 0x8b
        ? await gunzipAsync(payload)
        : payload;
      const parsed = JSON.parse(source.toString('utf8')) as
        | SessionDocument
        | LegacySessionDocument;
      if (
        parsed?.version === 2
        && parsed.projects
        && typeof parsed.projects === 'object'
      ) {
        return parsed;
      }
      if (
        parsed?.version === 1
        && parsed.sessions
        && typeof parsed.sessions === 'object'
      ) {
        return this.migrateLegacy(parsed);
      }
      return emptyDocument();
    } catch {
      return emptyDocument();
    }
  }

  private async writeDocument(document: SessionDocument): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.${process.pid}.tmp`;
    const serialized = Buffer.from(JSON.stringify(document), 'utf8');
    const payload = serialized.length >= COMPRESSION_THRESHOLD_BYTES
      ? await gzipAsync(serialized, { level: 6 })
      : serialized;
    await writeFile(
      temporary,
      payload,
      { mode: 0o600 }
    );
    await rename(temporary, this.storePath);
  }

  private ensureProject(
    document: SessionDocument,
    project: NeuraCoProject
  ): ProjectThreads {
    let projectThreads = document.projects[project.id];
    if (!projectThreads || typeof projectThreads.threads !== 'object') {
      const thread = initialThread(project);
      projectThreads = {
        activeThreadId: thread.threadId,
        threads: { [thread.threadId]: thread }
      };
      document.projects[project.id] = projectThreads;
      return projectThreads;
    }
    for (const [threadId, rawThread] of Object.entries(projectThreads.threads)) {
      projectThreads.threads[threadId] = normalizeThread(project, rawThread, threadId);
    }
    if (!projectThreads.threads[projectThreads.activeThreadId]) {
      projectThreads.activeThreadId = Object.keys(projectThreads.threads)[0] || '';
    }
    if (!projectThreads.activeThreadId) {
      const thread = initialThread(project);
      projectThreads.activeThreadId = thread.threadId;
      projectThreads.threads[thread.threadId] = thread;
    }
    return projectThreads;
  }

  private activeThread(
    document: SessionDocument,
    project: NeuraCoProject
  ): NeuraCoConversationThread {
    const projectThreads = this.ensureProject(document, project);
    return projectThreads.threads[projectThreads.activeThreadId];
  }

  async get(project: NeuraCoProject): Promise<NeuraCoConversationThread | null> {
    const document = await this.readDocument();
    if (!document.projects[project.id]) return null;
    return this.activeThread(document, project);
  }

  async snapshot(
    project: NeuraCoProject,
    threadId?: string
  ): Promise<NeuraCoConversationThread | undefined> {
    const document = await this.readDocument();
    if (!document.projects[project.id]) return undefined;
    const projectThreads = this.ensureProject(document, project);
    const requestedId = safeText(threadId, 120) || projectThreads.activeThreadId;
    return projectThreads.threads[requestedId];
  }

  async list(
    project: NeuraCoProject,
    includeArchived = false
  ): Promise<NeuraCoConversationThreadSummary[]> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    return Object.values(projectThreads.threads)
      .filter((thread) => includeArchived || !thread.archived)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((thread) => threadSummary(thread, projectThreads.activeThreadId));
  }

  async save(
    project: NeuraCoProject,
    input: NeuraCoLocalSessionSave
  ): Promise<NeuraCoConversationThread> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    const requestedThreadId = safeText(input.threadId, 120);
    const current = requestedThreadId
      ? projectThreads.threads[requestedThreadId]
      : projectThreads.threads[projectThreads.activeThreadId];
    if (!current) throw new Error('Fil de conversation NeuraCo introuvable.');
    const session: NeuraCoConversationThread = {
      ...current,
      projectName: project.name,
      sessionId: safeText(input.sessionId, 120) || undefined,
      executionMode: ['cloud', 'hybrid'].includes(input.executionMode)
        ? input.executionMode
        : 'local',
      cloudTaskId: safeText(input.cloudTaskId, 120) || undefined,
      taskSettings: normalizeTaskSettings(input.taskSettings, input.executionMode),
      messages: sanitizeMessages(input.messages),
      updatedAt: new Date().toISOString()
    };
    projectThreads.activeThreadId = session.threadId;
    projectThreads.threads[session.threadId] = session;
    await this.writeDocument(document);
    return session;
  }

  async create(
    project: NeuraCoProject,
    request: NeuraCoConversationThreadCreate = {}
  ): Promise<NeuraCoConversationThread> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    if (Object.keys(projectThreads.threads).length >= MAX_THREADS_PER_PROJECT) {
      throw new Error('La limite de 200 fils de conversation par projet est atteinte.');
    }
    const source = request.fromThreadId
      ? projectThreads.threads[safeText(request.fromThreadId, 120)]
      : undefined;
    if (request.fromThreadId && !source) {
      throw new Error('Fil source NeuraCo introuvable.');
    }
    let sourceMessages = source?.messages || [];
    if (source && request.fromMessageId) {
      const messageIndex = sourceMessages.findIndex(
        (message) => message.id === request.fromMessageId
      );
      if (messageIndex < 0) throw new Error('Point de branchement introuvable.');
      sourceMessages = sourceMessages.slice(0, messageIndex + 1);
    }
    const now = new Date().toISOString();
    const threadId = `thread_${randomUUID()}`;
    const thread = normalizeThread(project, {
      threadId,
      title: safeText(request.title, 120)
        || (source ? `Alternative — ${source.title}` : 'Nouvelle tâche'),
      archived: false,
      parentThreadId: source?.threadId,
      forkedFromMessageId: safeText(request.fromMessageId, 160) || undefined,
      checkpointId: safeText(request.checkpointId, 160) || source?.checkpointId,
      executionMode: source?.executionMode || 'local',
      messages: sourceMessages,
      createdAt: now,
      updatedAt: now
    }, threadId);
    projectThreads.threads[threadId] = thread;
    projectThreads.activeThreadId = threadId;
    await this.writeDocument(document);
    return thread;
  }

  async select(
    project: NeuraCoProject,
    threadId: string
  ): Promise<NeuraCoConversationThread> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    const thread = projectThreads.threads[safeText(threadId, 120)];
    if (!thread) throw new Error('Fil de conversation NeuraCo introuvable.');
    if (thread.archived) throw new Error('Désarchivez ce fil avant de le reprendre.');
    projectThreads.activeThreadId = thread.threadId;
    await this.writeDocument(document);
    return thread;
  }

  async rename(
    project: NeuraCoProject,
    threadId: string,
    title: string
  ): Promise<NeuraCoConversationThread> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    const thread = projectThreads.threads[safeText(threadId, 120)];
    const safeTitle = safeText(title.trim(), 120);
    if (!thread) throw new Error('Fil de conversation NeuraCo introuvable.');
    if (!safeTitle) throw new Error('Le titre du fil ne peut pas être vide.');
    thread.title = safeTitle;
    thread.updatedAt = new Date().toISOString();
    await this.writeDocument(document);
    return thread;
  }

  async archive(
    project: NeuraCoProject,
    threadId: string,
    archived: boolean
  ): Promise<NeuraCoConversationThreadSummary[]> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    const thread = projectThreads.threads[safeText(threadId, 120)];
    if (!thread) throw new Error('Fil de conversation NeuraCo introuvable.');
    thread.archived = archived;
    thread.updatedAt = new Date().toISOString();
    if (archived && projectThreads.activeThreadId === thread.threadId) {
      let replacement = Object.values(projectThreads.threads)
        .filter((item) => !item.archived && item.threadId !== thread.threadId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (!replacement) {
        const replacementId = `thread_${randomUUID()}`;
        replacement = normalizeThread(project, {
          threadId: replacementId,
          title: 'Nouvelle tâche',
          archived: false,
          executionMode: 'local',
          messages: []
        }, replacementId);
        projectThreads.threads[replacementId] = replacement;
      }
      projectThreads.activeThreadId = replacement.threadId;
    }
    await this.writeDocument(document);
    return Object.values(projectThreads.threads)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((item) => threadSummary(item, projectThreads.activeThreadId));
  }

  async clearMemory(
    project: NeuraCoProject,
    threadId: string
  ): Promise<NeuraCoConversationThread> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    const thread = projectThreads.threads[safeText(threadId, 120)];
    if (!thread) throw new Error('Fil de conversation NeuraCo introuvable.');
    thread.messages = [];
    thread.sessionId = undefined;
    thread.cloudTaskId = undefined;
    thread.checkpointId = undefined;
    thread.updatedAt = new Date().toISOString();
    await this.writeDocument(document);
    return thread;
  }

  async fork(
    project: NeuraCoProject,
    threadId: string,
    fromMessageId?: string
  ): Promise<NeuraCoConversationThread> {
    return this.create(project, {
      fromThreadId: threadId,
      fromMessageId,
      title: undefined
    });
  }

  async rewind(
    project: NeuraCoProject,
    threadId: string,
    messageId: string
  ): Promise<NeuraCoConversationThread> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    const thread = projectThreads.threads[safeText(threadId, 120)];
    if (!thread) throw new Error('Fil de conversation NeuraCo introuvable.');
    const messageIndex = thread.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) throw new Error('Point de conversation introuvable.');
    thread.messages = thread.messages.slice(0, messageIndex + 1);
    thread.sessionId = undefined;
    thread.cloudTaskId = undefined;
    thread.updatedAt = new Date().toISOString();
    await this.writeDocument(document);
    return thread;
  }

  async attachCheckpoint(
    project: NeuraCoProject,
    threadId: string,
    checkpointId?: string
  ): Promise<NeuraCoConversationThread> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    const thread = projectThreads.threads[safeText(threadId, 120)];
    if (!thread) throw new Error('Fil de conversation NeuraCo introuvable.');
    thread.checkpointId = safeText(checkpointId, 160) || undefined;
    thread.updatedAt = new Date().toISOString();
    await this.writeDocument(document);
    return thread;
  }

  async restoreSnapshot(
    project: NeuraCoProject,
    snapshot: NeuraCoConversationThread,
    includeTaskSettings = true
  ): Promise<NeuraCoConversationThread> {
    if (!snapshot || snapshot.projectId !== project.id) {
      throw new Error('Conversation du checkpoint hors projet.');
    }
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    const existing = projectThreads.threads[safeText(snapshot.threadId, 120)];
    const restored = normalizeThread(project, {
      ...snapshot,
      taskSettings: includeTaskSettings
        ? snapshot.taskSettings
        : existing?.taskSettings
    }, safeText(snapshot.threadId, 120) || `thread_${randomUUID()}`);
    restored.updatedAt = new Date().toISOString();
    projectThreads.threads[restored.threadId] = restored;
    projectThreads.activeThreadId = restored.threadId;
    await this.writeDocument(document);
    return restored;
  }

  async exportMarkdown(
    project: NeuraCoProject,
    threadId: string
  ): Promise<string> {
    const document = await this.readDocument();
    const projectThreads = this.ensureProject(document, project);
    const thread = projectThreads.threads[safeText(threadId, 120)];
    if (!thread) throw new Error('Fil de conversation NeuraCo introuvable.');
    const metadata = [
      `# ${thread.title}`,
      '',
      `- Projet : ${project.name}`,
      `- Fil : ${thread.threadId}`,
      `- Créé : ${thread.createdAt}`,
      `- Mis à jour : ${thread.updatedAt}`,
      thread.parentThreadId ? `- Fil parent : ${thread.parentThreadId}` : '',
      thread.checkpointId ? `- Checkpoint : ${thread.checkpointId}` : '',
      '',
      '## Conversation',
      ''
    ].filter(Boolean);
    const conversation = thread.messages.flatMap((message) => [
      `### ${message.role === 'user' ? 'Utilisateur' : message.role === 'assistant' ? 'NeuraCo' : 'Système'}`,
      '',
      redactSecrets(message.content),
      message.files?.length
        ? `\nFichiers : ${message.files.map(redactSecrets).join(', ')}`
        : '',
      ''
    ]);
    return [...metadata, ...conversation].join('\n');
  }

  async clear(project: NeuraCoProject): Promise<boolean> {
    const document = await this.readDocument();
    if (!document.projects[project.id]) return false;
    delete document.projects[project.id];
    await this.writeDocument(document);
    return true;
  }
}
