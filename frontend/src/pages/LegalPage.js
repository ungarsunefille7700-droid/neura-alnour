import { SUPPORT_EMAIL } from '@/utils/contact';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// Legal pages. Everything the owner still has to provide is written [À COMPLÉTER : …] and
// highlighted, so nothing administrative is invented. To be reviewed before launch.
const UPDATED = '16 octobre 2026';

const PROCESSORS = [
  ['Cloudflare (Workers AI)', "moteur d'IA : reçoit le texte des messages pour écrire les réponses, et la réflexion de l'IA quand tu demandes à la lire en français"],
  ['Emergent', "connexion avec Google, et passerelle vers OpenAI et Google Gemini pour l'analyse d'images, certaines voix et la transcription vocale"],
  ['OpenRouter', "génération d'images (texte de la demande)"],
  ['Tavily', 'recherche sur le web, si elle est activée (texte de la question)'],
  ['Stripe', 'paiement des abonnements (Neura Al Noor ne voit jamais ta carte bancaire)'],
  ['Resend', 'envoi des e-mails (vérification, mot de passe oublié)'],
  ['MongoDB Atlas', 'base de données (compte, conversations, souvenirs)'],
  ['[À COMPLÉTER : hébergeur du site et du serveur]', "hébergement de l'application"],
  ['Aladhan', 'horaires de prière et direction de la Qibla (coordonnées géographiques)'],
  ['OpenStreetMap (Overpass, Photon, Nominatim)', 'mosquées proches et nom de la ville (coordonnées géographiques)'],
  ['AlQuran.cloud et EveryAyah', 'texte et récitations du Coran (aucune donnée personnelle)'],
  ['Google Fonts', "police d'écriture du site (ton adresse IP est vue par Google)"],
  ['PayPal', 'dons depuis la page « Soutenir », seulement si tu cliques'],
];

