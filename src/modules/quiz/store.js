const jsonStore = require('../../data/jsonStore');

const NS_SESSION = 'quiz-session';
const NS_TENTATIVES = 'quiz-tentatives';
const NS_SCORES = 'quiz-scores';
const NS_HISTORIQUE = 'quiz-historique';

// --- Session de manche en cours (une seule à la fois) -------------------

function getSession() {
  return jsonStore.read(NS_SESSION, null);
}

function setSession(session) {
  jsonStore.write(NS_SESSION, session);
  return session;
}

function clearSession() {
  jsonStore.write(NS_SESSION, null);
}

// --- Tentatives par manche (clé = roundId) ------------------------------

function getToutesLesTentatives() {
  return jsonStore.read(NS_TENTATIVES, {});
}

/**
 * Incrémente le compteur de tentatives d'un joueur pour la manche en cours
 * et renvoie le nouveau total (utilisé pour l'affichage "en X tentatives").
 */
function enregistrerTentative(roundId, userId, tag) {
  const data = getToutesLesTentatives();
  if (!data[roundId]) data[roundId] = {};
  if (!data[roundId][userId]) data[roundId][userId] = { tag, count: 0, found: null };

  data[roundId][userId].tag = tag;
  data[roundId][userId].count += 1;
  jsonStore.write(NS_TENTATIVES, data);
  return data[roundId][userId].count;
}

function aDejaTrouve(roundId, userId) {
  const data = getToutesLesTentatives();
  return Boolean(data[roundId]?.[userId]?.found);
}

function enregistrerTrouvaille(roundId, userId, tag, { stage, points, tentatives }) {
  const data = getToutesLesTentatives();
  if (!data[roundId]) data[roundId] = {};
  data[roundId][userId] = { tag, count: tentatives, found: { stage, points, tentatives } };
  jsonStore.write(NS_TENTATIVES, data);
}

/**
 * Gagnants d'une manche, triés par points décroissants puis par nombre de
 * tentatives croissant (en cas d'égalité, le plus efficace passe devant).
 */
function getGagnants(roundId) {
  const data = getToutesLesTentatives();
  const entrees = Object.values(data[roundId] || {}).filter((e) => e.found);
  return entrees
    .map((e) => ({ tag: e.tag, stage: e.found.stage, points: e.found.points, tentatives: e.found.tentatives }))
    .sort((a, b) => b.points - a.points || a.tentatives - b.tentatives);
}

/**
 * Nombre total de réponses soumises sur une manche (toutes tentatives de
 * tous les joueurs, bonnes ou mauvaises) — affiché en compteur sur la carte.
 */
function compterReponses(roundId) {
  const data = getToutesLesTentatives();
  return Object.values(data[roundId] || {}).reduce((total, e) => total + e.count, 0);
}

function clearTentatives(roundId) {
  const data = getToutesLesTentatives();
  delete data[roundId];
  jsonStore.write(NS_TENTATIVES, data);
}

// --- Scores cumulés du cycle en cours (remis à zéro tous les 10) --------

function getEtatCycle() {
  return jsonStore.read(NS_SCORES, { cycleRoundCount: 0, scores: {} });
}

function ajouterPoints(userId, tag, points) {
  const data = getEtatCycle();
  if (!data.scores[userId]) data.scores[userId] = { tag, points: 0 };
  data.scores[userId].tag = tag;
  data.scores[userId].points += points;
  jsonStore.write(NS_SCORES, data);
}

/**
 * Marque une manche comme terminée. Renvoie le nouvel état (utile pour
 * savoir si le cap des 10 manches est atteint).
 */
function incrementerCycle() {
  const data = getEtatCycle();
  data.cycleRoundCount += 1;
  jsonStore.write(NS_SCORES, data);
  return data;
}

function getClassement() {
  const { scores } = getEtatCycle();
  return Object.values(scores).sort((a, b) => b.points - a.points);
}

function reinitialiserCycle() {
  jsonStore.write(NS_SCORES, { cycleRoundCount: 0, scores: {} });
}

// --- Historique anti-répétition (tmdbId déjà utilisés en quiz) ---------
// Séparé du cine-club-historique : usages différents (celui-ci ne sert
// qu'à éviter de retirer deux fois le même film en quiz).

function getUsedTmdbIds() {
  const { usedIds } = jsonStore.read(NS_HISTORIQUE, { usedIds: [] });
  return usedIds;
}

function addUsedTmdbId(tmdbId) {
  const data = jsonStore.read(NS_HISTORIQUE, { usedIds: [] });
  if (!data.usedIds.includes(tmdbId)) data.usedIds.push(tmdbId);
  jsonStore.write(NS_HISTORIQUE, data);
}

function resetUsedTmdbIds() {
  jsonStore.write(NS_HISTORIQUE, { usedIds: [] });
}

module.exports = {
  getSession,
  setSession,
  clearSession,
  enregistrerTentative,
  aDejaTrouve,
  enregistrerTrouvaille,
  getGagnants,
  compterReponses,
  clearTentatives,
  getEtatCycle,
  ajouterPoints,
  incrementerCycle,
  getClassement,
  reinitialiserCycle,
  getUsedTmdbIds,
  addUsedTmdbId,
  resetUsedTmdbIds,
};
