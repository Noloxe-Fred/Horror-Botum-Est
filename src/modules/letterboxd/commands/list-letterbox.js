const { SlashCommandBuilder, EmbedBuilder, escapeMarkdown } = require('discord.js');
const withErrorHandling = require('../../../core/withErrorHandling');
const store = require('../store');

const COULEUR_LETTERBOXD = 0xff8000;
// Marge sous la limite de 4096 caractères d'une description d'embed.
const TAILLE_MAX_PAGE = 3900;

/** Découpe les lignes en pages dont la longueur tient dans un embed. */
function paginer(lignes) {
  const pages = [];
  let courante = '';
  for (const ligne of lignes) {
    if (courante && courante.length + ligne.length + 1 > TAILLE_MAX_PAGE) {
      pages.push(courante);
      courante = '';
    }
    courante += (courante ? '\n' : '') + ligne;
  }
  if (courante) pages.push(courante);
  return pages;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-letterbox')
    .setDescription('Affiche la liste des profils Letterboxd des membres'),

  execute: withErrorHandling(async (interaction) => {
    const { profils, scannedAt } = store.getData();

    // Pseudo actualisé si le membre est en cache (il a pu en changer depuis
    // le scan), sinon celui enregistré au moment du scan.
    const entrees = Object.values(profils)
      .map((p) => ({
        ...p,
        displayName: interaction.guild.members.cache.get(p.userId)?.displayName || p.displayName,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' }));

    if (entrees.length === 0) {
      return interaction.reply({
        content: "📭 Aucun profil Letterboxd enregistré. Un admin doit d'abord lancer `/scan-letterbox`.",
        ephemeral: true,
      });
    }

    const lignes = entrees.map((p) => `• **${escapeMarkdown(p.displayName)}** — [${p.label}](${p.url})`);
    const pages = paginer(lignes);

    const embeds = pages.map((description, i) => {
      const embed = new EmbedBuilder().setColor(COULEUR_LETTERBOXD).setDescription(description);
      if (i === 0) embed.setTitle(`🎬 Profils Letterboxd des membres (${entrees.length})`);
      if (i === pages.length - 1 && scannedAt) {
        embed.setFooter({ text: 'Dernier scan' }).setTimestamp(new Date(scannedAt));
      }
      return embed;
    });

    // Un embed par message pour rester sous la limite de 6000 caractères
    // cumulés par message si la liste devient longue.
    await interaction.reply({ embeds: [embeds[0]] });
    for (const embed of embeds.slice(1)) {
      await interaction.followUp({ embeds: [embed] });
    }
  }, 'LIST-LETTERBOX'),
};
