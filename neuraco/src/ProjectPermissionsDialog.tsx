import { useEffect, useState } from 'react';
import {
  Check,
  Eye,
  FileCheck2,
  LockKeyhole,
  MousePointerClick,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X
} from 'lucide-react';
import type {
  NeuraCoNetworkAccessMode,
  NeuraCoPermissionAction,
  NeuraCoPermissionMode,
  NeuraCoProjectPermissions,
  NeuraCoProjectPermissionsUpdate
} from '../electron/ipc-contract';

interface ProjectPermissionsDialogProps {
  permissions: NeuraCoProjectPermissions;
  busy: boolean;
  onClose: () => void;
  onSave: (request: NeuraCoProjectPermissionsUpdate) => Promise<void>;
}

const splitRules = (value: string): string[] => (
  Array.from(new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  ))
);

const MODE_DETAILS: Array<{
  mode: NeuraCoPermissionMode;
  title: string;
  description: string;
}> = [
  {
    mode: 'plan',
    title: 'Plan / lecture seule',
    description: 'Lire, rechercher, analyser et préparer un plan sans rien modifier.'
  },
  {
    mode: 'manual',
    title: 'Manuel',
    description: 'Demander avant chaque modification, commande, application ou nouveau domaine.'
  },
  {
    mode: 'accept_edits',
    title: 'Accepter les modifications',
    description: 'Autoriser les fichiers du projet, mais demander pour les outils externes.'
  },
  {
    mode: 'safe_auto',
    title: 'Automatique sécurisé',
    description: 'Exécuter les actions sûres dans le périmètre explicitement autorisé.'
  },
  {
    mode: 'deny_unapproved',
    title: 'Ne pas demander',
    description: 'Refuser sans interruption ce qui sort des règles et poursuivre autrement.'
  },
  {
    mode: 'full',
    title: 'Accès complet',
    description: 'Automatisation large, avec confirmations sensibles toujours actives.'
  }
];

const ACTIONS: Array<{ value: NeuraCoPermissionAction; label: string }> = [
  { value: 'read_file', label: 'Lire les fichiers autorisés' },
  { value: 'write_file', label: 'Créer et modifier des fichiers' },
  { value: 'terminal', label: 'Exécuter les commandes autorisées' },
  { value: 'network', label: 'Accéder aux domaines autorisés' },
  { value: 'application', label: 'Utiliser les logiciels autorisés' }
];

const modeIcon = (mode: NeuraCoPermissionMode) => {
  switch (mode) {
    case 'plan':
      return <Eye size={18} />;
    case 'manual':
      return <MousePointerClick size={18} />;
    case 'accept_edits':
      return <FileCheck2 size={18} />;
    case 'safe_auto':
      return <Shield size={18} />;
    case 'deny_unapproved':
      return <LockKeyhole size={18} />;
    default:
      return <ShieldAlert size={18} />;
  }
};

