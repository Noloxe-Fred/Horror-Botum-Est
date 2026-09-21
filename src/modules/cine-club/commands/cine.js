const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config');
const { requireStreamerRole, requireChannel } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const { attendreClic } = require('../service');
const { runSeriesWizard } = require('../wizards/series');
const { runArracheWizard } = require('../wizards/arrache');
const { run48hWizard } = require('../wizards/quarante-huit-heures');
const { runSemaineSuivanteWizard } = require('../wizards/semaine-suivante');

const CHOIX = [
  { customId: 'cine_menu_series', label: '📺 Séances Séries', style: ButtonStyle.Primary },
  { customId: 'cine_menu_arrache', label: "🔥 Séance à l'arrache", style: ButtonStyle.Danger },
  { customId: 'cine_menu_48h', label: '🕑 Séance 48h', style: ButtonStyle.Secondary },
  { customId: 'cine_menu_semaine', label: '🎬 Séances Ciné semaine suivante', style: ButtonStyle.Primary },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cine')
    .setDescription('Point d\'entrée unique pour organiser une séance ciné-club'),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireStreamerRole(interaction))) return;
    if (!(await requireChannel(interaction, config.cineClub.channelId, { label: 'le salon ciné-club' }))) return;

    await interaction.deferReply({ ephemeral: true });
    const message = await interaction.editReply({
      content: 'Quel type de séance ?',
      components: [
        new ActionRowBuilder().addComponents(
          CHOIX.map((c) => new ButtonBuilder().setCustomId(c.customId).setLabel(c.label).setStyle(c.style))
        ),
      ],
    });

    let clic;
    try {
      clic = await attendreClic(
        message,
        interaction.user.id,
        CHOIX.map((c) => c.customId)
      );
    } catch {
      return interaction.editReply({ content: '⌛ Temps écoulé, /cine annulé.', components: [] });
    }

    // Les branches "Séances Séries" et "à l'arrache" ouvrent une modale dès
    // leur première étape : le clic ne doit surtout pas être deferUpdate()
    // avant (une modale doit être la toute première réponse à son
    // interaction).
    if (clic.customId === 'cine_menu_series') return runSeriesWizard(interaction, clic, message);
    if (clic.customId === 'cine_menu_arrache') return runArracheWizard(interaction, clic, message);

    await clic.deferUpdate();

    if (clic.customId === 'cine_menu_48h') return run48hWizard(interaction, message);
    if (clic.customId === 'cine_menu_semaine') return runSemaineSuivanteWizard(interaction, message);
  }, 'CINE-CLUB-CINE'),
};
