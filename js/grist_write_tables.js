/* Écriture limitée aux lignes existantes. Les contrôles sont une aide, pas un verrou concurrent. */
(function () {
    const names=['DNB_Sessions','DNB_Eleves','DNB_Salles','DNB_Enseignants','DNB_Affectations','DNB_Amenagements','DNB_Eleves_Amenagements'];
    window.getDnbCoreSnapshot = async api => Object.fromEntries(await Promise.all(names.map(async n=>[n,await api.fetchTable(n)])));
    window.buildDnbCoreUpdates = function (data, db) {
        const sid=data.DNB_Sessions.id[0];
        if (data.DNB_Sessions.id.length!==1) throw new Error('Une seule session est prise en charge.');
        const actions=[];
        function match(table, objects, prefix, build) {
            const indices=table.id.map((id,i)=>({id,i})).filter(x=>table.Session[x.i]===sid);
            const key=(x)=>String(x.id);
            const incoming=new Map(objects.map(o=>[key(o),o]));
            if(incoming.size!==objects.length || indices.length!==objects.length) throw new Error('Ajout, suppression ou identifiant dupliqué : opération non prise en charge.');
            const rowMap=new Map();
            for(const row of indices){const source=String(table.Identifiant_source[row.i] || prefix+row.id);const value=incoming.get(source);if(!value) throw new Error('Identifiant introuvable : recharge les tables.'); rowMap.set(source,row.id);actions.push(['UpdateRecord',table===data.DNB_Eleves?'DNB_Eleves':table===data.DNB_Salles?'DNB_Salles':'DNB_Enseignants',row.id,build(value)]);}
            return rowMap;
        }
        const e=match(data.DNB_Eleves,db.students,'Grist-E-',o=>({Nom:o.nom||'',Prenom:o.prenom||'',Classe:o.classe||'',Sexe:o.sexe||'',MEF:o.mef||'',Anonymat:o.anonymat||''}));
        const r=match(data.DNB_Salles,db.rooms,'Grist-S-',o=>({Nom:o.nom||'',Capacite:Number(o.capacite)||0,Tiers_temps:!!o.isTT,Amenagee:!!o.isAmen,Nb_surveillants:Number(o.nbSurv)||0}));
        match(data.DNB_Enseignants,db.teachers,'Grist-P-',o=>({Nom:o.nom||'',Prenom:o.prenom||'',Civilite:o.civ||'',Discipline:o.matiere||'',Sans_HSE:!!o.noHSE}));
        const codes=new Map(data.DNB_Amenagements.id.map((id,i)=>[id,data.DNB_Amenagements.Code[i]]));
        for(const student of db.students){const row=e.get(String(student.id));const expected=data.DNB_Eleves_Amenagements.id.map((id,i)=>i).filter(i=>data.DNB_Eleves_Amenagements.Eleve[i]===row).map(i=>codes.get(data.DNB_Eleves_Amenagements.Amenagement[i])).filter(Boolean).sort();const actual=[...new Set([...(student.labels||[]),...(student.tt?['TTEMPS']:[])])].sort();if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('La modification des aménagements n’est pas encore synchronisée.');}
        const roomsByName=new Map(db.rooms.map(o=>[o.nom,o]));if(roomsByName.size!==db.rooms.length)throw new Error('Les noms de salles doivent être uniques.');
        const allocations=[]; for(const [name,students] of Object.entries(db.distribution||{})){if(!students.length)continue;const room=roomsByName.get(name);if(!room)throw new Error('Salle ou zone tampon non prise en charge : '+name);for(const s of students){const er=e.get(String(s.id));if(!er)throw new Error('Élève affecté introuvable.');allocations.push({eleve:er,salle:r.get(String(room.id))});}}
        const p=data.DNB_Affectations;const rows=p.id.map((id,i)=>({id,i})).filter(x=>p.Session[x.i]===sid);if(rows.length!==allocations.length || new Set(allocations.map(x=>x.eleve)).size!==allocations.length)throw new Error('Ajout ou suppression d’affectation non pris en charge.');
        for(const row of rows){const a=allocations.find(x=>x.eleve===p.Eleve[row.i]);if(!a)throw new Error('Ajout ou suppression d’affectation non pris en charge.');actions.push(['UpdateRecord','DNB_Affectations',row.id,{Salle:a.salle}]);}
        return actions;
    };
})();
