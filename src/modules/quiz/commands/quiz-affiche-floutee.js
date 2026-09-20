const { SlashCommandBuilder } = require('discord.js');
const config = require('../../../config');
const { requireAnyRole } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const store = require('../store');
const service = require('../service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quiz-affiche-floutee')
    .setDescription("Lance une manche de quiz : devine le film d'horreur à partir de son affiche floutée"),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireAnyRole(interaction, service.rolesAutorises(), { label: service.ROLES_AUTORISES_LABEL })))
      return;

    if (!config.channels.quizId || !config.channels.quizResponseId) {
      return interaction.reply({
        content: '❌ QUIZ_CHANNEL_ID et/ou QUIZ_RESPONSE_CHANNEL_ID ne sont pas configurés dans .env.',
        ephemeral: true,
      });
    }

    if (store.getSession()) {
      return interaction.reply({
        content:
          '❌ Une manche de quiz est déjà en cours — attends qu\'elle se termine ' +
          '(ou utilise le bouton "Question suivante" une fois le reveal posté).',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const demarree = await service.demarrerNouvelleManche(interaction.client, {
      id: interaction.user.id,
      tag: interaction.user.tag,
    });

    if (!demarree) {
      return interaction.editReply(
        "❌ Impossible de trouver un film d'horreur correspondant aux critères sur TMDB pour le moment. Réessaie plus tard."
      );
    }

    await interaction.editReply(`✅ Manche de quiz lancée dans <#${config.channels.quizId}> !`);
  }, 'QUIZ-AFFICHE-FLOUTEE'),
};
