import { useEffect, useState } from 'react';
import {
  Archive,
  ArrowUpRight,
  LoaderCircle,
  MessageSquareMore,
  Plus,
  Send,
  X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  NeuraCoCommunicationStyle,
  NeuraCoEffortLevel,
  NeuraCoSecondaryConversation
} from '../electron/ipc-contract';

interface SecondaryConversationPanelProps {
  projectId: string;
  projectName: string;
  parentThreadId: string;
  linkedTaskId?: string;
  effort: NeuraCoEffortLevel;
  communicationStyle: NeuraCoCommunicationStyle;
  onPromote: (content: string) => void;
  onClose: () => void;
}

export default function SecondaryConversationPanel({
  projectId,
  projectName,
  parentThreadId,
  linkedTaskId,
  effort,
  communicationStyle,
  onPromote,
  onClose
}: SecondaryConversationPanelProps) {
  const [conversations, setConversations] = useState<NeuraCoSecondaryConversation[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const active = conversations.find((conversation) => conversation.id === activeId);

  const refresh = async () => {
    if (!window.neuraco) return;
    const next = await window.neuraco.listSecondaryConversations(parentThreadId);
    setConversations(next);
    setActiveId((current) => (
      current && next.some((conversation) => conversation.id === current)
        ? current
        : next[0]?.id
    ));
  };

  useEffect(() => {
    void refresh().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Chargement impossible.');
    });
  }, [parentThreadId]);

  const createConversation = async () => {
    if (!window.neuraco || busy) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const created = await window.neuraco.createSecondaryConversation({
        parentThreadId,
        linkedTaskId,
        title: linkedTaskId
          ? 'Questions sur la tâche active'
          : 'Questions sur le fil principal'
      });
      setConversations((current) => [created, ...current]);
      setActiveId(created.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const content = input.trim();
    if (!window.neuraco || !active || !content || busy) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const updated = await window.neuraco.sendSecondaryConversationMessage({
        conversationId: active.id,
        content,
        projectId,
        projectName,
        model: 'auto',
        effort,
        communicationStyle
      });
      setConversations((current) => current.map((conversation) => (
        conversation.id === updated.id ? updated : conversation
      )));
      setInput('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Réponse secondaire impossible.');
    } finally {
      setBusy(false);
    }
  };

  const archiveConversation = async () => {
    if (!window.neuraco || !active || busy) return;
    setBusy(true);
    try {
      const next = await window.neuraco.archiveSecondaryConversation(active.id);
      setConversations(next);
      setActiveId(next[0]?.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Archivage impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="secondary-conversation-overlay" role="presentation">
      <section
        className="secondary-conversation-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="secondary-conversation-title"
      >
        <header>
          <div>
            <MessageSquareMore size={18} />
            <div>
              <strong id="secondary-conversation-title">Conversation secondaire</strong>
              <span>
                Analyse séparée · aucune modification automatique de la mission
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        <div className="secondary-conversation-body">
          <aside>
            <button type="button" onClick={() => void createConversation()} disabled={busy}>
              <Plus size={14} />
              Nouvelle conversation
            </button>
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={conversation.id === activeId ? 'is-active' : ''}
                onClick={() => setActiveId(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <span>{conversation.messages.length} message(s)</span>
              </button>
            ))}
          </aside>

          <main>
            {!active ? (
              <div className="secondary-conversation-empty">
                <MessageSquareMore size={28} />
                <strong>Posez une question sans modifier la mission principale</strong>
                <span>
                  Créez une conversation pour demander une explication ou examiner
                  une autre solution.
                </span>
                <button type="button" onClick={() => void createConversation()}>
                  <Plus size={14} />
                  Créer la conversation
                </button>
              </div>
            ) : (
              <>
                <div className="secondary-conversation-toolbar">
                  <span>
                    Liée au fil {active.parentThreadId.slice(0, 18)}
                    {active.linkedTaskId ? ' · tâche active liée' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => void archiveConversation()}
                    disabled={busy}
                  >
                    <Archive size={13} />
                    Archiver
                  </button>
                </div>
                <div className="secondary-conversation-messages">
                  {active.messages.map((message) => (
                    <article key={message.id} className={`is-${message.role}`}>
                      <header>
                        <strong>{message.role === 'user' ? 'Vous' : 'NeuraCo'}</strong>
                        {message.model && <span>{message.model}</span>}
                      </header>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                      {message.role === 'assistant' && (
                        <button
                          type="button"
                          onClick={() => onPromote(message.content)}
                        >
                          <ArrowUpRight size={13} />
                          Transformer en instruction officielle
                        </button>
                      )}
                    </article>
                  ))}
                  {busy && (
                    <div className="secondary-conversation-working">
                      <LoaderCircle size={15} />
                      Analyse secondaire en cours…
                    </div>
                  )}
                </div>
                <div className="secondary-conversation-composer">
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    disabled={busy}
                    placeholder="Demandez une explication ou examinez une solution…"
                  />
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={busy || !input.trim()}
                    aria-label="Envoyer la question secondaire"
                  >
                    <Send size={15} />
                  </button>
                </div>
              </>
            )}
          </main>
        </div>
        {status && <footer>{status}</footer>}
      </section>
    </div>
  );
}
