import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { 
  CreditCard, 
  Check,
  Zap,
  Crown,
  Code,
  Sun,
  Moon,
  Home,
  Sparkles,
  Loader2,
  CheckCircle,
  ArrowLeft
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SubscriptionPage = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, getAuthHeader, fetchUser } = useAuth();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState('monthly');

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    if (sessionId) {
      checkPaymentStatus(sessionId);
    }
  }, [searchParams]);

  const checkPaymentStatus = async (sessionId) => {
    if (!user) {
      toast.error('Veuillez vous connecter');
      navigate('/auth');
      return;
    }

    setCheckingPayment(true);
    let attempts = 0;
    const maxAttempts = 5;

    const pollStatus = async () => {
      try {
        const response = await axios.get(`${API}/subscriptions/status/${sessionId}`, {
          headers: getAuthHeader()
        });

        if (response.data.payment_status === 'paid') {
          toast.success('Paiement réussi! Votre abonnement est activé.');
          await fetchUser();
          navigate('/subscription', { replace: true });
          return true;
        } else if (response.data.status === 'expired') {
          toast.error('Session expirée. Veuillez réessayer.');
          navigate('/subscription', { replace: true });
          return true;
        }

        return false;
      } catch (error) {
        console.error('Error checking payment:', error);
        return false;
      }
    };

    while (attempts < maxAttempts) {
      const done = await pollStatus();
      if (done) break;
      attempts++;
      await new Promise(r => setTimeout(r, 2000));
    }

    setCheckingPayment(false);
  };

  const subscribe = async (planId) => {
    if (!user) {
      toast.info('Veuillez vous connecter pour souscrire');
      navigate('/auth');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/subscriptions/checkout`, {
        plan: planId,
        billing_period: billingPeriod,
        origin_url: window.location.origin
      }, {
        headers: getAuthHeader()
      });

      window.location.href = response.data.url;
    } catch (error) {
      console.error('Subscription error:', error);
      toast.error(error.response?.data?.detail || 'Erreur lors de la souscription');
    } finally {
      setLoading(false);
    }
  };

  const plans = [
    {
      id: 'free',
      name: 'Free',
      icon: Sparkles,
      price: { monthly: 0, yearly: 0 },
      description: 'Découvrez ce que l’IA peut faire',
      features: [
        'Routeur IA multi-fournisseurs',
        'Messages IA avec quota',
        'Captures d’écran limitées',
        '3 créations d’images offertes',
        'Mémoire développeur limitée',
        'Coran complet avec audio',
        'Horaires de prière avec Adhan',
        'Invocations',
        'Quiz islamiques',
        'Module Ramadan et Aïd'
      ],
      highlight: false,
      current: user?.subscription === 'free'
    },
    {
      id: 'mongo',
      name: 'Mongo',
      icon: Zap,
      price: { monthly: 8.99, yearly: 89.99 },
      description: 'Le plus populaire',
      features: [
        'Tout du plan Gratuit',
        'Screens illimités',
        'Images IA illimitées',
        'Historique complet',
        'Réponses détaillées',
        'Export de conversations'
      ],
      highlight: true,
      current: user?.subscription === 'mongo'
    },
    {
      id: 'pro',
      name: 'Pro',
      icon: Crown,
      price: { monthly: 14.99, yearly: 89.99 },
      description: 'Pour les passionnés',
      features: [
        'Tout du plan Mongo',
        'Priorité serveur',
        'Réponses plus rapides',
        '+50 récitateurs Coran',
        'Mode mémorisation',
        'Coaching spirituel',
        'Thèmes premium'
      ],
      highlight: false,
      current: user?.subscription === 'pro'
    },
    {
      id: 'developer',
      name: 'Développeur',
      icon: Code,
      price: { monthly: 19.99, yearly: 119.99 },
      description: 'Pour les développeurs',
      features: [
        'Tout du plan Pro',
        'Accès API complet',
        'SDK mobile',
        'Webhooks prière',
        'Dashboard multi-projets',
        'Analytics détaillés'
      ],
      highlight: false,
      current: user?.subscription === 'developer'
    },
    {
      id: 'neura_plus',
      name: 'Neura+',
      icon: Zap,
      price: { monthly: 119.99, yearly: 1199.99 },
      description: 'Assistant Développeur IA avancé',
      features: [
        'Tout l\'islamique reste gratuit',
        'Assistant Développeur IA dans le chat',
        '150 générations de code / heure',
        'Génération multi-fichiers (jusqu\'à 10)',
        'Analyse approfondie du projet',
        'Mémoire développeur étendue',
        'Code avancé & réponses longues',
        'Priorité de traitement'
      ],
      highlight: false,
      current: user?.subscription === 'neura_plus'
    },
    {
      id: 'neura_ultra',
      name: 'Neura Ultra',
      icon: Crown,
      price: { monthly: 299.99, yearly: 2999.99 },
      description: 'Niveau ingénieur logiciel IA',
      features: [
        'Tout Neura+',
        'Génération quasi illimitée (1000 / heure)',
        'Génération massive (jusqu\'à 30 fichiers)',
        'Mémoire projet maximale',
        'Code le plus long & détaillé',
        'Analyse complète du projet',
        'Priorité serveur maximale'
      ],
      highlight: false,
      current: user?.subscription === 'neura_ultra'
    }
  ];

  if (checkingPayment) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Vérification du paiement...</h2>
          <p className="text-muted-foreground">Veuillez patienter quelques instants</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 glass">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold">NEURA</span>
          </Link>
          
          <div className="flex items-center gap-2">
            <Link to="/" className="p-2 rounded-full hover:bg-muted transition-colors">
              <Home className="w-5 h-5" />
            </Link>
            <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-muted transition-colors">
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="pt-20 pb-12 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Back button if user */}
          {user && (
            <Button variant="ghost" onClick={() => navigate('/chat')} className="mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('common.back')}
            </Button>
          )}

          {/* Hero */}
          <div className="text-center mb-12">
            <CreditCard className="w-16 h-16 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">Choisissez votre plan</h1>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Le module islamique est 100% gratuit pour tous. Débloquez plus de fonctionnalités IA avec nos plans Premium.
            </p>
            
            {user?.is_vip && (
              <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/10 text-secondary">
                <Crown className="w-5 h-5" />
                <span className="font-medium">Vous êtes VIP Admin - Accès illimité</span>
              </div>
            )}
          </div>

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-4 py-2 rounded-full transition-colors ${
                billingPeriod === 'monthly' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}
              data-testid="billing-monthly"
            >
              Mensuel
            </button>
            <button
              onClick={() => setBillingPeriod('yearly')}
              className={`px-4 py-2 rounded-full transition-colors ${
                billingPeriod === 'yearly' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}
              data-testid="billing-yearly"
            >
              Annuel
              <span className="ml-2 text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                -16%
              </span>
            </button>
          </div>

          {/* Plans Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {plans.map((plan) => (
              <Card
                key={plan.id}
                className={`
                  p-6 relative transition-all hover:-translate-y-1
                  ${plan.highlight ? 'ring-2 ring-primary shadow-lg' : ''}
                  ${plan.current ? 'bg-primary/5' : ''}
                `}
                data-testid={`plan-card-${plan.id}`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                      Populaire
                    </span>
                  </div>
                )}
                
                {plan.current && (
                  <div className="absolute -top-3 right-4">
                    <span className="px-3 py-1 rounded-full bg-green-500 text-white text-xs font-medium flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Actuel
                    </span>
                  </div>
                )}

                <div className="text-center mb-6">
                  <div className={`
                    w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center
                    ${plan.highlight ? 'bg-primary text-primary-foreground' : 'bg-muted'}
                  `}>
                    <plan.icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-lg">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <div className="text-center mb-6">
                  <span className="text-3xl font-bold">
                    {plan.price[billingPeriod]}€
                  </span>
                  {plan.price[billingPeriod] > 0 && (
                    <span className="text-muted-foreground">
                      /{billingPeriod === 'monthly' ? 'mois' : 'an'}
                    </span>
                  )}
                </div>

                <ul className="space-y-2 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {plan.id === 'free' ? (
                  <Button 
                    variant="outline" 
                    className="w-full rounded-full"
                    onClick={() => navigate(user ? '/chat' : '/auth')}
                    disabled={plan.current}
                    data-testid={`plan-btn-${plan.id}`}
                  >
                    {plan.current ? 'Votre forfait actuel' : (user ? 'Accéder' : 'Commencer')}
                  </Button>
                ) : plan.current || user?.is_vip ? (
                  <Button 
                    variant="outline" 
                    className="w-full rounded-full"
                    disabled
                  >
                    {user?.is_vip ? 'Inclus VIP' : 'Plan actuel'}
                  </Button>
                ) : (
                  <Button 
                    className={`w-full rounded-full ${plan.highlight ? '' : 'variant-outline'}`}
                    variant={plan.highlight ? 'default' : 'outline'}
                    onClick={() => subscribe(plan.id)}
                    disabled={loading}
                    data-testid={`plan-btn-${plan.id}`}
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Souscrire'}
                  </Button>
                )}
              </Card>
            ))}
          </div>

          {/* Info */}
          <div className="text-center mt-12 text-sm text-muted-foreground">
            <p>Paiement sécurisé par Stripe • Remboursement possible sous 14 jours</p>
            <p className="mt-2">Questions? Contactez-nous à support@neura-alnour.com</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SubscriptionPage;
