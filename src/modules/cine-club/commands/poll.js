const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const config = require('../../../config');
const { requireStreamerRole, requireChannel } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const store = require('../store');
const { creneauxFilmSemaineSuivante, formatDateFr } = require('../dateUtils');

const NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const CRENEAU_EMOJIS = ['🇦', '🇧', '🇨'];
const MAX_CANDIDATS = 10; // limite pratique du sondage à réactions (10 emojis numérotés)
const PAGE_SIZE = 25; // limite Discord d'un select menu

function cle(entree) {
  return `${entree.mediaType}:${entree.tmdbId}`;
}

async function attendreClic(message, userId, customIds, timeout = 120_000) {
  return message.awaitMessageComponent({
    filter: (i) => i.user.id === userId && customIds.includes(i.customId),
    time: timeout,
  });
}

function construireRowPagination(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('poll_page_prev')
      .setLabel('◀️ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('poll_page_next')
      .setLabel('Suivant ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder().setCustomId('poll_valider').setLabel('✅ Valider la sélection').setStyle(ButtonStyle.Success)
  );
}

/**
 * Sélecteur paginé, multi ou single-select, réutilisé pour les modes
 * "Manuel" et "Direct". Renvoie le tableau des entrées choisies.
 */
async function selectionnerDansWatchlist(interaction, message, entrees, { multi }) {
  if (entrees.length === 0) {
    await message.edit({ content: '❌ La watchlist est vide pour ce type de contenu.', components: [] });
    return [];
  }

  const totalPages = Math.ceil(entrees.length / PAGE_SIZE);
  let page = 0;
  const selection = new Map(); // cle -> entree

  while (true) {
    const pageEntries = entrees.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const select = new StringSelectMenuBuilder()
      .setCustomId('poll_select')
      .setPlaceholder(multi ? 'Choisis un ou plusieurs titres' : 'Choisis un titre')
      .setMinValues(1)
      .setMaxValues(multi ? pageEntries.length : 1)
      .addOptions(
        pageEntries.map((e) => ({
          label: e.titre.slice(0, 100),
          value: cle(e),
          default: selection.has(cle(e)),
        }))
      );

    const rows = [new ActionRowBuilder().addComponents(select)];
    if (multi) rows.push(construireRowPagination(page, totalPages));
    else if (totalPages > 1) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('poll_page_prev').setLabel('◀️ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId('poll_page_next').setLabel('Suivant ▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
        )
      );
    }

    await message.edit({
      content:
        `Page ${page + 1}/${totalPages}` +
        (multi ? ` — ${selection.size} titre(s) sélectionné(s) au total.` : ''),
      components: rows,
    });

    const customIds = multi
      ? ['poll_select', 'poll_page_prev', 'poll_page_next', 'poll_valider']
      : ['poll_select', 'poll_page_prev', 'poll_page_next'];

    let interactionComposant;
    try {
      interactionComposant = await attendreClic(message, interaction.user.id, customIds);
    } catch {
      await message.edit({ content: '⌛ Temps écoulé, /poll annulé.', components: [] });
      return [];
    }

    await interactionComposant.deferUpdate();

    if (interactionComposant.customId === 'poll_page_prev') {
      page = Math.max(0, page - 1);
      continue;
    }
    if (interactionComposant.customId === 'poll_page_next') {
      page = Math.min(totalPages - 1, page + 1);
      continue;
    }
    if (interactionComposant.customId === 'poll_select') {
      const valeurs = interactionComposant.values;
      if (!multi) {
        const choisi = entrees.find((e) => cle(e) === valeurs[0]);
        return choisi ? [choisi] : [];
      }
      // multi : on fusionne avec la sélection déjà faite sur d'autres pages
      for (const e of pageEntries) {
        if (valeurs.includes(cle(e))) selection.set(cle(e), e);
        else selection.delete(cle(e));
      }
      continue;
    }
    if (interactionComposant.customId === 'poll_valider') {
      return [...selection.values()].slice(0, MAX_CANDIDATS);
    }
  }
}

