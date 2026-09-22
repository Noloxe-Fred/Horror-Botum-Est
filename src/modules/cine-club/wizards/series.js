const {
  MessageFlags,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const config = require('../../../config');
const tmdb = require('../tmdb');
const store = require('../store');
const { prochainLundiA } = require('../dateUtils');
const {
  demanderTitreTmdb,
  choisirResultatTmdb,
  demanderSalonVocal,
  demanderHeure,
  demanderMessagePersonnalise,
  buildSeanceContainer,
  programmerRappels,
} = require('../service');

/**
 * Branche "Séances Séries" de /cine — recherche TMDB directe (pas de
 * sondage), séance fixée au lundi suivant, publiée dans le salon dédié
 * (CINE_CLUB_CHANNEL_SERIE_ID) où les gens s'inscrivent via "Je serai
 * présent" comme pour une séance à l'arrache. Alimente `/serie-en-cours`.
 * `clicBouton` est le clic du menu principal /cine qui déclenche l'ouverture
 * de la modale de recherche — il ne doit pas avoir été deferUpdate() avant.
 */
async function runSeriesWizard(interaction, clicBouton, message) {
  const titre = await demanderTitreTmdb(interaction, clicBouton, message, { label: 'Série à diffuser lundi prochain' });
  if (!titre) return;

  await interaction.editReply({ content: 'Recherche en cours...', components: [] });

  const resultats = await tmdb.searchMulti(titre, { limit: 10 });
  if (resultats.length === 0) {
    return interaction.editReply({ content: `❌ Aucun résultat TMDB pour "${titre}".`, components: [] });
  }

  const choisi = await choisirResultatTmdb(interaction, message, resultats);
  if (!choisi) return; // message d'erreur/timeout déjà posté par choisirResultatTmdb

  const heureChoisie = await demanderHeure(interaction, message, {
    defaut: '21h00',
    label: "l'heure de diffusion (lundi prochain)",
  });
  if (!heureChoisie) return; // message d'erreur/timeout déjà posté par demanderHeure
  const dateSeance = prochainLundiA(heureChoisie.heure, heureChoisie.minute);

  const salonVocalId = await demanderSalonVocal(interaction, message);
  if (!salonVocalId) return; // message d'erreur/timeout déjà posté

  const annonceTexte = await demanderMessagePersonnalise(interaction, message, {
    defaut: 'Nouvelle séance série ciné-club programmée !',
  });
  if (!annonceTexte) return; // message d'erreur/timeout déjà posté par demanderMessagePersonnalise

  const targetChannelId = config.cineClub.channelSerieId || config.cineClub.channelId;
  const salonAnnonce = await interaction.guild.channels.fetch(targetChannelId);
  if (!salonAnnonce) {
    return interaction.editReply({ content: `❌ Salon d'annonce introuvable (ID ${targetChannelId}).`, components: [] });
  }

  const fiche = await tmdb.getDetails(choisi.tmdbId, choisi.mediaType);

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

  const roleId = config.cineClub.roles.seancesSerie;
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
    source: 'serie',
  });

  // Référence vers l'annonce complète plutôt qu'une copie des données —
  // évite toute désynchronisation si la séance est mise à jour (présences,
  // event démarré...) — voir /serie-en-cours qui relit cette référence.
  store.setSerieCourante({
    tmdbId: fiche.tmdbId,
    titre: fiche.titre,
    dateDebut: dateSeance.toISOString(),
    sessionKey,
  });

  await interaction.editReply({ content: `✅ Annonce postée dans <#${targetChannelId}> !`, components: [] });
}

module.exports = { runSeriesWizard };
