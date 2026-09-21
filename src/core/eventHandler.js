const { buildRegistry } = require('./commandRegistry');

module.exports = (client) => {
  const { commands, buttonHandlers, modalHandlers, messageListeners, initializers } = buildRegistry();

  for (const { name, init } of initializers) {
    init(client);
    console.log(`[HANDLER] Module "${name}" initialisé.`);
  }

  // Seuls les modules qui définissent onMessage sont notifiés
  // (avant : TOUS les modules étaient scannés à CHAQUE message).
  client.on('messageCreate', async (message) => {
    for (const { name, onMessage } of messageListeners) {
      try {
        await onMessage(message);
      } catch (err) {
        console.error(`[HANDLER][${name}] Erreur onMessage :`, err);
      }
    }
  });

  // Lookup en O(1) via la Map, au lieu de boucler sur tous les modules
  // pour comparer le nom de la commande à chaque interaction.
  client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) {
        console.warn(`[HANDLER] Commande inconnue reçue : ${interaction.commandName}`);
        return;
      }
      return command.execute(interaction);
    }

    // Boutons persistants (ex: "Je serai présent") : dispatch par préfixe de
    // customId ("cine_presence:xyz" -> "cine_presence"). Les boutons de
    // formulaire éphémères (/cine...) sont gérés directement par
    // awaitMessageComponent() dans leur commande et n'arrivent jamais ici
    // sans handler correspondant — dans ce cas on ignore silencieusement
    // (bouton expiré ou déjà consommé par le collector de la commande).
    if (interaction.isButton()) {
      const prefixe = interaction.customId.split(':')[0];
      const handler = buttonHandlers.get(prefixe);
      if (!handler) return;

      try {
        await handler(interaction);
      } catch (err) {
        console.error(`[HANDLER] Erreur bouton "${prefixe}" :`, err);
      }
      return;
    }

    // Soumissions de modal (ex: réponse texte du quiz) : même principe de
    // dispatch par préfixe que les boutons persistants.
    if (interaction.isModalSubmit()) {
      const prefixe = interaction.customId.split(':')[0];
      const handler = modalHandlers.get(prefixe);
      if (!handler) return;

      try {
        await handler(interaction);
      } catch (err) {
        console.error(`[HANDLER] Erreur modal "${prefixe}" :`, err);
      }
    }
  });
};
