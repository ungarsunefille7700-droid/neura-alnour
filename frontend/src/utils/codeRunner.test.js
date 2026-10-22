import { MAX_AUTO_FIXES, MONITOR, verificationSummary, verifyProject, withMonitor } from './codeRunner';

const noWeb = async () => ({ ran: true, loaded: true, errors: [] });
let pyCalls = 0;
const noPy = async () => { pyCalls += 1; return { ran: false, reason: 'non appelé' }; };

describe('codeRunner', () => {
  test('le moniteur est placé au début de la page', () => {
    expect(withMonitor('<html><head><title>x</title></head></html>')).toBe(`<html><head>${MONITOR}<title>x</title></head></html>`);
    expect(withMonitor('<p>sans head</p>').startsWith(MONITOR)).toBe(true);
  });

  test('une page qui tourne sans erreur et sans problème statique est validée', async () => {
    const files = [{ path: 'index.html', content: '<html><head></head><body><p>ok</p></body></html>' }];
    const result = await verifyProject(files, { runWeb: noWeb, runPy: noPy });
    expect(result.issues).toEqual([]);
    expect(pyCalls).toBe(0);
    expect(verificationSummary(result)).toEqual({ ok: true, text: 'contrôles statiques faits · page exécutée sans erreur', notTested: [] });
  });

  test('les erreurs réelles de la page deviennent des problèmes à corriger', async () => {
    const runWeb = async () => ({ ran: true, loaded: true, errors: ['x is not defined (ligne 3)'] });
    const files = [{ path: 'index.html', content: '<html><head></head><body></body></html>' }];
    const result = await verifyProject(files, { runWeb, runPy: noPy });
    expect(result.issues).toEqual([{ file: 'page', message: "erreur à l'exécution : x is not defined (ligne 3)", source: 'exécution' }]);
    expect(verificationSummary(result).ok).toBe(false);
  });

  test('Python : tests échoués et erreurs de syntaxe sont rapportés, les réussis comptés', async () => {
    const runPy = async () => ({ ran: true, compiled: ['calc.py', 'test_calc.py'], syntax_errors: ['bad.py ligne 2 : invalid syntax'],
      import_errors: [], tests: [{ name: 'test_calc.py::test_add', ok: true }, { name: 'test_calc.py::test_div', ok: false, error: 'ZeroDivisionError : division by zero' }] });
    const files = [{ path: 'calc.py', content: '' }, { path: 'test_calc.py', content: '' }, { path: 'bad.py', content: '' }];
    const result = await verifyProject(files, { runWeb: noWeb, runPy });
    expect(result.issues.map((i) => i.message)).toEqual(['erreur de syntaxe : bad.py ligne 2 : invalid syntax', 'test échoué : ZeroDivisionError : division by zero']);
    expect(verificationSummary(result).text).toBe('contrôles statiques faits · Python compilé (2 fichier(s)) · tests 1/2 réussis');
  });

  test('ce qui ne peut pas tourner ici est dit « non testé », jamais réussi', async () => {
    const runPy = async () => ({ ran: false, reason: 'Python n’a pas pu être chargé à temps' });
    const files = [{ path: 'main.py', content: 'print(1)' }, { path: 'main.go', content: 'package main' },
      { path: 'fxmanifest.lua', content: "fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'" }, { path: 'client.lua', content: 'print(1)' }];
    const { notTested } = verificationSummary(await verifyProject(files, { runWeb: noWeb, runPy }));
    expect(notTested).toEqual([
      'Python : Python n’a pas pu être chargé à temps',
      'FiveM : test en jeu impossible ici (il faut un serveur FiveM) — syntaxe Lua et manifest vérifiés',
      'go : compilation non disponible ici',
    ]);
  });

  test('une boucle infinie est arrêtée et rapportée comme telle', async () => {
    const runPy = async () => ({ ran: true, timeout: true, errors: ['exécution arrêtée après 20 s (boucle infinie ?)'] });
    const result = await verifyProject([{ path: 'test_boucle.py', content: '' }], { runWeb: noWeb, runPy });
    expect(result.issues.map((i) => i.message)).toEqual(['exécution arrêtée après 20 s (boucle infinie ?)']);
    expect(verificationSummary(result).text).toBe('contrôles statiques faits · Python arrêté après 20 s (limite de temps)');
  });

  test('un test qui a besoin du réseau ou des threads est « non testé », jamais envoyé en correction', async () => {
    const runPy = async () => ({ ran: true, compiled: ['test_api.py'], syntax_errors: [], import_errors: [], tests: [
      { name: 'test_api.py::test_ok', ok: true },
      { name: 'test_api.py::test_api', ok: null, env: 'URLError : <urlopen error unknown url type: https> (test_api.py ligne 4 : urlopen(url))' },
    ] });
    const result = await verifyProject([{ path: 'test_api.py', content: '' }], { runWeb: noWeb, runPy });
    expect(result.issues).toEqual([]);
    const summary = verificationSummary(result);
    expect(summary.text).toBe('contrôles statiques faits · Python compilé (1 fichier(s)) · tests 1/1 réussis');
    expect(summary.notTested[0]).toMatch(/^Python : 1 test\(s\) impossible\(s\) dans le navigateur \(réseau, threads ou processus\) — URLError/);
  });

  test('trois corrections automatiques au maximum', () => {
    expect(MAX_AUTO_FIXES).toBe(3);
  });
});
