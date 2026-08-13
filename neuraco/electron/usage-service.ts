import { authenticatedApiRequest } from './auth-service';
import type {
  NeuraCoCreditCheckout,
  NeuraCoUsageEstimate,
  NeuraCoUsageEstimateRequest,
  NeuraCoUsageSettingsUpdate,
  NeuraCoUsageSummary
} from './ipc-contract';
import { isNeuraCoAgentModel } from './model-utils';

export interface NeuraCoServerStatisticsMetric {
  _id?: string | {
    provider?: string;
    model?: string;
  } | null;
  requests: number;
  credits_consumed: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  first_at?: string;
  last_at?: string;
}

export interface NeuraCoServerStatistics {
  generated_at: string;
  coverage: {
    starts_at?: string;
    ends_at?: string;
    records: number;
    provider_reported_records: number;
    estimated_records: number;
    unknown_metering_records: number;
    limited_to_recent_entries: boolean;
  };
  totals: NeuraCoServerStatisticsMetric;
  by_model: NeuraCoServerStatisticsMetric[];
  by_agent: NeuraCoServerStatisticsMetric[];
  by_project: NeuraCoServerStatisticsMetric[];
  daily: NeuraCoServerStatisticsMetric[];
  monthly: NeuraCoServerStatisticsMetric[];
}

const finite = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

export const getUsage = (): Promise<NeuraCoUsageSummary> => (
  authenticatedApiRequest<NeuraCoUsageSummary>('/neuraco/usage')
);

const recentStatistics = (
  summary: NeuraCoUsageSummary
): NeuraCoServerStatistics => {
  const entries = summary.recent.filter(
    (entry) => entry.type === 'consumption' && entry.status === 'settled'
  );
  const emptyMetric = (): NeuraCoServerStatisticsMetric => ({
    requests: 0,
    credits_consumed: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    duration_ms: 0
  });
  const add = (
    metric: NeuraCoServerStatisticsMetric,
    entry: NeuraCoUsageSummary['recent'][number]
  ) => {
    metric.requests += 1;
    metric.credits_consumed += finite(entry.credits_consumed, 0);
    metric.input_tokens += finite(entry.input_tokens, 0);
    metric.cached_input_tokens += finite(entry.cached_input_tokens, 0);
    metric.output_tokens += finite(entry.output_tokens, 0);
    metric.duration_ms += finite(entry.duration_ms, 0);
    metric.first_at = !metric.first_at || entry.created_at < metric.first_at
      ? entry.created_at
      : metric.first_at;
    metric.last_at = !metric.last_at || entry.created_at > metric.last_at
      ? entry.created_at
      : metric.last_at;
  };
  const group = (
    keyFor: (entry: NeuraCoUsageSummary['recent'][number]) => string
  ): NeuraCoServerStatisticsMetric[] => {
    const metrics = new Map<string, NeuraCoServerStatisticsMetric>();
    for (const entry of entries) {
      const key = keyFor(entry);
      const metric = metrics.get(key) || { ...emptyMetric(), _id: key };
      add(metric, entry);
      metrics.set(key, metric);
    }
    return [...metrics.values()].sort(
      (left, right) => right.credits_consumed - left.credits_consumed
    );
  };
  const byModel = new Map<string, NeuraCoServerStatisticsMetric>();
  for (const entry of entries) {
    const provider = entry.provider || 'unknown';
    const model = entry.model || 'unknown';
    const key = `${provider}/${model}`;
    const metric = byModel.get(key) || {
      ...emptyMetric(),
      _id: { provider, model }
    };
    add(metric, entry);
    byModel.set(key, metric);
  }
  const totals = emptyMetric();
  for (const entry of entries) add(totals, entry);
  const metering = entries.reduce((counts, entry) => {
    const key = entry.metering === 'provider_reported'
      ? 'reported'
      : entry.metering === 'estimated_fallback'
        ? 'estimated'
        : 'unknown';
    counts[key] += 1;
    return counts;
  }, { reported: 0, estimated: 0, unknown: 0 });
  return {
    generated_at: summary.server_time,
    coverage: {
      starts_at: totals.first_at,
      ends_at: totals.last_at,
      records: entries.length,
      provider_reported_records: metering.reported,
      estimated_records: metering.estimated,
      unknown_metering_records: metering.unknown,
      limited_to_recent_entries: true
    },
    totals,
    by_model: [...byModel.values()],
    by_agent: group((entry) => entry.agent || 'assistant'),
    by_project: group((entry) => entry.project_id || 'unknown'),
    daily: group((entry) => entry.created_at.slice(0, 10))
      .sort((left, right) => String(left._id).localeCompare(String(right._id))),
    monthly: group((entry) => entry.created_at.slice(0, 7))
      .sort((left, right) => String(left._id).localeCompare(String(right._id)))
  };
};