const DOCS = {
  'mentions-legales': {
    title: 'Mentions légales',
    sections: [
      ['Éditeur', [
        "L'application NEURA AL-NOUR est éditée par : [À COMPLÉTER : nom et prénom, ou dénomination sociale et forme de la société].",
        'Statut : [À COMPLÉTER : particulier, micro-entrepreneur ou société ; capital social le cas échéant].',
        'Adresse : [À COMPLÉTER : adresse postale].',
        'Immatriculation : [À COMPLÉTER : numéro SIREN / SIRET ou RCS, si une activité commerciale est exercée].',
        'TVA : [À COMPLÉTER : numéro de TVA intracommunautaire, ou mention « TVA non applicable, art. 293 B du CGI » si la franchise en base s\'applique].',
        `Contact : ${SUPPORT_EMAIL} — [À COMPLÉTER : téléphone].`,
        'Directeur de la publication : [À COMPLÉTER : nom].',
      ]],
      ['Hébergement', [
        'Site : [À COMPLÉTER : nom, adresse et téléphone de l\'hébergeur du site].',
        'Serveur : [À COMPLÉTER : nom, adresse et téléphone de l\'hébergeur du serveur].',
        'Base de données : MongoDB Atlas (MongoDB, Inc.) — [À COMPLÉTER : région d\'hébergement choisie].',
      ]],
      ['Intelligence artificielle', [
        "Les réponses de NEURA AL-NOUR sont écrites automatiquement par une intelligence artificielle. Elles peuvent être incomplètes ou fausses : vérifie les informations importantes.",
        "NEURA AL-NOUR n'est pas une autorité religieuse : pour une question de religion importante ou personnelle, consulte un imam ou une personne de science qualifiée. Elle ne remplace pas non plus un médecin, un avocat ou un conseiller financier.",
      ]],
      ['Propriété intellectuelle', [
        "Le nom, le logo, le design et le code de l'application appartiennent à l'éditeur, sauf mention contraire.",
        'Le texte du Coran et ses récitations proviennent de AlQuran.cloud et EveryAyah.',
        'Vidéos de rappels : [À COMPLÉTER : auteur des vidéos et autorisation de diffusion].',
      ]],
    ],
  },
  confidentialite: {
    title: 'Politique de confidentialité',
    sections: [
      ['Responsable du traitement', [
        `Le responsable du traitement de tes données est l'éditeur indiqué dans les mentions légales. Contact pour tes données : ${SUPPORT_EMAIL}.`,
      ]],
      ['Les données que nous gardons', [
        'Compte : adresse e-mail, nom, mot de passe chiffré (jamais lisible), photo si tu te connectes avec Google, double authentification si tu l\'actives.',
        'Conversations : tes messages et les réponses de l\'IA, les leçons du tuteur de langues et de l\'académie islamique, les documents et images que tu envoies.',
        "Mémoire : ce que tu confies à NEURA AL-NOUR (prénom, ville, projets, goûts…), retenu automatiquement avec la date. Tu peux la voir, la désactiver et l'effacer dans Paramètres → Mémoire. Les mots de passe et les clés ne sont jamais retenus.",
        'Voix : pendant un appel, ce que tu dis est transformé en texte pour répondre ; l\'enregistrement audio n\'est pas conservé par Neura Al Noor.',
        "Position : seulement si tu l'autorises, pour les horaires de prière, la Qibla et les mosquées proches. Elle reste enregistrée sur ton appareil.",
        'Progression : quiz, leçons, récompenses.',
        'Abonnement : offre, dates, identifiant client Stripe et historique des paiements. Ta carte bancaire est gérée uniquement par Stripe.',
        "Sécurité : sessions de connexion, appareil et adresse IP approximative, pour protéger ton compte.",
      ]],
      ['Pourquoi', [
        'Fournir le service que tu demandes (compte, conversations, mémoire, abonnement) : exécution du contrat.',
        'Protéger les comptes et empêcher les abus (limites de tentatives, quotas) : intérêt légitime.',
        'Facturation et comptabilité : obligation légale.',
        "Aucune publicité, aucune revente de données, aucun profilage commercial.",
      ]],
      ['Qui reçoit tes données', [
        'Seulement les prestataires nécessaires au fonctionnement, pour la tâche indiquée :',
      ], true],
      ['Transferts hors de l\'Union européenne', [
        "Plusieurs prestataires sont établis aux États-Unis (notamment Cloudflare, Stripe, Google, OpenAI). Les transferts reposent sur les garanties proposées par chaque prestataire (clauses contractuelles types de la Commission européenne ou Data Privacy Framework) : [À VÉRIFIER pour chaque prestataire avant la mise en ligne].",
      ]],
      ['Combien de temps', [
        'Compte et données associées : tant que le compte existe ; tout est effacé quand tu supprimes ton compte.',
        'Compte inactif : [À DÉCIDER : durée avant suppression d\'un compte inactif, par exemple 3 ans].',
        'Paiements : les pièces comptables sont gardées 10 ans (obligation légale), sans ton nom ni ton e-mail après la suppression du compte.',
        'Sessions de connexion : supprimées automatiquement à leur expiration.',
      ]],
      ['Tes droits', [
        'Accès et portabilité : Paramètres → Mes données → « Télécharger mes données ».',
        'Effacement : Paramètres → Mes données → « Supprimer mon compte ». Un souvenir précis : Paramètres → Mémoire.',
        `Rectification, opposition, limitation, directives après ton décès : écris à ${SUPPORT_EMAIL}.`,
        'Tu peux aussi saisir la CNIL (www.cnil.fr).',
      ]],
      ['Âge minimum', [
        "[À DÉCIDER : âge minimum pour créer un compte. En France, un mineur de moins de 15 ans a besoin de l'accord d'un parent pour ce type de service.]",
      ]],
      ['Sécurité', [
        "Mots de passe chiffrés, connexions chiffrées (HTTPS), double authentification possible, tentatives de connexion limitées, accès de chaque compte limité à ses propres données.",
      ]],
    ],
  },
  cgu: {
    title: "Conditions générales d'utilisation",
    sections: [
      ['Objet', [
        "Ces conditions encadrent l'utilisation de NEURA AL-NOUR : assistant IA, contenus islamiques (Coran, prières, douas, quiz, académie), tuteur de langues, appels vocaux et génération de code. Créer un compte vaut acceptation de ces conditions.",
      ]],
      ['Compte', [
        'Tu dois donner une adresse e-mail valide et garder ton mot de passe secret. Tu es responsable de ce qui est fait depuis ton compte.',
        'Âge minimum : [À DÉCIDER].',
      ]],
      ['Ce qui est interdit', [
        "Utiliser le service pour une activité illégale, harceler, insulter, publier des contenus haineux, tenter d'accéder aux données d'autres utilisateurs, contourner les quotas ou les abonnements, revendre l'accès, automatiser des requêtes en masse.",
        'En cas de manquement, le compte peut être suspendu ou supprimé.',
      ]],
      ["Les réponses de l'IA", [
        "Les réponses sont générées automatiquement et peuvent contenir des erreurs. Elles ne sont ni une fatwa, ni un avis médical, juridique ou financier.",
        "Le code généré est fourni tel quel : vérifie-le et teste-le avant de l'utiliser, surtout en production.",
      ]],
      ['Mémoire', [
        "NEURA AL-NOUR peut retenir ce que tu lui confies pour mieux t'aider ensuite. Tu peux la désactiver et l'effacer à tout moment (Paramètres → Mémoire).",
      ]],
      ['Disponibilité et quotas', [
        "Le service est fourni « en l'état ». Il peut être interrompu pour maintenance ou indisponible. L'offre gratuite a des limites d'utilisation ; elles peuvent changer.",
      ]],
      ['Tes contenus', [
        "Tu restes propriétaire de ce que tu écris et envoies. Tu nous autorises à le traiter uniquement pour te répondre et faire fonctionner le service.",
      ]],
      ['Changements', [
        "Ces conditions peuvent évoluer ; tu seras prévenu des changements importants. Dernière mise à jour : " + UPDATED + '.',
      ]],
      ['Droit applicable', [
        '[À COMPLÉTER : droit applicable (par exemple droit français) et tribunal compétent].',
      ]],
    ],
  },
  cgv: {
    title: 'Conditions générales de vente',
    sections: [
      ['Vendeur', ["Le vendeur est l'éditeur indiqué dans les mentions légales."]],
      ['Offres et prix', [
        'Les offres, leurs avantages et leurs prix sont présentés sur la page Abonnements au moment de la commande.',
        'Prix : [À COMPLÉTER : prix TTC, ou « TVA non applicable, art. 293 B du CGI »].',
      ]],
      ['Commande et paiement', [
        'Le paiement se fait par carte bancaire sur la page sécurisée de Stripe. L\'abonnement est activé dès que Stripe confirme le paiement.',
      ]],
      ['Durée et renouvellement', [
        "L'abonnement est mensuel ou annuel et se renouvelle automatiquement à la fin de chaque période, au même prix, sauf résiliation.",
      ]],
      ['Résiliation', [
        "Tu peux résilier à tout moment depuis la page Abonnements (« Annuler le renouvellement ») ou depuis l'espace de paiement Stripe. L'accès reste actif jusqu'à la fin de la période payée.",
      ]],
      ['Droit de rétractation', [
        "[À DÉCIDER : la page Abonnements indique « Remboursement possible sous 14 jours ». Soit cette promesse est gardée (remboursement sur demande dans les 14 jours), soit l'utilisateur renonce expressément à son droit de rétractation au moment du paiement pour profiter du service tout de suite. Les deux textes ne peuvent pas coexister.]",
        `Demande de remboursement : ${SUPPORT_EMAIL}.`,
      ]],
      ['Paiement refusé', [
        "Si un renouvellement échoue, l'accès payant est suspendu jusqu'à ce que le paiement soit régularisé.",
      ]],
      ['Garanties', [
        'Tu bénéficies de la garantie légale de conformité des contenus et services numériques prévue par le Code de la consommation.',
      ]],
      ['Médiation', [
        'En cas de litige, contacte-nous d\'abord. Tu peux ensuite recourir gratuitement à un médiateur de la consommation : [À COMPLÉTER : nom et site du médiateur choisi — obligatoire pour vendre à des particuliers].',
      ]],
    ],
  },
  cookies: {
    title: 'Cookies et traceurs',
    sections: [
      ['Pas de publicité ni de mesure d\'audience', [
        "NEURA AL-NOUR n'utilise aucun cookie publicitaire, aucun outil de statistiques et aucun traceur de réseaux sociaux.",
      ]],
      ['Ce qui est enregistré sur ton appareil', [
        'Ta connexion (pour rester connecté).',
        'Tes préférences : thème, langue, voix, rappels de prière et position pour les horaires, recherche web.',
        "Ces éléments sont strictement nécessaires au service que tu demandes : selon les règles de la CNIL, ils ne demandent pas de consentement. Ils restent sur ton appareil ; la déconnexion efface la connexion.",
      ]],
      ['Services extérieurs', [
        "La police d'écriture vient de Google Fonts (ton adresse IP est visible par Google). Le paiement se fait sur les pages de Stripe, et la connexion avec Google passe par Emergent : ces services ont leurs propres règles.",
      ]],
    ],
  },
};

