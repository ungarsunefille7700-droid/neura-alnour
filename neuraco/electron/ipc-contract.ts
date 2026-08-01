export const IPC_CHANNELS = {
  getAppInfo: 'neuraco:app-info',
  runSelfCheck: 'neuraco:self-check',
  connectivityGet: 'neuraco:connectivity-get',
  runtimePolicyGet: 'neuraco:runtime-policy-get',
  accessibilityGet: 'neuraco:accessibility-get',
  accessibilityUpdate: 'neuraco:accessibility-update',
  authRestore: 'neuraco:auth-restore',
  authLogin: 'neuraco:auth-login',
  authRegister: 'neuraco:auth-register',
  authGoogle: 'neuraco:auth-google',
  authLogout: 'neuraco:auth-logout',
  authSessionEvent: 'neuraco:auth-session-event',
  accountGet: 'neuraco:account-get',
  accountSessionRevoke: 'neuraco:account-session-revoke',
  accountSessionsRevokeOthers: 'neuraco:account-sessions-revoke-others',
  accountVerificationRequest: 'neuraco:account-verification-request',
  accountVerificationConfirm: 'neuraco:account-verification-confirm',
  accountPasswordResetRequest: 'neuraco:account-password-reset-request',
  accountPasswordResetConfirm: 'neuraco:account-password-reset-confirm',
  accountTwoFactorSetup: 'neuraco:account-two-factor-setup',
  accountTwoFactorEnable: 'neuraco:account-two-factor-enable',
  accountTwoFactorDisable: 'neuraco:account-two-factor-disable',
  accountPrivacyUpdate: 'neuraco:account-privacy-update',
  accountDelete: 'neuraco:account-delete',
  technicalErrorsList: 'neuraco:technical-errors-list',
  technicalErrorsClear: 'neuraco:technical-errors-clear',
  appLockGet: 'neuraco:app-lock-get',
  appLockSetPin: 'neuraco:app-lock-set-pin',
  appLockRemovePin: 'neuraco:app-lock-remove-pin',
  appLockSettings: 'neuraco:app-lock-settings',
  appLockLock: 'neuraco:app-lock-lock',
  appLockUnlockPin: 'neuraco:app-lock-unlock-pin',
  appLockWindowsHelloEnable: 'neuraco:app-lock-windows-hello-enable',
  appLockWindowsHelloUnlock: 'neuraco:app-lock-windows-hello-unlock',
  appLockEvent: 'neuraco:app-lock-event',
  securityDevicesList: 'neuraco:security-devices-list',
  securityDeviceRevoke: 'neuraco:security-device-revoke',
  projectOpen: 'neuraco:project-open',
  projectRefresh: 'neuraco:project-refresh',
  projectReadFile: 'neuraco:project-read-file',
  projectSaveFile: 'neuraco:project-save-file',
  terminalStart: 'neuraco:terminal-start',
  terminalCancel: 'neuraco:terminal-cancel',
  terminalEvent: 'neuraco:terminal-event',
  terminalProfiles: 'neuraco:terminal-profiles',
  terminalAssess: 'neuraco:terminal-assess',
  backgroundProcessesList: 'neuraco:background-processes-list',
  backgroundProcessStart: 'neuraco:background-process-start',
  backgroundProcessControl: 'neuraco:background-process-control',
  backgroundProcessLog: 'neuraco:background-process-log',
  backgroundProcessEvent: 'neuraco:background-process-event',
  artifactsList: 'neuraco:artifacts-list',
  artifactGet: 'neuraco:artifact-get',
  artifactCreate: 'neuraco:artifact-create',
  artifactUpdate: 'neuraco:artifact-update',
  artifactRename: 'neuraco:artifact-rename',
  artifactDelete: 'neuraco:artifact-delete',
  artifactRestoreVersion: 'neuraco:artifact-restore-version',
  artifactCompare: 'neuraco:artifact-compare',
  artifactExport: 'neuraco:artifact-export',
  nativeDocumentPreview: 'neuraco:native-document-preview',
  nativeDocumentExport: 'neuraco:native-document-export',
  controlledMemoryList: 'neuraco:controlled-memory-list',
  controlledMemoryObserve: 'neuraco:controlled-memory-observe',
  controlledMemoryUpdate: 'neuraco:controlled-memory-update',
  controlledMemoryDelete: 'neuraco:controlled-memory-delete',
  controlledMemorySetEnabled: 'neuraco:controlled-memory-set-enabled',
  controlledMemoryExport: 'neuraco:controlled-memory-export',
  extensionsState: 'neuraco:extensions-state',
  extensionInstallLocal: 'neuraco:extension-install-local',
  extensionUpdate: 'neuraco:extension-update',
  extensionSetEnabled: 'neuraco:extension-set-enabled',
  extensionToolSetEnabled: 'neuraco:extension-tool-set-enabled',
  extensionRemove: 'neuraco:extension-remove',
  mcpServerAdd: 'neuraco:mcp-server-add',
  mcpServerTest: 'neuraco:mcp-server-test',
  mcpServerSetEnabled: 'neuraco:mcp-server-set-enabled',
  mcpToolSetEnabled: 'neuraco:mcp-tool-set-enabled',
  mcpServerRemove: 'neuraco:mcp-server-remove',
  hooksState: 'neuraco:hooks-state',
  hookSave: 'neuraco:hook-save',
  hookSetEnabled: 'neuraco:hook-set-enabled',
  hookDelete: 'neuraco:hook-delete',
  hookTest: 'neuraco:hook-test',
  routinesState: 'neuraco:routines-state',
  routineSave: 'neuraco:routine-save',
  routineSetEnabled: 'neuraco:routine-set-enabled',
  routineDelete: 'neuraco:routine-delete',
  routineRun: 'neuraco:routine-run',
  routineTrigger: 'neuraco:routine-trigger',
  agentChat: 'neuraco:agent-chat',
  agentCancel: 'neuraco:agent-cancel',
  localSessionGet: 'neuraco:local-session-get',
  localSessionSave: 'neuraco:local-session-save',
  localSessionClear: 'neuraco:local-session-clear',
  conversationThreadsList: 'neuraco:conversation-threads-list',
  conversationThreadCreate: 'neuraco:conversation-thread-create',
  conversationThreadSelect: 'neuraco:conversation-thread-select',
  conversationThreadRename: 'neuraco:conversation-thread-rename',
  conversationThreadArchive: 'neuraco:conversation-thread-archive',
  conversationThreadExport: 'neuraco:conversation-thread-export',
  conversationThreadClearMemory: 'neuraco:conversation-thread-clear-memory',
  conversationThreadFork: 'neuraco:conversation-thread-fork',
  conversationThreadRewind: 'neuraco:conversation-thread-rewind',
  conversationThreadCheckpoint: 'neuraco:conversation-thread-checkpoint',
  secondaryConversationsList: 'neuraco:secondary-conversations-list',
  secondaryConversationCreate: 'neuraco:secondary-conversation-create',
  secondaryConversationChat: 'neuraco:secondary-conversation-chat',
  secondaryConversationArchive: 'neuraco:secondary-conversation-archive',
  environmentsDiscover: 'neuraco:environments-discover',
  environmentTransferPreview: 'neuraco:environment-transfer-preview',
  environmentTransferExecute: 'neuraco:environment-transfer-execute',
  environmentTransfersList: 'neuraco:environment-transfers-list',
  environmentPreparationGet: 'neuraco:environment-preparation-get',
  environmentPreparationUpdate: 'neuraco:environment-preparation-update',
  environmentPreparationPreview: 'neuraco:environment-preparation-preview',
  environmentPreparationRun: 'neuraco:environment-preparation-run',
  environmentPreparationHistory: 'neuraco:environment-preparation-history',
  remoteConnectionsDiscover: 'neuraco:remote-connections-discover',
  remoteConnectionChooseKey: 'neuraco:remote-connection-choose-key',
  remoteConnectionAction: 'neuraco:remote-connection-action',
  remoteConnectionDisconnect: 'neuraco:remote-connection-disconnect',
  hostedSitesList: 'neuraco:hosted-sites-list',
  hostedSitePreview: 'neuraco:hosted-site-preview',
  hostedSiteStartPreview: 'neuraco:hosted-site-start-preview',
  hostedSiteStopPreview: 'neuraco:hosted-site-stop-preview',
  hostedSiteDeploy: 'neuraco:hosted-site-deploy',
  hostedSiteProviderStatus: 'neuraco:hosted-site-provider-status',
  imageStudioCreate: 'neuraco:image-studio-create',
  imageStudioList: 'neuraco:image-studio-list',
  imageStudioPreview: 'neuraco:image-studio-preview',
  imageStudioExport: 'neuraco:image-studio-export',
  cloudTasksList: 'neuraco:cloud-tasks-list',
  cloudTaskCreate: 'neuraco:cloud-task-create',
  cloudTaskGet: 'neuraco:cloud-task-get',
  cloudTaskCancel: 'neuraco:cloud-task-cancel',
  relayState: 'neuraco:relay-state',
  relayEnable: 'neuraco:relay-enable',
  relayDisable: 'neuraco:relay-disable',
  relayResolve: 'neuraco:relay-resolve',
  relayEvent: 'neuraco:relay-event',
  permissionsGet: 'neuraco:permissions-get',
  permissionsUpdate: 'neuraco:permissions-update',
  checkpointList: 'neuraco:checkpoint-list',
  checkpointCreate: 'neuraco:checkpoint-create',
  checkpointRestore: 'neuraco:checkpoint-restore',
  checkpointRetentionGet: 'neuraco:checkpoint-retention-get',
  checkpointRetentionUpdate: 'neuraco:checkpoint-retention-update',
  trashList: 'neuraco:trash-list',
  trashMove: 'neuraco:trash-move',
  trashRestore: 'neuraco:trash-restore',
  emergencyStop: 'neuraco:emergency-stop',
  emergencyResume: 'neuraco:emergency-resume',
  emergencyEvent: 'neuraco:emergency-event',
  emergencyShortcutGet: 'neuraco:emergency-shortcut-get',
  emergencyShortcutSet: 'neuraco:emergency-shortcut-set',
  recoverableTasksList: 'neuraco:recoverable-tasks-list',
  recoverableTaskInspect: 'neuraco:recoverable-task-inspect',
  recoverableTaskResume: 'neuraco:recoverable-task-resume',
  recoverableTaskDiscard: 'neuraco:recoverable-task-discard',
  notificationsList: 'neuraco:notifications-list',
  notificationRead: 'neuraco:notification-read',
  notificationArchive: 'neuraco:notification-archive',
  notificationAction: 'neuraco:notification-action',
  notificationEvent: 'neuraco:notification-event',
  goalsList: 'neuraco:goals-list',
  goalCreate: 'neuraco:goal-create',
  goalUpdate: 'neuraco:goal-update',
  goalDelete: 'neuraco:goal-delete',
  goalStepUpdate: 'neuraco:goal-step-update',
  goalProposalResolve: 'neuraco:goal-proposal-resolve',
  agentsList: 'neuraco:agents-list',
  agentsSave: 'neuraco:agents-save',
  agentsDelete: 'neuraco:agents-delete',
  taskRoutingPreview: 'neuraco:task-routing-preview',
  agentsRun: 'neuraco:agents-run',
  agentsCancel: 'neuraco:agents-cancel',
  agentsProgress: 'neuraco:agents-progress',
  reviewQueueList: 'neuraco:review-queue-list',
  reviewQueueStatus: 'neuraco:review-queue-status',
  reviewQueueComment: 'neuraco:review-queue-comment',
  reviewQueueFileDecision: 'neuraco:review-queue-file-decision',
  reviewQueueHunkDecision: 'neuraco:review-queue-hunk-decision',
  reviewQueueAllDecision: 'neuraco:review-queue-all-decision',
  reviewQueueTests: 'neuraco:review-queue-tests',
  reviewQueueCheckpoint: 'neuraco:review-queue-checkpoint',
  gitStatus: 'neuraco:git-status',
  gitDiff: 'neuraco:git-diff',
  gitCreateWorktree: 'neuraco:git-create-worktree',
  gitRemoveWorktree: 'neuraco:git-remove-worktree',
  gitOpenWorktree: 'neuraco:git-open-worktree',
  gitCommitWorktree: 'neuraco:git-commit-worktree',
  gitTestCommands: 'neuraco:git-test-commands',
  gitRunTests: 'neuraco:git-run-tests',
  gitRunTestSuite: 'neuraco:git-run-test-suite',
  gitReview: 'neuraco:git-review',
  gitMerge: 'neuraco:git-merge',
  forgeConnection: 'neuraco:forge-connection',
  forgeInbox: 'neuraco:forge-inbox',
  forgeIssue: 'neuraco:forge-issue',
  forgeCreatePullRequest: 'neuraco:forge-create-pull-request',
  browserState: 'neuraco:browser-state',
  browserEvent: 'neuraco:browser-event',
  browserNewTab: 'neuraco:browser-new-tab',
  browserCloseTab: 'neuraco:browser-close-tab',
  browserActivateTab: 'neuraco:browser-activate-tab',
  browserNavigate: 'neuraco:browser-navigate',
  browserBack: 'neuraco:browser-back',
  browserForward: 'neuraco:browser-forward',
  browserReload: 'neuraco:browser-reload',
  browserBounds: 'neuraco:browser-bounds',
  browserDevTools: 'neuraco:browser-devtools',
  browserCapture: 'neuraco:browser-capture',
  browserSelectElement: 'neuraco:browser-select-element',
  browserAction: 'neuraco:browser-action',
  browserDiagnostics: 'neuraco:browser-diagnostics',
  browserHistory: 'neuraco:browser-history',
  browserDownloads: 'neuraco:browser-downloads',
  browserAnnotations: 'neuraco:browser-annotations',
  browserSaveAnnotation: 'neuraco:browser-save-annotation',
  browserHide: 'neuraco:browser-hide',
  applicationsList: 'neuraco:applications-list',
  applicationLaunch: 'neuraco:application-launch',
  applicationStop: 'neuraco:application-stop',
  computerWindows: 'neuraco:computer-windows',
  computerInspect: 'neuraco:computer-inspect',
  computerCapture: 'neuraco:computer-capture',
  computerPlan: 'neuraco:computer-plan',
  computerExecute: 'neuraco:computer-execute',
  computerCancel: 'neuraco:computer-cancel',
  studioAnalyze: 'neuraco:studio-analyze',
  studioRun: 'neuraco:studio-run',
  studioCancel: 'neuraco:studio-cancel',
  studioEvent: 'neuraco:studio-event',
  usageGet: 'neuraco:usage-get',
  usageEstimate: 'neuraco:usage-estimate',
  usageSettings: 'neuraco:usage-settings',
  usageCheckout: 'neuraco:usage-checkout',
  usageEvent: 'neuraco:usage-event',
  adminStateGet: 'neuraco:admin-state-get',
  adminConfigUpdate: 'neuraco:admin-config-update',
  adminPricingHistory: 'neuraco:admin-pricing-history',
  adminUsersList: 'neuraco:admin-users-list',
  adminLogsList: 'neuraco:admin-logs-list',
  adminIncidentsList: 'neuraco:admin-incidents-list',
  adminIncidentCreate: 'neuraco:admin-incident-create',
  adminIncidentUpdate: 'neuraco:admin-incident-update',
  adminPromotionsList: 'neuraco:admin-promotions-list',
  adminPromotionCreate: 'neuraco:admin-promotion-create',
  adminPromotionUpdate: 'neuraco:admin-promotion-update',
  adminCreditsAdjust: 'neuraco:admin-credits-adjust',
  adminRefundRecord: 'neuraco:admin-refund-record',
  statisticsGet: 'neuraco:statistics-get',
  statisticsExportCsv: 'neuraco:statistics-export-csv',
  statisticsExportPdf: 'neuraco:statistics-export-pdf',
  activityList: 'neuraco:activity-list',
  reportBuild: 'neuraco:report-build',
  reportExport: 'neuraco:report-export',
  evidenceOpen: 'neuraco:evidence-open',
  updateCheck: 'neuraco:update-check',
  updateDownload: 'neuraco:update-download',
  updateInstall: 'neuraco:update-install',
  updatePreferencesGet: 'neuraco:update-preferences-get',
  updatePreferencesSet: 'neuraco:update-preferences-set',
  updateRollbackGet: 'neuraco:update-rollback-get',
  updateRollbackInstall: 'neuraco:update-rollback-install',
  updateEvent: 'neuraco:update-event'
} as const;

