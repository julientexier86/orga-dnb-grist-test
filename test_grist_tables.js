/* Modèle structuré : aller-retour exact sur des données FICTIVES, y compris les cas tordus. */
const assert = require('assert');
const M = require('./js/grist_tables.js');
const viaGrist = rows => JSON.parse(JSON.stringify(rows));
const rt = db => M.decode(viaGrist(M.encode(db)));
const eleve = (id, x) => Object.assign({ id, nom: 'FICTIF', prenom: 'Alex' + id, classe: '3A', sexe: 'F', mef: 'X', anonymat: 'A' + id, tt: false,
    grades: { fr: 12, math: 0, hg: 9.5, emc: null, svt: 11, pc: 10, tech: null, oral: 15, genAvg: 11.2 } }, x || {});
const base = () => {
    const students = [eleve('e1'), eleve('e2', { tt: true, labels: ['TT', 'ORDI'] }), eleve('e3', { labels: [] })];
    return {
        config: { schoolName: 'Collège fictif', nbSurv: 2, logo: 'data:image/png;base64,AAAA', labels: [{ code: 'TT', color: '#f00', name: 'Tiers-temps' }] },
        students, rooms: [{ nom: 'Salle 1', capacite: 30, isTT: false, isAmen: false, nbSurv: 2, id: 'r1' }],
        teachers: [{ civ: 'Mme', nom: 'TEST', prenom: 'Morgan', matiere: 'Maths', id: 't1' }, { id: 't2', civ: 'M.', nom: 'ESSAI', prenom: 'Sacha', matiere: 'SVT', noHSE: true }],
        distribution: { 'Salle 1': [students[0], students[1]], 'Zone Tampon': [], 'Salle_2 bis': [students[2]] },
        planning: { '0_Salle 1_std_0_0': 'TEST Morgan', '1_Salle_2 bis_tt_1_0': 'ESSAI Sacha', '2_Salle 1_dict_0_1': 'TEST Morgan' },
        planningReserve: { '0_reserve_0': 'ESSAI Sacha' },
        uiState: { locked: { students: true, rooms: false } },
        exams: [{ name: 'Français', date: '2026-06-01', time: '09:00', timeTT: '09:00', durStd: 180, durTT: 240 }],
        examProfiles: { 'DNB': [{ name: 'Maths', date: '', time: '', timeTT: '', durStd: 120, durTT: 160 }], 'Devoir Commun': [] },
        examAttendanceProfiles: { 'DNB': [], 'DNB Blanc': [{ studentId: 'e1', exam: 0, status: 'absent' }] }, examAttendance: [],
        stage: { config: { date: '2026-05-01', teacherPool: ['TEST Morgan'] }, juries: [{ id: 1, name: 'Jury 1', room: 'Salle 1', members: ['TEST Morgan', 'ESSAI Sacha'] }], planning: [{ juryId: 1, time: '09:00', studentId: 17123456789 }] },
        edt: { cancelled: [], maintained: [] }, corrections: { settings: { fr: { mode: 'auto', teachers: [], manualMap: {} } }, lots: {} },
        oralConfig: { general: { name: 'Oral', date: '2026-05-20' }, pauses: [], languages: ['Anglais'], themes: { 'HDA': [] },
            students: [{ id: 'e1', nom: 'FICTIF', prenom: 'Alexe1', classe: '3A', sexe: 'F', langue: '', parcours: 'Avenir', sujet: 'Stage', groupId: null },
                { id: 'e2', nom: 'FICTIF', prenom: 'Alexe2', classe: '3A', sexe: 'F', langue: 'Anglais', parcours: 'HDA', sujet: 'Sujet, avec virgule', groupId: 'g1', isPriority: true }],
            teachers: [{ id: 't1', nom: 'TEST', prenom: 'Morgan', matiere: 'Maths', startTime: '08:00', endTime: '12:00', langue: '', jury: 'Jury A', salle: 'Salle 1' }],
            distribution: { 'Jury A': [], 'Jury B': [] }, grille: { prestation: { maxPoints: 50, criteres: [{ label: 'x', maxPts: 10, niveaux: [0, 5, 10] }] } } },
        officialResults: [{ id: 'e1', nom: 'FICTIF', prenom: 'Alexe1', classe: '3A', sexe: 'F', officialResult: 'ADMIS', grades: { fr: 12, math: null, genAvg: 11, finalAvg: 11.5 }, officialMeta: { serie: 'G', numero: '001', ine: '000000000ZZ', rawHg: 20, rawEmc: null } }],
        examDayLog: [], examDayChecklist: { 0: true }
    };
};
const db0 = base();
db0.oralConfig.distribution['Jury A'] = [{ type: 'individuel', theme: 'Avenir', langue: null, students: [db0.oralConfig.students[0]], startTime: '08:00', endTime: '08:15' },
    { type: 'groupe', theme: 'HDA', langue: 'Anglais', students: [db0.oralConfig.students[1], Object.assign({}, db0.oralConfig.students[0], { nom: 'COPIE DIVERGENTE' })], startTime: '08:15', endTime: '08:40' }];

