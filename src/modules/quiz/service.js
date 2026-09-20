const Jimp = require('jimp');
const {
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../../config');
const { requireAnyRole } = require('../../core/permissions');
const store = require('./store');
const tmdb = require('./tmdb');

const COULEUR_QUIZ = 0x8e44ad; // violet, distinct des couleurs film/série du ciné-club
const DELAI_PALIER_MS = 2 * 24 * 60 * 60 * 1000; // 2 jours entre chaque palier, validé avec l'utilisateur
const NIVEAUX_PIXEL = { 1: 5, 2: 12, 3: 25, 4: 50 }; // largeur (px) du downscale avant remise à l'échelle — plus petit = plus pixélisé
const NB_MANCHES_PAR_CYCLE = 10;

const ROLES_AUTORISES_LABEL = 'rôle Modérateur Quiz';

function rolesAutorises() {
  return [config.roles.adminId, config.roles.quizModeratorId];
}

// --- Utilitaires internes -----------------------------------------------

function genererRoundId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function separateur(container) {
  return container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
}

/**
 * Pixélise une image en la réduisant fortement puis en la remettant à
 * l'échelle sans lissage (nearest-neighbor), pour obtenir l'effet "gros
 * blocs" plutôt qu'un simple flou. Le niveau de réduction diminue à chaque
 * palier pour affiner progressivement l'affiche.
 */
async function pixeliser(buffer, stage) {
  const image = await Jimp.read(buffer);
  const largeurFinale = image.bitmap.width;
  const largeurReduite = NIVEAUX_PIXEL[stage] || NIVEAUX_PIXEL[4];

  image
    .resize(largeurReduite, Jimp.AUTO) // moyenne les couleurs par blocs en réduisant fortement
    .resize(largeurFinale, Jimp.AUTO, Jimp.RESIZE_NEAREST_NEIGHBOR); // remise à l'échelle sans lissage -> blocs nets

  return image.getBufferAsync(Jimp.MIME_PNG);
}

/**
 * Normalise une chaîne pour la comparaison : accents retirés, minuscules,
 * ponctuation supprimée, espaces multiples réduits.
 */
function normaliser(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function distanceLevenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cout);
    }
  }

  return dp[m][n];
}

/**
 * Compare la réponse d'un joueur à un ou plusieurs titres acceptés (titre
 * fr-FR + éventuellement titre original), avec tolérance aux fautes de
 * frappe/accents via une distance de Levenshtein proportionnelle à la
 * longueur du titre (minimum 2 caractères de tolérance).
 */
function reponseCorrecte(reponseUser, reponsesAcceptees) {
  const propre = normaliser(reponseUser || '');
  if (!propre) return false;

  return reponsesAcceptees.filter(Boolean).some((titre) => {
    const titreNorm = normaliser(titre);
    const tolerance = Math.max(2, Math.floor(titreNorm.length * 0.2));
    return distanceLevenshtein(propre, titreNorm) <= tolerance;
  });
}

// --- Construction des messages Components V2 ------------------------------
// Style aligné sur cine-club/service.js (buildFicheContainer/buildSeanceContainer) :
// titre en # / SeparatorBuilder entre sections / note en -# / boutons lien en fin.

/**
 * Carte "manche en cours" — postée à chaque palier (1 à 4). `mention` n'est
 * fourni que pour le palier 1 (annonce du rôle "Jouons à un jeu"), pour ne
 * pas re-pinger tout le monde à chaque palier suivant de la même manche.
 */
function construireContainerManche(session, buffer, { mention = '' } = {}) {
  const nomFichier = `quiz-poster-palier-${session.stage}.png`;
  const attachment = new AttachmentBuilder(buffer, { name: nomFichier });

  const container = new ContainerBuilder().setAccentColor(COULEUR_QUIZ);

  container.addTextDisplayComponents((t) =>
    t.setContent(`${mention}# 🎬 Quiz Affiche Floutée\nManche ${session.numeroManche}/${NB_MANCHES_PAR_CYCLE} — Palier ${session.stage}/4`)
  );
  separateur(container);

  container.addMediaGalleryComponents((galerie) =>
    galerie.addItems((item) => item.setURL(`attachment://${nomFichier}`).setDescription('Affiche floutée à deviner'))
  );

  container.addTextDisplayComponents((t) =>
    t.setContent("Devine le film d'horreur à partir de cette affiche. Plus elle se précise, moins tu marques de points !")
  );
  separateur(container);

  container.addActionRowComponents((row) =>
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`quiz_answer:${session.roundId}`)
        .setLabel('📝 Répondre')
        .setStyle(ButtonStyle.Primary)
    )
  );

  return { container, attachment };
}

function formaterLigneGagnant(g) {
  return (
    `🏅 **${g.tag}** — palier ${g.stage}/4, +${g.points} point${g.points > 1 ? 's' : ''} ` +
    `(${g.tentatives} tentative${g.tentatives > 1 ? 's' : ''})`
  );
}

