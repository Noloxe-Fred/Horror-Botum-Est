// Rendu PNG du programme des Séances Ciné (style "Grindhouse 70s") via
// @napi-rs/canvas. Pur dessin : reçoit une liste de séances déjà préparées
// (titre, type, année, synopsis, date, buffer d'affiche) et renvoie un
// Buffer PNG par image. Aucune dépendance à Discord ni au store.

const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const FONTS_DIR = path.join(__dirname, 'fonts');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Anton-Regular.ttf'), 'Anton');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Creepster-Regular.ttf'), 'Creepster');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'SpecialElite-Regular.ttf'), 'Special Elite');

const COULEURS = {
  fondCentre: '#2a1d16',
  fond: '#15100d',
  fondBord: '#0a0706',
  creme: '#e9dcc0',
  cremeClair: '#f3e8d0',
  moutarde: '#e0a526',
  sang: '#b3121b',
  synopsis: '#cbbd9f',
  annee: '#a8987c',
  pointilles: '#4a3a2e',
  noir: '#000000',
};

const LARGEUR = 1200;
const MARGE = 64;
const BANDE_H = 22; // bandes perforées façon pellicule (haut et bas)

// Colonnes d'une ligne séance : affiche | texte | ticket
const COL_AFFICHE = 196;
const COL_TICKET = 190;
const GOUTTIERE = 36;
const COL_TEXTE = LARGEUR - 2 * MARGE - COL_AFFICHE - COL_TICKET - 2 * GOUTTIERE;

const AFFICHE_W = 180;
const AFFICHE_H = 270;
const AFFICHE_CADRE = 8;
const LIGNE_H = AFFICHE_H + 2 * AFFICHE_CADRE; // 286
const LIGNE_PAD_BAS = 26;
const LIGNE_ECART = 26;

const ENTETE_H = 330;
const PIED_H = 96; // phrase d'accroche + marge, avant la bande du bas

const SEANCES_PREMIERE_IMAGE = 4;
const SEANCES_IMAGES_SUIVANTES = 5;

// --- Helpers texte ------------------------------------------------------

/**
 * Dessine un texte avec un espacement entre lettres, caractère par
 * caractère (indépendant du support de ctx.letterSpacing). `align` :
 * 'left' | 'center'. Renvoie la largeur totale.
 */
function texteEspace(ctx, texte, x, y, espacement, align = 'left') {
  const chars = [...texte];
  const largeurs = chars.map((c) => ctx.measureText(c).width);
  const total = largeurs.reduce((a, b) => a + b, 0) + espacement * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : x;
  const alignAvant = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += largeurs[i] + espacement;
  });
  ctx.textAlign = alignAvant;
  return total;
}

/**
 * Découpe un texte en lignes tenant dans `maxLargeur`, au plus `maxLignes`
 * — la dernière ligne est tronquée avec "…" si le texte déborde.
 */
function decouperLignes(ctx, texte, maxLargeur, maxLignes) {
  // Espace insécable devant la ponctuation haute française, pour ne jamais
  // commencer une ligne par ":" ou "?".
  const mots = texte.replace(/\s+/g, ' ').trim().replace(/ ([:;!?»])/g, ' $1').split(' ');
  const lignes = [];
  let courante = '';

  for (let i = 0; i < mots.length; i++) {
    const essai = courante ? `${courante} ${mots[i]}` : mots[i];
    if (ctx.measureText(essai).width <= maxLargeur) {
      courante = essai;
      continue;
    }
    if (courante) lignes.push(courante);
    courante = mots[i];
    if (lignes.length === maxLignes) {
      courante = null;
      break;
    }
  }
  if (courante) lignes.push(courante);

  const deborde = lignes.length > maxLignes || courante === null;
  const resultat = lignes.slice(0, maxLignes);
  if (deborde) {
    let derniere = resultat[maxLignes - 1];
    while (derniere.length && ctx.measureText(`${derniere}…`).width > maxLargeur) {
      derniere = derniere.replace(/\s*\S+$/, '');
    }
    resultat[maxLignes - 1] = `${derniere.replace(/[\s.,;:!?…-]+$/, '')}…`;
  }
  return resultat;
}

