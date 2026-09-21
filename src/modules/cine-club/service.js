const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  GuildScheduledEventStatus,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../../config');
const { requireAnyRole, requireStreamerRole } = require('../../core/permissions');
const store = require('./store');
const tmdb = require('./tmdb');
const { formatDateFr, parseHeure } = require('./dateUtils');

const COULEUR_FILM = 0xb8002e; // rouge horreur, cohérent avec le thème du serveur
const COULEUR_SERIE = 0x1f8a70;

function capitalize(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/**
 * Ligne "crédits" (réalisation + casting), commune à la fiche et à la carte
 * séance. Retourne `null` si aucune des deux infos n'est disponible (par
 * exemple TMDB sans données de credits pour un titre obscur).
 */
function ligneCredits(fiche) {
  const lignes = [];
  if (fiche.realisateur) lignes.push(`**Réalisation** — ${fiche.realisateur}`);
  if (fiche.casting && fiche.casting.length) lignes.push(`**Casting** — ${fiche.casting.join(', ')}`);
  return lignes.length ? lignes.join('\n') : null;
}

/**
 * Ligne "stats" (note / durée / pays), commune à la fiche et à la carte
 * séance. La durée n'est affichée que pour un film (décision explicite —
 * TMDB ne donne qu'une durée moyenne d'épisode pour une série, jugée peu
 * pertinente ici).
 */
function ligneStats(fiche) {
  const parties = [
    fiche.voteAverage ? `⭐ ${fiche.voteAverage}/10` : null,
    fiche.mediaType !== 'tv' && fiche.duree ? `⏱️ ${fiche.duree} min` : null,
    fiche.pays ? `🌍 ${fiche.pays}` : null,
  ].filter(Boolean);
  return parties.length ? parties.join('   ') : null;
}

/**
 * Carte "fiche" Components V2 — utilisée par /search et /add pour afficher
 * un film/série unique. Remplace l'ancien embedFiche().
 */
function buildFicheContainer(fiche) {
  const couleur = fiche.mediaType === 'tv' ? COULEUR_SERIE : COULEUR_FILM;
  const container = new ContainerBuilder().setAccentColor(couleur);

  if (fiche.posterUrl) {
    container.addMediaGalleryComponents((galerie) =>
      galerie.addItems((item) => item.setURL(fiche.posterUrl).setDescription(fiche.titre.slice(0, 100)))
    );
  }

  const typeLabel = fiche.mediaType === 'tv' ? 'Série' : 'Film';
  container.addTextDisplayComponents((t) => t.setContent(`**${fiche.titre}**  ·  ${typeLabel}\n${fiche.overview}`));

  const credits = ligneCredits(fiche);
  if (credits) container.addTextDisplayComponents((t) => t.setContent(credits));

  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  container.addTextDisplayComponents((t) => t.setContent(ligneStats(fiche) || 'Infos non disponibles.'));

  container.addActionRowComponents((row) =>
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Voir la fiche TMDB').setURL(tmdb.urlFiche(fiche))
    )
  );

  return container;
}

/**
 * Carte "séance" Components V2 — utilisée par /host et /arrache. Affiche
 * jour/heure en grand (façon site de cinéma), le salon vocal, le compteur
 * de présents, puis la fiche du film/série, et enfin les boutons d'action
 * ("Je serai présent", lien TMDB, lien + démarrage de l'event Discord natif
 * si disponible).
 */
