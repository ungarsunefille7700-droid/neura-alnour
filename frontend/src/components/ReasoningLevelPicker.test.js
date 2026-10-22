import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReasoningLevelPicker from './ReasoningLevelPicker';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MONGO = [
  { key: 'instant', label: 'Instantané', available: true },
  { key: 'medium', label: 'Moyenne', available: true },
  { key: 'high', label: 'Élevée', available: false, plan_needed: 'Plus' },
  { key: 'very_high', label: 'Très élevée', available: false, plan_needed: 'Neura+' },
];

const mount = (props) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ReasoningLevelPicker {...props} />));
  return { container, root, rerender: (next) => act(() => root.render(<ReasoningLevelPicker {...next} />)) };
};

test('opens over a blurred background with the chosen level above the track', () => {
  const onChange = jest.fn();
  const { container, root } = mount({ modes: MONGO, value: 'medium', onChange });
  expect(container.querySelector('[data-testid="reasoning-picker"]')).toBeNull();
  act(() => container.querySelector('[data-testid="intelligence-mode-selector"]').click());
  expect(container.querySelector('[data-testid="reasoning-backdrop"]').className).toContain('backdrop-blur');
  expect(container.querySelector('[data-testid="reasoning-current"]').textContent).toBe('Moyenne');
  expect(parseFloat(container.querySelector('[data-testid="reasoning-knob"]').style.left)).toBeCloseTo(33.33, 1);
  expect(container.querySelector('[data-testid="reasoning-upsell"]').textContent).toContain('Élevée avec Plus');
  act(() => root.unmount());
});

test('a level of the plan is chosen, a locked one cannot be', () => {
  const onChange = jest.fn();
  const { container, root } = mount({ modes: MONGO, value: 'instant', onChange });
  act(() => container.querySelector('[data-testid="intelligence-mode-selector"]').click());
  act(() => container.querySelector('[data-testid="reasoning-stop-high"]').click());
  expect(onChange).not.toHaveBeenCalled();
  expect(container.querySelector('[data-testid="reasoning-stop-very_high"]').disabled).toBe(true);
  act(() => container.querySelector('[data-testid="reasoning-stop-medium"]').click());
  expect(onChange).toHaveBeenCalledWith('medium');
  act(() => root.unmount());
});

test('the four levels are all open with Neura+ / Ultra, and the backdrop closes it', () => {
  const all = MONGO.map((mode) => ({ ...mode, available: true }));
  const onChange = jest.fn();
  const { container, root } = mount({ modes: all, value: 'instant', onChange });
  act(() => container.querySelector('[data-testid="intelligence-mode-selector"]').click());
  act(() => container.querySelector('[data-testid="reasoning-stop-very_high"]').click());
  expect(onChange).toHaveBeenCalledWith('very_high');
  expect(container.querySelector('[data-testid="reasoning-upsell"]')).toBeNull();
  act(() => container.querySelector('[data-testid="reasoning-backdrop"]').click());
  expect(container.querySelector('[data-testid="reasoning-picker"]')).toBeNull();
  act(() => root.unmount());
});
