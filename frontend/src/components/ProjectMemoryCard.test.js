import { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import ProjectMemoryCard from './ProjectMemoryCard';
import { fingerprintOf, versionOf } from './ProjectWorkshop';

jest.mock('axios');
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ getAuthHeader: () => ({}) }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('the version of a file changes when its content changes', () => {
  expect(versionOf('print(1)')).toBe(versionOf('print(1)'));
  expect(versionOf('print(1)')).not.toBe(versionOf('print(2)'));
  expect(fingerprintOf([{ path: 'a', size: 1 }, { path: 'b', size: 2 }])).toBe(fingerprintOf([{ path: 'b', size: 2 }, { path: 'a', size: 1 }]));
});

test('the project memory of the conversation is shown, and nothing when there is none', async () => {
  const memory = {
    archive: { name: 'neura_garage.zip', total_files: 7 }, objective: 'Garage FiveM sécurisé',
    files_studied: [{ path: 'a.lua', state: 'lu' }, { path: 'b.lua', state: 'lu' }, { path: 'c.png', state: 'image' }],
    modified_files: [{ path: 'server/main.lua', lines: 15 }], constraints: ['Garder oxmysql'], decisions: [],
    remaining_steps: ['Ajouter la NUI'], open_errors: ['client.lua : erreur Lua'],
  };
  axios.get.mockResolvedValue({ data: { memory: { ...memory, conversation_id: 'c1' } } });
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => { root.render(<ProjectMemoryCard conversationId="c1" refreshKey={0} />); });
  await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('Mémoire du projet : neura_garage.zip');
  expect(container.textContent).toContain('2 fichiers étudiés · 1 livrés · 1 erreur(s) ouverte(s)');
  await act(async () => { container.querySelector('[data-testid="project-memory-toggle"]').click(); });
  expect(container.querySelector('[data-testid="project-memory-details"]').textContent).toContain('Garder oxmysql');
  axios.get.mockResolvedValue({ data: { memory: null } });
  await act(async () => { root.render(<ProjectMemoryCard conversationId="c2" refreshKey={0} />); });
  await act(async () => { await Promise.resolve(); });
  expect(container.querySelector('[data-testid="project-memory"]')).toBeNull();
  act(() => root.unmount());
});