// --- Éléments de décor -------------------------------------------------

function dessinerFond(ctx, hauteur) {
  ctx.fillStyle = COULEURS.fondBord;
  ctx.fillRect(0, 0, LARGEUR, hauteur);

  // Vignette elliptique : un dégradé radial étiré verticalement.
  const cy = Math.min(hauteur * 0.3, 500);
  ctx.save();
  ctx.translate(LARGEUR / 2, cy);
  ctx.scale(1, 1.4);
  const rayon = Math.max(LARGEUR, hauteur) * 0.75;
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rayon);
  grad.addColorStop(0, COULEURS.fondCentre);
  grad.addColorStop(0.55, COULEURS.fond);
  grad.addColorStop(1, COULEURS.fondBord);
  ctx.fillStyle = grad;
  ctx.fillRect(-LARGEUR, -hauteur * 2, LARGEUR * 2, hauteur * 4);
  ctx.restore();
}

function dessinerBandePerforee(ctx, y) {
  ctx.fillStyle = COULEURS.fondBord;
  ctx.fillRect(0, y, LARGEUR, BANDE_H);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = COULEURS.creme;
  for (let x = 22; x < LARGEUR; x += 36) ctx.fillRect(x, y, 14, BANDE_H);
  ctx.globalAlpha = 1;
}

function dessinerEntete(ctx) {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  ctx.font = '22px "Special Elite"';
  ctx.fillStyle = COULEURS.moutarde;
  texteEspace(ctx, 'HORROR HUMANUM EST PRÉSENTE', LARGEUR / 2, BANDE_H + 44 + 22, 6, 'center');

  // Titre dégoulinant + ombre portée dure
  ctx.font = '150px Creepster';
  const yTitre = BANDE_H + 44 + 22 + 10 + 140;
  ctx.fillStyle = COULEURS.noir;
  texteEspace(ctx, 'SÉANCES CINÉ', LARGEUR / 2 + 6, yTitre + 6, 4, 'center');
  ctx.fillStyle = COULEURS.sang;
  texteEspace(ctx, 'SÉANCES CINÉ', LARGEUR / 2, yTitre, 4, 'center');

  // "AU PROGRAMME" encadré de deux filets moutarde
  ctx.font = '30px Anton';
  ctx.fillStyle = COULEURS.creme;
  const yProg = yTitre + 62;
  const largeurProg = texteEspace(ctx, 'AU PROGRAMME', LARGEUR / 2, yProg, 8, 'center');
  ctx.fillStyle = COULEURS.moutarde;
  const yFilet = yProg - 13;
  ctx.fillRect(LARGEUR / 2 - largeurProg / 2 - 18 - 120, yFilet, 120, 3);
  ctx.fillRect(LARGEUR / 2 + largeurProg / 2 + 18, yFilet, 120, 3);
}

function dessinerPied(ctx, y) {
  ctx.font = '22px "Special Elite"';
  ctx.fillStyle = COULEURS.moutarde;
  ctx.textBaseline = 'alphabetic';
  texteEspace(ctx, "ENTRÉE LIBRE — SI VOUS L'OSEZ", LARGEUR / 2, y, 4, 'center');
}

// --- Ligne séance --------------------------------------------------------

function dessinerAffiche(ctx, image, x, y, inclinaison) {
  const w = AFFICHE_W + 2 * AFFICHE_CADRE;
  const h = AFFICHE_H + 2 * AFFICHE_CADRE;

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(inclinaison);
  ctx.translate(-w / 2, -h / 2);

  ctx.fillStyle = COULEURS.noir;
  ctx.fillRect(8, 10, w, h);
  ctx.fillStyle = COULEURS.creme;
  ctx.fillRect(0, 0, w, h);

  if (image) {
    // object-fit: cover
    const ratio = Math.max(AFFICHE_W / image.width, AFFICHE_H / image.height);
    const sw = AFFICHE_W / ratio;
    const sh = AFFICHE_H / ratio;
    const sx = (image.width - sw) / 2;
    const sy = (image.height - sh) / 2;
    ctx.drawImage(image, sx, sy, sw, sh, AFFICHE_CADRE, AFFICHE_CADRE, AFFICHE_W, AFFICHE_H);
  } else {
    ctx.fillStyle = COULEURS.fond;
    ctx.fillRect(AFFICHE_CADRE, AFFICHE_CADRE, AFFICHE_W, AFFICHE_H);
    ctx.font = '26px Anton';
    ctx.fillStyle = COULEURS.annee;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PAS D’AFFICHE', w / 2, h / 2);
  }
  ctx.restore();
}

