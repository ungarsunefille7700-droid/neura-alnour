import fs from 'fs';
import path from 'path';
import { checkLua, manifestFiles } from './luaCheck';
import { checkProject } from './projectCheck';

test('balanced Lua passes, the usual mistakes are found with their line', () => {
  expect(checkLua('local t = {1, 2}\nfunction f(a)\n  if a then\n    for i = 1, 3 do print(i) end\n  end\n  return [[ok]]\nend\n')).toEqual([]);
  expect(checkLua('function f(a)\n  if a then\n    print("x")\nend\n')).toEqual(['ligne 1 : « function » jamais fermé']);
  expect(checkLua("print('oups)\n")).toEqual(['ligne 1 : chaîne jamais fermée']);
  expect(checkLua('if x then\n  y()\nend\nend')).toEqual(['ligne 4 : « end » en trop ou mal placé']);
  expect(checkLua('repeat x = x + 1 until x > 3\nwhile true do break end\n--[[ long\ncomment ]] ok()')).toEqual([]);
});

test('the files a manifest declares, without other resources or wildcards', () => {
  const manifest = "client_scripts { 'client.lua', '@ox_lib/init.lua' }\nui_page 'html/index.html'\nfiles { 'html/*.png', 'html/app.js' }";
  expect(manifestFiles(manifest)).toEqual(['client.lua', 'html/index.html', 'html/app.js']);
});

const fixture = (dir) => {
  const files = [];
  const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push({ path: path.relative(dir, full).split(path.sep).join('/'), content: fs.readFileSync(full, 'utf8') });
  });
  walk(dir);
  return files;
};

test('a real FiveM resource made by Neura (benchmark of 2026-10-17) passes every check', () => {
  const files = fixture(path.join(__dirname, '__fixtures__', 'neura_annonce'));
  expect(files.map((file) => file.path).sort()).toContain('fxmanifest.lua');
  expect(checkProject(files)).toEqual([]);
});

test('a broken FiveM resource is reported, so « Corriger automatiquement » appears', () => {
  const issues = checkProject([
    { path: 'fxmanifest.lua', content: "fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'\nserver_script 'server.lua'" },
    { path: 'client.lua', content: "RegisterNetEvent('x', function()\n  if true then\n    print('a')\nend)" },
  ]);
  expect(issues.map((issue) => issue.message)).toEqual([
    'erreur Lua : ligne 1 : « function » jamais fermé par « end » (avant le « ) » de la ligne 4)',
    "déclare « server.lua », qui n'existe pas dans le projet",
  ]);
  expect(checkProject([{ path: 'client.lua', content: 'CreateThread(function() end)' },
    { path: 'server.lua', content: "RegisterNetEvent('a', function() end)" }])[0].message).toContain('fxmanifest.lua');
  // One modified file sent back from an existing project (its manifest is in the archive): no false alarm.
  expect(checkProject([{ path: 'neura_garage/server/main.lua', content: "RegisterNetEvent('garage:spawn', function() end)" }])).toEqual([]);
});
