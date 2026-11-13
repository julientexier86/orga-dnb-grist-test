/* Stockage par lignes : installation, protection, envoi des seules lignes modifiées, conflits, fusion. Données FICTIVES. */
const assert = require('assert');
const R = require('./js/grist_rows.js'), M = require('./js/grist_tables.js');
const { fakeGrist } = require('./test_fake_grist_rows.js');
const eleve = (id, x) => Object.assign({ id, nom: 'FICTIF', prenom: 'Alex' + id, classe: '3A', sexe: 'F', mef: 'X', anonymat: 'A' + id, tt: false, grades: { fr: 12, math: 0, hg: null } }, x || {});
const projet = () => { const students = [eleve('e1'), eleve('e2'), eleve('e3')]; return { config: { schoolName: 'Collège fictif', logo: 'data:' + 'L'.repeat(300000), signature: 'data:' + 'S'.repeat(340000) },
    students, rooms: [{ id: 'r1', nom: 'Salle 1', capacite: 30, isTT: false, isAmen: false, nbSurv: 2 }], teachers: [{ id: 't1', civ: 'Mme', nom: 'TEST', prenom: 'Morgan', matiere: 'Maths' }],
    distribution: { 'Salle 1': [students[0], students[1]] }, planning: { '0_Salle 1_std_0_0': 'TEST Morgan' }, uiState: { locked: { students: false } },
    exams: [{ name: 'Français', date: '2026-06-01', time: '09:00', timeTT: '09:00', durStd: 180, durTT: 240 }], officialResults: [] }; };
const copie = x => JSON.parse(JSON.stringify(x));
/* Modifie une fiche élève et ses copies dans la répartition, comme le fait l'application. */
const mod = (db, i, fn) => { const id = db.students[i].id; fn(db.students[i]); for (const l of Object.values(db.distribution || {})) for (const c of l) if (c && c.id === id) fn(c); };
const nb = (g, op) => g.log.flat().filter(a => a[0] === op).length;

