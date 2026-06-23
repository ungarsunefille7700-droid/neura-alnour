import { createContext, useContext, useState } from 'react';
import { LANGUAGES } from '@/i18n/languages';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'neura_language';
const FALLBACK = 'fr'; // reasonable fallback when the phone language is not in the list

// Auto-detect the phone/browser language (e.g. "es-ES" -> "es").
function detectLanguage() {
  const supported = new Set(LANGUAGES.map((l) => l.code));
  let nav = '';
  if (typeof navigator !== 'undefined') {
    nav = navigator.language || (navigator.languages && navigator.languages[0]) || '';
  }
  const base = nav.toLowerCase().split('-')[0];
  if (supported.has(base)) return base;
  return supported.has('en') && base === 'en' ? 'en' : FALLBACK;
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    // A manual saved choice always takes precedence over auto-detection.
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

  const current =
    LANGUAGES.find((l) => l.code === language) ||
    LANGUAGES.find((l) => l.code === FALLBACK);

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
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
