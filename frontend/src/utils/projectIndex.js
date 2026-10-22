// Project workshop: inventory of an archive, scopes chosen by the user, search in the code,
// links between files, and the context given to the AI within the budget of the reasoning
// level. Everything runs in the browser; only the context finally built is sent with a message.

// Context ceilings per reasoning level (validated on 2026-10-17). A ceiling, never a target:
// a targeted question only sends the files it concerns.
export const CONTEXT_TOKENS = { instant: 6000, medium: 12000, high: 24000, very_high: 48000, auto: 12000 };
export const tokensOf = (text) => Math.ceil(String(text || '').length / 3.5);

const EXT = (path) => (String(path).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
const CODE = new Set(['lua', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'php', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'dart', 'rb', 'scala', 'vue', 'svelte', 'sql', 'sh', 'bash', 'ps1', 'bat', 'gd', 'r', 'm', 'pl', 'ex', 'exs', 'erl', 'hs', 'fs', 'vb', 'groovy', 'gradle', 'html', 'htm', 'css', 'scss', 'sass', 'less']);
const CONFIG = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'xml', 'properties', 'lock', 'gitignore', 'dockerfile', 'editorconfig']);
const DOC = new Set(['md', 'txt', 'rst', 'csv', 'log', 'tex']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tga', 'dds', 'psd']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']);
const AUDIO = new Set(['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus']);
// Folders listed in the inventory but not read by default (dependencies, builds, history).
export const IGNORED_DIRS = /(^|\/)(node_modules|\.git|dist|build|out|\.next|vendor|__pycache__|\.venv|venv|target|bin|obj|\.idea|\.vscode|coverage)\//i;

export const fileKind = (path) => {
  const ext = EXT(path);
  const base = String(path).split('/').pop().toLowerCase();
  if (base === 'dockerfile' || base === 'makefile' || base === '.env.example') return 'config';
  if (CODE.has(ext)) return 'code';
  if (CONFIG.has(ext)) return 'config';
  if (DOC.has(ext)) return 'doc';
  if (IMAGE.has(ext)) return 'image';
  if (VIDEO.has(ext)) return 'video';
  if (AUDIO.has(ext)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'rpf'].includes(ext)) return 'archive';
  return ext ? 'binary' : 'text';
};
export const isReadable = (entry) => ['code', 'config', 'doc', 'text'].includes(fileKind(entry.path));
export const extensionOf = EXT;

// Top folders with their number of files (to choose a scope).
export const folderSummary = (entries) => {
  const folders = new Map();
  entries.forEach((entry) => {
    const parts = entry.path.split('/');
    const top = parts.length > 1 ? parts.slice(0, Math.min(parts.length - 1, 2)).join('/') : '(racine)';
    const row = folders.get(top) || { folder: top, files: 0, bytes: 0 };
    row.files += 1;
    row.bytes += entry.size;
    folders.set(top, row);
  });
  return [...folders.values()].sort((a, b) => a.folder.localeCompare(b.folder));
};

// The files of the scope asked by the user — always from the inventory sorted by path, so
// « files 100 to 250 » or « the first half » mean the same thing each time.
export const selectScope = (entries, scope = { mode: 'all' }) => {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const readable = scope.includeIgnored ? sorted : sorted.filter((entry) => !IGNORED_DIRS.test(`${entry.path}`));
  switch (scope.mode) {
    case 'half': {
      if (scope.basis === 'volume') {
        const total = readable.reduce((sum, entry) => sum + entry.size, 0);
        let acc = 0;
        const firstHalf = readable.filter((entry) => { acc += entry.size; return acc - entry.size < total / 2; });
        return scope.half === 'second' ? readable.filter((entry) => !firstHalf.includes(entry)) : firstHalf;
      }
      const middle = Math.ceil(readable.length / 2);
      return scope.half === 'second' ? readable.slice(middle) : readable.slice(0, middle);
    }
    case 'folders': {
      const folders = (scope.folders || []).map((folder) => folder.replace(/^\/+|\/+$/g, '').toLowerCase()).filter(Boolean);
      return readable.filter((entry) => folders.some((folder) => entry.path.toLowerCase() === folder
        || entry.path.toLowerCase().startsWith(`${folder}/`) || entry.path.toLowerCase().includes(`/${folder}/`)));
    }
    case 'types': {
      const types = (scope.types || []).map((type) => type.replace(/^\./, '').toLowerCase());
      return readable.filter((entry) => types.includes(EXT(entry.path)));
    }
    case 'range': {
      const from = Math.max(1, Number(scope.from) || 1);
      const to = Math.min(readable.length, Number(scope.to) || readable.length);
      return readable.slice(from - 1, to);
    }
    default:
      return readable;
  }
};

