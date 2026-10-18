const {
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryItemBuilder,
  TextDisplayBuilder,
  SeparatorSpacingSize,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { XMLParser } = require('fast-xml-parser');
const store = require('./store');

const INTERVALLE_VERIFICATION_MS = 10 * 60 * 1000;
const TIMEOUT_HTTP_MS = 15 * 1000;
// En-têtes d'un navigateur classique : les pare-feu des hébergeurs (o2switch
// pour horreurnews.com) répondent 403 aux user-agents contenant "bot" ou
// trop incomplets, selon l'IP d'origine.
const EN_TETES_HTTP = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.7',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};
const COULEUR_CARTE = 0x8b0000;
const LONGUEUR_RESUME = 350;
// Une galerie Discord accepte 10 images au maximum ; 9 = grille 3x3. Avec
// l'image à la une, ça fait 10 pièces jointes : le maximum par message.
const MAX_IMAGES_GALERIE = 9;
// Limite d'envoi Discord : 10 Mo par message sur un serveur sans boost.
const MAX_OCTETS_PIECES_JOINTES = 9 * 1024 * 1024;
// Limite par image : une image plus lourde est ignorée sans être téléchargée
// en entier. Une image d'article fait en général 50 à 500 Ko.
const MAX_OCTETS_IMAGE = 5 * 1024 * 1024;
const EXTENSIONS_IMAGES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Le HTML échappé des flux Atom (&lt;p&gt;...) dépasse vite la limite par
  // défaut de 1000 entités standard. Les autres garde-fous du parseur
  // (taille et profondeur des entités DOCTYPE) restent actifs.
  processEntities: { maxTotalExpansions: 1_000_000 },
  // Les tags RSS sont parfois répétés (category, link Atom, media:content) :
  // on force ceux-là en tableau pour ne pas gérer objet OU tableau partout.
  isArray: (nom) => ['item', 'entry', 'category', 'link', 'media:content', 'media:thumbnail', 'enclosure'].includes(nom),
});

// --- Utilitaires texte -------------------------------------------------------

const ENTITES_NOMMEES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç',
};

/**
 * Les flux WordPress embarquent du HTML dans des CDATA : les entités HTML
 * (&#8217;, &rsquo;...) n'y sont pas décodées par le parseur XML.
 */
function decoderEntites(texte) {
  return texte
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, nom) => ENTITES_NOMMEES[nom.toLowerCase()] ?? m);
}

function texteDe(valeur) {
  if (valeur == null) return '';
  // `link` est forcé en tableau pour Atom (plusieurs liens par entrée) :
  // en RSS, c'est un tableau d'une seule chaîne.
  if (Array.isArray(valeur)) return texteDe(valeur[0]);
  if (typeof valeur === 'object') return String(valeur['#text'] ?? '');
  return String(valeur);
}

function htmlVersTexte(html) {
  return decoderEntites(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tronquer(texte, max) {
  if (texte.length <= max) return texte;
  const coupe = texte.slice(0, max);
  const dernierEspace = coupe.lastIndexOf(' ');
  return `${coupe.slice(0, dernierEspace > max * 0.6 ? dernierEspace : max).trimEnd()}…`;
}

// --- Récupération HTTP -------------------------------------------------------

const DELAI_REESSAI_MS = 5 * 1000;

/**
 * Message d'erreur lisible : en cas d'erreur réseau, fetch lève un simple
 * "fetch failed" et la vraie raison (DNS, délai de connexion, connexion
 * coupée, certificat...) n'est que dans `err.cause`.
 */
function messageErreur(err) {
  const cause = err?.cause;
  if (!cause) return err?.message ?? String(err);
  const detail = [cause.code, cause.message].filter(Boolean).join(' ');
  return `${err.message} (${detail || cause})`;
}

/**
 * fetch avec un nouvel essai après quelques secondes en cas d'erreur réseau
 * (connexion coupée, DNS momentanément indisponible...) — pas en cas de
 * réponse HTTP en erreur ni de délai dépassé.
 */
async function fetchAvecReessai(url, options) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_HTTP_MS) });
  } catch (err) {
    if (err.message !== 'fetch failed') throw err;
    await new Promise((resolve) => setTimeout(resolve, DELAI_REESSAI_MS));
    return fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_HTTP_MS) });
  }
}

