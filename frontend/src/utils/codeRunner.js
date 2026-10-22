// Real execution of generated code, in the user's browser, isolated:
// - web pages: a sandboxed frame (no access to the app, its storage or the account);
// - Python: Pyodide in a Web Worker, loaded only when needed, stopped after a time limit.
// Nothing here pretends: what could not be run is reported as « non testé ».
import { previewHtml } from './codeFiles';
import { checkProject } from './projectCheck';

export const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
export const LIMITS = { webMs: 4000, pythonLoadMs: 90000, pythonRunMs: 20000 };

// Injected first in the page: reports every error and console.error to the app.
export const MONITOR = `<script>(function(){
  var send=function(kind,text){try{parent.postMessage({__neuraRun:1,kind:kind,text:String(text).slice(0,300)},'*');}catch(e){}};
  window.addEventListener('error',function(e){send('error',(e.message||'erreur')+(e.lineno?' (ligne '+e.lineno+')':''));});
  window.addEventListener('unhandledrejection',function(e){send('error','promesse rejetée : '+((e.reason&&e.reason.message)||e.reason));});
  var ce=console.error;console.error=function(){send('console',[].slice.call(arguments).join(' '));try{ce.apply(console,arguments);}catch(e){}};
  window.addEventListener('load',function(){setTimeout(function(){send('done','');},1200);});
})();<\/script>`;

export const withMonitor = (html) => (/<head[^>]*>/i.test(html)
  ? html.replace(/<head[^>]*>/i, (tag) => `${tag}${MONITOR}`)
  : `${MONITOR}${html}`);

// Runs a web project in a sandboxed frame and collects its real runtime errors.
export const runWebProject = (files, { timeoutMs = LIMITS.webMs } = {}) => new Promise((resolve) => {
  const html = previewHtml(files);
  if (!html) { resolve({ ran: false, reason: 'aucune page HTML' }); return; }
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts'); // opaque origin: no cookie, no storage, no app access
  frame.style.cssText = 'position:fixed;width:1024px;height:768px;left:-5000px;top:0;border:0;visibility:hidden';
  const errors = [];
  let finished = false;
  const finish = (loaded) => {
    if (finished) return;
    finished = true;
    window.removeEventListener('message', onMessage);
    frame.remove();
    resolve({ ran: true, loaded, errors: [...new Set(errors)] });
  };
  const onMessage = (event) => {
    if (event.source !== frame.contentWindow || !event.data || !event.data.__neuraRun) return;
    if (event.data.kind === 'done') finish(true);
    else errors.push(event.data.text);
  };
  window.addEventListener('message', onMessage);
  frame.srcdoc = withMonitor(html);
  document.body.appendChild(frame);
  setTimeout(() => finish(false), timeoutMs);
});

// The Python harness run inside Pyodide: every file is compiled; tests (test_*.py files or
// test_* functions, unittest classes) are run; scripts are never run (they may wait for input).
export const PYTHON_HARNESS = `
import sys, json, traceback, importlib, unittest, inspect, builtins, io
sys.path.insert(0, '/projet')
def _no_input(*a, **k):
    raise RuntimeError("input() n'est pas disponible pendant les tests")
builtins.input = _no_input
# what the browser sandbox cannot do (not a bug of the code: reported as « non testé »)
ENV_LIMITS = ("can't start new thread", "unknown url type", "does not support processes", "Errno 138", "Errno 50", "Protocol not available")
def _frames(e):
    return traceback.extract_tb(e.__traceback__)
def _env_limit(e, text):
    if any(k in text for k in ENV_LIMITS):
        return True
    return isinstance(e, OSError) and any(f.filename.endswith('socket.py') for f in _frames(e))
def _describe(e):
    msg = str(e)
    own = [f for f in _frames(e) if f.filename.startswith('/projet/')]
    where = ''
    if own:
        f = own[-1]
        where = f" ({f.filename[len('/projet/'):]} ligne {f.lineno} : {(f.line or '').strip()[:120]})"
    return f"{type(e).__name__}{' : ' + msg if msg else ''}{where}"[:300]
def _failed(name, e):
    text = _describe(e)
    if _env_limit(e, text):
        return {"name": name, "ok": None, "env": text}
    return {"name": name, "ok": False, "error": text}
def _unittest_failed(case, err):
    lines = err.strip().splitlines()
    where = ''
    for i, line in enumerate(lines):
        if '"/projet/' in line and i + 1 < len(lines):
            where = f" ({line.split('/projet/')[1].split(chr(34))[0]} ligne {line.split('line ')[-1].split(',')[0]} : {lines[i + 1].strip()[:120]})"
    text = (lines[-1] + where)[:300]
    if any(k in err for k in ENV_LIMITS):
        return {"name": str(case), "ok": None, "env": text}
    return {"name": str(case), "ok": False, "error": text}
result = {"compiled": [], "syntax_errors": [], "tests": [], "import_errors": []}
for path in FILES:
    src = open('/projet/' + path, encoding='utf-8').read()
    try:
        compile(src, path, 'exec')
        result["compiled"].append(path)
    except SyntaxError as e:
        result["syntax_errors"].append(f"{path} ligne {e.lineno} : {e.msg}")
for path in [p for p in FILES if p in result["compiled"]]:
    module_name = path[:-3].replace('/', '.')
    is_test = path.split('/')[-1].startswith('test_') or path.endswith('_test.py')
    if not is_test:
        continue
    before = len(result["tests"])
    try:
        module = importlib.import_module(module_name)
    except AssertionError as e:
        # a test script with plain asserts: importing it IS running it
        result["tests"].append(_failed(f"{path} (script de test)", e))
        continue
    except Exception as e:
        entry = _failed(path, e)
        if entry["ok"] is None:
            result["tests"].append(entry)
        else:
            result["import_errors"].append(f"{path} : {entry['error']}")
        continue
    for name, fn in inspect.getmembers(module, inspect.isfunction):
        if name.startswith('test') and fn.__module__ == module.__name__:
            try:
                fn()
                result["tests"].append({"name": f"{path}::{name}", "ok": True})
            except Exception as e:
                result["tests"].append(_failed(f"{path}::{name}", e))
    suite = unittest.defaultTestLoader.loadTestsFromModule(module)
    if suite.countTestCases():
        stream = io.StringIO()
        run = unittest.TextTestRunner(stream=stream, verbosity=0).run(suite)
        for case, err in run.failures + run.errors:
            result["tests"].append(_unittest_failed(case, err))
        ok = run.testsRun - len(run.failures) - len(run.errors)
        result["tests"].extend({"name": f"{path}::unittest", "ok": True} for _ in range(ok))
    if len(result["tests"]) == before:
        result["tests"].append({"name": f"{path} (script de test)", "ok": True})
json.dumps(result)
`;