(async () => {
    // 1. installation : sans elle rien n'est protégé ; après, vérification et sonde passent ; réinstaller ne change rien
    const g = fakeGrist(), api = g.client();
    assert.strictEqual((await R.verify(api)).ok, false);
    assert.deepStrictEqual(await R.install(api), { ok: true });
    assert.ok((await R.verify(api)).ok); assert.ok((await R.sonder(api)).ok);
    const avant = JSON.stringify(g.tables._grist_ACLRules); assert.deepStrictEqual(await R.install(api), { ok: true }); assert.strictEqual(JSON.stringify(g.tables._grist_ACLRules), avant, 'installation idempotente');
    // une installation abîmée est détectée : révision automatique retirée, puis règle retirée
    { const h = fakeGrist(), a = h.client(); await R.install(a);
      await a.applyUserActions([['ModifyColumn', M.T.ELEVES, 'Revision', { recalcWhen: 0 }]]);
      assert.ok((await R.verify(a)).manques.some(x => x.includes('révision automatique')));
      assert.ok((await R.sonder(a)).echecs.some(x => x.includes('DNB_Eleves')), 'la sonde voit la révision figée');
      await R.install(a); assert.ok((await R.verify(a)).ok);
      const res = h.tables._grist_ACLResources.find(x => x.tableId === M.T.SALLES); h.tables._grist_ACLRules = h.tables._grist_ACLRules.filter(x => x.resource !== res.id);
      assert.strictEqual((await R.verify(a)).ok, false); const s = await R.sonder(a); assert.ok(s.echecs.some(x => x.includes('DNB_Salles') && x.includes('périmée')) && s.echecs.some(x => x.includes('suppression'))); }

    // 2. premier envoi, relecture identique, document vide reconnu
    const A = R.createRowStore(api); let a = await A.pull();
    assert.ok(A.vide(a.etat)); assert.deepStrictEqual(a.db, {});
    const db = projet(); let r = await A.push(db, a.etat); assert.ok(r.ok && r.lots >= 2, 'logo et signature imposent plusieurs requêtes');
    a = await A.pull(); assert.ok(M.deepEqual(a.db, db), 'relecture exacte'); assert.strictEqual(a.problems.length, 0); assert.ok(!A.vide(a.etat));
    assert.deepStrictEqual(await A.push(a.db, a.etat), { ok: true, n: 0 }, 'rien à envoyer si rien n\'a changé');

    // 3. seules les lignes modifiées partent ; aucune relecture des tables inchangées
    const dA = copie(a.db); mod(dA, 1, e => e.classe = '3B'); const n0 = g.log.length; r = await A.push(dA, a.etat);
    assert.ok(r.ok && r.n === 1 && g.log.length === n0 + 1 && g.log[n0].length === 1); assert.deepStrictEqual(Object.keys(g.log[n0][0][3]).sort(), ['Base', 'Classe', 'Jeton']);
    const lectures = []; const espion = Object.assign({}, api, { fetchTable: async t => { lectures.push(t); return api.fetchTable(t); } });
    const A2 = R.createRowStore(espion); await A2.pull(); lectures.length = 0; assert.deepStrictEqual(await A2.changed((await A2.pull()).sig), []); lectures.length = 0;
    await api.applyUserActions([['UpdateRecord', M.T.SALLES, g.tables[M.T.SALLES].find(x => x.Cle === 'r1').id, { Capacite: 28 }]]);   // saisie humaine dans Grist
    const p2 = await A2.pull(); assert.strictEqual(p2.db.rooms[0].capacite, 28, 'une saisie dans Grist revient dans l\'application');
    assert.deepStrictEqual(lectures.filter(t => t !== R.T_ETAT), [M.T.SALLES], 'seule la table modifiée est relue'); assert.ok(!lectures.includes(M.T.FICHIERS));

    // 4. deux utilisateurs, deux élèves différents : aucun conflit
    const B = R.createRowStore(g.client()); a = await A.pull(); let b = await B.pull();
    const d1 = copie(a.db); mod(d1, 0, e => e.prenom = 'Ana'); const d2 = copie(b.db); mod(d2, 2, e => e.tt = true);
    assert.ok((await A.push(d1, a.etat)).ok); assert.ok((await B.push(d2, b.etat)).ok, 'lignes différentes : pas de conflit');
    a = await A.pull(); assert.strictEqual(a.db.students[0].prenom, 'Ana'); assert.strictEqual(a.db.students[2].tt, true);

    // 5. même ligne : le second est refusé, rien n'est écrit, la fusion colonne par colonne règle le cas
    b = await B.pull(); const x1 = copie(a.db); mod(x1, 0, e => e.classe = '3C'); const x2 = copie(b.db); mod(x2, 0, e => e.nom = 'AUTRE'); x2.rooms[0].nbSurv = 3;
    assert.ok((await A.push(x1, a.etat)).ok); const instantane = JSON.stringify(g.tables[M.T.SALLES]);
    r = await B.push(x2, b.etat); assert.ok(!r.ok && r.conflit && !r.partiel); assert.strictEqual(JSON.stringify(g.tables[M.T.SALLES]), instantane, 'lot refusé en entier');
    let dist = await B.pull(); let f = B.fusion(b.etat, x2, dist.etat, 'distant'); assert.strictEqual(f.conflits.length, 0, 'colonnes différentes de la même ligne : fusion sans conflit');
    assert.ok((await B.push(f.db, dist.etat)).ok); b = await B.pull(); assert.deepStrictEqual([b.db.students[0].classe, b.db.students[0].nom, b.db.rooms[0].nbSurv], ['3C', 'AUTRE', 3]);

    // 6. même cellule : vrai conflit, signalé, jamais d'écrasement silencieux
    a = await A.pull(); const y1 = copie(a.db); mod(y1, 1, e => e.classe = 'A-1'); const y2 = copie(b.db); mod(y2, 1, e => e.classe = 'B-1');
    assert.ok((await A.push(y1, a.etat)).ok); assert.ok(!(await B.push(y2, b.etat)).ok);
    dist = await B.pull(); f = B.fusion(b.etat, y2, dist.etat, 'distant'); assert.deepStrictEqual(f.conflits, [{ table: M.T.ELEVES, cle: 'e2', colonne: 'Classe' }]); assert.strictEqual(f.db.students[1].classe, 'A-1');
    assert.strictEqual(B.fusion(b.etat, y2, dist.etat, 'local').db.students[1].classe, 'B-1');

    // 7. suppression = marque ; la ligne reste dans Grist ; recréer le même identifiant la réactive
    a = await A.pull(); const z = copie(a.db); z.teachers = []; assert.ok((await A.push(z, a.etat)).ok);
    assert.strictEqual(g.tables[M.T.ENS].filter(x => x.Cle === 't1').length, 1); assert.strictEqual(nb(g, 'RemoveRecord'), 0, 'aucune suppression physique acceptée');
    a = await A.pull(); assert.deepStrictEqual(a.db.teachers, []); const z2 = copie(a.db); z2.teachers = [{ id: 't1', civ: 'M.', nom: 'RETOUR', prenom: 'Lou', matiere: 'EPS' }];
    assert.ok((await A.push(z2, a.etat)).ok); a = await A.pull(); assert.strictEqual(a.db.teachers[0].nom, 'RETOUR'); assert.strictEqual(g.tables[M.T.ENS].filter(x => x.Cle === 't1').length, 1);
    // suppression d'un côté, modification de l'autre : conflit signalé
    b = await B.pull(); const s1 = copie(a.db); s1.students.pop(); const s2 = copie(b.db); mod(s2, 2, e => e.classe = '3Z');
    assert.ok((await A.push(s1, a.etat)).ok); assert.ok(!(await B.push(s2, b.etat)).ok); dist = await B.pull();
    f = B.fusion(b.etat, s2, dist.etat, 'distant'); assert.ok(f.conflits.length === 0 && f.db.students.length === 2, 'suppression distante + autre colonne locale : la suppression l\'emporte sans perte silencieuse côté Grist');

    // 8. doublon de clé (deux créations simultanées) : signalé, la plus ancienne fait foi
    a = await A.pull(); b = await B.pull(); const c1 = copie(a.db); c1.rooms.push({ id: 'r9', nom: 'Salle A', capacite: 10, isTT: false, isAmen: false, nbSurv: 1 });
    const c2 = copie(b.db); c2.rooms.push({ id: 'r9', nom: 'Salle B', capacite: 20, isTT: false, isAmen: false, nbSurv: 1 });
    assert.ok((await A.push(c1, a.etat)).ok); assert.ok((await B.push(c2, b.etat)).ok, 'Grist ne garantit pas l\'unicité à la création');
    a = await A.pull(); assert.strictEqual(a.problems.length, 1); assert.ok(a.problems[0].motif.includes('doublon')); assert.strictEqual(a.db.rooms.filter(x => x.id === 'r9')[0].nom, 'Salle A');

    // 9. lecture instable : une écriture pendant la lecture provoque une relecture, jamais un état mélangé
    { let coups = 0; const agite = Object.assign({}, api, { fetchTable: async t => { const v = await api.fetchTable(t);
        if (t === M.T.EPREUVES && coups++ === 0) await api.applyUserActions([['UpdateRecord', M.T.SALLES, g.tables[M.T.SALLES].find(x => x.Cle === 'r1').id, { Capacite: 99 }]]); return v; } });
      const C = R.createRowStore(agite); const c = await C.pull(); assert.strictEqual(c.db.rooms[0].capacite, 99); assert.ok(coups >= 1); }

    // 10. sans protection installée, l'écriture périmée passerait : c'est bien la règle qui protège
    { const h = fakeGrist(), ap = h.client(); await R.install(ap); const S1 = R.createRowStore(ap), S2 = R.createRowStore(h.client());
      let u = await S1.pull(); await S1.push(projet(), u.etat); u = await S1.pull(); const v = await S2.pull();
      h.tables._grist_ACLRules = [];
      const m1 = copie(u.db); mod(m1, 0, e => e.classe = 'X'); const m2 = copie(v.db); mod(m2, 0, e => e.classe = 'Y');
      await S1.push(m1, u.etat); assert.ok((await S2.push(m2, v.etat)).ok, 'témoin : sans règle, écrasement silencieux'); assert.strictEqual((await R.verify(ap)).ok, false); }
    // 10 bis. ligne supprimée dans Grist puis recréée chez moi (absente de ma base) : pas de faux conflit
    { const h = fakeGrist(), ap = h.client(); await R.install(ap); const S = R.createRowStore(ap);
      let u = await S.pull(); await S.push(projet(), u.etat); u = await S.pull();
      const sans = copie(u.db); delete sans.config.schoolName; sans.teachers = []; await S.push(sans, u.etat); u = await S.pull();   // lignes marquées supprimées
      const base = R.instantane(u.db), moi = copie(u.db); moi.config.schoolName = 'Recréé'; moi.teachers = [{ id: 't1', civ: 'M.', nom: 'RETOUR', prenom: 'Lou', matiere: 'EPS' }];
      const f = S.fusion(base, moi, u.etat, 'distant'); assert.deepStrictEqual(f.conflits, [], 'recréation sans conflit'); assert.ok(M.deepEqual(f.db, moi));
      assert.ok((await S.push(f.db, u.etat)).ok); assert.ok(M.deepEqual((await S.pull()).db, moi));
      // en revanche deux créations simultanées différentes de la même clé restent un conflit
      const autre = copie(moi); autre.config.ville = 'A'; const S2 = R.createRowStore(h.client()); const v = await S2.pull(); await S2.push(autre, v.etat);
      const moi2 = copie(moi); moi2.config.ville = 'B'; const d = await S.pull(); assert.strictEqual(S.fusion(R.instantane(moi), moi2, d.etat, 'distant').conflits.length, 1); }

    // 11. droits des lecteurs : colonnes sensibles masquées, installation idempotente, le reste intact
    { const h = fakeGrist(), ap = h.client(); await R.install(ap); assert.strictEqual((await R.verifierDroitsLecteurs(ap)).ok, false);
      assert.ok((await R.installerDroitsLecteurs(ap)).ok); const n = h.tables._grist_ACLRules.length; assert.ok((await R.installerDroitsLecteurs(ap)).ok); assert.strictEqual(h.tables._grist_ACLRules.length, n);
      const ine = h.tables._grist_ACLResources.find(x => x.tableId === M.T.RESULTATS && x.colIds !== '*'); assert.ok(ine.colIds.split(',').includes('INE') && ine.colIds.split(',').includes('Extra'));
      assert.ok(h.tables._grist_ACLResources.find(x => x.tableId === M.T.ELEVES && x.colIds !== '*').colIds.includes('Amenagements'));
      for (const r of h.tables._grist_ACLResources.filter(x => x.colIds !== '*')) for (const c of r.colIds.split(',')) assert.ok(c in M.TYPES[r.tableId], 'colonne inconnue dans une règle : ' + r.tableId + '.' + c);
      assert.ok((await R.verify(ap)).ok && (await R.sonder(ap)).ok, 'la protection par ligne reste en place'); }
    // 12. compte qui ne voit pas toutes les colonnes (lecteur) : l'application n'est pas chargée avec des données tronquées
    { const h = fakeGrist(), ap = h.client(); await R.install(ap); const lecteur = Object.assign({}, ap, { fetchTable: async t => { const c = await ap.fetchTable(t); if (t === M.T.RESULTATS) delete c.INE; return c; } });
      await assert.rejects(() => R.createRowStore(lecteur).pull(), e => e.lectureRestreinte === true && /DNB_Resultats/.test(e.message)); }
    console.log('Stockage Grist par lignes : installation, sonde, envoi minimal, saisie Grist, conflits, fusion, suppression, doublons OK');
})().catch(e => { console.error(e); process.exit(1); });
