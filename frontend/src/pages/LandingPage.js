import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { 
  MessageSquare, 
  BookOpen, 
  Clock, 
  Heart, 
  Brain, 
  Moon, 
  Sun,
  Sparkles,
  ChevronRight,
  Star,
  Zap,
  Shield,
  Menu,
  X,
  Compass,
  Building,
  GraduationCap
} from 'lucide-react';

const LandingPage = () => {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const features = [
    {
      icon: MessageSquare,
      title: "Chat IA Intelligent",
      description: "Conversations naturelles avec NEURA, une IA islamique intelligente et bienveillante.",
      color: "text-primary",
      path: "/chat"
    },
    {
      icon: BookOpen,
      title: "Coran Complet",
      description: "Lecture et audio des 114 sourates avec traduction française.",
      color: "text-secondary",
      path: "/quran"
    },
    {
      icon: Clock,
      title: "Heures de Prière",
      description: "Notifications automatiques et Adhan à l'heure exacte.",
      color: "text-primary",
      path: "/prayer-times"
    },
    {
      icon: Heart,
      title: "Invocations (Douas)",
      description: "Bibliothèque complète d'invocations avec audio.",
      color: "text-secondary",
      path: "/duas"
    },
    {
      icon: Brain,
      title: "Quiz Islamique",
      description: "Testez vos connaissances avec des quiz illimités.",
      color: "text-primary",
      path: "/quiz"
    },
    {
      icon: Moon,
      title: "Module Ramadan",
      description: "Guide complet pour le mois sacré avec horaires.",
      color: "text-secondary",
      path: "/ramadan"
    },
    {
      icon: Compass,
      title: "Boussole Qiblah",
      description: "Trouvez la direction de La Mecque instantanément.",
      color: "text-primary",
      path: "/qiblah"
    },
    {
      icon: Building,
      title: "Mosquées Proches",
      description: "Localisez les mosquées autour de vous avec itinéraire.",
      color: "text-secondary",
      path: "/mosques"
    },
    {
      icon: GraduationCap,
      title: "Apprendre l'Islam",
      description: "Leçons interactives avec suivi de progression.",
      color: "text-primary",
      path: "/learn"
    }
  ];

  const plans = [
    {
      name: "Gratuit",
      price: "0€",
      period: "",
      features: ["Messages illimités", "Module islamique complet", "Quiz illimité", "Heures de prière + Adhan"],
      highlight: false
    },
    {
      name: "Comme Toi",
      price: "4,99€",
      period: "/mois",
      features: ["Historique 50 conversations", "1 image IA/jour", "Mode clair/sombre", "Conversations chiffrées"],
      highlight: false
    },
    {
      name: "Mongo",
      price: "8,99€",
      period: "/mois",
      features: ["Screens illimités", "Images IA illimitées", "Historique complet", "Export conversations"],
      highlight: true
    },
    {
      name: "Pro",
      price: "14,99€",
      period: "/mois",
      features: ["Priorité serveur", "50+ récitateurs", "Mode mémorisation", "Coaching spirituel"],
      highlight: false
    }
  ];

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 glass">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">NEURA AL-NOUR</span>
            <span className="font-arabic text-lg text-muted-foreground">نور</span>
          </Link>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            <Link to="/quran" className="text-muted-foreground hover:text-foreground transition-colors">Coran</Link>
            <Link to="/prayer-times" className="text-muted-foreground hover:text-foreground transition-colors">Prières</Link>
            <Link to="/duas" className="text-muted-foreground hover:text-foreground transition-colors">Douas</Link>
            <Link to="/quiz" className="text-muted-foreground hover:text-foreground transition-colors">Quiz</Link>
            <Link to="/learn" className="text-muted-foreground hover:text-foreground transition-colors">Apprendre</Link>
            <Link to="/developer" className="text-primary font-medium hover:opacity-80 transition-opacity">Développeur</Link>
            <Link to="/support" className="text-muted-foreground hover:text-foreground transition-colors">Soutenir</Link>
            <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-muted transition-colors">
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            {user ? (
              <Button onClick={() => navigate('/chat')} data-testid="nav-chat-btn" className="rounded-full px-6">
                Accéder au Chat
              </Button>
            ) : (
              <Button onClick={() => navigate('/auth')} data-testid="nav-login-btn" className="rounded-full px-6">
                Connexion
              </Button>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button 
            className="md:hidden p-2"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="mobile-menu-btn"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 glass border-t border-border p-4 space-y-4">
            <Link to="/quran" className="block py-2 text-muted-foreground hover:text-foreground">Coran</Link>
            <Link to="/prayer-times" className="block py-2 text-muted-foreground hover:text-foreground">Prières</Link>
            <Link to="/duas" className="block py-2 text-muted-foreground hover:text-foreground">Douas</Link>
            <Link to="/quiz" className="block py-2 text-muted-foreground hover:text-foreground">Quiz</Link>
            <Link to="/learn" className="block py-2 text-muted-foreground hover:text-foreground">Apprendre</Link>
            <Link to="/developer" className="block py-2 text-primary font-medium">Développeur</Link>
            <Link to="/support" className="block py-2 text-muted-foreground hover:text-foreground">Soutenir</Link>
            <div className="flex items-center gap-4 pt-2">
              <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-muted">
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              {user ? (
                <Button onClick={() => navigate('/chat')} className="flex-1 rounded-full">
                  Accéder au Chat
                </Button>
              ) : (
                <Button onClick={() => navigate('/auth')} className="flex-1 rounded-full">
                  Connexion
                </Button>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6 relative">
        {/* Background decoration */}
        <div className="absolute inset-0 islamic-pattern pointer-events-none" />
        <div className="absolute top-20 right-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-10 w-96 h-96 bg-secondary/10 rounded-full blur-3xl" />
        
        <div className="max-w-7xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-8">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">Propulsé par l'IA NEURA</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
            <span className="text-primary">NEURA</span> AL-NOUR
            <span className="font-arabic text-4xl md:text-6xl ml-4 text-secondary">نور</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-4">
            بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
          </p>
          
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            L'assistant IA intelligent qui combine intelligence artificielle moderne et spiritualité islamique.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              size="lg" 
              onClick={() => navigate(user ? '/chat' : '/auth')}
              data-testid="hero-cta-btn"
              className="rounded-full px-8 h-14 text-lg shadow-lg shadow-primary/20 hover:scale-105 transition-transform"
            >
              Commencer Gratuitement
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
            <Button 
              variant="outline" 
              size="lg"
              onClick={() => navigate('/quran')}
              data-testid="hero-quran-btn"
              className="rounded-full px-8 h-14 text-lg border-2"
            >
              <BookOpen className="w-5 h-5 mr-2" />
              Explorer le Coran
            </Button>
          </div>
          
          <p className="mt-6 text-sm text-muted-foreground">
            Module islamique 100% gratuit • Aucune carte bancaire requise
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 px-6 relative">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-semibold mb-4">
              Tout ce dont vous avez besoin
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Une application complète pour votre vie spirituelle et quotidienne.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card
                key={index}
                onClick={() => navigate(feature.path === '/chat' && !user ? '/auth' : feature.path)}
                className="p-8 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 arch group cursor-pointer"
                data-testid={`feature-card-${index}`}
              >
                <div className={`w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${feature.color}`}>
                  <feature.icon className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-24 px-6 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-semibold mb-4">
              Choisissez votre plan
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Le module islamique est entièrement gratuit. Débloquez plus de fonctionnalités IA.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((plan, index) => (
              <Card 
                key={index}
                className={`p-6 relative overflow-hidden transition-all duration-300 hover:-translate-y-2 ${
                  plan.highlight ? 'ring-2 ring-primary shadow-lg shadow-primary/10' : ''
                }`}
                data-testid={`pricing-card-${index}`}
              >
                {plan.highlight && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-secondary" />
                )}
                {plan.highlight && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
                    <Star className="w-3 h-3" /> Populaire
                  </span>
                )}
                <h3 className="text-xl font-semibold mb-2">{plan.name}</h3>
                <div className="mb-6">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Shield className="w-4 h-4 text-primary flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button 
                  className={`w-full rounded-full ${plan.highlight ? '' : 'variant-outline'}`}
                  variant={plan.highlight ? 'default' : 'outline'}
                  onClick={() => navigate('/subscription')}
                  data-testid={`pricing-btn-${index}`}
                >
                  {plan.price === "0€" ? "Commencer" : "Choisir"}
                </Button>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="glass rounded-3xl p-12 relative overflow-hidden">
            <div className="absolute inset-0 islamic-pattern opacity-30" />
            <div className="relative z-10">
              <Zap className="w-16 h-16 text-secondary mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-semibold mb-4">
                Prêt à commencer votre voyage spirituel ?
              </h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
                Rejoignez des milliers d'utilisateurs qui utilisent NEURA AL-NOUR pour leur quotidien spirituel.
              </p>
              <Button 
                size="lg"
                onClick={() => navigate(user ? '/chat' : '/auth')}
                data-testid="cta-final-btn"
                className="rounded-full px-10 h-14 text-lg shadow-lg shadow-primary/20"
              >
                Commencer Maintenant
                <ChevronRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-border">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">NEURA AL-NOUR</span>
              <span className="font-arabic text-muted-foreground">نور</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link to="/quran" className="hover:text-foreground transition-colors">Coran</Link>
              <Link to="/prayer-times" className="hover:text-foreground transition-colors">Prières</Link>
              <Link to="/duas" className="hover:text-foreground transition-colors">Douas</Link>
              <Link to="/quiz" className="hover:text-foreground transition-colors">Quiz</Link>
              <Link to="/learn" className="hover:text-foreground transition-colors">Apprendre</Link>
              <Link to="/support" className="hover:text-foreground transition-colors">Soutenir</Link>
              <Link to="/subscription" className="hover:text-foreground transition-colors">Abonnements</Link>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 NEURA AL-NOUR. Tous droits réservés.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
