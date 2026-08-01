import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type NeuraCoAccessibilitySettingsUpdate,
  type NeuraCoAccountDeletionRequest,
  type NeuraCoAdminConfigUpdate,
  type NeuraCoAdminCreditAdjustment,
  type NeuraCoAdminIncidentCreate,
  type NeuraCoAdminIncidentUpdate,
  type NeuraCoAdminPromotionCreate,
  type NeuraCoAdminRefundRecord,
  type NeuraCoAppLockSettingsUpdate,
  type NeuraCoAppLockState,
  type NeuraCoLoginCredentials,
  type NeuraCoRegistration,
  type NeuraCoDesktopApi,
  type NeuraCoAgentRequest,
  type NeuraCoArtifactCreate,
  type NeuraCoArtifactUpdate,
  type NeuraCoBrowserAction,
  type NeuraCoBackgroundProcessAction,
  type NeuraCoBackgroundProcessEvent,
  type NeuraCoBackgroundProcessRequest,
  type NeuraCoBrowserAnnotationInput,
  type NeuraCoBrowserBounds,
  type NeuraCoBrowserEvent,
  type NeuraCoCloudTaskRequest,
  type NeuraCoCheckpointCreateRequest,
  type NeuraCoCheckpointRestoreTarget,
  type NeuraCoConversationThreadCreate,
  type NeuraCoSecondaryConversationCreate,
  type NeuraCoSecondaryConversationMessageRequest,
  type NeuraCoControlledMemoryObservation,
  type NeuraCoControlledMemoryUpdate,
  type NeuraCoComputerActionRequest,
  type NeuraCoCustomAgentInput,
  type NeuraCoEmergencyState,
  type NeuraCoEnvironmentPreparationUpdate,
  type NeuraCoEnvironmentTarget,
  type NeuraCoForgePullRequestCreate,
  type NeuraCoGitTestResult,
  type NeuraCoGitWorktreeCreate,
  type NeuraCoGoalCreate,
  type NeuraCoGoalStepStatus,
  type NeuraCoGoalUpdate,
  type NeuraCoHostedSiteRequest,
  type NeuraCoHookInput,
  type NeuraCoImageStudioCreateRequest,
  type NeuraCoLocalSessionSave,
  type NeuraCoMcpServerInput,
  type NeuraCoMultiAgentProgress,
  type NeuraCoMultiAgentRequest,
  type NeuraCoNativeDocumentDraft,
  type NeuraCoNotificationAction,
  type NeuraCoNotificationEvent,
  type NeuraCoProjectPermissionsUpdate,
  type NeuraCoPrivacySettings,
  type NeuraCoRelayEvent,
  type NeuraCoRemoteActionRequest,
  type NeuraCoReviewCommentInput,
  type NeuraCoReviewAllDecisionInput,
  type NeuraCoReviewFileDecisionInput,
  type NeuraCoReviewHunkDecisionInput,
  type NeuraCoReviewStatus,
  type NeuraCoRoutineInput,
  type NeuraCoRoutineTrigger,
  type NeuraCoSession,
  type NeuraCoStudioEvent,
  type NeuraCoStudioOperationRequest,
  type NeuraCoTaskRoutingRequest,
  type NeuraCoTaskResumeStrategy,
  type NeuraCoTerminalCommandRequest,
  type NeuraCoTerminalEvent,
  type NeuraCoUpdateState,
  type NeuraCoUpdatePreferences,
  type NeuraCoUsageEstimateRequest,
  type NeuraCoUsageSettingsUpdate,
  type NeuraCoUsageSummary
} from './ipc-contract';

