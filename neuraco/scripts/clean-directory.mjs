import { rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const allowed = new Set([
  'dist-electron',
  'dist-cli',
  'dist-sdk',
  'release-github',
  'release-package'
]);
const requested = String(process.argv[2] || '');
if (!allowed.has(requested)) {
  throw new Error(`Refus de nettoyer un dossier non autorisé : ${requested || '(vide)'}`);
}

const root = process.cwd();
const target = path.resolve(root, requested);
if (path.dirname(target) !== root || path.basename(target) !== requested) {
  throw new Error('Le dossier de build doit rester à la racine de NeuraCo.');
}

await rm(target, { recursive: true, force: true });
