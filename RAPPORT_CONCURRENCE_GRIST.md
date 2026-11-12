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
