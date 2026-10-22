// Light Lua checker (Lua 5.4 / CfxLua for FiveM): blocks (function / if / for / while / do …
// end, repeat … until), brackets, strings and long comments must be closed. It catches the
// usual mistakes of generated FiveM scripts (a missing « end »…); it is not a full parser.
const LONG_OPEN = /^\[(=*)\[/;

export const checkLua = (code) => {
  const text = String(code || '');
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (text.startsWith('--', i)) {
      const long = text.slice(i + 2).match(LONG_OPEN);
      if (long) {
        const close = `]${long[1]}]`;
        const end = text.indexOf(close, i + 2 + long[0].length);
        if (end < 0) return [`ligne ${line} : commentaire long jamais fermé`];
        line += (text.slice(i, end).match(/\n/g) || []).length;
        i = end + close.length;
      } else {
        const end = text.indexOf('\n', i);
        i = end < 0 ? n : end;
      }
      continue;
    }
    const long = text.slice(i).match(LONG_OPEN);
    if (long) {
      const close = `]${long[1]}]`;
      const end = text.indexOf(close, i + long[0].length);
      if (end < 0) return [`ligne ${line} : chaîne longue jamais fermée`];
      line += (text.slice(i, end).match(/\n/g) || []).length;
      i = end + close.length;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j += 1;
        else if (text[j] === '\n') return [`ligne ${line} : chaîne jamais fermée`];
        j += 1;
      }
      if (j >= n) return [`ligne ${line} : chaîne jamais fermée`];
      i = j + 1;
      continue;
    }
    const word = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      const w = word[0];
      if (w === 'for' || w === 'while') stack.push([w, line]);
      else if (w === 'do') {
        if (stack.length && (stack[stack.length - 1][0] === 'for' || stack[stack.length - 1][0] === 'while')) {
          stack[stack.length - 1] = ['do', stack[stack.length - 1][1]];
        } else stack.push(['do', line]);
      } else if (w === 'function' || w === 'if' || w === 'repeat') stack.push([w, line]);
      else if (w === 'end') {
        const top = stack[stack.length - 1];
        if (!top || !['function', 'if', 'do'].includes(top[0])) return [`ligne ${line} : « end » en trop ou mal placé`];
        stack.pop();
      } else if (w === 'until') {
        if (!stack.length || stack[stack.length - 1][0] !== 'repeat') return [`ligne ${line} : « until » sans « repeat »`];
        stack.pop();
      }
      i += w.length;
      continue;
    }
    if ('([{'.includes(c)) stack.push([c, line]);
    else if (')]}'.includes(c)) {
      const top = stack[stack.length - 1];
      if (top && /^[a-z]/.test(top[0])) return [`ligne ${top[1]} : « ${top[0]} » jamais fermé par « end » (avant le « ${c} » de la ligne ${line})`];
      if (!top || top[0] !== pairs[c]) return [`ligne ${line} : « ${c} » sans ouverture correspondante`];
      stack.pop();
    }
    i += 1;
  }
  return stack.map(([kind, at]) => `ligne ${at} : « ${kind} » jamais fermé`);
};

// The files a fxmanifest.lua declares (scripts, ui_page, files), wildcards left aside.
export const manifestFiles = (manifest) => [...String(manifest || '').matchAll(/['"]([^'"]+\.(?:lua|js|html?|css|png|jpe?g|svg|json|ogg|mp3|ttf|woff2?))['"]/gi)]
  .map((m) => m[1])
  // « @ox_lib/init.lua » comes from another resource, and wildcards are not single files.
  .filter((path) => !path.startsWith('@') && !path.includes('*'))
  .map((path) => path.replace(/^\.?\//, ''));
