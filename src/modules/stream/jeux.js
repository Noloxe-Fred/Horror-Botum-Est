const steam = require('./steam');
const igdb = require('./igdb');

const MAX_OPTIONS_SELECT = 25; // limite Discord d'un select menu

function cleDoublon(jeu) {
  const titre = jeu.titre.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${titre}:${(jeu.dateSortie || '').slice(0, 4)}`;
}

/**
 * Recherche un jeu sur Steam (fiches en français), complétée par IGDB si
 * TWITCH_CLIENT_ID/SECRET sont configurés (fiches en anglais, mais jeux console
 * et anciens absents de Steam). Une source en panne ne bloque pas l'autre.
 *
 * IGDB est interrogé même si Steam répond : pour "Alan Wake 2", absent de
 * Steam, celui-ci renvoie des résultats sans rapport avec le jeu cherché.
 */
async function rechercherJeux(titre) {
  const sources = [steam.rechercher(titre)];
  if (igdb.estConfigure()) sources.push(igdb.rechercher(titre));

  const reponses = await Promise.allSettled(sources);
  const echecs = reponses.filter((r) => r.status === 'rejected');
  if (echecs.length === reponses.length) throw echecs[0].reason;
  for (const echec of echecs) console.error('[STREAM] Source de jeux indisponible :', echec.reason);

  const vus = new Set();
  return reponses
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((jeu) => {
      const cle = cleDoublon(jeu);
      if (vus.has(cle)) return false;
      vus.add(cle);
      return true;
    })
    .slice(0, MAX_OPTIONS_SELECT);
}

module.exports = { rechercherJeux };
