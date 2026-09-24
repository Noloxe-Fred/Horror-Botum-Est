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
    nom: '/delete-watchlist',
    acces: 'Admin ou rôle streamer',
    description: 'Retire un ou plusieurs titres de la watchlist via un menu de sélection.',
  },
  {
    nom: '/cine',
    acces: 'Rôle streamer, salon ciné-club uniquement',
    description:
      'Point d\'entrée unique pour organiser une séance, avec 4 branches : Séances Séries ' +
      '(recherche TMDB, séance lundi prochain), Séance à l\'arrache (ce soir), Séance 48h ' +
      '(surlendemain, watchlist ou TMDB) — ces 3 publient directement — et Séances Ciné semaine ' +
      'suivante (films de la watchlist ou recherche TMDB, sondage de date mardi/vendredi/samedi, puis bouton "Valider séance" réservé ' +
      'admin/rôle streamer pour finaliser et créer l\'event).',
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
          'Watchlist ouverte à tout le monde. `/cine` est réservée au rôle streamer ' +
          'et au salon ciné-club dédié.'
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
