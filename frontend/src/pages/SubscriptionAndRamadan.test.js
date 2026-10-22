import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SubscriptionPage from './SubscriptionPage';
import { getHijriInfo } from './RamadanPage';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: jest.fn() }) }));
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key }) }));

let mockUser = null;
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, loading: false, getAuthHeader: () => ({}), fetchUser: jest.fn() }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const renderPlans = async (subscription) => {
  mockUser = { id: 'u1', name: 'Test', subscription };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/subscription']}><SubscriptionPage /></MemoryRouter>);
  });
  const buttonText = (id) => {
    const card = container.querySelector(`[data-testid="plan-btn-${id}"]`);
    if (card) return card.textContent;
    // Disabled buttons have no test id: find the card by its plan name.
    const cards = Array.from(container.querySelectorAll('button[disabled]'));
    return cards.map((button) => button.textContent).join(' | ');
  };
  const done = async () => act(async () => root.unmount());
  return { container, buttonText, done };
};

describe('subscription plans offered to a subscriber', () => {
  test('a Neura Ultra subscriber cannot buy Mongo, Plus or Neura+ on top', async () => {
    const page = await renderPlans('neura_ultra');
    expect(page.container.querySelector('[data-testid="plan-btn-mongo"]')).toBeNull();
    expect(page.container.querySelector('[data-testid="plan-btn-pro"]')).toBeNull();
    expect(page.container.querySelector('[data-testid="plan-btn-neura_plus"]')).toBeNull();
    expect(page.container.textContent).toContain('Inclus avec Neura Ultra');
    expect(page.container.textContent).toContain('Offre actuelle');
    await page.done();
  });

  test('a Plus subscriber can still upgrade, but not buy Mongo', async () => {
    const page = await renderPlans('pro');
    expect(page.container.querySelector('[data-testid="plan-btn-mongo"]')).toBeNull();
    expect(page.container.querySelector('[data-testid="plan-btn-neura_plus"]')).not.toBeNull();
    expect(page.container.querySelector('[data-testid="plan-btn-neura_ultra"]')).not.toBeNull();
    expect(page.container.textContent).toContain('Inclus avec Plus');
    await page.done();
  });

  test('the Developer plan is no longer offered', async () => {
    const page = await renderPlans('free');
    // Exactly 19.99 € (Neura+ costs 119.99 €).
    expect(page.container.textContent).not.toMatch(/(^|[^0-9])19\.99€/);
    expect(page.container.textContent).not.toContain('Pour les développeurs');
    expect(page.container.querySelector('[data-testid="plan-btn-developer"]')).toBeNull();
    await page.done();
  });
});

describe('Ramadan detection (Umm al-Qura calendar)', () => {
  test('14 October 2026 is not in Ramadan (3 Joumada al-Oula 1448, as Aladhan)', () => {
    const info = getHijriInfo(new Date(2026, 9, 14, 12));
    expect(info.isRamadan).toBe(false);
    expect(info.label).toMatch(/1448/);
  });

  test('15 February 2027 is in Ramadan 1448', () => {
    expect(getHijriInfo(new Date(2027, 1, 15, 12)).isRamadan).toBe(true);
  });
});
