// Programme des Séances Ciné en image : liste toutes les séances annoncées
// (cine-club-annonces) pas encore commencées, rendue en PNG (render.js) et
// affichée dans CINE_CLUB_CHANNEL_PROGRAMME_ID — un message par image,
// édités sur place à chaque changement plutôt que reposter.
//
// Mise à jour automatique : un tick par minute compare la liste des séances
// à venir avec celle de la dernière publication (signature) et régénère si
// elle a changé — nouvelle séance annoncée (n'importe quelle branche de
// /cine) ou séance commencée. Inactif tant que /programme-cine n'a pas été
// lancée une première fois.

const { AttachmentBuilder } = require('discord.js');
const config = require('../../../config');
const store = require('../store');
const { rendreProgramme } = require('./render');

const INTERVALLE_MS = 60 * 1000;
const TIMEOUT_AFFICHE_MS = 10 * 1000;
// Discord réduit les images dans le salon : petite ligne sous la dernière
// image pour inviter à cliquer (message à part, toujours le dernier).
const TEXTE_AGRANDIR = "-# 🔍 Cliquez sur une image pour l'agrandir";

// File d'attente : le tick et /programme-cine ne doivent jamais publier en
// même temps (sinon messages en double).
let file = Promise.resolve();
function enFile(tache) {
  const resultat = file.then(tache);
  file = resultat.catch(() => {});
  return resultat;
}

function signature(annonces) {
  return annonces.map((a) => a.sessionKey).join('|');
}

async function telechargerAffiche(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_AFFICHE_MS) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error(`[SEANCES-CINE][PROGRAMME] Affiche inaccessible (${url}) :`, err.message);
    return null;
  }
}

function partiesDate(date) {
  const format = (options) =>
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...options }).format(date);
  const jour = format({ weekday: 'long' });
  return {
    jour: jour.charAt(0).toUpperCase() + jour.slice(1),
    numero: format({ day: 'numeric' }),
    mois: format({ month: 'long' }),
    heure: format({ hour: '2-digit', minute: '2-digit' }).replace(':', 'h'),
  };
}

async function preparerSeances(annonces) {
  return Promise.all(
    annonces.map(async (a) => ({
      titre: a.fiche.titre,
      type: a.mediaType === 'tv' ? 'Série' : 'Film',
      annee: a.fiche.dateSortie ? a.fiche.dateSortie.slice(0, 4) : null,
      synopsis: a.fiche.overview || '',
      ...partiesDate(new Date(a.dateSeance)),
      afficheBuffer: await telechargerAffiche(a.fiche.posterUrl),
    }))
  );
}

async function supprimerMessages(client, channelId, ids) {
  if (!channelId || ids.length === 0) return;
  try {
    const channel = await client.channels.fetch(channelId);
    for (const id of ids) {
      await channel.messages.delete(id).catch(() => {});
    }
  } catch {
    // Salon supprimé ou inaccessible : rien à nettoyer.
  }
}

function piecesJointes(buffers) {
  return buffers.map((buf, i) => new AttachmentBuilder(buf, { name: `programme-seances-cine-${i + 1}.png` }));
}

/**
 * Édite les messages existants dans l'ordre, poste ceux qui manquent,
 * supprime ceux en trop. Lève une erreur si un message existant n'est plus
 * éditable (supprimé à la main...) — l'appelant repart alors de zéro.
 */
async function mettreAJourMessages(channel, anciensIds, fichiers) {
  const ids = [];
  for (let i = 0; i < fichiers.length; i++) {
    if (anciensIds[i]) {
      const message = await channel.messages.fetch(anciensIds[i]);
      await message.edit({ files: [fichiers[i]], attachments: [] });
      ids.push(message.id);
    } else {
      const message = await channel.send({ files: [fichiers[i]] });
      ids.push(message.id);
    }
  }
  for (const id of anciensIds.slice(fichiers.length)) {
    await channel.messages.delete(id).catch(() => {});
  }
  return ids;
}

/**
 * Régénère et publie le programme. `forcer` : supprime les anciennes images
 * et reposte tout (utilisé par /programme-cine). Renvoie
 * { seances, images }.
 */
function publierProgramme(client, { forcer = false } = {}) {
  return enFile(async () => {
    const channelId = config.cineClub.channelProgrammeId;
    if (!channelId) throw new Error("CINE_CLUB_CHANNEL_PROGRAMME_ID n'est pas défini dans .env.");
    const channel = await client.channels.fetch(channelId);

    const annonces = store.listAnnoncesAVenir();
    const buffers = await rendreProgramme(await preparerSeances(annonces));

    const etat = store.getProgramme();
    let anciensIds = etat.messageIds || [];
    let texteId = etat.texteId || null;
    if (forcer || etat.channelId !== channelId) {
      await supprimerMessages(client, etat.channelId, [...anciensIds, texteId].filter(Boolean));
      anciensIds = [];
      texteId = null;
    }

    let messageIds;
    try {
      messageIds = await mettreAJourMessages(channel, anciensIds, piecesJointes(buffers));
    } catch (err) {
      console.warn('[SEANCES-CINE][PROGRAMME] Messages existants non éditables, republication complète :', err.message);
      await supprimerMessages(client, channelId, anciensIds);
      messageIds = await mettreAJourMessages(channel, [], piecesJointes(buffers));
    }

    // La ligne "Cliquez pour agrandir" doit rester sous la dernière image :
    // repostée si une image a été ajoutée après elle ou si elle a disparu.
    const imageAjoutee = messageIds.some((id) => !anciensIds.includes(id));
    const texteExiste = texteId && (await channel.messages.fetch(texteId).then(() => true, () => false));
    if (imageAjoutee || !texteExiste) {
      if (texteId) await channel.messages.delete(texteId).catch(() => {});
      texteId = (await channel.send({ content: TEXTE_AGRANDIR })).id;
    }

    store.setProgramme({ channelId, messageIds, texteId, signature: signature(annonces) });
    return { seances: annonces.length, images: buffers.length };
  });
}

/**
 * Tick par minute : republie si la liste des séances à venir a changé
 * depuis la dernière publication. À appeler une seule fois au démarrage.
 */
function demarrerSchedulerProgramme(client) {
  setInterval(async () => {
    const etat = store.getProgramme();
    if (!etat.messageIds || etat.messageIds.length === 0) return; // jamais lancé
    if (signature(store.listAnnoncesAVenir()) === etat.signature) return;

    try {
      await publierProgramme(client);
    } catch (err) {
      console.error('[SEANCES-CINE][PROGRAMME] Mise à jour du programme impossible :', err);
    }
  }, INTERVALLE_MS);
}

module.exports = { publierProgramme, demarrerSchedulerProgramme };