export const LEGAL_LINKS = [
  ['/mentions-legales', 'Mentions légales'],
  ['/confidentialite', 'Confidentialité'],
  ['/cgu', 'CGU'],
  ['/cgv', 'CGV'],
  ['/cookies', 'Cookies'],
];

const Text = ({ children }) => {
  const parts = String(children).split(/(\[À (?:COMPLÉTER|DÉCIDER|VÉRIFIER)[^\]]*\])/g);
  return parts.map((part, index) => (/^\[À /.test(part)
    ? <mark key={index} className="rounded bg-amber-200 px-1 text-black">{part}</mark>
    : <span key={index}>{part}</span>));
};

export default function LegalPage() {
  const { pathname } = useLocation();
  const doc = DOCS[pathname.replace(/^\//, '')] || DOCS['mentions-legales'];
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Link>
        <h1 className="mb-1 text-3xl font-bold">{doc.title}</h1>
        <p className="mb-8 text-sm text-muted-foreground">Dernière mise à jour : {UPDATED}</p>
        {doc.sections.map(([title, paragraphs, withProcessors]) => (
          <section key={title} className="mb-6">
            <h2 className="mb-2 text-xl font-semibold">{title}</h2>
            {paragraphs.map((text) => <p key={text} className="mb-2 leading-relaxed"><Text>{text}</Text></p>)}
            {withProcessors && (
              <ul className="ml-5 list-disc space-y-1">
                {PROCESSORS.map(([name, role]) => <li key={name}><strong><Text>{name}</Text></strong> : {role}</li>)}
              </ul>
            )}
          </section>
        ))}
        <nav className="mt-10 flex flex-wrap gap-4 border-t border-border pt-6 text-sm text-muted-foreground">
          {LEGAL_LINKS.map(([to, label]) => <Link key={to} to={to} className="hover:text-foreground">{label}</Link>)}
        </nav>
      </div>
    </div>
  );
}
