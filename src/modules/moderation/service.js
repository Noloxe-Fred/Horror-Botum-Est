const { PermissionFlagsBits } = require('discord.js');
const config = require('../../config');

/**
 * Détermine si un membre doit être épargné par la purge
 * (bot, admin, ou détenteur du rôle admin configuré).
 */
function estExclu(member) {
  if (member.user.bot) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (config.roles.adminId && member.roles.cache.has(config.roles.adminId)) return true;
  return false;
}

/**
 * Récupère le rôle "purge" via son ID configuré. Le crée s'il n'existe
 * pas encore ET si aucun ID n'a été configuré (fallback pratique pour
 * un premier lancement sans config).
 */
async function getOrCreatePurgeRole(guild) {
  if (config.roles.purgeId) {
    const role = guild.roles.cache.get(config.roles.purgeId);
    if (role) return role;
    console.warn(
      `[MODERATION] PURGE_ROLE_ID configuré (${config.roles.purgeId}) mais introuvable sur ce serveur.`
    );
  }

  // Pas d'ID configuré (ou introuvable) : on crée un rôle "purge" par défaut.
  const created = await guild.roles.create({
    name: 'purge',
    color: 'Red',
    reason: 'Création du rôle pour la purge des membres inactifs',
  });
  console.log(`[MODERATION] Rôle "purge" créé sur le serveur ${guild.name} (${created.id}).`);
  console.log(`[MODERATION] 💡 Pense à ajouter PURGE_ROLE_ID=${created.id} dans ton .env.`);

  return created;
}

/**
 * Récupère le rôle "purge" existant, sans le créer.
 */
function findPurgeRole(guild) {
  if (!config.roles.purgeId) return null;
  return guild.roles.cache.get(config.roles.purgeId) ?? null;
}

module.exports = { estExclu, getOrCreatePurgeRole, findPurgeRole };
