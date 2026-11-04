// Tous les calculs de dates du module Séances Ciné, en JS natif (pas de
// dépendance type date-fns), conformément à la doctrine du projet.

function atHeure(date, heure, minute = 0) {
  const d = new Date(date);
  d.setHours(heure, minute, 0, 0);
  return d;
}

/**
 * Parse une heure saisie par un streamer en format libre ("21", "21h",
 * "21h30", "21:30"...) en { heure, minute }, ou `null` si invalide.
 */
function parseHeure(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  const match = /^(\d{1,2})\s*[h:]?\s*(\d{1,2})?$/.exec(trimmed);
  if (!match) return null;

  const heure = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (heure < 0 || heure > 23 || minute < 0 || minute > 59) return null;

  return { heure, minute };
}

/**
 * Heure choisie le jour même de `from` (utilisé par la séance "à l'arrache").
 * Si `from` est déjà après cette heure, on garde quand même le jour même
 * (séance à l'arrache = ce soir).
 */
function ceSoirA(heure, minute = 0, from = new Date()) {
  return atHeure(from, heure, minute);
}

/**
 * Les `nb` prochains jours calendaires à partir d'aujourd'hui (00:00), pour le
 * choix de date des séances (voir service.demanderJour). setDate() plutôt
 * que + n jours en millisecondes pour rester juste lors des changements
 * d'heure été/hiver.
 */
function prochainsJours(nb, from = new Date()) {
  return Array.from({ length: nb }, (_, i) => {
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/**
 * "Mardi 29 septembre" — libellé d'un jour dans le sélecteur de date.
 */
function formatJourFr(date) {
  const texte = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function formatDateFr(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

module.exports = {
  parseHeure,
  atHeure,
  ceSoirA,
  prochainsJours,
  formatJourFr,
  formatDateFr,
};
