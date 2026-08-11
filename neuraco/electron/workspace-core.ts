import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoProject,
  NeuraCoProjectFile,
  NeuraCoProjectFileNode,
  NeuraCoProjectFileSave,
  NeuraCoProjectSnapshot
} from './ipc-contract';

const MAX_TREE_ENTRIES = 6_000;
const MAX_TREE_DEPTH = 14;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 5 * 1024 * 1024;
const MAX_INDEX_CONCURRENCY = 16;
const MAX_CACHED_PROJECTS = 8;
const PROJECT_CACHE_TTL_MS = 10_000;

interface CachedProjectSnapshot {
  snapshot: NeuraCoProjectSnapshot;
  cachedAt: number;
}

const snapshotCache = new Map<string, CachedProjectSnapshot>();
const pendingScans = new Map<string, Promise<NeuraCoProjectSnapshot>>();

class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maximum: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

const EXCLUDED_DIRECTORIES = new Set([
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

const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^credentials?(?:\.|$)/i,
  /^secrets?(?:\.|$)/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.pem$/i
];

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.go': 'go',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.lua': 'lua',
  '.md': 'markdown',
  '.php': 'php',
  '.ps1': 'powershell',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.scss': 'scss',
  '.sh': 'shell',
  '.sql': 'sql',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.vue': 'html',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml'
};

const normalizedForComparison = (value: string): string => (
  process.platform === 'win32' ? value.toLowerCase() : value
);

const isInsideRoot = (rootPath: string, candidatePath: string): boolean => {
  const root = normalizedForComparison(path.resolve(rootPath));
  const candidate = normalizedForComparison(path.resolve(candidatePath));
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
};

export const isProjectPathExcluded = (relativePath: string): boolean => (
  relativePath
    .split(/[\\/]/)
    .filter(Boolean)
    .some((segment) => (
      EXCLUDED_DIRECTORIES.has(segment.toLowerCase())
      || SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(segment))
    ))
);

export const normalizeProjectPath = (relativePath: string): string => {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.length > 2_000) {
    throw new Error('Chemin de fichier invalide.');
  }
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error('Chemin de fichier non autorisé.');
  }
  const normalized = path.normalize(relativePath).replaceAll('\\', '/');
  if (
    normalized === '..'
    || normalized.startsWith('../')
    || normalized.split('/').includes('..')
    || isProjectPathExcluded(normalized)
  ) {
    throw new Error('Ce fichier est exclu du périmètre NeuraCo.');
  }
  return normalized.replace(/^\.\//, '');
};

const resolveExistingProjectPath = async (
  project: NeuraCoProject,
  relativePath: string
): Promise<{ normalized: string; absolutePath: string }> => {
  const normalized = normalizeProjectPath(relativePath);
  const lexicalPath = path.resolve(project.rootPath, normalized);
  if (!isInsideRoot(project.rootPath, lexicalPath)) {
    throw new Error('Chemin en dehors du projet autorisé.');
  }
  const resolvedPath = await realpath(lexicalPath);
  if (!isInsideRoot(project.rootPath, resolvedPath)) {
    throw new Error('Lien symbolique en dehors du projet autorisé.');
  }
  return { normalized, absolutePath: resolvedPath };
};

const resolveWritableProjectPath = async (
  project: NeuraCoProject,
  relativePath: string
): Promise<{ normalized: string; absolutePath: string }> => {
  const normalized = normalizeProjectPath(relativePath);
  const lexicalPath = path.resolve(project.rootPath, normalized);
  if (!isInsideRoot(project.rootPath, lexicalPath)) {
    throw new Error('Chemin en dehors du projet autorisé.');
  }
  const resolvedParent = await realpath(path.dirname(lexicalPath));
  if (!isInsideRoot(project.rootPath, resolvedParent)) {
    throw new Error('Dossier parent en dehors du projet autorisé.');
  }
  return {
    normalized,
    absolutePath: path.join(resolvedParent, path.basename(lexicalPath))
  };
};

