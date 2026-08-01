import {
  Archive,
  Bell,
  CheckCheck,
  ExternalLink,
  Pause,
  ShieldAlert,
  Square,
  X
} from 'lucide-react';
import type {
  NeuraCoNotification,
  NeuraCoNotificationAction,
  NeuraCoNotificationActionEvent
} from '../electron/ipc-contract';

interface NotificationPanelProps {
  notifications: NeuraCoNotification[];
  busy: boolean;
  onClose: () => void;
  onRead: (notificationId: string) => Promise<void>;
  onArchive: (notificationId: string) => Promise<void>;
  onAction: (
    notificationId: string,
    action: NeuraCoNotificationAction
  ) => Promise<NeuraCoNotificationActionEvent | undefined>;
}

const kindLabel: Record<NeuraCoNotification['kind'], string> = {
  permission_request: 'Autorisation',
  agent_blocked: 'Agent bloqué',
  task_completed: 'Tâche terminée',
  task_failed: 'Tâche échouée',
  credits_low: 'Crédits faibles',
  usage_limit_reached: 'Plafond atteint',
  merge_ready: 'Fusion prête',
  git_conflict: 'Conflit Git',
  test_failed: 'Test échoué',
  routine_result: 'Routine terminée',
  plugin_suspicious: 'Plugin suspect'
};

const actionLabel: Record<NeuraCoNotificationAction, string> = {
  open: 'Ouvrir',
  authorize: 'Examiner l’autorisation',
  refuse: 'Examiner le refus',
  pause: 'Pause',
  stop: 'Arrêter'
};

const ActionIcon = ({ action }: { action: NeuraCoNotificationAction }) => {
  if (action === 'pause') return <Pause size={14} />;
  if (action === 'stop') return <Square size={14} />;
  if (action === 'authorize' || action === 'refuse') return <ShieldAlert size={14} />;
  return <ExternalLink size={14} />;
};

export default function NotificationPanel({
  notifications,
  busy,
  onClose,
  onRead,
  onArchive,
  onAction
}: NotificationPanelProps) {
  const unread = notifications.filter((notification) => !notification.readAt).length;
  return (
    <div className="notification-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="notification-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Notifications NeuraCo"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <Bell size={18} />
            <span>
              <strong>Notifications</strong>
              <small>{unread} non lue(s)</small>
            </span>
          </div>
          <button type="button" onClick={onClose} title="Fermer">
            <X size={17} />
          </button>
        </header>

        <div className="notification-list">
          {notifications.length === 0 ? (
            <div className="notification-empty">
              <Bell size={24} />
              <strong>Aucune notification</strong>
              <span>Les événements importants apparaîtront ici.</span>
            </div>
          ) : notifications.map((notification) => (
            <article
              key={notification.id}
              className={[
                `is-${notification.severity}`,
                notification.readAt ? 'is-read' : 'is-unread'
              ].join(' ')}
            >
              <div className="notification-heading">
                <span>{kindLabel[notification.kind]}</span>
                <time dateTime={notification.createdAt}>
                  {new Date(notification.createdAt).toLocaleString('fr-FR')}
                </time>
              </div>
              <strong>{notification.title}</strong>
              <p>{notification.body}</p>
              {notification.sensitive && (
                <small className="notification-sensitive">
                  <ShieldAlert size={13} />
                  Validation détaillée obligatoire dans NeuraCo
                </small>
              )}
              <div className="notification-actions">
                {notification.actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={busy}
                    className={action === 'stop' ? 'is-danger' : ''}
                    onClick={() => void onAction(notification.id, action)}
                  >
                    <ActionIcon action={action} />
                    {actionLabel[action]}
                  </button>
                ))}
                {!notification.readAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onRead(notification.id)}
                  >
                    <CheckCheck size={14} />
                    Lu
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onArchive(notification.id)}
                  title="Archiver"
                  aria-label="Archiver la notification"
                >
                  <Archive size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
