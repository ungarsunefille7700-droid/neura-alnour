import { randomUUID } from 'node:crypto';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoCheckpoint,
  NeuraCoCheckpointRetention,
  NeuraCoCheckpointTaskSettings,
  NeuraCoCheckpointTrigger,
  NeuraCoConversationThread,
  NeuraCoProject,
  NeuraCoTrashEntry
} from './ipc-contract';
import { normalizeProjectPath } from './workspace-core';

const DEFAULT_MAX_CHECKPOINTS_PER_PROJECT = 30;
const MIN_CHECKPOINTS_PER_PROJECT = 5;
const MAX_CHECKPOINTS_PER_PROJECT = 100;
const MAX_PROJECT_CHECKPOINT_FILES = 8_000;
const MAX_PROJECT_CHECKPOINT_BYTES = 300 * 1024 * 1024;
const EXCLUDED_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.neuraco',
  '.next',
  '.nuxt',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'vendor'
]);
const SENSITIVE_NAMES = [
  /^\.env(?:\.|$)/i,
  /^credentials?(?:\.|$)/i,
  /^secrets?(?:\.|$)/i,
  /\.(?:key|pem|p12|pfx)$/i
];

interface CheckpointMetadata extends NeuraCoCheckpoint {
  capturedFiles: string[];
  originalExisted?: boolean;
  conversation?: NeuraCoConversationThread;
  taskSettings?: NeuraCoCheckpointTaskSettings;
}

interface TrashMetadata extends NeuraCoTrashEntry {}

interface RecoverySettingsDocument {
  version: 1;
  maxPerProject: number;
}

interface CheckpointCreationOptions {
  trigger?: NeuraCoCheckpointTrigger;
  conversation?: NeuraCoConversationThread;
  taskSettings?: NeuraCoCheckpointTaskSettings;
  preserveCheckpointIds?: string[];
}

const safeProjectTarget = async (
  project: NeuraCoProject,
  relativePath: string,
  requireExisting: boolean
): Promise<{ relativePath: string; targetPath: string }> => {
  const normalized = normalizeProjectPath(relativePath);
  const targetPath = path.resolve(project.rootPath, normalized);
  const relative = path.relative(project.rootPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Chemin hors du projet refusé.');
  }
  if (requireExisting) {
    const resolved = await realpath(targetPath);
    const resolvedRelative = path.relative(project.rootPath, resolved);
    if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) {
      throw new Error('Lien sortant du projet refusé.');
    }
    if ((await lstat(targetPath)).isSymbolicLink()) {
      throw new Error('Les liens symboliques ne sont pas pris en charge.');
    }
  }
  return { relativePath: normalized, targetPath };
};

const shouldExclude = (name: string): boolean => (
  EXCLUDED_NAMES.has(name.toLowerCase())
  || SENSITIVE_NAMES.some((pattern) => pattern.test(name))
);

const listCheckpointFiles = async (
  root: string
): Promise<{ files: string[]; bytes: number }> => {
  const files: string[] = [];
  let bytes = 0;
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldExclude(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const fileSize = (await stat(absolute)).size;
      files.push(path.relative(root, absolute).replaceAll('\\', '/'));
      bytes += fileSize;
      if (
        files.length > MAX_PROJECT_CHECKPOINT_FILES
        || bytes > MAX_PROJECT_CHECKPOINT_BYTES
      ) {
        throw new Error('Projet trop volumineux pour un checkpoint local complet.');
      }
    }
  };
  await walk(root);
  return { files, bytes };
};

const writeJsonAtomic = async (target: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, target);
};

const readJson = async <T>(target: string): Promise<T> => (
  JSON.parse(await readFile(target, 'utf8')) as T
);

const publicCheckpoint = (metadata: CheckpointMetadata): NeuraCoCheckpoint => ({
  id: metadata.id,
  projectId: metadata.projectId,
  projectName: metadata.projectName,
  type: metadata.type,
  trigger: metadata.trigger,
  reason: metadata.reason,
  createdAt: metadata.createdAt,
  size: metadata.size,
  relativePath: metadata.relativePath,
  hasConversation: Boolean(metadata.conversation),
  hasTaskSettings: Boolean(metadata.taskSettings)
});

const removeOldestDirectories = async (
  directory: string,
  keep: number,
  preservedIds: string[] = []
): Promise<void> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const directories = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        path: path.join(directory, entry.name),
        modified: (await stat(path.join(directory, entry.name))).mtimeMs
      })));
    directories.sort((left, right) => right.modified - left.modified);
    const removeCount = Math.max(0, directories.length - keep);
    const preserved = new Set(preservedIds);
    const removable = directories
      .slice()
      .reverse()
      .filter((entry) => !preserved.has(path.basename(entry.path)))
      .slice(0, removeCount);
    await Promise.all(removable.map((entry) => (
      rm(entry.path, { recursive: true, force: true })
    )));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

export class RecoveryService {
  constructor(private readonly baseDirectory: string) {}

  private settingsPath(): string {
    return path.join(this.baseDirectory, 'settings.json');
  }

