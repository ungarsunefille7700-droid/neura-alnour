// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoAccountDashboard,
  NeuraCoDesktopApi,
  NeuraCoSession
} from '../electron/ipc-contract';
import AccountPanel from './AccountPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: NeuraCoSession = {
  status: 'authenticated',
  persistent: true,
  user: {
    id: 'user-1',
    email: 'member@example.com',
    name: 'Member',
    subscription: 'pro',
    is_vip: false
  },
  entitlement: {
    neuraco_access: true,
    plan: 'pro',
    reason: 'subscription_active'
  }
};

const account: NeuraCoAccountDashboard = {
  profile: {
    ...session.user!,
    email_verified: true,
    two_factor_enabled: false
  },
  usage: null,
  sessions: [
    {
      id: 'current-session',
      device_name: 'NeuraCo Desktop',
      ip_hint: '203.0.113.x',
      last_seen_at: '2026-07-29T12:00:00Z',
      current: true
    },
    {
      id: 'other-session',
      device_name: 'Navigateur Web',
      ip_hint: '198.51.100.x',
      last_seen_at: '2026-07-28T12:00:00Z',
      current: false
    }
  ],
  invoices: [],
  storage: { cloud_files: 2, cloud_bytes: 2048 },
  personal_keys: [],
  connections: { google: false, relay_devices: 1 },
  privacy: {
    analytics_enabled: true,
    product_emails_enabled: false,
    security_emails_enabled: true,
    desktop_notifications_email_enabled: false
  }
};

afterEach(() => {
  document.body.innerHTML = '';
  delete window.neuraco;
});

describe('AccountPanel', () => {
  it('renders server data and remotely revokes other sessions', async () => {
    const getAccount = vi.fn().mockResolvedValue(account);
    const revokeOtherAccountSessions = vi.fn().mockResolvedValue({
      ok: true,
      revoked: 1
    });
    window.neuraco = {
      getAccount,
      listTechnicalErrors: vi.fn().mockResolvedValue([]),
      revokeOtherAccountSessions
    } as unknown as NeuraCoDesktopApi;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AccountPanel
          locale="fr"
          session={session}
          onLogout={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('member@example.com');
    expect(container.textContent).toContain('NeuraCo Desktop');
    expect(container.textContent).toContain('Navigateur Web');
    expect(container.textContent).toContain('2 · 2.0 Ko');
    expect(container.textContent).toContain('Télémétrie technique');
    expect(container.textContent).toContain('Journaux d’erreur locaux');
    expect(container.textContent).toContain('Facturation');
    expect(container.textContent).toContain('Supprimer le compte et les données cloud');
    expect(container.querySelector<HTMLButtonElement>('.account-danger-zone .button-danger')?.disabled)
      .toBe(true);

    const revokeOthers = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent?.includes('Déconnecter les autres'));
    expect(revokeOthers).toBeDefined();

    await act(async () => {
      revokeOthers!.click();
      await Promise.resolve();
    });

    expect(revokeOtherAccountSessions).toHaveBeenCalledTimes(1);
    expect(getAccount).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });
});