// 1. aller-retour exact, ordre des clés racine conservé
const snap = JSON.stringify(db0);
const r1 = rt(db0);
assert.ok(M.deepEqual(db0, r1), 'aller-retour inexact');
assert.strictEqual(JSON.stringify(Object.keys(db0)), JSON.stringify(Object.keys(r1)));
assert.strictEqual(JSON.stringify(db0), snap, 'encode ne doit pas modifier la source');

// 2. cas tordus : identifiants en double, absents, numériques, non-objets, copie périmée, sections de mauvais type, clé inconnue
const tordu = base();
tordu.students.push(eleve('e1', { nom: 'DOUBLON' }), { nom: 'SANS ID' }, eleve(42), null, 'texte', eleve('a|b'));
tordu.distribution['Salle 1'].push(Object.assign({}, tordu.students[0], { classe: 'PERIMEE' }), { id: 'inconnu' }, 7);
tordu.planning['clé libre'] = 'X'; tordu.planning['0_Salle 1_std_0_1'] = null; tordu.planning['0_Salle 1_std_0_2'] = '';
tordu.rooms = 'pas une liste'; tordu.examProfiles = { 'a|b': [] }; tordu.nouveauModule = { a: 1, b: [1, 2] }; tordu.vide = {}; tordu.liste = [1, { x: 1 }]; tordu.nul = null;
tordu.teachers[0].champInconnu = { profond: [1, null] }; tordu.students[1].labels = ['avec, virgule']; tordu.students[2].grades = 'atypique';
delete tordu.exams;
assert.ok(M.deepEqual(tordu, rt(tordu)), 'aller-retour inexact sur les cas tordus');

// 3. vide et quasi vide
assert.ok(M.deepEqual({}, rt({})));
assert.ok(M.deepEqual({ students: [], distribution: {}, oralConfig: {}, stage: {} }, rt({ students: [], distribution: {}, oralConfig: {}, stage: {} })));

// 4. une saisie faite dans Grist revient dans l'application
const rows = viaGrist(M.encode(db0));
const T = M.T, ligne = (t, cle) => rows[t].find(r => r.Cle === cle);
ligne(T.ELEVES, 'e1').Classe = '3B';                       // modification d'une cellule
ligne(T.ELEVES, 'e1').Note_EMC = 14;                       // note nulle complétée dans Grist
ligne(T.ELEVES, 'e3').Amenagements = 'TT, ORDI';           // aménagements saisis en texte
ligne(T.SALLES, 'r1').Capacite = 28;
ligne(T.SURV, 'planning|0_Salle 1_std_0_0').Enseignant = 'ESSAI Sacha';
rows[T.ENS].push({ Cle: 't9', Ordre: 9, Civilite: 'Mme', Nom: 'NOUVELLE', Prenom: 'Lou', Discipline: 'EPS', Sans_HSE: false, Extra: '' });   // ligne ajoutée à la main
ligne(T.ENS, 't2').Supprime = true;                        // suppression = marque, jamais effacement
const r4 = M.decode(rows);
assert.strictEqual(r4.students[0].classe, '3B');
assert.strictEqual(r4.students[0].grades.emc, 14);
assert.deepStrictEqual(r4.students[2].labels, ['TT', 'ORDI']);
assert.strictEqual(r4.rooms[0].capacite, 28);
assert.strictEqual(r4.planning['0_Salle 1_std_0_0'], 'ESSAI Sacha');
assert.deepStrictEqual(r4.teachers.map(t => t.id), ['t1', 't9']);
assert.deepStrictEqual(r4.teachers[1], { id: 't9', civ: 'Mme', nom: 'NOUVELLE', prenom: 'Lou', matiere: 'EPS', noHSE: false });
assert.strictEqual(r4.distribution['Salle 1'][0].classe, '3B', 'la répartition suit la fiche élève');
assert.strictEqual(r4.oralConfig.distribution['Jury A'][1].students[1].nom, 'COPIE DIVERGENTE', 'une copie divergente est conservée telle quelle');
// le reste n'a pas bougé
const r4b = JSON.parse(JSON.stringify(r4)); r4b.students[0].classe = '3A'; r4b.students[0].grades.emc = null; r4b.students[2].labels = []; r4b.rooms[0].capacite = 30;
r4b.planning['0_Salle 1_std_0_0'] = 'TEST Morgan'; r4b.teachers = db0.teachers; r4b.distribution['Salle 1'][0].classe = '3A'; r4b.distribution['Salle 1'][0].grades.emc = null; r4b.distribution['Salle_2 bis'][0].labels = [];
assert.ok(M.deepEqual(db0, r4b), 'une saisie dans Grist ne doit toucher que la donnée saisie');

