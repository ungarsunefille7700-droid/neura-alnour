import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Download, ExternalLink, Loader2, Package, Wrench } from 'lucide-react';
import {
  defaultFileName, downloadZip, extractCodeFiles, previewHtml, splitMessage,
} from '@/utils/codeFiles';
import { checkProject, fixRequest } from '@/utils/projectCheck';

// Like ChatGPT: code is NEVER shown in the chat. The files the AI writes become one
// project card (download as .zip, open the page); only one- or two-line terminal
// commands (« pip install pillow ») stay visible, as instructions.
const SHELL = new Set(['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'cmd', 'bat', 'console', 'terminal']);
const isCommand = (part) => part.complete && !part.path && SHELL.has(part.language) && part.lines <= 2;

const projectTitle = (files) => {
  const html = files.find((file) => /\.html?$/i.test(file.path));
  const title = html && /<title>([^<]{1,80})<\/title>/i.exec(html.content);
  return title ? title[1].trim() : 'Projet';
};

export const CONTINUE_REQUEST = (
  'Ta réponse précédente a été coupée avant la fin : le projet est incomplet. '
  + 'Réécris le projet en entier, chaque fichier complet (ligne « Fichier: chemin » puis son code), sans rien couper.'
);

export function ProjectCard({ parts, content, writing, truncated = false, onFix }) {
  const files = useMemo(() => {
    if (writing) return [];
    const named = truncated ? [] : extractCodeFiles(content);
    if (named.length) return named;
    // Code written without file names (a single script…): name it from its language.
    const taken = new Set();
    return parts.map((part) => ({ path: part.path || defaultFileName(part.language, taken), content: `${part.code}\n` }));
  }, [content, parts, writing, truncated]);
  const lines = parts.reduce((sum, part) => sum + part.lines, 0);
  const names = parts.map((part) => part.path).filter(Boolean);
  const preview = useMemo(() => (writing ? null : previewHtml(files)), [files, writing]);
  // Checked like a developer would before handing it over (ids, files, syntax).
  const issues = useMemo(() => {
    if (writing) return [];
    const found = checkProject(files);
    // A finished answer whose code stops in the middle: never shown as "being created".
    return truncated ? [{ file: 'projet', message: 'la réponse a été coupée avant la fin', truncated: true }, ...found] : found;
  }, [files, writing, truncated]);

  if (writing) {
    return (
      <div className="my-3 flex items-center gap-2 text-sm text-muted-foreground" data-testid="project-writing">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>
          Création du projet… {names.length ? `${names.join(', ')} · ` : ''}{lines} ligne{lines > 1 ? 's' : ''}
        </span>
      </div>
    );
  }
  if (!files.length) return null;
  const open = () => {
    const url = URL.createObjectURL(new Blob([preview], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  return (
    <div className="my-3 rounded-xl border border-border bg-card/60" data-testid="project-card">
    <div className="flex flex-wrap items-center gap-3 px-3 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Package className="h-5 w-5" />
      </span>
      {/* On a phone the buttons go to a second line, so the name stays readable. */}
      <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-0">
        <p className="truncate text-sm font-medium" data-testid="project-title">{projectTitle(files)}</p>
        <p className="truncate text-xs text-muted-foreground" title={files.map((file) => file.path).join(', ')}>
          {files.length} fichier{files.length > 1 ? 's' : ''} · {lines} lignes · {files.map((file) => file.path).join(', ')}
        </p>
      </div>
      <div className="flex w-full justify-end gap-2 sm:w-auto">
      {preview && (
        <button
          type="button"
          onClick={open}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
          data-testid="project-open"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Ouvrir
        </button>
      )}
      <button
        type="button"
        onClick={() => downloadZip(files)}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        data-testid="code-zip-download"
      >
        <Download className="h-3.5 w-3.5" /> Télécharger (.zip)
      </button>
      </div>
    </div>
    {issues.length > 0 && (
      <div className="border-t border-border px-3 py-2.5 text-xs" data-testid="project-issues">
        <p className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {issues.length} problème{issues.length > 1 ? 's' : ''} détecté{issues.length > 1 ? 's' : ''} par la vérification automatique
        </p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          {issues.map((issue) => <li key={`${issue.file}-${issue.message}`}>{issue.file} : {issue.message}</li>)}
        </ul>
        {onFix && (
          <button
            type="button"
            onClick={() => onFix(truncated ? CONTINUE_REQUEST : fixRequest(issues, files))}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 px-3 py-1.5 font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
            data-testid="project-fix"
          >
            <Wrench className="h-3.5 w-3.5" /> {truncated ? 'Terminer le projet' : 'Corriger automatiquement'}
          </button>
        )}
      </div>
    )}
    </div>
  );
}

// An AI answer: text as markdown; the code becomes a single project card.
// live: the answer is still being written (an unfinished code block is then normal).
export default function AssistantMarkdown({ content, components, onFixProject, live = false }) {
  // « Fichier: projet.zip » lines are noise: the app builds the archive itself.
  const cleaned = useMemo(() => String(content || '')
    .replace(/^[ \t]*(?:\*\*)?(?:fichier|file)\s*:\s*`?[^\s`]+\.zip`?(?:\*\*)?.*$/gim, ''), [content]);
  const parts = useMemo(() => splitMessage(cleaned), [cleaned]);
  const code = parts.filter((part) => part.type === 'code' && !isCommand(part));
  const unfinished = code.some((part) => !part.complete);
  const writing = live && unfinished;
  const truncated = !live && unfinished;
  let cardShown = false;
  return parts.map((part, index) => {
    const key = `${part.type}-${index}`;
    if (part.type === 'text') {
      return <ReactMarkdown key={key} remarkPlugins={[remarkGfm]} components={components}>{part.text}</ReactMarkdown>;
    }
    if (isCommand(part)) {
      return (
        <ReactMarkdown key={key} remarkPlugins={[remarkGfm]} components={components}>
          {`\`\`\`\`${part.language}\n${part.code}\n\`\`\`\``}
        </ReactMarkdown>
      );
    }
    if (cardShown) return null;
    cardShown = true;
    return <ProjectCard key={key} parts={code} content={cleaned} writing={writing} truncated={truncated} onFix={onFixProject} />;
  });
}
