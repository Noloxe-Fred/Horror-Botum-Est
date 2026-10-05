const { SlashCommandBuilder } = require('discord.js');
const config = require('../../../config');
const withErrorHandling = require('../../../core/withErrorHandling');
const { requireAnyRole } = require('../../../core/permissions');
const { publierProgramme } = require('../programme/service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('programme-cine')
    .setDescription('(Re)publie le programme en image des Séances Ciné dans le salon dédié'),

  execute: withErrorHandling(async (interaction) => {
    const autorise = await requireAnyRole(interaction, [config.roles.adminId, config.roles.quizModeratorId], {
      label: 'un modérateur',
    });
    if (!autorise) return;

    if (!config.cineClub.channelProgrammeId) {
      return interaction.reply({
        content: "❌ CINE_CLUB_CHANNEL_PROGRAMME_ID n'est pas configuré dans .env.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // Republication complète : anciennes images supprimées, nouvelles
    // postées. Ensuite le programme se tient à jour tout seul.
    const { seances, images } = await publierProgramme(interaction.client, { forcer: true });

    await interaction.editReply(
      `✅ Programme publié dans <#${config.cineClub.channelProgrammeId}> ` +
        `(${seances} séance${seances > 1 ? 's' : ''}, ${images} image${images > 1 ? 's' : ''}). ` +
        'Il se mettra à jour automatiquement à chaque nouvelle séance.'
    );
  }, 'SEANCES-CINE-PROGRAMME'),
};
