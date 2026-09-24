const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { requireAdmin } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const config = require('../../../config');
const { scannerSalon } = require('../service');
const store = require('../store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scan-letterbox')
    .setDescription('Scanne le salon des réseaux sociaux et enregistre les profils Letterboxd des membres')
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Salon à scanner (par défaut : salon des réseaux sociaux configuré)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireAdmin(interaction))) return;

    const channelId = interaction.options.getChannel('salon')?.id || config.channels.socialNetworksId;
    const channel = channelId
      ? await interaction.guild.channels.fetch(channelId).catch(() => null)
      : null;

    if (!channel) {
      return interaction.reply({
        content:
          "❌ Aucun salon à scanner : configure SOCIAL_NETWORKS_CHANNEL_ID dans .env ou précise l'option `salon`.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const { profils, nbMessages, nbSansLien, nbPartis } = await scannerSalon(channel);
    store.replaceProfils(profils, { channelId: channel.id });

    await interaction.editReply(
      `✅ **Scan Letterboxd terminé** (<#${channel.id}>)\n\n` +
        `💬 Messages analysés : **${nbMessages}**\n` +
        `🎬 Profils Letterboxd enregistrés : **${Object.keys(profils).length}**\n` +
        `➖ Membres sans lien Letterboxd : **${nbSansLien}**` +
        (nbPartis > 0 ? `\n🚪 Ignorés (ont quitté le serveur) : **${nbPartis}**` : '') +
        '\n\nUtilise `/list-letterbox` pour afficher la liste.'
    );
  }, 'SCAN-LETTERBOX'),
};
