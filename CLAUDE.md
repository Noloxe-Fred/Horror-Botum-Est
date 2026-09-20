# Horror Botum Est v2 — contexte projet

Bot Discord (discord.js v14, CommonJS, Node >=18) pour le serveur "Horror
Humanum Est". Refonte v2 architecturée par fonctionnalité. **Le README.md
est la doc de référence** (architecture, conventions, détail de chaque
fonctionnalité) — le lire avant toute modification structurelle. Ce fichier
ne fait que résumer l'essentiel pour éviter de re-explorer tout le repo.

## Démarrer / déployer
```bash
npm install
npm start          # lance le bot (index.js)
npm run deploy      # redéploie les slash commands (src/core/deployCommands.js)
```
`.env` requis (voir `.env.example`) — `TOKEN`, `CLIENT_ID`, `GUILD_ID`
obligatoires, le reste optionnel (le bot démarre avec des warnings si absent).

## Architecture (voir README pour le détail)
- `index.js` : bootstrap uniquement.
- `src/client.js` : création du client discord.js.
- `src/config/index.js` : lecture + validation des env vars, force `TZ=Europe/Paris`.
- `src/core/` : `commandRegistry` (charge `src/modules/*` en Map), `eventHandler`
  (branche les listeners), `deployCommands`, `permissions.requireAdmin()`,
  `withErrorHandling()` (wrapper try/catch générique).
- `src/data/jsonStore.js` : persistance JSON générique (écriture atomique),
  fichiers générés dans `data-store/` (jamais versionné).
- `src/modules/<feature>/` : **une fonctionnalité = un dossier**, avec
  `index.js` (manifeste : `name`, `commands[]`, `buttons[]`, `modals[]`,
  `onMessage`, `init`), `service.js` (logique métier), `store.js` (état
  persistant si besoin), `commands/*.js`.

Modules existants : `moderation` (purge/addpurge), `quiz` (quiz-affiche-floutée,
pixélisation Jimp + TMDB), `cine-club` (poll/host/arrache/etc, intégration
TMDB), `forbidden-word` (stub vide, pas encore implémenté).

## Conventions
- Dossiers de modules en kebab-case (contrainte shell/CLI).
- IDs Discord (rôles/salons) via env vars, jamais de noms en dur.
- Nouveau module : créer `src/modules/<nom>/index.js` exportant `name` +
  `commands` (+ optionnel `onMessage`/`init`/`buttons`/`modals`) — le
  `commandRegistry` le charge automatiquement, rien d'autre à faire.
- `customId` des boutons/modals persistants : format `<prefix>:<reste>`,
  le préfixe sert de clé de dispatch O(1) dans le registry.

## Pas de repo git pour l'instant
Le dossier n'était pas encore versionné (au 2026-09-20). `.gitignore` déjà
présent et correct (`node_modules/`, `.env`, `data-store/`, `npm-debug.log`).
