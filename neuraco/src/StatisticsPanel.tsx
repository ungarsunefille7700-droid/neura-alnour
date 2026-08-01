import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Clock3,
  Download,
  FileSpreadsheet,
  RefreshCw
} from 'lucide-react';
import type {
  NeuraCoStatisticsMetric,
  NeuraCoStatisticsPeriod,
  NeuraCoStatisticsSummary
} from '../electron/ipc-contract';

interface StatisticsPanelProps {
  onStatus: (message: string) => void;
}

const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4
});

const duration = (milliseconds: number): string => {
  const seconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return `${minutes} min ${remaining} s`;
  return `${remaining} s`;
};

const dateTime = (value?: string): string => {
  if (!value) return 'Aucune consommation';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Date indisponible'
    : parsed.toLocaleString('fr-FR');
};

const UsageTable = ({
  title,
  values,
  empty = 'Aucune consommation enregistrée.'
}: {
  title: string;
  values: NeuraCoStatisticsMetric[];
  empty?: string;
}) => (
  <section className="statistics-table-section">
    <header>
      <strong>{title}</strong>
      <span>{values.length} ligne(s)</span>
    </header>
    {values.length ? (
      <div className="statistics-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Appels</th>
              <th>Crédits</th>
              <th>Entrée</th>
              <th>Cache</th>
              <th>Sortie</th>
              <th>Durée</th>
            </tr>
          </thead>
          <tbody>
            {values.map((value) => (
              <tr key={value.key}>
                <td>
                  <strong>{value.label}</strong>
                  <small>
                    {value.source === 'server-ledger'
                      ? 'Registre serveur'
                      : 'Journal local'}
                  </small>
                </td>
                <td>{integer.format(value.requests)}</td>
                <td>{decimal.format(value.creditsConsumed)}</td>
                {value.tokenMetricsAvailable ? (
                  <>
                    <td>{integer.format(value.inputTokens)}</td>
                    <td>{integer.format(value.cachedInputTokens)}</td>
                    <td>{integer.format(value.outputTokens)}</td>
                  </>
                ) : (
                  <td colSpan={3} className="statistics-unavailable">
                    Non attribuables
                  </td>
                )}
                <td>{duration(value.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="statistics-empty">{empty}</p>
    )}
  </section>
);

const Timeline = ({
  values
}: {
  values: NeuraCoStatisticsPeriod[];
}) => {
  const maximum = Math.max(1, ...values.map((value) => value.creditsConsumed));
  return (
    <div className="statistics-timeline">
      {values.length ? values.map((value) => (
        <div key={value.key} className="statistics-timeline-row">
          <time>{value.period}</time>
          <div>
            <span style={{ width: `${Math.max(2, value.creditsConsumed / maximum * 100)}%` }} />
          </div>
          <strong>{decimal.format(value.creditsConsumed)}</strong>
          <small>{integer.format(value.requests)} appel(s)</small>
        </div>
      )) : (
        <p className="statistics-empty">Aucune période enregistrée.</p>
      )}
    </div>
  );
};

export default function StatisticsPanel({ onStatus }: StatisticsPanelProps) {
  const [summary, setSummary] = useState<NeuraCoStatisticsSummary>();
  const [period, setPeriod] = useState<'daily' | 'monthly'>('daily');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'pdf'>();
  const [error, setError] = useState<string>();

  const load = async () => {
    if (!window.neuraco) return;
    setLoading(true);
    setError(undefined);
    try {
      setSummary(await window.neuraco.getStatistics());
    } catch (loadError) {
      setError(loadError instanceof Error
        ? loadError.message
        : 'Statistiques indisponibles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const exportFile = async (format: 'csv' | 'pdf') => {
    if (!window.neuraco) return;
    setExporting(format);
    try {
      const filePath = format === 'csv'
        ? await window.neuraco.exportStatisticsCsv()
        : await window.neuraco.exportStatisticsPdf();
      if (filePath) onStatus(`Statistiques exportées : ${filePath}`);
    } catch (exportError) {
      onStatus(exportError instanceof Error
        ? exportError.message
        : 'Export impossible.');
    } finally {
      setExporting(undefined);
    }
  };

  const timeline = useMemo(
    () => period === 'daily' ? summary?.daily || [] : summary?.monthly || [],
    [period, summary]
  );

  return (
    <div className="statistics-view">
      <header className="statistics-heading">
        <div>
          <BarChart3 size={19} />
          <span>
            <strong>Statistiques</strong>
            <small>Données serveur et activité locale, sans compteur simulé</small>
          </span>
        </div>
        <div className="statistics-actions">
          <button
            type="button"
            onClick={() => void exportFile('csv')}
            disabled={!summary || Boolean(exporting)}
          >
            <FileSpreadsheet size={14} />
            {exporting === 'csv' ? 'Export…' : 'CSV'}
          </button>
          <button
            type="button"
            onClick={() => void exportFile('pdf')}
            disabled={!summary || Boolean(exporting)}
          >
            <Download size={14} />
            {exporting === 'pdf' ? 'Export…' : 'PDF'}
          </button>
          <button
            type="button"
            className="statistics-refresh"
            onClick={() => void load()}
            disabled={loading}
            title="Actualiser les statistiques"
            aria-label="Actualiser les statistiques"
          >
            <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />
          </button>
        </div>
      </header>

      {error && <div className="statistics-error">{error}</div>}
      {loading && !summary ? (
        <div className="statistics-loading">
          <RefreshCw size={18} className="is-spinning" />
          Chargement du registre…
        </div>
      ) : summary ? (
        <>
          <section className="statistics-totals" aria-label="Totaux d’utilisation">
            <article>
              <span>Crédits consommés</span>
              <strong>{decimal.format(summary.totals.creditsConsumed)}</strong>
              <small>{integer.format(summary.totals.requests)} consommation(s)</small>
            </article>
            <article>
              <span>Tokens d’entrée</span>
              <strong>{integer.format(summary.totals.inputTokens)}</strong>
              <small>Registre serveur</small>
            </article>
            <article>
              <span>Tokens mis en cache</span>
              <strong>{integer.format(summary.totals.cachedInputTokens)}</strong>
              <small>Comptage fournisseur</small>
            </article>
            <article>
              <span>Tokens de sortie</span>
              <strong>{integer.format(summary.totals.outputTokens)}</strong>
              <small>Registre serveur</small>
            </article>
          </section>

          <section className="statistics-outcomes">
            <div>
              <span>Tâches réussies</span>
              <strong>{integer.format(summary.tasks.successful)}</strong>
            </div>
            <div>
              <span>Tâches échouées</span>
              <strong>{integer.format(summary.tasks.failed)}</strong>
            </div>
            <div>
              <span>Tâches annulées</span>
              <strong>{integer.format(summary.tasks.cancelled)}</strong>
            </div>
            <div>
              <span>Taux de réussite</span>
              <strong>{decimal.format(summary.tasks.successRate)} %</strong>
            </div>
            <div>
              <span>Temps d’exécution IA</span>
              <strong>{duration(summary.totals.executionTimeMs)}</strong>
            </div>
            <div className="is-estimate">
              <span>Temps économisé estimé</span>
              <strong>≈ {duration(summary.estimatedTimeSaved.milliseconds)}</strong>
            </div>
          </section>

          <section className="statistics-periods">
            <header>
              <div>
                <Clock3 size={15} />
                <span>
                  <strong>Consommation dans le temps</strong>
                  <small>Crédits réglés par le serveur</small>
                </span>
              </div>
              <div className="statistics-period-picker">
                <button
                  type="button"
                  className={period === 'daily' ? 'is-active' : ''}
                  onClick={() => setPeriod('daily')}
                >
                  30 jours
                </button>
                <button
                  type="button"
                  className={period === 'monthly' ? 'is-active' : ''}
                  onClick={() => setPeriod('monthly')}
                >
                  12 mois
                </button>
              </div>
            </header>
            <Timeline values={timeline} />
          </section>

          <div className="statistics-breakdowns">
            <UsageTable title="Consommation par modèle" values={summary.byModel} />
            <UsageTable title="Consommation par agent" values={summary.byAgent} />
            <UsageTable
              title="Consommation par outil"
              values={summary.byTool}
              empty="Aucun outil terminé dans le journal local."
            />
            <UsageTable title="Consommation par projet" values={summary.byProject} />
          </div>

          <footer className="statistics-notes">
            <strong>Sources et limites</strong>
            <p>
              Couverture : {dateTime(summary.coverage.startsAt)} à{' '}
              {dateTime(summary.coverage.endsAt)} ·{' '}
              {summary.coverage.providerReportedRecords} comptage(s) fournisseur ·{' '}
              {summary.coverage.estimatedRecords} estimation(s) ·{' '}
              {summary.coverage.unknownMeteringRecords} inconnu(s).
            </p>
            <p>{summary.estimatedTimeSaved.methodology}</p>
            <ul>
              {summary.notices.map((notice) => <li key={notice}>{notice}</li>)}
            </ul>
          </footer>
        </>
      ) : null}
    </div>
  );
}
