// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoDesktopApi,
  NeuraCoExtensionsState
} from '../electron/ipc-contract';
import ExtensionsPanel from './ExtensionsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state: NeuraCoExtensionsState = {
  officialCount: 1,
  enabledSkillCount: 1,
  enabledPluginCount: 0,
  enabledMcpToolCount: 1,
  extensions: [{
    id: 'react-developer',
    name: 'Développeur React',
    version: '1.0.0',
    description: 'Compétence de développement React',
    kind: 'skill',
    origin: 'official',
    provider: 'NeuraCo',
    privacyPolicy: 'Locale',
    sourcePath: 'C:\\source',
    installPath: 'C:\\installed',
    enabled: true,
    trust: 'verified',
    integrity: 'sha256:test',
    signatureVerified: true,
    permissions: {
      files: ['src/**'],
      network: [],
      commands: ['npm test'],
      data: ['code source']
    },
    tools: [{
      id: 'review',
      name: 'Revue',
      description: 'Vérifie le code',
      enabled: true
    }],
    instructions: 'Instructions',
    scripts: [],
    references: [],
    examples: ['example.md'],
    tests: ['skill.test.ts'],
    installedAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
    warnings: []
  }],
  mcpServers: [{
    id: 'mcp-1',
    name: 'GitHub MCP',
    transport: 'stdio',
    command: 'github-mcp',
    args: [],
    environmentVariables: ['GITHUB_TOKEN'],
    headers: [],
    enabled: true,
    status: 'connected',
    tools: [{
      name: 'issues_list',
      description: 'Liste les issues',
      inputSchema: { type: 'object' },
      enabled: true
    }],
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z'
  }]
};

afterEach(() => {
  document.body.innerHTML = '';
  delete window.neuraco;
});

describe('ExtensionsPanel', () => {
  it('shows verified permissions and lets the user disable each MCP tool', async () => {
    const setMcpToolEnabled = vi.fn().mockResolvedValue({
      ...state,
      enabledMcpToolCount: 0,
      mcpServers: [{
        ...state.mcpServers[0],
        tools: [{ ...state.mcpServers[0].tools[0], enabled: false }]
      }]
    });
    window.neuraco = {
      getExtensionsState: vi.fn().mockResolvedValue(state),
      setMcpToolEnabled
    } as unknown as NeuraCoDesktopApi;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ExtensionsPanel emergencyStopped={false} onStatus={vi.fn()} />
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Développeur React');
    expect(container.textContent).toContain('Signature vérifiée');
    expect(container.textContent).toContain('src/**');
    expect(container.textContent).toContain('GitHub MCP');
    const mcpTool = Array.from(
      container.querySelectorAll<HTMLInputElement>('.mcp-entry input[type="checkbox"]')
    ).find((input) => input.checked);
    expect(mcpTool).toBeDefined();

    await act(async () => {
      mcpTool!.click();
      await Promise.resolve();
    });
    expect(setMcpToolEnabled).toHaveBeenCalledWith(
      'mcp-1',
      'issues_list',
      false
    );

    await act(async () => root.unmount());
  });
});
