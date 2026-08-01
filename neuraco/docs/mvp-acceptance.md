# NeuraCo — matrice d’acceptation MVP

Date de contrôle : 2026-08-01

Statuts : **Validé** = preuve automatique ou exécution réelle ; **Partiel** = code et tests présents mais cycle installé incomplet ; **Bloqué externe** = dépendance absente qui ne peut pas être simulée.

| Critère | Statut | Preuve |
| --- | --- | --- |
| Installer NeuraCo sur Windows | Bloqué externe | l’artefact existant est `NotSigned`; `forceCodeSigning` interdit désormais une nouvelle distribution non signée |
| Créer un compte | Validé | routes d’inscription/authentification et tests backend de sécurité |
| Ouvrir un dossier de projet | Validé | application Electron exécutée et `workspace-core.test.ts` |
| Poser une question sur son code | Validé hors appel payant | contrat agent, contexte projet et tests `agent-service`/`WorkspacePage` ; aucun crédit réel consommé pendant ce contrôle |
| Voir les fichiers lus | Validé | journal d’activité, rapport et preuves machine |
| Demander une modification | Validé | planification, éditeur et service agent connectés |
| Recevoir un plan | Validé | flux de plan et test de workspace |
| Approuver le plan | Validé | dialogue de permissions et décisions persistées |
| Voir les fichiers modifiés | Validé | éditeur et activité enregistrent les écritures réelles |
| Examiner chaque différence | Validé | revue par fichier/hunk et tests `diff-review` |
| Accepter ou refuser les changements | Validé | file de revue persistante et tests UI/service |
| Lancer les tests | Validé | terminal et commandes de test réels |
| Voir la sortie du terminal | Validé | flux stdout/stderr borné et test renderer |
| Arrêter une commande | Validé | annulation, arrêt d’urgence et Job Object Windows |
| Restaurer un checkpoint | Validé | restauration réelle d’un fichier écrasé dans `recovery-service.test.ts` |
| Consulter sa consommation | Validé | usage serveur affiché et tests `usage-service` |
| Fixer un plafond | Validé | préférences de dépense persistées côté serveur |
| Reprendre une ancienne session | Validé | stockage local atomique et tests de reprise |
| Fermer sans perdre le travail | Validé en mode développement | persistance locale et reprise testées ; reste à confirmer dans le build signé installé |
| Vérifier qu’aucun dossier non autorisé n’a été consulté | Validé | résolution canonique, rejet des traversées et journal des fichiers lus |

## Résultats machine

- Build complet : réussi.
- Suite NeuraCo : 78 fichiers, 298 tests réussis.
- Backend ciblé authentification/accès/administration/facturation/appareils/confidentialité : 65 tests réussis.
- Compilation Python : réussie avec `python -m py_compile backend/server.py`.
- Audit des dépendances de production : 0 vulnérabilité avec `npm audit --omit=dev --audit-level=high`.
- Sorties de build : aucun fichier de test compilé et aucun jeton sensible détecté dans `dist`, `dist-electron`, `dist-cli` et `dist-sdk`.
- Application Electron : lancement réel réussi.
- Schéma SQLite cible : 24 objets créés en mémoire.
- Installateur historique : 102 201 240 octets.
- SHA-256 historique : `7FC205098C673C52701F386AC05AA68A19B0BFCF2363241431A2774169682B3E`.
- Signature de l’installateur historique : `NotSigned`.

## Décision d’acceptation

Le MVP applicatif local est fonctionnel et couvert par les tests. La distribution Windows publique n’est **pas acceptée** tant qu’un certificat Authenticode officiel n’a pas permis de générer, vérifier, installer, désinstaller, réinstaller et mettre à jour un nouvel installateur signé. L’ancien exécutable non signé ne doit pas être publié comme version finale.

## Cycle requis après fourniture du certificat

1. Configurer le certificat uniquement dans l’environnement de build sécurisé.
2. Exécuter `npm run dist:win`.
3. Vérifier la signature de l’EXE et de l’installateur.
4. Installer dans un environnement Windows propre.
5. Tester lancement, connexion, projet, tâche, checkpoint et reprise.
6. Tester désinstallation en conservant les projets personnels.
7. Réinstaller puis tester une mise à jour signée et un rollback.
8. Remplacer cette matrice par les preuves du build installé.
