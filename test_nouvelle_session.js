/* Préparation de la session suivante : rien de personnel ne passe, le projet source n'est pas modifié. Données FICTIVES. */
const assert = require('assert');
const { preparerNouvelleSession } = require('./js/nouvelle_session.js');
const SECRET = 'ZZSECRETZZ';   // marque posée sur toute donnée d'élève ou nominative de la session écoulée
const eleve = id => ({ id, nom: SECRET, prenom: SECRET, classe: '3A', tt: true, labels: ['TT'], grades: { fr: 12 }, anonymat: SECRET });
const defauts = { config: { schoolName: '', year: '2026', logo: '' }, students: [], rooms: [], teachers: [], distribution: {}, planning: {}, officialResults: [],
    stage: { config: { date: '2026-06-01' }, juries: [], planning: [] }, oralConfig: { general: { name: '', date: '' }, students: [], teachers: [], distribution: {}, grille: {} },
    uiState: { locked: { students: false } }, exams: [{ name: 'Défaut', date: '2026-04-16', time: '09:00', timeTT: '09:00', durStd: 90, durTT: 120 }] };
const projet = () => ({
    config: { schoolName: 'Collège fictif', year: '2026', city: 'Testville', logo: 'data:LOGO', signature: 'data:SIG', director: { civ: 'M.', name: 'DIRECTION' }, labels: [{ code: 'TT', color: '#f00', name: 'Tiers-temps' }],
        instructionTemplates: { candidates: 'Consignes' }, oralDate: '2026-05-20', oralDuration: '15', champInconnu: SECRET,
        aeshConvocations: { lines: SECRET, instructions: 'Consignes AESH', assignments: { a: { enabled: true, roomName: 'S1', aeshNames: SECRET } } } },
    students: [eleve('e1'), eleve('e2')], rooms: [{ id: 'r1', nom: 'Salle 1', capacite: 30, isTT: false, isAmen: false, nbSurv: 2, occupant: SECRET }],
    teachers: [{ id: 't1', civ: 'Mme', nom: 'TEST', prenom: 'Morgan', matiere: 'Maths', noHSE: true, note: SECRET }],
    distribution: { 'Salle 1': [eleve('e1')] }, planning: { '0_Salle 1_std_0_0': SECRET }, planningReserve: { '0_reserve_0': SECRET },
    uiState: { locked: { students: true } }, exams: [{ name: 'Français', date: '2026-06-01', time: '09:00', timeTT: '09:00', durStd: 180, durTT: 240, remarque: SECRET }],
    examProfiles: { DNB: [{ name: 'Maths', date: '2026-06-02', time: '14:00', timeTT: '14:00', durStd: 120, durTT: 160 }] },
    examAttendanceProfiles: { DNB: [{ eleve: SECRET }] }, examAttendance: [{ eleve: SECRET }], examDayLog: [{ note: SECRET }], examDayChecklist: [{ done: true, note: SECRET }],
    stage: { config: { date: '2026-05-01', duration: 20, teacherPool: ['TEST Morgan'] }, juries: [{ id: 1, name: 'Jury', members: [SECRET] }], planning: [{ juryId: 1, studentId: 5, nom: SECRET }] },
    oralConfig: { general: { name: 'Oral', date: '2026-05-20', start: '08:00', end: '12:00' }, languages: ['Anglais'], themes: { HDA: [] }, grille: { prestation: { maxPoints: 8 } }, convocParams: { text: 'Texte' },
        students: [{ id: 'e1', nom: SECRET, sujet: SECRET }], teachers: [{ id: 't1', nom: 'TEST', jury: 'A', salle: SECRET }], distribution: { A: [{ students: [{ nom: SECRET }] }] }, brouillon: SECRET },
    officialResults: [{ id: 'e1', nom: SECRET, officialMeta: { ine: SECRET } }], corrections: { settings: { fr: { manualMap: { x: SECRET } } }, lots: { fr: [{ copies: [SECRET] }] } },
    edt: { cancelled: [{ cours: SECRET }], maintained: [] }, moduleInconnu: { contenu: SECRET }
});