export default function ProjectPermissionsDialog({
  permissions,
  busy,
  onClose,
  onSave
}: ProjectPermissionsDialogProps) {
  const [mode, setMode] = useState<NeuraCoPermissionMode>(permissions.mode);
  const [allowedActions, setAllowedActions] = useState<NeuraCoPermissionAction[]>(
    permissions.allowedActions
  );
  const [readOnlyFolders, setReadOnlyFolders] = useState(
    (permissions.readOnlyFolders || permissions.allowedFolders).join('\n')
  );
  const [writableFolders, setWritableFolders] = useState(
    (permissions.writableFolders?.length
      ? permissions.writableFolders
      : permissions.allowedFolders
    ).join('\n')
  );
  const [forbiddenPaths, setForbiddenPaths] = useState(
    (permissions.forbiddenPaths || []).join('\n')
  );
  const [commands, setCommands] = useState(
    permissions.allowedCommandPrefixes.join('\n')
  );
  const [domains, setDomains] = useState(permissions.allowedDomains.join('\n'));
  const [networkMode, setNetworkMode] = useState<NeuraCoNetworkAccessMode>(
    permissions.networkAccessMode
      || (permissions.allowedDomains.length > 0 ? 'approved_domains' : 'ask_each')
  );
  const [temporaryNetworkMinutes, setTemporaryNetworkMinutes] = useState(30);
  const [applications, setApplications] = useState(
    permissions.allowedApplications.join('\n')
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [phrase, setPhrase] = useState('');

  useEffect(() => {
    setMode(permissions.mode);
    setAllowedActions(permissions.allowedActions);
    setReadOnlyFolders(
      (permissions.readOnlyFolders || permissions.allowedFolders).join('\n')
    );
    setWritableFolders(
      (permissions.writableFolders?.length
        ? permissions.writableFolders
        : permissions.allowedFolders
      ).join('\n')
    );
    setForbiddenPaths((permissions.forbiddenPaths || []).join('\n'));
    setCommands(permissions.allowedCommandPrefixes.join('\n'));
    setDomains(permissions.allowedDomains.join('\n'));
    setNetworkMode(
      permissions.networkAccessMode
        || (permissions.allowedDomains.length > 0 ? 'approved_domains' : 'ask_each')
    );
    setTemporaryNetworkMinutes(30);
    setApplications(permissions.allowedApplications.join('\n'));
    setAcknowledged(false);
    setPhrase('');
  }, [permissions]);

  const request = (): NeuraCoProjectPermissionsUpdate => {
    const readable = splitRules(readOnlyFolders);
    const writable = mode === 'plan' ? [] : splitRules(writableFolders);
    return {
      mode,
      allowedActions:
        mode === 'safe_auto' || mode === 'deny_unapproved'
          ? allowedActions
          : mode === 'plan'
            ? ['read_file']
            : mode === 'accept_edits'
              ? ['read_file', 'write_file']
              : [],
      allowedFolders: Array.from(new Set([...readable, ...writable])),
      readOnlyFolders: readable,
      writableFolders: writable,
      forbiddenPaths: splitRules(forbiddenPaths),
      networkAccessMode: mode === 'plan' ? 'none' : networkMode,
      temporaryFullNetworkUntil:
        mode !== 'plan' && networkMode === 'temporary_full'
          ? new Date(Date.now() + temporaryNetworkMinutes * 60_000).toISOString()
          : undefined,
      allowedCommandPrefixes:
        mode === 'safe_auto' || mode === 'deny_unapproved'
          ? splitRules(commands)
          : [],
      allowedDomains: splitRules(domains),
      allowedApplications:
        mode === 'safe_auto' || mode === 'deny_unapproved'
          ? splitRules(applications)
          : [],
      alwaysAllowedSignatures: mode === permissions.mode
        ? permissions.alwaysAllowedSignatures
        : [],
      fullAccessAcknowledged: mode === 'full' ? acknowledged : undefined,
      fullAccessPhrase: mode === 'full' ? phrase : undefined
    };
  };

  const fullAccessReady = (
    mode !== 'full'
    || (acknowledged && phrase === 'J’ACCEPTE LES RISQUES')
  );

  return (
    <div className="permission-overlay" role="presentation">
      <section
        className={`permission-dialog ${mode === 'full' ? 'is-full-access' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-title"
      >
        <header>
          <div>
            <span className="permission-icon"><ShieldCheck size={20} /></span>
            <div>
              <h2 id="permission-title">Autorisations du projet</h2>
              <p>{permissions.projectRoot}</p>
            </div>
          </div>
          {permissions.configured && (
            <button type="button" title="Fermer" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </header>

        {!permissions.configured && (
          <div className="permission-first-use">
            Choisissez le fonctionnement de NeuraCo pour ce projet. Vous pourrez le modifier ensuite.
          </div>
        )}

        <div className="permission-modes">
          {MODE_DETAILS.map((item) => (
            <button
              key={item.mode}
              type="button"
              className={mode === item.mode ? 'is-active' : ''}
              onClick={() => setMode(item.mode)}
            >
              {modeIcon(item.mode)}
              <strong>{item.title}</strong>
              <span>{item.description}</span>
              {mode === item.mode && <Check size={16} />}
            </button>
          ))}
        </div>

        {mode === 'plan' && (
          <div className="permission-explanation">
            NeuraCo peut lire et analyser les fichiers du projet, effectuer des recherches
            et produire un plan. Les écritures, commandes, accès réseau et contrôles
            d’application sont refusés automatiquement.
          </div>
        )}

        {mode === 'manual' && (
          <div className="permission-explanation">
            Avant une action, NeuraCo affiche l’action, le logiciel, le fichier ou la
            commande, le risque, la raison et le coût estimé. Vous choisissez une fois,
            pour la session ou toujours pour cette action.
          </div>
        )}

        {mode === 'accept_edits' && (
          <div className="permission-explanation">
            Les créations et modifications de fichiers sont autorisées uniquement dans ce
            projet. Les commandes, Internet et applications demandent une confirmation à
            chaque fois. Les commandes de suppression restent sensibles.
          </div>
        )}

        {mode === 'safe_auto' && (
          <div className="permission-explanation">
            Les actions correspondant aux règles ci-dessous sont exécutées sans interruption.
            Une commande sensible demande toujours une confirmation explicite.
          </div>
        )}

        {mode === 'deny_unapproved' && (
          <div className="permission-explanation">
            NeuraCo n’affiche aucune demande pour une action hors périmètre : elle est
            refusée et journalisée. L’agent doit continuer avec une solution compatible
            avec les règles ci-dessous.
          </div>
        )}

        <div className="permission-scope permission-file-scope">
          <label>
            <span>Dossiers en lecture seule, un par ligne</span>
            <textarea
              value={readOnlyFolders}
              onChange={(event) => setReadOnlyFolders(event.target.value)}
            />
          </label>
          <label>
            <span>Dossiers modifiables, un par ligne</span>
            <textarea
              value={writableFolders}
              disabled={mode === 'plan'}
              onChange={(event) => setWritableFolders(event.target.value)}
            />
          </label>
          <label>
            <span>Chemins interdits, prioritaires sur toutes les autorisations</span>
            <textarea
              value={forbiddenPaths}
              onChange={(event) => setForbiddenPaths(event.target.value)}
              placeholder={'C:\\projet\\privé\nC:\\projet\\exports-sensibles'}
            />
          </label>
          <p>
            Les dossiers système, profils tiers, navigateurs personnels, clés SSH,
            coffres d’identifiants, portefeuilles et fichiers secrets restent bloqués.
          </p>
        </div>

        <div className="permission-scope permission-network-scope">
          <fieldset>
            <legend>Accès réseau</legend>
            {([
              ['none', 'Aucun accès'],
              ['approved_domains', 'Domaines approuvés uniquement'],
              ['ask_each', 'Demander pour chaque nouveau domaine'],
              ['temporary_full', 'Accès complet temporaire']
            ] as Array<[NeuraCoNetworkAccessMode, string]>).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="network-access-mode"
                  value={value}
                  disabled={mode === 'plan'}
                  checked={(mode === 'plan' ? 'none' : networkMode) === value}
                  onChange={() => setNetworkMode(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {networkMode === 'approved_domains' && mode !== 'plan' && (
            <label>
              <span>Domaines Internet autorisés</span>
              <textarea
                value={domains}
                onChange={(event) => setDomains(event.target.value)}
                placeholder={'docs.python.org\nnpmjs.com'}
              />
            </label>
          )}
          {networkMode === 'temporary_full' && mode !== 'plan' && (
            <label>
              <span>Durée maximale de l’accès temporaire</span>
              <select
                value={temporaryNetworkMinutes}
                onChange={(event) => setTemporaryNetworkMinutes(Number(event.target.value))}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </label>
          )}
          <p>
            Le domaine exact est affiché avant chaque autorisation. Un accès temporaire
            expire automatiquement et ne peut jamais dépasser une heure.
          </p>
        </div>

        {(mode === 'safe_auto' || mode === 'deny_unapproved') && (
          <div className="permission-scope">
            <fieldset>
              <legend>Actions autorisées</legend>
              {ACTIONS.map((action) => (
                <label key={action.value}>
                  <input
                    type="checkbox"
                    checked={allowedActions.includes(action.value)}
                    onChange={(event) => setAllowedActions((current) => (
                      event.target.checked
                        ? [...current, action.value]
                        : current.filter((value) => value !== action.value)
                    ))}
                  />
                  {action.label}
                </label>
              ))}
            </fieldset>
            <label>
              <span>Commandes autorisées par préfixe</span>
              <textarea
                value={commands}
                onChange={(event) => setCommands(event.target.value)}
                placeholder={'npm test\ngit status\npython -m pytest'}
              />
            </label>
            <label>
              <span>Logiciels autorisés</span>
              <textarea
                value={applications}
                onChange={(event) => setApplications(event.target.value)}
                placeholder={'Visual Studio Code\nBlender'}
              />
            </label>
          </div>
        )}

        {mode === 'full' && (
          <div className="full-access-warning">
            <h3>ATTENTION — ACCÈS COMPLET À VOTRE ORDINATEUR</h3>
            <p>
              Une intelligence artificielle peut se tromper. Elle peut modifier le mauvais
              fichier, écraser une modification, exécuter une mauvaise commande, fermer une
              application ou casser temporairement un projet.
            </p>
            <ul>
              <li>Sauvegardez vos fichiers importants et utilisez Git.</li>
              <li>Fermez les documents sensibles avant une tâche autonome.</li>
              <li>Les paiements, secrets, suppressions définitives et actions publiques restent protégés.</li>
              <li>Vous pourrez couper immédiatement cet accès depuis la barre du projet.</li>
            </ul>
            <label className="risk-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              J’ai lu et compris les risques
            </label>
            <label>
              <span>Saisissez exactement « J’ACCEPTE LES RISQUES »</span>
              <input value={phrase} onChange={(event) => setPhrase(event.target.value)} />
            </label>
          </div>
        )}

        <footer>
          {permissions.configured && (
            <button type="button" className="button button-secondary" onClick={onClose}>
              Annuler
            </button>
          )}
          <button
            type="button"
            className={`button ${mode === 'full' ? 'button-danger' : 'button-primary'}`}
            disabled={busy || !fullAccessReady}
            onClick={() => void onSave(request())}
          >
            {busy
              ? 'Enregistrement…'
              : mode === 'full'
                ? 'Activer l’accès complet'
                : 'Enregistrer ce mode'}
          </button>
        </footer>
      </section>
    </div>
  );
}
