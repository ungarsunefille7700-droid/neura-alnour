import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoActivityEntry,
  NeuraCoEvidence,
  NeuraCoTaskReport
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

const MAX_LOG_BYTES = 20 * 1024 * 1024;
const SENSITIVE_KEY =
  /(?:secret|token|password|api[_-]?key|authorization|cookie|checkoutSessionId|accessCode|privateKey)/i;
const SENSITIVE_VALUE =
  /(?:\b(?:sk|ghp|rnd|vcp|tvly)[_-][A-Za-z0-9_-]{12,}\b|Bearer\s+[A-Za-z0-9._-]{12,})/gi;
const SAFE_EVIDENCE_ID = /^[A-Za-z0-9_-]{8,160}$/;

const sanitize = (value: unknown, key = ''): unknown => {
  if (SENSITIVE_KEY.test(key)) return '[MASQUÉ]';
  if (typeof value === 'string') {
    return redactSecrets(value).replace(SENSITIVE_VALUE, '[MASQUÉ]').slice(0, 20_000);
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 200)
        .map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)])
    );
  }
  return value;
};

const unique = (values: Array<string | undefined>): string[] => (
  [...new Set(values.filter((value): value is string => Boolean(value)))]
);

const safeString = (value: unknown, max = 20_000): string => (
  redactSecrets(String(value || '')).slice(0, max)
);

const sanitizeEvidence = (
  evidence: NeuraCoEvidence | undefined,
  taskId?: string,
  projectId?: string
): NeuraCoEvidence | undefined => {
  if (!evidence || evidence.source !== 'machine' || !SAFE_EVIDENCE_ID.test(evidence.id)) {
    return undefined;
  }
  const metadata = evidence.metadata && typeof evidence.metadata === 'object'
    ? Object.fromEntries(
      Object.entries(evidence.metadata)
        .filter(([key, value]) => (
          (!SENSITIVE_KEY.test(key) && ['string', 'number', 'boolean'].includes(typeof value))
          || value === null
        ))
        .slice(0, 60)
        .map(([key, value]) => [
          key.slice(0, 120),
          typeof value === 'string' ? safeString(value, 2000) : value
        ])
    )
    : undefined;
  return {
    id: evidence.id,
    source: 'machine',
    kind: evidence.kind,
    status: evidence.status,
    title: safeString(evidence.title, 300),
    summary: safeString(evidence.summary, 2000),
    capturedAt: evidence.capturedAt || new Date().toISOString(),
    taskId: taskId || evidence.taskId,
    projectId: projectId || evidence.projectId,
    command: evidence.command ? safeString(evidence.command, 2000) : undefined,
    exitCode: evidence.exitCode,
    durationMs: Number.isFinite(evidence.durationMs)
      ? Math.max(0, Number(evidence.durationMs))
      : undefined,
    filePath: evidence.filePath ? safeString(evidence.filePath, 4000) : undefined,
    mediaType: evidence.mediaType ? safeString(evidence.mediaType, 120) : undefined,
    url: evidence.url ? safeString(evidence.url, 4000) : undefined,
    output: evidence.output ? safeString(evidence.output, 20_000) : undefined,
    metadata
  };
};

export class ActivityService {
  private readonly logPath: string;
  private appendQueue: Promise<void> = Promise.resolve();
  private chainInitialized = false;
  private lastHash = 'GENESIS';
  private lastSequence = 0;

  constructor(storageDirectory: string) {
    this.logPath = path.join(storageDirectory, 'activity.jsonl');
  }

