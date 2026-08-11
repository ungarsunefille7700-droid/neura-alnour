import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import type {
  NeuraCoFiveMResourceValidation,
  NeuraCoProject,
  NeuraCoProjectExportResult,
  NeuraCoProjectValidation
} from './ipc-contract';
import { isProjectPathExcluded } from './workspace-core';

const MAX_EXPORT_FILES = 10_000;
const MAX_EXPORT_BYTES = 256 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_WALK_DEPTH = 40;

interface SafeProjectFile {
  relativePath: string;
  absolutePath: string;
  size: number;
  modifiedAt: Date;
}

interface SafeProjectInventory {
  files: SafeProjectFile[];
  totalBytes: number;
  excludedEntries: number;
}

const normalizeRelativePath = (value: string): string => (
  value.replaceAll('\\', '/').replace(/^\.\//, '')
);

const collectSafeProjectFiles = async (
  project: NeuraCoProject,
  outputFilePath?: string
): Promise<SafeProjectInventory> => {
  const files: SafeProjectFile[] = [];
  let totalBytes = 0;
  let excludedEntries = 0;
  const outputPath = outputFilePath ? path.resolve(outputFilePath) : undefined;

  const walk = async (directoryPath: string, relativeDirectory: string, depth: number) => {
    if (depth > MAX_WALK_DEPTH) {
      throw new Error(`Le projet depasse la profondeur maximale de ${MAX_WALK_DEPTH} dossiers.`);
    }
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(
        relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      );
      const absolutePath = path.join(directoryPath, entry.name);
      if (
        entry.isSymbolicLink()
        || isProjectPathExcluded(relativePath)
        || (outputPath && path.resolve(absolutePath) === outputPath)
      ) {
        excludedEntries += 1;
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        excludedEntries += 1;
        continue;
      }
      const fileStats = await stat(absolutePath);
      if (fileStats.size > MAX_SINGLE_FILE_BYTES) {
        throw new Error(
          `${relativePath} depasse la limite de ${MAX_SINGLE_FILE_BYTES / 1024 / 1024} Mo par fichier.`
        );
      }
      totalBytes += fileStats.size;
      if (totalBytes > MAX_EXPORT_BYTES) {
        throw new Error('Le projet depasse la limite securisee de 256 Mo pour un export ZIP.');
      }
      files.push({
        relativePath,
        absolutePath,
        size: fileStats.size,
        modifiedAt: fileStats.mtime
      });
      if (files.length > MAX_EXPORT_FILES) {
        throw new Error(`Le projet depasse la limite de ${MAX_EXPORT_FILES} fichiers exportables.`);
      }
    }
  };

  await walk(project.rootPath, '', 0);
  return { files, totalBytes, excludedEntries };
};

