const jsonStore = require('../../data/jsonStore');

// Annonces séparées de celles de /cine : celles-ci alimentent aussi
// /supprimer-seance et leur fiche n'a pas le même format. Le programme en image
// lit les deux (cine-club/programme/service.js). Présences et rappels sont
// partagés avec cine-club (voir service.js).
const NS_ANNONCES = 'stream-annonces';

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

// Complète une annonce existante (ex: id du message posté, connu après envoi).
function majAnnonce(sessionKey, patch) {
  const all = getAnnonces();
  if (!all[sessionKey]) return null;
  all[sessionKey] = { ...all[sessionKey], ...patch };
  jsonStore.write(NS_ANNONCES, all);
  return all[sessionKey];
}

function supprimerAnnonce(sessionKey) {
  const all = getAnnonces();
  delete all[sessionKey];
  jsonStore.write(NS_ANNONCES, all);
}

function listAnnoncesAVenir(maintenant = Date.now()) {
  return Object.entries(getAnnonces())
    .map(([sessionKey, annonce]) => ({ sessionKey, ...annonce }))
    .filter((a) => new Date(a.dateSeance).getTime() > maintenant)
    .sort((a, b) => new Date(a.dateSeance) - new Date(b.dateSeance));
}

module.exports = { setAnnonce, getAnnonce, majAnnonce, supprimerAnnonce, listAnnoncesAVenir };
