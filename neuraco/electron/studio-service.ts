import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import type {
  NeuraCoFiveMManifest,
  NeuraCoProject,
  NeuraCoStudioAnalysis,
  NeuraCoStudioEvent,
  NeuraCoStudioOperationRequest,
  NeuraCoStudioOperationResult,
  NeuraCoStudioTool,
  NeuraCoStudioToolId
} from './ipc-contract';
import { createSandboxedEnvironment } from './sandbox-environment';

const MAX_SCANNED_FILES = 20_000;
const MAX_OUTPUT = 200_000;
const OPERATION_TIMEOUT_MS = 180_000;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.next',
  '.nuxt',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'release',
  'vendor'
]);

interface StudioServiceOptions {
  storageDirectory: string;
  spawnProcess?: typeof spawn;
  environment?: NodeJS.ProcessEnv;
}

interface RunningTask {
  child: ChildProcess;
  tool: NeuraCoStudioToolId;
}

const existsFile = async (target: string): Promise<boolean> => {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

const normalizeRelative = (value: string): string => value.replace(/\\/g, '/');

export const validateStudioProjectPath = (
  project: NeuraCoProject,
  value: string,
  allowMissing = false
): string => {
  const root = path.resolve(project.rootPath);
  const resolved = path.resolve(
    path.isAbsolute(value) ? value : path.join(root, value)
  );
  const relative = path.relative(root, resolved);
  if (!value || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Le chemin de l’outil 3D est hors du projet autorisé.');
  }
  if (!allowMissing && relative === '') {
    throw new Error('Un fichier du projet doit être sélectionné.');
  }
  return resolved;
};

const findFirstExecutable = async (candidates: string[]): Promise<string> => {
  for (const candidate of candidates) {
    if (await existsFile(candidate)) return candidate;
  }
  return '';
};

const versionFromPath = (executable: string): string => {
  const match = executable.match(/(?:Blender\s+|3ds Max\s+)([\d.]+)/i);
  return match?.[1] || '';
};

const toolCandidates = (environment: NodeJS.ProcessEnv) => {
  const programFiles = environment.ProgramFiles || 'C:\\Program Files';
  const localAppData = environment.LOCALAPPDATA || '';
  const blenderVersions = ['5.1', '5.0', '4.5', '4.4', '4.3', '4.2', '4.1', '4.0', '3.6'];
  const maxVersions = ['2027', '2026', '2025', '2024', '2023', '2022', '2021', '2020'];
  return {
    fivem: [
      path.join(localAppData, 'FiveM', 'FiveM.app', 'FiveM.exe')
    ],
    blender: blenderVersions.map((version) => (
      path.join(programFiles, 'Blender Foundation', `Blender ${version}`, 'blender.exe')
    )),
    '3dsmax': maxVersions.map((version) => (
      path.join(programFiles, 'Autodesk', `3ds Max ${version}`, '3dsmax.exe')
    ))
  };
};

const readProjectPaths = async (rootPath: string): Promise<{
  files: string[];
  truncated: boolean;
}> => {
  const files: string[] = [];
  let truncated = false;
  const walk = async (directory: string): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= MAX_SCANNED_FILES) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) await walk(absolute);
      } else if (entry.isFile()) {
        files.push(normalizeRelative(path.relative(rootPath, absolute)));
      }
    }
  };
  await walk(rootPath);
  return { files, truncated };
};

const quotedValues = (value: string): string[] => (
  [...value.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
);

const directiveValues = (source: string, names: string[]): string[] => {
  const values: string[] = [];
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:${names.join('|')})\\s*(\\{[\\s\\S]*?\\}|['"][^'"]+['"])`,
    'gmi'
  );
  for (const match of source.matchAll(pattern)) values.push(...quotedValues(match[1]));
  return Array.from(new Set(values));
};

const firstDirective = (source: string, name: string): string | undefined => {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${name}\\s+['"]([^'"]+)['"]`, 'i'));
  return match?.[1];
};

