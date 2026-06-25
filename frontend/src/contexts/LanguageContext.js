import { createContext, useContext, useState, useEffect } from 'react';
import { LANGUAGES } from '@/i18n/languages';
import { TRANSLATIONS } from '@/i18n/translations';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'neura_language';
const FALLBACK = 'fr'; // base language (the source strings are in French)

// Right-to-left languages.
const RTL = new Set(['ar', 'ur', 'fa', 'he', 'ps', 'sd', 'ug', 'yi', 'dv', 'ku']);

// Auto-detect the phone/browser language (e.g. "es-ES" -> "es").
function detectLanguage() {
  const supported = new Set(LANGUAGES.map((l) => l.code));
  let nav = '';
  if (typeof navigator !== 'undefined') {
    nav = navigator.language || (navigator.languages && navigator.languages[0]) || '';
  }
  const base = nav.toLowerCase().split('-')[0];
  if (supported.has(base)) return base;
  return FALLBACK;
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    let saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      saved = null;
    }
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
    return detectLanguage();
  });

  const setLanguage = (code) => {
    setLanguageState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch (e) {
      /* ignore storage errors */
    }
  };

  const dir = RTL.has(language) ? 'rtl' : 'ltr';

  // Reflect the language + direction on <html> (helps RTL languages render correctly).
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
      document.documentElement.dir = dir;
    }
  }, [language, dir]);

  // Translate a key. Falls back: current language -> French base -> the key itself.
  // So a missing translation never shows blank — at worst it shows the French label.
  const t = (key, vars) => {
    const dict = TRANSLATIONS[language] || {};
    const base = TRANSLATIONS[FALLBACK] || {};
    let str = (key in dict ? dict[key] : (key in base ? base[key] : key));
    if (vars && typeof str === 'string') {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp(`{${k}}`, 'g'), vars[k]);
      });
    }
    return str;
  };

  const current =
    LANGUAGES.find((l) => l.code === language) ||
    LANGUAGES.find((l) => l.code === FALLBACK);

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t,
        dir,
        isRTL: dir === 'rtl',
        languageName: current ? current.name : 'French',
        languageNative: current ? current.native : 'Français',
        languages: LANGUAGES,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
