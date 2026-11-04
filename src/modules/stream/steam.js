// API publique de la boutique Steam : sans clé et en français, mais non
// documentée officiellement. Le résumé n'est en français que si l'éditeur l'a
// traduit, et seuls les jeux vendus sur Steam y figurent (voir jeux.js).

const BASE_URL = 'https://store.steampowered.com/api';
const IMG_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';
const TIMEOUT_MS = 10 * 1000;
const MIN_LONGUEUR_TERME = 4; // en deçà ("the"), les résultats n'ont plus de rapport

const ENTITES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

function decoderEntites(texte) {
  return texte.replace(/&(?:amp|quot|#39|apos|lt|gt|nbsp);/g, (e) => ENTITES[e]);
}

async function steamFetch(pathname, params) {
  const url = new URL(`${BASE_URL}${pathname}`);
  url.searchParams.set('l', 'french');
  url.searchParams.set('cc', 'FR');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`[STEAM] Erreur HTTP ${response.status} sur ${pathname}`);
  }
  return response.json();
}

/**
 * Jaquette verticale, au format des affiches TMDB. Absente de la fiche et
 * parfois du CDN, d'où la vérification, avec repli sur la bannière horizontale.
 */
async function trouverJaquette(appId, banniere) {
  const jaquette = `${IMG_BASE}/${appId}/library_600x900_2x.jpg`;
  try {
    const response = await fetch(jaquette, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.ok) return jaquette;
  } catch (err) {
    console.error(`[STEAM] Jaquette inaccessible (${appId}) :`, err.message);
  }
  return banniere || null;
}

async function normalize(raw) {
  return {
    id: raw.steam_appid,
    source: 'Steam',
    titre: raw.name || 'Titre inconnu',
    // Steam donne une date en texte libre ("24 sept. 2025") : seule l'année
    // est exploitable, et seule l'année est affichée.
    dateSortie: /\d{4}/.exec(raw.release_date?.date || '')?.[0] || null,
    overview: decoderEntites(raw.short_description || '') || 'Pas de description disponible.',
    note: raw.metacritic?.score ? raw.metacritic.score / 10 : null,
    coverUrl: await trouverJaquette(raw.steam_appid, raw.header_image),
    genres: (raw.genres || []).map((g) => g.description).filter(Boolean),
    plateformes: [],
    developpeur: (raw.developers || [])[0] || null,
    url: `https://store.steampowered.com/app/${raw.steam_appid}`,
  };
}

async function details(appId) {
  try {
    const data = await steamFetch('/appdetails', { appids: appId });
    return data[appId]?.success ? data[appId].data : null;
  } catch (err) {
    console.error(`[STEAM] Fiche inaccessible (${appId}) :`, err.message);
    return null;
  }
}

/**
 * La recherche mélange jeux, DLC et bandes-son sans indiquer le type : seule
 * la fiche de chaque résultat permet de ne garder que les jeux.
 */
async function chercherTermes(termes) {
  const reponses = await Promise.all(termes.map((term) => steamFetch('/storesearch/', { term })));
  const ids = [...new Set(reponses.flatMap(({ items = [] }) => items.map((item) => item.id)))];
  const fiches = await Promise.all(ids.map(details));
  return Promise.all(fiches.filter((f) => f && f.type === 'game').map(normalize));
}

/**
 * Recherche un jeu par titre. Steam exige tous les mots saisis et n'en tolère
 * aucun en trop : "Dying Light 1" (le jeu s'appelle "Dying Light") ou "alien :
 * isolation" ne trouvent pas le jeu. On cherche donc aussi sans le "1" final
 * ni la ponctuation, puis, si rien ne sort (faute de frappe...), en retirant
 * les derniers mots un à un.
 */
async function rechercher(titre) {
  const nettoye = titre.replace(/[:;,!?–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sansNumero = nettoye.replace(/\s+(?:1|i)$/i, '');
  const termes = [...new Set([sansNumero, nettoye, titre])].filter(Boolean);

  let jeux = await chercherTermes(termes);

  const mots = sansNumero.split(' ');
  for (let n = mots.length - 1; jeux.length === 0 && n >= 1; n--) {
    const debut = mots.slice(0, n).join(' ');
    if (debut.length >= MIN_LONGUEUR_TERME) jeux = await chercherTermes([debut]);
  }
  return jeux;
}

module.exports = { rechercher };
