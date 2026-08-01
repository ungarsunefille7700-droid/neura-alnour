import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import type {
  NeuraCoNetworkAccessMode,
  NeuraCoPermissionAction,
  NeuraCoPermissionMode,
  NeuraCoProjectPermissions,
  NeuraCoProjectPermissionsUpdate,
  NeuraCoTerminalCommandAssessment
} from './ipc-contract';

const MAX_RULES = 100;
const MAX_VALUE_LENGTH = 500;
const VALID_MODES = new Set<NeuraCoPermissionMode>([
  'plan',
  'manual',
  'accept_edits',
  'safe_auto',
  'deny_unapproved',
  'full'
]);
const LEGACY_MODES: Record<string, NeuraCoPermissionMode> = {
  ask: 'manual',
  scoped: 'safe_auto'
};
const VALID_ACTIONS = new Set<NeuraCoPermissionAction>([
  'read_file',
  'write_file',
  'terminal',
  'network',
  'application'
]);
const VALID_NETWORK_MODES = new Set<NeuraCoNetworkAccessMode>([
  'none',
  'approved_domains',
  'ask_each',
  'temporary_full'
]);

export type NeuraCoFileAccess = 'forbidden' | 'none' | 'read_only' | 'writable';

interface StoredPermissions {
  version: 1;
  projects: Record<string, NeuraCoProjectPermissions>;
}

const cleanList = (value: unknown, max = MAX_RULES): string[] => (
  Array.isArray(value)
    ? Array.from(new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0 && item.length <= MAX_VALUE_LENGTH)
      )).slice(0, max)
    : []
);

const defaultPermissions = (
  projectId: string,
  projectRoot: string
): NeuraCoProjectPermissions => ({
  projectId,
  projectRoot,
  configured: false,
  mode: 'manual',
  allowedActions: [],
  allowedFolders: [projectRoot],
  readOnlyFolders: [projectRoot],
  writableFolders: [],
  forbiddenPaths: [],
  allowedCommandPrefixes: [],
  allowedDomains: [],
  networkAccessMode: 'ask_each',
  allowedApplications: [],
  alwaysAllowedSignatures: [],
  updatedAt: new Date().toISOString()
});

const sanitizePermissions = (
  raw: Partial<NeuraCoProjectPermissions> | undefined,
  projectId: string,
  projectRoot: string
): NeuraCoProjectPermissions => {
  const fallback = defaultPermissions(projectId, projectRoot);
  const rawMode = String(raw?.mode || '');
  const mode = VALID_MODES.has(rawMode as NeuraCoPermissionMode)
    ? rawMode as NeuraCoPermissionMode
    : LEGACY_MODES[rawMode] || fallback.mode;
  const allowedFolders = cleanList(raw?.allowedFolders);
  const readOnlyFolders = cleanList(raw?.readOnlyFolders);
  const writableFolders = cleanList(raw?.writableFolders);
  const forbiddenPaths = cleanList(raw?.forbiddenPaths);
  const legacyWritable = (
    mode === 'accept_edits'
    || mode === 'safe_auto'
    || mode === 'deny_unapproved'
    || mode === 'full'
  );
  const rawNetworkMode = String(raw?.networkAccessMode || '');
  let networkAccessMode = VALID_NETWORK_MODES.has(
    rawNetworkMode as NeuraCoNetworkAccessMode
  )
    ? rawNetworkMode as NeuraCoNetworkAccessMode
    : cleanList(raw?.allowedDomains).length > 0
      ? 'approved_domains'
      : 'ask_each';
  const temporaryFullNetworkUntil =
    typeof raw?.temporaryFullNetworkUntil === 'string'
      ? raw.temporaryFullNetworkUntil
      : undefined;
  if (networkAccessMode === 'temporary_full') {
    const expiry = temporaryFullNetworkUntil
      ? Date.parse(temporaryFullNetworkUntil)
      : Number.NaN;
    const now = Date.now();
    if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 60 * 60 * 1_000) {
      networkAccessMode = 'ask_each';
    }
  }
  return {
    projectId,
    projectRoot,
    configured: raw?.configured === true,
    mode,
    allowedActions: cleanList(raw?.allowedActions)
      .filter((action): action is NeuraCoPermissionAction => (
        VALID_ACTIONS.has(action as NeuraCoPermissionAction)
      )),
    allowedFolders: allowedFolders.length > 0 ? allowedFolders : [projectRoot],
    readOnlyFolders: readOnlyFolders.length > 0
      ? readOnlyFolders
      : allowedFolders.length > 0
        ? allowedFolders
        : [projectRoot],
    writableFolders: writableFolders.length > 0
      ? writableFolders
      : legacyWritable
        ? allowedFolders.length > 0 ? allowedFolders : [projectRoot]
        : [],
    forbiddenPaths,
    allowedCommandPrefixes: cleanList(raw?.allowedCommandPrefixes),
    allowedDomains: cleanList(raw?.allowedDomains),
    networkAccessMode,
    temporaryFullNetworkUntil,
    allowedApplications: cleanList(raw?.allowedApplications),
    alwaysAllowedSignatures: cleanList(raw?.alwaysAllowedSignatures),
    updatedAt: typeof raw?.updatedAt === 'string'
      ? raw.updatedAt
      : fallback.updatedAt
  };
};

