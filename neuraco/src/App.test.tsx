import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const createWorkspaceMocks = () => ({
  getRuntimePolicy: vi.fn().mockResolvedValue({
    revision: 1,
    maintenance: { active: false, enabled: false },
    providers: {
      anthropic: { enabled: true },
      openai: { enabled: true },
      gemini: { enabled: true }
    },
    disabled_models: [],
    models: [
      {
        id: 'claude-sonnet-4-5',
        provider: 'anthropic',
        display_name: 'Claude Sonnet 4.5',
        group: 'Anthropic'
      },
      {
        id: 'gpt-4o',
        provider: 'openai',
        display_name: 'GPT-4o',
        group: 'OpenAI'
      },
      {
        id: 'gemini-2.5-flash',
        provider: 'gemini',
        display_name: 'Gemini 2.5 Flash',
        group: 'Google Gemini'
      }
    ],
    plugins: { allow_unsigned_local: false, blocked_ids: [] },
    release: {
      latest_version: '1.0.10',
      minimum_supported_version: '1.0.0',
      rollout_percent: 100
    },
    incidents: [],
    server_time: '2026-08-13T00:00:00Z'
  }),
  getAccessibilitySettings: vi.fn().mockResolvedValue({
    theme: 'system',
    zoomPercent: 100,
    reducedMotion: false,
    highContrast: false
  }),
  updateAccessibilitySettings: vi.fn().mockImplementation(async (update) => ({
    theme: 'system',
    zoomPercent: 100,
    reducedMotion: false,
    highContrast: false,
    ...update
  })),
  getAppLockState: vi.fn().mockResolvedValue({
    configured: false,
    locked: false,
    pinEnabled: false,
    windowsHelloEnabled: false,
    windowsHelloAvailability: 'not_supported',
    lockOnStartup: false,
    idleTimeoutMinutes: 0,
    maskSensitiveNotifications: true,
    storageAvailable: true,
    failedAttempts: 0
  }),
  setAppLockPin: vi.fn(),
  removeAppLockPin: vi.fn(),
  updateAppLockSettings: vi.fn(),
  lockApp: vi.fn(),
  unlockAppWithPin: vi.fn(),
  setWindowsHelloEnabled: vi.fn(),
  unlockAppWithWindowsHello: vi.fn(),
  onAppLockEvent: vi.fn().mockReturnValue(() => undefined),
  onSessionEvent: vi.fn().mockReturnValue(() => undefined),
  listConnectedDevices: vi.fn().mockResolvedValue([]),
  revokeConnectedDevice: vi.fn().mockResolvedValue([]),
  openProject: vi.fn().mockResolvedValue(null),
  createProject: vi.fn().mockResolvedValue(null),
  cloneProject: vi.fn().mockResolvedValue(null),
  refreshProject: vi.fn().mockResolvedValue(null),
  validateProject: vi.fn(),
  exportProjectZip: vi.fn(),
  readProjectFile: vi.fn(),
  saveProjectFile: vi.fn(),
  startTerminalCommand: vi.fn().mockResolvedValue({ accepted: false }),
  cancelTerminalCommand: vi.fn().mockResolvedValue(false),
  onTerminalEvent: vi.fn().mockReturnValue(() => undefined),
  listBackgroundProcesses: vi.fn().mockResolvedValue([]),
  startBackgroundProcess: vi.fn(),
  controlBackgroundProcess: vi.fn(),
  getBackgroundProcessLog: vi.fn(),
  onBackgroundProcessEvent: vi.fn().mockReturnValue(() => undefined),
  listArtifacts: vi.fn().mockResolvedValue([]),
  getArtifact: vi.fn(),
  createArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  renameArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  restoreArtifactVersion: vi.fn(),
  compareArtifactVersions: vi.fn(),
  exportArtifact: vi.fn(),
  listControlledMemories: vi.fn().mockResolvedValue({
    enabled: true,
    entries: [],
    activeCount: 0,
    pendingCount: 0
  }),
  observeControlledMemory: vi.fn().mockResolvedValue({
    enabled: true,
    entries: [],
    activeCount: 0,
    pendingCount: 0
  }),
  updateControlledMemory: vi.fn(),
  deleteControlledMemory: vi.fn(),
  setControlledMemoryEnabled: vi.fn(),
  exportControlledMemories: vi.fn(),
  sendAgentMessage: vi.fn(),
  streamAgentMessage: vi.fn(),
  onAgentStreamEvent: vi.fn().mockReturnValue(() => undefined),
  cancelAgentMessage: vi.fn(),
  listSecondaryConversations: vi.fn().mockResolvedValue([]),
  createSecondaryConversation: vi.fn(),
  sendSecondaryConversationMessage: vi.fn(),
  archiveSecondaryConversation: vi.fn(),
  discoverEnvironments: vi.fn(),
  previewEnvironmentTransfer: vi.fn(),
  executeEnvironmentTransfer: vi.fn(),
  listEnvironmentTransfers: vi.fn(),
  getEnvironmentPreparation: vi.fn(),
  updateEnvironmentPreparation: vi.fn(),
  previewEnvironmentPreparation: vi.fn(),
  runEnvironmentPreparation: vi.fn(),
  listEnvironmentPreparationHistory: vi.fn(),
  createImageStudioJob: vi.fn(),
  listImageStudioJobs: vi.fn().mockResolvedValue([]),
  getImageStudioPreview: vi.fn(),
  exportImageStudioOutput: vi.fn(),
  getProjectPermissions: vi.fn(),
  updateProjectPermissions: vi.fn(),
  listCheckpoints: vi.fn(),
  createCheckpoint: vi.fn(),
  restoreCheckpoint: vi.fn(),
  getCheckpointRetention: vi.fn(),
  updateCheckpointRetention: vi.fn(),
  listTrash: vi.fn(),
  moveProjectPathToTrash: vi.fn(),
  restoreTrashEntry: vi.fn(),
  emergencyStop: vi.fn(),
  emergencyResume: vi.fn(),
  onEmergencyState: vi.fn().mockReturnValue(() => undefined),
  getEmergencyShortcut: vi.fn(),
  setEmergencyShortcut: vi.fn(),
  listRecoverableTasks: vi.fn(),
  inspectRecoverableTask: vi.fn(),
  resumeRecoverableTask: vi.fn(),
  discardRecoverableTask: vi.fn(),
  listNotifications: vi.fn().mockResolvedValue([]),
  markNotificationRead: vi.fn().mockResolvedValue([]),
  archiveNotification: vi.fn().mockResolvedValue([]),
  runNotificationAction: vi.fn(),
  onNotificationEvent: vi.fn().mockReturnValue(() => undefined),
  listGoals: vi.fn().mockResolvedValue([]),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  updateGoalStep: vi.fn(),
  resolveGoalProposal: vi.fn(),
  listAgents: vi.fn().mockResolvedValue([]),
  saveCustomAgent: vi.fn(),
  deleteCustomAgent: vi.fn(),
  previewTaskRoute: vi.fn(),
  runMultiAgentTask: vi.fn(),
  cancelMultiAgentTask: vi.fn(),
  onMultiAgentProgress: vi.fn().mockReturnValue(() => undefined),
  listReviewQueue: vi.fn().mockResolvedValue([]),
  updateReviewStatus: vi.fn(),
  addReviewComment: vi.fn(),
  decideReviewFile: vi.fn(),
  recordReviewTests: vi.fn(),
  attachReviewCheckpoint: vi.fn(),
  getGitStatus: vi.fn(),
  getGitDiff: vi.fn(),
  createGitWorktree: vi.fn(),
  removeGitWorktree: vi.fn(),
  openGitWorktree: vi.fn(),
  commitGitWorktree: vi.fn(),
  listGitTestCommands: vi.fn(),
  runGitTests: vi.fn(),
  runGitTestSuite: vi.fn(),
  reviewGitBranch: vi.fn(),
  mergeGitBranch: vi.fn(),
  getForgeConnection: vi.fn(),
  getForgeInbox: vi.fn(),
  getForgeIssue: vi.fn(),
  createForgePullRequest: vi.fn(),
  getBrowserState: vi.fn(),
  newBrowserTab: vi.fn(),
  closeBrowserTab: vi.fn(),
  activateBrowserTab: vi.fn(),
  navigateBrowser: vi.fn(),
  browserBack: vi.fn(),
  browserForward: vi.fn(),
  browserReload: vi.fn(),
  setBrowserBounds: vi.fn(),
  toggleBrowserDevTools: vi.fn(),
  captureBrowser: vi.fn(),
  selectBrowserElement: vi.fn(),
  runBrowserAction: vi.fn(),
  inspectBrowserDiagnostics: vi.fn(),
  getBrowserHistory: vi.fn(),
  getBrowserDownloads: vi.fn().mockResolvedValue([]),
  getBrowserAnnotations: vi.fn(),
  saveBrowserAnnotation: vi.fn(),
  hideBrowser: vi.fn(),
  onBrowserEvent: vi.fn().mockReturnValue(() => undefined),
  listApplications: vi.fn(),
  launchApplication: vi.fn(),
  stopApplication: vi.fn(),
  listComputerWindows: vi.fn().mockResolvedValue([]),
  inspectComputerWindow: vi.fn(),
  captureComputerWindow: vi.fn(),
  planComputerAction: vi.fn(),
  executeComputerPlan: vi.fn(),
  cancelComputerPlan: vi.fn(),
  analyzeStudioProject: vi.fn(),
  runStudioOperation: vi.fn(),
  cancelStudioOperation: vi.fn(),
  onStudioEvent: vi.fn().mockReturnValue(() => undefined)
});

