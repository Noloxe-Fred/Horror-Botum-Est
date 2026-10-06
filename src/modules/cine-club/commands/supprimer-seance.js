const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const withErrorHandling = require('../../../core/withErrorHandling');
const { requireStreamerRole } = require('../../../core/permissions');
const store = require('../store');
const { attendreClic, libelleEpisodesCourt } = require('../service');
const { publierProgramme } = require('../programme/service');

function libelleDate(dateSeance) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateSeance));
}

function libelleType(annonce) {
  if (annonce.mediaType !== 'tv') return 'Film';
  return annonce.episodes ? `Série · ${libelleEpisodesCourt(annonce.episodes)}` : 'Série';
}

/**
 * Supprime le message d'annonce. Les annonces postées avant l'enregistrement
 * de `messageId` sont retrouvées parmi les 100 derniers messages du salon,
 * via le customId de leur bouton "Je serai présent".
 */
async function supprimerMessageAnnonce(client, sessionKey, annonce) {
  try {
    const channel = await client.channels.fetch(annonce.channelId);
    if (annonce.messageId) {
      await channel.messages.delete(annonce.messageId);
      return true;
    }
    const messages = await channel.messages.fetch({ limit: 100 });
    const cible = messages.find(
      (m) => m.author.id === client.user.id && JSON.stringify(m.components).includes(`cine_presence:${sessionKey}`)
    );
    if (!cible) return false;
    await cible.delete();
    return true;
  } catch (err) {
    console.error("[SEANCES-CINE] Impossible de supprimer le message d'annonce :", err.message);
    return false;
  }
}

async function supprimerEvent(guild, eventId) {
  if (!eventId) return false;
  try {
    await guild.scheduledEvents.delete(eventId);
    return true;
  } catch (err) {
    console.error("[SEANCES-CINE] Impossible de supprimer l'évènement Discord :", err.message);
    return false;
  }
}

/**
 * Supprime tout ce qu'une séance a laissé derrière elle, quelle que soit la
 * branche de /cine qui l'a créée : message d'annonce, event Discord natif,
 * rappels, présences, entrée d'historique, annonce — puis met à jour le
 * programme en image. Renvoie le compte rendu affiché au streamer.
 */
async function supprimerSeance(interaction, sessionKey, annonce) {
  const { client, guild } = interaction;
  const lignes = [];

  const messageSupprime = await supprimerMessageAnnonce(client, sessionKey, annonce);
  lignes.push(messageSupprime ? "🗑️ Message d'annonce supprimé" : "⚠️ Message d'annonce introuvable (à supprimer à la main)");

  if (annonce.eventId) {
    const eventSupprime = await supprimerEvent(guild, annonce.eventId);
    lignes.push(eventSupprime ? '🗑️ Évènement Discord supprimé' : '⚠️ Évènement Discord introuvable ou déjà supprimé');
  }

  const rappels = store.supprimerRappelsSeance(sessionKey, annonce.dateSeance);
  lignes.push(`🔕 ${rappels} rappel${rappels > 1 ? 's' : ''} annulé${rappels > 1 ? 's' : ''}`);

  store.supprimerPresences(sessionKey);

  // Le titre retourne en watchlist s'il en sortait lors de la programmation
  // (entrée d'origine conservée dans l'historique depuis cette version).
  const historique = store.supprimerDeHistorique({
    tmdbId: annonce.tmdbId,
    mediaType: annonce.mediaType,
    dateVu: annonce.dateSeance,
  });
  if (historique && historique.entreeWatchlist) {
    if (!store.findInWatchlist(annonce.tmdbId, annonce.mediaType)) store.addToWatchlist(historique.entreeWatchlist);
    lignes.push('📋 Titre remis dans la watchlist');
  } else if (historique && !('entreeWatchlist' in historique)) {
    // Séance programmée avant cette version : impossible de savoir si le
    // titre venait de la watchlist.
    lignes.push('ℹ️ Séance trop ancienne pour savoir si le titre venait de la watchlist : si oui, remets-le avec /add');
  }

  store.supprimerAnnonce(sessionKey);

  // Le tick du programme le ferait dans la minute ; on n'attend pas.
  const programme = store.getProgramme();
  if (programme.messageIds && programme.messageIds.length) {
    try {
      await publierProgramme(client);
      lignes.push('🖼️ Programme en image mis à jour');
    } catch (err) {
      console.error('[SEANCES-CINE][PROGRAMME] Mise à jour du programme impossible :', err);
      lignes.push('⚠️ Programme en image non mis à jour (réessaie avec /programme-cine)');
    }
  }

  return lignes;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('supprimer-seance')
    .setDescription('Supprime une séance à venir (annonce, event, rappels, programme)'),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireStreamerRole(interaction))) return;

    await interaction.deferReply({ ephemeral: true });

    const seances = store.listAnnoncesAVenir().slice(0, 25);
    if (seances.length === 0) {
      return interaction.editReply('📭 Aucune séance à venir.');
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId('suppr_seance_choix')
      .setPlaceholder('Choisis la séance à supprimer')
      .addOptions(
        seances.map((s) => ({
          label: s.fiche.titre.slice(0, 100),
          description: `${libelleType(s)} — ${libelleDate(s.dateSeance)}`.slice(0, 100),
          value: s.sessionKey,
        }))
      );

    const message = await interaction.editReply({
      content: 'Quelle séance supprimer ?',
      components: [new ActionRowBuilder().addComponents(select)],
    });

    let annonce;
    let sessionKey;
    try {
      const choix = await attendreClic(message, interaction.user.id, ['suppr_seance_choix']);
      await choix.deferUpdate();
      sessionKey = choix.values[0];
      annonce = store.getAnnonce(sessionKey);
    } catch {
      return interaction.editReply({ content: '⌛ Temps écoulé, suppression annulée.', components: [] });
    }
    if (!annonce) {
      return interaction.editReply({ content: '❌ Cette séance a déjà été supprimée.', components: [] });
    }

    await interaction.editReply({
      content:
        `Supprimer **${annonce.fiche.titre}** (${libelleType(annonce)}) du ${libelleDate(annonce.dateSeance)} ?\n` +
        "L'annonce, l'évènement Discord, les rappels et la place au programme seront supprimés.",
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('suppr_seance_ok').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('suppr_seance_annuler').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
        ),
      ],
    });

    let confirmation;
    try {
      confirmation = await attendreClic(message, interaction.user.id, ['suppr_seance_ok', 'suppr_seance_annuler']);
      await confirmation.deferUpdate();
    } catch {
      return interaction.editReply({ content: '⌛ Temps écoulé, suppression annulée.', components: [] });
    }
    if (confirmation.customId === 'suppr_seance_annuler') {
      return interaction.editReply({ content: 'Suppression annulée.', components: [] });
    }

    await interaction.editReply({ content: 'Suppression en cours...', components: [] });
    const lignes = await supprimerSeance(interaction, sessionKey, annonce);

    await interaction.editReply({
      content: `✅ Séance **${annonce.fiche.titre}** supprimée.\n${lignes.join('\n')}`,
      components: [],
    });
  }, 'SEANCES-CINE-SUPPRIMER-SEANCE'),
};
