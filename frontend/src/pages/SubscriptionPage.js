import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { apiErrorMessage } from '@/utils/apiError';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { SUPPORT_EMAIL } from '@/utils/contact';
import { 
  CreditCard, 
  Check,
  Zap,
  Crown,
  Sun,
  Moon,
  Home,
  Sparkles,
  Loader2,
  CheckCircle,
  ArrowLeft
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Plans ordered by level: a lower plan is already included in a higher one, so
// it must not be bought on top of it (that would start a second subscription).
const PLAN_RANKS = { free: 0, mongo: 1, pro: 2, neura_plus: 3, neura_ultra: 4 };
const PLAN_NAMES = { mongo: 'Mongo', pro: 'Plus', neura_plus: 'Neura+', neura_ultra: 'Neura Ultra' };

const SubscriptionPage = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, loading: authLoading, getAuthHeader, fetchUser } = useAuth();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState('monthly');

  const sessionId = searchParams.get('session_id');
  const userId = user?.id;
  useEffect(() => {
    if (!sessionId || authLoading) return;
    if (!userId) {
      const returnTo = `/subscription?session_id=${encodeURIComponent(sessionId)}`;
      navigate(`/auth?return_to=${encodeURIComponent(returnTo)}`, { replace: true });
      return;
    }
    const controller = new AbortController();
    let timer;
    let attempts = 0;
    setCheckingPayment(true);
    const poll = async () => {
      let verificationError = null;
      try {
        const response = await axios.get(`${API}/subscriptions/status/${encodeURIComponent(sessionId)}`, {
          headers: getAuthHeader(), signal: controller.signal, timeout: 20000
        });
        if (controller.signal.aborted) return;
        if (response.data.payment_status === 'paid') {
          await fetchUser();
          if (controller.signal.aborted) return;
          toast.success('Paiement confirmé. Votre abonnement a été actualisé.');
          setCheckingPayment(false);
          navigate('/subscription', { replace: true });
          return;
        }
        if (response.data.status === 'expired') {
          toast.error('Session expirée. Veuillez réessayer.');
          setCheckingPayment(false);
          navigate('/subscription', { replace: true });
          return;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        verificationError = error;
        if (error.response?.status === 401) {
          navigate(`/auth?return_to=${encodeURIComponent('/subscription?session_id=' + encodeURIComponent(sessionId))}`, { replace: true });
          return;
        }
        if ([400, 403, 404].includes(error.response?.status)) {
          setCheckingPayment(false);
          toast.error(apiErrorMessage(error, 'Impossible de vérifier cette session de paiement.'));
          return;
        }
      }
      if (++attempts < 5) timer = setTimeout(poll, 2000);
      else {
        setCheckingPayment(false);
        if (verificationError) {
          toast.error(apiErrorMessage(verificationError, 'Vérification du paiement indisponible. Réessayez plus tard.'));
        } else {
          toast.info('Confirmation du paiement en attente. Actualisez cette page pour revérifier.');
        }
      }
    };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, authLoading, userId, getAuthHeader, fetchUser, navigate]);

  const isIncludedInCurrentPlan = (planId) => {
    const currentRank = PLAN_RANKS[user?.subscription];
    const planRank = PLAN_RANKS[planId];
    return currentRank !== undefined && planRank !== undefined && planRank > 0 && planRank < currentRank;
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

      const checkoutUrl = response.data?.url;
      if (typeof checkoutUrl !== 'string' || !/^https?:\/\//.test(checkoutUrl)) {
        throw new Error('missing checkout url');
      }
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Subscription error:', error);
      toast.error(apiErrorMessage(error, 'Erreur lors de la souscription'));
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
        'Assistant IA Neura Al Noor',
        'Réflexion : Instantané',
        '3 styles de réponse au choix (ChatGPT, Claude, Gemini)',
        'Messages IA avec quota par conversation',
        'Mémoire : Neura se souvient de toi',
        'Création de code avec projet téléchargeable (.zip)',
        'Coran complet avec audio et Moushaf',
        'Suivi de mémorisation du Coran',
        'Horaires de prière avec Adhan, Qibla et mosquées',
        'Invocations',
        'Quiz islamiques',
        'Académie islamique et tuteur de langues',
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
      description: 'Le bon équilibre au quotidien',
      features: [
        'Tout du plan Gratuit',
        'Réflexion : Instantané et Moyenne',
        '2× plus d’IA par jour que l’offre gratuite',
        'Export des conversations (PDF ou texte)',
        'Historique complet de tes conversations',
      ],
      highlight: true,
      current: user?.subscription === 'mongo'
    },
    {
      id: 'pro',
      name: 'Plus',
      icon: Crown,
      price: { monthly: 22, yearly: 219.99 },
      description: 'Pour une utilisation intensive',
      features: [
        'Tout du plan Mongo',
        'Réflexion : jusqu’à Élevée',
        'Mode Work pour les tâches longues',
        '4× plus d’IA par jour que l’offre gratuite'
      ],
      highlight: false,
      current: user?.subscription === 'pro',
      actionLabel: 'Choisir Plus'
    },
    {
      id: 'neura_plus',
      name: 'Neura+',
      icon: Zap,
      price: { monthly: 119.99, yearly: 1199.99 },
      description: 'Pour les usages professionnels et intensifs',
      features: [
        'Tout du plan Plus',
        'Réflexion : les 4 niveaux, jusqu’à Très élevée',
        'La plus grande réflexion pour le code et les problèmes difficiles',
        'Code plus long et plus détaillé',
        '8× plus d’IA par jour que l’offre gratuite',
        'Support prioritaire par e-mail'
      ],
      highlight: false,
      current: user?.subscription === 'neura_plus',
      actionLabel: 'Choisir Neura+'
    },
    {
      id: 'neura_ultra',
      name: 'Neura Ultra',
      icon: Crown,
      price: { monthly: 299.99, yearly: 2999.99 },
      description: 'Pour l’usage le plus intensif',
      features: [
        'Tout Neura+',
        'Réflexion : les 4 niveaux, jusqu’à Très élevée',
        '20× plus d’IA par jour que l’offre gratuite',
        'Accès en avant-première aux nouvelles fonctions',
        'Support prioritaire par e-mail'
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

          {user?.has_recurring_subscription && <section className="max-w-xl mx-auto mb-6 border-y py-4 space-y-3" aria-label="Abonnement actuel">
            <h2 className="font-semibold">Abonnement actuel</h2>
            <p>État : {user.subscription_status}</p>
            {user.subscription_expires_at && <p>{user.subscription_cancel_at_period_end ? 'Fin de l’accès' : 'Fin de période'} : {new Date(user.subscription_expires_at).toLocaleString()}</p>}
            {user.subscription_cancel_at_period_end ? <p>Renouvellement annulé. L’accès reste actif jusqu’à la fin de la période payée.</p> : ['active', 'trialing', 'past_due'].includes(user.subscription_status) && <Button variant="outline" disabled={loading} onClick={async () => {
              setLoading(true);
              try {
                await axios.post(`${API}/subscriptions/cancel`, {}, { headers: getAuthHeader() });
                await fetchUser();
                toast.success('Renouvellement annulé');
              } catch (error) { toast.error(apiErrorMessage(error, 'Annulation impossible')); }
              finally { setLoading(false); }
            }}>Annuler le renouvellement</Button>}
            {user.subscription_cancel_at_period_end && <Button variant="outline" disabled={loading} data-testid="resume-subscription" onClick={async () => {
              setLoading(true);
              try {
                await axios.post(`${API}/subscriptions/resume`, {}, { headers: getAuthHeader() });
                await fetchUser();
                toast.success('Abonnement repris');
              } catch (error) { toast.error(apiErrorMessage(error, 'Reprise impossible')); }
              finally { setLoading(false); }
            }}>Reprendre mon abonnement</Button>}
            <Button variant="ghost" disabled={loading} data-testid="billing-portal" onClick={async () => {
              setLoading(true);
              try {
                const response = await axios.post(`${API}/subscriptions/portal`, { origin_url: window.location.origin }, { headers: getAuthHeader() });
                window.location.href = response.data.url;
              } catch (error) { toast.error(apiErrorMessage(error, 'Espace de paiement indisponible')); setLoading(false); }
            }}>Gérer le paiement et les factures</Button>
          </section>}

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
                      Conseillé
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
                ) : plan.current || isIncludedInCurrentPlan(plan.id) || user?.is_vip ? (
                  <Button 
                    variant="outline" 
                    className="w-full rounded-full"
                    disabled
                  >
                    {user?.is_vip
                      ? 'Inclus VIP'
                      : plan.current
                        ? 'Offre actuelle'
                        : `Inclus avec ${PLAN_NAMES[user?.subscription] || 'votre offre'}`}
                  </Button>
                ) : (
                  <Button 
                    className={`w-full rounded-full ${plan.highlight ? '' : 'variant-outline'}`}
                    variant={plan.highlight ? 'default' : 'outline'}
                    onClick={() => subscribe(plan.id)}
                    disabled={loading}
                    data-testid={`plan-btn-${plan.id}`}
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (plan.actionLabel || 'Souscrire')}
                  </Button>
                )}
              </Card>
            ))}
          </div>

          {/* Info */}
          <div className="text-center mt-12 text-sm text-muted-foreground">
            <p>Paiement sécurisé par Stripe • Remboursement possible sous 14 jours</p>
            <p className="mt-2">Questions ? Contactez-nous à {SUPPORT_EMAIL}</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SubscriptionPage;
