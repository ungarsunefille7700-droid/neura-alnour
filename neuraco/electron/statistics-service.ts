import type {
  NeuraCoActivityEntry,
  NeuraCoProject,
  NeuraCoStatisticsMetric,
  NeuraCoStatisticsPeriod,
  NeuraCoStatisticsSummary
} from './ipc-contract';
import type {
  NeuraCoServerStatistics,
  NeuraCoServerStatisticsMetric
} from './usage-service';

const round = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const nonNegative = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const stringValue = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const serverMetric = (
  item: NeuraCoServerStatisticsMetric,
  key: string,
  label: string
): NeuraCoStatisticsMetric => ({
  key,
  label,
  requests: Math.round(nonNegative(item.requests)),
  creditsConsumed: round(nonNegative(item.credits_consumed)),
  inputTokens: Math.round(nonNegative(item.input_tokens)),
  cachedInputTokens: Math.round(nonNegative(item.cached_input_tokens)),
  outputTokens: Math.round(nonNegative(item.output_tokens)),
  durationMs: Math.round(nonNegative(item.duration_ms)),
  source: 'server-ledger',
  tokenMetricsAvailable: true
});

const modelIdentity = (
  item: NeuraCoServerStatisticsMetric
): { key: string; label: string } => {
  const value = item._id;
  if (value && typeof value === 'object') {
    const provider = stringValue(value.provider) || 'unknown';
    const model = stringValue(value.model) || 'unknown';
    return {
      key: `${provider}/${model}`,
      label: `${model} · ${provider}`
    };
  }
  const key = stringValue(value) || 'unknown';
  return { key, label: key };
};

const localTool = (entry: NeuraCoActivityEntry): { key: string; label: string } => {
  const explicit = stringValue(entry.details?.tool)
    || stringValue(entry.details?.application);
  if (explicit) return { key: explicit.toLowerCase(), label: explicit };
  if (entry.action.includes('image_studio')) {
    return { key: 'image-studio', label: 'Studio images' };
  }
  const labels: Record<string, string> = {
    agent: 'Assistant IA',
    browser: 'Navigateur',
    deployment: 'Sites',
    git: 'Git',
    report: 'Rapports',
    studio: 'Studio',
    terminal: 'Terminal',
    test: 'Tests'
  };
  const label = labels[entry.category] || entry.category || 'Système';
  return { key: label.toLowerCase(), label };
};

const aggregateTools = (events: NeuraCoActivityEntry[]): NeuraCoStatisticsMetric[] => {
  const metrics = new Map<string, NeuraCoStatisticsMetric>();
  for (const entry of events) {
    if (entry.status === 'started' || entry.status === 'info') continue;
    const identity = localTool(entry);
    const current = metrics.get(identity.key) || {
      key: identity.key,
      label: identity.label,
      requests: 0,
      creditsConsumed: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      source: 'local-activity' as const,
      tokenMetricsAvailable: false
    };
    const hasTokens = [
      entry.details?.inputTokens,
      entry.details?.cachedInputTokens,
      entry.details?.outputTokens
    ].some((value) => Number.isFinite(Number(value)));
    current.requests += 1;
    current.creditsConsumed += nonNegative(entry.details?.creditsConsumed);
    current.inputTokens += nonNegative(entry.details?.inputTokens);
    current.cachedInputTokens += nonNegative(entry.details?.cachedInputTokens);
    current.outputTokens += nonNegative(entry.details?.outputTokens);
    current.durationMs += nonNegative(
      entry.details?.durationMs ?? entry.evidence?.durationMs
    );
    current.tokenMetricsAvailable = current.tokenMetricsAvailable || hasTokens;
    metrics.set(identity.key, current);
  }
  return [...metrics.values()]
    .map((metric) => ({
      ...metric,
      creditsConsumed: round(metric.creditsConsumed),
      durationMs: Math.round(metric.durationMs)
    }))
    .sort((left, right) => (
      right.creditsConsumed - left.creditsConsumed
      || right.requests - left.requests
    ));
};