export interface NeuraCoAppInfo {
  name: string;
  version: string;
  platform: string;
  architecture: string;
  packaged: boolean;
}

export interface NeuraCoConnectivityState {
  online: boolean;
  checkedAt: string;
  source: 'system';
}

export type NeuraCoAccessibilityTheme = 'system' | 'light' | 'dark';

export interface NeuraCoAccessibilitySettings {
  theme: NeuraCoAccessibilityTheme;
  zoomPercent: number;
  reducedMotion: boolean;
  highContrast: boolean;
}

export type NeuraCoAccessibilitySettingsUpdate = Partial<
  NeuraCoAccessibilitySettings
>;

export interface NeuraCoSelfCheck {
  ok: boolean;
  checkedAt: string;
  checks: {
    contextIsolation: boolean;
    nodeIntegrationDisabled: boolean;
    sandboxEnabled: boolean;
    navigationGuardEnabled: boolean;
  };
}

export interface NeuraCoDesktopApi {
  getConnectivityState: () => Promise<NeuraCoConnectivityState>;
  getRuntimePolicy: () => Promise<NeuraCoRuntimePolicy>;
  getAccessibilitySettings: () => Promise<NeuraCoAccessibilitySettings>;
  updateAccessibilitySettings: (
    update: NeuraCoAccessibilitySettingsUpdate
  ) => Promise<NeuraCoAccessibilitySettings>;
  getAppInfo: () => Promise<NeuraCoAppInfo>;
  runSelfCheck: () => Promise<NeuraCoSelfCheck>;
  restoreSession: () => Promise<NeuraCoSession>;
  login: (credentials: NeuraCoLoginCredentials) => Promise<NeuraCoSession>;
  register: (registration: NeuraCoRegistration) => Promise<NeuraCoSession>;
  loginWithGoogle: () => Promise<NeuraCoSession>;
  logout: () => Promise<NeuraCoSession>;
  getAccount: () => Promise<NeuraCoAccountDashboard>;
  revokeAccountSession: (sessionId: string) => Promise<{ ok: boolean; current: boolean }>;
  revokeOtherAccountSessions: () => Promise<{ ok: boolean; revoked: number }>;
  requestEmailVerification: () => Promise<NeuraCoAccountActionResult>;
  confirmEmailVerification: (token: string) => Promise<NeuraCoAccountActionResult>;
  requestPasswordReset: (email: string) => Promise<NeuraCoAccountActionResult>;
  confirmPasswordReset: (
    email: string,
    token: string,
    newPassword: string
  ) => Promise<NeuraCoAccountActionResult>;
  setupTwoFactor: () => Promise<NeuraCoTwoFactorSetup>;
  enableTwoFactor: (code: string) => Promise<NeuraCoTwoFactorEnableResult>;
  disableTwoFactor: (code: string) => Promise<NeuraCoAccountActionResult>;
  updatePrivacySettings: (
    settings: NeuraCoPrivacySettings
  ) => Promise<NeuraCoPrivacySettings>;
  deleteAccount: (
    request: NeuraCoAccountDeletionRequest
  ) => Promise<NeuraCoAccountDeletionResult>;
  listTechnicalErrors: () => Promise<NeuraCoTechnicalErrorEntry[]>;
  clearTechnicalErrors: () => Promise<{ ok: boolean }>;
  onSessionEvent: (
    listener: (session: NeuraCoSession) => void
  ) => () => void;
  getAppLockState: () => Promise<NeuraCoAppLockState>;
  setAppLockPin: (
    pin: string,
    currentPin?: string
  ) => Promise<NeuraCoAppLockState>;
  removeAppLockPin: (currentPin: string) => Promise<NeuraCoAppLockState>;
  updateAppLockSettings: (
    update: NeuraCoAppLockSettingsUpdate
  ) => Promise<NeuraCoAppLockState>;
  lockApp: () => Promise<NeuraCoAppLockState>;
  unlockAppWithPin: (pin: string) => Promise<NeuraCoAppLockState>;
  setWindowsHelloEnabled: (enabled: boolean) => Promise<NeuraCoAppLockState>;
  unlockAppWithWindowsHello: () => Promise<NeuraCoAppLockState>;
  onAppLockEvent: (
    listener: (state: NeuraCoAppLockState) => void
  ) => () => void;
  listConnectedDevices: () => Promise<NeuraCoConnectedDevice[]>;
  revokeConnectedDevice: (
    deviceId: string
  ) => Promise<NeuraCoConnectedDevice[]>;
  openProject: () => Promise<NeuraCoProjectSnapshot | null>;
  refreshProject: () => Promise<NeuraCoProjectSnapshot | null>;
  readProjectFile: (relativePath: string) => Promise<NeuraCoProjectFile>;
  saveProjectFile: (
    relativePath: string,
    content: string
  ) => Promise<NeuraCoProjectFileSave>;
  startTerminalCommand: (
    request: NeuraCoTerminalCommandRequest
  ) => Promise<NeuraCoTerminalStartResult>;
  cancelTerminalCommand: (commandId: string) => Promise<boolean>;
  listTerminalProfiles: () => Promise<NeuraCoTerminalProfile[]>;
  assessTerminalCommand: (
    command: string
  ) => Promise<NeuraCoTerminalCommandAssessment>;
  onTerminalEvent: (
    listener: (event: NeuraCoTerminalEvent) => void
  ) => () => void;
  listBackgroundProcesses: () => Promise<NeuraCoBackgroundProcess[]>;
  startBackgroundProcess: (
    request: NeuraCoBackgroundProcessRequest
  ) => Promise<NeuraCoBackgroundProcess>;
  controlBackgroundProcess: (
    processId: string,
    action: NeuraCoBackgroundProcessAction
  ) => Promise<NeuraCoBackgroundProcess>;
  getBackgroundProcessLog: (
    processId: string
  ) => Promise<NeuraCoBackgroundProcessLog>;
  onBackgroundProcessEvent: (
    listener: (event: NeuraCoBackgroundProcessEvent) => void
  ) => () => void;
  listArtifacts: (includeDeleted?: boolean) => Promise<NeuraCoArtifactSummary[]>;
  getArtifact: (artifactId: string) => Promise<NeuraCoArtifact>;
  createArtifact: (
    input: NeuraCoArtifactCreate
  ) => Promise<NeuraCoArtifact>;
  updateArtifact: (
    artifactId: string,
    input: NeuraCoArtifactUpdate
  ) => Promise<NeuraCoArtifact>;
  renameArtifact: (
    artifactId: string,
    title: string
  ) => Promise<NeuraCoArtifactSummary>;
  deleteArtifact: (
    artifactId: string
  ) => Promise<NeuraCoArtifactSummary[]>;
  restoreArtifactVersion: (
    artifactId: string,
    versionId: string
  ) => Promise<NeuraCoArtifact>;
  compareArtifactVersions: (
    artifactId: string,
    fromVersionId: string,
    toVersionId: string
  ) => Promise<NeuraCoArtifactComparison>;
  exportArtifact: (artifactId: string) => Promise<string | null>;
  previewNativeDocument: (
    draft: NeuraCoNativeDocumentDraft
  ) => Promise<NeuraCoNativeDocumentPreview>;
  exportNativeDocument: (
    draft: NeuraCoNativeDocumentDraft,
    previewId: string
  ) => Promise<NeuraCoNativeDocumentExport | null>;
  listControlledMemories: () => Promise<NeuraCoControlledMemoryState>;
  observeControlledMemory: (
    input: NeuraCoControlledMemoryObservation
  ) => Promise<NeuraCoControlledMemoryState>;
  updateControlledMemory: (
    memoryId: string,
    input: NeuraCoControlledMemoryUpdate
  ) => Promise<NeuraCoControlledMemoryState>;
  deleteControlledMemory: (
    memoryId: string
  ) => Promise<NeuraCoControlledMemoryState>;
  setControlledMemoryEnabled: (
    enabled: boolean
  ) => Promise<NeuraCoControlledMemoryState>;
  exportControlledMemories: () => Promise<string | null>;
  getExtensionsState: () => Promise<NeuraCoExtensionsState>;
  installLocalExtension: () => Promise<NeuraCoExtensionsState | null>;
  updateExtension: (extensionId: string) => Promise<NeuraCoExtensionsState>;
  setExtensionEnabled: (
    extensionId: string,
    enabled: boolean
  ) => Promise<NeuraCoExtensionsState>;
  setExtensionToolEnabled: (
    extensionId: string,
    toolId: string,
    enabled: boolean
  ) => Promise<NeuraCoExtensionsState>;
  removeExtension: (extensionId: string) => Promise<NeuraCoExtensionsState>;
  addMcpServer: (
    input: NeuraCoMcpServerInput
  ) => Promise<NeuraCoExtensionsState>;
  testMcpServer: (serverId: string) => Promise<NeuraCoExtensionsState>;
  setMcpServerEnabled: (
    serverId: string,
    enabled: boolean
  ) => Promise<NeuraCoExtensionsState>;
  setMcpToolEnabled: (
    serverId: string,
    toolName: string,
    enabled: boolean
  ) => Promise<NeuraCoExtensionsState>;
  removeMcpServer: (serverId: string) => Promise<NeuraCoExtensionsState>;
  getHooksState: () => Promise<NeuraCoHooksState>;
  saveHook: (input: NeuraCoHookInput) => Promise<NeuraCoHooksState>;
  setHookEnabled: (
    hookId: string,
    enabled: boolean
  ) => Promise<NeuraCoHooksState>;
  deleteHook: (hookId: string) => Promise<NeuraCoHooksState>;
  testHook: (hookId: string) => Promise<NeuraCoHookRun>;
  getRoutinesState: () => Promise<NeuraCoRoutinesState>;
  saveRoutine: (
    input: NeuraCoRoutineInput
  ) => Promise<NeuraCoRoutinesState>;
  setRoutineEnabled: (
    routineId: string,
    enabled: boolean
  ) => Promise<NeuraCoRoutinesState>;
  deleteRoutine: (routineId: string) => Promise<NeuraCoRoutinesState>;
  runRoutine: (routineId: string) => Promise<NeuraCoRoutineRun>;
  triggerRoutines: (
    trigger: NeuraCoRoutineTrigger,
    metadata?: Record<string, unknown>
  ) => Promise<NeuraCoRoutineRun[]>;
  sendAgentMessage: (
    request: NeuraCoAgentRequest
  ) => Promise<NeuraCoAgentResponse>;
  cancelAgentMessage: (requestId: string) => Promise<boolean>;
  getLocalSession: () => Promise<NeuraCoLocalSession | null>;
  saveLocalSession: (
    session: NeuraCoLocalSessionSave
  ) => Promise<NeuraCoLocalSession>;
  clearLocalSession: () => Promise<boolean>;
  listConversationThreads: (
    includeArchived?: boolean
  ) => Promise<NeuraCoConversationThreadSummary[]>;
  createConversationThread: (
    request?: NeuraCoConversationThreadCreate
  ) => Promise<NeuraCoConversationThread>;
  selectConversationThread: (
    threadId: string
  ) => Promise<NeuraCoConversationThread>;
  renameConversationThread: (
    threadId: string,
    title: string
  ) => Promise<NeuraCoConversationThread>;
  archiveConversationThread: (
    threadId: string,
    archived: boolean
  ) => Promise<NeuraCoConversationThreadSummary[]>;
  exportConversationThread: (
    threadId: string
  ) => Promise<NeuraCoConversationThreadExport>;
  clearConversationThreadMemory: (
    threadId: string
  ) => Promise<NeuraCoConversationThread>;
  forkConversationThread: (
    threadId: string,
    fromMessageId?: string
  ) => Promise<NeuraCoConversationThread>;
  rewindConversationThread: (
    threadId: string,
    messageId: string
  ) => Promise<NeuraCoConversationThread>;
  attachConversationCheckpoint: (
    threadId: string,
    checkpointId?: string
  ) => Promise<NeuraCoConversationThread>;
  listSecondaryConversations: (
    parentThreadId?: string
  ) => Promise<NeuraCoSecondaryConversation[]>;
  createSecondaryConversation: (
    input: NeuraCoSecondaryConversationCreate
  ) => Promise<NeuraCoSecondaryConversation>;
  sendSecondaryConversationMessage: (
    request: NeuraCoSecondaryConversationMessageRequest
  ) => Promise<NeuraCoSecondaryConversation>;
  archiveSecondaryConversation: (
    conversationId: string
  ) => Promise<NeuraCoSecondaryConversation[]>;
  discoverEnvironments: () => Promise<NeuraCoEnvironmentDiscovery>;
  previewEnvironmentTransfer: (
    target: NeuraCoEnvironmentTarget
  ) => Promise<NeuraCoEnvironmentTransferPreview>;
  executeEnvironmentTransfer: (
    target: NeuraCoEnvironmentTarget
  ) => Promise<NeuraCoEnvironmentTransferRecord>;
  listEnvironmentTransfers: () => Promise<NeuraCoEnvironmentTransferRecord[]>;
  getEnvironmentPreparation: () => Promise<NeuraCoEnvironmentPreparationConfig>;
  updateEnvironmentPreparation: (
    update: NeuraCoEnvironmentPreparationUpdate
  ) => Promise<NeuraCoEnvironmentPreparationConfig>;
  previewEnvironmentPreparation: (
    target: NeuraCoEnvironmentTarget
  ) => Promise<NeuraCoEnvironmentPreparationPreview>;
  runEnvironmentPreparation: (
    target: NeuraCoEnvironmentTarget
  ) => Promise<NeuraCoEnvironmentPreparationExecution>;
  listEnvironmentPreparationHistory: (
    limit?: number
  ) => Promise<NeuraCoEnvironmentPreparationExecution[]>;
  discoverRemoteConnections: () => Promise<NeuraCoRemoteDiscovery>;
  chooseRemoteSshKey: () => Promise<string | null>;
  runRemoteConnectionAction: (
    request: NeuraCoRemoteActionRequest
  ) => Promise<NeuraCoRemoteActionResult>;
  disconnectRemoteConnection: (connectionId: string) => Promise<boolean>;
  listHostedSiteDeployments: () => Promise<NeuraCoHostedSiteDeployment[]>;
  previewHostedSite: (
    request: NeuraCoHostedSiteRequest
  ) => Promise<NeuraCoHostedSitePreview>;
  startHostedSitePreview: (
    previewId: string
  ) => Promise<NeuraCoHostedSitePreviewSession>;
  stopHostedSitePreview: (previewId: string) => Promise<boolean>;
  deployHostedSite: (
    previewId: string
  ) => Promise<NeuraCoHostedSiteDeployment>;
  getHostedSiteProviderStatus: () => Promise<NeuraCoHostedSiteProviderStatus>;
  createImageStudioJob: (
    request: NeuraCoImageStudioCreateRequest
  ) => Promise<NeuraCoImageStudioJob>;
  listImageStudioJobs: (
    limit?: number
  ) => Promise<NeuraCoImageStudioJob[]>;
  getImageStudioPreview: (
    outputId: string
  ) => Promise<NeuraCoImageStudioPreview>;
  exportImageStudioOutput: (
    outputId: string
  ) => Promise<string | null>;
  listCloudTasks: (limit?: number) => Promise<NeuraCoCloudTask[]>;
  createCloudTask: (
    request: NeuraCoCloudTaskRequest
  ) => Promise<NeuraCoCloudTask>;
  getCloudTask: (taskId: string) => Promise<NeuraCoCloudTask>;
  cancelCloudTask: (taskId: string) => Promise<NeuraCoCloudTask>;
  getRelayState: () => Promise<NeuraCoRelayState>;
  enableRelay: () => Promise<NeuraCoRelayState>;
  disableRelay: () => Promise<NeuraCoRelayState>;
  resolveRelayCommand: (
    commandId: string,
    accepted: boolean
  ) => Promise<NeuraCoRelayState>;
  onRelayEvent: (
    listener: (event: NeuraCoRelayEvent) => void
  ) => () => void;
  getProjectPermissions: () => Promise<NeuraCoProjectPermissions>;
  updateProjectPermissions: (
    request: NeuraCoProjectPermissionsUpdate
  ) => Promise<NeuraCoProjectPermissions>;
  listCheckpoints: () => Promise<NeuraCoCheckpoint[]>;
  createCheckpoint: (
    request: string | NeuraCoCheckpointCreateRequest
  ) => Promise<NeuraCoCheckpoint>;
  restoreCheckpoint: (
    checkpointId: string,
    target?: NeuraCoCheckpointRestoreTarget
  ) => Promise<NeuraCoCheckpointRestoreResult>;
  getCheckpointRetention: () => Promise<NeuraCoCheckpointRetention>;
  updateCheckpointRetention: (
    maxPerProject: number
  ) => Promise<NeuraCoCheckpointRetention>;
  listTrash: () => Promise<NeuraCoTrashEntry[]>;
  moveProjectPathToTrash: (relativePath: string) => Promise<NeuraCoTrashEntry>;
  restoreTrashEntry: (entryId: string) => Promise<NeuraCoTrashEntry>;
  emergencyStop: () => Promise<NeuraCoEmergencyState>;
  emergencyResume: () => Promise<NeuraCoEmergencyState>;
  onEmergencyState: (
    listener: (state: NeuraCoEmergencyState) => void
  ) => () => void;
  getEmergencyShortcut: () => Promise<string>;
  setEmergencyShortcut: (accelerator: string) => Promise<string>;
  listRecoverableTasks: (
    includeCompleted?: boolean
  ) => Promise<NeuraCoRecoverableTask[]>;
  inspectRecoverableTask: (
    taskId: string
  ) => Promise<NeuraCoRecoverableTaskInspection>;
  resumeRecoverableTask: (
    taskId: string,
    strategy: NeuraCoTaskResumeStrategy
  ) => Promise<NeuraCoRecoverableTaskResume>;
  discardRecoverableTask: (
    taskId: string
  ) => Promise<NeuraCoRecoverableTask[]>;
  listNotifications: (
    includeArchived?: boolean
  ) => Promise<NeuraCoNotification[]>;
  markNotificationRead: (
    notificationId: string
  ) => Promise<NeuraCoNotification[]>;
  archiveNotification: (
    notificationId: string
  ) => Promise<NeuraCoNotification[]>;
  runNotificationAction: (
    notificationId: string,
    action: NeuraCoNotificationAction
  ) => Promise<NeuraCoNotificationActionEvent>;
  onNotificationEvent: (
    listener: (event: NeuraCoNotificationEvent) => void
  ) => () => void;
  listGoals: () => Promise<NeuraCoGoal[]>;
  createGoal: (input: NeuraCoGoalCreate) => Promise<NeuraCoGoal>;
  updateGoal: (goalId: string, input: NeuraCoGoalUpdate) => Promise<NeuraCoGoal>;
  deleteGoal: (goalId: string) => Promise<NeuraCoGoal[]>;
  updateGoalStep: (
    goalId: string,
    stepId: string,
    status: NeuraCoGoalStepStatus
  ) => Promise<NeuraCoGoal>;
  resolveGoalProposal: (
    goalId: string,
    proposalId: string,
    decision: 'approved' | 'rejected'
  ) => Promise<NeuraCoGoal>;
  listAgents: () => Promise<NeuraCoAgentDefinition[]>;
  saveCustomAgent: (
    definition: NeuraCoCustomAgentInput
  ) => Promise<NeuraCoAgentDefinition>;
  deleteCustomAgent: (agentId: string) => Promise<boolean>;
  previewTaskRoute: (
    request: NeuraCoTaskRoutingRequest
  ) => Promise<NeuraCoTaskRoutingPreview>;
  runMultiAgentTask: (
    request: NeuraCoMultiAgentRequest
  ) => Promise<NeuraCoMultiAgentResult>;
  cancelMultiAgentTask: (taskId: string) => Promise<boolean>;
  onMultiAgentProgress: (
    listener: (event: NeuraCoMultiAgentProgress) => void
  ) => () => void;
  listReviewQueue: (
    includeArchived?: boolean
  ) => Promise<NeuraCoReviewItem[]>;
  updateReviewStatus: (
    itemId: string,
    status: NeuraCoReviewStatus
  ) => Promise<NeuraCoReviewItem>;
  addReviewComment: (
    input: NeuraCoReviewCommentInput
  ) => Promise<NeuraCoReviewItem>;
  decideReviewFile: (
    input: NeuraCoReviewFileDecisionInput
  ) => Promise<NeuraCoReviewItem>;
  decideReviewHunk: (
    input: NeuraCoReviewHunkDecisionInput
  ) => Promise<NeuraCoReviewItem>;
  decideAllReviewChanges: (
    input: NeuraCoReviewAllDecisionInput
  ) => Promise<NeuraCoReviewItem>;
  recordReviewTests: (
    itemId: string,
    tests: NeuraCoGitTestResult[]
  ) => Promise<NeuraCoReviewItem>;
  attachReviewCheckpoint: (
    itemId: string,
    checkpointId: string
  ) => Promise<NeuraCoReviewItem>;
  getGitStatus: () => Promise<NeuraCoGitStatus>;
  getGitDiff: (branch?: string) => Promise<NeuraCoGitDiff>;
  createGitWorktree: (
    request: NeuraCoGitWorktreeCreate
  ) => Promise<NeuraCoGitWorktree>;
  removeGitWorktree: (worktreePath: string) => Promise<boolean>;
  openGitWorktree: (worktreePath: string) => Promise<boolean>;
  commitGitWorktree: (
    worktreePath: string,
    message: string
  ) => Promise<NeuraCoGitCommitResult>;
  listGitTestCommands: (worktreePath?: string) => Promise<NeuraCoGitTestCommand[]>;
  runGitTests: (
    commandId: string,
    worktreePath?: string
  ) => Promise<NeuraCoGitTestResult>;
  runGitTestSuite: (worktreePath?: string) => Promise<NeuraCoGitTestResult[]>;
  reviewGitBranch: (branch: string) => Promise<NeuraCoGitReview>;
  mergeGitBranch: (branch: string) => Promise<NeuraCoGitMergeResult>;
  getForgeConnection: () => Promise<NeuraCoForgeConnection>;
  getForgeInbox: () => Promise<NeuraCoForgeInbox>;
  getForgeIssue: (issueNumber: number) => Promise<NeuraCoForgeIssue>;
  createForgePullRequest: (
    request: NeuraCoForgePullRequestCreate
  ) => Promise<NeuraCoForgePullRequestResult>;
  getBrowserState: () => Promise<NeuraCoBrowserState>;
  newBrowserTab: (url?: string) => Promise<NeuraCoBrowserState>;
  closeBrowserTab: (tabId: string) => Promise<NeuraCoBrowserState>;
  activateBrowserTab: (tabId: string) => Promise<NeuraCoBrowserState>;
  navigateBrowser: (url: string) => Promise<NeuraCoBrowserState>;
  browserBack: () => Promise<NeuraCoBrowserState>;
  browserForward: () => Promise<NeuraCoBrowserState>;
  browserReload: () => Promise<NeuraCoBrowserState>;
  setBrowserBounds: (bounds: NeuraCoBrowserBounds | null) => Promise<boolean>;
  toggleBrowserDevTools: () => Promise<boolean>;
  captureBrowser: () => Promise<NeuraCoBrowserCapture>;
  selectBrowserElement: () => Promise<NeuraCoBrowserElement>;
  runBrowserAction: (action: NeuraCoBrowserAction) => Promise<NeuraCoBrowserActionResult>;
  inspectBrowserDiagnostics: () => Promise<NeuraCoBrowserDiagnostics>;
  getBrowserHistory: () => Promise<NeuraCoBrowserHistoryEntry[]>;
  getBrowserDownloads: () => Promise<NeuraCoBrowserDownload[]>;
  getBrowserAnnotations: () => Promise<NeuraCoBrowserAnnotation[]>;
  saveBrowserAnnotation: (
    annotation: NeuraCoBrowserAnnotationInput
  ) => Promise<NeuraCoBrowserAnnotation>;
  hideBrowser: () => Promise<boolean>;
  onBrowserEvent: (
    listener: (event: NeuraCoBrowserEvent) => void
  ) => () => void;
  listApplications: () => Promise<NeuraCoApplication[]>;
  launchApplication: (
    applicationId: string,
    target?: string
  ) => Promise<NeuraCoApplicationProcess>;
  stopApplication: (processId: string) => Promise<boolean>;
  listComputerWindows: () => Promise<NeuraCoComputerWindow[]>;
  inspectComputerWindow: (windowId: string) => Promise<NeuraCoComputerInspection>;
  captureComputerWindow: (windowId: string) => Promise<NeuraCoComputerCapture>;
  planComputerAction: (
    request: NeuraCoComputerActionRequest
  ) => Promise<NeuraCoComputerActionPlan>;
  executeComputerPlan: (planId: string) => Promise<NeuraCoComputerActionResult>;
  cancelComputerPlan: (planId: string) => Promise<boolean>;
  analyzeStudioProject: () => Promise<NeuraCoStudioAnalysis>;
  runStudioOperation: (
    request: NeuraCoStudioOperationRequest
  ) => Promise<NeuraCoStudioOperationResult>;
  cancelStudioOperation: (taskId: string) => Promise<boolean>;
  onStudioEvent: (
    listener: (event: NeuraCoStudioEvent) => void
  ) => () => void;
  getUsage: () => Promise<NeuraCoUsageSummary>;
  estimateUsage: (
    request: NeuraCoUsageEstimateRequest
  ) => Promise<NeuraCoUsageEstimate>;
  updateUsageSettings: (
    request: NeuraCoUsageSettingsUpdate
  ) => Promise<NeuraCoUsageSummary>;
  createCreditCheckout: (
    amountEur: number
  ) => Promise<NeuraCoCreditCheckout>;
  onUsageEvent: (
    listener: (summary: NeuraCoUsageSummary) => void
  ) => () => void;
  getAdminState: () => Promise<NeuraCoAdminState>;
  updateAdminConfig: (
    update: NeuraCoAdminConfigUpdate
  ) => Promise<{ ok: boolean; config: NeuraCoAdminConfig }>;
  getAdminPricingHistory: () => Promise<NeuraCoAdminPricingHistory[]>;
  listAdminUsers: (search?: string) => Promise<NeuraCoAdminUser[]>;
  listAdminLogs: () => Promise<NeuraCoAdminLog[]>;
  listAdminIncidents: () => Promise<NeuraCoAdminIncident[]>;
  createAdminIncident: (
    request: NeuraCoAdminIncidentCreate
  ) => Promise<{ ok: boolean; incident: NeuraCoAdminIncident }>;
  updateAdminIncident: (
    incidentId: string,
    request: NeuraCoAdminIncidentUpdate
  ) => Promise<{ ok: boolean; incident_id: string; status: string }>;
  listAdminPromotions: () => Promise<NeuraCoAdminPromotion[]>;
  createAdminPromotion: (
    request: NeuraCoAdminPromotionCreate
  ) => Promise<{ ok: boolean; promotion: NeuraCoAdminPromotion }>;
  updateAdminPromotion: (
    promotionId: string,
    active: boolean
  ) => Promise<{ ok: boolean; promotion_id: string; active: boolean }>;
  adjustAdminCredits: (
    request: NeuraCoAdminCreditAdjustment
  ) => Promise<NeuraCoAdminLedgerResult>;
  recordAdminRefund: (
    request: NeuraCoAdminRefundRecord
  ) => Promise<NeuraCoAdminLedgerResult>;
  getStatistics: () => Promise<NeuraCoStatisticsSummary>;
  exportStatisticsCsv: () => Promise<string | null>;
  exportStatisticsPdf: () => Promise<string | null>;
  listActivity: (limit?: number) => Promise<NeuraCoActivityEntry[]>;
  buildTaskReport: (taskId?: string) => Promise<NeuraCoTaskReport>;
  exportTaskReport: (taskId?: string) => Promise<string | null>;
  openEvidence: (evidenceId: string) => Promise<boolean>;
  checkForUpdates: () => Promise<NeuraCoUpdateManifest>;
  downloadUpdate: () => Promise<NeuraCoUpdateState>;
  installUpdate: () => Promise<NeuraCoUpdateState>;
  getUpdatePreferences: () => Promise<NeuraCoUpdatePreferences>;
  updateUpdatePreferences: (
    update: Partial<NeuraCoUpdatePreferences>
  ) => Promise<NeuraCoUpdatePreferences>;
  getUpdateRollback: () => Promise<NeuraCoUpdateRollback>;
  rollbackUpdate: () => Promise<NeuraCoUpdateState>;
  onUpdateEvent: (
    listener: (state: NeuraCoUpdateState) => void
  ) => () => void;
}