export const getUsageStatistics = async (): Promise<NeuraCoServerStatistics> => {
  try {
    return await authenticatedApiRequest<NeuraCoServerStatistics>(
      '/neuraco/statistics'
    );
  } catch {
    return recentStatistics(await getUsage());
  }
};

export const estimateUsage = (
  request: NeuraCoUsageEstimateRequest
): Promise<NeuraCoUsageEstimate> => {
  if (
    !request
    || !['economic', 'balanced', 'quality', 'custom'].includes(request.mode)
    || !isNeuraCoAgentModel(request.model, false)
  ) {
    throw new Error('Estimation NeuraCo invalide.');
  }
  return authenticatedApiRequest<NeuraCoUsageEstimate>('/neuraco/usage/estimate', {
    method: 'POST',
    body: JSON.stringify({
      mode: request.mode,
      model: request.model,
      prompt_characters: Math.round(finite(request.promptCharacters, 2000)),
      max_output_tokens: Math.round(finite(request.maxOutputTokens, 4096)),
      agents: Math.round(finite(request.agents, 1)),
      image_count: Math.round(finite(request.imageCount, 0))
    })
  });
};

export const updateUsageSettings = (
  request: NeuraCoUsageSettingsUpdate
): Promise<NeuraCoUsageSummary> => (
  authenticatedApiRequest<NeuraCoUsageSummary>('/neuraco/usage/settings', {
    method: 'PUT',
    body: JSON.stringify({
      allow_purchased_credits: request.allowPurchasedCredits === true,
      task_cap: request.taskCap ?? null,
      daily_cap: request.dailyCap ?? null,
      monthly_cap: request.monthlyCap ?? null,
      agent_cap: request.agentCap ?? null,
      max_agents: request.maxAgents ?? null,
      max_model: request.maxModel ?? null,
      auto_reload_enabled: request.autoReloadEnabled === true,
      auto_reload_minimum: request.autoReloadMinimum ?? null,
      auto_reload_target: request.autoReloadTarget ?? null,
      auto_reload_max_eur: request.autoReloadMaxEur ?? null,
      auto_reload_monthly_cap_eur: request.autoReloadMonthlyCapEur ?? null
    })
  })
);

export const createCreditCheckout = async (
  amountEur: number
): Promise<NeuraCoCreditCheckout> => {
  if (!Number.isFinite(amountEur) || amountEur < 5 || amountEur > 200) {
    throw new Error('Le montant doit être compris entre 5 € et 200 €.');
  }
  const checkout = await authenticatedApiRequest<NeuraCoCreditCheckout>(
    '/neuraco/credits/checkout',
    {
      method: 'POST',
      body: JSON.stringify({ amount_eur: Math.round(amountEur * 100) / 100 })
    }
  );
  const target = new URL(checkout.url);
  if (
    target.protocol !== 'https:'
    || !/(^|\.)stripe\.com$/i.test(target.hostname)
  ) {
    throw new Error('Le serveur de paiement retourné n’est pas autorisé.');
  }
  return checkout;
};
