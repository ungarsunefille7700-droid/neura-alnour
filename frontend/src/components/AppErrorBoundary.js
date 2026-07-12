import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Keep this local: never expose stack traces or secrets in the UI.
    console.error('Application error boundary:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
        <section className="max-w-md w-full rounded-lg border border-border bg-card p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Une erreur d'affichage est survenue</h1>
          <p className="text-sm text-muted-foreground mb-5">
            L'application reste disponible. Recharge la page pour reprendre proprement.
          </p>
          <Button onClick={() => window.location.reload()} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Recharger
          </Button>
        </section>
      </main>
    );
  }
}
