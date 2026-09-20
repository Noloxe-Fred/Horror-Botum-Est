const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const withErrorHandling = require('../../../core/withErrorHandling');
const store = require('../store');
const { buildListeContainer } = require('../service');

function trierEntrees(entrees, tri) {
  const copie = [...entrees];
  if (tri === 'note') return copie.sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0));
  if (tri === 'duree') return copie.sort((a, b) => (a.duree || 0) - (b.duree || 0));
  // par défaut : plus récemment ajouté d'abord
  return copie.sort((a, b) => new Date(b.dateAjout) - new Date(a.dateAjout));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('Liste la watchlist ciné-club')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Filtrer par type')
        .addChoices({ name: 'Film', value: 'movie' }, { name: 'Série', value: 'tv' })
    )
    .addStringOption((option) =>
      option.setName('genre').setDescription('Filtrer par genre (ex: Horreur)')
    )
    .addStringOption((option) =>
      option
        .setName('tri')
        .setDescription('Ordre de tri')
        .addChoices(
          { name: 'Plus récemment ajouté', value: 'recent' },
          { name: 'Meilleure note', value: 'note' },
          { name: 'Durée croissante', value: 'duree' }
        )
    ),

  execute: withErrorHandling(async (interaction) => {
    await interaction.deferReply();

    const type = interaction.options.getString('type');
    const genre = interaction.options.getString('genre');
    const tri = interaction.options.getString('tri') || 'recent';

    let entrees = store.listWatchlist(type ? { mediaType: type } : {});
    if (genre) {
      const genreLower = genre.toLowerCase();
      entrees = entrees.filter((e) => (e.genres || []).some((g) => g.toLowerCase().includes(genreLower)));
    }
    entrees = trierEntrees(entrees, tri);

    if (entrees.length === 0) {
      return interaction.editReply('📭 Aucun titre ne correspond à ces filtres (ou la watchlist est vide).');
    }

    const lignes = entrees.slice(0, 25).map((e, i) => {
      const noteTxt = e.voteAverage ? `⭐ ${e.voteAverage}/10` : '⭐ N/A';
      const dureeTxt = e.duree ? `⏱️ ${e.duree} min` : '⏱️ N/A';
      const emoji = e.mediaType === 'tv' ? '📺' : '🎬';
      return `**${i + 1}.** ${emoji} **${e.titre}**\n${noteTxt}   ·   ${dureeTxt}   ·   proposé par ${e.proposePar.tag}`;
    });

    const footer =
      entrees.length > 25 ? `+${entrees.length - 25} autre(s) titre(s) non affiché(s) — affine les filtres.` : null;

    const container = buildListeContainer({
      titre: `Watchlist ciné-club (${entrees.length} titre${entrees.length > 1 ? 's' : ''})`,
      lignes,
      footer,
    });

    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
  }, 'CINE-CLUB-LIST'),
};
