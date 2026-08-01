import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoArtifact,
  NeuraCoArtifactComparison,
  NeuraCoArtifactCreate,
  NeuraCoArtifactSource,
  NeuraCoArtifactSummary,
  NeuraCoArtifactUpdate,
  NeuraCoArtifactVersion,
  NeuraCoProject
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

const MAX_ARTIFACTS = 300;
const MAX_VERSIONS = 100;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_DIFF_LINES = 3000;
const SAFE_ID = /^[A-Za-z0-9_-]{8,160}$/;
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ');

interface StoredVersion extends NeuraCoArtifactVersion {
  fileName: string;
}

interface StoredArtifact extends Omit<NeuraCoArtifactSummary, 'versionCount'> {
  versions: StoredVersion[];
}

interface ArtifactStore {
  version: 1;
  artifacts: StoredArtifact[];
}

const safeText = (value: unknown, max: number): string => (
  redactSecrets(String(value || '')).trim().slice(0, max)
);

const sanitizeSources = (sources: unknown): NeuraCoArtifactSource[] => {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, 30).flatMap((source) => {
    if (!source || typeof source !== 'object') return [];
    const item = source as Partial<NeuraCoArtifactSource>;
    if (!['embedded', 'project_file', 'connector'].includes(String(item.kind))) return [];
    if (!['read_only', 'mutating'].includes(String(item.access))) return [];
    return [{
      label: safeText(item.label, 160) || 'Source',
      kind: item.kind as NeuraCoArtifactSource['kind'],
      reference: item.reference ? safeText(item.reference, 1000) : undefined,
      access: item.access as NeuraCoArtifactSource['access'],
      authorized: item.authorized === true
    }];
  });
};

const validateHtml = (html: unknown): string => {
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new Error('Le contenu HTML de l’artefact est obligatoire.');
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error('L’artefact dépasse la taille maximale de 1 Mo.');
  }
  return redactSecrets(html);
};

const secureDocument = (html: string): string => {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
  }
  return `<!doctype html><html><head>${csp}<meta charset="utf-8"></head><body>${html}</body></html>`;
};

