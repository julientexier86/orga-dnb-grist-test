# Rapport — concurrence, limites et stockage Grist (12/11/2026)

Tous les essais ci-dessous ont été faits sur des documents **fictifs** de l'instance grist.numerique.gouv.fr, avec le compte propriétaire, par l'API REST de la session connectée. Aucune donnée réelle n'a été envoyée à Grist.

## 1. Ce qui est démontré

| Essai (réel) | Résultat |
|---|---|
| 12 mises à jour simultanées d'une même ligne, même révision de départ, règle `newRec.Revision != rec.Revision + 1` (refus de la mise à jour) | 1 acceptée, 11 refusées |
| Mise à jour sans incrément de révision | refusée |
| Lot de 2 lignes dont une périmée | lot refusé en bloc, la ligne valide n'est pas modifiée (atomicité) |
| Règle étendue à la suppression (`-UD`) | suppression directe refusée ; suppression logique par mise à jour versionnée acceptée |
| 12 publications simultanées par le module `grist_store.js` (document d'essai) | 1 publication réelle (révision 2 → 3) ; les autres refusées ou sans effet |
| Lot multi-sections dont une section est périmée | aucune section publiée, configuration inchangée |

## 2. Ce qui n'est PAS garanti par Grist

- **Unicité à la création** : 10 créations simultanées de la même clé ont toutes réussi (10 doublons) ; un lot contenant deux fois la même clé aussi. Les règles d'accès ne savent pas interroger la table (`Table1` : variable inconnue dans une formule de règle). Parade : ligne canonique = plus petit `id` ; les sections sont créées une seule fois par un seul geste explicite.
- **Rejouer un lot crée des doublons** (mesuré) : toute écriture est donc conçue pour ne pas dépendre d'un rejeu (morceaux identifiés par révision + nonce, publication par une seule mise à jour versionnée).
- **Rôles** : seuls les droits propriétaire ont été testés. Les rôles éditeur et lecteur, et deux comptes réels en parallèle, ne le sont pas (voir §5).
- **Accès par le widget** : la limite de taille et le comportement par le canal du widget (`grist.docApi`) n'ont pas été mesurés, seulement l'API REST.

## 3. Limites de l'instance mesurées (REST)

| Mesure | Valeur |
|---|---|
| Taille maximale d'une requête | ~1 Mo (HTTP 413 au-delà) ; cellule de 600 Ko relue à l'identique ; 1 Mo refusé |
| 8 290 lignes écrites par lots de 2 000 | ~3,4 s |
| Relecture de ~10 800 lignes | ~0,7 s |
| Rejeu d'un même lot | crée des doublons |
| Quota de document | non mesuré (l'API d'usage n'existe pas sur cette instance) |

Défauts découverts grâce à l'essai réel (et corrigés) : (a) la limite porte sur les octets sérialisés, pas sur les caractères ; (b) couper un morceau au milieu d'un émoji corrompt la donnée (demi-paire de substitution remplacée par U+FFFD) ; (c) une section corrompue ne doit pas bloquer la lecture des autres.

## 4. Architecture retenue

- Chaque clé racine de la base de l'application est une **section** ; le logo et la signature de `config` sont isolés (≈ 576 Ko). La sauvegarde réelle donne 19 sections, 27 morceaux de 64 Ko au plus, aller-retour identique (comparaison profonde).
- Une section est écrite en **morceaux ajoutés** (jamais modifiés), puis **publiée par une seule mise à jour** de sa ligne dans `DNB_Sections`, protégée par la règle de version. Plusieurs sections peuvent être publiées dans un même lot, accepté ou refusé en bloc.
- Chaque lecture vérifie le nombre de morceaux et l'empreinte SHA-256 ; une section défaillante est signalée sans bloquer les autres.
- **3 révisions** conservées par section ; restauration = nouvelle révision. Les morceaux d'une écriture en cours ne sont jamais supprimés.
- Le pont refuse d'écrire tant que la règle n'est pas **vérifiée** dans le document, ne remplace jamais le projet local sans confirmation, et ne publie que les sections modifiées par l'utilisateur.

## 5. Reste à faire avant toute donnée réelle

1. Essai de bout en bout dans Grist avec l'application déployée (widget) sur un document fictif neuf, y compris limites du canal widget.
2. Essai avec un **second compte** (éditeur, lecteur) : concurrence réelle et droits.
3. Tables structurées d'exploitation (miroir en lecture seule des sections) et rapprochement des 54 résultats ; non faits.
4. Droits par colonne (INE, aménagements, résultats) et revue des widgets du document de destination.
5. Dépendance ExcelJS chargée depuis `cdnjs.cloudflare.com` lors de l'export Excel : à embarquer localement.
6. Répétition de migration + restauration sur fixtures, puis seulement après, document réel dédié.

## Protection par ligne pour les tables structurées (mesuré le 12/11/2026)

Décision de Julien le 12/11 : les tables Grist deviennent la source de vérité, pour tous les domaines.
Mesures faites sur l'instance, document de laboratoire fictif, compte propriétaire, table `TEST_Lignes`.

Dispositif : colonnes `Base` (Int), `Jeton` (Text), `Revision` (Int, formule de déclenchement `(value or 0) + 1`,
recalculée à chaque modification de la ligne), règle `newRec.Jeton != rec.Jeton and newRec.Base != rec.Revision` -> `-U`,
et règle sans condition -> `-D`.

| Essai | Résultat |
|---|---|
| Modification d'une cellule sans toucher `Jeton` (saisie humaine dans Grist) | acceptée, `Revision` +1 |
| Écriture de l'application (`Jeton` neuf, `Base` = révision lue) | acceptée, `Revision` +1 |
| Écriture périmée (`Jeton` neuf, `Base` ancienne), y compris `Base` égale à la `Base` déjà stockée | refusée (403) |
| Lot de deux lignes dont une périmée (`UpdateRecord` x2, puis `BulkUpdateRecord`) | lot refusé en entier, aucune ligne modifiée |
| Suppression d'une ligne | refusée (403) |

Constats annexes : `AddTable` ignore `recalcWhen` ; il faut un `ModifyColumn` séparé (`recalcWhen: 2`), sinon la
révision ne bouge pas et la protection est inopérante. À vérifier à chaque installation.

Limites : mesuré avec le seul rôle propriétaire ; rien ne garantit l'unicité de `Cle` à la création ; une personne
ayant le droit d'écriture peut modifier `Base`/`Jeton`/`Revision` à la main (colonnes à masquer et à verrouiller).
Non encore mesuré : rôles éditeur et lecteur, règles de colonne sur les données sensibles.

## Tables structurées : mesures complémentaires (12/11/2026, soir)

Document de laboratoire fictif. Les rôles éditeur et lecteur sont **simulés** par la fonction « voir en tant que »
de Grist (`aclAsUser_=editor1@example.com` / `viewer@example.com`) depuis le compte propriétaire : ce n'est pas
encore un essai avec deux vrais comptes.

| Essai | Résultat |
|---|---|
| Valeur vide (`null`) dans une colonne numérique ou entière | conservée vide (pas de 0) |
| Cellule de texte de 340 000 caractères (taille de la signature) | écrite et relue à l'identique |
| Colonne calculée `SUM(r.Revision for r in T.lookupRecords())` | somme exacte, relue par l'API |
| Éditeur simulé : écriture périmée | refusée |
| Éditeur simulé : écriture à jour, saisie simple, ajout de ligne | acceptés, révision +1 |
| Éditeur simulé : suppression de ligne, modification de structure | refusées |
| Éditeur simulé : lecture des règles et des colonnes (vérification de la protection) | possible |
| Lecteur simulé : colonnes visées par `user.Access == VIEWER` -> `-R` | absentes de la réponse |
| Lecteur simulé : écriture | refusée |

Conséquences dans le code : `DNB_Etat` sert de signature (quelles tables relire, lecture cohérente) ; l'installation
ajoute `user.Access != OWNER` -> `-S` ; un compte qui ne voit pas toutes les colonnes n'obtient pas l'application
(message explicite) au lieu de données tronquées.

Reste non prouvé : essai de bout en bout dans un document fictif avec le widget, deux vrais comptes, comportement
de l'application réelle (et non du simulateur) lors d'un rechargement après fusion.

## Essai réel du stockage par lignes sur l'instance (12/11/2026, 22 h 30)

Code servi par GitHub Pages (v15), exécuté contre le document de laboratoire fictif par l'API de l'instance ;
projet fictif de 80 élèves avec logo (250 Ko) et signature (340 Ko). Rôles éditeur et lecteur simulés (« voir en tant que »).

| Essai | Résultat |
|---|---|
| Installation complète (15 tables, règles, sondes sur chaque table) | réussie, 22 s |
| Premier envoi : 120 lignes en 2 requêtes | 1,5 s ; relecture exactement identique |
| Relecture sans changement | 0,2 s (seule `DNB_Etat` est lue) |
| Propriétaire et éditeur modifient deux élèves différents | les deux acceptés, 1 ligne chacun |
| Même élève, colonnes différentes | second envoi refusé, fusion sans conflit, renvoi accepté |
| Même cellule | refus, conflit identifié (table, clé, colonne) |
| Saisie directe dans une table | relue par l'application |
| Masquage lecteurs installé | protection par ligne toujours vérifiée et sondée |
| Lecteur : lecture par l'application | refus propre (colonnes masquées détectées) ; INE, notes, aménagements absents de ses réponses |

Non couvert par cet essai : l'application réelle dans le widget (bascule, rechargement après fusion), deux vrais comptes.

## Sauvegarde locale du navigateur : risque constaté et corrigé

La sauvegarde automatique locale (`localStorage`) est commune à tous les documents Grist ouverts sur un même poste.
Le bouton « Restaurer la session » remplaçait le projet ouvert par cette copie, puis l'envoi automatique la publiait
dans le document affiché : une copie périmée, ou celle d'un autre document, pouvait ainsi remplacer les données
partagées. Le bouton n'est plus proposé quand l'application est embarquée dans Grist (`datavis.js`).
