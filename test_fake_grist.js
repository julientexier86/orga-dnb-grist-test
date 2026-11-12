const Store = require('./js/grist_store.js');

/* Simulateur de Grist calé sur les mesures faites sur l'instance :
 * - UpdateRecord sur DNB_Sections accepté seulement si Revision == ancienne + 1 ; sinon lot refusé en bloc ;
 * - suppression refusée sur DNB_Sections ; création jamais contrôlée (doublons possibles) ;
 * - chaque appel est sérialisé (mutation synchrone), comme le traitement d'un document côté serveur. */
function fakeGrist() {
    const tables = {}; const nextId = {}; const log = [];
    for (const a of Store.SCHEMA) { tables[a[1]] = []; nextId[a[1]] = 1; }
    for (const m of ['_grist_ACLResources', '_grist_ACLRules']) { tables[m] = []; nextId[m] = 1; }
    const clone = x => JSON.parse(JSON.stringify(x));
    const client = () => ({
        async listTables() { return Object.keys(tables).filter(t => !t.startsWith('_grist')); },
        async fetchTable(name) { await Promise.resolve(); const rows = clone(tables[name]); const cols = { id: rows.map(r => r.id) };
            for (const k of new Set(rows.flatMap(r => Object.keys(r)))) if (k !== 'id') cols[k] = rows.map(r => r[k]); return cols; },
        async applyUserActions(actions) {
            await Promise.resolve();
            // Limite mesurée sur l'instance : requête > ~1 Mo refusée (413), en octets sérialisés
            if (new TextEncoder().encode(JSON.stringify(actions)).length > 1000000) throw new Error('request entity too large');
            const work = clone(tables), ids = Object.assign({}, nextId);
            for (const [op, t, a, b] of actions) {
                // Le serveur stocke de l'UTF-8 : une demi-paire de substitution devient U+FFFD (constaté sur l'instance)
                if (b) for (const k of Object.keys(b)) if (typeof b[k] === 'string') b[k] = b[k].toWellFormed();
                if (op === 'AddRecord') { work[t].push(Object.assign({ id: ids[t]++ }, b)); }
                else if (op === 'UpdateRecord') {
                    const r = work[t].find(x => x.id === a); if (!r) throw new Error('Record not found');
                    if (t === Store.T_SECTIONS && b.Revision !== r.Revision + 1) throw new Error('Blocked by row update access rules');
                    Object.assign(r, b);
                } else if (op === 'BulkRemoveRecord') {
                    if (t === Store.T_SECTIONS) throw new Error('Blocked by row delete access rules');
                    work[t] = work[t].filter(x => !a.includes(x.id));
                } else throw new Error('Action non simulée : ' + op);
            }
            Object.assign(tables, work); Object.assign(nextId, ids); log.push(actions.length);
        }
    });
    return { client, tables, log };
}

module.exports = { fakeGrist };
