const quizAfficheFloutee = require('./commands/quiz-affiche-floutee');
const service = require('./service');

// Vérification périodique des paliers en attente. Les paliers sont espacés
// de 2 jours (voir DELAI_PALIER_MS dans service.js), un check toutes les
// 15 minutes est largement suffisant (pas besoin d'une boucle à la minute
// comme les rappels du ciné-club).
const INTERVALLE_SCHEDULER_MS = 15 * 60 * 1000;

module.exports = {
  name: 'quiz',
  commands: [quizAfficheFloutee],

  // Boutons persistants : survivent à un restart du bot, contrairement aux
  // boutons éphémères gérés par awaitMessageComponent() dans une commande.
  // Nécessaire ici car une manche dure plusieurs jours (paliers espacés de
  // 2 jours) et peut donc traverser plusieurs redémarrages du bot.
  buttons: [
    { prefix: 'quiz_answer', execute: service.gererBoutonRepondre },
    { prefix: 'quiz_next', execute: service.gererBoutonQuestionSuivante },
  ],

  modals: [{ prefix: 'quiz_modal', execute: service.gererSoumissionReponse }],

  init: (client) => {
    setInterval(() => {
      service.avancerManche(client).catch((err) => {
        console.error('[QUIZ] Erreur lors de la vérification des paliers :', err);
      });
    }, INTERVALLE_SCHEDULER_MS);
  },
};
