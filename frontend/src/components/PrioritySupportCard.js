import { Headphones } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { SUPPORT_EMAIL } from '@/utils/contact';

// Neura+ and Ultra: priority support by e-mail (answered first by the team).
export default function PrioritySupportCard() {
  const { user } = useAuth();
  if (!user?.priority_support) return null;
  const subject = encodeURIComponent('[Prioritaire] Demande d’aide NEURA AL-NOUR');
  return (
    <Card className="p-6 mb-6" data-testid="priority-support">
      <h3 className="font-semibold mb-1 flex items-center gap-2">
        <Headphones className="w-5 h-5 text-primary" />
        Support prioritaire
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        Ton abonnement inclut le support prioritaire : tes demandes sont traitées en premier.
      </p>
      <a href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`} className="text-sm font-medium text-primary underline">
        Écrire au support ({SUPPORT_EMAIL})
      </a>
    </Card>
  );
}
