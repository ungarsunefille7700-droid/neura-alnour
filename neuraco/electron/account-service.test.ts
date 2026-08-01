import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiRequest, publicApiRequest } = vi.hoisted(() => ({
  authenticatedApiRequest: vi.fn(),
  publicApiRequest: vi.fn()
}));

vi.mock('./auth-service', () => ({
  authenticatedApiRequest,
  publicApiRequest
}));

import {
  confirmPasswordReset,
  deleteAccount,
  getAccount,
  revokeAccountSession,
  sendOptionalNotificationEmail,
  setupTwoFactor,
  updatePrivacySettings
} from './account-service';

describe('account service', () => {
  beforeEach(() => {
    authenticatedApiRequest.mockReset();
    publicApiRequest.mockReset();
  });

  it('loads the server-authoritative account dashboard', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({ profile: { id: 'user-1' } });
    await getAccount();
    expect(authenticatedApiRequest).toHaveBeenCalledWith('/auth/account');
  });

  it('revokes only the selected server session', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({ ok: true, current: false });
    await revokeAccountSession('session 1');
    expect(authenticatedApiRequest).toHaveBeenCalledWith(
      '/auth/sessions/session%201',
      { method: 'DELETE' }
    );
  });

  it('never sends a password reset through an authenticated-only transport', async () => {
    publicApiRequest.mockResolvedValueOnce({ ok: true });
    await confirmPasswordReset('member@example.com', 'one-use-token', 'new-password');
    expect(publicApiRequest).toHaveBeenCalledWith(
      '/auth/password-reset/confirm',
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'member@example.com',
          token: 'one-use-token',
          new_password: 'new-password'
        })
      }
    );
  });

  it('gets 2FA setup material only from the authenticated server route', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({ secret: 'secret' });
    await setupTwoFactor();
    expect(authenticatedApiRequest).toHaveBeenCalledWith(
      '/auth/2fa/setup',
      { method: 'POST' }
    );
  });

  it('persists explicit privacy settings without deriving defaults locally', async () => {
    const settings = {
      analytics_enabled: false,
      product_emails_enabled: false,
      security_emails_enabled: true,
      desktop_notifications_email_enabled: false
    };
    authenticatedApiRequest.mockResolvedValueOnce(settings);
    await updatePrivacySettings(settings);
    expect(authenticatedApiRequest).toHaveBeenCalledWith('/auth/privacy', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  });

  it('maps the explicit account deletion confirmation to the protected route', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({ ok: true, account_deleted: true });
    await deleteAccount({
      confirmationEmail: ' Member@Example.com ',
      password: 'current-password',
      twoFactorCode: '123456'
    });
    expect(authenticatedApiRequest).toHaveBeenCalledWith('/auth/account/delete', {
      method: 'POST',
      body: JSON.stringify({
        confirmation_email: 'member@example.com',
        password: 'current-password',
        two_factor_code: '123456'
      })
    });
  });

  it('forwards only the sanitized notification contract to the optional email route', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({ ok: true, sent: false });
    await sendOptionalNotificationEmail({
      id: 'notification-1',
      projectId: 'project-1',
      projectName: 'Project',
      kind: 'plugin_suspicious',
      severity: 'critical',
      title: 'Plugin à vérifier',
      body: 'Extension non signée',
      target: 'protection',
      actions: ['open'],
      sensitive: true,
      createdAt: '2026-07-29T12:00:00Z'
    });
    expect(authenticatedApiRequest).toHaveBeenCalledWith(
      '/neuraco/notifications/email',
      {
        method: 'POST',
        body: JSON.stringify({
          kind: 'plugin_suspicious',
          severity: 'critical',
          title: 'Plugin à vérifier',
          body: 'Extension non signée',
          sensitive: true
        })
      }
    );
  });
});