export interface NeuraCoLoginCredentials {
  email: string;
  password: string;
  twoFactorCode?: string;
}

export interface NeuraCoRegistration {
  name: string;
  email: string;
  password: string;
}

export interface NeuraCoUser {
  id: string;
  email: string;
  name: string;
  subscription: string;
  is_vip: boolean;
  email_verified?: boolean;
  two_factor_enabled?: boolean;
}

export interface NeuraCoEntitlement {
  neuraco_access: boolean;
  plan: string;
  reason: string;
}

export interface NeuraCoSession {
  status: 'authenticated' | 'signed_out' | 'denied' | 'error';
  user?: NeuraCoUser;
  entitlement?: NeuraCoEntitlement;
  persistent?: boolean;
  error?: string;
  requiresTwoFactor?: boolean;
}

export interface NeuraCoAccountSession {
  id: string;
  device_name: string;
  ip_hint: string;
  created_at?: string;
  last_seen_at?: string;
  expires_at?: string;
  current: boolean;
}

export interface NeuraCoAccountInvoice {
  id: string;
  kind: string;
  plan?: string;
  amount?: number;
  currency: string;
  status: string;
  created_at?: string;
}

export interface NeuraCoPrivacySettings {
  analytics_enabled: boolean;
  product_emails_enabled: boolean;
  security_emails_enabled: boolean;
  desktop_notifications_email_enabled: boolean;
}

