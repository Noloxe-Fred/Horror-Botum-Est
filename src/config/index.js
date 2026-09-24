require('dotenv').config();

// Force le fuseau horaire du process à Europe/Paris. Sans ça, tous les
// calculs de dates du module ciné-club (dateUtils.js, qui utilise
// Date.setHours en heure LOCALE du serveur) supposent implicitement que le
// serveur tourne à l'heure de Paris. Sur la plupart des hébergeurs, le
// serveur tourne par défaut en UTC : "21h" calculé par setHours(21) devenait
// alors 21h UTC = 23h Paris (été), d'où le décalage de 2h observé entre
// l'heure affichée dans le component V2 (qui utilisait aussi le fuseau
// système par défaut, donc affichait "21h" sans le corriger) et l'heure
// réelle de l'event Discord natif (qui, lui, convertit correctement l'UTC
// stocké vers le fuseau de chaque utilisateur).
process.env.TZ = 'Europe/Paris';

// Variables obligatoires : sans elles, le bot ne peut pas démarrer correctement.
const REQUIRED = ['TOKEN', 'CLIENT_ID', 'GUILD_ID'];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `[CONFIG] Variables d'environnement manquantes dans .env : ${missing.join(', ')}`
  );
}

// Variables optionnelles : on prévient juste dans la console si elles manquent,
// car certaines fonctionnalités (rôles/salons ciblés) ne marcheront pas sans,
// mais ça ne doit pas empêcher le bot de démarrer.
const OPTIONAL = [
  'PURGE_ROLE_ID',
  'ADMIN_ROLE_ID',
  // --- Quiz (module réintroduit : /quiz-affiche-floutee) ---
  'QUIZ_MOD_ROLE_ID',
  'QUIZ_CHANNEL_ID',
  'QUIZ_RESPONSE_CHANNEL_ID',
  'QUIZ_ROLE_JOUONS_A_UN_JEU_ID',
  // --- Ciné-Club ---
  'TMDB_API_KEY',
  'CINE_CLUB_CHANNEL_ID',
  'CINE_CLUB_CHANNEL_ARRACHE_ID',
  'CINE_CLUB_CHANNEL_SERIE_ID',
  'CINE_CLUB_STREAMER_ROLE_ID',
  'CINE_CLUB_ROLE_SEANCES_CINE_ID',
  'CINE_CLUB_ROLE_CINE_CLASSIQUES_ID',
  'CINE_CLUB_ROLE_COURTS_METRAGES_ID',
  'CINE_CLUB_ROLE_SEANCES_SERIE_ID',
  'CINE_CLUB_ROLE_ARRACHE_ID',
  // --- Letterboxd ---
  'SOCIAL_NETWORKS_CHANNEL_ID',
];

for (const key of OPTIONAL) {
  if (!process.env[key]) {
    console.warn(`[CONFIG] ⚠️  ${key} n'est pas défini dans .env — certaines fonctionnalités seront limitées.`);
  }
}

module.exports = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  // 'guild' = déploiement instantané sur un seul serveur (par défaut)
  // 'global' = déploiement sur tous les serveurs (jusqu'à 1h de propagation)
  commandScope: process.env.COMMAND_SCOPE || 'guild',

  roles: {
    purgeId: process.env.PURGE_ROLE_ID || null,
    adminId: process.env.ADMIN_ROLE_ID || null,
    quizModeratorId: process.env.QUIZ_MOD_ROLE_ID || null,
    // Rôle "Jouons à un jeu" — mentionné au lancement de chaque nouvelle
    // manche de quiz (palier 1 uniquement, pas à chaque palier suivant,
    // pour ne pas spammer les abonnés tous les 2 jours sur la même manche).
    quizPingRoleId: process.env.QUIZ_ROLE_JOUONS_A_UN_JEU_ID || null,
  },

  channels: {
    quizId: process.env.QUIZ_CHANNEL_ID || null,
    quizResponseId: process.env.QUIZ_RESPONSE_CHANNEL_ID || null,
    // Salon où chaque membre partage ses réseaux sociaux (scanné par
    // /scan-letterbox).
    socialNetworksId: process.env.SOCIAL_NETWORKS_CHANNEL_ID || null,
  },

  messages: {
    purgeKick:
      `Le serveur Discord horrifique Horror Humanum Est a lancé sa purge de membres inactifs. ` +
      `Comme vous n'avez pas mentionné vouloir rester sur le serveur, vous avez été exclu.\n\n` +
      `Cette exclusion n'est pas définitive du tout, ou s'il s'agit d'une erreur, vous pouvez à ` +
      `tout moment revenir parler horreur avec nous en utilisant le lien suivant : ` +
      `https://discord.gg/jXN2UV6T7v`,
  },

  // --- Ciné-Club ---
  tmdb: {
    apiKey: process.env.TMDB_API_KEY || null,
  },

  cineClub: {
    channelId: process.env.CINE_CLUB_CHANNEL_ID || null,
    // Salons d'annonce dédiés : si non configurés, on retombe sur channelId
    // (comportement d'origine). channelId reste aussi le salon où /cine doit
    // être lancée (requireChannel).
    channelArracheId: process.env.CINE_CLUB_CHANNEL_ARRACHE_ID || null,
    channelSerieId: process.env.CINE_CLUB_CHANNEL_SERIE_ID || null,
    streamerRoleId: process.env.CINE_CLUB_STREAMER_ROLE_ID || null,
    roles: {
      seancesCine: process.env.CINE_CLUB_ROLE_SEANCES_CINE_ID || null,
      cineClassiques: process.env.CINE_CLUB_ROLE_CINE_CLASSIQUES_ID || null,
      courtsMetrages: process.env.CINE_CLUB_ROLE_COURTS_METRAGES_ID || null,
      seancesSerie: process.env.CINE_CLUB_ROLE_SEANCES_SERIE_ID || null,
      arrache: process.env.CINE_CLUB_ROLE_ARRACHE_ID || null,
    },
  },
};
