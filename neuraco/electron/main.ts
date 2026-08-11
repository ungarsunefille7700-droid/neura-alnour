import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  type WebPreferences
} from 'electron';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  IPC_CHANNELS,
  type NeuraCoAccountDeletionRequest,
  type NeuraCoAccessibilitySettingsUpdate,
  type NeuraCoAdminConfigUpdate,
  type NeuraCoAdminCreditAdjustment,
  type NeuraCoAdminIncidentCreate,
  type NeuraCoAdminIncidentUpdate,
  type NeuraCoAdminPromotionCreate,
  type NeuraCoAdminRefundRecord,
  type NeuraCoLoginCredentials,
  type NeuraCoRegistration,
  type NeuraCoAppLockSettingsUpdate,
  type NeuraCoAppInfo,
  type NeuraCoArtifactCreate,
  type NeuraCoArtifactUpdate,
  type NeuraCoBrowserAction,
  type NeuraCoBrowserAnnotationInput,
  type NeuraCoBrowserBounds,
  type NeuraCoBackgroundProcessAction,
  type NeuraCoBackgroundProcessRequest,
  type NeuraCoCloudTask,
  type NeuraCoCloudTaskRequest,
  type NeuraCoCheckpointCreateRequest,
  type NeuraCoCheckpointRestoreTarget,
  type NeuraCoCheckpointTaskSettings,
  type NeuraCoCheckpointTrigger,
  type NeuraCoConversationThreadCreate,
  type NeuraCoSecondaryConversationCreate,
  type NeuraCoSecondaryConversationMessageRequest,
  type NeuraCoControlledMemoryObservation,
  type NeuraCoControlledMemoryState,
  type NeuraCoControlledMemoryUpdate,
  type NeuraCoCommunicationStyle,
  type NeuraCoComputerActionRequest,
  type NeuraCoCustomAgentInput,
  type NeuraCoEffortLevel,
  type NeuraCoEnvironmentPreparationUpdate,
  type NeuraCoEnvironmentTarget,
  type NeuraCoForgePullRequestCreate,
  type NeuraCoGitTestResult,
  type NeuraCoGitWorktreeCreate,
  type NeuraCoGoalCreate,
  type NeuraCoGoalStepStatus,
  type NeuraCoGoalUpdate,
  type NeuraCoHostedSiteRequest,
  type NeuraCoHookEvent,
  type NeuraCoHookInput,
  type NeuraCoImageStudioCreateRequest,
  type NeuraCoLocalSessionSave,
  type NeuraCoMcpServerInput,
  type NeuraCoMultiAgentRequest,
  type NeuraCoNativeDocumentDraft,
  type NeuraCoNotification,
  type NeuraCoNotificationAction,
  type NeuraCoNotificationActionEvent,
  type NeuraCoNotificationEvent,
  type NeuraCoPermissionAction,
  type NeuraCoPrivacySettings,
  type NeuraCoProject,
  type NeuraCoProjectPermissionsUpdate,
  type NeuraCoRelayCommand,
  type NeuraCoRemoteActionRequest,
  type NeuraCoReviewCommentInput,
  type NeuraCoReviewAllDecisionInput,
  type NeuraCoReviewFileDecisionInput,
  type NeuraCoReviewHunkDecisionInput,
  type NeuraCoReviewStatus,
  type NeuraCoRoutine,
  type NeuraCoRoutineInput,
  type NeuraCoRoutineTrigger,
  type NeuraCoSelfCheck,
  type NeuraCoStudioOperationRequest,
  type NeuraCoTaskRoutingRequest,
  type NeuraCoTaskResumeStrategy,
  type NeuraCoUpdatePreferences,
  type NeuraCoUsageEstimateRequest,
  type NeuraCoUsageSummary,
  type NeuraCoUsageSettingsUpdate
} from './ipc-contract';
import {
  authenticatedApiRequest,
  loginWithGoogle,
  loginWithPassword,
  registerWithPassword,
  logout,
  restoreSession
} from './auth-service';
import {
  confirmEmailVerification,
  confirmPasswordReset,
  deleteAccount,
  disableTwoFactor,
  enableTwoFactor,
  getAccount,
  requestEmailVerification,
  requestPasswordReset,
  revokeAccountSession,
  revokeOtherAccountSessions,
  sendOptionalNotificationEmail,
  setupTwoFactor,
  updatePrivacySettings
} from './account-service';
import {
  createProjectRoot,
  openProjectRoot,
  readProjectTextFile,
  scanProjectCached,
  writeProjectTextFile
} from './workspace-core';
import {
  exportProjectPackage,
  projectArchiveDefaultName,
  validateProjectPackage
} from './project-package-service';
import { cloneGitRepository } from './project-clone-service';
import {
  listTerminalProfiles,
  startTerminalTask,
  validateTerminalCommand,
  type TerminalTask
} from './terminal-service';
import {
  isGeneralChatRequest,
  sendAgentMessage,
  streamAgentMessage
} from './agent-service';
import {
  isSensitiveTerminalCommand,
  assessTerminalCommand,
  normalizeNetworkDomain,
  permissionAllowsWithoutPrompt,
  permissionRefusesWithoutPrompt,
  permissionSignature,
  ProjectPermissionStore
} from './permission-service';
import { RecoveryService } from './recovery-service';
import {
  checkpointTriggerForCommand,
  commandNeedsProjectCheckpoint
} from './checkpoint-policy';
import { MultiAgentService } from './multi-agent-service';
import { GitService } from './git-service';
import { RemoteForgeService } from './remote-forge-service';
import { BrowserService, validateBrowserUrl } from './browser-service';
import { ApplicationService } from './application-service';
import { ComputerControlService } from './computer-control-service';
import { StudioService, validateStudioProjectPath } from './studio-service';
import {
  createCreditCheckout,
  estimateUsage,
  getUsage,
  getUsageStatistics,
  updateUsageSettings
} from './usage-service';
import { ActivityService } from './activity-service';
import {
  buildStatistics,
  statisticsToCsv,
  statisticsToPdf
} from './statistics-service';
import { UpdateService } from './update-service';
import { UpdatePreferencesService } from './update-preferences-service';
import { DatabaseMigrationService } from './database-migration-service';
import { sendTechnicalTelemetry } from './telemetry-service';
import { TechnicalErrorLogService } from './technical-error-log-service';
import { LocalSessionStore } from './session-service';
import { RelayService } from './relay-service';
import { ReviewQueueService } from './review-queue-service';
import { BackgroundProcessService } from './background-process-service';
import { ArtifactService } from './artifact-service';
import {
  nativeDocumentDigest,
  nativeDocumentInfo,
  previewNativeDocument,
  writeNativeDocument
} from './native-document-service';
import { ControlledMemoryService } from './controlled-memory-service';
import {
  projectInstructionsPrompt,
  readProjectInstructions
} from './project-instructions-service';
import { ExtensionService } from './extension-service';
import {
  HookService,
  type NeuraCoHookExecutionContext
} from './hook-service';
import { RoutineService } from './routine-service';
import {
  captureRecoverableProjectState,
  TaskRecoveryService
} from './task-recovery-service';
import {
  NotificationService,
  type NeuraCoNotificationCreate
} from './notification-service';
import { GoalService } from './goal-service';
import { SecondaryConversationService } from './secondary-conversation-service';
import {
  EnvironmentTransferService,
  type NeuraCoEnvironmentTransferSnapshot
} from './environment-transfer-service';
import { EnvironmentPreparationService } from './environment-preparation-service';
import { RemoteConnectionService } from './remote-connection-service';
import {
  ImageStudioService,
  type NeuraCoImageStudioRemoteResponse
} from './image-studio-service';
import { routeTask } from './task-routing-service';
import {
  cancelCloudTask,
  createCloudTask,
  getCloudTask,
  listCloudTasks
} from './cloud-task-service';
import { AppLockService } from './app-lock-service';
import {
  checkWindowsHelloAvailability,
  requestWindowsHelloVerification
} from './windows-hello';
import { DeviceSecurityService } from './device-security-service';
import { HostedSiteService } from './hosted-site-service';
import {
  IdeBridgeService,
  type NeuraCoIdeBridgeChatRequest,
  type NeuraCoIdeBridgeContext
} from './ide-bridge-service';
import { AccessibilityService } from './accessibility-service';
import {
  adjustAdminCredits,
  createAdminIncident,
  createAdminPromotion,
  getAdminPricingHistory,
  getAdminState,
  getRuntimePolicy,
  listAdminIncidents,
  listAdminLogs,
  listAdminPromotions,
  listAdminUsers,
  recordAdminRefund,
  updateAdminConfig,
  updateAdminIncident,
  updateAdminPromotion
} from './admin-service';

let mainWindow: BrowserWindow | null = null;
let navigationGuardEnabled = false;
let activeProject: NeuraCoProject | null = null;
const GENERAL_CHAT_PROJECT: NeuraCoProject = {
  id: '000000000000000000000001',
  name: 'Discussions NeuraCo',
  rootPath: ''
};
const terminalTasks = new Map<string, TerminalTask>();
const sessionAllowedSignatures = new Set<string>();
let permissionStore: ProjectPermissionStore | null = null;
let recoveryService: RecoveryService | null = null;
let multiAgentService: MultiAgentService | null = null;
let gitService: GitService | null = null;
let remoteForgeService: RemoteForgeService | null = null;
let browserService: BrowserService | null = null;
let applicationService: ApplicationService | null = null;
let computerControlService: ComputerControlService | null = null;
let studioService: StudioService | null = null;
let activityService: ActivityService | null = null;
let technicalErrorLogService: TechnicalErrorLogService | null = null;
let updateService: UpdateService | null = null;
let updatePreferencesService: UpdatePreferencesService | null = null;
let automaticUpdateCheckRunning = false;
let localSessionStore: LocalSessionStore | null = null;
let relayService: RelayService | null = null;
let reviewQueueService: ReviewQueueService | null = null;
let backgroundProcessService: BackgroundProcessService | null = null;
let goalService: GoalService | null = null;
let secondaryConversationService: SecondaryConversationService | null = null;
let environmentTransferService: EnvironmentTransferService | null = null;
let environmentPreparationService: EnvironmentPreparationService | null = null;
let remoteConnectionService: RemoteConnectionService | null = null;
let hostedSiteService: HostedSiteService | null = null;
let imageStudioService: ImageStudioService | null = null;
let artifactService: ArtifactService | null = null;
let controlledMemoryService: ControlledMemoryService | null = null;
let taskRecoveryService: TaskRecoveryService | null = null;
let notificationService: NotificationService | null = null;
let appLockService: AppLockService | null = null;
let deviceSecurityService: DeviceSecurityService | null = null;
let ideBridgeService: IdeBridgeService | null = null;
let accessibilityService: AccessibilityService | null = null;
let extensionService: ExtensionService | null = null;
let hookService: HookService | null = null;
let routineService: RoutineService | null = null;
const nativeNotifications = new Map<string, Notification>();
const knownForgeIssueIds = new Map<string, Set<string>>();
let emergencyStopped = false;
let emergencyStoppedAt: string | undefined;
const agentControllers = new Map<string, AbortController>();
let emergencyShortcut = 'CommandOrControl+Shift+Escape';
let criticalLocalOperations = 0;
let idleLockTimer: ReturnType<typeof setInterval> | null = null;

const getAccessibilityService = (): AccessibilityService => {
  if (!accessibilityService) {
    accessibilityService = new AccessibilityService(
      path.join(app.getPath('userData'), 'accessibility.json')
    );
  }
  return accessibilityService;
};

const getPermissionStore = (): ProjectPermissionStore => {
  if (!permissionStore) {
    permissionStore = new ProjectPermissionStore(
      path.join(app.getPath('userData'), 'project-permissions.json')
    );
  }
  return permissionStore;
};

const getRecoveryService = (): RecoveryService => {
  if (!recoveryService) {
    recoveryService = new RecoveryService(path.join(app.getPath('userData'), 'recovery'));
  }
  return recoveryService;
};

const getLocalSessionStore = (): LocalSessionStore => {
  if (!localSessionStore) {
    localSessionStore = new LocalSessionStore(
      path.join(app.getPath('userData'), 'local-sessions.json')
    );
  }
  return localSessionStore;
};

const emitSessionEvent = (
  session: Awaited<ReturnType<typeof restoreSession>>
): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.authSessionEvent, session);
  }
};

const getAppLockService = (): AppLockService => {
  if (!appLockService) {
    appLockService = new AppLockService({
      storePath: path.join(app.getPath('userData'), 'security', 'app-lock.bin'),
      protector: {
        available: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value)
      },
      onState: (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.appLockEvent, state);
        }
      }
    });
  }
  return appLockService;
};

const getDeviceSecurityService = (): DeviceSecurityService => {
  if (!deviceSecurityService) {
    deviceSecurityService = new DeviceSecurityService({
      storePath: path.join(app.getPath('userData'), 'relay-device-id'),
      appVersion: app.getVersion(),
      onRevoked: async () => {
        await ideBridgeService?.stop();
        await logout();
        getAppLockService().lock('remote');
        emitSessionEvent({ status: 'signed_out' });
      }
    });
  }
  return deviceSecurityService;
};

const ensureIdeBridgeAvailable = (): NeuraCoProject => {
  if (getAppLockService().state().locked) {
    throw new Error('NeuraCo Desktop est verrouillé.');
  }
  if (!activeProject) {
    throw new Error('Ouvrez un projet dans NeuraCo Desktop avant d’utiliser l’IDE.');
  }
  return activeProject;
};

const ideBridgeModels = [{
  id: 'auto' as const,
  name: 'Automatique',
  provider: 'NeuraCo'
}, {
  id: 'claude-sonnet-4-5' as const,
  name: 'Claude Sonnet 4.5',
  provider: 'Anthropic'
}, {
  id: 'gpt-4o' as const,
  name: 'GPT-4o',
  provider: 'OpenAI'
}, {
  id: 'gemini-2.5-flash' as const,
  name: 'Gemini 2.5 Flash',
  provider: 'Google'
}];

const getIdeBridgeService = (): IdeBridgeService => {
  if (!ideBridgeService) {
    ideBridgeService = new IdeBridgeService({
      manifestPath: path.join(
        app.getPath('userData'),
        'integrations',
        'ide-bridge.json'
      ),
      callbacks: {
        getContext: async (): Promise<NeuraCoIdeBridgeContext> => {
          const project = ensureIdeBridgeAvailable();
          const [threads, activeThread, agents, permissions, usage] = await Promise.all([
            getLocalSessionStore().list(project),
            getLocalSessionStore().get(project),
            getMultiAgentService().listAgents(),
            getPermissionStore().get(project.id, project.rootPath),
            getUsage().catch(() => null)
          ]);
          return {
            project: {
              id: project.id,
              name: project.name,
              rootPath: project.rootPath
            },
            threads,
            activeThread,
            agents,
            permissions,
            models: ideBridgeModels,
            usage
          };
        },
        createThread: async (title) => {
          const project = ensureIdeBridgeAvailable();
          return getLocalSessionStore().create(project, {
            title: title || 'Tâche JetBrains'
          });
        },
        selectThread: async (threadId) => {
          const project = ensureIdeBridgeAvailable();
          return getLocalSessionStore().select(project, threadId);
        },
        sendMessage: async (request: NeuraCoIdeBridgeChatRequest) => {
          const project = ensureIdeBridgeAvailable();
          const store = getLocalSessionStore();
          const selectedAgent = request.agentId
            ? (await getMultiAgentService().listAgents())
              .find((agent) => agent.id === request.agentId)
            : undefined;
          if (request.agentId && !selectedAgent) {
            throw new Error('L’agent sélectionné dans JetBrains n’existe plus.');
          }
          if (request.threadId) {
            await store.select(project, request.threadId);
          }
          const thread = await store.get(project)
            || await store.create(project, { title: 'Tâche JetBrains' });
          const requestId = `ide_${randomUUID()}`;
          await audit({
            taskId: requestId,
            projectId: project.id,
            category: 'agent',
            action: 'ide_task_started',
            status: 'started',
            summary: request.content.slice(0, 500),
            details: {
              source: 'jetbrains',
              threadId: thread.threadId,
              agentId: selectedAgent?.id,
              files: request.files.map((file) => file.path)
            }
          });
          try {
            const response = await sendRemoteAgentMessage({
              content: await appendAgentContext(
                project,
                selectedAgent
                  ? (
                    `${request.content}\n\nRÔLE ACTIF DANS L’IDE\n`
                    + `${selectedAgent.name} — ${selectedAgent.role}\n`
                    + selectedAgent.instructions
                  )
                  : request.content
              ),
              requestId,
              sessionId: thread.sessionId,
              projectId: project.id,
              projectName: project.name,
              mode: request.mode,
              model: (
                request.model === 'auto'
                && selectedAgent
                && ideBridgeModels.some((model) => model.id === selectedAgent.model)
              )
                ? selectedAgent.model as NeuraCoIdeBridgeChatRequest['model']
                : request.model,
              conversationContext: thread.messages.slice(-20),
              files: request.files,
              images: []
            });
            const updatedThread = await store.save(project, {
              threadId: thread.threadId,
              sessionId: response.sessionId,
              executionMode: thread.executionMode,
              cloudTaskId: thread.cloudTaskId,
              messages: [
                ...thread.messages,
                {
                  id: `ide_user_${randomUUID()}`,
                  role: 'user',
                  content: request.content,
                  files: request.files.map((file) => file.path)
                },
                {
                  id: `ide_assistant_${randomUUID()}`,
                  role: 'assistant',
                  content: response.message,
                  model: response.modelDisplay
                }
              ]
            });
            await audit({
              taskId: requestId,
              projectId: project.id,
              category: 'agent',
              action: 'ide_task_completed',
              status: 'completed',
              summary: `Réponse JetBrains produite avec ${response.modelDisplay}.`,
              details: {
                source: 'jetbrains',
                threadId: thread.threadId,
                agentId: selectedAgent?.id,
                provider: response.provider,
                model: response.model,
                creditsConsumed: response.usage?.credits_consumed || 0,
                inputTokens: response.usage?.input_tokens || 0,
                cachedInputTokens: response.usage?.cached_input_tokens || 0,
                outputTokens: response.usage?.output_tokens || 0,
                durationMs: response.usage?.duration_ms || 0
              }
            });
            return { response, thread: updatedThread };
          } catch (error) {
            await audit({
              taskId: requestId,
              projectId: project.id,
              category: 'agent',
              action: 'ide_task_failed',
              status: 'failed',
              summary: error instanceof Error ? error.message : 'Tâche IDE échouée.',
              details: {
                source: 'jetbrains',
                threadId: thread.threadId,
                agentId: selectedAgent?.id
              }
            });
            throw error;
          }
        }
      }
    });
  }
  return ideBridgeService;
};

const activateAuthenticatedSession = async (
  operation: () => Promise<Awaited<ReturnType<typeof restoreSession>>>
): Promise<Awaited<ReturnType<typeof restoreSession>>> => {
  const session = await operation();
  if (session.status === 'authenticated') {
    void getDeviceSecurityService().start().catch((error) => {
      console.error('NeuraCo device security heartbeat failed', error);
    });
    void getIdeBridgeService().start().catch((error) => {
      console.error('NeuraCo IDE bridge failed to start', error);
    });
    void runAutomaticUpdateCheck();
  } else {
    getDeviceSecurityService().stop();
    void ideBridgeService?.stop().catch((error) => {
      console.error('NeuraCo IDE bridge failed to stop', error);
    });
  }
  return session;
};

const activateAuthenticatedSessionWithAudit = async (
  action: 'session_restored' | 'password_login' | 'registration' | 'google_login',
  operation: () => Promise<Awaited<ReturnType<typeof restoreSession>>>
): Promise<Awaited<ReturnType<typeof restoreSession>>> => {
  const startedAt = Date.now();
  try {
    const session = await activateAuthenticatedSession(operation);
    const authenticated = session.status === 'authenticated';
    void audit({
      category: 'connection',
      action,
      status: authenticated ? 'completed' : 'failed',
      summary: authenticated
        ? 'Connexion NeuraCo établie.'
        : 'Connexion NeuraCo non établie.',
      details: {
        method: action === 'google_login'
          ? 'google'
          : action === 'registration'
            ? 'registration'
          : action === 'password_login'
            ? 'password'
            : 'stored_session',
        sessionStatus: session.status
      }
    });
    if (authenticated) {
      void sendTechnicalTelemetry({
        event: action,
        appVersion: app.getVersion(),
        success: true,
        durationMs: Date.now() - startedAt
      }).catch(() => undefined);
    }
    return session;
  } catch (error) {
    void audit({
      category: 'connection',
      action,
      status: 'failed',
      summary: 'La tentative de connexion NeuraCo a échoué.',
      details: {
        error: error instanceof Error ? error.message : 'Erreur de connexion.'
      }
    });
    throw error;
  }
};

const getRelayService = (): RelayService => {
  if (!relayService) {
    relayService = new RelayService({
      storePath: path.join(app.getPath('userData'), 'relay-device-id'),
      appVersion: app.getVersion(),
      getProject: () => activeProject,
      onEvent: (relayEvent) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.relayEvent, relayEvent);
        }
        const command = relayEvent.command as NeuraCoRelayCommand | undefined;
        if (
          relayEvent.type === 'command'
          && command
          && ['pause', 'stop'].includes(command.action)
        ) {
          void triggerEmergencyStop('secure-outbound-relay')
            .then(() => getRelayService().resolve(command.id, true))
            .catch((error) => {
              console.error('NeuraCo relay stop command failed', error);
            });
        }
      }
    });
  }
  return relayService;
};

const getReviewQueueService = (): ReviewQueueService => {
  if (!reviewQueueService) {
    reviewQueueService = new ReviewQueueService(
      path.join(app.getPath('userData'), 'review-queue.json')
    );
  }
  return reviewQueueService;
};

const getBackgroundProcessService = (): BackgroundProcessService => {
  if (!backgroundProcessService) {
    const storageDirectory = path.join(app.getPath('userData'), 'background-processes');
    backgroundProcessService = new BackgroundProcessService({
      storePath: path.join(storageDirectory, 'processes.json'),
      logsDirectory: path.join(storageDirectory, 'logs'),
      onEvent: (processEvent) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            IPC_CHANNELS.backgroundProcessEvent,
            processEvent
          );
        }
      }
    });
  }
  return backgroundProcessService;
};

const getArtifactService = (): ArtifactService => {
  if (!artifactService) {
    const storageDirectory = path.join(app.getPath('userData'), 'artifacts');
    artifactService = new ArtifactService(
      path.join(storageDirectory, 'artifacts.json'),
      path.join(storageDirectory, 'versions')
    );
  }
  return artifactService;
};

const getControlledMemoryService = (): ControlledMemoryService => {
  if (!controlledMemoryService) {
    controlledMemoryService = new ControlledMemoryService(
      path.join(app.getPath('userData'), 'controlled-memories.json')
    );
  }
  return controlledMemoryService;
};

const getExtensionService = (): ExtensionService => {
  if (!extensionService) {
    const storageDirectory = path.join(app.getPath('userData'), 'extensions');
    extensionService = new ExtensionService(
      path.join(storageDirectory, 'registry.json'),
      path.join(storageDirectory, 'installed')
    );
  }
  return extensionService;
};

const assertExtensionAllowedByServer = async (extension: {
  id: string;
  trust: string;
}): Promise<void> => {
  const policy = await getRuntimePolicy();
  const normalizedId = extension.id.trim().toLowerCase();
  if (policy.plugins.blocked_ids.includes(normalizedId)) {
    throw new Error('Cette extension est bloquee par la politique NeuraCo.');
  }
  if (!policy.plugins.allow_unsigned_local && extension.trust === 'unsigned') {
    throw new Error('Les extensions locales non signees sont desactivees par NeuraCo.');
  }
};

const getHookService = (): HookService => {
  if (!hookService) {
    hookService = new HookService(
      path.join(app.getPath('userData'), 'hooks.json')
    );
  }
  return hookService;
};

const getRoutineService = (): RoutineService => {
  if (!routineService) {
    routineService = new RoutineService(
      path.join(app.getPath('userData'), 'routines.json'),
      {
        execute: executeRoutineTask,
        isLocalExecutionAvailable: () => Boolean(
          mainWindow
          && !mainWindow.isDestroyed()
          && !emergencyStopped
          && !getAppLockService().state().locked
        )
      }
    );
    routineService.startScheduler();
  }
  return routineService;
};

const getTaskRecoveryService = (): TaskRecoveryService => {
  if (!taskRecoveryService) {
    taskRecoveryService = new TaskRecoveryService(
      path.join(app.getPath('userData'), 'recoverable-tasks.json')
    );
  }
  return taskRecoveryService;
};

const revealMainWindow = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const notificationActionLabel: Record<NeuraCoNotificationAction, string> = {
  open: 'Ouvrir',
  authorize: 'Autoriser',
  refuse: 'Refuser',
  pause: 'Mettre en pause',
  stop: 'Arrêter'
};

const emitNotificationEvent = (
  event: NeuraCoNotificationEvent
): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.notificationEvent, event);
  }
};

