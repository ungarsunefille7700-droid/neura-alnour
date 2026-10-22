// Turns the files written by the AI into a downloadable .zip, entirely in the browser.
// The AI announces each file with a line « Fichier: chemin/fichier.ext » (other usual
// forms are accepted too) right before its code block.

const FENCE = /^(\s*)(```|~~~)([^\n]*)\n([\s\S]*?)\n\1\2[ \t]*$/gm;
const PATH_LINE = /^\s*(?:[-*>#]+\s*)*(?:\*\*|__)?\s*(?:📄|🗂️|📁)?\s*(?:(?:fichier|file|chemin|path)\s*[:：-]\s*)?(?:\*\*|__)?\s*`?([^`*\s][^`*]*?)`?\s*(?:\*\*|__)?\s*:?\s*$/i;
const KNOWN_NAMES = /^(dockerfile|makefile|procfile|readme|license|\.env\.example|\.gitignore|\.dockerignore|\.editorconfig)$/i;

const EXTENSIONS = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx',
  html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yml', yml: 'yml', sql: 'sql', bash: 'sh',
  sh: 'sh', shell: 'sh', powershell: 'ps1', ps1: 'ps1', php: 'php', java: 'java', kotlin: 'kt', swift: 'swift',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', cs: 'cs', go: 'go', rust: 'rs', lua: 'lua', ruby: 'rb',
  markdown: 'md', md: 'md', xml: 'xml', toml: 'toml', ini: 'ini', dockerfile: 'Dockerfile', vue: 'vue', dart: 'dart',
};

// A safe relative path inside the archive, or null.
export const cleanPath = (value) => {
  const path = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
  // No drive letters (C:/…), no characters forbidden in file names.
  if (!path || path.length > 200 || /[<>:"|?*\u0000-\u001f]/.test(path)) return null;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  const name = parts[parts.length - 1];
  if (!/\.[\w-]+$/.test(name) && !KNOWN_NAMES.test(name)) return null;
  if (/\s/.test(name)) return null;
  return path;
};

const pathFromInfo = (info) => {
  const match = /(?:title|file|filename|path)\s*=\s*["']?([^"'\s]+)/i.exec(info) || /^[\w+#.-]+:(\S+)$/.exec(info.trim());
  return match ? cleanPath(match[1]) : null;
};

// A file name for code written without one (« main.py », « index.html »…).
export const defaultFileName = (language, taken = new Set()) => {
  const ext = EXTENSIONS[String(language || '').toLowerCase()] || 'txt';
  const base = ext === 'Dockerfile' ? 'Dockerfile' : ({ html: 'index', css: 'style', js: 'script', py: 'main' }[ext] || 'fichier');
  let name = ext === 'Dockerfile' ? base : `${base}.${ext}`;
  for (let n = 2; taken.has(name); n += 1) name = ext === 'Dockerfile' ? `${base}-${n}` : `${base}-${n}.${ext}`;
  taken.add(name);
  return name;
};

// [{ path, content }] in order of appearance; a file written twice keeps its last version.
export const extractCodeFiles = (markdown) => {
  const text = String(markdown || '');
  const named = new Map();
  const unnamed = [];
  let match;
  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(text)) !== null) {
    const info = match[3].trim();
    const code = match[4];
    if (!code.trim()) continue; // eslint-disable-line no-continue
    let path = pathFromInfo(info);
    if (!path) {
      // The announcing line: the last non-empty line before the block.
      const before = text.slice(0, match.index).split('\n').map((line) => line.trim()).filter(Boolean);
      const last = before[before.length - 1] || '';
      const candidate = PATH_LINE.exec(last);
      if (candidate && (/fichier|file|chemin|path|📄/i.test(last) || /[`*#]/.test(last) || last.split(/\s+/).length === 1)) {
        path = cleanPath(candidate[1]);
      }
      // « Crée le fichier `src/main.py` : » — a file name in backticks inside a sentence.
      if (!path) {
        const quoted = [...last.matchAll(/`([^`\s]+)`/g)].map((item) => cleanPath(item[1])).filter(Boolean);
        if (quoted.length) path = quoted[quoted.length - 1];
      }
    }
    const language = info.split(/[\s:{]/)[0].toLowerCase();
    if (path) {
      named.delete(path);
      named.set(path, code);
    } else if (language && !['text', 'plaintext', 'console', 'output', 'log'].includes(language)) {
      unnamed.push({ language, content: code });
    }
  }
  if (named.size) return [...named].map(([path, content]) => ({ path, content: `${content}\n` }));
  // No file names: only a real multi-file answer becomes a project.
  if (unnamed.length < 2) return [];
  const used = new Map();
  return unnamed.map(({ language, content }) => {
    const ext = EXTENSIONS[language] || 'txt';
    const base = ext === 'Dockerfile' ? 'Dockerfile' : ({ html: 'index', css: 'style', js: 'script', py: 'main' }[ext] || 'fichier');
    const count = (used.get(base + ext) || 0) + 1;
    used.set(base + ext, count);
    const suffix = count > 1 ? `-${count}` : '';
    return { path: ext === 'Dockerfile' ? `Dockerfile${suffix}` : `${base}${suffix}.${ext}`, content: `${content}\n` };
  });
};

// The file announced by a line written just before a code block.
// `pure`: the line only names the file (« Fichier: app.py », « **style.css** »), so the
// file card can replace it; a sentence (« Crée le fichier `a.py` : ») stays visible.
const announcedPath = (line) => {
  const last = String(line || '').trim();
  if (!last) return { path: null, pure: false };
  const candidate = PATH_LINE.exec(last);
  if (candidate && (/fichier|file|chemin|path|📄/i.test(last) || /[`*#]/.test(last) || last.split(/\s+/).length === 1)) {
    const path = cleanPath(candidate[1]);
    if (path) return { path, pure: true };
  }
  const quoted = [...last.matchAll(/`([^`\s]+)`/g)].map((item) => cleanPath(item[1])).filter(Boolean);
  return { path: quoted.length ? quoted[quoted.length - 1] : null, pure: false };
};

// Splits an answer into text and code parts, for display:
// [{ type: 'text', text }, { type: 'code', path, language, code, lines, complete }].
// A code block still being written (no closing fence yet) has complete=false.
export const splitMessage = (markdown) => {
  const lines = String(markdown || '').split('\n');
  const parts = [];
  let text = [];
  const flushText = () => {
    const joined = text.join('\n');
    if (joined.trim()) parts.push({ type: 'text', text: joined });
    text = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      text.push(lines[i]);
      continue; // eslint-disable-line no-continue
    }
    const marker = open[2];
    const info = open[3].trim();
    const body = [];
    let complete = false;
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      if (lines[j].trim().startsWith(marker) && !lines[j].trim().slice(marker.length).trim()) {
        complete = true;
        break;
      }
      body.push(lines[j]);
    }
    let path = pathFromInfo(info);
    if (!path) {
      let k = text.length - 1;
      while (k >= 0 && !text[k].trim()) k -= 1;
      const found = announcedPath(text[k]);
      path = found.path;
      if (found.pure) text = text.slice(0, k);
    }
    flushText();
    const code = body.join('\n');
    parts.push({
      type: 'code',
      path,
      language: info.split(/[\s:{]/)[0].toLowerCase(),
      code,
      lines: code ? body.length : 0,
      complete,
    });
    i = j;
  }
  flushText();
  return parts;
};

// A single page to open a web project in a new tab: its CSS and JS files are put
// inline, so it works without a server. null when the project has no HTML page.
export const previewHtml = (files) => {
  const pages = files.filter((file) => /\.html?$/i.test(file.path));
  const page = pages.find((file) => /(^|\/)index\.html?$/i.test(file.path)) || pages[0];
  if (!page) return null;
  const byName = new Map(files.map((file) => [file.path.split('/').pop().toLowerCase(), file.content]));
  const find = (ref) => byName.get(String(ref || '').split(/[?#]/)[0].split('/').pop().toLowerCase());
  return page.content
    .replace(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (tag, href) => {
      const css = find(href);
      return css === undefined ? tag : `<style>\n${css}\n</style>`;
    })
    .replace(/<script\b([^>]*)\bsrc=["']([^"']+\.js)["']([^>]*)>\s*<\/script>/gi, (tag, before, src, after) => {
      const js = find(src);
      return js === undefined ? tag : `<script${before}${after}>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
    });
};

// ---- Minimal ZIP writer (no compression, UTF-8 names): no library needed. ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date) => ({
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
});

// Returns the archive bytes (Uint8Array) for [{ path, content }].
export const buildZip = (files, now = new Date()) => {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const chunks = [];
  const central = [];
  let offset = 0;
  files.forEach(({ path, content }) => {
    const name = encoder.encode(path);
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  all.forEach((part) => { out.set(part, position); position += part.length; });
  return out;
};

export const zipFileName = (now = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `neura-projet-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
};

export const downloadZip = (files) => {
  const blob = new Blob([buildZip(files)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = zipFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
