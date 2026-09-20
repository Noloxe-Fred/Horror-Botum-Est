# Horror Botum Est — v2

Refonte du bot Discord du serveur Horror Humanum Est.

## Installation

```bash
npm install
cp .env.example .env
# remplir .env : TOKEN, CLIENT_ID, GUILD_ID, puis les IDs de rôles/salons
npm start
```

Les IDs de rôles/salons se récupèrent en activant le **mode développeur** dans
Discord (*Paramètres > Avancés*), puis clic droit sur le rôle/salon >
*Copier l'identifiant*.

## Architecture

```
index.js                     # bootstrap uniquement
src/
  client.js                  # création du client Discord
  config/index.js            # lecture + validation des variables d'env
  core/
    commandRegistry.js       # charge tous les modules, construit la Map de commandes
    eventHandler.js          # branche les listeners Discord sur le registre
    deployCommands.js        # déploiement des slash commands
    permissions.js           # requireAdmin() réutilisable
    withErrorHandling.js     # wrapper try/catch générique pour les commandes
  data/
    jsonStore.js             # persistance JSON générique (écriture atomique)
  modules/
    moderation/              # UNE fonctionnalité = UN dossier
      index.js                # manifeste : name, commands[]
      service.js               # logique métier partagée
      commands/
        addpurge.js
        purge.js
    quiz/                     # devine le film d'horreur à partir de son affiche floutée
      index.js                  # manifeste + boutons/modal persistants + scheduler des paliers
      service.js                 # pixélisation (Jimp), correction tolérante, Components V2
      store.js                    # état persistant (session, tentatives, scores, anti-répétition)
      tmdb.js                      # tirage TMDB d'un film d'horreur filtré
      commands/
        quiz-affiche-floutee.js
    forbidden-word/           # stub, prêt à implémenter
      index.js
```

## Ajouter un nouveau module (une nouvelle fonctionnalité)

1. Créer `src/modules/<mon-module>/index.js` qui exporte :
   ```js
   module.exports = {
     name: 'mon-module',
     commands: [],       // tableau de { data, execute }
     onMessage: async (message) => {},  // optionnel
     init: (client) => {},              // optionnel, appelé au démarrage
   };
   ```
2. Mettre **toutes** les commandes liées à cette fonctionnalité dans
   `src/modules/<mon-module>/commands/`.
3. Rien d'autre à faire : le `commandRegistry` charge automatiquement tout
   dossier présent dans `src/modules/`.

Convention : noms de dossiers en kebab-case, sans espace (ex: `forbidden-word`,
pas `le mot interdit`) pour rester compatible partout (shell, CLI, etc.).

## Changements par rapport à la v1

- **Structure par fonctionnalité** : `purge` + `addpurge` (même fonctionnalité)
  regroupées dans `modules/moderation/`, au lieu de deux dossiers séparés.
- **IDs Discord au lieu de noms** : un renommage de rôle/salon sur Discord ne
  casse plus le bot.
- **Registry de commandes en Map** : lookup en O(1) au lieu de boucler sur
  tous les modules à chaque interaction.
- **`onMessage` ciblé** : seuls les modules qui en définissent un sont notifiés
  à chaque message (avant : tous les modules étaient scannés systématiquement).
- **Persistance JSON** : chaque module gère son propre état via
  `data/jsonStore.js` (fichiers générés automatiquement dans `data-store/`,
  jamais versionnés) — le quiz par exemple répartit le sien sur plusieurs
  namespaces (`quiz-session`, `quiz-tentatives`, `quiz-scores`, `quiz-historique`).
- **Erreurs et permissions factorisées** : `withErrorHandling()` et
  `requireAdmin()` au lieu de dupliquer le try/catch dans chaque commande.
- **`rss-parser` retiré** du `package.json` : dépendance inutilisée dans le
  code d'origine.
- **`config/bot.js` vide retiré**, remplacé par `src/config/index.js` qui
  valide les variables d'environnement au démarrage (erreur explicite si
  `TOKEN`/`CLIENT_ID`/`GUILD_ID` manquent, au lieu d'un crash plus tard).

## Module en attente

`forbidden-word` (anciennement "le mot interdit") est un stub vide, prêt à
être implémenté quand tu veux — voir les commentaires dans son `index.js`.

## Quiz Affiche Floutée

- `/quiz-affiche-floutee` (réservé à `ADMIN_ROLE_ID` ou `QUIZ_MOD_ROLE_ID`) tire
  un film d'horreur au hasard sur TMDB (genre Horreur, note ≥ 5/10, sorti
  entre 1920 et aujourd'hui) et poste son affiche très pixélisée dans
  `QUIZ_CHANNEL_ID`, avec un bouton **Répondre** qui ouvre une fenêtre modale
  (champ texte libre). Le rôle `QUIZ_ROLE_JOUONS_A_UN_JEU_ID` (si configuré)
  est mentionné au lancement de chaque nouvelle manche (palier 1 uniquement,
  pas à chaque palier suivant).
- La réponse est vérifiée avec tolérance aux fautes de frappe/accents
  (distance de Levenshtein). Le retour est **éphémère** (visible seulement
  par le joueur) et ne révèle jamais le titre en cas d'erreur.
- Chaque bonne réponse est annoncée publiquement dans `QUIZ_RESPONSE_CHANNEL_ID`
  (pseudo, palier atteint, points gagnés, nombre de tentatives) — sans jamais
  répéter le texte proposé ni le titre.
- Toutes les 2 jours, une version un peu moins pixélisée est postée (4 paliers
  au total), puis le titre est révélé avec la liste des gagnants de la manche
  (points de cette manche uniquement — le score cumulé reste secret).
- Points selon le palier où la bonne réponse a été trouvée : **4** (palier 1),
  **3** (palier 2), **2** (palier 3), **1** (palier 4). Une seule réponse
  comptée par joueur (la première correcte).
- Bouton **Question suivante** sur le message de reveal (réservé
  Admin/Modérateur Quiz) pour relancer une manche immédiatement.
- Au bout de 10 manches, un palmarès cumulé est publié puis les scores sont
  remis à zéro pour un nouveau cycle.
- Dépendance ajoutée : [`jimp`](https://www.npmjs.com/package/jimp) (pur JS,
  pas de binaire natif à compiler) pour la pixélisation des affiches.
