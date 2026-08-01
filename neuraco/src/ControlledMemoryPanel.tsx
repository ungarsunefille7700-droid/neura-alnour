import { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Check,
  Download,
  Power,
  Save,
  Trash2,
  X
} from 'lucide-react';
import type {
  NeuraCoControlledMemory,
  NeuraCoControlledMemoryCategory,
  NeuraCoControlledMemoryScope,
  NeuraCoControlledMemoryState
} from '../electron/ipc-contract';

interface MemoryDraft {
  content: string;
  scope: NeuraCoControlledMemoryScope;
  category: NeuraCoControlledMemoryCategory;
}

interface ControlledMemoryPanelProps {
  state?: NeuraCoControlledMemoryState;
  busy: boolean;
  onStateChange: (state: NeuraCoControlledMemoryState) => void;
  onBusyChange: (busy: boolean) => void;
  onStatus: (message: string) => void;
}

const CATEGORY_LABELS: Record<NeuraCoControlledMemoryCategory, string> = {
  language: 'Langue préférée',
  technology: 'Technologie favorite',
  validation: 'Habitude de validation',
  architecture: 'Architecture',
  important_folder: 'Dossier important',
  decision: 'Décision du projet',
  known_error: 'Erreur déjà rencontrée',
  framework: 'Framework',
  naming: 'Convention de nommage',
  test_command: 'Commande de test',
  project_structure: 'Structure du projet',
  interface_style: 'Style d’interface',
  report_style: 'Style des rapports',
  instruction: 'Instruction durable',
  other: 'Autre préférence'
};

const draftOf = (memory: NeuraCoControlledMemory): MemoryDraft => ({
  content: memory.content,
  scope: memory.scope,
  category: memory.category
});

