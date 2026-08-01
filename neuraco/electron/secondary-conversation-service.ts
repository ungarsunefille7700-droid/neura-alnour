import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoPersistedChatMessage,
  NeuraCoSecondaryConversation,
  NeuraCoSecondaryConversationCreate
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES = 120;
const MAX_CONTENT = 40_000;
const SAFE_ID = /^[A-Za-z0-9_-]{8,160}$/;

interface SecondaryConversationStore {
  version: 1;
  conversations: NeuraCoSecondaryConversation[];
}

const safeText = (value: unknown, max: number): string => (
  redactSecrets(String(value || '')).trim().slice(0, max)
);

const normalizeMessage = (
  message: NeuraCoPersistedChatMessage
): NeuraCoPersistedChatMessage | null => {
  if (!message || !['user', 'assistant', 'system'].includes(message.role)) return null;
  const content = safeText(message.content, MAX_CONTENT);
  if (!content) return null;
  return {
    id: SAFE_ID.test(String(message.id || '')) ? message.id : randomUUID(),
    role: message.role,
    content,
    model: safeText(message.model, 240) || undefined,
    files: Array.isArray(message.files)
      ? message.files.map((file) => safeText(file, 1000)).filter(Boolean).slice(0, 24)
      : undefined
  };
};

const normalizeConversation = (
  value: NeuraCoSecondaryConversation
): NeuraCoSecondaryConversation | null => {
  if (!value || !SAFE_ID.test(String(value.id || ''))) return null;
  const projectId = safeText(value.projectId, 160);
  const parentThreadId = safeText(value.parentThreadId, 160);
  if (!projectId || !parentThreadId) return null;
  const now = new Date().toISOString();
  return {
    id: value.id,
    projectId,
    parentThreadId,
    linkedTaskId: safeText(value.linkedTaskId, 160) || undefined,
    title: safeText(value.title, 160) || 'Conversation secondaire',
    archived: Boolean(value.archived),
    messages: Array.isArray(value.messages)
      ? value.messages
        .map(normalizeMessage)
        .filter((message): message is NeuraCoPersistedChatMessage => Boolean(message))
        .slice(-MAX_MESSAGES)
      : [],
    createdAt: safeText(value.createdAt, 80) || now,
    updatedAt: safeText(value.updatedAt, 80) || now
  };
};

const writeAtomically = async (
  target: string,
  store: SecondaryConversationStore
): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  try {
    await rename(temporary, target);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes((error as NodeJS.ErrnoException).code || '')) {
      throw error;
    }
    await rm(target, { force: true });
    await rename(temporary, target);
  }
};

export class SecondaryConversationService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storePath: string) {}

  private async readStore(): Promise<SecondaryConversationStore> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      if (raw.length > 8 * 1024 * 1024) {
        throw new Error('Secondary conversation store too large');
      }
      const parsed = JSON.parse(raw) as Partial<SecondaryConversationStore>;
      return {
        version: 1,
        conversations: Array.isArray(parsed.conversations)
          ? parsed.conversations
            .map((conversation) => normalizeConversation(conversation))
            .filter((conversation): conversation is NeuraCoSecondaryConversation => (
              Boolean(conversation)
            ))
            .slice(-MAX_CONVERSATIONS)
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('NeuraCo secondary conversations could not be read', error);
      }
      return { version: 1, conversations: [] };
    }
  }

  private async mutate<T>(
    operation: (store: SecondaryConversationStore) => T | Promise<T>
  ): Promise<T> {
    const pending = this.writeQueue.catch(() => undefined).then(async () => {
      const store = await this.readStore();
      const result = await operation(store);
      store.conversations = store.conversations.slice(-MAX_CONVERSATIONS);
      await writeAtomically(this.storePath, store);
      return result;
    });
    this.writeQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async list(
    projectId: string,
    parentThreadId?: string,
    includeArchived = false
  ): Promise<NeuraCoSecondaryConversation[]> {
    const store = await this.readStore();
    return store.conversations
      .filter((conversation) => (
        conversation.projectId === projectId
        && (!parentThreadId || conversation.parentThreadId === parentThreadId)
        && (includeArchived || !conversation.archived)
      ))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async create(
    projectId: string,
    input: NeuraCoSecondaryConversationCreate
  ): Promise<NeuraCoSecondaryConversation> {
    const parentThreadId = safeText(input.parentThreadId, 160);
    if (!projectId || !parentThreadId) {
      throw new Error('Le fil principal lié est obligatoire.');
    }
    const now = new Date().toISOString();
    const conversation: NeuraCoSecondaryConversation = {
      id: randomUUID(),
      projectId,
      parentThreadId,
      linkedTaskId: safeText(input.linkedTaskId, 160) || undefined,
      title: safeText(input.title, 160) || 'Conversation secondaire',
      archived: false,
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    return this.mutate((store) => {
      store.conversations.push(conversation);
      return conversation;
    });
  }

  async get(
    projectId: string,
    conversationId: string
  ): Promise<NeuraCoSecondaryConversation> {
    if (!SAFE_ID.test(conversationId)) {
      throw new Error('Identifiant de conversation secondaire invalide.');
    }
    const store = await this.readStore();
    const conversation = store.conversations.find((candidate) => (
      candidate.id === conversationId && candidate.projectId === projectId
    ));
    if (!conversation || conversation.archived) {
      throw new Error('Conversation secondaire introuvable.');
    }
    return conversation;
  }

  async append(
    projectId: string,
    conversationId: string,
    message: NeuraCoPersistedChatMessage
  ): Promise<NeuraCoSecondaryConversation> {
    const normalized = normalizeMessage(message);
    if (!normalized) throw new Error('Message secondaire invalide.');
    return this.mutate((store) => {
      const conversation = store.conversations.find((candidate) => (
        candidate.id === conversationId && candidate.projectId === projectId
      ));
      if (!conversation || conversation.archived) {
        throw new Error('Conversation secondaire introuvable.');
      }
      conversation.messages = [...conversation.messages, normalized].slice(-MAX_MESSAGES);
      conversation.updatedAt = new Date().toISOString();
      return conversation;
    });
  }

  async archive(
    projectId: string,
    conversationId: string
  ): Promise<NeuraCoSecondaryConversation[]> {
    await this.mutate((store) => {
      const conversation = store.conversations.find((candidate) => (
        candidate.id === conversationId && candidate.projectId === projectId
      ));
      if (!conversation) throw new Error('Conversation secondaire introuvable.');
      conversation.archived = true;
      conversation.updatedAt = new Date().toISOString();
    });
    return this.list(projectId);
  }
}
