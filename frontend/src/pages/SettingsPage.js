import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { 
  Settings as SettingsIcon,
  Sun,
  Moon,
  Home,
  Sparkles,
  Bell,
  Globe,
  Shield,
  LogOut,
  User,
  CreditCard,
  ChevronRight,
  ArrowLeft
} from 'lucide-react';

const SettingsPage = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { language, setLanguage, languages } = useLanguage();
  const navigate = useNavigate();
  
  const [notifications, setNotifications] = useState(true);
  const [prayerReminders, setPrayerReminders] = useState(true);

  const handleLogout = () => {
    logout();
    toast.success('Déconnexion réussie');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 glass">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Retour
            </Button>
          </div>
          
          <div className="flex items-center gap-2">
            <Link to="/" className="p-2 rounded-full hover:bg-muted transition-colors">
              <Home className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-20 pb-12 px-4">
        <div className="max-w-2xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-8">
            <SettingsIcon className="w-16 h-16 text-primary mx-auto mb-4" />
            <h1 className="text-4xl font-bold mb-2">Paramètres</h1>
            <p className="text-muted-foreground">Personnalisez votre expérience</p>
          </div>

          {/* Profile Section */}
          <Card className="p-6 mb-6" data-testid="profile-section">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">
                  {user?.name?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{user?.name}</h3>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`
                    px-2 py-0.5 rounded-full text-xs font-medium
                    ${user?.is_vip ? 'bg-secondary text-secondary-foreground' : 'bg-primary/10 text-primary'}
                  `}>
                    {user?.is_vip ? '👑 VIP Admin' : user?.subscription?.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Appearance */}
          <Card className="p-6 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Sun className="w-5 h-5 text-primary" />
              Apparence
            </h3>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="theme-toggle" className="font-medium">Mode sombre</Label>
                <p className="text-sm text-muted-foreground">Activer le thème sombre islamique</p>
              </div>
              <Switch
                id="theme-toggle"
                checked={theme === 'dark'}
                onCheckedChange={toggleTheme}
                data-testid="theme-toggle"
              />
            </div>
          </Card>

          {/* Language */}
          <Card className="p-6 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              Langue
            </h3>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="language-select" className="font-medium">Langue de l'application</Label>
                <p className="text-sm text-muted-foreground">L'assistant répondra dans cette langue</p>
              </div>
              <select
                id="language-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="rounded-lg bg-muted px-3 py-2 text-sm border-0 outline-none cursor-pointer max-w-[180px]"
                data-testid="language-select"
              >
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>{l.native}</option>
                ))}
              </select>
            </div>
          </Card>

          {/* Notifications */}
          <Card className="p-6 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Notifications
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="notifications-toggle" className="font-medium">Notifications</Label>
                  <p className="text-sm text-muted-foreground">Recevoir les notifications de l'app</p>
                </div>
                <Switch
                  id="notifications-toggle"
                  checked={notifications}
                  onCheckedChange={setNotifications}
                  data-testid="notifications-toggle"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="prayer-toggle" className="font-medium">Rappels de prière</Label>
                  <p className="text-sm text-muted-foreground">Notifications 5 min avant chaque prière</p>
                </div>
                <Switch
                  id="prayer-toggle"
                  checked={prayerReminders}
                  onCheckedChange={setPrayerReminders}
                  data-testid="prayer-toggle"
                />
              </div>
            </div>
          </Card>

          {/* Quick Links */}
          <Card className="p-2 mb-6">
            <Link 
              to="/subscription" 
              className="flex items-center justify-between p-4 rounded-lg hover:bg-muted transition-colors"
              data-testid="subscription-link"
            >
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-medium">Abonnement</p>
                  <p className="text-sm text-muted-foreground">Gérer votre plan</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </Link>
          </Card>

          {/* Privacy */}
          <Card className="p-6 mb-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Confidentialité
            </h3>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>• Vos conversations sont privées et sécurisées</p>
              <p>• Nous ne vendons jamais vos données</p>
              <p>• Conforme au RGPD</p>
              <p>• Données stockées en Europe</p>
            </div>
          </Card>

          {/* Logout */}
          <Button 
            variant="destructive" 
            className="w-full rounded-full"
            onClick={handleLogout}
            data-testid="logout-btn"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Se déconnecter
          </Button>

          {/* Footer Info */}
          <div className="text-center mt-8 text-sm text-muted-foreground">
            <p>NEURA AL-NOUR v1.0.0</p>
            <p className="mt-1">© 2024 NEURA AL-NOUR. Tous droits réservés.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SettingsPage;