// 1. par défaut : enseignants gardés, dates vidées ; aucune donnée marquée ne passe ; la source n'est pas modifiée
const src = projet(), avant = JSON.stringify(src);
const { projet: p, rapport } = preparerNouvelleSession(src, defauts);
assert.strictEqual(JSON.stringify(src), avant, 'le projet ouvert ne doit pas être modifié');
assert.ok(!JSON.stringify(p).includes(SECRET), 'une donnée de la session écoulée a fui : ' + (JSON.stringify(p).match(new RegExp('.{60}' + SECRET)) || [''])[0]);
assert.deepStrictEqual([p.students, p.distribution, p.planning, p.planningReserve, p.officialResults, p.examAttendance, p.examDayLog], [[], {}, {}, {}, [], [], []]);
assert.deepStrictEqual([p.oralConfig.students, p.oralConfig.teachers, p.oralConfig.distribution, p.stage.juries, p.stage.planning], [[], [], {}, [], []]);
assert.ok(!('corrections' in p) && !('examDayChecklist' in p) && !('moduleInconnu' in p));
assert.deepStrictEqual(p.examAttendanceProfiles, { DNB: [] });
// repris
assert.deepStrictEqual([p.config.schoolName, p.config.city, p.config.logo, p.config.signature, p.config.director.name, p.config.labels.length, p.config.instructionTemplates.candidates, p.config.oralDuration],
    ['Collège fictif', 'Testville', 'data:LOGO', 'data:SIG', 'DIRECTION', 1, 'Consignes', '15']);
assert.deepStrictEqual(p.config.aeshConvocations, { lines: '', instructions: 'Consignes AESH', assignments: {} });
assert.deepStrictEqual(p.rooms, [{ id: 'r1', nom: 'Salle 1', capacite: 30, isTT: false, isAmen: false, nbSurv: 2 }]);
assert.deepStrictEqual(p.teachers, [{ id: 't1', civ: 'Mme', nom: 'TEST', prenom: 'Morgan', matiere: 'Maths', noHSE: true }]);
assert.deepStrictEqual(p.exams, [{ name: 'Français', time: '09:00', timeTT: '09:00', durStd: 180, durTT: 240, date: '' }]);
assert.strictEqual(p.examProfiles.DNB[0].date, ''); assert.strictEqual(p.oralConfig.general.date, ''); assert.strictEqual(p.stage.config.date, ''); assert.ok(!('oralDate' in p.config));
assert.deepStrictEqual([p.oralConfig.general.name, p.oralConfig.languages, p.oralConfig.grille.prestation.maxPoints, p.oralConfig.convocParams.text, p.stage.config.duration, p.stage.config.teacherPool], ['Oral', ['Anglais'], 8, 'Texte', 20, ['TEST Morgan']]);
assert.deepStrictEqual(p.uiState, defauts.uiState, 'verrous remis à zéro'); assert.ok(!('edt' in p) || JSON.stringify(p.edt) === JSON.stringify(defauts.edt));
// rapport : ce qui est écarté est annoncé, avec les sections inconnues
assert.ok(rapport.efface.some(x => /élèves, avec leurs notes.*\(2\)/.test(x)) && rapport.efface.some(x => /résultats officiels \(1\)/.test(x)) && rapport.efface.some(x => /AESH/.test(x)));
assert.deepStrictEqual(rapport.ignore.sort(), ['config.champInconnu', 'moduleInconnu', 'oralConfig.brouillon']);

// 2. options : sans enseignants, avec dates
const q = preparerNouvelleSession(projet(), defauts, { enseignants: false, dates: true }).projet;
assert.deepStrictEqual([q.teachers, q.stage.config.teacherPool], [[], []]);
assert.deepStrictEqual([q.exams[0].date, q.examProfiles.DNB[0].date, q.oralConfig.general.date, q.stage.config.date, q.config.oralDate], ['2026-06-01', '2026-06-02', '2026-05-20', '2026-05-01', '2026-05-20']);
assert.ok(!JSON.stringify(q).includes(SECRET));

// 3. projets vides ou abîmés : pas de plantage, résultat chargeable
for (const d of [{}, null, { config: null, students: 'x', oralConfig: null, stage: [], exams: null, rooms: [null, 3], teachers: [null] }]) {
    const r = preparerNouvelleSession(d, defauts).projet; assert.ok(Array.isArray(r.students) && Array.isArray(r.rooms) && Array.isArray(r.teachers) && r.config && r.uiState); }

// 4. le nouveau projet passe l'aller-retour des tables Grist
const M = require('./js/grist_tables.js');
assert.ok(M.deepEqual(p, M.decode(JSON.parse(JSON.stringify(M.encode(p))))));
console.log('Nouvelle session : liste blanche, aucune fuite, options, projets abîmés, compatibilité tables OK');
