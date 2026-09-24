// Premiers segments d'URL letterboxd.com qui ne sont PAS des pseudos
// (pages de films, listes, pages du site…). Un lien letterboxd.com/film/xxx
// partagé dans le salon ne doit pas être pris pour un profil.
const CHEMINS_RESERVES = new Set([
  'film', 'films', 'list', 'lists', 'journal', 'about', 'pro', 'patron',
  'search', 'members', 'people', 'actor', 'director', 'crew', 'tag', 'tags',
  'year', 'decade', 'genre', 'reviews', 'activity', 'settings', 'sign-in',
  'create-account', 'apps', 'welcome', 'legal', 'contact', 'gift-guide',
  'showdown', 'season', 'studio', 'country', 'language', 'watchlist', 'hq',
]);

// letterboxd.com/<pseudo>[/...] ou boxd.it/<code>, avec ou sans
// protocole / www. Pseudos Letterboxd : lettres, chiffres, underscore.
const REGEX_LIEN = /(?:https?:\/\/)?(?:www\.)?(?:letterboxd\.com\/([A-Za-z0-9_-]+)|boxd\.it\/([A-Za-z0-9]+))/gi;

/**
 * Cherche le premier lien de profil Letterboxd dans un texte.
 * Retourne { url, label } normalisé, ou null.
 *  - letterboxd.com/Pseudo/films → https://letterboxd.com/pseudo/
 *  - boxd.it/AbC12 → https://boxd.it/AbC12 (code sensible à la casse,
 *    on le garde tel quel)
 */
function extraireLienLetterboxd(texte) {
  if (!texte) return null;

  for (const match of texte.matchAll(REGEX_LIEN)) {
    const [, pseudo, code] = match;

    if (pseudo) {
      const p = pseudo.toLowerCase();
      if (CHEMINS_RESERVES.has(p)) continue;
      return { url: `https://letterboxd.com/${p}/`, label: `letterboxd.com/${p}` };
    }

    if (code) {
      return { url: `https://boxd.it/${code}`, label: `boxd.it/${code}` };
    }
  }

  return null;
}

/** Récupère TOUS les messages d'un salon (pagination par paquets de 100). */
async function fetchTousLesMessages(channel) {
  const messages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  return messages;
}

/** Texte à analyser : contenu du message + URL/titre/description des embeds. */
function texteDuMessage(message) {
  const morceaux = [message.content];
  for (const embed of message.embeds) {
    morceaux.push(embed.url, embed.title, embed.description);
  }
  return morceaux.filter(Boolean).join('\n');
}

/**
 * Scanne un salon et construit l'annuaire { userId: profil }.
 * Pour chaque membre, on garde le lien du message le plus récent qui en
 * contient un (les messages arrivent du plus récent au plus ancien).
 * Les bots et les membres ayant quitté le serveur sont ignorés.
 */
async function scannerSalon(channel) {
  const [messages, membres] = await Promise.all([
    fetchTousLesMessages(channel),
    channel.guild.members.fetch(),
  ]);

  const profils = {};
  const auteurs = new Set();
  const auteursPartis = new Set();

  for (const message of messages) {
    if (message.author.bot) continue;
    const userId = message.author.id;
    auteurs.add(userId);
    if (profils[userId]) continue;

    const lien = extraireLienLetterboxd(texteDuMessage(message));
    if (!lien) continue;

    const membre = membres.get(userId);
    if (!membre) {
      auteursPartis.add(userId);
      continue;
    }

    profils[userId] = {
      userId,
      displayName: membre.displayName,
      url: lien.url,
      label: lien.label,
      messageUrl: message.url,
    };
  }

  const nbAvecLien = Object.keys(profils).length;
  return {
    profils,
    nbMessages: messages.length,
    nbSansLien: auteurs.size - nbAvecLien - auteursPartis.size,
    nbPartis: auteursPartis.size,
  };
}

module.exports = { extraireLienLetterboxd, scannerSalon };
