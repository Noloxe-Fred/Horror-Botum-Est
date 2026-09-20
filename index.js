const config = require('./src/config');
const createClient = require('./src/client');
const deployCommands = require('./src/core/deployCommands');
const attachEventHandlers = require('./src/core/eventHandler');

const client = createClient();

(async () => {
  await deployCommands();
  attachEventHandlers(client);

  client.once('ready', () => {
    console.log(`Connecté en tant que ${client.user.tag}`);
  });

  await client.login(config.token);
})();
