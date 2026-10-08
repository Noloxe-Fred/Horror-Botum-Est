// Rappel hebdomadaire du programme : chaque dimanche à 18h (heure de Paris,
// TZ forcé par config), poste dans CINE_CLUB_CHANNEL_DISCUTE_ID ("la-discute")
// le programme en image avec mention du rôle Séances Ciné, suivi d'une ligne
// de texte. Message Components V2 : mention, galerie d'images, texte — seul
// moyen d'avoir le texte SOUS les images dans un même message.
//
// Tick par minute ; la date du dernier envoi est persistée pour n'envoyer
// qu'une fois par dimanche, même après un restart. Bot éteint à 18h : le
// rappel part au redémarrage s'il a lieu avant minuit le même dimanche.
// Rien n'est posté (ni personne mentionné) si aucune séance n'est à venir.

const {
  AttachmentBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
} = require('discord.js');
const config = require('../../../config');
const store = require('../store');
const { genererImagesProgramme } = require('./service');

const INTERVALLE_MS = 60 * 1000;
const JOUR = 0; // dimanche
const HEURE = 18;
const TEXTE = 'Le programme de la semaine sur HHE.';
// Limite Discord d'une galerie.
const MAX_IMAGES = 10;

function dateDuJour(maintenant) {
  const deuxChiffres = (n) => String(n).padStart(2, '0');
  return `${maintenant.getFullYear()}-${deuxChiffres(maintenant.getMonth() + 1)}-${deuxChiffres(maintenant.getDate())}`;
}

async function envoyerRappelHebdo(client) {
  const { annonces, buffers } = await genererImagesProgramme();
  if (annonces.length === 0) {
    console.log('[SEANCES-CINE][RAPPEL-HEBDO] Aucune séance à venir, pas de rappel cette semaine.');
    return;
  }

  const fichiers = buffers
    .slice(0, MAX_IMAGES)
    .map((buf, i) => new AttachmentBuilder(buf, { name: `programme-seances-cine-${i + 1}.png` }));
  const galerie = new MediaGalleryBuilder().addItems(
    fichiers.map((f) => new MediaGalleryItemBuilder().setURL(`attachment://${f.name}`))
  );

  const roleId = config.cineClub.roles.seancesCine;
  const components = [];
  if (roleId) components.push(new TextDisplayBuilder().setContent(`<@&${roleId}>`));
  components.push(galerie, new TextDisplayBuilder().setContent(TEXTE));

  const channel = await client.channels.fetch(config.cineClub.channelDiscuteId);
  await channel.send({ flags: MessageFlags.IsComponentsV2, components, files: fichiers });
}

/**
 * À appeler une seule fois au démarrage (init du module). Inactif si
 * CINE_CLUB_CHANNEL_DISCUTE_ID n'est pas configuré.
 */
function demarrerSchedulerRappelHebdo(client) {
  if (!config.cineClub.channelDiscuteId) return;

  let enCours = false;
  setInterval(async () => {
    const maintenant = new Date();
    if (enCours || maintenant.getDay() !== JOUR || maintenant.getHours() < HEURE) return;
    const date = dateDuJour(maintenant);
    if (store.getDernierRappelHebdo() === date) return;

    enCours = true;
    try {
      await envoyerRappelHebdo(client);
    } catch (err) {
      console.error('[SEANCES-CINE][RAPPEL-HEBDO] Rappel du programme impossible :', err);
    } finally {
      // Marqué envoyé même en cas d'erreur : pas de mention en boucle
      // toutes les minutes si Discord refuse le message.
      store.setDernierRappelHebdo(date);
      enCours = false;
    }
  }, INTERVALLE_MS);
}

module.exports = { demarrerSchedulerRappelHebdo };