function dessinerTexte(ctx, seance, x, y) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Étiquette Film/Série + année
  ctx.font = '18px Anton';
  const libelle = seance.type.toUpperCase();
  const espacement = 3;
  const largeurLibelle =
    [...libelle].reduce((a, c) => a + ctx.measureText(c).width, 0) + espacement * (libelle.length - 1);
  ctx.fillStyle = COULEURS.moutarde;
  ctx.fillRect(x, y, largeurLibelle + 24, 32);
  ctx.fillStyle = COULEURS.fond;
  texteEspace(ctx, libelle, x + 12, y + 24, espacement);

  if (seance.annee) {
    ctx.font = '18px "Special Elite"';
    ctx.fillStyle = COULEURS.annee;
    ctx.fillText(seance.annee, x + largeurLibelle + 24 + 12, y + 23);
  }

  // Titre : 52px sur 2 lignes max, réduit si un mot seul ne tient pas
  let taille = 52;
  let lignesTitre;
  for (; taille >= 34; taille -= 4) {
    ctx.font = `${taille}px Anton`;
    lignesTitre = decouperLignes(ctx, seance.titre.toUpperCase(), COL_TEXTE, 2);
    const tousTiennent = lignesTitre.every((l) => ctx.measureText(l).width <= COL_TEXTE);
    if (tousTiennent && !lignesTitre[lignesTitre.length - 1].endsWith('…')) break;
  }
  ctx.fillStyle = COULEURS.cremeClair;
  const interTitre = Math.round(taille * 1.05);
  let cy = y + 32 + 10 + taille;
  for (const ligne of lignesTitre) {
    ctx.fillText(ligne, x, cy);
    cy += interTitre;
  }

  // Synopsis : 18px, interligne 27, autant de lignes que la place restante
  // le permet (4 max), tronqué avec "…"
  ctx.font = '18px "Special Elite"';
  ctx.fillStyle = COULEURS.synopsis;
  const debutSynopsis = cy - interTitre + 14;
  const placeRestante = y + LIGNE_H - debutSynopsis;
  const maxLignes = Math.max(1, Math.min(4, Math.floor(placeRestante / 27)));
  const lignes = decouperLignes(ctx, seance.synopsis, COL_TEXTE, maxLignes);
  let sy = debutSynopsis + 20;
  for (const ligne of lignes) {
    ctx.fillText(ligne, x, sy);
    sy += 27;
  }
}

function dessinerTicket(ctx, seance, x, yLigne) {
  const w = COL_TICKET;
  const h = 236;
  const y = yLigne + (LIGNE_H - h) / 2;
  const cx = x + w / 2;

  ctx.fillStyle = COULEURS.noir;
  ctx.fillRect(x + 6, y + 8, w, h);
  ctx.fillStyle = COULEURS.creme;
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.strokeStyle = COULEURS.fond;
  ctx.lineWidth = 3;
  ctx.setLineDash([9, 6]);
  ctx.strokeRect(x + 8.5, y + 8.5, w - 17, h - 17);
  ctx.restore();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COULEURS.fond;
  ctx.font = '22px Anton';
  texteEspace(ctx, seance.jour.toUpperCase(), cx, y + 46, 4, 'center');

  ctx.font = '68px Anton';
  ctx.textAlign = 'center';
  ctx.fillText(seance.numero, cx, y + 118);

  ctx.font = '20px "Special Elite"';
  texteEspace(ctx, seance.mois.toUpperCase(), cx, y + 148, 2, 'center');

  // Heure en blanc sur pavé rouge
  ctx.font = '34px Anton';
  const lh = ctx.measureText(seance.heure).width + 28;
  ctx.fillStyle = COULEURS.sang;
  ctx.fillRect(cx - lh / 2, y + 162, lh, 48);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(seance.heure, cx, y + 200);
  ctx.textAlign = 'left';
}

