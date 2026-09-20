const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const withErrorHandling = require('../../../core/withErrorHandling');
const store = require('../store');
const { buildListeContainer } = require('../service');

const COULEUR_HISTORIQUE = 0x555555;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('historique')
    .setDescription('Affiche les derniers films/séries vus au ciné-club'),

  execute: withErrorHandling(async (interaction) => {
    await interaction.deferReply();

    const entrees = store.listHistorique({ limit: 15 });
    if (entrees.length === 0) {
      return interaction.editReply("📭 Aucun film/série n'a encore été marqué comme vu.");
    }

    const lignes = entrees.map((e) => {
      const emoji = e.mediaType === 'tv' ? '📺' : '🎬';
      const date = new Date(e.dateVu).toLocaleDateString('fr-FR');
      const origine = e.source === 'arrache' ? ' _(à l\'arrache)_' : '';
      return `${emoji} **${e.titre}** — vu le ${date}${origine}`;
    });

    const container = buildListeContainer({
      titre: '🗂️ Historique ciné-club',
      lignes,
      couleur: COULEUR_HISTORIQUE,
    });

    await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
  }, 'CINE-CLUB-HISTORIQUE'),
};
