import { describe, expect, it } from 'vitest';
import { validateUpdateManifest } from './update-service';

const baseManifest = {
  available: true,
  current_version: '0.1.0',
  latest_version: '0.2.0',
  download_url: 'https://neura-alnour-backend.onrender.com/api/neuraco/download/ticket',
  checksum_sha256: 'a'.repeat(64),
  size: 42_000_000,
  signature_required: true,
  checked_at: '2026-07-26T00:00:00.000Z'
};

describe('validateUpdateManifest', () => {
  it('accepts a versioned HTTPS manifest requiring a signature', () => {
    expect(validateUpdateManifest({ ...baseManifest, channel: 'stable' }, '0.1.0')).toMatchObject({
      latest_version: '0.2.0',
      signature_required: true
    });
  });

  it('never crosses the selected stable or beta channel', () => {
    expect(() => validateUpdateManifest({
      ...baseManifest,
      channel: 'beta' as const
    }, '0.1.0', 'stable')).toThrow('canal');
    expect(validateUpdateManifest({
      ...baseManifest,
      channel: 'beta' as const
    }, '0.1.0', 'beta').channel).toBe('beta');
  });

  it('blocks unsigned, malformed or non-HTTPS installers', () => {
    expect(() => validateUpdateManifest({
      ...baseManifest,
      signature_required: false
    }, '0.1.0')).toThrow('sécurité');
    expect(() => validateUpdateManifest({
      ...baseManifest,
      download_url: 'http://example.com/update.exe'
    }, '0.1.0')).toThrow('sécurité');
    expect(() => validateUpdateManifest({
      ...baseManifest,
      checksum_sha256: 'invalid'
    }, '0.1.0')).toThrow('sécurité');
    expect(() => validateUpdateManifest({
      ...baseManifest,
      latest_version: '0.1.0'
    }, '0.1.0')).toThrow('plus récente');
    expect(() => validateUpdateManifest({
      ...baseManifest,
      latest_version: '0.0.9'
    }, '0.1.0')).toThrow('plus récente');
  });

  it('accepts a no-update response without a download URL', () => {
    expect(validateUpdateManifest({
      available: false,
      current_version: '0.1.0',
      latest_version: '0.1.0',
      checked_at: '2026-07-26T00:00:00.000Z'
    }, '0.1.0').available).toBe(false);
  });
});
