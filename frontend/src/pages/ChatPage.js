import { useCallback, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import AssistantMarkdown from '@/components/AssistantMarkdown';
import ThinkingPanel from '@/components/ThinkingPanel';
import ReasoningLevelPicker from '@/components/ReasoningLevelPicker';
import { ProjectWorkshopPanel, useProjectWorkshop, workshopSummary } from '@/components/ProjectWorkshop';
import ProjectMemoryCard from '@/components/ProjectMemoryCard';
import { VideoAnalysisPanel, useVideoAnalysis } from '@/components/VideoAnalysis';
import { Clapperboard } from 'lucide-react';
import { extractCodeFiles } from '@/utils/codeFiles';
import { checkProject, fixRequest } from '@/utils/projectCheck';
import { keepsErrorsOnPurpose, MAX_AUTO_FIXES, verificationSummary, verifyProject } from '@/utils/codeRunner';
import { versionOf } from '@/components/ProjectWorkshop';
import VerificationNote from '@/components/VerificationNote';
import { canExport, downloadText, printPdf } from '@/utils/exportConversation';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { createChatRequestId, formatQuotaReset } from '@/utils/chatQuota';
import { apiErrorMessage } from '@/utils/apiError';
import { readSseEvents, streamError, streamErrorMessage, streamHttpError } from '@/utils/sseStream';
import {
  MAX_CHAT_IMAGES,
  clipboardImageFiles,
  composeImageAttachments,
  droppedImageFiles,
  formatImageBytes,
  prepareImageAttachment
} from '@/utils/imageAttachments';
import { toast } from 'sonner';
import { 
  Send, 
  Square,
  Package,
  FileDown,
  Lock,
  Plus, 
  Menu, 
  X, 
  Sparkles, 
  Moon, 
  Sun, 
  MessageSquare, 
  Trash2,
  Settings,
  LogOut,
  BookOpen,
  Clock,
  Heart,
  Brain,
  Image as ImageIcon,
  FileText,
  Loader2,
  Crown,
  Zap,
  Star,
  Wand2,
  Globe,
  Camera,
  Briefcase,
  Copy,
  Check,
  Languages,
  GraduationCap,
  MapPin,
  Compass,
  Gift,
  Phone,
  PhoneOff
} from 'lucide-react';
import { planLabel } from '@/utils/planLabels';
import useVoiceCall from '@/hooks/useVoiceCall';
import VoiceCallPanel, { VoicePicker } from '@/components/VoiceCallPanel';
import { getVoicePreference, saveVoicePreference } from '@/utils/voice';

// Code block with a copy button.
function CodeBlock({ children }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = ref.current?.innerText || '';
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative my-3">
      <button type="button" onClick={copy}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        {copied ? <><Check className="w-3 h-3" /> Copié</> : <><Copy className="w-3 h-3" /> Copier</>}
      </button>
      <pre ref={ref} className="overflow-x-auto rounded-lg bg-[#0d1117] text-[#e6edf3] p-4 text-sm border border-border">
        {children}
      </pre>
    </div>
  );
}

const mdComponents = {
  pre: CodeBlock,
  code: ({ children }) => (
    <code className="px-1.5 py-0.5 rounded bg-muted text-primary text-[0.85em]">{children}</code>
  ),
};

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const getStoredModelKey = () => {
  const stored = localStorage.getItem('neura_model');
  if (stored === 'grok') return 'gemini';
  // "model:<id>" = a model of the full catalogue (Plus plans); the server checks access.
  if (typeof stored === 'string' && stored.startsWith('model:')) return stored;
  return ['chatgpt', 'claude', 'gemini'].includes(stored) ? stored : 'chatgpt';
};

// Routers first, then the catalogue grouped by provider (when the plan offers it).
const groupModelOptions = (options) => {
  const routers = options.filter((option) => !option.group);
  const groups = [];
  options.filter((option) => option.group).forEach((option) => {
    let group = groups.find((item) => item.name === option.group);
    if (!group) {
      group = { name: option.group, options: [] };
      groups.push(group);
    }
    group.options.push(option);
  });
  return { routers, groups };
};

// Per-model web-search status labels, translated for the active UI languages.
const SEARCH_STATUS = {
  chatgpt: {
    fr: { searching: 'Recherche sur le web…', reading_sources: 'Analyse des sources…', writing: 'Rédaction de la réponse…' },
    en: { searching: 'Searching the web…', reading_sources: 'Reading sources…', writing: 'Writing the answer…' },
    ar: { searching: 'البحث في الويب…', reading_sources: 'تحليل المصادر…', writing: 'كتابة الإجابة…' },
    es: { searching: 'Buscando en la web…', reading_sources: 'Analizando las fuentes…', writing: 'Redactando la respuesta…' },
    tr: { searching: "Web'de aranıyor…", reading_sources: 'Kaynaklar analiz ediliyor…', writing: 'Yanıt yazılıyor…' },
  },
  claude: {
    fr: { searching: 'Recherche sur le web…', reading_sources: 'Consultation des sources…', writing: 'Synthèse des informations…' },
    en: { searching: 'Searching the web…', reading_sources: 'Reviewing sources…', writing: 'Synthesizing information…' },
    ar: { searching: 'البحث في الويب…', reading_sources: 'مراجعة المصادر…', writing: 'تجميع المعلومات…' },
    es: { searching: 'Buscando en la web…', reading_sources: 'Revisando las fuentes…', writing: 'Sintetizando la información…' },
    tr: { searching: "Web'de aranıyor…", reading_sources: 'Kaynaklar inceleniyor…', writing: 'Bilgiler sentezleniyor…' },
  },
  gemini: {
    fr: { searching: 'Recherche sur le web…', reading_sources: 'Vérification des sources…', writing: 'Génération de la réponse…' },
    en: { searching: 'Searching the web…', reading_sources: 'Verifying sources…', writing: 'Generating the answer…' },
    ar: { searching: 'البحث في الويب…', reading_sources: 'التحقق من المصادر…', writing: 'إنشاء الإجابة…' },
    es: { searching: 'Buscando en la web…', reading_sources: 'Verificando las fuentes…', writing: 'Generando la respuesta…' },
    tr: { searching: "Web'de aranıyor…", reading_sources: 'Kaynaklar doğrulanıyor…', writing: 'Yanıt oluşturuluyor…' },
  },
  grok: {
    fr: { searching: 'Recherche en temps réel…', reading_sources: 'Analyse de plusieurs sources…', writing: 'Préparation de la réponse…' },
    en: { searching: 'Real-time search…', reading_sources: 'Analyzing multiple sources…', writing: 'Preparing the answer…' },
    ar: { searching: 'بحث في الوقت الفعلي…', reading_sources: 'تحليل عدة مصادر…', writing: 'تحضير الإجابة…' },
    es: { searching: 'Búsqueda en tiempo real…', reading_sources: 'Analizando varias fuentes…', writing: 'Preparando la respuesta…' },
    tr: { searching: 'Gerçek zamanlı arama…', reading_sources: 'Birden fazla kaynak analiz ediliyor…', writing: 'Yanıt hazırlanıyor…' },
  },
};

// While the answer is being prepared, the app shows that NEURA AL-NOUR is thinking,
// whatever engine answers behind it.
const THINKING_LABEL = {
  fr: 'NEURA AL-NOUR réfléchit',
  en: 'NEURA AL-NOUR is thinking',
  ar: 'نور يفكّر',
  es: 'NEURA AL-NOUR está pensando',
  tr: 'NEURA AL-NOUR düşünüyor',
};
const getStatusLabel = (lang, model, phase) => {
  if (phase === 'writing' || !phase) return THINKING_LABEL[lang] || THINKING_LABEL.fr;
  const l = SEARCH_STATUS.chatgpt[lang] || SEARCH_STATUS.chatgpt.fr;
  return (l && l[phase]) || '…';
};

const STREAM_INTERRUPTED_MESSAGE = 'La réponse a été interrompue avant la fin. Réessayez.';
const WORK_UNAVAILABLE_MESSAGE = 'Le mode Work est temporairement indisponible.';

const WORK_STATUS = {
  analyzing: 'Analyse de la tâche…',
  reading_files: 'Lecture des fichiers du projet…',
  searching: 'Recherche des informations nécessaires…',
  generating: 'Exécution et création des livrables…',
  saving: 'Enregistrement du travail…',
};

const quotaNoticeContent = (message) => {
  const reset = formatQuotaReset(message.reset_at) || 'l’heure indiquée par le serveur';
  if (message.quota_type === 'advanced_fallback') {
    return `**Limite de l’IA avancée atteinte**\n\nVotre quota d’IA avancée est épuisé pour cette conversation. La conversation continue temporairement avec une version moyenne, dans la limite de son quota restant. Votre accès à l’IA avancée dans cette conversation sera renouvelé à ${reset}. Passez à une offre supérieure pour continuer avec l’IA avancée.`;
  }
  if (message.quota_type === 'text_blocked') {
    return `**Limite gratuite atteinte**\n\nVous avez épuisé le quota gratuit de cette conversation. Passez à une offre supérieure pour continuer cette même conversation ou commencez une nouvelle discussion. Le quota de cette conversation sera renouvelé à ${reset}.`;
  }
  if (message.quota_type === 'image_upload_blocked') {
    return `**Limite d’envoi de captures atteinte**\n\nVous avez utilisé vos trois captures d’écran ou images pour cette période. Vous pourrez en envoyer de nouvelles à ${reset} ou passer à une offre supérieure.`;
  }
  if (message.quota_type === 'image_analysis_blocked') {
    return `**Limite d’analyse de cette image atteinte**\n\nCette conversation contient une capture d’écran dont le quota d’analyse est épuisé. Réessayez à ${reset}, passez à une offre supérieure ou commencez une nouvelle conversation sans image.`;
  }
  return message.content;
};

