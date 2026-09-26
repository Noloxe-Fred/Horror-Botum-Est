const config = require('../../config');

// Wrapper TMDB propre au module quiz (recherche par critères via /discover,
// différent du besoin du ciné-club qui résout un titre texte libre). Garder
// chaque module autonome plutôt que de partager un tmdb.js commun, conformément
// à la convention "un dossier de module = une fonctionnalité complète".

const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w500';

const GENRE_HORREUR = 27; // ID de genre TMDB pour "Horreur"
const NOTE_MIN = 5; // 5/10 = 50%, seuil validé avec l'utilisateur
const VOTES_MIN = 200; // évite les films avec 1-2 votes non représentatifs (hypothèse, à ajuster si besoin)
const ANNEE_MIN = '1920-01-01';
const MAX_PAGES_TMDB = 500; // limite dure de l'API /discover
const MAX_TENTATIVES_TIRAGE = 8; // nombre de pages aléatoires essayées avant d'abandonner

function ensureKey() {
  if (!config.tmdb.apiKey) {
    throw new Error("TMDB_API_KEY n'est pas défini dans .env — impossible d'interroger TMDB.");
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
    throw new Error(`[QUIZ][TMDB] Erreur HTTP ${response.status} sur ${pathname}`);
  }
  return response.json();
}

function normalize(raw) {
  return {
    tmdbId: raw.id,
    titre: raw.title || 'Titre inconnu',
    // Accepté aussi comme réponse valide : certains films d'horreur gardent
    // leur titre anglais même dans les résultats fr-FR.
    titreOriginal: raw.original_title && raw.original_title !== raw.title ? raw.original_title : null,
    dateSortie: raw.release_date || null,
    overview: raw.overview || 'Pas de synopsis disponible.',
    voteAverage: typeof raw.vote_average === 'number' ? Math.round(raw.vote_average * 10) / 10 : null,
    posterUrl: raw.poster_path ? `${IMG_BASE}${raw.poster_path}` : null,
  };
}

async function discoverPage(page) {
  return tmdbFetch('/discover/movie', {
    with_genres: GENRE_HORREUR,
    'vote_average.gte': NOTE_MIN,
    'vote_count.gte': VOTES_MIN,
    'primary_release_date.gte': ANNEE_MIN,
    'primary_release_date.lte': new Date().toISOString().slice(0, 10),
    include_adult: false,
    sort_by: 'popularity.desc',
    page,
  });
}

/**
 * Tire un film d'horreur au hasard parmi les résultats TMDB filtrés
 * (genre Horreur, note >= 5/10, sorti entre 1920 et aujourd'hui), en
 * excluant les tmdbId déjà utilisés dans un quiz précédent (anti-répétition).
 * Pioche une page aléatoire à chaque tentative pour varier les résultats
 * plutôt que de toujours retomber sur les films les plus populaires.
 *
 * Renvoie `null` si aucun candidat neuf n'est trouvé après plusieurs
 * tentatives — à l'appelant de décider (ex: réinitialiser l'historique).
 */
async function tirerFilmHorreurAleatoire({ excludeIds = [] } = {}) {
  const excludeSet = new Set(excludeIds.map(String));

  const premierePage = await discoverPage(1);
  const totalPages = Math.min(premierePage.total_pages || 1, MAX_PAGES_TMDB);

  for (let tentative = 0; tentative < MAX_TENTATIVES_TIRAGE; tentative++) {
    const pageAleatoire = Math.floor(Math.random() * totalPages) + 1;
    const data = pageAleatoire === 1 ? premierePage : await discoverPage(pageAleatoire);

    const candidats = (data.results || []).filter(
      (r) => r.poster_path && !excludeSet.has(String(r.id))
    );

    if (candidats.length > 0) {
      const choisi = candidats[Math.floor(Math.random() * candidats.length)];
      return normalize(choisi);
    }
  }

  return null;
}

async function telechargerPoster(posterUrl) {
  const response = await fetch(posterUrl);
  if (!response.ok) {
    throw new Error(`[QUIZ][TMDB] Impossible de télécharger l'affiche (HTTP ${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Lien vers la fiche TMDB publique du film — même convention que
 * cine-club/tmdb.js (urlFiche), affiché en bouton sur le message de reveal.
 */
function urlFiche(tmdbId) {
  return `https://www.themoviedb.org/movie/${tmdbId}`;
}

module.exports = { tirerFilmHorreurAleatoire, telechargerPoster, urlFiche };
