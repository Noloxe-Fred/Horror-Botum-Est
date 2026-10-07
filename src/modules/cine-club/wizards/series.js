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
const { prochainLundiA } = require('../dateUtils');
const {
  attendreClic,
  demanderTitreTmdb,
  choisirResultatTmdb,
  demanderSalonVocal,
  demanderHeure,
  demanderMessagePersonnalise,
  buildSeanceContainer,
  libelleEpisodesCourt,
  programmerRappels,
} = require('../service');

const EPISODES_PAR_SELECT = 25; // limite Discord d'un select menu
const MAX_SELECTS_EPISODES = 4; // 5e rangée réservée au bouton "Valider"

/**
 * Choix de la saison (select, auto si une seule) puis des épisodes diffusés
 * (liste cochable, découpée en plusieurs selects au-delà de 25 épisodes).
 * Renvoie { saison, liste: [{ numero, titre }] }, ou `null` en cas
 * d'annulation/timeout (message d'erreur déjà posté dans `message`).
 */
async function choisirEpisodes(interaction, message, tmdbId) {
  const saisons = (await tmdb.getSaisons(tmdbId)).filter((s) => s.nbEpisodes > 0).slice(0, 25);
  if (saisons.length === 0) {
    await interaction.editReply({ content: '❌ Aucun épisode référencé sur TMDB pour cette série.', components: [] });
    return null;
  }

  let saison = saisons[0];
  if (saisons.length > 1) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('serie_saison')
      .setPlaceholder('Choisis la saison')
      .addOptions(
        saisons.map((s) => ({
          label: s.nom.slice(0, 100),
          description: `${s.nbEpisodes} épisode${s.nbEpisodes > 1 ? 's' : ''}`,
          value: String(s.numero),
        }))
      );
    await interaction.editReply({
      content: 'Quelle saison ?',
      components: [new ActionRowBuilder().addComponents(select)],
    });

    try {
      const choix = await attendreClic(message, interaction.user.id, ['serie_saison']);
      await choix.deferUpdate();
      saison = saisons.find((s) => String(s.numero) === choix.values[0]);
    } catch {
      await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
      return null;
    }
  }

  const episodes = (await tmdb.getEpisodes(tmdbId, saison.numero)).slice(0, EPISODES_PAR_SELECT * MAX_SELECTS_EPISODES);
  if (episodes.length === 0) {
    await interaction.editReply({ content: `❌ Aucun épisode référencé sur TMDB pour ${saison.nom}.`, components: [] });
    return null;
  }

  const groupes = [];
  for (let i = 0; i < episodes.length; i += EPISODES_PAR_SELECT) {
    groupes.push(episodes.slice(i, i + EPISODES_PAR_SELECT));
  }
  const selectIds = groupes.map((_, i) => `serie_episodes_${i}`);
  // Un Set par select : chaque select ne renvoie que ses propres valeurs.
  const coches = groupes.map(() => new Set());

  const construire = () => {
    const nbCoches = coches.reduce((total, set) => total + set.size, 0);
    const rows = groupes.map((groupe, i) =>
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(selectIds[i])
          .setPlaceholder(`Épisodes ${groupe[0].numero} à ${groupe[groupe.length - 1].numero}`)
          .setMinValues(0)
          .setMaxValues(groupe.length)
          .addOptions(
            groupe.map((e) => ({
              label: `Ép. ${e.numero} — ${e.titre}`.slice(0, 100),
              value: String(e.numero),
              default: coches[i].has(String(e.numero)),
            }))
          )
      )
    );
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('serie_episodes_valider')
          .setLabel(`✅ Valider (${nbCoches} épisode${nbCoches > 1 ? 's' : ''})`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(nbCoches === 0)
      )
    );
    return {
      content: `**${saison.nom}** — coche les épisodes diffusés lundi, puis valide.`,
      components: rows,
    };
  };

  await interaction.editReply(construire());

  for (;;) {
    let clic;
    try {
      clic = await attendreClic(message, interaction.user.id, [...selectIds, 'serie_episodes_valider'], 300_000);
    } catch {
      await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
      return null;
    }

    if (clic.customId === 'serie_episodes_valider') {
      await clic.deferUpdate();
      break;
    }

    coches[selectIds.indexOf(clic.customId)] = new Set(clic.values);
    await clic.update(construire());
  }

  const numerosCoches = new Set(coches.flatMap((set) => [...set]));
  return {
    saison: saison.numero,
    liste: episodes.filter((e) => numerosCoches.has(String(e.numero))),
  };
}

/**
 * Branche "Séances Séries" de /cine — recherche TMDB directe (pas de
 * sondage), choix de la saison et des épisodes diffusés, séance fixée au
 * lundi suivant, publiée dans le salon dédié (CINE_CLUB_CHANNEL_SERIE_ID)
 * où les gens s'inscrivent via "Je serai présent" comme pour une séance à
 * l'arrache. Relancée chaque semaine avec les nouveaux épisodes.
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

  // Pas d'épisodes à choisir si le résultat retenu est un film.
  let episodes = null;
  if (choisi.mediaType === 'tv') {
    episodes = await choisirEpisodes(interaction, message, choisi.tmdbId);
    if (!episodes) return; // message d'erreur/timeout déjà posté par choisirEpisodes
  }

  const heureChoisie = await demanderHeure(interaction, message, {
    defaut: '21h00',
    label: "l'heure de diffusion (lundi prochain)",
  });
  if (!heureChoisie) return; // message d'erreur/timeout déjà posté par demanderHeure
  const dateSeance = prochainLundiA(heureChoisie.heure, heureChoisie.minute);

  const salonVocalId = await demanderSalonVocal(interaction, message);
  if (!salonVocalId) return; // message d'erreur/timeout déjà posté

  const annonceTexte = await demanderMessagePersonnalise(interaction, message, {
    defaut: 'Nouvelle séance série programmée aux Séances Ciné !',
  });
  if (!annonceTexte) return; // message d'erreur/timeout déjà posté par demanderMessagePersonnalise

  const targetChannelId = config.cineClub.channelSerieId || config.cineClub.channelId;
  const salonAnnonce = await interaction.guild.channels.fetch(targetChannelId);
  if (!salonAnnonce) {
    return interaction.editReply({ content: `❌ Salon d'annonce introuvable (ID ${targetChannelId}).`, components: [] });
  }

  const fiche = await tmdb.getDetails(choisi.tmdbId, choisi.mediaType);
  const titreSeance = episodes ? `${fiche.titre} (${libelleEpisodesCourt(episodes)})` : fiche.titre;

  let eventId = null;
  try {
    const evenement = await interaction.guild.scheduledEvents.create({
      name: `Séances Ciné : ${titreSeance}`.slice(0, 100),
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
    episodes,
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
    episodes,
  });

  const messageAnnonce = await salonAnnonce.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
  store.majAnnonce(sessionKey, { messageId: messageAnnonce.id });

  programmerRappels({
    sessionKey,
    channelId: targetChannelId,
    roleId,
    titre: titreSeance,
    dateSeance,
  });

  store.addToHistorique({
    tmdbId: fiche.tmdbId,
    mediaType: fiche.mediaType,
    titre: fiche.titre,
    dateVu: dateSeance.toISOString(),
    posterUrl: fiche.posterUrl,
    source: 'serie',
    episodes,
  });

  // Programme en image à jour tout de suite (sans attendre le tick).
  rafraichirProgramme(interaction.client);

  await interaction.editReply({ content: `✅ Annonce postée dans <#${targetChannelId}> !`, components: [] });
}

module.exports = { runSeriesWizard };
