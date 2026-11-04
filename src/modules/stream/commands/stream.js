const {
  SlashCommandBuilder,
  MessageFlags,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const config = require('../../../config');
const { requireStreamerRole } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const { demanderJour, demanderHeure, demanderMessagePersonnalise } = require('../../cine-club/service');
const { atHeure, formatJourFr } = require('../../cine-club/dateUtils');
const { rafraichirProgramme } = require('../../cine-club/programme/service');
const { rechercherJeux } = require('../jeux');
const store = require('../store');
const { TWITCH_URL, buildStreamContainer, choisirJeu, programmerRappel } = require('../service');

const DUREE_EVENT_MS = 180 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream')
    .setDescription('Annonce un stream jeu vidéo sur la chaîne Twitch')
    .addStringOption((option) =>
      option.setName('jeu').setDescription('Titre du jeu à rechercher').setRequired(true).setMaxLength(100)
    ),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireStreamerRole(interaction))) return;

    const channelId = config.stream.channelId;
    if (!channelId) {
      return interaction.reply({ content: '❌ STREAM_CHANNEL_ID non configuré — commande indisponible.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const message = await interaction.editReply({ content: 'Recherche en cours...' });

    const titre = interaction.options.getString('jeu', true).trim();
    const resultats = await rechercherJeux(titre);
    if (resultats.length === 0) {
      return interaction.editReply({ content: `❌ Aucun jeu trouvé pour "${titre}".`, components: [] });
    }

    const fiche = await choisirJeu(interaction, message, resultats);
    if (!fiche) return; // message d'erreur/timeout déjà posté par choisirJeu

    const jourChoisi = await demanderJour(interaction, message);
    if (!jourChoisi) return; // message d'erreur/timeout déjà posté par demanderJour

    const heureChoisie = await demanderHeure(interaction, message, {
      defaut: '20h30',
      label: `l'heure du stream (${formatJourFr(jourChoisi)})`,
    });
    if (!heureChoisie) return; // message d'erreur/timeout déjà posté par demanderHeure
    const dateSeance = atHeure(jourChoisi, heureChoisie.heure, heureChoisie.minute);

    const annonceTexte = await demanderMessagePersonnalise(interaction, message, {
      defaut: `Stream jeu vidéo programmé pour ${formatJourFr(jourChoisi).toLowerCase()} !`,
    });
    if (!annonceTexte) return; // message d'erreur/timeout déjà posté par demanderMessagePersonnalise

    const salonAnnonce = await interaction.guild.channels.fetch(channelId);
    if (!salonAnnonce) {
      return interaction.editReply({ content: `❌ Salon d'annonce introuvable (ID ${channelId}).`, components: [] });
    }

    // Event "externe" : le stream a lieu sur Twitch, pas dans un salon vocal.
    let eventId = null;
    try {
      const evenement = await interaction.guild.scheduledEvents.create({
        name: `Stream : ${fiche.titre}`.slice(0, 100),
        scheduledStartTime: dateSeance,
        scheduledEndTime: new Date(dateSeance.getTime() + DUREE_EVENT_MS),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: TWITCH_URL },
        description: fiche.overview.slice(0, 950),
      });
      eventId = evenement.id;
    } catch (err) {
      console.error("[STREAM] Impossible de créer l'événement Discord natif :", err);
    }

    const roleId = config.stream.roleId;
    const mention = roleId ? `<@&${roleId}> ` : '';
    const sessionKey = `game:${fiche.source}:${fiche.id}:${dateSeance.getTime()}`;

    store.setAnnonce(sessionKey, {
      dateSeance: dateSeance.toISOString(),
      channelId,
      fiche,
      mention,
      annonceTexte,
      roleId,
      guildId: interaction.guild.id,
      eventId,
    });

    const container = buildStreamContainer({
      sessionKey,
      dateSeance,
      fiche,
      mention,
      annonceTexte,
      guildId: interaction.guild.id,
      eventId,
    });

    const messageAnnonce = await salonAnnonce.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    store.majAnnonce(sessionKey, { messageId: messageAnnonce.id });

    programmerRappel({ sessionKey, channelId, roleId, titre: fiche.titre, dateSeance });

    // Programme en image à jour tout de suite (sans attendre le tick).
    rafraichirProgramme(interaction.client);

    await interaction.editReply({ content: `✅ Annonce postée dans <#${channelId}> !`, components: [] });
  }, 'STREAM'),
};
