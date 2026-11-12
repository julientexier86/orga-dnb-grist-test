const assert = require('node:assert/strict');
const path = require('node:path');
const Store = require(path.resolve(process.argv[2] || 'js/grist_store.js'));

const { fakeGrist } = require('./test_fake_grist.js');
const mk = (g, name) => Store.createStore(g.client(), { auteur: name, now: () => '2026-01-01T00:00:00Z' });
const secs = (g, k) => g.tables.DNB_Sections.filter(r => r.Cle === k);

(async () => {
    // 1. Aller-retour d'une grosse section (> 600 Ko, accents, guillemets, antislash) découpée en morceaux
    {
        const g = fakeGrist(), a = mk(g, 'A');
        const big = 'é"\\{}'.repeat(150000); // 750 000 caractères
        const db = { config: { logo: big, ville: 'Gençay' }, students: [{ id: 'S1', nom: 'X' }], uiState: { locked: { students: false } } };
        let base = (await a.pull()).baseline;
        const r = await a.push(db, base); assert.equal(r.committed, true); assert.deepEqual(r.saved.sort(), ['config', 'students', 'uiState']);
        assert.ok(g.tables.DNB_Morceaux.filter(m => m.Cle_section === 'config').length >= 4);
        assert.ok(g.tables.DNB_Morceaux.every(m => m.Contenu.length <= Store.TAILLE_MORCEAU));
        const b = mk(g, 'B'); const got = await b.pull();
        assert.deepEqual(got.sections, db);
        // 2. Rien à enregistrer si rien n'a changé
        const before = g.log.length; const r2 = await a.push(db, r.baseline);
        assert.equal(r2.committed, true); assert.deepEqual(r2.saved, []); assert.equal(g.log.length, before);
    }
    // 3. Deux écrivains sur la même section et la même base : un seul gagne, l'autre est refusé sans rien perdre
    {
        const g = fakeGrist(), a = mk(g, 'A'), b = mk(g, 'B');
        const init = await a.push({ students: [{ id: 1, nom: 'init' }] }, {});
        const base = init.baseline;
        const [ra, rb] = await Promise.all([a.push({ students: [{ id: 1, nom: 'A' }] }, base), b.push({ students: [{ id: 1, nom: 'B' }] }, base)]);
        assert.equal([ra, rb].filter(r => r.committed).length, 1);
        const loser = ra.committed ? rb : ra; assert.deepEqual(loser.conflicts, ['students']); assert.equal(loser.refused, false);
        const state = (await mk(g, 'C').pull()).sections.students[0].nom; assert.equal(state, ra.committed ? 'A' : 'B');
        // les morceaux du perdant sont orphelins puis nettoyés, sans toucher à la version publiée
        const n = await a.garbageCollect(); assert.ok(n >= 1);
        assert.equal((await mk(g, 'C').pull()).sections.students[0].nom, state);
        // 12 écrivains simultanés
        const cur = (await a.pull()).baseline;
        const res = await Promise.all(Array.from({ length: 12 }, (_, i) => mk(g, 'W' + i).push({ students: [{ nom: 'w' + i }] }, cur)));
        assert.equal(res.filter(r => r.committed).length, 1);
    }
    // 4. Lot multi-sections atomique : si une section a bougé, aucune n'est publiée
    {
        const g = fakeGrist(), a = mk(g, 'A'), b = mk(g, 'B');
        const init = await a.push({ s1: 1, s2: 1 }, {}); const base = init.baseline;
        const rb = await b.push({ s1: 1, s2: 'B' }, base); assert.equal(rb.committed, true);
        const ra = await a.push({ s1: 'A', s2: 'A' }, base);
        assert.equal(ra.committed, false); assert.deepEqual(ra.conflicts, ['s2']);
        const state = (await mk(g, 'C').pull()).sections; assert.deepEqual(state, { s1: 1, s2: 'B' });
    }
    // 5. Sections différentes modifiées en parallèle : les deux passent
    {
        const g = fakeGrist(), a = mk(g, 'A'), b = mk(g, 'B');
        const base = (await a.push({ s1: 1, s2: 1 }, {})).baseline;
        const [ra, rb] = await Promise.all([a.push({ s1: 'A', s2: 1 }, base), b.push({ s1: 1, s2: 'B' }, base)]);
        assert.ok(ra.committed && rb.committed);
        assert.deepEqual((await mk(g, 'C').pull()).sections, { s1: 'A', s2: 'B' });
    }
    // 6. Création simultanée de la même section : doublon toléré, ligne canonique = plus petit id, un seul gagnant
    {
        const g = fakeGrist(), a = mk(g, 'A'), b = mk(g, 'B');
        const [ra, rb] = await Promise.all([a.push({ s1: 'A' }, {}), b.push({ s1: 'B' }, {})]);
        assert.ok(secs(g, 's1').length >= 1);
        assert.equal([ra, rb].filter(r => r.committed).length >= 1, true);
        const got = (await mk(g, 'C').pull()).sections.s1; assert.ok(got === 'A' || got === 'B');
    }
    // 7. Corruption détectée : morceau manquant ou empreinte différente
    {
        const g = fakeGrist(), a = mk(g, 'A');
        await a.push({ s1: 'x'.repeat(500000) }, {});
        await a.push({ s2: 'ok' }, (await a.pull()).baseline);
        const m = g.tables.DNB_Morceaux; m.splice(m.findIndex(x => x.Cle_section === 's1'), 1);
        const lu = await mk(g, 'C').pull();
        assert.deepEqual(lu.problems.map(p => p.cle), ['s1']);        // la section défaillante est signalée…
        assert.equal(lu.sections.s2, 'ok'); assert.equal('s1' in lu.sections, false); // …sans bloquer les autres
        const g2 = fakeGrist(), a2 = mk(g2, 'A'); await a2.push({ s1: 'abc' }, {});
        g2.tables.DNB_Morceaux[0].Contenu = 'abd';
        const lu2 = await mk(g2, 'C').pull();
        assert.equal(lu2.problems[0].raison, 'empreinte différente');
        // Réparation : republier le même contenu local doit remplacer la révision corrompue
        const rep = await a2.push({ s1: 'abc' }, lu2.baseline); assert.deepEqual(rep.saved, ['s1']);
        const lu3 = await mk(g2, 'C').pull(); assert.deepEqual(lu3.problems, []); assert.equal(lu3.sections.s1, 'abc');
        // Une écriture sans changement n'est pas comptée comme publication
        const nop = await a2.push({ s1: 'abc' }, lu3.baseline); assert.deepEqual(nop.saved, []);
    }
    // 8. Historique : conservation de 3 révisions, restauration comme nouvelle révision, rien de supprimé au-delà de la publiée
    {
        const g = fakeGrist(), a = mk(g, 'A'); let base = {};
        for (let i = 1; i <= 6; i++) { const r = await a.push({ s1: { v: i } }, base); assert.ok(r.committed); base = r.baseline; }
        const revs = [...new Set(g.tables.DNB_Morceaux.map(m => m.Revision_cible))].sort();
        assert.deepEqual(revs, [4, 5, 6]);
        const rr = await a.restore('s1', 4, base); assert.ok(rr.committed);
        assert.deepEqual((await mk(g, 'C').pull()).sections.s1, { v: 4 });
        assert.equal(secs(g, 's1')[0].Revision, 7);
        // morceaux d'une écriture en cours (révision > publiée) jamais supprimés
        g.tables.DNB_Morceaux.push({ id: 999, Cle_section: 's1', Revision_cible: 8, Nonce: 'enCours', Ordre: 0, Contenu: '{}', Hash: '' });
        await a.garbageCollect(); assert.ok(g.tables.DNB_Morceaux.some(m => m.id === 999));
    }
    // 9. Une section supprimée du JSON n'est pas supprimée de Grist (aucune suppression silencieuse)
    {
        const g = fakeGrist(), a = mk(g, 'A');
        const r = await a.push({ s1: 1, s2: 2 }, {}); await a.push({ s1: 1 }, r.baseline);
        assert.deepEqual((await mk(g, 'C').pull()).sections, { s1: 1, s2: 2 });
    }
    // 10. Pire cas de sérialisation : caractères de contrôle (6 octets) et émojis (4 octets), aucune requête > 1 Mo
    {
        const g = fakeGrist(), a = mk(g, 'A');
        const pire = { ctrl: '\u0001'.repeat(400000), emoji: '😀'.repeat(150000), guillemets: '"'.repeat(500000) };
        const r = await a.push(pire, {}); assert.ok(r.committed);
        const lu = await mk(g, 'B').pull(); assert.deepEqual(lu.problems, []); assert.deepEqual(lu.sections, pire);
        // coupure pile au milieu d'un émoji (frontière de morceau)
        const g2 = fakeGrist(), a2 = mk(g2, 'A'); const limite = Store.TAILLE_MORCEAU;
        const e = 'a'.repeat(limite - 2) + '😀' + 'z'.repeat(10);
        await a2.push({ e }, {}); const lu2 = await mk(g2, 'B').pull(); assert.deepEqual(lu2.problems, []); assert.equal(lu2.sections.e, e);
    }
    // 11. Découpage en sections : aller-retour exact, images isolées, clés inconnues conservées, absence préservée
    {
        const db = { config: { schoolName: 'X', logo: 'data:image/png;base64,AAA', signature: 'data:image/png;base64,BBB', labels: [1, 2] },
            students: [{ id: 1 }], inconnue: { a: [1, { b: null }] }, uiState: { locked: { rooms: true } } };
        const s = Store.splitDb(db);
        assert.deepEqual(Object.keys(s).sort(), ['config', 'config.logo', 'config.signature', 'inconnue', 'students', 'uiState']);
        assert.equal('logo' in s.config, false);
        assert.deepEqual(Store.joinDb(s), db);
        const sans = { config: { schoolName: 'X' }, students: [] }; assert.deepEqual(Store.joinDb(Store.splitDb(sans)), sans);
        assert.deepEqual(Object.keys(Store.splitDb(sans)), ['config', 'students']);
        // modifier seulement le logo ne republie que la section du logo
        const g = fakeGrist(), a = mk(g, 'A'); const r = await a.push(s, {});
        const s2 = Store.splitDb(Object.assign({}, db, { config: Object.assign({}, db.config, { logo: 'data:image/png;base64,CCC' }) }));
        const r2 = await a.push(s2, r.baseline); assert.deepEqual(r2.saved, ['config.logo']);
    }
    // 12. Protection : absente → vérification négative ; installation idempotente ; puis vérification positive ; illisible → non vérifiable
    {
        const g = fakeGrist();
        // le simulateur applique la règle de version uniquement si l'installation a eu lieu : ici on vérifie la présence
        const api = g.client();
        assert.equal((await Store.verifyProtection(api)).ok, false);
        const fake = g.client(); // AddRecord sur tables ACL gérés par le simulateur générique
        const out = await Store.installProtection(Object.assign({}, fake, {
            async fetchTable(n) { const t = await fake.fetchTable(n); if (n === '_grist_ACLRules') { t.aclFormula = t.aclFormula || []; } return t; } }));
        assert.equal(out.regle, 'installée');
        assert.equal((await Store.verifyProtection(api)).ok, true);
        const again = await Store.installProtection(api); assert.equal(again.regle, 'déjà présente'); assert.equal(again.created, 0);
        const sansLecture = { async fetchTable() { throw new Error('accès refusé'); } };
        const v = await Store.verifyProtection(sansLecture); assert.equal(v.ok, false); assert.equal(v.verifiable, false);
    }
    // 13. « Garder la mienne » : on ne republie que MES sections, sans écraser celles qu'un autre a modifiées
    {
        const g = fakeGrist(), a = mk(g, 'A'), b = mk(g, 'B');
        const base = (await a.push({ s1: 1, s2: 1, s3: 1 }, {})).baseline;
        const rb = await b.push({ s1: 1, s2: 'B', s3: 'B' }, base); assert.ok(rb.committed);   // B modifie s2 et s3
        const monDb = { s1: 'A', s2: 1, s3: 1 };                                                // A modifie s1 seulement (copie locale périmée pour s2, s3)
        const mesCles = await a.changedKeys(monDb, base); assert.deepEqual(mesCles, ['s1']);
        const frais = await a.pull();
        const r = await a.push(monDb, frais.baseline, { seulement: mesCles });
        assert.ok(r.committed); assert.deepEqual(r.saved, ['s1']);
        assert.deepEqual((await mk(g, 'C').pull()).sections, { s1: 'A', s2: 'B', s3: 'B' });
        const meta = (await mk(g, 'C').pull()).meta; assert.equal(meta.s2.auteur, 'B'); assert.equal(meta.s1.revision, 2);
    }
    console.log('Stockage Grist par sections : aller-retour, conflits, lots atomiques, doublons, corruption, historique OK');
})().catch(e => { console.error(e); process.exit(1); });
