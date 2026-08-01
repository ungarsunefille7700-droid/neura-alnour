import { describe, expect, it } from 'vitest';
import { parseWindowsHelloAvailability } from './windows-hello';

describe('Windows Hello result parsing', () => {
  it('maps real Windows availability values without inventing support', () => {
    expect(parseWindowsHelloAvailability('Available')).toBe('available');
    expect(parseWindowsHelloAvailability('NotConfiguredForUser')).toBe('not_configured');
    expect(parseWindowsHelloAvailability('DisabledByPolicy')).toBe('disabled_by_policy');
    expect(parseWindowsHelloAvailability('DeviceNotPresent')).toBe('not_supported');
    expect(parseWindowsHelloAvailability('DeviceBusy')).toBe('busy');
    expect(parseWindowsHelloAvailability('unexpected')).toBe('unknown');
  });
});