async function telecharger(url) {
  const res = await fetchAvecReessai(url, {
    headers: EN_TETES_HTTP,
    redirect: 'follow',
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      `HTTP ${res.status} : le site refuse la connexion depuis l'hébergeur du bot (protection anti-robots du site)`
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.text();
}

/**
 * Télécharge une image. Retourne null si ce n'est pas un format que Discord
 * affiche (le content-type fait foi, l'extension de l'URL peut mentir).
 */
async function telechargerImage(url) {
  const res = await fetchAvecReessai(url, {
    headers: { ...EN_TETES_HTTP, Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  const extension = EXTENSIONS_IMAGES[(res.headers.get('content-type') || '').split(';')[0].trim()];
  if (!extension) {
    await res.body?.cancel();
    return null;
  }

  // Taille annoncée par le site : une image trop lourde n'est même pas
  // téléchargée.
  const tailleAnnoncee = Number(res.headers.get('content-length'));
  if (tailleAnnoncee > MAX_OCTETS_IMAGE) {
    await res.body?.cancel();
    throw new Error(`image trop lourde (${Math.round(tailleAnnoncee / 1024 / 1024)} Mo)`);
  }

  // Taille réelle, contrôlée pendant la lecture (l'en-tête peut manquer ou
  // mentir) : on coupe dès que la limite est dépassée.
  const morceaux = [];
  let octets = 0;
  for await (const morceau of res.body) {
    octets += morceau.length;
    if (octets > MAX_OCTETS_IMAGE) {
      await res.body.cancel().catch(() => {});
      throw new Error(`image trop lourde (plus de ${Math.round(MAX_OCTETS_IMAGE / 1024 / 1024)} Mo)`);
    }
    morceaux.push(morceau);
  }
  return { buffer: Buffer.concat(morceaux), extension };
}

// --- Lecture du flux (RSS 2.0 et Atom) ---------------------------------------

function normaliserItemRss(item) {
  const html = texteDe(item['content:encoded']) || texteDe(item.description);
  return {
    id: texteDe(item.guid) || texteDe(item.link),
    titre: decoderEntites(texteDe(item.title)),
    lien: texteDe(item.link),
    date: item.pubDate ? new Date(texteDe(item.pubDate)) : null,
    auteur: texteDe(item['dc:creator']) || texteDe(item.author),
    resume: texteDe(item.description),
    html,
    categories: (item.category || []).map(texteDe).filter(Boolean),
    imagesMedia: [
      ...(item['media:content'] || []).filter((m) => !m['@_medium'] || m['@_medium'] === 'image'),
      ...(item['media:thumbnail'] || []),
      ...(item.enclosure || []).filter((e) => (e['@_type'] || '').startsWith('image/')),
    ]
      .map((m) => m['@_url'])
      .filter(Boolean),
  };
}

function normaliserEntreeAtom(entry) {
  const liens = entry.link || [];
  const lien = liens.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') || liens[0];
  const html = texteDe(entry.content) || texteDe(entry.summary);
  return {
    id: texteDe(entry.id) || lien?.['@_href'] || '',
    titre: decoderEntites(texteDe(entry.title)),
    lien: lien?.['@_href'] || '',
    date: entry.published || entry.updated ? new Date(texteDe(entry.published || entry.updated)) : null,
    auteur: texteDe(entry.author?.name),
    resume: texteDe(entry.summary),
    html,
    categories: (entry.category || []).map((c) => c['@_term']).filter(Boolean),
    imagesMedia: [...(entry['media:content'] || []), ...(entry['media:thumbnail'] || [])]
      .map((m) => m['@_url'])
      .filter(Boolean),
  };
}

/**
 * Télécharge et parse un flux. Retourne { titre, lien, articles } avec les
 * articles triés du plus ancien au plus récent (ordre de publication).
 */
async function lireFlux(url) {
  const xml = parser.parse(await telecharger(url));

  let flux;
  if (xml.rss?.channel) {
    const channel = xml.rss.channel;
    flux = {
      titre: decoderEntites(texteDe(channel.title)),
      lien: texteDe(channel.link),
      icone: texteDe(channel.image?.url) || null,
      articles: (channel.item || []).map(normaliserItemRss),
    };
  } else if (xml.feed) {
    const lien = (xml.feed.link || []).find((l) => !l['@_rel'] || l['@_rel'] === 'alternate');
    flux = {
      titre: decoderEntites(texteDe(xml.feed.title)),
      lien: lien?.['@_href'] || url,
      icone: texteDe(xml.feed.icon) || null,
      articles: (xml.feed.entry || []).map(normaliserEntreeAtom),
    };
  } else {
    throw new Error("Ce lien ne ressemble pas à un flux RSS ou Atom.");
  }

  flux.articles = flux.articles
    .filter((a) => a.id)
    .sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  return flux;
}

// --- Images de l'article -----------------------------------------------------

function imagesDuHtml(html) {
  return [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => decoderEntites(m[1]));
}

async function imageOpenGraph(lien) {
  if (!lien) return null;
  try {
    const page = await telecharger(lien);
    const match =
      page.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i) ||
      page.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    return match ? decoderEntites(match[1]) : null;
  } catch (err) {
    console.warn(`[RSS] og:image introuvable pour ${lien} :`, messageErreur(err));
    return null;
  }
}

// Formats que Discord n'affiche pas : on passe au candidat suivant.
const FORMATS_NON_SUPPORTES = /\.(avif|svg|tiff?|bmp|heic)(\?|#|$)/i;

function imageAffichable(url) {
  return Boolean(url) && /^https?:\/\//i.test(url) && !FORMATS_NON_SUPPORTES.test(url);
}

// WordPress décline chaque image en plusieurs tailles (photo-1024x576.jpg,
// photo-scaled.jpg) : on compare sans ce suffixe pour ne pas afficher deux
// fois la même image.
function cleImage(url) {
  return url
    .split(/[?#]/)[0]
    .replace(/-(\d+x\d+|scaled)(?=\.\w+$)/, '');
}

/**
 * Image à la une + images du contenu pour la galerie.
 *
 * Beaucoup de flux (dont WordPress par défaut) n'exposent pas l'image à la
 * une : elle n'est présente que dans la balise og:image de la page de
 * l'article. Ordre de priorité : image déclarée dans le flux (media/
 * enclosure), og:image de la page, première <img> du contenu. La galerie
 * reprend les autres <img> du contenu, sans doublon.
 */
async function trouverImages(article) {
  const duContenu = imagesDuHtml(article.html).filter(imageAffichable);
  let une = article.imagesMedia.find(imageAffichable);
  if (!une) {
    const openGraph = await imageOpenGraph(article.lien);
    une = imageAffichable(openGraph) ? openGraph : duContenu[0] || null;
  }

  const dejaVues = new Set(une ? [cleImage(une)] : []);
  const galerie = [];
  for (const url of duContenu) {
    const cle = cleImage(url);
    if (dejaVues.has(cle)) continue;
    dejaVues.add(cle);
    galerie.push(url);
  }
  return { une, galerie };
}

/**
 * Les images sont envoyées en pièces jointes plutôt que par leur URL : sinon
 * c'est Discord qui va les chercher sur le site, et les protections
 * anti-robots (o2switch pour horreurnews.com) bloquent ses serveurs, d'où
 * des images qui ne s'affichent pas. Les images en échec ou hors budget
 * (limite de taille d'un message) sont simplement omises.
 *
 * Retourne les pièces jointes et, pour chaque URL retenue, sa référence
 * `attachment://...` à utiliser dans la carte.
 */
async function joindreImages(urls) {
  const resultats = await Promise.allSettled(urls.map(telechargerImage));
  const fichiers = [];
  const references = new Map();
  let octets = 0;

  resultats.forEach((resultat, index) => {
    if (resultat.status === 'rejected') {
      console.warn(`[RSS] Image non téléchargée (${urls[index]}) :`, messageErreur(resultat.reason));
      return;
    }
    const image = resultat.value;
    if (!image || octets + image.buffer.length > MAX_OCTETS_PIECES_JOINTES) return;
    octets += image.buffer.length;
    const nom = `image-${index + 1}.${image.extension}`;
    fichiers.push(new AttachmentBuilder(image.buffer, { name: nom }));
    references.set(urls[index], `attachment://${nom}`);
  });

  return { fichiers, references };
}

// --- Publication -------------------------------------------------------------

function resumeArticle(article) {
  const texte = htmlVersTexte(article.resume || article.html)
    // Pied de page ajouté par WordPress à chaque description.
    .replace(/L[’']article .+ est apparu en premier sur .+\.?$/s, '')
    .trim();
  return tronquer(texte, LONGUEUR_RESUME);
}

/**
 * Carte Components V2 d'un article : image à la une en pleine largeur, puis
 * résumé, puis les autres images de l'article en mosaïque de vignettes (une
 * galerie d'un seul élément s'affiche en grand, une galerie de plusieurs en
 * grille). Un embed classique ne permet qu'une seule grande image.
 */
async function construireMessage(flux, article) {
  const images = await trouverImages(article);
  const urlsGalerie = images.galerie.slice(0, MAX_IMAGES_GALERIE);
  const { fichiers, references } = await joindreImages([images.une, ...urlsGalerie].filter(Boolean));
  let une = images.une ? references.get(images.une) : null;
  const galerie = urlsGalerie.map((url) => references.get(url)).filter(Boolean);
  // Image à la une en échec : la première image de la galerie la remplace.
  if (!une && galerie.length > 0) une = galerie.shift();
  const reste = images.galerie.length - urlsGalerie.length;

  const container = new ContainerBuilder().setAccentColor(COULEUR_CARTE);

  // Les crochets casseraient le lien masqué [titre](url).
  const titre = tronquer(article.titre || 'Sans titre', 250).replace(/[[\]]/g, '');
  container.addTextDisplayComponents((t) =>
    t.setContent(`-# 📰 ${flux.titre || 'Flux RSS'}\n## ${article.lien ? `[${titre}](${article.lien})` : titre}`)
  );

  if (une) {
    container.addMediaGalleryComponents((g) => g.addItems((item) => item.setURL(une).setDescription(titre.slice(0, 100))));
  }

  const resume = resumeArticle(article);
  // Une galerie d'une seule image s'afficherait en pleine largeur, aussi
  // grande que l'image à la une : l'image unique passe en vignette à droite
  // du résumé.
  if (galerie.length === 1 && resume) {
    container.addSectionComponents((section) =>
      section
        .addTextDisplayComponents((t) => t.setContent(resume))
        .setThumbnailAccessory((vignette) => vignette.setURL(galerie[0]))
    );
  } else if (resume) {
    container.addTextDisplayComponents((t) => t.setContent(resume));
  }

  if (galerie.length > 1 || (galerie.length === 1 && !resume)) {
    container.addMediaGalleryComponents((g) => g.addItems(galerie.map((url) => new MediaGalleryItemBuilder().setURL(url))));
    if (reste > 0) {
      container.addTextDisplayComponents((t) =>
        t.setContent(`-# +${reste} autre${reste > 1 ? 's' : ''} image${reste > 1 ? 's' : ''} dans l'article`)
      );
    }
  }

  container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const date = article.date && !Number.isNaN(article.date.getTime()) ? `<t:${Math.floor(article.date.getTime() / 1000)}:f>` : null;
  const pied = [article.auteur, article.categories[0], date].filter(Boolean).join(' · ');
  if (pied) container.addTextDisplayComponents((t) => t.setContent(`-# ${pied}`));

  if (article.lien) {
    container.addActionRowComponents((row) =>
      row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Lire l'article").setURL(article.lien))
    );
  }

  return { container, fichiers };
}

async function publierArticle(client, abonnement, flux, article) {
  const salon = await client.channels.fetch(abonnement.channelId);
  const components = [];
  if (abonnement.roleId) components.push(new TextDisplayBuilder().setContent(`<@&${abonnement.roleId}>`));
  // Les images ne sont jamais écrites sur le disque : elles restent en
  // mémoire le temps de l'envoi, puis sont libérées avec ces variables.
  const { container, fichiers } = await construireMessage(flux, article);
  components.push(container);

  await salon.send({
    flags: MessageFlags.IsComponentsV2,
    components,
    files: fichiers,
    allowedMentions: { roles: abonnement.roleId ? [abonnement.roleId] : [] },
  });
}

/**
 * Publie les articles pas encore vus d'un abonnement, du plus ancien au plus
 * récent. Chaque article est marqué vu dès qu'il est publié, pour qu'une
 * erreur en cours de route ne provoque pas de doublon au tick suivant.
 */
async function verifierAbonnement(client, abonnement) {
  const flux = await lireFlux(abonnement.url);
  const vus = new Set(abonnement.vus || []);
  const nouveaux = flux.articles.filter((a) => !vus.has(a.id));

  for (const article of nouveaux) {
    await publierArticle(client, abonnement, flux, article);
    store.marquerVus(abonnement.id, [article.id], flux.articles.length);
  }
  return nouveaux.length;
}

async function verifierTout(client) {
  for (const abonnement of store.listerFlux()) {
    try {
      const publies = await verifierAbonnement(client, abonnement);
      if (publies > 0) console.log(`[RSS] ${publies} article(s) publié(s) depuis ${abonnement.url}`);
    } catch (err) {
      console.error(`[RSS] Vérification impossible pour ${abonnement.url} :`, messageErreur(err));
    }
  }
}

function demarrerScheduler(client) {
  let enCours = false;
  const tick = async () => {
    // Un tick lent (beaucoup d'articles, site qui rame) ne doit pas se
    // chevaucher avec le suivant, sinon double publication.
    if (enCours) return;
    enCours = true;
    try {
      await verifierTout(client);
    } finally {
      enCours = false;
    }
  };

  client.once('ready', tick);
  setInterval(tick, INTERVALLE_VERIFICATION_MS);
}

module.exports = { lireFlux, construireMessage, messageErreur, demarrerScheduler, INTERVALLE_VERIFICATION_MS };
