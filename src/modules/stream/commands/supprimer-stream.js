const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const withErrorHandling = require('../../../core/withErrorHandling');
const { requireStreamerRole } = require('../../../core/permissions');
const cineStore = require('../../cine-club/store');
const { attendreClic } = require('../../cine-club/service');
const { formatDateFr } = require('../../cine-club/dateUtils');
const { rafraichirProgramme } = require('../../cine-club/programme/service');
const store = require('../store');

/**
 * Supprime tout ce qu'un stream a laissé derrière lui : message d'annonce,
 * event Discord, rappel, présences, annonce, place au programme. Renvoie le
 * compte rendu affiché au streamer.
 */
async function supprimerStream(interaction, sessionKey, annonce) {
  const { client, guild } = interaction;
  const lignes = [];

  try {
    const channel = await client.channels.fetch(annonce.channelId);
    await channel.messages.delete(annonce.messageId);
    lignes.push("🗑️ Message d'annonce supprimé");
  } catch (err) {
    console.error("[STREAM] Impossible de supprimer le message d'annonce :", err.message);
    lignes.push("⚠️ Message d'annonce introuvable (à supprimer à la main)");
  }

  if (annonce.eventId) {
    try {
      await guild.scheduledEvents.delete(annonce.eventId);
      lignes.push('🗑️ Évènement Discord supprimé');
    } catch (err) {
      console.error("[STREAM] Impossible de supprimer l'évènement Discord :", err.message);
      lignes.push('⚠️ Évènement Discord introuvable ou déjà supprimé');
    }
  }

  const rappels = cineStore.supprimerRappelsSeance(sessionKey, annonce.dateSeance);
  lignes.push(`🔕 ${rappels} rappel${rappels > 1 ? 's' : ''} annulé${rappels > 1 ? 's' : ''}`);

  cineStore.supprimerPresences(sessionKey);
  store.supprimerAnnonce(sessionKey);

  // Le tick du programme le ferait dans la minute ; on n'attend pas.
  if (await rafraichirProgramme(client)) lignes.push('🖼️ Programme en image mis à jour');

  return lignes;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('supprimer-stream')
    .setDescription('Supprime un stream à venir (annonce, event, rappel)'),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireStreamerRole(interaction))) return;

    await interaction.deferReply({ ephemeral: true });

    const streams = store.listAnnoncesAVenir().slice(0, 25);
    if (streams.length === 0) {
      return interaction.editReply('📭 Aucun stream à venir.');
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId('suppr_stream_choix')
      .setPlaceholder('Choisis le stream à supprimer')
      .addOptions(
        streams.map((s) => ({
          label: s.fiche.titre.slice(0, 100),
          description: formatDateFr(new Date(s.dateSeance)).slice(0, 100),
          value: s.sessionKey,
        }))
      );

    const message = await interaction.editReply({
      content: 'Quel stream supprimer ? (suppression immédiate)',
      components: [new ActionRowBuilder().addComponents(select)],
    });

    let choix;
    try {
      choix = await attendreClic(message, interaction.user.id, ['suppr_stream_choix']);
      await choix.deferUpdate();
    } catch {
      return interaction.editReply({ content: '⌛ Temps écoulé, suppression annulée.', components: [] });
    }

    const sessionKey = choix.values[0];
    const annonce = store.getAnnonce(sessionKey);
    if (!annonce) {
      return interaction.editReply({ content: '❌ Ce stream a déjà été supprimé.', components: [] });
    }

    await interaction.editReply({ content: 'Suppression en cours...', components: [] });
    const lignes = await supprimerStream(interaction, sessionKey, annonce);

    await interaction.editReply({
      content: `✅ Stream **${annonce.fiche.titre}** supprimé.\n${lignes.join('\n')}`,
      components: [],
    });
  }, 'STREAM-SUPPRIMER'),
};
