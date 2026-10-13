const rss = require('./commands/rss');
const { demarrerScheduler } = require('./service');

module.exports = {
  name: 'rss-feed',
  // Alternative maison à MonitoRSS : /rss ajouter|liste|supprimer|tester.
  commands: [rss],

  // Vérifie tous les flux suivis au démarrage puis toutes les 10 minutes.
  // Les articles déjà publiés sont persistés (data-store/rss-feed.json) :
  // pas de doublon après un redémarrage.
  init: (client) => {
    demarrerScheduler(client);
  },
};
