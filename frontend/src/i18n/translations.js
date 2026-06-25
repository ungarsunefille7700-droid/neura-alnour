// UI translations. French ('fr') is the SOURCE of truth (the keys/values below).
// Other languages are generated from it. A missing key/language falls back to French,
// so the UI never shows blank text. Add languages over time (évolutif).
//
// NOTE: machine-assisted translations for the major world languages live in
// ./translations.generated.js and are merged in below.

import { GENERATED } from './translations.generated';

const FR = {
  // --- Common ---
  'common.login': 'Connexion',
  'common.logout': 'Déconnexion',
  'common.start': 'Commencer',
  'common.openChat': 'Ouvrir le Chat',
  'common.upgrade': 'Améliorer',
  'common.back': 'Retour',
  'common.send': 'Envoyer',
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.loading': 'Chargement...',
  'common.search': 'Rechercher',

  // --- Navigation ---
  'nav.quran': 'Coran',
  'nav.prayers': 'Prières',
  'nav.duas': 'Douas',
  'nav.quiz': 'Quiz',
  'nav.learn': 'Apprendre',
  'nav.developer': 'Développeur',
  'nav.support': 'Soutenir',
  'nav.chat': 'Chat',
  'nav.subscription': 'Abonnement',
  'nav.settings': 'Réglages',

  // --- Landing ---
  'landing.poweredBy': "Propulsé par l'IA NEURA",
  'landing.heroCta': 'Commencer Gratuitement',
  'landing.subtitle': "L'assistant IA intelligent qui combine intelligence artificielle moderne et spiritualité islamique.",
  'landing.exploreQuran': 'Explorer le Coran',
  'landing.freeNoCard': 'Module islamique 100% gratuit • Aucune carte bancaire requise',
  'landing.featuresTitle': 'Tout ce dont tu as besoin',
  'feat.chat.title': 'Chat IA Intelligent',
  'feat.chat.desc': "Conversations naturelles avec NEURA, une IA islamique intelligente et bienveillante.",
  'feat.quran.title': 'Coran Complet',
  'feat.quran.desc': 'Lecture et audio des 114 sourates avec traduction française.',
  'feat.prayers.title': 'Heures de Prière',
  'feat.prayers.desc': "Notifications automatiques et Adhan à l'heure exacte.",
  'feat.duas.title': 'Invocations (Douas)',
  'feat.duas.desc': "Bibliothèque complète d'invocations avec audio.",
  'feat.quiz.title': 'Quiz Islamique',
  'feat.quiz.desc': 'Testez vos connaissances avec des quiz illimités.',
  'feat.ramadan.title': 'Module Ramadan',
  'feat.ramadan.desc': 'Guide complet pour le mois sacré avec horaires.',
  'feat.qiblah.title': 'Boussole Qiblah',
  'feat.qiblah.desc': 'Trouvez la direction de La Mecque instantanément.',
  'feat.mosques.title': 'Mosquées Proches',
  'feat.mosques.desc': 'Localisez les mosquées autour de vous avec itinéraire.',
  'feat.islam.title': "Apprendre l'Islam",
  'feat.islam.desc': 'Leçons interactives avec suivi de progression.',

  // --- Chat ---
  'chat.newConversation': 'Nouvelle Discussion',
  'chat.placeholder': 'Posez votre question...',
  'chat.thinking': 'NEURA réfléchit...',
  'chat.model': 'Modèle :',
  'chat.web': 'Web',
  'chat.code': 'Code',
  'chat.disclaimer': 'NEURA AL-NOUR est une IA. Consultez un imam pour les questions complexes.',

  // --- Settings ---
  'settings.title': 'Réglages',
  'settings.language': 'Langue',
  'settings.languageDesc': "Choisissez la langue de l'application et des réponses de l'IA.",
  'settings.theme': 'Thème',
  'settings.account': 'Compte',
};

// Build the full table: French base + generated languages (generated values win
// for their language, French fills any gap).
export const TRANSLATIONS = { fr: FR, ...GENERATED };
