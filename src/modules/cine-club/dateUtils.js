// Tous les calculs de dates du module ciné-club, en JS natif (pas de
// dépendance type date-fns), conformément à la doctrine du projet.

const DAY_MS = 24 * 60 * 60 * 1000;

function atHour(date, hour) {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
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
 * Créneaux fixes pour un film : mardi / vendredi / samedi 21h de la semaine
 * SUIVANT celle en cours (jamais la semaine courante, même si on est lundi).
 */
function creneauxFilmSemaineSuivante(from = new Date()) {
  const lundiSemaineSuivante = new Date(currentWeekMonday(from).getTime() + 7 * DAY_MS);

  const mardi = atHour(new Date(lundiSemaineSuivante.getTime() + 1 * DAY_MS), 21);
  const vendredi = atHour(new Date(lundiSemaineSuivante.getTime() + 4 * DAY_MS), 21);
  const samedi = atHour(new Date(lundiSemaineSuivante.getTime() + 5 * DAY_MS), 21);

  return [
    { label: 'Mardi 21h', date: mardi },
    { label: 'Vendredi 21h', date: vendredi },
    { label: 'Samedi 21h', date: samedi },
  ];
}

/**
 * Prochain lundi 21h STRICTEMENT après `from` (si `from` est déjà lundi
 * après 21h, on saute à la semaine suivante).
 */
function prochainLundi21h(from = new Date()) {
  const d = new Date(from);
  const day = d.getDay();
  let diff = (1 - day + 7) % 7; // jours jusqu'au prochain lundi (0 si on est lundi)

  let candidate = atHour(new Date(d.getTime() + diff * DAY_MS), 21);
  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(candidate.getTime() + 7 * DAY_MS);
  }
  return candidate;
}

/**
 * 21h le jour même de `from` (utilisé par /arrache). Si `from` est déjà
 * après 21h, on garde quand même le jour même (séance à l'arrache = ce soir).
 */
function ceSoir21h(from = new Date()) {
  return atHour(from, 21);
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
  creneauxFilmSemaineSuivante,
  prochainLundi21h,
  ceSoir21h,
  formatDateFr,
};
