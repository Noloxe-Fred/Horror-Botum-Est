const crypto = require('crypto');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const withErrorHandling = require('../../../core/withErrorHandling');
const { requireAdmin } = require('../../../core/permissions');
const store = require('../store');
const { lireFlux, construireMessage, messageErreur, INTERVALLE_VERIFICATION_MS } = require('../service');

const DELAI_CHOIX_MS = 60 * 1000;

function libelleAbonnement(abonnement) {
  return `${abonnement.titre || abonnement.url} → #${abonnement.channelName || abonnement.channelId}`;
}

/**
 * Affiche un menu déroulant des flux suivis et renvoie celui choisi (ou
 * null si aucun flux / temps écoulé — la réponse est alors déjà faite).
 */
async function choisirAbonnement(interaction, placeholder) {
  const abonnements = store.listerFlux().slice(0, 25);
  if (abonnements.length === 0) {
    await interaction.editReply('📭 Aucun flux suivi. Ajoute-en un avec `/rss ajouter`.');
    return null;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('rss_choix')
    .setPlaceholder(placeholder)
    .addOptions(
      abonnements.map((a) => ({
        label: (a.titre || a.url).slice(0, 100),
        description: `${a.url} → #${a.channelName || a.channelId}`.slice(0, 100),
        value: a.id,
      }))
    );

  const message = await interaction.editReply({
    components: [new ActionRowBuilder().addComponents(select)],
  });

  try {
    const choix = await message.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && i.customId === 'rss_choix',
      time: DELAI_CHOIX_MS,
    });
    await choix.deferUpdate();
    return store.getFlux(choix.values[0]);
  } catch {
    await interaction.editReply({ content: '⌛ Temps écoulé.', components: [] });
    return null;
  }
}

async function ajouter(interaction) {
  const url = interaction.options.getString('url', true).trim();
  const salon = interaction.options.getChannel('salon', true);
  const role = interaction.options.getRole('role');

  if (store.listerFlux().some((a) => a.url === url && a.channelId === salon.id)) {
    return interaction.editReply(`⚠️ Ce flux est déjà publié dans ${salon}.`);
  }

  let flux;
  try {
    flux = await lireFlux(url);
  } catch (err) {
    return interaction.editReply(`❌ Impossible de lire ce flux : ${messageErreur(err)}`);
  }

  // Les articles déjà présents dans le flux sont marqués comme vus : seuls
  // les articles publiés à partir de maintenant seront postés (sinon le
  // salon serait inondé par tout l'historique du flux).
  store.ajouterFlux({
    id: crypto.randomBytes(4).toString('hex'),
    url,
    titre: flux.titre,
    channelId: salon.id,
    channelName: salon.name,
    roleId: role?.id || null,
    ajoutePar: interaction.user.id,
    ajouteLe: new Date().toISOString(),
    vus: flux.articles.map((a) => a.id),
  });

  const minutes = Math.round(INTERVALLE_VERIFICATION_MS / 60000);
  return interaction.editReply(
    `✅ Flux **${flux.titre || url}** suivi dans ${salon}${role ? ` (mention ${role})` : ''}.\n` +
      `Les ${flux.articles.length} articles actuels sont ignorés : les prochains seront publiés (vérification toutes les ${minutes} min).\n` +
      'Utilise `/rss tester` pour prévisualiser le rendu.'
  );
}

async function liste(interaction) {
  const abonnements = store.listerFlux();
  if (abonnements.length === 0) {
    return interaction.editReply('📭 Aucun flux suivi. Ajoute-en un avec `/rss ajouter`.');
  }
  const lignes = abonnements.map(
    (a) => `• **${a.titre || 'Sans titre'}** → <#${a.channelId}>${a.roleId ? ` (mention <@&${a.roleId}>)` : ''}\n  ${a.url}`
  );
  return interaction.editReply(`📰 **Flux suivis (${abonnements.length})**\n${lignes.join('\n')}`);
}

async function supprimer(interaction) {
  const abonnement = await choisirAbonnement(interaction, 'Choisis le flux à ne plus suivre');
  if (!abonnement) return;
  store.supprimerFlux(abonnement.id);
  return interaction.editReply({ content: `🗑️ Flux **${libelleAbonnement(abonnement)}** supprimé.`, components: [] });
}

async function tester(interaction) {
  const abonnement = await choisirAbonnement(interaction, 'Choisis le flux à prévisualiser');
  if (!abonnement) return;

  await interaction.editReply({ content: '⏳ Lecture du flux...', components: [] });
  const flux = await lireFlux(abonnement.url);
  const dernier = flux.articles.at(-1);
  if (!dernier) {
    return interaction.editReply('📭 Le flux ne contient aucun article.');
  }

  // Un message Components V2 ne peut pas avoir de `content` : l'en-tête de
  // l'aperçu est un TextDisplay, et l'ancien texte est vidé explicitement.
  const { container, fichiers } = await construireMessage(flux, dernier);
  return interaction.editReply({
    content: null,
    flags: MessageFlags.IsComponentsV2,
    components: [
      new TextDisplayBuilder().setContent(`👀 Aperçu du dernier article, tel qu'il serait publié dans <#${abonnement.channelId}> :`),
      container,
    ],
    files: fichiers,
  });
}

const SOUS_COMMANDES = { ajouter, liste, supprimer, tester };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rss')
    .setDescription('Gère les flux RSS publiés automatiquement sur le serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc
        .setName('ajouter')
        .setDescription('Suit un nouveau flux RSS/Atom et publie ses articles dans un salon')
        .addStringOption((o) => o.setName('url').setDescription('Adresse du flux (ex: https://site.com/feed/)').setRequired(true))
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription('Salon où publier les articles')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addRoleOption((o) => o.setName('role').setDescription('Rôle à mentionner à chaque article (optionnel)'))
    )
    .addSubcommand((sc) => sc.setName('liste').setDescription('Liste les flux suivis'))
    .addSubcommand((sc) => sc.setName('supprimer').setDescription('Arrête de suivre un flux'))
    .addSubcommand((sc) => sc.setName('tester').setDescription("Prévisualise le dernier article d'un flux (visible par toi seul)")),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireAdmin(interaction))) return;
    await interaction.deferReply({ ephemeral: true });
    await SOUS_COMMANDES[interaction.options.getSubcommand()](interaction);
  }, 'RSS'),
};