export default function ControlledMemoryPanel({
  state,
  busy,
  onStateChange,
  onBusyChange,
  onStatus
}: ControlledMemoryPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, MemoryDraft>>({});

  useEffect(() => {
    if (!state) return;
    setDrafts(Object.fromEntries(
      state.entries.map((memory) => [memory.id, draftOf(memory)])
    ));
  }, [state]);

  const pending = useMemo(
    () => state?.entries.filter((entry) => entry.status === 'pending') || [],
    [state]
  );
  const saved = useMemo(
    () => state?.entries.filter((entry) => entry.status !== 'pending') || [],
    [state]
  );

  const mutate = async (
    operation: () => Promise<NeuraCoControlledMemoryState>,
    message: string
  ) => {
    onBusyChange(true);
    try {
      onStateChange(await operation());
      onStatus(message);
    } catch (error) {
      onStatus(
        error instanceof Error
          ? error.message
          : 'La mémoire contrôlée n’a pas pu être mise à jour.'
      );
    } finally {
      onBusyChange(false);
    }
  };

  const update = (
    memory: NeuraCoControlledMemory,
    status?: 'active' | 'disabled'
  ) => {
    const draft = drafts[memory.id] || draftOf(memory);
    void mutate(
      () => window.neuraco!.updateControlledMemory(memory.id, {
        ...draft,
        status
      }),
      status === 'active' && memory.status === 'pending'
        ? 'Mémoire approuvée. Elle sera utilisée uniquement lorsqu’elle est pertinente.'
        : status === 'disabled'
          ? 'Mémoire désactivée.'
          : status === 'active'
            ? 'Mémoire réactivée.'
            : 'Mémoire corrigée.'
    );
  };

  const remove = (memoryId: string) => {
    void mutate(
      () => window.neuraco!.deleteControlledMemory(memoryId),
      'Mémoire supprimée définitivement.'
    );
  };

  if (!state) {
    return (
      <div className="controlled-memory-view">
        <div className="memory-loading">Chargement des mémoires contrôlées…</div>
      </div>
    );
  }

  return (
    <div className="controlled-memory-view">
      <header className="memory-toolbar">
        <div>
          <BrainCircuit size={18} />
          <div>
            <strong>Mémoire contrôlée</strong>
            <span>
              {state.activeCount} active(s) · {state.pendingCount} à examiner
            </span>
          </div>
        </div>
        <label className="memory-master-toggle">
          <input
            type="checkbox"
            checked={state.enabled}
            disabled={busy}
            onChange={(event) => void mutate(
              () => window.neuraco!.setControlledMemoryEnabled(
                event.target.checked
              ),
              event.target.checked
                ? 'Mémoire contrôlée activée.'
                : 'Mémoire contrôlée désactivée. Aucune préférence ne sera injectée.'
            )}
          />
          <Power size={14} />
          {state.enabled ? 'Activée' : 'Désactivée'}
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            onBusyChange(true);
            void window.neuraco?.exportControlledMemories()
              .then((filePath) => {
                if (filePath) onStatus(`Mémoires exportées : ${filePath}`);
              })
              .catch((error) => onStatus(
                error instanceof Error ? error.message : 'Export impossible.'
              ))
              .finally(() => onBusyChange(false));
          }}
        >
          <Download size={14} />
          Exporter
        </button>
      </header>

      <div className="memory-safety-note">
        {state.enabled
          ? 'Les suggestions restent inactives jusqu’à votre validation.'
          : 'Enregistrement désactivé : aucune nouvelle préférence ne sera mémorisée.'}
        {' '}Les mots de passe, clés, données bancaires, médicales et d’identité
        sont refusés avant l’enregistrement.
      </div>

      <section className="memory-section memory-context-levels">
        <header>
          <h2>Mémoire de session</h2>
          <span>Contexte temporaire du fil actif, séparé des préférences durables.</span>
        </header>
        <div className="memory-context-summary">
          {state.sessionMemory ? (
            <>
              <strong>{state.sessionMemory.title}</strong>
              <span>{state.sessionMemory.messageCount} message(s) conservé(s)</span>
              <small>Mis à jour le {new Date(state.sessionMemory.updatedAt).toLocaleString('fr-FR')}</small>
            </>
          ) : (
            <span>Aucune session active mémorisée pour ce projet.</span>
          )}
        </div>
      </section>

      <section className="memory-section memory-context-levels">
        <header>
          <h2>Instructions du projet</h2>
          <span>Fichier facultatif NEURACO.md à la racine du projet.</span>
        </header>
        <div className="memory-context-summary">
          {state.projectInstructions?.found ? (
            <>
              <strong>NEURACO.md détecté</strong>
              <span title={state.projectInstructions.path}>
                {state.projectInstructions.path}
              </span>
              {state.projectInstructions.contentPreview && (
                <pre>{state.projectInstructions.contentPreview}</pre>
              )}
              {state.projectInstructions.warnings.map((warning) => (
                <small key={warning} className="is-warning">{warning}</small>
              ))}
            </>
          ) : (
            <>
              <strong>NEURACO.md n’existe pas encore</strong>
              <span>
                Créez-le dans l’éditeur si le projet doit définir ses règles,
                son architecture, ses commandes ou son processus de validation.
              </span>
              {state.projectInstructions?.warnings.map((warning) => (
                <small key={warning} className="is-warning">{warning}</small>
              ))}
            </>
          )}
        </div>
      </section>

      {pending.length > 0 && (
        <section className="memory-section is-pending">
          <header>
            <h2>À examiner</h2>
            <span>Corrigez la formulation avant de l’approuver.</span>
          </header>
          <div className="memory-list">
            {pending.map((memory) => {
              const draft = drafts[memory.id] || draftOf(memory);
              return (
                <article key={memory.id} className="memory-entry is-pending">
                  <div className="memory-entry-meta">
                    <span>Suggestion non active</span>
                    <small>Observée {memory.observationCount} fois</small>
                  </div>
                  <textarea
                    aria-label="Contenu de la mémoire suggérée"
                    value={draft.content}
                    disabled={busy}
                    onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [memory.id]: { ...draft, content: event.target.value }
                    }))}
                  />
                  <div className="memory-entry-controls">
                    <select
                      aria-label="Portée de la mémoire"
                      value={draft.scope}
                      disabled={busy}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [memory.id]: {
                          ...draft,
                          scope: event.target.value as NeuraCoControlledMemoryScope
                        }
                      }))}
                    >
                      <option value="project">Mémoire du projet</option>
                      <option value="global">Mémoire utilisateur</option>
                    </select>
                    <select
                      aria-label="Catégorie de la mémoire"
                      value={draft.category}
                      disabled={busy}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [memory.id]: {
                          ...draft,
                          category: event.target.value as NeuraCoControlledMemoryCategory
                        }
                      }))}
                    >
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="is-primary"
                      disabled={busy || draft.content.trim().length < 4}
                      onClick={() => update(memory, 'active')}
                    >
                      <Check size={14} />
                      Approuver
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(memory.id)}
                    >
                      <X size={14} />
                      Refuser
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="memory-section">
        <header>
          <h2>Mémoires approuvées</h2>
          <span>Une mémoire désactivée reste visible mais n’est jamais utilisée.</span>
        </header>
        {saved.length === 0 ? (
          <div className="memory-empty">
            Aucune mémoire approuvée pour ce projet.
          </div>
        ) : (
          <div className="memory-list">
            {saved.map((memory) => {
              const draft = drafts[memory.id] || draftOf(memory);
              return (
                <article
                  key={memory.id}
                  className={`memory-entry ${memory.status === 'disabled' ? 'is-disabled' : ''}`}
                >
                  <div className="memory-entry-meta">
                    <span>
                      {CATEGORY_LABELS[memory.category]} ·{' '}
                      {memory.scope === 'global' ? 'Mémoire utilisateur' : 'Mémoire du projet'}
                    </span>
                    <small>
                      {memory.status === 'disabled' ? 'Désactivée' : 'Active'}
                    </small>
                  </div>
                  <textarea
                    aria-label="Contenu de la mémoire"
                    value={draft.content}
                    disabled={busy}
                    onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [memory.id]: { ...draft, content: event.target.value }
                    }))}
                  />
                  <div className="memory-entry-controls">
                    <select
                      aria-label="Portée de la mémoire"
                      value={draft.scope}
                      disabled={busy}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [memory.id]: {
                          ...draft,
                          scope: event.target.value as NeuraCoControlledMemoryScope
                        }
                      }))}
                    >
                      <option value="project">Mémoire du projet</option>
                      <option value="global">Mémoire utilisateur</option>
                    </select>
                    <select
                      aria-label="Catégorie de la mémoire"
                      value={draft.category}
                      disabled={busy}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [memory.id]: {
                          ...draft,
                          category: event.target.value as NeuraCoControlledMemoryCategory
                        }
                      }))}
                    >
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || draft.content.trim().length < 4}
                      onClick={() => update(memory)}
                    >
                      <Save size={14} />
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => update(
                        memory,
                        memory.status === 'active' ? 'disabled' : 'active'
                      )}
                    >
                      <Power size={14} />
                      {memory.status === 'active' ? 'Désactiver' : 'Réactiver'}
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      disabled={busy}
                      onClick={() => remove(memory.id)}
                    >
                      <Trash2 size={14} />
                      Supprimer
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
