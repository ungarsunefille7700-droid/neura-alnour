import { showableReasoning } from './ThinkingPanel';

// Real reasoning captured from gpt-oss-120b on Workers AI (it reasons in English even
// when asked to reason in French): it must not be shown to a French-speaking user.
test('English reasoning is hidden, French reasoning is shown', () => {
  expect(showableReasoning('The user asks: "Écris une fonction JavaScript qui additionne deux nombres." So we need to provide a JavaScript function that adds two numbers. Provide code, maybe with explanation.')).toBe('');
  expect(showableReasoning("L'élève veut un quiz : je prépare 3 fichiers et je vérifie que les id sont dans le HTML.")).toContain('quiz');
  expect(showableReasoning('')).toBe('');
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ThinkingPanel, { translatableEnd } from './ThinkingPanel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('the translation stops at the end of the last full sentence while thinking', () => {
  const text = 'We need a file. Then we write';
  expect(translatableEnd(text, 0, false)).toBe('We need a file. '.length);
  expect(translatableEnd(text, 0, true)).toBe(text.length);
  expect(translatableEnd('no end yet', 0, false)).toBe(0);
});

test('opened, the English reasoning is shown in French (closed: nothing is translated)', async () => {
  const english = 'The user wants a quiz. We need three files and ids that match the HTML.';
  const translate = jest.fn(() => Promise.resolve("L'utilisateur veut un quiz. Il faut trois fichiers."));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ThinkingPanel thinking={english} content="" seconds={4} translate={translate} />);
  });
  expect(translate).not.toHaveBeenCalled();
  await act(async () => {
    container.querySelector('[data-testid="thinking-toggle"]').click();
  });
  await act(async () => { await Promise.resolve(); });
  expect(container.querySelector('[data-testid="thinking-text"]').textContent).toContain('trois fichiers');
  expect(translate).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain('We need');
  act(() => root.unmount());
  container.remove();
});
