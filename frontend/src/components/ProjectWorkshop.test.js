import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectWorkshopPanel, workshopSummary } from './ProjectWorkshop';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const workshop = (overrides = {}) => ({
  state: { name: 'neura_garage.zip', size: 2048, loading: false, entries: [{ path: 'server/main.lua', size: 10 }, { path: 'client/main.lua', size: 10 }], scope: { mode: 'all' }, read: 2 },
  selected: [{ path: 'server/main.lua', size: 10 }, { path: 'client/main.lua', size: 10 }],
  setScope: jest.fn(), close: jest.fn(), readScope: jest.fn(), statusOf: () => ({ state: 'lu' }),
  search: jest.fn(async () => [{ path: 'server/main.lua', score: 9, lines: [{ line: 1, text: "RegisterNetEvent('garage:spawn'" }] }]),
  ...overrides,
});

test('searching in the workshop never sends the chat message (the panel sits inside the chat form)', async () => {
  const onSubmit = jest.fn((event) => event.preventDefault());
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const w = workshop();
  await act(async () => { root.render(<form onSubmit={onSubmit}><ProjectWorkshopPanel workshop={w} /></form>); });
  const input = container.querySelector('[data-testid="workshop-search"]');
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await act(async () => { container.querySelector('[data-testid="workshop-search-btn"]').click(); });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(w.search).toHaveBeenCalled();
  expect(container.querySelector('[data-testid="workshop-results"]').textContent).toContain('garage:spawn');
  expect(container.querySelector('[data-testid="workshop-coverage"]').textContent).toContain('2 dans le périmètre');
  act(() => root.unmount());
});

test('the line under the message says exactly what was given to the AI', () => {
  expect(workshopSummary({ full: ['a', 'b'], partial: ['c'], outlined: ['d', 'e', 'f'], tokens: 19427 }))
    .toBe('Atelier : 2 fichier(s) en entier, 1 en extraits, 3 dans le plan · 19 427 jetons');
});
