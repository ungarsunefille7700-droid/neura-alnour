import { needsReview, summarize } from './QuranMemorization';

jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, getAuthHeader: () => ({}) }) }));

const DAY = 24 * 3600 * 1000;

test('a learned surah not revised for a week is to be reviewed', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  expect(needsReview({ status: 'learned', last_reviewed_at: '2026-10-19T12:00:00Z' }, now)).toBe(false);
  expect(needsReview({ status: 'learned', last_reviewed_at: new Date(now - 8 * DAY).toISOString() }, now)).toBe(true);
  expect(needsReview({ status: 'learning', last_reviewed_at: '2020-01-01T00:00:00Z' }, now)).toBe(false);
});

test('the summary counts learned, in progress and to review', () => {
  const old = '2020-01-01T00:00:00Z';
  expect(summarize({ 1: { status: 'learned', last_reviewed_at: old }, 112: { status: 'learned', last_reviewed_at: new Date().toISOString() },
    2: { status: 'learning' } })).toEqual({ learned: 2, learning: 1, review: 1 });
});
