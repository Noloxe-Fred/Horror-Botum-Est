// Tous les calculs de dates du module ciné-club, en JS natif (pas de
// dépendance type date-fns), conformément à la doctrine du projet.

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * "21h" ou "21h30" (pas de minutes si pile à l'heure) — utilisé pour
 * labelliser les créneaux proposés dans les sondages d'horaire.
 */
function formatHeureCourte(heure, minute = 0) {
  const h = String(heure).padStart(2, '0');
  return minute ? `${h}h${String(minute).padStart(2, '0')}` : `${h}h`;
}

/**
 * Lundi (00:00) de la semaine EN COURS (celle qui contient `from`).
 */
function currentWeekMonday(from = new Date()) {
  const d = new Date(from);
  const day = d.getDay(); // 0 = dimanche ... 6 = samedi
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Créneaux fixes pour un film : mardi / vendredi / samedi à l'heure choisie
 * par le streamer, de la semaine SUIVANT celle en cours (jamais la semaine
 * courante, même si on est lundi).
 */
function creneauxFilmSemaineSuivante(heure, minute = 0, from = new Date()) {
  const lundiSemaineSuivante = new Date(currentWeekMonday(from).getTime() + 7 * DAY_MS);

  const mardi = atHeure(new Date(lundiSemaineSuivante.getTime() + 1 * DAY_MS), heure, minute);
  const vendredi = atHeure(new Date(lundiSemaineSuivante.getTime() + 4 * DAY_MS), heure, minute);
  const samedi = atHeure(new Date(lundiSemaineSuivante.getTime() + 5 * DAY_MS), heure, minute);

  const libelleHeure = formatHeureCourte(heure, minute);
  return [
    { label: `Mardi ${libelleHeure}`, date: mardi },
    { label: `Vendredi ${libelleHeure}`, date: vendredi },
    { label: `Samedi ${libelleHeure}`, date: samedi },
  ];
}

/**
 * Prochain lundi à l'heure choisie, STRICTEMENT après `from` (si `from` est
 * déjà lundi après cette heure, on saute à la semaine suivante).
 */
function prochainLundiA(heure, minute = 0, from = new Date()) {
  const d = new Date(from);
  const day = d.getDay();
  let diff = (1 - day + 7) % 7; // jours jusqu'au prochain lundi (0 si on est lundi)

  let candidate = atHeure(new Date(d.getTime() + diff * DAY_MS), heure, minute);
  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(candidate.getTime() + 7 * DAY_MS);
  }
  return candidate;
}

/**
 * Heure choisie le jour même de `from` (utilisé par /arrache). Si `from`
 * est déjà après cette heure, on garde quand même le jour même (séance à
 * l'arrache = ce soir).
 */
function ceSoirA(heure, minute = 0, from = new Date()) {
  return atHeure(from, heure, minute);
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
  formatHeureCourte,
  creneauxFilmSemaineSuivante,
  prochainLundiA,
  ceSoirA,
  formatDateFr,
};
