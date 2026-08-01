import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoDesktopApi,
  NeuraCoStatisticsSummary
} from '../electron/ipc-contract';
import StatisticsPanel from './StatisticsPanel';

const metric = {
  requests: 2,
  creditsConsumed: 1.5,
  inputTokens: 800,
  cachedInputTokens: 120,
  outputTokens: 300,
  durationMs: 2500,
  source: 'server-ledger' as const,
  tokenMetricsAvailable: true
};

const summary: NeuraCoStatisticsSummary = {
  generatedAt: '2026-07-29T12:00:00.000Z',
  coverage: {
    startsAt: '2026-07-01T10:00:00.000Z',
    endsAt: '2026-07-29T11:00:00.000Z',
    serverRecords: 2,
    activityEvents: 8,
    providerReportedRecords: 2,
    estimatedRecords: 0,
    unknownMeteringRecords: 0,
    limitedToRecentEntries: false
  },
  totals: {
    creditsConsumed: 1.5,
    inputTokens: 800,
    cachedInputTokens: 120,
    outputTokens: 300,
    requests: 2,
    executionTimeMs: 2500
  },
  tasks: {
    successful: 3,
    failed: 1,
    cancelled: 0,
    successRate: 75
  },
  estimatedTimeSaved: {
    milliseconds: 600000,
    isEstimate: true,
    methodology: 'Estimation locale documentée.'
  },
  byModel: [{ key: 'anthropic/claude', label: 'claude · anthropic', ...metric }],
  byAgent: [{ key: 'assistant', label: 'assistant', ...metric }],
  byTool: [{
    key: 'vitest',
    label: 'Vitest',
    ...metric,
    source: 'local-activity',
    tokenMetricsAvailable: false
  }],
  byProject: [{ key: 'project-1', label: 'Portail client', ...metric }],
  daily: [{
    key: 'daily:2026-07-29',
    label: '2026-07-29',
    period: '2026-07-29',
    ...metric
  }],
  monthly: [{
    key: 'monthly:2026-07',
    label: '2026-07',
    period: '2026-07',
    ...metric
  }],
  notices: [
    'Les crédits et tokens proviennent du registre serveur.',
    'Le temps économisé est une estimation.'
  ]
};

describe('StatisticsPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: Partial<NeuraCoDesktopApi>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    api = {
      getStatistics: vi.fn().mockResolvedValue(summary),
      exportStatisticsCsv: vi.fn().mockResolvedValue('C:\\exports\\stats.csv'),
      exportStatisticsPdf: vi.fn().mockResolvedValue('C:\\exports\\stats.pdf')
    };
    window.neuraco = api as NeuraCoDesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.neuraco;
  });

  it('renders server metrics, local outcomes and live period selection', async () => {
    await act(async () => {
      root.render(<StatisticsPanel onStatus={vi.fn()} />);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.getStatistics).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Crédits consommés');
    expect(container.textContent).toContain('Tokens mis en cache');
    expect(container.textContent).toContain('Portail client');
    expect(container.textContent).toContain('Temps économisé estimé');
    expect(container.textContent).toContain('2026-07-29');

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('12 mois')
      )?.click();
    });
    expect(container.textContent).toContain('2026-07');
  });

  it('uses the desktop save flows for CSV and PDF exports', async () => {
    const onStatus = vi.fn();
    await act(async () => {
      root.render(<StatisticsPanel onStatus={onStatus} />);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('CSV')
      )?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.exportStatisticsCsv).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('stats.csv'));

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('PDF')
      )?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.exportStatisticsPdf).toHaveBeenCalledOnce();
  });
});
