import { describe, expect, it } from 'vitest';
import {
  buildBrowserDiagnostics,
  parseBrowserConsoleMessage
} from './browser-diagnostics';

const snapshot = {
  viewportWidth: 390,
  viewportHeight: 844,
  documentWidth: 430,
  documentHeight: 1200,
  resourceCount: 12,
  domContentLoadedMs: 125,
  loadMs: 240,
  brokenImages: ['img.hero'],
  overflowElements: ['nav.primary', 'nav.primary'],
  clippedElements: ['button.fixed'],
  smallControls: ['button.icon']
};

describe('browser diagnostics', () => {
  it('combines runtime and actual DOM observations without duplicates', () => {
    const result = buildBrowserDiagnostics('tab-1', 'https://example.com/', snapshot, [{
      source: 'console',
      severity: 'error',
      message: 'Unhandled error'
    }]);

    expect(result.metrics.viewportWidth).toBe(390);
    expect(result.metrics.loadMs).toBe(240);
    expect(result.issues.some((item) => item.source === 'console')).toBe(true);
    expect(result.issues.filter((item) => item.selector === 'nav.primary')).toHaveLength(1);
    expect(result.issues.some((item) => /Débordement horizontal global/.test(item.message)))
      .toBe(true);
  });

  it('supports both modern structured and legacy Electron console events', () => {
    expect(parseBrowserConsoleMessage([{}, { message: 'boom', level: 'error' }]))
      .toEqual({ message: 'boom', level: 'error' });
    expect(parseBrowserConsoleMessage([{}, 2, 'legacy boom', 10, 'app.js']))
      .toEqual({ message: 'legacy boom', level: '2' });
  });
});
