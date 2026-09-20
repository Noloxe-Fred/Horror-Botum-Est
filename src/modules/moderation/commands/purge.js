const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireAdmin } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const config = require('../../../config');
const { findPurgeRole } = require('../service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Exclut tous les membres ayant encore le rôle "purge"')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireAdmin(interaction))) return;

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const role = findPurgeRole(guild);

    if (!role) {
      return interaction.editReply(
        '❌ Le rôle "purge" est introuvable (vérifie PURGE_ROLE_ID dans .env, ou utilise `/addpurge` d\'abord).'
      );
    }

    await guild.members.fetch();
    const membresAPurger = role.members;

    let dmEnvoyes = 0;
    let dmEchecs = 0;
    let expulsions = 0;
    let expulsionsEchecs = 0;

    for (const [, member] of membresAPurger) {
      // MP envoyé AVANT expulsion (impossible une fois hors serveur)
      try {
        await member.send(config.messages.purgeKick);
        dmEnvoyes++;
      } catch (error) {
        console.log(`[PURGE] Impossible d'envoyer un MP à ${member.user.tag} (DMs probablement fermés)`);
        dmEchecs++;
      }

      try {
        await member.kick('Purge des membres inactifs');
        expulsions++;
      } catch (error) {
        console.error(`[PURGE] Erreur lors de l'expulsion de ${member.user.tag}:`, error);
        expulsionsEchecs++;
      }
    }

    await interaction.editReply(
      `🔨 **Purge terminée**\n` +
        `👥 Membres expulsés : **${expulsions}**\n` +
        `✉️ MP envoyés avec succès : **${dmEnvoyes}** (échecs : ${dmEchecs})` +
        (expulsionsEchecs > 0 ? `\n⚠️ Échecs d'expulsion : ${expulsionsEchecs}` : '')
    );
  }, 'PURGE'),
};
