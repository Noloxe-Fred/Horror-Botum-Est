const jsonStore = require('../../data/jsonStore');

const NS_WATCHLIST = 'cine-club-watchlist';
const NS_HISTORIQUE = 'cine-club-historique';
const NS_POLLS_EN_ATTENTE = 'cine-club-polls-en-attente';
const NS_REMINDERS = 'cine-club-reminders';
const NS_ANNONCES = 'cine-club-annonces';
const NS_PRESENCES = 'cine-club-presences';
const NS_PROGRAMME = 'cine-club-programme';

function cle(tmdbId, mediaType) {
  return `${mediaType}:${tmdbId}`;
}

// --- Watchlist -------------------------------------------------------

function getWatchlist() {
  return jsonStore.read(NS_WATCHLIST, {});
}

function findInWatchlist(tmdbId, mediaType) {
  const data = getWatchlist();
  return data[cle(tmdbId, mediaType)] || null;
}

function addToWatchlist(entry) {
  const data = getWatchlist();
  const key = cle(entry.tmdbId, entry.mediaType);
  data[key] = entry;
  jsonStore.write(NS_WATCHLIST, data);
  return entry;
}

function removeFromWatchlist(tmdbId, mediaType) {
  const data = getWatchlist();
  const key = cle(tmdbId, mediaType);
  const existed = key in data;
  delete data[key];
  jsonStore.write(NS_WATCHLIST, data);
  return existed;
}

function listWatchlist({ mediaType } = {}) {
  const data = getWatchlist();
  const entries = Object.values(data);
  return mediaType ? entries.filter((e) => e.mediaType === mediaType) : entries;
}

// --- Historique (films/séries vus) ------------------------------------

function getHistorique() {
  return jsonStore.read(NS_HISTORIQUE, { entries: [] });
}

function findInHistorique(tmdbId, mediaType) {
  const { entries } = getHistorique();
  // On garde la dernière occurrence si le titre a été revu plusieurs fois.
  const matches = entries.filter((e) => e.tmdbId === tmdbId && e.mediaType === mediaType);
  return matches.length ? matches[matches.length - 1] : null;
}

// Un titre programmé (= vu) quitte la watchlist, quelle que soit la branche
// de /cine qui l'a programmé.
function addToHistorique(entry) {
  const data = getHistorique();
  data.entries.push(entry);
  jsonStore.write(NS_HISTORIQUE, data);
  if (findInWatchlist(entry.tmdbId, entry.mediaType)) removeFromWatchlist(entry.tmdbId, entry.mediaType);
  return entry;
}

function listHistorique({ limit = 15 } = {}) {
  const { entries } = getHistorique();
  return [...entries].sort((a, b) => new Date(b.dateVu) - new Date(a.dateVu)).slice(0, limit);
}

// --- Sondages en attente de validation (pont vers le bouton "Valider
// séance") --------------------------------------------------------------
//
// Contrairement à l'ancien /poll -> /host (un seul "dernier poll" en
// mémoire), le bouton "Valider séance" est persistant et peut rester
// cliquable plusieurs jours (le temps du dépouillement des réactions) —
// plusieurs sondages pourraient donc coexister. Chacun est identifié par un
// id embarqué dans le customId du bouton (`cine_valider:<id>`).

function getPollsEnAttente() {
  return jsonStore.read(NS_POLLS_EN_ATTENTE, {});
}

function creerPollEnAttente(poll) {
  const id = String(Date.now());
  const all = getPollsEnAttente();
  all[id] = { votesCreneaux: {}, ...poll };
  jsonStore.write(NS_POLLS_EN_ATTENTE, all);
  return id;
}

function getPollEnAttente(id) {
  return getPollsEnAttente()[id] || null;
}

function clearPollEnAttente(id) {
  const all = getPollsEnAttente();
  delete all[id];
  jsonStore.write(NS_POLLS_EN_ATTENTE, all);
}

/**
 * Bascule le vote de créneau d'un utilisateur sur le sondage de date public
 * (customId `cine_vote_creneau:<pollId>:<index>`) — un seul vote actif par
 * utilisateur : cliquer sur le créneau déjà voté le retire, cliquer sur un
 * autre le déplace. Renvoie le poll à jour, ou `null` s'il est introuvable
 * (sondage expiré/déjà validé).
 */
function voterCreneau(pollId, index, userId) {
  const all = getPollsEnAttente();
  const poll = all[pollId];
  if (!poll) return null;

  if (!poll.votesCreneaux) poll.votesCreneaux = {};
  if (poll.votesCreneaux[userId] === index) delete poll.votesCreneaux[userId];
  else poll.votesCreneaux[userId] = index;

  jsonStore.write(NS_POLLS_EN_ATTENTE, all);
  return poll;
}

