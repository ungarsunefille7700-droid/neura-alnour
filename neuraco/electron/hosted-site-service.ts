import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  copyFile,
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
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import type {
  NeuraCoHostedSiteDeployment,
  NeuraCoHostedSiteFile,
  NeuraCoHostedSiteKind,
  NeuraCoHostedSitePreview,
  NeuraCoHostedSitePreviewSession,
  NeuraCoHostedSiteProviderStatus,
  NeuraCoHostedSiteRequest,
  NeuraCoProject
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

const MAX_FILES = 2_000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PREVIEW_TTL_MS = 30 * 60 * 1_000;
const VALID_ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]{0,79}$/;
const VALID_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const KINDS = new Set<NeuraCoHostedSiteKind>([
  'site',
  'dashboard',
  'internal_tool',
  'gallery',
  'web_app',
  'web_game',
  'revision_space'
]);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  '.neuraco',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.next/cache'
]);
const SENSITIVE_FILE = /(^|\.)(env($|\.)|pem$|key$|p12$|pfx$|keystore$)|(^|[-_.])(secret|secrets|credentials)([-_.]|$)/i;

interface StoredHostedSites {
  version: 1;
  deployments: NeuraCoHostedSiteDeployment[];
}

interface PendingPreview {
  preview: NeuraCoHostedSitePreview;
  sourceRoot: string;
  fingerprint: string;
}

interface PreviewServer {
  server: Server;
  address: string;
  startedAt: string;
}

export interface HostedSiteCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type HostedSiteCommandRunner = (
  command: string,
  args: string[],
  cwd: string
) => Promise<HostedSiteCommandResult>;

interface HostedSiteServiceOptions {
  storePath: string;
  storageDirectory: string;
  runCommand?: HostedSiteCommandRunner;
  now?: () => Date;
}

const safeEnvironment = (): NodeJS.ProcessEnv => {
  const allowed = new Set([
    'APPDATA',
    'COMSPEC',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LANG',
    'LOCALAPPDATA',
    'PATH',
    'PATHEXT',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'WINDIR'
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) => (
      allowed.has(name.toUpperCase()) && typeof value === 'string'
    ))
  );
};

const defaultCommandRunner: HostedSiteCommandRunner = (
  command,
  args,
  cwd
) => new Promise((resolve, reject) => {
  let executable = command;
  let commandArguments = args;
  if (process.platform === 'win32' && command === 'vercel.cmd') {
    const script = (process.env.PATH || '')
      .split(path.delimiter)
      .map((directory) => path.join(
        directory.replace(/^"|"$/g, ''),
        'node_modules',
        'vercel',
        'dist',
        'index.js'
      ))
      .find((candidate) => existsSync(candidate));
    if (script) {
      executable = 'node.exe';
      commandArguments = [script, ...args];
    }
  }
  execFile(executable, commandArguments, {
    cwd,
    env: safeEnvironment(),
    timeout: 10 * 60 * 1_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  }, (error, stdout, stderr) => {
    const result = {
      exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
      stdout: redactSecrets(String(stdout || '')).slice(-200_000),
      stderr: redactSecrets(String(stderr || '')).slice(-200_000)
    };
    if (error && !('code' in error)) {
      reject(error);
      return;
    }
    resolve(result);
  });
});

const writeAtomically = async (
  target: string,
  value: StoredHostedSites
): Promise<void> => {
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

const normalizeRelativeDirectory = (value: unknown): string => {
  const normalized = String(value || '.')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '') || '.';
  if (
    normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').includes('..')
  ) {
    throw new Error('Le dossier du site doit rester dans le projet actif.');
  }
  return normalized;
};

const resolveInside = (root: string, relativePath: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relation = path.relative(resolvedRoot, resolved);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error('Chemin de site hors du projet refusé.');
  }
  return resolved;
};

const slugify = (value: string): string => {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return slug || `neuraco-site-${randomUUID().slice(0, 8)}`;
};

const sanitizeList = (
  values: unknown,
  validator: RegExp,
  label: string
): string[] => {
  if (!Array.isArray(values)) return [];
  const result = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  if (result.length > 50) throw new Error(`${label} : 50 éléments maximum.`);
  const invalid = result.find((value) => !validator.test(value));
  if (invalid) throw new Error(`${label} invalide : ${redactSecrets(invalid).slice(0, 80)}.`);
  return result;
};

const durationLabel = (days?: number): string => (
  days
    ? `${days} jour${days > 1 ? 's' : ''} (suppression manuelle chez l’hébergeur)`
    : 'Sans expiration automatique, jusqu’à suppression chez l’hébergeur'
);

const mimeType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8'
  } as Record<string, string>)[extension] || 'application/octet-stream';
};

