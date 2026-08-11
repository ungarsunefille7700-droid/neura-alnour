import { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import {
  Activity,
  BarChart3,
  Blocks,
  Bot,
  Archive,
  Bell,
  BrainCircuit,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  ClipboardCheck,
  Cloud,
  Code2,
  DatabaseBackup,
  Download,
  File,
  FilePlus2,
  Files,
  Folder,
  FolderOpen,
  Gauge,
  GitBranch,
  Globe2,
  ImagePlus,
  Images,
  LayoutDashboard,
  LoaderCircle,
  Monitor,
  MousePointer2,
  Network,
  OctagonX,
  Play,
  Power,
  RadioTower,
  Replace,
  RotateCcw,
  Search,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  SquareTerminal,
  Target,
  Trash2,
  UsersRound,
  Webhook,
  X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  NeuraCoAgentFileContext,
  NeuraCoAgentModel,
  NeuraCoAgentDefinition,
  NeuraCoAgentImageContext,
  NeuraCoCheckpoint,
  NeuraCoCheckpointRetention,
  NeuraCoCheckpointRestoreTarget,
  NeuraCoCheckpointTaskSettings,
  NeuraCoCloudTask,
  NeuraCoCommunicationStyle,
  NeuraCoConnectivityState,
  NeuraCoConversationThread,
  NeuraCoConversationThreadSummary,
  NeuraCoControlledMemoryState,
  NeuraCoEmergencyState,
  NeuraCoEffortLevel,
  NeuraCoExecutionMode,
  NeuraCoForgeIssue,
  NeuraCoNotification,
  NeuraCoNotificationAction,
  NeuraCoNotificationActionEvent,
  NeuraCoPermissionMode,
  NeuraCoProjectFile,
  NeuraCoProjectFileNode,
  NeuraCoProjectPermissions,
  NeuraCoProjectPermissionsUpdate,
  NeuraCoProposedFile,
  NeuraCoProjectSnapshot,
  NeuraCoPersistedChatMessage,
  NeuraCoResponseSpeed,
  NeuraCoRecoverableTask,
  NeuraCoRecoverableTaskInspection,
  NeuraCoRelayState,
  NeuraCoTaskResumeStrategy,
  NeuraCoTaskMode,
  NeuraCoTaskRoutingPreview,
  NeuraCoTrashEntry
} from '../electron/ipc-contract';
import {
  clipboardImageFiles,
  droppedImageFiles,
  formatImageBytes,
  isSupportedImageFile,
  MAX_AGENT_IMAGES,
  prepareImageAttachment,
  type NeuraCoPreparedImage
} from './image-attachments';
import ProjectPermissionsDialog from './ProjectPermissionsDialog';
import RecoveryPanel from './RecoveryPanel';
import MultiAgentPanel from './MultiAgentPanel';
import GitPanel from './GitPanel';
import BrowserPanel from './BrowserPanel';
import StudioPanel from './StudioPanel';
import UsagePanel from './UsagePanel';
import ReviewQueuePanel from './ReviewQueuePanel';
import BackgroundProcessesPanel from './BackgroundProcessesPanel';
import ArtifactsPanel from './ArtifactsPanel';
import TaskRoutingPreview from './TaskRoutingPreview';
import ControlledMemoryPanel from './ControlledMemoryPanel';
import ExtensionsPanel from './ExtensionsPanel';
import HooksPanel from './HooksPanel';
import RoutinesPanel from './RoutinesPanel';
import NotificationPanel from './NotificationPanel';
import GoalsPanel from './GoalsPanel';
import SecondaryConversationPanel from './SecondaryConversationPanel';
import EnvironmentTransferPanel from './EnvironmentTransferPanel';
import ImageStudioPanel from './ImageStudioPanel';
import HostedSitesPanel from './HostedSitesPanel';
import StatisticsPanel from './StatisticsPanel';
import TerminalPanel from './TerminalPanel';
import ComputerControlPanel from './ComputerControlPanel';
import {
  EMPTY_EDITOR_SESSION,
  activeEditorDocument,
  closeEditorDocument,
  isEditorDocumentDirty,
  markEditorDocumentSaved,
  openEditorDocument,
  selectEditorDocument,
  updateEditorDocument
} from './editor-session';
import './monaco-setup';

type WorkspaceTab =
  | 'chat'
  | 'team'
  | 'review'
  | 'git'
  | 'browser'
  | 'computer'
  | 'studio'
  | 'usage'
  | 'statistics'
  | 'editor'
  | 'terminal'
  | 'processes'
  | 'artifacts'
  | 'memory'
  | 'extensions'
  | 'hooks'
  | 'routines'
  | 'goals'
  | 'environments'
  | 'sites'
  | 'images';

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  files?: string[];
  proposedFiles?: NeuraCoProposedFile[];
  images?: Array<Pick<
    NeuraCoPreparedImage,
    'id' | 'name' | 'preview' | 'width' | 'height' | 'size'
  >>;
}

interface PendingImage {
  localId: string;
  name: string;
  progress: number;
  image?: NeuraCoPreparedImage;
  error?: string;
}

type RequestedTaskMode = Exclude<NeuraCoTaskMode, 'mixed'>;

interface PendingRoutedTask {
  content: string;
  userEntry: ChatEntry;
  fileContexts: NeuraCoAgentFileContext[];
  conversationContext: NeuraCoPersistedChatMessage[];
  images: NeuraCoPreparedImage[];
}

type ActiveExecutionKind = 'agent' | 'multi_agent' | 'cloud';

interface ActiveChatExecution {
  id: string;
  kind: ActiveExecutionKind;
  objective: string;
}

interface DeferredInstruction extends PendingRoutedTask {
  id: string;
  createdAt: string;
}

interface WorkspacePageProps {
  snapshot: NeuraCoProjectSnapshot;
  onRefresh: () => Promise<void>;
  onOpenProject: () => Promise<void>;
}

const PERMISSION_MODE_LABELS: Record<NeuraCoPermissionMode, string> = {
  plan: 'Lecture seule',
  manual: 'Manuel',
  accept_edits: 'Modifications',
  safe_auto: 'Auto sécurisé',
  deny_unapproved: 'Sans demande',
  full: 'Accès complet'
};

const flattenFiles = (nodes: NeuraCoProjectFileNode[]): NeuraCoProjectFileNode[] => (
  nodes.flatMap((node) => (
    node.kind === 'directory'
      ? [node, ...flattenFiles(node.children || [])]
      : [node]
  ))
);