export interface NeuraCoAccountDeletionRequest {
  confirmationEmail: string;
  password?: string;
  twoFactorCode?: string;
}

export interface NeuraCoAccountDeletionResult {
  ok: boolean;
  account_deleted: boolean;
  cloud_collections_cleared: number;
  billing_records: 'pseudonymized';
}

export interface NeuraCoTechnicalErrorEntry {
  occurredAt: string;
  area: string;
  errorType: string;
  errorCode?: string;
  fingerprint: string;
}

export interface NeuraCoAccountDashboard {
  profile: NeuraCoUser & {
    email_verified: boolean;
    two_factor_enabled: boolean;
  };
  usage: NeuraCoUsageSummary | null;
  sessions: NeuraCoAccountSession[];
  invoices: NeuraCoAccountInvoice[];
  storage: {
    cloud_files: number;
    cloud_bytes: number;
  };
  personal_keys: Array<{
    provider: string;
    fingerprint: string;
    active: boolean;
  }>;
  connections: {
    google: boolean;
    relay_devices: number;
  };
  privacy: NeuraCoPrivacySettings;
}

export interface NeuraCoAccountActionResult {
  ok: boolean;
  message?: string;
  sent?: boolean;
  already_verified?: boolean;
  email_verified?: boolean;
  two_factor_enabled?: boolean;
}

export interface NeuraCoTwoFactorSetup {
  secret: string;
  otpauth_uri: string;
  expires_at: string;
}

export interface NeuraCoTwoFactorEnableResult {
  ok: boolean;
  recovery_codes: string[];
}

export type NeuraCoAppLockReason = 'startup' | 'idle' | 'manual' | 'remote';
export type NeuraCoWindowsHelloAvailability =
  | 'available'
  | 'not_configured'
  | 'not_supported'
  | 'disabled_by_policy'
  | 'busy'
  | 'unknown';

export interface NeuraCoAppLockState {
  configured: boolean;
  locked: boolean;
  reason?: NeuraCoAppLockReason;
  pinEnabled: boolean;
  windowsHelloEnabled: boolean;
  windowsHelloAvailability: NeuraCoWindowsHelloAvailability;
  lockOnStartup: boolean;
  idleTimeoutMinutes: number;
  maskSensitiveNotifications: boolean;
  storageAvailable: boolean;
  failedAttempts: number;
  retryAt?: string;
}

export interface NeuraCoAppLockSettingsUpdate {
  lockOnStartup: boolean;
  idleTimeoutMinutes: number;
  maskSensitiveNotifications: boolean;
}

export interface NeuraCoConnectedDevice {
  deviceId: string;
  deviceName: string;
  appVersion: string;
  lastSeenAt: string;
  createdAt?: string;
  revokedAt?: string;
  online: boolean;
  current: boolean;
}

export interface NeuraCoUsageWindow {
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  remaining_percent: number;
}

export interface NeuraCoUsageLedgerEntry {
  type: string;
  status: string;
  task_id?: string;
  project_id?: string;
  agent?: string;
  provider?: string;
  model?: string;
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  metering?: string;
  credits_added?: number;
  credits_consumed?: number;
  credit_breakdown?: {
    ai: number;
    infrastructure: number;
    tools: number;
  };
  pricing_version?: string;
  rounding_rule?: string;
  source?: string;
  amount_paid?: number;
  currency?: string;
  expiration?: string;
  created_at: string;
}

export interface NeuraCoUsageSummary {
  plan: {
    id: string;
    subscription: string;
    label: string;
    multiplier: number;
    price_monthly?: number;
    currency: string;
    administrator: boolean;
  };
  windows: {
    five_hour: NeuraCoUsageWindow;
    seven_day: NeuraCoUsageWindow;
    monthly: NeuraCoUsageWindow;
  };
  billing_period: {
    starts_at: string;
    renews_at: string;
  };
  next_recovery_at?: string | null;
  purchased: {
    available: number;
    reserved: number;
    expiring_lots: Array<{
      remaining_credits: number;
      expires_at: string;
      created_at?: string;
    }>;
  };
  finalization_reserve: {
    limit: number;
    used: number;
  };
  settings: {
    allow_purchased_credits: boolean;
    task_cap?: number | null;
    daily_cap?: number | null;
    monthly_cap?: number | null;
    agent_cap?: number | null;
    max_agents?: number | null;
    max_model?: 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash' | null;
    auto_reload_enabled: boolean;
    auto_reload_available: boolean;
  };
  spending_caps: {
    daily: { limit?: number | null; used: number };
    monthly: { limit?: number | null; used: number };
    task: { limit?: number | null };
    agent: { limit?: number | null };
  };
  recent: NeuraCoUsageLedgerEntry[];
  server_time: string;
}

export interface NeuraCoRuntimePolicy {
  revision: number;
  maintenance: {
    active: boolean;
    enabled?: boolean;
    message?: string;
    starts_at?: string | null;
    ends_at?: string | null;
  };
  providers: Record<string, { enabled: boolean }>;
  disabled_models: string[];
  plugins: {
    allow_unsigned_local: boolean;
    blocked_ids: string[];
  };
  release: {
    latest_version: string;
    minimum_supported_version: string;
    rollout_percent: number;
  };
  incidents: NeuraCoAdminIncident[];
  server_time: string;
}

export interface NeuraCoAdminPlanConfig {
  label: string;
  multiplier: number;
  five_hour: number;
  seven_day: number;
  monthly: number;
  finalization: number;
}

export interface NeuraCoAdminModelConfig {
  provider: 'openai' | 'anthropic' | 'gemini';
  input: number;
  cached_input: number;
  output: number;
  disabled: boolean;
}

export interface NeuraCoAdminBillingConfig {
  credits_per_usd: number;
  margin_percent: number;
  infrastructure_per_request_usd: number;
  compute_per_second_usd: number;
  storage_per_mb_usd: number;
  browser_call_usd: number;
  computer_call_usd: number;
  additional_agent_usd: number;
  remote_task_usd: number;
  priority_multipliers: Record<'standard' | 'high' | 'maximum', number>;
}

