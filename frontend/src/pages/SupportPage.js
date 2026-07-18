import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  Heart,
  Sun,
  Moon,
  Home,
  Sparkles,
  ExternalLink
} from 'lucide-react';

const SupportPage = () => {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();

  const handlePayPalDonate = () => {
    // PayPal donation link with the specified email
    const paypalEmail = 'kaddanaminpro@gmail.com';
    const paypalUrl = `https://www.paypal.com/donate?business=${encodeURIComponent(paypalEmail)}&currency_code=EUR`;
    window.open(paypalUrl, '_blank');
  };

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
        <div className="max-w-xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-8">
            <Heart className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">دعم التطبيق</h1>
            <p className="text-xl text-muted-foreground">Soutenir l'application</p>
          </div>

          {/* Main Card */}
          <Card className="p-8 mb-8">
            <div className="text-center space-y-6">
              {/* Message */}
              <div className="space-y-4">
                <p className="text-lg leading-relaxed">
                  Si vous aimez l'application et le site et souhaitez soutenir leur développement 
                  et leurs améliorations futures, vous pouvez faire un don.
                </p>
                <p className="text-lg font-semibold text-primary">
                  Merci beaucoup pour votre soutien. 💚
                </p>
              </div>

              {/* Divider */}
              <div className="h-px bg-border my-6" />

              {/* PayPal Button */}
              <Button 
                onClick={handlePayPalDonate}
                size="lg"
                className="w-full h-14 rounded-full text-lg bg-[#0070ba] hover:bg-[#003087] text-white"
                data-testid="paypal-donate-btn"
              >
                <svg className="w-6 h-6 mr-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 3.72a.771.771 0 0 1 .76-.654h6.557c2.192 0 3.88.587 4.963 1.724 1.005 1.054 1.413 2.527 1.18 4.29-.025.19-.054.378-.09.566-.63 3.327-2.786 5.03-6.404 5.03H9.476a.974.974 0 0 0-.962.818l-1.438 8.843zm6.678-14.6h-3.14a.485.485 0 0 0-.479.41l-.658 4.167h2.063c1.93 0 3.29-.52 3.922-2.282.286-.8.321-1.466.118-1.956-.25-.603-.88-.873-1.826-.34z"/>
                </svg>
                Faire un don avec PayPal
                <ExternalLink className="w-5 h-5 ml-2" />
              </Button>

              <p className="text-sm text-muted-foreground">
                Vous serez redirigé vers PayPal pour effectuer votre don en toute sécurité.
              </p>
            </div>
          </Card>

          {/* Benefits */}
          <Card className="p-6 mb-8">
            <h3 className="font-semibold mb-4 text-center">Votre don nous aide à :</h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary">✓</span>
                </div>
                <span>Maintenir les serveurs et l'infrastructure</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary">✓</span>
                </div>
                <span>Ajouter de nouvelles fonctionnalités islamiques</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary">✓</span>
                </div>
                <span>Améliorer l'expérience utilisateur</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary">✓</span>
                </div>
                <span>Garder le module islamique 100% gratuit</span>
              </li>
            </ul>
          </Card>

          {/* Dua */}
          <Card className="p-6 text-center bg-primary/5">
            <p className="font-arabic text-xl mb-2">جَزَاكَ اللَّهُ خَيْرًا</p>
            <p className="text-muted-foreground">Qu'Allah vous récompense par le bien</p>
          </Card>

          {/* Back link */}
          <div className="text-center mt-8">
            <Link to="/" className="text-primary hover:underline">
              ← {t('common.back')}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SupportPage;
