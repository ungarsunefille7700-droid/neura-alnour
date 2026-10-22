import { act } from 'react';
import { createRoot } from 'react-dom/client';
import VerificationNote from './VerificationNote';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const show = (result) => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<VerificationNote result={result} />));
  return { container, root };
};

test('rien sans vérification', () => {
  const { container, root } = show(undefined);
  expect(container.innerHTML).toBe('');
  act(() => root.unmount());
});

test('pendant la vérification', () => {
  const { container, root } = show({ running: true, python: true });
  expect(container.querySelector('[data-testid="verification-running"]').textContent).toContain('chargement de Python au premier usage');
  act(() => root.unmount());
});

test('résultat, correction automatique et non testé', () => {
  const { container, root } = show({ ok: false, issues: 2, text: 'contrôles statiques faits', autoFix: 'Correction automatique 1/3 envoyée à Neura', notTested: ['go : compilation non disponible ici'] });
  expect(container.querySelector('[data-testid="verification-note"]').textContent).toContain('Vérification réelle : contrôles statiques faits — 2 problème(s) trouvé(s)');
  expect(container.querySelector('[data-testid="verification-autofix"]').textContent).toContain('Correction automatique 1/3');
  expect(container.textContent).toContain('Non testé : go : compilation non disponible ici');
  act(() => root.unmount());
});