async function posterSondageReactions(channel, titreEmbed, entrees) {
  const emojis = NUM_EMOJIS.slice(0, entrees.length);
  const lignes = entrees.map((e, i) => `${emojis[i]} **${e.titre}**`).join('\n');
  const message = await channel.send(`🗳️ **${titreEmbed}**\n\n${lignes}`);
  for (const emoji of emojis) {
    await message.react(emoji);
  }
  return message;
}

async function posterSondageHoraire(channel, creneaux) {
  const emojis = CRENEAU_EMOJIS.slice(0, creneaux.length);
  const lignes = creneaux.map((c, i) => `${emojis[i]} **${c.label}** (${formatDateFr(c.date)})`).join('\n');
  const message = await channel.send(`🕒 **Sondage d'horaire**\n\n${lignes}`);
  for (const emoji of emojis) {
    await message.react(emoji);
  }
  return message;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Lance un sondage de sélection pour la prochaine séance ciné-club'),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireStreamerRole(interaction))) return;
    if (!(await requireChannel(interaction, config.cineClub.channelId, { label: 'le salon ciné-club' }))) return;

    await interaction.deferReply({ ephemeral: true });
    const message = await interaction.editReply({
      content: 'Quel type de contenu ?',
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('poll_type_movie').setLabel('🎬 Film').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('poll_type_tv').setLabel('📺 Série').setStyle(ButtonStyle.Primary)
        ),
      ],
    });

    // --- Étape 1 : type de contenu ---
    let clic;
    try {
      clic = await attendreClic(message, interaction.user.id, ['poll_type_movie', 'poll_type_tv']);
    } catch {
      return interaction.editReply({ content: '⌛ Temps écoulé, /poll annulé.', components: [] });
    }
    await clic.deferUpdate();
    const type = clic.customId === 'poll_type_movie' ? 'movie' : 'tv';

    // --- Étape 2 : mode de sélection ---
    await message.edit({
      content: 'Quel mode de sélection ?',
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('poll_mode_random').setLabel('🎲 Aléatoire').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('poll_mode_manual').setLabel('🖱️ Manuel').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('poll_mode_direct').setLabel('🎯 Direct').setStyle(ButtonStyle.Primary)
        ),
      ],
    });

    let clicMode;
    try {
      clicMode = await attendreClic(message, interaction.user.id, [
        'poll_mode_random',
        'poll_mode_manual',
        'poll_mode_direct',
      ]);
    } catch {
      return interaction.editReply({ content: '⌛ Temps écoulé, /poll annulé.', components: [] });
    }
    await clicMode.deferUpdate();
    const mode = clicMode.customId.replace('poll_mode_', '');

    const watchlist = store.listWatchlist({ mediaType: type });
    let candidats = [];

    if (mode === 'random') {
      if (watchlist.length < 2) {
        return message.edit({ content: '❌ Pas assez de titres dans la watchlist pour ce type (minimum 2).', components: [] });
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
      if (candidats.length === 0) return; // message d'erreur déjà envoyé par le sélecteur
    }

    // --- Publication dans le salon ciné-club ---
    const libelleType = type === 'tv' ? 'série' : 'film';

    if (mode === 'direct') {
      await interaction.channel.send(
        `🎯 **Sélection directe** — la prochaine séance ${libelleType} sera : **${candidats[0].titre}** !`
      );
    } else {
      await posterSondageReactions(
        interaction.channel,
        `Sondage ${libelleType} — vote pour la prochaine séance !`,
        candidats
      );
    }

    let creneaux = null;
    if (type === 'movie') {
      creneaux = creneauxFilmSemaineSuivante();
      await posterSondageHoraire(interaction.channel, creneaux);
    }

    store.setDernierPoll({
      type,
      mode,
      titresCandidats: candidats.map((c) => ({
        tmdbId: c.tmdbId,
        mediaType: c.mediaType,
        titre: c.titre,
        posterUrl: c.posterUrl,
        voteAverage: c.voteAverage,
        duree: c.duree,
      })),
      creneaux: creneaux ? creneaux.map((c) => ({ label: c.label, date: c.date.toISOString() })) : null,
      dateCreation: new Date().toISOString(),
    });

    await message.edit({
      content: `✅ Sondage publié dans <#${interaction.channel.id}> ! Utilise \`/host\` une fois le dépouillement fait.`,
      components: [],
    });
  }, 'CINE-CLUB-POLL'),
};
