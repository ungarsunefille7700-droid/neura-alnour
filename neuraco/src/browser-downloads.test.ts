import { describe, expect, it } from 'vitest';
import { browserDownloadProgress, formatBrowserBytes } from './browser-downloads';

describe('browser download presentation', () => {
  it('formats received byte counts without inventing precision', () => {
    expect(formatBrowserBytes(512)).toBe('512 o');
    expect(formatBrowserBytes(1536)).toBe('1.5 Ko');
    expect(formatBrowserBytes(2 * 1024 * 1024)).toBe('2.0 Mo');
  });

  it('computes a bounded progress only when the total is known', () => {
    expect(browserDownloadProgress({ receivedBytes: 25, totalBytes: 100 })).toBe(25);
    expect(browserDownloadProgress({ receivedBytes: 200, totalBytes: 100 })).toBe(100);
    expect(browserDownloadProgress({ receivedBytes: 25, totalBytes: 0 })).toBeNull();
  });
});
