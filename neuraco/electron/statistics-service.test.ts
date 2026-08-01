import { describe, expect, it } from 'vitest';
import type { NeuraCoActivityEntry } from './ipc-contract';
import {
  buildStatistics,
  statisticsToCsv,
  statisticsToPdf
} from './statistics-service';
import type { NeuraCoServerStatistics } from './usage-service';

const server: NeuraCoServerStatistics = {
  generated_at: '2026-07-29T12:00:00.000Z',
  coverage: {
    starts_at: '2026-07-01T10:00:00.000Z',
    ends_at: '2026-07-29T11:00:00.000Z',
    records: 3,
    provider_reported_records: 2,
    estimated_records: 1,
    unknown_metering_records: 0,
    limited_to_recent_entries: false
  },
  totals: {
    _id: null,
    requests: 3,
    credits_consumed: 2.75,
    input_tokens: 1200,
    cached_input_tokens: 300,
    output_tokens: 650,
    duration_ms: 4500
  },
  by_model: [{
    _id: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    requests: 3,
    credits_consumed: 2.75,
    input_tokens: 1200,
    cached_input_tokens: 300,
    output_tokens: 650,
    duration_ms: 4500
  }],
  by_agent: [{
    _id: 'assistant',
    requests: 3,
    credits_consumed: 2.75,
    input_tokens: 1200,
    cached_input_tokens: 300,
    output_tokens: 650,
    duration_ms: 4500
  }],
  by_project: [{
    _id: 'project-1',
    requests: 3,
    credits_consumed: 2.75,
    input_tokens: 1200,
    cached_input_tokens: 300,
    output_tokens: 650,
    duration_ms: 4500
  }],
  daily: [{
    _id: '2026-07-29',
    requests: 3,
    credits_consumed: 2.75,
    input_tokens: 1200,
    cached_input_tokens: 300,
    output_tokens: 650,
    duration_ms: 4500
  }],
  monthly: [{
    _id: '2026-07',
    requests: 3,
    credits_consumed: 2.75,
    input_tokens: 1200,
    cached_input_tokens: 300,
    output_tokens: 650,
    duration_ms: 4500
  }]
};

const events: NeuraCoActivityEntry[] = [
  {
    id: 'event-1',
    timestamp: '2026-07-29T10:00:00.000Z',
    taskId: 'task-1',
    projectId: 'project-1',
    category: 'agent',
    action: 'task_started',
    status: 'started',
    summary: 'Créer une page',
    details: {}
  },
  {
    id: 'event-2',
    timestamp: '2026-07-29T10:02:00.000Z',
    taskId: 'task-1',
    projectId: 'project-1',
    category: 'agent',
    action: 'task_completed',
    status: 'completed',
    summary: 'Page créée',
    details: {
      creditsConsumed: 2.75,
      inputTokens: 1200,
      cachedInputTokens: 300,
      outputTokens: 650,
      durationMs: 4500
    }
  },
  {
    id: 'event-3',
    timestamp: '2026-07-29T11:00:00.000Z',
    taskId: 'task-2',
    projectId: 'project-1',
    category: 'test',
    action: 'tests_failed',
    status: 'failed',
    summary: 'Tests échoués',
    details: { tool: 'Vitest', durationMs: 1000 }
  }
];

describe('statistics service', () => {
  it('combines authoritative server usage with local tasks and tools', () => {
    const summary = buildStatistics(server, events, {
      id: 'project-1',
      name: 'Portail client'
    });

    expect(summary.totals).toEqual({
      creditsConsumed: 2.75,
      inputTokens: 1200,
      cachedInputTokens: 300,
      outputTokens: 650,
      requests: 3,
      executionTimeMs: 4500
    });
    expect(summary.byModel[0]).toMatchObject({
      key: 'anthropic/claude-sonnet-4-5',
      tokenMetricsAvailable: true
    });
    expect(summary.byProject[0].label).toBe('Portail client');
    expect(summary.byTool.map((tool) => tool.label)).toEqual(
      expect.arrayContaining(['Assistant IA', 'Vitest'])
    );
    expect(summary.tasks).toMatchObject({
      successful: 1,
      failed: 1,
      cancelled: 0,
      successRate: 50
    });
    expect(summary.estimatedTimeSaved).toMatchObject({
      isEstimate: true
    });
    expect(summary.notices.join(' ')).toContain('estimées ou inconnues');
  });

  it('exports a spreadsheet-safe CSV and a real multi-object PDF', () => {
    const summary = buildStatistics(server, events);
    const csv = statisticsToCsv(summary);
    expect(csv).toContain('"tokens_entree"');
    expect(csv).toContain('"claude-sonnet-4-5 · anthropic"');
    expect(csv).toContain('"jour"');

    const pdf = statisticsToPdf(summary);
    const document = pdf.toString('binary');
    expect(document.startsWith('%PDF-1.4')).toBe(true);
    expect(document).toContain('/Type /Catalog');
    expect(document).toContain('NEURACO - STATISTIQUES D UTILISATION');
    expect(document.endsWith('%%EOF\n')).toBe(true);
  });
});
