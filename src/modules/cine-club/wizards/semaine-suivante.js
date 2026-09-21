const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../store');
const { creneauxFilmSemaineSuivante } = require('../dateUtils');
const {
  attendreClic,
  selectionnerDansWatchlist,
  posterSondageReactions,
  posterSondageHoraire,
  demanderHeure,
} = require('../service');

/**
 * Branche "Séances Ciné semaine suivante" de /cine — reprend l'ancien
 * tandem /poll (type film) + /host : choix du mode de sélection, choix de
 * l'heure pour les 3 créneaux (mardi/vendredi/samedi), publication du(des)
 * sondage(s), puis pose le bouton persistant "Valider séance".
 */
async function runSemaineSuivanteWizard(interaction, message) {
  await message.edit({
    content: '🎬 **Séances Ciné semaine suivante** — quel mode de sélection ?',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cine_mode_random').setLabel('🎲 Aléatoire').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cine_mode_manual').setLabel('🖱️ Manuel').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cine_mode_direct').setLabel('🎯 Direct').setStyle(ButtonStyle.Primary)
      ),
    ],
  });

  let clicMode;
  try {
    clicMode = await attendreClic(message, interaction.user.id, ['cine_mode_random', 'cine_mode_manual', 'cine_mode_direct']);
  } catch {
    return message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
  }
  await clicMode.deferUpdate();
  const mode = clicMode.customId.replace('cine_mode_', '');

  const watchlist = store.listWatchlist({ mediaType: 'movie' });
  let candidats = [];

  if (mode === 'random') {
    if (watchlist.length < 2) {
      return message.edit({ content: '❌ Pas assez de films dans la watchlist (minimum 2).', components: [] });
    }
    const nb = Math.min(watchlist.length, Math.floor(Math.random() * 6) + 5); // 5 à 10
    candidats = [...watchlist].sort(() => Math.random() - 0.5).slice(0, nb);
  } else if (mode === 'manual') {
    candidats = await selectionnerDansWatchlist(interaction, message, watchlist, { multi: true });
    if (candidats.length < 2) {
      return message.edit({ content: '❌ Il faut sélectionner au moins 2 titres pour un sondage.', components: [] });
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

  if (mode === 'direct') {
    await interaction.channel.send(`🎯 **Sélection directe** — la prochaine séance film sera : **${candidats[0].titre}** !`);
  } else {
    await posterSondageReactions(interaction.channel, 'Sondage film — vote pour la prochaine séance !', candidats);
  }

  const creneaux = creneauxFilmSemaineSuivante(heureChoisie.heure, heureChoisie.minute);
  await posterSondageHoraire(interaction.channel, creneaux);

  const pollId = store.creerPollEnAttente({
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
  });

  await interaction.channel.send({
    content:
      '🔒 Une fois le dépouillement fait (titre + créneau horaire), ' +
      'clique ci-dessous pour valider la séance (réservé admin/streamer).',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cine_valider:${pollId}`).setLabel('✅ Valider séance').setStyle(ButtonStyle.Success)
      ),
    ],
  });

  await message.edit({
    content: `✅ Sondage(s) publié(s) dans <#${interaction.channel.id}> ! Utilise le bouton "Valider séance" une fois le dépouillement fait.`,
    components: [],
  });
}

module.exports = { runSemaineSuivanteWizard };
