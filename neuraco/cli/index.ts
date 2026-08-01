#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { parseCliArguments, type ParsedCliArguments } from './argument-parser';
import { authenticateCliInBrowser } from './browser-auth';
import { cliApiRequest, CliApiError, streamCliAgent, type CliAgentEvent } from './api-client';
import {
  clearCliConfig,
  loadCliConfig,
  saveCliConfig,
  setCurrentProject
} from './config-store';
import { deleteCliToken, loadCliToken, saveCliToken } from './secure-store';
import {
  openProjectRoot,
  readProjectTextFile,
  scanProject
} from '../electron/workspace-core';
import type {
  NeuraCoAgentFileContext,
  NeuraCoProject
} from '../electron/ipc-contract';

const execFileAsync = promisify(execFile);
const ANSI = {
  bold: '\u001b[1m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  dim: '\u001b[2m',
  reset: '\u001b[0m'
};

interface SessionSummary {
  session_id: string;
  project_id?: string;
  project_name?: string;
  updated_at?: string;
  message_count?: number;
  last_message?: string;
}

interface UsageSummary {
  plan: { id: string; name: string };
  windows: Record<string, { remaining: number; limit: number; reset_at?: string }>;
  wallet: { balance: number; reserved: number };
}

const activeTaskPath = (): string => path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'NeuraCo',
  'cli-active-task.json'
);

const print = (value = ''): void => {
  process.stdout.write(`${value}\n`);
};
const errorLine = (value: string): void => {
  process.stderr.write(`${ANSI.red}Erreur: ${value}${ANSI.reset}\n`);
};

const requireToken = async (): Promise<string> => {
  const token = await loadCliToken();
  if (!token) {
    throw new Error('Aucune session CLI. Exécutez d’abord `neuraco login`.');
  }
  return token;
};

const ensureProject = async (): Promise<NeuraCoProject> => {
  const config = await loadCliConfig();
  if (config.project) {
    try {
      await access(config.project.rootPath);
      return await openProjectRoot(config.project.rootPath);
    } catch {
      // The saved project moved; fall back to the current directory.
    }
  }
  return setCurrentProject(process.cwd());
};

const loadAttachments = async (
  project: NeuraCoProject,
  paths: string[]
): Promise<NeuraCoAgentFileContext[]> => {
  const files: NeuraCoAgentFileContext[] = [];
  for (const requestedPath of paths) {
    const relative = path.isAbsolute(requestedPath)
      ? path.relative(project.rootPath, requestedPath)
      : requestedPath;
    const file = await readProjectTextFile(project, relative);
    files.push({
      path: file.relativePath,
      content: file.content,
      language: file.language
    });
  }
  return files;
};

const writeActiveTask = async (
  taskId: string,
  project: NeuraCoProject
): Promise<void> => {
  await mkdir(path.dirname(activeTaskPath()), { recursive: true });
  await writeFile(activeTaskPath(), JSON.stringify({
    pid: process.pid,
    taskId,
    projectId: project.id,
    startedAt: new Date().toISOString()
  }), { encoding: 'utf8', mode: 0o600 });
};

const clearActiveTask = async (): Promise<void> => {
  await rm(activeTaskPath(), { force: true });
};

