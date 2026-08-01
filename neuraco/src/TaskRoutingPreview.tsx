import {
  Bot,
  Coins,
  GitBranch,
  Layers3,
  Play,
  ShieldCheck,
  Wrench,
  X
} from 'lucide-react';
import type {
  NeuraCoAgentDefinition,
  NeuraCoCommunicationStyle,
  NeuraCoEffortLevel,
  NeuraCoExecutionMode,
  NeuraCoTaskMode,
  NeuraCoTaskRoutingPreview as RoutingPreview
} from '../electron/ipc-contract';

type RequestedMode = Exclude<NeuraCoTaskMode, 'mixed'>;

interface TaskRoutingPreviewProps {
  preview: RoutingPreview;
  requestedMode: RequestedMode;
  agents: NeuraCoAgentDefinition[];
  selectedAgentIds: string[];
  executionMode: NeuraCoExecutionMode;
  busy: boolean;
  onModeChange: (mode: RequestedMode) => void;
  onEffortChange: (effort: NeuraCoEffortLevel) => void;
  onCommunicationStyleChange: (style: NeuraCoCommunicationStyle) => void;
  onToggleAgent: (agentId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const MODE_OPTIONS: Array<{ value: RequestedMode; label: string }> = [
  { value: 'automatic', label: 'Automatique' },
  { value: 'question', label: 'Question' },
  { value: 'plan', label: 'Plan uniquement' },
  { value: 'code', label: 'Code' },
  { value: 'cowork', label: 'Cowork' },
  { value: 'research', label: 'Recherche' },
  { value: '3d', label: '3D' },
  { value: 'fivem', label: 'FiveM' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'audit', label: 'Audit' }
];

export default function TaskRoutingPreview({
  preview,
  requestedMode,
  agents,
  selectedAgentIds,
  executionMode,
  busy,
  onModeChange,
  onEffortChange,
  onCommunicationStyleChange,
  onToggleAgent,
  onConfirm,
  onCancel
}: TaskRoutingPreviewProps) {
  const requiresTeam = preview.execution === 'multi_agent';
  const localRequired = requiresTeam && executionMode !== 'local';
  return (
    <section className="task-routing-preview" aria-label="Validation du routage">
      <header>
        <div>
          <span className="routing-icon"><GitBranch size={17} /></span>
          <span>
            <strong>Routage à valider</strong>
            <small>{preview.reason}</small>
          </span>
        </div>
        <button type="button" title="Annuler le routage" onClick={onCancel}>
          <X size={15} />
        </button>
      </header>

      <div className="task-routing-summary">
        <label>
          <span>Mode</span>
          <select
            value={requestedMode}
            onChange={(event) => onModeChange(event.target.value as RequestedMode)}
            disabled={busy}
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div>
          <span><Layers3 size={13} /> Sélection</span>
          <strong>{preview.modeLabel}</strong>
        </div>
        <div>
          <span><Bot size={13} /> Exécution</span>
          <strong>{requiresTeam ? 'Équipe spécialisée' : 'Conversation'}</strong>
        </div>
        <div>
          <span><Coins size={13} /> Estimation</span>
          <strong>
            {preview.estimatedMinimumCredits} à {preview.estimatedMaximumCredits} crédits
          </strong>
          <small>
            {preview.estimateSource === 'server' ? 'Calcul serveur' : 'Estimation locale'}
          </small>
        </div>
      </div>

      <div className="routing-preferences">
        <label>
          <span>Niveau d’effort</span>
          <select
            value={preview.effort}
            onChange={(event) => onEffortChange(
              event.target.value as NeuraCoEffortLevel
            )}
            disabled={busy}
          >
            <option value="rapid">Rapide</option>
            <option value="normal">Normal</option>
            <option value="deep">Approfondi</option>
            <option value="maximum">Maximum</option>
          </select>
        </label>
        <label>
          <span>Style de communication</span>
          <select
            value={preview.communicationStyle}
            onChange={(event) => onCommunicationStyleChange(
              event.target.value as NeuraCoCommunicationStyle
            )}
            disabled={busy}
          >
            <option value="direct">Direct et court</option>
            <option value="normal">Normal</option>
            <option value="detailed">Détaillé</option>
            <option value="pedagogical">Pédagogique</option>
          </select>
        </label>
        <div>
          <span>Effet avant démarrage</span>
          <p>{preview.effortEffects.join(' · ')}</p>
        </div>
      </div>

      {preview.categories.length > 0 && (
        <div className="routing-categories">
          {preview.categories.map((category) => (
            <span key={category.id}>
              {category.label}
              <small>{category.confidence}%</small>
            </span>
          ))}
        </div>
      )}

      <div className="task-routing-columns">
        <section>
          <h3><Bot size={14} /> Agents proposés</h3>
          {requiresTeam ? (
            <div className="routing-agent-list">
              {agents.map((agent) => (
                <label
                  key={agent.id}
                  className={selectedAgentIds.includes(agent.id) ? 'is-selected' : ''}
                >
                  <input
                    type="checkbox"
                    checked={selectedAgentIds.includes(agent.id)}
                    onChange={() => onToggleAgent(agent.id)}
                    disabled={busy}
                  />
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="routing-direct-note">
              Le message reste dans le fil courant et utilise le routeur de modèles existant.
            </p>
          )}
        </section>

        <section>
          <h3><Wrench size={14} /> Outils nécessaires</h3>
          <div className="routing-tools">
            {preview.tools.map((tool) => <span key={tool}>{tool}</span>)}
          </div>
          <dl>
            <div><dt>Modèle principal</dt><dd>{preview.primaryModel}</dd></div>
            <div><dt>Complexité</dt><dd>{preview.complexity}</dd></div>
            <div><dt>Effort</dt><dd>{preview.effortLabel}</dd></div>
            <div><dt>Style</dt><dd>{preview.communicationStyleLabel}</dd></div>
            <div><dt>Vérifications</dt><dd>{preview.verificationPasses}</dd></div>
            <div><dt>Budget proposé</dt><dd>{preview.suggestedBudget}</dd></div>
          </dl>
        </section>
      </div>

      {localRequired && (
        <p className="routing-warning">
          <ShieldCheck size={14} />
          L’équipe spécialisée agit uniquement en mode Local afin de respecter les
          autorisations du projet. Sélectionnez Local avant de lancer.
        </p>
      )}

      <footer>
        <button type="button" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={onConfirm}
          disabled={
            busy
            || localRequired
            || (requiresTeam && selectedAgentIds.length === 0)
          }
        >
          <Play size={14} />
          {busy ? 'Préparation…' : 'Valider et démarrer'}
        </button>
      </footer>
    </section>
  );
}
