# Migration Orga Exam → Grist : état de préparation

La sauvegarde source est lue localement. Les scripts de migration ne contiennent aucun contenu issu de celle-ci. Aucune donnée réelle n'a été transmise par ces scripts.

## Structure préparée

`js/grist_migration.js` transforme une sauvegarde en lignes pour les tables DNB, conserve une copie JSON complète, et compte les références non rapprochées. Les résultats officiels non reliés sont conservés sans candidat associé, avec leurs champs d'origine, pour examen. Les oraux de l'ancien module sont distingués du module oral V2 ; les éléments non reliés restent dans la sauvegarde complète.

`js/grist_migration_actions.js` prépare une série d'actions pour un document dédié vide. Le contrôle d'une destination vide est obligatoire avant de les appliquer. Ces scripts ne sont pas reliés à un bouton d'import et n'envoient rien par eux-mêmes.

## Travaux indispensables avant utilisation réelle

- Achever et tester la migration de tous les champs et modules dans les deux sens ; la copie JSON complète ne remplace pas des données structurées exploitables.
- Réconcilier les résultats officiels et les anciens oraux qui n'ont pas de correspondance certaine ; ne pas inventer de lien.
- Vérifier les permissions réelles du document, de l'espace et des vues personnalisées ; ne pas utiliser le document de démonstration héritant de droits et comportant un widget tiers pour la sauvegarde réelle.
- Concevoir une protection contre les modifications concurrentes qui soit atomique. La comparaison actuelle avant écriture ne constitue pas un verrou.
- Vérifier les limites pratiques de taille de cellule et de document, la sauvegarde/restauration, les erreurs réseau, et la migration sur données fictives représentatives.
- Les tests existants et le contrôle local du plan ne prouvent pas que la totalité du projet est migrée ni que les synchronisations sont prêtes pour la production.