export const parseFiveMManifest = async (
  projectRoot: string,
  manifestRelativePath: string
): Promise<NeuraCoFiveMManifest> => {
  const absolute = path.join(projectRoot, manifestRelativePath);
  const source = (await readFile(absolute, 'utf8'))
    .replace(/--\[\[[\s\S]*?\]\]/g, '')
    .replace(/--.*$/gm, '');
  const scripts = directiveValues(source, [
    'client_script',
    'client_scripts',
    'server_script',
    'server_scripts',
    'shared_script',
    'shared_scripts',
    'file',
    'files'
  ]);
  const dependencies = directiveValues(source, ['dependency', 'dependencies']);
  const games = directiveValues(source, ['game', 'games']);
  const resourceRoot = path.dirname(absolute);
  const missingFiles: string[] = [];
  const warnings: string[] = [];

  for (const script of scripts) {
    if (
      script.startsWith('@')
      || /^https?:\/\//i.test(script)
      || /[*?[\]]/.test(script)
    ) {
      continue;
    }
    const resolved = path.resolve(resourceRoot, script);
    const relativeToResource = path.relative(resourceRoot, resolved);
    if (relativeToResource.startsWith('..') || path.isAbsolute(relativeToResource)) {
      warnings.push(`Référence hors ressource ignorée: ${script}`);
      continue;
    }
    if (!await existsFile(resolved)) missingFiles.push(script);
  }

  const fxVersion = firstDirective(source, 'fx_version');
  if (!fxVersion) warnings.push('Directive fx_version absente.');
  if (games.length === 0) warnings.push('Directive game/games absente.');
  if (scripts.length === 0) warnings.push('Aucun script ou fichier déclaré.');
  return {
    path: normalizeRelative(manifestRelativePath),
    fxVersion,
    games,
    scripts,
    dependencies,
    missingFiles,
    warnings
  };
};

const blenderInspectScript = `
import bpy, json, os, sys
args = sys.argv[sys.argv.index("--") + 1:]
report_path = args[0]
missing_images = []
for image in bpy.data.images:
    if image.source == 'FILE':
        candidate = bpy.path.abspath(image.filepath)
        if candidate and not os.path.exists(candidate):
            missing_images.append(image.name)
report = {
    "scene": bpy.context.scene.name if bpy.context.scene else "",
    "objects": len(bpy.data.objects),
    "meshes": len(bpy.data.meshes),
    "materials": len(bpy.data.materials),
    "images": len(bpy.data.images),
    "missingImages": missing_images,
    "renderEngine": bpy.context.scene.render.engine if bpy.context.scene else "",
    "blenderVersion": bpy.app.version_string
}
with open(report_path, "w", encoding="utf-8") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
`;

const blenderExportScript = `
import bpy, json, os, sys
args = sys.argv[sys.argv.index("--") + 1:]
output_path, report_path = args[0], args[1]
bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB')
report = {
    "output": output_path,
    "objects": len(bpy.data.objects),
    "bytes": os.path.getsize(output_path) if os.path.exists(output_path) else 0,
    "blenderVersion": bpy.app.version_string
}
with open(report_path, "w", encoding="utf-8") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
`;

const maxString = (value: string): string => (
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
);

export const buildMaxInspectScript = (target: string, reportPath: string): string => `
try (
  loadMaxFile "${maxString(target)}" useFileUnits:true quiet:true
  local f = createFile "${maxString(reportPath)}"
  format "scene=%\\n" maxFileName to:f
  format "objects=%\\n" objects.count to:f
  format "geometry=%\\n" geometry.count to:f
  format "materials=%\\n" sceneMaterials.count to:f
  format "version=%\\n" (maxVersion()) to:f
  close f
  quitMAX #noPrompt
) catch (
  local f = createFile "${maxString(reportPath)}"
  format "error=%\\n" (getCurrentException()) to:f
  close f
  quitMAX #noPrompt
)
`;

