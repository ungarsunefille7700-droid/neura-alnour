import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiRequest } = vi.hoisted(() => ({
  authenticatedApiRequest: vi.fn()
}));

vi.mock('./auth-service', () => ({
  authenticatedApiRequest
}));

import {
  createCreditCheckout,
  estimateUsage,
  getUsage,
  getUsageStatistics,
  updateUsageSettings
} from './usage-service';

describe('usage service', () => {
  beforeEach(() => {
    authenticatedApiRequest.mockReset();
  });

  it('reads the server-authoritative usage summary', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({ server_time: '2026-07-26T00:00:00Z' });
    await getUsage();
    expect(authenticatedApiRequest).toHaveBeenCalledWith('/neuraco/usage');
  });

  it('maps estimation fields without deriving model costs locally', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({ maximum_credits: 4.2 });
    await estimateUsage({
      mode: 'quality',
      model: 'claude-sonnet-4-5',
      promptCharacters: 1200,
      maxOutputTokens: 2048,
      agents: 2,
      imageCount: 0
    });
    expect(authenticatedApiRequest).toHaveBeenCalledWith(
      '/neuraco/usage/estimate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          mode: 'quality',
          model: 'claude-sonnet-4-5',
          prompt_characters: 1200,
          max_output_tokens: 2048,
          agents: 2,
          image_count: 0
        })
      })
    );
  });

  it('falls back to the recent authoritative ledger when statistics are unavailable', async () => {
    authenticatedApiRequest
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({
        server_time: '2026-07-29T12:00:00Z',
        recent: [{
          type: 'consumption',
          status: 'settled',
          task_id: 'task-1',
          project_id: 'project-1',
          agent: 'assistant',
          provider: 'openai',
          model: 'gpt-4o',
          input_tokens: 100,
          cached_input_tokens: 20,
          output_tokens: 50,
          credits_consumed: 0.4,
          duration_ms: 900,
          metering: 'provider_reported',
          created_at: '2026-07-29T11:00:00Z'
        }]
      });

    const statistics = await getUsageStatistics();
    expect(authenticatedApiRequest).toHaveBeenNthCalledWith(
      1,
      '/neuraco/statistics'
    );
    expect(authenticatedApiRequest).toHaveBeenNthCalledWith(
      2,
      '/neuraco/usage'
    );
    expect(statistics.coverage).toMatchObject({
      records: 1,
      provider_reported_records: 1,
      limited_to_recent_entries: true
    });
    expect(statistics.by_model[0]).toMatchObject({
      _id: { provider: 'openai', model: 'gpt-4o' },
      input_tokens: 100
    });
  });

  it('sends explicit spending settings to the backend', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({});
    await updateUsageSettings({
      allowPurchasedCredits: true,
      taskCap: 5,
      dailyCap: 20,
      monthlyCap: 100,
      agentCap: 40,
      maxAgents: 3,
      maxModel: 'gpt-4o',
      autoReloadEnabled: false
    });
    expect(authenticatedApiRequest).toHaveBeenCalledWith(
      '/neuraco/usage/settings',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          allow_purchased_credits: true,
          task_cap: 5,
          daily_cap: 20,
          monthly_cap: 100,
          agent_cap: 40,
          max_agents: 3,
          max_model: 'gpt-4o',
          auto_reload_enabled: false,
          auto_reload_minimum: null,
          auto_reload_target: null,
          auto_reload_max_eur: null,
          auto_reload_monthly_cap_eur: null
        })
      })
    );
  });

  it('accepts only Stripe HTTPS checkout URLs returned by the backend', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({
      url: 'https://checkout.stripe.com/c/pay/cs_test',
      session_id: 'cs_test',
      amount_eur: 20,
      credits: 500,
      one_off: true
    });
    await expect(createCreditCheckout(20)).resolves.toMatchObject({ credits: 500 });

    authenticatedApiRequest.mockResolvedValueOnce({
      url: 'https://stripe.com.attacker.example/checkout',
      session_id: 'bad',
      amount_eur: 20,
      credits: 500,
      one_off: true
    });
    await expect(createCreditCheckout(20)).rejects.toThrow('pas autorisé');
  });

  it('rejects amounts outside the server contract before any request', async () => {
    await expect(createCreditCheckout(4.99)).rejects.toThrow('compris entre');
    expect(authenticatedApiRequest).not.toHaveBeenCalled();
  });
});
