/**
 * Enrobe une fonction execute(interaction) pour capturer les erreurs
 * et répondre proprement à l'utilisateur, sans dupliquer le try/catch
 * dans chaque fichier de commande.
 *
 * @param {(interaction) => Promise<void>} execute
 * @param {string} label - utilisé dans les logs (ex: 'PURGE', 'QUIZ')
 */
function withErrorHandling(execute, label) {
  return async (interaction) => {
    try {
      await execute(interaction);
    } catch (error) {
      console.error(`[${label}] Erreur :`, error);

      try {
        if (interaction.deferred) {
          await interaction.editReply('❌ Une erreur est survenue.');
        } else if (!interaction.replied) {
          await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true });
        }
      } catch (replyError) {
        console.error(`[${label}] Impossible d'envoyer le message d'erreur :`, replyError);
      }
    }
  };
}

module.exports = withErrorHandling;
