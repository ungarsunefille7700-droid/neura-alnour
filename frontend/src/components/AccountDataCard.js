import { useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Download, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const errorText = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.message) return detail.message;
  return fallback;
};

// The user's rights over their data (GDPR): get a copy of everything, or erase the account.
export default function AccountDataCard() {
  const { user, getAuthHeader, logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const googleOnly = user && user.has_password === false;

  const download = async () => {
    setExporting(true);
    try {
      const response = await axios.get(`${API}/auth/account/export`, { headers: getAuthHeader(), responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mes-donnees-neura-al-noor.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error("Impossible de préparer tes données. Réessaie plus tard.");
    } finally {
      setExporting(false);
    }
  };

  const remove = async (event) => {
    event.preventDefault();
    setDeleting(true);
    try {
      await axios.post(`${API}/auth/account/delete`, {
        confirmation_email: email.trim(),
        ...(password ? { password } : {}),
        ...(code.trim() ? { two_factor_code: code.trim() } : {}),
      }, { headers: getAuthHeader() });
      toast.success('Ton compte et tes données ont été supprimés.');
      logout();
      window.location.href = '/';
    } catch (error) {
      toast.error(errorText(error, 'La suppression a échoué.'));
      setDeleting(false);
    }
  };

  return (
    <Card className="p-6 mb-6" data-testid="account-data-section">
      <h3 className="font-semibold mb-1 flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary" />
        Mes données
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Télécharge une copie de tout ce que NEURA AL-NOUR garde sur toi (profil, conversations, souvenirs,
        progression), ou supprime définitivement ton compte.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={download} disabled={exporting} data-testid="account-export">
          {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          Télécharger mes données
        </Button>
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setOpen((value) => !value)}
          data-testid="account-delete-open">
          <Trash2 className="w-4 h-4 mr-2" /> Supprimer mon compte
        </Button>
      </div>
      {open && (
        <form onSubmit={remove} className="mt-4 space-y-3 rounded-md border border-destructive/40 p-4" data-testid="account-delete-form">
          <p className="text-sm">
            Tout sera effacé : conversations, souvenirs, progression. Un abonnement en cours est résilié.
            C'est définitif.
          </p>
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)}
            placeholder="Ton adresse e-mail pour confirmer" autoComplete="email"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" data-testid="account-delete-email" />
          {!googleOnly && (
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)}
              placeholder="Ton mot de passe" autoComplete="current-password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" data-testid="account-delete-password" />
          )}
          {user?.two_factor_enabled && (
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Code de double authentification"
              inputMode="numeric" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          )}
          <Button type="submit" variant="destructive" size="sm" disabled={deleting || !email.trim()} data-testid="account-delete-confirm">
            {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Supprimer définitivement
          </Button>
        </form>
      )}
    </Card>
  );
}
