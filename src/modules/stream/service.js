const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  GuildScheduledEventStatus,
  MessageFlags,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
} = require('discord.js');
const { requireStreamerRole } = require('../../core/permissions');
const cineStore = require('../cine-club/store');
const { attendreClic } = require('../cine-club/service');
const { formatDateFr } = require('../cine-club/dateUtils');
const store = require('./store');

const TWITCH_URL = 'https://www.twitch.tv/horror_humanum_est';
const COULEUR_STREAM = 0x9146ff; // violet Twitch
const MAX_DESCRIPTION = 1000; // les résumés IGDB peuvent être très longs
const MAX_NOMS_AFFICHES = 25;

function capitalize(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function tronquer(texte, max) {
  return texte.length > max ? `${texte.slice(0, max - 1).trimEnd()}…` : texte;
}

function ligneStats(fiche) {
  const parties = [
    fiche.dateSortie ? `📅 ${fiche.dateSortie.slice(0, 4)}` : null,
    fiche.note ? `⭐ ${fiche.note}/10` : null,
    fiche.developpeur ? `🛠️ ${fiche.developpeur}` : null,
    fiche.genres.length ? `🏷️ ${fiche.genres.slice(0, 3).join(', ')}` : null,
  ].filter(Boolean);
  return parties.length ? parties.join('   ') : null;
}

/**
 * Carte d'annonce Components V2, sur le modèle de la carte séance de /cine :
 * heure en grand, lien vers la chaîne Twitch à la place du salon vocal, puis
 * la fiche du jeu et les boutons d'action.
 */
function buildStreamContainer({
  sessionKey,
  dateSeance,
  fiche,
  presentsCount = 0,
  presentsList = [],
  mention = '',
  annonceTexte,
  guildId = null,
  eventId = null,
}) {
  const container = new ContainerBuilder().setAccentColor(COULEUR_STREAM);

  container.addTextDisplayComponents((t) => t.setContent(`${mention}**${annonceTexte}**`));
  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const jour = capitalize(new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(dateSeance));
  const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(dateSeance);
  const dateCourte = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(dateSeance);
  const presentsLabel = `${presentsCount} présent${presentsCount > 1 ? 's' : ''}`;

  container.addTextDisplayComponents((t) =>
    t.setContent(`# ${heure}\n${jour} ${dateCourte}\n📺 [Sur notre chaîne Twitch](${TWITCH_URL})   ·   👥 ${presentsLabel}`)
  );

  if (presentsList.length > 0) {
    const noms = presentsList.slice(0, MAX_NOMS_AFFICHES).join(', ');
    const reste = presentsList.length - MAX_NOMS_AFFICHES;
    const suffixe = reste > 0 ? ` _(+${reste} autre${reste > 1 ? 's' : ''})_` : '';
    container.addTextDisplayComponents((t) => t.setContent(`-# Présents : ${noms}${suffixe}`));
  }

  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (fiche.coverUrl) {
    container.addMediaGalleryComponents((galerie) =>
      galerie.addItems((item) => item.setURL(fiche.coverUrl).setDescription(fiche.titre.slice(0, 100)))
    );
  }

  container.addTextDisplayComponents((t) =>
    t.setContent(`**${fiche.titre}**\n${tronquer(fiche.overview, MAX_DESCRIPTION)}`)
  );

  const stats = ligneStats(fiche);
  if (stats) container.addTextDisplayComponents((t) => t.setContent(stats));

  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const boutons = [
    new ButtonBuilder()
      .setCustomId(`stream_presence:${sessionKey}`)
      .setLabel(`✅ Je serai présent (${presentsCount})`)
      .setStyle(ButtonStyle.Secondary),
  ];

  if (fiche.url) {
    // Sans `source` : annonce postée quand IGDB était la seule source.
    boutons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Fiche ${fiche.source || 'IGDB'}`).setURL(fiche.url));
  }

  // Event Discord créé en best-effort : pas d'event, pas de lien mort.
  if (guildId && eventId) {
    boutons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Voir l’event Discord')
        .setURL(`https://discord.com/events/${guildId}/${eventId}`),
      new ButtonBuilder()
        .setCustomId(`stream_start_event:${sessionKey}`)
        .setLabel('▶️ Démarrer l’event')
        .setStyle(ButtonStyle.Success)
    );
  }

  container.addActionRowComponents((row) => row.addComponents(...boutons));

  return container;
}

/**
 * Laisse choisir le bon jeu parmi les résultats, même s'il n'y en a qu'un :
 * la recherche étant tolérante, ce n'est pas forcément le jeu demandé. Renvoie
 * le jeu choisi, ou `null` après timeout (message d'erreur déjà posté dans
 * `message`).
 */
