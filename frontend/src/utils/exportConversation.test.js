import { canExport, conversationHtml, conversationText } from './exportConversation';

const MESSAGES = [
  { role: 'user', content: 'Salam, explique la prière', created_at: '2026-10-16T10:00:00Z' },
  { role: 'assistant', content: 'La prière <b>se fait</b> 5 fois par jour.', created_at: '2026-10-16T10:00:05Z' },
  { role: 'system', content: 'jamais exporté' },
];

test('export is for Mongo and above', () => {
  expect(canExport({ subscription: 'free' })).toBe(false);
  expect(canExport({ subscription: 'mongo' })).toBe(true);
  expect(canExport({ subscription: 'neura_ultra' })).toBe(true);
  expect(canExport({ subscription: 'free', is_vip: true })).toBe(true);
  expect(canExport(null)).toBe(false);
});

test('the text export keeps who said what, never the hidden messages', () => {
  const text = conversationText(MESSAGES, 'Ma prière');
  expect(text).toContain('Ma prière');
  expect(text).toContain('— Toi');
  expect(text).toContain('— NEURA AL-NOUR');
  expect(text).toContain('5 fois par jour');
  expect(text).not.toContain('jamais exporté');
});

test('the PDF page never runs what the conversation contains', () => {
  const html = conversationHtml(MESSAGES, 'Test <script>');
  expect(html).toContain('&lt;b&gt;se fait&lt;/b&gt;');
  expect(html).not.toContain('<script>');
});