const WORKER_SOURCE = (url) => `
let pyodide = null;
self.onmessage = async (event) => {
  const { files, harness } = event.data;
  try {
    if (!pyodide) { importScripts('${url}pyodide.js'); pyodide = await loadPyodide({ indexURL: '${url}' }); self.postMessage({ loaded: true }); }
    try { pyodide.FS.mkdir('/projet'); } catch (e) {}
    const names = [];
    for (const file of files) {
      const parts = file.path.split('/');
      let dir = '/projet';
      for (const part of parts.slice(0, -1)) { dir += '/' + part; try { pyodide.FS.mkdir(dir); } catch (e) {} }
      pyodide.FS.writeFile('/projet/' + file.path, file.content);
      names.push(file.path);
    }
    // the packages Pyodide provides (pytest, numpy…) are loaded only if the code imports them
    try { await pyodide.loadPackagesFromImports(files.map((file) => file.content).join('\\n')); } catch (e) {}
    pyodide.globals.set('FILES', pyodide.toPy(names));
    const out = await pyodide.runPythonAsync(harness);
    self.postMessage({ result: JSON.parse(out) });
  } catch (error) {
    self.postMessage({ error: String(error && error.message || error).slice(0, 400) });
  }
};`;

// Runs the Python files of a project in Pyodide (downloaded only now, ~10 MB the first time).
export const runPython = (files, { loadMs = LIMITS.pythonLoadMs, runMs = LIMITS.pythonRunMs } = {}) => new Promise((resolve) => {
  const py = files.filter((file) => /\.py$/i.test(file.path) && !/(^|\/)\.\.(\/|$)/.test(file.path));
  if (!py.length) { resolve({ ran: false, reason: 'aucun fichier Python' }); return; }
  if (typeof Worker === 'undefined') { resolve({ ran: false, reason: 'exécution Python non disponible dans ce navigateur' }); return; }
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE(PYODIDE_URL)], { type: 'text/javascript' }));
  const worker = new Worker(url);
  let timer = setTimeout(() => stop({ ran: false, reason: 'Python n’a pas pu être chargé à temps' }), loadMs);
  const stop = (value) => {
    clearTimeout(timer);
    worker.terminate();
    URL.revokeObjectURL(url);
    resolve(value);
  };
  worker.onmessage = (event) => {
    if (event.data.loaded) {
      clearTimeout(timer);
      timer = setTimeout(() => stop({ ran: true, timeout: true, errors: [`exécution arrêtée après ${runMs / 1000} s (boucle infinie ?)`] }), runMs);
    } else if (event.data.error) stop({ ran: true, errors: [event.data.error] });
    else stop({ ran: true, ...event.data.result });
  };
  worker.onerror = (event) => stop({ ran: false, reason: event.message || 'erreur du moteur Python' });
  worker.postMessage({ files: py.map(({ path, content }) => ({ path, content })), harness: PYTHON_HARNESS });
});

