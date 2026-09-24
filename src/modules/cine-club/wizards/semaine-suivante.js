const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../store');
const tmdb = require('../tmdb');
const { creneauxFilmSemaineSuivante } = require('../dateUtils');
const {
  attendreClic,
  selectionnerDansWatchlist,
  demanderTitreTmdb,
  choisirResultatTmdb,
  posterFichesCandidats,
  posterSondageDate,
  demanderHeure,
} = require('../service');

/**
 * Branche "Séances Ciné semaine suivante" de /cine — reprend l'ancien
 * tandem /poll (type film) + /host : choix du mode de sélection, choix de
 * l'heure pour les 3 créneaux (mardi/vendredi/samedi), publication des
 * fiches candidat(s) + du sondage de date à boutons (comptage automatique),
 * puis pose le bouton persistant "Valider (streamer)".
 *
 * Modes : Aléatoire / Manuel / Direct piochent dans la watchlist ; TMDB
 * permet de proposer un film hors watchlist (recherche libre), traité
 * ensuite comme le mode Direct (un seul film, pas de vote sur le titre).
 */
async function runSemaineSuivanteWizard(interaction, message) {
  await interaction.editReply({
    content: '🎬 **Séances Ciné semaine suivante** — quel mode de sélection ?',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cine_mode_random').setLabel('🎲 Aléatoire').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cine_mode_manual').setLabel('🖱️ Manuel').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cine_mode_direct').setLabel('🎯 Direct').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cine_mode_tmdb').setLabel('🔎 Recherche TMDB').setStyle(ButtonStyle.Secondary)
      ),
    ],
  });

  let clicMode;
  try {
    clicMode = await attendreClic(message, interaction.user.id, [
      'cine_mode_random',
      'cine_mode_manual',
      'cine_mode_direct',
      'cine_mode_tmdb',
    ]);
  } catch {
    return interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
  }
  const mode = clicMode.customId.replace('cine_mode_', '');
  // Le mode TMDB ouvre une modale : elle doit être la toute première
  // réponse au clic, donc pas de deferUpdate() dans ce cas.
  if (mode !== 'tmdb') await clicMode.deferUpdate();

  const watchlist = store.listWatchlist({ mediaType: 'movie' });
  let candidats = [];

  if (mode === 'tmdb') {
    const titre = await demanderTitreTmdb(interaction, clicMode, message, { label: 'Film à proposer' });
    if (!titre) return;

    await interaction.editReply({ content: 'Recherche en cours...', components: [] });
    const resultats = (await tmdb.searchMulti(titre, { limit: 20 }))
      .filter((r) => r.mediaType === 'movie')
      .slice(0, 10);
    if (resultats.length === 0) {
      return interaction.editReply({ content: `❌ Aucun film TMDB trouvé pour "${titre}".`, components: [] });
    }
    const choisi = await choisirResultatTmdb(interaction, message, resultats);
    if (!choisi) return; // message d'erreur/timeout déjà posté par choisirResultatTmdb
    candidats = [choisi];
  } else if (mode === 'random') {
    if (watchlist.length < 2) {
      return interaction.editReply({ content: '❌ Pas assez de films dans la watchlist (minimum 2).', components: [] });
    }
    const nb = Math.min(watchlist.length, Math.floor(Math.random() * 6) + 5); // 5 à 10
    candidats = [...watchlist].sort(() => Math.random() - 0.5).slice(0, nb);
  } else if (mode === 'manual') {
    candidats = await selectionnerDansWatchlist(interaction, message, watchlist, { multi: true });
    if (candidats.length < 2) {
      return interaction.editReply({ content: '❌ Il faut sélectionner au moins 2 titres pour un sondage.', components: [] });
    }
  } else {
    candidats = await selectionnerDansWatchlist(interaction, message, watchlist, { multi: false });
    if (candidats.length === 0) return; // message d'erreur déjà posté par le sélecteur
  }

  const heureChoisie = await demanderHeure(interaction, message, {
    defaut: '21h00',
    label: "l'heure de diffusion pour les 3 créneaux proposés",
  });
  if (!heureChoisie) return; // message d'erreur/timeout déjà posté par demanderHeure

  const creneaux = creneauxFilmSemaineSuivante(heureChoisie.heure, heureChoisie.minute);
  const donneesPoll = {
    type: 'movie',
    mode,
    titresCandidats: candidats.map((c) => ({
      tmdbId: c.tmdbId,
      mediaType: c.mediaType,
      titre: c.titre,
      posterUrl: c.posterUrl,
      voteAverage: c.voteAverage,
      duree: c.duree,
    })),
    creneaux: creneaux.map((c) => ({ label: c.label, date: c.date.toISOString() })),
    dateCreation: new Date().toISOString(),
  };
  const pollId = store.creerPollEnAttente(donneesPoll);

  // Modes Direct/TMDB : un seul candidat déjà choisi, sa fiche est juste
  // affichée (pas de réaction, rien à voter sur le film). Aléatoire/Manuel :
  // chaque candidat reçoit sa fiche + une réaction numérotée pour voter.
  const avecVote = mode === 'random' || mode === 'manual';
  await posterFichesCandidats(interaction.channel, candidats, { avecVote });
  await posterSondageDate(interaction.channel, { ...donneesPoll, votesCreneaux: {} }, pollId);

  await interaction.channel.send({
    content:
      '🔒 Une fois le dépouillement fait (titre + créneau horaire), ' +
      'clique ci-dessous pour valider la séance (réservé admin/streamer).',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cine_valider:${pollId}`).setLabel('✅ Valider (streamer)').setStyle(ButtonStyle.Success)
      ),
    ],
  });

  await interaction.editReply({
    content: `✅ Sondage(s) publié(s) dans <#${interaction.channel.id}> ! Utilise le bouton "Valider (streamer)" une fois le dépouillement fait.`,
    components: [],
  });
}

module.exports = { runSemaineSuivanteWizard };