function construireContainerReveal(session, buffer, gagnants) {
  const nomFichier = 'quiz-poster-reveal.png';
  const attachment = new AttachmentBuilder(buffer, { name: nomFichier });
  const annee = session.dateSortie ? ` (${session.dateSortie.slice(0, 4)})` : '';

  const lignesGagnants =
    gagnants.length > 0
      ? gagnants.map(formaterLigneGagnant).join('\n')
      : "Personne n'a trouvé la bonne réponse cette fois... 👻";

  const container = new ContainerBuilder().setAccentColor(COULEUR_QUIZ);

  container.addTextDisplayComponents((t) =>
    t.setContent(`# 🎬 Quiz Affiche Floutée — Réponse !\nManche ${session.numeroManche}/${NB_MANCHES_PAR_CYCLE}`)
  );
  separateur(container);

  container.addMediaGalleryComponents((galerie) =>
    galerie.addItems((item) => item.setURL(`attachment://${nomFichier}`).setDescription(session.titre.slice(0, 100)))
  );

  container.addTextDisplayComponents((t) => t.setContent(`**${session.titre}**${annee}\n${session.overview}`));
  separateur(container);

  container.addTextDisplayComponents((t) => t.setContent(`**Bonnes réponses de cette manche :**\n${lignesGagnants}`));
  container.addTextDisplayComponents((t) =>
    t.setContent(`-# Le classement général reste secret jusqu'à la ${NB_MANCHES_PAR_CYCLE}e manche du cycle...`)
  );
  separateur(container);

  container.addActionRowComponents((row) =>
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Voir la fiche TMDB').setURL(tmdb.urlFiche(session.tmdbId)),
      new ButtonBuilder()
        .setCustomId(`quiz_next:${session.roundId}`)
        .setLabel('▶️ Question suivante')
        .setStyle(ButtonStyle.Success)
    )
  );

  return { container, attachment };
}

function construireContainerPalmares(classement) {
  const lignes =
    classement.length > 0
      ? classement.map((c, i) => `${i + 1}. **${c.tag}** — ${c.points} point${c.points > 1 ? 's' : ''}`).join('\n')
      : 'Aucun point marqué sur ce cycle...';

  const container = new ContainerBuilder().setAccentColor(COULEUR_QUIZ);
  container.addTextDisplayComponents((t) => t.setContent('# 🏆 Palmarès du cycle Quiz Affiche Floutée !'));
  separateur(container);
  container.addTextDisplayComponents((t) =>
    t.setContent(`Après ${NB_MANCHES_PAR_CYCLE} manches, voici le classement général :\n\n${lignes}`)
  );
  container.addTextDisplayComponents((t) => t.setContent('-# Les scores sont remis à zéro, un nouveau cycle commence ! 🎬'));

  return container;
}

// --- Orchestration des manches --------------------------------------------

/**
 * Lance une nouvelle manche : tire un film, poste le palier 1 (très
 * pixélisé) dans QUIZ_CHANNEL_ID, en mentionnant le rôle "Jouons à un jeu"
 * s'il est configuré. Renvoie `false` si aucun film candidat n'a pu être
 * trouvé sur TMDB (l'appelant doit prévenir l'utilisateur).
 */
async function demarrerNouvelleManche(client, startedBy) {
  let candidat = await tmdb.tirerFilmHorreurAleatoire({ excludeIds: store.getUsedTmdbIds() });

  if (!candidat) {
    // Pool épuisé (tous les films correspondant aux critères ont déjà été
    // utilisés) -> on réinitialise l'historique anti-répétition et on
    // retente une fois avant d'abandonner pour de bon.
    console.warn("[QUIZ] Pool de films épuisé, réinitialisation de l'historique anti-répétition.");
    store.resetUsedTmdbIds();
    candidat = await tmdb.tirerFilmHorreurAleatoire({ excludeIds: [] });
  }

  if (!candidat) return false;

  const roundId = genererRoundId();
  const posterOriginal = await tmdb.telechargerPoster(candidat.posterUrl);
  const bufferFlou = await pixeliser(posterOriginal, 1);

  const numeroManche = store.getEtatCycle().cycleRoundCount + 1;

  const session = {
    roundId,
    tmdbId: candidat.tmdbId,
    titre: candidat.titre,
    titreOriginal: candidat.titreOriginal,
    overview: candidat.overview,
    posterUrl: candidat.posterUrl,
    voteAverage: candidat.voteAverage,
    dateSortie: candidat.dateSortie,
    stage: 1,
    nextStageAt: Date.now() + DELAI_PALIER_MS,
    startedAt: new Date().toISOString(),
    startedBy,
    numeroManche,
  };
  store.setSession(session);

  const channel = await client.channels.fetch(config.channels.quizId);
  const mention = config.roles.quizPingRoleId ? `<@&${config.roles.quizPingRoleId}> ` : '';
  const { container, attachment } = construireContainerManche(session, bufferFlou, { mention });
  await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container], files: [attachment] });

  return true;
}

/**
 * Vérifie si la manche en cours doit avancer d'un palier (ou passer au
 * reveal). Appelée périodiquement par le scheduler démarré dans init().
 */