export const openProjectRoot = async (rootPath: string): Promise<NeuraCoProject> => {
  const resolvedRoot = await realpath(rootPath);
  const rootStats = await stat(resolvedRoot);
  if (!rootStats.isDirectory()) {
    throw new Error('Le chemin sélectionné n’est pas un dossier.');
  }
  return {
    id: createHash('sha256').update(normalizedForComparison(resolvedRoot)).digest('hex').slice(0, 24),
    name: path.basename(resolvedRoot),
    rootPath: resolvedRoot
  };
};

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export const normalizeNewProjectName = (name: string): string => {
  const normalized = String(name || '').trim();
  if (
    normalized.length < 1
    || normalized.length > 80
    || normalized === '.'
    || normalized === '..'
    || normalized.endsWith('.')
    || normalized.endsWith(' ')
    || /[<>:"/\\|?*\0-\x1f]/.test(normalized)
    || WINDOWS_RESERVED_NAMES.test(normalized)
  ) {
    throw new Error('Le nom du nouveau projet n\u2019est pas valide sous Windows.');
  }
  return normalized;
};

export const createProjectRoot = async (
  parentPath: string,
  name: string
): Promise<NeuraCoProject> => {
  const resolvedParent = await realpath(parentPath);
  const parentStats = await stat(resolvedParent);
  if (!parentStats.isDirectory()) {
    throw new Error('Le dossier parent s\u00e9lectionn\u00e9 n\u2019est pas valide.');
  }
  const projectName = normalizeNewProjectName(name);
  const projectPath = path.join(resolvedParent, projectName);
  try {
    await mkdir(projectPath, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Un fichier ou un dossier porte d\u00e9j\u00e0 ce nom.');
    }
    throw error;
  }
  return openProjectRoot(projectPath);
};

export const scanProject = async (
  project: NeuraCoProject
): Promise<NeuraCoProjectSnapshot> => {
  let indexedFiles = 0;
  let excludedEntries = 0;
  let visitedEntries = 0;
  let truncated = false;
  const io = new AsyncSemaphore(MAX_INDEX_CONCURRENCY);

  const walk = async (
    directoryPath: string,
    relativeDirectory: string,
    depth: number
  ): Promise<NeuraCoProjectFileNode[]> => {
    if (depth > MAX_TREE_DEPTH || visitedEntries >= MAX_TREE_ENTRIES) {
      truncated = true;
      return [];
    }

    const entries = await io.run(() => readdir(directoryPath, { withFileTypes: true }));
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });

    const candidates: Array<{
      entry: (typeof entries)[number];
      absolutePath: string;
      relativePath: string;
    }> = [];
    for (const entry of entries) {
      if (visitedEntries >= MAX_TREE_ENTRIES) {
        truncated = true;
        break;
      }
      visitedEntries += 1;
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;

      if (
        entry.isSymbolicLink()
        || isProjectPathExcluded(relativePath)
        || (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()))
      ) {
        excludedEntries += 1;
        continue;
      }

      const absolutePath = path.join(directoryPath, entry.name);
      if (!entry.isFile()) {
        if (!entry.isDirectory()) {
          excludedEntries += 1;
          continue;
        }
      }
      candidates.push({ entry, absolutePath, relativePath });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    return Promise.all(candidates.map(async ({
      entry,
      absolutePath,
      relativePath
    }): Promise<NeuraCoProjectFileNode> => {
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          relativePath,
          kind: 'directory',
          children: await walk(absolutePath, relativePath, depth + 1)
        };
      }
      const fileStats = await io.run(() => stat(absolutePath));
      indexedFiles += 1;
      return {
        name: entry.name,
        relativePath,
        kind: 'file',
        size: fileStats.size
      };
    }));
  };

  return {
    project,
    files: await walk(project.rootPath, '', 0),
    indexedFiles,
    excludedEntries,
    truncated
  };
};

export const invalidateProjectScanCache = (projectId?: string): void => {
  if (projectId) {
    snapshotCache.delete(projectId);
    return;
  }
  snapshotCache.clear();
};

export const scanProjectCached = async (
  project: NeuraCoProject,
  options: { force?: boolean; maxAgeMs?: number } = {}
): Promise<NeuraCoProjectSnapshot> => {
  const maximumAge = Math.max(
    0,
    Math.min(60_000, options.maxAgeMs ?? PROJECT_CACHE_TTL_MS)
  );
  const cached = snapshotCache.get(project.id);
  if (
    !options.force
    && cached
    && Date.now() - cached.cachedAt <= maximumAge
  ) {
    snapshotCache.delete(project.id);
    snapshotCache.set(project.id, cached);
    return cached.snapshot;
  }
  const pending = pendingScans.get(project.id);
  if (pending) return pending;
  const scan = scanProject(project).then((snapshot) => {
    snapshotCache.delete(project.id);
    snapshotCache.set(project.id, {
      snapshot,
      cachedAt: Date.now()
    });
    while (snapshotCache.size > MAX_CACHED_PROJECTS) {
      const oldest = snapshotCache.keys().next().value;
      if (!oldest) break;
      snapshotCache.delete(oldest);
    }
    return snapshot;
  }).finally(() => {
    pendingScans.delete(project.id);
  });
  pendingScans.set(project.id, scan);
  return scan;
};

export const readProjectTextFile = async (
  project: NeuraCoProject,
  relativePath: string
): Promise<NeuraCoProjectFile> => {
  const { normalized, absolutePath } = await resolveExistingProjectPath(project, relativePath);
  const fileStats = await stat(absolutePath);
  if (!fileStats.isFile()) throw new Error('Le chemin sélectionné n’est pas un fichier.');
  if (fileStats.size > MAX_TEXT_FILE_BYTES) {
    throw new Error('Ce fichier dépasse la limite de lecture de 2 Mo.');
  }
  const buffer = await readFile(absolutePath);
  if (buffer.includes(0)) throw new Error('Les fichiers binaires ne sont pas ouverts dans l’éditeur.');
  return {
    relativePath: normalized,
    content: buffer.toString('utf8'),
    language: LANGUAGE_BY_EXTENSION[path.extname(normalized).toLowerCase()] || 'plaintext',
    size: fileStats.size,
    modifiedAt: fileStats.mtime.toISOString()
  };
};

export const writeProjectTextFile = async (
  project: NeuraCoProject,
  relativePath: string,
  content: string
): Promise<NeuraCoProjectFileSave> => {
  if (typeof content !== 'string') throw new Error('Contenu de fichier invalide.');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) throw new Error('Ce fichier dépasse la limite d’écriture de 5 Mo.');

  const { normalized, absolutePath } = await resolveWritableProjectPath(project, relativePath);
  try {
    const existing = await lstat(absolutePath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error('Le chemin cible n’est pas un fichier modifiable.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporaryPath = `${absolutePath}.neuraco-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, absolutePath);
  invalidateProjectScanCache(project.id);
  return {
    relativePath: normalized,
    size: bytes,
    savedAt: new Date().toISOString()
  };
};