export class ProjectPermissionStore {
  constructor(private readonly filePath: string) {}

  private async readStore(): Promise<StoredPermissions> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      if (raw.length > 512 * 1024) throw new Error('Permission store too large');
      const parsed = JSON.parse(raw) as Partial<StoredPermissions>;
      return {
        version: 1,
        projects: parsed.projects && typeof parsed.projects === 'object'
          ? parsed.projects
          : {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('NeuraCo permissions could not be read', error);
      }
      return { version: 1, projects: {} };
    }
  }

  private async writeStore(store: StoredPermissions): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }

  async get(
    projectId: string,
    projectRoot: string
  ): Promise<NeuraCoProjectPermissions> {
    const store = await this.readStore();
    return sanitizePermissions(store.projects[projectId], projectId, projectRoot);
  }

  async update(
    projectId: string,
    projectRoot: string,
    update: NeuraCoProjectPermissionsUpdate
  ): Promise<NeuraCoProjectPermissions> {
    const store = await this.readStore();
    const current = sanitizePermissions(store.projects[projectId], projectId, projectRoot);
    if (!VALID_MODES.has(update.mode)) throw new Error('Mode d’autorisation invalide.');
    const next = sanitizePermissions({
      ...current,
      ...update,
      projectId,
      projectRoot,
      configured: true,
      updatedAt: new Date().toISOString()
    }, projectId, projectRoot);
    store.projects[projectId] = next;
    await this.writeStore(store);
    return next;
  }

  async allowSignature(
    projectId: string,
    projectRoot: string,
    signature: string
  ): Promise<NeuraCoProjectPermissions> {
    const current = await this.get(projectId, projectRoot);
    return this.update(projectId, projectRoot, {
      ...current,
      alwaysAllowedSignatures: [
        ...current.alwaysAllowedSignatures,
        signature
      ]
    });
  }
}

export const permissionSignature = (
  action: NeuraCoPermissionAction,
  detail: string
): string => `${action}:${detail.trim().toLowerCase()}`.slice(0, 520);

const normalizedPath = (value: string): string => {
  const resolved = path.resolve(value.trim());
  const normalized = resolved
    .replace(/[\\/]+/g, path.sep)
    .replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const isPathInside = (candidate: string, parent: string): boolean => {
  const normalizedCandidate = normalizedPath(candidate);
  const normalizedParent = normalizedPath(parent);
  return (
    normalizedCandidate === normalizedParent
    || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
  );
};

const environmentPath = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value ? normalizedPath(value) : null;
};

let protectedRootCache: string[] | null = null;

const protectedRoots = (): string[] => {
  if (protectedRootCache) return protectedRootCache;
  const rawHome = (process.env.USERPROFILE || process.env.HOME || '').trim();
  const home = rawHome ? normalizedPath(rawHome) : null;
  const usersRoot = home ? normalizedPath(path.dirname(home)) : null;
  const currentUserName = home ? path.basename(home).toLowerCase() : '';
  const appData = process.env.APPDATA?.trim();
  const localAppData = process.env.LOCALAPPDATA?.trim();
  const roots = [
    environmentPath('WINDIR'),
    environmentPath('SystemRoot'),
    environmentPath('ProgramFiles'),
    environmentPath('ProgramFiles(x86)'),
    environmentPath('ProgramData'),
    home ? normalizedPath(path.join(home, '.ssh')) : null,
    home ? normalizedPath(path.join(home, '.gnupg')) : null,
    appData
      ? normalizedPath(path.join(appData, 'Microsoft', 'Credentials'))
      : null,
    appData
      ? normalizedPath(path.join(appData, 'Microsoft', 'Protect'))
      : null,
    localAppData
      ? normalizedPath(path.join(localAppData, 'Microsoft', 'Credentials'))
      : null,
    localAppData
      ? normalizedPath(path.join(localAppData, 'Google', 'Chrome', 'User Data'))
      : null,
    localAppData
      ? normalizedPath(path.join(localAppData, 'Microsoft', 'Edge', 'User Data'))
      : null,
    appData
      ? normalizedPath(path.join(appData, 'Mozilla', 'Firefox', 'Profiles'))
      : null,
    appData ? normalizedPath(path.join(appData, 'Exodus')) : null,
    appData ? normalizedPath(path.join(appData, 'Ledger Live')) : null,
    appData ? normalizedPath(path.join(appData, 'Electrum')) : null
  ].filter((value): value is string => Boolean(value));

  if (usersRoot && currentUserName) {
    try {
      for (const entry of readdirSync(usersRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.toLowerCase() !== currentUserName) {
          roots.push(normalizedPath(path.join(usersRoot, entry.name)));
        }
      }
    } catch {
      // Profile discovery is best-effort; fixed protected roots remain active.
    }
  }
  protectedRootCache = Array.from(new Set(roots));
  return protectedRootCache;
};

