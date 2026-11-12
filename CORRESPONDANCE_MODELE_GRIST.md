# Table de correspondance — modèle Orga Exam ↔ Grist (projet, v0)

Statut : **proposition à valider**, non implémentée. Elle est établie à partir de la structure de la sauvegarde `.data` (clés, types, effectifs, cohérence des références) et du code (`globals.js`, `planning_distribution.js`, `dashboard.js`). Aucune valeur individuelle n'y figure. L'audit interface par interface (chaque écran et chaque export) reste à faire : la colonne « Interface » ne couvre que ce que j'ai vérifié dans le code.

## 1. Constats sur la sauvegarde (structure uniquement)

| Constat | Conséquence pour la migration |
|---|---|
| 17 clés racine : `config, students, rooms, teachers, distribution, planning, uiState, exams, stage, edt, corrections, oralConfig, planningReserve, examProfiles, examAttendanceProfiles, examAttendance, officialResults` | Toutes doivent avoir une destination, y compris celles vides aujourd'hui (`edt`, `corrections`, `examAttendance*`) |
| `config` pèse ~595 Ko, dont 2 images en data-URI (logo ~245 Ko, signature ~331 Ko) | Ne pas les mettre dans une cellule de texte avant mesure des limites de l'instance ; prévoir pièce jointe ou découpage |
| `distribution` est un dictionnaire **indexé par nom de salle** dont les valeurs sont des **copies complètes** des élèves | Les copies sont identiques à `students[]` (0 différence, 0 élève dans 2 salles). `students[]` fait foi ; `distribution` devient une table d'affectations (élève → salle) |
| `planning` est indexé par `examIdx_nomSalle_(std\|tt\|dict)_créneau_poste`, valeur = **nom complet de l'enseignant** (pas d'identifiant) | Décodage de clé sans ambiguïté sur les 55 entrées. Rattachement à l'enseignant par nom : à faire avec preuve, conserver le nom source si non résolu |
| `planningReserve` : clés `examIdx_reserve_n`, valeur = nom d'enseignant | Même traitement que `planning` |
| `oralConfig` : 80 élèves et 24 enseignants, **tous reliables par identifiant** aux listes principales | Références directes possibles |
| `oralConfig.distribution` : 9 clés de jury, 77 créneaux (75 individuels, 2 de groupe), 80 élèves au total. Les 9 clés coïncident **exactement** avec les libellés `oralConfig.teachers[].jury` : chacun des 9 jurys compte 2 enseignants. Les 6 autres enseignants n'ont ni jury ni salle (5 sont marqués réserve, 1 ne l'est pas) | Lien jury ↔ enseignant établi par égalité de libellé. **Cas à faire confirmer : 1 enseignant sans jury et non marqué réserve.** Correction d'une version précédente de ce document, qui annonçait à tort une discordance |
| `oralConfig.teachers[].salle` : seulement 8 des 18 salles de jury renseignées correspondent à une salle de l'établissement | Garder la salle de jury en texte, avec référence vers `DNB_Salles` uniquement quand le nom concorde |
| Ancien module `stage` : 9 jurys, 80 passages, `studentId` **numérique** ; aucun des 80 ne correspond aux identifiants principaux | Conserver tel quel, marqué « non rapproché » ; membres de jury (18) et réservoir (22) reliables aux enseignants |
| `officialResults` : 80 lignes, 26 seulement rapprochables par identifiant | Garder les 54 autres isolées avec `Statut_rapprochement`, sans fusion forcée |
| `officialMeta.ine` présent sur les 80 résultats | Identifiant national d'élève : à traiter comme donnée sensible dans les droits Grist |
| `examProfiles` : 3 profils × 5 épreuves ; `examAttendanceProfiles` : 3 listes vides | Table d'épreuves par profil ; profils vides conservés |

## 2. Principes communs à toutes les tables Grist

