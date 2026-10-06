const search = require('./commands/search');
const add = require('./commands/add');
const list = require('./commands/list');
const deleteWatchlist = require('./commands/delete-watchlist');
const cine = require('./commands/cine');
const historique = require('./commands/historique');
const helpCine = require('./commands/help-cine');
const programmeCine = require('./commands/programme-cine');
const supprimerSeance = require('./commands/supprimer-seance');
const { demarrerSchedulerProgramme } = require('./programme/service');
const {
  demarrerSchedulerRappels,
  handlePresenceButton,
  handleStartEventButton,
  handleValiderSeanceButton,
  handleVoteCreneauButton,
} = require('./service');

module.exports = {
  name: 'cine-club',
  commands: [search, add, list, deleteWatchlist, cine, historique, helpCine, programmeCine, supprimerSeance],

  // Boutons persistants sur les annonces (carte séance) et les sondages
  // /cine — survivent à un redémarrage du bot puisqu'ils sont dispatchés par
  // préfixe de customId via le registre central (voir core/commandRegistry.js),
  // pas par un collector scoped à la commande d'origine. cine_valider en
  // particulier doit rester cliquable plusieurs jours (le temps du
  // dépouillement des réactions).
  buttons: [
    { prefix: 'cine_presence', execute: handlePresenceButton },
    { prefix: 'cine_start_event', execute: handleStartEventButton },
    { prefix: 'cine_valider', execute: handleValiderSeanceButton },
    { prefix: 'cine_vote_creneau', execute: handleVoteCreneauButton },
  ],

  // Démarre la boucle qui vérifie chaque minute les rappels programmés par
  // les branches "Séances Séries", "Séance Libre" et "Valider séance" de
  // /cine ("Séance à l'arrache" n'en programme aucun, c'est une annonce
  // immédiate). Les rappels survivent à un restart car ils sont persistés en
  // JSON — au redémarrage, ceux déjà passés sont envoyés au premier tick
  // (max 60s de retard), ceux futurs attendent leur heure.
  //
  // Second tick par minute : tient à jour le programme en image
  // (programme/service.js) dès que la liste des séances à venir change.
  init: (client) => {
    demarrerSchedulerRappels(client);
    demarrerSchedulerProgramme(client);
  },
};