const handleNotificationAction = async (
  notification: NeuraCoNotification,
  action: NeuraCoNotificationAction
): Promise<NeuraCoNotificationActionEvent> => {
  revealMainWindow();
  await getNotificationService().markRead(
    notification.projectId,
    notification.id
  ).catch(() => undefined);
  let handled = action === 'open';
  let requiresValidation = notification.sensitive;
  let message = 'La notification a été ouverte dans NeuraCo.';

  if (action === 'pause' || action === 'stop') {
    requiresValidation = true;
    const controller = notification.taskId
      ? agentControllers.get(notification.taskId)
      : undefined;
    if (!controller || !mainWindow) {
      message = 'La tâche n’est plus active. Consultez son état dans NeuraCo.';
    } else {
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: action === 'pause' ? 'Mettre la tâche en pause' : 'Arrêter la tâche',
        message: notification.title,
        detail:
          `${notification.body}\n\nCette action interrompt l’exécution active. `
          + 'Une reprise contrôlée restera disponible si son état a été enregistré.',
        buttons: [
          action === 'pause' ? 'Mettre en pause' : 'Arrêter',
          'Annuler'
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (confirmation.response === 0) {
        controller.abort();
        await getTaskRecoveryService().interrupt(
          notification.taskId as string,
          action === 'pause'
            ? 'Tâche mise en pause depuis une notification.'
            : 'Tâche arrêtée depuis une notification.'
        ).catch(() => undefined);
        handled = true;
        message = action === 'pause'
          ? 'La tâche a été mise en pause.'
          : 'La tâche a été arrêtée.';
      } else {
        message = 'Action annulée après vérification.';
      }
    }
  } else if (action === 'authorize' || action === 'refuse') {
    requiresValidation = true;
    message = (
      'NeuraCo a été ouvert sur la demande d’autorisation. '
      + 'Les détails complets restent obligatoires avant validation.'
    );
  }

  const result: NeuraCoNotificationActionEvent = {
    notification,
    action,
    requiresValidation,
    handled,
    message
  };
  emitNotificationEvent({ type: 'action', action: result });
  await audit({
    taskId: notification.taskId,
    projectId: notification.projectId,
    category: 'security',
    action: `notification_${action}`,
    status: handled ? 'completed' : 'info',
    summary: message,
    details: {
      notificationId: notification.id,
      notificationKind: notification.kind,
      requiresValidation
    }
  });
  return result;
};

const showNativeNotification = (notification: NeuraCoNotification): void => {
  if (!Notification.isSupported()) return;
  const masked = (
    notification.sensitive
    && getAppLockService().shouldMaskSensitiveNotifications()
  );
  const availableActions = (masked ? [] : notification.actions)
    .filter((action) => action !== 'open')
    .slice(0, 2);
  const nativeNotification = new Notification({
    id: notification.id,
    title: masked ? 'Notification NeuraCo' : notification.title,
    body: masked
      ? 'Ouvrez NeuraCo pour consulter ce contenu sensible.'
      : notification.body,
    silent: notification.severity === 'info',
    actions: availableActions.map((action) => ({
      type: 'button' as const,
      text: notificationActionLabel[action]
    }))
  });
  nativeNotifications.set(notification.id, nativeNotification);
  nativeNotification.on('click', () => {
    void handleNotificationAction(notification, 'open');
  });
  nativeNotification.on('action', (details) => {
    const action = availableActions[details.actionIndex];
    if (action) void handleNotificationAction(notification, action);
  });
  nativeNotification.on('failed', (_event, error) => {
    console.error('NeuraCo native notification failed', error);
  });
  nativeNotification.show();
};

const getNotificationService = (): NotificationService => {
  if (!notificationService) {
    notificationService = new NotificationService(
      path.join(app.getPath('userData'), 'notifications.json'),
      {
        onCreated: (notification) => {
          emitNotificationEvent({ type: 'created', notification });
          showNativeNotification(notification);
          void sendOptionalNotificationEmail(notification).catch((error) => {
            console.error('NeuraCo optional notification email failed', error);
          });
        }
      }
    );
  }
  return notificationService;
};

const getGoalService = (): GoalService => {
  if (!goalService) {
    goalService = new GoalService(
      path.join(app.getPath('userData'), 'goals', 'goals.json')
    );
  }
  return goalService;
};

const getSecondaryConversationService = (): SecondaryConversationService => {
  if (!secondaryConversationService) {
    secondaryConversationService = new SecondaryConversationService(
      path.join(
        app.getPath('userData'),
        'conversations',
        'secondary-conversations.json'
      )
    );
  }
  return secondaryConversationService;
};

const getEnvironmentTransferService = (): EnvironmentTransferService => {
  if (!environmentTransferService) {
    const directory = path.join(app.getPath('userData'), 'environment-transfers');
    environmentTransferService = new EnvironmentTransferService({
      storePath: path.join(directory, 'transfers.json'),
      manifestsDirectory: path.join(directory, 'manifests'),
      uploadCloud: async (transferId, target, manifest) => {
        const response = await authenticatedApiRequest<{
          id: string;
          location: string;
        }>('/neuraco/environment-transfers', {
          method: 'POST',
          body: JSON.stringify({
            transfer_id: transferId,
            cloud_workspace_id: target.cloudWorkspaceId || 'default',
            manifest
          })
        });
        return response.location;
      }
    });
  }
  return environmentTransferService;
};

const getEnvironmentPreparationService = (): EnvironmentPreparationService => {
  if (!environmentPreparationService) {
    environmentPreparationService = new EnvironmentPreparationService({
      storePath: path.join(
        app.getPath('userData'),
        'environment-preparation',
        'preparation.json'
      )
    });
  }
  return environmentPreparationService;
};

const getRemoteConnectionService = (): RemoteConnectionService => {
  if (!remoteConnectionService) {
    remoteConnectionService = new RemoteConnectionService();
  }
  return remoteConnectionService;
};

const getHostedSiteService = (): HostedSiteService => {
  if (!hostedSiteService) {
    const directory = path.join(app.getPath('userData'), 'hosted-sites');
    hostedSiteService = new HostedSiteService({
      storePath: path.join(directory, 'deployments.json'),
      storageDirectory: directory
    });
  }
  return hostedSiteService;
};

const getImageStudioService = (): ImageStudioService => {
  if (!imageStudioService) {
    const directory = path.join(app.getPath('userData'), 'image-studio');
    imageStudioService = new ImageStudioService({
      storePath: path.join(directory, 'jobs.json'),
      assetsDirectory: path.join(directory, 'assets'),
      generateRemote: async (project, request) => (
        authenticatedApiRequest<NeuraCoImageStudioRemoteResponse>(
          '/neuraco/images/generate',
          {
            method: 'POST',
            body: JSON.stringify({
              request_id: request.requestId,
              project_id: project.id,
              operation: request.operation,
              prompt: request.prompt,
              variants: request.variants,
              source: request.source
                ? {
                    id: request.source.id,
                    name: request.source.name,
                    mime_type: request.source.mimeType,
                    data_base64: request.source.dataBase64,
                    width: request.source.width,
                    height: request.source.height,
                    size: request.source.size
                  }
                : null
            })
          }
        )
      )
    });
  }
  return imageStudioService;
};

const buildEnvironmentTransferSnapshot = async (
  project: NeuraCoProject
): Promise<NeuraCoEnvironmentTransferSnapshot> => {
  const activeTaskIds = new Set(agentControllers.keys());
  const [
    conversation,
    goals,
    agents,
    permissions,
    tasks,
    activities,
    gitStatus,
    budget
  ] = await Promise.all([
    getLocalSessionStore().get(project),
    getGoalService().list(project.id),
    getMultiAgentService().listAgents(),
    getPermissionStore().get(project.id, project.rootPath),
    getTaskRecoveryService().list(project.id, true, activeTaskIds),
    getActivityService().list(200),
    getGitService().status(project).catch(() => null),
    getUsage().catch(() => null)
  ]);
  const changes = gitStatus?.repository
    ? await getGitService().diff(project).catch(() => null)
    : null;
  const relevantFiles = [...new Set([
    ...tasks.flatMap((task) => task.filesModified),
    ...(conversation?.messages || []).flatMap((message) => message.files || [])
  ])].filter((file) => (
    typeof file === 'string'
    && file.length > 0
    && !path.isAbsolute(file)
    && !file.includes('..')
  )).slice(0, 80);
  const requiredTools = new Set<string>();
  if (gitStatus?.repository) requiredTools.add('git');
  const projectFiles = [
    ['package.json', ['node', 'npm']],
    ['requirements.txt', ['python']],
    ['pyproject.toml', ['python']],
    ['Cargo.toml', ['cargo']],
    ['go.mod', ['go']]
  ] as const;
  for (const [file, tools] of projectFiles) {
    try {
      await stat(path.join(project.rootPath, file));
      tools.forEach((tool) => requiredTools.add(tool));
    } catch {
      // The project does not require this tool family.
    }
  }
  return {
    projectId: project.id,
    projectName: project.name,
    sourcePath: project.rootPath,
    conversation,
    goals,
    agents,
    permissions,
    budget,
    tasks,
    changes,
    results: activities,
    requiredTools: [...requiredTools],
    relevantFiles
  };
};

const notify = (
  input: NeuraCoNotificationCreate
): Promise<NeuraCoNotification | null> => (
  getNotificationService().create(input).catch((error) => {
    console.error('NeuraCo notification creation failed', error);
    return null;
  })
);

const notifyLowCredits = async (
  project: NeuraCoProject,
  summary: NeuraCoUsageSummary
): Promise<void> => {
  const windows = [
    ['5 heures', summary.windows.five_hour],
    ['7 jours', summary.windows.seven_day],
    ['mois', summary.windows.monthly]
  ] as const;
  const lowest = windows
    .filter(([, window]) => window.limit > 0)
    .sort((left, right) => (
      left[1].remaining_percent - right[1].remaining_percent
    ))[0];
  if (!lowest || lowest[1].remaining_percent > 10) return;
  const [label, window] = lowest;
  const limitReached = window.remaining <= 0 || window.remaining_percent <= 0;
  await notify({
    project,
    kind: limitReached ? 'usage_limit_reached' : 'credits_low',
    severity: limitReached || window.remaining_percent <= 3 ? 'critical' : 'warning',
    title: limitReached
      ? 'Plafond NeuraCo atteint'
      : 'Crédits NeuraCo presque épuisés',
    body:
      `Il reste ${Math.max(0, window.remaining)} crédit(s), soit `
      + `${Math.max(0, window.remaining_percent).toFixed(1)} % sur la fenêtre ${label}.`,
    target: 'usage',
    actions: ['open'],
    dedupeKey: limitReached
      ? `usage-limit-reached-${label}`
      : `credits-low-${label}-${Math.ceil(window.remaining_percent / 5)}`
  });
};

const publishUsageSummary = (
  sender: Electron.WebContents,
  project: NeuraCoProject
): void => {
  void getUsage().then(async (summary) => {
    if (!sender.isDestroyed()) {
      sender.send(IPC_CHANNELS.usageEvent, summary);
    }
    await notifyLowCredits(project, summary);
  }).catch((error) => {
    console.error('NeuraCo usage refresh failed', error);
  });
};

const captureTaskRecoveryContext = async (project: NeuraCoProject) => {
  const [snapshot, gitStatus, permissions, checkpoints] = await Promise.all([
    scanProjectCached(project),
    getGitService().status(project).catch(() => undefined),
    getPermissionStore().get(project.id, project.rootPath),
    getRecoveryService().listCheckpoints(project).catch(() => [])
  ]);
  return {
    projectState: captureRecoverableProjectState(snapshot, gitStatus),
    worktrees: (gitStatus?.worktrees || []).map((worktree) => ({
      path: worktree.path,
      branch: worktree.branch,
      head: worktree.head
    })),
    permissions,
    checkpointIds: checkpoints.map((checkpoint) => checkpoint.id)
  };
};

const appendAgentContext = async (
  project: NeuraCoProject,
  content: unknown,
  effort?: NeuraCoEffortLevel,
  communicationStyle?: NeuraCoCommunicationStyle
): Promise<string> => {
  const original = String(content || '').trim();
  const [memory, projectInstructions, extensions] = await Promise.all([
    getControlledMemoryService().promptContext(project.id),
    projectInstructionsPrompt(project),
    getExtensionService().promptContext()
  ]);
  const safeEffort: NeuraCoEffortLevel = [
    'rapid',
    'normal',
    'deep',
    'maximum'
  ].includes(String(effort))
    ? effort as NeuraCoEffortLevel
    : 'normal';
  const safeStyle: NeuraCoCommunicationStyle = [
    'direct',
    'normal',
    'detailed',
    'pedagogical'
  ].includes(String(communicationStyle))
    ? communicationStyle as NeuraCoCommunicationStyle
    : 'normal';
  const verificationPasses = {
    rapid: 1,
    normal: 2,
    deep: 3,
    maximum: 4
  }[safeEffort];
  const styleInstruction = {
    direct: 'Réponds de manière directe et courte, sans retirer les preuves nécessaires.',
    normal: 'Réponds avec un niveau de détail normal et structuré.',
    detailed: 'Fournis une réponse détaillée, structurée et complète.',
    pedagogical: 'Explique pédagogiquement les décisions et les étapes importantes.'
  }[safeStyle];
  const preferences = (
    '\n\nRÉGLAGES VALIDÉS POUR CETTE TÂCHE\n'
    + `Niveau d’effort : ${safeEffort}. Effectue ${verificationPasses} `
    + 'passe(s) de vérification pertinentes avant de conclure. '
    + 'Ce réglage ne donne aucune autorisation supplémentaire.\n'
    + `Style de communication : ${safeStyle}. ${styleInstruction}`
  );
  const additions = `${preferences}${memory}${projectInstructions}${extensions}`;
  const room = Math.max(0, 24_000 - original.length - 2);
  return room >= 120
    ? `${original}${additions.slice(0, room)}`
    : original;
};

const enrichControlledMemoryState = async (
  project: NeuraCoProject,
  state: NeuraCoControlledMemoryState
): Promise<NeuraCoControlledMemoryState> => {
  const [projectInstructions, session] = await Promise.all([
    readProjectInstructions(project),
    getLocalSessionStore().snapshot(project).catch(() => undefined)
  ]);
  return {
    ...state,
    projectInstructions: {
      found: projectInstructions.found,
      path: projectInstructions.path,
      contentPreview: projectInstructions.contentPreview,
      size: projectInstructions.size,
      modifiedAt: projectInstructions.modifiedAt,
      warnings: projectInstructions.warnings
    },
    sessionMemory: session
      ? {
          threadId: session.threadId,
          title: session.title,
          messageCount: session.messages.length,
          updatedAt: session.updatedAt
        }
      : undefined
  };
};

const enqueueCloudTaskForReview = async (
  task: NeuraCoCloudTask
): Promise<NeuraCoCloudTask> => {
  if (
    activeProject
    && task.projectId === activeProject.id
    && task.status === 'completed'
  ) {
    const permissions = await getPermissionStore().get(
      activeProject.id,
      activeProject.rootPath
    );
    await getReviewQueueService().enqueueCloud(activeProject, task, permissions);
  }
  return task;
};

const synchronizeCloudTaskRecovery = async (
  task: NeuraCoCloudTask
): Promise<void> => {
  try {
    if (task.status === 'completed') {
      await getTaskRecoveryService().complete(task.id, {
        summary: task.result || 'Tâche Cloud terminée.',
        creditsConsumed: task.usage?.credits_consumed || 0
      });
      if (activeProject?.id === task.projectId) {
        await notify({
          project: activeProject,
          kind: 'task_completed',
          severity: 'success',
          title: 'Tâche Cloud terminée',
          body: task.result || 'Le résultat Cloud est prêt à être examiné.',
          taskId: task.id,
          target: 'review',
          actions: ['open'],
          dedupeKey: `task-completed-${task.id}`
        });
      }
    } else if (['failed', 'cancelled', 'cancel_requested'].includes(task.status)) {
      await getTaskRecoveryService().interrupt(
        task.id,
        task.error || (
          task.status === 'cancel_requested'
            ? 'Annulation de la tâche Cloud demandée par l’utilisateur.'
            : `Tâche Cloud ${task.status}.`
          )
      );
      if (
        activeProject?.id === task.projectId
        && ['failed', 'cancelled'].includes(task.status)
      ) {
        await notify({
          project: activeProject,
          kind: 'task_failed',
          severity: task.status === 'failed' ? 'critical' : 'warning',
          title: task.status === 'failed'
            ? 'Tâche Cloud échouée'
            : 'Tâche Cloud annulée',
          body: task.error || `La tâche Cloud est ${task.status}.`,
          taskId: task.id,
          target: 'protection',
          actions: ['open'],
          dedupeKey: `task-failed-${task.id}-${task.status}`
        });
      }
    }
  } catch (error) {
    console.error('NeuraCo Cloud recovery synchronization failed', error);
  }
};

const getActivityService = (): ActivityService => {
  if (!activityService) {
    activityService = new ActivityService(path.join(app.getPath('userData'), 'logs'));
  }
  return activityService;
};

const getTechnicalErrorLogService = (): TechnicalErrorLogService => {
  if (!technicalErrorLogService) {
    technicalErrorLogService = new TechnicalErrorLogService(
      path.join(app.getPath('userData'), 'logs')
    );
  }
  return technicalErrorLogService;
};

const audit = (
  entry: Parameters<ActivityService['append']>[0]
): Promise<unknown> => getActivityService().append(entry).catch((error) => {
  console.error('NeuraCo activity log failed', error);
  return null;
});

const enforceHooks = async (
  hookEvent: NeuraCoHookEvent,
  context: NeuraCoHookExecutionContext,
  project: NeuraCoProject
): Promise<void> => {
  const result = await getHookService().execute(hookEvent, {
    ...context,
    projectId: project.id,
    projectName: project.name
  }, project);
  for (const run of result.runs) {
    await audit({
      projectId: project.id,
      taskId: context.taskId,
      category: 'security',
      action: `hook_${hookEvent}`,
      status: run.status === 'passed'
        ? 'completed'
        : run.status === 'approval_required'
          ? 'started'
          : 'failed',
      summary: `${run.hookName} : ${run.summary}`,
      details: {
        hookId: run.hookId,
        hookStatus: run.status,
        durationMs: run.durationMs
      }
    });
  }
  for (const message of result.notifications) {
    await notify({
      project,
      kind: 'task_completed',
      severity: 'info',
      title: 'Hook NeuraCo',
      body: message,
      taskId: context.taskId,
      target: 'protection',
      dedupeKey: `hook-${hookEvent}-${message}-${Date.now()}`
    });
  }
  if (result.blocked) {
    const blocked = result.runs.find((run) => run.status === 'blocked');
    throw new Error(`Action bloquée par le hook « ${blocked?.hookName} » : ${blocked?.summary}`);
  }
  if (result.approvalRequired) {
    if (!mainWindow) throw new Error('Approbation du hook indisponible.');
    const approvals = result.runs
      .filter((run) => run.status === 'approval_required')
      .map((run) => run.hookName)
      .join(', ');
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Approbation demandée par un hook',
      message: approvals,
      detail: `Événement : ${hookEvent}. L’action ne continuera qu’après validation.`,
      buttons: ['Refuser', 'Autoriser cette action'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) {
      throw new Error('Action refusée lors de l’approbation du hook.');
    }
  }
};

const runPostHooks = (
  hookEvent: NeuraCoHookEvent,
  context: NeuraCoHookExecutionContext,
  project: NeuraCoProject
): void => {
  void enforceHooks(hookEvent, context, project).catch((error) => {
    console.error(`NeuraCo post-hook ${hookEvent} failed`, error);
    void notify({
      project,
      kind: 'task_failed',
      severity: 'warning',
      title: 'Hook NeuraCo en échec',
      body: error instanceof Error ? error.message : 'Le hook a échoué.',
      taskId: context.taskId,
      target: 'protection',
      sensitive: true,
      dedupeKey: `hook-error-${hookEvent}-${context.taskId || Date.now()}`
    });
  });
};

async function executeRoutineTask(
  routine: NeuraCoRoutine,
  trigger: NeuraCoRoutineTrigger,
  metadata: Record<string, unknown>
): Promise<{
  summary: string;
  provider?: string;
  model?: string;
  creditsConsumed?: number;
}> {
  ensureEmergencyRunning();
  if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
  const project = activeProject;
  if (
    routine.projectIds.length > 0
    && !routine.projectIds.includes(project.id)
  ) {
    throw new Error('Le projet actif ne fait pas partie de cette routine.');
  }
  if (routine.autonomy === 'supervised') {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Validation utilisateur indisponible.');
    }
    if (routine.notificationConditions.includes('on_approval')) {
      await notify({
        project,
        kind: 'routine_result',
        severity: 'warning',
        title: `Routine en attente : ${routine.name}`,
        body: 'Une validation est requise avant son exécution.',
        target: 'chat',
        actions: ['open'],
        dedupeKey: `routine-approval-${routine.id}-${Date.now()}`
      });
    }
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Routine NeuraCo',
      message: `Exécuter « ${routine.name} » ?`,
      detail:
        `${routine.instruction.slice(0, 600)}\n\n`
        + `Déclencheur : ${trigger} · Budget maximal : ${routine.budgetCredits} crédits.`,
      buttons: ['Exécuter', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) {
      throw new Error('Routine refusée par l’utilisateur.');
    }
  }
  if (routine.notificationConditions.includes('on_start')) {
    await notify({
      project,
      kind: 'routine_result',
      severity: 'info',
      title: `Routine démarrée : ${routine.name}`,
      body: `Déclencheur : ${trigger}.`,
      target: 'chat',
      actions: ['open'],
      dedupeKey: `routine-start-${routine.id}-${Date.now()}`
    });
  }
  const requestId = `routine_${randomUUID()}`;
  const selectedAgents = (await getMultiAgentService().listAgents())
    .filter((agent) => routine.agentIds.includes(agent.id));
  const instruction = [
    `ROUTINE NEURACO : ${routine.name}`,
    routine.instruction,
    `Déclencheur vérifié : ${trigger}.`,
    `Autonomie : ${routine.autonomy}.`,
    `Budget maximal : ${routine.budgetCredits} crédits.`,
    routine.tools.length > 0
      ? `Outils explicitement autorisés : ${routine.tools.join(', ')}.`
      : 'Aucun outil supplémentaire explicitement autorisé.',
    selectedAgents.length > 0
      ? (
        'Rôles demandés :\n'
        + selectedAgents.map((agent) => (
          `- ${agent.name} (${agent.role}) : ${agent.instructions}`
        )).join('\n')
      )
      : '',
    Object.keys(metadata).length > 0
      ? `Contexte du déclencheur : ${JSON.stringify(metadata).slice(0, 4_000)}`
      : '',
    'Produis un résultat concret et vérifiable. Respecte les permissions du projet.'
  ].filter(Boolean).join('\n\n');
  await enforceHooks('before_instruction', {
    taskId: requestId,
    instruction
  }, project);
  const estimateModel = routine.model === 'auto'
    ? 'gpt-4o'
    : routine.model;
  try {
    const estimate = await estimateUsage({
      mode: routine.autonomy === 'autonomous' ? 'quality' : 'balanced',
      model: estimateModel,
      promptCharacters: instruction.length,
      maxOutputTokens: 4_096,
      agents: Math.max(1, selectedAgents.length),
      imageCount: 0
    });
    if (estimate.maximum_credits > routine.budgetCredits) {
      throw new Error(
        `Budget insuffisant : estimation ${estimate.maximum_credits}, plafond ${routine.budgetCredits}.`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Budget insuffisant')) {
      throw error;
    }
  }
  try {
    if (routine.executionMode === 'cloud') {
      if (!routine.cloudConsent) throw new Error('Consentement cloud manquant.');
      const task = await createCloudTask({
        content: instruction,
        requestId,
        projectId: project.id,
        projectName: project.name,
        mode: 'question',
        model: routine.model,
        effort: routine.autonomy === 'autonomous' ? 'deep' : 'normal',
        conversationContext: [],
        files: []
      });
      const summary = `Tâche cloud ${task.id} créée avec le statut ${task.status}.`;
      if (routine.notificationConditions.includes('on_success')) {
        await notify({
          project,
          kind: 'routine_result',
          severity: 'success',
          title: `Routine envoyée : ${routine.name}`,
          body: summary,
          taskId: task.id,
          target: 'chat',
          actions: ['open'],
          dedupeKey: `routine-cloud-${routine.id}-${task.id}`
        });
      }
      return {
        summary,
        provider: task.provider,
        model: task.model,
        creditsConsumed: task.usage?.credits_consumed
      };
    }
    const response = await sendRemoteAgentMessage({
      content: await appendAgentContext(project, instruction, 'normal', 'direct'),
      requestId,
      projectId: project.id,
      projectName: project.name,
      mode: 'question',
      model: routine.model,
      conversationContext: [],
      files: [],
      images: []
    });
    await enforceHooks('task_completed', {
      taskId: requestId,
      status: 'completed',
      metadata: {
        routineId: routine.id,
        provider: response.provider,
        model: response.model
      }
    }, project);
    if (routine.notificationConditions.includes('on_success')) {
      await notify({
        project,
        kind: 'routine_result',
        severity: 'success',
        title: `Routine terminée : ${routine.name}`,
        body: response.message.slice(0, 1_000),
        taskId: requestId,
        target: 'chat',
        actions: ['open'],
        dedupeKey: `routine-success-${routine.id}-${requestId}`
      });
    }
    await audit({
      taskId: requestId,
      projectId: project.id,
      category: 'agent',
      action: 'routine_completed',
      status: 'completed',
      summary: `${routine.name} terminée avec ${response.modelDisplay}.`,
      details: {
        routineId: routine.id,
        trigger,
        executionMode: routine.executionMode,
        provider: response.provider,
        model: response.model,
        creditsConsumed: response.usage?.credits_consumed || 0
      }
    });
    return {
      summary: response.message,
      provider: response.provider,
      model: response.model,
      creditsConsumed: response.usage?.credits_consumed || 0
    };
  } catch (error) {
    runPostHooks('on_error', {
      taskId: requestId,
      error: error instanceof Error ? error.message : 'Routine en échec.'
    }, project);
    if (routine.notificationConditions.includes('on_failure')) {
      await notify({
        project,
        kind: 'routine_result',
        severity: 'critical',
        title: `Routine en échec : ${routine.name}`,
        body: error instanceof Error ? error.message : 'Exécution impossible.',
        taskId: requestId,
        target: 'chat',
        actions: ['open'],
        dedupeKey: `routine-failure-${routine.id}-${requestId}`
      });
    }
    throw error;
  }
}

const withCriticalOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
  criticalLocalOperations += 1;
  try {
    return await operation();
  } finally {
    criticalLocalOperations = Math.max(0, criticalLocalOperations - 1);
  }
};

const getMultiAgentService = (): MultiAgentService => {
  if (!multiAgentService) {
    multiAgentService = new MultiAgentService({
      storePath: path.join(app.getPath('userData'), 'custom-agents.json')
    });
  }
  return multiAgentService;
};

const getGitService = (): GitService => {
  if (!gitService) {
    gitService = new GitService({
      worktreeRoot: path.join(app.getPath('userData'), 'worktrees')
    });
  }
  return gitService;
};

const getRemoteForgeService = (): RemoteForgeService => {
  if (!remoteForgeService) {
    remoteForgeService = new RemoteForgeService();
  }
  return remoteForgeService;
};

const appendBrowserLog = async (event: unknown): Promise<void> => {
  const directory = path.join(app.getPath('userData'), 'logs');
  await mkdir(directory, { recursive: true });
  await appendFile(
    path.join(directory, 'browser.jsonl'),
    `${JSON.stringify(event)}\n`,
    'utf8'
  );
};

const getBrowserService = (): BrowserService => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Fenêtre NeuraCo indisponible.');
  }
  if (!browserService) {
    browserService = new BrowserService({
      host: mainWindow,
      storageDirectory: path.join(app.getPath('userData'), 'browser'),
      onEvent: (event) => {
        void appendBrowserLog(event).catch((error) => {
          console.error('NeuraCo browser log failed', error);
        });
        void audit({
          projectId: activeProject?.id,
          category: 'browser',
          action: event.type,
          status: event.type === 'blocked' ? 'refused' : 'info',
          summary: event.message || `Événement navigateur : ${event.type}`,
          details: { ...event }
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.browserEvent, event);
        }
      }
    });
  }
  return browserService;
};

const getApplicationService = (): ApplicationService => {
  if (!applicationService) {
    applicationService = new ApplicationService({
      storageDirectory: path.join(app.getPath('userData'), 'applications')
    });
  }
  return applicationService;
};

const getComputerControlService = (): ComputerControlService => {
  if (!computerControlService) {
    computerControlService = new ComputerControlService();
  }
  return computerControlService;
};

const appendStudioLog = async (event: unknown): Promise<void> => {
  const directory = path.join(app.getPath('userData'), 'logs');
  await mkdir(directory, { recursive: true });
  await appendFile(
    path.join(directory, 'studio.jsonl'),
    `${JSON.stringify(event)}\n`,
    'utf8'
  );
};

const getStudioService = (): StudioService => {
  if (!studioService) {
    studioService = new StudioService({
      storageDirectory: path.join(app.getPath('userData'), 'studio')
    });
  }
  return studioService;
};

const getUpdateService = (): UpdateService => {
  if (!updateService) {
    updateService = new UpdateService({
      storageDirectory: path.join(app.getPath('userData'), 'updates'),
      currentVersion: app.getVersion(),
      isBusy: () => (
        terminalTasks.size > 0
        || (backgroundProcessService?.activeCount() ?? 0) > 0
        || agentControllers.size > 0
        || criticalLocalOperations > 0
      ),
      saveState: async () => {
        if (activeProject) {
          await createProjectCheckpointWithContext(
            activeProject,
            'Avant la mise à jour NeuraCo',
            'application_update'
          );
        }
        await audit({
          projectId: activeProject?.id,
          category: 'update',
          action: 'update_state_saved',
          status: 'completed',
          summary: 'État local sauvegardé avant mise à jour.',
          details: activeProject
            ? { checkpoint: 'Avant la mise à jour NeuraCo' }
            : {}
        });
      },
      onState: (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.updateEvent, state);
        }
      }
    });
  }
  return updateService;
};

const getUpdatePreferencesService = (): UpdatePreferencesService => {
  if (!updatePreferencesService) {
    updatePreferencesService = new UpdatePreferencesService(
      path.join(app.getPath('userData'), 'updates', 'preferences.json')
    );
  }
  return updatePreferencesService;
};

