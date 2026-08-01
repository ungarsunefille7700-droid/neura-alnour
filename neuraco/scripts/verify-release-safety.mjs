import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const required = [
  'build/icon.ico',
  'dist/index.html',
  'dist-electron/main.js',
  'dist-cli/cli/index.js',
  'dist-sdk/sdk/index.js'
];

const forbiddenName = /(?:^|\/)(?:\.env(?:\..+)?|[^/]+\.(?:pem|key|pfx|p12|crt|cer|keystore))$/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-(?:proj-|live-|test-|emergent-)?[A-Za-z0-9_-]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\brnd_[A-Za-z0-9]{12,}\b/,
  /\bvcp_[A-Za-z0-9]{12,}\b/,
  /\btvly-(?:dev-)?[A-Za-z0-9_-]{12,}\b/
];

for (const relative of required) {
  await access(path.join(root, relative));
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (packageJson.productName !== 'NeuraCo' || packageJson.version !== '1.0.4') {
  throw new Error('Le nom ou la version de production NeuraCo est incorrect.');
}

const scanRoots = ['dist', 'dist-electron', 'dist-cli', 'dist-sdk'];
const failures = [];

const scan = async (absolute, relative) => {
  const info = await stat(absolute);
  if (info.isDirectory()) {
    for (const entry of await readdir(absolute)) {
      await scan(path.join(absolute, entry), path.posix.join(relative, entry));
    }
    return;
  }

  if (forbiddenName.test(relative)) failures.push(`${relative} est un fichier sensible.`);
  if (/\.test\.(?:js|cjs|mjs)$/i.test(relative)) failures.push(`${relative} est un test compile.`);
  if (info.size > 12 * 1024 * 1024) return;

  const content = await readFile(absolute, 'utf8');
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) failures.push(`${relative} contient une chaine ressemblant a un secret.`);
    pattern.lastIndex = 0;
  }
};

for (const directory of scanRoots) {
  await scan(path.join(root, directory), directory);
}

const preload = await readFile(path.join(root, 'dist-electron', 'preload.js'), 'utf8');
if (/require\(["']\.\//.test(preload)) {
  failures.push('Le preload de production contient encore une dependance locale non regroupee.');
}

if (failures.length) {
  throw new Error(`Verification de release refusee :\n- ${[...new Set(failures)].join('\n- ')}`);
}

console.log('Release sure : nom, version, icone, dependances et sorties controles.');