async function choisirJeu(interaction, message, resultats) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('stream_jeu')
    .setPlaceholder('Choisis le bon jeu')
    .addOptions(
      resultats.map((r, index) => ({
        label: `${r.titre}${r.dateSortie ? ` (${r.dateSortie.slice(0, 4)})` : ''}`.slice(0, 100),
        description: [r.source === 'IGDB' ? 'IGDB, résumé en anglais' : r.source, r.plateformes.join(', ')]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 100),
        value: String(index),
      }))
    );

  await interaction.editReply({
    content: `🔎 ${resultats.length} résultat${resultats.length > 1 ? 's' : ''} — quel jeu ?`,
    components: [new ActionRowBuilder().addComponents(select)],
  });

  try {
    const choix = await attendreClic(message, interaction.user.id, ['stream_jeu']);
    await choix.deferUpdate();
    return resultats[Number(choix.values[0])];
  } catch {
    await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }
}

/**
 * Programme le rappel H-1 dans le store de cine-club, dont le scheduler envoie
 * tous les rappels. Pas de programmerRappels() ici : ses ids reposent sur la
 * seule date, et un stream à la même heure qu'une séance entrerait en
 * collision avec son rappel.
 */
function programmerRappel({ sessionKey, channelId, roleId, titre, dateSeance }) {
  const triggerAt = dateSeance.getTime() - 60 * 60 * 1000;
  if (triggerAt <= Date.now()) return;

  cineStore.addReminders([
    {
      id: `stream-${sessionKey}`,
      triggerAt,
      sessionKey,
      channelId,
      roleId,
      message: `🎮 Rappel : stream de **${titre}** dans 1h (${formatDateFr(dateSeance)}) ! ${TWITCH_URL}`,
      sent: false,
    },
  ]);
}

/**
 * Handler du bouton "Je serai présent" (customId `stream_presence:<sessionKey>`).
 * Comme pour /cine, l'interaction est acquittée avant de toucher au store : si
 * Discord la rejette, la présence n'est pas basculée.
 */
async function handlePresenceButton(interaction) {
  await interaction.deferUpdate();

  const sessionKey = interaction.customId.split(':').slice(1).join(':');
  const annonce = store.getAnnonce(sessionKey);

  if (!annonce) {
    return interaction.followUp({ content: '❌ Cette annonce est introuvable (trop ancienne ?).', ephemeral: true });
  }

  const { isPresent, count } = cineStore.togglePresence(sessionKey, {
    id: interaction.user.id,
    nom: interaction.member?.displayName ?? interaction.user.displayName,
  });

  const container = buildStreamContainer({
    sessionKey,
    dateSeance: new Date(annonce.dateSeance),
    fiche: annonce.fiche,
    presentsCount: count,
    presentsList: cineStore.getPresenceList(sessionKey),
    mention: annonce.mention,
    annonceTexte: annonce.annonceTexte,
    guildId: annonce.guildId,
    eventId: annonce.eventId,
  });

  await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
  await interaction.followUp({
    content: isPresent ? '✅ Tu es marqué présent !' : '❌ Ta présence a été retirée.',
    ephemeral: true,
  });
}

/**
 * Handler du bouton "Démarrer l'event" (customId `stream_start_event:<sessionKey>`),
 * réservé au rôle streamer.
 */
async function handleStartEventButton(interaction) {
  if (!(await requireStreamerRole(interaction))) return;

  const sessionKey = interaction.customId.split(':').slice(1).join(':');
  const annonce = store.getAnnonce(sessionKey);

  if (!annonce || !annonce.eventId) {
    return interaction.reply({ content: '❌ Aucun évènement Discord associé à ce stream.', ephemeral: true });
  }

  try {
    const evenement = await interaction.guild.scheduledEvents.fetch(annonce.eventId);
    await evenement.setStatus(GuildScheduledEventStatus.Active);
    await interaction.reply({ content: '▶️ Évènement démarré !', ephemeral: true });
  } catch (err) {
    console.error("[STREAM] Impossible de démarrer l'évènement :", err);
    await interaction.reply({
      content: "❌ Impossible de démarrer l'évènement (déjà démarré/terminé, ou permissions manquantes).",
      ephemeral: true,
    });
  }
}

module.exports = {
  TWITCH_URL,
  buildStreamContainer,
  choisirJeu,
  programmerRappel,
  handlePresenceButton,
  handleStartEventButton,
};
