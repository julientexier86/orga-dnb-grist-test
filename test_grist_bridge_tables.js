/* Pont en mode tables, dans un DOM simulé, contre le simulateur de Grist. Données FICTIVES uniquement. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const R = require('./js/grist_rows.js'), M = require('./js/grist_tables.js'), Store = require('./js/grist_store.js');
const { fakeGrist } = require('./test_fake_grist_rows.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, label, ms = 9000) { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return; await sleep(25); } throw new Error('Délai dépassé : ' + label + ' / panneaux : ' + (globalThis.__w ? globalThis.__w.document.body.textContent.slice(0, 400) : '')); }

function lancer(grist, projetLocal) {
    const dom = new JSDOM('<body><iframe></iframe></body>', { runScripts: 'outside-only', url: 'https://exemple.invalid/' });
    const w = dom.window.document.querySelector('iframe').contentWindow;
    w.eval('var DB = ' + JSON.stringify(projetLocal) + '; function autoSave(){}');
    w.eval('function escapeHTML(s){return String(s)}; var confirms=[]; function showConfirm(m,ok,no){ confirms.push({m,ok,no}); }');
    w.eval('var chargements=0; function loadGlobalData(f,cb){ const r=new FileReader(); r.onload=e=>{ DB=JSON.parse(e.target.result); chargements++; cb&&cb(); }; r.readAsText(f); }');
    Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true });
    w.TextEncoder = TextEncoder; w.File = dom.window.File; w.FileReader = dom.window.FileReader;
    for (const f of ['grist_store.js', 'grist_tables.js', 'grist_rows.js', 'grist_bridge_tables.js']) w.eval(fs.readFileSync('./js/' + f, 'utf8'));
    const head = w.document.head, orig = head.appendChild.bind(head);
    head.appendChild = el => { if (el.tagName === 'SCRIPT') { w.grist = grist; setTimeout(() => el.onload && el.onload(), 0); return el; } return orig(el); };
    globalThis.__w = w;
    w.eval(fs.readFileSync('./js/grist_bridge.js', 'utf8'));
    return w;
}
const faux = g => { const c = g.client(); return { ready() {}, docApi: { listTables: c.listTables, fetchTable: c.fetchTable, applyUserActions: c.applyUserActions } }; };
const visibles = w => [...w.document.querySelectorAll('body > div')].filter(d => d.style.display !== 'none');
const titre = w => visibles(w).map(d => (d.querySelector('strong') || {}).textContent || '').join(' | ');
const boutons = w => visibles(w).flatMap(d => [...d.querySelectorAll('button')]).map(b => b.textContent);
const clic = (w, texte) => { const b = visibles(w).flatMap(d => [...d.querySelectorAll('button')]).find(x => x.textContent.includes(texte)); assert.ok(b, 'bouton introuvable : ' + texte + ' parmi ' + boutons(w)); b.click(); };
const confirmer = (w, oui = true) => w.eval('(function(){ const c = confirms.pop(); (' + oui + ' ? c.ok : c.no)(); })()');
const eleve = (id, x) => Object.assign({ id, nom: 'FICTIF', prenom: 'Alex' + id, classe: '3A', sexe: 'F', mef: 'X', anonymat: 'A' + id, tt: false, grades: { fr: 12, math: 0, hg: null } }, x || {});
const projet = () => ({ config: { schoolName: 'Collège fictif', logo: 'data:' + 'L'.repeat(120000) }, students: [eleve('e1'), eleve('e2'), eleve('e3')],
    rooms: [{ id: 'r1', nom: 'Salle 1', capacite: 30, isTT: false, isAmen: false, nbSurv: 2 }], teachers: [{ id: 't1', civ: 'Mme', nom: 'TEST', prenom: 'Morgan', matiere: 'Maths' }],
    distribution: { 'Salle 1': [] }, planning: { '0_Salle 1_std_0_0': 'TEST Morgan' }, uiState: { locked: { students: false } }, exams: [] });
const ligne = (g, t, cle) => g.tables[t].find(x => x.Cle === cle);
const revBlocs = g => g.tables.DNB_Sections.map(s => s.Cle + ':' + s.Revision).sort().join();
const vide = { students: [], rooms: [] };

(async () => {
    // 1. Document en blocs, synchronisé ; bascule explicite vers les tables
    const g = fakeGrist(), w = lancer(faux(g), projet());
    await until(() => /à initialiser/.test(titre(w)), 'à initialiser'); clic(w, 'Initialiser');
    await until(() => /Grist vide/.test(titre(w)), 'vide'); clic(w, 'Publier le projet local');
    await until(() => /synchronisé/.test(titre(w)), 'synchronisé (blocs)');
    assert.ok(!g.tables[M.T.ELEVES], 'aucune table structurée avant la bascule');
    clic(w, 'Passer aux tables'); confirmer(w, false); await sleep(50); assert.ok(!g.tables[M.T.ELEVES], 'annuler ne fait rien');
    clic(w, 'Passer aux tables'); confirmer(w);
    await until(() => /synchronisé \(tables\)/.test(titre(w)), 'synchronisé (tables)');
    assert.equal(await R.lireMode(g.client()), 'tables'); assert.ok((await R.verify(g.client())).ok);
    assert.equal(g.tables[M.T.ELEVES].filter(x => x.Cle !== '_sonde').length, 3);
    assert.ok(M.deepEqual((await R.createRowStore(g.client()).pull()).db, projet()), 'les tables contiennent exactement le projet');
    const archive = revBlocs(g);

    // 2. Modification locale : une seule ligne part, les blocs (archive) ne bougent plus
    const n0 = g.log.length;
    w.eval('DB.students[1].classe = "3B"; autoSave();');
    await until(() => ligne(g, M.T.ELEVES, 'e2').Classe === '3B', 'envoi automatique');
    assert.equal(g.log.slice(n0).flat().filter(a => a[0] !== 'AddRecord' || a[1] !== M.T.ELEVES).length, 1, 'une seule action'); assert.equal(revBlocs(g), archive, 'archive en blocs intacte');

    // 3. Un second utilisateur ouvre le document : il reçoit le projet depuis les tables
    const w2 = lancer(faux(g), vide);
    await until(() => /synchronisé \(tables\)/.test(titre(w2)), 'second utilisateur');
    assert.equal(w2.eval('DB.students[1].classe'), '3B'); assert.equal(w2.eval('chargements'), 1);

    // 4. Deux utilisateurs, deux élèves différents : aucun conflit ; chacun récupère la modification de l'autre
    w.eval('DB.students[0].prenom = "Ana"; autoSave();'); w2.eval('DB.students[2].tt = true; autoSave();');
    await until(() => ligne(g, M.T.ELEVES, 'e1').Prenom === 'Ana' && ligne(g, M.T.ELEVES, 'e3').Tiers_temps === true, 'deux envois');
    assert.ok(!/conflit/.test(titre(w) + titre(w2)));
    await w.DnbPontTables._verifier(); await until(() => boutons(w).some(b => /Charger les modifications/.test(b)), 'modifications disponibles');
    clic(w, 'Charger les modifications'); await until(() => w.eval('DB.students[2].tt') === true, 'modification de l’autre chargée');
    assert.equal(w.eval('DB.students[0].prenom'), 'Ana');

    // 5. Saisie directe dans Grist : jamais annulée par mon envoi suivant, puis chargée dans l'application
    await g.client().applyUserActions([['UpdateRecord', M.T.SALLES, ligne(g, M.T.SALLES, 'r1').id, { Capacite: 28 }]]);
    w.eval('DB.teachers[0].matiere = "Physique"; autoSave();');
    await until(() => ligne(g, M.T.ENS, 't1').Discipline === 'Physique', 'envoi après saisie Grist');
    assert.equal(ligne(g, M.T.SALLES, 'r1').Capacite, 28, 'la saisie faite dans Grist n’est pas écrasée'); assert.equal(w.eval('DB.rooms[0].capacite'), 30);
    await until(() => boutons(w).some(b => /Charger les modifications/.test(b)), 'saisie Grist signalée'); clic(w, 'Charger les modifications');
    await until(() => w.eval('DB.rooms[0].capacite') === 28, 'saisie Grist chargée'); assert.equal(w.eval('DB.teachers[0].matiere'), 'Physique');

    // 6. Même cellule des deux côtés : conflit affiché, rien d'écrasé ; « Garder la mienne » puis « Prendre la version de Grist »
    await g.client().applyUserActions([['UpdateRecord', M.T.SALLES, ligne(g, M.T.SALLES, 'r1').id, { Capacite: 20 }]]);
    w.eval('DB.rooms[0].capacite = 25; autoSave();');
    await until(() => /conflit/.test(titre(w)), 'conflit'); assert.equal(ligne(g, M.T.SALLES, 'r1').Capacite, 20); assert.equal(w.eval('DB.rooms[0].capacite'), 25);
    clic(w, 'Garder la mienne'); await until(() => ligne(g, M.T.SALLES, 'r1').Capacite === 25 && /synchronisé/.test(titre(w)), 'garder la mienne');
    await g.client().applyUserActions([['UpdateRecord', M.T.SALLES, ligne(g, M.T.SALLES, 'r1').id, { Capacite: 22 }]]);
    w.eval('DB.rooms[0].capacite = 26; autoSave();'); await until(() => /conflit/.test(titre(w)), 'conflit 2');
    clic(w, 'Prendre la version de Grist'); await until(() => w.eval('DB.rooms[0].capacite') === 22 && /synchronisé/.test(titre(w)), 'prendre Grist'); assert.equal(ligne(g, M.T.SALLES, 'r1').Capacite, 22);

    // 7. Fichier importé dans l'application : pas de publication automatique
    const n7 = g.log.length;
    w.eval('loadGlobalData(new File([JSON.stringify({students:[{id:"z1",nom:"IMPORT"}],rooms:[]})],"x.data"))');
    await until(() => /projet local/.test(titre(w)), 'import détecté'); w.eval('autoSave()'); await sleep(3600);
    assert.equal(g.log.length, n7, 'aucune écriture après un import'); assert.equal(ligne(g, M.T.ELEVES, 'e1').Supprime, false);
    clic(w, 'Recharger depuis Grist'); await until(() => /synchronisé/.test(titre(w)) && w.eval('DB.students.length') === 3, 'retour à Grist');

    // 8. Protection abîmée : aucune écriture, réparation proposée
    { const h = fakeGrist(); await R.install(h.client()); const s = R.createRowStore(h.client()); await s.push(projet(), (await s.pull()).etat); await R.ecrireMode(h.client(), 'tables');
      const res = h.tables._grist_ACLResources.find(x => x.tableId === M.T.ELEVES); h.tables._grist_ACLRules = h.tables._grist_ACLRules.filter(x => x.resource !== res.id);
      const n = h.log.length, w8 = lancer(faux(h), vide); await until(() => /non protégées/.test(titre(w8)), 'tables non protégées'); assert.equal(h.log.length, n); assert.equal(w8.eval('chargements'), 0);
      clic(w8, 'Réparer'); await until(() => /synchronisé \(tables\)/.test(titre(w8)), 'réparé'); assert.equal(w8.eval('DB.students.length'), 3); }

    // 9. Retour aux blocs : le projet est publié dans les blocs, la marque change, le pont des blocs reprend
    clic(w, 'Revenir aux blocs'); confirmer(w);
    await until(async () => (await R.lireMode(g.client())) === 'blocs', 'marque blocs'); assert.notEqual(revBlocs(g), archive, 'les blocs ont reçu le projet courant');
    const w9 = lancer(faux(g), vide); await until(() => /synchronisé$/.test(titre(w9).trim()), 'pont des blocs'); assert.equal(w9.eval('DB.rooms[0].capacite'), 22);
    console.log('Pont Grist (tables) : bascule, envoi minimal, second utilisateur, saisie Grist, conflits, import, protection, retour aux blocs OK');
    process.exit(0); // les ponts programment une vérification périodique
})().catch(e => { console.error(e); process.exit(1); });
