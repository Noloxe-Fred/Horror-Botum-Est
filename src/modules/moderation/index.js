const addpurge = require('./commands/addpurge');
const purge = require('./commands/purge');

module.exports = {
  name: 'moderation',
  // Toutes les commandes liées à la gestion des membres inactifs,
  // regroupées ici car c'est UNE seule fonctionnalité (avant : deux
  // dossiers séparés "purge" et "addpurge" pour la même chose).
  commands: [addpurge, purge],
};
