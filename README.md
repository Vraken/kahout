# Kahut 🎮

Application de quiz en temps réel - Créez vos quiz et jouez avec vos amis !

## Fonctionnalités

### Création de quiz
- Création illimitée de quiz personnalisés
- Trois types de questions :
  - **Choix unique** - Une seule réponse correcte
  - **Choix multiple** - Plusieurs réponses possibles
  - **Vrai/Faux** - Réponse binaire
- Ajout d'images aux questions
- Timer personnalisable (5s à 60s par question)
- Option de mélange des réponses
- Sauvegarde automatique
- Édition via lien sécurisé (ID + token)

### Mode jeu
- Code PIN à 6 chiffres pour rejoindre une partie
- Salle d'attente (lobby) pour voir les joueurs connectés
- Affichage des questions en temps réel
- Système de score basé sur la rapidité
- Tableau des scores (leaderboard)
- Support jusqu'à 100 joueurs simultanés


### Modération
- Filtrage des pseudos grossiers (français, anglais, espagnol)
- Nettoyage automatique des quiz inactifs (30 jours)
- Nettoyage automatique des images orphelines


## Technologies

- **Backend** : Node.js, Express, WebSocket (ws)
- **Frontend** : HTML, CSS, JavaScript vanilla
- **Stockage** : Fichiers JSON (pas de base de données)
- **Upload** : Multer (images)

