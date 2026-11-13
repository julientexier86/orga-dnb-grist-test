/* Orga Exam — stockage Grist par lignes (les tables structurées sont la source de vérité).
 *
 * S'appuie sur grist_tables.js (encode/decode). Chaque ligne porte :
 *   Revision  : +1 à chaque modification, par formule de déclenchement (aussi pour une saisie humaine dans Grist) ;
 *   Base/Jeton: l'application écrit Jeton neuf + Base = révision lue ; la règle d'accès refuse si Base est périmée ;
 *   Supprime  : on ne supprime jamais physiquement (règle -D) ; une suppression est une modification.
 * DNB_Etat (une ligne, colonnes calculées) donne la somme des révisions de chaque table : elle ne peut que croître,
 * donc elle sert à la fois à savoir quelles tables relire et à vérifier qu'une lecture multi-tables est cohérente.
 *
 * Ce que ce module ne garantit pas : l'unicité d'une clé à la création (deux créations simultanées donnent un
 * doublon, signalé à la lecture ; la ligne de plus petit numéro fait foi) ; l'atomicité d'un envoi trop gros pour
 * une seule requête (découpé en lots ; un refus en cours de route est signalé « partiel »).
 */
(function (root) {
    'use strict';
    const M = (typeof module !== 'undefined' && module.exports) ? require('./grist_tables.js') : root.DnbTables;
    const T_ETAT = 'DNB_Etat';
    const TABLES = M.SCHEMA.map(s => s.table);
    const REGLE_U = 'newRec.Jeton != rec.Jeton and newRec.Base != rec.Revision';
    const REGLE_S = 'user.Access != OWNER';   // seul le propriétaire modifie la structure (tables, colonnes, formules)
    const FORMULE_REV = '(value or 0) + 1';
    const TECH = new Set(['Cle', 'Base', 'Jeton', 'Revision']);
    const SONDE = '_sonde', MARQUE = '_stockage';   // lignes techniques : jamais lues comme données, jamais touchées par un envoi
    const technique = cle => cle === SONDE || cle === MARQUE;
    const LOT_MAX = 600000;   // octets sérialisés ; limite mesurée de l'instance : ~1 Mo par requête
    const colEtat = t => 'S_' + t.slice(4);
    const formuleEtat = t => 'SUM(r.Revision for r in ' + t + '.lookupRecords())';
    const refus = e => /access rules|Blocked by/i.test(String(e && e.message || e));
    const octets = x => new TextEncoder().encode(JSON.stringify(x)).length;
    const jeton = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

    function rowsOf(cols) { const ids = cols.id || []; return ids.map((id, i) => { const r = { id }; for (const k of Object.keys(cols)) if (k !== 'id') r[k] = cols[k][i]; return r; }); }
    const colonnesDonnees = t => M.SCHEMA.find(s => s.table === t).colonnes.filter(([c]) => !TECH.has(c));
    /* Égalité de cellule : vide (null, '', 0, false) contre vide est égal ; sinon comparaison stricte. */
    function egal(type, a, b) { const va = M.estVide(type, a), vb = M.estVide(type, b); return (va && vb) || (!va && !vb && a === b); }
    const valeurs = (t, r) => { const o = {}; for (const [c] of colonnesDonnees(t)) o[c] = r[c] === undefined ? null : r[c]; return o; };

    function createRowStore(api) {
        let cache = { sig: null, lignes: {} };

        async function lireEtat() {
            const r = rowsOf(await api.fetchTable(T_ETAT))[0];
            if (!r) throw new Error('DNB_Etat est vide : stockage à initialiser.');
            const sig = {}; for (const t of TABLES) sig[t] = Number(r[colEtat(t)]) || 0; return sig;
        }
        const memeSig = (a, b) => !!a && !!b && TABLES.every(t => a[t] === b[t]);

        /* Lecture cohérente : on ne relit que les tables dont la signature a bougé, puis on vérifie qu'elle n'a pas
         * bougé pendant la lecture. */
        async function pull(essais = 4) {
            for (let n = 0; n < essais; n++) {
                const avant = await lireEtat();
                const lignes = {};
                for (const t of TABLES) {
                    if (cache.sig && cache.sig[t] === avant[t] && cache.lignes[t]) { lignes[t] = cache.lignes[t]; continue; }
                    const cols = await api.fetchTable(t);
                    const masquees = M.SCHEMA.find(x => x.table === t).colonnes.map(c => c[0]).filter(c => !(c in cols));
                    if (masquees.length) { const e = new Error('Ce compte ne voit pas toutes les colonnes de ' + t + ' (' + masquees.slice(0, 3).join(', ') + '…) : l’application ne peut pas être chargée. Consultez les tables directement dans Grist.'); e.lectureRestreinte = true; throw e; }
                    lignes[t] = rowsOf(cols);
                }
                const apres = await lireEtat();
                if (!memeSig(avant, apres)) continue;
                cache = { sig: apres, lignes };
                return construire(lignes, apres);
            }
            throw new Error('Lecture instable : le document change en continu. Réessayez dans un instant.');
        }
        function construire(lignes, sig) {
            const etat = {}, pour = {}, problems = [];
            for (const t of TABLES) {
                etat[t] = new Map(); pour[t] = [];
                for (const r of lignes[t].slice().sort((a, b) => (a.Supprime ? 1 : 0) - (b.Supprime ? 1 : 0) || a.id - b.id)) {   // une ligne vivante passe avant une ligne supprimée
                    const cle = String(r.Cle);
                    if (technique(cle)) continue;
                    if (etat[t].has(cle)) { if (!r.Supprime) problems.push({ table: t, cle, id: r.id, motif: 'doublon de clé : la ligne n°' + etat[t].get(cle).id + ' fait foi' }); continue; }
                    etat[t].set(cle, { id: r.id, Revision: Number(r.Revision) || 0, vals: valeurs(t, r) });
                    pour[t].push(Object.assign({ Cle: cle }, valeurs(t, r)));
                }
            }
            return { db: M.decode(pour), etat, sig, problems };
        }
        /* Y a-t-il du nouveau dans Grist depuis `sig` ? (une seule petite lecture) */
        async function changed(sig) { const s = await lireEtat(); return TABLES.filter(t => s[t] !== sig[t]); }

        /* Différences entre l'état voulu (db) et l'état lu (etat) -> actions. */
        function differences(db, etat) {
            const cible = M.encode(db), actions = [], j = jeton(); let n = 0;
            for (const t of TABLES) {
                const types = M.TYPES[t], vues = new Set(), ajouts = [];
                for (const row of cible[t] || []) {
                    const cle = String(row.Cle); vues.add(cle);
                    const v = valeurs(t, Object.assign({ Supprime: false }, row));
                    const e = etat[t].get(cle);
                    if (!e) { ajouts.push(Object.assign({ Cle: cle, Base: 0, Jeton: j }, v)); continue; }
                    const maj = {}; for (const c of Object.keys(v)) if (!egal(types[c], v[c], e.vals[c])) maj[c] = v[c];
                    if (Object.keys(maj).length) { actions.push(['UpdateRecord', t, e.id, Object.assign(maj, { Base: e.Revision, Jeton: j })]); n++; }
                }
                for (const [cle, e] of etat[t]) if (!vues.has(cle) && !e.vals.Supprime) { actions.push(['UpdateRecord', t, e.id, { Supprime: true, Base: e.Revision, Jeton: j }]); n++; }
                for (const a of ajouts) { actions.push(['AddRecord', t, null, a]); n++; }
            }
            return { actions, n };
        }
        function lots(actions) {
            const out = []; let lot = [], taille = 0;
            for (const a of actions) { const o = octets(a); if (lot.length && taille + o > LOT_MAX) { out.push(lot); lot = []; taille = 0; } lot.push(a); taille += o; }
            if (lot.length) out.push(lot); return out;
        }

        /* Envoi : uniquement les lignes modifiées. Refus = quelqu'un a modifié une de ces lignes entre-temps. */
        async function push(db, etat) {
            const { actions, n } = differences(db, etat);
            if (!n) return { ok: true, n: 0 };
            const ls = lots(actions);
            for (let i = 0; i < ls.length; i++) {
                try { await api.applyUserActions(ls[i]); }
                catch (e) { if (refus(e)) return { ok: false, conflit: true, partiel: i > 0, lots: ls.length }; throw e; }
            }
            return { ok: true, n, lots: ls.length };
        }

        /* Fusion à trois, colonne par colonne : base (ce que j'avais lu), local (mon projet), distant (Grist maintenant).
         * Conflit = la même cellule modifiée des deux côtés avec des valeurs différentes. priorite : 'distant' | 'local'. */
        function fusion(baseEtat, dbLocal, distantEtat, priorite) {
            const local = M.encode(dbLocal), conflits = [], pour = {};
            for (const t of TABLES) {
                const types = M.TYPES[t], L = new Map((local[t] || []).map(r => [String(r.Cle), valeurs(t, Object.assign({ Supprime: false }, r))]));
                const cles = new Set([...L.keys(), ...distantEtat[t].keys()]); pour[t] = [];
                for (const cle of cles) {
                    const b = baseEtat[t].get(cle), r = distantEtat[t].get(cle); let l = L.get(cle);
                    if (!l && b) l = Object.assign({}, b.vals, { Supprime: true });          // supprimée chez moi
                    if (!l) { pour[t].push(Object.assign({ Cle: cle }, r.vals)); continue; }   // créée par un autre
                    if (!r) { pour[t].push(Object.assign({ Cle: cle }, l)); continue; }        // créée par moi
                    // absente de ma base et marquée supprimée dans Grist : pour moi elle n'existait pas, donc je la (re)crée
                    // sans conflit (cas d'une ligne supprimée puis recréée, par exemple après une bascule)
                    if (!b && r.vals.Supprime) { pour[t].push(Object.assign({ Cle: cle }, l)); continue; }
                    const out = { Cle: cle };
                    for (const [c] of colonnesDonnees(t)) {
                        const vb = b ? b.vals[c] : null, vl = l[c], vr = r.vals[c];
                        if (egal(types[c], vl, vr)) out[c] = vr;
                        else if (b && egal(types[c], vl, vb)) out[c] = vr;
                        else if (b && egal(types[c], vr, vb)) out[c] = vl;
                        else { conflits.push({ table: t, cle, colonne: c }); out[c] = priorite === 'local' ? vl : vr; }
                    }
                    pour[t].push(out);
                }
            }
            return { db: M.decode(pour), conflits };
        }
        const vide = etat => TABLES.every(t => [...etat[t].values()].every(e => e.vals.Supprime));
        return { pull, push, changed, differences, fusion, vide };
    }

    /* Instantané d'un projet, au même format qu'un état lu (sans numéros de ligne ni révisions) : sert de base à la fusion. */
    function instantane(db) {
        const e = M.encode(db), out = {};
        for (const t of TABLES) out[t] = new Map((e[t] || []).map(r => [String(r.Cle), { vals: valeurs(t, Object.assign({ Supprime: false }, r)) }]));
        return out;
    }
    /* Nombre de lignes qui diffèrent entre deux projets. */
    function ecart(dbA, dbB) {
        const a = instantane(dbA), b = instantane(dbB); let n = 0;
        for (const t of TABLES) { const types = M.TYPES[t];
            for (const cle of new Set([...a[t].keys(), ...b[t].keys()])) { const x = a[t].get(cle), y = b[t].get(cle);
                if (!x || !y || Object.keys(x.vals).some(c => !egal(types[c], x.vals[c], y.vals[c]))) n++; } }
        return n;
    }
    /* Marque du mode de stockage actif ('tables' ou 'blocs'), écrite en dernier lors d'une bascule. */
    async function lireMode(api) {
        let rows; try { rows = rowsOf(await api.fetchTable(M.T.PARAMS)); } catch (e) { return null; }
        const m = rows.filter(r => r.Cle === MARQUE).sort((x, y) => x.id - y.id)[0];
        return m ? String(m.Valeur || '') : null;
    }
    async function ecrireMode(api, mode) {
        const m = rowsOf(await api.fetchTable(M.T.PARAMS)).filter(r => r.Cle === MARQUE).sort((x, y) => x.id - y.id)[0];
        if (!m) await api.applyUserActions([['AddRecord', M.T.PARAMS, null, { Cle: MARQUE, Valeur: mode, Supprime: true, Base: 0, Jeton: jeton() }]]);
        else await api.applyUserActions([['UpdateRecord', M.T.PARAMS, m.id, { Valeur: mode, Base: Number(m.Revision) || 0, Jeton: jeton() }]]);
    }

    /* ---------- Installation et vérification (propriétaire) ---------- */
    async function meta(api) {
        const tables = rowsOf(await api.fetchTable('_grist_Tables')), cols = rowsOf(await api.fetchTable('_grist_Tables_column'));
        const res = rowsOf(await api.fetchTable('_grist_ACLResources')), rules = rowsOf(await api.fetchTable('_grist_ACLRules'));
        const idTable = new Map(tables.map(t => [t.tableId, t.id]));
        const col = (t, c) => cols.find(x => x.parentId === idTable.get(t) && x.colId === c);
        return { idTable, col, res, rules };
    }
    /* Vérification sur les métadonnées : tables, colonnes, formule de révision, règles. */
    async function verify(api) {
        let m; try { m = await meta(api); } catch (e) { return { ok: false, manques: ['métadonnées illisibles : ' + (e.message || e)], lisible: false }; }
        const manques = [];
        for (const { table, colonnes } of M.SCHEMA) {
            if (!m.idTable.has(table)) { manques.push('table ' + table); continue; }
            for (const [c] of colonnes) if (!m.col(table, c)) manques.push('colonne ' + table + '.' + c);
            const rev = m.col(table, 'Revision');
            if (rev && !(rev.recalcWhen === 2 && rev.formula === FORMULE_REV && !rev.isFormula)) manques.push('révision automatique de ' + table);
            const r = m.res.find(x => x.tableId === table && x.colIds === '*');
            const rs = r ? m.rules.filter(x => x.resource === r.id) : [];
            if (!rs.some(x => x.aclFormula === REGLE_U && x.permissionsText === '-U')) manques.push('règle de version de ' + table);
            if (!rs.some(x => !x.aclFormula && x.permissionsText === '-D')) manques.push('règle anti-suppression de ' + table);
        }
        const tout = m.res.find(x => x.tableId === '*' && x.colIds === '*');
        if (!tout || !m.rules.some(x => x.resource === tout.id && x.aclFormula === REGLE_S && x.permissionsText === '-S')) manques.push('structure réservée au propriétaire');
        if (!m.idTable.has(T_ETAT)) manques.push('table ' + T_ETAT);
        else for (const t of TABLES) { const c = m.col(T_ETAT, colEtat(t)); if (!c || !c.isFormula || c.formula !== formuleEtat(t)) manques.push('signature de ' + t); }
        return { ok: manques.length === 0, manques, lisible: true };
    }
    /* Preuve en conditions réelles : sur une ligne-sonde de chaque table, une écriture périmée et une suppression
     * doivent être refusées. N'écrit rien d'autre que les lignes-sondes (marquées supprimées, invisibles pour l'application). */
    async function sonder(api) {
        const echecs = [];
        for (const t of TABLES) {
            let s = rowsOf(await api.fetchTable(t)).find(r => r.Cle === SONDE);
            if (!s) { await api.applyUserActions([['AddRecord', t, null, { Cle: SONDE, Supprime: true, Base: 0, Jeton: jeton() }]]); s = rowsOf(await api.fetchTable(t)).find(r => r.Cle === SONDE); }
            if (!(Number(s.Revision) >= 1)) echecs.push(t + ' : la révision ne démarre pas');
            try { await api.applyUserActions([['UpdateRecord', t, s.id, { Base: -1, Jeton: jeton() }]]); echecs.push(t + ' : écriture périmée acceptée'); } catch (e) { if (!refus(e)) throw e; }
            try { await api.applyUserActions([['RemoveRecord', t, s.id]]); echecs.push(t + ' : suppression acceptée'); continue; } catch (e) { if (!refus(e)) throw e; }
            const avant = Number((rowsOf(await api.fetchTable(t)).find(r => r.id === s.id) || {}).Revision);
            await api.applyUserActions([['UpdateRecord', t, s.id, { Base: avant, Jeton: jeton() }]]);
            const apres = Number((rowsOf(await api.fetchTable(t)).find(r => r.id === s.id) || {}).Revision);
            if (apres !== avant + 1) echecs.push(t + ' : la révision n\'augmente pas (' + avant + ' -> ' + apres + ')');
        }
        return { ok: echecs.length === 0, echecs };
    }
    async function install(api) {
        let m = await meta(api);
        // 1. tables et colonnes manquantes (jamais de suppression ni de changement de type)
        const creer = [];
        for (const { table, colonnes } of M.SCHEMA) {
            if (!m.idTable.has(table)) creer.push(['AddTable', table, colonnes.map(([id, type]) => ({ id, type }))]);
            else for (const [id, type] of colonnes) if (!m.col(table, id)) creer.push(['AddColumn', table, id, { type }]);
        }
        if (!m.idTable.has(T_ETAT)) creer.push(['AddTable', T_ETAT, TABLES.map(t => ({ id: colEtat(t), type: 'Int', isFormula: true, formula: formuleEtat(t) }))]);
        else for (const t of TABLES) if (!m.col(T_ETAT, colEtat(t))) creer.push(['AddColumn', T_ETAT, colEtat(t), { type: 'Int', isFormula: true, formula: formuleEtat(t) }]);
        if (creer.length) await api.applyUserActions(creer);
        // 2. révision automatique : AddTable ignore recalcWhen (mesuré), d'où un ModifyColumn explicite ; signatures
        const regler = [];
        for (const t of TABLES) regler.push(['ModifyColumn', t, 'Revision', { isFormula: false, formula: FORMULE_REV, recalcWhen: 2 }]);
        for (const t of TABLES) regler.push(['ModifyColumn', T_ETAT, colEtat(t), { isFormula: true, formula: formuleEtat(t) }]);
        await api.applyUserActions(regler);
        if (!rowsOf(await api.fetchTable(T_ETAT)).length) await api.applyUserActions([['AddRecord', T_ETAT, null, {}]]);
        // 3. règles d'accès, avant toute donnée
        m = await meta(api);
        const manquantes = [...TABLES, '*'].filter(t => !m.res.some(x => x.tableId === t && x.colIds === '*'));
        if (manquantes.length) { await api.applyUserActions(manquantes.map(t => ['AddRecord', '_grist_ACLResources', null, { tableId: t, colIds: '*' }])); m = await meta(api); }
        const regles = []; let pos = Math.max(0, ...m.rules.map(r => Number(r.rulePos) || 0));
        for (const t of TABLES) {
            const r = m.res.find(x => x.tableId === t && x.colIds === '*'), rs = m.rules.filter(x => x.resource === r.id);
            if (!rs.some(x => x.aclFormula === REGLE_U && x.permissionsText === '-U')) regles.push(['AddRecord', '_grist_ACLRules', null, { resource: r.id, aclFormula: REGLE_U, permissionsText: '-U', rulePos: ++pos }]);
            if (!rs.some(x => !x.aclFormula && x.permissionsText === '-D')) regles.push(['AddRecord', '_grist_ACLRules', null, { resource: r.id, aclFormula: '', permissionsText: '-D', rulePos: ++pos }]);
        }
        const tout = m.res.find(x => x.tableId === '*' && x.colIds === '*');
        if (!m.rules.some(x => x.resource === tout.id && x.aclFormula === REGLE_S && x.permissionsText === '-S')) regles.push(['AddRecord', '_grist_ACLRules', null, { resource: tout.id, aclFormula: REGLE_S, permissionsText: '-S', rulePos: ++pos }]);
        if (regles.length) await api.applyUserActions(regles);
        // 4. contrôle : métadonnées puis preuve réelle
        const v = await verify(api); if (!v.ok) return { ok: false, etape: 'vérification', details: v.manques };
        const s = await sonder(api); if (!s.ok) return { ok: false, etape: 'sonde', details: s.echecs };
        return { ok: true };
    }

    /* ---------- Droits des simples lecteurs (rôle « Lecteur » de Grist) ----------
     * Un lecteur consulte les tables dans Grist ; il n'utilise pas l'application (qui exige de tout lire).
     * Colonnes masquées : aménagements, notes, résultats, INE, champs libres ; paramètres ; contenu des blocs d'archive. */
    const REGLE_LECTEUR = 'user.Access == VIEWER';
    function ressourcesLecteurs(tablesPresentes) {
        const out = Object.keys(M.SENSIBLES).map(t => ({ tableId: t, colIds: M.SENSIBLES[t].join(',') }));
        out.push({ tableId: M.T.PARAMS, colIds: 'Valeur' }, { tableId: M.T.FICHIERS, colIds: 'Valeur' });
        if (tablesPresentes.has('DNB_Morceaux')) out.push({ tableId: 'DNB_Morceaux', colIds: 'Contenu' });
        return out;
    }
    async function verifierDroitsLecteurs(api) {
        const m = await meta(api), manques = [];
        for (const r of ressourcesLecteurs(m.idTable)) {
            const res = m.res.find(x => x.tableId === r.tableId && x.colIds === r.colIds);
            if (!res || !m.rules.some(x => x.resource === res.id && x.aclFormula === REGLE_LECTEUR && x.permissionsText === '-R')) manques.push(r.tableId);
        }
        return { ok: manques.length === 0, manques };
    }
    async function installerDroitsLecteurs(api) {
        let m = await meta(api); const voulues = ressourcesLecteurs(m.idTable);
        const aCreer = voulues.filter(r => !m.res.some(x => x.tableId === r.tableId && x.colIds === r.colIds));
        if (aCreer.length) { await api.applyUserActions(aCreer.map(r => ['AddRecord', '_grist_ACLResources', null, r])); m = await meta(api); }
        const regles = []; let pos = Math.max(0, ...m.rules.map(r => Number(r.rulePos) || 0));
        for (const r of voulues) { const res = m.res.find(x => x.tableId === r.tableId && x.colIds === r.colIds);
            if (!m.rules.some(x => x.resource === res.id && x.aclFormula === REGLE_LECTEUR && x.permissionsText === '-R')) regles.push(['AddRecord', '_grist_ACLRules', null, { resource: res.id, aclFormula: REGLE_LECTEUR, permissionsText: '-R', rulePos: ++pos }]); }
        if (regles.length) await api.applyUserActions(regles);
        return verifierDroitsLecteurs(api);
    }

    const api = { createRowStore, install, verify, sonder, installerDroitsLecteurs, verifierDroitsLecteurs, REGLE_LECTEUR, instantane, ecart, lireMode, ecrireMode, TABLES, T_ETAT, REGLE_U, FORMULE_REV, colEtat, formuleEtat };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.DnbRows = api;
})(typeof window !== 'undefined' ? window : globalThis);