const getLocalCurrentDateAnswer = (text, lang) => {
  const normalized = (text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const asksDate = [
    'quelle date', 'quel date', 'on est quel', 'on et quel',
    'on est quelle', 'nous sommes quel', 'nous sommes quelle',
    'date aujourd', 'quel jour', 'what date', 'current date',
    "today's date", 'what day is it'
  ].some((marker) => normalized.includes(marker));
  if (!asksDate) return null;

  const now = new Date();
  const responseLanguage = (lang || 'fr').toLowerCase();
  if (responseLanguage.startsWith('en')) {
    return `Today is ${new Intl.DateTimeFormat('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'Europe/Paris'
    }).format(now)} (Europe/Paris).`;
  }
  if (responseLanguage.startsWith('fr')) {
    return `Nous sommes aujourd'hui le ${new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'Europe/Paris'
    }).format(now)} (Europe/Paris).`;
  }
  return null;
};

const isImageGenerationIntent = (text) => {
  const normalized = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [
    'cree-moi une image', 'cree une image', 'genere une image',
    'genere-moi une image', 'cree une illustration', 'genere une illustration'
  ].some((marker) => normalized.includes(marker));
};

const ChatPage = () => {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user, getAuthHeader, logout, handleUnauthorizedResponse } = useAuth();
  // The model reasons in English: translated to French when the user opens "Réflexion".
  const translateThinking = useCallback(
    (text) => axios.post(`${API}/chat/thinking/translate`, { text }, { headers: getAuthHeader(), timeout: 60000 })
      .then((response) => response.data?.text || ''),
    [getAuthHeader],
  );
  const { theme, toggleTheme } = useTheme();
  const { languageName, language, t } = useLanguage();
  
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  // Latest messages for the voice call, which reads the reply after sending.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [chatVoice, setChatVoice] = useState(() => getVoicePreference('chat'));
  // During a call the microphone pauses while the user types (keyboard noise).
  const lastTypedAtRef = useRef(0);
  // Receives the reply while it streams, so the call's voice starts on the first sentence.
  const voiceDeltaRef = useRef(null);
  const streamAbortRef = useRef(null);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentConversation, setCurrentConversation] = useState(conversationId);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [selectedImages, setSelectedImages] = useState([]);
  const [imagesProcessing, setImagesProcessing] = useState(false);
  const [imageDropActive, setImageDropActive] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageGenRemaining, setImageGenRemaining] = useState(null);
  const [selectedModel, setSelectedModel] = useState(getStoredModelKey);
  const [modelOptions, setModelOptions] = useState([]);
  const [activeModel, setActiveModel] = useState(null);
  const [selectedIntelligenceMode, setSelectedIntelligenceMode] = useState(() => {
    try { return localStorage.getItem('neura_reasoning_level') || 'auto'; } catch { return 'auto'; }
  });
  const [intelligenceModes, setIntelligenceModes] = useState([]);
  const [workAvailable, setWorkAvailable] = useState(false);
  const [conversationMode, setConversationMode] = useState('chat');
  const [workQuota, setWorkQuota] = useState(null);
  const [webMode, setWebMode] = useState(() => localStorage.getItem('neura_websearch') === '1' ? 'forced' : 'auto');
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const workshop = useProjectWorkshop();
  const zipInputRef = useRef(null);
  // Step 5: a video analysed in the browser; its timeline goes with each question.
  const video = useVideoAnalysis(getAuthHeader);
  const videoInputRef = useRef(null);
  const [projectMemoryTick, setProjectMemoryTick] = useState(0);
  // Real checks of the delivered code (by answer) and the automatic corrections (3 at most).
  const [verifications, setVerifications] = useState({});
  const autoFixRef = useRef({ conversation: null, attempts: 0 });
  const [pendingAutoFix, setPendingAutoFix] = useState(null);
  const [imageCreationMode, setImageCreationMode] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState(null);
  const [streamContent, setStreamContent] = useState('');
  const [streamSources, setStreamSources] = useState([]);
  const [streamThinking, setStreamThinking] = useState('');
  const [conversationQuota, setConversationQuota] = useState(null);
  const [chatImageQuota, setChatImageQuota] = useState(null);
  const [activeCaptureId, setActiveCaptureId] = useState(null);
  const [captureQuota, setCaptureQuota] = useState(null);
  const isMongoPlan = user?.subscription === 'mongo';

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const photoInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const toolsMenuRef = useRef(null);
  const imageBatchRef = useRef(0);
  // Incremented whenever the displayed conversation changes. A request started
  // in another view keeps running (the server saves its answer) but must not
  // update the conversation now on screen.
  const viewTokenRef = useRef(0);
  const fetchMessagesSeqRef = useRef(0);
  // Generated images and developer answers are not stored in the conversation
  // by the server: keep them for this visit so a reload of the conversation
  // does not wipe them. Keyed by conversation id ('new' before it exists).
  const localOnlyMessagesRef = useRef({});
  const webSearch = webMode === 'forced';
  const cameraAvailable = typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia);
  const textQuotaBlocked = Boolean(currentConversation && conversationQuota?.applies && conversationQuota?.blocked);
  const captureQuotaBlocked = Boolean(currentConversation && captureQuota?.applies && captureQuota?.blocked);
  const conversationBlocked = textQuotaBlocked || (!isMongoPlan && captureQuotaBlocked);
  const imageUploadBlocked = Boolean(chatImageQuota?.applies && chatImageQuota?.remaining <= 0);
  const imageMaxBytes = (
    user?.is_vip || ['neura_plus', 'neura_ultra'].includes(user?.subscription)
  ) ? 20 * 1024 * 1024 : 5 * 1024 * 1024;

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (!toolsMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!toolsMenuRef.current?.contains(event.target)) setToolsMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setToolsMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [toolsMenuOpen]);

  useEffect(() => {
    resetViewState();
    if (conversationId) {
      setCurrentConversation(conversationId);
      fetchMessages(conversationId);
    } else {
      setMessages([]);
      setCurrentConversation(null);
      setConversationQuota(null);
      setWorkQuota(null);
      setActiveCaptureId(null);
      setCaptureQuota(null);
    }
  }, [conversationId]);

  useEffect(() => {
    if (currentConversation) {
      fetchModelState(currentConversation, null);
    } else {
      fetchModelState(null, selectedModel);
    }
  }, [currentConversation]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    fetchImageGenRemaining();
    fetchChatImageQuota();
  }, []);

  useEffect(() => {
    const deadlines = [
      conversationQuota?.reset_at,
      captureQuota?.reset_at,
      chatImageQuota?.reset_at,
      imageGenRemaining?.reset_at
    ]
      .map((value) => value ? new Date(value).getTime() : NaN)
      .filter((value) => Number.isFinite(value) && value > Date.now());
    if (!deadlines.length) return undefined;

    const delay = Math.min(...deadlines) - Date.now() + 500;
    const timer = window.setTimeout(() => {
      if (currentConversation) fetchMessages(currentConversation);
      fetchChatImageQuota();
      fetchImageGenRemaining();
    }, Math.max(500, delay));
    return () => window.clearTimeout(timer);
  }, [
    currentConversation,
    conversationQuota?.reset_at,
    captureQuota?.reset_at,
    chatImageQuota?.reset_at,
    imageGenRemaining?.reset_at
  ]);

  useEffect(() => {
    if (isMongoPlan && captureQuotaBlocked) setActiveCaptureId(null);
  }, [isMongoPlan, captureQuotaBlocked]);

  const fetchImageGenRemaining = async () => {
    try {
      const response = await axios.get(`${API}/images/remaining`, { headers: getAuthHeader() });
      setImageGenRemaining(response.data);
    } catch (error) {
      console.error('Error fetching image gen remaining:', error);
    }
  };

  const fetchChatImageQuota = async () => {
    try {
      const response = await axios.get(`${API}/chat/quota/images`, { headers: getAuthHeader() });
      setChatImageQuota(response.data);
      return response.data;
    } catch (error) {
      console.error('Error fetching chat image quota:', error);
      return null;
    }
  };

  const fetchWorkQuota = async () => {
    if (!workAvailable) return null;
    try {
      const response = await axios.get(`${API}/chat/work/quota`, { headers: getAuthHeader() });
      setWorkQuota(response.data);
      return response.data;
    } catch (error) {
      setWorkQuota(null);
      return null;
    }
  };

  const viewGuard = () => {
    const token = viewTokenRef.current;
    return () => viewTokenRef.current === token;
  };

  const rememberLocalMessages = (convKey, ...items) => {
    const key = convKey || 'new';
    localOnlyMessagesRef.current[key] = [...(localOnlyMessagesRef.current[key] || []), ...items];
  };

  // A new chat that just received its id adopts the local-only messages kept under 'new'.
  const adoptNewChatLocalMessages = (convId) => {
    const pending = localOnlyMessagesRef.current.new;
    if (!convId || !pending?.length) return;
    localOnlyMessagesRef.current[convId] = [...(localOnlyMessagesRef.current[convId] || []), ...pending];
    delete localOnlyMessagesRef.current.new;
  };

  const resetViewState = () => {
    viewTokenRef.current += 1;
    setStreaming(false);
    setStreamPhase(null);
    setStreamContent('');
    setStreamSources([]);
    setLoading(false);
    setGeneratingImage(false);
    setSelectedImage(null);
    setImagePreview(null);
    setSelectedImages([]);
    imageBatchRef.current += 1;
    setImagesProcessing(false);
    setSelectedDocument(null);
    setImageCreationMode(false);
  };

  const generateImage = async () => {
    if (!inputMessage.trim() || loading || generatingImage) return;
    
    // Check remaining
    if (imageGenRemaining && !imageGenRemaining.unlimited && imageGenRemaining.remaining <= 0) {
      const reset = formatQuotaReset(imageGenRemaining.reset_at);
      toast.error(`Quota de génération d’images atteint${reset ? `. Renouvellement : ${reset}` : ''}.`);
      return;
    }

    const prompt = inputMessage.trim();
    const stillHere = viewGuard();
    const convKey = currentConversation;
    setInputMessage('');
    setGeneratingImage(true);

    // Add user message
    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: `🎨 Génère une image : ${prompt}`,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const response = await axios.post(`${API}/images/generate`, 
        { prompt },
        { headers: getAuthHeader(), timeout: 120000 }
      );

      const aiMessage = {
        id: `ai-img-${Date.now()}`,
        role: 'assistant',
        content: `Image générée pour : "${prompt}"`,
        generated_image: `data:image/png;base64,${response.data.image_base64}`,
        created_at: new Date().toISOString()
      };
      rememberLocalMessages(convKey, tempUserMsg, aiMessage);
      if (response.data.generation_quota) setImageGenRemaining(response.data.generation_quota);
      fetchImageGenRemaining();
      if (!stillHere()) return;
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      if (!stillHere()) return;
      toast.error(apiErrorMessage(error, 'Erreur lors de la génération de l\'image'));
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
    } finally {
      if (stillHere()) {
        setGeneratingImage(false);
        inputRef.current?.focus();
      }
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchConversations = async () => {
    try {
      const response = await axios.get(`${API}/chat/conversations`, {
        headers: getAuthHeader()
      });
      setConversations(response.data);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    }
  };

  const applyServerModel = (model) => {
    if (!model?.model_id || !model?.provider || !model?.label) return;
    setActiveModel(model);
    if (model.selection_key && model.selection_key !== selectedModel) {
      setSelectedModel(model.selection_key);
      localStorage.setItem('neura_model', model.selection_key);
    }
    if (model.requested_mode) {
      setSelectedIntelligenceMode(model.requested_mode);
    }
  };

  const fetchModelState = async (convId, requestedModel, requestedMode) => {
    try {
      const params = {};
      if (convId) params.conversation_id = convId;
      if (requestedModel) params.model = requestedModel;
      if (requestedMode) params.intelligence_mode = requestedMode;
      const response = await axios.get(`${API}/chat/models`, {
        headers: getAuthHeader(),
        params
      });
      if (Array.isArray(response.data?.options)) setModelOptions(response.data.options);
      setIntelligenceModes(Array.isArray(response.data?.intelligence_modes) ? response.data.intelligence_modes : []);
      setWorkAvailable(Boolean(response.data?.work_available));
      if (convId && response.data?.conversation_type) {
        setConversationMode(response.data.conversation_type);
      }
      applyServerModel(response.data?.active_model);
      return response.data;
    } catch (error) {
      console.error('Error fetching model state:', error);
      return null;
    }
  };

  const handleModelChange = (nextModel) => {
    setSelectedModel(nextModel);
    localStorage.setItem('neura_model', nextModel);
    fetchModelState(currentConversation, nextModel, selectedIntelligenceMode);
  };

  // "Réflexion en cours" only when the engine really reasons (or searches, or writes code);
  // at the Instantané level there is no reasoning step: a dot, like ChatGPT.
  const appliedLevel = activeModel?.requested_mode || selectedIntelligenceMode;
  const showsReasoning = Boolean(streamThinking)
    || /```/.test(streamContent || '')
    || Boolean(streamPhase && streamPhase !== 'writing')
    || ['medium', 'high', 'very_high'].includes(appliedLevel);

  const handleIntelligenceModeChange = (nextMode) => {
    setSelectedIntelligenceMode(nextMode);
    try { localStorage.setItem('neura_reasoning_level', nextMode); } catch { /* private mode */ }
    fetchModelState(currentConversation, selectedModel, nextMode);
  };

  const fetchMessages = async (convId) => {
    const seq = fetchMessagesSeqRef.current + 1;
    fetchMessagesSeqRef.current = seq;
    try {
      const [messagesResponse, quotaResponse] = await Promise.all([
        axios.get(`${API}/chat/conversations/${convId}/messages`, { headers: getAuthHeader() }),
        axios.get(`${API}/chat/conversations/${convId}/quota`, { headers: getAuthHeader() })
      ]);
      // Opening A then B quickly: only the latest request may fill the screen.
      if (seq !== fetchMessagesSeqRef.current) return;
      const localOnly = localOnlyMessagesRef.current[convId] || [];
      const serverMessages = Array.isArray(messagesResponse.data) ? messagesResponse.data : [];
      setMessages(localOnly.length
        ? [...serverMessages, ...localOnly].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
        : serverMessages);
      setConversationQuota(quotaResponse.data);
      setConversationMode(quotaResponse.data?.conversation_type || 'chat');
      setWorkQuota(quotaResponse.data?.work_quota || null);
      applyServerModel(quotaResponse.data?.active_model);
      setCaptureQuota(quotaResponse.data?.capture || null);
      setActiveCaptureId(
        isMongoPlan && quotaResponse.data?.capture?.blocked
          ? null
          : quotaResponse.data?.capture?.capture_id || null
      );
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const sendMessageStream = async (userMessage, tempId, requestId) => {
    const stillHere = viewGuard();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    setStreaming(true);
    setStreamPhase('writing');
    setStreamContent('');
    setStreamSources([]);
    setStreamThinking('');
    const startedAt = Date.now();
    let acc = '';
    let thinking = '';
    let sources = [];
    let webMeta = null;
    let convId = currentConversation;
    let quotaLimited = false;
    let completed = false;
    try {
      const workshopContext = workshop.active ? await workshop.contextFor(userMessage, appliedLevel) : null;
      if (workshopContext) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, workshop: workshopSummary(workshopContext.report) } : m)));
      }
      const videoContext = video.ready ? video.contextFor() : null;
      if (videoContext) setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, video: videoContext.summary } : m)));
      const response = await fetch(`${API}/chat/stream`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          content: userMessage,
          conversation_id: currentConversation,
          request_id: requestId,
          model: selectedModel,
          intelligence_mode: selectedIntelligenceMode,
          lang: languageName,
          web_search: webSearch,
          web_mode: webMode,
          // Spoken in a voice call: the server keeps the answer short and easy to listen to.
          voice: Boolean(voiceDeltaRef.current),
          ...(workshopContext ? { project_context: workshopContext.text, project_summary: workshopSummary(workshopContext.report) } : {}),
          ...(videoContext ? { video_context: videoContext.text, video_summary: videoContext.summary } : {}),
        })
      });
      if (!response.ok) {
        handleUnauthorizedResponse(response.status);
        throw await streamHttpError(response, 'Erreur lors de la réponse IA');
      }
      if (!response.body) throw new Error('Erreur lors de la réponse IA');
      await readSseEvents(response, (evt) => {
          if (evt.type === 'conversation') {
            convId = evt.conversation_id;
          } else if (!stillHere()) {
            // Another conversation is on screen: keep reading so the server
            // completes and saves this answer, without touching the display.
            if (evt.type === 'delta') acc += evt.content || '';
            if (evt.type === 'done') completed = true;
          } else if (evt.type === 'phase') {
            setStreamPhase(evt.phase);
            if (evt.phase === 'reading_sources' && Array.isArray(evt.sources)) {
              sources = evt.sources;
              setStreamSources(evt.sources);
            }
          } else if (evt.type === 'thinking') {
            // The model's reasoning: shown folded under "Réflexion en cours".
            thinking += evt.content || '';
            setStreamThinking(thinking);
          } else if (evt.type === 'delta') {
            acc += evt.content || '';
            setStreamContent(acc);
            voiceDeltaRef.current?.(evt.content || '');
          } else if (evt.type === 'model') {
            applyServerModel(evt.model);
          } else if (evt.type === 'done') {
            completed = true;
            if (Array.isArray(evt.sources)) sources = evt.sources;
            if (evt.conversation_id) convId = evt.conversation_id;
            if (evt.quota) setConversationQuota(evt.quota);
            webMeta = evt.web_search || null;
            applyServerModel(evt.active_model || evt.model);
          } else if (evt.type === 'quota_limit') {
            quotaLimited = true;
            if (evt.quota) setConversationQuota(evt.quota);
            toast.error(evt.detail || 'Limite gratuite atteinte pour cette conversation.');
          } else if (evt.type === 'error') {
            throw streamError(evt.detail || 'Erreur lors de la réponse IA');
          }
      });
      if (!stillHere()) {
        // The new conversation (if any) now exists server-side: refresh the list.
        if (!currentConversation && convId) fetchConversations();
        return;
      }
      if (quotaLimited) {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        if (convId) {
          if (!currentConversation) {
            setCurrentConversation(convId);
            navigate(`/chat/${convId}`, { replace: true });
          }
          await fetchMessages(convId);
        }
        return;
      }
      // The server ends every complete answer with a `done` event.
      if (!completed) throw streamError(STREAM_INTERRUPTED_MESSAGE);
      // Project memory: files studied (with their version) and checks of the delivered code.
      if (convId && (workshopContext || /```/.test(acc))) {
        (async () => {
          if (workshopContext) await workshop.saveSnapshot(convId, getAuthHeader());
          const delivered = extractCodeFiles(acc);
          if (delivered.length) {
            const key = versionOf(acc);
            const python = delivered.some((file) => /\.py$/i.test(file.path));
            setVerifications((v) => ({ ...v, [key]: { running: true, python } }));
            const verified = await verifyProject(delivered);
            const issues = verified.issues.map((issue) => `${issue.file} : ${issue.message}`);
            const summary = verificationSummary(verified);
            if (autoFixRef.current.conversation !== convId) autoFixRef.current = { conversation: convId, attempts: 0 };
            const attempt = autoFixRef.current.attempts + 1;
            const onPurpose = issues.length > 0 && keepsErrorsOnPurpose(userMessage);
            const willFix = issues.length > 0 && !onPurpose && attempt <= MAX_AUTO_FIXES;
            setVerifications((v) => ({ ...v, [key]: { ...summary, issues: issues.length, details: issues.slice(0, 5),
              autoFix: willFix ? `Correction automatique ${attempt}/${MAX_AUTO_FIXES} envoyée à Neura`
                : onPurpose ? 'Pas de correction automatique : tu as demandé de garder cette erreur'
                  : issues.length ? `${MAX_AUTO_FIXES} corrections automatiques déjà faites : à toi de voir (bouton « Corriger automatiquement »)` : null } }));
            await axios.post(`${API}/projects/memory/checks`, { conversation_id: convId, issues }, { headers: getAuthHeader() }).catch(() => {});
            if (willFix) {
              autoFixRef.current.attempts = attempt;
              setPendingAutoFix(fixRequest(verified.issues, delivered));
            }
          }
          setProjectMemoryTick((tick) => tick + 1);
        })();
      }
      if (acc) {
        setMessages(prev => [...prev, {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: acc,
          sources,
          web_search: webMeta,
          thinking,
          duration_ms: Date.now() - startedAt,
          created_at: new Date().toISOString()
        }]);
      }
      if (!currentConversation && convId) {
        adoptNewChatLocalMessages(convId);
        setCurrentConversation(convId);
        navigate(`/chat/${convId}`, { replace: true });
        fetchConversations();
      }
      if (convId) fetchMessages(convId);
    } catch (error) {
      if (!stillHere()) return;
      if (controller.signal.aborted) {
        // Stopped by the user: keep what was written (or say it was stopped, like ChatGPT).
        {
          setMessages(prev => [...prev, {
            id: `ai-stopped-${Date.now()}`,
            role: 'assistant',
            content: acc,
            sources,
            stopped: true,
            created_at: new Date().toISOString()
          }]);
        }
        if (!currentConversation && convId) {
          setCurrentConversation(convId);
          navigate(`/chat/${convId}`, { replace: true });
          fetchConversations();
        }
      } else if (acc.trim() && !quotaLimited) {
        // Keep the text already shown instead of discarding it, marked as incomplete.
        setMessages(prev => [...prev, {
          id: `ai-partial-${Date.now()}`,
          role: 'assistant',
          content: acc,
          sources,
          interrupted: true,
          created_at: new Date().toISOString()
        }]);
        if (!currentConversation && convId) {
          setCurrentConversation(convId);
          navigate(`/chat/${convId}`, { replace: true });
          fetchConversations();
        }
        toast.error(STREAM_INTERRUPTED_MESSAGE);
      } else {
        if (error.detail?.quota) setConversationQuota(error.detail.quota);
        toast.error(streamErrorMessage(error, 'Erreur lors de la réponse IA'));
        setMessages(prev => prev.filter(m => m.id !== tempId));
      }
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
      if (webMode === 'forced') {
        setWebMode('auto');
        localStorage.removeItem('neura_websearch');
      }
      if (stillHere()) {
        setStreaming(false);
        setStreamPhase(null);
        setStreamContent('');
        setStreamSources([]);
        setStreamThinking('');
        inputRef.current?.focus();
      }
    }
  };

  // Stop button: halts the answer being written (and the call voice reading it).
  const stopGenerating = () => {
    streamAbortRef.current?.abort();
    if (voiceCall.active) voiceCall.interrupt();
  };

  const sendWorkTask = async (userMessage, tempId, requestId, imageToSend, documentToSend) => {
    const stillHere = viewGuard();
    setStreaming(true);
    setStreamPhase('analyzing');
    setStreamContent('');
    setStreamSources([]);
    let convId = currentConversation;
    let answer = '';
    let sources = [];
    let webMeta = null;
    let quotaLimited = false;
    try {
      const response = await fetch(`${API}/chat/work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          content: userMessage || (documentToSend ? 'Analyse ce document.' : 'Analyse cette image.'),
          conversation_id: currentConversation,
          request_id: requestId,
          image_base64: imageToSend || null,
          document_name: documentToSend?.name || null,
          document_text: documentToSend?.content || null,
          model: selectedModel,
          intelligence_mode: selectedIntelligenceMode,
          lang: languageName,
          web_search: webSearch,
          web_mode: webMode
        })
      });
      if (!response.ok) {
        handleUnauthorizedResponse(response.status);
        throw await streamHttpError(response, WORK_UNAVAILABLE_MESSAGE);
      }
      if (!response.body) throw streamError(WORK_UNAVAILABLE_MESSAGE);
      await readSseEvents(response, (evt) => {
          if (evt.type === 'done') convId = evt.conversation_id || convId;
          if (!stillHere()) return;
          if (evt.type === 'phase') {
            setStreamPhase(evt.phase);
          } else if (evt.type === 'model') {
            applyServerModel(evt.model);
          } else if (evt.type === 'quota') {
            setWorkQuota(evt.work_quota || null);
          } else if (evt.type === 'quota_limit') {
            quotaLimited = true;
            setWorkQuota(evt.work_quota || null);
            toast.error('Limite du mode Work atteinte. Le mode Chat reste disponible.');
          } else if (evt.type === 'done') {
            answer = evt.response || evt.message || '';
            sources = Array.isArray(evt.sources) ? evt.sources : [];
            convId = evt.conversation_id || convId;
            setWorkQuota(evt.work_quota || null);
            webMeta = evt.web_search || null;
            applyServerModel(evt.active_model || evt.model);
          } else if (evt.type === 'error') {
            throw streamError(evt.detail || WORK_UNAVAILABLE_MESSAGE);
          }
      });
      if (!stillHere()) {
        if (!currentConversation && convId) fetchConversations();
        return;
      }
      if (quotaLimited) {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        return;
      }
      if (!answer) throw streamError(STREAM_INTERRUPTED_MESSAGE);
      setMessages(prev => [...prev, {
        id: `work-${Date.now()}`,
        role: 'assistant',
        content: answer,
        sources,
        web_search: webMeta,
        conversation_type: 'work',
        created_at: new Date().toISOString()
      }]);
      if (!currentConversation && convId) {
        setCurrentConversation(convId);
        navigate(`/chat/${convId}`, { replace: true });
        fetchConversations();
      }
      if (convId) fetchMessages(convId);
    } catch (error) {
      if (!stillHere()) return;
      toast.error(streamErrorMessage(error, WORK_UNAVAILABLE_MESSAGE));
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } finally {
      if (webMode === 'forced') {
        setWebMode('auto');
        localStorage.removeItem('neura_websearch');
      }
      if (stillHere()) {
        setStreaming(false);
        setStreamPhase(null);
        setStreamContent('');
        setStreamSources([]);
        inputRef.current?.focus();
      }
    }
  };

  const handleVoiceUtterance = async (spoken, { onDelta } = {}) => {
    const before = messagesRef.current.length;
    voiceDeltaRef.current = onDelta || null;
    try {
      await sendMessage(null, spoken);
    } finally {
      voiceDeltaRef.current = null;
    }
    // Let React apply the last state updates of the answer.
    await new Promise((resolve) => { window.setTimeout(resolve, 60); });
    const reply = messagesRef.current.slice(before).reverse().find((message) => message.role === 'assistant');
    return reply?.content || '';
  };
  const voiceCall = useVoiceCall({
    getAuthHeader,
    onUtterance: handleVoiceUtterance,
    voice: chatVoice,
    canListen: () => !inputRef.current?.value?.trim() && Date.now() - lastTypedAtRef.current > 2500,
    // Vocabulary only: given the AI's last reply, the transcriber "hears" it in the silence.
    context: () => 'NEURA AL-NOUR, islam, Coran, salat, inchallah, hamdoulillah, bismillah, doua.',
  });
  const toggleVoiceCall = () => (voiceCall.active ? voiceCall.stop() : voiceCall.start());
  const changeChatVoice = (voice) => {
    setChatVoice(voice);
    saveVoicePreference(voice, 'chat');
  };

  // The automatic correction asked after a failed real check, sent once the answer is over.
  useEffect(() => {
    if (!pendingAutoFix || streaming || loading) return;
    const request = pendingAutoFix;
    setPendingAutoFix(null);
    sendMessage(null, request);
  }, [pendingAutoFix, streaming, loading]);

  const sendMessage = async (e, spokenText) => {
    e?.preventDefault();
    // A message typed by the user starts a new series of automatic corrections.
    if (e) autoFixRef.current.attempts = 0;
    // A voice call sends what was said instead of the text box.
    const text = spokenText ?? inputMessage;
    if (
      (!text.trim() && !selectedImage && !selectedDocument)
      || loading
      || streaming
      || imagesProcessing
    ) return;
    if (
      !selectedImage
      && !selectedDocument
      && spokenText == null
      && (imageCreationMode || (conversationMode === 'chat' && isImageGenerationIntent(text)))
    ) {
      setImageCreationMode(false);
      await generateImage();
      return;
    }
    if (conversationBlocked) {
      toast.error('Cette conversation a atteint sa limite gratuite. Commencez une nouvelle conversation ou consultez les offres.');
      return;
    }

    const userMessage = text.trim();
    const requestId = createChatRequestId();
    if (spokenText == null) setInputMessage('');

    // Optimistically add user message
    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage || (selectedImage
        ? `[${selectedImages.length > 1 ? `${selectedImages.length} images envoyées` : 'Image envoyée'}]`
        : selectedDocument ? `[Document envoyé : ${selectedDocument.name}]` : ''),
      has_image: !!selectedImage,
      document_name: selectedDocument?.name,
      image_preview: imagePreview,
      image_previews: selectedImages.map((image) => image.preview),
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    // Clear image after adding to message
    const imageToSend = selectedImage;
    const documentToSend = selectedDocument;
    setSelectedImage(null);
    setImagePreview(null);
    setSelectedImages([]);
    setSelectedDocument(null);

    if (conversationMode === 'work') {
      await sendWorkTask(
        userMessage,
        tempUserMsg.id,
        requestId,
        imageToSend,
        documentToSend
      );
      return;
    }

    const localDateAnswer = (!imageToSend && !documentToSend && !webSearch)
      ? getLocalCurrentDateAnswer(userMessage, language)
      : null;
    if (localDateAnswer) {
      setMessages(prev => [...prev, {
        id: `ai-direct-${Date.now()}`,
        role: 'assistant',
        content: localDateAnswer,
        sources: [],
        created_at: new Date().toISOString()
      }]);
      // Save in the backend without blocking the UI. The backend has the same
      // direct-date guard, so no LLM call is triggered.
      axios.post(`${API}/chat/message`, {
        content: userMessage,
        conversation_id: currentConversation,
        request_id: requestId,
        model: selectedModel,
        intelligence_mode: selectedIntelligenceMode,
        lang: languageName,
        web_search: false,
        web_mode: 'auto'
      }, { headers: getAuthHeader(), timeout: 15000 }).then((response) => {
        applyServerModel(response.data?.active_model);
        if (!currentConversation && response.data?.conversation_id) {
          setCurrentConversation(response.data.conversation_id);
          navigate(`/chat/${response.data.conversation_id}`, { replace: true });
          fetchConversations();
        }
      }).catch(() => {});
      inputRef.current?.focus();
      return;
    }

    // Text chat always uses SSE so the server can activate Web automatically.
    if (!imageToSend && !documentToSend && !activeCaptureId) {
      await sendMessageStream(userMessage, tempUserMsg.id, requestId);
      return;
    }

    const stillHere = viewGuard();
    setLoading(true);
    try {
      const response = await axios.post(`${API}/chat/message`, {
        content: userMessage || (documentToSend ? "Analyse ce document s'il te plaît." : "Analyse cette image s'il te plaît."),
        conversation_id: currentConversation,
        request_id: requestId,
        image_base64: imageToSend,
        image_id: imageToSend ? requestId : null,
        capture_id: !imageToSend && !documentToSend ? activeCaptureId : null,
        document_name: documentToSend?.name || null,
        document_text: documentToSend?.content || null,
        model: selectedModel,
        intelligence_mode: selectedIntelligenceMode,
        lang: languageName,
        web_search: webSearch,
        web_mode: webMode
      }, {
        headers: getAuthHeader(),
        timeout: 120000 // 2 minute timeout for image/document analysis
      });

      if (!stillHere()) {
        if (!currentConversation) fetchConversations();
        return;
      }

      // Update with real response
      const aiMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: response.data.message,
        sources: response.data.sources || [],
        web_search: response.data.web_search || null,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMessage]);
      if (response.data.quota) setConversationQuota(response.data.quota);
      applyServerModel(response.data.active_model || response.data.model);
      if (response.data.image_quota) setChatImageQuota(response.data.image_quota);
      if (response.data.capture_id) setActiveCaptureId(response.data.capture_id);
      if (response.data.capture_quota) setCaptureQuota(response.data.capture_quota);

      // Update conversation ID if new
      if (!currentConversation) {
        setCurrentConversation(response.data.conversation_id);
        navigate(`/chat/${response.data.conversation_id}`, { replace: true });
        fetchConversations();
      }
      fetchChatImageQuota();
      if (response.data.conversation_id) fetchMessages(response.data.conversation_id);
    } catch (error) {
      if (!stillHere()) return;
      const detail = error.response?.data?.detail;
      // A FastAPI validation error (422) sends a list: never pass it to the toast.
      const errorMsg = detail && typeof detail === 'object' && !Array.isArray(detail)
        ? detail.message || 'Limite gratuite atteinte'
        : apiErrorMessage(error, 'Erreur lors de l\'envoi du message');
      if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
        if (detail.quota) setConversationQuota(detail.quota);
        if (detail.image_quota) setChatImageQuota(detail.image_quota);
        if (detail.capture_quota) {
          setCaptureQuota(detail.capture_quota);
          if (isMongoPlan && detail.capture_quota.blocked) setActiveCaptureId(null);
        }
        const failedConversationId = detail.conversation_id || currentConversation;
        if (failedConversationId) {
          if (!currentConversation) {
            setCurrentConversation(failedConversationId);
            navigate(`/chat/${failedConversationId}`, { replace: true });
            fetchConversations();
          }
          fetchMessages(failedConversationId);
        }
        fetchChatImageQuota();
      }
      toast.error(errorMsg);
      // Remove temp message on error
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
    } finally {
      if (webMode === 'forced') {
        setWebMode('auto');
        localStorage.removeItem('neura_websearch');
      }
      if (stillHere()) {
        setLoading(false);
        inputRef.current?.focus();
      }
    }
  };

  const addImageFiles = async (files) => {
    if (!files.length || imagesProcessing) return;
    if (imageUploadBlocked) {
      const reset = formatQuotaReset(chatImageQuota?.reset_at);
      toast.error(`Limite de captures atteinte${reset ? `. Renouvellement : ${reset}` : ''}.`);
      return;
    }
    if (selectedImages.length + files.length > MAX_CHAT_IMAGES) {
      toast.error(`Vous pouvez joindre jusqu’à ${MAX_CHAT_IMAGES} images par message.`);
      return;
    }

    const batchId = imageBatchRef.current + 1;
    imageBatchRef.current = batchId;
    setImagesProcessing(true);
    try {
      const prepared = [];
      for (const file of files) {
        prepared.push(await prepareImageAttachment(file, imageMaxBytes));
        if (imageBatchRef.current !== batchId) return;
      }
      const nextImages = [...selectedImages, ...prepared];
      const composed = await composeImageAttachments(nextImages, imageMaxBytes);
      if (imageBatchRef.current !== batchId) return;
      setSelectedImages(nextImages);
      setSelectedImage(composed);
      setImagePreview(nextImages[0]?.preview || null);
      setSelectedDocument(null);
    } catch (error) {
      toast.error(error.message || 'Impossible d’ajouter cette image.');
    } finally {
      if (imageBatchRef.current === batchId) setImagesProcessing(false);
    }
  };

  const handleImageSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length) {
      await addImageFiles(imageFiles);
      return;
    }

    const file = files[0];
    const textLike = (
      file.type.startsWith('text/') ||
      [
        'application/json',
        'application/xml',
        'application/javascript',
        'application/typescript',
        'application/x-python-code'
      ].includes(file.type) ||
      /\.(txt|md|csv|json|xml|html|css|js|jsx|ts|tsx|py|java|php|sql|yml|yaml|toml|ini|log)$/i.test(file.name)
    );
    if (file.size > 1024 * 1024) {
      toast.error('Le document texte ne doit pas dépasser 1 Mo');
      return;
    }
    if (!textLike) {
      toast.error('Format non pris en charge. Utilise une image ou un fichier texte/code.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedImage(null);
      setImagePreview(null);
      setSelectedImages([]);
      setSelectedDocument({
        name: file.name,
        type: file.type || 'text/plain',
        content: String(event.target.result || '').slice(0, 20000)
      });
    };
    reader.onerror = () => toast.error('Impossible de lire ce document.');
    reader.readAsText(file);
  };

  const handleImagePaste = async (event) => {
    const files = clipboardImageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();

    const pastedText = event.clipboardData.getData('text/plain');
    if (pastedText) {
      const start = event.currentTarget.selectionStart ?? inputMessage.length;
      const end = event.currentTarget.selectionEnd ?? start;
      setInputMessage(`${inputMessage.slice(0, start)}${pastedText}${inputMessage.slice(end)}`);
    }
    await addImageFiles(files);
  };

  const handleImageDrop = async (event) => {
    event.preventDefault();
    setImageDropActive(false);
    await addImageFiles(droppedImageFiles(event.dataTransfer));
  };

  const cancelImageProcessing = () => {
    imageBatchRef.current += 1;
    setImagesProcessing(false);
  };

  const removeSelectedImage = async (imageId) => {
    const nextImages = selectedImages.filter((image) => image.id !== imageId);
    setSelectedImages(nextImages);
    if (!nextImages.length) {
      setSelectedImage(null);
      setImagePreview(null);
      if (photoInputRef.current) photoInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      return;
    }
    setImagesProcessing(true);
    try {
      setSelectedImage(await composeImageAttachments(nextImages, imageMaxBytes));
      setImagePreview(nextImages[0].preview);
    } catch (error) {
      toast.error(error.message || 'Impossible de mettre à jour les images.');
    } finally {
      setImagesProcessing(false);
    }
  };

  const removeSelectedDocument = () => {
    setSelectedDocument(null);
    if (documentInputRef.current) documentInputRef.current.value = '';
  };

  const activateForcedWebSearch = () => {
    setWebMode('forced');
    localStorage.setItem('neura_websearch', '1');
    setToolsMenuOpen(false);
    inputRef.current?.focus();
  };

  const activateImageCreation = () => {
    setToolsMenuOpen(false);
    if (inputMessage.trim()) {
      generateImage();
      return;
    }
    setImageCreationMode(true);
    inputRef.current?.focus();
  };

  const startNewChat = (requestedMode = 'chat') => {
    const nextMode = typeof requestedMode === 'string' ? requestedMode : 'chat';
    // Also needed when already on /chat (the URL does not change then).
    resetViewState();
    setCurrentConversation(null);
    setMessages([]);
    setConversationQuota(null);
    setWorkQuota(null);
    setActiveModel(null);
    setActiveCaptureId(null);
    setCaptureQuota(null);
    setSelectedImage(null);
    setImagePreview(null);
    setSelectedImages([]);
    imageBatchRef.current += 1;
    setImagesProcessing(false);
    setSelectedDocument(null);
    setImageCreationMode(false);
    setToolsMenuOpen(false);
    setSelectedIntelligenceMode('auto');
    setConversationMode(nextMode);
    fetchModelState(null, selectedModel, 'auto');
    if (nextMode === 'work') fetchWorkQuota();
    navigate('/chat');
    setSidebarOpen(false);
  };

  const handleConversationModeChange = (nextMode) => {
    if (!workAvailable || !['chat', 'work'].includes(nextMode) || nextMode === conversationMode) return;
    startNewChat(nextMode);
  };

  const deleteConversation = async (convId, e) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API}/chat/conversations/${convId}`, {
        headers: getAuthHeader()
      });
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (currentConversation === convId) {
        startNewChat();
      }
      toast.success('Conversation supprimée');
    } catch (error) {
      toast.error('Erreur lors de la suppression');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const navItems = [
    { icon: BookOpen, label: t('nav.quran'), path: '/quran' },
    { icon: Clock, label: t('nav.prayers'), path: '/prayer-times' },
    { icon: Heart, label: t('nav.duas'), path: '/duas' },
    { icon: Brain, label: t('nav.quiz'), path: '/quiz' },
    { icon: Moon, label: 'Ramadan', path: '/ramadan' },
    { icon: Languages, label: 'Langues', path: '/language-tutor' },
    { icon: GraduationCap, label: 'Apprendre', path: '/islam-learning' },
    { icon: MapPin, label: 'Mosquées', path: '/mosques' },
    { icon: Compass, label: 'Qibla', path: '/qiblah' },
    { icon: Gift, label: 'Missions', path: '/rewards' },
  ];

  const renderSources = (sources) => (
    <div className="mt-3 pt-3 border-t border-border/40">
      <p className="text-xs font-medium text-muted-foreground mb-1">Sources</p>
      <div className="flex flex-col gap-1">
        {sources.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline truncate"
            title={s.title || s.url}
          >
            [{i + 1}] {s.title || s.url}
          </a>
        ))}
      </div>
    </div>
  );

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border transform transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-4">
              <Link to="/" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-bold">NEURA</span>
                <span className="font-arabic text-muted-foreground text-sm">نور</span>
              </Link>
              <button onClick={() => setSidebarOpen(false)} className="md:hidden p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <Button
              onClick={startNewChat} 
              className="w-full rounded-full"
              data-testid="new-chat-btn"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t('chat.newConversation')}
            </Button>
          </div>

          {/* Conversations List */}
          <ScrollArea className="flex-1 p-2">
            <div className="space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => {
                    navigate(`/chat/${conv.id}`);
                    setSidebarOpen(false);
                  }}
                  className={`
                    w-full text-left p-3 rounded-lg flex items-center gap-3 group transition-colors cursor-pointer
                    ${currentConversation === conv.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}
                  `}
                  data-testid={`conversation-${conv.id}`}
                >
                  {conv.conversation_type === 'work'
                    ? <Briefcase className="w-4 h-4 flex-shrink-0" />
                    : <MessageSquare className="w-4 h-4 flex-shrink-0" />}
                  <span className="flex-1 truncate text-sm">{conv.title}</span>
                  <button
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className="md:opacity-0 md:group-hover:opacity-100 p-1 hover:text-destructive transition-opacity"
                    aria-label="Supprimer la conversation"
                    data-testid={`delete-conv-${conv.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Quick Nav */}
          <div className="p-2 border-t border-border">
            <div className="grid grid-cols-5 gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className="p-2 rounded-lg hover:bg-muted flex flex-col items-center gap-1 transition-colors"
                  title={item.label}
                  data-testid={`quick-nav-${item.path.slice(1)}`}
                >
                  <item.icon className="w-4 h-4" />
                  <span className="text-[10px] leading-none text-muted-foreground truncate max-w-full">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* User Section */}
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center relative">
                <span className="text-primary font-medium">
                  {user?.name?.charAt(0).toUpperCase()}
                </span>
                {(user?.is_vip || (user?.subscription && user?.subscription !== 'free')) && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 flex items-center justify-center" data-testid="premium-badge-icon">
                    <Crown className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-sm">{user?.name}</p>
                {user?.is_vip ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 text-xs font-medium" data-testid="premium-badge">
                    <Crown className="w-3 h-3" />
                    VIP Admin
                  </span>
                ) : user?.subscription && user?.subscription !== 'free' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-medium" data-testid="premium-badge">
                    <Zap className="w-3 h-3" />
                    {planLabel(user.subscription)}
                  </span>
                ) : (
                  <Link to="/subscription" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs hover:bg-primary/10 hover:text-primary transition-colors" data-testid="upgrade-link">
                    <Star className="w-3 h-3" />
                    {t('common.upgrade')}
                  </Link>
                )}
              </div>
              <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-muted">
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <Link to="/settings" className="p-2 rounded-lg hover:bg-muted">
                <Settings className="w-4 h-4" />
              </Link>
              <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-muted text-destructive">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden p-4 border-b border-border flex items-center gap-4">
          <button onClick={() => setSidebarOpen(true)} data-testid="mobile-sidebar-btn">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-bold">NEURA AL-NOUR</span>
          </div>
        </header>

        {workAvailable && (
          <div className="flex min-h-11 items-center justify-center border-b border-border px-4">
            <select
              value={conversationMode}
              onChange={(event) => handleConversationModeChange(event.target.value)}
              className="rounded-full border border-border bg-muted px-4 py-1.5 text-sm font-medium outline-none"
              data-testid="conversation-mode-selector"
              aria-label="Mode de conversation"
            >
              <option value="chat">Chat</option>
              <option value="work">Work</option>
            </select>
            {conversationMode === 'work' && workQuota && !workQuota.unlimited && (
              <span className="ml-2 text-xs text-muted-foreground" data-testid="work-quota">
                {workQuota.remaining}/{workQuota.limit} unités
              </span>
            )}
          </div>
        )}

        {messages.length > 0 && (
          <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-1.5 text-xs" data-testid="export-bar">
            {canExport(user) ? (
              <>
                <span className="text-muted-foreground">Exporter :</span>
                <button type="button" className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 hover:text-foreground"
                  onClick={() => downloadText(messages, conversations.find((c) => c.id === currentConversation)?.title || 'Conversation NEURA AL-NOUR')}
                  data-testid="export-text">
                  <FileDown className="h-3 w-3" /> Texte
                </button>
                <button type="button" className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 hover:text-foreground"
                  onClick={() => printPdf(messages, conversations.find((c) => c.id === currentConversation)?.title || 'Conversation NEURA AL-NOUR')}
                  data-testid="export-pdf">
                  <FileDown className="h-3 w-3" /> PDF
                </button>
              </>
            ) : (
              <Link to="/subscription" className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-muted-foreground hover:text-foreground"
                data-testid="export-locked">
                <Lock className="h-3 w-3" /> Exporter la conversation avec Mongo
              </Link>
            )}
          </div>
        )}

        {/* Messages Area */}
        <ScrollArea className="flex-1 p-4">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6 animate-pulse-glow">
                  <Sparkles className="w-10 h-10 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold mb-2">Bienvenue sur NEURA AL-NOUR</h2>
                <p className="text-muted-foreground mb-6">
                  بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
                </p>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Posez-moi vos questions sur l'Islam, demandez-moi de l'aide, ou discutons simplement.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  {[
                    "Quels sont les 5 piliers de l'Islam?",
                    "Comment faire la prière?",
                    "Parle-moi du Ramadan"
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => setInputMessage(suggestion)}
                      className="px-4 py-2 rounded-full bg-muted hover:bg-muted/80 text-sm transition-colors"
                      data-testid={`suggestion-${i}`}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, index) => {
                const isQuotaNotice = msg.role === 'system' && Boolean(msg.quota_type);
                const showNewConversation = ['text_blocked', 'image_analysis_blocked'].includes(msg.quota_type);
                return (
                  <div
                    key={msg.id || index}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    data-testid={`message-${index}`}
                  >
                    <div className={msg.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-br-md bg-primary p-4 text-primary-foreground'
                      : isQuotaNotice
                        ? 'max-w-[85%] rounded-2xl rounded-bl-md border border-amber-500/40 bg-amber-500/10 p-4'
                        : 'w-full max-w-[85%] py-2'
                    }>
                      {msg.role === 'user' && msg.workshop && (
                        <p className="mb-1 text-[11px] opacity-80" data-testid="message-workshop">📦 {msg.workshop}</p>
                      )}
                      {msg.role === 'user' && msg.video && (
                        <p className="mb-1 text-[11px] opacity-80" data-testid="message-video">{msg.video}</p>
                      )}
                      {msg.role === 'assistant' && (
                        <div className="flex items-center gap-2 mb-2 text-primary">
                          <Sparkles className="w-4 h-4" />
                          <span className="text-xs font-medium">NEURA AL-NOUR</span>
                        </div>
                      )}
                      {/* Show image preview if message has image */}
                      {msg.image_previews?.length > 0 ? (
                        <div className="mb-2 grid max-w-sm grid-cols-2 gap-2">
                          {msg.image_previews.map((preview, imageIndex) => (
                            <img
                              key={`${msg.id || index}-image-${imageIndex}`}
                              src={preview}
                              alt={`Pièce jointe ${imageIndex + 1}`}
                              className="aspect-square w-full rounded-lg object-cover"
                            />
                          ))}
                        </div>
                      ) : msg.image_preview ? (
                        <img
                          src={msg.image_preview}
                          alt="Image envoyée"
                          className="max-w-[200px] rounded-lg mb-2"
                        />
                      ) : null}
                      {msg.has_image && !msg.image_preview && !msg.image_previews?.length && (
                        <div className="flex items-center gap-2 mb-2 text-xs opacity-70">
                          <ImageIcon className="w-4 h-4" />
                          <span>Image envoyée</span>
                        </div>
                      )}
                      {msg.generated_image && (
                        <img
                          src={msg.generated_image}
                          alt="Generated"
                          className="w-full max-w-[300px] rounded-lg mb-2"
                          data-testid="generated-image"
                        />
                      )}
                      {msg.role === 'assistant' || isQuotaNotice ? (
                        <div className="markdown-content text-sm leading-relaxed">
                          {isQuotaNotice ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                              {quotaNoticeContent(msg)}
                            </ReactMarkdown>
                          ) : (
                            <>
                              {Boolean(msg.thinking?.trim() || /```/.test(msg.content || '')) && (
                                <ThinkingPanel thinking={msg.thinking || ''} content={msg.content} seconds={(msg.duration_ms || 0) / 1000} translate={translateThinking} />
                              )}
                              <AssistantMarkdown
                                content={msg.content}
                                components={mdComponents}
                                onFixProject={streaming || loading ? undefined : (request) => sendMessage(null, request)}
                              />
                              <VerificationNote result={verifications[versionOf(msg.content || '')]} />
                            </>
                          )}
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                      )}
                      {isQuotaNotice && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            to="/subscription"
                            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                            data-testid="quota-upgrade-btn"
                          >
                            {showNewConversation ? 'Passer à une offre supérieure' : 'Voir les offres'}
                          </Link>
                          {showNewConversation && (
                            <button
                              type="button"
                              onClick={startNewChat}
                              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                              data-testid="quota-new-chat-btn"
                            >
                              Nouvelle conversation
                            </button>
                          )}
                        </div>
                      )}
                      {msg.role === 'assistant' && msg.stopped && (
                        <p className="mt-2 text-xs text-muted-foreground" data-testid="message-stopped">
                          {msg.content?.trim() ? 'Réponse arrêtée.' : 'Tu as arrêté cette réponse.'}
                        </p>
                      )}
                      {msg.role === 'assistant' && msg.interrupted && (
                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400" data-testid="message-interrupted">
                          Réponse incomplète : la connexion a été interrompue.
                        </p>
                      )}
                      {msg.role === 'assistant' && msg.web_search?.performed && (
                        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary" data-testid="web-search-used">
                          <Globe className="h-3 w-3" />
                          Recherche Web
                          {msg.web_search.reason === 'manual_activation' ? ' · activée manuellement' : ' · automatique'}
                        </div>
                      )}
                      {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && renderSources(msg.sources)}
                    </div>
                  </div>
                );
              })
            )}
            {streaming && (
              <div className="flex justify-start">
                <div className="w-full max-w-[85%] py-2">
                  <div className="flex items-center gap-2 mb-2 text-primary">
                    <Sparkles className="w-4 h-4" />
                    <span className="text-xs font-medium">NEURA AL-NOUR</span>
                  </div>
                  {conversationMode !== 'work' && !showsReasoning && !streamContent && (
                    <span className="inline-block h-3.5 w-3.5 animate-pulse rounded-full bg-blue-500" aria-label="Neura écrit" data-testid="writing-dot" />
                  )}
                  {conversationMode !== 'work' && showsReasoning && (
                    <ThinkingPanel
                      active
                      thinking={streamThinking}
                      translate={translateThinking}
                      content={streamContent}
                      label={streamPhase && streamPhase !== 'writing' ? getStatusLabel(language, selectedModel, streamPhase) : undefined}
                    />
                  )}
                  {!streamContent && conversationMode === 'work' && (
                    <div className="flex items-center gap-2 text-primary text-sm" data-testid="neura-thinking">
                      <span className="relative flex h-4 w-4 items-center justify-center">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/30" />
                        <Sparkles className="relative w-3.5 h-3.5" />
                      </span>
                      <span data-testid={conversationMode === 'work' ? 'work-status' : 'search-status'}>
                        {conversationMode === 'work'
                          ? WORK_STATUS[streamPhase] || 'Travail en cours…'
                          : getStatusLabel(language, selectedModel, streamPhase)}
                      </span>
                      <span className="inline-flex gap-0.5" aria-hidden="true">
                        {[0, 150, 300].map((delay) => (
                          <span key={delay} className="h-1 w-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                        ))}
                      </span>
                    </div>
                  )}
                  {streamContent && (
                    <div className="markdown-content text-sm leading-relaxed">
                      <AssistantMarkdown content={streamContent} components={mdComponents} live />
                    </div>
                  )}
                  {streamSources.length > 0 && renderSources(streamSources)}
                </div>
              </div>
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="py-2">
                  <div className="flex items-center gap-2 text-primary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">{getStatusLabel(language, selectedModel, 'writing')}…</span>
                  </div>
                </div>
              </div>
            )}
            {generatingImage && (
              <div className="flex justify-start">
                <div className="glass rounded-2xl rounded-bl-md p-4">
                  <div className="flex items-center gap-2 text-primary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Génération de l'image en cours...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 border-t border-border">
          <form
            onSubmit={sendMessage}
            onDragEnter={(event) => {
              if (Array.from(event.dataTransfer?.types || []).includes('Files')) setImageDropActive(true);
            }}
            onDragOver={(event) => {
              if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setImageDropActive(false);
            }}
            onDrop={handleImageDrop}
            className={`max-w-3xl mx-auto transition-shadow ${imageDropActive ? 'rounded-lg ring-2 ring-primary ring-offset-4 ring-offset-background' : ''}`}
          >
            {selectedImages.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-3" data-testid="image-attachments">
                {selectedImages.map((image, index) => (
                  <div key={image.id} className="relative w-36 rounded-lg border border-border bg-muted/40 p-2">
                    <img
                      src={image.preview}
                      alt={`Pièce jointe ${index + 1}`}
                      className="h-20 w-full rounded-md object-cover"
                    />
                    <p className="mt-1 truncate text-xs font-medium">{image.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {image.width}×{image.height} · {formatImageBytes(image.size)}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeSelectedImage(image.id)}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid={`remove-image-btn-${index}`}
                      aria-label={`Retirer l’image ${index + 1}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {imagesProcessing && (
              <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Préparation des images…
                <button type="button" onClick={cancelImageProcessing} className="font-medium text-primary hover:underline">
                  Annuler
                </button>
              </div>
            )}
            {selectedDocument && (
              <div className="mb-3 inline-flex max-w-full items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2 text-sm">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{selectedDocument.name}</span>
                <button
                  type="button"
                  onClick={removeSelectedDocument}
                  className="ml-1 rounded-full p-1 text-muted-foreground hover:text-foreground"
                  data-testid="remove-document-btn"
                  aria-label="Retirer le document"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {conversationBlocked && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                <span>
                  Cette conversation est temporairement limitée
                  {(captureQuotaBlocked ? formatQuotaReset(captureQuota?.reset_at) : formatQuotaReset(conversationQuota?.reset_at))
                    ? ` jusqu’au ${captureQuotaBlocked ? formatQuotaReset(captureQuota?.reset_at) : formatQuotaReset(conversationQuota?.reset_at)}`
                    : ''}.
                </span>
                <button type="button" onClick={startNewChat} className="font-medium text-primary hover:underline">
                  Nouvelle conversation
                </button>
              </div>
            )}
            
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('chat.model')}</span>
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="text-xs rounded-full bg-muted px-3 py-1 border-0 outline-none cursor-pointer max-w-[60vw] sm:max-w-sm"
                data-testid="model-selector"
                data-provider={activeModel?.provider || ''}
                data-model-id={activeModel?.model_id || ''}
                data-level={activeModel?.stage || ''}
                data-selection-reason={activeModel?.selection_reason || ''}
                disabled={!modelOptions.length}
              >
                {modelOptions.length ? (() => {
                  const { routers, groups } = groupModelOptions(modelOptions);
                  const renderOption = (option, label) => {
                    const model = option.key === selectedModel && activeModel
                      ? activeModel
                      : option.model;
                    return (
                      <option key={option.key} value={option.key}>{label(model)}</option>
                    );
                  };
                  return (
                    <>
                      {routers.map((option) => renderOption(option, (model) => model.label))}
                      {groups.map((group) => (
                        <optgroup key={group.name} label={`Tous les modèles · ${group.name}`}>
                          {group.options.map((option) => renderOption(
                            option,
                            (model) => model.display_name || model.label
                          ))}
                        </optgroup>
                      ))}
                    </>
                  );
                })() : (
                  <option value={selectedModel}>Modèle indisponible</option>
                )}
              </select>
            </div>

            <ProjectWorkshopPanel workshop={workshop} />
            <VideoAnalysisPanel video={video} level={appliedLevel} />
            <ProjectMemoryCard conversationId={currentConversation} refreshKey={projectMemoryTick} />

            {webMode === 'forced' && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary" data-testid="web-search-active">
                <Globe className="h-3 w-3" />
                Recherche Web activée pour la prochaine demande
                <button
                  type="button"
                  onClick={() => {
                    setWebMode('auto');
                    localStorage.removeItem('neura_websearch');
                  }}
                  aria-label="Désactiver la recherche Web"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {imageCreationMode && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary" data-testid="image-creation-active">
                <Wand2 className="h-3 w-3" />
                Décrivez l’image à créer
                <button type="button" onClick={() => setImageCreationMode(false)} aria-label="Annuler la création d’image">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {voiceCall.active && (
              <VoiceCallPanel call={voiceCall} voice={chatVoice} onVoiceChange={changeChatVoice} title="Appel avec Neura" />
            )}
            {!voiceCall.active && voiceCall.error && (
              <p className="mb-2 text-sm text-amber-600 dark:text-amber-400" data-testid="voice-call-error">{voiceCall.error}</p>
            )}
            <div className="relative flex items-center gap-2">
              <input
                type="file"
                ref={photoInputRef}
                onChange={handleImageSelect}
                accept="image/*"
                multiple
                className="hidden"
                data-testid="photo-input"
              />
              <input
                type="file"
                ref={cameraInputRef}
                onChange={handleImageSelect}
                accept="image/*"
                capture="environment"
                className="hidden"
                data-testid="camera-input"
              />
              <input
                type="file"
                ref={documentInputRef}
                onChange={handleImageSelect}
                accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.php,.sql,.yml,.yaml,.toml,.ini,.log"
                className="hidden"
                data-testid="document-input"
              />
              <input
                type="file"
                ref={zipInputRef}
                accept=".zip,application/zip"
                className="hidden"
                data-testid="zip-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) workshop.open(file);
                  event.target.value = '';
                }}
              />
              <input
                type="file"
                ref={videoInputRef}
                accept="video/*"
                className="hidden"
                data-testid="video-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) video.open(file);
                  event.target.value = '';
                }}
              />

              <div className="relative" ref={toolsMenuRef}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-12 w-12 rounded-full"
                  onClick={() => setToolsMenuOpen((open) => !open)}
                  disabled={loading || generatingImage || conversationBlocked}
                  title="Ajouter ou utiliser un outil"
                  aria-expanded={toolsMenuOpen}
                  aria-controls="chat-tools-menu"
                  data-testid="tools-menu-button"
                >
                  <Plus className="w-5 h-5" />
                </Button>
                {toolsMenuOpen && (
                  <div
                    id="chat-tools-menu"
                    className="absolute bottom-14 left-0 z-30 min-w-52 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
                    data-testid="tools-menu"
                  >
                    {cameraAvailable && (
                      <button
                        type="button"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          cameraInputRef.current?.click();
                        }}
                        disabled={imageUploadBlocked}
                        className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                        data-testid="tools-camera"
                      >
                        <Camera className="h-4 w-4" /> Caméra
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setToolsMenuOpen(false);
                        photoInputRef.current?.click();
                      }}
                      disabled={imageUploadBlocked}
                      className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                      data-testid="tools-photos"
                    >
                      <ImageIcon className="h-4 w-4" /> Photos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setToolsMenuOpen(false);
                        documentInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted"
                      data-testid="tools-files"
                    >
                      <FileText className="h-4 w-4" /> Fichiers
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setToolsMenuOpen(false);
                        zipInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted"
                      data-testid="tools-zip"
                    >
                      <Package className="h-4 w-4" /> Atelier de projet (ZIP)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setToolsMenuOpen(false);
                        videoInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted"
                      data-testid="tools-video"
                    >
                      <Clapperboard className="h-4 w-4" /> Analyser une vidéo
                    </button>
                    <button
                      type="button"
                      onClick={activateForcedWebSearch}
                      className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted"
                      data-testid="tools-web"
                    >
                      <Globe className="h-4 w-4" /> Recherche Web
                    </button>
                    <button
                      type="button"
                      onClick={activateImageCreation}
                      disabled={Boolean(imageGenRemaining && !imageGenRemaining.unlimited && imageGenRemaining.remaining <= 0)}
                      className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                      data-testid="tools-create-image"
                    >
                      <Wand2 className="h-4 w-4" />
                      Créer une image
                      {imageGenRemaining && !imageGenRemaining.unlimited && (
                        <span className="ml-auto text-xs text-muted-foreground">{imageGenRemaining.remaining}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setToolsMenuOpen(false);
                        toggleVoiceCall();
                      }}
                      className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted"
                      data-testid="tools-voice-call"
                    >
                      {voiceCall.active ? <PhoneOff className="h-4 w-4 text-destructive" /> : <Phone className="h-4 w-4" />}
                      {voiceCall.active ? 'Raccrocher' : 'Appel vocal'}
                    </button>
                    <div className="px-3 py-2 border-t border-border mt-1">
                      <p className="text-xs text-muted-foreground mb-1.5">Voix de Neura</p>
                      <VoicePicker value={chatVoice} onChange={changeChatVoice} />
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex-1 relative">
                <Input
                  ref={inputRef}
                  value={inputMessage}
                  onChange={(e) => {
                    lastTypedAtRef.current = Date.now();
                    setInputMessage(e.target.value);
                  }}
                  onPaste={handleImagePaste}
                  placeholder={conversationBlocked
                    ? 'Limite atteinte pour cette conversation'
                    : selectedImage || selectedDocument
                      ? "Ajoutez un message (optionnel)..."
                      : imageCreationMode
                        ? "Décrivez l’image à créer..."
                        : conversationMode === 'work'
                          ? "Décrivez la tâche à exécuter..."
                          : t('chat.placeholder')}
                  className="pr-4 h-12 rounded-full bg-muted border-0"
                  disabled={loading || conversationBlocked || imagesProcessing}
                  data-testid="chat-input"
                />
              </div>
              <ReasoningLevelPicker
                modes={intelligenceModes.map((mode) => ({
                  ...mode,
                  // A level of the plan whose Plus quota is used up is locked until it renews.
                  available: mode.available !== false
                    && !(activeModel?.levels_available && activeModel.levels_available[mode.key] === false),
                }))}
                value={selectedIntelligenceMode}
                onChange={handleIntelligenceModeChange}
                disabled={streaming}
              />
              <Button
                type="button"
                size="icon"
                onClick={toggleVoiceCall}
                className={`h-12 w-12 rounded-full shadow-md transition-all ${voiceCall.active
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white hover:shadow-lg hover:shadow-emerald-500/30 hover:scale-105'}`}
                disabled={!voiceCall.active && conversationBlocked}
                title={voiceCall.active ? 'Raccrocher' : 'Appel vocal avec Neura'}
                aria-label={voiceCall.active ? 'Raccrocher' : 'Appel vocal'}
                data-testid="voice-call-btn"
              >
                {voiceCall.active ? <PhoneOff className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
              </Button>
              {streaming && streamAbortRef.current ? (
                <Button
                  type="button"
                  size="icon"
                  onClick={stopGenerating}
                  className="h-12 w-12 rounded-full bg-blue-500 text-white hover:bg-blue-600"
                  title="Arrêter la réponse"
                  aria-label="Arrêter la réponse"
                  data-testid="stop-generating-btn"
                >
                  <Square className="w-4 h-4 fill-white text-white" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  className="h-12 w-12 rounded-full"
                  disabled={loading || streaming || generatingImage || imagesProcessing || conversationBlocked || (!inputMessage.trim() && !selectedImage && !selectedDocument)}
                  data-testid="send-message-btn"
                >
                  <Send className="w-5 h-5" />
                </Button>
              )}
            </div>
            {imageUploadBlocked && (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="chat-image-reset">
                Nouvelles captures disponibles le {formatQuotaReset(chatImageQuota?.reset_at) || 'prochain renouvellement serveur'}.
              </p>
            )}
            <p className="text-xs text-center text-muted-foreground mt-3">
              {t('chat.disclaimer')}
            </p>
          </form>
        </div>
      </main>
    </div>
  );
};

export default ChatPage;
