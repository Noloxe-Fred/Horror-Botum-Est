const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const config = require('../../../config');
const tmdb = require('../tmdb');
const store = require('../store');
const { dansDeuxJoursA } = require('../dateUtils');
const {
  attendreClic,
  selectionnerDansWatchlist,
  demanderTitreTmdb,
  choisirResultatTmdb,
  demanderSalonVocal,
  demanderHeure,
  demanderMessagePersonnalise,
  buildSeanceContainer,
  TYPES_SEANCE_FILM,
  roleIdPourTypeSeance,
  programmerRappels,
} = require('../service');

/**
 * Branche "Séance 48h" de /cine — propose un film pour le surlendemain
 * soir. Film choisi soit dans la watchlist, soit via une recherche TMDB
 * libre. Heure et rôle à mentionner (Séances Cinés / Ciné Classiques /
 * Courts Métrages) choisis par le streamer, comme /host.
 */
async function run48hWizard(interaction, message) {
  await message.edit({
    content: '🕑 **Séance 48h** — comment choisir le film ?',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cine48_source_watchlist').setLabel('🎯 Watchlist').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cine48_source_tmdb').setLabel('🔎 Recherche TMDB').setStyle(ButtonStyle.Primary)
      ),
    ],
  });

  let clicSource;
  try {
    clicSource = await attendreClic(message, interaction.user.id, ['cine48_source_watchlist', 'cine48_source_tmdb']);
  } catch {
    return message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
  }

  let elu; // { tmdbId, mediaType }

  if (clicSource.customId === 'cine48_source_watchlist') {
    await clicSource.deferUpdate();
    const watchlist = store.listWatchlist({ mediaType: 'movie' });
    const choix = await selectionnerDansWatchlist(interaction, message, watchlist, { multi: false });
    if (choix.length === 0) return; // message d'erreur déjà posté par le sélecteur
    elu = choix[0];
  } else {
    // Recherche TMDB : la modale doit être la toute première réponse à ce
    // clic, donc pas de deferUpdate() avant demanderTitreTmdb().
    const titre = await demanderTitreTmdb(clicSource, message, { label: 'Film à diffuser dans 2 jours' });
    if (!titre) return;

    await message.edit({ content: 'Recherche en cours...', components: [] });
    const resultats = await tmdb.searchMulti(titre, { limit: 10 });
    if (resultats.length === 0) {
      return message.edit({ content: `❌ Aucun résultat TMDB pour "${titre}".`, components: [] });
    }
    const choisi = await choisirResultatTmdb(interaction, message, resultats);
    if (!choisi) return; // message d'erreur/timeout déjà posté par choisirResultatTmdb
    elu = choisi;
  }

  const heureChoisie = await demanderHeure(interaction, message, {
    defaut: '21h00',
    label: "l'heure de diffusion (dans 2 jours)",
  });
  if (!heureChoisie) return; // message d'erreur/timeout déjà posté par demanderHeure
  const dateSeance = dansDeuxJoursA(heureChoisie.heure, heureChoisie.minute);

  const selectRole = new StringSelectMenuBuilder()
    .setCustomId('cine48_role')
    .setPlaceholder('Type de séance')
    .addOptions(TYPES_SEANCE_FILM.map((t) => ({ label: t.label, value: t.id })));

  await message.edit({
    content: 'Quel type de séance ?',
    components: [new ActionRowBuilder().addComponents(selectRole)],
  });

  let clicRole;
  try {
    clicRole = await attendreClic(message, interaction.user.id, ['cine48_role']);
  } catch {
    return message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
  }
  await clicRole.deferUpdate();
  const roleId = roleIdPourTypeSeance(clicRole.values[0]);

  const salonVocalId = await demanderSalonVocal(interaction, message);
  if (!salonVocalId) return; // message d'erreur/timeout déjà posté

  const annonceTexte = await demanderMessagePersonnalise(interaction, message, {
    defaut: 'Séance ciné-club programmée dans 2 jours !',
  });
  if (!annonceTexte) return; // message d'erreur/timeout déjà posté par demanderMessagePersonnalise

  const targetChannelId = config.cineClub.channelId;
  const salonAnnonce = await interaction.guild.channels.fetch(targetChannelId);
  if (!salonAnnonce) {
    return message.edit({ content: `❌ Salon d'annonce introuvable (ID ${targetChannelId}).`, components: [] });
  }

  const fiche = await tmdb.getDetails(elu.tmdbId, elu.mediaType);

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

  programmerRappels({
    channelId: targetChannelId,
    roleId,
    titre: fiche.titre,
    dateSeance,
  });

  store.addToHistorique({
    tmdbId: fiche.tmdbId,
    mediaType: fiche.mediaType,
    titre: fiche.titre,
    dateVu: dateSeance.toISOString(),
    posterUrl: fiche.posterUrl,
    source: '48h',
  });

  await message.edit({ content: `✅ Annonce postée dans <#${targetChannelId}> !`, components: [] });
}

module.exports = { run48hWizard };
