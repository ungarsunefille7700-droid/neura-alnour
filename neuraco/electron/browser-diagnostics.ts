import type {
  NeuraCoBrowserDiagnosticIssue,
  NeuraCoBrowserDiagnostics
} from './ipc-contract';

export interface BrowserDomSnapshot {
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  resourceCount: number;
  domContentLoadedMs?: number;
  loadMs?: number;
  brokenImages: string[];
  overflowElements: string[];
  clippedElements: string[];
  smallControls: string[];
}

const unique = (values: string[], limit = 20): string[] => (
  [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, limit)
);

const issue = (
  source: NeuraCoBrowserDiagnosticIssue['source'],
  severity: NeuraCoBrowserDiagnosticIssue['severity'],
  message: string,
  selector?: string
): NeuraCoBrowserDiagnosticIssue => ({
  source,
  severity,
  message,
  selector
});

export const buildBrowserDiagnostics = (
  tabId: string,
  url: string,
  snapshot: BrowserDomSnapshot,
  runtimeIssues: NeuraCoBrowserDiagnosticIssue[]
): NeuraCoBrowserDiagnostics => {
  const issues = [...runtimeIssues.slice(-100)];

  for (const selector of unique(snapshot.brokenImages)) {
    issues.push(issue('visual', 'error', 'Image non chargée ou source invalide.', selector));
  }
  for (const selector of unique(snapshot.overflowElements)) {
    issues.push(issue(
      'visual',
      'warning',
      'Élément visible en dehors de la largeur de l’écran.',
      selector
    ));
  }
  for (const selector of unique(snapshot.clippedElements)) {
    issues.push(issue(
      'visual',
      'warning',
      'Élément fixe ou collant partiellement coupé dans la fenêtre.',
      selector
    ));
  }
  for (const selector of unique(snapshot.smallControls, 10)) {
    issues.push(issue(
      'dom',
      'info',
      'Contrôle interactif inférieur à 24 × 24 pixels.',
      selector
    ));
  }

  if (snapshot.documentWidth > snapshot.viewportWidth + 2) {
    issues.push(issue(
      'visual',
      'warning',
      `Débordement horizontal global: ${snapshot.documentWidth}px pour une fenêtre de ${snapshot.viewportWidth}px.`
    ));
  }

  const deduplicated = issues.filter((current, index, all) => (
    all.findIndex((candidate) => (
      candidate.source === current.source
      && candidate.severity === current.severity
      && candidate.message === current.message
      && candidate.selector === current.selector
    )) === index
  ));

  return {
    tabId,
    url,
    inspectedAt: new Date().toISOString(),
    metrics: {
      viewportWidth: snapshot.viewportWidth,
      viewportHeight: snapshot.viewportHeight,
      documentWidth: snapshot.documentWidth,
      documentHeight: snapshot.documentHeight,
      resourceCount: snapshot.resourceCount,
      domContentLoadedMs: snapshot.domContentLoadedMs,
      loadMs: snapshot.loadMs
    },
    issues: deduplicated
  };
};

export const parseBrowserConsoleMessage = (
  args: unknown[]
): { message: string; level: string } | null => {
  if (typeof args[1] === 'number' && typeof args[2] === 'string') {
    return {
      message: args[2],
      level: String(args[1])
    };
  }
  for (const candidate of [...args].reverse()) {
    if (
      candidate
      && typeof candidate === 'object'
      && typeof (candidate as { message?: unknown }).message === 'string'
    ) {
      return {
        message: (candidate as { message: string }).message,
        level: String((candidate as { level?: unknown }).level || 'info')
      };
    }
  }
  const strings = args.filter((candidate): candidate is string => typeof candidate === 'string');
  if (strings.length === 0) return null;
  return { message: strings.at(-1) || '', level: 'info' };
};
