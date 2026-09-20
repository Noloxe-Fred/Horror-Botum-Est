const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const withErrorHandling = require('../../../core/withErrorHandling');
const tmdb = require('../tmdb');
const { buildFicheContainer, choisirResultatTmdb } = require('../service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Cherche un film ou une série via TMDB')
    .addStringOption((option) =>
      option.setName('titre').setDescription('Titre à rechercher').setRequired(true)
    ),

  execute: withErrorHandling(async (interaction) => {
    await interaction.deferReply();

    const titre = interaction.options.getString('titre');
    const resultats = await tmdb.searchMulti(titre, { limit: 25 });

    if (resultats.length === 0) {
      return interaction.editReply(`❌ Aucun résultat TMDB pour "${titre}".`);
    }

    const message = await interaction.editReply({ content: 'Recherche en cours...' });

    // Un seul résultat : on l'affiche directement. Plusieurs : select menu
    // pour laisser l'utilisateur choisir plutôt que de deviner (avant :
    // le premier résultat était pris automatiquement).
    const choisi = await choisirResultatTmdb(interaction, message, resultats);
    if (!choisi) return; // message d'erreur/timeout déjà posté par choisirResultatTmdb

    const fiche = await tmdb.getDetails(choisi.tmdbId, choisi.mediaType);
    const container = buildFicheContainer(fiche);

    await message.edit({ content: null, embeds: [], flags: MessageFlags.IsComponentsV2, components: [container] });
  }, 'CINE-CLUB-SEARCH'),
};
