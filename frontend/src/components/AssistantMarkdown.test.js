import { act } from 'react';
import { createRoot } from 'react-dom/client';
import AssistantMarkdown from './AssistantMarkdown';
import { downloadZip } from '@/utils/codeFiles';

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }) => <div data-testid="md">{children}</div> }));
jest.mock('remark-gfm', () => () => {});
jest.mock('@/utils/codeFiles', () => {
  const actual = jest.requireActual('@/utils/codeFiles');
  return { ...actual, downloadZip: jest.fn() };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

const fence = '```';
const file = (name, language, lines) => [`Fichier: ${name}`, `${fence}${language}`, ...lines, fence].join('\n');
const project = [
  'Je vais créer un jeu de quiz islamique.',
  file('index.html', 'html', ['<html><head><title>Noor Quiz</title><link rel="stylesheet" href="style.css"></head>',
    '<body><h1>Quiz</h1><script src="script.js"></script></body></html>']),
  file('style.css', 'css', ['h1 { color: green; }']),
  file('script.js', 'js', ['console.log("quiz");']),
  "J'ai créé **Noor Quiz** : 10 questions, un score et un chronomètre.",
].join('\n\n');

test('like ChatGPT: the code never shows in the chat, one project card replaces it', async () => {
  await act(async () => { root.render(<AssistantMarkdown content={project} />); });
  expect(container.textContent).not.toContain('color: green');
  expect(container.textContent).not.toContain('console.log');
  expect(container.textContent).not.toContain('Fichier:');
  expect(container.querySelectorAll('[data-testid="project-card"]')).toHaveLength(1);
  expect(container.querySelector('[data-testid="project-title"]').textContent).toBe('Noor Quiz');
  expect(container.textContent).toContain('3 fichiers');
  expect(container.textContent).toContain('Je vais créer un jeu de quiz islamique.');
  expect(container.textContent).toContain('Noor Quiz** : 10 questions');

  await act(async () => { container.querySelector('[data-testid="code-zip-download"]').click(); });
  expect(downloadZip).toHaveBeenCalledWith([
    expect.objectContaining({ path: 'index.html' }),
    expect.objectContaining({ path: 'style.css' }),
    expect.objectContaining({ path: 'script.js' }),
  ]);
});

test('« Ouvrir » opens the page with its CSS and JS inside, in a new tab', async () => {
  const opened = [];
  let blob;
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = (value) => { blob = value; return 'blob:apercu'; };
  const realOpen = window.open;
  window.open = (url) => { opened.push(url); };
  try {
    await act(async () => { root.render(<AssistantMarkdown content={project} />); });
    await act(async () => { container.querySelector('[data-testid="project-open"]').click(); });
    expect(opened).toEqual(['blob:apercu']);
    const html = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    expect(html).toContain('<style>');
    expect(html).toContain('h1 { color: green; }');
    expect(html).toContain('console.log("quiz");');
    expect(html).not.toContain('href="style.css"');
  } finally {
    URL.createObjectURL = realCreate;
    window.open = realOpen;
  }
});

test('a project with a detected problem offers « Corriger automatiquement »', async () => {
  const broken = [
    file('index.html', 'html', ['<html><body><div class="options-grid"></div><script src="script.js"></script></body></html>']),
    file('script.js', 'js', ["document.getElementById('options-grid').innerHTML = '';"]),
  ].join('\n\n');
  const requests = [];
  await act(async () => { root.render(<AssistantMarkdown content={broken} onFixProject={(text) => requests.push(text)} />); });
  expect(container.querySelector('[data-testid="project-issues"]').textContent).toContain('1 problème détecté');
  await act(async () => { container.querySelector('[data-testid="project-fix"]').click(); });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain('script.js : cherche l\'élément id="options-grid"');
});

test('a correct project shows no warning', async () => {
  await act(async () => { root.render(<AssistantMarkdown content={project} onFixProject={() => {}} />); });
  expect(container.querySelector('[data-testid="project-issues"]')).toBeNull();
});

test('while the AI writes, only a progress line shows — never the code', async () => {
  await act(async () => {
    root.render(<AssistantMarkdown live content={`Je vais créer un script.\n\nFichier: app.py\n${fence}python\nimport os\nprint(1)`} />);
  });
  expect(container.querySelector('[data-testid="project-writing"]').textContent).toContain('Création du projet… app.py · 2 lignes');
  expect(container.textContent).not.toContain('import os');
});

test('a finished answer cut in the middle of the code is never shown as being created', async () => {
  const onFix = jest.fn();
  await act(async () => {
    root.render(<AssistantMarkdown onFixProject={onFix} content={`Je vais créer un site.\n\nFichier: index.html\n${fence}html\n<h1>Coran</h1>`} />);
  });
  expect(container.querySelector('[data-testid="project-writing"]')).toBeNull();
  expect(container.querySelector('[data-testid="project-card"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="project-issues"]').textContent).toContain('coupée avant la fin');
  await act(async () => { container.querySelector('[data-testid="project-fix"]').click(); });
  expect(onFix.mock.calls[0][0]).toContain('Réécris le projet en entier');
});

test('a single script without a file name still gets its card', async () => {
  const lines = Array.from({ length: 8 }, (_, i) => `print(${i})`);
  await act(async () => { root.render(<AssistantMarkdown content={`Voici :\n${fence}python\n${lines.join('\n')}\n${fence}`} />); });
  expect(container.textContent).not.toContain('print(3)');
  expect(container.textContent).toContain('main.py');
});

test('a short terminal command stays visible; « Fichier: projet.zip » is hidden', async () => {
  await act(async () => {
    root.render(<AssistantMarkdown content={`Installe :\n${fence}bash\npip install pillow\n${fence}\nFichier: project.zip *(Note)*\nFin.`} />);
  });
  expect(container.querySelector('[data-testid="project-card"]')).toBeNull();
  expect(container.textContent).toContain('pip install pillow');
  expect(container.textContent).not.toContain('project.zip');
});
