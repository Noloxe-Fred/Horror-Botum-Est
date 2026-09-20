const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SeparatorSpacingSize } = require('discord.js');
const withErrorHandling = require('../../../core/withErrorHandling');

const COULEUR_HELP = 0xb8002e;

const COMMANDES = [
  {
    nom: '/search titre',
    acces: 'Tout le monde, tout salon',
    description: 'Cherche un film ou une série sur TMDB et affiche sa fiche.',
  },
  {
    nom: '/add titre',
    acces: 'Tout le monde, tout salon',
    description:
      'Ajoute un titre à la watchlist commune. Refuse les doublons déjà en watchlist, ' +
      'demande confirmation si le titre a déjà été vu.',
  },
  {
    nom: '/list',
    acces: 'Tout le monde, tout salon',
    description: 'Liste la watchlist, avec filtres type/genre et tri (récent, note, durée).',
  },
  {
    nom: '/poll',
    acces: 'Rôle streamer, salon ciné-club uniquement',
    description:
      'Lance le formulaire de sondage (film ou série, aléatoire/manuel/direct) pour choisir ' +
      'la prochaine séance.',
  },
  {
    nom: '/host',
    acces: 'Rôle streamer, salon ciné-club uniquement',
    description:
      "Finalise la séance à partir du dernier /poll : titre gagnant, créneau, salon vocal, " +
      "puis poste l'annonce (salon ciné-club pour un film, salon dédié pour une série) et programme les rappels.",
  },
  {
    nom: '/arrache titre',
    acces: 'Rôle streamer, salon ciné-club uniquement',
    description: "Annonce une séance improvisée pour ce soir 21h dans son salon dédié, sans sondage ni planification.",
  },
  {
    nom: '/serie-en-cours',
    acces: 'Tout le monde, tout salon',
    description: 'Rappelle quelle série est actuellement suivie, posté dans le salon série dédié.',
  },
  {
    nom: '/historique',
    acces: 'Tout le monde',
    description: 'Affiche les derniers films/séries vus au ciné-club.',
  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help-cine')
    .setDescription('Affiche la liste des commandes du ciné-club et leur usage'),

  execute: withErrorHandling(async (interaction) => {
    const container = new ContainerBuilder().setAccentColor(COULEUR_HELP);

    container.addTextDisplayComponents((t) =>
      t.setContent(
        '# 🎬 Commandes du Ciné-Club\n' +
          'Watchlist ouverte à tout le monde. `/poll`, `/host` et `/arrache` sont réservées ' +
          'au rôle streamer et au salon ciné-club dédié.'
      )
    );

    for (const c of COMMANDES) {
      container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents((t) =>
        t.setContent(`**${c.nom}**\n${c.description}\n-# Accès : ${c.acces}`)
      );
    }

    await interaction.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
  }, 'CINE-CLUB-HELP'),
};