const commandName = (): string => (
  process.platform === 'win32' ? 'vercel.cmd' : 'vercel'
);

export class HostedSiteService {
  private readonly runCommand: HostedSiteCommandRunner;

  private readonly now: () => Date;

  private readonly pending = new Map<string, PendingPreview>();

  private readonly previewServers = new Map<string, PreviewServer>();

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: HostedSiteServiceOptions) {
    this.runCommand = options.runCommand || defaultCommandRunner;
    this.now = options.now || (() => new Date());
  }

  private async readStore(): Promise<StoredHostedSites> {
    try {
      const raw = await readFile(this.options.storePath, 'utf8');
      if (raw.length > 4 * 1024 * 1024) throw new Error('Hosted site store too large');
      const parsed = JSON.parse(raw) as Partial<StoredHostedSites>;
      return {
        version: 1,
        deployments: Array.isArray(parsed.deployments)
          ? parsed.deployments.slice(-200)
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('NeuraCo hosted sites could not be read', error);
      }
      return { version: 1, deployments: [] };
    }
  }

  private async saveDeployment(deployment: NeuraCoHostedSiteDeployment): Promise<void> {
    const pending = this.writeQueue.catch(() => undefined).then(async () => {
      const store = await this.readStore();
      store.deployments = [...store.deployments, deployment].slice(-200);
      await writeAtomically(this.options.storePath, store);
    });
    this.writeQueue = pending.then(() => undefined, () => undefined);
    await pending;
  }

  private async scan(sourceRoot: string): Promise<{
    files: NeuraCoHostedSiteFile[];
    fingerprint: string;
    totalBytes: number;
  }> {
    const files: Array<NeuraCoHostedSiteFile & { modifiedAt: number }> = [];
    let totalBytes = 0;

    const visit = async (directory: string, relativeDirectory = ''): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink()) continue;
        const relativePath = path.posix.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
          if (
            IGNORED_DIRECTORIES.has(entry.name)
            || IGNORED_DIRECTORIES.has(relativePath)
          ) continue;
          await visit(path.join(directory, entry.name), relativePath);
          continue;
        }
        if (!entry.isFile() || SENSITIVE_FILE.test(entry.name)) continue;
        const absolutePath = path.join(directory, entry.name);
        const details = await stat(absolutePath);
        if (details.size > MAX_FILE_BYTES) {
          throw new Error(`Le fichier ${relativePath} dépasse 20 Mo.`);
        }
        totalBytes += details.size;
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new Error('Le déploiement dépasse la limite locale de 100 Mo.');
        }
        files.push({
          relativePath,
          size: details.size,
          modifiedAt: details.mtimeMs
        });
        if (files.length > MAX_FILES) {
          throw new Error(`Le déploiement dépasse ${MAX_FILES} fichiers.`);
        }
      }
    };

    await visit(sourceRoot);
    if (files.length === 0) throw new Error('Aucun fichier publiable trouvé.');
    const fingerprint = createHash('sha256')
      .update(files.map((file) => (
        `${file.relativePath}\0${file.size}\0${file.modifiedAt}`
      )).join('\n'))
      .digest('hex');
    return {
      files: files.map(({ relativePath, size }) => ({ relativePath, size })),
      fingerprint,
      totalBytes
    };
  }

  private async detectFramework(sourceRoot: string): Promise<string> {
    try {
      const packageJson = JSON.parse(
        await readFile(path.join(sourceRoot, 'package.json'), 'utf8')
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      if (dependencies.next) return 'Next.js';
      if (dependencies['@angular/core']) return 'Angular';
      if (dependencies.vue) return 'Vue';
      if (dependencies.svelte || dependencies['@sveltejs/kit']) return 'Svelte';
      if (dependencies.react) return 'React';
      if (dependencies.vite) return 'Vite';
      return 'Application Node.js';
    } catch {
      return 'Site statique';
    }
  }

  private getPending(previewId: string): PendingPreview {
    const pending = this.pending.get(String(previewId || ''));
    if (!pending) throw new Error('Prévisualisation de déploiement introuvable.');
    if (new Date(pending.preview.expiresAt).getTime() <= this.now().getTime()) {
      this.pending.delete(previewId);
      throw new Error('Cette prévisualisation a expiré. Analysez de nouveau les fichiers.');
    }
    return pending;
  }

  getPreview(previewId: string): NeuraCoHostedSitePreview {
    return this.getPending(previewId).preview;
  }

  async preview(
    project: NeuraCoProject,
    request: NeuraCoHostedSiteRequest
  ): Promise<NeuraCoHostedSitePreview> {
    const name = redactSecrets(String(request?.name || '')).trim().slice(0, 100);
    if (!name) throw new Error('Le nom du site est obligatoire.');
    if (!KINDS.has(request?.kind)) throw new Error('Type de site invalide.');
    if (!['local', 'public'].includes(request?.visibility)) {
      throw new Error('Visibilité de site invalide.');
    }
    const sourceDirectory = normalizeRelativeDirectory(request.sourceDirectory);
    const sourceRoot = resolveInside(project.rootPath, sourceDirectory);
    const sourceDetails = await lstat(sourceRoot);
    if (!sourceDetails.isDirectory() || sourceDetails.isSymbolicLink()) {
      throw new Error('Le dossier source doit être un dossier réel du projet.');
    }
    const environmentVariables = sanitizeList(
      request.environmentVariables,
      VALID_ENVIRONMENT_NAME,
      'Variable d’environnement'
    );
    const requestedAuthorizedPeople = sanitizeList(
      request.authorizedPeople,
      VALID_EMAIL,
      'Adresse autorisée'
    );
    if (requestedAuthorizedPeople.length > 0) {
      throw new Error(
        'Cette version publie uniquement en accès public. '
        + 'Aucune restriction par adresse ne sera simulée.'
      );
    }
    const days = request.hostingDurationDays == null
      ? undefined
      : Math.floor(Number(request.hostingDurationDays));
    if (days != null && (!Number.isFinite(days) || days < 1 || days > 3650)) {
      throw new Error('La durée doit être comprise entre 1 et 3650 jours.');
    }
    const scanned = await this.scan(sourceRoot);
    const id = randomUUID();
    const createdAt = this.now();
    const slug = slugify(name);
    const isPublic = request.visibility === 'public';
    const preview: NeuraCoHostedSitePreview = {
      id,
      projectId: project.id,
      name,
      slug,
      kind: request.kind,
      sourceDirectory,
      visibility: request.visibility,
      files: scanned.files,
      totalBytes: scanned.totalBytes,
      plannedAddress: isPublic
        ? `https://${slug}.vercel.app`
        : 'Adresse locale attribuée au lancement de l’aperçu',
      plannedAddressIsEstimate: isPublic,
      environmentVariables,
      estimatedCredits: 0,
      hostingDurationDays: days,
      hostingDurationLabel: isPublic
        ? durationLabel(days)
        : 'Durée de la session locale NeuraCo',
      authorizedPeople: isPublic
        ? ['Tout le monde (site public)']
        : ['Utilisateur Windows local'],
      framework: await this.detectFramework(sourceRoot),
      provider: isPublic ? 'vercel' : 'local',
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PREVIEW_TTL_MS).toISOString()
    };
    this.pending.set(id, {
      preview,
      sourceRoot,
      fingerprint: scanned.fingerprint
    });
    return preview;
  }

  async startPreview(previewId: string): Promise<NeuraCoHostedSitePreviewSession> {
    const existing = this.previewServers.get(previewId);
    if (existing) {
      return {
        previewId,
        address: existing.address,
        startedAt: existing.startedAt
      };
    }
    const pending = this.getPending(previewId);
    const entry = path.join(pending.sourceRoot, 'index.html');
    const entryDetails = await stat(entry).catch(() => null);
    if (!entryDetails?.isFile()) {
      throw new Error(
        'L’aperçu local nécessite un index.html dans le dossier sélectionné. '
        + 'Pour React/Vite, sélectionnez le dossier dist après le build.'
      );
    }
    const root = await realpath(pending.sourceRoot);
    const server = createServer(async (request, response) => {
      try {
        if (!['GET', 'HEAD'].includes(request.method || '')) {
          response.writeHead(405, { Allow: 'GET, HEAD' });
          response.end();
          return;
        }
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        const decoded = decodeURIComponent(url.pathname);
        if (decoded.split('/').includes('..') || decoded.includes('\0')) {
          response.writeHead(400);
          response.end('Requête invalide');
          return;
        }
        const requested = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
        let target = resolveInside(root, requested);
        let targetDetails = await stat(target).catch(() => null);
        if (targetDetails?.isDirectory()) {
          target = path.join(target, 'index.html');
          targetDetails = await stat(target).catch(() => null);
        }
        if (!targetDetails?.isFile() && !path.extname(requested)) {
          target = path.join(root, 'index.html');
          targetDetails = await stat(target).catch(() => null);
        }
        if (!targetDetails?.isFile()) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Fichier introuvable');
          return;
        }
        const realTarget = await realpath(target);
        const relation = path.relative(root, realTarget);
        if (relation.startsWith('..') || path.isAbsolute(relation)) {
          response.writeHead(403);
          response.end('Accès refusé');
          return;
        }
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Length': targetDetails.size,
          'Content-Type': mimeType(realTarget),
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff'
        });
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        response.end(await readFile(realTarget));
      } catch {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Aperçu temporairement indisponible');
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Adresse locale de prévisualisation indisponible.');
    }
    const session = {
      previewId,
      address: `http://127.0.0.1:${address.port}/`,
      startedAt: this.now().toISOString()
    };
    this.previewServers.set(previewId, {
      server,
      address: session.address,
      startedAt: session.startedAt
    });
    return session;
  }

  async stopPreview(previewId: string): Promise<boolean> {
    const current = this.previewServers.get(previewId);
    if (!current) return false;
    this.previewServers.delete(previewId);
    await new Promise<void>((resolve) => current.server.close(() => resolve()));
    return true;
  }

  async stopAllPreviews(): Promise<void> {
    await Promise.all([...this.previewServers.keys()].map((id) => this.stopPreview(id)));
  }

  async providerStatus(): Promise<NeuraCoHostedSiteProviderStatus> {
    try {
      const result = await this.runCommand(commandName(), ['--version'], process.cwd());
      if (result.exitCode !== 0) {
        return {
          provider: 'vercel',
          available: false,
          reason: result.stderr.trim() || 'Vercel CLI indisponible.'
        };
      }
      return {
        provider: 'vercel',
        available: true,
        version: result.stdout.trim().split(/\r?\n/).at(-1)?.slice(0, 80)
      };
    } catch {
      return {
        provider: 'vercel',
        available: false,
        reason: 'Vercel CLI n’est pas installée ou accessible.'
      };
    }
  }

  async deploy(
    projectId: string,
    previewId: string,
    confirmedPublic: boolean
  ): Promise<NeuraCoHostedSiteDeployment> {
    const pending = this.getPending(previewId);
    if (pending.preview.projectId !== projectId) {
      throw new Error('Cette prévisualisation appartient à un autre projet.');
    }
    if (pending.preview.visibility !== 'public') {
      throw new Error('Un aperçu local ne peut pas être déployé publiquement.');
    }
    if (!confirmedPublic) {
      throw new Error('Une confirmation explicite est obligatoire avant publication.');
    }
    const rescanned = await this.scan(pending.sourceRoot);
    if (rescanned.fingerprint !== pending.fingerprint) {
      throw new Error(
        'Les fichiers ont changé depuis la prévisualisation. '
        + 'Analysez de nouveau le site avant de le publier.'
      );
    }
    const provider = await this.providerStatus();
    if (!provider.available) throw new Error(provider.reason || 'Vercel CLI indisponible.');

    const stagingDirectory = path.join(
      this.options.storageDirectory,
      'staging',
      previewId
    );
    await rm(stagingDirectory, { recursive: true, force: true });
    await mkdir(stagingDirectory, { recursive: true });
    try {
      for (const file of pending.preview.files) {
        const source = resolveInside(pending.sourceRoot, file.relativePath);
        const target = resolveInside(stagingDirectory, file.relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source, target);
      }
      const result = await this.runCommand(commandName(), [
        'deploy',
        stagingDirectory,
        '--yes',
        '--prod',
        '--name',
        pending.preview.slug
      ], stagingDirectory);
      if (result.exitCode !== 0) {
        throw new Error(
          `Déploiement Vercel refusé : ${
            result.stderr.trim() || result.stdout.trim() || 'erreur inconnue'
          }`
        );
      }
      const urls = `${result.stdout}\n${result.stderr}`
        .match(/https:\/\/[A-Za-z0-9.-]+\.vercel\.app(?:\/[^\s]*)?/g);
      const address = urls?.at(-1)?.replace(/[),.;]+$/, '');
      if (!address) {
        throw new Error('Vercel n’a retourné aucune adresse de déploiement vérifiable.');
      }
      const deployment: NeuraCoHostedSiteDeployment = {
        id: randomUUID(),
        projectId,
        name: pending.preview.name,
        kind: pending.preview.kind,
        sourceDirectory: pending.preview.sourceDirectory,
        visibility: 'public',
        provider: 'vercel',
        address,
        deployedAt: this.now().toISOString(),
        files: pending.preview.files,
        totalBytes: pending.preview.totalBytes,
        environmentVariables: pending.preview.environmentVariables,
        estimatedCredits: pending.preview.estimatedCredits,
        hostingDurationDays: pending.preview.hostingDurationDays,
        hostingDurationLabel: pending.preview.hostingDurationLabel,
        authorizedPeople: pending.preview.authorizedPeople
      };
      await this.saveDeployment(deployment);
      this.pending.delete(previewId);
      return deployment;
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  }

  async list(projectId: string): Promise<NeuraCoHostedSiteDeployment[]> {
    const store = await this.readStore();
    return store.deployments
      .filter((deployment) => deployment.projectId === projectId)
      .sort((left, right) => right.deployedAt.localeCompare(left.deployedAt));
  }
}