const SENSITIVE_FILE_NAMES = [
  /^\.env(?:\.|$)/i,
  /^credentials?(?:\.|$)/i,
  /^secrets?(?:\.|$)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /\.(?:key|pem|p12|pfx|kdbx)$/i,
  /^wallet\.dat$/i
];

export const isDefaultProtectedFilePath = (candidatePath: string): boolean => {
  const candidate = normalizedPath(candidatePath);
  if (protectedRoots().some((root) => isPathInside(candidate, root))) return true;
  return candidate
    .split(/[\\/]/)
    .some((segment) => SENSITIVE_FILE_NAMES.some((pattern) => pattern.test(segment)));
};

export const fileAccessForPath = (
  permissions: NeuraCoProjectPermissions,
  candidatePath: string
): NeuraCoFileAccess => {
  if (isDefaultProtectedFilePath(candidatePath)) return 'forbidden';
  if ((permissions.forbiddenPaths || []).some((rule) => isPathInside(candidatePath, rule))) {
    return 'forbidden';
  }

  const fallbackWritable = (
    permissions.mode === 'accept_edits'
    || permissions.mode === 'safe_auto'
    || permissions.mode === 'deny_unapproved'
    || permissions.mode === 'full'
  )
    ? permissions.allowedFolders
    : [];
  const writable = permissions.writableFolders ?? fallbackWritable;
  if (writable.some((rule) => isPathInside(candidatePath, rule))) return 'writable';

  const readable = permissions.readOnlyFolders ?? permissions.allowedFolders;
  if (readable.some((rule) => isPathInside(candidatePath, rule))) return 'read_only';
  return 'none';
};

