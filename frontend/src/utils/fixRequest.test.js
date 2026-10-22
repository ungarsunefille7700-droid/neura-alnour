import { fixRequest } from './projectCheck';
import { keepsErrorsOnPurpose } from './codeRunner';

describe('fixRequest adaptée au langage', () => {
  test('Python : aucune consigne Lua, FiveM ou HTML', () => {
    const text = fixRequest([{ file: 'test_stats.py::test_moyenne_vide', message: 'test échoué : ZeroDivisionError' }],
      [{ path: 'stats.py' }, { path: 'test_stats.py' }]);
    expect(text).toContain('- test_stats.py::test_moyenne_vide : test échoué : ZeroDivisionError');
    expect(text).toContain('les tests passent vraiment');
    expect(text).not.toMatch(/Lua|fxmanifest|HTML|JavaScript/);
    expect(text).toContain("en respectant toutes les consignes de la demande d'origine");
  });

  test('page web : consignes HTML / JavaScript / CSS seulement', () => {
    const text = fixRequest([{ file: 'page', message: "erreur à l'exécution : x is not defined" }],
      [{ path: 'index.html' }, { path: 'script.js' }, { path: 'style.css' }]);
    expect(text).toContain('chaque id utilisé par le JavaScript existe dans le HTML');
    expect(text).toContain('fichier CSS');
    expect(text).not.toMatch(/Lua|fxmanifest|Python/);
  });

  test('ressource FiveM : manifest et blocs Lua, rien sur le web ni Python', () => {
    const text = fixRequest([{ file: 'client.lua', message: 'erreur Lua : « end » manquant' }],
      [{ path: 'fxmanifest.lua' }, { path: 'client.lua' }]);
    expect(text).toContain('fxmanifest.lua est fourni');
    expect(text).toContain('fermé par « end »');
    expect(text).not.toMatch(/HTML|Python/);
  });

  test('Lua seul (hors FiveM) : pas de consigne fxmanifest', () => {
    const text = fixRequest([{ file: 'main.lua', message: 'erreur Lua' }], [{ path: 'main.lua' }]);
    expect(text).toContain('« end »');
    expect(text).not.toContain('fxmanifest');
  });

  test('langage sans contrôle spécifique : seulement les erreurs trouvées', () => {
    const text = fixRequest([{ file: 'main.go', message: 'erreur' }], [{ path: 'main.go' }]);
    expect(text).not.toContain('Vérifie ensuite');
  });
});

describe('erreur volontaire : intention clairement exprimée', () => {
  test.each([
    "la fonction n'existe pas, c'est voulu, ne l'ajoute pas",
    "Crée un exercice Python avec une erreur volontaire que l'élève doit trouver",
    'Mets volontairement un bug dans la boucle',
    'Recopie ce code sans le corriger',
    'ne corrige pas le bug, explique-le moi',
    "Garde l'erreur, c'est pour mon cours",
    "Écris une fonction avec une division par zéro faite exprès",
    'Write a script with a bug on purpose',
    "Écris calc.py et son test, l'erreur est voulue, c'est pour un exercice",
    'Les fautes sont volontaires dans ce texte de code',
  ])('détecté : %s', (text) => expect(keepsErrorsOnPurpose(text)).toBe(true));

  test.each([
    "Corrige l'erreur dans mon code",
    "J'ai une erreur : TypeError ligne 3",
    'Fais un code sans erreur',
    "L'erreur n'est pas voulue, aide-moi",
    "c'est pas voulu ce bug",
    'Ne corrige pas seulement le bug, ajoute aussi des tests',
    'Écris un module Python calc.py avec ses tests',
    'Ne laisse aucune erreur',
    'Ajoute un bouton fait exprès pour les débutants',
  ])('non détecté : %s', (text) => expect(keepsErrorsOnPurpose(text)).toBe(false));
});
