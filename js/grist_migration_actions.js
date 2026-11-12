/* Uniquement pour un document dédié dont les tables cibles sont toutes vides. */
(function () {
    window.buildDnbMigrationActions = function(plan) {
        if (!plan || !plan.rows || !plan.sourceJSON) throw new Error('Plan de migration absent.');
        const actions = [
            ['AddColumn','DNB_Resultats','Nom_source',{type:'Text'}],
            ['AddColumn','DNB_Resultats','Prenom_source',{type:'Text'}],
            ['AddColumn','DNB_Resultats','Classe_source',{type:'Text'}],
            ['AddColumn','DNB_Resultats','Donnees_source_JSON',{type:'Text'}]
        ];
        for (const [table, records] of Object.entries(plan.rows)) {
            records.forEach((fields,i)=>actions.push(['AddRecord',table,i+1,fields]));
        }
        actions.push(['AddRecord','OrgaExamSauvegardes',null,{Date_UTC:new Date().toISOString(),Libelle:'Sauvegarde source intégrale avant migration',Donnees_JSON:plan.sourceJSON}]);
        return actions;
    };
    window.assertEmptyMigrationTarget = async function(api, plan) {
        for (const name of [...Object.keys(plan.rows),'OrgaExamSauvegardes']) {
            const t=await api.fetchTable(name);
            if(t.id.length) throw new Error('Import refusé : la table '+name+' contient déjà des données. Un document dédié et vide est nécessaire.');
        }
    };
})();
