import { describe, expect, it } from 'vitest';
import {
  BROWSER_REFRESH_INTERVALS,
  normalizeBrowserRefreshInterval
} from './browser-refresh';

describe('browser auto-refresh settings', () => {
  it('keeps supported intervals and disables unsupported values', () => {
    expect(normalizeBrowserRefreshInterval(5_000)).toBe(5_000);
    expect(normalizeBrowserRefreshInterval(3_000)).toBe(0);
    expect(BROWSER_REFRESH_INTERVALS[0]).toBe(0);
  });
});
