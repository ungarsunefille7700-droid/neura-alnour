import fs from 'fs';
import path from 'path';

import { createChatRequestId, formatQuotaReset } from '../utils/chatQuota';

const readPage = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');

describe('free plan quota wording', () => {
  test('shows the two requested quota labels without an unlimited text claim', () => {
    const subscription = readPage('SubscriptionPage.js');
    const landing = readPage('LandingPage.js');
    expect(subscription).toContain('Messages IA avec quota');
    expect(subscription).toContain('Captures d’écran limitées');
    expect(landing).toContain('Messages IA avec quota');
    expect(landing).toContain('Captures d’écran limitées');
    expect(subscription).not.toContain('Messages texte illimités');
    expect(landing).not.toContain('Messages illimités');
  });

  test('keeps the paid cards and their prices present', () => {
    const subscription = readPage('SubscriptionPage.js');
    ['Comme Toi', 'Mongo', 'Pro', 'Développeur', 'Neura+', 'Neura Ultra'].forEach((name) => {
      expect(subscription).toContain(`name: '${name}'`);
    });
    ['4.99', '8.99', '14.99', '19.99', '119.99', '299.99'].forEach((price) => {
      expect(subscription).toContain(price);
    });
  });
});

describe('quota client helpers', () => {
  test('creates distinct idempotency identifiers', () => {
    expect(createChatRequestId()).not.toBe(createChatRequestId());
  });

  test('formats a server UTC reset and rejects invalid values', () => {
    expect(typeof formatQuotaReset('2026-07-21T18:00:00Z')).toBe('string');
    expect(formatQuotaReset('invalid')).toBeNull();
  });
});