  private checkpointRoot(projectId: string): string {
    return path.join(this.baseDirectory, 'checkpoints', projectId);
  }

  private trashRoot(projectId: string): string {
    return path.join(this.baseDirectory, 'trash', projectId);
  }

  private async maxCheckpointsPerProject(): Promise<number> {
    try {
      const settings = await readJson<RecoverySettingsDocument>(this.settingsPath());
      if (settings.version !== 1 || !Number.isFinite(settings.maxPerProject)) {
        return DEFAULT_MAX_CHECKPOINTS_PER_PROJECT;
      }
      return Math.max(
        MIN_CHECKPOINTS_PER_PROJECT,
        Math.min(MAX_CHECKPOINTS_PER_PROJECT, Math.round(settings.maxPerProject))
      );
    } catch {
      return DEFAULT_MAX_CHECKPOINTS_PER_PROJECT;
    }
  }

  async getRetention(): Promise<NeuraCoCheckpointRetention> {
    return {
      maxPerProject: await this.maxCheckpointsPerProject(),
      minimum: MIN_CHECKPOINTS_PER_PROJECT,
      maximum: MAX_CHECKPOINTS_PER_PROJECT
    };
  }

  async updateRetention(maxPerProject: number): Promise<NeuraCoCheckpointRetention> {
    if (!Number.isFinite(maxPerProject)) {
      throw new Error('Historique de checkpoints invalide.');
    }
    const normalized = Math.max(
      MIN_CHECKPOINTS_PER_PROJECT,
      Math.min(MAX_CHECKPOINTS_PER_PROJECT, Math.round(maxPerProject))
    );
    await writeJsonAtomic(this.settingsPath(), {
      version: 1,
      maxPerProject: normalized
    } satisfies RecoverySettingsDocument);
    const checkpointsRoot = path.join(this.baseDirectory, 'checkpoints');
    try {
      const projects = await readdir(checkpointsRoot, { withFileTypes: true });
      await Promise.all(projects
        .filter((entry) => entry.isDirectory())
        .map((entry) => removeOldestDirectories(
          path.join(checkpointsRoot, entry.name),
          normalized
        )));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return this.getRetention();
  }

  private async pruneCheckpoints(
    projectId: string,
    preservedIds: string[] = []
  ): Promise<void> {
    await removeOldestDirectories(
      this.checkpointRoot(projectId),
      await this.maxCheckpointsPerProject(),
      preservedIds
    );
  }

  async createFileCheckpoint(
    project: NeuraCoProject,
    relativePath: string,
    reason: string,
    options: CheckpointCreationOptions = {}
  ): Promise<NeuraCoCheckpoint> {
    const normalized = normalizeProjectPath(relativePath);
    const id = randomUUID();
    const directory = path.join(this.checkpointRoot(project.id), id);
    const source = path.resolve(project.rootPath, normalized);
    let originalExisted = true;
    let size = 0;
    try {
      const safe = await safeProjectTarget(project, normalized, true);
      const info = await stat(safe.targetPath);
      if (!info.isFile()) throw new Error('Seuls les fichiers peuvent être sauvegardés ici.');
      size = info.size;
      await mkdir(path.dirname(path.join(directory, 'files', normalized)), { recursive: true });
      await copyFile(safe.targetPath, path.join(directory, 'files', normalized));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        originalExisted = false;
      } else {
        throw error;
      }
    }
    const metadata: CheckpointMetadata = {
      id,
      projectId: project.id,
      projectName: project.name,
      type: 'file',
      trigger: options.trigger || 'important_change',
      reason,
      createdAt: new Date().toISOString(),
      size,
      relativePath: normalized,
      capturedFiles: originalExisted ? [normalized] : [],
      originalExisted,
      conversation: options.conversation,
      taskSettings: options.taskSettings || options.conversation?.taskSettings
    };
    await writeJsonAtomic(path.join(directory, 'metadata.json'), metadata);
    await this.pruneCheckpoints(project.id, options.preserveCheckpointIds);
    return publicCheckpoint(metadata);
  }

