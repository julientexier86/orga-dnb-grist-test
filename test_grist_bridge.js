/* Test du pont Grist dans un DOM simulé (iframe), contre le simulateur de Grist. Données fictives uniquement. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const Store = require('./js/grist_store.js');
const { fakeGrist } = require('./test_fake_grist.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, label, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return; await sleep(20); } throw new Error('Délai dépassé : ' + label + ' / panneau : ' + (globalThis.__w ? globalThis.__w.document.body.textContent.slice(0, 300) : '')); }

function lancer(grist, projetLocal) {
    const dom = new JSDOM('<body><iframe></iframe></body>', { runScripts: 'outside-only', url: 'https://exemple.invalid/' });
    const w = dom.window.document.querySelector('iframe').contentWindow;
    w.eval('var DB = ' + JSON.stringify(projetLocal) + '; var autoSaveCalls = 0; function autoSave(){ autoSaveCalls++; }');
    w.eval('function escapeHTML(s){return String(s)}; var confirms=[]; function showConfirm(m,ok,no){ confirms.push({m,ok,no}); }');
    w.eval('var chargements=[]; function loadGlobalData(f,cb){ const r=new FileReader(); r.onload=e=>{ DB=JSON.parse(e.target.result); chargements.push(1); cb&&cb(); }; r.readAsText(f); }');
    Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true });
    w.TextEncoder = TextEncoder;
    w.File = dom.window.File; w.FileReader = dom.window.FileReader;
    w.eval(fs.readFileSync('./js/grist_store.js', 'utf8'));
    // Aucune ressource réseau : on remplace le chargement du script de l'API Grist par un faux objet `grist`.
    const head = w.document.head, orig = head.appendChild.bind(head);
    head.appendChild = el => { if (el.tagName === 'SCRIPT') { w.grist = grist; setTimeout(() => el.onload && el.onload(), 0); return el; } return orig(el); };
    globalThis.__w = w;
    w.eval(fs.readFileSync('./js/grist_bridge.js', 'utf8'));
    return w;
}
const faux = g => { const c = g.client(); return { ready() {}, docApi: { listTables: c.listTables, fetchTable: c.fetchTable, applyUserActions: c.applyUserActions } }; };
const titre = w => (w.document.querySelector('strong') || {}).textContent || '';
const boutons = w => [...w.document.querySelectorAll('button')].map(b => b.textContent);
const clic = (w, texte) => { const b = [...w.document.querySelectorAll('button')].find(x => x.textContent.includes(texte)); assert.ok(b, 'bouton introuvable : ' + texte + ' parmi ' + boutons(w)); b.click(); };
const grandProjet = () => ({ config: { schoolName: 'Collège fictif', year: '2026', logo: 'data:image/png;base64,' + 'A'.repeat(100000) }, students: [{ id: 'E1', nom: 'FICTIF' }], rooms: [{ id: 'R1', nom: 'Salle 1' }], teachers: [], distribution: {}, uiState: { locked: { students: false } } });

(async () => {
    // 1. Document sans protection : aucune écriture, bouton d'initialisation proposé
    {
        const g = fakeGrist(), w = lancer(faux(g), grandProjet());
        await until(() => /non protégé/.test(titre(w)), 'mode non protégé');
        assert.equal(g.log.length, 0, 'aucune écriture avant vérification de la protection');
        assert.ok(boutons(w).some(b => /Initialiser/.test(b)));
        // 2. Initialisation par le propriétaire, puis Grist vide : le projet local n'est PAS envoyé automatiquement
        clic(w, 'Initialiser');
        await until(() => /Grist vide/.test(titre(w)), 'mode Grist vide');
        assert.equal(g.tables.DNB_Sections.length, 0, 'rien publié sans action explicite');
        // 3. Publication explicite
        clic(w, 'Publier le projet local');
        await until(() => /synchronisé/.test(titre(w)), 'mode synchronisé');
        assert.ok(g.tables.DNB_Sections.length >= 4);
        // 4. Modification locale + autoSave : publication automatique d'UNE seule section
        const avant = g.tables.DNB_Sections.map(s => s.Revision).join();
        w.eval('DB.students.push({id:"E2",nom:"FICTIF2"}); autoSave();');
        await until(() => g.tables.DNB_Sections.find(s => s.Cle === 'students').Revision === 2, 'publication automatique', 8000);
        assert.equal(g.tables.DNB_Sections.filter(s => s.Revision === 2).length, 1);
        assert.notEqual(g.tables.DNB_Sections.map(s => s.Revision).join(), avant);
        // 5. Un autre utilisateur modifie la même section : mon prochain envoi est refusé, mes données restent
        const autre = Store.createStore(g.client(), { auteur: 'Autre' });
        const lu = await autre.pull();
        const r = await autre.push({ students: [{ id: 'X', nom: 'DE_L_AUTRE' }] }, lu.baseline); assert.ok(r.committed);
        w.eval('DB.students.push({id:"E3",nom:"FICTIF3"}); autoSave();');
        await until(() => /conflit/.test(titre(w)), 'mode conflit', 8000);
        assert.equal(w.eval('DB.students.length'), 3, 'données locales intactes après refus');
        assert.deepEqual((await autre.pull()).sections.students.map(s => s.id), ['X'], 'version de l’autre non écrasée');
        // 6. « Garder la mienne » : publie mes modifications sur la révision actuelle
        clic(w, 'Garder la mienne');
        await until(() => /synchronisé/.test(titre(w)), 'retour synchronisé');
        assert.deepEqual((await autre.pull()).sections.students.map(s => s.id), ['E1', 'E2', 'E3']);
    }
    // 7. « Prendre leur version » charge seulement la section en conflit
    {
        const g = fakeGrist(), w = lancer(faux(g), grandProjet());
        await until(() => /non protégé/.test(titre(w)), 'init');
        clic(w, 'Initialiser'); await until(() => /Grist vide/.test(titre(w)), 'vide');
        clic(w, 'Publier le projet local'); await until(() => /synchronisé/.test(titre(w)), 'sync');
        const autre = Store.createStore(g.client(), { auteur: 'Autre' }); const lu = await autre.pull();
        await autre.push({ students: [{ id: 'X' }] }, lu.baseline);
        w.eval('DB.students.push({id:"E9"}); DB.rooms.push({id:"R2",nom:"Salle 2"}); autoSave();');
        await until(() => /conflit/.test(titre(w)), 'conflit');
        clic(w, 'Prendre leur version'); await until(() => /synchronisé/.test(titre(w)), 'resync');
        assert.deepEqual(JSON.parse(w.eval('JSON.stringify(DB.students.map(s=>s.id))')), ['X'], 'section en conflit remplacée par la leur');
        assert.equal(w.eval('DB.rooms.length'), 2, 'les autres sections locales sont conservées');
    }
    // 8. Projet vide localement + projet dans Grist : chargé automatiquement ; projet local ouvert : confirmation demandée
    {
        const g = fakeGrist(); const seed = Store.createStore(g.client(), { auteur: 'Seed' });
        await seed.push(Store.splitDb(grandProjet()), {});
        await Store.installProtection(g.client());
        const w1 = lancer(faux(g), { config: {}, students: [], rooms: [], teachers: [] });
        await until(() => /synchronisé/.test(titre(w1)), 'chargement automatique');
        assert.equal(w1.eval('DB.students.length'), 1);
        const w2 = lancer(faux(g), grandProjet());
        await until(() => /non synchronisé/.test(titre(w2)) && w2.eval('confirms.length') === 1, 'confirmation demandée');
        assert.equal(w2.eval('chargements.length'), 0, 'aucun remplacement sans confirmation');
        assert.equal(g.log.length > 0, true);
    }
    // 9. Lecteur seul (écriture refusée sans conflit) : message de droits, pas de faux conflit
    {
        const g = fakeGrist(); await Store.installProtection(g.client());
        const api = faux(g); const w = lancer(api, grandProjet());
        await until(() => /Grist vide/.test(titre(w)), 'vide');
        const reel = api.docApi.applyUserActions; let n = 0;
        api.docApi.applyUserActions = async a => { if (a.some(x => x[0] === 'UpdateRecord' && x[1] === 'DNB_Sections' && x[3].Revision === 1)) throw new Error('Blocked by row update access rules'); return reel(a); };
        // la mise à jour de section est refusée alors qu'aucune révision n'a bougé → « droits », pas « conflit »
        clic(w, 'Publier le projet local'); await until(() => /erreur/.test(titre(w)), 'erreur droits');
        assert.match(w.document.body.textContent, /droits insuffisants/);
    }
    // 10. Section illisible : aucune écriture automatique, mais deux issues proposées (plus d'impasse)
    {
        const g = fakeGrist(); await Store.installProtection(g.client());
        const seed = Store.createStore(g.client(), { auteur: 'Seed' });
        await seed.push(Store.splitDb(grandProjet()), {});
        const ch = g.tables.DNB_Morceaux.find(m => m.Cle_section === 'rooms'); ch.Contenu = ch.Contenu.slice(0, -3) + 'XXX';
        const ecrituresAvant = g.log.length;
        const w = lancer(faux(g), grandProjet());
        await until(() => /illisible/.test(titre(w)), 'mode illisible');
        assert.equal(g.log.length, ecrituresAvant, 'aucune écriture automatique');
        assert.ok(boutons(w).some(b => /Charger les sections lisibles/.test(b)) && boutons(w).some(b => /Publier le projet local/.test(b)), 'deux issues proposées : ' + boutons(w));
        // issue 1 : charger le lisible
        clic(w, 'Charger les sections lisibles'); await until(() => /synchronisé/.test(titre(w)), 'chargement du lisible');
        assert.equal(w.eval('DB.students.length'), 1);
        assert.equal(w.eval('DB.rooms.length'), 1, 'la section illisible garde sa valeur locale (pas de clé manquante)');
        // une section illisible ne doit pas être signalée comme « modifiée par un autre » après un envoi
        w.eval('DB.students.push({id:"E9",nom:"FICTIF9"}); autoSave();');
        await until(() => g.tables.DNB_Sections.find(s => s.Cle === 'students').Revision === 2, 'envoi après chargement partiel', 8000);
        await sleep(300);
        assert.ok(!boutons(w).some(b => /Charger \d+ section/.test(b)), 'faux signal « modifié par un autre » : ' + boutons(w));
        // issue 2 (nouvelle ouverture) : publier le projet local répare la section
        const w2 = lancer(faux(g), grandProjet());
        await until(() => /illisible/.test(titre(w2)), 'mode illisible 2');
        clic(w2, 'Publier le projet local'); await until(() => w2.eval('confirms.length') === 1, 'confirmation');
        w2.eval('confirms[0].ok()'); await until(() => /synchronisé/.test(titre(w2)), 'réparé');
        assert.equal((await Store.createStore(g.client(), { auteur: 'V' }).pull()).problems.length, 0, 'plus aucune section illisible');
    }
    // 11. Restauration depuis l'interface : section illisible dont une révision antérieure est saine
    {
        const g = fakeGrist(); await Store.installProtection(g.client());
        const seed = Store.createStore(g.client(), { auteur: 'Seed' });
        const p1 = grandProjet(); let base = (await seed.push(Store.splitDb(p1), {})).baseline;
        const p2 = grandProjet(); p2.rooms = [{ id: 'R1', nom: 'Salle 1' }, { id: 'R2', nom: 'Salle 2' }];
        assert.ok((await seed.push(Store.splitDb(p2), base)).committed);                       // rooms : révision 2 (2 salles)
        const ch = g.tables.DNB_Morceaux.find(m => m.Cle_section === 'rooms' && m.Revision_cible === 2); ch.Contenu += 'X';   // révision courante abîmée
        const w = lancer(faux(g), grandProjet());
        await until(() => /illisible/.test(titre(w)), 'mode illisible');
        clic(w, 'Restaurer une version'); await until(() => /historique/.test(titre(w)), 'écran historique');
        const lignes = boutons(w); assert.ok(lignes.some(b => /Révision 1/.test(b)) && lignes.some(b => /Révision 2 \(actuelle\)/.test(b)), 'révisions listées : ' + lignes);
        assert.ok([...w.document.querySelectorAll('button')].find(b => /Révision 2/.test(b.textContent)).disabled, 'la révision courante n’est pas restaurable');
        const avant = g.log.length;
        clic(w, 'Révision 1'); await until(() => w.eval('confirms.length') >= 1, 'confirmation demandée');
        assert.equal(g.log.length, avant, 'rien n’est écrit avant confirmation');
        w.eval('confirms[confirms.length-1].ok()');
        await until(() => /synchronisé/.test(titre(w)), 'restauré');
        assert.equal(w.eval('DB.rooms.length'), 1, 'la version 1 (1 salle) est chargée dans l’application');
        assert.equal((await Store.createStore(g.client(), { auteur: 'V' }).pull()).problems.length, 0, 'section réparée');
        assert.equal(g.tables.DNB_Sections.find(s => s.Cle === 'rooms').Revision, 3, 'restauration = nouvelle révision');
    }
    console.log('Pont Grist : protection exigée, publication explicite, envoi automatique, conflits, rechargement partiel, droits, sections illisibles, restauration OK');
    process.exit(0); // le pont programme une vérification périodique : on quitte explicitement
})().catch(e => { console.error(e); process.exit(1); });
