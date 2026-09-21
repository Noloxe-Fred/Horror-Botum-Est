const fs = require('fs');
const path = require('path');

const MODULES_PATH = path.join(__dirname, '../modules');

function loadModules() {
  const folders = fs
    .readdirSync(MODULES_PATH)
    .filter((f) => fs.statSync(path.join(MODULES_PATH, f)).isDirectory());

  return folders.map((folder) => require(path.join(MODULES_PATH, folder)));
}

/**
 * Construit le registre à partir de tous les modules du dossier /modules.
 * Un module peut définir :
 *  - name (obligatoire)
 *  - commands: [{ data, execute }, ...]
 *  - buttons: [{ prefix, execute }, ...]  -> boutons persistants (voir eventHandler)
 *  - onMessage(message)  -> appelé uniquement si défini (pas de scan inutile)
 *  - init(client)        -> appelé une fois au démarrage
 *
 * `buttons` sert aux boutons dont le customId doit rester cliquable après un
 * redémarrage du bot (ex: "Je serai présent" sur une annonce postée il y a
 * plusieurs jours) — contrairement aux boutons éphémères des formulaires de
 * commande (/cine...), qui s'auto-gèrent via awaitMessageComponent()
 * et n'ont pas besoin de passer par ce registre. Convention de customId :
 * `<prefix>:<reste>` (ex: `cine_presence:movie:123:456`) — le préfixe avant
 * le premier `:` sert de clé de dispatch en O(1).
 *
 * `modals` fonctionne sur le même principe que `buttons`, mais pour les
 * soumissions de fenêtres modales (ModalBuilder) — nécessaire dès qu'une
 * commande a besoin d'un vrai champ de saisie libre (ex: la réponse texte
 * du quiz), ce qu'un simple bouton/select menu ne permet pas.
 */
function buildRegistry() {
  const modules = loadModules();

  const commands = new Map();
  const buttonHandlers = new Map();
  const modalHandlers = new Map();
  const messageListeners = [];
  const initializers = [];

  for (const mod of modules) {
    if (!mod.name) {
      console.warn('[REGISTRY] Un module sans "name" a été ignoré.');
      continue;
    }

    for (const command of mod.commands ?? []) {
      const commandName = command.data.name;
      if (commands.has(commandName)) {
        console.warn(
          `[REGISTRY] Commande dupliquée ignorée : /${commandName} (module "${mod.name}")`
        );
        continue;
      }
      commands.set(commandName, command);
    }

    for (const bouton of mod.buttons ?? []) {
      if (buttonHandlers.has(bouton.prefix)) {
        console.warn(
          `[REGISTRY] Préfixe de bouton dupliqué ignoré : "${bouton.prefix}" (module "${mod.name}")`
        );
        continue;
      }
      buttonHandlers.set(bouton.prefix, bouton.execute);
    }

    for (const modal of mod.modals ?? []) {
      if (modalHandlers.has(modal.prefix)) {
        console.warn(
          `[REGISTRY] Préfixe de modal dupliqué ignoré : "${modal.prefix}" (module "${mod.name}")`
        );
        continue;
      }
      modalHandlers.set(modal.prefix, modal.execute);
    }

    if (typeof mod.onMessage === 'function') {
      messageListeners.push({ name: mod.name, onMessage: mod.onMessage });
    }

    if (typeof mod.init === 'function') {
      initializers.push({ name: mod.name, init: mod.init });
    }
  }

  console.log(
    `[REGISTRY] ${modules.length} module(s) chargé(s) — ${commands.size} commande(s), ` +
      `${buttonHandlers.size} bouton(s) persistant(s), ${modalHandlers.size} modal(aux) persistant(s), ` +
      `${messageListeners.length} écouteur(s) de message.`
  );

  return { modules, commands, buttonHandlers, modalHandlers, messageListeners, initializers };
}

module.exports = { buildRegistry };
