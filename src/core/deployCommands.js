const { REST, Routes } = require('discord.js');
const config = require('../config');
const { buildRegistry } = require('./commandRegistry');

async function deployCommands() {
  const { commands } = buildRegistry();
  const body = [...commands.values()].map((c) => c.data.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);

  const route =
    config.commandScope === 'global'
      ? Routes.applicationCommands(config.clientId)
      : Routes.applicationGuildCommands(config.clientId, config.guildId);

  try {
    console.log(
      `[DEPLOY] Déploiement de ${body.length} commande(s) — scope: ${config.commandScope}...`
    );
    await rest.put(route, { body });
    console.log('[DEPLOY] Commandes enregistrées ✅');
  } catch (error) {
    console.error('[DEPLOY] Erreur lors du déploiement des commandes :', error);
  }
}

module.exports = deployCommands;