const runAutomaticUpdateCheck = async (): Promise<void> => {
  if (automaticUpdateCheckRunning) return;
  automaticUpdateCheckRunning = true;
  try {
    const preferences = await getUpdatePreferencesService().get();
    if (!(await getUpdatePreferencesService().shouldCheck())) return;
    const manifest = await getUpdateService().check(preferences.channel);
    await getUpdatePreferencesService().markChecked();
    await audit({
      projectId: activeProject?.id,
      category: 'update',
      action: 'automatic_update_checked',
      status: 'completed',
      summary: manifest.available
        ? `NeuraCo ${manifest.latest_version} est disponible sur le canal ${preferences.channel}.`
        : `Canal ${preferences.channel} vérifié : NeuraCo est à jour.`,
      details: {
        currentVersion: manifest.current_version,
        latestVersion: manifest.latest_version,
        channel: preferences.channel
      }
    });
    if (manifest.available && preferences.autoDownload) {
      await getUpdateService().download();
    }
  } catch (error) {
    await audit({
      projectId: activeProject?.id,
      category: 'update',
      action: 'automatic_update_checked',
      status: 'failed',
      summary: error instanceof Error ? error.message : 'Vérification automatique impossible.'
    });
  } finally {
    automaticUpdateCheckRunning = false;
  }
};

const runLocalDatabaseMigrations = async (): Promise<void> => {
  const service = new DatabaseMigrationService(app.getPath('userData'));
  await service.run([{
    id: 'update-preferences-v1',
    from: 0,
    to: 1,
    targets: ['updates/preferences.json', 'updates/update-channel.json'],
    apply: async (context) => {
      const existing = await context.readJson<Record<string, unknown>>(
        'updates/preferences.json'
      );
      if (existing) return;
      const legacy = await context.readJson<string | { channel?: string }>(
        'updates/update-channel.json'
      );
      const legacyChannel = typeof legacy === 'string' ? legacy : legacy?.channel;
      await context.writeJson('updates/preferences.json', {
        version: 1,
        channel: legacyChannel === 'beta' ? 'beta' : 'stable',
        autoCheck: true,
        autoDownload: false,
        checkIntervalHours: 12
      });
    }
  }]);
};

const ensureEmergencyRunning = (): void => {
  if (emergencyStopped) {
    throw new Error('NeuraCo est suspendu par l’arrêt d’urgence. Reprenez les agents pour continuer.');
  }
};

const currentEmergencyState = (terminalsStopped = 0, agentsStopped = 0) => ({
  stopped: emergencyStopped,
  stoppedAt: emergencyStoppedAt,
  terminalsStopped,
  agentsStopped
});

const appendEmergencyLog = async (event: string, details: unknown): Promise<void> => {
  const directory = path.join(app.getPath('userData'), 'logs');
  await mkdir(directory, { recursive: true });
  await appendFile(
    path.join(directory, 'emergency.jsonl'),
    `${JSON.stringify({ timestamp: new Date().toISOString(), event, details })}\n`,
    'utf8'
  );
};

const triggerEmergencyStop = async (source: string) => {
  emergencyStopped = true;
  emergencyStoppedAt = new Date().toISOString();
  const backgroundStopped = backgroundProcessService
    ? await backgroundProcessService.stopAll(true)
    : 0;
  const terminalsStopped = terminalTasks.size + backgroundStopped;
  const agentsStopped = agentControllers.size + (studioService?.cancelAll() ?? 0);
  for (const task of terminalTasks.values()) task.cancel();
  for (const controller of agentControllers.values()) controller.abort();
  browserService?.hide();
  getApplicationService().stopAll();
  const state = currentEmergencyState(terminalsStopped, agentsStopped);
  await appendEmergencyLog('emergency_stop', { source, ...state }).catch((error) => {
    console.error('NeuraCo emergency log failed', error);
  });
  await audit({
    projectId: activeProject?.id,
    category: 'security',
    action: 'emergency_stop',
    status: 'completed',
    summary: 'Arrêt d’urgence déclenché.',
    details: { source, terminalsStopped, agentsStopped }
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.emergencyEvent, state);
  }
  return state;
};

const checkpointApplicationState = async (
  project: NeuraCoProject,
  threadId?: string,
  taskSettings?: NeuraCoCheckpointTaskSettings
) => {
  const conversation = await getLocalSessionStore()
    .snapshot(project, threadId)
    .catch(() => undefined);
  return {
    conversation,
    taskSettings: taskSettings || conversation?.taskSettings
  };
};

const createProjectCheckpointWithContext = async (
  project: NeuraCoProject,
  reason: string,
  trigger: NeuraCoCheckpointTrigger,
  threadId?: string,
  taskSettings?: NeuraCoCheckpointTaskSettings,
  preserveCheckpointIds?: string[]
) => getRecoveryService().createProjectCheckpoint(project, reason, {
  trigger,
  preserveCheckpointIds,
  ...await checkpointApplicationState(project, threadId, taskSettings)
});

const createFileCheckpointWithContext = async (
  project: NeuraCoProject,
  relativePath: string,
  reason: string
) => getRecoveryService().createFileCheckpoint(project, relativePath, reason, {
  trigger: 'important_change',
  ...await checkpointApplicationState(project)
});

const backgroundWorkingDirectory = async (
  project: NeuraCoProject,
  requested?: string
): Promise<string> => {
  const candidate = requested?.trim()
    ? path.resolve(project.rootPath, requested.trim())
    : path.resolve(project.rootPath);
  const root = path.resolve(project.rootPath);
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const normalizedCandidate = process.platform === 'win32'
    ? candidate.toLowerCase()
    : candidate;
  if (
    normalizedCandidate !== normalizedRoot
    && !normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error('Le dossier du processus doit rester dans le projet actif.');
  }
  const info = await stat(candidate);
  if (!info.isDirectory()) throw new Error('Le dossier de travail est invalide.');
  return candidate;
};

const authorizeArtifactMutation = async (
  label: string,
  detail?: string
): Promise<void> => {
  if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
  const allowed = await authorizeProjectAction({
    action: 'write_file',
    detail: detail || path.join(activeProject.rootPath, '.neuraco-artifacts', label),
    software: 'Artefacts NeuraCo',
    file: label,
    risk: 'Une version HTML isolée sera créée ou modifiée dans l’espace NeuraCo.',
    reason: 'Conserver un artefact interactif séparément de la conversation.',
    estimatedCost: '0 crédit IA'
  });
  if (!allowed) throw new Error('Modification de l’artefact refusée.');
};

const emergencyShortcutPath = () => (
  path.join(app.getPath('userData'), 'emergency-shortcut.json')
);

const registerEmergencyShortcut = async (accelerator: string): Promise<string> => {
  const normalized = accelerator.trim();
  if (
    normalized.length < 5
    || normalized.length > 100
    || !/(CommandOrControl|Ctrl|Alt|Shift|Super|Meta)\+/i.test(normalized)
  ) {
    throw new Error('Le raccourci doit contenir au moins une touche de modification.');
  }
  const previous = emergencyShortcut;
  globalShortcut.unregister(previous);
  if (!globalShortcut.register(normalized, () => {
    void triggerEmergencyStop('global_shortcut');
  })) {
    globalShortcut.register(previous, () => {
      void triggerEmergencyStop('global_shortcut');
    });
    throw new Error('Ce raccourci global est déjà utilisé par Windows ou une autre application.');
  }
  emergencyShortcut = normalized;
  await writeFile(
    emergencyShortcutPath(),
    JSON.stringify({ accelerator: normalized }),
    'utf8'
  );
  return emergencyShortcut;
};

const loadEmergencyShortcut = async (): Promise<void> => {
  try {
    const parsed = JSON.parse(await readFile(emergencyShortcutPath(), 'utf8')) as {
      accelerator?: unknown;
    };
    if (typeof parsed.accelerator === 'string') {
      await registerEmergencyShortcut(parsed.accelerator);
      return;
    }
  } catch {
    // Use the secure default if the setting is absent or invalid.
  }
  if (!globalShortcut.register(emergencyShortcut, () => {
    void triggerEmergencyStop('global_shortcut');
  })) {
    console.error('NeuraCo emergency shortcut could not be registered');
  }
};

interface PermissionPrompt {
  action: NeuraCoPermissionAction;
  detail: string;
  software: string;
  file?: string;
  command?: string;
  risk: string;
  reason: string;
  estimatedCost: string;
}

const authorizeProjectAction = async (prompt: PermissionPrompt): Promise<boolean> => {
  if (!mainWindow || !activeProject) return false;
  const permissions = await getPermissionStore().get(
    activeProject.id,
    activeProject.rootPath
  );
  if (
    permissionAllowsWithoutPrompt(
      permissions,
      prompt.action,
      prompt.detail,
      sessionAllowedSignatures
    )
  ) {
    return true;
  }
  if (
    permissionRefusesWithoutPrompt(
      permissions,
      prompt.action,
      prompt.detail,
      sessionAllowedSignatures
    )
  ) {
    await audit({
      projectId: activeProject.id,
      category: 'permission',
      action: 'action_refused_by_mode',
      status: 'refused',
      summary: `${prompt.action} refusée automatiquement par le mode ${permissions.mode}.`,
      details: {
        application: prompt.software,
        command: prompt.command,
        fileRead: prompt.file,
        risk: prompt.risk,
        reason: prompt.reason
      }
    });
    return false;
  }

  const sensitiveAction = (
    prompt.action === 'terminal'
    && isSensitiveTerminalCommand(prompt.detail)
  );
  const allowOnlyOnce = sensitiveAction || permissions.mode === 'accept_edits';
  const details = [
    `Action : ${prompt.action}`,
    `Logiciel : ${prompt.software}`,
    prompt.action === 'network'
      ? `Domaine : ${normalizeNetworkDomain(prompt.detail) || 'invalide'}`
      : null,
    prompt.file ? `Fichier : ${prompt.file}` : null,
    prompt.command ? `Commande : ${prompt.command}` : null,
    `Risque : ${prompt.risk}`,
    `Raison : ${prompt.reason}`,
    `Coût estimé : ${prompt.estimatedCost}`
  ].filter(Boolean).join('\n');
  const buttons = allowOnlyOnce
    ? ['Autoriser une seule fois', 'Refuser']
    : [
        'Autoriser une seule fois',
        'Autoriser pour cette session',
        'Toujours autoriser cette action',
        'Refuser'
      ];
  const permissionNotification = await notify({
    project: activeProject,
    kind: 'permission_request',
    severity: sensitiveAction ? 'critical' : 'warning',
    title: `Autorisation requise · ${prompt.software}`,
    body:
      `${prompt.reason}\nAction : ${prompt.action}. Risque : ${prompt.risk}. `
      + 'Ouvrez NeuraCo pour vérifier les détails avant de décider.',
    target: 'chat',
    actions: ['authorize', 'refuse'],
    sensitive: true
  });
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: sensitiveAction ? 'warning' : 'question',
    title: sensitiveAction
      ? 'Confirmation sensible obligatoire'
      : 'Autorisation NeuraCo',
    message: sensitiveAction
      ? 'Cette action reste protégée quel que soit le mode actif.'
      : 'NeuraCo demande votre autorisation.',
    detail: details,
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    noLink: true
  });
  if (confirmation.response === buttons.length - 1) {
    if (permissionNotification) {
      await getNotificationService().markRead(
        activeProject.id,
        permissionNotification.id
      ).catch(() => undefined);
    }
    await audit({
      projectId: activeProject.id,
      category: 'permission',
      action: 'action_refused',
      status: 'refused',
      summary: `${prompt.action} refusée pour ${prompt.software}.`,
      details: {
        application: prompt.software,
        domain: prompt.action === 'network'
          ? normalizeNetworkDomain(prompt.detail)
          : undefined,
        command: prompt.command,
        fileRead: prompt.file,
        risk: prompt.risk,
        reason: prompt.reason
      }
    });
    return false;
  }

  if (permissionNotification) {
    await getNotificationService().markRead(
      activeProject.id,
      permissionNotification.id
    ).catch(() => undefined);
  }
  const signature = permissionSignature(prompt.action, prompt.detail);
  if (!allowOnlyOnce && confirmation.response === 1) {
    sessionAllowedSignatures.add(signature);
  } else if (!allowOnlyOnce && confirmation.response === 2) {
    await getPermissionStore().allowSignature(
      activeProject.id,
      activeProject.rootPath,
      signature
    );
  }
  await audit({
    projectId: activeProject.id,
    category: 'permission',
    action: 'action_allowed',
    status: 'completed',
    summary: `${prompt.action} autorisée pour ${prompt.software}.`,
    details: {
      application: prompt.software,
      command: prompt.command,
      fileRead: prompt.file,
      risk: prompt.risk,
      scope: confirmation.response
    }
  });
  return true;
};

const runEnvironmentPreparationForTarget = async (
  project: NeuraCoProject,
  target: NeuraCoEnvironmentTarget,
  reason: string
) => {
  const preview = await getEnvironmentPreparationService().preview(
    project.id,
    target
  );
  if (!preview.compatible) {
    throw new Error(
      `Préparation incompatible : ${
        preview.blockedReasons.join(' ') || 'configuration inactive.'
      }`
    );
  }
  const allowed = await authorizeProjectAction({
    action: 'terminal',
    detail: preview.script,
    software: preview.shell || 'Shell de préparation',
    command: preview.script,
    risk: preview.warnings.join(' '),
    reason,
    estimatedCost: '0 crédit IA'
  });
  if (!allowed) throw new Error('Script de préparation refusé.');
  if (commandNeedsProjectCheckpoint(preview.script)) {
    await createProjectCheckpointWithContext(
      project,
      `Avant la préparation de l’environnement : ${preview.script.slice(0, 140)}`,
      checkpointTriggerForCommand(preview.script)
    );
  }
  const execution = await getEnvironmentPreparationService().run(
    project.id,
    target
  );
  await audit({
    taskId: execution.id,
    projectId: project.id,
    category: 'terminal',
    action: 'environment_preparation_executed',
    status: execution.status === 'completed' ? 'completed' : 'failed',
    summary:
      `Préparation ${execution.status === 'completed' ? 'terminée' : 'échouée'} `
      + `dans ${target.kind}.`,
    details: {
      target,
      shell: execution.shell,
      exitCode: execution.exitCode,
      durationMs: execution.durationMs,
      secretsInjected: false
    }
  });
  return execution;
};

const secureWebPreferences: WebPreferences = Object.freeze({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  devTools: !app.isPackaged
});

const appInfo = (): NeuraCoAppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
  architecture: process.arch,
  packaged: app.isPackaged
});

const connectivityState = () => ({
  online: net.isOnline(),
  checkedAt: new Date().toISOString(),
  source: 'system' as const
});

const ensureRemoteAiAvailable = (): void => {
  if (!net.isOnline()) {
    throw new Error(
      'Connexion Internet nécessaire pour utiliser les fonctions IA distantes. '
      + 'Les projets, l’éditeur, le terminal, Git, l’historique, les différences, '
      + 'les checkpoints et la recherche locale restent disponibles hors ligne.'
    );
  }
};

const sendRemoteAgentMessage = (
  ...args: Parameters<typeof sendAgentMessage>
): ReturnType<typeof sendAgentMessage> => {
  ensureRemoteAiAvailable();
  return sendAgentMessage(...args);
};

const securityReport = (): NeuraCoSelfCheck => {
  const checks = {
    contextIsolation: secureWebPreferences.contextIsolation === true,
    nodeIntegrationDisabled: secureWebPreferences.nodeIntegration === false,
    sandboxEnabled: secureWebPreferences.sandbox === true,
    navigationGuardEnabled
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checkedAt: new Date().toISOString(),
    checks
  };
};

const ensureTrustedSender = (senderUrl: string): void => {
  if (mainWindow?.webContents.getURL() !== senderUrl) {
    throw new Error('Emetteur IPC non autorise');
  }
};

const registerIpcHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return appInfo();
  });

  ipcMain.handle(IPC_CHANNELS.connectivityGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return connectivityState();
  });

  ipcMain.handle(IPC_CHANNELS.accessibilityGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getAccessibilityService().get();
  });

  ipcMain.handle(
    IPC_CHANNELS.accessibilityUpdate,
    async (event, update: NeuraCoAccessibilitySettingsUpdate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      const settings = await getAccessibilityService().update(update || {});
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setZoomFactor(settings.zoomPercent / 100);
      }
      return settings;
    }
  );

  ipcMain.handle(IPC_CHANNELS.runSelfCheck, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return securityReport();
  });

  ipcMain.handle(IPC_CHANNELS.authRestore, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return activateAuthenticatedSessionWithAudit('session_restored', restoreSession);
  });

  ipcMain.handle(
    IPC_CHANNELS.authLogin,
    (event, credentials: NeuraCoLoginCredentials) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return activateAuthenticatedSessionWithAudit(
        'password_login',
        () => loginWithPassword(credentials)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.authRegister,
    (event, registration: NeuraCoRegistration) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return activateAuthenticatedSessionWithAudit(
        'registration',
        () => registerWithPassword(registration)
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.authGoogle, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return activateAuthenticatedSessionWithAudit('google_login', loginWithGoogle);
  });

  ipcMain.handle(IPC_CHANNELS.authLogout, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    getDeviceSecurityService().stop();
    await ideBridgeService?.stop();
    const session = await logout();
    await audit({
      category: 'connection',
      action: 'logout',
      status: 'completed',
      summary: 'Session NeuraCo fermée sur cet appareil.'
    });
    return session;
  });

  ipcMain.handle(IPC_CHANNELS.accountGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getAccount();
  });

  ipcMain.handle(IPC_CHANNELS.accountSessionRevoke, (event, sessionId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return revokeAccountSession(String(sessionId || ''));
  });

  ipcMain.handle(IPC_CHANNELS.accountSessionsRevokeOthers, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return revokeOtherAccountSessions();
  });

  ipcMain.handle(IPC_CHANNELS.accountVerificationRequest, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return requestEmailVerification();
  });

  ipcMain.handle(IPC_CHANNELS.accountVerificationConfirm, (event, token: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return confirmEmailVerification(String(token || ''));
  });

  ipcMain.handle(IPC_CHANNELS.accountPasswordResetRequest, (event, email: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return requestPasswordReset(String(email || ''));
  });

  ipcMain.handle(
    IPC_CHANNELS.accountPasswordResetConfirm,
    (event, email: string, token: string, newPassword: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return confirmPasswordReset(
        String(email || ''),
        String(token || ''),
        String(newPassword || '')
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.accountTwoFactorSetup, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return setupTwoFactor();
  });

  ipcMain.handle(IPC_CHANNELS.accountTwoFactorEnable, (event, code: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return enableTwoFactor(String(code || ''));
  });

  ipcMain.handle(IPC_CHANNELS.accountTwoFactorDisable, (event, code: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return disableTwoFactor(String(code || ''));
  });

  ipcMain.handle(
    IPC_CHANNELS.accountPrivacyUpdate,
    (event, settings: NeuraCoPrivacySettings) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return updatePrivacySettings(settings);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.accountDelete,
    async (event, request: NeuraCoAccountDeletionRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Supprimer définitivement le compte',
        message: 'Cette action supprime le compte et les données cloud NeuraCo.',
        detail:
          'Les conversations, projets cloud, mémoires et sessions seront supprimés. '
          + 'Les écritures de facturation obligatoires seront conservées sans identité directe.',
        buttons: ['Supprimer définitivement', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (confirmation.response !== 0) {
        throw new Error('Suppression annulée.');
      }
      const result = await deleteAccount(request);
      getDeviceSecurityService().stop();
      await ideBridgeService?.stop();
      await audit({
        category: 'privacy',
        action: 'account_deleted',
        status: 'completed',
        summary: 'Compte et données cloud supprimés à la demande de l’utilisateur.'
      });
      await logout();
      return result;
    }
  );

  ipcMain.handle(IPC_CHANNELS.technicalErrorsList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getTechnicalErrorLogService().list();
  });

  ipcMain.handle(IPC_CHANNELS.technicalErrorsClear, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    await getTechnicalErrorLogService().clear();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.appLockGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getAppLockService().state();
  });

  ipcMain.handle(
    IPC_CHANNELS.appLockSetPin,
    (event, pin: string, currentPin?: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getAppLockService().setPin(
        String(pin || ''),
        currentPin === undefined ? undefined : String(currentPin)
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.appLockRemovePin, (event, currentPin: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getAppLockService().removePin(String(currentPin || ''));
  });

  ipcMain.handle(
    IPC_CHANNELS.appLockSettings,
    (event, update: NeuraCoAppLockSettingsUpdate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getAppLockService().updateSettings(update);
    }
  );

  ipcMain.handle(IPC_CHANNELS.appLockLock, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getAppLockService().lock('manual');
  });

  ipcMain.handle(IPC_CHANNELS.appLockUnlockPin, (event, pin: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getAppLockService().unlockWithPin(String(pin || ''));
  });

  ipcMain.handle(
    IPC_CHANNELS.appLockWindowsHelloEnable,
    async (event, enabled: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!enabled) return getAppLockService().setWindowsHelloEnabled(false);
      const availability = await checkWindowsHelloAvailability();
      getAppLockService().setWindowsHelloAvailability(availability);
      if (availability !== 'available') {
        throw new Error('Windows Hello n’est pas disponible sur cet appareil.');
      }
      const verified = await requestWindowsHelloVerification(
        'Confirmer l’activation de Windows Hello dans NeuraCo'
      );
      if (!verified) throw new Error('Activation Windows Hello annulée ou refusée.');
      return getAppLockService().setWindowsHelloEnabled(true);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.appLockWindowsHelloUnlock,
    async (event) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      const verified = await requestWindowsHelloVerification(
        'Déverrouiller NeuraCo'
      );
      if (!verified) throw new Error('Vérification Windows Hello refusée.');
      return getAppLockService().unlockWithWindowsHello();
    }
  );

  ipcMain.handle(IPC_CHANNELS.securityDevicesList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getDeviceSecurityService().list();
  });

  ipcMain.handle(
    IPC_CHANNELS.securityDeviceRevoke,
    (event, deviceId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getDeviceSecurityService().revoke(String(deviceId || ''));
    }
  );

  ipcMain.handle(IPC_CHANNELS.projectOpen, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Ouvrir un projet dans NeuraCo',
      buttonLabel: 'Ouvrir ce dossier',
      properties: ['openDirectory', 'createDirectory']
    });
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    activeProject = await openProjectRoot(selection.filePaths[0]);
    sessionAllowedSignatures.clear();
    const snapshot = await scanProjectCached(activeProject, { force: true });
    await audit({
      projectId: activeProject.id,
      category: 'project',
      action: 'project_opened',
      status: 'completed',
      summary: `Projet ouvert : ${activeProject.name}`,
      details: { indexedFiles: snapshot.indexedFiles }
    });
    void getRoutineService().trigger('app_open', {
      projectId: activeProject.id,
      projectName: activeProject.name
    }).catch((error) => {
      console.error('NeuraCo app-open routines failed', error);
    });
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.projectCreate, async (event, name: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fen\u00eatre NeuraCo indisponible.');
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Choisir le dossier parent du nouveau projet',
      buttonLabel: 'Cr\u00e9er le projet ici',
      properties: ['openDirectory', 'createDirectory']
    });
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    activeProject = await createProjectRoot(selection.filePaths[0], name);
    sessionAllowedSignatures.clear();
    const snapshot = await scanProjectCached(activeProject, { force: true });
    await audit({
      projectId: activeProject.id,
      category: 'project',
      action: 'project_created',
      status: 'completed',
      summary: `Projet cr\u00e9\u00e9 : ${activeProject.name}`,
      details: { indexedFiles: snapshot.indexedFiles }
    });
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.projectClone, async (event, repositoryUrl: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fen\u00eatre NeuraCo indisponible.');
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Choisir o\u00f9 cloner le d\u00e9p\u00f4t Git',
      buttonLabel: 'Cloner dans ce dossier',
      properties: ['openDirectory', 'createDirectory']
    });
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    activeProject = await cloneGitRepository(selection.filePaths[0], repositoryUrl);
    sessionAllowedSignatures.clear();
    const snapshot = await scanProjectCached(activeProject, { force: true });
    await audit({
      projectId: activeProject.id,
      category: 'project',
      action: 'project_cloned',
      status: 'completed',
      summary: `D\u00e9p\u00f4t clon\u00e9 : ${activeProject.name}`,
      details: { indexedFiles: snapshot.indexedFiles }
    });
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.projectRefresh, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return activeProject
      ? scanProjectCached(activeProject, { force: true })
      : null;
  });

  ipcMain.handle(IPC_CHANNELS.projectValidate, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n\u2019est ouvert.');
    const allowed = await authorizeProjectAction({
      action: 'read_file',
      detail: activeProject.rootPath,
      software: 'Validateur de projet NeuraCo',
      file: activeProject.name,
      risk: 'Lecture des chemins et des manifestes du projet ouvert uniquement.',
      reason: 'Verifier la structure du projet et les references FiveM avant export.',
      estimatedCost: '0 credit IA'
    });
    if (!allowed) throw new Error('Validation refusee par les autorisations du projet.');
    const validation = await validateProjectPackage(activeProject);
    await audit({
      projectId: activeProject.id,
      category: 'project',
      action: 'project_validated',
      status: validation.valid ? 'completed' : 'failed',
      summary: validation.valid
        ? `Projet valide : ${validation.fileCount} fichier(s).`
        : `Validation terminee avec ${validation.errors.length} erreur(s).`,
      details: {
        kind: validation.kind,
        errors: validation.errors,
        warnings: validation.warnings,
        excludedEntries: validation.excludedEntries
      }
    });
    return validation;
  });

  ipcMain.handle(IPC_CHANNELS.projectExportZip, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject || !mainWindow) throw new Error('Aucun projet n\u2019est ouvert.');
    const project = activeProject;
    const allowed = await authorizeProjectAction({
      action: 'read_file',
      detail: project.rootPath,
      software: 'Export ZIP NeuraCo',
      file: project.name,
      risk: 'Lecture et compression des fichiers non sensibles du projet ouvert.',
      reason: 'Creer une archive installable ou partageable du projet selectionne.',
      estimatedCost: '0 credit IA'
    });
    if (!allowed) throw new Error('Export refuse par les autorisations du projet.');
    const validation = await validateProjectPackage(project);
    if (!validation.valid) {
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Erreurs detectees avant export',
        message: `${validation.errors.length} erreur(s) ont ete detectee(s) dans le projet.`,
        detail: [
          ...validation.errors.slice(0, 8),
          validation.errors.length > 8
            ? `... et ${validation.errors.length - 8} autre(s) erreur(s).`
            : ''
        ].filter(Boolean).join('\n'),
        buttons: ['Exporter malgre les erreurs', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (confirmation.response !== 0) return { canceled: true, validation };
    }
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter le projet NeuraCo en ZIP',
      buttonLabel: 'Creer le ZIP',
      defaultPath: path.join(
        app.getPath('downloads'),
        projectArchiveDefaultName(project.name)
      ),
      filters: [{ name: 'Archive ZIP', extensions: ['zip'] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true, validation };
    const destinationPath = selection.filePath.toLowerCase().endsWith('.zip')
      ? selection.filePath
      : `${selection.filePath}.zip`;
    const result = await exportProjectPackage(project, destinationPath, validation);
    await audit({
      projectId: project.id,
      category: 'project',
      action: 'project_exported_zip',
      status: 'completed',
      summary: `Archive ZIP creee avec ${result.fileCount} fichier(s).`,
      details: {
        fileCreated: result.filePath,
        filesRead: result.fileCount,
        excludedEntries: result.excludedEntries,
        sha256: result.sha256,
        validation: result.validation.valid
      }
    });
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.projectReadFile, async (event, relativePath: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const allowed = await authorizeProjectAction({
      action: 'read_file',
      detail: path.resolve(activeProject.rootPath, relativePath),
      software: 'Éditeur NeuraCo',
      file: relativePath,
      risk: 'Lecture du contenu d’un fichier local.',
      reason: 'Afficher le fichier demandé dans l’éditeur du projet.',
      estimatedCost: '0 crédit IA'
    });
    if (!allowed) throw new Error('Lecture refusée par les autorisations du projet.');
    const file = await readProjectTextFile(activeProject, relativePath);
    void audit({
      projectId: activeProject.id,
      category: 'file',
      action: 'file_read',
      status: 'completed',
      summary: `Fichier consulté : ${file.relativePath}`,
      details: { fileRead: file.relativePath }
    });
    return file;
  });

  ipcMain.handle(
    IPC_CHANNELS.projectSaveFile,
    async (event, relativePath: string, content: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      ensureEmergencyRunning();
      const allowed = await authorizeProjectAction({
        action: 'write_file',
        detail: path.resolve(activeProject.rootPath, relativePath),
        software: 'Éditeur NeuraCo',
        file: relativePath,
        risk: 'Modification du contenu du fichier local.',
        reason: 'Enregistrer les changements demandés dans le projet ouvert.',
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Enregistrement refusé par l’utilisateur.');
      await enforceHooks('before_modification', {
        file: relativePath,
        content: String(content || '').slice(0, 20_000)
      }, activeProject);
      await createFileCheckpointWithContext(
        activeProject,
        relativePath,
        `Avant l’enregistrement de ${relativePath}`
      );
      const saved = await withCriticalOperation(() => (
        writeProjectTextFile(activeProject!, relativePath, content)
      ));
      await audit({
        projectId: activeProject.id,
        category: 'file',
        action: 'file_saved',
        status: 'completed',
        summary: `Fichier enregistré : ${saved.relativePath}`,
        details: {
          fileModified: saved.relativePath,
          checkpoint: `Avant l’enregistrement de ${relativePath}`
        }
      });
      await enforceHooks('after_modification', {
        file: saved.relativePath,
        status: 'saved'
      }, activeProject);
      void getRoutineService().trigger('file_change', {
        projectId: activeProject.id,
        filePath: saved.relativePath
      }).catch((error) => {
        console.error('NeuraCo file-change routines failed', error);
      });
      return saved;
    }
  );

  ipcMain.handle(IPC_CHANNELS.terminalStart, async (event, request) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
    ensureEmergencyRunning();
    const command = validateTerminalCommand(request?.command);
    const assessment = assessTerminalCommand(command);
    await enforceHooks('before_command', { command }, activeProject);
    const allowed = await authorizeProjectAction({
      action: 'terminal',
      detail: command,
      software: 'Terminal Windows',
      command,
      risk: assessment.reason,
      reason: 'Exécuter la commande demandée dans le dossier du projet.',
      estimatedCost: '0 crédit IA'
    });
    if (!allowed) return { accepted: false };
    if (commandNeedsProjectCheckpoint(command)) {
      await createProjectCheckpointWithContext(
        activeProject,
        `Avant la commande : ${command.slice(0, 180)}`,
        checkpointTriggerForCommand(command)
      );
    }

    const sender = event.sender;
    const taskProject = activeProject;
    let terminalOutput = '';
    const task = await startTerminalTask(
      activeProject.rootPath,
      command,
      (terminalEvent) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.terminalEvent, terminalEvent);
        if (
          (terminalEvent.type === 'stdout' || terminalEvent.type === 'stderr')
          && terminalEvent.chunk
        ) {
          terminalOutput = `${terminalOutput}${terminalEvent.chunk}`.slice(-20_000);
        }
        if (['completed', 'cancelled', 'error'].includes(terminalEvent.type)) {
          const isTest = /\b(test|pytest|vitest|jest|ctest)\b/i.test(command);
          const passed = terminalEvent.type === 'completed' && terminalEvent.exitCode === 0;
          void audit({
            taskId: terminalEvent.commandId,
            projectId: taskProject.id,
            category: isTest ? 'test' : 'terminal',
            action: `terminal_${terminalEvent.type}`,
            status: terminalEvent.type === 'completed'
              ? (terminalEvent.exitCode === 0 ? 'completed' : 'failed')
              : terminalEvent.type === 'cancelled' ? 'cancelled' : 'failed',
            summary: terminalEvent.type === 'completed'
              ? `Commande terminée avec le code ${terminalEvent.exitCode}.`
              : terminalEvent.message || `Commande ${terminalEvent.type}.`,
            details: {
              command,
              durationMs: terminalEvent.durationMs,
              exitCode: terminalEvent.exitCode,
              output: terminalOutput,
              checkpoint: commandNeedsProjectCheckpoint(command)
                ? `Avant la commande : ${command.slice(0, 180)}`
                : undefined
            },
            evidence: terminalEvent.type === 'cancelled' ? undefined : {
              id: `${terminalEvent.commandId}-result`,
              source: 'machine',
              kind: isTest ? 'test_result' : 'terminal_log',
              status: passed ? 'passed' : 'failed',
              title: isTest ? 'Résultat de test local' : 'Journal de commande locale',
              summary: passed
                ? 'La commande s’est terminée avec un code de sortie nul.'
                : `La commande s’est terminée avec le code ${terminalEvent.exitCode ?? 'inconnu'}.`,
              capturedAt: new Date().toISOString(),
              command,
              exitCode: terminalEvent.exitCode,
              durationMs: terminalEvent.durationMs,
              output: terminalOutput
            }
          });
          runPostHooks('after_command', {
            taskId: terminalEvent.commandId,
            command,
            status: terminalEvent.type,
            metadata: {
              exitCode: terminalEvent.exitCode,
              durationMs: terminalEvent.durationMs
            }
          }, taskProject);
        }
      },
      request?.timeoutMs,
      {
        terminalId: request?.terminalId,
        profileId: request?.profileId,
        target: request?.target
      }
    );
    terminalTasks.set(task.id, task);
    void audit({
      taskId: task.id,
      projectId: taskProject.id,
      category: 'terminal',
      action: 'terminal_started',
      status: 'started',
      summary: 'Commande locale démarrée.',
      details: { command }
    });
    void task.completion.finally(() => terminalTasks.delete(task.id));
    return { accepted: true, commandId: task.id };
  });

  ipcMain.handle(IPC_CHANNELS.terminalCancel, (event, commandId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const task = terminalTasks.get(commandId);
    if (!task) return false;
    task.cancel();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.terminalProfiles, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return listTerminalProfiles();
  });

  ipcMain.handle(IPC_CHANNELS.terminalAssess, (event, rawCommand: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return assessTerminalCommand(validateTerminalCommand(rawCommand));
  });

  ipcMain.handle(IPC_CHANNELS.backgroundProcessesList, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getBackgroundProcessService().list(activeProject.id);
  });

  ipcMain.handle(
    IPC_CHANNELS.backgroundProcessStart,
    async (event, request: NeuraCoBackgroundProcessRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      ensureEmergencyRunning();
      const command = validateTerminalCommand(request?.command);
      const workingDirectory = await backgroundWorkingDirectory(
        activeProject,
        request?.workingDirectory
      );
      const allowed = await authorizeProjectAction({
        action: 'terminal',
        detail: command,
        software: 'Gestionnaire de processus NeuraCo',
        command,
        risk: isSensitiveTerminalCommand(command)
          ? 'Commande persistante sensible ou potentiellement destructive.'
          : 'La commande peut rester active après la fermeture de sa vue.',
        reason: 'Lancer un processus de longue durée dans le projet actif.',
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Lancement du processus refusé.');
      if (commandNeedsProjectCheckpoint(command)) {
        await createProjectCheckpointWithContext(
          activeProject,
          `Avant le processus : ${command.slice(0, 180)}`,
          checkpointTriggerForCommand(command)
        );
      }
      const started = await getBackgroundProcessService().start(
        activeProject,
        { ...request, command },
        workingDirectory
      );
      await audit({
        taskId: started.id,
        projectId: activeProject.id,
        category: 'terminal',
        action: 'background_process_started',
        status: 'started',
        summary: `Processus démarré : ${started.name}.`,
        details: {
          command: started.command,
          agent: started.agent,
          processId: started.pid,
          port: started.port
        }
      });
      return started;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.backgroundProcessControl,
    async (
      event,
      processId: string,
      action: NeuraCoBackgroundProcessAction
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      if (action === 'restart') ensureEmergencyRunning();
      const processes = await getBackgroundProcessService().list(activeProject.id);
      const target = processes.find((item) => item.id === processId);
      if (!target) throw new Error('Processus absent du projet actif.');
      await backgroundWorkingDirectory(activeProject, target.workingDirectory);
      if (action === 'restart') {
        const allowed = await authorizeProjectAction({
          action: 'terminal',
          detail: target.command,
          software: 'Gestionnaire de processus NeuraCo',
          command: target.command,
          risk: isSensitiveTerminalCommand(target.command)
            ? 'Redémarrage d’une commande sensible.'
            : 'Le processus sera relancé dans son dossier de travail.',
          reason: `Redémarrer ${target.name}.`,
          estimatedCost: '0 crédit IA'
        });
        if (!allowed) throw new Error('Redémarrage refusé.');
      }
      const updated = await getBackgroundProcessService().control(
        processId,
        action
      );
      await audit({
        taskId: processId,
        projectId: activeProject.id,
        category: 'terminal',
        action: `background_process_${action}`,
        status: 'completed',
        summary: `${action} appliqué à ${updated.name}.`,
        details: {
          command: updated.command,
          processId: updated.pid,
          state: updated.state
        }
      });
      return updated;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.backgroundProcessLog,
    async (event, processId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const processes = await getBackgroundProcessService().list(activeProject.id);
      if (!processes.some((item) => item.id === processId)) {
        throw new Error('Processus absent du projet actif.');
      }
      return getBackgroundProcessService().log(processId);
    }
  );

  ipcMain.handle(IPC_CHANNELS.artifactsList, (event, includeDeleted?: boolean) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getArtifactService().list(activeProject.id, includeDeleted === true);
  });

  ipcMain.handle(IPC_CHANNELS.artifactGet, (event, artifactId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getArtifactService().get(activeProject.id, artifactId);
  });

  ipcMain.handle(
    IPC_CHANNELS.artifactCreate,
    async (event, input: NeuraCoArtifactCreate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      ensureEmergencyRunning();
      await authorizeArtifactMutation(String(input?.title || 'Nouvel artefact'));
      const constrainedInput: NeuraCoArtifactCreate = {
        ...input,
        sources: input?.sources?.map((source) => (
          source.access === 'mutating'
            ? { ...source, authorized: false }
            : source
        ))
      };
      const artifact = await getArtifactService().create(
        activeProject,
        constrainedInput
      );
      await audit({
        projectId: activeProject.id,
        category: 'file',
        action: 'artifact_created',
        status: 'completed',
        summary: `Artefact créé : ${artifact.title}.`,
        details: {
          artifactId: artifact.id,
          version: artifact.currentVersionId,
          sources: artifact.sources
        }
      });
      return artifact;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.artifactUpdate,
    async (event, artifactId: string, input: NeuraCoArtifactUpdate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      ensureEmergencyRunning();
      await authorizeArtifactMutation(String(artifactId || 'Artefact'));
      const constrainedInput: NeuraCoArtifactUpdate = {
        ...input,
        sources: input?.sources?.map((source) => (
          source.access === 'mutating'
            ? { ...source, authorized: false }
            : source
        ))
      };
      const artifact = await getArtifactService().update(
        activeProject.id,
        artifactId,
        constrainedInput
      );
      await audit({
        projectId: activeProject.id,
        category: 'file',
        action: 'artifact_version_created',
        status: 'completed',
        summary: `Nouvelle version de ${artifact.title}.`,
        details: {
          artifactId,
          version: artifact.currentVersionId
        }
      });
      return artifact;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.artifactRename,
    async (event, artifactId: string, title: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      ensureEmergencyRunning();
      await authorizeArtifactMutation(String(artifactId || 'Artefact'));
      return getArtifactService().rename(activeProject.id, artifactId, title);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.artifactDelete,
    async (event, artifactId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
      ensureEmergencyRunning();
      const artifact = await getArtifactService().get(activeProject.id, artifactId);
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Supprimer cet artefact',
        message: `Masquer « ${artifact.title} » de la liste active ?`,
        detail:
          'Les versions restent conservées localement. Aucune publication externe ne sera effectuée.',
        buttons: ['Supprimer', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (confirmation.response !== 0) throw new Error('Suppression annulée.');
      await authorizeArtifactMutation(artifact.title);
      return getArtifactService().delete(activeProject.id, artifactId);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.artifactRestoreVersion,
    async (event, artifactId: string, versionId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      ensureEmergencyRunning();
      await authorizeArtifactMutation(String(artifactId || 'Artefact'));
      return getArtifactService().restoreVersion(
        activeProject.id,
        artifactId,
        versionId
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.artifactCompare,
    (
      event,
      artifactId: string,
      fromVersionId: string,
      toVersionId: string
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getArtifactService().compare(
        activeProject.id,
        artifactId,
        fromVersionId,
        toVersionId
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.artifactExport,
    async (event, artifactId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
      const artifact = await getArtifactService().get(activeProject.id, artifactId);
      const safeName = artifact.title
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .slice(0, 100) || 'artefact-neuraco';
      const selection = await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter l’artefact HTML',
        defaultPath: path.join(app.getPath('documents'), `${safeName}.html`),
        filters: [{ name: 'Page HTML', extensions: ['html'] }]
      });
      if (selection.canceled || !selection.filePath) return null;
      await authorizeArtifactMutation(artifact.title, selection.filePath);
      await getArtifactService().export(
        activeProject.id,
        artifactId,
        selection.filePath
      );
      await audit({
        projectId: activeProject.id,
        category: 'file',
        action: 'artifact_exported',
        status: 'completed',
        summary: `Artefact exporté : ${artifact.title}.`,
        details: { fileModified: selection.filePath, artifactId }
      });
      return selection.filePath;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.nativeDocumentPreview,
    (event, draft: NeuraCoNativeDocumentDraft) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return previewNativeDocument(draft);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.nativeDocumentExport,
    async (
      event,
      draft: NeuraCoNativeDocumentDraft,
      previewId: string
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
      if (
        !/^[a-f0-9]{64}$/.test(String(previewId || ''))
        || nativeDocumentDigest(draft) !== previewId
      ) {
        throw new Error('Le document doit être prévisualisé après sa dernière modification.');
      }
      const info = nativeDocumentInfo(draft.format);
      const safeName = String(draft.title || 'document-neuraco')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .slice(0, 100) || 'document-neuraco';
      const selection = await dialog.showSaveDialog(mainWindow, {
        title: `Exporter le document ${draft.format.toUpperCase()}`,
        defaultPath: path.join(
          app.getPath('documents'),
          `${safeName}.${info.extension}`
        ),
        filters: [{
          name: `${draft.format.toUpperCase()} natif`,
          extensions: [info.extension]
        }]
      });
      if (selection.canceled || !selection.filePath) return null;
      await authorizeArtifactMutation(draft.title, selection.filePath);
      const exported = await writeNativeDocument(draft, selection.filePath);
      await audit({
        projectId: activeProject.id,
        category: 'file',
        action: 'native_document_exported',
        status: 'completed',
        summary: `Document ${draft.format.toUpperCase()} exporté : ${draft.title}.`,
        details: {
          fileModified: exported.path,
          format: exported.format,
          mimeType: exported.mimeType,
          size: exported.size,
          sha256: exported.sha256
        },
        evidence: {
          id: randomUUID(),
          source: 'machine',
          kind: 'artifact_report',
          status: 'passed',
          title: `Document ${draft.format.toUpperCase()} natif`,
          summary: `${exported.size} octets écrits et vérifiés.`,
          capturedAt: exported.createdAt,
          output: exported.sha256,
          metadata: {
            path: exported.path,
            format: exported.format,
            mimeType: exported.mimeType
          }
        }
      });
      return exported;
    }
  );

  ipcMain.handle(IPC_CHANNELS.controlledMemoryList, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return enrichControlledMemoryState(
      activeProject,
      await getControlledMemoryService().list(activeProject.id)
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.controlledMemoryObserve,
    async (event, input: NeuraCoControlledMemoryObservation) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const previous = await getControlledMemoryService().list(activeProject.id);
      const state = await getControlledMemoryService().observe(
        activeProject,
        String(input?.content || '').slice(0, 40_000),
        typeof input?.sourceThreadId === 'string'
          ? input.sourceThreadId.slice(0, 160)
          : undefined
      );
      if (state.pendingCount > previous.pendingCount) {
        await audit({
          projectId: activeProject.id,
          category: 'security',
          action: 'controlled_memory_suggested',
          status: 'completed',
          summary: 'Une préférence a été proposée, sans être activée.',
          details: {
            pendingCount: state.pendingCount,
            sourceThreadId: input?.sourceThreadId
          }
        });
      }
      return enrichControlledMemoryState(activeProject, state);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.controlledMemoryUpdate,
    async (
      event,
      memoryId: string,
      input: NeuraCoControlledMemoryUpdate
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const state = await getControlledMemoryService().update(
        activeProject,
        String(memoryId || ''),
        input || {}
      );
      await audit({
        projectId: activeProject.id,
        category: 'security',
        action: input?.status === 'active'
          ? 'controlled_memory_approved'
          : input?.status === 'disabled'
            ? 'controlled_memory_disabled'
            : 'controlled_memory_updated',
        status: 'completed',
        summary: 'Mémoire contrôlée mise à jour.',
        details: {
          memoryId,
          scope: input?.scope,
          category: input?.category,
          memoryStatus: input?.status
        }
      });
      return enrichControlledMemoryState(activeProject, state);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.controlledMemoryDelete,
    async (event, memoryId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const state = await getControlledMemoryService().delete(
        activeProject.id,
        String(memoryId || '')
      );
      await audit({
        projectId: activeProject.id,
        category: 'security',
        action: 'controlled_memory_deleted',
        status: 'completed',
        summary: 'Mémoire contrôlée supprimée.',
        details: { memoryId }
      });
      return enrichControlledMemoryState(activeProject, state);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.controlledMemorySetEnabled,
    async (event, enabled: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      if (typeof enabled !== 'boolean') {
        throw new Error('État global de la mémoire invalide.');
      }
      const state = await getControlledMemoryService().setEnabled(
        activeProject.id,
        enabled
      );
      await audit({
        projectId: activeProject.id,
        category: 'security',
        action: enabled
          ? 'controlled_memory_enabled'
          : 'controlled_memory_disabled_globally',
        status: 'completed',
        summary: enabled
          ? 'Mémoire contrôlée activée.'
          : 'Mémoire contrôlée désactivée.'
      });
      return enrichControlledMemoryState(activeProject, state);
    }
  );

  ipcMain.handle(IPC_CHANNELS.controlledMemoryExport, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject || !mainWindow) {
      throw new Error('Projet ou fenêtre NeuraCo indisponible.');
    }
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter les mémoires contrôlées',
      defaultPath: path.join(
        app.getPath('documents'),
        'neuraco-memoires-controlees.json'
      ),
      filters: [{ name: 'Données JSON', extensions: ['json'] }]
    });
    if (selection.canceled || !selection.filePath) return null;
    const state = await getControlledMemoryService().exportAll();
    await writeFile(selection.filePath, JSON.stringify({
      exportedAt: new Date().toISOString(),
      projectId: activeProject.id,
      projectName: activeProject.name,
      ...state
    }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await audit({
      projectId: activeProject.id,
      category: 'security',
      action: 'controlled_memory_exported',
      status: 'completed',
      summary: 'Mémoires contrôlées exportées.',
      details: { fileCreated: selection.filePath }
    });
    return selection.filePath;
  });

  ipcMain.handle(IPC_CHANNELS.extensionsState, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getExtensionService().state();
  });

  ipcMain.handle(IPC_CHANNELS.extensionInstallLocal, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Installer une compétence ou un plugin local',
      properties: ['openDirectory']
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    let state = await getExtensionService().installFromDirectory(
      selection.filePaths[0]
    );
    const installed = state.extensions.find((extension) => (
      path.resolve(extension.sourcePath) === path.resolve(selection.filePaths[0])
    ));
    if (!installed) throw new Error('Extension installée introuvable.');
    try {
      await assertExtensionAllowedByServer(installed);
    } catch (error) {
      await getExtensionService().remove(installed.id);
      throw error;
    }
    const permissions = [
      `Fichiers : ${installed.permissions.files.join(', ') || 'aucun'}`,
      `Réseau : ${installed.permissions.network.join(', ') || 'aucun'}`,
      `Commandes : ${installed.permissions.commands.join(', ') || 'aucune'}`,
      `Données : ${installed.permissions.data.join(', ') || 'aucune'}`,
      `Intégrité : ${installed.integrity}`,
      `Confiance : ${installed.trust}`
    ].join('\n');
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: installed.trust === 'unsigned' ? 'warning' : 'question',
      title: `Activer ${installed.name} ?`,
      message: 'Examinez les permissions déclarées avant activation.',
      detail: permissions,
      buttons: ['Activer', 'Garder désactivée'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response === 0) {
      state = await getExtensionService().setEnabled(installed.id, true);
    }
    await audit({
      projectId: activeProject?.id,
      category: 'plugin',
      action: 'extension_installed',
      status: 'completed',
      summary: `Extension installée : ${installed.name}.`,
      details: {
        extensionId: installed.id,
        extensionKind: installed.kind,
        trust: installed.trust,
        enabled: confirmation.response === 0
      }
    });
    if (
      activeProject
      && (installed.trust === 'unsigned' || installed.warnings.length > 0)
    ) {
      await notify({
        project: activeProject,
        kind: 'plugin_suspicious',
        severity: installed.trust === 'unsigned' ? 'critical' : 'warning',
        title: `Plugin à vérifier : ${installed.name}`,
        body: installed.warnings.length
          ? installed.warnings.join(' · ')
          : 'Ce plugin local n’est pas signé. Vérifiez sa source et ses permissions avant activation.',
        target: 'protection',
        actions: ['open'],
        sensitive: true,
        dedupeKey: `plugin-suspicious-${installed.id}-${installed.integrity}`
      });
    }
    return state;
  });

  ipcMain.handle(
    IPC_CHANNELS.extensionUpdate,
    async (event, extensionId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      const state = await getExtensionService().update(String(extensionId || ''));
      const updated = state.extensions.find((entry) => entry.id === extensionId);
      if (!updated) throw new Error('Updated extension not found.');
      try {
        await assertExtensionAllowedByServer(updated);
      } catch (error) {
        await getExtensionService().remove(updated.id);
        throw error;
      }
      await audit({
        projectId: activeProject?.id,
        category: 'plugin',
        action: 'extension_updated',
        status: 'completed',
        summary: `Extension mise à jour : ${extensionId}.`
      });
      return state;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.extensionSetEnabled,
    async (event, extensionId: string, enabled: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (typeof enabled !== 'boolean') throw new Error('État d’extension invalide.');
      if (enabled) {
        const current = await getExtensionService().state();
        const extension = current.extensions.find((entry) => entry.id === extensionId);
        if (!extension) throw new Error('Extension not found.');
        await assertExtensionAllowedByServer(extension);
      }
      const state = await getExtensionService().setEnabled(
        String(extensionId || ''),
        enabled
      );
      await audit({
        projectId: activeProject?.id,
        category: 'plugin',
        action: enabled ? 'extension_enabled' : 'extension_disabled',
        status: 'completed',
        summary: `Extension ${enabled ? 'activée' : 'désactivée'} : ${extensionId}.`
      });
      return state;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.extensionToolSetEnabled,
    async (
      event,
      extensionId: string,
      toolId: string,
      enabled: boolean
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (typeof enabled !== 'boolean') throw new Error('État d’outil invalide.');
      if (enabled) {
        const current = await getExtensionService().state();
        const extension = current.extensions.find((entry) => entry.id === extensionId);
        if (!extension) throw new Error('Extension not found.');
        await assertExtensionAllowedByServer(extension);
      }
      return getExtensionService().setToolEnabled(
        String(extensionId || ''),
        String(toolId || ''),
        enabled
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.extensionRemove,
    async (event, extensionId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
      const state = await getExtensionService().state();
      const extension = state.extensions.find((entry) => entry.id === extensionId);
      if (!extension) throw new Error('Extension introuvable.');
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Supprimer cette extension ?',
        message: extension.name,
        detail: 'Le paquet géré par NeuraCo sera supprimé. Le dossier source reste intact.',
        buttons: ['Annuler', 'Supprimer'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (confirmation.response !== 1) return state;
      const updated = await getExtensionService().remove(extensionId);
      await audit({
        projectId: activeProject?.id,
        category: 'plugin',
        action: 'extension_removed',
        status: 'completed',
        summary: `Extension supprimée : ${extension.name}.`
      });
      return updated;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcpServerAdd,
    async (event, input: NeuraCoMcpServerInput) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      const state = await getExtensionService().addMcpServer(input);
      await audit({
        projectId: activeProject?.id,
        category: 'connection',
        action: 'mcp_server_configured',
        status: 'completed',
        summary: `Serveur MCP configuré : ${String(input?.name || '')}.`,
        details: { transport: input?.transport }
      });
      return state;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcpServerTest,
    async (event, serverId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
      const current = await getExtensionService().state();
      const server = current.mcpServers.find((entry) => entry.id === serverId);
      if (!server) throw new Error('Serveur MCP introuvable.');
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Tester la connexion MCP ?',
        message: server.name,
        detail: server.transport === 'stdio'
          ? `NeuraCo va lancer sans shell : ${server.command} ${(server.args || []).join(' ')}`
          : `NeuraCo va contacter : ${server.url}`,
        buttons: ['Annuler', 'Tester'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (confirmation.response !== 1) return current;
      const state = await getExtensionService().testMcpServer(serverId);
      await audit({
        projectId: activeProject?.id,
        category: 'connection',
        action: 'mcp_server_tested',
        status: 'completed',
        summary: `Connexion MCP vérifiée : ${server.name}.`,
        details: {
          transport: server.transport,
          tools: state.mcpServers.find((entry) => entry.id === serverId)?.tools.length
        }
      });
      return state;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcpServerSetEnabled,
    async (event, serverId: string, enabled: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (typeof enabled !== 'boolean') throw new Error('État MCP invalide.');
      return getExtensionService().setMcpEnabled(String(serverId || ''), enabled);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcpToolSetEnabled,
    async (
      event,
      serverId: string,
      toolName: string,
      enabled: boolean
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (typeof enabled !== 'boolean') throw new Error('État d’outil MCP invalide.');
      return getExtensionService().setMcpToolEnabled(
        String(serverId || ''),
        String(toolName || ''),
        enabled
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.mcpServerRemove,
    async (event, serverId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      return getExtensionService().removeMcpServer(String(serverId || ''));
    }
  );

  ipcMain.handle(IPC_CHANNELS.hooksState, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getHookService().state();
  });

  ipcMain.handle(
    IPC_CHANNELS.hookSave,
    async (event, input: NeuraCoHookInput) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const state = await getHookService().save(input, activeProject.id);
      await audit({
        projectId: activeProject.id,
        category: 'security',
        action: 'hook_saved',
        status: 'completed',
        summary: `Hook enregistré : ${String(input?.name || '')}.`
      });
      return state;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.hookSetEnabled,
    async (event, hookId: string, enabled: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (typeof enabled !== 'boolean') throw new Error('État de hook invalide.');
      return getHookService().setEnabled(String(hookId || ''), enabled);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.hookDelete,
    async (event, hookId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      return getHookService().delete(String(hookId || ''));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.hookTest,
    async (event, hookId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getHookService().test(String(hookId || ''), activeProject);
    }
  );

  ipcMain.handle(IPC_CHANNELS.routinesState, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getRoutineService().state();
  });

  ipcMain.handle(
    IPC_CHANNELS.routineSave,
    async (event, input: NeuraCoRoutineInput) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const projectIds = Array.isArray(input?.projectIds) && input.projectIds.length > 0
        ? input.projectIds
        : [activeProject.id];
      let cloudConsent = input?.cloudConsent === true;
      if (input?.executionMode === 'cloud') {
        if (!mainWindow) throw new Error('Consentement cloud indisponible.');
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Routine cloud facultative',
          message: 'Autoriser cette routine à être envoyée au service cloud NeuraCo ?',
          detail:
            'Le cloud ne reçoit aucun accès au disque local. '
            + 'Seule l’instruction explicitement configurée est transmise.',
          buttons: ['Refuser', 'Autoriser le cloud'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        });
        cloudConsent = confirmation.response === 1;
        if (!cloudConsent) throw new Error('Routine cloud refusée.');
      }
      const state = await getRoutineService().save({
        ...input,
        projectIds,
        cloudConsent
      });
      await audit({
        projectId: activeProject.id,
        category: 'security',
        action: input?.id ? 'routine_updated' : 'routine_created',
        status: 'completed',
        summary: `Routine ${String(input?.name || '').slice(0, 120)} enregistrée.`,
        details: {
          routineId: input?.id,
          trigger: input?.schedule?.trigger,
          executionMode: input?.executionMode,
          budgetCredits: input?.budgetCredits
        }
      });
      return state;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.routineSetEnabled,
    async (event, routineId: string, enabled: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      const state = await getRoutineService().setEnabled(
        String(routineId || ''),
        enabled === true
      );
      await audit({
        projectId: activeProject?.id,
        category: 'security',
        action: enabled ? 'routine_enabled' : 'routine_disabled',
        status: 'completed',
        summary: `Routine ${enabled ? 'activée' : 'désactivée'}.`,
        details: { routineId }
      });
      return state;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.routineDelete,
    async (event, routineId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      return getRoutineService().delete(String(routineId || ''));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.routineRun,
    async (event, routineId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      return getRoutineService().runManual(String(routineId || ''));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.routineTrigger,
    async (
      event,
      trigger: NeuraCoRoutineTrigger,
      metadata?: Record<string, unknown>
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (trigger !== 'api') {
        throw new Error('Seul le déclencheur API est accepté par ce canal.');
      }
      return getRoutineService().trigger('api', {
        ...(metadata || {}),
        projectId: activeProject?.id
      });
    }
  );

  ipcMain.handle(IPC_CHANNELS.agentChat, async (event, request) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (request?.scope === 'general') {
      if (!isGeneralChatRequest(request)) {
        throw new Error(
          'La conversation générale ne peut pas accéder aux fichiers du projet.'
        );
      }
      const requestId = typeof request.requestId === 'string'
        ? request.requestId
        : randomUUID();
      const controller = new AbortController();
      agentControllers.set(requestId, controller);
      try {
        return await sendRemoteAgentMessage(
          { ...request, requestId },
          controller.signal
        );
      } finally {
        agentControllers.delete(requestId);
      }
    }
    if (!activeProject || request?.projectId !== activeProject.id) {
      throw new Error('Le projet NeuraCo actif ne correspond pas à la demande.');
    }
    const requestId = typeof request?.requestId === 'string'
      ? request.requestId
      : randomUUID();
    const controller = new AbortController();
    agentControllers.set(requestId, controller);
    const taskProject = activeProject;
    try {
      await enforceHooks('before_instruction', {
        taskId: requestId,
        instruction: String(request?.content || '').slice(0, 20_000)
      }, taskProject);
      const recoveryContext = await captureTaskRecoveryContext(taskProject);
      await getTaskRecoveryService().start({
        id: requestId,
        project: taskProject,
        kind: 'agent',
        objective: String(request?.content || ''),
        agents: ['Assistant principal'],
        budgetAllocated: 0,
        permissionMode: recoveryContext.permissions.mode,
        allowedActions: recoveryContext.permissions.allowedActions,
        checkpointIds: recoveryContext.checkpointIds,
        projectState: recoveryContext.projectState,
        worktrees: recoveryContext.worktrees,
        files: Array.isArray(request?.files)
          ? request.files.map((file: { path?: string }) => String(file.path || '')).filter(Boolean)
          : []
      });
      await audit({
        taskId: requestId,
        projectId: taskProject.id,
        category: 'agent',
        action: 'task_started',
        status: 'started',
        summary: String(request?.content || '').slice(0, 500),
        details: {
          agent: 'Assistant principal',
          files: Array.isArray(request?.files)
            ? request.files.map((file: { path?: string }) => file.path).filter(Boolean)
            : [],
          images: Array.isArray(request?.images) ? request.images.length : 0
        }
      });
      const response = await sendRemoteAgentMessage(
        {
          ...request,
          requestId,
          content: await appendAgentContext(
            taskProject,
            request?.content,
            request?.effort,
            request?.communicationStyle
          )
        },
        controller.signal
      );
      await enforceHooks('task_completed', {
        taskId: requestId,
        status: 'completed',
        metadata: {
          provider: response.provider,
          model: response.model,
          filesUsed: response.filesUsed
        }
      }, taskProject);
      await audit({
        taskId: requestId,
        projectId: taskProject.id,
        category: 'agent',
        action: 'task_completed',
        status: 'completed',
        summary: `Réponse produite avec ${response.modelDisplay}.`,
        details: {
          agent: 'Assistant principal',
          provider: response.provider,
          model: response.model,
          creditsConsumed: response.usage?.credits_consumed || 0,
          inputTokens: response.usage?.input_tokens || 0,
          cachedInputTokens: response.usage?.cached_input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0,
          durationMs: response.usage?.duration_ms || 0,
          filesRead: response.filesUsed
        }
      });
      await getTaskRecoveryService().complete(requestId, {
        summary: response.message,
        files: response.filesUsed,
        creditsConsumed: response.usage?.credits_consumed || 0
      }).catch((error) => {
        console.error('NeuraCo recoverable task completion failed', error);
      });
      await notify({
        project: taskProject,
        kind: 'task_completed',
        severity: 'success',
        title: 'Tâche terminée',
        body: `L’assistant principal a terminé la tâche avec ${response.modelDisplay}.`,
        taskId: requestId,
        target: 'review',
        actions: ['open'],
        dedupeKey: `task-completed-${requestId}`
      });
      publishUsageSummary(event.sender, taskProject);
      return response;
    } catch (error) {
      runPostHooks('on_error', {
        taskId: requestId,
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : 'Tâche IA interrompue.'
      }, taskProject);
      await getTaskRecoveryService().interrupt(
        requestId,
        error instanceof Error ? error.message : 'Tâche IA interrompue.'
      ).catch((recoveryError) => {
        console.error('NeuraCo recoverable task interruption failed', recoveryError);
      });
      await audit({
        taskId: requestId,
        projectId: taskProject.id,
        category: 'agent',
        action: 'task_failed',
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        summary: error instanceof Error ? error.message : 'Tâche IA interrompue.',
        details: { agent: 'Assistant principal' }
      });
      await notify({
        project: taskProject,
        kind: 'task_failed',
        severity: 'critical',
        title: controller.signal.aborted ? 'Tâche interrompue' : 'Tâche échouée',
        body: error instanceof Error ? error.message : 'La tâche IA a échoué.',
        taskId: requestId,
        target: 'protection',
        actions: ['open'],
        dedupeKey: `task-failed-${requestId}`
      });
      throw error;
    } finally {
      agentControllers.delete(requestId);
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentStream, async (event, request) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!isGeneralChatRequest(request)) {
      throw new Error('La diffusion directe est réservée à la conversation générale NeuraCo.');
    }
    const requestId = typeof request?.requestId === 'string' ? request.requestId : randomUUID();
    const controller = new AbortController();
    agentControllers.set(requestId, controller);
    const sender = event.sender;
    try {
      return await streamAgentMessage(
        { ...request, requestId },
        (streamEvent) => {
          if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.agentStreamEvent, streamEvent);
        },
        controller.signal
      );
    } finally {
      agentControllers.delete(requestId);
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentCancel, async (event, requestId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const safeRequestId = String(requestId || '').trim();
    if (!safeRequestId) throw new Error('Identifiant de tâche manquant.');
    const controller = agentControllers.get(safeRequestId);
    if (!controller) return false;
    controller.abort(new Error('Tâche redirigée par l’utilisateur.'));
    if (!activeProject) return true;
    await audit({
      taskId: safeRequestId,
      projectId: activeProject.id,
      category: 'agent',
      action: 'task_redirect_requested',
      status: 'cancelled',
      summary: 'Interruption ciblée demandée avant redirection.',
      details: { agent: 'Assistant principal' }
    });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.localSessionGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getLocalSessionStore().get(activeProject);
  });

  ipcMain.handle(
    IPC_CHANNELS.localSessionSave,
    (event, session: NeuraCoLocalSessionSave) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getLocalSessionStore().save(activeProject, session);
    }
  );

  ipcMain.handle(IPC_CHANNELS.localSessionClear, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getLocalSessionStore().clear(activeProject);
  });

  ipcMain.handle(IPC_CHANNELS.generalSessionGet, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const existing = await getLocalSessionStore().get(GENERAL_CHAT_PROJECT);
    if (existing) return existing;
    return getLocalSessionStore().save(GENERAL_CHAT_PROJECT, {
      executionMode: 'local',
      messages: []
    });
  });

  ipcMain.handle(
    IPC_CHANNELS.generalSessionSave,
    (event, session: NeuraCoLocalSessionSave) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getLocalSessionStore().save(GENERAL_CHAT_PROJECT, session);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.generalThreadsList,
    (event, includeArchived?: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getLocalSessionStore().list(GENERAL_CHAT_PROJECT, Boolean(includeArchived));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.generalThreadCreate,
    (event, request?: NeuraCoConversationThreadCreate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getLocalSessionStore().create(GENERAL_CHAT_PROJECT, request || {});
    }
  );

  ipcMain.handle(IPC_CHANNELS.generalThreadSelect, (event, threadId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getLocalSessionStore().select(GENERAL_CHAT_PROJECT, threadId);
  });

  ipcMain.handle(
    IPC_CHANNELS.generalThreadRename,
    (event, threadId: string, title: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getLocalSessionStore().rename(GENERAL_CHAT_PROJECT, threadId, title);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.generalThreadArchive,
    (event, threadId: string, archived: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getLocalSessionStore().archive(
        GENERAL_CHAT_PROJECT,
        threadId,
        Boolean(archived)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadsList,
    (event, includeArchived?: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getLocalSessionStore().list(activeProject, Boolean(includeArchived));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadCreate,
    async (event, request?: NeuraCoConversationThreadCreate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const thread = await getLocalSessionStore().create(activeProject, request || {});
      await audit({
        taskId: thread.threadId,
        projectId: activeProject.id,
        category: 'conversation',
        action: thread.parentThreadId ? 'thread_forked' : 'thread_created',
        status: 'completed',
        summary: thread.title,
        details: {
          parentThreadId: thread.parentThreadId,
          checkpointId: thread.checkpointId
        }
      });
      return thread;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadSelect,
    (event, threadId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getLocalSessionStore().select(activeProject, threadId);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadRename,
    async (event, threadId: string, title: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const thread = await getLocalSessionStore().rename(activeProject, threadId, title);
      await audit({
        taskId: thread.threadId,
        projectId: activeProject.id,
        category: 'conversation',
        action: 'thread_renamed',
        status: 'completed',
        summary: thread.title
      });
      return thread;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadArchive,
    async (event, threadId: string, archived: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const threads = await getLocalSessionStore().archive(
        activeProject,
        threadId,
        Boolean(archived)
      );
      await audit({
        taskId: threadId,
        projectId: activeProject.id,
        category: 'conversation',
        action: archived ? 'thread_archived' : 'thread_unarchived',
        status: 'completed',
        summary: archived ? 'Fil archivé.' : 'Fil désarchivé.'
      });
      return threads;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadExport,
    async (event, threadId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject || !mainWindow) {
        throw new Error('Projet ou fenêtre NeuraCo indisponible.');
      }
      const summaries = await getLocalSessionStore().list(activeProject, true);
      const summary = summaries.find((thread) => thread.threadId === threadId);
      if (!summary) throw new Error('Fil de conversation NeuraCo introuvable.');
      const safeTitle = summary.title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'conversation';
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter le fil NeuraCo',
        defaultPath: `neuraco-${safeTitle}.md`,
        filters: [{ name: 'Conversation Markdown', extensions: ['md'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const markdown = await getLocalSessionStore().exportMarkdown(
        activeProject,
        threadId
      );
      await writeFile(result.filePath, markdown, 'utf8');
      await audit({
        taskId: threadId,
        projectId: activeProject.id,
        category: 'conversation',
        action: 'thread_exported',
        status: 'completed',
        summary: 'Fil de conversation exporté.',
        details: { fileCreated: result.filePath }
      });
      return { canceled: false, filePath: result.filePath };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadClearMemory,
    async (event, threadId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Effacer la mémoire de ce fil',
        message: 'Effacer toute la mémoire de ce fil NeuraCo ?',
        detail: 'Le projet et ses fichiers ne seront pas modifiés. Cette action efface uniquement la conversation locale ciblée.',
        buttons: ['Annuler', 'Effacer la mémoire'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (confirmation.response !== 1) {
        throw new Error('Effacement de la mémoire annulé.');
      }
      const thread = await getLocalSessionStore().clearMemory(activeProject, threadId);
      await audit({
        taskId: threadId,
        projectId: activeProject.id,
        category: 'conversation',
        action: 'thread_memory_cleared',
        status: 'completed',
        summary: 'Mémoire locale du fil effacée.'
      });
      return thread;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadFork,
    async (event, threadId: string, fromMessageId?: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const thread = await getLocalSessionStore().fork(
        activeProject,
        threadId,
        fromMessageId
      );
      await audit({
        taskId: thread.threadId,
        projectId: activeProject.id,
        category: 'conversation',
        action: 'thread_forked',
        status: 'completed',
        summary: thread.title,
        details: {
          parentThreadId: thread.parentThreadId,
          fromMessageId: thread.forkedFromMessageId
        }
      });
      return thread;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadRewind,
    async (event, threadId: string, messageId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Revenir à ce point',
        message: 'Revenir à ce point de la conversation ?',
        detail: 'Les messages suivants seront retirés de ce fil. Les fichiers du projet ne seront pas modifiés.',
        buttons: ['Annuler', 'Revenir à ce point'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (confirmation.response !== 1) {
        throw new Error('Retour au point précédent annulé.');
      }
      return getLocalSessionStore().rewind(activeProject, threadId, messageId);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationThreadCheckpoint,
    (event, threadId: string, checkpointId?: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getLocalSessionStore().attachCheckpoint(
        activeProject,
        threadId,
        checkpointId
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.secondaryConversationsList,
    (event, parentThreadId?: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getSecondaryConversationService().list(
        activeProject.id,
        parentThreadId
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.secondaryConversationCreate,
    async (event, input: NeuraCoSecondaryConversationCreate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const parentThread = (await getLocalSessionStore().list(activeProject, true))
        .find((thread) => thread.threadId === input?.parentThreadId);
      if (!parentThread) throw new Error('Le fil principal lié est introuvable.');
      const conversation = await getSecondaryConversationService().create(
        activeProject.id,
        input
      );
      await audit({
        taskId: conversation.linkedTaskId || conversation.id,
        projectId: activeProject.id,
        category: 'conversation',
        action: 'secondary_conversation_created',
        status: 'completed',
        summary: conversation.title,
        details: {
          conversationId: conversation.id,
          parentThreadId: conversation.parentThreadId
        }
      });
      return conversation;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.secondaryConversationChat,
    async (
      event,
      request: NeuraCoSecondaryConversationMessageRequest
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject || request?.projectId !== activeProject.id) {
        throw new Error('Le projet NeuraCo actif ne correspond pas à la demande.');
      }
      const service = getSecondaryConversationService();
      const existing = await service.get(activeProject.id, request.conversationId);
      const content = String(request.content || '').trim();
      if (!content) throw new Error('La question secondaire ne peut pas être vide.');
      const withUserMessage = await service.append(
        activeProject.id,
        existing.id,
        {
          id: randomUUID(),
          role: 'user',
          content
        }
      );
      const requestId = `secondary_${randomUUID()}`;
      const controller = new AbortController();
      agentControllers.set(requestId, controller);
      try {
        const protectedPrompt = [
          'MODE CONVERSATION SECONDAIRE — ANALYSE UNIQUEMENT.',
          'Cette conversation est liée à une mission principale, mais elle ne doit',
          'jamais modifier, rediriger, arrêter ou exécuter cette mission.',
          'Réponds uniquement à la question, explique ou examine la solution.',
          'Ne prétends pas avoir modifié des fichiers ou exécuté une action.',
          'Une réponse ne deviendra une instruction officielle que si l’utilisateur',
          'utilise explicitement le bouton prévu dans NeuraCo.',
          '',
          `Question secondaire : ${content}`
        ].join('\n');
        const response = await sendRemoteAgentMessage({
          content: await appendAgentContext(
            activeProject,
            protectedPrompt,
            request.effort,
            request.communicationStyle
          ),
          requestId,
          projectId: activeProject.id,
          projectName: activeProject.name,
          mode: 'question',
          model: request.model || 'auto',
          effort: request.effort,
          communicationStyle: request.communicationStyle,
          conversationContext: withUserMessage.messages.slice(-20),
          files: [],
          images: []
        }, controller.signal);
        const updated = await service.append(activeProject.id, existing.id, {
          id: randomUUID(),
          role: 'assistant',
          content: response.message,
          model: `${response.modelDisplay} · ${response.provider}`,
          files: response.filesUsed
        });
        await audit({
          taskId: existing.linkedTaskId || requestId,
          projectId: activeProject.id,
          category: 'conversation',
          action: 'secondary_conversation_answered',
          status: 'completed',
          summary: `Réponse secondaire produite avec ${response.modelDisplay}.`,
          details: {
            conversationId: existing.id,
            parentThreadId: existing.parentThreadId,
            provider: response.provider,
            model: response.model
          }
        });
        publishUsageSummary(event.sender, activeProject);
        return updated;
      } finally {
        agentControllers.delete(requestId);
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.secondaryConversationArchive,
    async (event, conversationId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const conversations = await getSecondaryConversationService().archive(
        activeProject.id,
        conversationId
      );
      await audit({
        taskId: conversationId,
        projectId: activeProject.id,
        category: 'conversation',
        action: 'secondary_conversation_archived',
        status: 'completed',
        summary: 'Conversation secondaire archivée.'
      });
      return conversations;
    }
  );

  ipcMain.handle(IPC_CHANNELS.environmentsDiscover, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const [gitStatus, cloudAvailable] = await Promise.all([
      getGitService().status(activeProject).catch(() => null),
      getUsage().then(() => true).catch(() => false)
    ]);
    return getEnvironmentTransferService().discover(
      activeProject.rootPath,
      gitStatus?.worktrees || [],
      cloudAvailable
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.environmentTransferPreview,
    async (event, target: NeuraCoEnvironmentTarget) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const snapshot = await buildEnvironmentTransferSnapshot(activeProject);
      return getEnvironmentTransferService().preview(target, snapshot);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.environmentTransferExecute,
    async (event, target: NeuraCoEnvironmentTarget) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const taskProject = activeProject;
      const snapshot = await buildEnvironmentTransferSnapshot(taskProject);
      const record = await getEnvironmentTransferService().transfer(
        target,
        snapshot
      );
      await audit({
        taskId: record.id,
        projectId: taskProject.id,
        category: 'security',
        action: 'environment_session_transferred',
        status: 'completed',
        summary: `Session transférée vers ${record.target.kind}.`,
        details: {
          target: record.target,
          manifestLocation: record.manifestLocation,
          remoteLocation: record.remoteLocation,
          preserved: record.preserved,
          secretsCopied: false
        }
      });
      const preparation = await getEnvironmentPreparationService().get(
        taskProject.id
      );
      if (preparation.enabled && preparation.runOnTransfer) {
        try {
          const execution = await runEnvironmentPreparationForTarget(
            taskProject,
            record.target,
            'Préparer la cible après le transfert vérifié de la session.'
          );
          await notify({
            project: taskProject,
            kind: 'task_completed',
            severity: 'success',
            title: 'Environnement préparé',
            body:
              `Le script de préparation s’est terminé en ${execution.durationMs} ms `
              + `dans ${record.target.kind}.`,
            target: 'environments',
            sensitive: false
          });
        } catch (error) {
          await notify({
            project: taskProject,
            kind: 'task_failed',
            severity: 'warning',
            title: 'Préparation non exécutée',
            body: error instanceof Error ? error.message : 'Préparation indisponible.',
            target: 'environments',
            sensitive: true
          });
        }
      }
      return record;
    }
  );

  ipcMain.handle(IPC_CHANNELS.environmentTransfersList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getEnvironmentTransferService().list(activeProject.id);
  });

  ipcMain.handle(IPC_CHANNELS.remoteConnectionsDiscover, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getRemoteConnectionService().discover();
  });

  ipcMain.handle(IPC_CHANNELS.remoteConnectionChooseKey, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choisir une clé privée SSH locale',
      properties: ['openFile'],
      filters: [
        { name: 'Clés SSH', extensions: ['pem', 'key', 'ppk', 'pub'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle(
    IPC_CHANNELS.remoteConnectionAction,
    async (event, request: NeuraCoRemoteActionRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const allowed = await authorizeProjectAction({
        action: request.action === 'read_file' || request.action === 'list_files'
          ? 'read_file'
          : request.action === 'connect' || request.action === 'inspect'
            ? 'network'
            : 'terminal',
        detail: `${request.kind}:${request.target}:${request.action}`,
        software: request.kind === 'ssh'
          ? 'OpenSSH local'
          : request.kind === 'wsl2'
            ? 'WSL2 local'
            : 'Docker local',
        command: request.command || request.action,
        file: request.path,
        risk: 'Cette action s’exécute dans la cible distante sélectionnée.',
        reason: 'Gérer explicitement l’environnement distant depuis NeuraCo.',
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Action distante refusée par l’utilisateur.');
      const result = await getRemoteConnectionService().run(request);
      await audit({
        projectId: activeProject.id,
        category: 'connection',
        action: `remote_${request.action}`,
        status: result.ok ? 'completed' : 'failed',
        summary: `${request.kind.toUpperCase()} ${request.action} : ${request.target}.`,
        details: {
          kind: request.kind,
          target: request.target,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          keyStayedLocal: true
        }
      });
      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.remoteConnectionDisconnect,
    async (event, connectionId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      const disconnected = getRemoteConnectionService().disconnect(
        String(connectionId || '')
      );
      await audit({
        projectId: activeProject?.id,
        category: 'connection',
        action: 'remote_disconnected',
        status: disconnected ? 'completed' : 'failed',
        summary: disconnected
          ? 'Connexion distante fermée proprement.'
          : 'Connexion distante déjà fermée.'
      });
      return disconnected;
    }
  );

  ipcMain.handle(IPC_CHANNELS.environmentPreparationGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getEnvironmentPreparationService().get(activeProject.id);
  });

  ipcMain.handle(
    IPC_CHANNELS.environmentPreparationUpdate,
    async (event, update: NeuraCoEnvironmentPreparationUpdate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const config = await getEnvironmentPreparationService().update(
        activeProject.id,
        update
      );
      await audit({
        projectId: activeProject.id,
        category: 'security',
        action: 'environment_preparation_updated',
        status: 'completed',
        summary: config.enabled
          ? 'Script de préparation sécurisé activé.'
          : 'Script de préparation désactivé.',
        details: {
          enabled: config.enabled,
          runOnWorktree: config.runOnWorktree,
          runOnTransfer: config.runOnTransfer,
          timeoutSeconds: config.timeoutSeconds,
          scriptLength: config.script.length
        }
      });
      return config;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.environmentPreparationPreview,
    async (event, target: NeuraCoEnvironmentTarget) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getEnvironmentPreparationService().preview(activeProject.id, target);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.environmentPreparationRun,
    async (event, target: NeuraCoEnvironmentTarget) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return runEnvironmentPreparationForTarget(
        activeProject,
        target,
        'Préparer explicitement le nouvel environnement avec le script affiché.'
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.environmentPreparationHistory,
    (event, limit?: number) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getEnvironmentPreparationService().listExecutions(
        activeProject.id,
        limit
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.hostedSitesList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getHostedSiteService().list(activeProject.id);
  });

  ipcMain.handle(
    IPC_CHANNELS.hostedSitePreview,
    async (event, request: NeuraCoHostedSiteRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const preview = await getHostedSiteService().preview(activeProject, request);
      await audit({
        taskId: preview.id,
        projectId: activeProject.id,
        category: 'deployment',
        action: 'hosted_site_previewed',
        status: 'completed',
        summary:
          `${preview.name} analysé avant ${preview.visibility === 'public'
            ? 'publication'
            : 'aperçu local'}.`,
        details: {
          provider: preview.provider,
          visibility: preview.visibility,
          files: preview.files,
          totalBytes: preview.totalBytes,
          plannedAddress: preview.plannedAddress,
          environmentVariables: preview.environmentVariables,
          estimatedCredits: preview.estimatedCredits,
          hostingDuration: preview.hostingDurationLabel,
          authorizedPeople: preview.authorizedPeople
        }
      });
      return preview;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.hostedSiteStartPreview,
    async (event, previewId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const preview = getHostedSiteService().getPreview(previewId);
      if (preview.projectId !== activeProject.id) {
        throw new Error('Cette prévisualisation appartient à un autre projet.');
      }
      return getHostedSiteService().startPreview(previewId);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.hostedSiteStopPreview,
    (event, previewId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getHostedSiteService().stopPreview(previewId);
    }
  );

  ipcMain.handle(IPC_CHANNELS.hostedSiteProviderStatus, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getHostedSiteService().providerStatus();
  });

  ipcMain.handle(
    IPC_CHANNELS.hostedSiteDeploy,
    async (event, previewId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!mainWindow || !activeProject) {
        throw new Error('Aucun projet n’est ouvert.');
      }
      const taskProject = activeProject;
      const service = getHostedSiteService();
      const preview = service.getPreview(previewId);
      if (preview.projectId !== taskProject.id || preview.visibility !== 'public') {
        throw new Error('Prévisualisation publique invalide pour ce projet.');
      }
      const visibleFiles = preview.files
        .slice(0, 80)
        .map((file) => `• ${file.relativePath} (${file.size} octets)`);
      if (preview.files.length > visibleFiles.length) {
        visibleFiles.push(`• … ${preview.files.length - visibleFiles.length} autre(s) fichier(s)`);
      }
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Confirmation de publication publique',
        message: `Rendre « ${preview.name} » public sur Internet ?`,
        detail: [
          `Adresse prévue : ${preview.plannedAddress} (indicative jusqu’au retour Vercel)`,
          'Visibilité : publique',
          `Variables d’environnement : ${
            preview.environmentVariables.join(', ') || 'aucune'
          }`,
          `Crédits IA estimés : ${preview.estimatedCredits} (estimation)`,
          `Durée d’hébergement : ${preview.hostingDurationLabel}`,
          `Personnes autorisées : ${preview.authorizedPeople.join(', ')}`,
          '',
          `Fichiers publiés (${preview.files.length}) :`,
          ...visibleFiles
        ].join('\n'),
        buttons: ['Confirmer et publier', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (confirmation.response !== 0) {
        await audit({
          taskId: preview.id,
          projectId: taskProject.id,
          category: 'deployment',
          action: 'hosted_site_publication_cancelled',
          status: 'refused',
          summary: `Publication publique annulée : ${preview.name}.`
        });
        throw new Error('Publication publique annulée.');
      }
      const allowed = await authorizeProjectAction({
        action: 'network',
        detail: 'vercel.com:public-deployment',
        software: 'Vercel CLI',
        command: `vercel deploy --prod --name ${preview.slug}`,
        risk:
          'Les fichiers affichés seront envoyés à Vercel et deviendront accessibles '
          + 'publiquement. Les fichiers secrets ont été exclus.',
        reason: `Publier explicitement ${preview.name} après validation du récapitulatif.`,
        estimatedCost:
          `${preview.estimatedCredits} crédit IA estimé. Les frais éventuels `
          + 'de l’hébergeur dépendent du compte Vercel.'
      });
      if (!allowed) throw new Error('Déploiement Vercel refusé.');
      const deployment = await service.deploy(taskProject.id, previewId, true);
      await audit({
        taskId: deployment.id,
        projectId: taskProject.id,
        category: 'deployment',
        action: 'hosted_site_deployed',
        status: 'completed',
        summary: `${deployment.name} publié sur ${deployment.address}.`,
        details: {
          provider: deployment.provider,
          visibility: deployment.visibility,
          files: deployment.files,
          totalBytes: deployment.totalBytes,
          address: deployment.address,
          environmentVariables: deployment.environmentVariables,
          estimatedCredits: deployment.estimatedCredits,
          hostingDuration: deployment.hostingDurationLabel,
          authorizedPeople: deployment.authorizedPeople
        }
      });
      return deployment;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.imageStudioCreate,
    async (event, request: NeuraCoImageStudioCreateRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const isLocalResize = request?.operation === 'resize';
      if (!isLocalResize) ensureRemoteAiAvailable();
      const allowed = await authorizeProjectAction({
        action: isLocalResize ? 'application' : 'network',
        detail: isLocalResize
          ? 'neuraco:image-studio:resize'
          : 'openrouter.ai:image-generation',
        software: isLocalResize ? 'Atelier Images NeuraCo' : 'OpenRouter Images',
        risk: isLocalResize
          ? 'Une nouvelle copie redimensionnée sera créée dans le stockage privé NeuraCo.'
          : (
              'Le prompt et, si nécessaire, une copie compressée de l’image source '
              + 'seront envoyés au fournisseur. L’original local ne sera jamais remplacé.'
            ),
        reason: isLocalResize
          ? 'Produire une copie aux dimensions demandées sans appel payant.'
          : `Produire ${Math.max(1, Number(request?.variants) || 1)} résultat(s) visuel(s).`,
        estimatedCost: isLocalResize
          ? '0 crédit IA'
          : 'Réservation serveur de 5 crédits maximum par variante'
      });
      if (!allowed) throw new Error('Création d’image refusée.');
      const project = activeProject;
      const job = await getImageStudioService().create(project, request);
      await audit({
        projectId: project.id,
        category: 'agent',
        action: 'image_studio_completed',
        status: 'completed',
        summary: `${job.outputs.length} image(s) créée(s) par ${job.modelDisplay}.`,
        details: {
          operation: job.operation,
          provider: job.provider,
          model: job.model,
          creditsConsumed: job.usage.creditsConsumed,
          inputTokens: job.usage.inputTokens || 0,
          outputTokens: job.usage.outputTokens || 0,
          filesCreated: job.outputs.map((output) => output.filePath),
          originalPreserved: job.originalPreserved
        }
      });
      return job;
    }
  );

  ipcMain.handle(IPC_CHANNELS.imageStudioList, (event, limit?: number) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getImageStudioService().list(activeProject.id, limit);
  });

  ipcMain.handle(
    IPC_CHANNELS.imageStudioPreview,
    (event, outputId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getImageStudioService().preview(activeProject.id, outputId);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.imageStudioExport,
    async (event, outputId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
      const jobs = await getImageStudioService().list(activeProject.id, 100);
      const output = jobs.flatMap((job) => job.outputs)
        .find((candidate) => candidate.id === outputId);
      if (!output) throw new Error('Sortie image introuvable pour ce projet.');
      const extension = output.mimeType === 'image/jpeg'
        ? 'jpg'
        : output.mimeType.split('/')[1] || 'png';
      const selection = await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter une copie de l’image',
        defaultPath: path.join(
          app.getPath('pictures'),
          `neuraco-${output.id.slice(0, 8)}.${extension}`
        ),
        filters: [{ name: 'Image', extensions: [extension] }]
      });
      if (selection.canceled || !selection.filePath) return null;
      const allowed = await authorizeProjectAction({
        action: 'write_file',
        detail: selection.filePath,
        software: 'Atelier Images NeuraCo',
        file: selection.filePath,
        risk: 'Une nouvelle copie de l’image sera écrite. Aucun fichier existant ne sera remplacé.',
        reason: 'Exporter explicitement le résultat sélectionné.',
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Export de l’image refusé.');
      try {
        const exported = await getImageStudioService().export(
          activeProject.id,
          outputId,
          selection.filePath
        );
        await audit({
          projectId: activeProject.id,
          category: 'file',
          action: 'image_studio_exported',
          status: 'completed',
          summary: 'Image NeuraCo exportée sans remplacer l’original.',
          details: { fileCreated: exported, outputId }
        });
        return exported;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Fichier déjà présent',
            message: 'NeuraCo n’a pas remplacé le fichier existant.',
            detail: 'Choisissez un nouveau nom ou un autre emplacement.'
          });
          return null;
        }
        throw error;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.cloudTasksList, async (event, limit?: number) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const tasks = await listCloudTasks(activeProject.id, limit);
    for (const task of tasks) {
      await enqueueCloudTaskForReview(task);
      await synchronizeCloudTaskRecovery(task);
    }
    return tasks;
  });

  ipcMain.handle(
    IPC_CHANNELS.cloudTaskCreate,
    async (event, request: NeuraCoCloudTaskRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      ensureRemoteAiAvailable();
      if (!activeProject || request?.projectId !== activeProject.id) {
        throw new Error('Le projet NeuraCo actif ne correspond pas à la tâche Cloud.');
      }
      const taskProject = activeProject;
      const task = await createCloudTask({
        ...request,
        content: await appendAgentContext(
          taskProject,
          request.content,
          request.effort,
          request.communicationStyle
        )
      });
      try {
        const recoveryContext = await captureTaskRecoveryContext(taskProject);
        await getTaskRecoveryService().start({
          id: task.id,
          project: taskProject,
          kind: 'cloud',
          objective: request.content,
          agents: ['Assistant Cloud'],
          budgetAllocated: Number(task.estimatedCredits || 0),
          permissionMode: recoveryContext.permissions.mode,
          allowedActions: recoveryContext.permissions.allowedActions,
          checkpointIds: recoveryContext.checkpointIds,
          projectState: recoveryContext.projectState,
          worktrees: recoveryContext.worktrees,
          files: request.files.map((file) => file.path)
        });
      } catch (error) {
        console.error('NeuraCo Cloud recovery initialization failed', error);
      }
      await audit({
        taskId: task.id,
        projectId: taskProject.id,
        category: 'agent',
        action: 'cloud_task_created',
        status: 'started',
        summary: request.content.slice(0, 500),
        details: {
          agent: 'Assistant Cloud',
          executionMode: 'cloud',
          files: request.files.map((file) => file.path)
        }
      });
      return task;
    }
  );

  ipcMain.handle(IPC_CHANNELS.cloudTaskGet, async (event, taskId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const task = await enqueueCloudTaskForReview(await getCloudTask(taskId));
    await synchronizeCloudTaskRecovery(task);
    return task;
  });

  ipcMain.handle(IPC_CHANNELS.cloudTaskCancel, async (event, taskId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const task = await cancelCloudTask(taskId);
    await synchronizeCloudTaskRecovery(task);
    await audit({
      taskId: task.id,
      projectId: activeProject?.id,
      category: 'agent',
      action: 'cloud_task_cancelled',
      status: 'cancelled',
      summary: 'Tâche Cloud annulée par l’utilisateur.',
      details: { executionMode: 'cloud' }
    });
    return task;
  });

  ipcMain.handle(IPC_CHANNELS.relayState, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getRelayService().state();
  });

  ipcMain.handle(IPC_CHANNELS.relayEnable, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Ouvrez un projet avant d’activer le relais.');
    const state = await getRelayService().enable();
    await audit({
      projectId: activeProject.id,
      category: 'security',
      action: 'relay_enabled',
      status: state.connected ? 'completed' : 'failed',
      summary: state.connected
        ? 'Relais sortant HTTPS activé.'
        : 'Le relais sortant n’a pas pu joindre le serveur.',
      details: {
        transport: state.transport,
        publicPortOpen: state.publicPortOpen
      }
    });
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.relayDisable, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const state = getRelayService().disable();
    await audit({
      projectId: activeProject?.id,
      category: 'security',
      action: 'relay_disabled',
      status: 'completed',
      summary: 'Relais sortant désactivé.',
      details: {
        transport: state.transport,
        publicPortOpen: state.publicPortOpen
      }
    });
    return state;
  });

  ipcMain.handle(
    IPC_CHANNELS.relayResolve,
    (event, commandId: string, accepted: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (typeof accepted !== 'boolean') {
        throw new Error('Réponse de relais invalide.');
      }
      return getRelayService().resolve(commandId, accepted);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.recoverableTasksList,
    async (event, includeCompleted?: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const taskProject = activeProject;
      try {
        const cloudTasks = await listCloudTasks(taskProject.id, 100);
        for (const task of cloudTasks) await synchronizeCloudTaskRecovery(task);
      } catch (error) {
        console.error('NeuraCo Cloud recovery refresh failed', error);
      }
      return getTaskRecoveryService().list(
        taskProject.id,
        Boolean(includeCompleted),
        new Set(agentControllers.keys())
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.recoverableTaskInspect,
    async (event, taskId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const context = await captureTaskRecoveryContext(activeProject);
      return getTaskRecoveryService().inspect(
        activeProject.id,
        taskId,
        context.projectState,
        context.worktrees
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.recoverableTaskResume,
    async (
      event,
      taskId: string,
      strategy: NeuraCoTaskResumeStrategy
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const context = await captureTaskRecoveryContext(activeProject);
      const resumed = await getTaskRecoveryService().resume(
        activeProject.id,
        taskId,
        strategy,
        context.projectState,
        context.worktrees
      );
      await audit({
        taskId,
        projectId: activeProject.id,
        category: 'agent',
        action: 'recoverable_task_resumed',
        status: 'started',
        summary: `Reprise préparée avec la stratégie ${strategy}.`,
        details: {
          differences: resumed.differences.map((difference) => difference.message),
          completedSteps: resumed.task.steps.filter(
            (step) => step.status === 'completed'
          ).length,
          remainingSteps: resumed.task.steps.filter(
            (step) => step.status !== 'completed'
          ).length
        }
      });
      return resumed;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.recoverableTaskDiscard,
    async (event, taskId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Abandonner la reprise',
        message: 'Abandonner cette tâche récupérable ?',
        detail:
          'Les fichiers et checkpoints ne seront pas supprimés. '
          + 'Seule la proposition de reprise sera archivée.',
        buttons: ['Abandonner la reprise', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (confirmation.response !== 0) throw new Error('Abandon de la reprise annulé.');
      return getTaskRecoveryService().discard(
        activeProject.id,
        taskId,
        new Set(agentControllers.keys())
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.notificationsList,
    (event, includeArchived?: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getNotificationService().list(
        activeProject.id,
        Boolean(includeArchived)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.notificationRead,
    async (event, notificationId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const notifications = await getNotificationService().markRead(
        activeProject.id,
        notificationId
      );
      const notification = notifications.find((item) => item.id === notificationId);
      if (notification) {
        emitNotificationEvent({ type: 'updated', notification });
      }
      return notifications;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.notificationArchive,
    (event, notificationId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      nativeNotifications.get(notificationId)?.close();
      nativeNotifications.delete(notificationId);
      return getNotificationService().archive(
        activeProject.id,
        notificationId
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.notificationAction,
    async (
      event,
      notificationId: string,
      action: NeuraCoNotificationAction
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      if (!['open', 'authorize', 'refuse', 'pause', 'stop'].includes(action)) {
        throw new Error('Action de notification invalide.');
      }
      const notification = await getNotificationService().get(
        activeProject.id,
        notificationId
      );
      if (action !== 'open' && !notification.actions.includes(action)) {
        throw new Error('Cette action n’est pas disponible pour la notification.');
      }
      return handleNotificationAction(notification, action);
    }
  );

  ipcMain.handle(IPC_CHANNELS.goalsList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getGoalService().list(activeProject.id);
  });

  ipcMain.handle(
    IPC_CHANNELS.goalCreate,
    async (event, input: NeuraCoGoalCreate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const goal = await getGoalService().create({
        ...input,
        projectIds: [...new Set([
          activeProject.id,
          ...(Array.isArray(input?.projectIds) ? input.projectIds : [])
        ])]
      });
      await audit({
        projectId: activeProject.id,
        category: 'goal',
        action: 'goal_created',
        status: 'completed',
        summary: `Objectif créé : ${goal.title}`,
        details: { goalId: goal.id, budget: goal.budget, agents: goal.agentIds }
      });
      return goal;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.goalUpdate,
    async (event, goalId: string, input: NeuraCoGoalUpdate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getGoalService().list(activeProject.id);
      if (!visible.some((goal) => goal.id === goalId)) {
        throw new Error('Objectif absent du projet actif.');
      }
      return getGoalService().update(goalId, input || {});
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.goalDelete,
    async (event, goalId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getGoalService().list(activeProject.id);
      if (!visible.some((goal) => goal.id === goalId)) {
        throw new Error('Objectif absent du projet actif.');
      }
      await getGoalService().delete(goalId);
      await audit({
        projectId: activeProject.id,
        category: 'goal',
        action: 'goal_deleted',
        status: 'completed',
        summary: 'Objectif supprimé.',
        details: { goalId }
      });
      return getGoalService().list(activeProject.id);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.goalStepUpdate,
    async (
      event,
      goalId: string,
      stepId: string,
      status: NeuraCoGoalStepStatus
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getGoalService().list(activeProject.id);
      if (!visible.some((goal) => goal.id === goalId)) {
        throw new Error('Objectif absent du projet actif.');
      }
      return getGoalService().updateStep(goalId, stepId, status);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.goalProposalResolve,
    async (
      event,
      goalId: string,
      proposalId: string,
      decision: 'approved' | 'rejected'
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getGoalService().list(activeProject.id);
      if (!visible.some((goal) => goal.id === goalId)) {
        throw new Error('Objectif absent du projet actif.');
      }
      return getGoalService().resolveProposal(goalId, proposalId, decision);
    }
  );

  ipcMain.handle(IPC_CHANNELS.agentsList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getMultiAgentService().listAgents();
  });

  ipcMain.handle(
    IPC_CHANNELS.agentsSave,
    (event, definition: NeuraCoCustomAgentInput) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      return getMultiAgentService().saveAgent(definition);
    }
  );

  ipcMain.handle(IPC_CHANNELS.agentsDelete, (event, agentId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (typeof agentId !== 'string') throw new Error('Identifiant d’agent invalide.');
    return getMultiAgentService().deleteAgent(agentId);
  });

  ipcMain.handle(
    IPC_CHANNELS.taskRoutingPreview,
    async (event, request: NeuraCoTaskRoutingRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject || request?.projectId !== activeProject.id) {
        throw new Error('Le projet NeuraCo actif ne correspond pas au routage.');
      }
      const preview = routeTask({
        projectId: activeProject.id,
        content: String(request.content || '').slice(0, 40_000),
        requestedMode: request.requestedMode,
        effort: request.effort,
        communicationStyle: request.communicationStyle,
        preferredModel: request.preferredModel,
        responseSpeed: request.responseSpeed,
        filePaths: Array.isArray(request.filePaths)
          ? request.filePaths
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.slice(0, 1000))
              .slice(0, 64)
          : [],
        imageCount: Math.min(8, Math.max(0, Math.floor(Number(request.imageCount) || 0)))
      });
      try {
        const estimate = await estimateUsage({
          mode: preview.effort === 'rapid'
            ? 'economic'
            : ['deep', 'maximum'].includes(preview.effort)
              ? 'quality'
              : preview.complexity === 'complex'
                ? 'quality'
                : 'balanced',
          model: preview.primaryModel,
          promptCharacters: request.content.length,
          maxOutputTokens: preview.maxOutputTokens,
          agents: Math.max(1, preview.agents.length),
          imageCount: request.imageCount
        });
        return {
          ...preview,
          estimatedMinimumCredits: estimate.minimum_credits,
          estimatedMaximumCredits: estimate.maximum_credits,
          estimateSource: 'server' as const
        };
      } catch {
        return preview;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.agentsRun,
    async (event, request: NeuraCoMultiAgentRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      ensureRemoteAiAvailable();
      if (!activeProject || request?.projectId !== activeProject.id) {
        throw new Error('Le projet NeuraCo actif ne correspond pas à la demande.');
      }
      const taskId = typeof request?.taskId === 'string' && request.taskId
        ? request.taskId
        : randomUUID();
      const controller = new AbortController();
      agentControllers.set(taskId, controller);
      const taskProject = activeProject;
      try {
        const recoveryContext = await captureTaskRecoveryContext(taskProject);
        await getTaskRecoveryService().start({
          id: taskId,
          project: taskProject,
          kind: 'multi_agent',
          objective: String(request.objective || ''),
          agents: request.selectedAgentIds,
          budgetAllocated: Number(request.budget || 0),
          permissionMode: recoveryContext.permissions.mode,
          allowedActions: recoveryContext.permissions.allowedActions,
          checkpointIds: recoveryContext.checkpointIds,
          projectState: recoveryContext.projectState,
          worktrees: recoveryContext.worktrees,
          files: request.files.map((file) => file.path)
        });
        await audit({
          taskId,
          projectId: taskProject.id,
          category: 'agent',
          action: 'multi_agent_started',
          status: 'started',
          summary: String(request.objective || '').slice(0, 1000),
          details: {
            agents: request.selectedAgentIds,
            filesRead: request.files.map((file) => file.path),
            budget: request.budget
          }
        });
        const result = await getMultiAgentService().run(
          {
            ...request,
            taskId,
            objective: await appendAgentContext(
              taskProject,
              request.objective,
              request.effort,
              request.communicationStyle
            )
          },
          controller.signal,
          (progress) => {
            void getTaskRecoveryService().progress(taskId, progress).catch((error) => {
              console.error('NeuraCo recoverable task progress failed', error);
            });
            if (progress.task?.status === 'blocked') {
              void notify({
                project: taskProject,
                kind: 'agent_blocked',
                severity: 'warning',
                title: `${progress.task.agentName} est bloqué`,
                body:
                  progress.task.blockers?.join(' · ')
                  || progress.message
                  || 'Une intervention est nécessaire pour continuer.',
                taskId,
                target: 'team',
                actions: ['open', 'pause', 'stop'],
                sensitive: true,
                dedupeKey: `agent-blocked-${taskId}-${progress.task.id}`
              });
            }
            if (!event.sender.isDestroyed()) {
              event.sender.send(IPC_CHANNELS.agentsProgress, progress);
            }
          }
        );
        const permissions = await getPermissionStore().get(
          taskProject.id,
          taskProject.rootPath
        );
        await getReviewQueueService().enqueueMultiAgent(
          taskProject,
          { ...request, taskId },
          result,
          permissions
        );
        if (request.goalId) {
          try {
            const visibleGoals = await getGoalService().list(taskProject.id);
            if (visibleGoals.some((goal) => goal.id === request.goalId)) {
              const updatedGoal = await getGoalService().proposeFromTasks(
                request.goalId,
                taskId,
                result.tasks
              );
              await audit({
                taskId,
                projectId: taskProject.id,
                category: 'goal',
                action: 'goal_steps_proposed',
                status: 'info',
                summary:
                  `${updatedGoal.proposals.filter((proposal) => proposal.status === 'pending').length} `
                  + 'proposition(s) d’étape attendent une validation.',
                details: { goalId: updatedGoal.id }
              });
            }
          } catch (goalError) {
            console.error('NeuraCo goal proposal recording failed', goalError);
          }
        }
        await audit({
          taskId,
          projectId: taskProject.id,
          category: 'agent',
          action: 'multi_agent_completed',
          status: 'completed',
          summary: result.summary,
          details: {
            agents: result.tasks.map((task) => task.agentName),
            filesRead: result.tasks.flatMap((task) => task.files),
            models: result.tasks.map((task) => task.model).filter(Boolean),
            provider: result.provider,
            model: result.model,
            creditsConsumed: result.creditsConsumed,
            risks: result.risks,
            durationMs: result.durationMs
          }
        });
        await getTaskRecoveryService().complete(taskId, result).catch((error) => {
          console.error('NeuraCo recoverable multi-agent completion failed', error);
        });
        await notify({
          project: taskProject,
          kind: 'task_completed',
          severity: 'success',
          title: 'Équipe d’agents terminée',
          body: result.summary,
          taskId,
          target: 'review',
          actions: ['open'],
          dedupeKey: `task-completed-${taskId}`
        });
        publishUsageSummary(event.sender, taskProject);
        return result;
      } catch (error) {
        await getTaskRecoveryService().interrupt(
          taskId,
          error instanceof Error ? error.message : 'Orchestration interrompue.'
        ).catch((recoveryError) => {
          console.error('NeuraCo recoverable multi-agent interruption failed', recoveryError);
        });
        await audit({
          taskId,
          projectId: taskProject.id,
          category: 'agent',
          action: 'multi_agent_failed',
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          summary: error instanceof Error ? error.message : 'Orchestration interrompue.',
          details: { agents: request.selectedAgentIds }
        });
        await notify({
          project: taskProject,
          kind: 'task_failed',
          severity: 'critical',
          title: controller.signal.aborted
            ? 'Orchestration interrompue'
            : 'Orchestration échouée',
          body: error instanceof Error ? error.message : 'L’orchestration a échoué.',
          taskId,
          target: 'protection',
          actions: ['open'],
          dedupeKey: `task-failed-${taskId}`
        });
        throw error;
      } finally {
        agentControllers.delete(taskId);
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.agentsCancel, (event, taskId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const controller = agentControllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  });

  ipcMain.handle(
    IPC_CHANNELS.reviewQueueList,
    (event, includeArchived?: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      return getReviewQueueService().list(activeProject.id, Boolean(includeArchived));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewQueueStatus,
    async (event, itemId: string, status: NeuraCoReviewStatus) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getReviewQueueService().list(activeProject.id, true);
      if (!visible.some((item) => item.id === itemId)) {
        throw new Error('Élément de révision absent du projet actif.');
      }
      const item = await getReviewQueueService().updateStatus(itemId, status);
      await audit({
        taskId: item.sourceId,
        projectId: activeProject.id,
        category: 'review',
        action: `review_${status}`,
        status: status === 'refused' ? 'refused' : 'info',
        summary: item.task,
        details: { reviewItemId: item.id, source: item.source, branch: item.branch }
      });
      return item;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewQueueComment,
    async (event, input: NeuraCoReviewCommentInput) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getReviewQueueService().list(activeProject.id, true);
      if (!visible.some((item) => item.id === input?.itemId)) {
        throw new Error('Élément de révision absent du projet actif.');
      }
      return getReviewQueueService().addComment(input);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewQueueFileDecision,
    async (event, input: NeuraCoReviewFileDecisionInput) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getReviewQueueService().list(activeProject.id, true);
      if (!visible.some((item) => item.id === input?.itemId)) {
        throw new Error('Élément de révision absent du projet actif.');
      }
      return getReviewQueueService().decideFile(input);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewQueueHunkDecision,
    async (event, input: NeuraCoReviewHunkDecisionInput) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getReviewQueueService().list(activeProject.id, true);
      if (!visible.some((item) => item.id === input?.itemId)) {
        throw new Error('Élément de révision absent du projet actif.');
      }
      return getReviewQueueService().decideHunk(input);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewQueueAllDecision,
    async (event, input: NeuraCoReviewAllDecisionInput) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getReviewQueueService().list(activeProject.id, true);
      if (!visible.some((item) => item.id === input?.itemId)) {
        throw new Error('Élément de révision absent du projet actif.');
      }
      return getReviewQueueService().decideAll(input);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewQueueTests,
    async (event, itemId: string, tests: NeuraCoGitTestResult[]) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getReviewQueueService().list(activeProject.id, true);
      if (!visible.some((item) => item.id === itemId)) {
        throw new Error('Élément de révision absent du projet actif.');
      }
      if (!Array.isArray(tests)) throw new Error('Résultats de tests invalides.');
      return getReviewQueueService().recordTests(itemId, tests);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewQueueCheckpoint,
    async (event, itemId: string, checkpointId: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const visible = await getReviewQueueService().list(activeProject.id, true);
      if (!visible.some((item) => item.id === itemId)) {
        throw new Error('Élément de révision absent du projet actif.');
      }
      return getReviewQueueService().attachCheckpoint(itemId, checkpointId);
    }
  );

  ipcMain.handle(IPC_CHANNELS.gitStatus, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getGitService().status(activeProject);
  });

  ipcMain.handle(IPC_CHANNELS.gitDiff, (event, branch?: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    if (branch !== undefined && typeof branch !== 'string') {
      throw new Error('Nom de branche invalide.');
    }
    return getGitService().diff(activeProject, branch);
  });

  ipcMain.handle(
    IPC_CHANNELS.gitCreateWorktree,
    async (event, request: NeuraCoGitWorktreeCreate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const allowed = await authorizeProjectAction({
        action: 'terminal',
        detail: `git-worktree:${request?.taskId || ''}:${request?.agentId || ''}`,
        software: 'Git',
        command: 'git worktree add -b <branche-isolée>',
        risk: 'Crée une branche et un espace Git isolé sans modifier les fichiers courants.',
        reason: 'Isoler le travail d’un agent avant revue et fusion.',
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Création du worktree refusée.');
      const project = activeProject;
      const created = await getGitService().createWorktree(project, request);
      const preparation = await getEnvironmentPreparationService().get(project.id);
      if (preparation.enabled && preparation.runOnWorktree) {
        try {
          const execution = await runEnvironmentPreparationForTarget(
            project,
            { kind: 'worktree', worktreePath: created.path },
            'Préparer le worktree isolé qui vient d’être créé.'
          );
          await notify({
            project,
            kind: 'task_completed',
            severity: 'success',
            title: 'Worktree préparé',
            body:
              `Le script de préparation s’est terminé en ${execution.durationMs} ms.`,
            target: 'git',
            sensitive: false
          });
        } catch (error) {
          await notify({
            project,
            kind: 'task_failed',
            severity: 'warning',
            title: 'Worktree créé, préparation incomplète',
            body: error instanceof Error ? error.message : 'Préparation indisponible.',
            target: 'git',
            sensitive: true
          });
        }
      }
      return created;
    }
  );

  ipcMain.handle(IPC_CHANNELS.gitRemoveWorktree, async (event, worktreePath: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Supprimer le worktree',
      message: 'Le worktree doit être propre avant sa suppression.',
      detail: worktreePath,
      buttons: ['Supprimer le worktree', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) throw new Error('Suppression du worktree annulée.');
    return getGitService().removeWorktree(activeProject, worktreePath);
  });

  ipcMain.handle(IPC_CHANNELS.gitOpenWorktree, async (event, worktreePath: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const status = await getGitService().status(activeProject);
    const worktree = status.worktrees.find(
      (item) => path.resolve(item.path) === path.resolve(worktreePath) && !item.isMain
    );
    if (!worktree) throw new Error('Worktree NeuraCo introuvable.');
    const error = await shell.openPath(worktree.path);
    if (error) throw new Error(`Windows n’a pas pu ouvrir le worktree: ${error}`);
    return true;
  });

  ipcMain.handle(
    IPC_CHANNELS.gitCommitWorktree,
    async (event, worktreePath: string, message: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const allowed = await authorizeProjectAction({
        action: 'terminal',
        detail: `git-commit:${worktreePath}`,
        software: 'Git',
        command: 'git add --all && git commit',
        risk: 'Enregistre toutes les modifications non sensibles du worktree dans sa branche isolée.',
        reason: 'Préparer un commit vérifiable avant tests et revue.',
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Commit refusé.');
      const committed = await getGitService().commitWorktree(
        activeProject,
        worktreePath,
        message
      );
      void getRoutineService().trigger('new_commit', {
        projectId: activeProject.id,
        worktreePath,
        message
      }).catch((error) => {
        console.error('NeuraCo commit routines failed', error);
      });
      return committed;
    }
  );

  ipcMain.handle(IPC_CHANNELS.gitTestCommands, (event, worktreePath?: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getGitService().testCommands(activeProject, worktreePath);
  });

  ipcMain.handle(
    IPC_CHANNELS.gitRunTests,
    async (event, commandId: string, worktreePath?: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const commands = await getGitService().testCommands(activeProject, worktreePath);
      const command = commands.find((item) => item.id === commandId);
      if (!command) throw new Error('Commande de test non autorisée.');
      const allowed = await authorizeProjectAction({
        action: 'terminal',
        detail: `git-tests:${command.id}`,
        software: 'Terminal de tests',
        command: command.command,
        risk: 'Les scripts de test du dépôt seront exécutés dans le worktree sélectionné.',
        reason: 'Valider la branche avant revue et fusion.',
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Exécution des tests refusée.');
      const result = await getGitService().runTests(
        activeProject,
        commandId,
        worktreePath
      );
      await audit({
        projectId: activeProject.id,
        category: 'test',
        action: 'git_test_completed',
        status: result.passed ? 'completed' : 'failed',
        summary: result.passed
          ? `Test réussi : ${command.command}`
          : `Test échoué : ${command.command}`,
        details: {
          command: result.command,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          output: result.output
        },
        evidence: {
          id: result.id,
          source: 'machine',
          kind: /\bbuild\b/i.test(result.command) ? 'build_report' : 'test_result',
          status: result.passed ? 'passed' : 'failed',
          title: result.passed ? 'Test Git réussi' : 'Test Git échoué',
          summary: `Commande vérifiée sur ${result.branch}.`,
          capturedAt: result.completedAt,
          command: result.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          output: result.output,
          metadata: { branch: result.branch }
        }
      });
      if (!result.passed) {
        await notify({
          project: activeProject,
          kind: 'test_failed',
          severity: 'critical',
          title: 'Test Git échoué',
          body:
            `${result.command} a échoué avec le code ${result.exitCode ?? 'inconnu'}.`,
          target: 'git',
          actions: ['open'],
          dedupeKey: `test-failed-${command.id}-${result.completedAt}`
        });
        void getRoutineService().trigger('ci_failure', {
          projectId: activeProject.id,
          command: result.command,
          exitCode: result.exitCode
        }).catch((error) => {
          console.error('NeuraCo CI-failure routines failed', error);
        });
      }
      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.gitRunTestSuite,
    async (event, worktreePath?: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const commands = await getGitService().testCommands(activeProject, worktreePath);
      if (commands.length === 0) throw new Error('Aucun test ou build détecté.');
      const allowed = await authorizeProjectAction({
        action: 'terminal',
        detail: `git-test-suite:${worktreePath || activeProject.rootPath}`,
        software: 'Terminal de tests',
        command: commands.map((command) => command.command).join(' puis '),
        risk: `${commands.length} commande(s) du dépôt seront exécutées séquentiellement.`,
        reason: 'Valider tous les tests et builds détectés avant la fusion.',
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Suite de tests refusée.');
      const results = await getGitService().runTestSuite(activeProject, worktreePath);
      for (const result of results) {
        await audit({
          projectId: activeProject.id,
          category: 'test',
          action: 'git_test_completed',
          status: result.passed ? 'completed' : 'failed',
          summary: result.passed
            ? `Test réussi : ${result.command}`
            : `Test échoué : ${result.command}`,
          details: {
            command: result.command,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            output: result.output
          },
          evidence: {
            id: result.id,
            source: 'machine',
            kind: /\bbuild\b/i.test(result.command) ? 'build_report' : 'test_result',
            status: result.passed ? 'passed' : 'failed',
            title: result.passed ? 'Test Git réussi' : 'Test Git échoué',
            summary: `Commande vérifiée sur ${result.branch}.`,
            capturedAt: result.completedAt,
            command: result.command,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            output: result.output,
            metadata: { branch: result.branch }
          }
        });
      }
      const failed = results.filter((result) => !result.passed);
      if (failed.length > 0) {
        await notify({
          project: activeProject,
          kind: 'test_failed',
          severity: 'critical',
          title: `${failed.length} test(s) ou build(s) ont échoué`,
          body: failed.map((result) => (
            `${result.command} (code ${result.exitCode ?? 'inconnu'})`
          )).join(' · '),
          target: 'git',
          actions: ['open'],
          dedupeKey: `test-suite-failed-${failed
            .map((result) => result.command)
            .join('|')}`
        });
        void getRoutineService().trigger('ci_failure', {
          projectId: activeProject.id,
          commands: failed.map((result) => result.command)
        }).catch((error) => {
          console.error('NeuraCo CI-failure routines failed', error);
        });
      }
      return results;
    }
  );

  ipcMain.handle(IPC_CHANNELS.gitReview, async (event, branch: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const requestId = `git-review-${randomUUID()}`;
    const controller = new AbortController();
    agentControllers.set(requestId, controller);
    try {
      const review = await getGitService().review(
        activeProject,
        branch,
        controller.signal
      );
      const permissions = await getPermissionStore().get(
        activeProject.id,
        activeProject.rootPath
      );
      await getReviewQueueService().enqueueGit(
        activeProject,
        review,
        permissions
      );
      await audit({
        taskId: requestId,
        projectId: activeProject.id,
        category: 'agent',
        action: 'git_review_completed',
        status: review.approved ? 'completed' : 'failed',
        summary: review.approved
          ? `Revue Git approuvée pour ${branch}.`
          : `Revue Git refusée pour ${branch}.`,
        details: {
          agent: 'Réviseur Git',
          provider: review.provider,
          model: review.model,
          creditsConsumed: review.creditsConsumed,
          filesRead: review.diff.patch
            .split(/\r?\n/)
            .filter((line) => line.startsWith('+++ b/'))
            .map((line) => line.slice(6))
          }
      });
      if (review.approved) {
        await notify({
          project: activeProject,
          kind: 'merge_ready',
          severity: 'success',
          title: 'Fusion Git prête',
          body:
            `La branche ${branch} a passé la revue indépendante. `
            + 'La fusion reste soumise à votre validation.',
          target: 'git',
          actions: ['open'],
          sensitive: true,
          dedupeKey: `merge-ready-${branch}-${review.reviewedAt}`
        });
      }
      publishUsageSummary(event.sender, activeProject);
      return review;
    } finally {
      agentControllers.delete(requestId);
    }
  });

  ipcMain.handle(IPC_CHANNELS.gitMerge, async (event, branch: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
    const diff = await getGitService().diff(activeProject, branch);
    await enforceHooks('before_merge', {
      branch,
      metadata: {
        baseBranch: diff.baseBranch,
        stat: diff.stat
      }
    }, activeProject);
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Fusion Git contrôlée',
      message: `Fusionner ${branch} dans ${diff.baseBranch} ?`,
      detail:
        `${diff.stat}\n\nNeuraCo vérifiera à nouveau les tests, la revue et les conflits avant la fusion.`,
      buttons: ['Fusionner les changements validés', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) throw new Error('Fusion annulée.');
    const checkpoint = await createProjectCheckpointWithContext(
      activeProject,
      `Avant la fusion Git de ${branch}`,
      'merge'
    );
    let result;
    try {
      result = await withCriticalOperation(() => (
        getGitService().merge(activeProject as NeuraCoProject, branch)
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fusion Git échouée.';
      await notify({
        project: activeProject,
        kind: /conflit|conflict/i.test(message) ? 'git_conflict' : 'task_failed',
        severity: 'critical',
        title: /conflit|conflict/i.test(message)
          ? 'Conflit Git détecté'
          : 'Fusion Git échouée',
        body: message,
        target: 'git',
        actions: ['open'],
        sensitive: true,
        dedupeKey: `git-merge-failed-${branch}-${Date.now()}`
      });
      throw error;
    }
    await audit({
      projectId: activeProject.id,
      category: 'git',
      action: 'git_merge_completed',
      status: 'completed',
      summary: `${branch} fusionnée dans ${result.targetBranch}.`,
      details: {
        checkpoint: `Avant la fusion Git de ${branch}`,
        commit: result.commit,
        tests: result.tests.map((test) => test.command)
      },
      evidence: {
        id: randomUUID(),
        source: 'machine',
        kind: 'git_state',
        status: 'passed',
        title: 'Fusion Git vérifiée',
        summary: `${branch} a été fusionnée dans ${result.targetBranch} après validation.`,
        capturedAt: new Date().toISOString(),
        output: result.tests.map((test) => (
          `${test.passed ? 'PASS' : 'FAIL'} ${test.command}`
        )).join('\n'),
        metadata: {
          branch,
          targetBranch: result.targetBranch,
          commit: result.commit,
          tests: result.tests.length
        }
      }
    });
    const reviewItems = await getReviewQueueService().list(activeProject.id, true);
    const queueItem = reviewItems.find((item) => (
      item.source === 'git' && item.sourceId === branch
    ));
    if (queueItem) {
      await getReviewQueueService().attachCheckpoint(queueItem.id, checkpoint.id);
      await getReviewQueueService().updateStatus(queueItem.id, 'merged');
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.forgeConnection, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const connection = await getRemoteForgeService().connection(activeProject);
    await audit({
      projectId: activeProject.id,
      category: 'connection',
      action: 'forge_connection_checked',
      status: connection.authenticated ? 'completed' : 'failed',
      summary: connection.authenticated
        ? 'Connexion au dépôt distant vérifiée.'
        : 'Connexion au dépôt distant indisponible.',
      details: {
        provider: connection.provider,
        repository: connection.repository
      }
    });
    return connection;
  });

  ipcMain.handle(IPC_CHANNELS.forgeInbox, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const allowed = await authorizeProjectAction({
      action: 'network',
      detail: 'api.github.com,gitlab.com',
      software: 'GitHub/GitLab CLI',
      command: 'gh api / glab api (lecture seule)',
      risk: 'Lit les issues, pull requests, commentaires, CI et alertes du dépôt distant.',
      reason: 'Actualiser la boîte de réception Git du projet.',
      estimatedCost: '0 crédit IA'
    });
    if (!allowed) throw new Error('Lecture GitHub/GitLab refusée.');
    const inbox = await getRemoteForgeService().inbox(activeProject);
    const issueIds = new Set(
      inbox.items.filter((item) => item.kind === 'issue').map((item) => item.id)
    );
    const previousIssueIds = knownForgeIssueIds.get(activeProject.id);
    knownForgeIssueIds.set(activeProject.id, issueIds);
    if (previousIssueIds) {
      for (const item of inbox.items.filter((entry) => (
        entry.kind === 'issue' && !previousIssueIds.has(entry.id)
      ))) {
        void getRoutineService().trigger('new_issue', {
          projectId: activeProject.id,
          issueId: item.id,
          number: item.number,
          title: item.title,
          url: item.url
        }).catch((error) => {
          console.error('NeuraCo new-issue routines failed', error);
        });
      }
    }
    await audit({
      projectId: activeProject.id,
      category: 'connection',
      action: 'forge_inbox_refreshed',
      status: inbox.connection.authenticated ? 'completed' : 'failed',
      summary: inbox.connection.authenticated
        ? `${inbox.items.length} élément(s) distant(s) chargés.`
        : inbox.connection.message,
      details: {
        provider: inbox.connection.provider,
        repository: inbox.connection.repository,
        warnings: inbox.warnings.length
      }
    });
    return inbox;
  });

  ipcMain.handle(IPC_CHANNELS.forgeIssue, async (event, issueNumber: number) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    if (!Number.isInteger(issueNumber)) throw new Error('Numéro d’issue invalide.');
    const allowed = await authorizeProjectAction({
      action: 'network',
      detail: `forge-issue:${issueNumber}`,
      software: 'GitHub/GitLab CLI',
      command: `Lire l’issue #${issueNumber} et ses commentaires`,
      risk: 'Lit le contenu distant de cette issue sans le modifier.',
      reason: 'Préparer une délégation vérifiable dans NeuraCo.',
      estimatedCost: '0 crédit IA'
    });
    if (!allowed) throw new Error('Lecture de l’issue refusée.');
    return getRemoteForgeService().issue(activeProject, issueNumber);
  });

  ipcMain.handle(
    IPC_CHANNELS.forgeCreatePullRequest,
    async (event, request: NeuraCoForgePullRequestCreate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const branch = String(request?.branch || '').trim();
      const status = await getGitService().status(activeProject);
      const worktree = status.worktrees.find((item) => (
        item.branch === branch && !item.isMain
      ));
      if (!worktree) {
        throw new Error('La branche doit appartenir à un worktree NeuraCo isolé.');
      }
      if (worktree.dirty) {
        throw new Error('Le worktree contient des modifications non commitées.');
      }
      const allowed = await authorizeProjectAction({
        action: 'network',
        detail: `forge-pull-request:${branch}`,
        software: 'Git et GitHub/GitLab CLI',
        command: `Tester, revoir, pousser ${branch}, puis ouvrir une pull request`,
        risk:
          'Publie la branche et crée une pull request distante. '
          + 'Aucune fusion distante ne sera effectuée.',
        reason: 'Soumettre les changements vérifiés à validation humaine.',
        estimatedCost: 'Revue IA selon le modèle et l’abonnement actifs'
      });
      if (!allowed) throw new Error('Création de la pull request refusée.');

      const tests = await getGitService().runTestSuite(
        activeProject,
        worktree.path
      );
      if (tests.length === 0 || tests.some((test) => !test.passed)) {
        await notify({
          project: activeProject,
          kind: 'test_failed',
          severity: 'critical',
          title: 'Publication distante bloquée par les tests',
          body:
            tests.filter((test) => !test.passed)
              .map((test) => test.command)
              .join(' · ')
            || 'Aucun test vérifiable n’a été détecté.',
          target: 'git',
          actions: ['open'],
          dedupeKey: `forge-tests-failed-${branch}`
        });
        throw new Error('La pull request est bloquée car les tests ne sont pas tous réussis.');
      }
      const review = await getGitService().review(activeProject, branch);
      const permissions = await getPermissionStore().get(
        activeProject.id,
        activeProject.rootPath
      );
      await getReviewQueueService().enqueueGit(activeProject, review, permissions);
      if (!review.approved) {
        throw new Error('La pull request est bloquée par la revue indépendante.');
      }

      await withCriticalOperation(() => getGitService().pushBranch(
        activeProject as NeuraCoProject,
        branch
      ));
      const created = await getRemoteForgeService().createPullRequest(
        activeProject,
        request
      );
      await audit({
        projectId: activeProject.id,
        category: 'git',
        action: 'forge_pull_request_created',
        status: 'completed',
        summary: `Pull request créée pour ${created.branch}.`,
        details: {
          provider: created.provider,
          repository: created.repository,
          url: created.url,
          branch: created.branch,
          baseBranch: created.baseBranch,
          draft: created.draft,
          tests: tests.map((test) => test.command),
          reviewModel: review.model
        }
      });
      await notify({
        project: activeProject,
        kind: 'merge_ready',
        severity: 'success',
        title: created.draft
          ? 'Brouillon de pull request prêt'
          : 'Pull request prête à être examinée',
        body: `${created.branch} vers ${created.baseBranch} · ${created.url}`,
        target: 'git',
        actions: ['open'],
        sensitive: true,
        dedupeKey: `forge-pr-ready-${created.provider}-${created.repository}-${created.branch}`
      });
      publishUsageSummary(event.sender, activeProject);
      void getRoutineService().trigger('new_pull_request', {
        projectId: activeProject.id,
        provider: created.provider,
        repository: created.repository,
        branch: created.branch,
        baseBranch: created.baseBranch,
        url: created.url
      }).catch((error) => {
        console.error('NeuraCo pull-request routines failed', error);
      });
      return created;
    }
  );

  ipcMain.handle(IPC_CHANNELS.browserState, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const browser = getBrowserService();
    if (browser.state().tabs.length === 0) await browser.createTab();
    return browser.state();
  });

  ipcMain.handle(IPC_CHANNELS.browserNewTab, async (event, url?: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const requestedUrl = typeof url === 'string' && url.trim() ? url.trim() : 'about:blank';
    if (requestedUrl !== 'about:blank') {
      const parsed = validateBrowserUrl(requestedUrl);
      const allowed = await authorizeProjectAction({
        action: 'network',
        detail: parsed.hostname.toLowerCase(),
        software: 'Navigateur NeuraCo isolé',
        risk: 'Le site recevra l’adresse IP et les informations réseau habituelles du navigateur isolé.',
        reason: `Ouvrir ${parsed.origin} dans un nouvel onglet isolé.`,
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Navigation refusée.');
    }
    return getBrowserService().createTab(requestedUrl);
  });

  ipcMain.handle(IPC_CHANNELS.browserCloseTab, (event, tabId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().closeTab(String(tabId || ''));
  });

  ipcMain.handle(IPC_CHANNELS.browserActivateTab, (event, tabId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().activateTab(String(tabId || ''));
  });

  ipcMain.handle(IPC_CHANNELS.browserNavigate, async (event, value: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const parsed = validateBrowserUrl(value);
    if (parsed.href !== 'about:blank') {
      const allowed = await authorizeProjectAction({
        action: 'network',
        detail: parsed.hostname.toLowerCase(),
        software: 'Navigateur NeuraCo isolé',
        risk: 'Le domaine sera contacté depuis le profil navigateur isolé.',
        reason: `Naviguer explicitement vers ${parsed.origin}.`,
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Navigation refusée.');
    }
    return getBrowserService().navigate(parsed.toString());
  });

  ipcMain.handle(IPC_CHANNELS.browserBack, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().back();
  });

  ipcMain.handle(IPC_CHANNELS.browserForward, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().forward();
  });

  ipcMain.handle(IPC_CHANNELS.browserReload, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().reload();
  });

  ipcMain.handle(
    IPC_CHANNELS.browserBounds,
    (event, bounds: NeuraCoBrowserBounds | null) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getBrowserService().setBounds(bounds);
    }
  );

  ipcMain.handle(IPC_CHANNELS.browserDevTools, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().toggleDevTools();
  });

  ipcMain.handle(IPC_CHANNELS.browserCapture, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const capture = await getBrowserService().capture();
    const directory = path.join(app.getPath('userData'), 'evidence', 'browser');
    const filePath = path.join(directory, `${capture.id}.png`);
    const encoded = capture.dataUrl.replace(/^data:image\/png;base64,/, '');
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, Buffer.from(encoded, 'base64'), { mode: 0o600 });
    await audit({
      projectId: activeProject?.id,
      category: 'browser',
      action: 'browser_capture_completed',
      status: 'completed',
      summary: `Capture navigateur enregistrée (${capture.width} × ${capture.height}).`,
      details: {
        fileCreated: filePath,
        url: capture.url,
        width: capture.width,
        height: capture.height
      },
      evidence: {
        id: capture.id,
        source: 'machine',
        kind: 'screenshot',
        status: 'observed',
        title: 'Capture du navigateur',
        summary: `Image PNG réelle de ${capture.width} × ${capture.height} pixels.`,
        capturedAt: capture.capturedAt,
        filePath,
        mediaType: 'image/png',
        url: capture.url,
        metadata: {
          width: capture.width,
          height: capture.height,
          tabId: capture.tabId
        }
      }
    });
    return capture;
  });

  ipcMain.handle(IPC_CHANNELS.browserSelectElement, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    return getBrowserService().selectElement();
  });

  ipcMain.handle(
    IPC_CHANNELS.browserAction,
    async (event, action: NeuraCoBrowserAction) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      await enforceHooks('before_tool', {
        tool: `browser:${String(action?.type || '')}`,
        metadata: { selector: action?.selector }
      }, activeProject);
      const allowed = await authorizeProjectAction({
        action: 'application',
        detail: 'browser',
        software: 'Navigateur NeuraCo isolé',
        risk: 'Une interaction DOM sera exécutée dans l’onglet actif. Les actions sensibles restent bloquées.',
        reason: `Exécuter l’action structurée « ${String(action?.type || '')} ».`,
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Contrôle du navigateur refusé.');
      const result = await getBrowserService().action(action);
      await enforceHooks('after_tool', {
        tool: `browser:${String(action?.type || '')}`,
        status: 'completed',
        metadata: { url: result.url }
      }, activeProject);
      return result;
    }
  );

  ipcMain.handle(IPC_CHANNELS.browserDiagnostics, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().inspect();
  });

  ipcMain.handle(IPC_CHANNELS.browserHistory, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().history();
  });

  ipcMain.handle(IPC_CHANNELS.browserDownloads, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().downloads();
  });

  ipcMain.handle(IPC_CHANNELS.browserAnnotations, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getBrowserService().annotations();
  });

  ipcMain.handle(
    IPC_CHANNELS.browserSaveAnnotation,
    (event, annotation: NeuraCoBrowserAnnotationInput) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return getBrowserService().saveAnnotation(annotation);
    }
  );

  ipcMain.handle(IPC_CHANNELS.browserHide, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return browserService?.hide() ?? true;
  });

  ipcMain.handle(IPC_CHANNELS.applicationsList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getApplicationService().list();
  });

  ipcMain.handle(
    IPC_CHANNELS.applicationLaunch,
    async (event, applicationId: string, target?: string) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const safeApplicationId = String(applicationId || '').trim().toLowerCase();
      const allowed = await authorizeProjectAction({
        action: 'application',
        detail: safeApplicationId,
        software: safeApplicationId,
        file: target,
        risk: 'L’application autorisée sera lancée et pourra accéder à la cible indiquée.',
        reason: 'Ouvrir un outil détecté avec le projet actif ou un fichier de ce projet.',
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Lancement de l’application refusé.');
      const process = await getApplicationService().launch(
        activeProject,
        safeApplicationId,
        target
      );
      await audit({
        projectId: activeProject.id,
        category: 'application',
        action: 'application_launched',
        status: 'completed',
        summary: `${process.name} a été lancé.`,
        details: {
          application: process.name,
          processId: process.id,
          fileRead: target
        }
      });
      return process;
    }
  );

  ipcMain.handle(IPC_CHANNELS.applicationStop, (event, processId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    return getApplicationService().stop(String(processId || ''));
  });

  ipcMain.handle(IPC_CHANNELS.computerWindows, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getComputerControlService().listWindows();
  });

  ipcMain.handle(IPC_CHANNELS.computerInspect, async (event, windowId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const inspection = await getComputerControlService().inspectWindow(
      String(windowId || '')
    );
    await audit({
      projectId: activeProject.id,
      category: 'application',
      action: 'computer_window_inspected',
      status: 'info',
      summary: `Fenêtre inspectée en lecture seule: ${inspection.window.title}.`,
      details: {
        applicationId: inspection.window.applicationId,
        processId: inspection.window.processId,
        elements: inspection.elements.length
      }
    });
    return inspection;
  });

  ipcMain.handle(IPC_CHANNELS.computerCapture, async (event, windowId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const capture = await getComputerControlService().captureWindow(
      String(windowId || '')
    );
    const directory = path.join(app.getPath('userData'), 'evidence', 'computer');
    const filePath = path.join(directory, `${capture.id}.png`);
    await mkdir(directory, { recursive: true });
    await writeFile(
      filePath,
      Buffer.from(capture.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'),
      { mode: 0o600 }
    );
    await audit({
      projectId: activeProject.id,
      category: 'application',
      action: 'computer_window_captured',
      status: 'completed',
      summary: `Capture de fenêtre enregistrée (${capture.width} × ${capture.height}).`,
      details: {
        windowId: capture.windowId,
        fileCreated: filePath
      },
      evidence: {
        id: capture.id,
        source: 'machine',
        kind: 'screenshot',
        status: 'observed',
        title: 'Capture du contrôle PC expérimental',
        summary: `Capture PNG réelle de ${capture.width} × ${capture.height} pixels.`,
        capturedAt: capture.capturedAt,
        filePath,
        mediaType: 'image/png',
        metadata: {
          windowId: capture.windowId,
          width: capture.width,
          height: capture.height
        }
      }
    });
    return capture;
  });

  ipcMain.handle(
    IPC_CHANNELS.computerPlan,
    async (event, request: NeuraCoComputerActionRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const plan = await getComputerControlService().planAction(request);
      await audit({
        projectId: activeProject.id,
        category: 'application',
        action: 'computer_action_planned',
        status: 'started',
        summary: plan.explanation,
        details: {
          planId: plan.id,
          applicationId: plan.window.applicationId,
          action: plan.action,
          element: plan.element.name || plan.element.controlType,
          pointer: plan.pointer,
          expiresAt: plan.expiresAt
        }
      });
      return plan;
    }
  );

  ipcMain.handle(IPC_CHANNELS.computerExecute, async (event, planId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Fenêtre NeuraCo indisponible.');
    }
    const service = getComputerControlService();
    const plan = service.getPlan(String(planId || ''));
    if (!plan || plan.status !== 'pending') {
      throw new Error('Plan de contrôle PC introuvable ou déjà traité.');
    }
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Confirmer le contrôle PC expérimental',
      message: plan.explanation,
      detail: [
        `Application: ${plan.window.title}`,
        `Action: ${plan.action}`,
        `Élément: ${plan.element.name || plan.element.controlType}`,
        `Coordonnées: ${plan.pointer.x}, ${plan.pointer.y}`,
        'Cette confirmation est obligatoire et ne peut pas être mémorisée.'
      ].join('\n'),
      buttons: ['Exécuter', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) {
      service.cancelPlan(plan.id);
      await audit({
        projectId: activeProject.id,
        category: 'application',
        action: 'computer_action_refused',
        status: 'refused',
        summary: `Action refusée: ${plan.explanation}`,
        details: { planId: plan.id }
      });
      throw new Error('Action de contrôle PC annulée par l’utilisateur.');
    }
    ensureEmergencyRunning();
    const result = await service.executePlan(plan.id);
    await audit({
      projectId: activeProject.id,
      category: 'application',
      action: 'computer_action_completed',
      status: 'completed',
      summary: plan.explanation,
      details: {
        planId: plan.id,
        applicationId: plan.window.applicationId,
        action: plan.action,
        pointer: plan.pointer
      }
    });
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.computerCancel, (event, planId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getComputerControlService().cancelPlan(String(planId || ''));
  });

  ipcMain.handle(IPC_CHANNELS.studioAnalyze, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    ensureEmergencyRunning();
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    const allowed = await authorizeProjectAction({
      action: 'read_file',
      detail: activeProject.rootPath,
      software: 'Analyseur Studio NeuraCo',
      file: activeProject.rootPath,
      risk: 'Les manifestes et métadonnées de fichiers du projet seront lus localement.',
      reason: 'Détecter les ressources FiveM et scènes Blender/3ds Max.',
      estimatedCost: '0 crédit IA'
    });
    if (!allowed) throw new Error('Analyse Studio refusée.');
    const analysis = await getStudioService().analyze(activeProject);
    await appendStudioLog({
      timestamp: new Date().toISOString(),
      event: 'analysis',
      projectId: activeProject.id,
      scannedFiles: analysis.scannedFiles,
      issues: analysis.issues.length
    });
    return analysis;
  });

  ipcMain.handle(
    IPC_CHANNELS.studioRun,
    async (event, request: NeuraCoStudioOperationRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
      const operation = String(request?.operation || '');
      const tool = operation.startsWith('blender')
        ? 'blender'
        : operation.startsWith('max')
          ? '3dsmax'
          : 'fivem';
      const isExport = operation.endsWith('_export_gltf') || operation.endsWith('_export_fbx');
      const target = request?.targetPath
        ? validateStudioProjectPath(activeProject, request.targetPath)
        : undefined;
      const allowed = await authorizeProjectAction({
        action: tool === 'fivem' ? 'read_file' : 'application',
        detail: tool === 'fivem' ? activeProject.rootPath : tool,
        software: tool === '3dsmax' ? '3ds Max' : tool === 'blender' ? 'Blender' : 'FiveM',
        file: target,
        risk: isExport
          ? 'Le logiciel 3D ouvrira la scène et créera un fichier exporté dans le projet.'
          : 'Le projet ou la scène sera lu par une intégration locale structurée.',
        reason: `Exécuter l’opération contrôlée ${operation}.`,
        estimatedCost: '0 crédit IA'
      });
      if (!allowed) throw new Error('Opération Studio refusée.');
      if (isExport) {
        await createProjectCheckpointWithContext(
          activeProject,
          `Avant l’opération Studio ${operation}`,
          'important_change'
        );
      }
      const taskId = typeof request?.taskId === 'string' && request.taskId
        ? request.taskId
        : randomUUID();
      await audit({
        taskId,
        projectId: activeProject.id,
        category: 'studio',
        action: 'studio_started',
        status: 'started',
        summary: `Opération Studio ${operation}.`,
        details: {
          application: tool,
          fileRead: target,
          risk: isExport
            ? 'Création d’un fichier exporté dans le projet.'
            : 'Lecture contrôlée du projet.'
        }
      });
      try {
        const result = await withCriticalOperation(() => getStudioService().run(
          activeProject as NeuraCoProject,
          { ...request, taskId },
          (studioEvent) => {
            void appendStudioLog(studioEvent).catch((error) => {
              console.error('NeuraCo studio log failed', error);
            });
            if (!event.sender.isDestroyed()) {
              event.sender.send(IPC_CHANNELS.studioEvent, studioEvent);
            }
          }
        ));
        await audit({
          taskId,
          projectId: activeProject.id,
          category: 'studio',
          action: 'studio_completed',
          status: 'completed',
          summary: result.summary,
          details: {
            application: tool,
            filesCreated: [result.outputPath, result.reportPath].filter(Boolean),
            checkpoint: isExport ? `Avant l’opération Studio ${operation}` : undefined,
            durationMs: result.durationMs,
            output: result.output
          },
          evidence: {
            id: `${taskId}-studio`,
            source: 'machine',
            kind: 'studio_report',
            status: result.ok ? 'passed' : 'failed',
            title: `Rapport ${tool}`,
            summary: result.summary,
            capturedAt: result.completedAt,
            durationMs: result.durationMs,
            filePath: result.reportPath,
            mediaType: result.reportPath?.toLowerCase().endsWith('.json')
              ? 'application/json'
              : 'text/plain',
            output: result.output,
            metadata: {
              tool,
              operation,
              targetPath: result.targetPath || null,
              outputPath: result.outputPath || null
            }
          }
        });
        return result;
      } catch (error) {
        await audit({
          taskId,
          projectId: activeProject.id,
          category: 'studio',
          action: 'studio_failed',
          status: 'failed',
          summary: error instanceof Error ? error.message : 'Opération Studio échouée.',
          details: { application: tool, fileRead: target }
        });
        throw error;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.studioCancel, (event, taskId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getStudioService().cancel(String(taskId || ''));
  });

  ipcMain.handle(IPC_CHANNELS.usageGet, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const summary = await getUsage();
    if (activeProject) await notifyLowCredits(activeProject, summary);
    return summary;
  });

  ipcMain.handle(IPC_CHANNELS.runtimePolicyGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getRuntimePolicy();
  });

  ipcMain.handle(IPC_CHANNELS.adminStateGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getAdminState();
  });

  ipcMain.handle(
    IPC_CHANNELS.adminConfigUpdate,
    async (event, update: NeuraCoAdminConfigUpdate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow) throw new Error('NeuraCo window unavailable.');
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Apply NeuraCo administration changes?',
        message: update?.reason || 'Administrative configuration update',
        detail: `Affected groups: ${Object.keys(update || {})
          .filter((key) => !['expected_revision', 'reason'].includes(key))
          .join(', ') || 'none'}`,
        buttons: ['Cancel', 'Apply'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (confirmation.response !== 1) throw new Error('Administrative update cancelled.');
      return updateAdminConfig(update);
    }
  );

  ipcMain.handle(IPC_CHANNELS.adminPricingHistory, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getAdminPricingHistory();
  });
  ipcMain.handle(IPC_CHANNELS.adminUsersList, (event, search?: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return listAdminUsers(String(search || ''));
  });
  ipcMain.handle(IPC_CHANNELS.adminLogsList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return listAdminLogs();
  });
  ipcMain.handle(IPC_CHANNELS.adminIncidentsList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return listAdminIncidents();
  });
  ipcMain.handle(
    IPC_CHANNELS.adminIncidentCreate,
    (event, request: NeuraCoAdminIncidentCreate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return createAdminIncident(request);
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.adminIncidentUpdate,
    (event, incidentId: string, request: NeuraCoAdminIncidentUpdate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return updateAdminIncident(String(incidentId || ''), request);
    }
  );
  ipcMain.handle(IPC_CHANNELS.adminPromotionsList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return listAdminPromotions();
  });
  ipcMain.handle(
    IPC_CHANNELS.adminPromotionCreate,
    (event, request: NeuraCoAdminPromotionCreate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return createAdminPromotion(request);
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.adminPromotionUpdate,
    (event, promotionId: string, active: boolean) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return updateAdminPromotion(String(promotionId || ''), active === true);
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.adminCreditsAdjust,
    async (event, request: NeuraCoAdminCreditAdjustment) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow) throw new Error('NeuraCo window unavailable.');
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Adjust user credits?',
        message: `${request?.amount || 0} credits for ${request?.user_id || 'unknown user'}`,
        detail: request?.reason || 'No reason supplied',
        buttons: ['Cancel', 'Confirm adjustment'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (confirmation.response !== 1) throw new Error('Credit adjustment cancelled.');
      return adjustAdminCredits(request);
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.adminRefundRecord,
    async (event, request: NeuraCoAdminRefundRecord) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow) throw new Error('NeuraCo window unavailable.');
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Record an external refund?',
        message: request?.payment_reference || 'Unknown payment',
        detail:
          'This records a refund already completed by the payment provider and removes '
          + `${request?.credits_to_remove || 0} available credits.`,
        buttons: ['Cancel', 'Record refund'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (confirmation.response !== 1) throw new Error('Refund recording cancelled.');
      return recordAdminRefund(request);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.usageEstimate,
    (event, request: NeuraCoUsageEstimateRequest) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      return estimateUsage(request);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.usageSettings,
    async (event, request: NeuraCoUsageSettingsUpdate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      const summary = await updateUsageSettings(request);
      await audit({
        projectId: activeProject?.id,
        category: 'usage',
        action: 'usage_settings_updated',
        status: 'completed',
        summary: 'Limites et autorisations de crédits mises à jour.',
        details: {
          allowPurchasedCredits: request.allowPurchasedCredits,
          taskCap: request.taskCap,
          dailyCap: request.dailyCap,
          monthlyCap: request.monthlyCap,
          autoReloadEnabled: request.autoReloadEnabled
        }
      });
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.usageEvent, summary);
      }
      if (activeProject) await notifyLowCredits(activeProject, summary);
      return summary;
    }
  );

  ipcMain.handle(IPC_CHANNELS.usageCheckout, async (event, amountEur: number) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
    const amount = Math.round(Number(amountEur) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 5 || amount > 200) {
      throw new Error('Le montant doit être compris entre 5 € et 200 €.');
    }
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Acheter des crédits NeuraCo',
      message: `Créer un paiement unique de ${amount.toFixed(2)} € ?`,
      detail:
        'Le paiement sera ouvert sur la page sécurisée Stripe. '
        + 'Aucune clé ni donnée bancaire n’est stockée dans NeuraCo.',
      buttons: ['Continuer vers Stripe', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) throw new Error('Achat de crédits annulé.');
    const checkout = await createCreditCheckout(amount);
    await audit({
      projectId: activeProject?.id,
      category: 'billing',
      action: 'credit_checkout_created',
      status: 'started',
      summary: `Paiement unique de ${checkout.amount_eur.toFixed(2)} € créé.`,
      details: {
        credits: checkout.credits,
        amountEur: checkout.amount_eur,
        checkoutSessionId: checkout.session_id
      }
    });
    await shell.openExternal(checkout.url);
    return checkout;
  });

  const buildCurrentStatistics = async () => buildStatistics(
    await getUsageStatistics(),
    await getActivityService().list(5000),
    activeProject || undefined
  );

  ipcMain.handle(IPC_CHANNELS.statisticsGet, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return buildCurrentStatistics();
  });

  ipcMain.handle(IPC_CHANNELS.statisticsExportCsv, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
    const summary = await buildCurrentStatistics();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter les statistiques NeuraCo en CSV',
      defaultPath: 'statistiques-neuraco.csv',
      filters: [{ name: 'Tableur CSV', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, statisticsToCsv(summary), 'utf8');
    await audit({
      projectId: activeProject?.id,
      category: 'report',
      action: 'statistics_csv_exported',
      status: 'completed',
      summary: 'Statistiques NeuraCo exportées en CSV.',
      details: { fileCreated: result.filePath }
    });
    return result.filePath;
  });

  ipcMain.handle(IPC_CHANNELS.statisticsExportPdf, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
    const summary = await buildCurrentStatistics();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter les statistiques NeuraCo en PDF',
      defaultPath: 'statistiques-neuraco.pdf',
      filters: [{ name: 'Document PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, statisticsToPdf(summary));
    await audit({
      projectId: activeProject?.id,
      category: 'report',
      action: 'statistics_pdf_exported',
      status: 'completed',
      summary: 'Statistiques NeuraCo exportées en PDF.',
      details: { fileCreated: result.filePath }
    });
    return result.filePath;
  });

  ipcMain.handle(IPC_CHANNELS.activityList, (event, limit?: number) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const safeLimit = Number.isInteger(limit)
      ? Math.max(1, Math.min(Number(limit), 5000))
      : 500;
    return getActivityService().list(safeLimit);
  });

  ipcMain.handle(IPC_CHANNELS.reportBuild, (event, taskId?: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getActivityService().buildReport(
      typeof taskId === 'string' && taskId.trim() ? taskId.trim() : undefined
    );
  });

  ipcMain.handle(IPC_CHANNELS.reportExport, async (event, taskId?: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
    const report = await getActivityService().buildReport(
      typeof taskId === 'string' && taskId.trim() ? taskId.trim() : undefined
    );
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter le rapport NeuraCo',
      defaultPath: `rapport-neuraco-${report.taskId || 'activite'}.md`,
      filters: [
        { name: 'Rapport Markdown', extensions: ['md'] },
        { name: 'Rapport JSON', extensions: ['json'] }
      ]
    });
    if (result.canceled || !result.filePath) return null;
    const json = path.extname(result.filePath).toLowerCase() === '.json';
    await writeFile(
      result.filePath,
      json
        ? JSON.stringify(report, null, 2)
        : getActivityService().formatMarkdown(report),
      { encoding: 'utf8', mode: 0o600 }
    );
    await audit({
      taskId: report.taskId,
      projectId: activeProject?.id,
      category: 'report',
      action: 'report_exported',
      status: 'completed',
      summary: 'Rapport NeuraCo exporté.',
      details: { fileCreated: result.filePath }
    });
    return result.filePath;
  });

  ipcMain.handle(IPC_CHANNELS.evidenceOpen, async (event, evidenceId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const evidence = await getActivityService().findEvidence(String(evidenceId || ''));
    if (!evidence?.filePath) throw new Error('Cette preuve ne contient aucun fichier.');
    const target = path.resolve(evidence.filePath);
    const allowedRoots = [
      path.resolve(app.getPath('userData')),
      activeProject ? path.resolve(activeProject.rootPath) : null
    ].filter((root): root is string => Boolean(root));
    const allowed = allowedRoots.some((root) => {
      const relative = path.relative(root, target);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
    if (!allowed) throw new Error('Le fichier de preuve est hors des espaces autorisés.');
    const targetStat = await stat(target);
    if (!targetStat.isFile()) throw new Error('Le fichier de preuve est indisponible.');
    shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.updateCheck, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const preferences = await getUpdatePreferencesService().get();
    const manifest = await getUpdateService().check(preferences.channel);
    await getUpdatePreferencesService().markChecked();
    await audit({
      projectId: activeProject?.id,
      category: 'update',
      action: 'update_checked',
      status: 'completed',
      summary: manifest.available
        ? `NeuraCo ${manifest.latest_version} est disponible.`
        : 'NeuraCo est à jour.',
      details: {
        currentVersion: manifest.current_version,
        latestVersion: manifest.latest_version,
        channel: preferences.channel
      }
    });
    return manifest;
  });

  ipcMain.handle(IPC_CHANNELS.updateDownload, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    const state = await getUpdateService().download();
    await audit({
      projectId: activeProject?.id,
      category: 'update',
      action: 'update_downloaded',
      status: state.phase === 'ready' ? 'completed' : 'failed',
      summary: state.message,
      details: {
        fileCreated: state.installerPath,
        signature: state.signature
      }
    });
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.updateInstall, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Installer la mise à jour NeuraCo',
      message: 'NeuraCo va sauvegarder l’état du projet puis lancer l’installateur signé.',
      detail: 'Les actions critiques en cours bloqueront automatiquement l’installation.',
      buttons: ['Installer et fermer NeuraCo', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) throw new Error('Installation annulée.');
    const state = await getUpdateService().install();
    if (state.phase === 'installing') {
      await audit({
        projectId: activeProject?.id,
        category: 'update',
        action: 'update_installing',
        status: 'started',
        summary: state.message,
        details: { fileRead: state.installerPath, signature: state.signature }
      });
      setTimeout(() => app.quit(), 500);
    }
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.updatePreferencesGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getUpdatePreferencesService().get();
  });

  ipcMain.handle(
    IPC_CHANNELS.updatePreferencesSet,
    async (event, update: Partial<NeuraCoUpdatePreferences>) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      const preferences = await getUpdatePreferencesService().update(update || {});
      await audit({
        projectId: activeProject?.id,
        category: 'update',
        action: 'update_preferences_changed',
        status: 'completed',
        summary: `Canal ${preferences.channel}, vérification automatique ${preferences.autoCheck ? 'active' : 'inactive'}.`,
        details: {
          channel: preferences.channel,
          autoCheck: preferences.autoCheck,
          autoDownload: preferences.autoDownload,
          checkIntervalHours: preferences.checkIntervalHours
        }
      });
      return preferences;
    }
  );

  ipcMain.handle(IPC_CHANNELS.updateRollbackGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getUpdateService().getRollback();
  });

  ipcMain.handle(IPC_CHANNELS.updateRollbackInstall, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!mainWindow) throw new Error('Fenêtre NeuraCo indisponible.');
    const rollback = await getUpdateService().getRollback();
    if (!rollback.available || !rollback.version) {
      throw new Error('Aucune version précédente signée et vérifiée n’est disponible.');
    }
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Revenir à la version précédente',
      message: `NeuraCo va restaurer la version signée ${rollback.version}.`,
      detail: 'L’état du projet sera sauvegardé avant le lancement de l’installateur.',
      buttons: ['Restaurer et fermer NeuraCo', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) throw new Error('Retour à la version précédente annulé.');
    const state = await getUpdateService().rollback();
    if (state.phase === 'installing') {
      await audit({
        projectId: activeProject?.id,
        category: 'update',
        action: 'update_rollback_installing',
        status: 'started',
        summary: state.message,
        details: { version: rollback.version, signature: state.signature }
      });
      setTimeout(() => app.quit(), 500);
    }
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.permissionsGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getPermissionStore().get(activeProject.id, activeProject.rootPath);
  });

  ipcMain.handle(
    IPC_CHANNELS.permissionsUpdate,
    async (event, request: NeuraCoProjectPermissionsUpdate) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
      if (request?.mode === 'full') {
        if (
          request.fullAccessAcknowledged !== true
          || request.fullAccessPhrase !== 'J’ACCEPTE LES RISQUES'
        ) {
          throw new Error('La confirmation complète des risques est obligatoire.');
        }
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'ATTENTION — ACCÈS COMPLET À VOTRE ORDINATEUR',
          message: 'Une intelligence artificielle peut se tromper.',
          detail:
            'NeuraCo pourra utiliser les fichiers, applications et terminaux dans le périmètre de vos tâches. '
            + 'Les confirmations sensibles, journaux, checkpoints et l’arrêt d’urgence resteront actifs.',
          buttons: ['Activer l’accès complet', 'Annuler'],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        });
        if (confirmation.response !== 0) {
          throw new Error('Activation de l’accès complet annulée.');
        }
      }
      sessionAllowedSignatures.clear();
      return getPermissionStore().update(
        activeProject.id,
        activeProject.rootPath,
        request
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.checkpointList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getRecoveryService().listCheckpoints(activeProject);
  });

  ipcMain.handle(
    IPC_CHANNELS.checkpointCreate,
    async (event, input: string | NeuraCoCheckpointCreateRequest) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    ensureEmergencyRunning();
    const request = typeof input === 'string'
      ? { reason: input }
      : input && typeof input === 'object'
        ? input
        : { reason: '' };
    const safeReason = typeof request.reason === 'string' && request.reason.trim()
      ? request.reason.trim().slice(0, 300)
      : 'Checkpoint manuel';
    return createProjectCheckpointWithContext(
      activeProject,
      safeReason,
      request.trigger || 'manual',
      request.threadId,
      request.taskSettings
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.checkpointRestore,
    async (
      event,
      checkpointId: string,
      requestedTarget?: NeuraCoCheckpointRestoreTarget
    ) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      if (!mainWindow || !activeProject) throw new Error('Aucun projet n’est ouvert.');
      ensureEmergencyRunning();
      const target: NeuraCoCheckpointRestoreTarget = [
        'files',
        'conversation',
        'task_settings',
        'all'
      ].includes(requestedTarget || '')
        ? requestedTarget as NeuraCoCheckpointRestoreTarget
        : 'all';
      const snapshot = await getRecoveryService().getCheckpointSnapshot(
        activeProject,
        checkpointId
      );
      if (target === 'conversation' && !snapshot.conversation) {
        throw new Error('Ce checkpoint ancien ne contient pas de conversation.');
      }
      if (target === 'task_settings' && !snapshot.taskSettings) {
        throw new Error('Ce checkpoint ancien ne contient pas de réglages de tâche.');
      }
      const targetLabel = {
        files: 'les fichiers',
        conversation: 'la conversation',
        task_settings: 'les réglages de tâche',
        all: 'les fichiers, la conversation et les réglages disponibles'
      }[target];
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Restaurer ce checkpoint',
        message: `Restaurer ${targetLabel} ?`,
        detail:
          'Un checkpoint de sécurité sera créé avant la restauration. '
          + 'Les fichiers sensibles exclus ne seront pas modifiés.',
        buttons: ['Restaurer', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (confirmation.response !== 0) throw new Error('Restauration annulée.');

      await createProjectCheckpointWithContext(
        activeProject,
        `Avant la restauration du checkpoint ${checkpointId.slice(0, 8)}`,
        'important_change',
        undefined,
        undefined,
        [checkpointId]
      );

      const restored: NeuraCoCheckpointRestoreTarget[] = [];
      if (target === 'files' || target === 'all') {
        await getRecoveryService().restoreCheckpoint(activeProject, checkpointId);
        restored.push('files');
      }
      let conversation;
      if ((target === 'conversation' || target === 'all') && snapshot.conversation) {
        conversation = await getLocalSessionStore().restoreSnapshot(
          activeProject,
          snapshot.conversation,
          target === 'all'
        );
        restored.push('conversation');
      }
      if ((target === 'task_settings' || target === 'all') && snapshot.taskSettings) {
        restored.push('task_settings');
      }
      await audit({
        projectId: activeProject.id,
        category: 'file',
        action: 'checkpoint_restored',
        status: 'completed',
        summary: `Checkpoint restauré : ${targetLabel}.`,
        details: {
          checkpointId,
          restored
        }
      });
      return {
        checkpoint: snapshot.checkpoint,
        restored,
        conversation,
        taskSettings: target === 'conversation' ? undefined : snapshot.taskSettings
      };
    }
  );

  ipcMain.handle(IPC_CHANNELS.checkpointRetentionGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return getRecoveryService().getRetention();
  });

  ipcMain.handle(
    IPC_CHANNELS.checkpointRetentionUpdate,
    async (event, maxPerProject: number) => {
      ensureTrustedSender(event.senderFrame?.url ?? '');
      ensureEmergencyRunning();
      return getRecoveryService().updateRetention(maxPerProject);
    }
  );

  ipcMain.handle(IPC_CHANNELS.trashList, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    return getRecoveryService().listTrash(activeProject);
  });

  ipcMain.handle(IPC_CHANNELS.trashMove, async (event, relativePath: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    ensureEmergencyRunning();
    const allowed = await authorizeProjectAction({
      action: 'write_file',
      detail: path.resolve(activeProject.rootPath, relativePath),
      software: 'Explorateur NeuraCo',
      file: relativePath,
      risk: 'Le fichier sera retiré du projet mais restera récupérable.',
      reason: 'Déplacer l’élément vers la corbeille NeuraCo.',
      estimatedCost: '0 crédit IA'
    });
    if (!allowed) throw new Error('Suppression refusée par l’utilisateur.');
    await createProjectCheckpointWithContext(
      activeProject,
      `Avant le déplacement vers la corbeille : ${relativePath}`,
      'important_change'
    );
    return getRecoveryService().moveToTrash(activeProject, relativePath);
  });

  ipcMain.handle(IPC_CHANNELS.trashRestore, async (event, entryId: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (!activeProject) throw new Error('Aucun projet n’est ouvert.');
    ensureEmergencyRunning();
    return getRecoveryService().restoreTrash(activeProject, entryId);
  });

  ipcMain.handle(IPC_CHANNELS.emergencyStop, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return triggerEmergencyStop('interface');
  });

  ipcMain.handle(IPC_CHANNELS.emergencyResume, async (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    emergencyStopped = false;
    emergencyStoppedAt = undefined;
    const state = currentEmergencyState();
    await appendEmergencyLog('emergency_resume', { source: 'interface' }).catch((error) => {
      console.error('NeuraCo emergency log failed', error);
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.emergencyEvent, state);
    }
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.emergencyShortcutGet, (event) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    return emergencyShortcut;
  });

  ipcMain.handle(IPC_CHANNELS.emergencyShortcutSet, (event, accelerator: string) => {
    ensureTrustedSender(event.senderFrame?.url ?? '');
    if (typeof accelerator !== 'string') throw new Error('Raccourci invalide.');
    return registerEmergencyShortcut(accelerator);
  });
};

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    show: false,
    backgroundColor: '#07090f',
    title: 'NeuraCo',
    webPreferences: secureWebPreferences
  });
  const accessibility = await getAccessibilityService().get();
  mainWindow.webContents.setZoomFactor(accessibility.zoomPercent / 100);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://neura-alnour.vercel.app/')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll }
      );
    } else if (params.selectionText) {
      template.push({ role: 'copy', enabled: params.editFlags.canCopy });
    }
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: mainWindow || undefined });
    }
  });
  navigationGuardEnabled = true;

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    browserService?.destroy();
    browserService = null;
    mainWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
};

const recoverBackgroundProcesses = async (): Promise<void> => {
  if (!mainWindow) return;
  const survivors = await getBackgroundProcessService().recoverSurvivors();
  if (survivors.length === 0) return;
  const names = survivors
    .slice(0, 8)
    .map((item) => `• ${item.name} (PID ${item.pid || '?'})`)
    .join('\n');
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Processus en arrière-plan détectés',
    message: `${survivors.length} processus NeuraCo sont encore actifs.`,
    detail:
      `${names}\n\nRattacher réactive leur suivi dans l’interface. `
      + 'Conserver les laisse fonctionner sans les attacher.',
    buttons: ['Rattacher', 'Conserver', 'Arrêter'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  const action: NeuraCoBackgroundProcessAction = confirmation.response === 0
    ? 'attach'
    : confirmation.response === 1
      ? 'keep'
      : 'force_stop';
  await Promise.all(
    survivors.map((item) => (
      getBackgroundProcessService().control(item.id, action)
    ))
  );
  await audit({
    category: 'terminal',
    action: 'background_process_recovery',
    status: 'completed',
    summary: `${survivors.length} processus récupérés avec l’action ${action}.`,
    details: {
      action,
      processes: survivors.map((item) => ({
        name: item.name,
        processId: item.pid
      }))
    }
  });
};

const selfTestFileArg = process.argv.find((argument) =>
  argument.startsWith('--self-test-file=')
);
const browserSmokeFileArg = process.argv.find((argument) =>
  argument.startsWith('--browser-smoke-file=')
);

app.whenReady().then(async () => {
  process.on('uncaughtExceptionMonitor', (error) => {
    void getTechnicalErrorLogService().record('main.uncaught', error);
  });
  process.on('unhandledRejection', (reason) => {
    void getTechnicalErrorLogService().record('main.rejection', reason);
  });
  await runLocalDatabaseMigrations();
  await getAppLockService().initialize();
  getRoutineService();
  const windowsHelloCheck = checkWindowsHelloAvailability();
  idleLockTimer = setInterval(() => {
    const service = getAppLockService();
    if (service.shouldLockForIdle(powerMonitor.getSystemIdleTime())) {
      service.lock('idle');
    }
  }, 5_000);
  registerIpcHandlers();
  await loadEmergencyShortcut();
  await createWindow();
  void windowsHelloCheck.then((availability) => {
    getAppLockService().setWindowsHelloAvailability(availability);
  }).catch(() => {
    getAppLockService().setWindowsHelloAvailability('unknown');
  });
  if (!selfTestFileArg && !browserSmokeFileArg) {
    await recoverBackgroundProcesses();
  }

  if (browserSmokeFileArg) {
    const outputPath = path.resolve(
      browserSmokeFileArg.slice('--browser-smoke-file='.length)
    );
    const smokeUrl = process.env.NEURACO_BROWSER_SMOKE_URL;
    if (!smokeUrl) throw new Error('NEURACO_BROWSER_SMOKE_URL est obligatoire.');
    const browser = getBrowserService();
    const startedAt = Date.now();
    await browser.createTab(smokeUrl);
    const action = await browser.action({
      type: 'type',
      selector: '#neuraco-smoke-input',
      text: 'NeuraCo browser verified'
    });
    browser.setBounds({ x: 0, y: 0, width: 800, height: 600 });
    mainWindow?.show();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const capture = await browser.capture();
    const diagnostics = await browser.inspect();
    const history = await browser.history();
    const report = {
      ok: action.ok
        && capture.width > 0
        && capture.height > 0
        && diagnostics.metrics.viewportWidth > 0,
      durationMs: Date.now() - startedAt,
      state: browser.state(),
      action,
      capture: {
        width: capture.width,
        height: capture.height,
        url: capture.url,
        hasPngData: capture.dataUrl.startsWith('data:image/png;base64,')
      },
      diagnostics,
      history: history.slice(0, 3)
    };
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
    browser.destroy();
    app.exit(report.ok ? 0 : 1);
    return;
  }

  if (selfTestFileArg) {
    const outputPath = path.resolve(selfTestFileArg.slice('--self-test-file='.length));
    const report = {
      app: appInfo(),
      security: securityReport()
    };
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
}).catch((error) => {
  console.error('NeuraCo failed to start', error);
  app.exit(1);
});

app.on('will-quit', () => {
  if (idleLockTimer) clearInterval(idleLockTimer);
  idleLockTimer = null;
  deviceSecurityService?.stop();
  void ideBridgeService?.stop();
  void hostedSiteService?.stopAllPreviews();
  relayService?.disable();
  browserService?.destroy();
  applicationService?.stopAll();
  backgroundProcessService?.stopNonPersistentSync();
  studioService?.cancelAll();
  remoteConnectionService?.disconnectAll();
  routineService?.stopScheduler();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
