import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoDesktopApi,
  NeuraCoNotificationEvent,
  NeuraCoProjectSnapshot,
  NeuraCoTerminalEvent
} from '../electron/ipc-contract';

vi.mock('./monaco-setup', () => ({}));
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Éditeur de code"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}));
vi.mock('./image-attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./image-attachments')>();
  return {
    ...actual,
    prepareImageAttachment: vi.fn().mockImplementation(
      async (file: File, onProgress?: (progress: number) => void) => {
        onProgress?.(100);
        return {
          id: 'image-test-123',
          name: file.name,
          mimeType: 'image/png',
          dataBase64: 'iVBORw0KGgo=',
          width: 320,
          height: 180,
          size: 8,
          preview: 'data:image/png;base64,iVBORw0KGgo='
        };
      }
    )
  };
});

import WorkspacePage from './WorkspacePage';

const setControlValue = (
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string
) => {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
};

const setSelectValue = (control: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    'value'
  )?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('change', { bubbles: true }));
};

const validateRouting = async (container: HTMLElement) => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.includes('Valider et démarrer')
  );
  await act(async () => {
    button?.click();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const snapshot: NeuraCoProjectSnapshot = {
  project: {
    id: 'project-1',
    name: 'sample-project',
    rootPath: 'C:\\projects\\sample-project'
  },
  files: [
    {
      name: 'src',
      relativePath: 'src',
      kind: 'directory',
      children: [
        {
          name: 'main.ts',
          relativePath: 'src/main.ts',
          kind: 'file',
          size: 21
        }
      ]
    }
  ],
  indexedFiles: 1,
  excludedEntries: 2,
  truncated: false
};

const createDesktopApi = () => {
  let terminalListener: ((event: NeuraCoTerminalEvent) => void) | undefined;
  let notificationListener: ((event: NeuraCoNotificationEvent) => void) | undefined;
  const reviewItem = {
    id: 'review_12345678',
    source: 'multi_agent' as const,
    sourceId: 'task_12345678',
    projectId: snapshot.project.id,
    projectName: snapshot.project.name,
    task: 'Analyser le fichier actif',
    agent: 'Développeur, Tests',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    durationMs: 1200,
    creditsUsed: 0.42,
    files: [{
      path: 'src/main.ts',
      changeKind: 'proposed' as const,
      decision: 'pending' as const
    }],
    tests: [{
      label: 'Test du contrat',
      status: 'passed' as const
    }],
    risk: 'low' as const,
    risks: [],
    permissions: ['mode:scoped'],
    status: 'pending' as const,
    comments: [],
    summary: 'Le contrat a été analysé.',
    result: 'Revue indépendante validée.',
    rerun: {
      objective: 'Analyser le fichier actif',
      selectedAgentIds: ['developer', 'tests'],
      maxAgents: 2,
      budget: 8,
      filePaths: ['src/main.ts']
    }
  };
  const artifact = {
    id: 'artifact_12345678',
    projectId: snapshot.project.id,
    projectName: snapshot.project.name,
    title: 'Rapport interactif',
    description: 'Rapport autonome du projet',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:01:00.000Z',
    currentVersionId: 'artifact_version_2',
    versionCount: 2,
    sources: [{
      label: 'Rapport de tests',
      kind: 'embedded' as const,
      access: 'read_only' as const,
      authorized: true
    }],
    html: '<!doctype html><html><head></head><body><button>Tester</button></body></html>',
    versions: [
      {
        id: 'artifact_version_2',
        number: 2,
        createdAt: '2026-07-28T00:01:00.000Z',
        summary: 'Bouton ajouté',
        size: 85
      },
      {
        id: 'artifact_version_1',
        number: 1,
        createdAt: '2026-07-28T00:00:00.000Z',
        summary: 'Version initiale',
        size: 63
      }
    ]
  };
  const api: NeuraCoDesktopApi = {
    getAppInfo: vi.fn(),
    runSelfCheck: vi.fn(),
    restoreSession: vi.fn(),
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    logout: vi.fn(),
    openProject: vi.fn(),
    refreshProject: vi.fn().mockResolvedValue(snapshot),
    readProjectFile: vi.fn().mockResolvedValue({
      relativePath: 'src/main.ts',
      content: 'export const ready = true;\n',
      language: 'typescript',
      size: 27,
      modifiedAt: '2026-07-26T00:00:00.000Z'
    }),
    saveProjectFile: vi.fn().mockResolvedValue({
      relativePath: 'src/main.ts',
      size: 28,
      savedAt: '2026-07-26T00:00:01.000Z'
    }),
    startTerminalCommand: vi.fn().mockResolvedValue({
      accepted: true,
      commandId: 'command-1'
    }),
    cancelTerminalCommand: vi.fn().mockResolvedValue(true),
    listTerminalProfiles: vi.fn().mockResolvedValue([
      {
        id: 'cmd',
        label: 'Invite de commandes',
        available: true,
        detail: 'C:\\Windows\\System32\\cmd.exe',
        requiresTarget: false
      },
      {
        id: 'powershell',
        label: 'PowerShell',
        available: true,
        detail: 'powershell.exe',
        requiresTarget: false
      }
    ]),
    assessTerminalCommand: vi.fn().mockResolvedValue({
      level: 'safe',
      label: 'Niveau sûr',
      reason: 'Commande de test.',
      requiresExplicitConfirmation: false
    }),
    onTerminalEvent: vi.fn((listener) => {
      terminalListener = listener;
      return () => {
        terminalListener = undefined;
      };
    }),
    listBackgroundProcesses: vi.fn().mockResolvedValue([]),
    startBackgroundProcess: vi.fn(),
    controlBackgroundProcess: vi.fn(),
    getBackgroundProcessLog: vi.fn().mockResolvedValue({
      processId: 'process-1',
      content: 'ready',
      truncated: false,
      updatedAt: '2026-07-28T00:00:00.000Z'
    }),
    onBackgroundProcessEvent: vi.fn().mockReturnValue(() => undefined),
    listArtifacts: vi.fn().mockResolvedValue([artifact]),
    getArtifact: vi.fn().mockResolvedValue(artifact),
    createArtifact: vi.fn().mockResolvedValue(artifact),
    updateArtifact: vi.fn().mockImplementation(async (_artifactId, input) => ({
      ...artifact,
      html: input.html,
      versionCount: 3,
      currentVersionId: 'artifact_version_3',
      versions: [{
        id: 'artifact_version_3',
        number: 3,
        createdAt: '2026-07-28T00:02:00.000Z',
        summary: input.summary,
        size: input.html.length
      }, ...artifact.versions]
    })),
    renameArtifact: vi.fn().mockImplementation(async (_artifactId, title) => ({
      ...artifact,
      title
    })),
    deleteArtifact: vi.fn().mockResolvedValue([]),
    restoreArtifactVersion: vi.fn().mockResolvedValue({
      ...artifact,
      versionCount: 3,
      currentVersionId: 'artifact_version_3',
      html: '<!doctype html><html><body>Version restaurée</body></html>',
      versions: [{
        id: 'artifact_version_3',
        number: 3,
        createdAt: '2026-07-28T00:02:00.000Z',
        summary: 'Restauration de la version 1',
        size: 62
      }, ...artifact.versions]
    }),
    compareArtifactVersions: vi.fn().mockResolvedValue({
      artifactId: artifact.id,
      fromVersionId: 'artifact_version_1',
      toVersionId: 'artifact_version_2',
      fromNumber: 1,
      toNumber: 2,
      addedLines: 1,
      removedLines: 0,
      diff: '+ <button>Tester</button>',
      truncated: false
    }),
    exportArtifact: vi.fn().mockResolvedValue('C:\\exports\\rapport.html'),
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
    exportControlledMemories: vi.fn().mockResolvedValue(null),
    previewTaskRoute: vi.fn().mockImplementation(async (request) => {
      const effort = request.effort || 'normal';
      const communicationStyle = request.communicationStyle || 'normal';
      const routedMode = request.requestedMode === 'automatic'
        ? /ajoute|corrige|implémente/i.test(request.content)
          ? 'code'
          : 'question'
        : request.requestedMode;
      const multiAgent = !['question', 'plan'].includes(routedMode);
      return {
        mode: routedMode,
        modeLabel: routedMode === 'code'
          ? 'Code'
          : routedMode === 'plan'
            ? 'Plan'
            : 'Question',
        reason: multiAgent
          ? 'La demande correspond principalement au mode Code.'
          : 'La demande reste une conversation.',
        categories: multiAgent
          ? [{ id: 'code', label: 'Développement', confidence: 91 }]
          : [],
        agents: multiAgent
          ? [
              { id: 'architect', name: 'Architecte', role: 'Architecture' },
              { id: 'developer', name: 'Développeur', role: 'Développement' },
              { id: 'tests', name: 'Tests', role: 'Validation' }
            ]
          : [],
        tools: multiAgent
          ? ['project-context', 'code', 'tests']
          : ['project-context'],
        primaryModel: effort === 'rapid'
          ? 'gemini-2.5-flash'
          : effort !== 'normal' && !multiAgent
            ? 'gpt-4o'
          : multiAgent
            ? 'claude-sonnet-4-5'
            : 'gemini-2.5-flash',
        effort,
        effortLabel: effort === 'normal' ? 'Normal' : 'Approfondi',
        communicationStyle,
        communicationStyleLabel: communicationStyle === 'normal'
          ? 'Normal'
          : 'Détaillé',
        verificationPasses: effort === 'normal' ? 2 : 3,
        maxOutputTokens: effort === 'normal' ? 7000 : 11000,
        effortEffects: [
          `${effort === 'normal' ? 2 : 3} passe(s) de vérification`,
          `${multiAgent ? 3 : 1} agent(s) ou assistant principal`
        ],
        complexity: 'standard',
        execution: multiAgent ? 'multi_agent' : 'chat',
        suggestedBudget: multiAgent ? 20 : 4,
        estimatedMinimumCredits: 1.2,
        estimatedMaximumCredits: 3.8,
        estimateSource: 'server',
        requiresConfirmation: true
      };
    }),
    sendAgentMessage: vi.fn().mockResolvedValue({
      message: 'Le fichier exporte une constante booléenne.',
      sessionId: 'session-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      modelDisplay: 'Claude Sonnet 4.5',
      mode: 'question',
      filesUsed: ['src/main.ts'],
      imagesUsed: [],
      entitlementPlan: 'neura_plus'
    }),
    getConnectivityState: vi.fn().mockResolvedValue({
      online: true,
      checkedAt: '2026-07-29T00:00:00.000Z',
      source: 'system'
    }),
    cancelAgentMessage: vi.fn().mockResolvedValue(true),
    getLocalSession: vi.fn().mockResolvedValue(null),
    saveLocalSession: vi.fn().mockImplementation(async (session) => ({
      ...session,
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      updatedAt: '2026-07-26T00:00:00.000Z'
    })),
    clearLocalSession: vi.fn().mockResolvedValue(true),
    listConversationThreads: vi.fn().mockResolvedValue([{
      threadId: 'thread_main_12345678',
      title: 'Fil principal',
      archived: false,
      active: true,
      messageCount: 0,
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z'
    }]),
    createConversationThread: vi.fn().mockResolvedValue({
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      threadId: 'thread_main_12345678',
      title: 'Fil principal',
      archived: false,
      executionMode: 'local',
      messages: [],
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z'
    }),
    selectConversationThread: vi.fn(),
    renameConversationThread: vi.fn(),
    archiveConversationThread: vi.fn(),
    exportConversationThread: vi.fn().mockResolvedValue({ canceled: true }),
    clearConversationThreadMemory: vi.fn(),
    forkConversationThread: vi.fn().mockResolvedValue({
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      threadId: 'thread_branch_12345678',
      title: 'Alternative — Fil principal',
      archived: false,
      parentThreadId: 'thread_main_12345678',
      executionMode: 'local',
      messages: [],
      createdAt: '2026-07-26T00:00:01.000Z',
      updatedAt: '2026-07-26T00:00:01.000Z'
    }),
    rewindConversationThread: vi.fn(),
    attachConversationCheckpoint: vi.fn(),
    listSecondaryConversations: vi.fn().mockResolvedValue([]),
    createSecondaryConversation: vi.fn().mockResolvedValue({
      id: 'secondary_12345678',
      projectId: snapshot.project.id,
      parentThreadId: 'thread_main_12345678',
      linkedTaskId: 'task_12345678',
      title: 'Questions sur la tâche active',
      archived: false,
      messages: [],
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z'
    }),
    sendSecondaryConversationMessage: vi.fn().mockResolvedValue({
      id: 'secondary_12345678',
      projectId: snapshot.project.id,
      parentThreadId: 'thread_main_12345678',
      linkedTaskId: 'task_12345678',
      title: 'Questions sur la tâche active',
      archived: false,
      messages: [
        {
          id: 'secondary_user_12345678',
          role: 'user',
          content: 'Pourquoi cette solution ?'
        },
        {
          id: 'secondary_agent_12345678',
          role: 'assistant',
          content: 'Utilise un service isolé et des tests ciblés.',
          model: 'Claude Sonnet 4.5 · anthropic'
        }
      ],
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:01.000Z'
    }),
    archiveSecondaryConversation: vi.fn().mockResolvedValue([]),
    discoverEnvironments: vi.fn().mockResolvedValue({
      checkedAt: '2026-07-28T00:00:00.000Z',
      capabilities: [
        {
          kind: 'local',
          available: true,
          targets: [{
            id: snapshot.project.rootPath,
            label: 'Projet local actuel',
            detail: snapshot.project.rootPath
          }]
        },
        {
          kind: 'worktree',
          available: true,
          targets: [{
            id: 'C:\\projects\\sample-worktree',
            label: 'feature/environment-transfer',
            detail: 'C:\\projects\\sample-worktree'
          }]
        },
        { kind: 'docker', available: false, reason: 'Docker absent.', targets: [] },
        { kind: 'wsl2', available: false, reason: 'WSL2 absent.', targets: [] },
        { kind: 'ssh', available: true, targets: [] },
        {
          kind: 'cloud',
          available: true,
          targets: [{ id: 'default', label: 'Espace Cloud NeuraCo' }]
        }
      ]
    }),
    previewEnvironmentTransfer: vi.fn().mockResolvedValue({
      target: {
        kind: 'local',
        projectPath: snapshot.project.rootPath
      },
      compatible: true,
      checkedAt: '2026-07-28T00:00:00.000Z',
      unavailableFiles: [],
      unavailableTools: [],
      warnings: ['Les secrets réels ne sont jamais copiés.'],
      preserved: {
        conversationMessages: 2,
        goals: 1,
        agents: 3,
        permissions: 1,
        tasks: 1,
        changes: 1,
        results: 2
      }
    }),
    executeEnvironmentTransfer: vi.fn().mockResolvedValue({
      id: 'transfer_12345678',
      projectId: snapshot.project.id,
      sourcePath: snapshot.project.rootPath,
      target: {
        kind: 'local',
        projectPath: snapshot.project.rootPath
      },
      status: 'completed',
      compatible: true,
      manifestLocation: 'C:\\appdata\\transfers\\transfer_12345678.json',
      remoteLocation: snapshot.project.rootPath,
      preserved: {
        conversationMessages: 2,
        goals: 1,
        agents: 3,
        permissions: 1,
        tasks: 1,
        changes: 1,
        results: 2
      },
      warnings: [],
      createdAt: '2026-07-28T00:00:00.000Z'
    }),
    listEnvironmentTransfers: vi.fn().mockResolvedValue([]),
    getEnvironmentPreparation: vi.fn().mockResolvedValue({
      projectId: snapshot.project.id,
      script: '',
      enabled: false,
      runOnWorktree: true,
      runOnTransfer: true,
      timeoutSeconds: 300,
      updatedAt: '2026-07-28T00:00:00.000Z'
    }),
    updateEnvironmentPreparation: vi.fn().mockImplementation(async (update) => ({
      projectId: snapshot.project.id,
      ...update,
      updatedAt: '2026-07-28T00:01:00.000Z'
    })),
    previewEnvironmentPreparation: vi.fn().mockResolvedValue({
      target: {
        kind: 'local',
        projectPath: snapshot.project.rootPath
      },
      script: 'npm ci\nnpm test',
      shell: 'Windows PowerShell',
      firstExecution: true,
      compatible: true,
      blockedReasons: [],
      warnings: [
        'Les variables sensibles du processus parent sont retirées avant exécution.'
      ],
      checkedAt: '2026-07-28T00:01:00.000Z'
    }),
    runEnvironmentPreparation: vi.fn().mockResolvedValue({
      id: 'preparation_12345678',
      projectId: snapshot.project.id,
      target: {
        kind: 'local',
        projectPath: snapshot.project.rootPath
      },
      status: 'completed',
      shell: 'Windows PowerShell',
      exitCode: 0,
      stdout: 'Tests passed.',
      stderr: '',
      durationMs: 1200,
      createdAt: '2026-07-28T00:02:00.000Z'
    }),
    listEnvironmentPreparationHistory: vi.fn().mockResolvedValue([]),
    createImageStudioJob: vi.fn(),
    listImageStudioJobs: vi.fn().mockResolvedValue([]),
    getImageStudioPreview: vi.fn().mockResolvedValue({
      outputId: 'image-output-123',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo='
    }),
    exportImageStudioOutput: vi.fn().mockResolvedValue(
      'C:\\Users\\test\\Pictures\\neuraco-image.png'
    ),
    listCloudTasks: vi.fn().mockResolvedValue([]),
    createCloudTask: vi.fn().mockResolvedValue({
      id: 'cloud_task_12345678',
      sessionId: 'cloud_session_12345678',
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      executionMode: 'cloud',
      localAccess: false,
      status: 'queued',
      estimatedCredits: 1.2,
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z'
    }),
    getCloudTask: vi.fn().mockResolvedValue({
      id: 'cloud_task_12345678',
      sessionId: 'cloud_session_12345678',
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      executionMode: 'cloud',
      localAccess: false,
      status: 'completed',
      result: 'Analyse Cloud terminée.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      modelDisplay: 'Claude Sonnet 4.5',
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:02.000Z'
    }),
    cancelCloudTask: vi.fn(),
    getRelayState: vi.fn().mockResolvedValue({
      enabled: false,
      connected: false,
      pendingCommands: [],
      transport: 'outbound-https',
      publicPortOpen: false
    }),
    enableRelay: vi.fn().mockResolvedValue({
      enabled: true,
      connected: true,
      deviceId: 'device_12345678',
      pendingCommands: [],
      transport: 'outbound-https',
      publicPortOpen: false
    }),
    disableRelay: vi.fn().mockResolvedValue({
      enabled: false,
      connected: false,
      pendingCommands: [],
      transport: 'outbound-https',
      publicPortOpen: false
    }),
    resolveRelayCommand: vi.fn(),
    onRelayEvent: vi.fn().mockReturnValue(() => undefined),
    getProjectPermissions: vi.fn().mockResolvedValue({
      projectId: 'project-1',
      projectRoot: 'C:\\projects\\sample-project',
      configured: true,
      mode: 'manual',
      allowedActions: [],
      allowedFolders: ['C:\\projects\\sample-project'],
      allowedCommandPrefixes: [],
      allowedDomains: [],
      allowedApplications: [],
      alwaysAllowedSignatures: [],
      updatedAt: '2026-07-26T00:00:00.000Z'
    }),
    updateProjectPermissions: vi.fn(),
    listCheckpoints: vi.fn().mockResolvedValue([]),
    createCheckpoint: vi.fn(),
    restoreCheckpoint: vi.fn(),
    getCheckpointRetention: vi.fn().mockResolvedValue({
      maxPerProject: 30,
      minimum: 5,
      maximum: 100
    }),
    updateCheckpointRetention: vi.fn(),
    listTrash: vi.fn().mockResolvedValue([]),
    moveProjectPathToTrash: vi.fn(),
    restoreTrashEntry: vi.fn(),
    emergencyStop: vi.fn().mockResolvedValue({
      stopped: true,
      stoppedAt: '2026-07-26T00:02:00.000Z',
      terminalsStopped: 1,
      agentsStopped: 1
    }),
    emergencyResume: vi.fn().mockResolvedValue({
      stopped: false,
      terminalsStopped: 0,
      agentsStopped: 0
    }),
    onEmergencyState: vi.fn().mockReturnValue(() => undefined),
    getEmergencyShortcut: vi.fn().mockResolvedValue('CommandOrControl+Shift+Escape'),
    setEmergencyShortcut: vi.fn(),
    listRecoverableTasks: vi.fn().mockResolvedValue([]),
    inspectRecoverableTask: vi.fn(),
    resumeRecoverableTask: vi.fn(),
    discardRecoverableTask: vi.fn().mockResolvedValue([]),
    listNotifications: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn().mockResolvedValue([]),
    archiveNotification: vi.fn().mockResolvedValue([]),
    runNotificationAction: vi.fn(),
    onNotificationEvent: vi.fn().mockImplementation((listener) => {
      notificationListener = listener;
      return () => {
        notificationListener = undefined;
      };
    }),
    listGoals: vi.fn().mockResolvedValue([]),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    updateGoalStep: vi.fn(),
    resolveGoalProposal: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([
      {
        id: 'architect',
        name: 'Architecte',
        role: 'Architecture',
        instructions: '',
        model: 'claude-sonnet-4-5',
        tools: [],
        allowedApplications: [],
        allowedFolders: [],
        budget: 8,
        autonomy: 'ask',
        memory: 'project',
        color: '#2563eb',
        icon: 'blocks',
        builtIn: true
      },
      {
        id: 'developer',
        name: 'Développeur',
        role: 'Développement général',
        instructions: '',
        model: 'claude-sonnet-4-5',
        tools: [],
        allowedApplications: [],
        allowedFolders: [],
        budget: 8,
        autonomy: 'ask',
        memory: 'project',
        color: '#7c3aed',
        icon: 'code',
        builtIn: true
      },
      {
        id: 'tests',
        name: 'Tests',
        role: 'Tests',
        instructions: '',
        model: 'gpt-4o',
        tools: [],
        allowedApplications: [],
        allowedFolders: [],
        budget: 6,
        autonomy: 'ask',
        memory: 'session',
        color: '#16a34a',
        icon: 'flask',
        builtIn: true
      }
    ]),
    saveCustomAgent: vi.fn(),
    deleteCustomAgent: vi.fn(),
    runMultiAgentTask: vi.fn().mockResolvedValue({
      taskId: 'task_12345678',
      summary: 'Plan validé',
      risks: [],
      tasks: [{
        id: 'task-code',
        agentId: 'developer',
        agentName: 'Développeur',
        agentRole: 'Développement général',
        objective: 'Analyser le fichier',
        files: ['src/main.ts'],
        dependencies: [],
        acceptanceCriteria: ['Le contrat est identifié'],
        budget: 3,
        status: 'completed',
        message: 'Analyse concrète.',
        questions: [],
        blockers: [],
        testState: 'passed',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        durationMs: 12
      }],
      review: 'Revue indépendante validée.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      durationMs: 30,
      budgetUsed: 3,
      creditsConsumed: 0.42,
      entitlementPlan: 'neura_plus',
      coordinationMessages: [{
        id: 'message-12345678',
        taskId: 'task_12345678',
        fromAgentId: 'developer',
        fromAgentName: 'Développeur',
        toAgentId: 'tests',
        toAgentName: 'Tests',
        kind: 'verification_request',
        subject: 'Vérifier le contrat',
        body: 'Contrôler le comportement observé.',
        relatedTaskId: 'task-code',
        createdAt: '2026-07-26T00:00:00.000Z'
      }],
      fileReservations: [{
        path: 'src/main.ts',
        taskId: 'task-code',
        agentId: 'developer',
        agentName: 'Développeur',
        reservedAt: '2026-07-26T00:00:00.000Z',
        releasedAt: '2026-07-26T00:00:01.000Z'
      }],
      coordinationLimits: {
        maxMessages: 20,
        maxMessagesPerPair: 6,
        maxDurationMs: 120000,
        messagesUsed: 1,
        escalations: 0,
        limitReached: false
      }
    }),
    cancelMultiAgentTask: vi.fn().mockResolvedValue(true),
    onMultiAgentProgress: vi.fn().mockReturnValue(() => undefined),
    listReviewQueue: vi.fn().mockResolvedValue([reviewItem]),
    updateReviewStatus: vi.fn().mockImplementation(async (_itemId, status) => ({
      ...reviewItem,
      status
    })),
    addReviewComment: vi.fn(),
    decideReviewFile: vi.fn(),
    recordReviewTests: vi.fn(),
    attachReviewCheckpoint: vi.fn(),
    getGitStatus: vi.fn().mockResolvedValue({
      installed: true,
      repository: true,
      root: 'C:\\projects\\sample-project',
      branch: 'main',
      head: '1234567890abcdef',
      dirty: false,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      branches: ['main'],
      worktrees: [{
        path: 'C:\\projects\\sample-project',
        branch: 'main',
        head: '1234567890abcdef',
        isMain: true,
        dirty: false
      }]
    }),
    getGitDiff: vi.fn(),
    createGitWorktree: vi.fn(),
    removeGitWorktree: vi.fn(),
    openGitWorktree: vi.fn(),
    commitGitWorktree: vi.fn(),
    listGitTestCommands: vi.fn().mockResolvedValue([]),
    runGitTests: vi.fn(),
    runGitTestSuite: vi.fn(),
    reviewGitBranch: vi.fn(),
    mergeGitBranch: vi.fn(),
    getForgeConnection: vi.fn().mockResolvedValue({
      configured: false,
      authenticated: false,
      message: 'Aucune forge configurée.'
    }),
    getForgeInbox: vi.fn(),
    getForgeIssue: vi.fn(),
    createForgePullRequest: vi.fn(),
    getBrowserState: vi.fn().mockResolvedValue({
      tabs: [{
        id: 'tab-1',
        title: 'Application locale',
        url: 'http://localhost:3000/',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        secure: false
      }],
      activeTabId: 'tab-1',
      controlling: false,
      profile: 'isolated'
    }),
    newBrowserTab: vi.fn(),
    closeBrowserTab: vi.fn(),
    activateBrowserTab: vi.fn(),
    navigateBrowser: vi.fn(),
    browserBack: vi.fn(),
    browserForward: vi.fn(),
    browserReload: vi.fn(),
    setBrowserBounds: vi.fn().mockResolvedValue(true),
    toggleBrowserDevTools: vi.fn(),
    captureBrowser: vi.fn(),
    selectBrowserElement: vi.fn(),
    runBrowserAction: vi.fn(),
    inspectBrowserDiagnostics: vi.fn().mockResolvedValue({
      tabId: 'browser-1',
      url: 'http://localhost:3000/',
      inspectedAt: '2026-07-29T00:00:00.000Z',
      metrics: {
        viewportWidth: 1280,
        viewportHeight: 720,
        documentWidth: 1280,
        documentHeight: 900,
        resourceCount: 12,
        loadMs: 220
      },
      issues: []
    }),
    getBrowserHistory: vi.fn().mockResolvedValue([{
      id: 'history-1',
      title: 'Application locale',
      url: 'http://localhost:3000/',
      visitedAt: '2026-07-26T00:00:00.000Z'
    }]),
    getBrowserDownloads: vi.fn().mockResolvedValue([]),
    getBrowserAnnotations: vi.fn().mockResolvedValue([]),
    saveBrowserAnnotation: vi.fn(),
    hideBrowser: vi.fn().mockResolvedValue(true),
    onBrowserEvent: vi.fn().mockReturnValue(() => undefined),
    listApplications: vi.fn().mockResolvedValue([{
      id: 'vscode',
      name: 'Visual Studio Code',
      executable: 'C:\\Code.exe',
      installed: true,
      capabilities: ['Ouvrir un projet']
    }]),
    launchApplication: vi.fn(),
    stopApplication: vi.fn(),
    listComputerWindows: vi.fn().mockResolvedValue([]),
    inspectComputerWindow: vi.fn(),
    captureComputerWindow: vi.fn(),
    planComputerAction: vi.fn(),
    executeComputerPlan: vi.fn(),
    cancelComputerPlan: vi.fn(),
    analyzeStudioProject: vi.fn().mockResolvedValue({
      projectId: 'project-1',
      scannedAt: '2026-07-26T00:00:00.000Z',
      durationMs: 12,
      scannedFiles: 3,
      truncated: false,
      tools: [
        {
          id: 'fivem',
          name: 'FiveM',
          installed: false,
          executable: '',
          version: '',
          integration: 'Manifestes et validation statique',
          capabilities: ['fxmanifest']
        },
        {
          id: 'blender',
          name: 'Blender',
          installed: true,
          executable: 'C:\\Blender\\blender.exe',
          version: '5.1',
          integration: 'API Python Blender',
          capabilities: ['inspecter', 'valider', 'exporter GLB']
        },
        {
          id: '3dsmax',
          name: '3ds Max',
          installed: true,
          executable: 'C:\\Autodesk\\3dsmax.exe',
          version: '2027',
          integration: 'MAXScript',
          capabilities: ['inspecter', 'valider', 'exporter FBX']
        }
      ],
      fiveM: {
        detected: true,
        manifests: [{
          path: 'fxmanifest.lua',
          fxVersion: 'cerulean',
          games: ['gta5'],
          scripts: ['client.lua'],
          dependencies: [],
          missingFiles: [],
          warnings: []
        }],
        luaFiles: ['client.lua']
      },
      blender: { detected: true, files: ['vehicle.blend'] },
      max3d: { detected: true, files: ['scene.max'] },
      issues: []
    }),
    runStudioOperation: vi.fn(),
    cancelStudioOperation: vi.fn(),
    onStudioEvent: vi.fn().mockReturnValue(() => undefined),
    getUsage: vi.fn().mockResolvedValue({
      plan: {
        id: 'pro_5x',
        subscription: 'neura_plus',
        label: 'Neura+',
        multiplier: 5,
        currency: 'EUR',
        administrator: false
      },
      windows: {
        five_hour: {
          limit: 250,
          used: 20,
          reserved: 0,
          remaining: 230,
          remaining_percent: 92
        },
        seven_day: {
          limit: 625,
          used: 50,
          reserved: 0,
          remaining: 575,
          remaining_percent: 92
        },
        monthly: {
          limit: 1250,
          used: 100,
          reserved: 0,
          remaining: 1150,
          remaining_percent: 92
        }
      },
      billing_period: {
        starts_at: '2026-07-01T00:00:00.000Z',
        renews_at: '2026-07-31T00:00:00.000Z'
      },
      next_recovery_at: '2026-07-26T05:00:00.000Z',
      purchased: {
        available: 500,
        reserved: 0,
        expiring_lots: []
      },
      finalization_reserve: { limit: 125, used: 0 },
      settings: {
        allow_purchased_credits: false,
        task_cap: null,
        daily_cap: null,
        monthly_cap: null,
        auto_reload_enabled: false,
        auto_reload_available: false
      },
      spending_caps: {
        daily: { limit: null, used: 0 },
        monthly: { limit: null, used: 0 },
        task: { limit: null },
        agent: { limit: null }
      },
      recent: [],
      server_time: '2026-07-26T00:00:00.000Z'
    }),
    estimateUsage: vi.fn(),
    updateUsageSettings: vi.fn(),
    createCreditCheckout: vi.fn(),
    onUsageEvent: vi.fn().mockReturnValue(() => undefined),
    listActivity: vi.fn().mockResolvedValue([]),
    buildTaskReport: vi.fn(),
    exportTaskReport: vi.fn(),
    openEvidence: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    getUpdatePreferences: vi.fn().mockResolvedValue({
      channel: 'stable',
      autoCheck: true,
      autoDownload: false,
      checkIntervalHours: 12
    }),
    updateUpdatePreferences: vi.fn().mockResolvedValue({
      channel: 'beta',
      autoCheck: true,
      autoDownload: false,
      checkIntervalHours: 12
    }),
    getUpdateRollback: vi.fn().mockResolvedValue({ available: false }),
    rollbackUpdate: vi.fn(),
    onUpdateEvent: vi.fn().mockReturnValue(() => undefined)
  };
  return {
    api,
    emitTerminal: (event: NeuraCoTerminalEvent) => terminalListener?.(event),
    emitNotification: (event: NeuraCoNotificationEvent) =>
      notificationListener?.(event)
  };
};

describe('NeuraCo project workspace', () => {
  let container: HTMLDivElement;
  let root: Root;
  let desktop: ReturnType<typeof createDesktopApi>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    desktop = createDesktopApi();
    window.neuraco = desktop.api;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.neuraco;
  });

  it('keeps local project tools available while remote AI is offline', async () => {
    desktop.api.getConnectivityState = vi.fn().mockResolvedValue({
      online: false,
      checkedAt: '2026-07-29T00:00:00.000Z',
      source: 'system'
    });
    await act(async () => {
      root.render(
        <WorkspacePage
          snapshot={snapshot}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
          onOpenProject={vi.fn().mockResolvedValue(undefined)}
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Mode hors ligne');
    expect(container.textContent).toContain('Les outils locaux restent disponibles');
    expect(container.querySelector<HTMLButtonElement>('.agent-send')?.disabled).toBe(true);

    const editorTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Éditeur')
        || button.textContent?.includes('Ã‰diteur')
    );
    expect(editorTab?.disabled).not.toBe(true);
    await act(async () => editorTab?.click());
    expect(container.querySelector('.editor-view')).not.toBeNull();
    expect(desktop.api.sendAgentMessage).not.toHaveBeenCalled();
  });

  it('opens a real file and saves the edited content through the desktop bridge', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));

    const fileButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('main.ts')
    );
    await act(async () => {
      fileButton?.click();
      await Promise.resolve();
    });

    expect(desktop.api.readProjectFile).toHaveBeenCalledWith('src/main.ts');
    expect(container.textContent).toContain('src/main.ts');

    const editorTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Éditeur')
    );
    await act(async () => editorTab?.click());

    const editor = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Éditeur de code"]'
    );
    await act(async () => {
      if (editor) {
        setControlValue(editor, 'export const ready = false;\n');
      }
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Enregistrer')
    );
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(desktop.api.saveProjectFile).toHaveBeenCalledWith(
      'src/main.ts',
      'export const ready = false;\n'
    );
  });

  it('sends only the authorized active file to the authenticated AI bridge', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));

    const fileButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('main.ts')
    );
    await act(async () => {
      fileButton?.click();
      await Promise.resolve();
    });

    const agentTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Agent')
    );
    await act(async () => agentTab?.click());

    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.agent-composer textarea'
    );
    await act(async () => {
      if (prompt) {
        setControlValue(prompt, 'Explique ce fichier.');
      }
    });

    const send = container.querySelector<HTMLButtonElement>('.agent-send');
    await act(async () => {
      send?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Routage à valider');
    await validateRouting(container);

    expect(desktop.api.sendAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Explique ce fichier.',
        projectId: 'project-1',
        files: [
          expect.objectContaining({
            path: 'src/main.ts',
            language: 'typescript'
          })
        ]
      })
    );
    expect(container.textContent).toContain('Claude Sonnet 4.5');
    expect(container.textContent).toContain('constante booléenne');
  });

  it('queues a new instruction during work and executes it after the current task', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    desktop.api.sendAgentMessage = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValue({
        message: 'Instruction de la file terminée.',
        sessionId: 'session-1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        modelDisplay: 'Claude Sonnet 4.5',
        mode: 'question',
        filesUsed: [],
        imagesUsed: [],
        entitlementPlan: 'neura_plus'
      });

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.agent-composer textarea'
    );
    await act(async () => {
      if (prompt) setControlValue(prompt, 'Analyse le module actuel.');
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.agent-send')?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await validateRouting(container);

    await act(async () => {
      if (prompt) setControlValue(prompt, 'Exécute ensuite les tests ciblés.');
      container.querySelector<HTMLButtonElement>('.agent-send')?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Nouvelle instruction pendant le travail');
    const queueButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Ajouter à la file')
    );
    await act(async () => queueButton?.click());
    expect(container.textContent).toContain('1 instruction(s) dans la file');
    expect(desktop.api.sendAgentMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.({
        message: 'Analyse terminée.',
        sessionId: 'session-1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        modelDisplay: 'Claude Sonnet 4.5',
        mode: 'question',
        filesUsed: [],
        imagesUsed: [],
        entitlementPlan: 'neura_plus'
      });
      await Promise.resolve();
      await vi.waitFor(
        () => expect(desktop.api.sendAgentMessage).toHaveBeenCalledTimes(2),
        { timeout: 1_500 }
      );
    });
    expect(desktop.api.sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(desktop.api.sendAgentMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'Exécute ensuite les tests ciblés.' })
    );
    expect(container.textContent).toContain('Instruction sortie de la file');
  });

  it('redirects only the active task and immediately executes the new instruction', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    desktop.api.sendAgentMessage = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectFirst = reject;
      }))
      .mockResolvedValue({
        message: 'Plan réévalué.',
        sessionId: 'session-1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        modelDisplay: 'Claude Sonnet 4.5',
        mode: 'question',
        filesUsed: [],
        imagesUsed: [],
        entitlementPlan: 'neura_plus'
      });
    desktop.api.cancelAgentMessage = vi.fn().mockImplementation(async () => {
      rejectFirst?.(new Error('Tâche redirigée par l’utilisateur.'));
      return true;
    });

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.agent-composer textarea'
    );
    await act(async () => {
      if (prompt) setControlValue(prompt, 'Prépare un premier plan.');
      container.querySelector<HTMLButtonElement>('.agent-send')?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await validateRouting(container);
    await act(async () => {
      if (prompt) setControlValue(prompt, 'Change de priorité immédiatement.');
      container.querySelector<HTMLButtonElement>('.agent-send')?.click();
      await Promise.resolve();
    });
    const redirectButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Rediriger maintenant')
    );
    await act(async () => {
      redirectButton?.click();
      await Promise.resolve();
      await vi.waitFor(
        () => expect(desktop.api.sendAgentMessage).toHaveBeenCalledTimes(2),
        { timeout: 1_500 }
      );
    });

    expect(desktop.api.cancelAgentMessage).toHaveBeenCalledWith(
      expect.any(String)
    );
    expect(desktop.api.cancelMultiAgentTask).not.toHaveBeenCalled();
    expect(desktop.api.sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(desktop.api.sendAgentMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'Change de priorité immédiatement.' })
    );
    expect(container.textContent).toContain('Plan réévalué immédiatement');
  });

  it('starts a real one-agent subtask in parallel without cancelling the main task', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    desktop.api.sendAgentMessage = vi.fn().mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirst = resolve;
      })
    );

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.agent-composer textarea'
    );
    await act(async () => {
      if (prompt) setControlValue(prompt, 'Analyse principale.');
      container.querySelector<HTMLButtonElement>('.agent-send')?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await validateRouting(container);
    await act(async () => {
      if (prompt) setControlValue(prompt, 'Vérifie les tests en parallèle.');
      container.querySelector<HTMLButtonElement>('.agent-send')?.click();
      await Promise.resolve();
    });
    const subtaskButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Créer une sous-tâche')
    );
    await act(async () => {
      subtaskButton?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(desktop.api.runMultiAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        objective: 'Vérifie les tests en parallèle.',
        maxAgents: 1,
        selectedAgentIds: ['architect']
      })
    );
    expect(desktop.api.cancelAgentMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Sous-tâche terminée');

    await act(async () => {
      resolveFirst?.({
        message: 'Analyse principale terminée.',
        sessionId: 'session-1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        modelDisplay: 'Claude Sonnet 4.5',
        mode: 'question',
        filesUsed: [],
        imagesUsed: [],
        entitlementPlan: 'neura_plus'
      });
      await Promise.resolve();
    });
  });

  it('keeps secondary questions isolated and promotes a response through official routing', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const secondaryButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Conversation secondaire"]'
    );
    await act(async () => {
      secondaryButton?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('aucune modification automatique');

    const createButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Créer la conversation')
    );
    await act(async () => {
      createButton?.click();
      await Promise.resolve();
    });
    expect(desktop.api.createSecondaryConversation).toHaveBeenCalledWith({
      parentThreadId: 'thread_main_12345678',
      linkedTaskId: undefined,
      title: 'Questions sur le fil principal'
    });

    const secondaryInput = container.querySelector<HTMLTextAreaElement>(
      '.secondary-conversation-composer textarea'
    );
    await act(async () => {
      if (secondaryInput) setControlValue(secondaryInput, 'Pourquoi cette solution ?');
    });
    const secondarySend = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Envoyer la question secondaire"]'
    );
    await act(async () => {
      secondarySend?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(desktop.api.sendSecondaryConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'secondary_12345678',
        content: 'Pourquoi cette solution ?',
        projectId: 'project-1'
      })
    );
    expect(desktop.api.sendAgentMessage).not.toHaveBeenCalled();

    const promoteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Transformer en instruction officielle')
    );
    await act(async () => {
      promoteButton?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).not.toContain('Conversation secondaireAnalyse séparée');
    expect(container.textContent).toContain('Routage à valider');
    expect(desktop.api.previewTaskRoute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'Instruction officielle issue de la conversation secondaire'
        )
      })
    );
  });

  it('blocks incompatible environment transfers and completes a verified transfer', async () => {
    desktop.api.previewEnvironmentTransfer = vi.fn()
      .mockResolvedValueOnce({
        target: {
          kind: 'local',
          projectPath: snapshot.project.rootPath
        },
        compatible: false,
        checkedAt: '2026-07-28T00:00:00.000Z',
        unavailableFiles: ['src/missing.ts'],
        unavailableTools: ['node'],
        warnings: [
          '1 fichier de contexte absent.',
          '1 outil requis indisponible.'
        ],
        preserved: {
          conversationMessages: 2,
          goals: 1,
          agents: 3,
          permissions: 1,
          tasks: 1,
          changes: 1,
          results: 2
        }
      })
      .mockResolvedValue({
        target: {
          kind: 'local',
          projectPath: snapshot.project.rootPath
        },
        compatible: true,
        checkedAt: '2026-07-28T00:01:00.000Z',
        unavailableFiles: [],
        unavailableTools: [],
        warnings: ['Les secrets réels ne sont jamais copiés.'],
        preserved: {
          conversationMessages: 2,
          goals: 1,
          agents: 3,
          permissions: 1,
          tasks: 1,
          changes: 1,
          results: 2
        }
      });

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const environmentsTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Environnements')
    );
    await act(async () => {
      environmentsTab?.click();
      await vi.waitFor(
        () => expect(desktop.api.discoverEnvironments).toHaveBeenCalledOnce()
      );
    });

    const verify = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Vérifier la compatibilité')
    );
    await act(async () => {
      verify?.click();
      await vi.waitFor(
        () => expect(desktop.api.previewEnvironmentTransfer).toHaveBeenCalledOnce()
      );
    });

    expect(container.textContent).toContain('Transfert bloqué');
    expect(container.textContent).toContain('src/missing.ts');
    expect(container.textContent).toContain('node');
    const transfer = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Transférer la session')
    ) as HTMLButtonElement | undefined;
    expect(transfer?.disabled).toBe(true);
    expect(desktop.api.executeEnvironmentTransfer).not.toHaveBeenCalled();

    await act(async () => {
      verify?.click();
      await vi.waitFor(
        () => expect(desktop.api.previewEnvironmentTransfer).toHaveBeenCalledTimes(2)
      );
    });
    expect(container.textContent).toContain('Cible compatible');
    expect(transfer?.disabled).toBe(false);

    await act(async () => {
      transfer?.click();
      await vi.waitFor(
        () => expect(desktop.api.executeEnvironmentTransfer).toHaveBeenCalledOnce()
      );
    });
    expect(desktop.api.executeEnvironmentTransfer).toHaveBeenCalledWith({
      kind: 'local',
      projectPath: snapshot.project.rootPath
    });
    expect(container.textContent).toContain('Transferts terminés');
    expect(container.textContent).toContain('LOCAL');
  });

  it('saves, previews and runs a visible environment preparation script', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const environmentsTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Environnements')
    );
    await act(async () => {
      environmentsTab?.click();
      await vi.waitFor(
        () => expect(desktop.api.getEnvironmentPreparation).toHaveBeenCalledOnce()
      );
    });

    const script = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Script de préparation"]'
    );
    const enabled = container.querySelector<HTMLInputElement>(
      '.environment-preparation-options input[type="checkbox"]'
    );
    await act(async () => {
      if (script) setControlValue(script, 'npm ci\nnpm test');
      enabled?.click();
    });
    const save = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Enregistrer')
        && button.closest('.environment-preparation-section')
    );
    await act(async () => {
      save?.click();
      await vi.waitFor(
        () => expect(desktop.api.updateEnvironmentPreparation).toHaveBeenCalledOnce()
      );
    });
    expect(desktop.api.updateEnvironmentPreparation).toHaveBeenCalledWith(
      expect.objectContaining({
        script: 'npm ci\nnpm test',
        enabled: true,
        runOnWorktree: true,
        runOnTransfer: true
      })
    );

    const inspect = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Examiner pour cette cible')
    );
    await act(async () => {
      inspect?.click();
      await vi.waitFor(
        () => expect(desktop.api.previewEnvironmentPreparation).toHaveBeenCalledOnce()
      );
    });
    expect(container.textContent).toContain('Prêt pour autorisation');
    expect(container.textContent).toContain('première exécution');

    const run = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Autoriser et exécuter')
    ) as HTMLButtonElement | undefined;
    expect(run?.disabled).toBe(false);
    await act(async () => {
      run?.click();
      await vi.waitFor(
        () => expect(desktop.api.runEnvironmentPreparation).toHaveBeenCalledOnce()
      );
    });
    expect(desktop.api.runEnvironmentPreparation).toHaveBeenCalledWith({
      kind: 'local',
      projectPath: snapshot.project.rootPath
    });
    expect(container.textContent).toContain('Tests passed.');
    expect(container.textContent).toContain('code 0');
  });

  it('shows a server routing preview and runs only the agents confirmed by the user', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.agent-composer textarea'
    );
    await act(async () => {
      if (prompt) {
        setControlValue(prompt, 'Ajoute une API et vérifie son comportement.');
      }
    });
    const send = container.querySelector<HTMLButtonElement>('.agent-send');
    await act(async () => {
      send?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(desktop.api.previewTaskRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Ajoute une API et vérifie son comportement.',
        requestedMode: 'automatic'
      })
    );
    expect(desktop.api.runMultiAgentTask).not.toHaveBeenCalled();
    expect(container.textContent).toContain('1.2 à 3.8 crédits');
    expect(container.textContent).toContain('Architecte');
    expect(container.textContent).toContain('Développeur');

    const architect = Array.from(
      container.querySelectorAll<HTMLLabelElement>('.routing-agent-list label')
    ).find((label) => label.textContent?.includes('Architecte'));
    await act(async () => {
      architect?.querySelector<HTMLInputElement>('input')?.click();
    });
    await validateRouting(container);

    expect(desktop.api.runMultiAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        objective: 'Ajoute une API et vérifie son comportement.',
        selectedAgentIds: ['developer', 'tests'],
        maxAgents: 2,
        budget: 20
      })
    );
    expect(desktop.api.sendAgentMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Plan validé');
    expect(container.textContent).toContain('Revue indépendante');
  });

  it('shows a detected preference before saving it and requires explicit approval', async () => {
    const pendingMemory = {
      id: 'memory_12345678',
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      scope: 'project' as const,
      category: 'framework' as const,
      content: 'Utilise toujours React pour les nouvelles interfaces.',
      status: 'pending' as const,
      observationCount: 1,
      sourceThreadId: 'thread_main_12345678',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
      lastObservedAt: '2026-07-28T00:00:00.000Z'
    };
    desktop.api.observeControlledMemory = vi.fn().mockResolvedValue({
      enabled: true,
      entries: [pendingMemory],
      activeCount: 0,
      pendingCount: 1
    });
    desktop.api.updateControlledMemory = vi.fn().mockResolvedValue({
      enabled: true,
      entries: [{ ...pendingMemory, status: 'active' }],
      activeCount: 1,
      pendingCount: 0
    });

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.agent-composer textarea'
    );
    await act(async () => {
      if (prompt) {
        setControlValue(
          prompt,
          'Utilise toujours React pour les nouvelles interfaces.'
        );
      }
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.agent-send')?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await validateRouting(container);
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(desktop.api.observeControlledMemory).toHaveBeenCalledWith({
      content: 'Utilise toujours React pour les nouvelles interfaces.',
      sourceThreadId: 'thread_main_12345678'
    });
    expect(desktop.api.updateControlledMemory).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Mémoire suggérée, non active');

    const memoryTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Mémoire')
    );
    await act(async () => memoryTab?.click());
    expect(container.textContent).toContain('Suggestion non active');

    const approve = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Approuver')
    );
    await act(async () => {
      approve?.click();
      await Promise.resolve();
    });
    expect(desktop.api.updateControlledMemory).toHaveBeenCalledWith(
      pendingMemory.id,
      expect.objectContaining({
        content: pendingMemory.content,
        scope: 'project',
        category: 'framework',
        status: 'active'
      })
    );
  });

  it('re-estimates and applies effort and communication style before execution', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.agent-composer textarea'
    );
    await act(async () => {
      if (prompt) setControlValue(prompt, 'Explique la stratégie de test.');
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.agent-send')?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const preferences = container.querySelectorAll<HTMLSelectElement>(
      '.routing-preferences select'
    );
    await act(async () => {
      setSelectValue(preferences[0], 'deep');
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const refreshedPreferences = container.querySelectorAll<HTMLSelectElement>(
      '.routing-preferences select'
    );
    await act(async () => {
      setSelectValue(refreshedPreferences[1], 'detailed');
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(desktop.api.previewTaskRoute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        effort: 'deep',
        communicationStyle: 'detailed'
      })
    );
    expect(container.textContent).toContain('Approfondi');
    expect(container.textContent).toContain('Détaillé');
    expect(container.textContent).toContain('3 passe(s) de vérification');

    await validateRouting(container);
    expect(desktop.api.sendAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        effort: 'deep',
        communicationStyle: 'detailed'
      })
    );
  });

  it('runs a Cloud task without granting automatic access to local files', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const cloud = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cloud'
    );
    await act(async () => cloud?.click());

    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.agent-composer textarea'
    );
    await act(async () => {
      if (prompt) setControlValue(prompt, 'Continue cette analyse à distance.');
    });
    const send = container.querySelector<HTMLButtonElement>('.agent-send');
    await act(async () => {
      send?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await validateRouting(container);

    expect(desktop.api.createCloudTask).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Continue cette analyse à distance.',
        projectId: 'project-1',
        model: 'gemini-2.5-flash',
        effort: 'normal',
        communicationStyle: 'normal',
        files: []
      })
    );
    expect(desktop.api.sendAgentMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Analyse Cloud terminée.');
    expect(container.textContent).toContain('Cloud');
  });

  it('enables the outbound relay before allowing a hybrid task', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));

    const hybridBeforeRelay = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Hybride'
    );
    expect(hybridBeforeRelay?.disabled).toBe(true);

    const enableRelay = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Activer le relais')
    );
    await act(async () => {
      enableRelay?.click();
      await Promise.resolve();
    });

    expect(desktop.api.enableRelay).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Relais actif');

    const hybrid = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Hybride'
    );
    expect(hybrid?.disabled).toBe(false);
    await act(async () => hybrid?.click());

    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.agent-composer textarea'
    );
    await act(async () => {
      if (prompt) setControlValue(prompt, 'Prépare une analyse hybride.');
    });
    const send = container.querySelector<HTMLButtonElement>('.agent-send');
    await act(async () => {
      send?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await validateRouting(container);

    expect(desktop.api.createCloudTask).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Prépare une analyse hybride.',
        files: []
      })
    );
    expect(container.textContent).toContain('Tâche hybride démarrée');
  });

  it('restores the last local session for the opened project', async () => {
    desktop.api.getLocalSession = vi.fn().mockResolvedValue({
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      sessionId: 'session_restore_123',
      executionMode: 'local',
      messages: [{
        id: 'restored-message',
        role: 'assistant',
        content: 'Conversation restaurée après redémarrage.',
        model: 'GPT-4o'
      }],
      updatedAt: '2026-07-26T00:00:00.000Z'
    });

    await act(async () => {
      root.render(
        <WorkspacePage
          snapshot={snapshot}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
          onOpenProject={vi.fn().mockResolvedValue(undefined)}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Conversation restaurée après redémarrage.');
    expect(container.textContent).toContain('GPT-4o');
  });

  it('creates and forks persistent task threads from the conversation UI', async () => {
    desktop.api.getLocalSession = vi.fn().mockResolvedValue({
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      threadId: 'thread_main_12345678',
      title: 'Fil principal',
      archived: false,
      executionMode: 'local',
      messages: [{
        id: 'message-to-fork',
        role: 'assistant',
        content: 'Première solution.',
        model: 'Claude Sonnet 4.5'
      }],
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z'
    });

    await act(async () => {
      root.render(
        <WorkspacePage
          snapshot={snapshot}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
          onOpenProject={vi.fn().mockResolvedValue(undefined)}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const branch = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Créer une branche depuis ce message"]'
    );
    await act(async () => {
      branch?.click();
      await Promise.resolve();
    });
    expect(desktop.api.forkConversationThread).toHaveBeenCalledWith(
      'thread_main_12345678',
      'message-to-fork'
    );
    expect(container.textContent).toContain(
      'Branche de conversation créée sans modifier la solution originale.'
    );

    const newThread = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Nouveau fil de tâche"]'
    );
    await act(async () => {
      newThread?.click();
      await Promise.resolve();
    });
    expect(desktop.api.createConversationThread).toHaveBeenCalledWith({
      title: 'Nouvelle tâche'
    });
  });

  it('runs a terminal command and renders streamed output', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));

    const terminalTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Terminal')
    );
    await act(async () => terminalTab?.click());

    const commandInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Commande terminal"]'
    );
    await act(async () => {
      if (commandInput) {
        setControlValue(commandInput, 'npm test');
      }
    });

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Exécuter')
    );
    await act(async () => {
      runButton?.click();
      await Promise.resolve();
    });

    expect(desktop.api.startTerminalCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'npm test',
        profileId: 'cmd'
      })
    );

    await act(async () => {
      desktop.emitTerminal({
        commandId: 'command-1',
        type: 'stdout',
        chunk: 'Tests passed\n'
      });
      desktop.emitTerminal({
        commandId: 'command-1',
        type: 'completed',
        exitCode: 0,
        durationMs: 87
      });
    });

    expect(container.textContent).toContain('Tests passed');
    expect(container.textContent).toContain('code 0');
  });

  it('monitors and starts real background processes from the dedicated view', async () => {
    const runningProcess = {
      id: 'process_12345678',
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      name: 'Serveur Vite',
      command: 'npm run dev',
      agent: 'Agent développeur',
      workingDirectory: snapshot.project.rootPath,
      startedAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:02.000Z',
      durationMs: 2000,
      cpuPercent: 2.5,
      memoryBytes: 32 * 1024 * 1024,
      state: 'running' as const,
      port: 5173,
      lastOutput: 'ready on http://localhost:5173',
      attached: true,
      keepAlive: false,
      restartable: true,
      pid: 4312
    };
    desktop.api.listBackgroundProcesses = vi.fn().mockResolvedValue([
      runningProcess
    ]);
    desktop.api.startBackgroundProcess = vi.fn().mockResolvedValue({
      ...runningProcess,
      id: 'process_87654321',
      name: 'Tests continus',
      command: 'npm run test -- --watch',
      pid: 4313
    });

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const processTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Processus'
    );
    await act(async () => {
      processTab?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Serveur Vite');
    expect(container.textContent).toContain('ready on http://localhost:5173');
    expect(container.textContent).toContain('32.0 Mo');

    const commandInput = container.querySelector<HTMLInputElement>(
      '.background-process-form input[placeholder="npm run dev"]'
    );
    await act(async () => {
      if (commandInput) setControlValue(commandInput, 'npm run test -- --watch');
    });
    const startButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Lancer')
    );
    await act(async () => {
      startButton?.click();
      await Promise.resolve();
    });

    expect(desktop.api.startBackgroundProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'npm run test -- --watch',
        workingDirectory: '.',
        keepAlive: false
      })
    );
    expect(container.textContent).toContain('Tests continus');
  });

  it('previews, versions, compares and restores isolated HTML artifacts', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));

    const artifactTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Artefacts'
    );
    await act(async () => {
      artifactTab?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(desktop.api.listArtifacts).toHaveBeenCalledOnce();
    expect(desktop.api.getArtifact).toHaveBeenCalledWith('artifact_12345678');
    expect(container.textContent).toContain('Rapport interactif');

    const preview = container.querySelector<HTMLIFrameElement>('.artifact-preview iframe');
    expect(preview?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(preview?.getAttribute('srcdoc')).toContain("connect-src 'none'");
    expect(preview?.getAttribute('srcdoc')).toContain("form-action 'none'");

    const source = container.querySelector<HTMLTextAreaElement>(
      '.artifact-source-editor textarea'
    );
    await act(async () => {
      if (source) {
        setControlValue(
          source,
          '<!doctype html><html><body><button>Version trois</button></body></html>'
        );
      }
    });
    const save = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Enregistrer une version')
    );
    await act(async () => {
      save?.click();
      await Promise.resolve();
    });
    expect(desktop.api.updateArtifact).toHaveBeenCalledWith(
      'artifact_12345678',
      expect.objectContaining({
        html: expect.stringContaining('Version trois')
      })
    );

    const compare = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Comparer')
    );
    await act(async () => {
      compare?.click();
      await Promise.resolve();
    });
    expect(desktop.api.compareArtifactVersions).toHaveBeenCalled();
    expect(container.textContent).toContain('+ <button>Tester</button>');

    const restore = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Restaurer')
    );
    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });
    expect(desktop.api.restoreArtifactVersion).toHaveBeenCalled();
  });

  it('previews an image and sends it only after the user submits the message', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));

    const imageInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const imageFile = new File(['image'], 'capture.png', { type: 'image/png' });
    Object.defineProperty(imageInput, 'files', {
      configurable: true,
      value: [imageFile]
    });
    await act(async () => {
      imageInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('capture.png');
    expect(container.textContent).toContain('320×180');
    expect(desktop.api.sendAgentMessage).not.toHaveBeenCalled();

    const send = container.querySelector<HTMLButtonElement>('.agent-send');
    await act(async () => {
      send?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await validateRouting(container);

    expect(desktop.api.sendAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Analyse les images jointes.',
        images: [
          expect.objectContaining({
            id: 'image-test-123',
            name: 'capture.png',
            mimeType: 'image/png',
            width: 320,
            height: 180
          })
        ]
      })
    );
  });

  it('requires a permission mode choice when a project is opened for the first time', async () => {
    desktop.api.getProjectPermissions = vi.fn().mockResolvedValue({
      projectId: 'project-1',
      projectRoot: 'C:\\projects\\sample-project',
      configured: false,
      mode: 'manual',
      allowedActions: [],
      allowedFolders: ['C:\\projects\\sample-project'],
      allowedCommandPrefixes: [],
      allowedDomains: [],
      allowedApplications: [],
      alwaysAllowedSignatures: [],
      updatedAt: '2026-07-26T00:00:00.000Z'
    });
    desktop.api.updateProjectPermissions = vi.fn().mockResolvedValue({
      projectId: 'project-1',
      projectRoot: 'C:\\projects\\sample-project',
      configured: true,
      mode: 'manual',
      allowedActions: [],
      allowedFolders: ['C:\\projects\\sample-project'],
      allowedCommandPrefixes: [],
      allowedDomains: [],
      allowedApplications: [],
      alwaysAllowedSignatures: [],
      updatedAt: '2026-07-26T00:01:00.000Z'
    });

    await act(async () => {
      root.render(
        <WorkspacePage
          snapshot={snapshot}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
          onOpenProject={vi.fn().mockResolvedValue(undefined)}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Choisissez le fonctionnement de NeuraCo');
    const save = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Enregistrer ce mode')
    );
    await act(async () => {
      save?.click();
      await Promise.resolve();
    });
    expect(desktop.api.updateProjectPermissions).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'manual',
        allowedActions: []
      })
    );
  });

  it('runs the multi-agent team with explicit project context', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const team = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Équipe')
    );
    await act(async () => {
      team?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Équipe multi-agents');
    expect(desktop.api.listAgents).toHaveBeenCalledOnce();

    const objective = container.querySelector<HTMLTextAreaElement>('#multi-agent-objective');
    const fileCheckbox = container.querySelector<HTMLInputElement>('.multi-agent-files input');
    await act(async () => {
      if (objective) setControlValue(objective, 'Analyser le fichier actif.');
      fileCheckbox?.click();
    });
    const run = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Lancer l’équipe')
    );
    await act(async () => {
      run?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(desktop.api.readProjectFile).toHaveBeenCalledWith('src/main.ts');
    expect(desktop.api.runMultiAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        objective: 'Analyser le fichier actif.',
        selectedAgentIds: ['architect', 'developer', 'tests'],
        files: [
          expect.objectContaining({
            path: 'src/main.ts',
            language: 'typescript'
          })
        ]
      })
    );
    expect(container.textContent).toContain('Revue indépendante validée.');
    expect(container.textContent).toContain('Coordination de l’équipe');
    expect(container.textContent).toContain('Vérifier le contrat');
    expect(container.textContent).toContain('src/main.ts');
  });

  it('opens the persistent review queue and applies a real status decision', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const reviewTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('À examiner')
    );
    await act(async () => {
      reviewTab?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(desktop.api.listReviewQueue).toHaveBeenCalledWith(false);
    expect(container.textContent).toContain('Analyser le fichier actif');
    expect(container.textContent).toContain('Test du contrat');
    expect(container.textContent).toContain('mode:scoped');

    const approve = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Approuver')
    );
    await act(async () => {
      approve?.click();
      await Promise.resolve();
    });
    expect(desktop.api.updateReviewStatus).toHaveBeenCalledWith(
      'review_12345678',
      'approved'
    );
  });

  it('opens the real isolated browser workspace with history and allowlisted apps', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const browser = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Navigateur')
    );
    await act(async () => {
      browser?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(desktop.api.getBrowserState).toHaveBeenCalledOnce();
    expect(desktop.api.getBrowserHistory).toHaveBeenCalledOnce();
    expect(desktop.api.listApplications).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Profil isolé');
    expect(container.textContent).toContain('Application locale');
    expect(container.textContent).toContain('Visual Studio Code');
  });

  it('previews and executes an explicitly confirmed Windows UI Automation plan', async () => {
    const controlledWindow = {
      id: '1001:42',
      applicationId: 'notepad',
      processId: 42,
      processName: 'notepad',
      title: 'notes.txt - Bloc-notes',
      handle: '1001',
      bounds: { x: 0, y: 0, width: 800, height: 600 }
    };
    const element = {
      id: 'element-1',
      runtimeId: '42.7.1',
      name: 'Document',
      automationId: '15',
      controlType: 'Edit',
      enabled: true,
      offscreen: false,
      password: false,
      actionable: true,
      bounds: { x: 10, y: 20, width: 500, height: 400 }
    };
    desktop.api.listComputerWindows = vi.fn().mockResolvedValue([controlledWindow]);
    desktop.api.inspectComputerWindow = vi.fn().mockResolvedValue({
      window: controlledWindow,
      elements: [element],
      inspectedAt: '2026-07-29T00:00:00.000Z'
    });
    desktop.api.captureComputerWindow = vi.fn().mockResolvedValue({
      id: 'capture-1',
      windowId: controlledWindow.id,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      width: 800,
      height: 600,
      capturedAt: '2026-07-29T00:00:00.000Z'
    });
    desktop.api.planComputerAction = vi.fn().mockResolvedValue({
      id: 'plan-1',
      status: 'pending',
      window: controlledWindow,
      element,
      action: 'type',
      pointer: { x: 260, y: 220 },
      textPreview: 'Texte vérifié',
      confirmationRequired: true,
      risk: 'moderate',
      explanation: 'Saisir 14 caractère(s) dans « Document ».',
      createdAt: '2026-07-29T00:00:00.000Z',
      expiresAt: '2026-07-29T00:02:00.000Z'
    });
    desktop.api.executeComputerPlan = vi.fn().mockResolvedValue({
      planId: 'plan-1',
      status: 'completed',
      action: 'type',
      windowId: controlledWindow.id,
      completedAt: '2026-07-29T00:01:00.000Z'
    });

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const computer = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('PC expérimental')
    );
    await act(async () => {
      computer?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(desktop.api.listComputerWindows).toHaveBeenCalledOnce();

    const inspect = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Inspecter et capturer')
    );
    await act(async () => {
      inspect?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(desktop.api.inspectComputerWindow).toHaveBeenCalledWith(controlledWindow.id);
    expect(desktop.api.captureComputerWindow).toHaveBeenCalledWith(controlledWindow.id);

    const elementButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Document')
    );
    await act(async () => elementButton?.click());
    const text = container.querySelector<HTMLTextAreaElement>(
      '.computer-action-builder textarea'
    );
    await act(async () => {
      if (text) setControlValue(text, 'Texte vérifié');
    });
    const prepare = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Prévisualiser l’action')
    );
    await act(async () => {
      prepare?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(desktop.api.planComputerAction).toHaveBeenCalledWith({
      windowId: controlledWindow.id,
      elementRuntimeId: element.runtimeId,
      action: 'type',
      text: 'Texte vérifié'
    });
    expect(container.textContent).toContain('Confirmation requise');
    expect(container.textContent).toContain('260, 220');

    const execute = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Confirmer dans Windows')
    );
    await act(async () => {
      execute?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(desktop.api.executeComputerPlan).toHaveBeenCalledWith('plan-1');
    expect(container.textContent).toContain('Action exécutée et journalisée');
  });

  it('analyzes and exposes the structured FiveM, Blender and 3ds Max tools', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const studio = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Studio'
    );
    await act(async () => {
      studio?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(desktop.api.analyzeStudioProject).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Studio structuré');
    expect(container.textContent).toContain('fxmanifest.lua');
    expect(container.textContent).toContain('Blender');
    expect(container.textContent).toContain('3ds Max');
  });

  it('loads server-authoritative usage in the utilization workspace', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const usage = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Utilisation'
    );
    await act(async () => {
      usage?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(desktop.api.getUsage).toHaveBeenCalledOnce();
    expect(desktop.api.listActivity).toHaveBeenCalledWith(250);
    expect(desktop.api.getUpdatePreferences).toHaveBeenCalledOnce();
    expect(desktop.api.getUpdateRollback).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Utilisation et contrôle');
    expect(container.textContent).toContain('Neura+');
    expect(container.textContent).toContain('230 restants');
    expect(container.textContent).toContain('500 crédits');

    const updateChannel = container.querySelector<HTMLSelectElement>(
      '.usage-update-options select'
    );
    expect(updateChannel?.value).toBe('stable');
    await act(async () => {
      updateChannel!.value = 'beta';
      updateChannel!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(desktop.api.updateUpdatePreferences).toHaveBeenCalledWith({
      channel: 'beta'
    });
  });

  it('shows machine evidence in the final report and opens its persisted file', async () => {
    desktop.api.buildTaskReport = vi.fn().mockResolvedValue({
      generatedAt: '2026-07-28T12:00:00.000Z',
      durationMs: 1250,
      agents: [],
      applications: [],
      filesRead: [],
      filesCreated: [],
      filesModified: [],
      filesMoved: [],
      filesDeleted: [],
      commands: ['npm test'],
      tests: [{ summary: 'Tests réussis', status: 'completed' }],
      errors: [],
      corrections: [],
      refusedActions: [],
      risks: [],
      restorePoints: [],
      creditsConsumed: 0,
      evidence: [{
        id: 'evidence-test-1',
        source: 'machine',
        kind: 'test_result',
        status: 'passed',
        title: 'Suite Vitest',
        summary: '136 tests exécutés sans erreur.',
        capturedAt: '2026-07-28T12:00:00.000Z',
        command: 'npm test',
        exitCode: 0,
        filePath: 'C:\\NeuraCo\\evidence\\vitest.txt',
        output: '136 tests passed'
      }],
      events: []
    });

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const usage = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Utilisation'
    );
    await act(async () => {
      usage?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const build = container.querySelector<HTMLButtonElement>(
      '.usage-report-actions button:first-child'
    );
    await act(async () => {
      build?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Preuves machine');
    expect(container.textContent).toContain('Suite Vitest');
    expect(container.textContent).toContain('136 tests exécutés sans erreur.');
    const open = container.querySelector<HTMLButtonElement>(
      '.usage-evidence details summary button'
    );
    await act(async () => {
      open?.click();
      await Promise.resolve();
    });
    expect(desktop.api.openEvidence).toHaveBeenCalledWith('evidence-test-1');
  });

  it('displays goal progress and requires approval for an agent proposal', async () => {
    const goal = {
      id: 'goal-12345678',
      title: 'Stabiliser NeuraCo',
      expectedResult: 'Tous les tests passent.',
      description: 'Éviter les régressions.',
      steps: [{
        id: 'step-12345678',
        title: 'Lancer les tests',
        status: 'pending' as const,
        order: 0,
        createdAt: '2026-07-28T12:00:00.000Z'
      }],
      successCriteria: [{
        id: 'criterion-12345678',
        label: 'Build réussi',
        satisfied: false
      }],
      priority: 'high' as const,
      budget: 20,
      projectIds: [snapshot.project.id],
      agentIds: ['tests'],
      status: 'active' as const,
      progress: 0,
      proposals: [{
        id: 'proposal-12345678',
        title: 'Ajouter un test de non-régression',
        proposedBy: 'Agent Tests',
        status: 'pending' as const,
        createdAt: '2026-07-28T12:00:00.000Z'
      }],
      createdAt: '2026-07-28T12:00:00.000Z',
      updatedAt: '2026-07-28T12:00:00.000Z'
    };
    desktop.api.listGoals = vi.fn().mockResolvedValue([goal]);
    desktop.api.resolveGoalProposal = vi.fn().mockResolvedValue({
      ...goal,
      steps: [
        ...goal.steps,
        {
          id: 'step-87654321',
          title: goal.proposals[0].title,
          status: 'pending',
          order: 1,
          createdAt: '2026-07-28T12:05:00.000Z'
        }
      ],
      proposals: [{ ...goal.proposals[0], status: 'approved' }]
    });

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const goals = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Objectifs'
    );
    await act(async () => {
      goals?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Stabiliser NeuraCo');
    expect(container.textContent).toContain('Ajouter un test de non-régression');
    const approve = container.querySelector<HTMLButtonElement>(
      '.goal-proposals article button.is-primary'
    );
    await act(async () => {
      approve?.click();
      await Promise.resolve();
    });
    expect(desktop.api.resolveGoalProposal).toHaveBeenCalledWith(
      'goal-12345678',
      'proposal-12345678',
      'approved'
    );
    expect(container.textContent).toContain('Les agents ne peuvent rien ajouter seuls');
  });

  it('shows the real Git status and detected test commands', async () => {
    desktop.api.getGitStatus = vi.fn().mockResolvedValue({
      installed: true,
      repository: true,
      root: 'C:\\projects\\sample-project',
      branch: 'main',
      head: '1234567890abcdef',
      dirty: false,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      branches: ['main', 'neuraco/task-1234/developer'],
      worktrees: [
        {
          path: 'C:\\projects\\sample-project',
          branch: 'main',
          head: '1234567890abcdef',
          isMain: true,
          dirty: false
        },
        {
          path: 'C:\\NeuraCo\\worktrees\\developer',
          branch: 'neuraco/task-1234/developer',
          head: 'abcdef1234567890',
          isMain: false,
          dirty: false
        }
      ]
    });
    desktop.api.listGitTestCommands = vi.fn().mockResolvedValue([
      {
        id: 'tests-1',
        label: 'Tests npm · racine',
        cwd: 'C:\\NeuraCo\\worktrees\\developer',
        command: 'npm test'
      }
    ]);
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const gitTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Git'
    );
    await act(async () => {
      gitTab?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('neuraco/task-1234/developer');
    expect(container.textContent).toContain('Tests npm');
    expect(desktop.api.getGitStatus).toHaveBeenCalledOnce();
  });

  it('loads the forge inbox and prepares an issue as a validated plan', async () => {
    desktop.api.getForgeConnection = vi.fn().mockResolvedValue({
      configured: true,
      authenticated: true,
      provider: 'github',
      repository: 'neura/project',
      cli: 'gh',
      message: 'GitHub connecté avec founder.'
    });
    desktop.api.getForgeInbox = vi.fn().mockResolvedValue({
      connection: {
        configured: true,
        authenticated: true,
        provider: 'github',
        repository: 'neura/project',
        cli: 'gh',
        message: 'GitHub connecté avec founder.'
      },
      items: [{
        id: 'github:issue:31',
        kind: 'issue',
        number: 31,
        title: 'Corriger le callback',
        summary: 'Le callback est lent.',
        state: 'open',
        url: 'https://github.com/neura/project/issues/31',
        author: 'reporter',
        requiresReview: true
      }],
      warnings: [],
      fetchedAt: '2026-07-28T10:00:00.000Z'
    });
    desktop.api.getForgeIssue = vi.fn().mockResolvedValue({
      provider: 'github',
      repository: 'neura/project',
      number: 31,
      title: 'Corriger le callback',
      body: 'Le callback est lent.',
      state: 'open',
      url: 'https://github.com/neura/project/issues/31',
      author: 'reporter',
      labels: ['bug'],
      comments: []
    });
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const gitTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Git'
    );
    await act(async () => {
      gitTab?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const refreshRemote = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Actualiser')
        && button.closest('.forge-inbox')
    );
    await act(async () => {
      refreshRemote?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const issueButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Corriger le callback')
    );
    await act(async () => {
      issueButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Déléguer avec prévalidation');
    const delegate = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Déléguer avec prévalidation')
    );
    await act(async () => {
      delegate?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(desktop.api.getForgeInbox).toHaveBeenCalledOnce();
    expect(desktop.api.getForgeIssue).toHaveBeenCalledWith(31);
    expect(desktop.api.previewTaskRoute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestedMode: 'plan',
        content: expect.stringContaining('issue github #31')
      })
    );
    expect(container.textContent).toContain('Routage à valider');
  });

  it('checks project differences before resuming an interrupted task', async () => {
    const recoverableTask = {
      id: 'recover-1',
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      kind: 'multi_agent' as const,
      objective: 'Corriger la reprise',
      plan: 'Analyser puis tester.',
      status: 'interrupted' as const,
      interruptionReason: 'Connexion perdue.',
      steps: [{
        id: 'step-1',
        title: 'Analyser',
        status: 'completed' as const,
        agent: 'Architecte',
        files: ['src/main.ts'],
        result: 'Analyse prête.'
      }],
      agents: ['Architecte'],
      worktrees: [],
      filesModified: ['src/main.ts'],
      commands: ['npm test'],
      results: ['Analyse prête.'],
      budgetAllocated: 10,
      budgetConsumed: 2,
      permissionMode: 'manual' as const,
      allowedActions: ['read_file' as const],
      checkpointIds: [],
      projectState: {
        fingerprint: 'before',
        branch: 'main',
        head: 'abc',
        dirty: false,
        files: [{ path: 'src/main.ts', size: 21 }],
        capturedAt: '2026-07-28T10:00:00.000Z'
      },
      createdAt: '2026-07-28T10:00:00.000Z',
      updatedAt: '2026-07-28T10:01:00.000Z'
    };
    desktop.api.listRecoverableTasks = vi.fn().mockResolvedValue([recoverableTask]);
    desktop.api.inspectRecoverableTask = vi.fn().mockResolvedValue({
      task: recoverableTask,
      compatible: false,
      currentProjectState: {
        ...recoverableTask.projectState,
        fingerprint: 'after',
        head: 'def'
      },
      differences: [{
        kind: 'head',
        before: 'abc',
        after: 'def',
        message: 'Le commit de référence du projet a changé.'
      }]
    });
    desktop.api.resumeRecoverableTask = vi.fn().mockResolvedValue({
      task: { ...recoverableTask, status: 'resuming' },
      strategy: 'restart_from_current',
      resumePrompt: 'Reprends la tâche récupérable recover-1.',
      differences: [{
        kind: 'head',
        before: 'abc',
        after: 'def',
        message: 'Le commit de référence du projet a changé.'
      }]
    });
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const protection = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Protection')
    );
    await act(async () => {
      protection?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Corriger la reprise');
    const verify = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Vérifier')
    );
    await act(async () => {
      verify?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Le projet a changé depuis l’interruption');
    expect(container.textContent).toContain('Le commit de référence du projet a changé');
    const restart = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Replanifier depuis l’état actuel')
    );
    await act(async () => {
      restart?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(desktop.api.resumeRecoverableTask).toHaveBeenCalledWith(
      'recover-1',
      'restart_from_current'
    );
    expect(desktop.api.previewTaskRoute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: 'Reprends la tâche récupérable recover-1.'
      })
    );
    expect(container.textContent).toContain('Routage à valider');
  });

  it('shows persistent notifications and opens their server-provided target', async () => {
    const notification = {
      id: 'notification-1',
      projectId: snapshot.project.id,
      projectName: snapshot.project.name,
      kind: 'credits_low' as const,
      severity: 'warning' as const,
      title: 'Crédits NeuraCo presque épuisés',
      body: 'Il reste 8 % sur la fenêtre 5 heures.',
      target: 'usage' as const,
      actions: ['open' as const],
      sensitive: false,
      createdAt: '2026-07-28T15:00:00.000Z'
    };
    desktop.api.listNotifications = vi.fn().mockResolvedValue([notification]);
    desktop.api.runNotificationAction = vi.fn().mockResolvedValue({
      notification,
      action: 'open',
      requiresValidation: false,
      handled: true,
      message: 'La notification a été ouverte dans NeuraCo.'
    });

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const notificationsButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Notifications')
    );
    expect(notificationsButton?.textContent).toContain('1');
    await act(async () => {
      notificationsButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Crédits NeuraCo presque épuisés');

    const open = container.querySelector<HTMLButtonElement>(
      '.notification-actions button'
    );
    await act(async () => {
      open?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(desktop.api.runNotificationAction).toHaveBeenCalledWith(
      'notification-1',
      'open'
    );
    expect(desktop.api.getUsage).toHaveBeenCalled();
    expect(container.textContent).toContain('La notification a été ouverte dans NeuraCo.');
  });

  it('creates an image studio job and displays server model and consumption', async () => {
    const job = {
      id: 'image-job-123',
      requestId: 'image-request-123',
      projectId: snapshot.project.id,
      operation: 'generate' as const,
      prompt: 'Crée une icône claire.',
      outputs: [{
        id: 'image-output-123',
        variant: 1,
        mimeType: 'image/png' as const,
        filePath: 'C:\\appdata\\image-output-123.png',
        size: 2048
      }],
      provider: 'OpenRouter',
      model: 'google/gemini-2.5-flash-image',
      modelDisplay: 'Gemini 2.5 Flash Image',
      usage: {
        inputTokens: 20,
        outputTokens: 4,
        totalTokens: 24,
        costUsd: 0.04,
        creditsConsumed: 1.25
      },
      rights: {
        status: 'not_reported' as const,
        message: 'Le fournisseur ne transmet pas de licence.'
      },
      warnings: [],
      originalPreserved: true as const,
      createdAt: '2026-07-28T12:00:00.000Z'
    };
    desktop.api.listImageStudioJobs = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([job]);
    desktop.api.createImageStudioJob = vi.fn().mockResolvedValue(job);

    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const imagesTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Images')
    );
    await act(async () => {
      imagesTab?.click();
      await vi.waitFor(
        () => expect(desktop.api.listImageStudioJobs).toHaveBeenCalledOnce()
      );
    });

    const prompt = container.querySelector<HTMLTextAreaElement>(
      '.image-studio-prompt textarea'
    );
    await act(async () => {
      if (prompt) setControlValue(prompt, 'Crée une icône claire.');
    });
    const generate = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Générer avec autorisation')
    );
    await act(async () => {
      generate?.click();
      await vi.waitFor(
        () => expect(desktop.api.createImageStudioJob).toHaveBeenCalledOnce()
      );
      await Promise.resolve();
    });

    expect(desktop.api.createImageStudioJob).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'generate',
        prompt: 'Crée une icône claire.',
        variants: 1,
        requestId: expect.any(String)
      })
    );
    expect(desktop.api.getImageStudioPreview).toHaveBeenCalledWith(
      'image-output-123'
    );
    expect(container.textContent).toContain('Gemini 2.5 Flash Image');
    expect(container.textContent).toContain('1.25 crédit(s)');
    expect(container.textContent).toContain('Original conservé');
  });

  it('stops all agents from the always-visible emergency control', async () => {
    await act(async () => root.render(
      <WorkspacePage
        snapshot={snapshot}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenProject={vi.fn().mockResolvedValue(undefined)}
      />
    ));
    const stop = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Arrêter tous les agents')
    );
    await act(async () => {
      stop?.click();
      await Promise.resolve();
    });
    expect(desktop.api.emergencyStop).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Reprendre');
    expect(container.textContent).toContain('Tous les agents et commandes ont été suspendus');
  });
});
