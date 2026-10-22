import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoAnalysisPanel } from './VideoAnalysis';

jest.mock('axios');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const show = (state) => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const video = { state, close: jest.fn(), setOptions: jest.fn(), analyse: jest.fn(), stop: jest.fn() };
  act(() => root.render(<VideoAnalysisPanel video={video} level="auto" />));
  return { container, root, video };
};
const base = { name: 'lecon.webm', loading: false, duration: 600, width: 1280, height: 720, mode: 'full', ranges: '', query: '' };
const quotaText = (container) => container.querySelector('[data-testid="video-quota"]')?.textContent;

test('ce qu’il reste aujourd’hui, avant d’analyser', () => {
  const { container, root } = show({ ...base, mode: 'ranges', ranges: '1:00-2:30', quota: { enabled: true, minutes_left_today: 2, unlimited: false } });
  expect(quotaText(container)).toBe('Partie choisie : 01:30 · il te reste aujourd’hui environ 2 min de vidéo parlée');
  act(() => root.unmount());
});

test('prévient quand la partie choisie dépasse ce qu’il reste', () => {
  const { container, root } = show({ ...base, quota: { enabled: true, minutes_left_today: 2, unlimited: false } });
  expect(quotaText(container)).toContain('Partie choisie : 10:00 · il te reste aujourd’hui environ 2 min de vidéo parlée — la fin ne pourra pas être analysée');
  act(() => root.unmount());
});

test('sans limite (VIP) et désactivée', () => {
  let shown = show({ ...base, quota: { enabled: true, unlimited: true, minutes_left_today: 180 } });
  expect(quotaText(shown.container)).toBe('Partie choisie : 10:00 · analyse vidéo sans limite pour ton compte');
  act(() => shown.root.unmount());
  shown = show({ ...base, quota: { enabled: false } });
  expect(quotaText(shown.container)).toBe("L'analyse vidéo n'est pas activée pour le moment.");
  act(() => shown.root.unmount());
});

test('résultat : couverture, recherche, coût', () => {
  const { container, root } = show({ ...base, result: {
    coverage: { windows: ['00:00–01:31'], frames: 8, largestGap: 16, speech: { status: 'ok', spokenSeconds: 27, segments: 7 } },
    matches: [{ t: 78.5 }], query: 'olivier', neurons: 39.5, stoppedBy: null,
  } });
  const text = container.querySelector('[data-testid="video-coverage"]').textContent;
  expect(text).toContain('Analysé : 00:00–01:31 · 8 images (au plus 16 s sans image)');
  expect(text).toContain('Paroles : 27 s transcrites (7 phrases)');
  expect(text).toContain('« olivier » trouvé à 01:18');
  expect(text).toContain('Coût : 39.5 neurones');
  act(() => root.unmount());
});
