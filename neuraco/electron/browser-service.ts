import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BrowserWindow,
  dialog,
  nativeImage,
  session,
  WebContentsView
} from 'electron';
import type {
  NeuraCoBrowserAction,
  NeuraCoBrowserActionResult,
  NeuraCoBrowserAnnotation,
  NeuraCoBrowserAnnotationInput,
  NeuraCoBrowserBounds,
  NeuraCoBrowserCapture,
  NeuraCoBrowserDiagnosticIssue,
  NeuraCoBrowserDiagnostics,
  NeuraCoBrowserDownload,
  NeuraCoBrowserElement,
  NeuraCoBrowserEvent,
  NeuraCoBrowserHistoryEntry,
  NeuraCoBrowserState,
  NeuraCoBrowserTab
} from './ipc-contract';
import {
  buildBrowserDiagnostics,
  parseBrowserConsoleMessage,
  type BrowserDomSnapshot
} from './browser-diagnostics';

const MAX_TABS = 8;
const MAX_HISTORY = 500;
const MAX_ANNOTATIONS = 500;
const MAX_DOWNLOADS = 100;
const PARTITION = 'persist:neuraco-browser-isolated';
const BLOCKED_PROTOCOLS = new Set([
  'file:',
  'javascript:',
  'data:',
  'vbscript:',
  'chrome:',
  'edge:',
  'devtools:'
]);
const SENSITIVE_QUERY = /token|secret|password|pass|key|code|session|auth/i;
const SENSITIVE_PAGE = /(?:checkout|payment|billing|bank|wallet|crypto|password|captcha|login\/challenge)/i;
const SENSITIVE_CONTROL = /(?:acheter|buy|purchase|payer|pay now|submit payment|publier|publish|envoyer|send all|delete permanently|supprimer définitivement|captcha)/i;

interface BrowserTabRecord {
  state: NeuraCoBrowserTab;
  view: WebContentsView;
  allowedNavigation?: string;
}

interface BrowserServiceOptions {
  host: BrowserWindow;
  storageDirectory: string;
  onEvent: (event: NeuraCoBrowserEvent) => void;
}

const atomicWrite = async (target: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  try {
    await rename(temporary, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EEXIST', 'EPERM'].includes(code || '')) throw error;
    await rm(target, { force: true });
    await rename(temporary, target);
  }
};

export const validateBrowserUrl = (value: string): URL => {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Adresse vide.');
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  if (BLOCKED_PROTOCOLS.has(parsed.protocol) || !['http:', 'https:', 'about:'].includes(parsed.protocol)) {
    throw new Error('Ce protocole est bloqué dans le navigateur NeuraCo.');
  }
  if (parsed.protocol === 'about:' && parsed.href !== 'about:blank') {
    throw new Error('Seule la page about:blank est autorisée.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Les identifiants ne doivent pas être placés dans l’adresse.');
  }
  return parsed;
};

export const isSensitiveBrowserAction = (
  url: string,
  action: NeuraCoBrowserAction,
  elementText = ''
): boolean => (
  action.type === 'type' && /password|passcode|otp|card|cvv/i.test(action.selector || '')
  || SENSITIVE_PAGE.test(url)
  || SENSITIVE_CONTROL.test(`${elementText} ${action.text || ''}`)
);

const safeHistoryUrl = (value: string): string => {
  try {
    const parsed = validateBrowserUrl(value);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) parsed.searchParams.set(key, '[MASQUÉ]');
    }
    return parsed.toString();
  } catch {
    return 'about:blank';
  }
};

const selectorScript = `
(() => new Promise((resolve) => {
  const previous = document.getElementById('__neuraco_selector_overlay__');
  if (previous) previous.remove();
  const overlay = document.createElement('div');
  overlay.id = '__neuraco_selector_overlay__';
  Object.assign(overlay.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    border: '2px solid #7357e8', background: 'rgba(115,87,232,.12)'
  });
  document.documentElement.appendChild(overlay);
  const selectorFor = (element) => {
    if (element.id) return '#' + CSS.escape(element.id);
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length) part += '.' + [...node.classList].slice(0, 2).map(CSS.escape).join('.');
      const siblings = node.parentElement ? [...node.parentElement.children].filter((item) => item.tagName === node.tagName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const move = (event) => {
    if (event.target === overlay) return;
    const rect = event.target.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: rect.left + 'px', top: rect.top + 'px',
      width: rect.width + 'px', height: rect.height + 'px'
    });
  };
  const cleanup = () => {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', choose, true);
    overlay.remove();
  };
  const choose = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const element = event.target;
    const rect = element.getBoundingClientRect();
    const result = {
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      text: String(element.innerText || element.textContent || '').trim().slice(0, 500),
      role: element.getAttribute('role') || '',
      type: element.getAttribute('type') || '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      url: location.href
    };
    cleanup();
    resolve(result);
  };
  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', choose, true);
  setTimeout(() => { cleanup(); resolve(null); }, 30000);
}))()
`;

