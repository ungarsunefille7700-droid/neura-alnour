import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const artifactName = `NeuraCo-Setup-v${version}.exe`;
const sourceDirectory = path.join(root, 'release-github');
const sourceArtifact = path.join(sourceDirectory, artifactName);
const targetDirectory = path.join(root, 'release-package', `v${version}`);

await rm(targetDirectory, { recursive: true, force: true });
await mkdir(targetDirectory, { recursive: true });

const artifact = await readFile(sourceArtifact);
const hash = createHash('sha256').update(artifact).digest('hex').toUpperCase();
const targetArtifact = path.join(targetDirectory, artifactName);
await copyFile(sourceArtifact, targetArtifact);

const blockmapName = `${artifactName}.blockmap`;
try {
  await copyFile(path.join(sourceDirectory, blockmapName), path.join(targetDirectory, blockmapName));
} catch {
  // Le blockmap est facultatif pour une publication manuelle.
}

const notesSource = path.join(root, 'docs', `RELEASE_NOTES_v${version}.md`);
await copyFile(notesSource, path.join(targetDirectory, 'RELEASE_NOTES.md'));
await writeFile(path.join(targetDirectory, 'SHA256SUMS.txt'), `${hash}  ${artifactName}\n`, 'utf8');

const artifactInfo = await stat(targetArtifact);
const manifest = {
  product: packageJson.productName,
  version,
  platform: 'windows',
  architecture: 'x64',
  installer: artifactName,
  bytes: artifactInfo.size,
  sha256: hash,
  signature: 'unsigned',
  backendBundled: false
};
await writeFile(
  path.join(targetDirectory, 'release-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
);

console.log(`Paquet GitHub prepare : ${targetDirectory}`);
console.log(`SHA-256 : ${hash}`);