const runStop = async (): Promise<void> => {
  try {
    const raw = await readFile(activeTaskPath(), 'utf8');
    const active = JSON.parse(raw) as { pid?: number; taskId?: string };
    if (!Number.isInteger(active.pid) || Number(active.pid) < 1) {
      throw new Error('État de tâche invalide.');
    }
    process.kill(Number(active.pid), 'SIGINT');
    await clearActiveTask();
    print(`Tâche ${active.taskId || ''} arrêtée.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      print('Aucune tâche CLI NeuraCo active.');
      return;
    }
    throw error;
  }
};

const login = async (): Promise<void> => {
  print('Ouverture de la connexion sécurisée NeuraCo dans votre navigateur…');
  const result = await authenticateCliInBrowser();
  if (!result.entitlement.neuraco_access) {
    throw new Error('Ce compte ne possède pas l’accès NeuraCo.');
  }
  await saveCliToken(result.token);
  print(
    `${ANSI.green}Connecté: ${result.user.name || result.user.email}`
    + ` (${result.entitlement.plan}).${ANSI.reset}`
  );
};

const status = async (json: boolean): Promise<void> => {
  const token = await requireToken();
  const [user, accessInfo, usage, cloudTasks, config] = await Promise.all([
    cliApiRequest<{ id: string; name?: string; email: string }>('/auth/me', token),
    cliApiRequest<{ neuraco_access: boolean; plan: string; reason: string }>(
      '/neuraco/access',
      token
    ),
    cliApiRequest<UsageSummary>('/neuraco/usage', token),
    cliApiRequest<Array<Record<string, unknown>>>('/neuraco/cloud/tasks?limit=5', token),
    loadCliConfig()
  ]);
  const result = {
    user,
    access: accessInfo,
    project: config.project,
    model: config.preferredModel,
    agent: config.preferredAgent,
    usage,
    cloudTasks
  };
  if (json) {
    print(JSON.stringify(result, null, 2));
    return;
  }
  print(`${ANSI.bold}Compte${ANSI.reset}   ${user.name || user.email}`);
  print(`${ANSI.bold}Offre${ANSI.reset}    ${usage.plan?.name || accessInfo.plan}`);
  print(`${ANSI.bold}Accès${ANSI.reset}    ${accessInfo.neuraco_access ? 'autorisé' : 'refusé'}`);
  print(`${ANSI.bold}Projet${ANSI.reset}   ${config.project?.rootPath || 'aucun'}`);
  print(`${ANSI.bold}Modèle${ANSI.reset}   ${config.preferredModel}`);
  print(`${ANSI.bold}Crédits${ANSI.reset}  achetés: ${usage.wallet?.balance ?? 0}`);
  const activeCloud = cloudTasks.filter((task) => (
    task.status === 'queued' || task.status === 'running'
  ));
  print(`${ANSI.bold}Cloud${ANSI.reset}    ${activeCloud.length} tâche(s) active(s)`);
  for (const [name, window] of Object.entries(usage.windows || {})) {
    print(`  ${name}: ${window.remaining}/${window.limit}`);
  }
};

const openProject = async (requestedPath: string): Promise<void> => {
  const project = await setCurrentProject(requestedPath);
  const snapshot = await scanProject(project);
  print(`${ANSI.green}Projet ouvert:${ANSI.reset} ${project.rootPath}`);
  print(
    `${snapshot.indexedFiles} fichiers indexés, `
    + `${snapshot.excludedEntries} éléments sensibles ou volumineux exclus`
    + `${snapshot.truncated ? ', index tronqué' : ''}.`
  );
};

const saveSession = async (projectId: string, sessionId: string): Promise<void> => {
  const config = await loadCliConfig();
  await saveCliConfig({
    ...config,
    sessions: { ...config.sessions, [projectId]: sessionId }
  });
};

const sendInstruction = async (
  args: ParsedCliArguments,
  instruction: string,
  mode: 'question' | 'plan',
  project: NeuraCoProject,
  token: string,
  forcedFiles?: NeuraCoAgentFileContext[]
): Promise<CliAgentEvent> => {
  const config = await loadCliConfig();
  const files = forcedFiles || await loadAttachments(project, args.attachments);
  const taskId = randomUUID();
  const sessionId = config.sessions[project.id];
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  await writeActiveTask(taskId, project);
  let startedWriting = false;
  try {
    const final = await streamCliAgent(
      token,
      {
        content: instruction,
        session_id: sessionId,
        request_id: taskId,
        project_id: project.id,
        project_name: project.name,
        mode,
        model: args.model === 'auto' ? config.preferredModel : args.model,
        files,
        images: []
      },
      (event) => {
        if (args.json) return;
        if (event.type === 'model') {
          print(
            `${ANSI.dim}${event.model_display || event.model}`
            + ` via ${event.provider}${ANSI.reset}`
          );
          return;
        }
        if (event.type === 'delta' && event.content) {
          startedWriting = true;
          process.stdout.write(event.content);
        }
      },
      controller.signal
    );
    if (!args.json && startedWriting) process.stdout.write('\n');
    if (final.session_id) await saveSession(project.id, final.session_id);
    if (args.json) {
      print(JSON.stringify(final, null, 2));
    } else if (final.usage) {
      print(
        `${ANSI.dim}Crédits: ${final.usage.credits_consumed ?? 0}`
        + ` · entrée: ${final.usage.input_tokens ?? 0}`
        + ` · sortie: ${final.usage.output_tokens ?? 0}${ANSI.reset}`
      );
    }
    return final;
  } finally {
    process.removeListener('SIGINT', stop);
    await clearActiveTask();
  }
};

const createCloudTask = async (
  args: ParsedCliArguments,
  instruction: string,
  mode: 'question' | 'plan',
  project: NeuraCoProject,
  token: string
): Promise<void> => {
  const config = await loadCliConfig();
  const files = await loadAttachments(project, args.attachments);
  const task = await cliApiRequest<Record<string, unknown>>('/neuraco/cloud/tasks', token, {
    method: 'POST',
    body: JSON.stringify({
      content: instruction,
      session_id: config.sessions[project.id],
      request_id: randomUUID(),
      project_id: project.id,
      project_name: project.name,
      mode,
      model: args.model === 'auto' ? config.preferredModel : args.model,
      files
    })
  });
  if (typeof task.session_id === 'string') {
    await saveSession(project.id, task.session_id);
  }
  if (args.json) {
    print(JSON.stringify(task, null, 2));
    return;
  }
  print(`${ANSI.green}Tâche cloud créée.${ANSI.reset}`);
  print(`Identifiant: ${task.id}`);
  print(`État: ${task.status} · le PC peut maintenant être éteint.`);
  print('Les fichiers locaux non joints ne sont pas accessibles à cette tâche.');
};

const resume = async (args: ParsedCliArguments): Promise<void> => {
  const token = await requireToken();
  const project = await ensureProject();
  const sessions = await cliApiRequest<SessionSummary[]>(
    '/neuraco/sessions?limit=100',
    token
  );
  const selected = sessions.find((session) => session.project_id === project.id)
    || sessions[0];
  if (!selected) {
    print('Aucune conversation NeuraCo à reprendre.');
    return;
  }
  await saveSession(project.id, selected.session_id);
  if (args.json) {
    print(JSON.stringify(selected, null, 2));
    return;
  }
  print(`${ANSI.green}Session reprise:${ANSI.reset} ${selected.session_id}`);
  print(`${selected.message_count || 0} messages · ${selected.project_name || project.name}`);
  if (selected.last_message) print(`${ANSI.dim}${selected.last_message}${ANSI.reset}`);
};

const review = async (args: ParsedCliArguments): Promise<void> => {
  const project = await ensureProject();
  const token = await requireToken();
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--no-ext-diff', '--unified=3', 'HEAD'],
    {
      cwd: project.rootPath,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024
    }
  );
  const diff = stdout.trim();
  if (!diff) {
    print('Aucune différence Git à réviser.');
    return;
  }
  await sendInstruction(
    args,
    'Effectue une revue de code stricte du diff Git joint. Liste d’abord les bugs et '
      + 'risques concrets avec les fichiers concernés, puis les tests manquants. '
      + 'N’affirme rien qui ne soit pas visible dans le diff.',
    'question',
    project,
    token,
    [{ path: 'git.diff', content: diff.slice(0, 200_000), language: 'diff' }]
  );
};

const interactiveChat = async (
  args: ParsedCliArguments,
  initialInstruction?: string
): Promise<void> => {
  const token = await requireToken();
  const project = await ensureProject();
  if (initialInstruction) {
    await sendInstruction(args, initialInstruction, 'question', project, token);
    if (args.nonInteractive) return;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  print(`${ANSI.cyan}NeuraCo CLI · ${project.name}${ANSI.reset}`);
  print(`${ANSI.dim}Tapez /exit pour quitter, /status pour voir l’utilisation.${ANSI.reset}`);
  try {
    while (true) {
      const instruction = (await prompt.question('neuraco> ')).trim();
      if (!instruction) continue;
      if (instruction === '/exit' || instruction === '/quit') break;
      if (instruction === '/status') {
        await status(false);
        continue;
      }
      await sendInstruction(args, instruction, 'question', project, token);
    }
  } finally {
    prompt.close();
  }
};

const showAgents = (json: boolean): void => {
  const agents = [
    { id: 'assistant', name: 'Assistant senior', purpose: 'Analyse et développement général' },
    { id: 'architect', name: 'Architecte', purpose: 'Architecture et plans techniques' },
    { id: 'frontend', name: 'Frontend', purpose: 'Interfaces et accessibilité' },
    { id: 'backend', name: 'Backend', purpose: 'API, données et sécurité serveur' },
    { id: 'reviewer', name: 'Réviseur', purpose: 'Revue de code et risques' },
    { id: 'tester', name: 'Testeur', purpose: 'Tests et validation' }
  ];
  if (json) {
    print(JSON.stringify(agents, null, 2));
    return;
  }
  for (const agent of agents) {
    print(`${ANSI.bold}${agent.id}${ANSI.reset} · ${agent.name} — ${agent.purpose}`);
  }
};

const showHelp = (): void => {
  print(`${ANSI.bold}NeuraCo CLI${ANSI.reset}`);
  print('neuraco                         Ouvrir le chat interactif');
  print('neuraco login                   Se connecter dans le navigateur');
  print('neuraco logout                  Supprimer la session locale chiffrée');
  print('neuraco open .                  Ouvrir un projet local');
  print('neuraco chat "question"         Interroger NeuraCo');
  print('neuraco plan "objectif"         Générer un plan vérifiable');
  print('neuraco run "objectif"          Préparer l’exécution sous autorisations');
  print('neuraco review                  Réviser le diff Git courant');
  print('neuraco agents                  Lister les rôles intégrés');
  print('neuraco status                  Afficher compte, projet et crédits');
  print('neuraco resume                  Reprendre la dernière session du projet');
  print('neuraco stop                    Arrêter la tâche CLI active');
  print('');
  print('Options: --model, --agent, --budget, --attach, --read-only, --auto,');
  print('         --local, --cloud, --non-interactive, --json');
};

const main = async (): Promise<void> => {
  const args = parseCliArguments(process.argv.slice(2));
  const instruction = args.positionals.join(' ').trim();
  if (args.command === 'help') return showHelp();
  if (args.command === 'login') return login();
  if (args.command === 'logout') {
    await deleteCliToken();
    await clearCliConfig();
    return print('Session CLI NeuraCo supprimée.');
  }
  if (args.command === 'status') return status(args.json);
  if (args.command === 'open') return openProject(args.positionals[0] || '.');
  if (args.command === 'resume') return resume(args);
  if (args.command === 'stop') return runStop();
  if (args.command === 'agents') return showAgents(args.json);
  if (args.command === 'review') return review(args);
  if (args.command === 'plan' || args.command === 'run') {
    if (!instruction) throw new Error(`La commande ${args.command} nécessite un objectif.`);
    const token = await requireToken();
    const project = await ensureProject();
    const prefix = args.command === 'run'
      ? 'Prépare une exécution concrète et sûre de cette tâche. Donne les modifications exactes, '
        + 'les commandes proposées, les tests et les risques. N’affirme pas les avoir exécutés: '
        + 'les autorisations locales doivent d’abord les valider.\n\n'
      : '';
    if (args.executionMode === 'cloud') {
      await createCloudTask(args, `${prefix}${instruction}`, 'plan', project, token);
    } else {
      await sendInstruction(args, `${prefix}${instruction}`, 'plan', project, token);
    }
    return;
  }
  return interactiveChat(args, instruction || undefined);
};

void main().catch((error) => {
  if (error instanceof CliApiError && error.status === 401) {
    void deleteCliToken();
  }
  errorLine(error instanceof Error ? error.message : 'Erreur NeuraCo inconnue.');
  process.exitCode = 1;
});
