const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const config = require('../../../config');
const { requireAnyRole } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const store = require('../store');

// Un select menu Discord est limité à 25 options : au-delà, on pagine.
const TAILLE_PAGE = 25;
const DELAI_MS = 120_000;

function cle(entree) {
  return `${entree.mediaType}:${entree.tmdbId}`;
}

function watchlistTriee() {
  return store
    .listWatchlist()
    .sort((a, b) => a.titre.localeCompare(b.titre, 'fr', { sensitivity: 'base' }));
}

/** Construit le contenu + composants de la page `page` du formulaire. */
function construireVue(entrees, page, entete = '') {
  const nbPages = Math.max(1, Math.ceil(entrees.length / TAILLE_PAGE));
  const pageCourante = Math.min(page, nbPages - 1);

  if (entrees.length === 0) {
    return { page: 0, vue: { content: `${entete}📭 La watchlist est vide.`, components: [] } };
  }

  const tranche = entrees.slice(pageCourante * TAILLE_PAGE, (pageCourante + 1) * TAILLE_PAGE);

  const select = new StringSelectMenuBuilder()
    .setCustomId('watchlist_delete_select')
    .setPlaceholder('Titres à retirer de la watchlist…')
    .setMinValues(1)
    .setMaxValues(tranche.length)
    .addOptions(
      tranche.map((e) => ({
        label: `${e.mediaType === 'tv' ? '📺' : '🎬'} ${e.titre}`.slice(0, 100),
        description: `Proposé par ${e.proposePar?.tag || 'inconnu'}`.slice(0, 100),
        value: cle(e),
      }))
    );

  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('watchlist_delete_prev')
      .setLabel('◀️ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageCourante === 0),
    new ButtonBuilder()
      .setCustomId('watchlist_delete_next')
      .setLabel('Suivant ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageCourante >= nbPages - 1),
    new ButtonBuilder().setCustomId('watchlist_delete_done').setLabel('Terminer').setStyle(ButtonStyle.Primary)
  );

  return {
    page: pageCourante,
    vue: {
      content:
        `${entete}🗑️ Sélectionne les titres à retirer de la watchlist ` +
        `(${entrees.length} au total — page ${pageCourante + 1}/${nbPages}).`,
      components: [new ActionRowBuilder().addComponents(select), boutons],
    },
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete-watchlist')
    .setDescription('Retire un ou plusieurs titres de la watchlist ciné-club'),

  execute: withErrorHandling(async (interaction) => {
    if (
      !(await requireAnyRole(interaction, [config.cineClub.streamerRoleId], {
        label: 'le rôle streamer ciné-club',
      }))
    )
      return;

    let entrees = watchlistTriee();
    let { page, vue } = construireVue(entrees, 0);
    const message = await interaction.reply({ ...vue, ephemeral: true, fetchReply: true });
    if (entrees.length === 0) return;

    // Boucle du formulaire : suppressions successives et navigation entre
    // les pages jusqu'à "Terminer" ou expiration.
    while (true) {
      let choix;
      try {
        choix = await message.awaitMessageComponent({
          filter: (i) => i.user.id === interaction.user.id,
          time: DELAI_MS,
        });
      } catch {
        return interaction.editReply({ content: '⌛ Temps écoulé, formulaire fermé.', components: [] });
      }

      if (choix.customId === 'watchlist_delete_done') {
        return choix.update({ content: '✅ Formulaire fermé.', components: [] });
      }

      let entete = '';
      if (choix.customId === 'watchlist_delete_prev') page -= 1;
      if (choix.customId === 'watchlist_delete_next') page += 1;
      if (choix.customId === 'watchlist_delete_select') {
        const retires = [];
        for (const valeur of choix.values) {
          const entree = entrees.find((e) => cle(e) === valeur);
          const [mediaType, tmdbId] = valeur.split(':');
          if (store.removeFromWatchlist(tmdbId, mediaType) && entree) retires.push(entree.titre);
        }
        entrees = watchlistTriee();
        entete = retires.length
          ? `✅ Retiré(s) de la watchlist : ${retires.map((t) => `**${t}**`).join(', ')}\n\n`
          : '';
      }

      ({ page, vue } = construireVue(entrees, page, entete));
      await choix.update(vue);
      if (entrees.length === 0) return;
    }
  }, 'CINE-CLUB-DELETE-WATCHLIST'),
};
