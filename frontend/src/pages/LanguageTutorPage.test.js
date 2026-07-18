import { LANGUAGES } from '../i18n/languages';
import { selectBestVoice, speechChunks, speechLang } from '../utils/speech';

describe('language tutor speech helpers', () => {
  test('provides a valid locale for every configured language', () => {
    expect(LANGUAGES).toHaveLength(124);
    expect(new Set(LANGUAGES.map((language) => language.code)).size).toBe(124);
    LANGUAGES.forEach(({ code }) => {
      expect(speechLang(code)).toMatch(/^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$/);
    });
  });

  test('keeps the actual Maghreb language in the speech locale', () => {
    expect(speechLang('ary')).toBe('ar-MA');
    expect(speechLang('arq')).toBe('ar-DZ');
    expect(speechLang('aeb')).toBe('ar-TN');
    expect(speechLang('kab')).toBe('kab-DZ');
    expect(speechLang('rif')).toBe('rif-MA');
    expect(speechLang('zgh')).toBe('zgh-MA');
  });

  test('prefers an exact high-quality voice locale', () => {
    const voices = [
      { name: 'Generic English', lang: 'en-GB', localService: true, default: true },
      { name: 'Microsoft Natural English', lang: 'en-US', localService: false, default: false },
      { name: 'French', lang: 'fr-FR', localService: false, default: false },
    ];
    expect(selectBestVoice(voices, 'en-US')).toBe(voices[1]);
  });

  test('removes code blocks and splits normal sentences for speech', () => {
    const chunks = speechChunks('Bonjour. ```const secret = true;``` Comment vas-tu ?');
    expect(chunks.join(' ')).not.toContain('secret');
    expect(chunks.join(' ')).toContain('Bonjour.');
    expect(chunks.join(' ')).toContain('Comment vas-tu ?');
  });
});
