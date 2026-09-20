const config = require('../../config');

const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w500';

function ensureKey() {
  if (!config.tmdb.apiKey) {
    throw new Error(
      "TMDB_API_KEY n'est pas défini dans .env — impossible d'interroger TMDB."
    );
  }
}

async function tmdbFetch(pathname, params = {}) {
  ensureKey();

  const url = new URL(`${BASE_URL}${pathname}`);
  url.searchParams.set('api_key', config.tmdb.apiKey);
  url.searchParams.set('language', 'fr-FR');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`[TMDB] Erreur HTTP ${response.status} sur ${pathname}`);
  }
  return response.json();
}

/**
 * Normalise un résultat brut TMDB (recherche ou détails) vers un format
 * unique utilisé partout ailleurs dans le module.
 *
 * `raw.credits` n'est présent que si l'appel a demandé
 * `append_to_response=credits` (voir getDetails) — absent sur les résultats
 * de recherche (/search/multi), d'où les garde-fous partout ci-dessous.
 */
function normalize(raw, mediaType) {
  const titre = mediaType === 'tv' ? raw.name : raw.title;
  const dateSortie = mediaType === 'tv' ? raw.first_air_date : raw.release_date;
  const duree =
    mediaType === 'tv'
      ? (raw.episode_run_time && raw.episode_run_time[0]) || null
      : raw.runtime || null;

  // Réalisation : un vrai "Director" pour un film, les créateurs pour une
  // série (TMDB n'a pas de notion de réalisateur unique pour une série).
  const realisateur =
    mediaType === 'tv'
      ? (raw.created_by || []).map((c) => c.name).join(', ') || null
      : ((raw.credits && raw.credits.crew) || []).find((c) => c.job === 'Director')?.name || null;

  // 4 premiers acteurs du casting, dans l'ordre TMDB (ordre de billing).
  const casting = ((raw.credits && raw.credits.cast) || []).slice(0, 4).map((c) => c.name);

  // Pays d'origine : production_countries (noms complets) en priorité,
  // sinon origin_country (codes ISO, moins parlant mais toujours dispo).
  const pays =
    raw.production_countries && raw.production_countries.length
      ? raw.production_countries.map((c) => c.name).join(', ')
      : (raw.origin_country || []).join(', ') || null;

  return {
    tmdbId: raw.id,
    mediaType,
    titre: titre || 'Titre inconnu',
    dateSortie: dateSortie || null,
    overview: raw.overview || 'Pas de synopsis disponible.',
    voteAverage: typeof raw.vote_average === 'number' ? Math.round(raw.vote_average * 10) / 10 : null,
    posterUrl: raw.poster_path ? `${IMG_BASE}${raw.poster_path}` : null,
    duree,
    genres: (raw.genres || []).map((g) => g.name),
    genreIds: raw.genre_ids || (raw.genres || []).map((g) => g.id),
    realisateur,
    casting,
    pays,
  };
}

/**
 * Recherche multi (films + séries) sur un titre. Retourne les meilleurs
 * résultats normalisés, triés par popularité décroissante (ordre TMDB natif).
 */
async function searchMulti(query, { limit = 10 } = {}) {
  const data = await tmdbFetch('/search/multi', { query, include_adult: false });
  const results = (data.results || []).filter(
    (r) => r.media_type === 'movie' || r.media_type === 'tv'
  );
  return results.slice(0, limit).map((r) => normalize(r, r.media_type));
}

/**
 * Récupère les détails complets (durée, genres, réalisation, casting,
 * pays...) d'un titre déjà identifié par son ID + type de média — utile car
 * /search/multi ne renvoie pas ces infos. `append_to_response=credits`
 * ramène cast/crew en un seul appel (pas de requête TMDB séparée).
 */
async function getDetails(tmdbId, mediaType) {
  const pathname = mediaType === 'tv' ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
  const data = await tmdbFetch(pathname, { append_to_response: 'credits' });
  return normalize(data, mediaType);
}

/**
 * Résout un titre texte libre en fiche TMDB complète (recherche + détails).
 * Lève une erreur si aucun résultat.
 */
async function resolveTitle(query) {
  const results = await searchMulti(query, { limit: 1 });
  if (results.length === 0) {
    throw new Error(`Aucun résultat TMDB pour "${query}".`);
  }
  return getDetails(results[0].tmdbId, results[0].mediaType);
}

/**
 * URL publique de la fiche TMDB, utilisée pour le bouton "Voir la fiche
 * TMDB" (Discord ne permet pas de rendre une image cliquable vers une URL
 * externe, ni en embed classique ni en Components V2 — un bouton lien est
 * la seule option native).
 */
function urlFiche({ tmdbId, mediaType }) {
  return `https://www.themoviedb.org/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}`;
}

module.exports = { searchMulti, getDetails, resolveTitle, urlFiche };
