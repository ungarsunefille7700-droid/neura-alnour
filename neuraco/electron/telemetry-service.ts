import { authenticatedApiRequest } from './auth-service';

export type TechnicalTelemetryEvent =
  | 'app_started'
  | 'session_restored'
  | 'password_login'
  | 'google_login'
  | 'self_check_completed'
  | 'update_check_completed'
  | 'update_download_completed';

export interface TechnicalTelemetryInput {
  event: TechnicalTelemetryEvent;
  appVersion: string;
  success: boolean;
  durationMs?: number;
}

export const durationBucket = (
  durationMs: number | undefined
): 'lt_1s' | '1_3s' | '3_10s' | 'gt_10s' | undefined => {
  if (!Number.isFinite(durationMs)) return undefined;
  if (Number(durationMs) < 1000) return 'lt_1s';
  if (Number(durationMs) < 3000) return '1_3s';
  if (Number(durationMs) < 10_000) return '3_10s';
  return 'gt_10s';
};

export const sendTechnicalTelemetry = async (
  input: TechnicalTelemetryInput
): Promise<{ ok: boolean; recorded: boolean; reason?: string }> => {
  const platform = process.platform;
  const architecture = process.arch;
  if (!['win32', 'darwin', 'linux'].includes(platform)) {
    return { ok: true, recorded: false, reason: 'unsupported_platform' };
  }
  if (!['x64', 'arm64', 'ia32'].includes(architecture)) {
    return { ok: true, recorded: false, reason: 'unsupported_architecture' };
  }
  return authenticatedApiRequest('/neuraco/telemetry', {
    method: 'POST',
    body: JSON.stringify({
      event: input.event,
      app_version: String(input.appVersion || '').slice(0, 32),
      platform,
      architecture,
      success: Boolean(input.success),
      duration_bucket: durationBucket(input.durationMs)
    })
  });
};
