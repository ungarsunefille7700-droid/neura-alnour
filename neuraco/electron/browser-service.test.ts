import { describe, expect, it } from 'vitest';
import {
  isSensitiveBrowserAction,
  validateBrowserUrl
} from './browser-service';

describe('NeuraCo isolated browser security', () => {
  it('accepts explicit web addresses and normalizes bare domains', () => {
    expect(validateBrowserUrl('example.com').toString()).toBe('https://example.com/');
    expect(validateBrowserUrl('http://localhost:5173/app').toString())
      .toBe('http://localhost:5173/app');
    expect(validateBrowserUrl('about:blank').toString()).toBe('about:blank');
  });

  it('blocks privileged protocols and credentials embedded in addresses', () => {
    expect(() => validateBrowserUrl('file:///C:/secret.txt')).toThrow(/protocole/i);
    expect(() => validateBrowserUrl('javascript:alert(1)')).toThrow(/protocole/i);
    expect(() => validateBrowserUrl('about:config')).toThrow(/about:blank/i);
    expect(() => validateBrowserUrl('https://user:password@example.com'))
      .toThrow(/identifiants/i);
  });

  it('blocks payment, password, publication and destructive actions', () => {
    expect(isSensitiveBrowserAction(
      'https://shop.example/checkout',
      { type: 'click', selector: '#confirm' }
    )).toBe(true);
    expect(isSensitiveBrowserAction(
      'https://example.com',
      { type: 'type', selector: 'input[type=password]', text: 'secret' }
    )).toBe(true);
    expect(isSensitiveBrowserAction(
      'https://example.com/editor',
      { type: 'click', selector: '#publish' },
      'Publier maintenant'
    )).toBe(true);
    expect(isSensitiveBrowserAction(
      'https://example.com/docs',
      { type: 'click', selector: '#next' },
      'Page suivante'
    )).toBe(false);
  });
});