const terminalTaskEntry = (entry: NeuraCoActivityEntry): boolean => (
  entry.status === 'failed'
  || entry.status === 'cancelled'
  || entry.status === 'refused'
  || /(?:completed|failed|cancelled|refused)$/.test(entry.action)
);

const aggregateTasks = (events: NeuraCoActivityEntry[]) => {
  const tasks = new Map<string, NeuraCoActivityEntry[]>();
  for (const event of events) {
    if (!event.taskId) continue;
    const current = tasks.get(event.taskId) || [];
    current.push(event);
    tasks.set(event.taskId, current);
  }
  let successful = 0;
  let failed = 0;
  let cancelled = 0;
  let estimatedTimeSavedMs = 0;
  const benchmarkMinutes: Record<string, number> = {
    agent: 30,
    deployment: 15,
    git: 20,
    studio: 20,
    test: 10
  };

  for (const entries of tasks.values()) {
    const ordered = [...entries].sort(
      (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
    );
    const last = [...ordered].reverse().find(terminalTaskEntry);
    if (!last) continue;
    if (last.status === 'completed') successful += 1;
    else if (last.status === 'cancelled') cancelled += 1;
    else failed += 1;
    if (last.status !== 'completed') continue;
    const firstAt = Date.parse(ordered[0].timestamp);
    const lastAt = Date.parse(last.timestamp);
    const measuredMs = nonNegative(
      last.details?.durationMs
      ?? (Number.isFinite(firstAt) && Number.isFinite(lastAt) ? lastAt - firstAt : 0)
    );
    const benchmarkMs = (benchmarkMinutes[last.category] || 8) * 60_000;
    estimatedTimeSavedMs += Math.max(0, benchmarkMs - measuredMs);
  }
  const finished = successful + failed + cancelled;
  return {
    successful,
    failed,
    cancelled,
    successRate: finished ? round(successful / finished * 100, 1) : 0,
    estimatedTimeSavedMs: Math.round(estimatedTimeSavedMs)
  };
};

const projectLabel = (
  key: string,
  activeProject?: Pick<NeuraCoProject, 'id' | 'name'>
): string => {
  if (activeProject?.id === key) return activeProject.name;
  if (key === 'unknown') return 'Projet non renseigné';
  return `Projet ${key.slice(0, 10)}`;
};

const periodMetrics = (
  values: NeuraCoServerStatisticsMetric[],
  source: 'daily' | 'monthly'
): NeuraCoStatisticsPeriod[] => values.map((item) => {
  const period = stringValue(item._id) || 'unknown';
  return {
    ...serverMetric(item, `${source}:${period}`, period),
    period
  };
});

export const buildStatistics = (
  server: NeuraCoServerStatistics,
  events: NeuraCoActivityEntry[],
  activeProject?: Pick<NeuraCoProject, 'id' | 'name'>
): NeuraCoStatisticsSummary => {
  const taskMetrics = aggregateTasks(events);
  const totals = server.totals || {
    requests: 0,
    credits_consumed: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    duration_ms: 0
  };
  const estimatedRecords = Math.round(nonNegative(
    server.coverage?.estimated_records
  ));
  const unknownRecords = Math.round(nonNegative(
    server.coverage?.unknown_metering_records
  ));
  const notices = [
    'Les crédits, tokens, modèles, agents et projets proviennent du registre serveur.',
    'Les outils et résultats de tâches proviennent du journal local de cette installation.',
    'Le temps économisé est une estimation comparative, jamais une mesure certaine.'
  ];
  if (server.coverage?.limited_to_recent_entries) {
    notices.push(
      'Le serveur ne propose pas encore l’agrégation complète : cette vue est '
      + 'limitée aux écritures récentes disponibles.'
    );
  }
  if (estimatedRecords > 0 || unknownRecords > 0) {
    notices.push(
      `${estimatedRecords + unknownRecords} consommation(s) ne disposent pas `
      + 'd’un comptage fournisseur intégral et sont signalées comme estimées ou inconnues.'
    );
  }

  return {
    generatedAt: server.generated_at || new Date().toISOString(),
    coverage: {
      startsAt: server.coverage?.starts_at,
      endsAt: server.coverage?.ends_at,
      serverRecords: Math.round(nonNegative(server.coverage?.records)),
      activityEvents: events.length,
      providerReportedRecords: Math.round(nonNegative(
        server.coverage?.provider_reported_records
      )),
      estimatedRecords,
      unknownMeteringRecords: unknownRecords,
      limitedToRecentEntries: Boolean(
        server.coverage?.limited_to_recent_entries
      )
    },
    totals: {
      creditsConsumed: round(nonNegative(totals.credits_consumed)),
      inputTokens: Math.round(nonNegative(totals.input_tokens)),
      cachedInputTokens: Math.round(nonNegative(totals.cached_input_tokens)),
      outputTokens: Math.round(nonNegative(totals.output_tokens)),
      requests: Math.round(nonNegative(totals.requests)),
      executionTimeMs: Math.round(nonNegative(totals.duration_ms))
    },
    tasks: {
      successful: taskMetrics.successful,
      failed: taskMetrics.failed,
      cancelled: taskMetrics.cancelled,
      successRate: taskMetrics.successRate
    },
    estimatedTimeSaved: {
      milliseconds: taskMetrics.estimatedTimeSavedMs,
      isEstimate: true,
      methodology:
        'Estimation locale : durée de chaque tâche réussie comparée à un repère '
        + 'conservateur de 8 à 30 minutes selon sa catégorie.'
    },
    byModel: (server.by_model || []).map((item) => {
      const identity = modelIdentity(item);
      return serverMetric(item, identity.key, identity.label);
    }),
    byAgent: (server.by_agent || []).map((item) => {
      const key = stringValue(item._id) || 'assistant';
      return serverMetric(item, key, key);
    }),
    byTool: aggregateTools(events),
    byProject: (server.by_project || []).map((item) => {
      const key = stringValue(item._id) || 'unknown';
      return serverMetric(item, key, projectLabel(key, activeProject));
    }),
    daily: periodMetrics(server.daily || [], 'daily'),
    monthly: periodMetrics(server.monthly || [], 'monthly'),
    notices
  };
};

const csvCell = (value: unknown): string => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

const metricCsvRows = (
  section: string,
  metrics: NeuraCoStatisticsMetric[]
): string[] => metrics.map((metric) => [
  section,
  metric.label,
  metric.requests,
  metric.creditsConsumed,
  metric.inputTokens,
  metric.cachedInputTokens,
  metric.outputTokens,
  metric.durationMs,
  metric.source,
  metric.tokenMetricsAvailable ? 'oui' : 'non'
].map(csvCell).join(';'));

export const statisticsToCsv = (summary: NeuraCoStatisticsSummary): string => {
  const header = [
    'section',
    'libelle',
    'requetes',
    'credits_consommes',
    'tokens_entree',
    'tokens_cache',
    'tokens_sortie',
    'duree_ms',
    'source',
    'tokens_disponibles'
  ].map(csvCell).join(';');
  const totals = [
    'total',
    'Toutes consommations',
    summary.totals.requests,
    summary.totals.creditsConsumed,
    summary.totals.inputTokens,
    summary.totals.cachedInputTokens,
    summary.totals.outputTokens,
    summary.totals.executionTimeMs,
    'server-ledger',
    'oui'
  ].map(csvCell).join(';');
  return [
    '\uFEFF' + header,
    totals,
    ...metricCsvRows('modele', summary.byModel),
    ...metricCsvRows('agent', summary.byAgent),
    ...metricCsvRows('outil', summary.byTool),
    ...metricCsvRows('projet', summary.byProject),
    ...metricCsvRows('jour', summary.daily),
    ...metricCsvRows('mois', summary.monthly)
  ].join('\r\n');
};

const pdfAscii = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\x20-\x7E]/g, '?')
  .replace(/[\\()]/g, (character) => `\\${character}`);

