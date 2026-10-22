import { CheckCircle2, FlaskConical, Loader2, Wrench } from 'lucide-react';

// Under an answer with code: what was REALLY checked or run, what was found, and what could
// not be tested here (never shown as a success).
export default function VerificationNote({ result }) {
  if (!result) return null;
  if (result.running) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="verification-running">
        <Loader2 className="h-3 w-3 animate-spin" /> Vérification réelle du code en cours{result.python ? ' (chargement de Python au premier usage)' : ''}…
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-0.5 text-xs" data-testid="verification-note">
      <p className={`flex items-center gap-1.5 ${result.ok ? 'text-primary' : 'text-amber-600 dark:text-amber-400'}`}>
        {result.ok ? <CheckCircle2 className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}
        Vérification réelle : {result.text}{result.ok ? ' — aucun problème trouvé' : ` — ${result.issues} problème(s) trouvé(s)`}
      </p>
      {result.details?.length > 0 && (
        <ul className="ml-5 list-disc text-muted-foreground" data-testid="verification-details">
          {result.details.map((line) => <li key={line} className="break-words">{line}</li>)}
        </ul>
      )}
      {result.autoFix && (
        <p className="flex items-center gap-1.5 text-muted-foreground" data-testid="verification-autofix">
          <Wrench className="h-3 w-3" /> {result.autoFix}
        </p>
      )}
      {result.notTested?.map((line) => <p key={line} className="text-muted-foreground">Non testé : {line}</p>)}
    </div>
  );
}