function dessinerLigne(ctx, seance, image, y, index, derniere) {
  const inclinaison = ((index % 2 === 0 ? -2.5 : 2) * Math.PI) / 180;
  dessinerAffiche(ctx, image, MARGE + (COL_AFFICHE - AFFICHE_W - 2 * AFFICHE_CADRE) / 2, y, inclinaison);
  dessinerTexte(ctx, seance, MARGE + COL_AFFICHE + GOUTTIERE, y + 6);
  dessinerTicket(ctx, seance, LARGEUR - MARGE - COL_TICKET, y);

  if (!derniere) {
    ctx.save();
    ctx.strokeStyle = COULEURS.pointilles;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    const yl = y + LIGNE_H + LIGNE_PAD_BAS;
    ctx.moveTo(MARGE, yl);
    ctx.lineTo(LARGEUR - MARGE, yl);
    ctx.stroke();
    ctx.restore();
  }
}

// --- Images complètes ---------------------------------------------------

/**
 * Découpe la liste en pages : 4 séances sur la première image (sous
 * l'en-tête), 5 sur chaque image suivante (sans en-tête).
 */
function paginer(seances) {
  const pages = [seances.slice(0, SEANCES_PREMIERE_IMAGE)];
  for (let i = SEANCES_PREMIERE_IMAGE; i < seances.length; i += SEANCES_IMAGES_SUIVANTES) {
    pages.push(seances.slice(i, i + SEANCES_IMAGES_SUIVANTES));
  }
  return pages;
}

async function chargerImage(buffer) {
  if (!buffer) return null;
  try {
    return await loadImage(buffer);
  } catch {
    return null;
  }
}

async function rendrePage(seances, { premiere, derniere }) {
  const pasLigne = LIGNE_H + LIGNE_PAD_BAS + LIGNE_ECART;
  const hautContenu = premiere ? ENTETE_H : BANDE_H + 44;
  const hauteurLignes = seances.length
    ? seances.length * pasLigne - LIGNE_ECART - LIGNE_PAD_BAS
    : 120; // message "aucune séance"
  const hauteur = hautContenu + 12 + hauteurLignes + (derniere ? PIED_H : 44) + BANDE_H;

  const canvas = createCanvas(LARGEUR, hauteur);
  const ctx = canvas.getContext('2d');

  dessinerFond(ctx, hauteur);
  dessinerBandePerforee(ctx, 0);
  dessinerBandePerforee(ctx, hauteur - BANDE_H);
  if (premiere) dessinerEntete(ctx);

  let y = hautContenu + 12;
  if (seances.length === 0) {
    ctx.font = '30px "Special Elite"';
    ctx.fillStyle = COULEURS.creme;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Aucune séance au programme… pour l’instant.', LARGEUR / 2, y + 60);
  }

  const images = await Promise.all(seances.map((s) => chargerImage(s.afficheBuffer)));
  seances.forEach((seance, i) => {
    dessinerLigne(ctx, seance, images[i], y, i, i === seances.length - 1);
    y += pasLigne;
  });

  if (derniere) dessinerPied(ctx, hauteur - BANDE_H - 40);

  return canvas.encode('png');
}

/**
 * Rend le programme complet : un Buffer PNG par image. Toujours au moins
 * une image (en-tête + message "aucune séance" si la liste est vide).
 *
 * Chaque séance : { titre, type, annee, synopsis, jour, numero, mois,
 * heure, afficheBuffer }.
 */
async function rendreProgramme(seances) {
  const pages = paginer(seances);
  return Promise.all(
    pages.map((page, i) => rendrePage(page, { premiere: i === 0, derniere: i === pages.length - 1 }))
  );
}

module.exports = { rendreProgramme };