describe('NeuraCo desktop foundation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.neuraco;
    vi.useRealTimers();
  });

  it('quitte le chargement bloque et permet de retenter la session', async () => {
    vi.useFakeTimers();
    const restoreSession = vi.fn()
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
      .mockResolvedValueOnce({
        status: 'authenticated',
        user: {
          id: 'user-retry',
          email: 'member@example.com',
          name: 'Member',
          subscription: 'neura_ultra',
          is_vip: false
        },
        entitlement: {
          neuraco_access: true,
          plan: 'neura_ultra',
          reason: 'subscription_active'
        },
        persistent: true
      });
    window.neuraco = {
      ...createWorkspaceMocks(),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'NeuraCo',
        version: '1.0.4',
        platform: 'win32',
        architecture: 'x64',
        packaged: true
      }),
      runSelfCheck: vi.fn(),
      restoreSession,
      login: vi.fn(),
      register: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn()
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Connexion sécurisée');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(container.textContent).toContain('La restauration de session a expiré');
    expect(container.textContent).toContain('Réessayer la connexion');
    expect(container.textContent).not.toContain('Connexion sécurisée...');

    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Réessayer la connexion')
    );
    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(restoreSession).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('NeuraCo est prêt');
  });

  it('renders the real foundation without exposing unavailable tools', async () => {
    await act(async () => root.render(<App />));

    expect(container.textContent).toContain('NeuraCo est prêt');
    expect(container.textContent).toContain('Aperçu navigateur');
    expect(container.textContent).toContain('Aucun projet ouvert');
    expect(container.querySelector('textarea')?.disabled).toBe(true);
  });

  it('allows an authenticated user to chat without opening a project', async () => {
    const streamAgentMessage = vi.fn().mockResolvedValue({
      message: 'Réponse générale NeuraCo',
      sessionId: 'general-session-1',
      provider: 'openai',
      model: 'gpt-4o',
      modelDisplay: 'GPT-4o',
      mode: 'question',
      filesUsed: [],
      imagesUsed: [],
      entitlementPlan: 'neura_ultra'
    });
    window.neuraco = {
      ...createWorkspaceMocks(),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'NeuraCo',
        version: '1.0.2',
        platform: 'win32',
        architecture: 'x64',
        packaged: true
      }),
      runSelfCheck: vi.fn(),
      restoreSession: vi.fn().mockResolvedValue({
        status: 'authenticated',
        user: {
          id: 'vip-1',
          email: 'founder@example.com',
          name: 'Founder',
          subscription: 'neura_ultra',
          is_vip: true
        },
        entitlement: {
          neuraco_access: true,
          plan: 'neura_ultra',
          reason: 'administrator'
        },
        persistent: true
      }),
      streamAgentMessage,
      login: vi.fn(),
      register: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn()
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const preferences = container.querySelectorAll<HTMLSelectElement>(
      '.home-composer-options select'
    );
    const selectSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )?.set;
    await act(async () => {
      selectSetter?.call(preferences[0], 'claude-sonnet-4-5');
      preferences[0]?.dispatchEvent(new Event('change', { bubbles: true }));
      selectSetter?.call(preferences[1], 'deep');
      preferences[1]?.dispatchEvent(new Event('change', { bubbles: true }));
      selectSetter?.call(preferences[2], 'fast');
      preferences[2]?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('.composer textarea');
    expect(textarea?.disabled).toBe(false);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    await act(async () => {
      setter?.call(textarea, 'Bonjour NeuraCo');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>('.composer')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Bonjour NeuraCo',
      projectId: '000000000000000000000001',
      projectName: 'Conversation générale',
      model: 'claude-sonnet-4-5',
      effort: 'deep',
      responseSpeed: 'fast',
      files: [],
      images: []
    }));
    expect(container.textContent).toContain('Réponse générale NeuraCo');
  });

  it('renders the server-authoritative model catalogue', async () => {
    const mocks = createWorkspaceMocks();
    mocks.getRuntimePolicy.mockResolvedValue({
      revision: 2,
      maintenance: { active: false, enabled: false },
      providers: {
        anthropic: { enabled: true },
        openai: { enabled: true },
        gemini: { enabled: true }
      },
      disabled_models: [],
      models: [
        {
          id: 'claude-opus-4-8',
          provider: 'anthropic',
          display_name: 'Claude Opus 4.8',
          group: 'Anthropic'
        },
        {
          id: 'gpt-5.6-sol',
          provider: 'openai',
          display_name: 'GPT-5.6 Sol',
          group: 'OpenAI'
        },
        {
          id: 'gemini-3.5-flash',
          provider: 'gemini',
          display_name: 'Gemini 3.5 Flash',
          group: 'Google Gemini'
        }
      ],
      plugins: { allow_unsigned_local: false, blocked_ids: [] },
      release: {
        latest_version: '1.0.10',
        minimum_supported_version: '1.0.0',
        rollout_percent: 100
      },
      incidents: [],
      server_time: '2026-08-13T00:00:00Z'
    });
    window.neuraco = {
      ...mocks,
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'NeuraCo',
        version: '1.0.10',
        platform: 'win32',
        architecture: 'x64',
        packaged: true
      }),
      runSelfCheck: vi.fn(),
      restoreSession: vi.fn().mockResolvedValue({
        status: 'authenticated',
        user: {
          id: 'vip-models',
          email: 'founder@example.com',
          name: 'Founder',
          subscription: 'neura_ultra',
          is_vip: true
        },
        entitlement: {
          neuraco_access: true,
          plan: 'neura_ultra',
          reason: 'administrator'
        },
        persistent: true
      }),
      login: vi.fn(),
      register: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn()
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const modelSelect = container.querySelector<HTMLSelectElement>(
      '.home-composer-options select'
    );
    const labels = Array.from(modelSelect?.options || []).map((option) => option.textContent);
    expect(labels).toContain('Claude Opus 4.8');
    expect(labels).toContain('GPT-5.6 Sol');
    expect(labels).toContain('Gemini 3.5 Flash');
    expect(labels).not.toContain('Claude Opus 5');
  });

  it('creates and opens a new local project from the sidebar', async () => {
    const createProject = vi.fn().mockResolvedValue({
      project: {
        id: 'project-created',
        name: 'Mon Application',
        rootPath: 'C:\\Users\\member\\Projects\\Mon Application'
      },
      files: [],
      indexedFiles: 0,
      excludedEntries: 0,
      truncated: false
    });
    const cloneProject = vi.fn().mockResolvedValue({
      project: {
        id: 'project-cloned',
        name: 'Hello-World',
        rootPath: 'C:\\Users\\member\\Projects\\Hello-World'
      },
      files: [],
      indexedFiles: 1,
      excludedEntries: 1,
      truncated: false
    });
    window.neuraco = {
      ...createWorkspaceMocks(),
      createProject,
      cloneProject,
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'NeuraCo',
        version: '1.0.5',
        platform: 'win32',
        architecture: 'x64',
        packaged: true
      }),
      runSelfCheck: vi.fn(),
      restoreSession: vi.fn().mockResolvedValue({
        status: 'authenticated',
        user: {
          id: 'member-1',
          email: 'member@example.com',
          name: 'Member',
          subscription: 'neura_plus',
          is_vip: false
        },
        entitlement: {
          neuraco_access: true,
          plan: 'neura_plus',
          reason: 'subscription_active'
        },
        persistent: true
      }),
      login: vi.fn(),
      register: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn()
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const createButton = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Cr\u00e9er un nouveau projet')
    );
    expect(createButton).toBeDefined();
    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const input = container.querySelector<HTMLInputElement>('#new-project-name');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, 'Mon Application');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input?.closest('form')?.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createProject).toHaveBeenCalledWith('Mon Application');
    expect(container.textContent).toContain('Mon Application');
    expect(container.querySelector('#new-project-name')).toBeNull();

    const cloneButton = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Cloner un d\u00e9p\u00f4t Git')
    );
    expect(cloneButton).toBeDefined();
    await act(async () => {
      cloneButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const repositoryInput = container.querySelector<HTMLInputElement>('#repository-url');
    await act(async () => {
      setter?.call(repositoryInput, 'https://github.com/octocat/Hello-World.git');
      repositoryInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      repositoryInput?.closest('form')?.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cloneProject).toHaveBeenCalledWith('https://github.com/octocat/Hello-World.git');
    expect(container.textContent).toContain('Hello-World');
    expect(container.querySelector('#repository-url')).toBeNull();
  });

  it('reads app information and verifies security through the preload API', async () => {
    window.neuraco = {
      ...createWorkspaceMocks(),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'NeuraCo',
        version: '0.1.0',
        platform: 'win32',
        architecture: 'x64',
        packaged: true
      }),
      runSelfCheck: vi.fn().mockResolvedValue({
        ok: true,
        checkedAt: '2026-07-25T00:00:00.000Z',
        checks: {
          contextIsolation: true,
          nodeIntegrationDisabled: true,
          sandboxEnabled: true,
          navigationGuardEnabled: true
        }
      }),
      restoreSession: vi.fn().mockResolvedValue({
        status: 'authenticated',
        user: {
          id: 'user-1',
          email: 'member@example.com',
          name: 'Member',
          subscription: 'pro',
          is_vip: false
        },
        entitlement: {
          neuraco_access: true,
          plan: 'pro',
          reason: 'subscription_active'
        },
        persistent: true
      }),
      login: vi.fn(),
      register: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn()
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const securityButton = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Sécurité'
    );
    await act(async () => {
      securityButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Vérifier maintenant')
    );
    expect(button).toBeDefined();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('win32');
    expect(container.textContent).toContain('x64');
    expect(container.textContent).toContain('Vérifié');
    expect(window.neuraco?.runSelfCheck).toHaveBeenCalledOnce();
  });

  it('blocks the workspace until desktop authentication succeeds', async () => {
    const authenticatedSession = {
      status: 'authenticated' as const,
      user: {
        id: 'user-1',
        email: 'member@example.com',
        name: 'Member',
        subscription: 'pro',
        is_vip: false
      },
      entitlement: {
        neuraco_access: true,
        plan: 'pro',
        reason: 'subscription_active'
      },
      persistent: true
    };
    window.neuraco = {
      ...createWorkspaceMocks(),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'NeuraCo',
        version: '0.1.0',
        platform: 'win32',
        architecture: 'x64',
        packaged: true
      }),
      runSelfCheck: vi.fn(),
      restoreSession: vi.fn().mockResolvedValue({ status: 'signed_out' }),
      login: vi.fn(),
      register: vi.fn(),
      loginWithGoogle: vi.fn().mockResolvedValue(authenticatedSession),
      logout: vi.fn()
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Connectez-vous à NeuraCo');
    expect(container.textContent).not.toContain('NeuraCo est prêt');

    const googleButton = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Continuer avec Google')
    );
    await act(async () => {
      googleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.neuraco?.loginWithGoogle).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('NeuraCo est prêt');
    expect(container.textContent).toContain('Member');
  });

  it('creates an account through the protected desktop registration bridge', async () => {
    const registeredSession = {
      status: 'authenticated' as const,
      user: {
        id: 'user-2',
        email: 'new.member@example.com',
        name: 'New Member',
        subscription: 'neura_plus',
        is_vip: false
      },
      entitlement: {
        neuraco_access: true,
        plan: 'neura_plus',
        reason: 'subscription_active'
      },
      persistent: true
    };
    const register = vi.fn().mockResolvedValue(registeredSession);
    window.neuraco = {
      ...createWorkspaceMocks(),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'NeuraCo',
        version: '1.0.1',
        platform: 'win32',
        architecture: 'x64',
        packaged: true
      }),
      runSelfCheck: vi.fn(),
      restoreSession: vi.fn().mockResolvedValue({ status: 'signed_out' }),
      login: vi.fn(),
      register,
      loginWithGoogle: vi.fn(),
      logout: vi.fn()
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const createAccountSwitch = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Créer un compte'
    );
    await act(async () => {
      createAccountSwitch?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Créez votre compte');
    const nameInput = container.querySelector<HTMLInputElement>('input[autocomplete="name"]');
    const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]');
    const passwordInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="password"]')
    );
    const inputSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set;

    await act(async () => {
      inputSetter?.call(nameInput, 'New Member');
      nameInput?.dispatchEvent(new Event('input', { bubbles: true }));
      inputSetter?.call(emailInput, 'new.member@example.com');
      emailInput?.dispatchEvent(new Event('input', { bubbles: true }));
      inputSetter?.call(passwordInputs[0], 'StrongPassword42');
      passwordInputs[0]?.dispatchEvent(new Event('input', { bubbles: true }));
      inputSetter?.call(passwordInputs[1], 'StrongPassword42');
      passwordInputs[1]?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const createAccountSubmit = container.querySelector<HTMLButtonElement>(
      'form button[type="submit"]'
    );
    await act(async () => {
      createAccountSubmit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(register).toHaveBeenCalledWith({
      name: 'New Member',
      email: 'new.member@example.com',
      password: 'StrongPassword42'
    });
    expect(container.textContent).toContain('New Member');
  });

  it('applies accessible themes and zoom through the desktop API', async () => {
    const desktop = {
      ...createWorkspaceMocks(),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'NeuraCo',
        version: '0.1.0',
        platform: 'win32',
        architecture: 'x64',
        packaged: true
      }),
      runSelfCheck: vi.fn(),
      restoreSession: vi.fn().mockResolvedValue({
        status: 'authenticated',
        user: {
          id: 'user-1',
          email: 'member@example.com',
          name: 'Member',
          subscription: 'pro',
          is_vip: false
        },
        entitlement: {
          neuraco_access: true,
          plan: 'pro',
          reason: 'subscription_active'
        },
        persistent: true
      }),
      login: vi.fn(),
      register: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn()
    };
    window.neuraco = desktop;

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const accessibilityButton = container
      .querySelector('.lucide-accessibility')
      ?.closest('button');
    await act(async () => {
      accessibilityButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const themeSelect = container.querySelector<HTMLSelectElement>(
      '.accessibility-setting-row select'
    );
    expect(themeSelect).not.toBeNull();
    await act(async () => {
      if (themeSelect) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value'
        )?.set;
        setter?.call(themeSelect, 'dark');
        themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(desktop.updateAccessibilitySettings).toHaveBeenCalledWith({ theme: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: '+',
        ctrlKey: true,
        bubbles: true
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(desktop.updateAccessibilitySettings).toHaveBeenCalledWith({ zoomPercent: 110 });
    expect(container.querySelector('.skip-link')?.getAttribute('href')).toBe('#main-content');
  });

  it('keeps the workspace hidden until the application PIN is verified', async () => {
    const unlocked = {
      configured: true,
      locked: false,
      pinEnabled: true,
      windowsHelloEnabled: false,
      windowsHelloAvailability: 'not_supported' as const,
      lockOnStartup: true,
      idleTimeoutMinutes: 5,
      maskSensitiveNotifications: true,
      storageAvailable: true,
      failedAttempts: 0
    };
    const desktop = {
      ...createWorkspaceMocks(),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'NeuraCo',
        version: '0.1.0',
        platform: 'win32',
        architecture: 'x64',
        packaged: true
      }),
      runSelfCheck: vi.fn(),
      restoreSession: vi.fn().mockResolvedValue({
        status: 'authenticated',
        user: {
          id: 'user-1',
          email: 'member@example.com',
          name: 'Member',
          subscription: 'pro',
          is_vip: false
        },
        entitlement: {
          neuraco_access: true,
          plan: 'pro',
          reason: 'subscription_active'
        },
        persistent: true
      }),
      getAppLockState: vi.fn().mockResolvedValue({
        ...unlocked,
        locked: true,
        reason: 'startup'
      }),
      unlockAppWithPin: vi.fn().mockResolvedValue(unlocked),
      login: vi.fn(),
      register: vi.fn(),
      loginWithGoogle: vi.fn(),
      logout: vi.fn()
    };
    window.neuraco = desktop;

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Application verrouillée');
    expect(container.textContent).not.toContain('NeuraCo est prÃªt');
    const input = container.querySelector<HTMLInputElement>('#app-lock-pin');
    await act(async () => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;
        setter?.call(input, '4286');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const unlockButton = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Déverrouiller')
    );
    await act(async () => {
      unlockButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(desktop.unlockAppWithPin).toHaveBeenCalledWith('4286');
    expect(container.textContent).toContain('NeuraCo est prêt');
  });
});
