const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
} = require('discord.js');
const { requireAdmin } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const store = require('../store');

// Un select menu Discord est limité à 25 options : au-delà, on pagine.
const TAILLE_PAGE = 25;
const DELAI_MS = 120_000;

function profilsTries() {
  return Object.values(store.getData().profils).sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' })
  );
}

/** Construit le contenu + composants de la page `page` du formulaire. */
function construireVue(profils, page, entete = '') {
  const nbPages = Math.max(1, Math.ceil(profils.length / TAILLE_PAGE));
  const pageCourante = Math.min(page, nbPages - 1);

  if (profils.length === 0) {
    return {
      page: 0,
      vue: { content: `${entete}📭 L'annuaire Letterboxd est vide.`, components: [] },
    };
  }

  const tranche = profils.slice(pageCourante * TAILLE_PAGE, (pageCourante + 1) * TAILLE_PAGE);

  const select = new StringSelectMenuBuilder()
    .setCustomId('lbx_delete_select')
    .setPlaceholder('Profils à supprimer…')
    .setMinValues(1)
    .setMaxValues(tranche.length)
    .addOptions(
      tranche.map((p) => ({
        label: p.displayName.slice(0, 100),
        description: p.label.slice(0, 100),
        value: p.userId,
      }))
    );

  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lbx_delete_prev')
      .setLabel('◀ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageCourante === 0),
    new ButtonBuilder()
      .setCustomId('lbx_delete_next')
      .setLabel('Suivant ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageCourante >= nbPages - 1),
    new ButtonBuilder().setCustomId('lbx_delete_done').setLabel('Terminer').setStyle(ButtonStyle.Primary)
  );

  return {
    page: pageCourante,
    vue: {
      content:
        `${entete}🗑️ Sélectionne les profils Letterboxd à supprimer ` +
        `(${profils.length} au total — page ${pageCourante + 1}/${nbPages}).`,
      components: [new ActionRowBuilder().addComponents(select), boutons],
    },
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete-letterbox')
    .setDescription("Supprime des profils de l'annuaire Letterboxd")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireAdmin(interaction))) return;

    let profils = profilsTries();
    let { page, vue } = construireVue(profils, 0);
    const message = await interaction.reply({ ...vue, ephemeral: true, fetchReply: true });
    if (profils.length === 0) return;

    // Boucle du formulaire : l'admin peut supprimer plusieurs fois et
    // naviguer entre les pages jusqu'à "Terminer" ou expiration.
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

      if (choix.customId === 'lbx_delete_done') {
        return choix.update({ content: '✅ Formulaire fermé.', components: [] });
      }

      let entete = '';
      if (choix.customId === 'lbx_delete_prev') page -= 1;
      if (choix.customId === 'lbx_delete_next') page += 1;
      if (choix.customId === 'lbx_delete_select') {
        const supprimes = store.removeProfils(choix.values);
        profils = profilsTries();
        entete = `✅ Supprimé(s) : ${supprimes.map((p) => `**${escapeMarkdown(p.displayName)}**`).join(', ')}\n\n`;
      }

      ({ page, vue } = construireVue(profils, page, entete));
      await choix.update(vue);
      if (profils.length === 0) return;
    }
  }, 'DELETE-LETTERBOX'),
};