const plain = (text) => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['les', 'des', 'une', 'pour', 'avec', 'dans', 'que', 'qui', 'est', 'sont', 'mon', 'mes', 'ton', 'tes', 'son', 'ses', 'sur', 'par', 'pas', 'plus', 'tout', 'tous', 'fais', 'fait', 'moi', 'refais', 'corrige', 'ajoute', 'explique', 'analyse', 'fichier', 'fichiers', 'projet', 'script', 'code', 'the', 'and', 'this', 'that', 'quoi', 'comment', 'pourquoi', 'peux', 'veux', 'stp']);
export const queryTerms = (question) => [...new Set(plain(question).match(/[a-z0-9_]{3,}/g) || [])].filter((term) => !STOP.has(term));

// Relevance of each read file for a question (name first, then content).
export const rankFiles = (question, texts, paths) => {
  const terms = queryTerms(question);
  if (!terms.length) return [];
  return paths.map((path) => {
    const name = plain(path);
    const body = plain(texts.get(path) || '');
    let score = 0;
    const lines = [];
    terms.forEach((term) => {
      if (name.includes(term)) score += 8;
      let count = 0;
      let at = body.indexOf(term);
      while (at >= 0 && count < 50) { count += 1; at = body.indexOf(term, at + term.length); }
      if (count) score += 1 + Math.log2(1 + count);
    });
    if (score > 0) {
      const raw = String(texts.get(path) || '').split('\n');
      raw.forEach((line, index) => {
        if (lines.length < 3 && terms.some((term) => plain(line).includes(term))) lines.push({ line: index + 1, text: line.trim().slice(0, 160) });
      });
    }
    return { path, score: Math.round(score * 10) / 10, lines };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score);
};

// Links between files: requires/imports, files loaded by HTML, files declared by a fxmanifest.
export const fileLinks = (path, text) => {
  const found = new Set();
  const patterns = [
    /require\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\s+(?:[^'"]*\sfrom\s+)?['"]([^'"]+)['"]/g,
    /<script[^>]+src=["']([^"']+)["']/gi, /<link[^>]+href=["']([^"']+\.css)["']/gi,
    /^\s*(?:from|import)\s+([\w.]+)/gm,
  ];
  patterns.forEach((pattern) => { [...String(text).matchAll(pattern)].forEach((m) => found.add(m[1])); });
  if (/fxmanifest\.lua$|__resource\.lua$/i.test(path)) {
    [...String(text).matchAll(/['"]([^'"]+\.(?:lua|js|html?|css|json))['"]/gi)].forEach((m) => found.add(m[1]));
  }
  return [...found].slice(0, 40);
};

const DEFINITIONS = [
  /^\s*(?:local\s+)?function\s+([\w.:]+)/, /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
  /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/, /^\s*(?:export\s+)?class\s+(\w+)/,
  /^\s*(?:async\s+)?def\s+(\w+)/, /\b(RegisterNetEvent|RegisterServerEvent|AddEventHandler|RegisterCommand|RegisterNUICallback|exports)\s*\(\s*['"]([^'"]+)['"]/,
  /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)/i, /^\s*(?:@app|@router|@api_router)\.(?:get|post|put|delete|patch)\(\s*['"]([^'"]+)/,
  /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:class|interface|struct|enum)\s+(\w+)/,
];

export const outlineOf = (content, max = 10) => {
  const found = [];
  for (const line of String(content).split('\n')) {
    for (const pattern of DEFINITIONS) {
      const m = line.match(pattern);
      if (m) {
        const name = m[2] ? `${m[1]} ${m[2]}` : m[1];
        if (!found.includes(name)) found.push(name);
        break;
      }
    }
    if (found.length >= max) break;
  }
  return found;
};

// Numbered passages (±25 lines) around the lines that contain the question's words.
export const excerptsOf = (content, question, budgetTokens) => {
  const terms = queryTerms(question);
  if (!terms.length) return '';
  const lines = String(content).split('\n');
  const hits = [];
  lines.forEach((line, index) => {
    const low = plain(line);
    const weight = terms.filter((term) => low.includes(term)).length;
    if (weight) hits.push({ index, weight });
  });
  if (!hits.length) return '';
  hits.sort((a, b) => b.weight - a.weight || a.index - b.index);
  const windows = [];
  hits.forEach(({ index }) => {
    const start = Math.max(0, index - 25);
    const end = Math.min(lines.length, index + 26);
    if (!windows.some((w) => start < w.end && end > w.start)) windows.push({ start, end });
  });
  let out = '';
  for (const w of windows.sort((a, b) => a.start - b.start)) {
    const part = lines.slice(w.start, w.end).map((line, i) => `${w.start + i + 1}| ${line}`).join('\n');
    if (tokensOf(out + part) > budgetTokens) break;
    out += `${out ? '\n…\n' : ''}${part}`;
  }
  return out;
};

const KEY_FILE =/(^|\/)(fxmanifest\.lua|__resource\.lua|package\.json|requirements\.txt|pyproject\.toml|composer\.json|cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|readme\.md|config\.lua|shared\/config\.lua|docker-compose\.ya?ml|dockerfile|tsconfig\.json|vite\.config\.\w+|next\.config\.\w+)$/i;

// Does the question concern the whole scope (« analyse / explique / refais le projet ») or a
// precise point (« corrige le bug du garage ») ?
export const asksForWholeScope = (question) => /\b(tout|entier|entiere|complet|complete|ensemble|global|architecture|structure|refais|reconstrui\w*|recree\w*|analyse\w*|resume\w*|explique\w* (le|ce|mon) (projet|script|zip)|comprend\w*|audit\w*|documente\w*)\b/.test(plain(question));

// The context sent to the AI: summary + tree + the most useful files, within `budgetTokens`.
// Returns the text and an exact report of what is included.
export const buildProjectContext = ({ archiveName, entries, selected, texts, question, budgetTokens }) => {
  const budget = Math.max(1500, budgetTokens);
  const readablePaths = selected.filter((entry) => texts.has(entry.path)).map((entry) => entry.path);
  const ranked = rankFiles(question, texts, readablePaths);
  const whole = asksForWholeScope(question) || !ranked.length;
  const key = readablePaths.filter((path) => KEY_FILE.test(path));
  const order = [...new Set([...key, ...ranked.map((row) => row.path), ...(whole ? readablePaths : [])])];
  const header = [
    `ATELIER DE PROJET — archive « ${archiveName} » : ${entries.length} fichiers au total, ${selected.length} dans le périmètre choisi, ${readablePaths.length} lus.`,
    'Fichiers du périmètre (chemin · taille) :',
  ];
  const treeLines = selected.slice(0, 400).map((entry) => `- ${entry.path} · ${entry.size} o`);
  if (selected.length > 400) treeLines.push(`- … et ${selected.length - 400} autres fichiers (non listés ici)`);
  let text = `${header.join('\n')}\n${treeLines.join('\n')}\n`;
  const report = { full: [], partial: [], listed: selected.length, ranked: ranked.slice(0, 20), whole };
  for (const path of order) {
    const content = texts.get(path) || '';
    const links = fileLinks(path, content);
    const block = `\n=== FICHIER ${path}${links.length ? ` (liens : ${links.join(', ')})` : ''} ===\n`;
    // A question about the whole project keeps 30 % of the budget for the map of the others.
    const left = (whole ? budget * 0.7 : budget) - tokensOf(text) - tokensOf(block) - 50;
    if (left <= 200) break;
    if (tokensOf(content) <= left) {
      text += block + content + '\n';
      report.full.push(path);
      continue;
    }
    // Too big: the passages around the words of the question (numbered lines), so that one
    // huge file does not take the place of all the others.
    const share = Math.min(left, Math.max(800, Math.floor(budget / 4)));
    const excerpt = excerptsOf(content, question, share);
    if (excerpt) {
      text += `${block}${excerpt}\n[extraits seulement : fichier de ${tokensOf(content)} jetons]\n`;
      report.partial.push(path);
    } else if (left > 600) {
      const cut = content.slice(0, Math.floor(Math.min(left, share) * 3.5));
      text += `${block}${cut}\n[… début seulement : ${tokensOf(content) - tokensOf(cut)} jetons non inclus]\n`;
      report.partial.push(path);
    }
  }
  // The map of the files that did not fit: their definitions (functions, events, commands,
  // classes, tables), so the whole architecture is seen even when everything cannot be sent.
  const sent = new Set([...report.full, ...report.partial]);
  const rest = readablePaths.filter((path) => !sent.has(path));
  report.outlined = [];
  if (rest.length) {
    let outline = '\nPLAN DES AUTRES FICHIERS LUS (définitions seulement, contenu non transmis) :\n';
    for (const path of rest) {
      const defs = outlineOf(texts.get(path) || '');
      const row = `- ${path}${defs.length ? ` : ${defs.join(' · ')}` : ''}\n`;
      if (tokensOf(text + outline + row) > budget - 80) break;
      outline += row;
      report.outlined.push(path);
    }
    if (report.outlined.length) text += outline;
  }
  const missing = order.length - report.full.length - report.partial.length - report.outlined.filter((p) => order.includes(p)).length;
  text += `\nCOUVERTURE : ${report.full.length} fichier(s) donnés en entier, ${report.partial.length} en partie, ${missing > 0 ? `${missing} fichier(s) lus mais non transmis faute de place` : 'aucun fichier utile laissé de côté'}. `
    + 'Ne prétends jamais avoir lu un fichier qui n\'est pas donné ci-dessus en entier ; si un fichier manque pour répondre, dis lequel.';
  report.tokens = tokensOf(text);
  report.missing = Math.max(0, missing);
  return { text, report };
};
