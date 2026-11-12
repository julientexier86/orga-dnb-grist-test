/* Prépare en mémoire une migration à partir d'un fichier .data ; aucune donnée n'est envoyée ici. */
(function () {
    const str = v => v == null ? '' : String(v);
    const key = v => str(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/[^a-z0-9]/g,'');
    const norm = x => [key(x.nom),key(x.prenom),key(x.classe)].join('|');
    function uniqueLookup(rows, fn) {
        const map = new Map();
        rows.forEach((row,i)=>{const k=fn(row); if (!k) return; if(map.has(k)) map.set(k,null); else map.set(k,i+1);});
        return map;
    }
    window.planDnbMigration = function(data) {
        if (!data || !data.config || !Array.isArray(data.students) || !Array.isArray(data.rooms) || !Array.isArray(data.teachers)) throw new Error('Sauvegarde Orga Exam invalide.');
        const studentId = uniqueLookup(data.students,x=>str(x.id));
        const studentName = uniqueLookup(data.students,norm);
        const roomName = uniqueLookup(data.rooms,x=>str(x.nom));
        const teacherName = uniqueLookup(data.teachers,x=>str(x.nom));
        const teacherId = uniqueLookup(data.teachers,x=>str(x.id));
        for (const [name,rows,lookup] of [['élèves',data.students,studentId],['salles',data.rooms,roomName]]) if (rows.length!==lookup.size || [...lookup.values()].some(v=>v===null)) throw new Error('Identifiants ou noms de '+name+' manquants ou ambigus.');
        const rows={DNB_Sessions:[],DNB_Eleves:[],DNB_Salles:[],DNB_Enseignants:[],DNB_Amenagements:[],DNB_Eleves_Amenagements:[],DNB_Epreuves:[],DNB_Affectations:[],DNB_Surveillances:[],DNB_Jurys:[],DNB_Jurys_Membres:[],DNB_Oraux:[],DNB_Resultats:[],DNB_Notes:[]};
        const add=(name,fields)=>{rows[name].push(fields);return rows[name].length;};
        const warn={resultats_non_rapproches:0,surveillances_non_rapprochees:0,affectations_non_rapprochees:0,oraux_non_rapproches:0};
        const sid=add('DNB_Sessions',{Annee:Number(data.config.year)||0,Nom:'Session importée',Type:str(data.config.examType)});
        const labels = new Map();
        for (const l of data.config.labels||[]) if (l.code && !labels.has(l.code)) labels.set(l.code,add('DNB_Amenagements',{Code:str(l.code),Libelle:str(l.name)}));
        data.students.forEach(s=>{const id=add('DNB_Eleves',{Session:sid,Identifiant_source:str(s.id),Nom:str(s.nom),Prenom:str(s.prenom),Classe:str(s.classe),Sexe:str(s.sexe),MEF:str(s.mef),Anonymat:str(s.anonymat)}); const ls=new Set([...(s.labels||[]),...(s.tt?['TTEMPS']:[])]); for(const code of ls){if(!labels.has(code))labels.set(code,add('DNB_Amenagements',{Code:str(code),Libelle:str(code)}));add('DNB_Eleves_Amenagements',{Eleve:id,Amenagement:labels.get(code)});} });
        data.rooms.forEach(r=>add('DNB_Salles',{Session:sid,Identifiant_source:str(r.id),Nom:str(r.nom),Capacite:Number(r.capacite)||0,Tiers_temps:!!r.isTT,Amenagee:!!r.isAmen,Nb_surveillants:Number(r.nbSurv)||0}));
        data.teachers.forEach(t=>add('DNB_Enseignants',{Session:sid,Identifiant_source:str(t.id),Civilite:str(t.civ),Nom:str(t.nom),Prenom:str(t.prenom),Discipline:str(t.matiere),Sans_HSE:!!t.noHSE}));
        const profiles=data.examProfiles && Object.keys(data.examProfiles).length ? data.examProfiles : {[str(data.config.examType)||'Examen']:data.exams||[]};
        const epMap=new Map(); for(const [profile,exams] of Object.entries(profiles)) for(const [i,e] of (exams||[]).entries()){const v={Session:sid,Profil:profile,Ordre:i,Nom:str(e.name),Debut_standard:str(e.time),Debut_tiers_temps:str(e.timeTT),Duree_standard_min:Number(e.durStd)||0,Duree_tiers_temps_min:Number(e.durTT)||0};if(/^\d{4}-\d{2}-\d{2}$/.test(str(e.date)))v.Date=Math.floor(Date.parse(e.date+'T00:00:00Z')/1000);const row=add('DNB_Epreuves',v);epMap.set(profile+'|'+i,row);}
        for(const [name,group] of Object.entries(data.distribution||{})){if(name==='Zone Tampon')continue; const r=roomName.get(name); for(const [i,s] of group.entries()){const e=studentId.get(str(s.id));if(!r||!e){warn.affectations_non_rapprochees++;continue;}add('DNB_Affectations',{Session:sid,Eleve:e,Salle:r,Statut:'Affecté',Ordre:i+1});}}
        const active=str(data.config.activeExamProfileKey || data.config.examType);for(const [encoded,teacher] of Object.entries(data.planning||{})){if(!teacher)continue;const m=encoded.match(/^(\d+)_(.*)_(std|tt|dict)_(\d+)_(\d+)$/);const e=m&&epMap.get(active+'|'+Number(m[1])),r=m&&roomName.get(m[2]),t=teacherName.get(str(teacher));if(!e||!r||!t){warn.surveillances_non_rapprochees++;continue;}add('DNB_Surveillances',{Epreuve:e,Salle:r,Enseignant:t,Type_creneau:m[3],Creneau:Number(m[4]),Poste:Number(m[5]),Cle_source:encoded});}
        data.students.forEach((s,i)=>{const grades=s.grades||{};if(!Object.keys(grades).length)return; const rid=add('DNB_Resultats',{Session:sid,Eleve:i+1,Source:'DNB blanc',Identifiant_source:str(s.id),Statut_rapprochement:'Identifiant'});for(const [k,v] of Object.entries(grades))if(v!=='' && v!==null && Number.isFinite(Number(v)))add('DNB_Notes',{Resultat:rid,Matiere:k,Note:Number(v)});});
        for(const x of data.officialResults||[]){let match=studentId.get(str(x.id));let status='Identifiant';if(match && (key(data.students[match-1].nom)!==key(x.nom) || key(data.students[match-1].prenom)!==key(x.prenom))) match=null;if(!match){match=studentName.get(norm(x));status=match?'Nom, prénom et classe — à vérifier':'Non rapproché';}if(!match)warn.resultats_non_rapproches++;const meta=x.officialMeta||{};const rid=add('DNB_Resultats',{Session:sid,Eleve:match||0,Source:'DNB officiel',Identifiant_source:str(x.id),Statut_rapprochement:status,Numero_candidat:str(meta.numero),Serie:str(meta.serie),Nom_source:str(x.nom),Prenom_source:str(x.prenom),Classe_source:str(x.classe),Donnees_source_JSON:JSON.stringify(x)});for(const [k,v] of Object.entries(x.grades||{}))if(v!=='' && v!==null && Number.isFinite(Number(v)))add('DNB_Notes',{Resultat:rid,Matiere:k,Note:Number(v)});}
        const juryById=new Map();for(const j of data.stage?.juries||[]){const n=add('DNB_Jurys',{Session:sid,Identifiant_source:str(j.id),Nom:str(j.name),Salle:roomName.get(str(j.room))||0});juryById.set(str(j.id),n);for(const member of j.members||[]){const t=teacherId.get(str(member)) || teacherName.get(str(member));if(t)add('DNB_Jurys_Membres',{Jury:n,Enseignant:t,Role:'Membre'});}}
        for(const p of data.stage?.planning||[]){const e=studentId.get(str(p.studentId)),j=juryById.get(str(p.juryId));if(!e||!j){warn.oraux_non_rapproches++;continue;}add('DNB_Oraux',{Session:sid,Eleve:e,Jury:j,Heure:str(p.time)});}
        const oral = data.oralConfig || {}; const v2Juries = new Map();
        for (const [name, slots] of Object.entries(oral.distribution || {})) {
            const jid=add('DNB_Jurys',{Session:sid,Identifiant_source:'ORAL_V2:'+name,Nom:'Oral : '+name,Salle:0}); v2Juries.set(name,jid);
            for (const slot of slots || []) for (const student of slot.students || []) {
                const e=studentId.get(str(student.id)); if(!e){warn.oraux_non_rapproches++;continue;}
                add('DNB_Oraux',{Session:sid,Eleve:e,Jury:jid,Heure:str(slot.startTime),Parcours:str(student.parcours),Sujet:str(student.sujet),Langue:str(student.langue || slot.langue),Groupe:str(student.groupId),Prioritaire:!!student.isPriority});
            }
        }
        for(const t of oral.teachers || []) { const jid=v2Juries.get(str(t.jury)), tid=teacherId.get(str(t.id)); if(jid && tid) add('DNB_Jurys_Membres',{Jury:jid,Enseignant:tid,Role:'Membre oral V2'}); }
        return {rows,warnings:warn,sourceJSON:JSON.stringify(data)};
    };
})();