  async append(
    entry: Omit<NeuraCoActivityEntry, 'id' | 'timestamp'>
  ): Promise<NeuraCoActivityEntry> {
    const operation = this.appendQueue.then(() => this.appendInternal(entry));
    this.appendQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async appendInternal(
    entry: Omit<NeuraCoActivityEntry, 'id' | 'timestamp'>
  ): Promise<NeuraCoActivityEntry> {
    await mkdir(path.dirname(this.logPath), { recursive: true });
    await this.ensureChainState();
    const chained: Omit<NeuraCoActivityEntry, 'entryHash'> = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sequence: this.lastSequence + 1,
      previousHash: this.lastHash,
      taskId: entry.taskId,
      projectId: entry.projectId,
      category: String(entry.category || 'system').slice(0, 80),
      action: String(entry.action || 'event').slice(0, 120),
      status: entry.status,
      summary: safeString(entry.summary, 1000),
      details: sanitize(entry.details || {}) as Record<string, unknown>,
      evidence: sanitizeEvidence(entry.evidence, entry.taskId, entry.projectId)
    };
    const safe: NeuraCoActivityEntry = {
      ...chained,
      entryHash: createHash('sha256').update(JSON.stringify(chained)).digest('hex')
    };
    await appendFile(this.logPath, `${JSON.stringify(safe)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    this.lastHash = safe.entryHash!;
    this.lastSequence = safe.sequence!;
    await this.truncateIfNeeded();
    return safe;
  }

  async list(limit = 500): Promise<NeuraCoActivityEntry[]> {
    let content = '';
    try {
      content = await readFile(this.logPath, 'utf8');
    } catch {
      return [];
    }
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(limit, 5000)))
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as NeuraCoActivityEntry];
        } catch {
          return [];
        }
      });
  }

  async buildReport(taskId?: string): Promise<NeuraCoTaskReport> {
    const all = await this.list(5000);
    const events = taskId ? all.filter((entry) => entry.taskId === taskId) : all;
    const first = events[0];
    const last = events.at(-1);
    const detailStrings = (...keys: string[]): string[] => events.flatMap((entry) => (
      keys.flatMap((key) => {
        const value = entry.details?.[key];
        if (Array.isArray(value)) return value.map(String);
        return typeof value === 'string' ? [value] : [];
      })
    ));
    const byStatus = (status: NeuraCoActivityEntry['status']): string[] => (
      events.filter((entry) => entry.status === status).map((entry) => entry.summary)
    );
    const creditsConsumed = events.reduce((total, entry) => {
      const value = Number(entry.details?.creditsConsumed ?? 0);
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);
    const tests = events
      .filter((entry) => entry.category === 'test')
      .map((entry) => ({ summary: entry.summary, status: entry.status }));
    const evidence = events
      .flatMap((entry) => entry.evidence ? [entry.evidence] : [])
      .filter((item, index, all) => (
        all.findIndex((candidate) => candidate.id === item.id) === index
      ));

    return {
      generatedAt: new Date().toISOString(),
      taskId,
      objective: events.find((entry) => entry.action === 'task_started')?.summary,
      durationMs: first && last
        ? Math.max(0, Date.parse(last.timestamp) - Date.parse(first.timestamp))
        : 0,
      agents: unique([
        ...detailStrings('agent'),
        ...events.filter((entry) => entry.category === 'agent')
          .map((entry) => String(entry.details?.agent || ''))
      ]),
      applications: unique(detailStrings('application', 'applications')),
      filesRead: unique(detailStrings('fileRead', 'filesRead')),
      filesCreated: unique(detailStrings('fileCreated', 'filesCreated')),
      filesModified: unique(detailStrings('fileModified', 'filesModified')),
      filesMoved: unique(detailStrings('fileMoved', 'filesMoved')),
      filesDeleted: unique(detailStrings('fileDeleted', 'filesDeleted')),
      commands: unique(detailStrings('command', 'commands')),
      tests,
      errors: byStatus('failed'),
      corrections: events
        .filter((entry) => entry.action.includes('fix') || entry.action.includes('restore'))
        .map((entry) => entry.summary),
      refusedActions: byStatus('refused'),
      risks: unique(detailStrings('risk')),
      restorePoints: unique(detailStrings('checkpoint')),
      creditsConsumed: Math.round(creditsConsumed * 100) / 100,
      integrity: this.verifyIntegrity(all),
      evidence,
      events
    };
  }

  async findEvidence(evidenceId: string): Promise<NeuraCoEvidence | null> {
    if (!SAFE_EVIDENCE_ID.test(evidenceId)) return null;
    const entries = await this.list(5000);
    return entries.find((entry) => entry.evidence?.id === evidenceId)?.evidence || null;
  }

  formatMarkdown(report: NeuraCoTaskReport): string {
    const list = (items: string[]) => (
      items.length ? items.map((item) => `- ${item}`).join('\n') : '- Aucun'
    );
    const evidenceMarkdown = report.evidence.length
      ? report.evidence.map((evidence) => [
        `### ${evidence.title}`,
        `- Type : ${evidence.kind}`,
        `- Statut : ${evidence.status}`,
        '- Source : mesure machine',
        `- Capturée : ${evidence.capturedAt}`,
        evidence.command ? `- Commande : \`${evidence.command.replace(/`/g, '\\`')}\`` : null,
        evidence.exitCode !== undefined ? `- Code de sortie : ${evidence.exitCode}` : null,
        evidence.durationMs !== undefined ? `- Durée : ${evidence.durationMs} ms` : null,
        evidence.url ? `- URL : ${evidence.url}` : null,
        evidence.filePath ? `- Fichier : \`${evidence.filePath.replace(/`/g, '\\`')}\`` : null,
        '',
        evidence.summary,
        evidence.output
          ? `\n\`\`\`text\n${evidence.output.replace(/```/g, '` ` `')}\n\`\`\``
          : null
      ].filter((line): line is string => line !== null).join('\n')).join('\n\n')
      : '- Aucune preuve machine enregistrée. Une affirmation d’agent seule n’est pas une preuve.';
    return [
      '# Rapport NeuraCo',
      '',
      `Généré : ${report.generatedAt}`,
      report.taskId ? `Tâche : ${report.taskId}` : null,
      report.objective ? `Objectif : ${report.objective}` : null,
      `Durée : ${report.durationMs} ms`,
      `Crédits consommés : ${report.creditsConsumed}`,
      report.integrity
        ? `Intégrité du journal : ${report.integrity.verified ? 'vérifiée' : 'ERREUR'}`
        : null,
      '',
      '## Agents',
      list(report.agents),
      '',
      '## Applications',
      list(report.applications),
      '',
      '## Fichiers consultés',
      list(report.filesRead),
      '',
      '## Fichiers créés ou modifiés',
      list([...report.filesCreated, ...report.filesModified]),
      '',
      '## Commandes',
      list(report.commands),
      '',
      '## Tests',
      list(report.tests.map((test) => `${test.status} — ${test.summary}`)),
      '',
      '## Preuves de fonctionnement',
      evidenceMarkdown,
      '',
      '## Erreurs',
      list(report.errors),
      '',
      '## Actions refusées',
      list(report.refusedActions),
      '',
      '## Restauration',
      list(report.restorePoints)
    ].filter((line): line is string => line !== null).join('\n');
  }

  private async truncateIfNeeded(): Promise<void> {
    try {
      const content = await readFile(this.logPath);
      if (content.byteLength <= MAX_LOG_BYTES) return;
      const tail = content.subarray(content.byteLength - Math.floor(MAX_LOG_BYTES / 2));
      const firstLine = tail.indexOf(0x0a);
      const clean = firstLine >= 0 ? tail.subarray(firstLine + 1) : tail;
      const { writeFile } = await import('node:fs/promises');
      await writeFile(this.logPath, clean);
    } catch {
      // A missing or temporarily locked log is retried on the next append.
    }
  }

  private async ensureChainState(): Promise<void> {
    if (this.chainInitialized) return;
    const existing = await this.list(5000);
    const lastChained = existing
      .filter((entry) => entry.entryHash && Number.isInteger(entry.sequence))
      .at(-1);
    if (lastChained) {
      this.lastHash = lastChained.entryHash!;
      this.lastSequence = lastChained.sequence!;
    }
    this.chainInitialized = true;
  }

  private verifyIntegrity(entries: NeuraCoActivityEntry[]): {
    verified: boolean;
    chainedEntries: number;
    legacyEntries: number;
    invalidEntryIds: string[];
  } {
    const invalidEntryIds: string[] = [];
    let previous: NeuraCoActivityEntry | undefined;
    let chainedEntries = 0;
    let legacyEntries = 0;
    for (const entry of entries) {
      if (!entry.entryHash || !entry.previousHash || !Number.isInteger(entry.sequence)) {
        legacyEntries += 1;
        continue;
      }
      chainedEntries += 1;
      const { entryHash, ...payload } = entry;
      const expected = createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
      const linked = !previous || (
        entry.previousHash === previous.entryHash
        && entry.sequence === Number(previous.sequence) + 1
      );
      if (entryHash !== expected || !linked) invalidEntryIds.push(entry.id);
      previous = entry;
    }
    return {
      verified: invalidEntryIds.length === 0,
      chainedEntries,
      legacyEntries,
      invalidEntryIds
    };
  }
}
