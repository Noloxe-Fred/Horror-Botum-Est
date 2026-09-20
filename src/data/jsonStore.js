const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data-store');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(namespace) {
  return path.join(DATA_DIR, `${namespace}.json`);
}

/**
 * Lit un namespace de données. Retourne `fallback` si le fichier
 * n'existe pas encore ou est corrompu.
 */
function read(namespace, fallback = {}) {
  ensureDir();
  const file = filePath(namespace);
  if (!fs.existsSync(file)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`[STORE] Fichier "${namespace}.json" illisible, valeur par défaut utilisée :`, err);
    return fallback;
  }
}

/**
 * Écrit un namespace de données de façon atomique (écrit dans un .tmp
 * puis renomme), pour éviter un fichier corrompu si le process crash
 * en pleine écriture.
 */
function write(namespace, data) {
  ensureDir();
  const file = filePath(namespace);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

module.exports = { read, write };