function buildSeanceContainer({
  sessionKey,
  mediaType,
  dateSeance,
  salonVocalId,
  fiche,
  presentsCount = 0,
  presentsList = [],
  mention = '',
  annonceTexte,
  guildId = null,
  eventId = null,
}) {
  const couleur = mediaType === 'tv' ? COULEUR_SERIE : COULEUR_FILM;
  const container = new ContainerBuilder().setAccentColor(couleur);

  container.addTextDisplayComponents((t) => t.setContent(`${mention}**${annonceTexte}**`));
  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const jour = capitalize(new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(dateSeance));
  const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(dateSeance);
  const dateCourte = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(dateSeance);
  const presentsLabel = `${presentsCount} présent${presentsCount > 1 ? 's' : ''}`;

  container.addTextDisplayComponents((t) =>
    t.setContent(`# ${heure}\n${jour} ${dateCourte}\n🔊 <#${salonVocalId}>   ·   👥 ${presentsLabel}`)
  );

  // Liste nominative des présents, reconstruite à chaque clic sur "Je serai
  // présent" — plafonnée pour ne jamais risquer de dépasser la limite de
  // caractères d'un composant Discord si la séance attire du monde.
  if (presentsList.length > 0) {
    const MAX_NOMS_AFFICHES = 25;
    const noms = presentsList.slice(0, MAX_NOMS_AFFICHES).join(', ');
    const reste = presentsList.length - MAX_NOMS_AFFICHES;
    const suffixe = reste > 0 ? ` _(+${reste} autre${reste > 1 ? 's' : ''})_` : '';
    container.addTextDisplayComponents((t) => t.setContent(`-# Présents : ${noms}${suffixe}`));
  }

  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (fiche.posterUrl) {
    container.addMediaGalleryComponents((galerie) =>
      galerie.addItems((item) => item.setURL(fiche.posterUrl).setDescription(fiche.titre.slice(0, 100)))
    );
  }

  container.addTextDisplayComponents((t) => t.setContent(`**${fiche.titre}**\n${fiche.overview}`));

  const credits = ligneCredits(fiche);
  if (credits) container.addTextDisplayComponents((t) => t.setContent(credits));

  const stats = ligneStats(fiche);
  if (stats) container.addTextDisplayComponents((t) => t.setContent(stats));

  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const boutons = [
    new ButtonBuilder()
      .setCustomId(`cine_presence:${sessionKey}`)
      .setLabel(`✅ Je serai présent (${presentsCount})`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Fiche TMDB').setURL(tmdb.urlFiche(fiche)),
  ];

  // Boutons liés à l'event Discord natif — seulement si la création a
  // réussi (best-effort, voir host.js/arrache.js). Pas d'event => pas de
  // lien ni de bouton "Démarrer", pour ne jamais afficher un lien mort.
  if (guildId && eventId) {
    boutons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Voir l\u2019event Discord')
        .setURL(`https://discord.com/events/${guildId}/${eventId}`)
    );
    boutons.push(
      new ButtonBuilder()
        .setCustomId(`cine_start_event:${sessionKey}`)
        .setLabel('▶️ Démarrer l\u2019event')
        .setStyle(ButtonStyle.Success)
    );
  }

  container.addActionRowComponents((row) => row.addComponents(...boutons));

  return container;
}

/**
 * Quand une recherche TMDB renvoie plusieurs résultats plausibles, affiche
 * un select menu pour laisser l'utilisateur choisir le bon titre, plutôt
 * que de deviner (auparavant : premier résultat pris automatiquement).
 *
 * Réutilisé par /search et /add. Renvoie le résultat choisi (normalisé,
 * tel que renvoyé par tmdb.searchMulti), ou `null` si un seul résultat
 * existait déjà (rien à choisir) ou en cas d'annulation/timeout — dans ce
 * dernier cas, la fonction a déjà édité `message` avec un message
 * d'erreur, l'appelant doit juste s'arrêter.
 */
async function choisirResultatTmdb(interaction, message, resultats) {
  if (resultats.length === 1) return resultats[0];

  const options = resultats.map((r, index) => {
    const annee = r.dateSortie ? ` (${r.dateSortie.slice(0, 4)})` : '';
    const type = r.mediaType === 'tv' ? 'Série' : 'Film';
    return {
      label: `${r.titre}${annee}`.slice(0, 100),
      description: type,
      value: String(index),
    };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('tmdb_choix')
    .setPlaceholder('Plusieurs résultats trouvés, choisis le bon titre')
    .addOptions(options);

  await message.edit({
    content: `🔎 ${resultats.length} résultats trouvés pour cette recherche — lequel ?`,
    embeds: [],
    components: [new ActionRowBuilder().addComponents(select)],
  });

  try {
    const choix = await message.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && i.customId === 'tmdb_choix',
      time: 60_000,
    });
    await choix.deferUpdate();
    return resultats[Number(choix.values[0])];
  } catch {
    await message.edit({ content: '⌛ Temps écoulé, aucun titre choisi.', embeds: [], components: [] });
    return null;
  }
}