const diagnosticsScript = `
(() => {
  const selectorFor = (element) => {
    if (!element || element.nodeType !== 1) return '';
    if (element.id) return '#' + CSS.escape(element.id);
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length) {
        part += '.' + [...node.classList].slice(0, 2).map(CSS.escape).join('.');
      }
      const siblings = node.parentElement
        ? [...node.parentElement.children].filter((item) => item.tagName === node.tagName)
        : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const isVisible = (element, style, rect) => (
    style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity || 1) > 0
    && rect.width > 0
    && rect.height > 0
  );
  const all = [...document.querySelectorAll('*')].slice(0, 5000);
  const overflowElements = [];
  const clippedElements = [];
  for (const element of all) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!isVisible(element, style, rect)) continue;
    if ((rect.right > innerWidth + 2 || rect.left < -2) && overflowElements.length < 20) {
      overflowElements.push(selectorFor(element));
    }
    if (
      (style.position === 'fixed' || style.position === 'sticky')
      && (rect.top < -2 || rect.left < -2 || rect.right > innerWidth + 2 || rect.bottom > innerHeight + 2)
      && clippedElements.length < 20
    ) {
      clippedElements.push(selectorFor(element));
    }
  }
  const brokenImages = [...document.images]
    .filter((image) => image.complete && image.naturalWidth === 0)
    .slice(0, 20)
    .map(selectorFor);
  const smallControls = [...document.querySelectorAll(
    'button,a[href],input,select,textarea,[role="button"],[role="link"]'
  )]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return isVisible(element, getComputedStyle(element), rect)
        && (rect.width < 24 || rect.height < 24);
    })
    .slice(0, 10)
    .map(selectorFor);
  const navigation = performance.getEntriesByType('navigation')[0];
  return {
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    resourceCount: performance.getEntriesByType('resource').length,
    domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : undefined,
    loadMs: navigation ? Math.round(navigation.loadEventEnd) : undefined,
    brokenImages,
    overflowElements,
    clippedElements,
    smallControls
  };
})()
`;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export class BrowserService {
  private readonly host: BrowserWindow;
  private readonly onEvent: BrowserServiceOptions['onEvent'];
  private readonly historyPath: string;
  private readonly annotationsPath: string;
  private readonly tabs = new Map<string, BrowserTabRecord>();
  private readonly downloadRecords = new Map<string, NeuraCoBrowserDownload>();
  private readonly runtimeIssues = new Map<string, NeuraCoBrowserDiagnosticIssue[]>();
  private activeTabId?: string;
  private bounds?: NeuraCoBrowserBounds;
  private controlling = false;
  private downloadsConfigured = false;

  constructor(options: BrowserServiceOptions) {
    this.host = options.host;
    this.onEvent = options.onEvent;
    this.historyPath = path.join(options.storageDirectory, 'history.json');
    this.annotationsPath = path.join(options.storageDirectory, 'annotations.json');
  }

  private emit(
    type: NeuraCoBrowserEvent['type'],
    message: string,
    details: Partial<NeuraCoBrowserEvent> = {}
  ): void {
    this.onEvent({
      type,
      message,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  private active(): BrowserTabRecord {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (!tab) throw new Error('Aucun onglet navigateur actif.');
    return tab;
  }

  private updateTab(record: BrowserTabRecord): void {
    const history = record.view.webContents.navigationHistory;
    record.state = {
      ...record.state,
      url: record.view.webContents.getURL() || record.state.url,
      title: record.view.webContents.getTitle() || record.state.title,
      loading: record.view.webContents.isLoading(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      secure: record.view.webContents.getURL().startsWith('https://')
    };
    this.emit('state', 'État du navigateur actualisé.', {
      tabId: record.state.id,
      url: record.state.url
    });
  }

  private tabByWebContentsId(webContentsId?: number): BrowserTabRecord | undefined {
    if (!webContentsId) return undefined;
    return [...this.tabs.values()].find(
      (record) => record.view.webContents.id === webContentsId
    );
  }

  private recordIssue(tabId: string, issue: NeuraCoBrowserDiagnosticIssue): void {
    const issues = this.runtimeIssues.get(tabId) || [];
    issues.push({
      ...issue,
      observedAt: issue.observedAt || new Date().toISOString()
    });
    this.runtimeIssues.set(tabId, issues.slice(-100));
  }

  private applyBounds(): void {
    for (const [id, record] of this.tabs) {
      const visible = id === this.activeTabId && this.bounds;
      record.view.setVisible(Boolean(visible));
      if (visible && this.bounds) record.view.setBounds(this.bounds);
    }
  }

  private async appendHistory(record: BrowserTabRecord): Promise<void> {
    const url = safeHistoryUrl(record.view.webContents.getURL());
    if (url === 'about:blank') return;
    const history = await this.history();
    history.unshift({
      id: randomUUID(),
      title: record.view.webContents.getTitle() || url,
      url,
      visitedAt: new Date().toISOString()
    });
    await atomicWrite(this.historyPath, history.slice(0, MAX_HISTORY));
  }

  private configureDownloads(): void {
    if (this.downloadsConfigured) return;
    this.downloadsConfigured = true;
    const isolatedSession = session.fromPartition(PARTITION);
    isolatedSession.on('will-download', async (event, item) => {
      const id = randomUUID();
      const download: NeuraCoBrowserDownload = {
        id,
        filename: item.getFilename(),
        url: safeHistoryUrl(item.getURL()),
        state: 'requested',
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        startedAt: new Date().toISOString()
      };
      this.downloadRecords.set(id, download);
      while (this.downloadRecords.size > MAX_DOWNLOADS) {
        const oldest = this.downloadRecords.keys().next().value;
        if (!oldest) break;
        this.downloadRecords.delete(oldest);
      }
      const publish = (message: string, level = 'info') => {
        this.emit('download', message, {
          url: download.url,
          level,
          download: { ...download }
        });
      };
      item.pause();
      publish(`Téléchargement demandé: ${download.filename}`);
      item.on('updated', (_downloadEvent, state) => {
        download.receivedBytes = item.getReceivedBytes();
        download.totalBytes = item.getTotalBytes();
        download.state = state === 'interrupted' ? 'interrupted' : 'progressing';
        publish(
          state === 'interrupted'
            ? `Téléchargement interrompu: ${download.filename}`
            : `Téléchargement en cours: ${download.filename}`,
          state === 'interrupted' ? 'error' : 'info'
        );
      });
      item.once('done', (_downloadEvent, state) => {
        download.receivedBytes = item.getReceivedBytes();
        download.totalBytes = item.getTotalBytes();
        download.savePath = item.getSavePath() || undefined;
        download.completedAt = new Date().toISOString();
        download.state = state === 'completed'
          ? 'completed'
          : state === 'cancelled'
            ? 'cancelled'
            : 'interrupted';
        publish(
          state === 'completed'
            ? `Téléchargement terminé: ${download.filename}`
            : state === 'cancelled'
              ? `Téléchargement annulé: ${download.filename}`
              : `Téléchargement interrompu: ${download.filename}`,
          state === 'completed' ? 'success' : state === 'cancelled' ? 'info' : 'error'
        );
      });
      const confirmation = await dialog.showMessageBox(this.host, {
        type: 'question',
        title: 'Téléchargement du navigateur isolé',
        message: `Autoriser le téléchargement de « ${item.getFilename()} » ?`,
        detail: `${safeHistoryUrl(item.getURL())}\n${item.getTotalBytes() || 'Taille inconnue'} octets`,
        buttons: ['Télécharger', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (confirmation.response === 0) item.resume();
      else {
        event.preventDefault();
        item.cancel();
        download.state = 'cancelled';
        download.completedAt = new Date().toISOString();
        publish(`Téléchargement annulé: ${download.filename}`);
        this.emit('blocked', 'Téléchargement annulé par l’utilisateur.');
      }
    });
    isolatedSession.webRequest.onCompleted((details) => {
      const record = this.tabByWebContentsId(
        (details as typeof details & { webContentsId?: number }).webContentsId
      );
      if (record && details.statusCode >= 400) {
        this.recordIssue(record.state.id, {
          source: 'network',
          severity: 'error',
          message: `HTTP ${details.statusCode} · ${details.resourceType}`,
          url: safeHistoryUrl(details.url)
        });
      }
      if (details.resourceType === 'mainFrame') {
        this.emit('network', `HTTP ${details.statusCode}`, {
          url: safeHistoryUrl(details.url),
          level: details.statusCode >= 400 ? 'error' : 'info'
        });
      }
    });
    isolatedSession.webRequest.onErrorOccurred((details) => {
      if (details.error === 'net::ERR_ABORTED') return;
      const record = this.tabByWebContentsId(
        (details as typeof details & { webContentsId?: number }).webContentsId
      );
      if (!record) return;
      const message = `${details.error} · ${details.resourceType}`;
      this.recordIssue(record.state.id, {
        source: 'network',
        severity: 'error',
        message,
        url: safeHistoryUrl(details.url)
      });
      this.emit('network', message, {
        tabId: record.state.id,
        url: safeHistoryUrl(details.url),
        level: 'error'
      });
    });
  }

  async createTab(url = 'about:blank'): Promise<NeuraCoBrowserState> {
    if (this.tabs.size >= MAX_TABS) throw new Error(`Maximum ${MAX_TABS} onglets.`);
    this.configureDownloads();
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true
      }
    });
    const state: NeuraCoBrowserTab = {
      id,
      title: 'Nouvel onglet',
      url: 'about:blank',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      secure: false
    };
    const record: BrowserTabRecord = { state, view };
    this.tabs.set(id, record);
    this.host.contentView.addChildView(view);
    this.activeTabId = id;
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      this.emit('blocked', 'Nouvelle fenêtre bloquée. Ouvrez explicitement cette adresse.', {
        tabId: id,
        url: safeHistoryUrl(target)
      });
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (event, target) => {
      const current = view.webContents.getURL();
      const explicitlyAllowed = record.allowedNavigation === target;
      record.allowedNavigation = undefined;
      try {
        const targetUrl = validateBrowserUrl(target);
        const currentUrl = current ? validateBrowserUrl(current) : null;
        const sameOrigin = currentUrl?.origin === targetUrl.origin;
        if (!explicitlyAllowed && !sameOrigin) {
          event.preventDefault();
          record.state.error = 'Navigation vers un nouveau domaine bloquée: autorisation explicite requise.';
          this.emit('blocked', record.state.error, { tabId: id, url: safeHistoryUrl(target) });
        }
      } catch (error) {
        event.preventDefault();
        record.state.error = error instanceof Error ? error.message : 'Navigation bloquée.';
      }
    });
    view.webContents.on('did-start-loading', () => {
      this.runtimeIssues.set(id, []);
      this.updateTab(record);
    });
    view.webContents.on('did-stop-loading', () => this.updateTab(record));
    view.webContents.on('did-navigate', () => {
      record.state.error = undefined;
      this.updateTab(record);
      void this.appendHistory(record);
    });
    view.webContents.on('did-navigate-in-page', () => this.updateTab(record));
    view.webContents.on('page-title-updated', () => this.updateTab(record));
    view.webContents.on('did-fail-load', (_event, code, description, target, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      record.state.error = `${description} (${code})`;
      this.recordIssue(id, {
        source: 'network',
        severity: 'error',
        message: record.state.error,
        url: safeHistoryUrl(target)
      });
      this.emit('network', record.state.error, {
        tabId: id,
        url: safeHistoryUrl(target),
        level: 'error'
      });
      this.updateTab(record);
    });
    view.webContents.on('console-message', (...args: unknown[]) => {
      const details = parseBrowserConsoleMessage(args);
      if (!details?.message) return;
      const normalizedLevel = details.level.toLowerCase();
      const severity = normalizedLevel === 'error' || normalizedLevel === '3'
        ? 'error'
        : normalizedLevel === 'warning' || normalizedLevel === 'warn' || normalizedLevel === '2'
          ? 'warning'
          : 'info';
      if (severity !== 'info') {
        this.recordIssue(id, {
          source: 'console',
          severity,
          message: details.message.slice(0, 2000),
          url: safeHistoryUrl(view.webContents.getURL())
        });
      }
      this.emit('console', details.message.slice(0, 2000), {
        tabId: id,
        url: safeHistoryUrl(view.webContents.getURL()),
        level: severity
      });
    });
    await view.webContents.loadURL('about:blank');
    if (url !== 'about:blank') await this.navigate(url);
    this.applyBounds();
    return this.state();
  }

  state(): NeuraCoBrowserState {
    return {
      tabs: [...this.tabs.values()].map((record) => ({ ...record.state })),
      activeTabId: this.activeTabId,
      controlling: this.controlling,
      profile: 'isolated'
    };
  }

  async closeTab(tabId: string): Promise<NeuraCoBrowserState> {
    const record = this.tabs.get(tabId);
    if (!record) return this.state();
    this.host.contentView.removeChildView(record.view);
    record.view.webContents.close();
    this.tabs.delete(tabId);
    this.runtimeIssues.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs.keys().next().value;
    }
    if (this.tabs.size === 0) return this.createTab();
    this.applyBounds();
    return this.state();
  }

  activateTab(tabId: string): NeuraCoBrowserState {
    if (!this.tabs.has(tabId)) throw new Error('Onglet introuvable.');
    this.activeTabId = tabId;
    this.applyBounds();
    return this.state();
  }

  async navigate(value: string): Promise<NeuraCoBrowserState> {
    const parsed = validateBrowserUrl(value);
    const record = this.active();
    record.allowedNavigation = parsed.toString();
    await record.view.webContents.loadURL(parsed.toString());
    this.updateTab(record);
    return this.state();
  }

  back(): NeuraCoBrowserState {
    const record = this.active();
    if (record.view.webContents.navigationHistory.canGoBack()) {
      record.view.webContents.navigationHistory.goBack();
    }
    return this.state();
  }

  forward(): NeuraCoBrowserState {
    const record = this.active();
    if (record.view.webContents.navigationHistory.canGoForward()) {
      record.view.webContents.navigationHistory.goForward();
    }
    return this.state();
  }

  reload(): NeuraCoBrowserState {
    this.active().view.webContents.reload();
    return this.state();
  }

  setBounds(bounds: NeuraCoBrowserBounds | null): boolean {
    if (!bounds) {
      this.bounds = undefined;
      this.applyBounds();
      return true;
    }
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(100, Math.round(bounds.width)),
      height: Math.max(100, Math.round(bounds.height))
    };
    this.applyBounds();
    return true;
  }

  hide(): boolean {
    this.bounds = undefined;
    this.applyBounds();
    return true;
  }

  toggleDevTools(): boolean {
    const contents = this.active().view.webContents;
    if (contents.isDevToolsOpened()) contents.closeDevTools();
    else contents.openDevTools({ mode: 'detach', activate: true });
    return contents.isDevToolsOpened();
  }

  async capture(): Promise<NeuraCoBrowserCapture> {
    const record = this.active();
    const contents = record.view.webContents;
    const alreadyAttached = contents.debugger.isAttached();
    if (!alreadyAttached) contents.debugger.attach('1.3');
    let image;
    try {
      const screenshot = await withTimeout(
        contents.debugger.sendCommand('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false
        }) as Promise<{ data: string }>,
        5000,
        'La capture du navigateur a dépassé 5 secondes.'
      );
      image = nativeImage.createFromBuffer(Buffer.from(screenshot.data, 'base64'));
    } finally {
      if (!alreadyAttached && contents.debugger.isAttached()) contents.debugger.detach();
    }
    const size = image.getSize();
    if (size.width < 1 || size.height < 1 || image.isEmpty()) {
      throw new Error('La capture du navigateur est vide.');
    }
    return {
      id: randomUUID(),
      tabId: record.state.id,
      url: safeHistoryUrl(record.view.webContents.getURL()),
      dataUrl: image.toDataURL(),
      width: size.width,
      height: size.height,
      capturedAt: new Date().toISOString()
    };
  }

  async selectElement(): Promise<NeuraCoBrowserElement> {
    const record = this.active();
    const result = await record.view.webContents.executeJavaScript(selectorScript, true);
    if (!result) throw new Error('Sélection annulée ou expirée.');
    return result as NeuraCoBrowserElement;
  }

  async action(action: NeuraCoBrowserAction): Promise<NeuraCoBrowserActionResult> {
    const record = this.active();
    const url = record.view.webContents.getURL();
    if (isSensitiveBrowserAction(url, action)) {
      throw new Error('Action sensible bloquée: paiement, authentification ou publication.');
    }
    if (
      !['click', 'type', 'focus', 'scroll'].includes(action.type)
      || (action.selector && action.selector.length > 1000)
      || (action.text && action.text.length > 10_000)
    ) {
      throw new Error('Action navigateur invalide.');
    }
    this.controlling = true;
    this.emit('action', `Action prévue: ${action.type}`, {
      tabId: record.state.id,
      url: safeHistoryUrl(url)
    });
    try {
      const payload = JSON.stringify(action).replace(/</g, '\\u003c');
      const result = await record.view.webContents.executeJavaScript(`
        (() => {
          const action = ${payload};
          const element = action.selector ? document.querySelector(action.selector) : null;
          if (action.type !== 'scroll' && !element) return { ok: false, reason: 'Élément introuvable' };
          const text = String(element?.innerText || element?.textContent || '');
          const type = String(element?.getAttribute?.('type') || '');
          const sensitive = /password|captcha|card|cvv/i.test(type + ' ' + action.selector)
            || /acheter|buy|purchase|payer|pay now|submit payment|publier|publish|delete permanently/i.test(text);
          if (sensitive) return { ok: false, reason: 'Action sensible bloquée' };
          if (action.type === 'click') element.click();
          if (action.type === 'focus') element.focus();
          if (action.type === 'type') {
            if (!('value' in element)) return { ok: false, reason: 'Élément non saisissable' };
            element.focus();
            element.value = String(action.text || '');
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action.type === 'scroll') {
            window.scrollBy({ left: Number(action.x || 0), top: Number(action.y || 0), behavior: 'smooth' });
          }
          return { ok: true };
        })()
      `, true) as { ok?: boolean; reason?: string };
      if (!result?.ok) throw new Error(result?.reason || 'Action navigateur non exécutée.');
      const completed: NeuraCoBrowserActionResult = {
        ok: true,
        action: action.type,
        selector: action.selector,
        url: safeHistoryUrl(record.view.webContents.getURL()),
        description: `${action.type} exécuté dans le profil isolé NeuraCo.`,
        completedAt: new Date().toISOString()
      };
      this.emit('action', completed.description, {
        tabId: record.state.id,
        url: completed.url
      });
      return completed;
    } finally {
      this.controlling = false;
      this.emit('state', 'Contrôle navigateur terminé.', { tabId: record.state.id });
    }
  }

  async inspect(): Promise<NeuraCoBrowserDiagnostics> {
    const record = this.active();
    if (record.view.webContents.isLoading()) {
      throw new Error('Attendez la fin du chargement avant de lancer le diagnostic.');
    }
    const snapshot = await withTimeout(
      record.view.webContents.executeJavaScript(diagnosticsScript, true) as Promise<BrowserDomSnapshot>,
      5000,
      'Le diagnostic du navigateur a dépassé 5 secondes.'
    );
    return buildBrowserDiagnostics(
      record.state.id,
      safeHistoryUrl(record.view.webContents.getURL()),
      snapshot,
      this.runtimeIssues.get(record.state.id) || []
    );
  }

  async history(): Promise<NeuraCoBrowserHistoryEntry[]> {
    try {
      const parsed = JSON.parse(await readFile(this.historyPath, 'utf8')) as unknown;
      return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
    } catch {
      return [];
    }
  }

  downloads(): NeuraCoBrowserDownload[] {
    return [...this.downloadRecords.values()]
      .reverse()
      .map((download) => ({ ...download }));
  }

  async annotations(): Promise<NeuraCoBrowserAnnotation[]> {
    try {
      const parsed = JSON.parse(await readFile(this.annotationsPath, 'utf8')) as unknown;
      return Array.isArray(parsed) ? parsed.slice(0, MAX_ANNOTATIONS) : [];
    } catch {
      return [];
    }
  }

  async saveAnnotation(
    input: NeuraCoBrowserAnnotationInput
  ): Promise<NeuraCoBrowserAnnotation> {
    const comment = String(input.comment || '').trim().slice(0, 4000);
    if (!comment) throw new Error('Le commentaire est vide.');
    const annotation: NeuraCoBrowserAnnotation = {
      id: randomUUID(),
      tabId: String(input.tabId || '').slice(0, 120),
      url: safeHistoryUrl(input.url),
      selector: input.selector?.slice(0, 1000),
      rect: input.rect,
      comment,
      createdAt: new Date().toISOString()
    };
    const annotations = await this.annotations();
    annotations.unshift(annotation);
    await atomicWrite(this.annotationsPath, annotations.slice(0, MAX_ANNOTATIONS));
    return annotation;
  }

  destroy(): void {
    for (const record of this.tabs.values()) {
      this.host.contentView.removeChildView(record.view);
      record.view.webContents.close();
    }
    this.tabs.clear();
    this.runtimeIssues.clear();
  }
}
