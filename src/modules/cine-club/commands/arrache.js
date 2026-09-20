const {
  SlashCommandBuilder,
  MessageFlags,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const config = require('../../../config');
const { requireStreamerRole, requireAnyChannel } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const tmdb = require('../tmdb');
const store = require('../store');
const { ceSoir21h } = require('../dateUtils');
const { choisirResultatTmdb, demanderSalonVocal, buildSeanceContainer } = require('../service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arrache')
    .setDescription('Annonce une séance ciné improvisée ce soir à 21h')
    .addStringOption((option) =>
      option.setName('titre').setDescription('Film à diffuser ce soir').setRequired(true)
    ),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireStreamerRole(interaction))) return;
    if (
      !(await requireAnyChannel(
        interaction,
        [config.cineClub.channelId, config.cineClub.channelArracheId],
        { label: 'le salon ciné-club ou le salon dédié aux séances à l\'arrache' }
      ))
    )
      return;

    await interaction.deferReply();

    const titre = interaction.options.getString('titre');
    const resultats = await tmdb.searchMulti(titre, { limit: 10 });

    if (resultats.length === 0) {
      return interaction.editReply(`❌ Aucun résultat TMDB pour "${titre}".`);
    }

    const message = await interaction.editReply({ content: 'Recherche en cours...' });

    // Plusieurs résultats possibles -> même sélecteur que /search et /add,
    // pour ne pas annoncer le mauvais film par erreur ce soir.
    const choisi = await choisirResultatTmdb(interaction, message, resultats);
    if (!choisi) return; // message d'erreur/timeout déjà posté par choisirResultatTmdb

    const fiche = await tmdb.getDetails(choisi.tmdbId, choisi.mediaType);
    const dateSeance = ceSoir21h();

    // Salon vocal de diffusion (liste dynamique du serveur, comme /host).
    const salonVocalId = await demanderSalonVocal(interaction, message);
    if (!salonVocalId) return; // message d'erreur/timeout déjà posté

    // Salon d'annonce dédié à l'arrache — fallback sur le salon ciné-club
    // d'origine si non configuré dans .env.
    const targetChannelId = config.cineClub.channelArracheId || config.cineClub.channelId;
    const salonAnnonce = await interaction.guild.channels.fetch(targetChannelId);
    if (!salonAnnonce) {
      return message.edit({ content: `❌ Salon d'annonce introuvable (ID ${targetChannelId}).`, components: [] });
    }

    // Événement Discord natif (best-effort, comme /host — absent jusqu'ici
    // pour /arrache).
    let eventId = null;
    try {
      const evenement = await interaction.guild.scheduledEvents.create({
        name: `Ciné à l'arrache : ${fiche.titre}`,
        scheduledStartTime: dateSeance,
        scheduledEndTime: new Date(dateSeance.getTime() + 150 * 60 * 1000),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.Voice,
        channel: salonVocalId,
        description: fiche.overview.slice(0, 950),
      });
      eventId = evenement.id;
    } catch (err) {
      console.error("[CINE-CLUB] Impossible de créer l'événement Discord natif :", err);
    }

    const roleId = config.cineClub.roles.arrache;
    const mention = roleId ? `<@&${roleId}> ` : '';
    const annonceTexte = 'Séance improvisée ce soir, amenez du pop-corn !';
    const sessionKey = `${fiche.mediaType}:${fiche.tmdbId}:${dateSeance.getTime()}`;

    store.setAnnonce(sessionKey, {
      mediaType: fiche.mediaType,
      tmdbId: fiche.tmdbId,
      dateSeance: dateSeance.toISOString(),
      salonVocalId,
      channelId: targetChannelId,
      fiche,
      mention,
      annonceTexte,
      roleId,
      guildId: interaction.guild.id,
      eventId,
    });

    const container = buildSeanceContainer({
      sessionKey,
      mediaType: fiche.mediaType,
      dateSeance,
      salonVocalId,
      fiche,
      presentsCount: 0,
      mention,
      annonceTexte,
      guildId: interaction.guild.id,
      eventId,
    });

    await salonAnnonce.send({ flags: MessageFlags.IsComponentsV2, components: [container] });

    // Pas de rappels programmés pour /arrache (contrairement à /host) :
    // c'est une annonce immédiate pour ce soir, un rappel n'aurait pas de
    // sens (décision d'origine, inchangée).

    // Alimente l'historique comme /host, même si aucune watchlist/poll n'est
    // impliqué — décision validée avec l'utilisateur.
    store.addToHistorique({
      tmdbId: fiche.tmdbId,
      mediaType: fiche.mediaType,
      titre: fiche.titre,
      dateVu: dateSeance.toISOString(),
      posterUrl: fiche.posterUrl,
      source: 'arrache',
    });

    await message.edit({ content: `✅ Annonce postée dans <#${targetChannelId}> !`, components: [] });
  }, 'CINE-CLUB-ARRACHE'),
};
