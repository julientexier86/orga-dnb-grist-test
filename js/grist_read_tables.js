/* Lecture initiale de la première session structurée ; aucune écriture dans les tables. */
(function () {
    window.readDnbStructuredSession = async function (api, blank) {
        const ids = ['DNB_Sessions','DNB_Eleves','DNB_Salles','DNB_Enseignants','DNB_Affectations','DNB_Amenagements','DNB_Eleves_Amenagements'];
        const result = await Promise.all(ids.map(id => api.fetchTable(id)));
        const [sessions, students, rooms, teachers, placements, labels, studentLabels] = result;
        if (sessions.id.length !== 1) throw new Error('La lecture de test attend exactement une session.');
        const sessionId = sessions.id[0];
        const select = table => table.id.map((id,i)=>({id,i})).filter(x=>table.Session[x.i] === sessionId);
        const newDB = JSON.parse(JSON.stringify(blank));
        newDB.config.year = String(sessions.Annee[0] || '');
        newDB.students = select(students).map(({id,i})=>({id:String(students.Identifiant_source[i] || 'Grist-E-'+id),nom:students.Nom[i] || '',prenom:students.Prenom[i] || '',classe:students.Classe[i] || '',sexe:students.Sexe[i] || '',mef:students.MEF[i] || '',anonymat:students.Anonymat[i] || '',tt:false,labels:[],grades:{}}));
        newDB.rooms = select(rooms).map(({id,i})=>({id:String(rooms.Identifiant_source[i] || 'Grist-S-'+id),nom:rooms.Nom[i] || '',capacite:rooms.Capacite[i] || 0,isTT:!!rooms.Tiers_temps[i],isAmen:!!rooms.Amenagee[i],nbSurv:rooms.Nb_surveillants[i] || 0}));
        newDB.teachers = select(teachers).map(({id,i})=>({id:String(teachers.Identifiant_source[i] || 'Grist-P-'+id),nom:teachers.Nom[i] || '',prenom:teachers.Prenom[i] || '',civ:teachers.Civilite[i] || '',matiere:teachers.Discipline[i] || '',noHSE:!!teachers.Sans_HSE[i]}));
        const studentMap = new Map(select(students).map((x,i)=>[x.id,newDB.students[i]]));
        const roomMap = new Map(select(rooms).map((x,i)=>[x.id,newDB.rooms[i]]));
        const labelById = new Map(labels.id.map((id,i)=>[id,labels.Code[i]]));
        for (let i=0;i<studentLabels.id.length;i++) {
            const student=studentMap.get(studentLabels.Eleve[i]), code=labelById.get(studentLabels.Amenagement[i]);
            if (student && code) { student.labels.push(code); if (code === 'TTEMPS') student.tt=true; }
        }
        newDB.distribution = {};
        for (const {i} of select(placements)) {
            const student=studentMap.get(placements.Eleve[i]), room=roomMap.get(placements.Salle[i]);
            if (!student || !room) throw new Error('Une affectation contient une référence manquante.');
            (newDB.distribution[room.nom] ||= []).push(student);
        }
        return newDB;
    };
})();
