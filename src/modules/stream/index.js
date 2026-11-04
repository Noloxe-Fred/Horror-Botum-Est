const stream = require('./commands/stream');
const supprimerStream = require('./commands/supprimer-stream');
const { handlePresenceButton, handleStartEventButton } = require('./service');

module.exports = {
  name: 'stream',
  commands: [stream, supprimerStream],

  // Boutons persistants sur les annonces de stream, sur le même principe que
  // ceux de /cine (voir cine-club/index.js). Le rappel H-1 passe par le
  // scheduler de rappels de cine-club : pas de boucle à démarrer ici.
  buttons: [
    { prefix: 'stream_presence', execute: handlePresenceButton },
    { prefix: 'stream_start_event', execute: handleStartEventButton },
  ],
};
