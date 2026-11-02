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
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../../config');
const { requireStreamerRole } = require('../../core/permissions');
const store = require('./store');
const tmdb = require('./tmdb');
const { formatDateFr, formatJourFr, parseHeure, prochainsJours } = require('./dateUtils');

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
 * Date TMDB "AAAA-MM-JJ" -> "12 mars 1982". Formatée en UTC : la date TMDB
 * est un jour calendaire, sans heure, qu'aucun fuseau ne doit décaler.
 */
function formatDateSortie(dateSortie) {
  if (!dateSortie) return null;
  const date = new Date(`${dateSortie}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/**
 * Ligne "stats" (date de sortie / note / durée / pays), commune à la fiche
 * et à la carte séance. La durée n'est affichée que pour un film (décision
 * explicite — TMDB ne donne qu'une durée moyenne d'épisode pour une série,
 * jugée peu pertinente ici).
 */
function ligneStats(fiche) {
  const dateSortie = formatDateSortie(fiche.dateSortie);
  const parties = [
    dateSortie ? `📅 ${dateSortie}` : null,
    fiche.voteAverage ? `⭐ ${fiche.voteAverage}/10` : null,
    fiche.mediaType !== 'tv' && fiche.duree ? `⏱️ ${fiche.duree} min` : null,
    fiche.pays ? `🌍 ${fiche.pays}` : null,
  ].filter(Boolean);
  return parties.length ? parties.join('   ') : null;
}

/**
 * Libellé court des épisodes d'une séance série ({ saison, liste }) :
 * "S2 · Ép. 3-5, 8" — les numéros consécutifs sont regroupés en plages.
 * Utilisé pour le nom de l'event, les rappels et le programme en image.
 */
function libelleEpisodesCourt({ saison, liste }) {
  const numeros = liste.map((e) => e.numero).sort((a, b) => a - b);
  const plages = [];
  for (const n of numeros) {
    const derniere = plages[plages.length - 1];
    if (derniere && n === derniere[1] + 1) derniere[1] = n;
    else plages.push([n, n]);
  }
  const texte = plages.map(([debut, fin]) => (debut === fin ? `${debut}` : `${debut}-${fin}`)).join(', ');
  return `S${saison} · Ép. ${texte}`;
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
 * Carte "séance" Components V2 — utilisée par toutes les branches de /cine. Affiche
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
  episodes = null,
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

  // Épisodes diffusés (branche "Séances Séries" uniquement).
  if (episodes && episodes.liste.length) {
    const nb = episodes.liste.length;
    const lignes = episodes.liste.map((e) => `\`É${String(e.numero).padStart(2, '0')}\` ${e.titre}`);
    container.addTextDisplayComponents((t) =>
      t.setContent(`📺 **Saison ${episodes.saison} — ${nb} épisode${nb > 1 ? 's' : ''}**\n${lignes.join('\n')}`.slice(0, 4000))
    );
  }

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

  await interaction.editReply({
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
    await interaction.editReply({ content: '⌛ Temps écoulé, aucun titre choisi.', embeds: [], components: [] });
    return null;
  }
}

/**
 * Demande le salon vocal de diffusion parmi les salons vocaux du serveur
 * (liste dynamique, pas de config .env figée). Auto-sélectionne s'il n'y en
 * a qu'un seul. Réutilisé par les branches de /cine.
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
    await interaction.editReply({ content: '❌ Aucun salon vocal trouvé sur ce serveur.', components: [] });
    return null;
  }

  if (salons.length === 1) return salons[0].value;

  const select = new StringSelectMenuBuilder()
    .setCustomId('salon_vocal')
    .setPlaceholder('Choisis le salon vocal de diffusion')
    .addOptions(salons);

  await interaction.editReply({
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
    await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }
}

/**
 * Demande au streamer l'heure de diffusion via un bouton qui ouvre une
 * modale (un select menu ne permet pas la saisie libre nécessaire ici).
 * Réutilisé par les branches "Séances Séries" et "Séance Libre" de /cine.
 *
 * Renvoie { heure, minute }, ou `null` en cas d'annulation/timeout/format
 * invalide (message d'erreur déjà posté dans `message`, l'appelant doit
 * juste s'arrêter).
 */