const desktopApi: NeuraCoDesktopApi = Object.freeze({
  getConnectivityState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.connectivityGet),
  getRuntimePolicy: () => ipcRenderer.invoke(IPC_CHANNELS.runtimePolicyGet),
  getAccessibilitySettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.accessibilityGet),
  updateAccessibilitySettings: (update: NeuraCoAccessibilitySettingsUpdate) =>
    ipcRenderer.invoke(IPC_CHANNELS.accessibilityUpdate, update),
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  runSelfCheck: () => ipcRenderer.invoke(IPC_CHANNELS.runSelfCheck),
  restoreSession: () => ipcRenderer.invoke(IPC_CHANNELS.authRestore),
  login: (credentials: NeuraCoLoginCredentials) =>
    ipcRenderer.invoke(IPC_CHANNELS.authLogin, credentials),
  register: (registration: NeuraCoRegistration) =>
    ipcRenderer.invoke(IPC_CHANNELS.authRegister, registration),
  loginWithGoogle: () => ipcRenderer.invoke(IPC_CHANNELS.authGoogle),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.authLogout),
  getAccount: () => ipcRenderer.invoke(IPC_CHANNELS.accountGet),
  revokeAccountSession: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.accountSessionRevoke, sessionId),
  revokeOtherAccountSessions: () =>
    ipcRenderer.invoke(IPC_CHANNELS.accountSessionsRevokeOthers),
  requestEmailVerification: () =>
    ipcRenderer.invoke(IPC_CHANNELS.accountVerificationRequest),
  confirmEmailVerification: (token: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.accountVerificationConfirm, token),
  requestPasswordReset: (email: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.accountPasswordResetRequest, email),
  confirmPasswordReset: (email: string, token: string, newPassword: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.accountPasswordResetConfirm,
      email,
      token,
      newPassword
    ),
  setupTwoFactor: () =>
    ipcRenderer.invoke(IPC_CHANNELS.accountTwoFactorSetup),
  enableTwoFactor: (code: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.accountTwoFactorEnable, code),
  disableTwoFactor: (code: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.accountTwoFactorDisable, code),
  updatePrivacySettings: (settings: NeuraCoPrivacySettings) =>
    ipcRenderer.invoke(IPC_CHANNELS.accountPrivacyUpdate, settings),
  deleteAccount: (request: NeuraCoAccountDeletionRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.accountDelete, request),
  listTechnicalErrors: () =>
    ipcRenderer.invoke(IPC_CHANNELS.technicalErrorsList),
  clearTechnicalErrors: () =>
    ipcRenderer.invoke(IPC_CHANNELS.technicalErrorsClear),
  onSessionEvent: (listener: (session: NeuraCoSession) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      session: NeuraCoSession
    ) => listener(session);
    ipcRenderer.on(IPC_CHANNELS.authSessionEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.authSessionEvent, handler);
  },
  getAppLockState: () => ipcRenderer.invoke(IPC_CHANNELS.appLockGet),
  setAppLockPin: (pin: string, currentPin?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.appLockSetPin, pin, currentPin),
  removeAppLockPin: (currentPin: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.appLockRemovePin, currentPin),
  updateAppLockSettings: (update: NeuraCoAppLockSettingsUpdate) =>
    ipcRenderer.invoke(IPC_CHANNELS.appLockSettings, update),
  lockApp: () => ipcRenderer.invoke(IPC_CHANNELS.appLockLock),
  unlockAppWithPin: (pin: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.appLockUnlockPin, pin),
  setWindowsHelloEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.appLockWindowsHelloEnable, enabled),
  unlockAppWithWindowsHello: () =>
    ipcRenderer.invoke(IPC_CHANNELS.appLockWindowsHelloUnlock),
  onAppLockEvent: (listener: (state: NeuraCoAppLockState) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: NeuraCoAppLockState
    ) => listener(state);
    ipcRenderer.on(IPC_CHANNELS.appLockEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.appLockEvent, handler);
  },
  listConnectedDevices: () =>
    ipcRenderer.invoke(IPC_CHANNELS.securityDevicesList),
  revokeConnectedDevice: (deviceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.securityDeviceRevoke, deviceId),
  openProject: () => ipcRenderer.invoke(IPC_CHANNELS.projectOpen),
  refreshProject: () => ipcRenderer.invoke(IPC_CHANNELS.projectRefresh),
  readProjectFile: (relativePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectReadFile, relativePath),
  saveProjectFile: (relativePath: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectSaveFile, relativePath, content),
  startTerminalCommand: (request: NeuraCoTerminalCommandRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalStart, request),
  cancelTerminalCommand: (commandId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalCancel, commandId),
  listTerminalProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.terminalProfiles),
  assessTerminalCommand: (command: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalAssess, command),
  onTerminalEvent: (listener: (event: NeuraCoTerminalEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, terminalEvent: Parameters<typeof listener>[0]) => {
      listener(terminalEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.terminalEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalEvent, handler);
  },
  listBackgroundProcesses: () =>
    ipcRenderer.invoke(IPC_CHANNELS.backgroundProcessesList),
  startBackgroundProcess: (request: NeuraCoBackgroundProcessRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.backgroundProcessStart, request),
  controlBackgroundProcess: (
    processId: string,
    action: NeuraCoBackgroundProcessAction
  ) => ipcRenderer.invoke(
    IPC_CHANNELS.backgroundProcessControl,
    processId,
    action
  ),
  getBackgroundProcessLog: (processId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.backgroundProcessLog, processId),
  onBackgroundProcessEvent: (
    listener: (event: NeuraCoBackgroundProcessEvent) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      processEvent: NeuraCoBackgroundProcessEvent
    ) => listener(processEvent);
    ipcRenderer.on(IPC_CHANNELS.backgroundProcessEvent, handler);
    return () => ipcRenderer.removeListener(
      IPC_CHANNELS.backgroundProcessEvent,
      handler
    );
  },
  listArtifacts: (includeDeleted?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.artifactsList, includeDeleted),
  getArtifact: (artifactId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.artifactGet, artifactId),
  createArtifact: (input: NeuraCoArtifactCreate) =>
    ipcRenderer.invoke(IPC_CHANNELS.artifactCreate, input),
  updateArtifact: (artifactId: string, input: NeuraCoArtifactUpdate) =>
    ipcRenderer.invoke(IPC_CHANNELS.artifactUpdate, artifactId, input),
  renameArtifact: (artifactId: string, title: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.artifactRename, artifactId, title),
  deleteArtifact: (artifactId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.artifactDelete, artifactId),
  restoreArtifactVersion: (artifactId: string, versionId: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.artifactRestoreVersion,
      artifactId,
      versionId
    ),
  compareArtifactVersions: (
    artifactId: string,
    fromVersionId: string,
    toVersionId: string
  ) => ipcRenderer.invoke(
    IPC_CHANNELS.artifactCompare,
    artifactId,
    fromVersionId,
    toVersionId
  ),
  exportArtifact: (artifactId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.artifactExport, artifactId),
  previewNativeDocument: (draft: NeuraCoNativeDocumentDraft) =>
    ipcRenderer.invoke(IPC_CHANNELS.nativeDocumentPreview, draft),
  exportNativeDocument: (draft: NeuraCoNativeDocumentDraft, previewId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.nativeDocumentExport, draft, previewId),
  listControlledMemories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.controlledMemoryList),
  observeControlledMemory: (input: NeuraCoControlledMemoryObservation) =>
    ipcRenderer.invoke(IPC_CHANNELS.controlledMemoryObserve, input),
  updateControlledMemory: (
    memoryId: string,
    input: NeuraCoControlledMemoryUpdate
  ) => ipcRenderer.invoke(
    IPC_CHANNELS.controlledMemoryUpdate,
    memoryId,
    input
  ),
  deleteControlledMemory: (memoryId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.controlledMemoryDelete, memoryId),
  setControlledMemoryEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.controlledMemorySetEnabled, enabled),
  exportControlledMemories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.controlledMemoryExport),
  getExtensionsState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.extensionsState),
  installLocalExtension: () =>
    ipcRenderer.invoke(IPC_CHANNELS.extensionInstallLocal),
  updateExtension: (extensionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.extensionUpdate, extensionId),
  setExtensionEnabled: (extensionId: string, enabled: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.extensionSetEnabled,
      extensionId,
      enabled
    ),
  setExtensionToolEnabled: (
    extensionId: string,
    toolId: string,
    enabled: boolean
  ) => ipcRenderer.invoke(
    IPC_CHANNELS.extensionToolSetEnabled,
    extensionId,
    toolId,
    enabled
  ),
  removeExtension: (extensionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.extensionRemove, extensionId),
  addMcpServer: (input: NeuraCoMcpServerInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.mcpServerAdd, input),
  testMcpServer: (serverId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.mcpServerTest, serverId),
  setMcpServerEnabled: (serverId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.mcpServerSetEnabled, serverId, enabled),
  setMcpToolEnabled: (
    serverId: string,
    toolName: string,
    enabled: boolean
  ) => ipcRenderer.invoke(
    IPC_CHANNELS.mcpToolSetEnabled,
    serverId,
    toolName,
    enabled
  ),
  removeMcpServer: (serverId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.mcpServerRemove, serverId),
  getHooksState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.hooksState),
  saveHook: (input: NeuraCoHookInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.hookSave, input),
  setHookEnabled: (hookId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.hookSetEnabled, hookId, enabled),
  deleteHook: (hookId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.hookDelete, hookId),
  testHook: (hookId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.hookTest, hookId),
  getRoutinesState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.routinesState),
  saveRoutine: (input: NeuraCoRoutineInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.routineSave, input),
  setRoutineEnabled: (routineId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.routineSetEnabled, routineId, enabled),
  deleteRoutine: (routineId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.routineDelete, routineId),
  runRoutine: (routineId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.routineRun, routineId),
  triggerRoutines: (
    trigger: NeuraCoRoutineTrigger,
    metadata?: Record<string, unknown>
  ) => ipcRenderer.invoke(IPC_CHANNELS.routineTrigger, trigger, metadata),
  sendAgentMessage: (request: NeuraCoAgentRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentChat, request),
  cancelAgentMessage: (requestId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentCancel, requestId),
  getLocalSession: () =>
    ipcRenderer.invoke(IPC_CHANNELS.localSessionGet),
  saveLocalSession: (session: NeuraCoLocalSessionSave) =>
    ipcRenderer.invoke(IPC_CHANNELS.localSessionSave, session),
  clearLocalSession: () =>
    ipcRenderer.invoke(IPC_CHANNELS.localSessionClear),
  listConversationThreads: (includeArchived?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationThreadsList, includeArchived),
  createConversationThread: (request?: NeuraCoConversationThreadCreate) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationThreadCreate, request),
  selectConversationThread: (threadId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationThreadSelect, threadId),
  renameConversationThread: (threadId: string, title: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationThreadRename, threadId, title),
  archiveConversationThread: (threadId: string, archived: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationThreadArchive, threadId, archived),
  exportConversationThread: (threadId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationThreadExport, threadId),
  clearConversationThreadMemory: (threadId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationThreadClearMemory, threadId),
  forkConversationThread: (threadId: string, fromMessageId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationThreadFork, threadId, fromMessageId),
  rewindConversationThread: (threadId: string, messageId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationThreadRewind, threadId, messageId),
  attachConversationCheckpoint: (threadId: string, checkpointId?: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.conversationThreadCheckpoint,
      threadId,
      checkpointId
    ),
  listSecondaryConversations: (parentThreadId?: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.secondaryConversationsList,
      parentThreadId
    ),
  createSecondaryConversation: (input: NeuraCoSecondaryConversationCreate) =>
    ipcRenderer.invoke(IPC_CHANNELS.secondaryConversationCreate, input),
  sendSecondaryConversationMessage: (
    request: NeuraCoSecondaryConversationMessageRequest
  ) => ipcRenderer.invoke(IPC_CHANNELS.secondaryConversationChat, request),
  archiveSecondaryConversation: (conversationId: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.secondaryConversationArchive,
      conversationId
    ),
  discoverEnvironments: () =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentsDiscover),
  previewEnvironmentTransfer: (target: NeuraCoEnvironmentTarget) =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentTransferPreview, target),
  executeEnvironmentTransfer: (target: NeuraCoEnvironmentTarget) =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentTransferExecute, target),
  listEnvironmentTransfers: () =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentTransfersList),
  getEnvironmentPreparation: () =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentPreparationGet),
  updateEnvironmentPreparation: (update: NeuraCoEnvironmentPreparationUpdate) =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentPreparationUpdate, update),
  previewEnvironmentPreparation: (target: NeuraCoEnvironmentTarget) =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentPreparationPreview, target),
  runEnvironmentPreparation: (target: NeuraCoEnvironmentTarget) =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentPreparationRun, target),
  listEnvironmentPreparationHistory: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentPreparationHistory, limit),
  discoverRemoteConnections: () =>
    ipcRenderer.invoke(IPC_CHANNELS.remoteConnectionsDiscover),
  chooseRemoteSshKey: () =>
    ipcRenderer.invoke(IPC_CHANNELS.remoteConnectionChooseKey),
  runRemoteConnectionAction: (request: NeuraCoRemoteActionRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.remoteConnectionAction, request),
  disconnectRemoteConnection: (connectionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.remoteConnectionDisconnect, connectionId),
  listHostedSiteDeployments: () =>
    ipcRenderer.invoke(IPC_CHANNELS.hostedSitesList),
  previewHostedSite: (request: NeuraCoHostedSiteRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.hostedSitePreview, request),
  startHostedSitePreview: (previewId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.hostedSiteStartPreview, previewId),
  stopHostedSitePreview: (previewId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.hostedSiteStopPreview, previewId),
  deployHostedSite: (previewId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.hostedSiteDeploy, previewId),
  getHostedSiteProviderStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.hostedSiteProviderStatus),
  createImageStudioJob: (request: NeuraCoImageStudioCreateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioCreate, request),
  listImageStudioJobs: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioList, limit),
  getImageStudioPreview: (outputId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioPreview, outputId),
  exportImageStudioOutput: (outputId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioExport, outputId),
  listCloudTasks: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudTasksList, limit),
  createCloudTask: (request: NeuraCoCloudTaskRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudTaskCreate, request),
  getCloudTask: (taskId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudTaskGet, taskId),
  cancelCloudTask: (taskId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudTaskCancel, taskId),
  getRelayState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.relayState),
  enableRelay: () =>
    ipcRenderer.invoke(IPC_CHANNELS.relayEnable),
  disableRelay: () =>
    ipcRenderer.invoke(IPC_CHANNELS.relayDisable),
  resolveRelayCommand: (commandId: string, accepted: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.relayResolve, commandId, accepted),
  onRelayEvent: (listener: (event: NeuraCoRelayEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, relayEvent: NeuraCoRelayEvent) => {
      listener(relayEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.relayEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.relayEvent, handler);
  },
  getProjectPermissions: () =>
    ipcRenderer.invoke(IPC_CHANNELS.permissionsGet),
  updateProjectPermissions: (request: NeuraCoProjectPermissionsUpdate) =>
    ipcRenderer.invoke(IPC_CHANNELS.permissionsUpdate, request),
  listCheckpoints: () => ipcRenderer.invoke(IPC_CHANNELS.checkpointList),
  createCheckpoint: (request: string | NeuraCoCheckpointCreateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkpointCreate, request),
  restoreCheckpoint: (
    checkpointId: string,
    target?: NeuraCoCheckpointRestoreTarget
  ) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkpointRestore, checkpointId, target),
  getCheckpointRetention: () =>
    ipcRenderer.invoke(IPC_CHANNELS.checkpointRetentionGet),
  updateCheckpointRetention: (maxPerProject: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkpointRetentionUpdate, maxPerProject),
  listTrash: () => ipcRenderer.invoke(IPC_CHANNELS.trashList),
  moveProjectPathToTrash: (relativePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.trashMove, relativePath),
  restoreTrashEntry: (entryId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.trashRestore, entryId),
  emergencyStop: () => ipcRenderer.invoke(IPC_CHANNELS.emergencyStop),
  emergencyResume: () => ipcRenderer.invoke(IPC_CHANNELS.emergencyResume),
  onEmergencyState: (listener: (state: NeuraCoEmergencyState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => {
      listener(state);
    };
    ipcRenderer.on(IPC_CHANNELS.emergencyEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.emergencyEvent, handler);
  },
  getEmergencyShortcut: () =>
    ipcRenderer.invoke(IPC_CHANNELS.emergencyShortcutGet),
  setEmergencyShortcut: (accelerator: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.emergencyShortcutSet, accelerator),
  listRecoverableTasks: (includeCompleted?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.recoverableTasksList, includeCompleted),
  inspectRecoverableTask: (taskId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.recoverableTaskInspect, taskId),
  resumeRecoverableTask: (
    taskId: string,
    strategy: NeuraCoTaskResumeStrategy
  ) => ipcRenderer.invoke(IPC_CHANNELS.recoverableTaskResume, taskId, strategy),
  discardRecoverableTask: (taskId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.recoverableTaskDiscard, taskId),
  listNotifications: (includeArchived?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.notificationsList, includeArchived),
  markNotificationRead: (notificationId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.notificationRead, notificationId),
  archiveNotification: (notificationId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.notificationArchive, notificationId),
  runNotificationAction: (
    notificationId: string,
    action: NeuraCoNotificationAction
  ) => ipcRenderer.invoke(
    IPC_CHANNELS.notificationAction,
    notificationId,
    action
  ),
  onNotificationEvent: (
    listener: (event: NeuraCoNotificationEvent) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      notificationEvent: NeuraCoNotificationEvent
    ) => listener(notificationEvent);
    ipcRenderer.on(IPC_CHANNELS.notificationEvent, handler);
    return () => ipcRenderer.removeListener(
      IPC_CHANNELS.notificationEvent,
      handler
    );
  },
  listGoals: () => ipcRenderer.invoke(IPC_CHANNELS.goalsList),
  createGoal: (input: NeuraCoGoalCreate) =>
    ipcRenderer.invoke(IPC_CHANNELS.goalCreate, input),
  updateGoal: (goalId: string, input: NeuraCoGoalUpdate) =>
    ipcRenderer.invoke(IPC_CHANNELS.goalUpdate, goalId, input),
  deleteGoal: (goalId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.goalDelete, goalId),
  updateGoalStep: (
    goalId: string,
    stepId: string,
    status: NeuraCoGoalStepStatus
  ) => ipcRenderer.invoke(IPC_CHANNELS.goalStepUpdate, goalId, stepId, status),
  resolveGoalProposal: (
    goalId: string,
    proposalId: string,
    decision: 'approved' | 'rejected'
  ) => ipcRenderer.invoke(
    IPC_CHANNELS.goalProposalResolve,
    goalId,
    proposalId,
    decision
  ),
  listAgents: () => ipcRenderer.invoke(IPC_CHANNELS.agentsList),
  saveCustomAgent: (definition: NeuraCoCustomAgentInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentsSave, definition),
  deleteCustomAgent: (agentId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentsDelete, agentId),
  previewTaskRoute: (request: NeuraCoTaskRoutingRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.taskRoutingPreview, request),
  runMultiAgentTask: (request: NeuraCoMultiAgentRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentsRun, request),
  cancelMultiAgentTask: (taskId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentsCancel, taskId),
  onMultiAgentProgress: (listener: (event: NeuraCoMultiAgentProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => {
      listener(progress);
    };
    ipcRenderer.on(IPC_CHANNELS.agentsProgress, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.agentsProgress, handler);
  },
  listReviewQueue: (includeArchived?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewQueueList, includeArchived),
  updateReviewStatus: (itemId: string, status: NeuraCoReviewStatus) =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewQueueStatus, itemId, status),
  addReviewComment: (input: NeuraCoReviewCommentInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewQueueComment, input),
  decideReviewFile: (input: NeuraCoReviewFileDecisionInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewQueueFileDecision, input),
  decideReviewHunk: (input: NeuraCoReviewHunkDecisionInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewQueueHunkDecision, input),
  decideAllReviewChanges: (input: NeuraCoReviewAllDecisionInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewQueueAllDecision, input),
  recordReviewTests: (itemId: string, tests: NeuraCoGitTestResult[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewQueueTests, itemId, tests),
  attachReviewCheckpoint: (itemId: string, checkpointId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.reviewQueueCheckpoint, itemId, checkpointId),
  getGitStatus: () => ipcRenderer.invoke(IPC_CHANNELS.gitStatus),
  getGitDiff: (branch?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitDiff, branch),
  createGitWorktree: (request: NeuraCoGitWorktreeCreate) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitCreateWorktree, request),
  removeGitWorktree: (worktreePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitRemoveWorktree, worktreePath),
  openGitWorktree: (worktreePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitOpenWorktree, worktreePath),
  commitGitWorktree: (worktreePath: string, message: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitCommitWorktree, worktreePath, message),
  listGitTestCommands: (worktreePath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitTestCommands, worktreePath),
  runGitTests: (commandId: string, worktreePath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitRunTests, commandId, worktreePath),
  runGitTestSuite: (worktreePath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitRunTestSuite, worktreePath),
  reviewGitBranch: (branch: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitReview, branch),
  mergeGitBranch: (branch: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitMerge, branch),
  getForgeConnection: () =>
    ipcRenderer.invoke(IPC_CHANNELS.forgeConnection),
  getForgeInbox: () =>
    ipcRenderer.invoke(IPC_CHANNELS.forgeInbox),
  getForgeIssue: (issueNumber: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.forgeIssue, issueNumber),
  createForgePullRequest: (request: NeuraCoForgePullRequestCreate) =>
    ipcRenderer.invoke(IPC_CHANNELS.forgeCreatePullRequest, request),
  getBrowserState: () => ipcRenderer.invoke(IPC_CHANNELS.browserState),
  newBrowserTab: (url?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.browserNewTab, url),
  closeBrowserTab: (tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.browserCloseTab, tabId),
  activateBrowserTab: (tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.browserActivateTab, tabId),
  navigateBrowser: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.browserNavigate, url),
  browserBack: () => ipcRenderer.invoke(IPC_CHANNELS.browserBack),
  browserForward: () => ipcRenderer.invoke(IPC_CHANNELS.browserForward),
  browserReload: () => ipcRenderer.invoke(IPC_CHANNELS.browserReload),
  setBrowserBounds: (bounds: NeuraCoBrowserBounds | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.browserBounds, bounds),
  toggleBrowserDevTools: () =>
    ipcRenderer.invoke(IPC_CHANNELS.browserDevTools),
  captureBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.browserCapture),
  selectBrowserElement: () =>
    ipcRenderer.invoke(IPC_CHANNELS.browserSelectElement),
  runBrowserAction: (action: NeuraCoBrowserAction) =>
    ipcRenderer.invoke(IPC_CHANNELS.browserAction, action),
  inspectBrowserDiagnostics: () =>
    ipcRenderer.invoke(IPC_CHANNELS.browserDiagnostics),
  getBrowserHistory: () => ipcRenderer.invoke(IPC_CHANNELS.browserHistory),
  getBrowserDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.browserDownloads),
  getBrowserAnnotations: () =>
    ipcRenderer.invoke(IPC_CHANNELS.browserAnnotations),
  saveBrowserAnnotation: (annotation: NeuraCoBrowserAnnotationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.browserSaveAnnotation, annotation),
  hideBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.browserHide),
  onBrowserEvent: (listener: (event: NeuraCoBrowserEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, browserEvent: Parameters<typeof listener>[0]) => {
      listener(browserEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.browserEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.browserEvent, handler);
  },
  listApplications: () => ipcRenderer.invoke(IPC_CHANNELS.applicationsList),
  launchApplication: (applicationId: string, target?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.applicationLaunch, applicationId, target),
  stopApplication: (processId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.applicationStop, processId),
  listComputerWindows: () =>
    ipcRenderer.invoke(IPC_CHANNELS.computerWindows),
  inspectComputerWindow: (windowId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.computerInspect, windowId),
  captureComputerWindow: (windowId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.computerCapture, windowId),
  planComputerAction: (request: NeuraCoComputerActionRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.computerPlan, request),
  executeComputerPlan: (planId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.computerExecute, planId),
  cancelComputerPlan: (planId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.computerCancel, planId),
  analyzeStudioProject: () => ipcRenderer.invoke(IPC_CHANNELS.studioAnalyze),
  runStudioOperation: (request: NeuraCoStudioOperationRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.studioRun, request),
  cancelStudioOperation: (taskId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.studioCancel, taskId),
  onStudioEvent: (listener: (event: NeuraCoStudioEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, studioEvent: Parameters<typeof listener>[0]) => {
      listener(studioEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.studioEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.studioEvent, handler);
  },
  getUsage: () => ipcRenderer.invoke(IPC_CHANNELS.usageGet),
  estimateUsage: (request: NeuraCoUsageEstimateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.usageEstimate, request),
  updateUsageSettings: (request: NeuraCoUsageSettingsUpdate) =>
    ipcRenderer.invoke(IPC_CHANNELS.usageSettings, request),
  createCreditCheckout: (amountEur: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.usageCheckout, amountEur),
  onUsageEvent: (listener: (summary: NeuraCoUsageSummary) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, summary: NeuraCoUsageSummary) => {
      listener(summary);
    };
    ipcRenderer.on(IPC_CHANNELS.usageEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.usageEvent, handler);
  },
  getAdminState: () => ipcRenderer.invoke(IPC_CHANNELS.adminStateGet),
  updateAdminConfig: (update: NeuraCoAdminConfigUpdate) =>
    ipcRenderer.invoke(IPC_CHANNELS.adminConfigUpdate, update),
  getAdminPricingHistory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.adminPricingHistory),
  listAdminUsers: (search?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.adminUsersList, search),
  listAdminLogs: () => ipcRenderer.invoke(IPC_CHANNELS.adminLogsList),
  listAdminIncidents: () =>
    ipcRenderer.invoke(IPC_CHANNELS.adminIncidentsList),
  createAdminIncident: (request: NeuraCoAdminIncidentCreate) =>
    ipcRenderer.invoke(IPC_CHANNELS.adminIncidentCreate, request),
  updateAdminIncident: (
    incidentId: string,
    request: NeuraCoAdminIncidentUpdate
  ) => ipcRenderer.invoke(
    IPC_CHANNELS.adminIncidentUpdate,
    incidentId,
    request
  ),
  listAdminPromotions: () =>
    ipcRenderer.invoke(IPC_CHANNELS.adminPromotionsList),
  createAdminPromotion: (request: NeuraCoAdminPromotionCreate) =>
    ipcRenderer.invoke(IPC_CHANNELS.adminPromotionCreate, request),
  updateAdminPromotion: (promotionId: string, active: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.adminPromotionUpdate, promotionId, active),
  adjustAdminCredits: (request: NeuraCoAdminCreditAdjustment) =>
    ipcRenderer.invoke(IPC_CHANNELS.adminCreditsAdjust, request),
  recordAdminRefund: (request: NeuraCoAdminRefundRecord) =>
    ipcRenderer.invoke(IPC_CHANNELS.adminRefundRecord, request),
  getStatistics: () => ipcRenderer.invoke(IPC_CHANNELS.statisticsGet),
  exportStatisticsCsv: () =>
    ipcRenderer.invoke(IPC_CHANNELS.statisticsExportCsv),
  exportStatisticsPdf: () =>
    ipcRenderer.invoke(IPC_CHANNELS.statisticsExportPdf),
  listActivity: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.activityList, limit),
  buildTaskReport: (taskId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportBuild, taskId),
  exportTaskReport: (taskId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportExport, taskId),
  openEvidence: (evidenceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.evidenceOpen, evidenceId),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateDownload),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateInstall),
  getUpdatePreferences: () => ipcRenderer.invoke(IPC_CHANNELS.updatePreferencesGet),
  updateUpdatePreferences: (update: Partial<NeuraCoUpdatePreferences>) =>
    ipcRenderer.invoke(IPC_CHANNELS.updatePreferencesSet, update),
  getUpdateRollback: () => ipcRenderer.invoke(IPC_CHANNELS.updateRollbackGet),
  rollbackUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateRollbackInstall),
  onUpdateEvent: (listener: (state: NeuraCoUpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: NeuraCoUpdateState) => {
      listener(state);
    };
    ipcRenderer.on(IPC_CHANNELS.updateEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateEvent, handler);
  }
});

contextBridge.exposeInMainWorld('neuraco', desktopApi);
