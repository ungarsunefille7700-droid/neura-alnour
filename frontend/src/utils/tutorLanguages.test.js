import { TUTOR_LANGUAGE_GROUPS, detectRequestedLanguage, frenchLanguageName } from './tutorLanguages';

describe('detectRequestedLanguage', () => {
  test.each([
    ['je veux appre ndre le riff marocain*', 'rif'],
    ['je veux apprendre le rifain', 'rif'],
    ['apprends-moi le tarifit stp', 'rif'],
    ['je veux apprendre la darija', 'ary'],
    ["j'aimerais apprendre l'arabe marocain", 'ary'],
    ['je veux apprendre le kabyle', 'kab'],
    ['je veux apprendre le chleuh', 'shi'],
    ["je veux apprendre l'amazigh", 'ber'],
    ["apprends-moi l'espagnol", 'es'],
    ['je veux apprendre le turc', 'tr'],
    ['teach me Spanish please', 'es'],
  ])('%s → %s', (text, code) => {
    expect(detectRequestedLanguage(text, 'en')).toBe(code);
  });

  test.each([
    'parle francais',
    'comment dit-on musique ?',
    'je veux apprendre à conjuguer ce verbe',
    "c'est en anglais ou en espagnol ?",
  ])('no switch for: %s', (text) => {
    expect(detectRequestedLanguage(text, 'en')).toBeNull();
  });

  test('no switch when already learning that language', () => {
    expect(detectRequestedLanguage('je veux apprendre l anglais', 'en')).toBeNull();
  });
});

describe('language menu', () => {
  const all = TUTOR_LANGUAGE_GROUPS.flatMap((group) => group.options);

  test('every language is offered once', () => {
    const codes = all.map((option) => option.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining(['rif', 'ary', 'kab', 'shi', 'en', 'es', 'ar']));
  });

  test('labels are readable in French', () => {
    expect(frenchLanguageName({ code: 'rif', name: 'Tarifit (Rif Berber)' })).toBe('Rifain (tarifit)');
    expect(all.find((option) => option.code === 'ary').label).toMatch(/^Darija marocaine/);
    expect(TUTOR_LANGUAGE_GROUPS[0].options.map((option) => option.code)).toContain('rif');
  });
});