export interface NeuraCoAdminConfig {
  revision: number;
  version: string;
  plans: Record<string, NeuraCoAdminPlanConfig>;
  models: Record<string, NeuraCoAdminModelConfig>;
  billing: NeuraCoAdminBillingConfig;
  providers: Record<string, { enabled: boolean }>;
  tools: Record<string, number>;
  plugins: {
    allow_unsigned_local: boolean;
    blocked_ids: string[];
  };
  maintenance: {
    enabled: boolean;
    message: string;
    starts_at?: string | null;
    ends_at?: string | null;
  };
  release: {
    latest_version: string;
    minimum_supported_version: string;
    rollout_percent: number;
  };
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface NeuraCoAdminState {
  role: 'founder' | 'admin';
  config: NeuraCoAdminConfig;
  counts: {
    users: number;
    active_incidents: number;
    active_promotions: number;
  };
}

export interface NeuraCoAdminConfigUpdate {
  expected_revision: number;
  reason: string;
  version?: string;
  plans?: Record<string, NeuraCoAdminPlanConfig>;
  models?: Record<string, NeuraCoAdminModelConfig>;
  billing?: NeuraCoAdminBillingConfig;
  providers?: Record<string, { enabled: boolean }>;
  tools?: Record<string, number>;
  plugins?: NeuraCoAdminConfig['plugins'];
  maintenance?: NeuraCoAdminConfig['maintenance'];
  release?: NeuraCoAdminConfig['release'];
}

export interface NeuraCoAdminPricingHistory {
  id: string;
  status: 'pending' | 'committed' | 'aborted';
  revision: number;
  reason: string;
  actor_email?: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  created_at: string;
  committed_at?: string;
}

export interface NeuraCoAdminUser {
  id: string;
  email: string;
  name?: string;
  username?: string;
  subscription?: string;
  role?: string;
  status?: string;
}

export interface NeuraCoAdminLog {
  id: string;
  action: string;
  actor_email?: string;
  target_user_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface NeuraCoAdminIncident {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  created_at: string;
  updated_at: string;
}

export interface NeuraCoAdminIncidentCreate {
  title: string;
  message: string;
  severity: NeuraCoAdminIncident['severity'];
  status: NeuraCoAdminIncident['status'];
}

export interface NeuraCoAdminIncidentUpdate {
  status: NeuraCoAdminIncident['status'];
  message?: string;
}

export interface NeuraCoAdminPromotion {
  id: string;
  code: string;
  description: string;
  discount_percent: number;
  plans: string[];
  starts_at?: string | null;
  ends_at?: string | null;
  max_uses?: number | null;
  uses: number;
  active: boolean;
  created_at: string;
}

export interface NeuraCoAdminPromotionCreate {
  code: string;
  description: string;
  discount_percent: number;
  plans: Array<'pro' | 'neura_plus' | 'neura_ultra'>;
  starts_at?: string | null;
  ends_at?: string | null;
  max_uses?: number | null;
}

export interface NeuraCoAdminCreditAdjustment {
  user_id: string;
  amount: number;
  reason: string;
  idempotency_key: string;
}

export interface NeuraCoAdminRefundRecord {
  payment_reference: string;
  provider_refund_id: string;
  credits_to_remove: number;
  reason: string;
}

export interface NeuraCoAdminLedgerResult {
  ok: boolean;
  duplicate: boolean;
  entry: NeuraCoUsageLedgerEntry;
}

export interface NeuraCoStatisticsMetric {
  key: string;
  label: string;
  requests: number;
  creditsConsumed: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  durationMs: number;
  source: 'server-ledger' | 'local-activity';
  tokenMetricsAvailable: boolean;
}

export interface NeuraCoStatisticsPeriod extends NeuraCoStatisticsMetric {
  period: string;
}

export interface NeuraCoStatisticsSummary {
  generatedAt: string;
  coverage: {
    startsAt?: string;
    endsAt?: string;
    serverRecords: number;
    activityEvents: number;
    providerReportedRecords: number;
    estimatedRecords: number;
    unknownMeteringRecords: number;
    limitedToRecentEntries: boolean;
  };
  totals: {
    creditsConsumed: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    requests: number;
    executionTimeMs: number;
  };
  tasks: {
    successful: number;
    failed: number;
    cancelled: number;
    successRate: number;
  };
  estimatedTimeSaved: {
    milliseconds: number;
    isEstimate: true;
    methodology: string;
  };
  byModel: NeuraCoStatisticsMetric[];
  byAgent: NeuraCoStatisticsMetric[];
  byTool: NeuraCoStatisticsMetric[];
  byProject: NeuraCoStatisticsMetric[];
  daily: NeuraCoStatisticsPeriod[];
  monthly: NeuraCoStatisticsPeriod[];
  notices: string[];
}

export interface NeuraCoUsageEstimateRequest {
  mode: 'economic' | 'balanced' | 'quality' | 'custom';
  model: 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash';
  promptCharacters: number;
  maxOutputTokens: number;
  agents: number;
  imageCount: number;
}

export interface NeuraCoUsageEstimate {
  model: string;
  provider: string;
  mode: string;
  agents: number;
  environment: string;
  minimum_credits: number;
  maximum_credits: number;
  five_hour_percent: number;
  seven_day_percent: number;
  can_start_with_included: boolean;
  purchased_credits_required: number;
  is_estimate: true;
}

export interface NeuraCoUsageSettingsUpdate {
  allowPurchasedCredits: boolean;
  taskCap?: number | null;
  dailyCap?: number | null;
  monthlyCap?: number | null;
  agentCap?: number | null;
  maxAgents?: number | null;
  maxModel?: 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash' | null;
  autoReloadEnabled: boolean;
  autoReloadMinimum?: number | null;
  autoReloadTarget?: number | null;
  autoReloadMaxEur?: number | null;
  autoReloadMonthlyCapEur?: number | null;
}

export interface NeuraCoCreditCheckout {
  url: string;
  session_id: string;
  amount_eur: number;
  credits: number;
  one_off: true;
}

export interface NeuraCoActivityEntry {
  id: string;
  timestamp: string;
  sequence?: number;
  previousHash?: string;
  entryHash?: string;
  taskId?: string;
  projectId?: string;
  category: string;
  action: string;
  status: 'started' | 'completed' | 'failed' | 'refused' | 'cancelled' | 'info';
  summary: string;
  details?: Record<string, unknown>;
  evidence?: NeuraCoEvidence;
}

export type NeuraCoEvidenceKind =
  | 'test_result'
  | 'screenshot'
  | 'terminal_log'
  | 'api_exchange'
  | 'visual_comparison'
  | 'build_report'
  | 'git_state'
  | 'studio_report'
  | 'artifact_report'
  | 'accessibility_report';

export interface NeuraCoEvidence {
  id: string;
  source: 'machine';
  kind: NeuraCoEvidenceKind;
  status: 'passed' | 'failed' | 'observed';
  title: string;
  summary: string;
  capturedAt: string;
  taskId?: string;
  projectId?: string;
  command?: string;
  exitCode?: number | null;
  durationMs?: number;
  filePath?: string;
  mediaType?: string;
  url?: string;
  output?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface NeuraCoTaskReport {
  generatedAt: string;
  taskId?: string;
  objective?: string;
  durationMs: number;
  agents: string[];
  applications: string[];
  filesRead: string[];
  filesCreated: string[];
  filesModified: string[];
  filesMoved: string[];
  filesDeleted: string[];
  commands: string[];
  tests: Array<{ summary: string; status: string }>;
  errors: string[];
  corrections: string[];
  refusedActions: string[];
  risks: string[];
  restorePoints: string[];
  creditsConsumed: number;
  integrity?: {
    verified: boolean;
    chainedEntries: number;
    legacyEntries: number;
    invalidEntryIds: string[];
  };
  evidence: NeuraCoEvidence[];
  events: NeuraCoActivityEntry[];
}

export interface NeuraCoUpdateManifest {
  available: boolean;
  current_version: string;
  latest_version: string;
  channel?: NeuraCoUpdateChannel;
  download_url?: string;
  checksum_sha256?: string;
  size?: number;
  signature_required?: boolean;
  mandatory?: boolean;
  notes?: string[];
  published_at?: string | null;
  minimum_version?: string | null;
  checked_at: string;
}

export type NeuraCoUpdateChannel = 'stable' | 'beta';

export interface NeuraCoUpdatePreferences {
  channel: NeuraCoUpdateChannel;
  autoCheck: boolean;
  autoDownload: boolean;
  checkIntervalHours: number;
  lastCheckedAt?: string;
}

export interface NeuraCoUpdateRollback {
  available: boolean;
  version?: string;
  signer?: string;
  verifiedAt?: string;
}

export interface NeuraCoUpdateState {
  phase:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'blocked'
    | 'error'
    | 'current';
  progress: number;
  message: string;
  manifest?: NeuraCoUpdateManifest;
  installerPath?: string;
  signature?: string;
}

export interface NeuraCoProject {
  id: string;
  name: string;
  rootPath: string;
}

export interface NeuraCoProjectFileNode {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  size?: number;
  children?: NeuraCoProjectFileNode[];
}

export interface NeuraCoProjectSnapshot {
  project: NeuraCoProject;
  files: NeuraCoProjectFileNode[];
  indexedFiles: number;
  excludedEntries: number;
  truncated: boolean;
}

export interface NeuraCoProjectFile {
  relativePath: string;
  content: string;
  language: string;
  size: number;
  modifiedAt: string;
}

export interface NeuraCoProjectFileSave {
  relativePath: string;
  size: number;
  savedAt: string;
}

export type NeuraCoPermissionMode =
  | 'plan'
  | 'manual'
  | 'accept_edits'
  | 'safe_auto'
  | 'deny_unapproved'
  | 'full';
export type NeuraCoPermissionAction =
  | 'read_file'
  | 'write_file'
  | 'terminal'
  | 'network'
  | 'application';
export type NeuraCoNetworkAccessMode =
  | 'none'
  | 'approved_domains'
  | 'ask_each'
  | 'temporary_full';

export interface NeuraCoProjectPermissions {
  projectId: string;
  projectRoot: string;
  configured: boolean;
  mode: NeuraCoPermissionMode;
  allowedActions: NeuraCoPermissionAction[];
  allowedFolders: string[];
  readOnlyFolders?: string[];
  writableFolders?: string[];
  forbiddenPaths?: string[];
  allowedCommandPrefixes: string[];
  allowedDomains: string[];
  networkAccessMode?: NeuraCoNetworkAccessMode;
  temporaryFullNetworkUntil?: string;
  allowedApplications: string[];
  alwaysAllowedSignatures: string[];
  updatedAt: string;
}

export interface NeuraCoProjectPermissionsUpdate {
  mode: NeuraCoPermissionMode;
  allowedActions: NeuraCoPermissionAction[];
  allowedFolders: string[];
  readOnlyFolders?: string[];
  writableFolders?: string[];
  forbiddenPaths?: string[];
  allowedCommandPrefixes: string[];
  allowedDomains: string[];
  networkAccessMode?: NeuraCoNetworkAccessMode;
  temporaryFullNetworkUntil?: string;
  allowedApplications: string[];
  alwaysAllowedSignatures: string[];
  fullAccessAcknowledged?: boolean;
  fullAccessPhrase?: string;
}

export interface NeuraCoCheckpoint {
  id: string;
  projectId: string;
  projectName: string;
  type: 'file' | 'project';
  trigger?: NeuraCoCheckpointTrigger;
  reason: string;
  createdAt: string;
  size: number;
  relativePath?: string;
  hasConversation?: boolean;
  hasTaskSettings?: boolean;
}

export type NeuraCoCheckpointTrigger =
  | 'manual'
  | 'important_change'
  | 'risky_command'
  | 'installation'
  | 'merge'
  | 'migration'
  | 'git_sensitive'
  | 'application_update';

export type NeuraCoCheckpointRestoreTarget =
  | 'files'
  | 'conversation'
  | 'task_settings'
  | 'all';

export interface NeuraCoCheckpointTaskSettings {
  taskMode: Exclude<NeuraCoTaskMode, 'mixed'>;
  effort: NeuraCoEffortLevel;
  communicationStyle: NeuraCoCommunicationStyle;
  executionMode: NeuraCoExecutionMode;
  includeActiveFile: boolean;
}

export interface NeuraCoCheckpointCreateRequest {
  reason: string;
  trigger?: NeuraCoCheckpointTrigger;
  threadId?: string;
  taskSettings?: NeuraCoCheckpointTaskSettings;
}

export interface NeuraCoCheckpointRestoreResult {
  checkpoint: NeuraCoCheckpoint;
  restored: NeuraCoCheckpointRestoreTarget[];
  conversation?: NeuraCoConversationThread;
  taskSettings?: NeuraCoCheckpointTaskSettings;
}

export interface NeuraCoCheckpointRetention {
  maxPerProject: number;
  minimum: number;
  maximum: number;
}

export interface NeuraCoTrashEntry {
  id: string;
  projectId: string;
  relativePath: string;
  kind: 'file' | 'directory';
  size: number;
  deletedAt: string;
}

export interface NeuraCoEmergencyState {
  stopped: boolean;
  stoppedAt?: string;
  terminalsStopped: number;
  agentsStopped: number;
}

export interface NeuraCoTerminalCommandRequest {
  command: string;
  timeoutMs?: number;
  terminalId?: string;
  profileId?: NeuraCoTerminalProfileId;
  target?: string;
}

export type NeuraCoTerminalProfileId =
  | 'powershell'
  | 'cmd'
  | 'git-bash'
  | 'wsl'
  | 'ssh'
  | 'docker';

export interface NeuraCoTerminalProfile {
  id: NeuraCoTerminalProfileId;
  label: string;
  available: boolean;
  detail: string;
  requiresTarget: boolean;
  targetPlaceholder?: string;
}

export type NeuraCoTerminalRiskLevel = 'safe' | 'moderate' | 'sensitive';

export interface NeuraCoTerminalCommandAssessment {
  level: NeuraCoTerminalRiskLevel;
  label: string;
  reason: string;
  requiresExplicitConfirmation: boolean;
}

export interface NeuraCoTerminalStartResult {
  accepted: boolean;
  commandId?: string;
}

export interface NeuraCoTerminalEvent {
  commandId: string;
  terminalId?: string;
  profileId?: NeuraCoTerminalProfileId;
  type: 'started' | 'stdout' | 'stderr' | 'completed' | 'cancelled' | 'error';
  command?: string;
  chunk?: string;
  exitCode?: number | null;
  durationMs?: number;
  message?: string;
}

export type NeuraCoBackgroundProcessState =
  | 'starting'
  | 'running'
  | 'detached'
  | 'stopping'
  | 'stopped'
  | 'exited'
  | 'failed'
  | 'orphaned';

export type NeuraCoBackgroundProcessAction =
  | 'attach'
  | 'detach'
  | 'keep'
  | 'stop'
  | 'force_stop'
  | 'restart';

export interface NeuraCoBackgroundProcessRequest {
  name: string;
  command: string;
  agent: string;
  workingDirectory?: string;
  port?: number;
  keepAlive?: boolean;
}

export interface NeuraCoBackgroundProcess {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  command: string;
  agent: string;
  workingDirectory: string;
  startedAt: string;
  updatedAt: string;
  durationMs: number;
  cpuPercent: number;
  memoryBytes: number;
  state: NeuraCoBackgroundProcessState;
  port?: number;
  lastOutput: string;
  attached: boolean;
  keepAlive: boolean;
  restartable: boolean;
  pid?: number;
  exitCode?: number | null;
}

export interface NeuraCoBackgroundProcessLog {
  processId: string;
  content: string;
  truncated: boolean;
  updatedAt: string;
}

export interface NeuraCoBackgroundProcessEvent {
  type: 'started' | 'updated' | 'exited' | 'recovered';
  process: NeuraCoBackgroundProcess;
}

export interface NeuraCoArtifactSource {
  label: string;
  kind: 'embedded' | 'project_file' | 'connector';
  reference?: string;
  access: 'read_only' | 'mutating';
  authorized: boolean;
}

export interface NeuraCoArtifactVersion {
  id: string;
  number: number;
  createdAt: string;
  summary: string;
  sourceConversationId?: string;
  size: number;
}

export interface NeuraCoArtifactSummary {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  currentVersionId: string;
  versionCount: number;
  sources: NeuraCoArtifactSource[];
}

export interface NeuraCoArtifact extends NeuraCoArtifactSummary {
  html: string;
  versions: NeuraCoArtifactVersion[];
}

export interface NeuraCoArtifactCreate {
  title: string;
  description: string;
  html: string;
  summary?: string;
  sourceConversationId?: string;
  sources?: NeuraCoArtifactSource[];
}

export interface NeuraCoArtifactUpdate {
  html: string;
  summary: string;
  sourceConversationId?: string;
  sources?: NeuraCoArtifactSource[];
}

export interface NeuraCoArtifactComparison {
  artifactId: string;
  fromVersionId: string;
  toVersionId: string;
  fromNumber: number;
  toNumber: number;
  addedLines: number;
  removedLines: number;
  diff: string;
  truncated: boolean;
}

export type NeuraCoNativeDocumentFormat =
  | 'docx'
  | 'pdf'
  | 'pptx'
  | 'xlsx'
  | 'csv'
  | 'markdown'
  | 'html'
  | 'json';

export interface NeuraCoNativeDocumentDraft {
  title: string;
  description?: string;
  format: NeuraCoNativeDocumentFormat;
  content: string;
  author?: string;
}

export interface NeuraCoNativeDocumentPreview {
  previewId: string;
  format: NeuraCoNativeDocumentFormat;
  extension: string;
  mimeType: string;
  previewHtml: string;
  itemCount: number;
  warnings: string[];
  validatedAt: string;
}

export interface NeuraCoNativeDocumentExport {
  path: string;
  format: NeuraCoNativeDocumentFormat;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export type NeuraCoControlledMemoryScope = 'project' | 'global';
export type NeuraCoControlledMemoryStatus = 'pending' | 'active' | 'disabled';
export type NeuraCoControlledMemoryCategory =
  | 'language'
  | 'technology'
  | 'validation'
  | 'architecture'
  | 'important_folder'
  | 'decision'
  | 'known_error'
  | 'framework'
  | 'naming'
  | 'test_command'
  | 'project_structure'
  | 'interface_style'
  | 'report_style'
  | 'instruction'
  | 'other';

export interface NeuraCoControlledMemory {
  id: string;
  projectId?: string;
  projectName?: string;
  scope: NeuraCoControlledMemoryScope;
  category: NeuraCoControlledMemoryCategory;
  content: string;
  status: NeuraCoControlledMemoryStatus;
  observationCount: number;
  sourceThreadId?: string;
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
}

export interface NeuraCoControlledMemoryState {
  enabled: boolean;
  entries: NeuraCoControlledMemory[];
  activeCount: number;
  pendingCount: number;
  projectInstructions?: NeuraCoProjectInstructions;
  sessionMemory?: {
    threadId: string;
    title: string;
    messageCount: number;
    updatedAt: string;
  };
}

export interface NeuraCoProjectInstructions {
  found: boolean;
  path: string;
  contentPreview?: string;
  size?: number;
  modifiedAt?: string;
  warnings: string[];
}

export interface NeuraCoControlledMemoryObservation {
  content: string;
  sourceThreadId?: string;
}

export interface NeuraCoControlledMemoryUpdate {
  content?: string;
  scope?: NeuraCoControlledMemoryScope;
  category?: NeuraCoControlledMemoryCategory;
  status?: Exclude<NeuraCoControlledMemoryStatus, 'pending'>;
}

export type NeuraCoExtensionKind = 'skill' | 'plugin';
export type NeuraCoExtensionOrigin =
  | 'official'
  | 'private'
  | 'enterprise'
  | 'local';
export type NeuraCoExtensionTrust =
  | 'verified'
  | 'integrity-only'
  | 'unsigned';

export interface NeuraCoExtensionPermissions {
  files: string[];
  network: string[];
  commands: string[];
  data: string[];
}

export interface NeuraCoExtensionTool {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  entrypoint?: string;
}

export interface NeuraCoInstalledExtension {
  id: string;
  name: string;
  version: string;
  description: string;
  kind: NeuraCoExtensionKind;
  origin: NeuraCoExtensionOrigin;
  provider: string;
  privacyPolicy: string;
  sourcePath: string;
  installPath: string;
  enabled: boolean;
  trust: NeuraCoExtensionTrust;
  integrity: string;
  signatureVerified: boolean;
  permissions: NeuraCoExtensionPermissions;
  tools: NeuraCoExtensionTool[];
  instructions?: string;
  scripts: string[];
  references: string[];
  examples: string[];
  tests: string[];
  installedAt: string;
  updatedAt: string;
  warnings: string[];
}

export type NeuraCoMcpTransport = 'stdio' | 'http';

export interface NeuraCoMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
}

export interface NeuraCoMcpServerInput {
  name: string;
  transport: NeuraCoMcpTransport;
  command?: string;
  args?: string[];
  url?: string;
  environmentVariables?: string[];
  headers?: Array<{ name: string; environmentVariable: string }>;
}

export interface NeuraCoMcpServer extends NeuraCoMcpServerInput {
  id: string;
  enabled: boolean;
  status: 'untested' | 'connected' | 'error' | 'disabled';
  tools: NeuraCoMcpTool[];
  lastTestedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NeuraCoExtensionsState {
  extensions: NeuraCoInstalledExtension[];
  mcpServers: NeuraCoMcpServer[];
  officialCount: number;
  enabledSkillCount: number;
  enabledPluginCount: number;
  enabledMcpToolCount: number;
}

export type NeuraCoHookEvent =
  | 'before_instruction'
  | 'before_tool'
  | 'after_tool'
  | 'before_command'
  | 'after_command'
  | 'before_modification'
  | 'after_modification'
  | 'before_merge'
  | 'task_completed'
  | 'on_error';

export type NeuraCoHookAction =
  | 'log'
  | 'block_pattern'
  | 'command'
  | 'approval'
  | 'notification';

export interface NeuraCoHookInput {
  id?: string;
  name: string;
  event: NeuraCoHookEvent;
  action: NeuraCoHookAction;
  pattern?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  failureMode?: 'block' | 'warn';
}

export interface NeuraCoHook extends NeuraCoHookInput {
  id: string;
  projectId?: string;
  enabled: boolean;
  security: boolean;
  immutable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NeuraCoHookRun {
  id: string;
  hookId: string;
  hookName: string;
  event: NeuraCoHookEvent;
  status: 'passed' | 'blocked' | 'failed' | 'approval_required';
  summary: string;
  output?: string;
  durationMs: number;
  createdAt: string;
}

export interface NeuraCoHooksState {
  hooks: NeuraCoHook[];
  recentRuns: NeuraCoHookRun[];
  securityHookCount: number;
  activeCustomHookCount: number;
}

export type NeuraCoRoutineTrigger =
  | 'time'
  | 'day'
  | 'app_open'
  | 'new_commit'
  | 'new_pull_request'
  | 'ci_failure'
  | 'new_issue'
  | 'file_change'
  | 'api'
  | 'manual';

export type NeuraCoRoutineAutonomy =
  | 'supervised'
  | 'balanced'
  | 'autonomous';

export type NeuraCoRoutineNotificationCondition =
  | 'on_start'
  | 'on_success'
  | 'on_failure'
  | 'on_approval';

export interface NeuraCoRoutineSchedule {
  trigger: NeuraCoRoutineTrigger;
  time?: string;
  weekdays?: number[];
  filePattern?: string;
}

export interface NeuraCoRoutineInput {
  id?: string;
  name: string;
  instruction: string;
  projectIds: string[];
  agentIds: string[];
  model: 'auto' | 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash';
  schedule: NeuraCoRoutineSchedule;
  tools: string[];
  budgetCredits: number;
  autonomy: NeuraCoRoutineAutonomy;
  notificationConditions: NeuraCoRoutineNotificationCondition[];
  executionMode: 'local' | 'cloud';
  cloudConsent: boolean;
}

export interface NeuraCoRoutine extends NeuraCoRoutineInput {
  id: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface NeuraCoRoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  trigger: NeuraCoRoutineTrigger;
  executionMode: 'local' | 'cloud';
  status: 'running' | 'completed' | 'failed' | 'skipped';
  summary: string;
  provider?: string;
  model?: string;
  creditsConsumed?: number;
  startedAt: string;
  completedAt?: string;
}

export interface NeuraCoRoutinesState {
  routines: NeuraCoRoutine[];
  recentRuns: NeuraCoRoutineRun[];
  schedulerActive: boolean;
  localOnlyNotice: string;
}

export interface NeuraCoAgentFileContext {
  path: string;
  content: string;
  language?: string;
}

export interface NeuraCoAgentRequest {
  content: string;
  sessionId?: string;
  requestId?: string;
  projectId: string;
  projectName: string;
  mode: 'question' | 'plan';
  model?: 'auto' | 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash';
  effort?: NeuraCoEffortLevel;
  communicationStyle?: NeuraCoCommunicationStyle;
  conversationContext?: NeuraCoPersistedChatMessage[];
  files: NeuraCoAgentFileContext[];
  images: NeuraCoAgentImageContext[];
}

export interface NeuraCoAgentImageContext {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  dataBase64: string;
  width: number;
  height: number;
  size: number;
}

export interface NeuraCoAgentResponse {
  message: string;
  sessionId: string;
  provider: string;
  model: string;
  modelDisplay: string;
  mode: 'question' | 'plan';
  filesUsed: string[];
  imagesUsed: Array<{
    id: string;
    name: string;
    mimeType: string;
    width: number;
    height: number;
    size: number;
  }>;
  entitlementPlan: string;
  usage?: {
    credits_consumed?: number;
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    provider_cost_usd?: number;
    source?: string;
    duration_ms?: number;
  };
  reservation?: {
    estimated_credits: number;
    reserved_included: number;
    reserved_purchased: number;
  };
}

export type NeuraCoExecutionMode = 'local' | 'cloud' | 'hybrid';

export interface NeuraCoPersistedChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  files?: string[];
}

export interface NeuraCoLocalSessionSave {
  threadId?: string;
  sessionId?: string;
  executionMode: NeuraCoExecutionMode;
  cloudTaskId?: string;
  taskSettings?: NeuraCoCheckpointTaskSettings;
  messages: NeuraCoPersistedChatMessage[];
}

export interface NeuraCoLocalSession extends NeuraCoLocalSessionSave {
  projectId: string;
  projectName: string;
  updatedAt: string;
}

export interface NeuraCoConversationThread extends NeuraCoLocalSession {
  threadId: string;
  title: string;
  archived: boolean;
  parentThreadId?: string;
  forkedFromMessageId?: string;
  checkpointId?: string;
  createdAt: string;
}

export interface NeuraCoConversationThreadSummary {
  threadId: string;
  title: string;
  archived: boolean;
  active: boolean;
  parentThreadId?: string;
  checkpointId?: string;
  messageCount: number;
  lastMessagePreview?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NeuraCoConversationThreadCreate {
  title?: string;
  fromThreadId?: string;
  fromMessageId?: string;
  checkpointId?: string;
}

export interface NeuraCoConversationThreadExport {
  canceled: boolean;
  filePath?: string;
}

export interface NeuraCoSecondaryConversation {
  id: string;
  projectId: string;
  parentThreadId: string;
  linkedTaskId?: string;
  title: string;
  archived: boolean;
  messages: NeuraCoPersistedChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface NeuraCoSecondaryConversationCreate {
  parentThreadId: string;
  linkedTaskId?: string;
  title?: string;
}

export interface NeuraCoSecondaryConversationMessageRequest {
  conversationId: string;
  content: string;
  projectId: string;
  projectName: string;
  model?: 'auto' | 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash';
  effort?: NeuraCoEffortLevel;
  communicationStyle?: NeuraCoCommunicationStyle;
}

export type NeuraCoEnvironmentKind =
  | 'local'
  | 'worktree'
  | 'docker'
  | 'wsl2'
  | 'ssh'
  | 'cloud';

export interface NeuraCoEnvironmentTarget {
  kind: NeuraCoEnvironmentKind;
  label?: string;
  projectPath?: string;
  worktreePath?: string;
  container?: string;
  distribution?: string;
  sshHost?: string;
  cloudWorkspaceId?: string;
}

export interface NeuraCoEnvironmentCapability {
  kind: NeuraCoEnvironmentKind;
  available: boolean;
  reason?: string;
  targets: Array<{
    id: string;
    label: string;
    detail?: string;
  }>;
}

export interface NeuraCoEnvironmentDiscovery {
  checkedAt: string;
  capabilities: NeuraCoEnvironmentCapability[];
}

export interface NeuraCoEnvironmentTransferPreview {
  target: NeuraCoEnvironmentTarget;
  compatible: boolean;
  checkedAt: string;
  unavailableFiles: string[];
  unavailableTools: string[];
  warnings: string[];
  preserved: {
    conversationMessages: number;
    goals: number;
    agents: number;
    permissions: number;
    tasks: number;
    changes: number;
    results: number;
  };
}

export interface NeuraCoEnvironmentTransferRecord {
  id: string;
  projectId: string;
  sourcePath: string;
  target: NeuraCoEnvironmentTarget;
  status: 'completed' | 'failed';
  compatible: boolean;
  manifestLocation: string;
  remoteLocation?: string;
  preserved: NeuraCoEnvironmentTransferPreview['preserved'];
  warnings: string[];
  createdAt: string;
}

export interface NeuraCoEnvironmentPreparationConfig {
  projectId: string;
  script: string;
  enabled: boolean;
  runOnWorktree: boolean;
  runOnTransfer: boolean;
  timeoutSeconds: number;
  firstRunAt?: string;
  lastRunAt?: string;
  lastStatus?: 'completed' | 'failed' | 'blocked';
  updatedAt: string;
}

export interface NeuraCoEnvironmentPreparationUpdate {
  script: string;
  enabled: boolean;
  runOnWorktree: boolean;
  runOnTransfer: boolean;
  timeoutSeconds: number;
}

export interface NeuraCoEnvironmentPreparationPreview {
  target: NeuraCoEnvironmentTarget;
  script: string;
  shell: string;
  firstExecution: boolean;
  compatible: boolean;
  blockedReasons: string[];
  warnings: string[];
  checkedAt: string;
}

export interface NeuraCoEnvironmentPreparationExecution {
  id: string;
  projectId: string;
  target: NeuraCoEnvironmentTarget;
  status: 'completed' | 'failed' | 'blocked';
  shell: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  createdAt: string;
}

export interface NeuraCoRemoteSshHost {
  id: string;
  alias: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFiles: string[];
}

export interface NeuraCoRemoteDockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export interface NeuraCoRemoteDiscovery {
  checkedAt: string;
  sshAvailable: boolean;
  sshHosts: NeuraCoRemoteSshHost[];
  wslAvailable: boolean;
  wslDistributions: string[];
  dockerAvailable: boolean;
  dockerContainers: NeuraCoRemoteDockerContainer[];
  activeTunnels: Array<{
    id: string;
    host: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
  }>;
}

export type NeuraCoRemoteAction =
  | 'connect'
  | 'list_files'
  | 'read_file'
  | 'run_command'
  | 'logs'
  | 'inspect'
  | 'start'
  | 'stop'
  | 'rebuild'
  | 'tunnel';

export interface NeuraCoRemoteActionRequest {
  kind: 'ssh' | 'wsl2' | 'docker';
  action: NeuraCoRemoteAction;
  target: string;
  identityFile?: string;
  path?: string;
  command?: string;
  localPort?: number;
  remoteHost?: string;
  remotePort?: number;
}

export interface NeuraCoRemoteActionResult {
  action: NeuraCoRemoteAction;
  target: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  connectionId?: string;
}

export type NeuraCoHostedSiteKind =
  | 'site'
  | 'dashboard'
  | 'internal_tool'
  | 'gallery'
  | 'web_app'
  | 'web_game'
  | 'revision_space';

export type NeuraCoHostedSiteVisibility = 'local' | 'public';

export interface NeuraCoHostedSiteRequest {
  name: string;
  kind: NeuraCoHostedSiteKind;
  sourceDirectory: string;
  visibility: NeuraCoHostedSiteVisibility;
  environmentVariables: string[];
  authorizedPeople: string[];
  hostingDurationDays?: number;
}

export interface NeuraCoHostedSiteFile {
  relativePath: string;
  size: number;
}

export interface NeuraCoHostedSitePreview {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  kind: NeuraCoHostedSiteKind;
  sourceDirectory: string;
  visibility: NeuraCoHostedSiteVisibility;
  files: NeuraCoHostedSiteFile[];
  totalBytes: number;
  plannedAddress: string;
  plannedAddressIsEstimate: boolean;
  environmentVariables: string[];
  estimatedCredits: number;
  hostingDurationDays?: number;
  hostingDurationLabel: string;
  authorizedPeople: string[];
  framework: string;
  provider: 'local' | 'vercel';
  createdAt: string;
  expiresAt: string;
}

export interface NeuraCoHostedSitePreviewSession {
  previewId: string;
  address: string;
  startedAt: string;
}

export interface NeuraCoHostedSiteDeployment {
  id: string;
  projectId: string;
  name: string;
  kind: NeuraCoHostedSiteKind;
  sourceDirectory: string;
  visibility: NeuraCoHostedSiteVisibility;
  provider: 'vercel';
  address: string;
  deployedAt: string;
  files: NeuraCoHostedSiteFile[];
  totalBytes: number;
  environmentVariables: string[];
  estimatedCredits: number;
  hostingDurationDays?: number;
  hostingDurationLabel: string;
  authorizedPeople: string[];
}

export interface NeuraCoHostedSiteProviderStatus {
  provider: 'vercel';
  available: boolean;
  version?: string;
  reason?: string;
}

export type NeuraCoImageStudioOperation =
  | 'generate'
  | 'edit'
  | 'mockup'
  | 'icon'
  | 'texture'
  | 'reference'
  | 'remove_background'
  | 'resize'
  | 'variants';

export interface NeuraCoImageStudioLocalOutput {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  dataBase64: string;
  width: number;
  height: number;
}

export interface NeuraCoImageStudioCreateRequest {
  requestId: string;
  operation: NeuraCoImageStudioOperation;
  prompt: string;
  variants: number;
  source?: NeuraCoAgentImageContext;
  localOutput?: NeuraCoImageStudioLocalOutput;
}

export interface NeuraCoImageStudioUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  creditsConsumed: number;
}

export interface NeuraCoImageStudioRights {
  status: 'not_reported' | 'source_inherited';
  message: string;
}

export interface NeuraCoImageStudioOutput {
  id: string;
  variant: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  filePath: string;
  size: number;
  width?: number;
  height?: number;
}

export interface NeuraCoImageStudioJob {
  id: string;
  requestId: string;
  projectId: string;
  operation: NeuraCoImageStudioOperation;
  prompt: string;
  sourceName?: string;
  outputs: NeuraCoImageStudioOutput[];
  provider: string;
  model: string;
  modelDisplay: string;
  usage: NeuraCoImageStudioUsage;
  rights: NeuraCoImageStudioRights;
  warnings: string[];
  originalPreserved: true;
  createdAt: string;
}

export interface NeuraCoImageStudioPreview {
  outputId: string;
  dataUrl: string;
}

export interface NeuraCoCloudTaskRequest {
  content: string;
  sessionId?: string;
  requestId?: string;
  projectId: string;
  projectName: string;
  mode: 'question' | 'plan';
  model?: 'auto' | 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash';
  effort?: NeuraCoEffortLevel;
  communicationStyle?: NeuraCoCommunicationStyle;
  conversationContext?: NeuraCoPersistedChatMessage[];
  files: NeuraCoAgentFileContext[];
}

export interface NeuraCoCloudTask {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  executionMode: 'cloud';
  localAccess: false;
  status:
    | 'queued'
    | 'running'
    | 'cancel_requested'
    | 'completed'
    | 'failed'
    | 'cancelled';
  result?: string;
  error?: string;
  provider?: string;
  model?: string;
  modelDisplay?: string;
  estimatedCredits?: number;
  usage?: NeuraCoAgentResponse['usage'];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
}

export interface NeuraCoRelayCommand {
  id: string;
  deviceId: string;
  action: 'instruction' | 'pause' | 'stop';
  payload: { instruction?: string };
  status: 'delivered' | 'accepted' | 'refused' | 'completed' | 'failed';
  createdAt: string;
  expiresAt: string;
}

export interface NeuraCoRelayState {
  enabled: boolean;
  connected: boolean;
  deviceId?: string;
  lastHeartbeatAt?: string;
  error?: string;
  pendingCommands: NeuraCoRelayCommand[];
  transport: 'outbound-https';
  publicPortOpen: false;
}

export interface NeuraCoRelayEvent {
  type: 'state' | 'command' | 'instruction';
  state: NeuraCoRelayState;
  command?: NeuraCoRelayCommand;
}

export type NeuraCoAgentAutonomy = 'ask' | 'scoped' | 'full';
export type NeuraCoAgentMemory = 'off' | 'session' | 'project';
export type NeuraCoEffortLevel = 'rapid' | 'normal' | 'deep' | 'maximum';
export type NeuraCoCommunicationStyle =
  | 'direct'
  | 'normal'
  | 'detailed'
  | 'pedagogical';

export type NeuraCoTaskMode =
  | 'automatic'
  | 'question'
  | 'plan'
  | 'code'
  | 'cowork'
  | 'research'
  | '3d'
  | 'fivem'
  | 'frontend'
  | 'audit'
  | 'mixed';

export type NeuraCoTaskCategory = Exclude<
  NeuraCoTaskMode,
  'automatic' | 'question' | 'plan' | 'mixed'
>;

export interface NeuraCoTaskRoutingRequest {
  projectId: string;
  content: string;
  requestedMode: Exclude<NeuraCoTaskMode, 'mixed'>;
  effort?: NeuraCoEffortLevel;
  communicationStyle?: NeuraCoCommunicationStyle;
  filePaths: string[];
  imageCount: number;
}

export interface NeuraCoTaskRoutingCategory {
  id: NeuraCoTaskCategory;
  label: string;
  confidence: number;
}

export interface NeuraCoTaskRoutingAgent {
  id: string;
  name: string;
  role: string;
}

export interface NeuraCoTaskRoutingPreview {
  mode: Exclude<NeuraCoTaskMode, 'automatic'>;
  modeLabel: string;
  reason: string;
  categories: NeuraCoTaskRoutingCategory[];
  agents: NeuraCoTaskRoutingAgent[];
  tools: string[];
  primaryModel: 'claude-sonnet-4-5' | 'gpt-4o' | 'gemini-2.5-flash';
  effort: NeuraCoEffortLevel;
  effortLabel: string;
  communicationStyle: NeuraCoCommunicationStyle;
  communicationStyleLabel: string;
  verificationPasses: number;
  maxOutputTokens: number;
  effortEffects: string[];
  complexity: 'simple' | 'standard' | 'complex';
  execution: 'chat' | 'multi_agent';
  suggestedBudget: number;
  estimatedMinimumCredits: number;
  estimatedMaximumCredits: number;
  estimateSource: 'server' | 'local';
  requiresConfirmation: true;
}

export interface NeuraCoAgentDefinition {
  id: string;
  name: string;
  role: string;
  instructions: string;
  model: string;
  tools: string[];
  allowedApplications: string[];
  allowedFolders: string[];
  budget: number;
  autonomy: NeuraCoAgentAutonomy;
  memory: NeuraCoAgentMemory;
  color: string;
  icon: string;
  builtIn: boolean;
}

export type NeuraCoCustomAgentInput = Omit<
  NeuraCoAgentDefinition,
  'builtIn'
>;

export interface NeuraCoMultiAgentRequest {
  taskId?: string;
  goalId?: string;
  objective: string;
  projectId: string;
  projectName: string;
  selectedAgentIds: string[];
  maxAgents: number;
  budget: number;
  effort?: NeuraCoEffortLevel;
  communicationStyle?: NeuraCoCommunicationStyle;
  files: NeuraCoAgentFileContext[];
}

export interface NeuraCoMultiAgentTask {
  id: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  objective: string;
  files: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  budget: number;
  status: 'queued' | 'waiting' | 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';
  message?: string;
  intermediateResult?: string;
  questions?: string[];
  blockers?: string[];
  testState?: 'not_requested' | 'pending' | 'passed' | 'failed' | 'blocked';
  provider?: string;
  model?: string;
  durationMs?: number;
  creditsConsumed?: number;
}

export type NeuraCoCoordinationKind =
  | 'information'
  | 'verification_request'
  | 'task_handoff'
  | 'conflict'
  | 'context_request'
  | 'response'
  | 'subtask_proposal'
  | 'decision'
  | 'result'
  | 'warning'
  | 'summary'
  | 'escalation';

export interface NeuraCoAgentCoordinationMessage {
  id: string;
  taskId: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  kind: NeuraCoCoordinationKind;
  subject: string;
  body: string;
  relatedTaskId?: string;
  inReplyTo?: string;
  createdAt: string;
}

export interface NeuraCoAgentFileReservation {
  path: string;
  taskId: string;
  agentId: string;
  agentName: string;
  reservedAt: string;
  releasedAt?: string;
}

export interface NeuraCoCoordinationLimits {
  maxMessages: number;
  maxMessagesPerPair: number;
  maxDurationMs: number;
  messagesUsed: number;
  escalations: number;
  limitReached: boolean;
}

export interface NeuraCoMultiAgentProgress {
  taskId: string;
  phase:
    | 'planning'
    | 'planned'
    | 'specialists'
    | 'reviewing'
    | 'completed'
    | 'failed'
    | 'cancelled';
  message: string;
  completed: number;
  total: number;
  task?: NeuraCoMultiAgentTask;
  coordinationMessages?: NeuraCoAgentCoordinationMessage[];
  fileReservations?: NeuraCoAgentFileReservation[];
  coordinationLimits?: NeuraCoCoordinationLimits;
}

export interface NeuraCoMultiAgentResult {
  taskId: string;
  summary: string;
  risks: string[];
  tasks: NeuraCoMultiAgentTask[];
  review: string;
  provider: string;
  model: string;
  durationMs: number;
  budgetUsed: number;
  creditsConsumed: number;
  entitlementPlan: string;
  coordinationMessages: NeuraCoAgentCoordinationMessage[];
  fileReservations: NeuraCoAgentFileReservation[];
  coordinationLimits: NeuraCoCoordinationLimits;
}

export type NeuraCoReviewStatus =
  | 'pending'
  | 'reviewing'
  | 'changes_requested'
  | 'approved'
  | 'refused'
  | 'merged'
  | 'archived';

export type NeuraCoReviewRisk = 'low' | 'medium' | 'high' | 'critical';
export type NeuraCoReviewFileDecision = 'pending' | 'accepted' | 'refused';
export type NeuraCoReviewChangeKind =
  | 'proposed'
  | 'modified'
  | 'created'
  | 'deleted'
  | 'renamed';

export interface NeuraCoReviewFile {
  path: string;
  changeKind: NeuraCoReviewChangeKind;
  decision: NeuraCoReviewFileDecision;
}

export interface NeuraCoReviewDiffLine {
  kind: 'context' | 'addition' | 'deletion';
  oldLine?: number;
  newLine?: number;
  content: string;
}

export interface NeuraCoReviewDiffHunk {
  id: string;
  filePath: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  addedLines: number;
  removedLines: number;
  decision: NeuraCoReviewFileDecision;
  lines: NeuraCoReviewDiffLine[];
}

export interface NeuraCoReviewDiffFile {
  path: string;
  oldPath: string;
  newPath: string;
  changeKind: Exclude<NeuraCoReviewChangeKind, 'proposed'>;
  addedLines: number;
  removedLines: number;
  hunks: NeuraCoReviewDiffHunk[];
}

export interface NeuraCoReviewTest {
  label: string;
  status: 'not_run' | 'passed' | 'failed' | 'blocked';
  output?: string;
  durationMs?: number;
}

export interface NeuraCoReviewComment {
  id: string;
  filePath: string;
  line: number;
  body: string;
  createdAt: string;
}

export interface NeuraCoReviewRerun {
  objective: string;
  selectedAgentIds: string[];
  maxAgents: number;
  budget: number;
  filePaths: string[];
}

export interface NeuraCoReviewItem {
  id: string;
  source: 'multi_agent' | 'git' | 'cloud' | 'routine';
  sourceId: string;
  projectId: string;
  projectName: string;
  task: string;
  agent: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  creditsUsed: number;
  files: NeuraCoReviewFile[];
  tests: NeuraCoReviewTest[];
  risk: NeuraCoReviewRisk;
  risks: string[];
  permissions: string[];
  status: NeuraCoReviewStatus;
  comments: NeuraCoReviewComment[];
  summary: string;
  result: string;
  branch?: string;
  diff?: NeuraCoGitDiff;
  diffFiles?: NeuraCoReviewDiffFile[];
  checkpointId?: string;
  rerun?: NeuraCoReviewRerun;
}

export interface NeuraCoReviewCommentInput {
  itemId: string;
  filePath: string;
  line: number;
  body: string;
}

export interface NeuraCoReviewFileDecisionInput {
  itemId: string;
  filePath: string;
  decision: NeuraCoReviewFileDecision;
}

export interface NeuraCoReviewHunkDecisionInput {
  itemId: string;
  filePath: string;
  hunkId: string;
  decision: NeuraCoReviewFileDecision;
}

export interface NeuraCoReviewAllDecisionInput {
  itemId: string;
  decision: Exclude<NeuraCoReviewFileDecision, 'pending'>;
}

export type NeuraCoRecoverableTaskKind = 'agent' | 'multi_agent' | 'cloud';
export type NeuraCoRecoverableTaskStatus =
  | 'running'
  | 'interrupted'
  | 'resuming'
  | 'completed'
  | 'abandoned';
export type NeuraCoTaskResumeStrategy = 'continue_with_changes' | 'restart_from_current';

export interface NeuraCoRecoverableTaskStep {
  id: string;
  title: string;
  status: 'queued' | 'waiting' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';
  agent?: string;
  files: string[];
  result?: string;
}

export interface NeuraCoRecoverableProjectState {
  fingerprint: string;
  branch?: string;
  head?: string;
  dirty: boolean;
  files: Array<{
    path: string;
    size: number;
  }>;
  capturedAt: string;
}

export interface NeuraCoRecoverableTask {
  id: string;
  projectId: string;
  projectName: string;
  kind: NeuraCoRecoverableTaskKind;
  objective: string;
  plan?: string;
  status: NeuraCoRecoverableTaskStatus;
  interruptionReason?: string;
  steps: NeuraCoRecoverableTaskStep[];
  agents: string[];
  worktrees: Array<{
    path: string;
    branch: string;
    head: string;
  }>;
  filesModified: string[];
  commands: string[];
  results: string[];
  budgetAllocated: number;
  budgetConsumed: number;
  permissionMode: NeuraCoPermissionMode;
  allowedActions: NeuraCoPermissionAction[];
  checkpointIds: string[];
  projectState: NeuraCoRecoverableProjectState;
  createdAt: string;
  updatedAt: string;
}

export interface NeuraCoRecoverableTaskDifference {
  kind: 'branch' | 'head' | 'file_added' | 'file_removed' | 'file_changed' | 'worktree';
  path?: string;
  before?: string;
  after?: string;
  message: string;
}

export interface NeuraCoRecoverableTaskInspection {
  task: NeuraCoRecoverableTask;
  compatible: boolean;
  currentProjectState: NeuraCoRecoverableProjectState;
  differences: NeuraCoRecoverableTaskDifference[];
}

export interface NeuraCoRecoverableTaskResume {
  task: NeuraCoRecoverableTask;
  strategy: NeuraCoTaskResumeStrategy;
  resumePrompt: string;
  differences: NeuraCoRecoverableTaskDifference[];
}

export type NeuraCoNotificationKind =
  | 'permission_request'
  | 'agent_blocked'
  | 'task_completed'
  | 'task_failed'
  | 'credits_low'
  | 'usage_limit_reached'
  | 'merge_ready'
  | 'git_conflict'
  | 'test_failed'
  | 'routine_result'
  | 'plugin_suspicious';
export type NeuraCoNotificationSeverity = 'info' | 'success' | 'warning' | 'critical';
export type NeuraCoNotificationAction =
  | 'open'
  | 'authorize'
  | 'refuse'
  | 'pause'
  | 'stop';
export type NeuraCoNotificationTarget =
  | 'chat'
  | 'team'
  | 'review'
  | 'git'
  | 'environments'
  | 'usage'
  | 'protection';

export interface NeuraCoNotification {
  id: string;
  projectId: string;
  projectName: string;
  kind: NeuraCoNotificationKind;
  severity: NeuraCoNotificationSeverity;
  title: string;
  body: string;
  taskId?: string;
  target: NeuraCoNotificationTarget;
  actions: NeuraCoNotificationAction[];
  sensitive: boolean;
  dedupeKey?: string;
  createdAt: string;
  readAt?: string;
  archivedAt?: string;
}

export interface NeuraCoNotificationActionEvent {
  notification: NeuraCoNotification;
  action: NeuraCoNotificationAction;
  requiresValidation: boolean;
  handled: boolean;
  message?: string;
}

export type NeuraCoNotificationEvent =
  | {
      type: 'created' | 'updated';
      notification: NeuraCoNotification;
    }
  | {
      type: 'action';
      action: NeuraCoNotificationActionEvent;
    };

export type NeuraCoGoalPriority = 'low' | 'medium' | 'high' | 'critical';
export type NeuraCoGoalStatus = 'active' | 'paused' | 'completed' | 'archived';
export type NeuraCoGoalStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'blocked';

export interface NeuraCoGoalStep {
  id: string;
  title: string;
  description?: string;
  status: NeuraCoGoalStepStatus;
  order: number;
  createdAt: string;
  completedAt?: string;
}

export interface NeuraCoGoalCriterion {
  id: string;
  label: string;
  satisfied: boolean;
  verifiedAt?: string;
}

export interface NeuraCoGoalStepProposal {
  id: string;
  title: string;
  description?: string;
  proposedBy: string;
  sourceTaskId?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

export interface NeuraCoGoal {
  id: string;
  title: string;
  expectedResult: string;
  description: string;
  steps: NeuraCoGoalStep[];
  successCriteria: NeuraCoGoalCriterion[];
  priority: NeuraCoGoalPriority;
  budget: number;
  projectIds: string[];
  agentIds: string[];
  targetDate?: string;
  status: NeuraCoGoalStatus;
  progress: number;
  proposals: NeuraCoGoalStepProposal[];
  createdAt: string;
  updatedAt: string;
}

export interface NeuraCoGoalCreate {
  title: string;
  expectedResult: string;
  description: string;
  steps: string[];
  successCriteria: string[];
  priority: NeuraCoGoalPriority;
  budget: number;
  projectIds: string[];
  agentIds: string[];
  targetDate?: string;
}

export interface NeuraCoGoalUpdate {
  title?: string;
  expectedResult?: string;
  description?: string;
  priority?: NeuraCoGoalPriority;
  budget?: number;
  projectIds?: string[];
  agentIds?: string[];
  targetDate?: string | null;
  status?: NeuraCoGoalStatus;
  criterionId?: string;
  criterionSatisfied?: boolean;
}

export interface NeuraCoGitWorktree {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  dirty: boolean;
}

export interface NeuraCoGitStatus {
  installed: boolean;
  repository: boolean;
  root: string;
  branch: string;
  head: string;
  dirty: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
  branches: string[];
  worktrees: NeuraCoGitWorktree[];
  lastCommit?: {
    hash: string;
    subject: string;
    author: string;
    date: string;
  };
  error?: string;
}

export interface NeuraCoGitDiff {
  branch: string;
  baseBranch: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  stat: string;
  patch: string;
  truncated: boolean;
}

export interface NeuraCoGitWorktreeCreate {
  taskId: string;
  agentId: string;
  baseBranch?: string;
}

export interface NeuraCoGitCommitResult {
  branch: string;
  commit: string;
  message: string;
  filesChanged: number;
}

export interface NeuraCoGitTestCommand {
  id: string;
  label: string;
  cwd: string;
  command: string;
}

export interface NeuraCoGitTestResult {
  id: string;
  branch: string;
  command: string;
  passed: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
  completedAt: string;
}

export interface NeuraCoGitReview {
  branch: string;
  approved: boolean;
  message: string;
  provider: string;
  model: string;
  creditsConsumed: number;
  diff: NeuraCoGitDiff;
  reviewedAt: string;
}

export interface NeuraCoGitMergeResult {
  branch: string;
  targetBranch: string;
  commit: string;
  mergedAt: string;
  tests: NeuraCoGitTestResult[];
  review: NeuraCoGitReview;
}

export type NeuraCoForgeProvider = 'github' | 'gitlab';

export type NeuraCoForgeInboxKind =
  | 'issue'
  | 'pull_request'
  | 'comment'
  | 'ci'
  | 'security'
  | 'dependency';

export interface NeuraCoForgeConnection {
  configured: boolean;
  authenticated: boolean;
  provider?: NeuraCoForgeProvider;
  repository?: string;
  remoteUrl?: string;
  cli?: 'gh' | 'glab';
  account?: string;
  message: string;
}

export interface NeuraCoForgeInboxItem {
  id: string;
  kind: NeuraCoForgeInboxKind;
  number?: number;
  title: string;
  summary: string;
  state: string;
  url?: string;
  author?: string;
  branch?: string;
  updatedAt?: string;
  requiresReview: boolean;
}

export interface NeuraCoForgeInbox {
  connection: NeuraCoForgeConnection;
  items: NeuraCoForgeInboxItem[];
  warnings: string[];
  fetchedAt: string;
}

export interface NeuraCoForgeIssue {
  provider: NeuraCoForgeProvider;
  repository: string;
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  author?: string;
  labels: string[];
  comments: Array<{
    id: string;
    author?: string;
    body: string;
    createdAt?: string;
  }>;
}

export interface NeuraCoForgePullRequestCreate {
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface NeuraCoForgePullRequestResult {
  provider: NeuraCoForgeProvider;
  repository: string;
  number?: number;
  title: string;
  url: string;
  branch: string;
  baseBranch: string;
  draft: boolean;
  createdAt: string;
}

export interface NeuraCoBrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  secure: boolean;
  error?: string;
}

export interface NeuraCoBrowserState {
  tabs: NeuraCoBrowserTab[];
  activeTabId?: string;
  controlling: boolean;
  profile: 'isolated';
}

export interface NeuraCoBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NeuraCoBrowserCapture {
  id: string;
  tabId: string;
  url: string;
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: string;
}

export interface NeuraCoBrowserElement {
  selector: string;
  tag: string;
  text: string;
  role: string;
  type: string;
  rect: { x: number; y: number; width: number; height: number };
  url: string;
}

export interface NeuraCoBrowserAction {
  type: 'click' | 'type' | 'focus' | 'scroll';
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
}

export interface NeuraCoBrowserActionResult {
  ok: boolean;
  action: NeuraCoBrowserAction['type'];
  selector?: string;
  url: string;
  description: string;
  completedAt: string;
}

export interface NeuraCoBrowserDiagnosticIssue {
  source: 'console' | 'network' | 'dom' | 'visual';
  severity: 'error' | 'warning' | 'info';
  message: string;
  selector?: string;
  url?: string;
  observedAt?: string;
}

export interface NeuraCoBrowserDiagnostics {
  tabId: string;
  url: string;
  inspectedAt: string;
  metrics: {
    viewportWidth: number;
    viewportHeight: number;
    documentWidth: number;
    documentHeight: number;
    resourceCount: number;
    domContentLoadedMs?: number;
    loadMs?: number;
  };
  issues: NeuraCoBrowserDiagnosticIssue[];
}

export interface NeuraCoBrowserEvent {
  type: 'state' | 'console' | 'network' | 'action' | 'blocked' | 'download';
  tabId?: string;
  message: string;
  url?: string;
  level?: string;
  download?: NeuraCoBrowserDownload;
  timestamp: string;
}

export interface NeuraCoBrowserHistoryEntry {
  id: string;
  title: string;
  url: string;
  visitedAt: string;
}

export interface NeuraCoBrowserDownload {
  id: string;
  filename: string;
  url: string;
  state: 'requested' | 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  receivedBytes: number;
  totalBytes: number;
  savePath?: string;
  startedAt: string;
  completedAt?: string;
}

export interface NeuraCoBrowserAnnotationInput {
  tabId: string;
  url: string;
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
  comment: string;
}

export interface NeuraCoBrowserAnnotation extends NeuraCoBrowserAnnotationInput {
  id: string;
  createdAt: string;
}

export interface NeuraCoApplication {
  id: string;
  name: string;
  executable: string;
  installed: boolean;
  capabilities: string[];
}

export interface NeuraCoApplicationProcess {
  id: string;
  applicationId: string;
  name: string;
  pid: number;
  startedAt: string;
  target?: string;
}

export interface NeuraCoComputerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NeuraCoComputerWindow {
  id: string;
  applicationId: string;
  processId: number;
  processName: string;
  title: string;
  handle: string;
  bounds: NeuraCoComputerBounds;
}

export interface NeuraCoComputerElement {
  id: string;
  runtimeId: string;
  name: string;
  automationId: string;
  controlType: string;
  enabled: boolean;
  offscreen: boolean;
  password: boolean;
  actionable: boolean;
  bounds: NeuraCoComputerBounds;
}

export interface NeuraCoComputerInspection {
  window: NeuraCoComputerWindow;
  elements: NeuraCoComputerElement[];
  inspectedAt: string;
}

export interface NeuraCoComputerCapture {
  id: string;
  windowId: string;
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: string;
}

export type NeuraCoComputerActionType = 'focus' | 'click' | 'type';

export interface NeuraCoComputerActionRequest {
  windowId: string;
  elementRuntimeId: string;
  action: NeuraCoComputerActionType;
  text?: string;
}

export interface NeuraCoComputerActionPlan {
  id: string;
  status: 'pending' | 'completed' | 'expired' | 'cancelled';
  window: NeuraCoComputerWindow;
  element: NeuraCoComputerElement;
  action: NeuraCoComputerActionType;
  pointer: { x: number; y: number };
  textPreview?: string;
  confirmationRequired: true;
  risk: 'moderate';
  explanation: string;
  createdAt: string;
  expiresAt: string;
}

export interface NeuraCoComputerActionResult {
  planId: string;
  status: 'completed';
  action: NeuraCoComputerActionType;
  windowId: string;
  completedAt: string;
}

export type NeuraCoStudioToolId = 'fivem' | 'blender' | '3dsmax';

export interface NeuraCoStudioTool {
  id: NeuraCoStudioToolId;
  name: string;
  installed: boolean;
  executable: string;
  version: string;
  integration: string;
  capabilities: string[];
}

export interface NeuraCoFiveMManifest {
  path: string;
  fxVersion?: string;
  games: string[];
  scripts: string[];
  dependencies: string[];
  missingFiles: string[];
  warnings: string[];
}

export interface NeuraCoStudioIssue {
  severity: 'info' | 'warning' | 'error';
  tool: NeuraCoStudioToolId;
  path?: string;
  message: string;
}

export interface NeuraCoStudioAnalysis {
  projectId: string;
  scannedAt: string;
  durationMs: number;
  scannedFiles: number;
  truncated: boolean;
  tools: NeuraCoStudioTool[];
  fiveM: {
    detected: boolean;
    manifests: NeuraCoFiveMManifest[];
    luaFiles: string[];
  };
  blender: {
    detected: boolean;
    files: string[];
  };
  max3d: {
    detected: boolean;
    files: string[];
  };
  issues: NeuraCoStudioIssue[];
}

export type NeuraCoStudioOperation =
  | 'fivem_validate'
  | 'blender_inspect'
  | 'blender_validate'
  | 'blender_export_gltf'
  | 'max_inspect'
  | 'max_validate'
  | 'max_export_fbx';

export interface NeuraCoStudioOperationRequest {
  taskId?: string;
  operation: NeuraCoStudioOperation;
  targetPath?: string;
  outputPath?: string;
}

export interface NeuraCoStudioOperationResult {
  taskId: string;
  operation: NeuraCoStudioOperation;
  tool: NeuraCoStudioToolId;
  ok: boolean;
  summary: string;
  targetPath?: string;
  outputPath?: string;
  reportPath?: string;
  output: string;
  durationMs: number;
  completedAt: string;
}

export interface NeuraCoStudioEvent {
  taskId: string;
  type: 'started' | 'output' | 'completed' | 'failed' | 'cancelled';
  tool: NeuraCoStudioToolId;
  message: string;
  timestamp: string;
}
