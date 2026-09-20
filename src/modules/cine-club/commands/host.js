const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const config = require('../../../config');
const { requireStreamerRole, requireAnyChannel } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const store = require('../store');
const tmdb = require('../tmdb');
const { prochainLundi21h } = require('../dateUtils');
const {
  TYPES_SEANCE_FILM,
  roleIdPourTypeSeance,
  programmerRappels,
  demanderSalonVocal,
  buildSeanceContainer,
} = require('../service');

async function attendreClic(message, userId, customIds, timeout = 120_000) {
  return message.awaitMessageComponent({
    filter: (i) => i.user.id === userId && customIds.includes(i.customId),
    time: timeout,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('host')
    .setDescription("Finalise la séance à partir du dernier /poll et poste l'annonce"),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireStreamerRole(interaction))) return;
    if (
      !(await requireAnyChannel(
        interaction,
        [config.cineClub.channelId, config.cineClub.channelSerieId],
        { label: 'le salon ciné-club ou le salon dédié aux séances série' }
      ))
    )
      return;

    const dernierPoll = store.getDernierPoll();
    if (!dernierPoll || !dernierPoll.titresCandidats || dernierPoll.titresCandidats.length === 0) {
      return interaction.reply({
        content: "❌ Aucun /poll récent en mémoire. Lance d'abord `/poll` avant `/host`.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
    const { titresCandidats, type } = dernierPoll;

    // --- Étape 1 : choix du titre gagnant ---
    let gagnant;
    if (titresCandidats.length === 1) {
      gagnant = titresCandidats[0];
    } else {
      const select = new StringSelectMenuBuilder()
        .setCustomId('host_titre')
        .setPlaceholder('Choisis le titre gagnant')
        .addOptions(
          titresCandidats.map((c) => ({
            label: c.titre.slice(0, 100),
            value: `${c.mediaType}:${c.tmdbId}`,
          }))
        );

      const message = await interaction.editReply({
        content: 'Quel titre a gagné le vote ?',
        components: [new ActionRowBuilder().addComponents(select)],
      });

      let clic;
      try {
        clic = await attendreClic(message, interaction.user.id, ['host_titre']);
      } catch {
        return interaction.editReply({ content: '⌛ Temps écoulé, /host annulé.', components: [] });
      }
      await clic.deferUpdate();
      const [mediaType, tmdbIdStr] = clic.values[0].split(':');
      gagnant = titresCandidats.find((c) => c.mediaType === mediaType && String(c.tmdbId) === tmdbIdStr);
    }

    const message = await interaction.editReply({ content: 'Traitement en cours...', components: [] });

    // --- Étape 2 : date de la séance ---
    let dateSeance;
    if (type === 'movie') {
      if (!dernierPoll.creneaux || dernierPoll.creneaux.length === 0) {
        return message.edit('❌ Aucun créneau d\'horaire enregistré pour ce poll.');
      }
      const row = new ActionRowBuilder().addComponents(
        dernierPoll.creneaux.map((c, i) =>
          new ButtonBuilder().setCustomId(`host_creneau_${i}`).setLabel(c.label).setStyle(ButtonStyle.Primary)
        )
      );
      await message.edit({ content: 'Quel créneau a gagné le sondage d\'horaire ?', components: [row] });

      let clicCreneau;
      try {
        clicCreneau = await attendreClic(
          message,
          interaction.user.id,
          dernierPoll.creneaux.map((_, i) => `host_creneau_${i}`)
        );
      } catch {
        return message.edit({ content: '⌛ Temps écoulé, /host annulé.', components: [] });
      }
      await clicCreneau.deferUpdate();
      const index = Number(clicCreneau.customId.split('_').pop());
      dateSeance = new Date(dernierPoll.creneaux[index].date);
    } else {
      // Série : pas de sondage d'horaire, date fixée automatiquement.
      dateSeance = prochainLundi21h();
    }

    // --- Étape 3 : rôle à mentionner ---
    let roleId;
    if (type === 'movie') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('host_role')
        .setPlaceholder('Type de séance')
        .addOptions(TYPES_SEANCE_FILM.map((t) => ({ label: t.label, value: t.id })));

      await message.edit({
        content: 'Quel type de séance ?',
        components: [new ActionRowBuilder().addComponents(select)],
      });

      let clicRole;
      try {
        clicRole = await attendreClic(message, interaction.user.id, ['host_role']);
      } catch {
        return message.edit({ content: '⌛ Temps écoulé, /host annulé.', components: [] });
      }
      await clicRole.deferUpdate();
      roleId = roleIdPourTypeSeance(clicRole.values[0]);
    } else {
      roleId = config.cineClub.roles.seancesSerie;
    }

    // --- Étape 4 : salon vocal de diffusion (liste dynamique du serveur) ---
    const salonVocalId = await demanderSalonVocal(interaction, message);
    if (!salonVocalId) return; // message d'erreur/timeout déjà posté

    // --- Salon d'annonce : le salon ciné-club d'origine pour un film, un
    // salon dédié pour une série (fallback sur le salon d'origine si non
    // configuré) — même logique que /arrache avec son propre salon dédié.
    const targetChannelId =
      type === 'tv' && config.cineClub.channelSerieId ? config.cineClub.channelSerieId : config.cineClub.channelId;

    const salonAnnonce = await interaction.guild.channels.fetch(targetChannelId);
    if (!salonAnnonce) {
      return message.edit({ content: `❌ Salon d'annonce introuvable (ID ${targetChannelId}).`, components: [] });
    }

    // --- Fiche TMDB complète (synopsis, réalisation, casting, pays à jour) ---
    const fiche = await tmdb.getDetails(gagnant.tmdbId, gagnant.mediaType);

    // --- Événement Discord natif (best-effort, ne bloque pas /host si ça échoue) ---
    let eventId = null;
    try {
      const evenement = await interaction.guild.scheduledEvents.create({
        name: `Ciné-Club : ${fiche.titre}`,
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

    const mention = roleId ? `<@&${roleId}> ` : '';
    const annonceTexte = 'Nouvelle séance ciné-club programmée !';
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

    // --- Rappels J-1 / H-1 / H-15 ---
    programmerRappels({
      channelId: targetChannelId,
      roleId,
      titre: fiche.titre,
      dateSeance,
    });

    // --- Historique + série en cours ---
    store.addToHistorique({
      tmdbId: fiche.tmdbId,
      mediaType: fiche.mediaType,
      titre: fiche.titre,
      dateVu: dateSeance.toISOString(),
      posterUrl: fiche.posterUrl,
      source: 'host',
    });

    if (type === 'tv') {
      store.setSerieCourante({
        tmdbId: fiche.tmdbId,
        titre: fiche.titre,
        dateDebut: dateSeance.toISOString(),
        // Référence vers l'annonce complète (cine-club-annonces) plutôt
        // qu'une copie des données — évite toute désynchronisation si la
        // séance est mise à jour (présences, event démarré...).
        sessionKey,
      });
    }

    // Le pont /poll -> /host a rempli son rôle, on le vide pour éviter
    // qu'un /host ultérieur ne réutilise un poll déjà traité.
    store.clearDernierPoll();

    await message.edit({ content: `✅ Séance programmée et annoncée dans <#${targetChannelId}> !`, components: [] });
  }, 'CINE-CLUB-HOST'),
};