async function demanderHeure(interaction, message, { defaut = '20h45', label = "l'heure de diffusion" } = {}) {
  const boutonId = 'heure_ouvrir_modal';

  await interaction.editReply({
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
    await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
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
    await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }

  const brut = soumission.fields.getTextInputValue('heure_valeur');
  const heureParsee = parseHeure(brut);
  await soumission.deferUpdate();

  if (!heureParsee) {
    await interaction.editReply({
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
 * Dernière étape commune aux 3 branches de /cine avant publication.
 *
 * Renvoie le texte choisi, ou `null` en cas d'annulation/timeout (message
 * d'erreur déjà posté dans `message`, l'appelant doit juste s'arrêter).
 */
async function demanderMessagePersonnalise(interaction, message, { defaut }) {
  const boutonId = 'message_ouvrir_modal';

  await interaction.editReply({
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
    await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
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
    await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }

  const texte = soumission.fields.getTextInputValue('message_valeur').trim();
  await soumission.deferUpdate();

  return texte || defaut;
}

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

/**
 * Sélecteur paginé (single-select) dans la watchlist. Utilisé par la branche
 * "Séance Libre" (choix watchlist). Renvoie un tableau contenant l'entrée
 * choisie, vide en cas d'annulation/timeout (message d'erreur déjà posté).
 */
async function selectionnerDansWatchlist(interaction, message, entrees) {
  if (entrees.length === 0) {
    await interaction.editReply({ content: '❌ La watchlist est vide pour ce type de contenu.', components: [] });
    return [];
  }

  const totalPages = Math.ceil(entrees.length / PAGE_SIZE);
  let page = 0;

  while (true) {
    const pageEntries = entrees.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const select = new StringSelectMenuBuilder()
      .setCustomId('watchlist_select')
      .setPlaceholder('Choisis un titre')
      .addOptions(pageEntries.map((e) => ({ label: e.titre.slice(0, 100), value: cleEntree(e) })));

    const rows = [new ActionRowBuilder().addComponents(select)];
    if (totalPages > 1) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('watchlist_page_prev').setLabel('◀️ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId('watchlist_page_next').setLabel('Suivant ▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
        )
      );
    }

    await interaction.editReply({ content: `Page ${page + 1}/${totalPages}`, components: rows });

    let interactionComposant;
    try {
      interactionComposant = await attendreClic(message, interaction.user.id, [
        'watchlist_select',
        'watchlist_page_prev',
        'watchlist_page_next',
      ]);
    } catch {
      await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
      return [];
    }

    await interactionComposant.deferUpdate();

    if (interactionComposant.customId === 'watchlist_page_prev') {
      page = Math.max(0, page - 1);
      continue;
    }
    if (interactionComposant.customId === 'watchlist_page_next') {
      page = Math.min(totalPages - 1, page + 1);
      continue;
    }
    const choisi = entrees.find((e) => cleEntree(e) === interactionComposant.values[0]);
    return choisi ? [choisi] : [];
  }
}

const NB_JOURS_PROPOSES = 21; // 3 semaines (un select Discord accepte 25 options max)

/**
 * Demande le jour de la séance parmi les NB_JOURS_PROPOSES prochains jours
 * (à partir de demain). Utilisé par les branches "Séance Libre" et
 * "Séances Séries".
 *
 * Renvoie la date choisie (00:00), ou `null` en cas d'annulation/timeout
 * (message d'erreur déjà posté dans `message`, l'appelant doit juste
 * s'arrêter).
 */
async function demanderJour(interaction, message) {
  const jours = prochainsJours(NB_JOURS_PROPOSES);
  const select = new StringSelectMenuBuilder()
    .setCustomId('seance_jour')
    .setPlaceholder('Jour de la séance')
    .addOptions(jours.map((j, i) => ({ label: formatJourFr(j), value: String(i) })));

  await interaction.editReply({
    content: 'Quel jour ?',
    components: [new ActionRowBuilder().addComponents(select)],
  });

  let clic;
  try {
    clic = await attendreClic(message, interaction.user.id, ['seance_jour']);
  } catch {
    await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }
  await clic.deferUpdate();
  return jours[Number(clic.values[0])];
}

/**
 * Demande un titre libre via modale (recherche TMDB) — utilisé par les
 * branches "Séance à l'arrache" et "Séance Libre". `clicBouton` est
 * l'interaction du bouton qui déclenche l'ouverture de la modale (une
 * modale doit être la toute première réponse à son interaction).
 *
 * Renvoie la chaîne saisie, ou `null` en cas d'annulation/timeout (message
 * d'erreur déjà posté dans `message`, l'appelant doit juste s'arrêter).
 */
async function demanderTitreTmdb(interaction, clicBouton, message, { label = 'Titre à rechercher' } = {}) {
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
    await interaction.editReply({ content: '⌛ Temps écoulé, commande annulée.', components: [] });
    return null;
  }

  const titre = soumission.fields.getTextInputValue('titre_valeur').trim();
  await soumission.deferUpdate();

  if (!titre) {
    await interaction.editReply({ content: '❌ Titre vide, commande annulée.', components: [] });
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
 * Programme le rappel H-1 d'une séance (un seul rappel : le rappel de la
 * veille a été retiré, le programme de la semaine étant rappelé chaque
 * dimanche — voir programme/rappel-hebdo.js).
 * Persisté en JSON pour survivre à un restart — voir init() du module
 * qui recharge et vérifie les rappels en attente au démarrage.
 */
function programmerRappels({ sessionKey, channelId, roleId, titre, dateSeance }) {
  // Suffixe d'id "-1" conservé (c'était celui du H-1) : "-0" reste réservé
  // aux anciens rappels J-1 encore persistés, écartés par le scheduler.
  const item = {
    id: `${dateSeance.getTime()}-1`,
    triggerAt: dateSeance.getTime() - 60 * 60 * 1000,
    sessionKey, // permet de retirer les rappels avec la séance (/supprimer-seance)
    channelId,
    roleId,
    message: `🎬 Rappel : **${titre}** dans 1h (${formatDateFr(dateSeance)}) !`,
    sent: false,
  };

  // Pas de rappel déjà passé (séance programmée moins d'1h à l'avance).
  const futurs = item.triggerAt > Date.now() ? [item] : [];
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

      // Rappels H-15 et J-1 hérités (programmés avant leur suppression,
      // encore persistés pour des séances futures) : on les écarte sans les
      // envoyer.
      if (reminder.message.includes('dans 15 minutes') || reminder.message.includes('** demain (')) {
        store.markReminderSent(reminder.id);
        continue;
      }

      try {
        const channel = await client.channels.fetch(reminder.channelId);
        const mention = reminder.roleId ? `<@&${reminder.roleId}> ` : '';
        await channel.send(`${mention}${reminder.message}`);
      } catch (err) {
        console.error('[SEANCES-CINE] Impossible d\'envoyer un rappel :', err);
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
 * Handler du bouton "Je serai présent" (customId `cine_presence:<sessionKey>`).
 * Toggle la présence de l'utilisateur, reconstruit la carte séance avec le
 * compteur à jour, et édite le message en place.
 *
 * L'interaction est acquittée (deferUpdate) avant toute modification du
 * store : si Discord la rejette (délai de 3 s dépassé -> 10062 Unknown
 * interaction), la présence n'est pas basculée, sinon l'utilisateur serait
 * inscrit sans que la carte le montre, et son clic suivant le désinscrirait.
 */
async function handlePresenceButton(interaction) {
  await interaction.deferUpdate();

  const sessionKey = interaction.customId.split(':').slice(1).join(':');
  const annonce = store.getAnnonce(sessionKey);

  if (!annonce) {
    return interaction.followUp({ content: '❌ Cette annonce est introuvable (trop ancienne ?).', ephemeral: true });
  }

  const { isPresent, count } = store.togglePresence(sessionKey, {
    id: interaction.user.id,
    // Pseudo serveur si dispo, sinon nom d'affichage global du compte.
    nom: interaction.member?.displayName ?? interaction.user.displayName,
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
    episodes: annonce.episodes,
  });

  await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
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
    console.error("[SEANCES-CINE] Impossible de démarrer l'évènement :", err);
    await interaction.reply({
      content: "❌ Impossible de démarrer l'évènement (déjà démarré/terminé, ou permissions manquantes).",
      ephemeral: true,
    });
  }
}

module.exports = {
  buildFicheContainer,
  buildSeanceContainer,
  libelleEpisodesCourt,
  buildListeContainer,
  prependTextDisplay,
  attendreClic,
  selectionnerDansWatchlist,
  demanderJour,
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
};