export const normalizeNetworkDomain = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return '';
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`
    );
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
};

const isApprovedDomain = (
  permissions: NeuraCoProjectPermissions,
  detail: string
): boolean => {
  const domain = normalizeNetworkDomain(detail);
  if (!domain) return false;
  return permissions.allowedDomains.some((allowed) => {
    const normalized = normalizeNetworkDomain(allowed.replace(/^\*\./, ''));
    return Boolean(
      normalized
      && (domain === normalized || domain.endsWith(`.${normalized}`))
    );
  });
};

const hasTemporaryFullNetwork = (
  permissions: NeuraCoProjectPermissions
): boolean => (
  permissions.networkAccessMode === 'temporary_full'
  && typeof permissions.temporaryFullNetworkUntil === 'string'
  && Date.parse(permissions.temporaryFullNetworkUntil) > Date.now()
);

export const isSensitiveTerminalCommand = (command: string): boolean => {
  const normalized = command.trim().toLowerCase();
  return [
    /\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f)/,
    /\b(rm|rmdir|del|erase|remove-item)\b/,
    /\b(format|diskpart|shutdown|restart-computer)\b/,
    /\b(password|passwd|credential|secret|token|api[_-]?key)\b/,
    /(?:^|[\\/\s])\.env(?:[.\s]|$)/,
    /(?:^|[\\/\s])\.ssh(?:[\\/\s]|$)/,
    /\bid_(?:rsa|dsa|ecdsa|ed25519)\b/,
    /\b(?:wallet\.dat|credentials?|protect)[\\/\s]/,
    /\bappdata\b.*\b(?:chrome|edge|firefox|exodus|ledger|electrum)\b/,
    /\b(?:chrome|edge|firefox)\b.*\b(?:user data|profiles?)\b/,
    /\b(stripe|paypal|payment|crypto|wallet|bank|transfer)\b/,
    /\b(netsh|firewall|defender|antivirus|set-mppreference)\b/,
    /\b(run as administrator|sudo|start-process.+-verb\s+runas)\b/,
    /\b(npm\s+publish|docker\s+push|twine\s+upload)\b/
  ].some((pattern) => pattern.test(normalized));
};

export const assessTerminalCommand = (
  command: string
): NeuraCoTerminalCommandAssessment => {
  const normalized = String(command || '').trim().toLowerCase();
  if (isSensitiveTerminalCommand(normalized)) {
    return {
      level: 'sensitive',
      label: 'Niveau sensible',
      reason: 'La commande peut supprimer, publier, élever les privilèges ou modifier le système.',
      requiresExplicitConfirmation: true
    };
  }
  const safePatterns = [
    /^(dir|ls|pwd|tree)(\s|$)/,
    /^(type|cat|get-content|head|tail)(\s|$)/,
    /^git\s+(status|diff|log|show|branch)(\s|$)/,
    /^(npm|pnpm|yarn)\s+(test|run\s+(test|build|lint|typecheck))(\s|$)/,
    /^(pytest|python\s+-m\s+pytest|vitest|jest|ctest|tsc)(\s|$)/,
    /^(dotnet\s+(test|build)|cargo\s+(test|check|build)|go\s+test)(\s|$)/
  ];
  if (safePatterns.some((pattern) => pattern.test(normalized))) {
    return {
      level: 'safe',
      label: 'Niveau sûr',
      reason: 'Lecture, statut, test, compilation ou vérification sans action destructive détectée.',
      requiresExplicitConfirmation: false
    };
  }
  return {
    level: 'moderate',
    label: 'Niveau modéré',
    reason: 'La commande peut créer des fichiers, installer une dépendance ou lancer un processus.',
    requiresExplicitConfirmation: false
  };
};

export const permissionAllowsWithoutPrompt = (
  permissions: NeuraCoProjectPermissions,
  action: NeuraCoPermissionAction,
  detail: string,
  sessionSignatures: ReadonlySet<string>
): boolean => {
  const signature = permissionSignature(action, detail);
  const fileAccess = action === 'read_file' || action === 'write_file'
    ? fileAccessForPath(permissions, detail)
    : null;

  if (action === 'terminal' && isSensitiveTerminalCommand(detail)) {
    return false;
  }
  if (fileAccess === 'forbidden') return false;
  if (permissions.mode === 'plan') {
    return action === 'read_file' && (
      fileAccess === 'read_only' || fileAccess === 'writable'
    );
  }
  if (action === 'network') {
    const networkMode = permissions.networkAccessMode
      || (permissions.allowedDomains.length > 0 ? 'approved_domains' : 'ask_each');
    if (networkMode === 'none') return false;
    if (networkMode === 'approved_domains') return isApprovedDomain(permissions, detail);
    if (networkMode === 'temporary_full') return hasTemporaryFullNetwork(permissions);
    return (
      sessionSignatures.has(signature)
      || permissions.alwaysAllowedSignatures.includes(signature)
    );
  }
  if (permissions.mode === 'accept_edits') {
    if (action === 'read_file') {
      return fileAccess === 'read_only' || fileAccess === 'writable';
    }
    if (action === 'write_file') return fileAccess === 'writable';
    return false;
  }
  if (permissions.mode === 'full') {
    if (action === 'read_file') return fileAccess !== 'none';
    if (action === 'write_file') return fileAccess === 'writable';
    return true;
  }
  if (
    sessionSignatures.has(signature)
    || permissions.alwaysAllowedSignatures.includes(signature)
  ) {
    return true;
  }
  if (permissions.mode === 'manual') return false;
  if (!permissions.allowedActions.includes(action)) return false;
  if (action === 'application') {
    const application = detail.trim().toLowerCase();
    return permissions.allowedApplications.some(
      (allowed) => allowed.trim().toLowerCase() === application
    );
  }
  if (action === 'read_file' || action === 'write_file') {
    return action === 'read_file'
      ? fileAccess === 'read_only' || fileAccess === 'writable'
      : fileAccess === 'writable';
  }
  if (action === 'terminal') {
    const command = detail.trim().toLowerCase();
    return permissions.allowedCommandPrefixes.some((prefix) => (
      command === prefix.toLowerCase()
      || command.startsWith(`${prefix.toLowerCase()} `)
    ));
  }
  return true;
};

export const permissionRefusesWithoutPrompt = (
  permissions: NeuraCoProjectPermissions,
  action: NeuraCoPermissionAction,
  detail: string,
  sessionSignatures: ReadonlySet<string>
): boolean => (
  (
    (
      action === 'network'
      && (
        permissions.networkAccessMode === 'none'
        || (
          permissions.networkAccessMode === 'approved_domains'
          && !isApprovedDomain(permissions, detail)
        )
      )
    )
    ||
    (
      (action === 'read_file' || action === 'write_file')
      && fileAccessForPath(permissions, detail) === 'forbidden'
    )
    || permissions.mode === 'plan'
    || permissions.mode === 'deny_unapproved'
  )
  && !permissionAllowsWithoutPrompt(
    permissions,
    action,
    detail,
    sessionSignatures
  )
);
