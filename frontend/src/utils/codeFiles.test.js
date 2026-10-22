import { buildZip, cleanPath, crc32, extractCodeFiles, splitMessage } from './codeFiles';

const fence = '```';

describe('extractCodeFiles', () => {
  test('files announced with « Fichier: » become a project, in order', () => {
    const answer = [
      'Voici ton projet :',
      'Fichier: app.py',
      `${fence}python`, 'print("salam")', fence,
      '',
      'Fichier: templates/index.html',
      `${fence}html`, '<h1>Salam</h1>', fence,
      'Lance-le avec `python app.py`.',
    ].join('\n');
    expect(extractCodeFiles(answer)).toEqual([
      { path: 'app.py', content: 'print("salam")\n' },
      { path: 'templates/index.html', content: '<h1>Salam</h1>\n' },
    ]);
  });

  test('the usual ways of naming a file are understood', () => {
    const answer = [
      '### `src/main.js`', `${fence}js`, 'const a = 1;', fence,
      '**style.css**', `${fence}css`, 'body{}', fence,
      'Crée le fichier `requirements.txt` :', `${fence}text`, 'flask', fence,
      `${fence}python title="server/api.py"`, 'x = 1', fence,
      '📄 Dockerfile', `${fence}dockerfile`, 'FROM python:3.12', fence,
    ].join('\n');
    expect(extractCodeFiles(answer).map((file) => file.path)).toEqual([
      'src/main.js', 'style.css', 'requirements.txt', 'server/api.py', 'Dockerfile',
    ]);
  });

  test('a corrected file keeps only its last version', () => {
    const answer = ['Fichier: a.py', `${fence}py`, 'v1', fence, 'Correction :', 'Fichier: a.py', `${fence}py`, 'v2', fence].join('\n');
    expect(extractCodeFiles(answer)).toEqual([{ path: 'a.py', content: 'v2\n' }]);
  });

  test('unnamed blocks: a single snippet is not a project, several get sensible names', () => {
    expect(extractCodeFiles(`Exemple :\n${fence}python\nprint(1)\n${fence}`)).toEqual([]);
    const page = [`${fence}html`, '<p>a</p>', fence, `${fence}css`, 'p{}', fence, `${fence}js`, 'go()', fence].join('\n');
    expect(extractCodeFiles(page).map((file) => file.path)).toEqual(['index.html', 'style.css', 'script.js']);
    expect(extractCodeFiles(`${fence}text\nsortie\n${fence}\n${fence}console\n$ ls\n${fence}`)).toEqual([]);
  });

  test('paths that could escape the archive are refused', () => {
    expect(cleanPath('../../etc/passwd.txt')).toBeNull();
    expect(cleanPath('/abs/x.py')).toBe('abs/x.py');
    expect(cleanPath('C:\\Users\\x.py')).toBeNull();
    expect(cleanPath('Voici le code')).toBeNull();
    expect(cleanPath('src\\app.js')).toBe('src/app.js');
  });
});

describe('buildZip', () => {
  const read32 = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  const read16 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);

  test('crc32 matches the standard value', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
  });

  test('a valid archive: entries, names, contents and directory', () => {
    const zip = buildZip([
      { path: 'app.py', content: 'print("salam")\n' },
      { path: 'dossier/é.txt', content: 'arabe : سلام\n' },
    ], new Date(2026, 9, 14, 21, 30, 10));
    expect(read32(zip, 0)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(read32(zip, end)).toBe(0x06054b50);
    expect(read16(zip, end + 10)).toBe(2);
    const directory = read32(zip, end + 16);
    expect(read32(zip, directory)).toBe(0x02014b50);
    const nameLength = read16(zip, 26);
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLength))).toBe('app.py');
    const size = read32(zip, 18);
    expect(new TextDecoder().decode(zip.slice(30 + nameLength, 30 + nameLength + size))).toBe('print("salam")\n');
    expect(read32(zip, 14)).toBe(crc32(new TextEncoder().encode('print("salam")\n')));
  });
});

describe('splitMessage', () => {
  test('text and code parts; the « Fichier: » line becomes the card title', () => {
    const answer = ['Voici le jeu.', '', 'Fichier: index.html', `${fence}html`, '<h1>Quiz</h1>', '<p>a</p>', fence, 'Ouvre index.html.'].join('\n');
    expect(splitMessage(answer)).toEqual([
      { type: 'text', text: 'Voici le jeu.\n' },
      { type: 'code', path: 'index.html', language: 'html', code: '<h1>Quiz</h1>\n<p>a</p>', lines: 2, complete: true },
      { type: 'text', text: 'Ouvre index.html.' },
    ]);
  });

  test('a block still being written is incomplete; a sentence naming the file stays', () => {
    const parts = splitMessage(['Crée le fichier `app.py` :', `${fence}python`, 'import os', 'print(1)'].join('\n'));
    expect(parts[0]).toEqual({ type: 'text', text: 'Crée le fichier `app.py` :' });
    expect(parts[1]).toEqual(expect.objectContaining({ path: 'app.py', complete: false, lines: 2 }));
  });
});

