const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const config = require('../../../config');
const tmdb = require('../tmdb');
const store = require('../store');
const { ceSoirA, parseHeure } = require('../dateUtils');
const {
  choisirResultatTmdb,
  demanderSalonVocal,
  demanderMessagePersonnalise,
  buildSeanceContainer,
} = require('../service');

/**
 * Demande titre + heure en une seule modale (reprend les deux options de
 * l'ancien /arrache). `clicBouton` est le clic du menu principal /cine qui
 * déclenche l'ouverture — une modale doit être la toute première réponse à
 * son interaction, donc ce clic ne doit pas avoir été deferUpdate() avant.
 */
async function demanderTitreEtHeure(clicBouton, message) {
  const modal = new ModalBuilder().setCustomId('arrache_modal').setTitle("Séance à l'arrache");
  const titreInput = new TextInputBuilder()
    .setCustomId('arrache_titre')
    .setLabel('Film à diffuser ce soir')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const heureInput = new TextInputBuilder()
    .setCustomId('arrache_heure')
    .setLabel('Heure de diffusion (ex: 21h, 21h30)')
    .setStyle(TextInputStyle.Short)
    .setValue('21h00')
    .setRequired(true)
    .setMaxLength(5);
  modal.addComponents(
    new ActionRowBuilder().addComponents(titreInput),
    new ActionRowBuilder().addComponents(heureInput)
  );
  await clicBouton.showModal(modal);

  let soumission;
  try {
    soumission = await clicBouton.awaitModalSubmit({
      filter: (i) => i.user.id === clicBouton.user.id && i.customId === 'arrache_modal',
      time: 120_000,
    });
  } catch {
    await message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }

  const titre = soumission.fields.getTextInputValue('arrache_titre').trim();
  const heureBrute = soumission.fields.getTextInputValue('arrache_heure').trim();
  await soumission.deferUpdate();

  const heureChoisie = parseHeure(heureBrute);
  if (!heureChoisie) {
    await message.edit({
      content: `❌ Heure invalide ("${heureBrute}"), commande annulée. Utilise un format du type "21h" ou "21h30".`,
      components: [],
    });
    return null;
  }

  return { titre, heureChoisie };
}

/**
 * Branche "Séance à l'arrache" de /cine — reprend l'ancien /arrache :
 * recherche TMDB immédiate, séance ce soir, aucun sondage ni rappel
 * programmé.
 */
async function runArracheWizard(interaction, clicBouton, message) {
  const saisie = await demanderTitreEtHeure(clicBouton, message);
  if (!saisie) return;
  const { titre, heureChoisie } = saisie;

  await message.edit({ content: 'Recherche en cours...', components: [] });

  const resultats = await tmdb.searchMulti(titre, { limit: 10 });
  if (resultats.length === 0) {
    return message.edit({ content: `❌ Aucun résultat TMDB pour "${titre}".`, components: [] });
  }

  const choisi = await choisirResultatTmdb(interaction, message, resultats);
  if (!choisi) return; // message d'erreur/timeout déjà posté par choisirResultatTmdb

  const fiche = await tmdb.getDetails(choisi.tmdbId, choisi.mediaType);
  const dateSeance = ceSoirA(heureChoisie.heure, heureChoisie.minute);

  const salonVocalId = await demanderSalonVocal(interaction, message);
  if (!salonVocalId) return; // message d'erreur/timeout déjà posté

  const annonceTexte = await demanderMessagePersonnalise(interaction, message, {
    defaut: 'Séance improvisée ce soir, amenez du pop-corn !',
  });
  if (!annonceTexte) return; // message d'erreur/timeout déjà posté par demanderMessagePersonnalise

  const targetChannelId = config.cineClub.channelArracheId || config.cineClub.channelId;
  const salonAnnonce = await interaction.guild.channels.fetch(targetChannelId);
  if (!salonAnnonce) {
    return message.edit({ content: `❌ Salon d'annonce introuvable (ID ${targetChannelId}).`, components: [] });
  }

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

  // Pas de rappels programmés (annonce immédiate pour ce soir, décision
  // d'origine inchangée).

  store.addToHistorique({
    tmdbId: fiche.tmdbId,
    mediaType: fiche.mediaType,
    titre: fiche.titre,
    dateVu: dateSeance.toISOString(),
    posterUrl: fiche.posterUrl,
    source: 'arrache',
  });

  await message.edit({ content: `✅ Annonce postée dans <#${targetChannelId}> !`, components: [] });
}

module.exports = { runArracheWizard };