/**
 * Demande le salon vocal de diffusion parmi les salons vocaux du serveur
 * (liste dynamique, pas de config .env figée). Auto-sélectionne s'il n'y en
 * a qu'un seul. Réutilisé par /host et /arrache.
 *
 * Renvoie l'ID du salon choisi, ou `null` si aucun salon vocal n'existe ou
 * en cas d'annulation/timeout (message d'erreur déjà posté dans `message`).
 */
async function demanderSalonVocal(interaction, message) {
  const salons = interaction.guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildVoice)
    .map((c) => ({ label: c.name.slice(0, 100), value: c.id }))
    .slice(0, 25);

  if (salons.length === 0) {
    await message.edit({ content: '❌ Aucun salon vocal trouvé sur ce serveur.', components: [] });
    return null;
  }

  if (salons.length === 1) return salons[0].value;

  const select = new StringSelectMenuBuilder()
    .setCustomId('salon_vocal')
    .setPlaceholder('Choisis le salon vocal de diffusion')
    .addOptions(salons);

  await message.edit({
    content: 'Quel salon vocal pour la diffusion ?',
    components: [new ActionRowBuilder().addComponents(select)],
  });

  try {
    const choix = await message.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && i.customId === 'salon_vocal',
      time: 60_000,
    });
    await choix.deferUpdate();
    return choix.values[0];
  } catch {
    await message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }
}

/**
 * Demande au streamer l'heure de diffusion via un bouton qui ouvre une
 * modale (un select menu ne permet pas la saisie libre nécessaire ici).
 * Réutilisé par /poll (créneaux film) et /host (séance série).
 *
 * Renvoie { heure, minute }, ou `null` en cas d'annulation/timeout/format
 * invalide (message d'erreur déjà posté dans `message`, l'appelant doit
 * juste s'arrêter).
 */
async function demanderHeure(interaction, message, { defaut = '21h00', label = "l'heure de diffusion" } = {}) {
  const boutonId = 'heure_ouvrir_modal';

  await message.edit({
    content: `Choisis ${label} (${defaut} si tu ne changes rien).`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(boutonId).setLabel('🕒 Définir l\'heure').setStyle(ButtonStyle.Primary)
      ),
    ],
  });

  let clicOuverture;
  try {
    clicOuverture = await message.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && i.customId === boutonId,
      time: 120_000,
    });
  } catch {
    await message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }

  const modal = new ModalBuilder().setCustomId('heure_modal').setTitle('Heure de diffusion');
  const input = new TextInputBuilder()
    .setCustomId('heure_valeur')
    .setLabel('Heure (ex: 21h, 21h30, 20:00)')
    .setStyle(TextInputStyle.Short)
    .setValue(defaut)
    .setRequired(true)
    .setMaxLength(5);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await clicOuverture.showModal(modal);

  let soumission;
  try {
    soumission = await clicOuverture.awaitModalSubmit({
      filter: (i) => i.user.id === interaction.user.id && i.customId === 'heure_modal',
      time: 120_000,
    });
  } catch {
    await message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }

  const brut = soumission.fields.getTextInputValue('heure_valeur');
  const heureParsee = parseHeure(brut);
  await soumission.deferUpdate();

  if (!heureParsee) {
    await message.edit({
      content: `❌ Heure invalide ("${brut}"), commande annulée. Utilise un format du type "21h" ou "21h30".`,
      components: [],
    });
    return null;
  }

  return heureParsee;
}

