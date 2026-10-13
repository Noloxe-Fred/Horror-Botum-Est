const jsonStore = require('../../data/jsonStore');

const NAMESPACE = 'rss-feed';

// Nombre d'identifiants d'articles mémorisés par flux : largement plus que
// ce qu'un flux expose (10 à 50 items en général), pour qu'un article qui
// reste dans le flux ne soit jamais republié.
const MAX_VUS = 300;

function lire() {
  return jsonStore.read(NAMESPACE, { feeds: {} });
}

function listerFlux() {
  return Object.values(lire().feeds);
}

function getFlux(id) {
  return lire().feeds[id] || null;
}

function ajouterFlux(flux) {
  const data = lire();
  data.feeds[flux.id] = flux;
  jsonStore.write(NAMESPACE, data);
}

function supprimerFlux(id) {
  const data = lire();
  if (!data.feeds[id]) return false;
  delete data.feeds[id];
  jsonStore.write(NAMESPACE, data);
  return true;
}

/**
 * Ajoute des identifiants d'articles à la liste des articles déjà publiés
 * (les plus récents en fin de liste, les plus anciens purgés au-delà de
 * MAX_VUS). `tailleFlux` (nombre d'articles exposés par le flux) relève ce
 * plafond pour les très gros flux : purger l'identifiant d'un article encore
 * présent dans le flux le ferait republier au tick suivant.
 */
function marquerVus(id, articleIds, tailleFlux = 0) {
  const data = lire();
  const flux = data.feeds[id];
  if (!flux) return;
  const vus = new Set(flux.vus || []);
  for (const articleId of articleIds) vus.add(articleId);
  flux.vus = [...vus].slice(-Math.max(MAX_VUS, tailleFlux * 2));
  jsonStore.write(NAMESPACE, data);
}

module.exports = { listerFlux, getFlux, ajouterFlux, supprimerFlux, marquerVus };
