const jsonStore = require('../../data/jsonStore');

const NS_PROFILS = 'letterboxd-profils';

/**
 * Structure : { scannedAt, channelId, profils: { [userId]: { userId,
 * displayName, url, label, messageUrl } } }
 */
function getData() {
  return jsonStore.read(NS_PROFILS, { scannedAt: null, channelId: null, profils: {} });
}

/** Remplace entièrement l'annuaire (un scan = photo complète du salon). */
function replaceProfils(profils, { channelId }) {
  const data = { scannedAt: new Date().toISOString(), channelId, profils };
  jsonStore.write(NS_PROFILS, data);
  return data;
}

/** Supprime des profils de l'annuaire. Retourne les profils supprimés. */
function removeProfils(userIds) {
  const data = getData();
  const supprimes = [];
  for (const userId of userIds) {
    if (data.profils[userId]) {
      supprimes.push(data.profils[userId]);
      delete data.profils[userId];
    }
  }
  jsonStore.write(NS_PROFILS, data);
  return supprimes;
}

module.exports = { getData, replaceProfils, removeProfils };
