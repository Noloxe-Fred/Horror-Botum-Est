const scanLetterbox = require('./commands/scan-letterbox');
const listLetterbox = require('./commands/list-letterbox');
const deleteLetterbox = require('./commands/delete-letterbox');

module.exports = {
  name: 'letterboxd',
  // Annuaire des profils Letterboxd des membres, construit à partir du salon
  // de partage des réseaux sociaux (SOCIAL_NETWORKS_CHANNEL_ID).
  commands: [scanLetterbox, listLetterbox, deleteLetterbox],
};
