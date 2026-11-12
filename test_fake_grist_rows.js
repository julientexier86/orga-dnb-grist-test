/* Simulateur de Grist pour le stockage par lignes, calé sur les mesures du 12/11/2026 (voir RAPPORT_CONCURRENCE_GRIST.md) :
 * - AddTable ignore recalcWhen ; la révision n'augmente aux modifications que si recalcWhen = 2 (ModifyColumn) ;
 * - à la création, la formule de déclenchement s'applique toujours (Revision = 1) ;
 * - la règle de version et la règle anti-suppression n'agissent que si elles sont réellement installées ;
 * - un lot est appliqué en entier ou pas du tout ; requête > 1 Mo refusée ; colonnes calculées évaluées à la lecture. */
function fakeGrist() {
    const tables = { _grist_Tables: [], _grist_Tables_column: [], _grist_ACLResources: [], _grist_ACLRules: [] };
    const next = {}; const log = [];
    const clone = x => JSON.parse(JSON.stringify(x));
    const nid = (w, t) => { w.__next[t] = (w.__next[t] || 1); return w.__next[t]++; };
    const colsDe = (w, t) => { const tb = w._grist_Tables.find(x => x.tableId === t); return tb ? w._grist_Tables_column.filter(c => c.parentId === tb.id) : null; };
    const regles = (w, t) => { const r = w._grist_ACLResources.find(x => x.tableId === t && x.colIds === '*'); return r ? w._grist_ACLRules.filter(x => x.resource === r.id) : []; };
    const BLOCS = 'newRec.Revision != rec.Revision + 1';   // règle du stockage par blocs (grist_store.js)
    const U = 'newRec.Jeton != rec.Jeton and newRec.Base != rec.Revision';
    function appliquer(w, [op, t, a, b]) {
        if (op === 'AddTable') { if (w[t]) throw new Error('table existe'); const id = nid(w, '_grist_Tables'); w._grist_Tables.push({ id, tableId: t }); w[t] = [];
            for (const c of a) w._grist_Tables_column.push({ id: nid(w, '_grist_Tables_column'), parentId: id, colId: c.id, type: c.type, isFormula: !!c.isFormula, formula: c.formula || '', recalcWhen: 0 }); return; }
        if (op === 'AddColumn') { const tb = w._grist_Tables.find(x => x.tableId === t); w._grist_Tables_column.push({ id: nid(w, '_grist_Tables_column'), parentId: tb.id, colId: a, type: b.type, isFormula: !!b.isFormula, formula: b.formula || '', recalcWhen: 0 }); return; }
        if (op === 'ModifyColumn') { const c = colsDe(w, t).find(x => x.colId === a); if (!c) throw new Error('colonne inconnue ' + t + '.' + a); Object.assign(c, b); return; }
        if (!w[t]) throw new Error('table inconnue ' + t);
        const meta = t.startsWith('_grist');
        const rev = meta ? null : (colsDe(w, t) || []).find(c => c.colId === 'Revision');
        if (op === 'AddRecord') { const r = Object.assign({ id: nid(w, t) }, b);
            if (!meta) { for (const c of colsDe(w, t)) if (!(c.colId in r) && !c.isFormula) r[c.colId] = c.type === 'Text' ? '' : c.type === 'Bool' ? false : 0;
                if (rev && rev.formula) r.Revision = (r.Revision || 0) + 1;
                for (const k of Object.keys(b)) if (!colsDe(w, t).some(c => c.colId === k)) throw new Error('colonne inconnue ' + t + '.' + k); }
            w[t].push(r); return; }
        if (op === 'UpdateRecord') { const r = w[t].find(x => x.id === a); if (!r) throw new Error('Record not found');
            if (!meta) { for (const k of Object.keys(b)) if (!colsDe(w, t).some(c => c.colId === k)) throw new Error('colonne inconnue ' + t + '.' + k);
                if (regles(w, t).some(x => x.aclFormula === U && x.permissionsText === '-U')) { const nj = 'Jeton' in b ? b.Jeton : r.Jeton, nb = 'Base' in b ? b.Base : r.Base;
                    if (nj !== r.Jeton && nb !== r.Revision) throw new Error('Blocked by row update access rules'); }
                if (regles(w, t).some(x => x.aclFormula === BLOCS && x.permissionsText.includes('U')) && b.Revision !== r.Revision + 1) throw new Error('Blocked by row update access rules');
                Object.assign(r, b); if (rev && rev.formula && rev.recalcWhen === 2) r.Revision = (r.Revision || 0) + 1; }
            else Object.assign(r, b);
            return; }
        if (op === 'RemoveRecord' || op === 'BulkRemoveRecord') { if (regles(w, t).some(x => (!x.aclFormula && x.permissionsText === '-D') || (x.aclFormula === BLOCS && x.permissionsText.includes('D')))) throw new Error('Blocked by table delete access rules');
            const ids = [].concat(a); w[t] = w[t].filter(x => !ids.includes(x.id)); return; }
        throw new Error('Action non simulée : ' + op);
    }
    tables.__next = next;
    const client = () => ({
        async listTables() { return tables._grist_Tables.map(t => t.tableId); },
        async fetchTable(name) { await Promise.resolve(); if (!tables[name]) throw new Error('table inconnue ' + name);
            let rows = clone(tables[name]);
            const cs = name.startsWith('_grist') ? null : colsDe(tables, name);
            if (cs) for (const c of cs.filter(c => c.isFormula)) { const m = /^SUM\(r\.Revision for r in (\w+)\.lookupRecords\(\)\)$/.exec(c.formula);
                for (const r of rows) r[c.colId] = m && tables[m[1]] ? tables[m[1]].reduce((n, x) => n + (x.Revision || 0), 0) : null; }
            const out = { id: rows.map(r => r.id) }; const ks = cs ? cs.map(c => c.colId) : [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => k !== 'id');
            for (const k of ks) out[k] = rows.map(r => r[k] === undefined ? null : r[k]); return out; },
        async applyUserActions(actions) { await Promise.resolve();
            if (new TextEncoder().encode(JSON.stringify(actions)).length > 1000000) throw new Error('request entity too large');
            const w = clone(tables); for (const a of clone(actions)) appliquer(w, a);
            for (const k of Object.keys(tables)) delete tables[k]; Object.assign(tables, w); log.push(actions); }
    });
    return { client, tables, log };
}
module.exports = { fakeGrist };