  async createProjectCheckpoint(
    project: NeuraCoProject,
    reason: string,
    options: CheckpointCreationOptions = {}
  ): Promise<NeuraCoCheckpoint> {
    const id = randomUUID();
    const directory = path.join(this.checkpointRoot(project.id), id);
    const capture = await listCheckpointFiles(project.rootPath);
    for (const relativePath of capture.files) {
      const source = path.join(project.rootPath, relativePath);
      const destination = path.join(directory, 'files', relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    const metadata: CheckpointMetadata = {
      id,
      projectId: project.id,
      projectName: project.name,
      type: 'project',
      trigger: options.trigger || 'manual',
      reason,
      createdAt: new Date().toISOString(),
      size: capture.bytes,
      capturedFiles: capture.files,
      conversation: options.conversation,
      taskSettings: options.taskSettings || options.conversation?.taskSettings
    };
    await writeJsonAtomic(path.join(directory, 'metadata.json'), metadata);
    await this.pruneCheckpoints(project.id, options.preserveCheckpointIds);
    return publicCheckpoint(metadata);
  }

  async listCheckpoints(project: NeuraCoProject): Promise<NeuraCoCheckpoint[]> {
    try {
      const entries = await readdir(this.checkpointRoot(project.id), { withFileTypes: true });
      const checkpoints = await Promise.all(entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => readJson<CheckpointMetadata>(
          path.join(this.checkpointRoot(project.id), entry.name, 'metadata.json')
        )));
      return checkpoints
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(publicCheckpoint);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async restoreCheckpoint(
    project: NeuraCoProject,
    checkpointId: string
  ): Promise<NeuraCoCheckpoint> {
    if (!/^[a-f0-9-]{36}$/i.test(checkpointId)) {
      throw new Error('Checkpoint invalide.');
    }
    const directory = path.join(this.checkpointRoot(project.id), checkpointId);
    const metadata = await readJson<CheckpointMetadata>(
      path.join(directory, 'metadata.json')
    );
    if (metadata.projectId !== project.id) throw new Error('Checkpoint hors projet.');

    if (metadata.type === 'file' && metadata.originalExisted === false && metadata.relativePath) {
      const target = await safeProjectTarget(project, metadata.relativePath, false);
      await rm(target.targetPath, { force: true });
      return publicCheckpoint(metadata);
    }
    for (const relativePath of metadata.capturedFiles) {
      const target = await safeProjectTarget(project, relativePath, false);
      const source = path.join(directory, 'files', relativePath);
      await mkdir(path.dirname(target.targetPath), { recursive: true });
      await copyFile(source, target.targetPath);
    }
    return publicCheckpoint(metadata);
  }

  async getCheckpointSnapshot(
    project: NeuraCoProject,
    checkpointId: string
  ): Promise<{
    checkpoint: NeuraCoCheckpoint;
    conversation?: NeuraCoConversationThread;
    taskSettings?: NeuraCoCheckpointTaskSettings;
  }> {
    if (!/^[a-f0-9-]{36}$/i.test(checkpointId)) {
      throw new Error('Checkpoint invalide.');
    }
    const metadata = await readJson<CheckpointMetadata>(
      path.join(this.checkpointRoot(project.id), checkpointId, 'metadata.json')
    );
    if (metadata.projectId !== project.id) throw new Error('Checkpoint hors projet.');
    return {
      checkpoint: publicCheckpoint(metadata),
      conversation: metadata.conversation,
      taskSettings: metadata.taskSettings || metadata.conversation?.taskSettings
    };
  }

  async moveToTrash(
    project: NeuraCoProject,
    relativePath: string
  ): Promise<NeuraCoTrashEntry> {
    const safe = await safeProjectTarget(project, relativePath, true);
    const id = randomUUID();
    const directory = path.join(this.trashRoot(project.id), id);
    const payload = path.join(directory, 'payload');
    const info = await stat(safe.targetPath);
    await mkdir(directory, { recursive: true });
    try {
      await rename(safe.targetPath, payload);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await cp(safe.targetPath, payload, { recursive: info.isDirectory(), errorOnExist: true });
      await rm(safe.targetPath, { recursive: info.isDirectory(), force: true });
    }
    const metadata: TrashMetadata = {
      id,
      projectId: project.id,
      relativePath: safe.relativePath,
      kind: info.isDirectory() ? 'directory' : 'file',
      size: info.isFile() ? info.size : 0,
      deletedAt: new Date().toISOString()
    };
    await writeJsonAtomic(path.join(directory, 'metadata.json'), metadata);
    return metadata;
  }

  async listTrash(project: NeuraCoProject): Promise<NeuraCoTrashEntry[]> {
    try {
      const entries = await readdir(this.trashRoot(project.id), { withFileTypes: true });
      const trash = await Promise.all(entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => readJson<TrashMetadata>(
          path.join(this.trashRoot(project.id), entry.name, 'metadata.json')
        )));
      return trash.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async restoreTrash(
    project: NeuraCoProject,
    entryId: string
  ): Promise<NeuraCoTrashEntry> {
    if (!/^[a-f0-9-]{36}$/i.test(entryId)) throw new Error('Élément de corbeille invalide.');
    const directory = path.join(this.trashRoot(project.id), entryId);
    const metadata = await readJson<TrashMetadata>(path.join(directory, 'metadata.json'));
    if (metadata.projectId !== project.id) throw new Error('Élément hors projet.');
    const target = await safeProjectTarget(project, metadata.relativePath, false);
    try {
      await lstat(target.targetPath);
      throw new Error('Un fichier existe déjà à cet emplacement.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(path.dirname(target.targetPath), { recursive: true });
    try {
      await rename(path.join(directory, 'payload'), target.targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await cp(path.join(directory, 'payload'), target.targetPath, {
        recursive: metadata.kind === 'directory',
        errorOnExist: true
      });
    }
    await rm(directory, { recursive: true, force: true });
    return metadata;
  }
}
