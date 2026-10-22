import { checkProject, fixRequest } from './projectCheck';

const page = (body, head = '') => ({
  path: 'index.html',
  content: `<html><head>${head}<link rel="stylesheet" href="style.css"></head><body>${body}<script src="script.js"></script></body></html>`,
});
const css = { path: 'style.css', content: 'body{}' };

describe('checkProject', () => {
  test('the bug seen in a real generated quiz: id looked up, only a class in the HTML', () => {
    const issues = checkProject([
      page('<div class="options-grid"></div><p id="question"></p>'),
      css,
      { path: 'script.js', content: "const grid = document.getElementById('options-grid');\nconst q = document.getElementById('question');" },
    ]);
    expect(issues).toEqual([{
      file: 'script.js',
      message: 'cherche l\'élément id="options-grid", absent du HTML (le HTML a seulement class="options-grid")',
    }]);
    expect(fixRequest(issues)).toContain('- script.js : cherche l\'élément id="options-grid"');
  });

  test('a consistent project has no issue (no invented problem)', () => {
    expect(checkProject([
      page('<div id="options-grid"></div><button id="start">Go</button>'),
      css,
      {
        path: 'script.js',
        content: "document.getElementById('options-grid');\ndocument.querySelector('#start');\n"
          + "const b = document.createElement('div'); b.id = 'result';\ndocument.getElementById('result');",
      },
    ])).toEqual([]);
  });

  test('missing local files and JavaScript syntax errors are reported; CDN files are fine', () => {
    const issues = checkProject([
      { path: 'index.html', content: '<link href="style.css" rel="stylesheet"><script src="https://cdn.x/lib.js"></script><script src="app.js"></script>' },
      { path: 'other.js', content: 'function ( {' },
    ]);
    expect(issues.map((issue) => issue.message)).toEqual([
      'charge « style.css », qui n\'existe pas dans le projet',
      'charge « app.js », qui n\'existe pas dans le projet',
      expect.stringContaining('erreur de syntaxe JavaScript'),
    ]);
  });

  test('projects without a web page are not checked', () => {
    expect(checkProject([{ path: 'main.py', content: 'print(1)' }])).toEqual([]);
  });
});
