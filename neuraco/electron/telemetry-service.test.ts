import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiRequest } = vi.hoisted(() => ({
  authenticatedApiRequest: vi.fn()
}));

vi.mock('./auth-service', () => ({ authenticatedApiRequest }));

import { durationBucket, sendTechnicalTelemetry } from './telemetry-service';

describe('technical telemetry', () => {
  beforeEach(() => authenticatedApiRequest.mockReset());

  it('uses coarse duration buckets instead of raw timing', () => {
    expect(durationBucket(700)).toBe('lt_1s');
    expect(durationBucket(1800)).toBe('1_3s');
    expect(durationBucket(8000)).toBe('3_10s');
    expect(durationBucket(12_000)).toBe('gt_10s');
  });

  it('sends only the closed technical schema', async () => {
    authenticatedApiRequest.mockResolvedValueOnce({ ok: true, recorded: true });
    await sendTechnicalTelemetry({
      event: 'self_check_completed',
      appVersion: '1.2.3',
      success: true,
      durationMs: 1400
    });
    const [, request] = authenticatedApiRequest.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(Object.keys(body).sort()).toEqual([
      'app_version',
      'architecture',
      'duration_bucket',
      'event',
      'platform',
      'success'
    ]);
    expect(body.duration_bucket).toBe('1_3s');
  });
});
