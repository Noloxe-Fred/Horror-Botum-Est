const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const withErrorHandling = require('../../../core/withErrorHandling');
const tmdb = require('../tmdb');
const store = require('../store');
const {
  buildFicheContainer,
  prependTextDisplay,
  choisirResultatTmdb,
  doublonWatchlist,
  doublonHistorique,
} = require('../service');

function construireEntreeWatchlist(fiche, interaction) {
  return {
    tmdbId: fiche.tmdbId,
    mediaType: fiche.mediaType,
    titre: fiche.titre,
    posterUrl: fiche.posterUrl,
    voteAverage: fiche.voteAverage,
    duree: fiche.duree,
    genres: fiche.genres,
    dateAjout: new Date().toISOString(),
    proposePar: { id: interaction.user.id, tag: interaction.user.tag },
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('Ajoute un film/série à la watchlist commune')
    .addStringOption((option) =>
      option.setName('titre').setDescription('Titre à ajouter').setRequired(true)
    ),

  execute: withErrorHandling(async (interaction) => {
    await interaction.deferReply();

    const titre = interaction.options.getString('titre');
    const resultats = await tmdb.searchMulti(titre, { limit: 25 });

    if (resultats.length === 0) {
      return interaction.editReply(`❌ Aucun résultat TMDB pour "${titre}".`);
    }

    const message = await interaction.editReply({ content: 'Recherche en cours...' });

    // Plusieurs résultats possibles -> on demande lequel, plutôt que de
    // prendre le premier au hasard (risque d'ajouter le mauvais titre,
    // ex: un remake, une série du même nom, etc.).
    const choisi = await choisirResultatTmdb(interaction, message, resultats);
    if (!choisi) return; // message d'erreur/timeout déjà posté

    const fiche = await tmdb.getDetails(choisi.tmdbId, choisi.mediaType);

    // 1. Doublon dans la watchlist active -> refus.
    const dejaEnWatchlist = doublonWatchlist(fiche);
    if (dejaEnWatchlist) {
      return message.edit({
        content:
          `❌ **${fiche.titre}** est déjà dans la watchlist — proposé par ` +
          `**${dejaEnWatchlist.proposePar.tag}** le ${new Date(dejaEnWatchlist.dateAjout).toLocaleDateString('fr-FR')}.`,
        embeds: [],
        components: [],
      });
    }

    // 2. Doublon dans l'historique (déjà vu) -> confirmation, pas de blocage.
    const dejaVu = doublonHistorique(fiche);
    if (dejaVu) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('add_confirm').setLabel('Ajouter quand même').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('add_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      );

      await message.edit({
        content:
          `⚠️ **${fiche.titre}** a déjà été vu le ${new Date(dejaVu.dateVu).toLocaleDateString('fr-FR')}. ` +
          `L'ajouter quand même à la watchlist ?`,
        embeds: [],
        components: [row],
      });

      try {
        const choix = await message.awaitMessageComponent({
          filter: (i) => i.user.id === interaction.user.id,
          time: 60_000,
        });

        if (choix.customId === 'add_cancel') {
          return choix.update({ content: '❌ Ajout annulé.', components: [] });
        }

        const entree = store.addToWatchlist(construireEntreeWatchlist(fiche, interaction));
        const container = prependTextDisplay(
          buildFicheContainer(fiche),
          `✅ **${entree.titre}** ajouté à la watchlist (proposé par ${interaction.user.tag}).`
        );
        return choix.update({
          content: null,
          embeds: [],
          flags: MessageFlags.IsComponentsV2,
          components: [container],
        });
      } catch {
        return message.edit({ content: '⌛ Temps écoulé, ajout annulé.', components: [] });
      }
    }

    // 3. Pas de doublon -> ajout direct.
    const entree = store.addToWatchlist(construireEntreeWatchlist(fiche, interaction));
    const container = prependTextDisplay(
      buildFicheContainer(fiche),
      `✅ **${entree.titre}** ajouté à la watchlist (proposé par ${interaction.user.tag}).`
    );
    await message.edit({
      content: null,
      embeds: [],
      flags: MessageFlags.IsComponentsV2,
      components: [container],
    });
  }, 'CINE-CLUB-ADD'),
};