async function avancerManche(client) {
  const session = store.getSession();
  if (!session) return;
  if (Date.now() < session.nextStageAt) return;

  const channel = await client.channels.fetch(config.channels.quizId);

  if (session.stage < 4) {
    const nouveauStage = session.stage + 1;
    const posterOriginal = await tmdb.telechargerPoster(session.posterUrl);
    const buffer = await pixeliser(posterOriginal, nouveauStage);

    const sessionMaj = { ...session, stage: nouveauStage, nextStageAt: Date.now() + DELAI_PALIER_MS };
    store.setSession(sessionMaj);

    // Pas de mention ici : seul le palier 1 (nouvelle manche) ping le rôle,
    // pour ne pas spammer tous les 2 jours sur la même manche.
    const { container, attachment } = construireContainerManche(sessionMaj, buffer);
    await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container], files: [attachment] });
    return;
  }

  // --- Palier 4 écoulé -> reveal de la réponse ---
  const bufferNet = await tmdb.telechargerPoster(session.posterUrl);
  const gagnants = store.getGagnants(session.roundId);

  const { container, attachment } = construireContainerReveal(session, bufferNet, gagnants);
  await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container], files: [attachment] });

  store.addUsedTmdbId(session.tmdbId);
  store.clearTentatives(session.roundId);
  store.clearSession();

  const { cycleRoundCount } = store.incrementerCycle();

  if (cycleRoundCount >= NB_MANCHES_PAR_CYCLE) {
    const classement = store.getClassement();
    const channelReponses = await client.channels.fetch(config.channels.quizResponseId).catch(() => null);
    const cibleChannel = channelReponses || channel;
    await cibleChannel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [construireContainerPalmares(classement)],
    });
    store.reinitialiserCycle();
  }
}

// --- Handlers boutons / modal (exportés vers index.js) -------------------

async function gererBoutonRepondre(interaction) {
  const [, roundId] = interaction.customId.split(':');
  const session = store.getSession();

  if (!session || session.roundId !== roundId) {
    return interaction.reply({ content: '❌ Cette manche est terminée, tu ne peux plus répondre.', ephemeral: true });
  }

  if (store.aDejaTrouve(roundId, interaction.user.id)) {
    return interaction.reply({
      content: '✅ Tu as déjà trouvé la bonne réponse pour cette manche, bravo !',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder().setCustomId(`quiz_modal:${roundId}`).setTitle('Quiz Affiche Floutée');
  const input = new TextInputBuilder()
    .setCustomId('reponse')
    .setLabel('Quel est ce film ?')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function gererSoumissionReponse(interaction) {
  const [, roundId] = interaction.customId.split(':');
  const session = store.getSession();

  if (!session || session.roundId !== roundId) {
    return interaction.reply({ content: '❌ Cette manche est terminée.', ephemeral: true });
  }

  if (store.aDejaTrouve(roundId, interaction.user.id)) {
    return interaction.reply({
      content: '✅ Tu as déjà trouvé la bonne réponse pour cette manche !',
      ephemeral: true,
    });
  }

  const reponseBrute = interaction.fields.getTextInputValue('reponse');
  const nbTentatives = store.enregistrerTentative(roundId, interaction.user.id, interaction.user.tag);

  const correct = reponseCorrecte(reponseBrute, [session.titre, session.titreOriginal]);

  if (!correct) {
    return interaction.reply({ content: '❌ Mauvaise réponse, retente !', ephemeral: true });
  }

  const points = 5 - session.stage;
  store.enregistrerTrouvaille(roundId, interaction.user.id, interaction.user.tag, {
    stage: session.stage,
    points,
    tentatives: nbTentatives,
  });
  store.ajouterPoints(interaction.user.id, interaction.user.tag, points);

  await interaction.reply({
    content: `✅ Bonne réponse ! +${points} point${points > 1 ? 's' : ''} (palier ${session.stage}/4).`,
    ephemeral: true,
  });

  const channelReponses = await interaction.client.channels.fetch(config.channels.quizResponseId).catch(() => null);
  if (channelReponses) {
    await channelReponses.send(
      `🎉 **${interaction.user.tag}** a trouvé la bonne réponse ! ` +
        `(palier ${session.stage}/4 — +${points} point${points > 1 ? 's' : ''} — ` +
        `en ${nbTentatives} tentative${nbTentatives > 1 ? 's' : ''})`
    );
  }
}

async function gererBoutonQuestionSuivante(interaction) {
  if (!(await requireAnyRole(interaction, rolesAutorises(), { label: ROLES_AUTORISES_LABEL }))) return;

  if (store.getSession()) {
    return interaction.reply({ content: '❌ Une manche est déjà en cours.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const demarree = await demarrerNouvelleManche(interaction.client, {
    id: interaction.user.id,
    tag: interaction.user.tag,
  });

  if (!demarree) {
    return interaction.editReply("❌ Impossible de trouver un nouveau film correspondant aux critères sur TMDB.");
  }

  await interaction.editReply('✅ Nouvelle manche lancée !');
}

module.exports = {
  rolesAutorises,
  ROLES_AUTORISES_LABEL,
  demarrerNouvelleManche,
  avancerManche,
  gererBoutonRepondre,
  gererSoumissionReponse,
  gererBoutonQuestionSuivante,
};
