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
const { rafraichirProgramme } = require('../programme/service');
const { prochainsJours, formatJourFr, atHeure } = require('../dateUtils');
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

const NB_JOURS_PROPOSES = 21; // 3 semaines (un select Discord accepte 25 options max)

/**
 * Branche "Séance Libre" de /cine — programme un film à une date libre
 * parmi les NB_JOURS_PROPOSES prochains jours (à partir de demain), à une heure
 * libre. Film choisi soit dans la watchlist, soit via une recherche TMDB
 * libre. Rôle à mentionner (Séances Cinés / Ciné Classiques / Courts
 * Métrages) choisi par le streamer, comme /host.
 */
async function runSeanceLibreWizard(interaction, message) {
  await interaction.editReply({
    content: '🗓️ **Séance Libre** — comment choisir le film ?',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cinelibre_source_watchlist').setLabel('🎯 Watchlist').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cinelibre_source_tmdb').setLabel('🔎 Recherche TMDB').setStyle(ButtonStyle.Primary)
      ),
    ],
  });

  let clicSource;
  try {
    clicSource = await attendreClic(message, interaction.user.id, ['cinelibre_source_watchlist', 'cinelibre_source_tmdb']);
  } catch {
    return interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
  }

  let elu; // { tmdbId, mediaType }

  if (clicSource.customId === 'cinelibre_source_watchlist') {
    await clicSource.deferUpdate();
    const watchlist = store.listWatchlist({ mediaType: 'movie' });
    const choix = await selectionnerDansWatchlist(interaction, message, watchlist, { multi: false });
    if (choix.length === 0) return; // message d'erreur déjà posté par le sélecteur
    elu = choix[0];
  } else {
    // Recherche TMDB : la modale doit être la toute première réponse à ce
    // clic, donc pas de deferUpdate() avant demanderTitreTmdb().
    const titre = await demanderTitreTmdb(interaction, clicSource, message, { label: 'Film à diffuser' });
    if (!titre) return;

    await interaction.editReply({ content: 'Recherche en cours...', components: [] });
    const resultats = await tmdb.searchMulti(titre, { limit: 10 });
    if (resultats.length === 0) {
      return interaction.editReply({ content: `❌ Aucun résultat TMDB pour "${titre}".`, components: [] });
    }
    const choisi = await choisirResultatTmdb(interaction, message, resultats);
    if (!choisi) return; // message d'erreur/timeout déjà posté par choisirResultatTmdb
    elu = choisi;
  }

  const jours = prochainsJours(NB_JOURS_PROPOSES);
  const selectJour = new StringSelectMenuBuilder()
    .setCustomId('cinelibre_jour')
    .setPlaceholder('Jour de la séance')
    .addOptions(jours.map((j, i) => ({ label: formatJourFr(j), value: String(i) })));

  await interaction.editReply({
    content: 'Quel jour ?',
    components: [new ActionRowBuilder().addComponents(selectJour)],
  });

  let clicJour;
  try {
    clicJour = await attendreClic(message, interaction.user.id, ['cinelibre_jour']);
  } catch {
    return interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
  }
  await clicJour.deferUpdate();
  const jourChoisi = jours[Number(clicJour.values[0])];

  const heureChoisie = await demanderHeure(interaction, message, {
    defaut: '21h00',
    label: `l'heure de diffusion (${formatJourFr(jourChoisi)})`,
  });
  if (!heureChoisie) return; // message d'erreur/timeout déjà posté par demanderHeure
  const dateSeance = atHeure(jourChoisi, heureChoisie.heure, heureChoisie.minute);

  const selectRole = new StringSelectMenuBuilder()
    .setCustomId('cinelibre_role')
    .setPlaceholder('Type de séance')
    .addOptions(TYPES_SEANCE_FILM.map((t) => ({ label: t.label, value: t.id })));

  await interaction.editReply({
    content: 'Quel type de séance ?',
    components: [new ActionRowBuilder().addComponents(selectRole)],
  });

  let clicRole;
  try {
    clicRole = await attendreClic(message, interaction.user.id, ['cinelibre_role']);
  } catch {
    return interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
  }
  await clicRole.deferUpdate();
  const roleId = roleIdPourTypeSeance(clicRole.values[0]);

  const salonVocalId = await demanderSalonVocal(interaction, message);
  if (!salonVocalId) return; // message d'erreur/timeout déjà posté

  const annonceTexte = await demanderMessagePersonnalise(interaction, message, {
    defaut: `Séance Ciné programmée pour ${formatJourFr(jourChoisi).toLowerCase()} !`,
  });
  if (!annonceTexte) return; // message d'erreur/timeout déjà posté par demanderMessagePersonnalise

  const targetChannelId = config.cineClub.channelId;
  const salonAnnonce = await interaction.guild.channels.fetch(targetChannelId);
  if (!salonAnnonce) {
    return interaction.editReply({ content: `❌ Salon d'annonce introuvable (ID ${targetChannelId}).`, components: [] });
  }

  const fiche = await tmdb.getDetails(elu.tmdbId, elu.mediaType);

  let eventId = null;
  try {
    const evenement = await interaction.guild.scheduledEvents.create({
      name: `Séances Ciné : ${fiche.titre}`,
      scheduledStartTime: dateSeance,
      scheduledEndTime: new Date(dateSeance.getTime() + 150 * 60 * 1000),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.Voice,
      channel: salonVocalId,
      description: fiche.overview.slice(0, 950),
    });
    eventId = evenement.id;
  } catch (err) {
    console.error("[SEANCES-CINE] Impossible de créer l'événement Discord natif :", err);
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

  const messageAnnonce = await salonAnnonce.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
  store.majAnnonce(sessionKey, { messageId: messageAnnonce.id });

  programmerRappels({
    sessionKey,
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
    source: 'libre',
  });

  // Programme en image à jour tout de suite (sans attendre le tick).
  rafraichirProgramme(interaction.client);

  await interaction.editReply({ content: `✅ Annonce postée dans <#${targetChannelId}> !`, components: [] });
}

module.exports = { runSeanceLibreWizard };
