/* Schéma de démonstration, sans données issues d'une sauvegarde réelle. */
(function () {
    const T = (id, cols) => ['AddTable', id, cols.map(([id, type]) => ({id, type}))];
    const S = 'Ref:DNB_Sessions', E = 'Ref:DNB_Eleves', R = 'Ref:DNB_Salles', P = 'Ref:DNB_Enseignants', J = 'Ref:DNB_Jurys', X = 'Ref:DNB_Epreuves';
    const tables = [
        T('DNB_Sessions', [['Annee','Int'],['Nom','Text'],['Type','Text']]),
        T('DNB_Eleves', [['Session',S],['Identifiant_source','Text'],['Nom','Text'],['Prenom','Text'],['Classe','Text'],['Sexe','Text'],['MEF','Text'],['Anonymat','Text']]),
        T('DNB_Salles', [['Session',S],['Identifiant_source','Text'],['Nom','Text'],['Capacite','Int'],['Tiers_temps','Bool'],['Amenagee','Bool'],['Nb_surveillants','Int']]),
        T('DNB_Enseignants', [['Session',S],['Identifiant_source','Text'],['Civilite','Text'],['Nom','Text'],['Prenom','Text'],['Discipline','Text'],['Sans_HSE','Bool']]),
        T('DNB_Amenagements', [['Code','Text'],['Libelle','Text']]),
        T('DNB_Eleves_Amenagements', [['Eleve',E],['Amenagement','Ref:DNB_Amenagements']]),
        T('DNB_Epreuves', [['Session',S],['Profil','Text'],['Ordre','Int'],['Nom','Text'],['Date','Date'],['Debut_standard','Text'],['Debut_tiers_temps','Text'],['Duree_standard_min','Int'],['Duree_tiers_temps_min','Int']]),
        T('DNB_Affectations', [['Session',S],['Eleve',E],['Salle',R],['Statut','Text'],['Ordre','Int']]),
        T('DNB_Surveillances', [['Epreuve',X],['Salle',R],['Enseignant',P],['Type_creneau','Text'],['Creneau','Int'],['Poste','Int'],['Cle_source','Text']]),
        T('DNB_Jurys', [['Session',S],['Identifiant_source','Text'],['Nom','Text'],['Salle',R]]),
        T('DNB_Jurys_Membres', [['Jury',J],['Enseignant',P],['Role','Text']]),
        T('DNB_Oraux', [['Session',S],['Eleve',E],['Jury',J],['Heure','Text'],['Parcours','Text'],['Sujet','Text'],['Langue','Text'],['Groupe','Text'],['Prioritaire','Bool']]),
        T('DNB_Resultats', [['Session',S],['Eleve',E],['Source','Text'],['Identifiant_source','Text'],['Statut_rapprochement','Text'],['Numero_candidat','Text'],['Serie','Text'],['Decision','Text'],['Mention','Text']]),
        T('DNB_Notes', [['Resultat','Ref:DNB_Resultats'],['Matiere','Text'],['Note','Numeric'],['Bareme','Numeric']]),
        T('DNB_Presences', [['Session',S],['Eleve',E],['Epreuve',X],['Statut','Text'],['Note','Text']]),
        T('DNB_Journal', [['Session',S],['Date_heure','Text'],['Type','Text'],['Personne_salle','Text'],['Note','Text']])
    ];
    const add = (table, id, values) => ['AddRecord', table, id, values];
    const demo = [
        add('DNB_Sessions',1,{Annee:2026,Nom:'Session fictive de démonstration',Type:'DNB blanc'}),
        add('DNB_Eleves',1,{Session:1,Identifiant_source:'TEST-E01',Nom:'FICTIF',Prenom:'Alex',Classe:'3e A'}),
        add('DNB_Eleves',2,{Session:1,Identifiant_source:'TEST-E02',Nom:'FICTIF',Prenom:'Camille',Classe:'3e B'}),
        add('DNB_Salles',1,{Session:1,Identifiant_source:'TEST-S01',Nom:'Salle test 101',Capacite:24}),
        add('DNB_Enseignants',1,{Session:1,Identifiant_source:'TEST-P01',Nom:'FICTIF',Prenom:'Morgan',Discipline:'Mathématiques'}),
        add('DNB_Amenagements',1,{Code:'TTEMPS',Libelle:'Tiers-temps — exemple fictif'}),
        add('DNB_Eleves_Amenagements',1,{Eleve:2,Amenagement:1}),
        add('DNB_Epreuves',1,{Session:1,Profil:'DNB blanc',Ordre:1,Nom:'Mathématiques — exemple',Date:1775779200,Debut_standard:'09:00',Duree_standard_min:120,Duree_tiers_temps_min:160}),
        add('DNB_Affectations',1,{Session:1,Eleve:1,Salle:1,Statut:'Affecté',Ordre:1}),
        add('DNB_Surveillances',1,{Epreuve:1,Salle:1,Enseignant:1,Type_creneau:'standard',Creneau:1,Poste:1}),
        add('DNB_Jurys',1,{Session:1,Identifiant_source:'TEST-J01',Nom:'Jury test 1',Salle:1}),
        add('DNB_Jurys_Membres',1,{Jury:1,Enseignant:1,Role:'Membre'}),
        add('DNB_Oraux',1,{Session:1,Eleve:1,Jury:1,Heure:'09:00',Parcours:'Exemple',Sujet:'Sujet fictif'}),
        add('DNB_Resultats',1,{Session:1,Eleve:1,Source:'DNB blanc',Identifiant_source:'TEST-E01',Statut_rapprochement:'Exemple fictif'}),
        add('DNB_Notes',1,{Resultat:1,Matiere:'Mathématiques',Note:14,Bareme:20})
    ];
    window.createDnbDemoSchema = async function (api) {
        const existing = await api.listTables();
        const collisions = tables.map(a => a[1]).filter(id => existing.includes(id));
        if (collisions.length) throw new Error('Création arrêtée : des tables DNB existent déjà ('+collisions.join(', ')+').');
        await api.applyUserActions([...tables, ...demo]);
        return tables.length;
    };
})();