// 5. schéma : toutes les colonnes écrites existent, colonnes techniques partout
for (const { table, colonnes } of M.SCHEMA) {
    const ids = new Set(colonnes.map(c => c[0]));
    for (const c of ['Cle', 'Ordre', 'Extra', 'Supprime', 'Base', 'Jeton', 'Revision']) assert.ok(ids.has(c), table + '.' + c);
    for (const r of [...M.encode(db0)[table], ...M.encode(tordu)[table]]) for (const c of Object.keys(r)) assert.ok(ids.has(c), 'colonne hors schéma : ' + table + '.' + c);
    assert.strictEqual(ids.size, colonnes.length, 'colonne en double dans ' + table);
}
// 6. clés uniques par table
for (const d of [db0, tordu]) { const e = M.encode(d); for (const t of Object.keys(e)) assert.strictEqual(new Set(e[t].map(r => r.Cle)).size, e[t].length, 'clé en double dans ' + t); }
console.log('test_grist_tables : OK (6 scénarios)');
// 7. noms réservés et identifiants commençant par « # »
const res = { students: [{ id: 'x', _valeur: 1 }, { id: '#0', nom: 'A' }, { id: 'y', _absents: ['nom'], _id: 'n' }], teachers: [{ id: 3, nom: 'N' }] };
assert.ok(M.deepEqual(res, rt(res)), 'noms réservés');
console.log('scénario 7 : OK');
// 8. aléatoire reproductible : 400 projets fictifs de formes arbitraires
let graine = 12345; const rnd = n => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return (graine >>> 9) % n; };
const mots = ['', 'a', 'b c', 'x,y', 'é', '#1', 'a|b', '_valeur', 'id', 'nom', 'grades', 'labels', 'tt', '0_S_std_0_0', '1_reserve_0', 'students', '12'];
const val = p => { const t = rnd(p > 3 ? 6 : 9); return t === 0 ? null : t === 1 ? rnd(50) - 5 : t === 2 ? rnd(100) / 8 : t === 3 ? mots[rnd(mots.length)] : t === 4 ? rnd(2) === 1 : t === 5 ? '' 
    : t === 6 ? Array.from({ length: rnd(4) }, () => val(p + 1)) : Object.fromEntries(Array.from({ length: rnd(5) }, () => [mots[rnd(mots.length)], val(p + 1)])); };
const racines = ['config', 'students', 'rooms', 'teachers', 'distribution', 'planning', 'planningReserve', 'exams', 'examProfiles', 'oralConfig', 'stage', 'officialResults', 'examAttendance', 'examAttendanceProfiles', 'uiState', 'autre', 'a|b'];
const liste = p => Array.from({ length: rnd(5) }, () => val(p));
const dico = p => Object.fromEntries(Array.from({ length: rnd(5) }, () => [mots[rnd(mots.length)], Array.from({ length: rnd(4) }, () => val(p))]));
const projet = () => {
    const d = {}; for (const k of racines) if (rnd(4)) d[k] = rnd(3) ? val(0) : (rnd(2) ? liste(1) : dico(2));
    if (rnd(2)) { d.oralConfig = { general: val(1) }; if (rnd(3)) d.oralConfig.students = liste(1); if (rnd(3)) d.oralConfig.teachers = liste(1);
        if (rnd(3)) { d.oralConfig.distribution = dico(2); if (Array.isArray(d.oralConfig.students) && d.oralConfig.students.length) d.oralConfig.distribution['Jury 1'] = [{ type: 'x', students: [d.oralConfig.students[0]], startTime: '08:00' }, { students: d.oralConfig.students.slice(0, 2) }]; } }
    if (rnd(2)) { d.stage = { config: val(1) }; if (rnd(3)) d.stage.juries = liste(1); if (rnd(3)) d.stage.planning = liste(1); }
    if (Array.isArray(d.students) && d.students.length && rnd(2)) d.distribution = { 'Salle 1': d.students.slice(0, 2), 'Zone Tampon': [], 'S 2': [d.students[d.students.length - 1], val(1)] };
    if (rnd(3) === 0) d.config = { logo: 'data:' + 'A'.repeat(20000 + rnd(9000)), nom: val(1) };
    return d;
};
let lignes = {};
for (let n = 0; n < 1500; n++) {
    const d = projet(), b = rt(d);
    if (!M.deepEqual(d, b)) { assert.fail('aléatoire n°' + n); }
    const e = M.encode(d); for (const t of Object.keys(e)) { assert.strictEqual(new Set(e[t].map(r => r.Cle)).size, e[t].length, 'clé en double (aléatoire) ' + t); lignes[t] = (lignes[t] || 0) + e[t].length; }
}
// le tirage doit réellement remplir chaque table, sinon il ne prouve rien
for (const t of Object.values(M.T)) assert.ok(lignes[t] > 100, 'table peu exercée : ' + t + ' ' + lignes[t]);
console.log('scénario 8 (aléatoire) : OK');