// --- Rappels programmés (/host) -----------------------------------------

function getReminders() {
  return jsonStore.read(NS_REMINDERS, { items: [] });
}

function addReminders(items) {
  const data = getReminders();
  data.items.push(...items);
  jsonStore.write(NS_REMINDERS, data);
}

function markReminderSent(id) {
  const data = getReminders();
  const item = data.items.find((r) => r.id === id);
  if (item) item.sent = true;
  jsonStore.write(NS_REMINDERS, data);
}

function getPendingReminders() {
  const { items } = getReminders();
  return items.filter((r) => !r.sent);
}

// --- Annonces (séances /host et /arrache) --------------------------------
//
// Garde les données nécessaires pour reconstruire la carte Components V2
// d'une annonce quand quelqu'un clique sur "Je serai présent" ou "Démarrer
// l'event" (l'interaction de bouton ne fournit que le customId, pas le
// contexte du film/de la séance) — store séparé plutôt que de trafiquer
// l'historique, qui reste un simple journal de ce qui a été vu.

function getAnnonces() {
  return jsonStore.read(NS_ANNONCES, {});
}

function setAnnonce(sessionKey, data) {
  const all = getAnnonces();
  all[sessionKey] = data;
  jsonStore.write(NS_ANNONCES, all);
  return data;
}

function getAnnonce(sessionKey) {
  return getAnnonces()[sessionKey] || null;
}

/**
 * Annonces dont la séance n'a pas encore commencé, triées par date —
 * source du programme en image (programme/service.js).
 */
function listAnnoncesAVenir(maintenant = Date.now()) {
  return Object.entries(getAnnonces())
    .map(([sessionKey, annonce]) => ({ sessionKey, ...annonce }))
    .filter((a) => new Date(a.dateSeance).getTime() > maintenant)
    .sort((a, b) => new Date(a.dateSeance) - new Date(b.dateSeance));
}

// --- Programme en image ---------------------------------------------------
//
// Messages postés dans le salon programme (un par image, dans l'ordre) et
// signature de la liste de séances affichée, pour ne régénérer l'image que
// quand le programme change réellement.

function getProgramme() {
  return jsonStore.read(NS_PROGRAMME, { channelId: null, messageIds: [], signature: null });
}

function setProgramme(data) {
  jsonStore.write(NS_PROGRAMME, data);
}

// --- Présences ("Je serai présent") ---------------------------------------
//
// Toggle par utilisateur, stocké par session (mediaType:tmdbId:timestamp de
// la séance) — indépendant de l'historique de visionnage.

function getPresences() {
  return jsonStore.read(NS_PRESENCES, {});
}

/**
 * Bascule la présence d'un utilisateur pour une session donnée. Retourne le
 * nouvel état (présent ou non) et le nombre total de présents.
 */
function togglePresence(sessionKey, user) {
  const all = getPresences();
  const entry = all[sessionKey] || { users: {} };
  const etaitPresent = Boolean(entry.users[user.id]);

  if (etaitPresent) delete entry.users[user.id];
  else entry.users[user.id] = user.nom;

  all[sessionKey] = entry;
  jsonStore.write(NS_PRESENCES, all);

  return { isPresent: !etaitPresent, count: Object.keys(entry.users).length };
}

function getPresenceCount(sessionKey) {
  const entry = getPresences()[sessionKey];
  return entry ? Object.keys(entry.users).length : 0;
}

/**
 * Renvoie la liste des noms affichés (displayName au moment de
 * l'inscription ; tag pour les inscriptions plus anciennes) des présents
 * pour une session, triée par ordre
 * alphabétique — utilisée pour afficher la liste dans la carte Components V2
 * (reconstruite à chaque clic sur "Je serai présent").
 */
function getPresenceList(sessionKey) {
  const entry = getPresences()[sessionKey];
  if (!entry) return [];
  return Object.values(entry.users).sort((a, b) => a.localeCompare(b));
}

module.exports = {
  // watchlist
  findInWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  listWatchlist,
  // historique
  findInHistorique,
  addToHistorique,
  listHistorique,
  // sondages en attente de validation
  creerPollEnAttente,
  getPollEnAttente,
  clearPollEnAttente,
  voterCreneau,
  // rappels
  addReminders,
  markReminderSent,
  getPendingReminders,
  // annonces
  setAnnonce,
  getAnnonce,
  listAnnoncesAVenir,
  // programme en image
  getProgramme,
  setProgramme,
  // présences
  togglePresence,
  getPresenceCount,
  getPresenceList,
};