// Every check that can really run here, and the exact list of what could not.
export const verifyProject = async (files, { runWeb = runWebProject, runPy = runPython } = {}) => {
  const issues = checkProject(files).map((issue) => ({ ...issue, source: 'vérification' }));
  const report = { static: true, web: null, python: null, notTested: [] };
  if (files.some((file) => /\.html?$/i.test(file.path))) {
    report.web = await runWeb(files);
    if (report.web.ran) report.web.errors.forEach((text) => issues.push({ file: 'page', message: `erreur à l'exécution : ${text}`, source: 'exécution' }));
  }
  if (files.some((file) => /\.py$/i.test(file.path))) {
    report.python = await runPy(files);
    const p = report.python;
    if (p.ran) {
      (p.syntax_errors || []).forEach((text) => issues.push({ file: 'python', message: `erreur de syntaxe : ${text}`, source: 'exécution' }));
      (p.import_errors || []).forEach((text) => issues.push({ file: 'python', message: `import impossible : ${text}`, source: 'exécution' }));
      (p.tests || []).filter((t) => t.ok === false).forEach((t) => issues.push({ file: t.name, message: `test échoué : ${t.error}`, source: 'tests' }));
      const sandboxed = (p.tests || []).filter((t) => t.ok === null);
      if (sandboxed.length) report.notTested.push(`Python : ${sandboxed.length} test(s) impossible(s) dans le navigateur (réseau, threads ou processus) — ${sandboxed[0].env}`);
      (p.errors || []).forEach((text) => issues.push({ file: 'python', message: text, source: 'exécution' }));
    } else report.notTested.push(`Python : ${p.reason}`);
  }
  if (files.some((file) => /\.lua$/i.test(file.path))) report.notTested.push('FiveM : test en jeu impossible ici (il faut un serveur FiveM) — syntaxe Lua et manifest vérifiés');
  const other = files.filter((file) => /\.(c|cpp|cs|java|kt|go|rs|swift|dart|php|rb)$/i.test(file.path));
  if (other.length) report.notTested.push(`${[...new Set(other.map((f) => f.path.split('.').pop()))].join(', ')} : compilation non disponible ici`);
  return { issues, report };
};

// What the note under the answer says, from the real results.
export const verificationSummary = ({ issues, report }) => {
  const parts = ['contrôles statiques faits'];
  if (report.web?.ran) parts.push(report.web.errors.length ? `page exécutée : ${report.web.errors.length} erreur(s)` : 'page exécutée sans erreur');
  if (report.python?.timeout) parts.push(`Python arrêté après ${LIMITS.pythonRunMs / 1000} s (limite de temps)`);
  else if (report.python?.ran) {
    const tests = (report.python.tests || []).filter((t) => t.ok !== null);
    const passed = tests.filter((t) => t.ok).length;
    parts.push(`Python compilé (${(report.python.compiled || []).length} fichier(s))${tests.length ? ` · tests ${passed}/${tests.length} réussis` : (report.python.import_errors || []).length ? ' · tests non lancés (import impossible)'
      : (report.python.tests || []).length ? ' · tests non exécutables dans le navigateur' : ' · aucun test fourni'}`);
  }
  return { ok: issues.length === 0, text: parts.join(' · '), notTested: report.notTested };
};

export const MAX_AUTO_FIXES = 3;

// The user clearly asked to keep an error (an exercise, a bug to explain…): no automatic
// correction then. The word « erreur » alone is not enough — the intention must be stated.
const KEEP_ERROR = [
  /\b(c'?est|erreurs?|bugs?|fautes?|oublis?)\s+((est|sont|etait|etaient)\s+)?(faite?s?\s+)?(voulue?s?|volontaires?|intentionnel(le)?s?|expres)\b/,
  /\b(volontairement|intentionnellement|expres|deliberement)\b[^.!?]{0,60}\b(erreurs?|bugs?|fautes?|cass\w*|manqu\w*|n'existe pas|incorrect\w*|faux|fausse)\b/,
  /\b(erreurs?|bugs?|fautes?|cass\w*|manqu\w*|n'existe pas|incorrect\w*|faux|fausse)\b[^.!?]{0,60}\b(volontairement|intentionnellement|expres|deliberement)\b/,
  /\b(faite?s?|mise?s?|laissee?s?)\s+(expres|volontairement)\b(?!\s+pour)/,
  /\bne\s+(l'|le\s+|la\s+|les\s+)?(corrige|repare)\w*\s+(pas|rien|surtout pas)\b(?!\s+(seulement|que|juste|uniquement))/,
  /\bne\s+corrige\w*\s+(pas|rien)\b(?!\s+(seulement|que|juste|uniquement))/,
  /\bsans\s+(rien\s+)?(le\s+|la\s+|les\s+)?(corriger|reparer)\b/,
  /\b(garde|laisse|conserve)[sz]?\s+(l'|les\s+|cette\s+|ces\s+|le\s+|la\s+)(erreurs?|bugs?|fautes?)\b/,
  /\b(on purpose|intentionally|deliberately|don'?t fix|do not fix|keep the (bug|error|mistake)s?)\b/,
];

export const keepsErrorsOnPurpose = (text) => {
  const plain = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'");
  return KEEP_ERROR.some((pattern) => pattern.test(plain));
};
