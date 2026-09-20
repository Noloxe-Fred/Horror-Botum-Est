const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../../config');
const withErrorHandling = require('../../../core/withErrorHandling');
const store = require('../store');
const { buildSeanceContainer } = require('../service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serie-en-cours')
    .setDescription('Rappelle quelle série est actuellement suivie par le ciné-club'),

  execute: withErrorHandling(async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    const serie = store.getSerieCourante();
    if (!serie || !serie.sessionKey) {
      return interaction.editReply("📭 Aucune série n'est actuellement en cours au ciné-club.");
    }

    // La série ne garde qu'une référence vers l'annonce complète postée par
    // /host (cine-club-annonces) — pas de copie, pour ne jamais afficher des
    // infos désynchronisées (présences, event...).
    const annonce = store.getAnnonce(serie.sessionKey);
    if (!annonce) {
      return interaction.editReply(
        "⚠️ Les données de la dernière séance série sont introuvables. Relance `/host` pour les régénérer."
      );
    }

    const targetChannelId = config.cineClub.channelSerieId || config.cineClub.channelId;
    const salonAnnonce = await interaction.guild.channels.fetch(targetChannelId);
    if (!salonAnnonce) {
      return interaction.editReply(`❌ Salon dédié introuvable (ID ${targetChannelId}).`);
    }

    const presentsCount = store.getPresenceCount(serie.sessionKey);
    const presentsList = store.getPresenceList(serie.sessionKey);

    const container = buildSeanceContainer({
      sessionKey: serie.sessionKey,
      mediaType: annonce.mediaType,
      dateSeance: new Date(annonce.dateSeance),
      salonVocalId: annonce.salonVocalId,
      fiche: annonce.fiche,
      presentsCount,
      presentsList,
      mention: annonce.mention,
      annonceTexte: 'Rappel : toujours au programme du ciné-club !',
      guildId: annonce.guildId,
      eventId: annonce.eventId,
    });

    await salonAnnonce.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    await interaction.editReply(`✅ Rappel posté dans <#${targetChannelId}> !`);
  }, 'CINE-CLUB-SERIE-EN-COURS'),
};
