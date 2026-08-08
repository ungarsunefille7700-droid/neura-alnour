import { spawnSync } from 'node:child_process';

const allowedUnpatchedAdvisories = new Set([
  'GHSA-w3rx-r6r6-pgpr',
  'GHSA-5p2g-fcmc-qvqq'
]);

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Le chemin du client npm est indisponible.');
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [npmCli, 'audit', '--omit=dev', '--json'],
  { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
);

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  console.error(result.stdout || result.stderr || 'npm audit n\u2019a produit aucun rapport JSON.');
  process.exit(1);
}

const vulnerabilities = Object.entries(report.vulnerabilities || {});
const blocked = [];
const accepted = [];
for (const [packageName, vulnerability] of vulnerabilities) {
  const advisoryIds = (vulnerability.via || [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => String(item.url || '').match(/GHSA-[\w-]+/i)?.[0])
    .filter(Boolean);
  const imageSizeAccepted = (
    packageName === 'image-size'
    && advisoryIds.length > 0
    && advisoryIds.every((id) => allowedUnpatchedAdvisories.has(id))
    && vulnerability.isDirect === false
  );
  const parentOnlyAccepted = (
    packageName === 'pptxgenjs'
    && vulnerability.isDirect === true
    && (vulnerability.via || []).length === 1
    && vulnerability.via[0] === 'image-size'
  );
  const narrowlyAccepted = imageSizeAccepted || parentOnlyAccepted;
  if (narrowlyAccepted) accepted.push({ packageName, advisoryIds });
  else blocked.push({ packageName, vulnerability });
}

if (blocked.length > 0) {
  console.error('Audit production refus\u00e9 : vuln\u00e9rabilit\u00e9s non autoris\u00e9es d\u00e9tect\u00e9es.');
  console.error(JSON.stringify(blocked, null, 2));
  process.exit(1);
}

if (result.status !== 0 && accepted.length === 0) {
  console.error(result.stderr || 'npm audit a \u00e9chou\u00e9 sans vuln\u00e9rabilit\u00e9 identifiable.');
  process.exit(1);
}

console.log('Audit production valid\u00e9.');
if (accepted.length > 0) {
  console.log(
    'Exception temporaire limit\u00e9e \u00e0 image-size, d\u00e9pendance transitive inutilis\u00e9e par le flux PowerPoint sans images :'
  );
  for (const item of accepted) {
    console.log(`- ${item.packageName}: ${item.advisoryIds.join(', ') || 'via image-size uniquement'}`);
  }
}
