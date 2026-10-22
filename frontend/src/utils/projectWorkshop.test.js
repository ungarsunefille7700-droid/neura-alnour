import { buildZip } from './codeFiles';
import { readZipDirectory, readZipText, refusalReason, unsafePath } from './zipReader';
import {
  asksForWholeScope, buildProjectContext, excerptsOf, fileKind, outlineOf, rankFiles, selectScope,
} from './projectIndex';

const PROJECT = [
  { path: 'neura_garage/fxmanifest.lua', content: "fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client/main.lua'\nserver_script 'server/main.lua'\n" },
  { path: 'neura_garage/client/main.lua', content: "RegisterNetEvent('garage:open', function(vehicles)\n  SendNUIMessage({ action = 'open' })\nend)\n" },
  { path: 'neura_garage/server/main.lua', content: "RegisterNetEvent('garage:spawn', function(plate)\n  local src = source\n  TriggerClientEvent('garage:spawned', src, plate)\nend)\n" },
  { path: 'node_modules/lib/index.js', content: 'module.exports = 1;' },
  { path: 'README.md', content: '# Garage\n' },
];

const blobOf = (files) => {
  const bytes = buildZip(files);
  const blob = new Blob([bytes]);
  // jsdom's Blob may lack arrayBuffer(): the reader only needs slice() + arrayBuffer().
  if (!blob.arrayBuffer) {
    blob.slice = (start, end) => {
      const part = bytes.slice(start, end);
      return { arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) };
    };
  }
  return blob;
};

test('the directory of a real archive is read without decompressing it', async () => {
  const entries = await readZipDirectory(blobOf(PROJECT));
  expect(entries.map((e) => e.path)).toEqual(PROJECT.map((f) => f.path));
  expect(entries[0].size).toBe(PROJECT[0].content.length);
  const text = await readZipText(blobOf(PROJECT), entries[2]);
  expect(text).toContain("TriggerClientEvent('garage:spawned'");
});

test('dangerous archives are refused before anything is read', () => {
  expect(unsafePath('../evil.lua')).toBe(true);
  expect(unsafePath('C:/Windows/x.dll')).toBe(true);
  expect(unsafePath('client/main.lua')).toBe(false);
  expect(refusalReason({ path: 'a.txt', size: 50 * 1048576, compressedSize: 50000, method: 8 })).toContain('trop gros');
  expect(refusalReason({ path: 'b.txt', size: 1.5 * 1048576, compressedSize: 1000, method: 8 })).toContain('suspect');
  expect(refusalReason({ path: 'c.lua', size: 10, compressedSize: 10, method: 0, encrypted: true })).toBe('fichier chiffré');
});

test('every scope asked by the user, always on the inventory sorted by path', () => {
  const entries = PROJECT.map((f, index) => ({ index, path: f.path, size: f.content.length }));
  expect(selectScope(entries, { mode: 'all' }).map((e) => e.path)).not.toContain('node_modules/lib/index.js');
  expect(selectScope(entries, { mode: 'all', includeIgnored: true })).toHaveLength(5);
  expect(selectScope(entries, { mode: 'folders', folders: ['server'] }).map((e) => e.path)).toEqual(['neura_garage/server/main.lua']);
  expect(selectScope(entries, { mode: 'types', types: ['lua'] })).toHaveLength(3);
  const all = selectScope(entries, { mode: 'all' });
  expect([...selectScope(entries, { mode: 'half', half: 'first' }), ...selectScope(entries, { mode: 'half', half: 'second' })]).toEqual(all);
  expect(selectScope(entries, { mode: 'range', from: 2, to: 3 })).toEqual(all.slice(1, 3));
});

test('a targeted question sends only what it concerns, a whole-project question covers everything', () => {
  const entries = PROJECT.map((f) => ({ path: f.path, size: f.content.length }));
  const selected = selectScope(entries, { mode: 'all' });
  const texts = new Map(PROJECT.map((f) => [f.path, f.content]));
  expect(rankFiles('corrige le spawn', texts, [...texts.keys()])[0].path).toBe('neura_garage/server/main.lua');
  const targeted = buildProjectContext({ archiveName: 'g.zip', entries, selected, texts, question: 'corrige le spawn', budgetTokens: 48000 });
  expect(targeted.report.full).toContain('neura_garage/server/main.lua');
  expect(targeted.report.full).not.toContain('neura_garage/client/main.lua'); // not concerned: not sent
  expect(targeted.report.tokens).toBeLessThan(1000); // a ceiling, not a target
  expect(asksForWholeScope('analyse tout le projet')).toBe(true);
  const whole = buildProjectContext({ archiveName: 'g.zip', entries, selected, texts, question: 'analyse tout le projet', budgetTokens: 6000 });
  expect(whole.report.full.length + whole.report.partial.length + whole.report.outlined.length).toBe(4);
  expect(whole.text).toContain('COUVERTURE');
});

test('a huge file gives its relevant passages with line numbers, other files get a map', () => {
  const big = Array.from({ length: 3000 }, (_, i) => (i === 1500 ? 'local function payerVehicule(prix) end' : `print(${i})`)).join('\n');
  const passage = excerptsOf(big, 'payer vehicule payerVehicule', 2000);
  expect(passage).toContain('1501| local function payerVehicule(prix) end');
  expect(outlineOf("RegisterNetEvent('garage:spawn', function() end)\nlocal function ouvrir() end\ndef calcul():\n  pass")).toEqual(
    ['RegisterNetEvent garage:spawn', 'ouvrir', 'calcul']);
  expect(fileKind('ui/app.tsx')).toBe('code');
  expect(fileKind('video/demo.mp4')).toBe('video');
});
