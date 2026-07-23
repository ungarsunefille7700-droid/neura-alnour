import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import DevWorkspace from '@/components/DevWorkspace';
import { createChatRequestId, formatQuotaReset } from '@/utils/chatQuota';
import { toast } from 'sonner';
import { 
  Send, 
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
  Code2,
  Copy,
  Check
} from 'lucide-react';

// Code block with a copy button (used for developer-mode responses).
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

// Extract the last AI code block (+ "Fichier: path") to pre-fill the workspace editor.
function extractAiCode(messages) {
  const lastAi = [...(messages || [])].reverse().find((m) => m.role === 'assistant');
  if (!lastAi) return null;
  const text = lastAi.content || '';
  const fence = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/);
  if (!fence) return null;
  const pathMatch = text.match(/Fichier\s*:\s*([^\n`]+)/i);
  return { code: fence[1].replace(/\n$/, ''), path: pathMatch ? pathMatch[1].trim() : '' };
}

const mdComponents = {
  pre: CodeBlock,
  code: ({ children }) => (
    <code className="px-1.5 py-0.5 rounded bg-muted text-primary text-[0.85em]">{children}</code>
  ),
};

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MODELS = [
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'claude', label: 'Claude' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'grok', label: 'Grok' },
];

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
    fr: { searching: 'Claude recherche sur le web…', reading_sources: 'Consultation des sources…', writing: 'Synthèse des informations…' },
    en: { searching: 'Claude is searching the web…', reading_sources: 'Reviewing sources…', writing: 'Synthesizing information…' },
    ar: { searching: 'كلود يبحث في الويب…', reading_sources: 'مراجعة المصادر…', writing: 'تجميع المعلومات…' },
    es: { searching: 'Claude está buscando en la web…', reading_sources: 'Revisando las fuentes…', writing: 'Sintetizando la información…' },
    tr: { searching: "Claude web'de arıyor…", reading_sources: 'Kaynaklar inceleniyor…', writing: 'Bilgiler sentezleniyor…' },
  },
  gemini: {
    fr: { searching: 'Recherche Google…', reading_sources: 'Vérification des sources…', writing: 'Génération de la réponse…' },
    en: { searching: 'Searching Google…', reading_sources: 'Verifying sources…', writing: 'Generating the answer…' },
    ar: { searching: 'البحث في جوجل…', reading_sources: 'التحقق من المصادر…', writing: 'إنشاء الإجابة…' },
    es: { searching: 'Buscando en Google…', reading_sources: 'Verificando las fuentes…', writing: 'Generando la respuesta…' },
    tr: { searching: "Google'da aranıyor…", reading_sources: 'Kaynaklar doğrulanıyor…', writing: 'Yanıt oluşturuluyor…' },
  },
  grok: {
    fr: { searching: 'Recherche en temps réel…', reading_sources: 'Analyse de plusieurs sources…', writing: 'Préparation de la réponse…' },
    en: { searching: 'Real-time search…', reading_sources: 'Analyzing multiple sources…', writing: 'Preparing the answer…' },
    ar: { searching: 'بحث في الوقت الفعلي…', reading_sources: 'تحليل عدة مصادر…', writing: 'تحضير الإجابة…' },
    es: { searching: 'Búsqueda en tiempo real…', reading_sources: 'Analizando varias fuentes…', writing: 'Preparando la respuesta…' },
    tr: { searching: 'Gerçek zamanlı arama…', reading_sources: 'Birden fazla kaynak analiz ediliyor…', writing: 'Yanıt hazırlanıyor…' },
  },
};

const getStatusLabel = (lang, model, phase) => {
  const m = SEARCH_STATUS[model] || SEARCH_STATUS.chatgpt;
  const l = m[lang] || m.en || m.fr;
  return (l && l[phase]) || '…';
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

const ChatPage = () => {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user, getAuthHeader, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { languageName, language, t } = useLanguage();
  
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentConversation, setCurrentConversation] = useState(conversationId);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageGenRemaining, setImageGenRemaining] = useState(null);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('neura_model') || 'chatgpt');
  const [webSearch, setWebSearch] = useState(() => localStorage.getItem('neura_websearch') === '1');
  const [devMode, setDevMode] = useState(() => localStorage.getItem('neura_devmode') === '1');
  const [devSessionId, setDevSessionId] = useState(null);
  const [devStatus, setDevStatus] = useState(null);
  const [devRole, setDevRole] = useState('');
  const [wsOpen, setWsOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState(null);
  const [streamContent, setStreamContent] = useState('');
  const [streamSources, setStreamSources] = useState([]);
  const [conversationQuota, setConversationQuota] = useState(null);
  const [chatImageQuota, setChatImageQuota] = useState(null);
  const [activeCaptureId, setActiveCaptureId] = useState(null);
  const [captureQuota, setCaptureQuota] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const textQuotaBlocked = Boolean(currentConversation && conversationQuota?.applies && conversationQuota?.blocked);
  const captureQuotaBlocked = Boolean(currentConversation && captureQuota?.applies && captureQuota?.blocked);
  const conversationBlocked = textQuotaBlocked || captureQuotaBlocked;
  const imageUploadBlocked = Boolean(chatImageQuota?.applies && chatImageQuota?.remaining <= 0);

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (conversationId) {
      setCurrentConversation(conversationId);
      fetchMessages(conversationId);
    } else {
      setMessages([]);
      setCurrentConversation(null);
      setConversationQuota(null);
      setActiveCaptureId(null);
      setCaptureQuota(null);
    }
  }, [conversationId]);

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
      chatImageQuota?.reset_at
    ]
      .map((value) => value ? new Date(value).getTime() : NaN)
      .filter((value) => Number.isFinite(value) && value > Date.now());
    if (!deadlines.length) return undefined;

    const delay = Math.min(...deadlines) - Date.now() + 500;
    const timer = window.setTimeout(() => {
      if (currentConversation) fetchMessages(currentConversation);
      fetchChatImageQuota();
    }, Math.max(500, delay));
    return () => window.clearTimeout(timer);
  }, [
    currentConversation,
    conversationQuota?.reset_at,
    captureQuota?.reset_at,
    chatImageQuota?.reset_at
  ]);

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

  const generateImage = async () => {
    if (!inputMessage.trim() || loading || generatingImage) return;
    
    // Check remaining
    if (imageGenRemaining && !imageGenRemaining.unlimited && imageGenRemaining.remaining <= 0) {
      toast.error('Vous avez utilisé vos 3 générations gratuites. Abonnez-vous au plan Mongo pour continuer.');
      return;
    }

    const prompt = inputMessage.trim();
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
      setMessages(prev => [...prev, aiMessage]);
      
      // Refresh remaining count
      fetchImageGenRemaining();
    } catch (error) {
      const errorMsg = error.response?.data?.detail || 'Erreur lors de la génération de l\'image';
      toast.error(errorMsg);
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
    } finally {
      setGeneratingImage(false);
      inputRef.current?.focus();
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

  const fetchMessages = async (convId) => {
    try {
      const [messagesResponse, quotaResponse] = await Promise.all([
        axios.get(`${API}/chat/conversations/${convId}/messages`, { headers: getAuthHeader() }),
        axios.get(`${API}/chat/conversations/${convId}/quota`, { headers: getAuthHeader() })
      ]);
      setMessages(messagesResponse.data);
      setConversationQuota(quotaResponse.data);
      setCaptureQuota(quotaResponse.data?.capture || null);
      setActiveCaptureId(quotaResponse.data?.capture?.capture_id || null);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const sendMessageStream = async (userMessage, tempId, requestId) => {
    setStreaming(true);
    setStreamPhase('searching');
    setStreamContent('');
    setStreamSources([]);
    let acc = '';
    let sources = [];
    let convId = currentConversation;
    let quotaLimited = false;
    try {
      const response = await fetch(`${API}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          content: userMessage,
          conversation_id: currentConversation,
          request_id: requestId,
          model: selectedModel,
          lang: languageName,
          web_search: true
        })
      });
      if (!response.ok || !response.body) throw new Error('stream failed');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          let evt;
          try { evt = JSON.parse(line.slice(5).trim()); } catch (err) { continue; }
          if (evt.type === 'conversation') {
            convId = evt.conversation_id;
          } else if (evt.type === 'phase') {
            setStreamPhase(evt.phase);
            if (evt.phase === 'reading_sources' && Array.isArray(evt.sources)) {
              sources = evt.sources;
              setStreamSources(evt.sources);
            }
          } else if (evt.type === 'delta') {
            acc += evt.content || '';
            setStreamContent(acc);
          } else if (evt.type === 'done') {
            if (Array.isArray(evt.sources)) sources = evt.sources;
            if (evt.conversation_id) convId = evt.conversation_id;
            if (evt.quota) setConversationQuota(evt.quota);
          } else if (evt.type === 'quota_limit') {
            quotaLimited = true;
            if (evt.quota) setConversationQuota(evt.quota);
            toast.error(evt.detail || 'Limite gratuite atteinte pour cette conversation.');
          } else if (evt.type === 'error') {
            throw new Error(evt.detail || 'error');
          }
        }
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
      const aiMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: acc,
        sources,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMessage]);
      if (!currentConversation && convId) {
        setCurrentConversation(convId);
        navigate(`/chat/${convId}`, { replace: true });
        fetchConversations();
      }
      if (convId) fetchMessages(convId);
    } catch (error) {
      toast.error('Erreur lors de la recherche web');
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } finally {
      setStreaming(false);
      setStreamPhase(null);
      setStreamContent('');
      setStreamSources([]);
      inputRef.current?.focus();
    }
  };

  // Developer (Code) mode: dedicated assistant endpoint with per-plan quotas.
  const sendDevMessage = async (userMessage, tempId, imageToSend, documentToSend = null) => {
    setLoading(true);
    try {
      const devContent = documentToSend
        ? `${userMessage || 'Analyse ce document.'}\n\nDocument fourni (${documentToSend.name}) :\n\`\`\`text\n${documentToSend.content}\n\`\`\``
        : userMessage;
      const r = await axios.post(`${API}/developer/chat`,
        { content: devContent, session_id: devSessionId, image_base64: imageToSend || null, web_search: webSearch, role: devRole || null },
        { headers: getAuthHeader(), timeout: 120000 });
      setDevSessionId(r.data.session_id);
      if (r.data.quota) setDevStatus(s => s ? { ...s, remaining: r.data.quota.remaining, used: r.data.quota.used, reset_at: r.data.quota.reset_at } : s);
      setMessages(prev => [...prev, {
        id: `dev-${Date.now()}`, role: 'assistant', content: r.data.response,
        sources: r.data.sources || [],
        created_at: new Date().toISOString()
      }]);
    } catch (err) {
      if (err.response?.status === 429) {
        const d = err.response.data?.detail || {};
        setMessages(prev => [...prev, {
          id: `dev-${Date.now()}`, role: 'assistant',
          content: (d.message || 'Tu as atteint la limite de génération de ton abonnement.') +
                   '\n\n👉 Passe à **Neura+** ou **Neura Ultra** pour continuer avec plus de puissance.',
          created_at: new Date().toISOString()
        }]);
      } else {
        toast.error('Service IA développeur temporairement indisponible.');
        setMessages(prev => prev.filter(m => m.id !== tempId));
      }
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if ((!inputMessage.trim() && !selectedImage && !selectedDocument) || loading || streaming) return;
    if (conversationBlocked) {
      toast.error('Cette conversation a atteint sa limite gratuite. Commencez une nouvelle conversation ou consultez les offres.');
      return;
    }

    const userMessage = inputMessage.trim();
    const requestId = createChatRequestId();
    setInputMessage('');

    // Optimistically add user message
    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage || (selectedImage ? '[Image envoyée]' : selectedDocument ? `[Document envoyé : ${selectedDocument.name}]` : ''),
      has_image: !!selectedImage,
      document_name: selectedDocument?.name,
      image_preview: imagePreview,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    // Clear image after adding to message
    const imageToSend = selectedImage;
    const documentToSend = selectedDocument;
    setSelectedImage(null);
    setImagePreview(null);
    setSelectedDocument(null);

    const localDateAnswer = (!imageToSend && !documentToSend && !devMode && !webSearch)
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
        lang: languageName,
        web_search: false
      }, { headers: getAuthHeader(), timeout: 15000 }).then((response) => {
        if (!currentConversation && response.data?.conversation_id) {
          setCurrentConversation(response.data.conversation_id);
          navigate(`/chat/${response.data.conversation_id}`, { replace: true });
          fetchConversations();
        }
      }).catch(() => {});
      inputRef.current?.focus();
      return;
    }

    // Developer (Code) mode -> dedicated assistant endpoint (supports image + web).
    if (devMode) {
      await sendDevMessage(userMessage, tempUserMsg.id, imageToSend, documentToSend);
      return;
    }

    // Web search uses the SSE streaming endpoint (text only).
    if (webSearch && !imageToSend && !documentToSend && !activeCaptureId) {
      await sendMessageStream(userMessage, tempUserMsg.id, requestId);
      return;
    }

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
        lang: languageName,
        web_search: webSearch
      }, {
        headers: getAuthHeader(),
        timeout: 120000 // 2 minute timeout for image/document analysis
      });

      // Update with real response
      const aiMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: response.data.message,
        sources: response.data.sources || [],
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMessage]);
      if (response.data.quota) setConversationQuota(response.data.quota);
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
      const detail = error.response?.data?.detail;
      const errorMsg = typeof detail === 'object'
        ? detail.message || 'Limite gratuite atteinte'
        : detail || 'Erreur lors de l\'envoi du message';
      if (detail && typeof detail === 'object') {
        if (detail.quota) setConversationQuota(detail.quota);
        if (detail.image_quota) setChatImageQuota(detail.image_quota);
        if (detail.capture_quota) setCaptureQuota(detail.capture_quota);
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
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
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

    if (isImage && imageUploadBlocked) {
      const reset = formatQuotaReset(chatImageQuota?.reset_at);
      toast.error(`Limite de captures atteinte${reset ? `. Renouvellement : ${reset}` : ''}.`);
      e.target.value = '';
      return;
    }

    // Check file size (max 5MB for images, 1MB for text/code documents)
    if (isImage && file.size > 5 * 1024 * 1024) {
      toast.error('L\'image ne doit pas dépasser 5 Mo');
      return;
    }

    if (!isImage && file.size > 1024 * 1024) {
      toast.error('Le document texte ne doit pas dépasser 1 Mo');
      return;
    }

    if (!isImage && !textLike) {
      toast.error('Format non pris en charge. Utilise une image ou un fichier texte/code.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (isImage) {
        const base64 = event.target.result;
        setImagePreview(base64);
        setSelectedDocument(null);
        // Remove the data:image/xxx;base64, prefix for the API
        const base64Data = base64.split(',')[1];
        setSelectedImage(base64Data);
      } else {
        setSelectedImage(null);
        setImagePreview(null);
        setSelectedDocument({
          name: file.name,
          type: file.type || 'text/plain',
          content: String(event.target.result || '').slice(0, 20000)
        });
      }
    };
    if (isImage) reader.readAsDataURL(file);
    else reader.readAsText(file);
  };

  const removeSelectedImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeSelectedDocument = () => {
    setSelectedDocument(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const startNewChat = () => {
    setCurrentConversation(null);
    setMessages([]);
    setConversationQuota(null);
    setActiveCaptureId(null);
    setCaptureQuota(null);
    setSelectedImage(null);
    setImagePreview(null);
    setSelectedDocument(null);
    navigate('/chat');
    setSidebarOpen(false);
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
                  <MessageSquare className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 truncate text-sm">{conv.title}</span>
                  <button
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-opacity"
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
                >
                  <item.icon className="w-4 h-4" />
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
                    {user.subscription === 'comme_toi' ? 'Comme Toi' : 
                     user.subscription === 'mongo' ? 'Mongo' : 
                     user.subscription === 'pro' ? 'Pro' : 
                     user.subscription === 'developer' ? 'Développeur' : user.subscription}
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
                    <div className={`
                      max-w-[85%] rounded-2xl p-4
                      ${msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : isQuotaNotice
                          ? 'border border-amber-500/40 bg-amber-500/10 rounded-bl-md'
                          : 'glass rounded-bl-md'
                      }
                    `}>
                      {msg.role === 'assistant' && (
                        <div className="flex items-center gap-2 mb-2 text-primary">
                          <Sparkles className="w-4 h-4" />
                          <span className="text-xs font-medium">NEURA AL-NOUR</span>
                        </div>
                      )}
                      {/* Show image preview if message has image */}
                      {msg.image_preview && (
                        <img
                          src={msg.image_preview}
                          alt="Uploaded"
                          className="max-w-[200px] rounded-lg mb-2"
                        />
                      )}
                      {msg.has_image && !msg.image_preview && (
                        <div className="flex items-center gap-2 mb-2 text-xs opacity-70">
                          <ImageIcon className="w-4 h-4" />
                          <span>Image envoyée</span>
                        </div>
                      )}
                      {msg.generated_image && (
                        <img
                          src={msg.generated_image}
                          alt="Generated"
                          className="max-w-[300px] rounded-lg mb-2"
                          data-testid="generated-image"
                        />
                      )}
                      {msg.role === 'assistant' || isQuotaNotice ? (
                        <div className="markdown-content text-sm leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {isQuotaNotice ? quotaNoticeContent(msg) : msg.content}
                          </ReactMarkdown>
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
                      {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && renderSources(msg.sources)}
                    </div>
                  </div>
                );
              })
            )}
            {streaming && (
              <div className="flex justify-start">
                <div className="glass rounded-2xl rounded-bl-md p-4 max-w-[85%]">
                  <div className="flex items-center gap-2 mb-2 text-primary">
                    <Sparkles className="w-4 h-4" />
                    <span className="text-xs font-medium">NEURA AL-NOUR</span>
                  </div>
                  {streamPhase && !streamContent && (
                    <div className="flex items-center gap-2 text-primary text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span data-testid="search-status">{getStatusLabel(language, selectedModel, streamPhase)}</span>
                    </div>
                  )}
                  {streamContent && (
                    <div className="markdown-content text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamContent}</ReactMarkdown>
                    </div>
                  )}
                  {streamSources.length > 0 && renderSources(streamSources)}
                </div>
              </div>
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="glass rounded-2xl rounded-bl-md p-4">
                  <div className="flex items-center gap-2 text-primary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">{t('chat.thinking')}</span>
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
          <form onSubmit={sendMessage} className="max-w-3xl mx-auto">
            {/* Image Preview */}
            {imagePreview && (
              <div className="mb-3 relative inline-block">
                <img 
                  src={imagePreview} 
                  alt="Preview" 
                  className="h-20 w-20 object-cover rounded-lg border border-border"
                />
                <button
                  type="button"
                  onClick={removeSelectedImage}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90"
                  data-testid="remove-image-btn"
                >
                  <X className="w-4 h-4" />
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
                onChange={(e) => { setSelectedModel(e.target.value); localStorage.setItem('neura_model', e.target.value); }}
                className="text-xs rounded-full bg-muted px-3 py-1 border-0 outline-none cursor-pointer"
                data-testid="model-selector"
              >
                {MODELS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => { const v = !webSearch; setWebSearch(v); localStorage.setItem('neura_websearch', v ? '1' : '0'); }}
                className={`text-xs rounded-full px-3 py-1 flex items-center gap-1 transition-colors ${webSearch ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                data-testid="web-search-toggle"
                title={t('chat.web')}
              >
                <Globe className="w-3 h-3" />
                {t('chat.web')}
              </button>
              <button
                type="button"
                onClick={() => { const v = !devMode; setDevMode(v); localStorage.setItem('neura_devmode', v ? '1' : '0'); if (v) { axios.get(`${API}/developer/status`, { headers: getAuthHeader() }).then(r => setDevStatus(r.data)).catch(() => {}); } }}
                className={`text-xs rounded-full px-3 py-1 flex items-center gap-1 transition-colors ${devMode ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                data-testid="dev-mode-toggle"
                title="Mode Développeur (génération de code)"
              >
                <Code2 className="w-3 h-3" />
                {t('chat.code')}
              </button>
            </div>

            {devMode && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs" data-testid="dev-panel">
                {devStatus && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-3 py-1 font-medium">
                    <Code2 className="w-3 h-3" />
                    {devStatus.label}{devStatus.is_founder ? ' · Fondateur' : ''} ·{' '}
                    {devStatus.unlimited ? 'illimité' : `${devStatus.remaining ?? '—'}/${devStatus.limit} crédits`}
                  </span>
                )}
                {devStatus && (devStatus.tier === 'plus' || devStatus.tier === 'ultra') && (
                  <select
                    value={devRole}
                    onChange={(e) => setDevRole(e.target.value)}
                    className="rounded-full bg-muted px-3 py-1 border-0 outline-none cursor-pointer"
                    title="Rôle expert (Neura+/Ultra)"
                    data-testid="dev-role-selector"
                  >
                    <option value="">Rôle…</option>
                    <option value="frontend">Frontend senior</option>
                    <option value="backend">Backend senior</option>
                    <option value="fullstack">Fullstack senior</option>
                    <option value="architect">Architecte</option>
                    <option value="security">Sécurité</option>
                    <option value="database">Base de données</option>
                    <option value="mobile">Mobile senior</option>
                  </select>
                )}
                <button type="button" onClick={() => setWsOpen(true)}
                  className="rounded-full bg-primary/10 text-primary px-3 py-1 hover:bg-primary/20 transition-colors inline-flex items-center gap-1"
                  data-testid="dev-workspace-btn">
                  <Code2 className="w-3 h-3" /> Projet
                </button>
                {[
                  { label: 'Page React', text: 'Crée une page React ' },
                  { label: 'Corriger un bug', text: 'Corrige ce bug : ' },
                  { label: 'API Express', text: 'Crée une API Express pour ' },
                  { label: 'Auditer du code', text: 'Audite ce code (forces, faiblesses, risques, note /10) :\n' },
                  { label: 'Script FiveM', text: 'Crée un script FiveM ESX pour ' },
                ].map((t, i) => (
                  <button key={i} type="button" onClick={() => { setInputMessage(t.text); inputRef.current?.focus(); }}
                    className="rounded-full bg-muted px-3 py-1 text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`dev-template-${i}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <DevWorkspace open={wsOpen} onClose={() => setWsOpen(false)} lastAiCode={extractAiCode(messages)} />

            <div className="relative flex items-center gap-2">
              {/* Hidden file input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageSelect}
                accept="image/*,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.php,.sql,.yml,.yaml,.toml,.ini,.log"
                className="hidden"
                data-testid="image-input"
              />
              
              {/* Image upload button */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-12 w-12 rounded-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || generatingImage || conversationBlocked}
                title={imageUploadBlocked && formatQuotaReset(chatImageQuota?.reset_at)
                  ? `Captures renouvelées le ${formatQuotaReset(chatImageQuota.reset_at)}. Les documents texte restent disponibles.`
                  : 'Ajouter une image ou un document'}
                data-testid="add-image-btn"
              >
                <ImageIcon className="w-5 h-5" />
              </Button>

              {/* Image generation button */}
              <div className="relative">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-12 w-12 rounded-full"
                  onClick={generateImage}
                  disabled={loading || generatingImage || !inputMessage.trim()}
                  title={imageGenRemaining && !imageGenRemaining.unlimited 
                    ? `Générer une image (${imageGenRemaining.remaining}/3 restantes)` 
                    : 'Générer une image'}
                  data-testid="generate-image-btn"
                >
                  {generatingImage 
                    ? <Loader2 className="w-5 h-5 animate-spin" /> 
                    : <Wand2 className="w-5 h-5" />
                  }
                </Button>
                {imageGenRemaining && !imageGenRemaining.unlimited && (
                  <span 
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium"
                    data-testid="image-gen-counter"
                  >
                    {imageGenRemaining.remaining}
                  </span>
                )}
              </div>
              
              <div className="flex-1 relative">
                <Input
                  ref={inputRef}
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder={conversationBlocked
                    ? 'Limite atteinte pour cette conversation'
                    : selectedImage || selectedDocument
                      ? "Ajoutez un message (optionnel)..."
                      : t('chat.placeholder')}
                  className="pr-4 h-12 rounded-full bg-muted border-0"
                  disabled={loading || conversationBlocked}
                  data-testid="chat-input"
                />
              </div>
              <Button 
                type="submit" 
                size="icon" 
                className="h-12 w-12 rounded-full"
                disabled={loading || generatingImage || conversationBlocked || (!inputMessage.trim() && !selectedImage && !selectedDocument)}
                data-testid="send-message-btn"
              >
                <Send className="w-5 h-5" />
              </Button>
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