export const buildMaxExportScript = (
  target: string,
  output: string,
  reportPath: string
): string => `
try (
  loadMaxFile "${maxString(target)}" useFileUnits:true quiet:true
  exportFile "${maxString(output)}" #noPrompt selectedOnly:false using:FBXEXP
  local f = createFile "${maxString(reportPath)}"
  format "output=%\\n" "${maxString(output)}" to:f
  format "objects=%\\n" objects.count to:f
  close f
  quitMAX #noPrompt
) catch (
  local f = createFile "${maxString(reportPath)}"
  format "error=%\\n" (getCurrentException()) to:f
  close f
  quitMAX #noPrompt
)
`;

const appendChunk = (current: string, chunk: Buffer): string => (
  `${current}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT)
);

export class StudioService {
  private readonly storageDirectory: string;
  private readonly spawnProcess: typeof spawn;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly running = new Map<string, RunningTask>();

  constructor(options: StudioServiceOptions) {
    this.storageDirectory = options.storageDirectory;
    this.spawnProcess = options.spawnProcess || spawn;
    this.environment = options.environment || process.env;
  }

  async tools(): Promise<NeuraCoStudioTool[]> {
    const candidates = toolCandidates(this.environment);
    const [fiveM, blender, max3d] = await Promise.all([
      findFirstExecutable(candidates.fivem),
      findFirstExecutable(candidates.blender),
      findFirstExecutable(candidates['3dsmax'])
    ]);
    return [
      {
        id: 'fivem',
        name: 'FiveM',
        installed: Boolean(fiveM),
        executable: fiveM,
        version: '',
        integration: 'Manifestes, fichiers, journaux et validation statique',
        capabilities: ['fxmanifest', 'Lua/JS/TS', 'ESX/QBCore', 'dépendances']
      },
      {
        id: 'blender',
        name: 'Blender',
        installed: Boolean(blender),
        executable: blender,
        version: versionFromPath(blender),
        integration: 'API Python Blender en mode arrière-plan',
        capabilities: ['inspecter', 'valider', 'exporter GLB']
      },
      {
        id: '3dsmax',
        name: '3ds Max',
        installed: Boolean(max3d),
        executable: max3d,
        version: versionFromPath(max3d),
        integration: 'MAXScript prédéfini et automatisation officielle',
        capabilities: ['inspecter', 'valider', 'exporter FBX']
      }
    ];
  }

  async analyze(project: NeuraCoProject): Promise<NeuraCoStudioAnalysis> {
    const startedAt = Date.now();
    const { files, truncated } = await readProjectPaths(project.rootPath);
    const manifestPaths = files.filter((file) => (
      /(?:^|\/)(?:fxmanifest\.lua|__resource\.lua)$/i.test(file)
    ));
    const manifests = await Promise.all(
      manifestPaths.map((manifest) => parseFiveMManifest(project.rootPath, manifest))
    );
    const luaFiles = files.filter((file) => file.toLowerCase().endsWith('.lua'));
    const blendFiles = files.filter((file) => file.toLowerCase().endsWith('.blend'));
    const maxFiles = files.filter((file) => file.toLowerCase().endsWith('.max'));
    const issues: NeuraCoStudioAnalysis['issues'] = [];
    for (const manifest of manifests) {
      for (const missing of manifest.missingFiles) {
        issues.push({
          severity: 'error',
          tool: 'fivem',
          path: manifest.path,
          message: `Fichier déclaré introuvable: ${missing}`
        });
      }
      for (const warning of manifest.warnings) {
        issues.push({
          severity: 'warning',
          tool: 'fivem',
          path: manifest.path,
          message: warning
        });
      }
    }
    if (truncated) {
      issues.push({
        severity: 'warning',
        tool: 'fivem',
        message: `Analyse limitée à ${MAX_SCANNED_FILES} fichiers.`
      });
    }
    return {
      projectId: project.id,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      scannedFiles: files.length,
      truncated,
      tools: await this.tools(),
      fiveM: {
        detected: manifests.length > 0,
        manifests,
        luaFiles
      },
      blender: {
        detected: blendFiles.length > 0,
        files: blendFiles
      },
      max3d: {
        detected: maxFiles.length > 0,
        files: maxFiles
      },
      issues
    };
  }

  private async runProcess(
    taskId: string,
    tool: NeuraCoStudioToolId,
    executable: string,
    args: string[],
    cwd: string,
    onEvent: (event: NeuraCoStudioEvent) => void
  ): Promise<{ output: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      let output = '';
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const child = this.spawnProcess(executable, args, {
        cwd,
        env: createSandboxedEnvironment(this.environment),
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.running.set(taskId, { child, tool });
      const finish = (error?: Error, exitCode: number | null = null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.running.delete(taskId);
        if (error) reject(error);
        else resolve({ output, exitCode });
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        output = appendChunk(output, chunk);
        onEvent({
          taskId,
          type: 'output',
          tool,
          message: chunk.toString('utf8').slice(0, 2000),
          timestamp: new Date().toISOString()
        });
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        output = appendChunk(output, chunk);
        onEvent({
          taskId,
          type: 'output',
          tool,
          message: chunk.toString('utf8').slice(0, 2000),
          timestamp: new Date().toISOString()
        });
      });
      child.once('error', (error) => finish(error));
      child.once('exit', (code, signal) => {
        const normalizedCode = typeof code === 'number' && code > 0x7fffffff
          ? code - 0x100000000
          : code;
        if (signal) {
          finish(new Error(`Outil ${tool} interrompu (${signal}).`), normalizedCode);
        } else {
          finish(undefined, normalizedCode);
        }
      });
      timer = setTimeout(() => {
        child.kill();
        finish(new Error(`L’outil ${tool} a dépassé ${OPERATION_TIMEOUT_MS / 1000} secondes.`));
      }, OPERATION_TIMEOUT_MS);
    });
  }

  async run(
    project: NeuraCoProject,
    request: NeuraCoStudioOperationRequest,
    onEvent: (event: NeuraCoStudioEvent) => void
  ): Promise<NeuraCoStudioOperationResult> {
    const taskId = request.taskId || randomUUID();
    if (this.running.has(taskId)) throw new Error('Cette tâche Studio est déjà active.');
    const startedAt = Date.now();
    const operation = request.operation;
    const tool: NeuraCoStudioToolId = operation.startsWith('fivem')
      ? 'fivem'
      : operation.startsWith('blender')
        ? 'blender'
        : '3dsmax';
    onEvent({
      taskId,
      type: 'started',
      tool,
      message: `${operation} démarré.`,
      timestamp: new Date().toISOString()
    });
    try {
      if (operation === 'fivem_validate') {
        const analysis = await this.analyze(project);
        const errors = analysis.issues.filter(
          (issue) => issue.tool === 'fivem' && issue.severity === 'error'
        );
        const result: NeuraCoStudioOperationResult = {
          taskId,
          operation,
          tool,
          ok: errors.length === 0 && analysis.fiveM.detected,
          summary: analysis.fiveM.detected
            ? `${analysis.fiveM.manifests.length} ressource(s), ${errors.length} erreur(s).`
            : 'Aucune ressource FiveM détectée.',
          output: JSON.stringify({
            manifests: analysis.fiveM.manifests,
            issues: analysis.issues.filter((issue) => issue.tool === 'fivem')
          }, null, 2),
          durationMs: Date.now() - startedAt,
          completedAt: new Date().toISOString()
        };
        onEvent({
          taskId,
          type: result.ok ? 'completed' : 'failed',
          tool,
          message: result.summary,
          timestamp: result.completedAt
        });
        return result;
      }

      const tools = await this.tools();
      const installed = tools.find((item) => item.id === tool);
      if (!installed?.installed || !installed.executable) {
        throw new Error(`${installed?.name || tool} n’est pas installé ou détectable.`);
      }
      const target = validateStudioProjectPath(project, String(request.targetPath || ''));
      const extension = path.extname(target).toLowerCase();
      if (tool === 'blender' && extension !== '.blend') {
        throw new Error('Blender exige un fichier .blend du projet.');
      }
      if (tool === '3dsmax' && extension !== '.max') {
        throw new Error('3ds Max exige un fichier .max du projet.');
      }

      const taskDirectory = path.join(this.storageDirectory, 'tasks', taskId);
      await mkdir(taskDirectory, { recursive: true });
      const reportPath = path.join(
        taskDirectory,
        tool === 'blender' ? 'report.json' : 'report.txt'
      );
      let outputPath: string | undefined;
      let scriptPath: string;
      let args: string[];
      if (tool === 'blender') {
        scriptPath = path.join(taskDirectory, 'operation.py');
        if (operation === 'blender_export_gltf') {
          outputPath = validateStudioProjectPath(
            project,
            request.outputPath || `${path.basename(target, '.blend')}.glb`,
            true
          );
          if (path.extname(outputPath).toLowerCase() !== '.glb') {
            throw new Error('L’export Blender doit produire un fichier .glb.');
          }
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeFile(scriptPath, blenderExportScript, 'utf8');
          args = [
            '--background',
            target,
            '--python',
            scriptPath,
            '--',
            outputPath,
            reportPath
          ];
        } else {
          await writeFile(scriptPath, blenderInspectScript, 'utf8');
          args = ['--background', target, '--python', scriptPath, '--', reportPath];
        }
      } else {
        scriptPath = path.join(taskDirectory, 'operation.ms');
        if (operation === 'max_export_fbx') {
          outputPath = validateStudioProjectPath(
            project,
            request.outputPath || `${path.basename(target, '.max')}.fbx`,
            true
          );
          if (path.extname(outputPath).toLowerCase() !== '.fbx') {
            throw new Error('L’export 3ds Max doit produire un fichier .fbx.');
          }
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeFile(
            scriptPath,
            buildMaxExportScript(target, outputPath, reportPath),
            'utf8'
          );
        } else {
          await writeFile(scriptPath, buildMaxInspectScript(target, reportPath), 'utf8');
        }
        args = ['-q', '-silent', '-U', 'MAXScript', scriptPath];
      }

      const processResult = await this.runProcess(
        taskId,
        tool,
        installed.executable,
        args,
        project.rootPath,
        onEvent
      );
      let report = '';
      try {
        report = await readFile(reportPath, 'utf8');
      } catch {
        // The external application may have failed before producing its report.
      }
      const hasReportedError = /(^|\n)\s*error\s*=/i.test(report);
      const ok = processResult.exitCode === 0 && Boolean(report) && !hasReportedError;
      const result: NeuraCoStudioOperationResult = {
        taskId,
        operation,
        tool,
        ok,
        summary: ok
          ? `${installed.name} a terminé l’opération et produit un rapport.`
          : `${installed.name} n’a pas validé l’opération.`,
        targetPath: normalizeRelative(path.relative(project.rootPath, target)),
        outputPath: outputPath
          ? normalizeRelative(path.relative(project.rootPath, outputPath))
          : undefined,
        reportPath,
        output: `${processResult.output}\n${report}`.trim().slice(-MAX_OUTPUT),
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString()
      };
      onEvent({
        taskId,
        type: ok ? 'completed' : 'failed',
        tool,
        message: result.summary,
        timestamp: result.completedAt
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Opération Studio impossible.';
      onEvent({
        taskId,
        type: 'failed',
        tool,
        message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  cancel(taskId: string): boolean {
    const running = this.running.get(taskId);
    if (!running) return false;
    const stopped = running.child.kill();
    if (stopped) this.running.delete(taskId);
    return stopped;
  }

  cancelAll(): number {
    let stopped = 0;
    for (const taskId of [...this.running.keys()]) {
      if (this.cancel(taskId)) stopped += 1;
    }
    return stopped;
  }
}
