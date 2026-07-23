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

  test('removes Comme Toi while keeping every other paid card and price', () => {
    const subscription = readPage('SubscriptionPage.js');
    const landing = readPage('LandingPage.js');
    expect(subscription).not.toContain("id: 'comme_toi'");
    expect(subscription).not.toContain("name: 'Comme Toi'");
    expect(subscription).not.toContain('price: { monthly: 4.99');
    expect(landing).not.toContain('name: "Comme Toi"');
    expect(landing).not.toContain('price: "4,99€"');
    ['Mongo', 'Pro', 'Développeur', 'Neura+', 'Neura Ultra'].forEach((name) => {
      expect(subscription).toContain(`name: '${name}'`);
    });
    ['8.99', '14.99', '19.99', '119.99', '299.99'].forEach((price) => {
      expect(subscription).toContain(price);
    });
  });

  test('shows the exact Mongo quota offer without unlimited claims', () => {
    const subscription = readPage('SubscriptionPage.js');
    const landing = readPage('LandingPage.js');
    const expected = [
      'Tout du plan Gratuit',
      'Quotas IA avancée fortement augmentés',
      'Conversations plus longues',
      'Jusqu’à 50 captures d’écran par 24 h',
      'Analyse d’images prolongée',
      'Mémoire et contexte étendus',
      'Historique complet',
      'Réponses détaillées',
      'Export de conversations',
      'Génération d’images avec quota étendu'
    ];
    expected.forEach((feature) => {
      expect(subscription).toContain(feature);
      expect(landing).toContain(feature);
    });
    expect(subscription).not.toContain('Screens illimités');
    expect(subscription).not.toContain('Images IA illimitées');
    expect(landing).not.toContain('Screens illimités');
    expect(landing).not.toContain('Images IA illimitées');
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

describe('server-driven model selector', () => {
  test('uses backend model metadata and does not offer Grok', () => {
    const chat = readPage('ChatPage.js');
    expect(chat).toContain('`${API}/chat/models`');
    expect(chat).toContain('response.data?.active_model');
    expect(chat).toContain('evt.active_model || evt.model');
    expect(chat).toContain('data-model-id={activeModel?.model_id');
    expect(chat).toContain('data-provider={activeModel?.provider');
    expect(chat).toContain('data-level={activeModel?.stage');
    expect(chat).not.toContain("{ key: 'grok', label: 'Grok' }");
    expect(chat).not.toContain('<option value="grok">');
  });
});
