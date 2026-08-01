// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoAdminConfig,
  NeuraCoAdminState,
  NeuraCoDesktopApi
} from '../electron/ipc-contract';
import AdminPanel from './AdminPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: NeuraCoAdminConfig = {
  revision: 4,
  version: '2026-08-01',
  plans: {
    pro: {
      id: 'plus',
      label: 'Plus',
      multiplier: 1,
      five_hour: 50,
      seven_day: 125,
      monthly: 250,
      finalization: 25
    }
  },
  models: {
    'gpt-4o': {
      provider: 'openai',
      input: 2.5,
      cached_input: 1.25,
      output: 10,
      disabled: false
    }
  },
  billing: {
    credits_per_usd: 25,
    margin_percent: 0,
    infrastructure_per_request_usd: 0,
    compute_per_second_usd: 0,
    storage_per_mb_usd: 0,
    browser_call_usd: 0,
    computer_call_usd: 0,
    additional_agent_usd: 0,
    remote_task_usd: 0,
    priority_multipliers: { standard: 1, high: 1.15, maximum: 1.35 }
  },
  providers: {
    openai: { enabled: true },
    anthropic: { enabled: true },
    gemini: { enabled: true },
    openrouter: { enabled: true }
  },
  tools: { browser: 1 },
  plugins: { allow_unsigned_local: false, blocked_ids: [] },
  maintenance: { enabled: false, message: 'Maintenance planifiee.' },
  release: {
    latest_version: '0.1.0',
    minimum_supported_version: '0.1.0',
    rollout_percent: 100
  }
};

const state: NeuraCoAdminState = {
  role: 'founder',
  config,
  counts: { users: 18, active_incidents: 1, active_promotions: 2 }
};

describe('AdminPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: Partial<NeuraCoDesktopApi>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    api = {
      getAdminState: vi.fn().mockResolvedValue(state),
      updateAdminConfig: vi.fn().mockImplementation(async (request) => ({
        ok: true,
        config: { ...config, ...request, revision: 5 }
      })),
      listAdminIncidents: vi.fn().mockResolvedValue([]),
      listAdminPromotions: vi.fn().mockResolvedValue([]),
      getAdminPricingHistory: vi.fn().mockResolvedValue([]),
      listAdminLogs: vi.fn().mockResolvedValue([]),
      listAdminUsers: vi.fn().mockResolvedValue([]),
      createAdminIncident: vi.fn(),
      updateAdminIncident: vi.fn(),
      createAdminPromotion: vi.fn(),
      updateAdminPromotion: vi.fn(),
      adjustAdminCredits: vi.fn(),
      recordAdminRefund: vi.fn()
    };
    window.neuraco = api as NeuraCoDesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.neuraco;
  });

  it('loads server-authoritative state and saves a revisioned maintenance change', async () => {
    await act(async () => {
      root.render(<AdminPanel />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.getAdminState).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('18 utilisateurs');
    expect(container.textContent).toContain('1 incidents actifs');
    expect(container.textContent).toContain('gpt-4o');

    const maintenance = Array.from(container.querySelectorAll('label')).find(
      (label) => label.textContent?.includes('Maintenance')
    )?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const reason = Array.from(container.querySelectorAll('label')).find(
      (label) => label.textContent?.includes('Raison obligatoire')
    )?.querySelector<HTMLInputElement>('input');
    expect(maintenance).toBeDefined();
    expect(reason).toBeDefined();

    await act(async () => {
      maintenance!.click();
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      valueSetter?.call(reason, 'Incident fournisseur confirme');
      reason!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Enregistrer la configuration')
    );
    expect(save?.disabled).toBe(false);

    await act(async () => {
      save!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.updateAdminConfig).toHaveBeenCalledWith(expect.objectContaining({
      expected_revision: 4,
      reason: 'Incident fournisseur confirme',
      maintenance: expect.objectContaining({ enabled: true })
    }));
    expect(container.textContent).toContain('révision 5');
  });
});
