const search = require('./commands/search');
const add = require('./commands/add');
const list = require('./commands/list');
const poll = require('./commands/poll');
const host = require('./commands/host');
const arrache = require('./commands/arrache');
const serieEnCours = require('./commands/serie-en-cours');
const historique = require('./commands/historique');
const helpCine = require('./commands/help-cine');
const { demarrerSchedulerRappels, handlePresenceButton, handleStartEventButton } = require('./service');

module.exports = {
  name: 'cine-club',
  commands: [search, add, list, poll, host, arrache, serieEnCours, historique, helpCine],

  // Boutons persistants sur les annonces /host et /arrache — survivent à un
  // redémarrage du bot puisqu'ils sont dispatchés par préfixe de customId via
  // le registre central (voir core/commandRegistry.js), pas par un collector
  // scoped à la commande d'origine.
  buttons: [
    { prefix: 'cine_presence', execute: handlePresenceButton },
    { prefix: 'cine_start_event', execute: handleStartEventButton },
  ],

  // Démarre la boucle qui vérifie chaque minute les rappels programmés par
  // /host (J-1, H-1, H-15) et /arrache (aucun rappel programmé pour celle-ci,
  // c'est une annonce immédiate). Les rappels survivent à un restart car ils
  // sont persistés en JSON — au redémarrage, ceux déjà passés sont envoyés
  // au premier tick (max 60s de retard), ceux futurs attendent leur heure.
  init: (client) => {
    demarrerSchedulerRappels(client);
  },
};