/**
 * Demande au streamer un message personnalisé pour l'annonce finale (champ
 * `annonceTexte` de buildSeanceContainer), via bouton + modale pré-remplie
 * avec un texte par défaut — soumettre sans rien changer garde ce défaut.
 * Dernière étape commune aux 4 branches de /cine avant publication.
 *
 * Renvoie le texte choisi, ou `null` en cas d'annulation/timeout (message
 * d'erreur déjà posté dans `message`, l'appelant doit juste s'arrêter).
 */
async function demanderMessagePersonnalise(interaction, message, { defaut }) {
  const boutonId = 'message_ouvrir_modal';

  await message.edit({
    content: "Un message personnalisé pour l'annonce ? (laisse tel quel pour garder le message par défaut)",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(boutonId).setLabel('✍️ Message de l\'annonce').setStyle(ButtonStyle.Primary)
      ),
    ],
  });

  let clicOuverture;
  try {
    clicOuverture = await message.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && i.customId === boutonId,
      time: 120_000,
    });
  } catch {
    await message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }

  const modal = new ModalBuilder().setCustomId('message_modal').setTitle("Message de l'annonce");
  const input = new TextInputBuilder()
    .setCustomId('message_valeur')
    .setLabel('Affiché en haut de la carte séance')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(defaut)
    .setRequired(true)
    .setMaxLength(300);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await clicOuverture.showModal(modal);

  let soumission;
  try {
    soumission = await clicOuverture.awaitModalSubmit({
      filter: (i) => i.user.id === interaction.user.id && i.customId === 'message_modal',
      time: 120_000,
    });
  } catch {
    await message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }

  const texte = soumission.fields.getTextInputValue('message_valeur').trim();
  await soumission.deferUpdate();

  return texte || defaut;
}

