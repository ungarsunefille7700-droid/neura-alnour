import {
  authenticatedApiRequest,
  publicApiRequest
} from './auth-service';
import type {
  NeuraCoAccountDeletionRequest,
  NeuraCoAccountDeletionResult,
  NeuraCoAccountActionResult,
  NeuraCoAccountDashboard,
  NeuraCoNotification,
  NeuraCoPrivacySettings,
  NeuraCoTwoFactorEnableResult,
  NeuraCoTwoFactorSetup
} from './ipc-contract';

const json = (value: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(value)
});

export const getAccount = (): Promise<NeuraCoAccountDashboard> => (
  authenticatedApiRequest('/auth/account')
);

export const revokeAccountSession = (
  sessionId: string
): Promise<{ ok: boolean; current: boolean }> => (
  authenticatedApiRequest(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  })
);

export const revokeOtherAccountSessions = (): Promise<{
  ok: boolean;
  revoked: number;
}> => authenticatedApiRequest('/auth/sessions/revoke-others', {
  method: 'POST'
});

export const requestEmailVerification = (): Promise<NeuraCoAccountActionResult> => (
  authenticatedApiRequest('/auth/email-verification/request', { method: 'POST' })
);

export const confirmEmailVerification = (
  token: string
): Promise<NeuraCoAccountActionResult> => (
  authenticatedApiRequest('/auth/email-verification/confirm', json({ token }))
);

export const requestPasswordReset = (
  email: string
): Promise<NeuraCoAccountActionResult> => (
  publicApiRequest('/auth/password-reset/request', json({ email }))
);

export const confirmPasswordReset = (
  email: string,
  token: string,
  newPassword: string
): Promise<NeuraCoAccountActionResult> => (
  publicApiRequest('/auth/password-reset/confirm', json({
    email,
    token,
    new_password: newPassword
  }))
);

export const setupTwoFactor = (): Promise<NeuraCoTwoFactorSetup> => (
  authenticatedApiRequest('/auth/2fa/setup', { method: 'POST' })
);

export const enableTwoFactor = (
  code: string
): Promise<NeuraCoTwoFactorEnableResult> => (
  authenticatedApiRequest('/auth/2fa/enable', json({ code }))
);

export const disableTwoFactor = (
  code: string
): Promise<NeuraCoAccountActionResult> => (
  authenticatedApiRequest('/auth/2fa/disable', json({ code }))
);

export const updatePrivacySettings = (
  settings: NeuraCoPrivacySettings
): Promise<NeuraCoPrivacySettings> => (
  authenticatedApiRequest('/auth/privacy', {
    method: 'PUT',
    body: JSON.stringify(settings)
  })
);

export const deleteAccount = (
  request: NeuraCoAccountDeletionRequest
): Promise<NeuraCoAccountDeletionResult> => (
  authenticatedApiRequest('/auth/account/delete', json({
    confirmation_email: request.confirmationEmail.trim().toLowerCase(),
    password: request.password || undefined,
    two_factor_code: request.twoFactorCode?.trim() || undefined
  }))
);

export const sendOptionalNotificationEmail = (
  notification: NeuraCoNotification
): Promise<{ ok: boolean; sent: boolean; reason?: string }> => (
  authenticatedApiRequest('/neuraco/notifications/email', json({
    kind: notification.kind,
    severity: notification.severity,
    title: notification.title,
    body: notification.body,
    sensitive: notification.sensitive
  }))
);