const wrapPdfLine = (value: string, maxLength = 92): string[] => {
  const words = pdfAscii(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word.slice(0, maxLength);
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
};

const formatDuration = (milliseconds: number): string => {
  const seconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return `${hours} h ${minutes} min ${remaining} s`;
};

const metricPdfLines = (
  title: string,
  metrics: NeuraCoStatisticsMetric[]
): string[] => [
  '',
  title,
  ...(metrics.length
    ? metrics.map((metric) => (
      `- ${metric.label}: ${metric.requests} requete(s), `
      + `${metric.creditsConsumed} credit(s), `
      + `${metric.inputTokens}/${metric.cachedInputTokens}/${metric.outputTokens} tokens E/C/S`
    ))
    : ['- Aucune donnee'])
];

export const statisticsToPdf = (summary: NeuraCoStatisticsSummary): Buffer => {
  const lines = [
    'NEURACO - STATISTIQUES D UTILISATION',
    `Genere le: ${summary.generatedAt}`,
    `Couverture serveur: ${summary.coverage.serverRecords} consommation(s)`,
    '',
    'TOTAUX',
    `Credits consommes: ${summary.totals.creditsConsumed}`,
    `Tokens entree: ${summary.totals.inputTokens}`,
    `Tokens mis en cache: ${summary.totals.cachedInputTokens}`,
    `Tokens sortie: ${summary.totals.outputTokens}`,
    `Temps execution IA cumule: ${formatDuration(summary.totals.executionTimeMs)}`,
    `Taches reussies/echecs/annulees: ${summary.tasks.successful}/${summary.tasks.failed}/${summary.tasks.cancelled}`,
    `Taux de reussite: ${summary.tasks.successRate}%`,
    `Temps economise estime: ${formatDuration(summary.estimatedTimeSaved.milliseconds)}`,
    `ESTIMATION: ${summary.estimatedTimeSaved.methodology}`,
    ...metricPdfLines('PAR MODELE', summary.byModel),
    ...metricPdfLines('PAR AGENT', summary.byAgent),
    ...metricPdfLines('PAR OUTIL', summary.byTool),
    ...metricPdfLines('PAR PROJET', summary.byProject),
    ...metricPdfLines('PAR JOUR', summary.daily),
    ...metricPdfLines('PAR MOIS', summary.monthly),
    '',
    'NOTES',
    ...summary.notices.map((notice) => `- ${notice}`)
  ].flatMap((line) => wrapPdfLine(line));
  const pageLines = 48;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageLines) {
    pages.push(lines.slice(index, index + pageLines));
  }
  if (!pages.length) pages.push(['Aucune donnee.']);

  const objects: string[] = ['', '', '', ''];
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (const page of pages) {
    const pageId = objects.length;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    contentIds.push(contentId);
    objects.push('');
    const stream = [
      'BT',
      '/F1 10 Tf',
      '48 798 Td',
      '14 TL',
      ...page.map((line) => `(${pdfAscii(line)}) Tj T*`),
      'ET'
    ].join('\n');
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pageIds.forEach((pageId, index) => {
    objects[pageId] = [
      '<< /Type /Page /Parent 2 0 R',
      '/MediaBox [0 0 595 842]',
      '/Resources << /Font << /F1 3 0 R >> >>',
      `/Contents ${contentIds[index]} 0 R >>`
    ].join(' ');
  });

  let output = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output, 'binary');
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, 'binary');
  output += `xref\n0 ${objects.length}\n`;
  output += '0000000000 65535 f \n';
  for (let id = 1; id < objects.length; id += 1) {
    output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n`;
  output += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'binary');
};
