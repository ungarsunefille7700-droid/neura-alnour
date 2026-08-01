import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoNotification,
  NeuraCoNotificationAction,
  NeuraCoNotificationKind,
  NeuraCoNotificationSeverity,
  NeuraCoNotificationTarget,
  NeuraCoProject
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

const MAX_NOTIFICATIONS = 300;
const MAX_TITLE = 160;
const MAX_BODY = 2_000;
const DEDUPE_WINDOW_MS = 30 * 60_000;
const VALID_KINDS = new Set<NeuraCoNotificationKind>([
  'permission_request',
  'agent_blocked',
  'task_completed',
  'task_failed',
  'credits_low',
  'usage_limit_reached',
  'merge_ready',
  'git_conflict',
  'test_failed',
  'routine_result',
  'plugin_suspicious'
]);
const VALID_SEVERITIES = new Set<NeuraCoNotificationSeverity>([
  'info',
  'success',
  'warning',
  'critical'
]);
const VALID_ACTIONS = new Set<NeuraCoNotificationAction>([
  'open',
  'authorize',
  'refuse',
  'pause',
  'stop'
]);
const VALID_TARGETS = new Set<NeuraCoNotificationTarget>([
  'chat',
  'team',
  'review',
  'git',
  'environments',
  'usage',
  'protection'
]);

interface NotificationDocument {
  version: 1;
  notifications: NeuraCoNotification[];
}

export interface NeuraCoNotificationCreate {
  project: NeuraCoProject;
  kind: NeuraCoNotificationKind;
  severity: NeuraCoNotificationSeverity;
  title: string;
  body: string;
  taskId?: string;
  target: NeuraCoNotificationTarget;
  actions?: NeuraCoNotificationAction[];
  sensitive?: boolean;
  dedupeKey?: string;
}

interface NotificationServiceOptions {
  onCreated?: (notification: NeuraCoNotification) => void | Promise<void>;
}

const cleanText = (value: unknown, max: number): string => (
  redactSecrets(String(value || '').trim()).slice(0, max)
);

const cleanNotification = (
  notification: NeuraCoNotification
): NeuraCoNotification => ({
  id: cleanText(notification.id, 120) || randomUUID(),
  projectId: cleanText(notification.projectId, 120),
  projectName: cleanText(notification.projectName, 160),
  kind: VALID_KINDS.has(notification.kind) ? notification.kind : 'task_failed',
  severity: VALID_SEVERITIES.has(notification.severity)
    ? notification.severity
    : 'info',
  title: cleanText(notification.title, MAX_TITLE) || 'Notification NeuraCo',
  body: cleanText(notification.body, MAX_BODY),
  taskId: cleanText(notification.taskId, 160) || undefined,
  target: VALID_TARGETS.has(notification.target) ? notification.target : 'chat',
  actions: [...new Set(
    Array.isArray(notification.actions)
      ? notification.actions.filter((action) => VALID_ACTIONS.has(action))
      : ['open' as NeuraCoNotificationAction]
  )].slice(0, 5),
  sensitive: notification.sensitive === true,
  dedupeKey: cleanText(notification.dedupeKey, 180) || undefined,
  createdAt: Number.isFinite(Date.parse(notification.createdAt))
    ? notification.createdAt
    : new Date().toISOString(),
  readAt: notification.readAt && Number.isFinite(Date.parse(notification.readAt))
    ? notification.readAt
    : undefined,
  archivedAt: notification.archivedAt
    && Number.isFinite(Date.parse(notification.archivedAt))
    ? notification.archivedAt
    : undefined
});

const emptyDocument = (): NotificationDocument => ({
  version: 1,
  notifications: []
});

export class NotificationService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storePath: string,
    private readonly options: NotificationServiceOptions = {}
  ) {}

  private async readDocument(): Promise<NotificationDocument> {
    try {
      const parsed = JSON.parse(
        await readFile(this.storePath, 'utf8')
      ) as NotificationDocument;
      if (parsed?.version !== 1 || !Array.isArray(parsed.notifications)) {
        return emptyDocument();
      }
      return {
        version: 1,
        notifications: parsed.notifications.map(cleanNotification)
      };
    } catch {
      return emptyDocument();
    }
  }

  private async writeDocument(document: NotificationDocument): Promise<void> {
    const next: NotificationDocument = {
      version: 1,
      notifications: document.notifications
        .map(cleanNotification)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, MAX_NOTIFICATIONS)
    };
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporary, this.storePath);
  }

  private mutate<T>(
    operation: (document: NotificationDocument) => Promise<T> | T
  ): Promise<T> {
    const scheduled = this.writeQueue.then(async () => {
      const document = await this.readDocument();
      const result = await operation(document);
      await this.writeDocument(document);
      return result;
    });
    this.writeQueue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  async create(input: NeuraCoNotificationCreate): Promise<NeuraCoNotification> {
    let created = false;
    const notification = await this.mutate((document) => {
      const now = new Date();
      const dedupeKey = cleanText(input.dedupeKey, 180) || undefined;
      const existing = dedupeKey
        ? document.notifications.find((item) => (
            item.projectId === input.project.id
            && item.dedupeKey === dedupeKey
            && now.getTime() - Date.parse(item.createdAt) <= DEDUPE_WINDOW_MS
            && !item.archivedAt
          ))
        : undefined;
      if (existing) return cleanNotification(existing);
      created = true;
      const next = cleanNotification({
        id: randomUUID(),
        projectId: input.project.id,
        projectName: input.project.name,
        kind: input.kind,
        severity: input.severity,
        title: input.title,
        body: input.body,
        taskId: input.taskId,
        target: input.target,
        actions: input.actions?.length ? input.actions : ['open'],
        sensitive: input.sensitive === true,
        dedupeKey,
        createdAt: now.toISOString()
      });
      document.notifications.unshift(next);
      return next;
    });
    if (created) {
      await this.options.onCreated?.(notification);
    }
    return notification;
  }

  async list(
    projectId: string,
    includeArchived = false
  ): Promise<NeuraCoNotification[]> {
    await this.writeQueue;
    const document = await this.readDocument();
    return document.notifications
      .filter((notification) => (
        notification.projectId === projectId
        && (includeArchived || !notification.archivedAt)
      ))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(cleanNotification);
  }

  async get(
    projectId: string,
    notificationId: string
  ): Promise<NeuraCoNotification> {
    const notification = (await this.list(projectId, true)).find(
      (item) => item.id === notificationId
    );
    if (!notification) {
      throw new Error('Notification introuvable pour ce projet.');
    }
    return notification;
  }

  async markRead(
    projectId: string,
    notificationId: string
  ): Promise<NeuraCoNotification[]> {
    await this.mutate((document) => {
      const notification = document.notifications.find(
        (item) => item.id === notificationId && item.projectId === projectId
      );
      if (!notification) throw new Error('Notification introuvable pour ce projet.');
      notification.readAt = notification.readAt || new Date().toISOString();
    });
    return this.list(projectId);
  }

  async archive(
    projectId: string,
    notificationId: string
  ): Promise<NeuraCoNotification[]> {
    await this.mutate((document) => {
      const notification = document.notifications.find(
        (item) => item.id === notificationId && item.projectId === projectId
      );
      if (!notification) throw new Error('Notification introuvable pour ce projet.');
      const now = new Date().toISOString();
      notification.readAt = notification.readAt || now;
      notification.archivedAt = now;
    });
    return this.list(projectId);
  }
}
