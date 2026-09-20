const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireAdmin } = require('../../../core/permissions');
const withErrorHandling = require('../../../core/withErrorHandling');
const { estExclu, getOrCreatePurgeRole } = require('../service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addpurge')
    .setDescription('Ajoute le rôle "purge" à tous les membres (sauf admins et bots)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  execute: withErrorHandling(async (interaction) => {
    if (!(await requireAdmin(interaction))) return;

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const role = await getOrCreatePurgeRole(guild);
    const members = await guild.members.fetch();

    const totalMembres = members.size;
    let exclus = 0;
    let count = 0;
    let erreurs = 0;
    const membresEnErreur = [];

    for (const [, member] of members) {
      if (estExclu(member)) {
        exclus++;
        continue;
      }

      try {
        await member.roles.add(role);
        count++;
      } catch (error) {
        console.error(`[ADDPURGE] Erreur ajout rôle à ${member.user.tag}:`, error);
        erreurs++;
        membresEnErreur.push(member.user.tag);
      }
    }

    let message =
      `✅ **Rôle "${role.name}" attribué**\n\n` +
      `👥 Membres du serveur : **${totalMembres}**\n` +
      `🛡️ Exclus (admins/bots) : **${exclus}**\n` +
      `✔️ Rôle ajouté avec succès : **${count}**\n` +
      `❌ Erreurs : **${erreurs}**`;

    if (erreurs > 0) {
      const liste = membresEnErreur.slice(0, 15).join(', ');
      message += `\n\n⚠️ Membres en erreur : ${liste}`;
      if (membresEnErreur.length > 15) {
        message += ` (+${membresEnErreur.length - 15} autre(s))`;
      }
    }

    await interaction.editReply(message);
  }, 'ADDPURGE'),
};
