import { memoryDate } from './MemoryCard';

jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ getAuthHeader: () => ({}) }) }));

test('a memory shows the day it was told', () => {
  expect(memoryDate('2026-08-04T10:00:00+00:00')).toBe('4 août 2026');
  expect(memoryDate('pas une date')).toBe('');
});