const writeAtomically = async (target: string, store: ArtifactStore): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), {
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

const summaryOf = (artifact: StoredArtifact): NeuraCoArtifactSummary => ({
  id: artifact.id,
  projectId: artifact.projectId,
  projectName: artifact.projectName,
  title: artifact.title,
  description: artifact.description,
  createdAt: artifact.createdAt,
  updatedAt: artifact.updatedAt,
  deletedAt: artifact.deletedAt,
  currentVersionId: artifact.currentVersionId,
  versionCount: artifact.versions.length,
  sources: artifact.sources
});

const publicVersion = (version: StoredVersion): NeuraCoArtifactVersion => {
  const { fileName: _fileName, ...result } = version;
  return result;
};

const buildDiff = (
  before: string,
  after: string
): {
  addedLines: number;
  removedLines: number;
  diff: string;
  truncated: boolean;
} => {
  const left = before.replace(/\r\n/g, '\n').split('\n');
  const right = after.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let addedLines = 0;
  let removedLines = 0;

  if (left.length <= 1200 && right.length <= 1200) {
    const table = Array.from(
      { length: left.length + 1 },
      () => new Uint16Array(right.length + 1)
    );
    for (let i = left.length - 1; i >= 0; i -= 1) {
      for (let j = right.length - 1; j >= 0; j -= 1) {
        table[i][j] = left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        output.push(`  ${left[i]}`);
        i += 1;
        j += 1;
      } else if (
        j < right.length
        && (i >= left.length || table[i][j + 1] >= table[i + 1][j])
      ) {
        output.push(`+ ${right[j]}`);
        addedLines += 1;
        j += 1;
      } else {
        output.push(`- ${left[i]}`);
        removedLines += 1;
        i += 1;
      }
    }
  } else {
    let prefix = 0;
    while (
      prefix < left.length
      && prefix < right.length
      && left[prefix] === right[prefix]
    ) prefix += 1;
    let suffix = 0;
    while (
      suffix < left.length - prefix
      && suffix < right.length - prefix
      && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
    ) suffix += 1;
    output.push(...left.slice(Math.max(0, prefix - 3), prefix).map((line) => `  ${line}`));
    const removed = left.slice(prefix, left.length - suffix);
    const added = right.slice(prefix, right.length - suffix);
    output.push(...removed.map((line) => `- ${line}`));
    output.push(...added.map((line) => `+ ${line}`));
    output.push(...left.slice(left.length - suffix, left.length - suffix + 3).map(
      (line) => `  ${line}`
    ));
    removedLines = removed.length;
    addedLines = added.length;
  }
  const truncated = output.length > MAX_DIFF_LINES;
  return {
    addedLines,
    removedLines,
    diff: redactSecrets(output.slice(0, MAX_DIFF_LINES).join('\n')),
    truncated
  };
};

export class ArtifactService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storePath: string,
    private readonly storageDirectory: string
  ) {}

  private async readStore(): Promise<ArtifactStore> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      if (raw.length > 4 * 1024 * 1024) throw new Error('Artifact store too large');
      const parsed = JSON.parse(raw) as Partial<ArtifactStore>;
      return {
        version: 1,
        artifacts: Array.isArray(parsed.artifacts)
          ? parsed.artifacts
              .filter((item) => item && SAFE_ID.test(String(item.id)))
              .slice(-MAX_ARTIFACTS) as StoredArtifact[]
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('NeuraCo artifacts could not be read', error);
      }
      return { version: 1, artifacts: [] };
    }
  }

  private async mutate<T>(
    operation: (store: ArtifactStore) => T | Promise<T>
  ): Promise<T> {
    const pending = this.writeQueue.catch(() => undefined).then(async () => {
      const store = await this.readStore();
      const result = await operation(store);
      store.artifacts = store.artifacts.slice(-MAX_ARTIFACTS);
      await writeAtomically(this.storePath, store);
      return result;
    });
    this.writeQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private versionPath(artifactId: string, fileName: string): string {
    if (!SAFE_ID.test(artifactId) || !/^[A-Za-z0-9_-]+\.html$/.test(fileName)) {
      throw new Error('Chemin de version d’artefact invalide.');
    }
    return path.join(this.storageDirectory, artifactId, fileName);
  }

  private async writeVersion(
    artifactId: string,
    html: string,
    number: number,
    summary: string,
    sourceConversationId?: string
  ): Promise<StoredVersion> {
    const id = randomUUID();
    const fileName = `${id}.html`;
    const target = this.versionPath(artifactId, fileName);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html, { encoding: 'utf8', mode: 0o600 });
    return {
      id,
      number,
      createdAt: new Date().toISOString(),
      summary: safeText(summary, 500) || `Version ${number}`,
      sourceConversationId: sourceConversationId
        ? safeText(sourceConversationId, 160)
        : undefined,
      size: Buffer.byteLength(html, 'utf8'),
      fileName
    };
  }

  async list(
    projectId: string,
    includeDeleted = false
  ): Promise<NeuraCoArtifactSummary[]> {
    const store = await this.readStore();
    return store.artifacts
      .filter((item) => item.projectId === projectId)
      .filter((item) => includeDeleted || !item.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summaryOf);
  }

  async get(projectId: string, artifactId: string): Promise<NeuraCoArtifact> {
    const store = await this.readStore();
    const artifact = store.artifacts.find(
      (item) => item.id === artifactId && item.projectId === projectId
    );
    if (!artifact) throw new Error('Artefact introuvable.');
    const version = artifact.versions.find(
      (item) => item.id === artifact.currentVersionId
    );
    if (!version) throw new Error('Version actuelle de l’artefact introuvable.');
    const html = await readFile(
      this.versionPath(artifact.id, version.fileName),
      'utf8'
    );
    return {
      ...summaryOf(artifact),
      html,
      versions: artifact.versions.map(publicVersion).reverse()
    };
  }

  async create(
    project: NeuraCoProject,
    input: NeuraCoArtifactCreate
  ): Promise<NeuraCoArtifact> {
    const id = randomUUID();
    const html = validateHtml(input.html);
    const now = new Date().toISOString();
    const version = await this.writeVersion(
      id,
      html,
      1,
      input.summary || 'Création de l’artefact',
      input.sourceConversationId
    );
    const artifact: StoredArtifact = {
      id,
      projectId: project.id,
      projectName: project.name,
      title: safeText(input.title, 160) || 'Nouvel artefact',
      description: safeText(input.description, 1000),
      createdAt: now,
      updatedAt: now,
      currentVersionId: version.id,
      versions: [version],
      sources: sanitizeSources(input.sources)
    };
    await this.mutate((store) => {
      store.artifacts.push(artifact);
    });
    return this.get(project.id, id);
  }

  async update(
    projectId: string,
    artifactId: string,
    input: NeuraCoArtifactUpdate
  ): Promise<NeuraCoArtifact> {
    const html = validateHtml(input.html);
    return this.mutate(async (store) => {
      const artifact = store.artifacts.find(
        (item) => item.id === artifactId && item.projectId === projectId
      );
      if (!artifact || artifact.deletedAt) throw new Error('Artefact introuvable.');
      const version = await this.writeVersion(
        artifact.id,
        html,
        artifact.versions.length + 1,
        input.summary,
        input.sourceConversationId
      );
      artifact.versions = [...artifact.versions, version].slice(-MAX_VERSIONS);
      artifact.currentVersionId = version.id;
      artifact.updatedAt = version.createdAt;
      if (input.sources) artifact.sources = sanitizeSources(input.sources);
      return {
        ...summaryOf(artifact),
        html,
        versions: artifact.versions.map(publicVersion).reverse()
      };
    });
  }

  async rename(
    projectId: string,
    artifactId: string,
    title: string
  ): Promise<NeuraCoArtifactSummary> {
    return this.mutate((store) => {
      const artifact = store.artifacts.find(
        (item) => item.id === artifactId && item.projectId === projectId
      );
      if (!artifact || artifact.deletedAt) throw new Error('Artefact introuvable.');
      artifact.title = safeText(title, 160) || artifact.title;
      artifact.updatedAt = new Date().toISOString();
      return summaryOf(artifact);
    });
  }

  async delete(
    projectId: string,
    artifactId: string
  ): Promise<NeuraCoArtifactSummary[]> {
    await this.mutate((store) => {
      const artifact = store.artifacts.find(
        (item) => item.id === artifactId && item.projectId === projectId
      );
      if (!artifact) throw new Error('Artefact introuvable.');
      artifact.deletedAt = new Date().toISOString();
      artifact.updatedAt = artifact.deletedAt;
    });
    return this.list(projectId);
  }

  async restoreVersion(
    projectId: string,
    artifactId: string,
    versionId: string
  ): Promise<NeuraCoArtifact> {
    const store = await this.readStore();
    const artifact = store.artifacts.find(
      (item) => item.id === artifactId && item.projectId === projectId
    );
    const version = artifact?.versions.find((item) => item.id === versionId);
    if (!artifact || !version || artifact.deletedAt) {
      throw new Error('Version d’artefact introuvable.');
    }
    const html = await readFile(
      this.versionPath(artifact.id, version.fileName),
      'utf8'
    );
    return this.update(projectId, artifactId, {
      html,
      summary: `Restauration de la version ${version.number}`,
      sources: artifact.sources
    });
  }

  async compare(
    projectId: string,
    artifactId: string,
    fromVersionId: string,
    toVersionId: string
  ): Promise<NeuraCoArtifactComparison> {
    const store = await this.readStore();
    const artifact = store.artifacts.find(
      (item) => item.id === artifactId && item.projectId === projectId
    );
    const from = artifact?.versions.find((item) => item.id === fromVersionId);
    const to = artifact?.versions.find((item) => item.id === toVersionId);
    if (!artifact || !from || !to) throw new Error('Versions à comparer introuvables.');
    const [before, after] = await Promise.all([
      readFile(this.versionPath(artifact.id, from.fileName), 'utf8'),
      readFile(this.versionPath(artifact.id, to.fileName), 'utf8')
    ]);
    return {
      artifactId,
      fromVersionId,
      toVersionId,
      fromNumber: from.number,
      toNumber: to.number,
      ...buildDiff(before, after)
    };
  }

  async export(
    projectId: string,
    artifactId: string,
    targetPath: string
  ): Promise<void> {
    const artifact = await this.get(projectId, artifactId);
    await mkdir(path.dirname(targetPath), { recursive: true });
    const temporary = `${targetPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, secureDocument(artifact.html), 'utf8');
    try {
      await rename(temporary, targetPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EEXIST', 'EPERM'].includes(code || '')) throw error;
      await copyFile(temporary, targetPath);
      await rm(temporary, { force: true });
    }
  }
}

export const secureArtifactDocument = secureDocument;
