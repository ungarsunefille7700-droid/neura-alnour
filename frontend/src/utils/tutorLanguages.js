import { LANGUAGES } from '@/i18n/languages';

// French names for the regional variants Intl does not know (or names badly).
const FRENCH_NAMES = {
  fr: 'Français',
  ar: 'Arabe littéraire (fusha)',
  'ar-MA': 'Arabe standard (Maroc)',
  ary: 'Darija marocaine',
  zgh: 'Amazigh standard marocain',
  tzm: 'Amazigh du Moyen Atlas',
  rif: 'Rifain (tarifit)',
  shi: 'Chleuh (tachelhit)',
  arq: 'Darija algérienne',
  'ber-DZ': 'Amazigh (Algérie)',
  kab: 'Kabyle',
  shy: 'Chaoui',
  cnu: 'Chenoui',
  mzb: 'Mozabite',
  thv: 'Touareg (tamahaq)',
  aeb: 'Darija tunisienne',
  'ar-TN': 'Arabe standard (Tunisie)',
  jbn: 'Amazigh de Djerba',
  ber: 'Amazigh (tamazight)',
};

// Extra words people use to ask for a language (accents removed, lowercase).
const ALIASES = {
  ar: ['arabe', 'arabe litteraire', 'fusha', 'fousha', 'arabe classique'],
  ary: ['darija', 'darija marocaine', 'marocain', 'arabe marocain', 'dialecte marocain'],
  arq: ['darija algerienne', 'algerien', 'arabe algerien', 'dialecte algerien'],
  aeb: ['darija tunisienne', 'derja', 'tunisien', 'arabe tunisien', 'dialecte tunisien'],
  rif: ['rif', 'riff', 'rifain', 'riffain', 'rifi', 'riffi', 'tarifit', 'tarifite', 'tamazight du rif'],
  shi: ['chleuh', 'tachelhit', 'tachelhite', 'soussi', 'tashelhit'],
  kab: ['kabyle', 'taqbaylit'],
  ber: ['amazigh', 'berbere', 'tamazight', 'tamazigh'],
  shy: ['chaoui', 'tachawit'],
  thv: ['touareg', 'tamahaq'],
};

const normalize = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, ' ');

let displayNames = null;
try {
  displayNames = new Intl.DisplayNames(['fr'], { type: 'language' });
} catch (error) {
  displayNames = null;
}

export const frenchLanguageName = (language) => {
  if (!language) return '';
  if (FRENCH_NAMES[language.code]) return FRENCH_NAMES[language.code];
  try {
    const name = displayNames?.of(language.code);
    if (name && name.toLowerCase() !== language.code.toLowerCase()) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  } catch (error) {
    // Unknown code for Intl: fall back to the English name.
  }
  return language.name;
};

const MAGHREB_CODES = new Set([
  'ary', 'rif', 'shi', 'zgh', 'tzm', 'ar-MA', 'arq', 'kab', 'ber-DZ', 'shy', 'cnu', 'mzb', 'thv',
  'aeb', 'ar-TN', 'jbn', 'ber', 'ar',
]);

const optionOf = (language) => {
  const french = frenchLanguageName(language);
  const label = normalize(french) === normalize(language.native) ? french : `${french} — ${language.native}`;
  return { code: language.code, label, french };
};

// Grouped options for the language menu: Maghreb and Arabic first, then the rest A→Z.
export const TUTOR_LANGUAGE_GROUPS = [
  {
    label: 'Arabe, darija et amazigh',
    options: LANGUAGES.filter((l) => MAGHREB_CODES.has(l.code)).map(optionOf),
  },
  {
    label: 'Toutes les langues',
    options: LANGUAGES.filter((l) => !MAGHREB_CODES.has(l.code))
      .map(optionOf)
      .sort((a, b) => a.french.localeCompare(b.french, 'fr')),
  },
];

const ALIAS_LIST = (() => {
  const list = [];
  const add = (alias, code) => {
    const value = normalize(alias).trim();
    if (value.length >= 3) list.push({ alias: value, code });
  };
  LANGUAGES.forEach((language) => {
    add(frenchLanguageName(language).replace(/\(.*?\)/g, ''), language.code);
    add(language.name.replace(/\(.*?\)/g, ''), language.code);
  });
  Object.entries(ALIASES).forEach(([code, aliases]) => aliases.forEach((alias) => add(alias, code)));
  return list;
})();

// "je veux apprendre le rifain", "apprends-moi l'espagnol", "teach me Turkish"…
const LEARN_REQUEST = /(appr?e\s*n\s*d|enseign|learn|teach|\bcours (de|d )|\blecons? (de|d ))/;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const detectRequestedLanguage = (text, currentCode) => {
  const value = normalize(text);
  const request = LEARN_REQUEST.exec(value);
  if (!request) return null;
  const after = value.slice(request.index);
  let best = null;
  ALIAS_LIST.forEach(({ alias, code }) => {
    const match = new RegExp(`(^|[^a-z])${escapeRegExp(alias)}($|[^a-z])`).exec(after);
    if (!match) return;
    const position = match.index;
    // The language must follow the request closely ("apprendre le rifain").
    if (position > 40) return;
    if (!best || position < best.position || (position === best.position && alias.length > best.alias.length)) {
      best = { position, alias, code };
    }
  });
  if (!best || best.code === currentCode) return null;
  return best.code;
};