const extractQuotedValues = (value: string): string[] => {
  const values: string[] = [];
  const quoted = /(['"])(.*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(value)) !== null) {
    if (match[2].trim()) values.push(match[2].trim());
  }
  return values;
};

const globToRegExp = (pattern: string): RegExp => {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`, 'i');
};

const validateFiveMManifest = async (
  manifest: SafeProjectFile,
  projectPaths: string[]
): Promise<NeuraCoFiveMResourceValidation> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (manifest.size > MAX_MANIFEST_BYTES) {
    return {
      manifestPath: manifest.relativePath,
      valid: false,
      errors: ['Le manifeste depasse 2 Mo et ne peut pas etre valide.'],
      warnings
    };
  }

  const raw = (await readFile(manifest.absolutePath, 'utf8'))
    .replace(/--\[\[[\s\S]*?\]\]/g, '')
    .replace(/--[^\r\n]*/g, '');
  if (!/\bfx_version\s+(['"])[^'"]+\1/i.test(raw)) {
    errors.push("La directive fx_version est absente.");
  }
  const gameDeclaration = raw.match(/\bgames?\s*(?:\{[\s\S]*?\}|(['"])[^'"]+\1)/i)?.[0] || '';
  if (!/(['"])gta5\1/i.test(gameDeclaration)) {
    errors.push("La ressource ne declare pas le jeu gta5.");
  }

  const resourceDirectory = path.posix.dirname(manifest.relativePath) === '.'
    ? ''
    : path.posix.dirname(manifest.relativePath);
  const projectPathSet = new Set(projectPaths.map((entry) => entry.toLowerCase()));
  const directivePattern = /\b(client_scripts?|server_scripts?|shared_scripts?|files|ui_page|loadscreen)\s*(\{[\s\S]*?\}|(['"])[^'"\r\n]+\3)/gi;
  const scriptReferences: string[] = [];
  const allReferences: string[] = [];
  let directiveMatch: RegExpExecArray | null;
  while ((directiveMatch = directivePattern.exec(raw)) !== null) {
    const references = extractQuotedValues(directiveMatch[2]);
    allReferences.push(...references);
    if (/scripts?$/i.test(directiveMatch[1])) scriptReferences.push(...references);
  }

  if (scriptReferences.length === 0) {
    warnings.push('Aucun script client, serveur ou partage n\'est declare.');
  }
  for (const reference of new Set(allReferences)) {
    const normalizedReference = normalizeRelativePath(reference);
    if (
      normalizedReference.startsWith('@')
      || normalizedReference.startsWith('$')
      || /^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedReference)
    ) {
      continue;
    }
    const candidate = path.posix.normalize(
      resourceDirectory
        ? path.posix.join(resourceDirectory, normalizedReference)
        : normalizedReference
    );
    if (candidate === '..' || candidate.startsWith('../')) {
      errors.push(`Reference en dehors du projet interdite : ${reference}`);
      continue;
    }
    const exists = /[*?]/.test(candidate)
      ? projectPaths.some((entry) => globToRegExp(candidate).test(entry))
      : projectPathSet.has(candidate.toLowerCase());
    if (!exists) errors.push(`Fichier reference introuvable : ${reference}`);
  }

  const hasReadme = projectPaths.some((entry) => {
    const directory = path.posix.dirname(entry) === '.' ? '' : path.posix.dirname(entry);
    return directory === resourceDirectory && /^readme(?:\.|$)/i.test(path.posix.basename(entry));
  });
  if (!hasReadme) warnings.push('Aucun README n\'est present pour cette ressource.');

  return {
    manifestPath: manifest.relativePath,
    valid: errors.length === 0,
    errors,
    warnings
  };
};

export const validateProjectPackage = async (
  project: NeuraCoProject
): Promise<NeuraCoProjectValidation> => {
  const inventory = await collectSafeProjectFiles(project);
  const manifests = inventory.files.filter(
    (file) => path.posix.basename(file.relativePath).toLowerCase() === 'fxmanifest.lua'
  );
  const projectPaths = inventory.files.map((file) => file.relativePath);
  const resources = await Promise.all(
    manifests.map((manifest) => validateFiveMManifest(manifest, projectPaths))
  );
  const errors = resources.flatMap((resource) => (
    resource.errors.map((error) => `[${resource.manifestPath}] ${error}`)
  ));
  const warnings = resources.flatMap((resource) => (
    resource.warnings.map((warning) => `[${resource.manifestPath}] ${warning}`)
  ));
  if (inventory.files.length === 0) errors.push('Le projet ne contient aucun fichier exportable.');
  return {
    kind: manifests.length > 0 ? 'fivem' : 'generic',
    valid: errors.length === 0,
    checkedAt: new Date().toISOString(),
    fileCount: inventory.files.length,
    totalBytes: inventory.totalBytes,
    excludedEntries: inventory.excludedEntries,
    errors,
    warnings,
    resources
  };
};

export const projectArchiveDefaultName = (projectName: string): string => {
  const safeName = String(projectName || 'projet')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 80) || 'projet';
  return `${safeName}.zip`;
};

export const exportProjectPackage = async (
  project: NeuraCoProject,
  destinationPath: string,
  validation?: NeuraCoProjectValidation
): Promise<NeuraCoProjectExportResult> => {
  if (!destinationPath || path.extname(destinationPath).toLowerCase() !== '.zip') {
    throw new Error('La destination doit etre un fichier ZIP.');
  }
  const inventory = await collectSafeProjectFiles(project, destinationPath);
  if (inventory.files.length === 0) throw new Error('Le projet ne contient aucun fichier exportable.');
  const zip = new JSZip();
  for (const file of inventory.files) {
    zip.file(file.relativePath, await readFile(file.absolutePath), {
      binary: true,
      date: file.modifiedAt,
      createFolders: true
    });
  }
  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    streamFiles: true
  });
  await writeFile(destinationPath, archive);
  return {
    canceled: false,
    filePath: destinationPath,
    fileCount: inventory.files.length,
    totalBytes: inventory.totalBytes,
    compressedBytes: archive.length,
    excludedEntries: inventory.excludedEntries,
    sha256: createHash('sha256').update(archive).digest('hex').toUpperCase(),
    validation: validation || await validateProjectPackage(project)
  };
};