const NUM_EMOJIS =['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const CRENEAU_EMOJIS = ['🇦', '🇧', '🇨'];
const MAX_CANDIDATS = 10; // limite pratique du sondage à réactions (10 emojis numérotés)
const PAGE_SIZE = 25; // limite Discord d'un select menu

function cleEntree(entree) {
  return `${entree.mediaType}:${entree.tmdbId}`;
}

/**
 * Attend le clic d'un bouton/select parmi `customIds`, filtré sur l'auteur
 * de la commande. Utilisé partout dans les wizards `/cine` pour enchaîner
 * les étapes d'un même message éphémère.
 */
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
 * Sélecteur paginé, multi ou single-select, dans la watchlist. Utilisé par
 * les branches "Séances Séries", "Séances Ciné semaine suivante" (modes
 * Manuel/Direct) et "Séance 48h" (choix watchlist). Renvoie le tableau des
 * entrées choisies.
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
          value: cleEntree(e),
          default: selection.has(cleEntree(e)),
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
      await message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
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
        const choisi = entrees.find((e) => cleEntree(e) === valeurs[0]);
        return choisi ? [choisi] : [];
      }
      // multi : on fusionne avec la sélection déjà faite sur d'autres pages
      for (const e of pageEntries) {
        if (valeurs.includes(cleEntree(e))) selection.set(cleEntree(e), e);
        else selection.delete(cleEntree(e));
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

/**
 * Demande un titre libre via modale (recherche TMDB) — utilisé par les
 * branches "Séance à l'arrache" et "Séance 48h". `clicBouton` est
 * l'interaction du bouton qui déclenche l'ouverture de la modale (une
 * modale doit être la toute première réponse à son interaction).
 *
 * Renvoie la chaîne saisie, ou `null` en cas d'annulation/timeout (message
 * d'erreur déjà posté dans `message`, l'appelant doit juste s'arrêter).
 */
async function demanderTitreTmdb(clicBouton, message, { label = 'Titre à rechercher' } = {}) {
  const modal = new ModalBuilder().setCustomId('titre_modal').setTitle('Recherche TMDB');
  const input = new TextInputBuilder()
    .setCustomId('titre_valeur')
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await clicBouton.showModal(modal);

  let soumission;
  try {
    soumission = await clicBouton.awaitModalSubmit({
      filter: (i) => i.user.id === clicBouton.user.id && i.customId === 'titre_modal',
      time: 120_000,
    });
  } catch {
    await message.edit({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }

  const titre = soumission.fields.getTextInputValue('titre_valeur').trim();
  await soumission.deferUpdate();

  if (!titre) {
    await message.edit({ content: '❌ Titre vide, commande annulée.', components: [] });
    return null;
  }

  return titre;
}

/**
 * Vérifie si un titre est déjà dans la watchlist active.
 * Retourne l'entrée existante (ou null).
 */
function doublonWatchlist(fiche) {
  return store.findInWatchlist(fiche.tmdbId, fiche.mediaType);
}

/**
 * Vérifie si un titre a déjà été vu (historique). Retourne l'entrée
 * existante (ou null) — ne bloque jamais, sert juste à demander confirmation.
 */
function doublonHistorique(fiche) {
  return store.findInHistorique(fiche.tmdbId, fiche.mediaType);
}

/**
 * Libellés -> IDs de rôle configurés pour le type de séance film.
 */
const TYPES_SEANCE_FILM = [
  { id: 'seancesCine', label: 'Séances Cinés' },
  { id: 'cineClassiques', label: 'Ciné Classiques' },
  { id: 'courtsMetrages', label: 'Courts Métrages' },
];

function roleIdPourTypeSeance(typeSeanceId) {
  return config.cineClub.roles[typeSeanceId] || null;
}

/**
 * Programme les 3 rappels (J-1, H-1, H-15) pour une séance donnée.
 * Persistés en JSON pour survivre à un restart — voir init() du module
 * qui recharge et vérifie les rappels en attente au démarrage.
 */
function programmerRappels({ channelId, roleId, titre, dateSeance }) {
  const echeances = [
    { offsetMs: 24 * 60 * 60 * 1000, label: 'demain' },
    { offsetMs: 60 * 60 * 1000, label: "dans 1h" },
    { offsetMs: 15 * 60 * 1000, label: 'dans 15 minutes' },
  ];

  const items = echeances.map(({ offsetMs, label }, index) => ({
    id: `${dateSeance.getTime()}-${index}`,
    triggerAt: dateSeance.getTime() - offsetMs,
    channelId,
    roleId,
    message: `🎬 Rappel : **${titre}** ${label} (${formatDateFr(dateSeance)}) !`,
    sent: false,
  }));

  // On ne programme pas les rappels déjà passés (ex: /host lancé la veille
  // au soir pour une séance le lendemain matin — H-15 aurait un sens mais
  // pas J-1).
  const futurs = items.filter((i) => i.triggerAt > Date.now());
  store.addReminders(futurs);
  return futurs;
}

/**
 * Démarre la boucle de vérification des rappels en attente. À appeler une
 * seule fois au démarrage du bot (init(client) du module).
 */
function demarrerSchedulerRappels(client) {
  const INTERVALLE_MS = 60 * 1000;

  setInterval(async () => {
    const pending = store.getPendingReminders();
    const maintenant = Date.now();

    for (const reminder of pending) {
      if (reminder.triggerAt > maintenant) continue;

      try {
        const channel = await client.channels.fetch(reminder.channelId);
        const mention = reminder.roleId ? `<@&${reminder.roleId}> ` : '';
        await channel.send(`${mention}${reminder.message}`);
      } catch (err) {
        console.error('[CINE-CLUB] Impossible d\'envoyer un rappel :', err);
      } finally {
        store.markReminderSent(reminder.id);
      }
    }
  }, INTERVALLE_MS);
}

/**
 * Container Components V2 "liste compacte" — utilisé par /list et
 * /historique pour afficher plusieurs titres d'un coup. Volontairement
 * SANS poster/synopsis par entrée : une carte complète par titre (comme
 * buildFicheContainer) dépasserait vite les limites Discord d'un message
 * Components V2 (40 composants, ~4000 caractères de texte cumulés) pour
 * une liste de 15-25 entrées.
 */
function buildListeContainer({ titre, sousTitre, lignes, couleur = COULEUR_FILM, footer }) {
  const container = new ContainerBuilder().setAccentColor(couleur);

  container.addTextDisplayComponents((t) => t.setContent(`# ${titre}${sousTitre ? `\n${sousTitre}` : ''}`));
  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents((t) => t.setContent(lignes.join('\n')));

  if (footer) {
    container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents((t) => t.setContent(`-# ${footer}`));
  }

  return container;
}

/**
 * Insère une ligne de texte tout en haut d'un container déjà construit (ex:
 * "✅ Ajouté à la watchlist par ..." au-dessus d'une buildFicheContainer()).
 * Utile car un message Components V2 ne peut plus utiliser `content` une
 * fois le flag posé — ce texte de confirmation doit donc vivre dans le
 * container lui-même plutôt qu'à côté.
 */
function prependTextDisplay(container, texte) {
  container.spliceComponents(0, 0, new TextDisplayBuilder().setContent(texte));
  return container;
}

/**
 * Handler du bouton persistant "Valider séance" (customId
 * `cine_valider:<pollId>`), posté sous le sondage de la branche "Séances
 * Ciné semaine suivante" de `/cine` (seule branche qui passe encore par un
 * sondage — les 3 autres publient directement). Reprend le rôle de l'ancien
 * /host : dépouille le titre gagnant, fixe le créneau, le rôle à mentionner,
 * le salon vocal et le message de l'annonce, puis publie l'annonce finale +
 * crée l'événement Discord natif. Réservé à l'admin ou au rôle streamer.
 */
async function handleValiderSeanceButton(interaction) {
  if (!(await requireAnyRole(interaction, [config.cineClub.streamerRoleId], { label: 'le rôle streamer ciné-club' })))
    return;

  const pollId = interaction.customId.split(':').slice(1).join(':');
  const poll = store.getPollEnAttente(pollId);
  if (!poll) {
    return interaction.reply({
      content: '❌ Ce sondage est introuvable ou a déjà été validé.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const { titresCandidats } = poll;

  // --- Étape 1 : choix du titre gagnant ---
  let gagnant;
  if (titresCandidats.length === 1) {
    gagnant = titresCandidats[0];
  } else {
    const select = new StringSelectMenuBuilder()
      .setCustomId('host_titre')
      .setPlaceholder('Choisis le titre gagnant')
      .addOptions(
        titresCandidats.map((c) => ({
          label: c.titre.slice(0, 100),
          value: `${c.mediaType}:${c.tmdbId}`,
        }))
      );

    const message = await interaction.editReply({
      content: 'Quel titre a gagné le vote ?',
      components: [new ActionRowBuilder().addComponents(select)],
    });

    let clic;
    try {
      clic = await attendreClic(message, interaction.user.id, ['host_titre']);
    } catch {
      return interaction.editReply({ content: '⌛ Temps écoulé, validation annulée.', components: [] });
    }
    await clic.deferUpdate();
    const [mediaType, tmdbIdStr] = clic.values[0].split(':');
    gagnant = titresCandidats.find((c) => c.mediaType === mediaType && String(c.tmdbId) === tmdbIdStr);
  }

  const message = await interaction.editReply({ content: 'Traitement en cours...', components: [] });

  // --- Étape 2 : créneau de la séance ---
  if (!poll.creneaux || poll.creneaux.length === 0) {
    return message.edit('❌ Aucun créneau d\'horaire enregistré pour ce sondage.');
  }
  const row = new ActionRowBuilder().addComponents(
    poll.creneaux.map((c, i) =>
      new ButtonBuilder().setCustomId(`host_creneau_${i}`).setLabel(c.label).setStyle(ButtonStyle.Primary)
    )
  );
  await message.edit({ content: 'Quel créneau a gagné le sondage d\'horaire ?', components: [row] });

  let clicCreneau;
  try {
    clicCreneau = await attendreClic(
      message,
      interaction.user.id,
      poll.creneaux.map((_, i) => `host_creneau_${i}`)
    );
  } catch {
    return message.edit({ content: '⌛ Temps écoulé, validation annulée.', components: [] });
  }
  await clicCreneau.deferUpdate();
  const index = Number(clicCreneau.customId.split('_').pop());
  const dateSeance = new Date(poll.creneaux[index].date);

  // --- Étape 3 : rôle à mentionner ---
  const select = new StringSelectMenuBuilder()
    .setCustomId('host_role')
    .setPlaceholder('Type de séance')
    .addOptions(TYPES_SEANCE_FILM.map((t) => ({ label: t.label, value: t.id })));

  await message.edit({
    content: 'Quel type de séance ?',
    components: [new ActionRowBuilder().addComponents(select)],
  });

  let clicRole;
  try {
    clicRole = await attendreClic(message, interaction.user.id, ['host_role']);
  } catch {
    return message.edit({ content: '⌛ Temps écoulé, validation annulée.', components: [] });
  }
  await clicRole.deferUpdate();
  const roleId = roleIdPourTypeSeance(clicRole.values[0]);

  // --- Étape 4 : salon vocal de diffusion ---
  const salonVocalId = await demanderSalonVocal(interaction, message);
  if (!salonVocalId) return; // message d'erreur/timeout déjà posté

  const targetChannelId = config.cineClub.channelId;
  const salonAnnonce = await interaction.guild.channels.fetch(targetChannelId);
  if (!salonAnnonce) {
    return message.edit({ content: `❌ Salon d'annonce introuvable (ID ${targetChannelId}).`, components: [] });
  }

  // --- Étape 5 : message personnalisé de l'annonce ---
  const annonceTexte = await demanderMessagePersonnalise(interaction, message, {
    defaut: 'Nouvelle séance ciné-club programmée !',
  });
  if (!annonceTexte) return; // message d'erreur/timeout déjà posté par demanderMessagePersonnalise

  // --- Fiche TMDB complète (synopsis, réalisation, casting, pays à jour) ---
  const fiche = await tmdb.getDetails(gagnant.tmdbId, gagnant.mediaType);

  // --- Événement Discord natif (best-effort, ne bloque pas la validation si ça échoue) ---
  let eventId = null;
  try {
    const evenement = await interaction.guild.scheduledEvents.create({
      name: `Ciné-Club : ${fiche.titre}`,
      scheduledStartTime: dateSeance,
      scheduledEndTime: new Date(dateSeance.getTime() + 150 * 60 * 1000),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.Voice,
      channel: salonVocalId,
      description: fiche.overview.slice(0, 950),
    });
    eventId = evenement.id;
  } catch (err) {
    console.error("[CINE-CLUB] Impossible de créer l'événement Discord natif :", err);
  }

  const mention = roleId ? `<@&${roleId}> ` : '';
  const sessionKey = `${fiche.mediaType}:${fiche.tmdbId}:${dateSeance.getTime()}`;

  store.setAnnonce(sessionKey, {
    mediaType: fiche.mediaType,
    tmdbId: fiche.tmdbId,
    dateSeance: dateSeance.toISOString(),
    salonVocalId,
    channelId: targetChannelId,
    fiche,
    mention,
    annonceTexte,
    roleId,
    guildId: interaction.guild.id,
    eventId,
  });

  const container = buildSeanceContainer({
    sessionKey,
    mediaType: fiche.mediaType,
    dateSeance,
    salonVocalId,
    fiche,
    presentsCount: 0,
    mention,
    annonceTexte,
    guildId: interaction.guild.id,
    eventId,
  });

  await salonAnnonce.send({ flags: MessageFlags.IsComponentsV2, components: [container] });

  // --- Rappels J-1 / H-1 / H-15 ---
  programmerRappels({
    channelId: targetChannelId,
    roleId,
    titre: fiche.titre,
    dateSeance,
  });

  // --- Historique + série en cours ---
  store.addToHistorique({
    tmdbId: fiche.tmdbId,
    mediaType: fiche.mediaType,
    titre: fiche.titre,
    dateVu: dateSeance.toISOString(),
    posterUrl: fiche.posterUrl,
    source: 'cine-club',
  });

  store.clearPollEnAttente(pollId);

  // Le sondage a rempli son rôle : on retire le bouton "Valider séance" du
  // message d'origine pour éviter une double validation.
  try {
    await interaction.message.edit({
      content: `${interaction.message.content}\n\n✅ **Séance validée par ${interaction.user} !**`,
      components: [],
    });
  } catch (err) {
    console.error('[CINE-CLUB] Impossible de mettre à jour le message de sondage :', err);
  }

  await message.edit({ content: `✅ Séance programmée et annoncée dans <#${targetChannelId}> !`, components: [] });
}

/**
 * Handler du bouton "Je serai présent" (customId `cine_presence:<sessionKey>`).
 * Toggle la présence de l'utilisateur, reconstruit la carte séance avec le
 * compteur à jour, et édite le message en place via interaction.update().
 */
async function handlePresenceButton(interaction) {
  const sessionKey = interaction.customId.split(':').slice(1).join(':');
  const annonce = store.getAnnonce(sessionKey);

  if (!annonce) {
    return interaction.reply({ content: '❌ Cette annonce est introuvable (trop ancienne ?).', ephemeral: true });
  }

  const { isPresent, count } = store.togglePresence(sessionKey, {
    id: interaction.user.id,
    tag: interaction.user.tag,
  });
  const presentsList = store.getPresenceList(sessionKey);

  const container = buildSeanceContainer({
    sessionKey,
    mediaType: annonce.mediaType,
    dateSeance: new Date(annonce.dateSeance),
    salonVocalId: annonce.salonVocalId,
    fiche: annonce.fiche,
    presentsCount: count,
    presentsList,
    mention: annonce.mention,
    annonceTexte: annonce.annonceTexte,
    guildId: annonce.guildId,
    eventId: annonce.eventId,
  });

  await interaction.update({ flags: MessageFlags.IsComponentsV2, components: [container] });
  await interaction.followUp({
    content: isPresent ? '✅ Tu es marqué présent !' : '❌ Ta présence a été retirée.',
    ephemeral: true,
  });
}

/**
 * Handler du bouton "Démarrer l'event" (customId `cine_start_event:<sessionKey>`),
 * réservé au rôle streamer. Passe l'event Discord natif associé en statut
 * "en cours" (GuildScheduledEventStatus.Active).
 */
async function handleStartEventButton(interaction) {
  if (!(await requireStreamerRole(interaction))) return;

  const sessionKey = interaction.customId.split(':').slice(1).join(':');
  const annonce = store.getAnnonce(sessionKey);

  if (!annonce || !annonce.eventId) {
    return interaction.reply({ content: "❌ Aucun évènement Discord associé à cette séance.", ephemeral: true });
  }

  try {
    const evenement = await interaction.guild.scheduledEvents.fetch(annonce.eventId);
    await evenement.setStatus(GuildScheduledEventStatus.Active);
    await interaction.reply({ content: "▶️ Évènement démarré !", ephemeral: true });
  } catch (err) {
    console.error("[CINE-CLUB] Impossible de démarrer l'évènement :", err);
    await interaction.reply({
      content: "❌ Impossible de démarrer l'évènement (déjà démarré/terminé, ou permissions manquantes).",
      ephemeral: true,
    });
  }
}

module.exports = {
  buildFicheContainer,
  buildSeanceContainer,
  buildListeContainer,
  prependTextDisplay,
  attendreClic,
  selectionnerDansWatchlist,
  posterSondageReactions,
  posterSondageHoraire,
  demanderSalonVocal,
  demanderHeure,
  demanderTitreTmdb,
  demanderMessagePersonnalise,
  choisirResultatTmdb,
  doublonWatchlist,
  doublonHistorique,
  TYPES_SEANCE_FILM,
  roleIdPourTypeSeance,
  programmerRappels,
  demarrerSchedulerRappels,
  handlePresenceButton,
  handleStartEventButton,
  handleValiderSeanceButton,
};