- `Cle` : identifiant stable fourni par l'application (jamais le numéro de ligne Grist). Index unique logique, vérifié à la création.
- `Version` (entier) : incrémentée à chaque écriture ; protège contre les écritures périmées (règle d'accès testée sur un seul rôle, voir rapport de concurrence).
- `Supprime` (booléen) : pas de suppression physique ; la suppression est une mise à jour versionnée.
- `Session` : référence vers `DNB_Sessions`.
- `Extra_JSON` : champs inconnus ou non modélisés, conservés tels quels (jamais attribués arbitrairement).
- `Source_chemin` : chemin d'origine dans la sauvegarde, pour l'audit et le retour arrière.
- Filet de sécurité : l'encodage en arbre sans perte (`grist_lossless_tree.js`) reste l'archive de référence, **pas** le modèle métier.

## 3. Correspondance champ par champ

Légende « Statut » : **E** existe dans le prototype · **N** nouveau · **?** à décider.

### 3.1 Configuration
| Source | Table.colonne Grist | Statut | Remarque |
|---|---|---|---|
| `config.schoolName, year, city, examType, nbSurv, splitHGEMC, activeExamProfileKey, datavisSource` | `DNB_Config` (clé/valeur typées) | N | Une ligne par paramètre, versionnée |
| `config.director.{civ,name}` | `DNB_Config` | N | |
| `config.scienceSubjects` (2) | `DNB_Config_Listes` | N | Liste ordonnée |
| `config.labels` (11 : code, color, name) | `DNB_Amenagements` | E | Complète `Code`, `Libelle`, ajoute `Couleur` |
| `config.oralDate/oralStart/oralEnd/oralDuration` | `DNB_Config` | N | Doublon partiel avec `oralConfig.general` : conserver les deux |
| `config.teacherConvocInstructions`, `instructionTemplates` (7), `aeshConvocations` (lignes, consignes, affectations) | `DNB_Modeles_Texte`, `DNB_AESH_Convocations` | N | Structure interne d'`aeshConvocations` à auditer champ par champ |
| `config.logo`, `config.signature` | `DNB_Fichiers` (pièce jointe ou fragments) | N | **Limites d'instance à mesurer d'abord** |
| `uiState.locked.*` (6 verrous) | `DNB_Config` | N | **Décision du 12/11 : partagé par tous les utilisateurs.** Un verrou posé par un utilisateur vaut pour tous ; chaque changement est versionné et journalisé |

### 3.2 Élèves, salles, enseignants
| Source | Grist | Statut |
|---|---|---|
| `students[].id, nom, prenom, classe, sexe, mef, anonymat` | `DNB_Eleves.Identifiant_source, Nom, Prenom, Classe, Sexe, MEF, Anonymat` | E |
| `students[].tt` | `DNB_Eleves.Tiers_temps` | N (absent du prototype) |
| `students[].labels[]` | `DNB_Eleves_Amenagements` | E |
| `students[].grades.{fr,math,hg,emc,svt,pc,tech,oral,genAvg}` | `DNB_Notes` (une ligne par matière) rattachées à une source « blanc » | E, à étendre |
| `rooms[].id, nom, capacite, isTT, isAmen, nbSurv` | `DNB_Salles` | E |
| `teachers[].id, civ, nom, prenom, matiere, noHSE` | `DNB_Enseignants` | E |

### 3.3 Répartition et surveillances
| Source | Grist | Statut | Remarque |
|---|---|---|---|
| `distribution[nomSalle][]` | `DNB_Affectations` (Eleve, Salle, Ordre) | E | Salle retrouvée par **nom** ; « Zone Tampon » = statut, pas une salle |
| `planning[examIdx_salle_type_créneau_poste]` | `DNB_Surveillances` (Epreuve, Salle, Type_creneau, Creneau, Poste, Enseignant, `Nom_source`) | E | `dict` = surveillance dictée ; `Nom_source` conservé si l'enseignant n'est pas résolu |
| `planningReserve[examIdx_reserve_n]` | `DNB_Surveillances` avec `Type_creneau = reserve` | N | |

### 3.4 Épreuves
| Source | Grist | Statut |
|---|---|---|
| `exams[]` (name, date, time, timeTT, durStd, durTT) | `DNB_Epreuves` (profil actif) | E |
| `examProfiles{DNB, DNB Blanc, Devoir Commun}[]` | `DNB_Epreuves` avec `Profil` | E |
| `examAttendanceProfiles`, `examAttendance[]` (vides) | `DNB_Presences` | E, structure interne à auditer (code `dashboard.js`) |

### 3.5 Oraux
| Source | Grist | Statut | Remarque |
|---|---|---|---|
| `oralConfig.general, languages, themes, grille, convocParams, simpleConvocParams, profConvocParams, pauses` | `DNB_Oraux_Config` + `DNB_Oraux_Grille` | N | `grille` : critères et niveaux à modéliser en lignes |
| `oralConfig.students[]` | `DNB_Oraux_Candidats` (Eleve, Langue, Parcours, Sujet, Groupe, Prioritaire) | E, à étendre | Reliés par identifiant |
| `oralConfig.teachers[]` | `DNB_Oraux_Jury_Enseignants` (Enseignant, Debut, Fin, Langue, Jury, Salle, Reserve) | N | Libellé de jury à résoudre |
| `oralConfig.distribution[jury][]` (créneaux indiv/groupe) | `DNB_Oraux` + `DNB_Oraux_Groupes` | E, à étendre | 75 individuels, 2 de groupe |
| `stage.config/juries/planning` | `DNB_Stage_*` (tables séparées) | N | Passages marqués `Rapproche = non` |

### 3.6 Résultats, corrections, autres
| Source | Grist | Statut |
|---|---|---|
| `officialResults[]` (id, nom, prenom, classe, sexe, `officialResult`, grades, `officialMeta`) | `DNB_Resultats` + `DNB_Notes` ; INE dans colonne à accès restreint | E |
| `corrections.settings/lots` | `DNB_Corrections_*` | ? | Vides dans cette sauvegarde, structure à auditer dans le code |
| `edt.cancelled/maintained` | `DNB_EDT_Exceptions` | ? | Vides ici ; le code manipule des objets `Date` |

## 4. Points ouverts à valider
1. Rattachement des surveillances aux enseignants par nom : règle de normalisation et gestion des homonymes.
2. Oral V2 : confirmer le statut de l'enseignant sans jury et non marqué réserve.
3. Limites de l'instance (taille de cellule, pièces jointes) pour logo et signature.
4. Droits par colonne pour les identifiants nationaux, aménagements et résultats.
5. Audit des écrans et exports pour compléter la colonne « Interface ».

Décisions prises : `uiState` partagé (12/11) ; correspondance des jurys proposée avec preuves, validation humaine pour le cas ci-dessus.
