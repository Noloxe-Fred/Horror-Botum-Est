const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Vérifie que l'utilisateur est admin, répond avec une erreur sinon.
 * Retourne true si la commande peut continuer, false sinon.
 */
async function requireAdmin(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Cette commande est réservée aux administrateurs du serveur.',
      ephemeral: true,
    });
    return false;
  }
  return true;
}

/**
 * Vérifie que l'utilisateur possède le rôle streamer ciné-club
 * (CINE_CLUB_STREAMER_ROLE_ID). Générique : sur le même modèle que
 * requireAdmin, mais pensé pour être réutilisable si d'autres modules ont
 * besoin d'un rôle "responsable" dédié plus tard.
 */
async function requireStreamerRole(interaction) {
  const roleId = config.cineClub.streamerRoleId;

  if (!roleId) {
    await interaction.reply({
      content: '❌ CINE_CLUB_STREAMER_ROLE_ID non configuré — commande indisponible.',
      ephemeral: true,
    });
    return false;
  }

  if (!interaction.member.roles.cache.has(roleId)) {
    await interaction.reply({
      content: '❌ Cette commande est réservée au rôle streamer du ciné-club.',
      ephemeral: true,
    });
    return false;
  }

  return true;
}

/**
 * Vérifie que la commande est lancée dans le salon attendu (par ID).
 * Générique — le module appelant fournit l'ID et le libellé du salon.
 */
async function requireChannel(interaction, channelId, { label = 'le salon dédié' } = {}) {
  if (!channelId) {
    await interaction.reply({
      content: '❌ Le salon requis pour cette commande n\'est pas configuré dans .env.',
      ephemeral: true,
    });
    return false;
  }

  if (interaction.channel.id !== channelId) {
    await interaction.reply({
      content: `❌ Cette commande ne peut être utilisée que dans ${label} (<#${channelId}>).`,
      ephemeral: true,
    });
    return false;
  }

  return true;
}

/**
 * Vérifie que la commande est lancée dans l'un des salons fournis (par ID).
 * Générique — utile quand plusieurs salons distincts doivent chacun donner
 * accès à une même commande (ex: salon ciné-club principal OU salon dédié
 * "séances à l'arrache" pour /arrache), contrairement à requireChannel qui
 * ne teste qu'un seul salon précis.
 */
async function requireAnyChannel(interaction, channelIds = [], { label = 'un salon autorisé' } = {}) {
  const idsValides = channelIds.filter(Boolean);

  if (idsValides.length === 0) {
    await interaction.reply({
      content: '❌ Aucun salon autorisé n\'est configuré dans .env pour cette commande.',
      ephemeral: true,
    });
    return false;
  }

  if (!idsValides.includes(interaction.channel.id)) {
    const liste = idsValides.map((id) => `<#${id}>`).join(' ou ');
    await interaction.reply({
      content: `❌ Cette commande ne peut être utilisée que dans ${label} (${liste}).`,
      ephemeral: true,
    });
    return false;
  }

  return true;
}

/**
 * Vérifie que l'utilisateur possède au moins un des rôles fournis (ou est
 * administrateur du serveur, toujours autorisé par défaut). Générique —
 * utile quand plusieurs rôles distincts doivent chacun donner accès à une
 * même commande (ex: rôle Admin OU rôle Modérateur Quiz pour
 * /quiz-affiche-floutee), contrairement à requireStreamerRole qui ne teste
 * qu'un seul rôle précis.
 */
async function requireAnyRole(interaction, roleIds = [], { label = 'un rôle autorisé' } = {}) {
  if (isAdmin(interaction)) return true;

  const idsValides = roleIds.filter(Boolean);
  if (idsValides.length === 0) {
    await interaction.reply({
      content: "❌ Aucun rôle autorisé n'est configuré dans .env pour cette commande.",
      ephemeral: true,
    });
    return false;
  }

  const possede = idsValides.some((id) => interaction.member.roles.cache.has(id));
  if (!possede) {
    await interaction.reply({
      content: `❌ Cette commande est réservée aux administrateurs ou à ${label}.`,
      ephemeral: true,
    });
    return false;
  }

  return true;
}

module.exports = {
  isAdmin,
  requireAdmin,
  requireStreamerRole,
  requireChannel,
  requireAnyChannel,
  requireAnyRole,
};
