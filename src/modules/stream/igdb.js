// Source complémentaire de Steam (voir jeux.js) : résumés en anglais, mais
// jeux console et anciens absents de Steam.

const config = require('../../config');

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const GAMES_URL = 'https://api.igdb.com/v4/games';
const IMG_BASE = 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x';
const MARGE_EXPIRATION_MS = 60 * 1000;

const CHAMPS = [
  'name',
  'summary',
  'first_release_date',
  'total_rating',
  'url',
  'cover.image_id',
  'genres.name',
  'platforms.abbreviation',
  'involved_companies.developer',
  'involved_companies.company.name',
].join(',');

// Jeton d'application Twitch, gardé en mémoire : il dure environ 60 jours et
// s'obtient en un appel, inutile de le persister.
let jeton = null;

function estConfigure() {
  return Boolean(config.igdb.clientId && config.igdb.clientSecret);
}

async function obtenirJeton() {
  if (jeton && jeton.expireA > Date.now()) return jeton.valeur;

  const { clientId, clientSecret } = config.igdb;
  if (!clientId || !clientSecret) {
    throw new Error(
      "TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET ne sont pas définis dans .env — impossible d'interroger IGDB."
    );
  }

  const url = new URL(TOKEN_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  const response = await fetch(url.toString(), { method: 'POST' });
  if (!response.ok) {
    throw new Error(`[IGDB] Erreur HTTP ${response.status} à l'obtention du jeton Twitch`);
  }
  const data = await response.json();
  jeton = {
    valeur: data.access_token,
    expireA: Date.now() + data.expires_in * 1000 - MARGE_EXPIRATION_MS,
  };
  return jeton.valeur;
}

async function igdbFetch(requete) {
  const envoyer = async () =>
    fetch(GAMES_URL, {
      method: 'POST',
      headers: {
        'Client-ID': config.igdb.clientId,
        Authorization: `Bearer ${await obtenirJeton()}`,
        Accept: 'application/json',
      },
      body: requete,
    });

  let response = await envoyer();
  // Jeton révoqué avant son expiration annoncée : on en redemande un, une fois.
  if (response.status === 401) {
    jeton = null;
    response = await envoyer();
  }
  if (!response.ok) {
    throw new Error(`[IGDB] Erreur HTTP ${response.status} sur /games`);
  }
  return response.json();
}

/**
 * Normalise un jeu IGDB vers le format utilisé par le module. La recherche
 * demande déjà tous les champs : pas de second appel "détails" comme TMDB.
 */
function normalize(raw) {
  const developpeur = (raw.involved_companies || []).find((c) => c.developer)?.company?.name || null;

  return {
    id: raw.id,
    source: 'IGDB',
    titre: raw.name || 'Titre inconnu',
    // Timestamp Unix en secondes -> jour calendaire "AAAA-MM-JJ".
    dateSortie: raw.first_release_date ? new Date(raw.first_release_date * 1000).toISOString().slice(0, 10) : null,
    overview: raw.summary || 'Pas de description disponible.',
    // IGDB note sur 100, ramené sur 10 comme les fiches TMDB.
    note: typeof raw.total_rating === 'number' ? Math.round(raw.total_rating) / 10 : null,
    coverUrl: raw.cover?.image_id ? `${IMG_BASE}/${raw.cover.image_id}.jpg` : null,
    genres: (raw.genres || []).map((g) => g.name).filter(Boolean),
    plateformes: (raw.platforms || []).map((p) => p.abbreviation).filter(Boolean),
    developpeur,
    url: raw.url || null,
  };
}

/**
 * Recherche un jeu par titre. `version_parent = null` écarte les éditions
 * (GOTY, Deluxe...) qui doublonnent le jeu de base dans les résultats.
 */
async function rechercher(titre, { limit = 10 } = {}) {
  const recherche = titre.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const data = await igdbFetch(
    `fields ${CHAMPS}; search "${recherche}"; where version_parent = null; limit ${limit};`
  );
  return data.map(normalize);
}

module.exports = { estConfigure, rechercher };
