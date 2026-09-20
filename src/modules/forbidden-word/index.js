// TODO: implémenter le jeu "le mot interdit".
//
// Structure prête à l'emploi, suit le même pattern que les autres modules :
//   - commands: []                -> ajouter ici les SlashCommandBuilder + execute
//   - onMessage: async (message)  -> décommenter et implémenter si le jeu réagit aux messages
//   - state.js / store.js         -> créer un fichier d'état si le jeu doit persister des données
//                                    (voir src/modules/quiz/store.js pour un exemple avec jsonStore)

module.exports = {
  name: 'forbidden-word',
  commands: [],

  // onMessage: async (message) => {
  //   // logique du jeu ici
  // },
};
