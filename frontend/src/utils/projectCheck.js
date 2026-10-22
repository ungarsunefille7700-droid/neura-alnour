// Checks a generated web project before the user runs it, the way a developer would:
// every element the JavaScript looks up must exist in the HTML, every local CSS/JS file
// the page loads must be in the project, and each JavaScript file must parse.
// Returns [{ file, message }] — empty when nothing wrong was found.

import { checkLua, manifestFiles } from './luaCheck';

const ID_LOOKUPS = [
  /getElementById\(\s*['"`]([\w-]+)['"`]\s*\)/g,
  /querySelector(?:All)?\(\s*['"`]#([\w-]+)['"`]\s*\)/g,
];

const htmlIds = (html) => new Set([...html.matchAll(/\bid\s*=\s*["']([\w-]+)["']/gi)].map((m) => m[1]));

// Ids the script creates itself (el.id = 'x', setAttribute('id', 'x'), id="x" in a template).
const createdIds = (js) => new Set([
  ...[...js.matchAll(/\.id\s*=\s*['"`]([\w-]+)['"`]/g)].map((m) => m[1]),
  ...[...js.matchAll(/setAttribute\(\s*['"`]id['"`]\s*,\s*['"`]([\w-]+)['"`]/g)].map((m) => m[1]),
  ...[...js.matchAll(/\bid\s*=\s*\\?["']([\w-]+)\\?["']/g)].map((m) => m[1]),
]);

const localRef = (ref) => ref && !/^(https?:)?\/\//i.test(ref) && !/^(data|blob):/i.test(ref);
const baseName = (path) => String(path || '').split(/[?#]/)[0].split('/').pop().toLowerCase();

const syntaxError = (code) => {
  if (/^\s*(import|export)\s/m.test(code)) return null; // ES modules: not checked here
  try {
    // Parses without running anything.
    // eslint-disable-next-line no-new-func
    new Function(code);
    return null;
  } catch (error) {
    return error instanceof SyntaxError ? error.message : null;
  }
};

// FiveM resources: every Lua file must be balanced, and every file the fxmanifest declares
// (scripts, ui_page, files) must be in the project.
const checkFiveM = (files, issues) => {
  files.filter((file) => /\.lua$/i.test(file.path)).forEach((file) => {
    checkLua(file.content).forEach((problem) => issues.push({ file: file.path, message: `erreur Lua : ${problem}` }));
  });
  const manifest = files.find((file) => /(^|\/)(fxmanifest|__resource)\.lua$/i.test(file.path));
  if (!manifest) {
    // Only a whole new resource (client AND server scripts) without manifest is reported: one modified
    // file sent back from an existing project keeps the manifest it already has.
    const luaFiles = files.filter((file) => /\.lua$/i.test(file.path));
    if (luaFiles.length >= 2 && files.some((file) => /\.lua$/i.test(file.path) && /\b(RegisterNetEvent|TriggerServerEvent|TriggerClientEvent|RegisterCommand|CreateThread|Citizen\.)/.test(file.content))) {
      issues.push({ file: 'fxmanifest.lua', message: 'manquant : une ressource FiveM ne démarre pas sans fxmanifest.lua' });
    }
    return;
  }
  const root = manifest.path.includes('/') ? manifest.path.slice(0, manifest.path.lastIndexOf('/') + 1) : '';
  const present = new Set(files.map((file) => file.path.toLowerCase()));
  manifestFiles(manifest.content).forEach((declared) => {
    if (!present.has(`${root}${declared}`.toLowerCase()) && !present.has(declared.toLowerCase())) {
      issues.push({ file: manifest.path, message: `déclare « ${declared} », qui n'existe pas dans le projet` });
    }
  });
  if (!/\bfx_version\b/.test(manifest.content)) issues.push({ file: manifest.path, message: 'fx_version manquant' });
  if (!/\bgames?\b/.test(manifest.content)) issues.push({ file: manifest.path, message: "« game 'gta5' » manquant" });
};

export const checkProject = (files) => {
  const issues = [];
  checkFiveM(files, issues);
  const pages = files.filter((file) => /\.html?$/i.test(file.path));
  const scripts = files.filter((file) => /\.(m?js)$/i.test(file.path));
  const names = new Set(files.map((file) => baseName(file.path)));
  if (!pages.length) return issues;

  pages.forEach((page) => {
    [...page.content.matchAll(/<link\b[^>]*href=["']([^"']+\.css)["']/gi),
      ...page.content.matchAll(/<script\b[^>]*src=["']([^"']+\.js)["']/gi)]
      .map((m) => m[1])
      .filter((ref) => localRef(ref) && !names.has(baseName(ref)))
      .forEach((ref) => issues.push({ file: page.path, message: `charge « ${ref} », qui n'existe pas dans le projet` }));
  });

  const ids = new Set(pages.flatMap((page) => [...htmlIds(page.content)]));
  scripts.forEach((script) => {
    const created = createdIds(script.content);
    const missing = new Set();
    ID_LOOKUPS.forEach((pattern) => {
      [...script.content.matchAll(pattern)].forEach((m) => {
        if (!ids.has(m[1]) && !created.has(m[1])) missing.add(m[1]);
      });
    });
    missing.forEach((id) => {
      const asClass = pages.some((page) => new RegExp(`class\\s*=\\s*["'][^"']*\\b${id}\\b`).test(page.content));
      issues.push({
        file: script.path,
        message: `cherche l'élément id="${id}", absent du HTML${asClass ? ` (le HTML a seulement class="${id}")` : ''}`,
      });
    });
    const error = syntaxError(script.content);
    if (error) issues.push({ file: script.path, message: `erreur de syntaxe JavaScript : ${error}` });
  });
  return issues;
};

// What to re-check, only for the languages really in the project (or named by the errors).
const FIX_CHECKS = [
  { kind: 'web', test: (paths) => paths.some((p) => /\.(html?|m?js|jsx)$/i.test(p)) || paths.includes('page'),
    text: 'chaque id utilisé par le JavaScript existe dans le HTML, chaque fichier chargé par la page est fourni et la page s\'exécute sans erreur dans la console' },
  { kind: 'css', test: (paths) => paths.some((p) => /\.css$/i.test(p)),
    text: 'chaque fichier CSS chargé par la page est fourni et ses sélecteurs correspondent au HTML' },
  { kind: 'python', test: (paths) => paths.some((p) => /\.py$/i.test(p) || /\.py::|^python$/i.test(p)),
    text: 'le code Python compile, ses imports existent (bibliothèque standard ou dépendances déclarées) et les tests passent vraiment : corrige le code plutôt que d\'affaiblir les tests, sauf si un test est lui-même faux' },
  { kind: 'fivem', test: (paths) => paths.some((p) => /(^|\/)(fxmanifest|__resource)\.lua$/i.test(p)),
    text: 'chaque fichier déclaré dans fxmanifest.lua est fourni, avec fx_version et game' },
  { kind: 'lua', test: (paths) => paths.some((p) => /\.lua$/i.test(p)),
    text: 'chaque bloc Lua (function, if, for, while, do) est bien fermé par « end »' },
];

// The message sent to the AI to fix the project: the errors really found, then only the
// checks that concern its languages (no Lua advice for a Python project).
export const fixRequest = (issues, files = []) => {
  const paths = [...files.map((file) => file.path), ...issues.map((issue) => issue.file)];
  const checks = FIX_CHECKS.filter((check) => check.test(paths)).map((check) => check.text);
  return [
    'Le projet que tu viens de créer a des erreurs détectées par la vérification automatique :',
    ...issues.map((issue) => `- ${issue.file} : ${issue.message}`),
    'Corrige-les et renvoie TOUS les fichiers du projet complets et corrigés (chacun avec sa ligne « Fichier: »), '
    + 'en respectant toutes les consignes de la demande d\'origine de l\'utilisateur (ce qu\'il a imposé ne change pas : '
    + 'si une consigne rend la correction impossible, dis-le clairement).'
    + (checks.length ? ` Vérifie ensuite que ${checks.join(' ; que ')}.` : ''),
  ].join('\n');
};