const FileTree = ({
  nodes,
  activePath,
  depth = 0,
  onOpen
}: {
  nodes: NeuraCoProjectFileNode[];
  activePath?: string;
  depth?: number;
  onOpen: (node: NeuraCoProjectFileNode) => void;
}) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className="file-tree">
      {nodes.map((node) => {
        const isDirectory = node.kind === 'directory';
        const isCollapsed = collapsed[node.relativePath] === true;
        return (
          <div key={node.relativePath}>
            <button
              type="button"
              className={`file-tree-row ${activePath === node.relativePath ? 'is-active' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => {
                if (isDirectory) {
                  setCollapsed((current) => ({
                    ...current,
                    [node.relativePath]: !current[node.relativePath]
                  }));
                } else {
                  onOpen(node);
                }
              }}
              title={node.relativePath}
            >
              {isDirectory
                ? isCollapsed
                  ? <ChevronRight size={14} />
                  : <ChevronDown size={14} />
                : <span className="tree-spacer" />}
              {isDirectory
                ? isCollapsed
                  ? <Folder size={15} />
                  : <FolderOpen size={15} />
                : <File size={15} />}
              <span>{node.name}</span>
            </button>
            {isDirectory && !isCollapsed && node.children && (
              <FileTree
                nodes={node.children}
                activePath={activePath}
                depth={depth + 1}
                onOpen={onOpen}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default function WorkspacePage({
  snapshot,
  onRefresh,
  onOpenProject
}: WorkspacePageProps) {
  const [tab, setTab] = useState<WorkspaceTab>('chat');
  const [editorSession, setEditorSession] = useState(EMPTY_EDITOR_SESSION);
  const [editorPreview, setEditorPreview] = useState(false);
  const [editorMarkers, setEditorMarkers] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [packageBusy, setPackageBusy] = useState(false);
  const [connectivity, setConnectivity] = useState<NeuraCoConnectivityState>({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    checkedAt: new Date().toISOString(),
    source: 'system'
  });
  const [newFilePath, setNewFilePath] = useState('');
  const [creatingFile, setCreatingFile] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [taskMode, setTaskMode] = useState<RequestedTaskMode>('automatic');
  const [effort, setEffort] = useState<NeuraCoEffortLevel>('normal');
  const [selectedModel, setSelectedModel] = useState<NeuraCoAgentModel>('auto');
  const [responseSpeed, setResponseSpeed] = useState<NeuraCoResponseSpeed>('standard');
  const [communicationStyle, setCommunicationStyle] =
    useState<NeuraCoCommunicationStyle>('normal');
  const [composerToolsOpen, setComposerToolsOpen] = useState(false);
  const [proposalReviewMessageId, setProposalReviewMessageId] = useState<string>();
  const [proposalReviewPath, setProposalReviewPath] = useState<string>();
  const [proposalApplying, setProposalApplying] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [activeExecution, setActiveExecution] =
    useState<ActiveChatExecution | null>(null);
  const [instructionDecision, setInstructionDecision] =
    useState<DeferredInstruction | null>(null);
  const [instructionQueue, setInstructionQueue] =
    useState<DeferredInstruction[]>([]);
  const [parallelSubtaskCount, setParallelSubtaskCount] = useState(0);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingPreview, setRoutingPreview] = useState<NeuraCoTaskRoutingPreview>();
  const [pendingRoutedTask, setPendingRoutedTask] = useState<PendingRoutedTask>();
  const [routingAgents, setRoutingAgents] = useState<NeuraCoAgentDefinition[]>([]);
  const [selectedRoutingAgentIds, setSelectedRoutingAgentIds] = useState<string[]>([]);
  const [controlledMemory, setControlledMemory] =
    useState<NeuraCoControlledMemoryState>();
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string>();
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [conversationThreads, setConversationThreads] = useState<
    NeuraCoConversationThreadSummary[]
  >([]);
  const [executionMode, setExecutionMode] = useState<NeuraCoExecutionMode>('local');
  const [activeCloudTask, setActiveCloudTask] = useState<NeuraCoCloudTask | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [relayState, setRelayState] = useState<NeuraCoRelayState>({
    enabled: false,
    connected: false,
    pendingCommands: [],
    transport: 'outbound-https',
    publicPortOpen: false
  });
  const [includeActiveFile, setIncludeActiveFile] = useState(true);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [draggingImages, setDraggingImages] = useState(false);
  const [permissions, setPermissions] = useState<NeuraCoProjectPermissions | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [checkpoints, setCheckpoints] = useState<NeuraCoCheckpoint[]>([]);
  const [checkpointRetention, setCheckpointRetention] =
    useState<NeuraCoCheckpointRetention>();
  const [trashEntries, setTrashEntries] = useState<NeuraCoTrashEntry[]>([]);
  const [recoverableTasks, setRecoverableTasks] = useState<NeuraCoRecoverableTask[]>([]);
  const [notifications, setNotifications] = useState<NeuraCoNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [secondaryConversationOpen, setSecondaryConversationOpen] = useState(false);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [emergencyState, setEmergencyState] = useState<NeuraCoEmergencyState>({
    stopped: false,
    terminalsStopped: 0,
    agentsStopped: 0
  });
  const [emergencyShortcut, setEmergencyShortcut] = useState(
    'CommandOrControl+Shift+Escape'
  );
  const [messages, setMessages] = useState<ChatEntry[]>([
    {
      id: 'welcome',
      role: 'system',
      content: 'Projet ouvert. Sélectionnez un fichier ou posez une question à NeuraCo.'
    }
  ]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const handledCloudTasksRef = useRef(new Set<string>());
  const activeExecutionRef = useRef<ActiveChatExecution | null>(null);
  const instructionQueueRef = useRef<DeferredInstruction[]>([]);
  const redirectInstructionRef = useRef<DeferredInstruction | null>(null);
  const deferredExecutionRunningRef = useRef(false);
  const emergencyStoppedRef = useRef(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const markerSubscriptionRef = useRef<{ dispose: () => void } | null>(null);

  const allFiles = useMemo(() => (
    flattenFiles(snapshot.files).filter((node) => node.kind === 'file')
  ), [snapshot.files]);
  const activeDocument = activeEditorDocument(editorSession);
  const activeFile = activeDocument?.file || null;
  const editorValue = activeDocument?.value || '';
  const activeConversationThread = conversationThreads.find(
    (thread) => thread.threadId === activeThreadId
  );
  const dirty = Boolean(activeDocument && isEditorDocumentDirty(activeDocument));
  const readyImages = pendingImages
    .map((attachment) => attachment.image)
    .filter((image): image is NeuraCoPreparedImage => Boolean(image));
  const imagesProcessing = pendingImages.some(
    (attachment) => !attachment.image && !attachment.error
  );
  const unreadNotifications = notifications.filter(
    (notification) => !notification.readAt
  ).length;
  const proposalReviewMessage = messages.find(
    (message) => message.id === proposalReviewMessageId
  );
  const proposalReviewFiles = proposalReviewMessage?.proposedFiles || [];
  const proposalReviewFile = proposalReviewFiles.find(
    (file) => file.path === proposalReviewPath
  ) || proposalReviewFiles[0];

  const applyConversationThread = (thread: NeuraCoConversationThread) => {
    setActiveThreadId(thread.threadId);
    setSessionId(thread.sessionId);
    setTaskMode(thread.taskSettings?.taskMode || 'automatic');
    setEffort(thread.taskSettings?.effort || 'normal');
    setSelectedModel(thread.taskSettings?.model || 'auto');
    setResponseSpeed(thread.taskSettings?.responseSpeed || 'standard');
    setCommunicationStyle(thread.taskSettings?.communicationStyle || 'normal');
    setExecutionMode(thread.taskSettings?.executionMode || thread.executionMode);
    setIncludeActiveFile(thread.taskSettings?.includeActiveFile !== false);
    setComposerToolsOpen(false);
    setActiveCloudTask(null);
    setRoutingPreview(undefined);
    setPendingRoutedTask(undefined);
    setRoutingAgents([]);
    setSelectedRoutingAgentIds([]);
    setProposalReviewMessageId(undefined);
    setProposalReviewPath(undefined);
    handledCloudTasksRef.current.clear();
    setMessages(thread.messages.length > 0
      ? thread.messages
      : [{
          id: `welcome-${thread.threadId}`,
          role: 'system',
          content: 'Ce fil est prêt. Posez une question à NeuraCo.'
        }]);
  };

  const refreshConversationThreads = async () => {
    if (!window.neuraco) return;
    setConversationThreads(await window.neuraco.listConversationThreads(true));
  };

  useEffect(() => {
    let active = true;
    const refreshConnectivity = async () => {
      try {
        const next = await window.neuraco?.getConnectivityState?.();
        if (active && next) setConnectivity(next);
      } catch {
        if (active) {
          setConnectivity({
            online: navigator.onLine,
            checkedAt: new Date().toISOString(),
            source: 'system'
          });
        }
      }
    };
    const handleConnectivityChange = () => {
      setConnectivity({
        online: navigator.onLine,
        checkedAt: new Date().toISOString(),
        source: 'system'
      });
      void refreshConnectivity();
    };
    void refreshConnectivity();
    window.addEventListener('online', handleConnectivityChange);
    window.addEventListener('offline', handleConnectivityChange);
    const timer = window.setInterval(refreshConnectivity, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('online', handleConnectivityChange);
      window.removeEventListener('offline', handleConnectivityChange);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.neuraco?.onEmergencyState((state) => {
      emergencyStoppedRef.current = state.stopped;
      setEmergencyState(state);
      if (state.stopped) {
        setChatBusy(false);
        setStatus(
          `Arrêt d’urgence actif : ${state.terminalsStopped} commande(s) et `
          + `${state.agentsStopped} appel(s) IA interrompus.`
        );
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    window.neuraco?.getRelayState()
      .then((state) => {
        if (active) setRelayState(state);
      })
      .catch(() => undefined);
    const unsubscribe = window.neuraco?.onRelayEvent((event) => {
      if (!active) return;
      setRelayState(event.state);
      if (event.type === 'instruction' && event.command?.payload.instruction) {
        setExecutionMode('local');
        setChatInput(event.command.payload.instruction);
        setStatus(
          'Instruction distante validée et placée dans le composeur. '
          + 'Vérifiez-la avant de l’envoyer.'
        );
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setPermissions(null);
    window.neuraco?.getProjectPermissions()
      .then((result) => {
        if (active) {
          setPermissions(result);
          if (!result.configured) setPermissionsOpen(true);
        }
      })
      .catch((error) => {
        if (active) {
          setStatus(
            error instanceof Error
              ? error.message
              : 'Impossible de charger les autorisations du projet.'
          );
        }
      });
    return () => {
      active = false;
    };
  }, [snapshot.project.id]);

  useEffect(() => {
    let active = true;
    setControlledMemory(undefined);
    window.neuraco?.listControlledMemories()
      .then((state) => {
        if (active) setControlledMemory(state);
      })
      .catch((error) => {
        if (active) {
          setStatus(
            error instanceof Error
              ? error.message
              : 'Impossible de charger la mémoire contrôlée.'
          );
        }
      });
    return () => {
      active = false;
    };
  }, [snapshot.project.id]);

  useEffect(() => {
    let active = true;
    setSessionLoaded(false);
    setActiveCloudTask(null);
    handledCloudTasksRef.current.clear();
    window.neuraco?.getLocalSession()
      .then(async (existing) => {
        if (!active) return;
        const stored = existing || await window.neuraco?.createConversationThread({
          title: 'Fil principal'
        });
        if (stored) {
          applyConversationThread(stored as NeuraCoConversationThread);
          if (stored.cloudTaskId) {
            const task = await window.neuraco?.getCloudTask(stored.cloudTaskId);
            if (active && task) {
              setActiveCloudTask(task);
              const running = ['queued', 'running', 'cancel_requested'].includes(
                task.status
              );
              setChatBusy(running);
              if (running) {
                const execution: ActiveChatExecution = {
                  id: task.id,
                  kind: 'cloud',
                  objective: 'Tâche Cloud restaurée'
                };
                activeExecutionRef.current = execution;
                setActiveExecution(execution);
              }
            }
          }
        } else {
          const cloudTasks = await window.neuraco?.listCloudTasks(10);
          const pending = cloudTasks?.find((task) => (
            ['queued', 'running', 'cancel_requested'].includes(task.status)
          ));
          if (active && pending) {
            setExecutionMode('cloud');
            setSessionId(pending.sessionId);
            setActiveCloudTask(pending);
            setChatBusy(true);
            const execution: ActiveChatExecution = {
              id: pending.id,
              kind: 'cloud',
              objective: 'Tâche Cloud restaurée'
            };
            activeExecutionRef.current = execution;
            setActiveExecution(execution);
          }
        }
        if (active) {
          const threads = await window.neuraco?.listConversationThreads(true);
          setConversationThreads(threads || []);
        }
      })
      .catch((error) => {
        if (active) {
          setStatus(
            error instanceof Error
              ? error.message
              : 'Impossible de restaurer la session NeuraCo.'
          );
        }
      })
      .finally(() => {
        if (active) setSessionLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [snapshot.project.id]);

  useEffect(() => {
    if (!sessionLoaded || !window.neuraco) return;
    const timer = window.setTimeout(() => {
      void window.neuraco?.saveLocalSession({
        threadId: activeThreadId,
        sessionId,
        executionMode,
        cloudTaskId: activeCloudTask?.id,
        taskSettings: {
          taskMode,
          effort,
          model: selectedModel,
          responseSpeed,
          communicationStyle,
          executionMode,
          includeActiveFile
        },
        messages: messages.map(({ id, role, content, model, files, proposedFiles }) => ({
          id,
          role,
          content,
          model,
          files,
          proposedFiles
        }))
      }).then((saved) => {
        setConversationThreads((current) => current.map((thread) => (
          thread.threadId === saved.threadId
            ? {
                ...thread,
                messageCount: saved.messages.length,
                lastMessagePreview: saved.messages.at(-1)?.content
                  .replace(/\s+/g, ' ')
                  .slice(0, 180),
                updatedAt: saved.updatedAt
              }
            : thread
        )));
      }).catch((error) => {
        setStatus(
          error instanceof Error
            ? error.message
            : 'La session locale n’a pas pu être sauvegardée.'
        );
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    activeCloudTask?.id,
    activeThreadId,
    communicationStyle,
    effort,
    executionMode,
    includeActiveFile,
    messages,
    responseSpeed,
    selectedModel,
    sessionId,
    sessionLoaded,
    taskMode
  ]);

  useEffect(() => {
    if (!activeCloudTask || !window.neuraco) return;
    let active = true;
    const applyTask = (task: NeuraCoCloudTask) => {
      setActiveCloudTask(task);
      setSessionId(task.sessionId);
      if (
        ['completed', 'failed', 'cancelled'].includes(task.status)
        && !handledCloudTasksRef.current.has(task.id)
      ) {
        handledCloudTasksRef.current.add(task.id);
        finishCurrentExecution(task.id);
        setMessages((current) => {
          const id = `cloud-result-${task.id}`;
          if (current.some((message) => message.id === id)) return current;
          return [
            ...current,
            task.status === 'completed'
              ? {
                  id,
                  role: 'assistant',
                  content: task.result || 'Tâche Cloud terminée sans contenu.',
                  model: `${task.modelDisplay || task.model || 'Modèle Cloud'} · Cloud`
                }
              : {
                  id,
                  role: 'system',
                  content: task.status === 'cancelled'
                    ? 'La tâche Cloud a été annulée.'
                    : `La tâche Cloud a échoué : ${task.error || 'erreur distante contrôlée.'}`
                }
          ];
        });
      }
    };
    if (['completed', 'failed', 'cancelled'].includes(activeCloudTask.status)) {
      applyTask(activeCloudTask);
      return;
    }
    const refresh = async () => {
      try {
        const task = await window.neuraco?.getCloudTask(activeCloudTask.id);
        if (!active || !task) return;
        applyTask(task);
      } catch (error) {
        if (active) {
          setStatus(
            error instanceof Error
              ? error.message
              : 'Impossible de suivre la tâche Cloud.'
          );
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeCloudTask?.id, activeCloudTask?.status]);

  const openFile = async (node: NeuraCoProjectFileNode) => {
    if (!window.neuraco || node.kind !== 'file') return;
    if (editorSession.documents.some(
      (document) => document.file.relativePath === node.relativePath
    )) {
      setEditorSession((current) => selectEditorDocument(current, node.relativePath));
      setEditorPreview(false);
      setTab('editor');
      return;
    }
    setStatus(null);
    try {
      const file = await window.neuraco.readProjectFile(node.relativePath);
      setEditorSession((current) => openEditorDocument(current, file));
      setEditorPreview(false);
      setTab('editor');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Impossible d’ouvrir ce fichier.');
    }
  };

  const saveFile = async () => {
    if (!window.neuraco || !activeFile || !dirty || emergencyState.stopped) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await window.neuraco.saveProjectFile(activeFile.relativePath, editorValue);
      const savedFile = {
        ...activeFile,
        content: editorValue,
        size: result.size,
        modifiedAt: result.savedAt
      };
      setEditorSession((current) => (
        markEditorDocumentSaved(current, activeFile.relativePath, savedFile)
      ));
      setStatus(`${activeFile.relativePath} enregistré.`);
      await onRefresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  const createFile = async () => {
    if (!window.neuraco || !newFilePath.trim()) return;
    setCreatingFile(true);
    setStatus(null);
    try {
      await window.neuraco.saveProjectFile(newFilePath.trim(), '');
      await onRefresh();
      const file = await window.neuraco.readProjectFile(newFilePath.trim());
      setEditorSession((current) => openEditorDocument(current, file));
      setEditorPreview(false);
      setNewFilePath('');
      setTab('editor');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Impossible de créer ce fichier.');
    } finally {
      setCreatingFile(false);
    }
  };

  const addImageFiles = async (files: File[]) => {
    if (executionMode !== 'local') {
      setStatus('Les images restent sur ce PC et sont disponibles uniquement en mode Local.');
      return;
    }
    const availableSlots = MAX_AGENT_IMAGES - pendingImages.length;
    if (availableSlots <= 0) {
      setStatus(`Vous pouvez joindre au maximum ${MAX_AGENT_IMAGES} images.`);
      return;
    }
    const selected = files.slice(0, availableSlots);
    setStatus(
      files.length > availableSlots
        ? `Seules les ${MAX_AGENT_IMAGES} premières images sont conservées.`
        : null
    );

    for (const file of selected) {
      const localId = crypto.randomUUID();
      if (!isSupportedImageFile(file)) {
        setPendingImages((current) => [
          ...current,
          {
            localId,
            name: file.name || 'image',
            progress: 0,
            error: 'Format non pris en charge. Utilisez PNG, JPEG, WEBP ou GIF.'
          }
        ]);
        continue;
      }

      setPendingImages((current) => [
        ...current,
        { localId, name: file.name || 'image', progress: 1 }
      ]);
      try {
        const image = await prepareImageAttachment(file, (progress) => {
          setPendingImages((current) => current.map((attachment) => (
            attachment.localId === localId
              ? { ...attachment, progress }
              : attachment
          )));
        });
        setPendingImages((current) => current.map((attachment) => (
          attachment.localId === localId
            ? { ...attachment, name: image.name, progress: 100, image }
            : attachment
        )));
      } catch (error) {
        setPendingImages((current) => current.map((attachment) => (
          attachment.localId === localId
            ? {
                ...attachment,
                progress: 0,
                error: error instanceof Error ? error.message : 'Image illisible.'
              }
            : attachment
        )));
      }
    }
  };

  const updatePermissions = async (request: NeuraCoProjectPermissionsUpdate) => {
    if (!window.neuraco) return;
    setPermissionsBusy(true);
    setStatus(null);
    try {
      const updated = await window.neuraco.updateProjectPermissions(request);
      setPermissions(updated);
      setPermissionsOpen(false);
      setStatus('Autorisations du projet mises à jour.');
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Impossible de modifier les autorisations.'
      );
    } finally {
      setPermissionsBusy(false);
    }
  };

  const disableFullAccess = async () => {
    if (!permissions) return;
    await updatePermissions({
      mode: 'manual',
      allowedActions: [],
      allowedFolders: [permissions.projectRoot],
      allowedCommandPrefixes: [],
      allowedDomains: [],
      allowedApplications: [],
      alwaysAllowedSignatures: []
    });
  };

  const refreshRecovery = async () => {
    if (!window.neuraco) return;
    const [
      nextCheckpoints,
      nextTrash,
      shortcut,
      nextRecoverableTasks,
      nextRetention
    ] = await Promise.all([
      window.neuraco.listCheckpoints(),
      window.neuraco.listTrash(),
      window.neuraco.getEmergencyShortcut(),
      window.neuraco.listRecoverableTasks(),
      window.neuraco.getCheckpointRetention()
    ]);
    setCheckpoints(nextCheckpoints);
    setTrashEntries(nextTrash);
    setEmergencyShortcut(shortcut);
    setRecoverableTasks(nextRecoverableTasks);
    setCheckpointRetention(nextRetention);
  };

  const openRecovery = async () => {
    setRecoveryOpen(true);
    setRecoveryBusy(true);
    try {
      await refreshRecovery();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Restauration indisponible.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const refreshNotifications = async () => {
    if (!window.neuraco) return;
    setNotifications(await window.neuraco.listNotifications());
  };

  const openNotificationTarget = async (notification: NeuraCoNotification) => {
    if (notification.kind === 'permission_request') {
      setPermissionsOpen(true);
    }
    if (notification.target === 'protection') {
      await openRecovery();
      return;
    }
    const targetTab: Partial<Record<NeuraCoNotification['target'], WorkspaceTab>> = {
      chat: 'chat',
      team: 'team',
      review: 'review',
      git: 'git',
      environments: 'environments',
      usage: 'usage'
    };
    const nextTab = targetTab[notification.target];
    if (nextTab) setTab(nextTab);
  };

  const openNotifications = async () => {
    setNotificationsOpen(true);
    setNotificationsBusy(true);
    try {
      await refreshNotifications();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Impossible de charger les notifications.'
      );
    } finally {
      setNotificationsBusy(false);
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    if (!window.neuraco) return;
    setNotificationsBusy(true);
    try {
      setNotifications(await window.neuraco.markNotificationRead(notificationId));
    } finally {
      setNotificationsBusy(false);
    }
  };

  const archiveNotification = async (notificationId: string) => {
    if (!window.neuraco) return;
    setNotificationsBusy(true);
    try {
      setNotifications(await window.neuraco.archiveNotification(notificationId));
    } finally {
      setNotificationsBusy(false);
    }
  };

  const runNotificationAction = async (
    notificationId: string,
    action: NeuraCoNotificationAction
  ): Promise<NeuraCoNotificationActionEvent | undefined> => {
    if (!window.neuraco) return undefined;
    setNotificationsBusy(true);
    try {
      const result = await window.neuraco.runNotificationAction(
        notificationId,
        action
      );
      await openNotificationTarget(result.notification);
      setStatus(result.message || null);
      await refreshNotifications();
      return result;
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Action de notification impossible.'
      );
      return undefined;
    } finally {
      setNotificationsBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    window.neuraco?.listNotifications()
      .then((items) => {
        if (active) setNotifications(items);
      })
      .catch(() => undefined);
    const unsubscribe = window.neuraco?.onNotificationEvent((event) => {
      if (!active) return;
      if (event.type === 'created' || event.type === 'updated') {
        setNotifications((current) => {
          const withoutCurrent = current.filter(
            (item) => item.id !== event.notification.id
          );
          return [event.notification, ...withoutCurrent]
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        });
      } else {
        void openNotificationTarget(event.action.notification);
        if (event.action.message) setStatus(event.action.message);
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [snapshot.project.id]);

  const createCheckpoint = async () => {
    if (!window.neuraco || emergencyState.stopped) return;
    setRecoveryBusy(true);
    try {
      const taskSettings: NeuraCoCheckpointTaskSettings = {
        taskMode,
        effort,
        model: selectedModel,
        responseSpeed,
        communicationStyle,
        executionMode,
        includeActiveFile
      };
      const checkpoint = await window.neuraco.createCheckpoint({
        reason: 'Checkpoint manuel',
        trigger: 'manual',
        threadId: activeThreadId,
        taskSettings
      });
      if (activeThreadId) {
        await window.neuraco.attachConversationCheckpoint(
          activeThreadId,
          checkpoint.id
        );
        await refreshConversationThreads();
      }
      await refreshRecovery();
      setStatus('Checkpoint local créé.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Échec du checkpoint.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const restoreCheckpoint = async (
    checkpointId: string,
    target: NeuraCoCheckpointRestoreTarget
  ) => {
    if (!window.neuraco || emergencyState.stopped) return;
    setRecoveryBusy(true);
    try {
      const result = await window.neuraco.restoreCheckpoint(checkpointId, target);
      if (result.conversation) {
        applyConversationThread(result.conversation);
      }
      if (result.taskSettings) {
        setTaskMode(result.taskSettings.taskMode);
        setEffort(result.taskSettings.effort);
        setSelectedModel(result.taskSettings.model || 'auto');
        setResponseSpeed(result.taskSettings.responseSpeed || 'standard');
        setCommunicationStyle(result.taskSettings.communicationStyle);
        setExecutionMode(result.taskSettings.executionMode);
        setIncludeActiveFile(result.taskSettings.includeActiveFile);
      }
      if (result.restored.includes('conversation')) {
        await refreshConversationThreads();
      }
      if (result.restored.includes('files')) {
        await onRefresh();
      }
      if (result.restored.includes('files') && activeFile) {
        const refreshed = await window.neuraco.readProjectFile(activeFile.relativePath);
        setEditorSession((current) => (
          markEditorDocumentSaved(current, activeFile.relativePath, refreshed)
        ));
      }
      await refreshRecovery();
      setStatus(`Checkpoint restauré (${result.restored.join(', ')}).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Restauration impossible.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const updateCheckpointRetention = async (maxPerProject: number) => {
    if (!window.neuraco) return;
    setRecoveryBusy(true);
    try {
      const updated = await window.neuraco.updateCheckpointRetention(maxPerProject);
      setCheckpointRetention(updated);
      await refreshRecovery();
      setStatus(`Historique limité à ${updated.maxPerProject} checkpoints par projet.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Historique impossible à modifier.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const moveActiveFileToTrash = async () => {
    if (!window.neuraco || !activeFile || emergencyState.stopped) return;
    setStatus(null);
    try {
      await window.neuraco.moveProjectPathToTrash(activeFile.relativePath);
      setEditorSession((current) => closeEditorDocument(current, activeFile.relativePath));
      setEditorPreview(false);
      await onRefresh();
      if (recoveryOpen) await refreshRecovery();
      setStatus('Fichier déplacé dans la corbeille NeuraCo.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Suppression impossible.');
    }
  };

  const closeEditorTab = (relativePath: string) => {
    const document = editorSession.documents.find(
      (candidate) => candidate.file.relativePath === relativePath
    );
    if (
      document
      && isEditorDocumentDirty(document)
      && !window.confirm(`Fermer ${relativePath} sans enregistrer ses modifications ?`)
    ) {
      return;
    }
    setEditorSession((current) => closeEditorDocument(current, relativePath));
    setEditorPreview(false);
  };

  const runEditorAction = async (actionId: string, unavailableMessage: string) => {
    const action = editorRef.current?.getAction(actionId);
    if (!action || !action.isSupported()) {
      setStatus(unavailableMessage);
      return;
    }
    await action.run();
    editorRef.current?.focus();
  };

  const updateEditorMarkers = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!model || !monaco) {
      setEditorMarkers(0);
      return;
    }
    setEditorMarkers(monaco.editor.getModelMarkers({ resource: model.uri }).length);
  };

  const mountEditor: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    markerSubscriptionRef.current?.dispose();
    markerSubscriptionRef.current = monaco.editor.onDidChangeMarkers(() => {
      updateEditorMarkers();
    });
    updateEditorMarkers();
  };

  useEffect(() => () => {
    markerSubscriptionRef.current?.dispose();
  }, []);

  useEffect(() => {
    if (tab !== 'editor') return;
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [tab, activeFile?.relativePath, editorValue, dirty, saving, emergencyState.stopped]);

  const restoreTrashEntry = async (entryId: string) => {
    if (!window.neuraco || emergencyState.stopped) return;
    setRecoveryBusy(true);
    try {
      await window.neuraco.restoreTrashEntry(entryId);
      await Promise.all([onRefresh(), refreshRecovery()]);
      setStatus('Élément restauré depuis la corbeille.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Restauration impossible.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const stopAllAgents = async () => {
    if (!window.neuraco) return;
    const state = await window.neuraco.emergencyStop();
    emergencyStoppedRef.current = state.stopped;
    setEmergencyState(state);
    setChatBusy(false);
    setStatus('Tous les agents et commandes ont été suspendus.');
  };

  const resumeAgents = async () => {
    if (!window.neuraco) return;
    const state = await window.neuraco.emergencyResume();
    emergencyStoppedRef.current = state.stopped;
    setEmergencyState(state);
    setStatus('NeuraCo est de nouveau autorisé à agir.');
    window.setTimeout(scheduleDeferredInstruction, 0);
  };

  const saveEmergencyShortcut = async (accelerator: string) => {
    if (!window.neuraco) return;
    setRecoveryBusy(true);
    try {
      const saved = await window.neuraco.setEmergencyShortcut(accelerator);
      setEmergencyShortcut(saved);
      setStatus(`Raccourci d’arrêt d’urgence : ${saved}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Raccourci invalide.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const setCurrentExecution = (execution: ActiveChatExecution | null) => {
    activeExecutionRef.current = execution;
    setActiveExecution(execution);
  };

  const replaceInstructionQueue = (next: DeferredInstruction[]) => {
    instructionQueueRef.current = next;
    setInstructionQueue(next);
  };

  const buildDeferredInstruction = (content: string): DeferredInstruction => {
    const fileContexts: NeuraCoAgentFileContext[] = (
      includeActiveFile && activeFile
        ? [{
            path: activeFile.relativePath,
            content: editorValue,
            language: activeFile.language
          }]
        : []
    );
    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      content,
      userEntry: {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        files: fileContexts.map((file) => file.path)
      },
      fileContexts,
      conversationContext: messages
        .filter((message) => ['user', 'assistant'].includes(message.role))
        .slice(-20)
        .map(({ id, role, content: messageContent }) => ({
          id,
          role,
          content: messageContent
        })),
      images: []
    };
  };

  function scheduleDeferredInstruction() {
    if (
      emergencyStoppedRef.current
      || activeExecutionRef.current
      || deferredExecutionRunningRef.current
    ) return;
    const redirected = redirectInstructionRef.current;
    const queued = instructionQueueRef.current[0];
    const next = redirected || queued;
    if (!next) {
      setChatBusy(false);
      return;
    }
    if (redirected) {
      redirectInstructionRef.current = null;
    } else {
      replaceInstructionQueue(instructionQueueRef.current.slice(1));
    }
    window.setTimeout(() => {
      void executeDeferredInstruction(next, redirected ? 'redirect' : 'queue');
    }, 0);
  }

  function finishCurrentExecution(executionId: string) {
    if (activeExecutionRef.current?.id === executionId) {
      setCurrentExecution(null);
    }
    setChatBusy(false);
    window.setTimeout(scheduleDeferredInstruction, 0);
  }

  async function executeDeferredInstruction(
    pending: DeferredInstruction,
    source: 'queue' | 'redirect'
  ) {
    if (!window.neuraco || emergencyState.stopped) return;
    const requestId = crypto.randomUUID();
    deferredExecutionRunningRef.current = true;
    setCurrentExecution({
      id: requestId,
      kind: 'agent',
      objective: pending.content
    });
    setChatBusy(true);
    setMessages((current) => [
      ...current,
      pending.userEntry,
      {
        id: crypto.randomUUID(),
        role: 'system',
        content: source === 'redirect'
          ? 'Plan réévalué immédiatement avec la nouvelle instruction.'
          : 'Instruction sortie de la file et exécutée après l’étape précédente.'
      }
    ]);
    try {
      const response = await window.neuraco.sendAgentMessage({
        content: pending.content,
        sessionId,
        requestId,
        scope: 'project',
        projectId: snapshot.project.id,
        projectName: snapshot.project.name,
        mode: taskMode === 'plan' ? 'plan' : 'question',
        model: selectedModel,
        effort,
        communicationStyle,
        responseSpeed,
        conversationContext: pending.conversationContext,
        files: pending.fileContexts,
        images: []
      });
      setSessionId(response.sessionId);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.message,
          model: `${response.modelDisplay} · ${response.provider}`,
          files: response.filesUsed,
          proposedFiles: response.proposedFiles
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'system',
          content: error instanceof Error
            ? error.message
            : 'L’instruction différée n’a pas pu être exécutée.'
        }
      ]);
    } finally {
      deferredExecutionRunningRef.current = false;
      finishCurrentExecution(requestId);
    }
  }

  const runParallelSubtask = async (pending: DeferredInstruction) => {
    if (!window.neuraco || emergencyState.stopped) return;
    const taskId = crypto.randomUUID();
    setParallelSubtaskCount((current) => current + 1);
    setMessages((current) => [
      ...current,
      pending.userEntry,
      {
        id: crypto.randomUUID(),
        role: 'system',
        content:
          'Sous-tâche parallèle lancée : un agent distinct la traite pendant que '
          + 'la tâche principale continue.'
      }
    ]);
    try {
      const [preview, agents] = await Promise.all([
        window.neuraco.previewTaskRoute({
          projectId: snapshot.project.id,
          content: pending.content,
          requestedMode: 'automatic',
          effort,
          communicationStyle,
          preferredModel: selectedModel,
          responseSpeed,
          filePaths: pending.fileContexts.map((file) => file.path),
          imageCount: 0
        }),
        window.neuraco.listAgents()
      ]);
      const availableIds = new Set(agents.map((agent) => agent.id));
      const selectedAgentIds = preview.agents
        .map((agent) => agent.id)
        .filter((id) => availableIds.has(id))
        .slice(0, 1);
      if (selectedAgentIds.length === 0 && agents[0]) {
        selectedAgentIds.push(agents[0].id);
      }
      if (selectedAgentIds.length === 0) {
        throw new Error('Aucun agent distinct n’est disponible pour cette sous-tâche.');
      }
      const result = await window.neuraco.runMultiAgentTask({
        taskId,
        objective: pending.content,
        projectId: snapshot.project.id,
        projectName: snapshot.project.name,
        selectedAgentIds,
        maxAgents: 1,
        budget: Math.max(1, preview.suggestedBudget),
        effort: preview.effort,
        communicationStyle: preview.communicationStyle,
        preferredModel: preview.primaryModel,
        responseSpeed: preview.responseSpeed,
        files: pending.fileContexts
      });
      const task = result.tasks[0];
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            `### Sous-tâche terminée par ${task?.agentName || 'un agent spécialisé'}\n\n`
            + `${task?.message || task?.intermediateResult || result.summary}\n\n`
            + `### Revue\n${result.review}`,
          model: `${result.model} · ${result.provider}`,
          files: pending.fileContexts.map((file) => file.path)
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'system',
          content: error instanceof Error
            ? `Sous-tâche parallèle interrompue : ${error.message}`
            : 'La sous-tâche parallèle n’a pas pu être exécutée.'
        }
      ]);
    } finally {
      setParallelSubtaskCount((current) => Math.max(0, current - 1));
    }
  };

  const resolveInstructionDecision = async (
    action: 'queue' | 'redirect' | 'subtask'
  ) => {
    if (!window.neuraco || !instructionDecision) return;
    const pending = instructionDecision;
    setInstructionDecision(null);
    setChatInput('');
    if (action === 'queue') {
      replaceInstructionQueue([...instructionQueueRef.current, pending]);
      setStatus('Instruction ajoutée à la file. Elle démarrera après l’étape en cours.');
      if (!activeExecutionRef.current) scheduleDeferredInstruction();
      return;
    }
    if (action === 'subtask') {
      setStatus('Sous-tâche lancée en parallèle sans interrompre le travail principal.');
      void runParallelSubtask(pending);
      return;
    }

    redirectInstructionRef.current = pending;
    const current = activeExecutionRef.current;
    setStatus('Redirection demandée : arrêt ciblé puis réévaluation immédiate du plan.');
    if (!current) {
      scheduleDeferredInstruction();
      return;
    }
    try {
      if (current.kind === 'agent') {
        await window.neuraco.cancelAgentMessage(current.id);
      } else if (current.kind === 'multi_agent') {
        await window.neuraco.cancelMultiAgentTask(current.id);
      } else {
        const cancelled = await window.neuraco.cancelCloudTask(current.id);
        setActiveCloudTask(cancelled);
      }
    } catch (error) {
      redirectInstructionRef.current = null;
      setStatus(
        error instanceof Error ? error.message : 'La redirection ciblée a échoué.'
      );
    }
  };

  const executeDirectTask = async (
    pending: PendingRoutedTask,
    mode: 'question' | 'plan',
    preview: NeuraCoTaskRoutingPreview
  ) => {
    if (!window.neuraco) return;
    if (!connectivity.online) {
      setStatus(
        'Connexion Internet nécessaire pour utiliser l’IA. '
        + 'Les outils locaux du projet restent disponibles.'
      );
      return;
    }
    const executionId = crypto.randomUUID();
    setMessages((current) => [...current, pending.userEntry]);
    setChatInput('');
    setChatBusy(true);
    setStatus(null);
    setCurrentExecution({
      id: executionId,
      kind: executionMode === 'local' ? 'agent' : 'cloud',
      objective: pending.content
    });
    try {
      if (executionMode !== 'local') {
        const task = await window.neuraco.createCloudTask({
          content: pending.content,
          sessionId,
          requestId: executionId,
          projectId: snapshot.project.id,
          projectName: snapshot.project.name,
          mode,
          model: preview.primaryModel,
          effort: preview.effort,
          communicationStyle: preview.communicationStyle,
          responseSpeed: preview.responseSpeed,
          conversationContext: pending.conversationContext,
          files: pending.fileContexts
        });
        setSessionId(task.sessionId);
        setActiveCloudTask(task);
        setCurrentExecution({
          id: task.id,
          kind: 'cloud',
          objective: pending.content
        });
        setMessages((current) => [
          ...current,
          {
            id: `cloud-status-${task.id}`,
            role: 'system',
            content: executionMode === 'hybrid'
              ? 'Tâche hybride démarrée : le raisonnement continue dans le Cloud, '
                + 'mais toute action sur ce PC exige que le relais reste actif.'
              : 'Tâche envoyée dans le Cloud. Elle continue sur le serveur même si '
                + 'NeuraCo ou ce PC est fermé.'
          }
        ]);
      } else {
        const response = await window.neuraco.sendAgentMessage({
          content: pending.content,
          sessionId,
          requestId: executionId,
          scope: 'project',
          projectId: snapshot.project.id,
          projectName: snapshot.project.name,
          mode,
          model: preview.primaryModel,
          effort: preview.effort,
          communicationStyle: preview.communicationStyle,
          responseSpeed: preview.responseSpeed,
          conversationContext: pending.conversationContext,
          files: pending.fileContexts,
          images: pending.images.map((image): NeuraCoAgentImageContext => ({
            id: image.id,
            name: image.name,
            mimeType: image.mimeType,
            dataBase64: image.dataBase64,
            width: image.width,
            height: image.height,
            size: image.size
          }))
        });
        setSessionId(response.sessionId);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: response.message,
            model: `${response.modelDisplay} · ${response.provider}`,
            files: response.filesUsed,
            proposedFiles: response.proposedFiles
          }
        ]);
        setPendingImages([]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'system',
          content: error instanceof Error
            ? error.message
            : 'Le service IA NeuraCo est indisponible.'
        }
      ]);
    } finally {
      if (executionMode === 'local') {
        finishCurrentExecution(executionId);
      } else if (!activeCloudTask && activeExecutionRef.current?.id === executionId) {
        finishCurrentExecution(executionId);
      }
    }
  };

  const reviewProposedFiles = (message: ChatEntry) => {
    const first = message.proposedFiles?.[0];
    if (!first) return;
    setProposalReviewMessageId(message.id);
    setProposalReviewPath(first.path);
  };

  const applyProposedFiles = async () => {
    if (!window.neuraco || !proposalReviewMessageId || proposalApplying) return;
    const message = messages.find((entry) => entry.id === proposalReviewMessageId);
    const pending = (message?.proposedFiles || []).filter(
      (file) => file.status !== 'applied'
    );
    if (pending.length === 0) return;
    setProposalApplying(true);
    try {
      let applied = 0;
      const results = new Map<string, Pick<NeuraCoProposedFile, 'status' | 'error'>>();
      for (const file of pending) {
        try {
          await window.neuraco.saveProjectFile(file.path, file.content);
          results.set(file.path, { status: 'applied' });
          applied += 1;
        } catch (error) {
          results.set(file.path, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Écriture refusée ou interrompue.'
          });
        }
      }
      setMessages((current) => current.map((entry) => (
        entry.id === proposalReviewMessageId
          ? {
              ...entry,
              proposedFiles: entry.proposedFiles?.map((file) => {
                const result = results.get(file.path);
                return result ? { ...file, ...result } : file;
              })
            }
          : entry
      )));
      try {
        await onRefresh();
      } catch {
        // The files are already saved; a refresh failure must not lock the review UI.
      }
      const failed = pending.length - applied;
      setStatus(
        failed === 0
          ? `${applied} fichier(s) appliqué(s) dans le projet avec checkpoint.`
          : `${applied} fichier(s) appliqué(s), ${failed} refusé(s) ou en erreur.`
      );
      if (failed === 0) {
        setProposalReviewMessageId(undefined);
        setProposalReviewPath(undefined);
      }
    } finally {
      setProposalApplying(false);
    }
  };

  const validateCurrentProject = async () => {
    if (!window.neuraco || packageBusy) return;
    setPackageBusy(true);
    setStatus(null);
    try {
      const validation = await window.neuraco.validateProject();
      if (validation.valid) {
        setStatus(
          validation.kind === 'fivem'
            ? `Projet FiveM valide : ${validation.resources.length} ressource(s), ${validation.fileCount} fichier(s).`
            : `Projet valide : ${validation.fileCount} fichier(s) exportable(s).`
        );
      } else {
        const firstError = validation.errors[0]
          ? ` ${validation.errors[0]}`
          : '';
        setStatus(
          `Validation terminée : ${validation.errors.length} erreur(s), ${validation.warnings.length} avertissement(s).${firstError}`
        );
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'La validation du projet a échoué.'
      );
    } finally {
      setPackageBusy(false);
    }
  };

  const exportCurrentProjectZip = async () => {
    if (!window.neuraco || packageBusy) return;
    setPackageBusy(true);
    setStatus(null);
    try {
      const result = await window.neuraco.exportProjectZip();
      if (result.canceled) {
        setStatus('Export ZIP annulé.');
        return;
      }
      const shortHash = result.sha256?.slice(0, 12);
      setStatus(
        `ZIP créé : ${result.filePath} · ${result.fileCount} fichier(s)${shortHash ? ` · SHA-256 ${shortHash}…` : ''}`
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'La création du ZIP a échoué.'
      );
    } finally {
      setPackageBusy(false);
    }
  };

  const loadRoutingPreview = async (
    pending: PendingRoutedTask,
    requestedMode: RequestedTaskMode
  ) => {
    if (!window.neuraco || routingBusy) return;
    setRoutingBusy(true);
    setStatus(null);
    try {
      const [preview, agents] = await Promise.all([
        window.neuraco.previewTaskRoute({
          projectId: snapshot.project.id,
          content: pending.content,
          requestedMode,
          effort,
          communicationStyle,
          preferredModel: selectedModel,
          responseSpeed,
          filePaths: pending.fileContexts.map((file) => file.path),
          imageCount: pending.images.length
        }),
        window.neuraco.listAgents()
      ]);
      setPendingRoutedTask(pending);
      setRoutingPreview(preview);
      setRoutingAgents(agents);
      setSelectedRoutingAgentIds(preview.agents.map((agent) => agent.id));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Routage indisponible.');
    } finally {
      setRoutingBusy(false);
    }
  };

  const promoteSecondaryResponse = async (content: string) => {
    const officialInstruction = buildDeferredInstruction(
      `Instruction officielle issue de la conversation secondaire :\n\n${content}`
    );
    setSecondaryConversationOpen(false);
    if (chatBusy) {
      setInstructionDecision(officialInstruction);
      setStatus(
        'La réponse secondaire est prête. Choisissez comment l’intégrer à la tâche active.'
      );
      return;
    }
    setStatus('Réponse secondaire transformée en instruction à valider.');
    await loadRoutingPreview(officialInstruction, taskMode);
  };

  const sendChat = async () => {
    const content = chatInput.trim() || (
      readyImages.length > 0 ? 'Analyse les images jointes.' : ''
    );
    if (
      !window.neuraco
      || !content
      || routingBusy
      || routingPreview
      || imagesProcessing
      || emergencyState.stopped
    ) return;
    if (!connectivity.online) {
      setStatus(
        'Connexion Internet nécessaire pour utiliser l’IA. '
        + 'Continuez hors ligne avec l’éditeur, le terminal, Git, '
        + 'l’historique, les différences, les checkpoints ou la recherche locale.'
      );
      return;
    }
    if (chatBusy) {
      if (readyImages.length > 0) {
        setStatus(
          'Les nouvelles instructions pendant une exécution sont textuelles. '
          + 'Les images restent jointes à la tâche en cours.'
        );
        return;
      }
      setInstructionDecision(buildDeferredInstruction(content));
      return;
    }
    if (executionMode !== 'local' && readyImages.length > 0) {
      setStatus(
        'Les images restent locales. Retirez-les ou passez en mode Local pour les analyser.'
      );
      return;
    }
    if (executionMode === 'hybrid' && !relayState.connected) {
      setStatus(
        'Le mode Hybride exige que ce PC soit en ligne et que le relais sécurisé soit actif.'
      );
      return;
    }
    const fileContexts: NeuraCoAgentFileContext[] = (
      includeActiveFile && activeFile
        ? [{
            path: activeFile.relativePath,
            content: editorValue,
            language: activeFile.language
          }]
        : []
    );
    const conversationContext: NeuraCoPersistedChatMessage[] = messages
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .slice(-20)
      .map(({ id, role, content }) => ({ id, role, content }));
    const userEntry: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      files: fileContexts.map((file) => file.path),
      images: readyImages.map((image) => ({
        id: image.id,
        name: image.name,
        preview: image.preview,
        width: image.width,
        height: image.height,
        size: image.size
      }))
    };
    await loadRoutingPreview({
      content,
      userEntry,
      fileContexts,
      conversationContext,
      images: [...readyImages]
    }, taskMode);
  };

  const delegateForgeIssue = async (issue: NeuraCoForgeIssue) => {
    const comments = issue.comments.slice(-12).map((comment) => (
      `- ${comment.author || 'Utilisateur'} : ${comment.body}`
    )).join('\n');
    const content = (
      `Prépare la délégation contrôlée de l’issue ${issue.provider} `
      + `#${issue.number} du dépôt ${issue.repository}.\n\n`
      + `Titre : ${issue.title}\n`
      + `Description :\n${issue.body || 'Aucune description.'}\n\n`
      + `${comments ? `Commentaires récents :\n${comments}\n\n` : ''}`
      + 'Commence uniquement par analyser le besoin et produire un plan vérifiable. '
      + 'Indique les fichiers probablement concernés, les risques, les tests à exécuter '
      + 'et les critères de réussite. N’invente pas les fichiers : vérifie le projet. '
      + 'Ne modifie encore aucun fichier. Après validation, le travail devra être isolé '
      + 'dans un worktree NeuraCo, commité, testé, revu puis soumis en PR/MR sans fusion automatique.'
    ).slice(0, 11_800);
    const userEntry: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'user',
      content
    };
    setTab('chat');
    setTaskMode('plan');
    setStatus(`Issue #${issue.number} prête pour prévalidation.`);
    await loadRoutingPreview({
      content,
      userEntry,
      fileContexts: [],
      conversationContext: [],
      images: []
    }, 'plan');
  };

  const inspectRecoverableTask = async (
    taskId: string
  ): Promise<NeuraCoRecoverableTaskInspection> => {
    if (!window.neuraco) throw new Error('NeuraCo Desktop est indisponible.');
    return window.neuraco.inspectRecoverableTask(taskId);
  };

  const resumeRecoverableTask = async (
    taskId: string,
    strategy: NeuraCoTaskResumeStrategy
  ) => {
    if (!window.neuraco || emergencyState.stopped) return;
    setRecoveryBusy(true);
    try {
      const resumed = await window.neuraco.resumeRecoverableTask(taskId, strategy);
      const content = resumed.resumePrompt;
      setRecoveryOpen(false);
      setTab('chat');
      setTaskMode('automatic');
      setStatus(`Reprise de « ${resumed.task.objective.slice(0, 80)} » prête à valider.`);
      await loadRoutingPreview({
        content,
        userEntry: {
          id: crypto.randomUUID(),
          role: 'user',
          content
        },
        fileContexts: [],
        conversationContext: [],
        images: []
      }, 'automatic');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Reprise impossible.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const discardRecoverableTask = async (taskId: string) => {
    if (!window.neuraco) return;
    setRecoveryBusy(true);
    try {
      const next = await window.neuraco.discardRecoverableTask(taskId);
      setRecoverableTasks(next);
      setStatus('Proposition de reprise archivée.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Abandon de reprise impossible.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const changeRoutingMode = async (mode: RequestedTaskMode) => {
    setTaskMode(mode);
    if (pendingRoutedTask) {
      setRoutingPreview(undefined);
      await loadRoutingPreview(pendingRoutedTask, mode);
    }
  };

  const changeEffort = async (nextEffort: NeuraCoEffortLevel) => {
    setEffort(nextEffort);
    if (pendingRoutedTask) {
      setRoutingBusy(true);
      setStatus(null);
      try {
        const preview = await window.neuraco?.previewTaskRoute({
          projectId: snapshot.project.id,
          content: pendingRoutedTask.content,
          requestedMode: taskMode,
          effort: nextEffort,
          communicationStyle,
          preferredModel: selectedModel,
          responseSpeed,
          filePaths: pendingRoutedTask.fileContexts.map((file) => file.path),
          imageCount: pendingRoutedTask.images.length
        });
        if (preview) {
          setRoutingPreview(preview);
          setSelectedRoutingAgentIds(preview.agents.map((agent) => agent.id));
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Réglage d’effort indisponible.');
      } finally {
        setRoutingBusy(false);
      }
    }
  };

  const changeCommunicationStyle = async (
    nextStyle: NeuraCoCommunicationStyle
  ) => {
    setCommunicationStyle(nextStyle);
    if (pendingRoutedTask) {
      setRoutingBusy(true);
      setStatus(null);
      try {
        const preview = await window.neuraco?.previewTaskRoute({
          projectId: snapshot.project.id,
          content: pendingRoutedTask.content,
          requestedMode: taskMode,
          effort,
          communicationStyle: nextStyle,
          preferredModel: selectedModel,
          responseSpeed,
          filePaths: pendingRoutedTask.fileContexts.map((file) => file.path),
          imageCount: pendingRoutedTask.images.length
        });
        if (preview) setRoutingPreview(preview);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Style de communication indisponible.');
      } finally {
        setRoutingBusy(false);
      }
    }
  };

  const toggleRoutingAgent = async (agentId: string) => {
    const next = selectedRoutingAgentIds.includes(agentId)
      ? selectedRoutingAgentIds.filter((id) => id !== agentId)
      : [...selectedRoutingAgentIds, agentId].slice(0, 8);
    setSelectedRoutingAgentIds(next);
    if (!window.neuraco || !routingPreview || !pendingRoutedTask) return;
    try {
      const estimate = await window.neuraco.estimateUsage({
        mode: routingPreview.effort === 'rapid'
          ? 'economic'
          : ['deep', 'maximum'].includes(routingPreview.effort)
            ? 'quality'
            : routingPreview.complexity === 'complex'
              ? 'quality'
              : 'balanced',
        model: routingPreview.primaryModel,
        promptCharacters: pendingRoutedTask.content.length,
        maxOutputTokens: routingPreview.maxOutputTokens,
        agents: Math.max(1, next.length),
        imageCount: pendingRoutedTask.images.length
      });
      if (
        !estimate
        || !Number.isFinite(estimate.minimum_credits)
        || !Number.isFinite(estimate.maximum_credits)
      ) return;
      setRoutingPreview((current) => current ? {
        ...current,
        estimatedMinimumCredits: estimate.minimum_credits,
        estimatedMaximumCredits: estimate.maximum_credits,
        estimateSource: 'server'
      } : current);
    } catch {
      // The original server-backed or local estimate remains visible.
    }
  };

  const cancelRouting = () => {
    setRoutingPreview(undefined);
    setPendingRoutedTask(undefined);
    setRoutingAgents([]);
    setSelectedRoutingAgentIds([]);
  };

  const observeControlledPreferences = async (content: string) => {
    if (!window.neuraco) return;
    try {
      const next = await window.neuraco.observeControlledMemory({
        content,
        sourceThreadId: activeThreadId
      });
      setControlledMemory(next);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'La suggestion de mémoire n’a pas pu être analysée.'
      );
    }
  };

  const confirmRouting = async () => {
    if (
      !window.neuraco
      || !routingPreview
      || !pendingRoutedTask
      || chatBusy
      || routingBusy
    ) return;
    if (!connectivity.online) {
      setStatus(
        'Connexion Internet nécessaire pour démarrer cette tâche IA distante.'
      );
      return;
    }
    const preview = routingPreview;
    const pending = pendingRoutedTask;
    void observeControlledPreferences(pending.content);
    if (preview.execution === 'chat') {
      cancelRouting();
      await executeDirectTask(
        pending,
        preview.mode === 'plan' ? 'plan' : 'question',
        preview
      );
      return;
    }
    if (executionMode !== 'local') {
      setStatus('Les équipes spécialisées s’exécutent en mode Local uniquement.');
      return;
    }
    if (selectedRoutingAgentIds.length === 0) {
      setStatus('Sélectionnez au moins un agent avant de démarrer.');
      return;
    }
    cancelRouting();
    setMessages((current) => [
      ...current,
      pending.userEntry,
      {
        id: crypto.randomUUID(),
        role: 'system',
        content:
          `Routage validé : ${preview.modeLabel} · `
          + `${selectedRoutingAgentIds.length} agent(s) · `
          + `${preview.estimatedMinimumCredits} à `
          + `${preview.estimatedMaximumCredits} crédits estimés.`
      }
    ]);
    setChatInput('');
    setChatBusy(true);
    setStatus(null);
    const taskId = crypto.randomUUID();
    setCurrentExecution({
      id: taskId,
      kind: 'multi_agent',
      objective: pending.content
    });
    try {
      const result = await window.neuraco.runMultiAgentTask({
        taskId,
        objective: pending.content,
        projectId: snapshot.project.id,
        projectName: snapshot.project.name,
        selectedAgentIds: selectedRoutingAgentIds,
        maxAgents: Math.min(8, selectedRoutingAgentIds.length),
        budget: preview.suggestedBudget,
        effort: preview.effort,
        communicationStyle: preview.communicationStyle,
        preferredModel: preview.primaryModel,
        responseSpeed: preview.responseSpeed,
        files: pending.fileContexts
      });
      const specialistResults = result.tasks.map((task) => (
        `### ${task.agentName}\n`
        + `${task.message || task.intermediateResult || 'Aucun résultat fourni.'}`
      )).join('\n\n');
      const risks = result.risks.length > 0
        ? `\n\n### Risques\n${result.risks.map((risk) => `- ${risk}`).join('\n')}`
        : '';
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            `## ${result.summary}\n\n${specialistResults}`
            + `\n\n### Revue indépendante\n${result.review}`
            + risks
            + `\n\n_${result.creditsConsumed} crédit(s) consommé(s) · `
            + `${Math.round(result.durationMs / 100) / 10} s_`,
          model: `${result.model} · ${result.provider}`,
          files: pending.fileContexts.map((file) => file.path)
        }
      ]);
      setPendingImages([]);
      setStatus(
        `Tâche ${preview.modeLabel} terminée par ${result.tasks.length} agent(s).`
      );
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'system',
          content: error instanceof Error
            ? error.message
            : 'L’équipe spécialisée NeuraCo est indisponible.'
        }
      ]);
    } finally {
      finishCurrentExecution(taskId);
    }
  };

  const resetChatSession = async () => {
    if (!window.neuraco || chatBusy) return;
    setSessionLoaded(false);
    try {
      const thread = await window.neuraco.createConversationThread({
        title: 'Nouvelle tâche'
      });
      applyConversationThread(thread);
      await refreshConversationThreads();
      setStatus('Nouveau fil de tâche créé.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Création du fil impossible.');
    } finally {
      setSessionLoaded(true);
    }
  };

  const selectConversationThread = async (threadId: string) => {
    if (!window.neuraco || chatBusy || threadId === activeThreadId) return;
    setSessionLoaded(false);
    try {
      const summary = conversationThreads.find((thread) => thread.threadId === threadId);
      if (summary?.archived) {
        await window.neuraco.archiveConversationThread(threadId, false);
      }
      const thread = await window.neuraco.selectConversationThread(threadId);
      applyConversationThread(thread);
      await refreshConversationThreads();
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Ouverture du fil impossible.');
    } finally {
      setSessionLoaded(true);
    }
  };

  const renameConversationThread = async () => {
    if (!window.neuraco || !activeThreadId || chatBusy) return;
    const current = conversationThreads.find(
      (thread) => thread.threadId === activeThreadId
    );
    const title = window.prompt('Nouveau nom du fil', current?.title || '');
    if (title === null) return;
    try {
      await window.neuraco.renameConversationThread(activeThreadId, title);
      await refreshConversationThreads();
      setStatus('Fil renommé.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Renommage impossible.');
    }
  };

  const archiveConversationThread = async () => {
    if (!window.neuraco || !activeThreadId || chatBusy) return;
    setSessionLoaded(false);
    try {
      await window.neuraco.archiveConversationThread(activeThreadId, true);
      const replacement = await window.neuraco.getLocalSession();
      if (replacement) {
        applyConversationThread(replacement as NeuraCoConversationThread);
      }
      await refreshConversationThreads();
      setStatus('Fil archivé. Vous pouvez le rouvrir depuis la liste.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Archivage impossible.');
    } finally {
      setSessionLoaded(true);
    }
  };

  const exportConversationThread = async () => {
    if (!window.neuraco || !activeThreadId) return;
    try {
      const result = await window.neuraco.exportConversationThread(activeThreadId);
      if (!result.canceled) setStatus(`Fil exporté : ${result.filePath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export impossible.');
    }
  };

  const clearConversationThreadMemory = async () => {
    if (!window.neuraco || !activeThreadId || chatBusy) return;
    setSessionLoaded(false);
    try {
      const thread = await window.neuraco.clearConversationThreadMemory(activeThreadId);
      applyConversationThread(thread);
      await refreshConversationThreads();
      setStatus('Mémoire de ce fil effacée. Les fichiers du projet sont intacts.');
    } catch (error) {
      if (
        error instanceof Error
        && !error.message.toLowerCase().includes('annulé')
      ) {
        setStatus(error.message);
      }
    } finally {
      setSessionLoaded(true);
    }
  };

  const forkConversationThread = async (fromMessageId?: string) => {
    if (!window.neuraco || !activeThreadId || chatBusy) return;
    setSessionLoaded(false);
    try {
      const thread = await window.neuraco.forkConversationThread(
        activeThreadId,
        fromMessageId
      );
      applyConversationThread(thread);
      await refreshConversationThreads();
      setStatus('Branche de conversation créée sans modifier la solution originale.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Branchement impossible.');
    } finally {
      setSessionLoaded(true);
    }
  };

  const rewindConversationThread = async (messageId: string) => {
    if (!window.neuraco || !activeThreadId || chatBusy) return;
    setSessionLoaded(false);
    try {
      const thread = await window.neuraco.rewindConversationThread(
        activeThreadId,
        messageId
      );
      applyConversationThread(thread);
      await refreshConversationThreads();
      setStatus('Conversation restaurée à ce point. Les fichiers n’ont pas été modifiés.');
    } catch (error) {
      if (
        error instanceof Error
        && !error.message.toLowerCase().includes('annulé')
      ) {
        setStatus(error.message);
      }
    } finally {
      setSessionLoaded(true);
    }
  };

  const cancelActiveCloudTask = async () => {
    if (!window.neuraco || !activeCloudTask) return;
    try {
      const task = await window.neuraco.cancelCloudTask(activeCloudTask.id);
      setActiveCloudTask(task);
      setChatBusy(false);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Annulation Cloud impossible.'
      );
    }
  };

  const toggleRelay = async () => {
    if (!window.neuraco) return;
    try {
      const next = relayState.enabled
        ? await window.neuraco.disableRelay()
        : await window.neuraco.enableRelay();
      setRelayState(next);
      if (!next.connected && next.enabled) {
        setStatus(next.error || 'Le relais sécurisé n’a pas pu joindre le serveur.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Relais sécurisé indisponible.');
    }
  };

  const resolveRelayInstruction = async (
    commandId: string,
    accepted: boolean
  ) => {
    if (!window.neuraco) return;
    try {
      setRelayState(
        await window.neuraco.resolveRelayCommand(commandId, accepted)
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Réponse distante impossible.'
      );
    }
  };

  return (
    <div className="project-workspace">
      <aside className="project-explorer">
        <header>
          <div>
            <strong>Explorateur</strong>
            <span>{snapshot.indexedFiles} fichiers</span>
          </div>
          <div>
            <button
              type="button"
              title="Valider le projet"
              disabled={packageBusy}
              onClick={() => void validateCurrentProject()}
            >
              {packageBusy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
            </button>
            <button
              type="button"
              title="Exporter le projet en ZIP"
              disabled={packageBusy}
              onClick={() => void exportCurrentProjectZip()}
            >
              <Download size={15} />
            </button>
            <button type="button" title="Nouveau fichier" onClick={() => setCreatingFile(true)}>
              <FilePlus2 size={15} />
            </button>
            <button type="button" title="Actualiser" onClick={() => void onRefresh()}>
              <RefreshCw size={15} />
            </button>
          </div>
        </header>
        {creatingFile && (
          <form
            className="new-file-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createFile();
            }}
          >
            <input
              autoFocus
              value={newFilePath}
              onChange={(event) => setNewFilePath(event.target.value)}
              placeholder="src/nouveau-fichier.ts"
            />
            <button type="submit" title="Créer"><Check size={14} /></button>
            <button
              type="button"
              title="Annuler"
              onClick={() => {
                setCreatingFile(false);
                setNewFilePath('');
              }}
            >
              <X size={14} />
            </button>
          </form>
        )}
        <div className="project-tree-scroll">
          <FileTree
            nodes={snapshot.files}
            activePath={activeFile?.relativePath}
            onOpen={(node) => void openFile(node)}
          />
        </div>
        <footer>
          <span>{snapshot.excludedEntries} éléments protégés/exclus</span>
          {snapshot.truncated && <strong>Index partiel</strong>}
        </footer>
      </aside>

      <section className="project-main">
        <header className="project-tabs">
          <button
            type="button"
            className={tab === 'chat' ? 'is-active' : ''}
            onClick={() => setTab('chat')}
          >
            <Bot size={16} /> Agent
          </button>
          <button
            type="button"
            className={tab === 'editor' ? 'is-active' : ''}
            onClick={() => setTab('editor')}
          >
            <Code2 size={16} /> Éditeur
            {dirty && <span className="dirty-dot" />}
          </button>
          <button
            type="button"
            className={tab === 'team' ? 'is-active' : ''}
            onClick={() => setTab('team')}
          >
            <UsersRound size={16} /> Équipe
          </button>
          <button
            type="button"
            className={tab === 'goals' ? 'is-active' : ''}
            onClick={() => setTab('goals')}
          >
            <Target size={16} /> Objectifs
          </button>
          <button
            type="button"
            className={tab === 'environments' ? 'is-active' : ''}
            onClick={() => setTab('environments')}
          >
            <Network size={16} /> Environnements
          </button>
          <button
            type="button"
            className={tab === 'sites' ? 'is-active' : ''}
            onClick={() => setTab('sites')}
          >
            <LayoutDashboard size={16} /> Sites
          </button>
          <button
            type="button"
            className={tab === 'images' ? 'is-active' : ''}
            onClick={() => setTab('images')}
          >
            <ImagePlus size={16} /> Images
          </button>
          <button
            type="button"
            className={tab === 'review' ? 'is-active' : ''}
            onClick={() => setTab('review')}
          >
            <ClipboardCheck size={16} /> À examiner
          </button>
          <button
            type="button"
            className={tab === 'terminal' ? 'is-active' : ''}
            onClick={() => setTab('terminal')}
          >
            <SquareTerminal size={16} /> Terminal
          </button>
          <button
            type="button"
            className={tab === 'processes' ? 'is-active' : ''}
            onClick={() => setTab('processes')}
          >
            <Activity size={16} /> Processus
          </button>
          <button
            type="button"
            className={tab === 'artifacts' ? 'is-active' : ''}
            onClick={() => setTab('artifacts')}
          >
            <Archive size={16} /> Artefacts
          </button>
          <button
            type="button"
            className={tab === 'memory' ? 'is-active' : ''}
            onClick={() => setTab('memory')}
          >
            <BrainCircuit size={16} /> Mémoire
            {Boolean(controlledMemory?.pendingCount) && (
              <span className="tab-count">{controlledMemory?.pendingCount}</span>
            )}
          </button>
          <button
            type="button"
            className={tab === 'extensions' ? 'is-active' : ''}
            onClick={() => setTab('extensions')}
          >
            <Blocks size={16} /> Extensions
          </button>
          <button
            type="button"
            className={tab === 'hooks' ? 'is-active' : ''}
            onClick={() => setTab('hooks')}
          >
            <Webhook size={16} /> Hooks
          </button>
          <button
            type="button"
            className={tab === 'routines' ? 'is-active' : ''}
            onClick={() => setTab('routines')}
          >
            <CalendarClock size={16} /> Routines
          </button>
          <button
            type="button"
            className={tab === 'git' ? 'is-active' : ''}
            onClick={() => setTab('git')}
          >
            <GitBranch size={16} /> Git
          </button>
          <button
            type="button"
            className={tab === 'browser' ? 'is-active' : ''}
            onClick={() => setTab('browser')}
          >
            <Globe2 size={16} /> Navigateur
          </button>
          <button
            type="button"
            className={tab === 'computer' ? 'is-active' : ''}
            onClick={() => setTab('computer')}
          >
            <MousePointer2 size={16} /> PC expérimental
          </button>
          <button
            type="button"
            className={tab === 'studio' ? 'is-active' : ''}
            onClick={() => setTab('studio')}
          >
            <DatabaseBackup size={16} /> Studio
          </button>
          <button
            type="button"
            className={tab === 'statistics' ? 'is-active' : ''}
            onClick={() => setTab('statistics')}
          >
            <BarChart3 size={16} /> Statistiques
          </button>
          <button
            type="button"
            className={tab === 'usage' ? 'is-active' : ''}
            onClick={() => setTab('usage')}
          >
            <Gauge size={16} /> Utilisation
          </button>
          <button
            type="button"
            className={`permission-status is-${permissions?.mode || 'loading'}`}
            onClick={() => setPermissionsOpen(true)}
            title="Configurer les autorisations du projet"
          >
            <ShieldCheck size={15} />
            {permissions
              ? PERMISSION_MODE_LABELS[permissions.mode]
              : 'Chargement'}
          </button>
          {permissions?.mode === 'full' && (
            <button
              type="button"
              className="permission-emergency-disable"
              onClick={() => void disableFullAccess()}
              title="Désactiver immédiatement l’accès complet"
            >
              <Power size={15} />
              Couper
            </button>
          )}
          <button
            type="button"
            className="recovery-open"
            onClick={() => void openRecovery()}
            title="Checkpoints et corbeille"
          >
            <DatabaseBackup size={15} />
            Protection
          </button>
          <button
            type="button"
            className="notifications-open"
            onClick={() => void openNotifications()}
            title="Ouvrir les notifications"
          >
            <Bell size={15} />
            Notifications
            {unreadNotifications > 0 && (
              <span className="tab-count">{Math.min(unreadNotifications, 99)}</span>
            )}
          </button>
          {emergencyState.stopped ? (
            <button
              type="button"
              className="emergency-resume"
              onClick={() => void resumeAgents()}
              title="Reprendre les agents après examen"
            >
              <Play size={15} />
              Reprendre
            </button>
          ) : (
            <button
              type="button"
              className="emergency-stop"
              onClick={() => void stopAllAgents()}
              title="ARRÊTER TOUS LES AGENTS (Ctrl+Shift+Échap)"
            >
              <OctagonX size={15} />
              Arrêter tous les agents
            </button>
          )}
          <div className="project-path" title={snapshot.project.rootPath}>
            <ShieldCheck size={14} />
            <span>{snapshot.project.rootPath}</span>
          </div>
          <button type="button" className="change-project" onClick={() => void onOpenProject()}>
            Changer
          </button>
        </header>

        {(!connectivity.online || status) && (
          <div className="workspace-notice-stack">
            {!connectivity.online && (
              <div className="workspace-notice is-offline" role="status">
                <Cloud size={15} aria-hidden="true" />
                <span>
                  <strong>Mode hors ligne.</strong> Les outils locaux restent disponibles.
                  Une connexion Internet est nécessaire uniquement pour l’IA et les services distants.
                </span>
              </div>
            )}
            {status && (
              <div
                className={`workspace-notice ${emergencyState.stopped ? 'is-emergency' : ''}`}
                role="status"
                aria-live="polite"
              >
                {status}
              </div>
            )}
          </div>
        )}

        {tab === 'chat' && (
          <div className="agent-view">
            <div className="agent-messages">
              <div className="conversation-thread-bar">
                <select
                  aria-label="Fil de tâche"
                  value={activeThreadId || ''}
                  onChange={(event) => void selectConversationThread(event.target.value)}
                  disabled={chatBusy}
                >
                  {conversationThreads.map((thread) => (
                    <option key={thread.threadId} value={thread.threadId}>
                      {thread.archived ? '[Archivé] ' : ''}{thread.title}
                    </option>
                  ))}
                </select>
                <span>
                  {activeConversationThread?.messageCount || 0} message(s)
                  {activeConversationThread?.checkpointId ? ' · checkpoint lié' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void resetChatSession()}
                  disabled={chatBusy}
                  title="Créer un nouveau fil de tâche"
                  aria-label="Nouveau fil de tâche"
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => void renameConversationThread()}
                  disabled={chatBusy || !activeThreadId}
                  title="Renommer le fil"
                  aria-label="Renommer le fil"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => void forkConversationThread()}
                  disabled={chatBusy || !activeThreadId}
                  title="Explorer une autre solution"
                  aria-label="Explorer une autre solution"
                >
                  <GitBranch size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setSecondaryConversationOpen(true)}
                  disabled={!activeThreadId}
                  title="Ouvrir une conversation secondaire liée"
                  aria-label="Conversation secondaire"
                >
                  <Bot size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => void archiveConversationThread()}
                  disabled={chatBusy || !activeThreadId}
                  title="Archiver le fil"
                  aria-label="Archiver le fil"
                >
                  <Archive size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => void exportConversationThread()}
                  disabled={!activeThreadId}
                  title="Exporter le fil en Markdown"
                  aria-label="Exporter le fil"
                >
                  <Download size={14} />
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => void clearConversationThreadMemory()}
                  disabled={chatBusy || !activeThreadId}
                  title="Effacer uniquement la mémoire de ce fil"
                  aria-label="Effacer la mémoire du fil"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="execution-summary" aria-live="polite">
                <span className={`execution-badge is-${executionMode}`}>
                  {executionMode === 'local'
                    ? <><Monitor size={13} /> Local</>
                    : executionMode === 'cloud'
                      ? <><Cloud size={13} /> Cloud</>
                      : <><RadioTower size={13} /> Hybride</>}
                </span>
                <small>
                  {executionMode === 'local'
                    ? 'Travaille avec le projet ouvert sur ce PC.'
                    : executionMode === 'cloud'
                      ? 'Continue sur le serveur avec les seuls fichiers joints.'
                      : 'Cloud + relais vers ce PC uniquement lorsqu’il est en ligne.'}
                </small>
                {activeCloudTask
                  && ['queued', 'running', 'cancel_requested'].includes(activeCloudTask.status)
                  && (
                    <button
                      type="button"
                      onClick={() => void cancelActiveCloudTask()}
                    >
                      <CircleStop size={13} />
                      Annuler la tâche
                    </button>
                  )}
                <button
                  type="button"
                  className={`relay-control ${relayState.connected ? 'is-connected' : ''}`}
                  onClick={() => void toggleRelay()}
                  title="Aucun port public n’est ouvert : connexion HTTPS sortante uniquement"
                >
                  <RadioTower size={13} />
                  {relayState.connected
                    ? 'Relais actif'
                    : relayState.enabled
                      ? 'Relais hors ligne'
                      : 'Activer le relais'}
                </button>
              </div>
              {relayState.pendingCommands.map((command) => (
                <div className="relay-command" key={command.id}>
                  <div>
                    <strong>Instruction distante à valider</strong>
                    <span>{command.payload.instruction || command.action}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void resolveRelayInstruction(command.id, false)}
                  >
                    Refuser
                  </button>
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => void resolveRelayInstruction(command.id, true)}
                  >
                    Placer dans le composeur
                  </button>
                </div>
              ))}
              {messages.map((message) => (
                <article key={message.id} className={`agent-message is-${message.role}`}>
                  <header>
                    <strong>
                      {message.role === 'user'
                        ? 'Vous'
                        : message.role === 'assistant'
                          ? 'NeuraCo'
                          : 'Système'}
                    </strong>
                    <div className="message-header-actions">
                      {message.model && <span>{message.model}</span>}
                      {!chatBusy && !message.id.startsWith('welcome') && (
                        <>
                          <button
                            type="button"
                            onClick={() => void forkConversationThread(message.id)}
                            title="Explorer une autre solution depuis ce message"
                            aria-label="Créer une branche depuis ce message"
                          >
                            <GitBranch size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void rewindConversationThread(message.id)}
                            title="Revenir à ce point"
                            aria-label="Revenir à ce message"
                          >
                            <RotateCcw size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </header>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  {message.files && message.files.length > 0 && (
                    <div className="message-files">
                      <Files size={14} />
                      {message.files.join(', ')}
                    </div>
                  )}
                  {message.proposedFiles && message.proposedFiles.length > 0 && (
                    <div className="proposed-files-summary">
                      <div>
                        <Files size={15} />
                        <span>
                          <strong>{message.proposedFiles.length} fichier(s) proposé(s)</strong>
                          <small>
                            {message.proposedFiles.map((file) => file.path).join(' · ')}
                          </small>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => reviewProposedFiles(message)}
                      >
                        {message.proposedFiles.every((file) => file.status === 'applied')
                          ? 'Voir les fichiers'
                          : 'Examiner avant application'}
                      </button>
                    </div>
                  )}
                  {message.images && message.images.length > 0 && (
                    <div className="message-images">
                      {message.images.map((image) => (
                        <figure key={image.id}>
                          <img src={image.preview} alt={image.name} />
                          <figcaption>
                            {image.name} · {image.width}×{image.height} · {formatImageBytes(image.size)}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </article>
              ))}
              {chatBusy && (
                <div className="agent-working">
                  <span />
                  {executionMode !== 'local'
                    ? `Tâche ${executionMode === 'hybrid' ? 'hybride' : 'Cloud'} `
                      + `${activeCloudTask?.status || 'en préparation'}…`
                    : activeExecution?.kind === 'multi_agent'
                      ? 'L’équipe NeuraCo exécute les étapes validées…'
                      : 'NeuraCo analyse le contexte autorisé…'}
                </div>
              )}
            </div>
            {routingPreview && (
              <TaskRoutingPreview
                preview={routingPreview}
                requestedMode={taskMode}
                agents={routingAgents}
                selectedAgentIds={selectedRoutingAgentIds}
                executionMode={executionMode}
                busy={routingBusy}
                onModeChange={(mode) => void changeRoutingMode(mode)}
                onEffortChange={(nextEffort) => void changeEffort(nextEffort)}
                onCommunicationStyleChange={(nextStyle) => (
                  void changeCommunicationStyle(nextStyle)
                )}
                onToggleAgent={(agentId) => void toggleRoutingAgent(agentId)}
                onConfirm={() => void confirmRouting()}
                onCancel={cancelRouting}
              />
            )}
            {controlledMemory && controlledMemory.pendingCount > 0 && (
              <div className="memory-suggestion-banner" role="status">
                <BrainCircuit size={17} />
                <div>
                  <strong>Mémoire suggérée, non active</strong>
                  <span>
                    {controlledMemory.entries.find(
                      (entry) => entry.status === 'pending'
                    )?.content}
                  </span>
                </div>
                <button type="button" onClick={() => setTab('memory')}>
                  Examiner
                </button>
              </div>
            )}
            {(instructionQueue.length > 0 || parallelSubtaskCount > 0) && (
              <div className="instruction-queue-status" role="status">
                <Archive size={16} />
                <div>
                  <strong>
                    {instructionQueue.length > 0
                      ? `${instructionQueue.length} instruction(s) dans la file`
                      : 'Sous-tâche parallèle en cours'}
                  </strong>
                  <span>
                    {instructionQueue[0]?.content
                      || `${parallelSubtaskCount} agent(s) distinct(s) travaille(nt) en parallèle.`}
                  </span>
                </div>
                {parallelSubtaskCount > 0 && (
                  <small>{parallelSubtaskCount} parallèle(s)</small>
                )}
              </div>
            )}
            {instructionDecision && (
              <section
                className="instruction-decision"
                role="dialog"
                aria-modal="true"
                aria-labelledby="instruction-decision-title"
              >
                <header>
                  <div>
                    <strong id="instruction-decision-title">
                      Nouvelle instruction pendant le travail
                    </strong>
                    <span>{instructionDecision.content}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInstructionDecision(null)}
                    aria-label="Fermer"
                  >
                    <X size={15} />
                  </button>
                </header>
                <div className="instruction-decision-options">
                  <button
                    type="button"
                    onClick={() => void resolveInstructionDecision('queue')}
                  >
                    <Archive size={18} />
                    <strong>Ajouter à la file</strong>
                    <span>
                      L’étape actuelle se termine, puis cette instruction démarre
                      automatiquement.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void resolveInstructionDecision('redirect')}
                  >
                    <RotateCcw size={18} />
                    <strong>Rediriger maintenant</strong>
                    <span>
                      La tâche actuelle est interrompue seule, puis le plan est
                      réévalué immédiatement.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void resolveInstructionDecision('subtask')}
                  >
                    <UsersRound size={18} />
                    <strong>Créer une sous-tâche</strong>
                    <span>
                      Un autre agent traite cette instruction en parallèle sans
                      arrêter le travail principal.
                    </span>
                  </button>
                </div>
              </section>
            )}
            <div
              className={`agent-composer ${draggingImages ? 'is-dragging' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDraggingImages(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setDraggingImages(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDraggingImages(false);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDraggingImages(false);
                void addImageFiles(droppedImageFiles(event.dataTransfer));
              }}
            >
              <div className="agent-options">
                <div className="execution-mode-select" aria-label="Lieu d’exécution">
                  <button
                    type="button"
                    className={executionMode === 'local' ? 'is-active' : ''}
                    onClick={() => setExecutionMode('local')}
                    disabled={chatBusy}
                    title="Exécuter dans NeuraCo sur ce PC"
                  >
                    <Monitor size={13} />
                    Local
                  </button>
                  <button
                    type="button"
                    className={executionMode === 'cloud' ? 'is-active' : ''}
                    onClick={() => {
                      setExecutionMode('cloud');
                      setPendingImages([]);
                    }}
                    disabled={chatBusy}
                    title="Continuer sur le serveur sans accès automatique au PC"
                  >
                    <Cloud size={13} />
                    Cloud
                  </button>
                  <button
                    type="button"
                    className={executionMode === 'hybrid' ? 'is-active' : ''}
                    onClick={() => {
                      setExecutionMode('hybrid');
                      setPendingImages([]);
                    }}
                    disabled={chatBusy || !relayState.connected}
                    title={
                      relayState.connected
                        ? 'Cloud avec relais sécurisé vers ce PC en ligne'
                        : 'Activez d’abord le relais sécurisé'
                    }
                  >
                    <RadioTower size={13} />
                    Hybride
                  </button>
                </div>
                <select
                  value={taskMode}
                  onChange={(event) => setTaskMode(
                    event.target.value as RequestedTaskMode
                  )}
                  aria-label="Mode de travail"
                  disabled={chatBusy || Boolean(routingPreview)}
                >
                  <option value="automatic">Automatique</option>
                  <option value="question">Question</option>
                  <option value="plan">Plan (aucune modification)</option>
                  <option value="code">Code</option>
                  <option value="cowork">Cowork</option>
                  <option value="research">Recherche</option>
                  <option value="3d">3D</option>
                  <option value="fivem">FiveM</option>
                  <option value="frontend">Frontend</option>
                  <option value="audit">Audit</option>
                </select>
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(
                    event.target.value as NeuraCoAgentModel
                  )}
                  aria-label="Modèle IA"
                  disabled={chatBusy || Boolean(routingPreview)}
                >
                  <option value="auto">Modèle automatique</option>
                  <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                </select>
                <select
                  value={effort}
                  onChange={(event) => setEffort(
                    event.target.value as NeuraCoEffortLevel
                  )}
                  aria-label="Niveau d’effort"
                  disabled={chatBusy || Boolean(routingPreview)}
                >
                  <option value="rapid">Effort rapide</option>
                  <option value="normal">Effort normal</option>
                  <option value="deep">Effort approfondi</option>
                  <option value="maximum">Effort maximum</option>
                </select>
                <select
                  value={responseSpeed}
                  onChange={(event) => setResponseSpeed(
                    event.target.value as NeuraCoResponseSpeed
                  )}
                  aria-label="Vitesse de réponse"
                  disabled={chatBusy || Boolean(routingPreview)}
                >
                  <option value="standard">Vitesse standard</option>
                  <option value="fast">Vitesse rapide</option>
                </select>
                <select
                  value={communicationStyle}
                  onChange={(event) => setCommunicationStyle(
                    event.target.value as NeuraCoCommunicationStyle
                  )}
                  aria-label="Style de communication"
                  disabled={chatBusy || Boolean(routingPreview)}
                >
                  <option value="direct">Style direct et court</option>
                  <option value="normal">Style normal</option>
                  <option value="detailed">Style détaillé</option>
                  <option value="pedagogical">Style pédagogique</option>
                </select>
                <button
                  type="button"
                  className="new-agent-session"
                  onClick={() => void resetChatSession()}
                  disabled={chatBusy}
                  title="Nouveau fil de tâche"
                >
                  <FilePlus2 size={13} />
                  Nouveau fil
                </button>
                {activeFile && (
                  <label>
                    <input
                      type="checkbox"
                      checked={includeActiveFile}
                      onChange={(event) => setIncludeActiveFile(event.target.checked)}
                    />
                    Joindre {activeFile.relativePath}
                  </label>
                )}
              </div>
              {pendingImages.length > 0 && (
                <div className="agent-attachments" aria-label="Images jointes">
                  {pendingImages.map((attachment) => (
                    <div
                      key={attachment.localId}
                      className={`agent-attachment ${attachment.error ? 'has-error' : ''}`}
                    >
                      {attachment.image ? (
                        <img src={attachment.image.preview} alt="" />
                      ) : (
                        <span className="attachment-placeholder">
                          {attachment.error
                            ? <Images size={18} />
                            : <LoaderCircle className="attachment-spinner" size={18} />}
                        </span>
                      )}
                      <div>
                        <strong title={attachment.name}>{attachment.name}</strong>
                        {attachment.image ? (
                          <small>
                            {attachment.image.width}×{attachment.image.height}
                            {' · '}
                            {formatImageBytes(attachment.image.size)}
                          </small>
                        ) : attachment.error ? (
                          <small>{attachment.error}</small>
                        ) : (
                          <small>Préparation {attachment.progress}%</small>
                        )}
                        {!attachment.image && !attachment.error && (
                          <span className="attachment-progress">
                            <i style={{ width: `${attachment.progress}%` }} />
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        title="Retirer cette image"
                        onClick={() => setPendingImages((current) => (
                          current.filter((item) => item.localId !== attachment.localId)
                        ))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                disabled={routingBusy || Boolean(routingPreview)}
                onPaste={(event) => {
                  const files = clipboardImageFiles(event.clipboardData);
                  if (files.length > 0) {
                    if (!event.clipboardData.getData('text/plain')) event.preventDefault();
                    void addImageFiles(files);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendChat();
                  }
                }}
                placeholder="Demandez une analyse, une explication ou un plan vérifiable…"
              />
              <div className="agent-attachment-actions">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={(event) => {
                    void addImageFiles(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                />
                <div className="composer-tools">
                  <button
                    type="button"
                    title="Ajouter ou ouvrir un outil"
                    aria-label="Ajouter ou ouvrir un outil"
                    aria-expanded={composerToolsOpen}
                    disabled={chatBusy || routingBusy || Boolean(routingPreview)}
                    onClick={() => setComposerToolsOpen((open) => !open)}
                  >
                    <Plus size={17} />
                    <span>Ajouter</span>
                  </button>
                  {composerToolsOpen && (
                    <div className="composer-tools-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={
                          executionMode !== 'local'
                          || pendingImages.length >= MAX_AGENT_IMAGES
                        }
                        onClick={() => {
                          setComposerToolsOpen(false);
                          imageInputRef.current?.click();
                        }}
                      >
                        <ImagePlus size={16} />
                        <span><strong>Images</strong><small>Joindre une capture ou une image</small></span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setComposerToolsOpen(false);
                          setCreatingFile(true);
                        }}
                      >
                        <FilePlus2 size={16} />
                        <span><strong>Nouveau fichier</strong><small>Créer un fichier dans ce projet</small></span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setComposerToolsOpen(false);
                          setTab('goals');
                        }}
                      >
                        <Target size={16} />
                        <span><strong>Objectifs</strong><small>Organiser les étapes du projet</small></span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setComposerToolsOpen(false);
                          setTaskMode('plan');
                        }}
                      >
                        <ClipboardCheck size={16} />
                        <span><strong>Mode plan</strong><small>Analyser sans modifier les fichiers</small></span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setComposerToolsOpen(false);
                          setTab('extensions');
                        }}
                      >
                        <Blocks size={16} />
                        <span><strong>Extensions</strong><small>Ouvrir les outils installés</small></span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setComposerToolsOpen(false);
                          setTab('browser');
                        }}
                      >
                        <Globe2 size={16} />
                        <span><strong>Navigateur</strong><small>Ouvrir le navigateur intégré</small></span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setComposerToolsOpen(false);
                          setTab('computer');
                        }}
                      >
                        <Monitor size={16} />
                        <span><strong>Ordinateur</strong><small>Ouvrir les actions Windows contrôlées</small></span>
                      </button>
                    </div>
                  )}
                </div>
                <small>
                  {executionMode !== 'local'
                    ? 'Distant : seuls les fichiers explicitement joints sont envoyés.'
                    : 'Coller, déposer ou ajouter · pixels non conservés dans l’historique.'}
                </small>
              </div>
              <button
                type="button"
                className="agent-send"
                disabled={
                  (!chatInput.trim() && readyImages.length === 0)
                  || routingBusy
                  || Boolean(routingPreview)
                  || imagesProcessing
                  || emergencyState.stopped
                  || !connectivity.online
                }
                onClick={() => void sendChat()}
                title={connectivity.online ? 'Envoyer' : 'Connexion Internet nécessaire pour l’IA'}
              >
                <Send size={17} />
              </button>
            </div>
          </div>
        )}

        {tab === 'editor' && (
          <div className="editor-view">
            {editorSession.documents.length > 0 && (
              <nav className="editor-tabs" aria-label="Fichiers ouverts">
                {editorSession.documents.map((document) => {
                  const documentDirty = isEditorDocumentDirty(document);
                  const selected = document.file.relativePath === editorSession.activePath;
                  return (
                    <div
                      key={document.file.relativePath}
                      className={selected ? 'is-active' : ''}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setEditorSession((current) => (
                            selectEditorDocument(current, document.file.relativePath)
                          ));
                          setEditorPreview(false);
                        }}
                        title={document.file.relativePath}
                      >
                        <File size={13} />
                        <span>{document.file.relativePath.split('/').pop()}</span>
                        {documentDirty && <i aria-label="Modifié" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => closeEditorTab(document.file.relativePath)}
                        title={`Fermer ${document.file.relativePath}`}
                        aria-label={`Fermer ${document.file.relativePath}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </nav>
            )}
            <header className="editor-toolbar">
              <div className="editor-file-status">
                <File size={15} />
                <span>{activeFile?.relativePath || 'Aucun fichier ouvert'}</span>
                {dirty && <small>Modifié</small>}
                {activeFile && (
                  <small>{Math.max(1, Math.ceil(activeFile.size / 1024))} Ko</small>
                )}
                {activeFile && (
                  <small className={editorMarkers > 0 ? 'has-errors' : ''}>
                    {editorMarkers} diagnostic(s)
                  </small>
                )}
              </div>
              <div className="editor-command-group">
                <button
                  type="button"
                  disabled={!activeFile}
                  onClick={() => void runEditorAction('actions.find', 'Recherche indisponible.')}
                  title="Rechercher (Ctrl+F)"
                  aria-label="Rechercher"
                >
                  <Search size={14} />
                </button>
                <button
                  type="button"
                  disabled={!activeFile}
                  onClick={() => void runEditorAction(
                    'editor.action.startFindReplaceAction',
                    'Remplacement indisponible.'
                  )}
                  title="Rechercher et remplacer (Ctrl+H)"
                  aria-label="Rechercher et remplacer"
                >
                  <Replace size={14} />
                </button>
                <button
                  type="button"
                  disabled={!activeFile}
                  onClick={() => void runEditorAction(
                    'editor.action.revealDefinition',
                    'Aucune définition disponible à cette position.'
                  )}
                  title="Atteindre la définition (F12)"
                >
                  Définition
                </button>
                <button
                  type="button"
                  disabled={!activeFile || emergencyState.stopped}
                  onClick={() => void runEditorAction(
                    'editor.action.formatDocument',
                    'Aucun formateur n’est disponible pour ce type de fichier.'
                  )}
                  title="Formater le document"
                >
                  Formater
                </button>
                <button
                  type="button"
                  disabled={!activeFile || !['html', 'markdown'].includes(activeFile.language)}
                  className={editorPreview ? 'is-active' : ''}
                  onClick={() => setEditorPreview((current) => !current)}
                  title="Aperçu sécurisé HTML ou Markdown"
                >
                  Aperçu
                </button>
              </div>
              <button
                type="button"
                disabled={!dirty || saving || emergencyState.stopped}
                onClick={() => void saveFile()}
              >
                <Save size={15} />
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button
                type="button"
                className="editor-trash"
                disabled={!activeFile || emergencyState.stopped}
                onClick={() => void moveActiveFileToTrash()}
                title="Déplacer le fichier dans la corbeille NeuraCo"
              >
                <Trash2 size={15} />
                Corbeille
              </button>
            </header>
            {activeFile ? (
              <div className={`editor-canvas ${editorPreview ? 'has-preview' : ''}`}>
                <Editor
                  key={activeFile.relativePath}
                  height="100%"
                  language={activeFile.language}
                  path={`file:///${activeFile.relativePath}`}
                  value={editorValue}
                  onMount={mountEditor}
                  onChange={(value) => {
                    const nextValue = value ?? '';
                    setEditorSession((current) => (
                      updateEditorDocument(current, activeFile.relativePath, nextValue)
                    ));
                  }}
                  theme="vs"
                  options={{
                    automaticLayout: true,
                    fontFamily: 'Cascadia Code, Consolas, monospace',
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    largeFileOptimizations: true,
                    maxTokenizationLineLength: 20_000
                  }}
                />
                {editorPreview && activeFile.language === 'markdown' && (
                  <aside className="editor-preview markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{editorValue}</ReactMarkdown>
                  </aside>
                )}
                {editorPreview && activeFile.language === 'html' && (
                  <aside className="editor-preview">
                    <iframe
                      title={`Aperçu de ${activeFile.relativePath}`}
                      sandbox=""
                      srcDoc={editorValue}
                    />
                  </aside>
                )}
              </div>
            ) : (
              <div className="empty-workspace">
                <Code2 size={34} />
                <h2>Ouvrez un fichier</h2>
                <p>Sélectionnez un fichier texte dans l’explorateur.</p>
                <span>{allFiles.length} fichiers disponibles</span>
              </div>
            )}
          </div>
        )}

        {tab === 'team' && (
          <MultiAgentPanel
            snapshot={snapshot}
            files={allFiles}
            emergencyStopped={emergencyState.stopped}
            onStatus={setStatus}
          />
        )}

        {tab === 'goals' && (
          <GoalsPanel
            snapshot={snapshot}
            onStatus={setStatus}
          />
        )}

        {tab === 'environments' && (
          <EnvironmentTransferPanel onStatus={setStatus} />
        )}

        {tab === 'sites' && (
          <HostedSitesPanel
            emergencyStopped={emergencyState.stopped}
            onStatus={setStatus}
            onOpenPreview={async (address) => {
              if (!window.neuraco) return;
              await window.neuraco.newBrowserTab(address);
              setTab('browser');
            }}
          />
        )}

        {tab === 'images' && (
          <ImageStudioPanel onStatus={setStatus} />
        )}

        {tab === 'review' && (
          <ReviewQueuePanel
            snapshot={snapshot}
            emergencyStopped={emergencyState.stopped}
            onProjectRefresh={onRefresh}
            onStatus={setStatus}
            onOpenFile={(filePath) => {
              const node = allFiles.find((candidate) => candidate.relativePath === filePath);
              if (!node) {
                setStatus(`${filePath} n’existe pas dans le projet actif.`);
                return;
              }
              void openFile(node);
            }}
          />
        )}

        {tab === 'terminal' && (
          <TerminalPanel
            projectRoot={snapshot.project.rootPath}
            emergencyStopped={emergencyState.stopped}
            onStatus={setStatus}
            onOpenBrowser={async (url) => {
              try {
                await window.neuraco?.navigateBrowser(url);
                setTab('browser');
              } catch (error) {
                setStatus(
                  error instanceof Error ? error.message : 'Ouverture du lien impossible.'
                );
              }
            }}
          />
        )}

        {tab === 'processes' && (
          <BackgroundProcessesPanel
            snapshot={snapshot}
            emergencyStopped={emergencyState.stopped}
            onStatus={(message) => setStatus(message)}
          />
        )}

        {tab === 'artifacts' && (
          <ArtifactsPanel
            snapshot={snapshot}
            emergencyStopped={emergencyState.stopped}
            onStatus={(message) => setStatus(message)}
          />
        )}

        {tab === 'memory' && (
          <ControlledMemoryPanel
            state={controlledMemory}
            busy={memoryBusy}
            onStateChange={setControlledMemory}
            onBusyChange={setMemoryBusy}
            onStatus={setStatus}
          />
        )}

        {tab === 'extensions' && (
          <ExtensionsPanel
            emergencyStopped={emergencyState.stopped}
            onStatus={setStatus}
          />
        )}

        {tab === 'hooks' && (
          <HooksPanel
            emergencyStopped={emergencyState.stopped}
            onStatus={setStatus}
          />
        )}

        {tab === 'routines' && (
          <RoutinesPanel
            project={snapshot.project}
            emergencyStopped={emergencyState.stopped}
            onStatus={setStatus}
          />
        )}

        {tab === 'git' && (
          <GitPanel
            snapshot={snapshot}
            emergencyStopped={emergencyState.stopped}
            onProjectRefresh={onRefresh}
            onStatus={setStatus}
            onDelegateIssue={delegateForgeIssue}
          />
        )}

        {tab === 'browser' && (
          <BrowserPanel
            snapshot={snapshot}
            emergencyStopped={emergencyState.stopped}
            onStatus={setStatus}
          />
        )}

        {tab === 'computer' && (
          <ComputerControlPanel
            emergencyStopped={emergencyState.stopped}
            onEmergencyStop={stopAllAgents}
            onStatus={setStatus}
          />
        )}

        {tab === 'studio' && (
          <StudioPanel
            snapshot={snapshot}
            emergencyStopped={emergencyState.stopped}
            onStatus={setStatus}
          />
        )}

        {tab === 'usage' && (
          <UsagePanel onStatus={setStatus} />
        )}

        {tab === 'statistics' && (
          <StatisticsPanel onStatus={setStatus} />
        )}
      </section>
      {proposalReviewMessage && proposalReviewFiles.length > 0 && (
        <div
          className="proposal-review-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !proposalApplying) {
              setProposalReviewMessageId(undefined);
              setProposalReviewPath(undefined);
            }
          }}
        >
          <section
            className="proposal-review-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-review-title"
          >
            <header>
              <div>
                <strong id="proposal-review-title">Fichiers proposés par NeuraCo</strong>
                <span>
                  Rien n’est écrit avant votre validation. Les permissions et checkpoints
                  du projet restent actifs.
                </span>
              </div>
              <button
                type="button"
                title="Fermer"
                aria-label="Fermer l’examen des fichiers"
                disabled={proposalApplying}
                onClick={() => {
                  setProposalReviewMessageId(undefined);
                  setProposalReviewPath(undefined);
                }}
              >
                <X size={17} />
              </button>
            </header>
            <div className="proposal-review-content">
              <nav aria-label="Fichiers proposés">
                {proposalReviewFiles.map((file) => (
                  <button
                    type="button"
                    key={file.path}
                    className={file.path === proposalReviewFile?.path ? 'is-active' : ''}
                    onClick={() => setProposalReviewPath(file.path)}
                    title={file.path}
                  >
                    {file.status === 'applied'
                      ? <Check size={14} />
                      : file.status === 'failed'
                        ? <OctagonX size={14} />
                        : <File size={14} />}
                    <span>{file.path}</span>
                    <small>
                      {file.status === 'applied'
                        ? 'Appliqué'
                        : file.status === 'failed'
                          ? 'Erreur'
                          : 'En attente'}
                    </small>
                  </button>
                ))}
              </nav>
              <div className="proposal-code-preview">
                <header>
                  <strong>{proposalReviewFile?.path}</strong>
                  {proposalReviewFile?.language && <span>{proposalReviewFile.language}</span>}
                </header>
                {proposalReviewFile?.error && (
                  <p className="proposal-file-error">{proposalReviewFile.error}</p>
                )}
                <pre><code>{proposalReviewFile?.content}</code></pre>
              </div>
            </div>
            <footer>
              <span>
                {proposalReviewFiles.filter((file) => file.status === 'applied').length}
                /{proposalReviewFiles.length} appliqué(s)
              </span>
              <button
                type="button"
                disabled={proposalApplying}
                onClick={() => {
                  setProposalReviewMessageId(undefined);
                  setProposalReviewPath(undefined);
                }}
              >
                Fermer
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={
                  proposalApplying
                  || proposalReviewFiles.every((file) => file.status === 'applied')
                  || emergencyState.stopped
                }
                onClick={() => void applyProposedFiles()}
              >
                {proposalApplying
                  ? <><LoaderCircle className="attachment-spinner" size={14} /> Application…</>
                  : 'Appliquer dans le projet'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {permissions && permissionsOpen && (
        <ProjectPermissionsDialog
          permissions={permissions}
          busy={permissionsBusy}
          onClose={() => setPermissionsOpen(false)}
          onSave={updatePermissions}
        />
      )}
      {recoveryOpen && (
        <RecoveryPanel
          checkpoints={checkpoints}
          retention={checkpointRetention}
          trash={trashEntries}
          recoverableTasks={recoverableTasks}
          busy={recoveryBusy || emergencyState.stopped}
          emergencyShortcut={emergencyShortcut}
          onClose={() => setRecoveryOpen(false)}
          onCreateCheckpoint={createCheckpoint}
          onRestoreCheckpoint={restoreCheckpoint}
          onUpdateRetention={updateCheckpointRetention}
          onRestoreTrash={restoreTrashEntry}
          onInspectTask={inspectRecoverableTask}
          onResumeTask={resumeRecoverableTask}
          onDiscardTask={discardRecoverableTask}
          onSaveEmergencyShortcut={saveEmergencyShortcut}
        />
      )}
      {notificationsOpen && (
        <NotificationPanel
          notifications={notifications}
          busy={notificationsBusy}
          onClose={() => setNotificationsOpen(false)}
          onRead={markNotificationRead}
          onArchive={archiveNotification}
          onAction={runNotificationAction}
        />
      )}
      {secondaryConversationOpen && activeThreadId && (
        <SecondaryConversationPanel
          projectId={snapshot.project.id}
          projectName={snapshot.project.name}
          parentThreadId={activeThreadId}
          linkedTaskId={activeExecution?.id}
          effort={effort}
          communicationStyle={communicationStyle}
          onPromote={(content) => void promoteSecondaryResponse(content)}
          onClose={() => setSecondaryConversationOpen(false)}
        />
      )}
    </div>
  );
}
