/* Stockage Grist versionné, par sections, avec validation atomique.
 *
 * Principe (mesuré sur l'instance, voir RAPPORT_CONCURRENCE_GRIST.md) :
 *  - le contenu d'une section est découpé en morceaux ajoutés (jamais modifiés) ;
 *  - la section n'est « publiée » que par UNE mise à jour de sa ligne dans DNB_Sections,
 *    qui doit incrémenter Revision de 1 : la règle d'accès Grist refuse toute autre valeur,
 *    donc un seul des écrivains simultanés l'emporte ;
 *  - plusieurs sections peuvent être publiées dans un même lot, accepté ou refusé en bloc ;
 *  - une écriture refusée ne modifie rien : les données locales sont conservées.
 * Limites connues : Grist ne garantit pas l'unicité à la création (la ligne canonique d'une
 * section est la plus petite), et les morceaux orphelins d'un écrivain battu sont nettoyés
 * par garbageCollect(). Aucune E/S réseau en dehors de l'objet `api` fourni.
 */
(function (root) {
    const T_SECTIONS = 'DNB_Sections', T_MORCEAUX = 'DNB_Morceaux';
    // Grist refuse toute requête > ~1 Mo (HTTP 413, mesuré). La limite porte sur les OCTETS sérialisés :
    // un caractère peut en occuper jusqu'à 6 (échappement JSON), d'où un morceau de 64 K caractères (≤ ~400 Ko)
    // et un lot mesuré sur sa taille réelle.
    const TAILLE_MORCEAU = 64 * 1024;
    const OCTETS_PAR_REQUETE = 700 * 1024;
    const octets = x => new TextEncoder().encode(JSON.stringify(x)).length;
    const HISTORIQUE = 3;                   // révisions conservées par section

    const SCHEMA = [
        ['AddTable', T_SECTIONS, [
            { id: 'Cle', type: 'Text' }, { id: 'Revision', type: 'Int' }, { id: 'Hash', type: 'Text' },
            { id: 'Nonce', type: 'Text' }, { id: 'NbMorceaux', type: 'Int' }, { id: 'Taille', type: 'Int' },
            { id: 'Auteur', type: 'Text' }, { id: 'Date_UTC', type: 'Text' }]],
        ['AddTable', T_MORCEAUX, [
            { id: 'Cle_section', type: 'Text' }, { id: 'Revision_cible', type: 'Int' }, { id: 'Nonce', type: 'Text' },
            { id: 'Ordre', type: 'Int' }, { id: 'Contenu', type: 'Text' }, { id: 'Hash', type: 'Text' }]]
    ];

    async function sha256(text) {
        const buf = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    }
    const nonce = () => Array.from(root.crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
    const rowsOf = t => (t.id || []).map((id, i) => { const r = { id }; for (const k of Object.keys(t)) if (k !== 'id') r[k] = t[k][i]; return r; });
    // Ne jamais couper une paire de substitution (émojis) : le serveur remplacerait les demi-paires par U+FFFD.
    function chunk(text) {
        const out = []; let i = 0;
        while (i < text.length) {
            let end = Math.min(i + TAILLE_MORCEAU, text.length);
            if (end < text.length) { const c = text.charCodeAt(end - 1); if (c >= 0xD800 && c <= 0xDBFF) end--; }
            out.push(text.slice(i, end)); i = end;
        }
        return out.length ? out : [''];
    }
    const isRefusal = e => /blocked|access rules|denied|refus/i.test(String(e && (e.message || e)));

    function createStore(api, options) {
        const quiEstCe = () => { const a = options && options.auteur; return (typeof a === 'function' ? a() : a) || ''; };
        const now =(options && options.now) || (() => new Date().toISOString());

        async function readSectionRows() {
            const rows = rowsOf(await api.fetchTable(T_SECTIONS));
            const byKey = new Map();
            for (const r of rows) { const cur = byKey.get(r.Cle); if (!cur || r.id < cur.id) byKey.set(r.Cle, r); } // canonique = plus petit id
            return byKey;
        }

        /** Lit toutes les sections publiées ; vérifie nombre de morceaux et empreinte ; réessaie si une publication survient. */
        /**
         * Lit toutes les sections publiées. Une section incomplète ou corrompue n'empêche pas de lire les autres :
         * elle est signalée dans `problems` (et absente de `sections`) ; le réessai écarte les lectures prises
         * pendant une publication concurrente. Réparation : restore() d'une révision antérieure.
         */
        async function pull(retries = 3) {
            let out;
            for (let attempt = 0; attempt <= retries; attempt++) {
                const secs = await readSectionRows();
                const morceaux = rowsOf(await api.fetchTable(T_MORCEAUX));
                out = { sections: {}, baseline: {}, problems: [], meta: {} };
                for (const [cle, s] of secs) {
                    out.meta[cle] = { auteur: s.Auteur || '', date: s.Date_UTC || '', revision: s.Revision || 0 };
                    out.baseline[cle] = { id: s.id, revision: s.Revision || 0, hash: s.Hash || '', nonce: s.Nonce };
                    if (!s.Revision) continue;
                    const parts = morceaux.filter(m => m.Cle_section === cle && m.Revision_cible === s.Revision && m.Nonce === s.Nonce)
                        .sort((a, b) => a.Ordre - b.Ordre);
                    const text = parts.map(p => p.Contenu).join('');
                    if (parts.length !== s.NbMorceaux || parts.some((p, i) => p.Ordre !== i) || (await sha256(text)) !== s.Hash) {
                        out.problems.push({ cle, revision: s.Revision, raison: parts.length !== s.NbMorceaux ? 'morceaux manquants' : 'empreinte différente' });
                        out.baseline[cle].hash = ''; // force la republication (réparation) même si le contenu local est identique
                        continue;
                    }
                    out.sections[cle] = JSON.parse(text);
                }
                if (!out.problems.length) return out;
            }
            return out;
        }

        /** Crée (une seule fois, tolérant aux doublons) les lignes de sections absentes ; renvoie la base mise à jour. */
        async function ensureSections(keys, baseline) {
            const missing = keys.filter(k => !baseline[k]);
            if (!missing.length) return baseline;
            await api.applyUserActions(missing.map(k => ['AddRecord', T_SECTIONS, null, { Cle: k, Revision: 0, Hash: '', Nonce: '', NbMorceaux: 0, Taille: 0, Auteur: quiEstCe(), Date_UTC: now() }]));
            const secs = await readSectionRows();
            const next = Object.assign({}, baseline);
            for (const k of missing) { const s = secs.get(k); next[k] = { id: s.id, revision: s.Revision, hash: s.Hash, nonce: s.Nonce }; }
            return next;
        }

        /**
         * Publie les sections modifiées. `db` : objet à enregistrer ; `baseline` : état lu au chargement.
         * Renvoie { committed, saved, conflicts, baseline }. Ne lève pas d'erreur sur un simple conflit.
         */
        /** Lecture légère (table des sections seule) : révision, auteur et date de chaque section publiée. */
        async function revisions() {
            const out = {};
            for (const [cle, s] of await readSectionRows()) out[cle] = { revision: s.Revision || 0, auteur: s.Auteur || '', date: s.Date_UTC || '' };
            return out;
        }
        /** Sections dont le contenu local diffère de la base de référence (= mes modifications). */
        async function changedKeys(db, baseline) {
            const out = [];
            for (const k of Object.keys(db)) {
                const h = await sha256(JSON.stringify(db[k] === undefined ? null : db[k]));
                if (!baseline[k] || baseline[k].hash !== h) out.push(k);
            }
            return out;
        }
        /** `options.seulement` : ne publier que ces sections (jamais celles qu'un autre a modifiées sans que j'y touche). */
        async function push(db, baseline, options) {
            baseline = Object.assign({}, baseline);
            const keys = (options && options.seulement) ? Object.keys(db).filter(k => options.seulement.includes(k)) : Object.keys(db);
            const texts = {}, hashes = {}, changed = [];
            for (const k of keys) {
                texts[k] = JSON.stringify(db[k] === undefined ? null : db[k]);
                hashes[k] = await sha256(texts[k]);
                if (!baseline[k] || baseline[k].hash !== hashes[k]) changed.push(k);
            }
            if (!changed.length) return { committed: true, saved: [], conflicts: [], baseline };
            baseline = await ensureSections(changed, baseline);
            const nonces = {}, pending = [];
            let bytes = 0, batch = [];
            const flush = async () => { if (batch.length) { await api.applyUserActions(batch); batch = []; bytes = 0; } };
            for (const k of changed) {
                const rev = baseline[k].revision + 1, n = nonces[k] = nonce();
                const parts = chunk(texts[k]);
                for (let i = 0; i < parts.length; i++) {
                    const action = ['AddRecord', T_MORCEAUX, null, { Cle_section: k, Revision_cible: rev, Nonce: n, Ordre: i, Contenu: parts[i], Hash: '' }];
                    const size = octets(action);
                    if (batch.length && bytes + size > OCTETS_PAR_REQUETE) await flush();
                    batch.push(action);
                    bytes += size;
                }
                pending.push({ k, rev, n, count: parts.length });
            }
            await flush();
            const stamp = now();
            const commit = pending.map(p => ['UpdateRecord', T_SECTIONS, baseline[p.k].id, {
                Revision: p.rev, Hash: hashes[p.k], Nonce: p.n, NbMorceaux: p.count, Taille: texts[p.k].length, Auteur: quiEstCe(), Date_UTC: stamp }]);
            try { await api.applyUserActions(commit); }
            catch (e) {
                if (!isRefusal(e)) throw e;
                // Lot refusé en bloc : rien n'est publié. On indique quelles sections ont bougé.
                const secs = await readSectionRows();
                const conflicts = changed.filter(k => { const s = secs.get(k); return s && s.Revision !== baseline[k].revision; });
                // Aucune révision n'a bougé : le refus ne vient pas d'un conflit (droits insuffisants, règle mal posée…)
                return { committed: false, saved: [], conflicts, refused: !conflicts.length, baseline };
            }
            for (const p of pending) baseline[p.k] = { id: baseline[p.k].id, revision: p.rev, hash: hashes[p.k], nonce: p.n };
            await garbageCollect(changed.map(k => k)).catch(() => {});
            return { committed: true, saved: changed, conflicts: [], baseline };
        }

        /** Supprime uniquement des morceaux : orphelins (écrivain battu) ou plus anciens que l'historique conservé. */
        async function garbageCollect(keys) {
            const secs = await readSectionRows();
            const morceaux = rowsOf(await api.fetchTable(T_MORCEAUX));
            const del = [];
            for (const m of morceaux) {
                const s = secs.get(m.Cle_section);
                if (!s || (keys && !keys.includes(m.Cle_section))) continue;
                // Jamais de suppression au-delà de la révision publiée : ce seraient les morceaux d'une écriture en cours.
                if (m.Revision_cible > s.Revision) continue;
                const ancien = m.Revision_cible <= s.Revision - HISTORIQUE;
                const orphelin = m.Revision_cible === s.Revision && m.Nonce !== s.Nonce; // écrivain battu à cette révision
                if (ancien || orphelin) del.push(m.id);
            }
            if (del.length) await api.applyUserActions([['BulkRemoveRecord', T_MORCEAUX, del]]);
            return del.length;
        }

        /** Restaure une révision antérieure comme NOUVELLE révision (l'historique n'est jamais réécrit). */
        async function restore(key, revision, baseline) {
            const secs = await readSectionRows();
            const morceaux = rowsOf(await api.fetchTable(T_MORCEAUX));
            const candidates = morceaux.filter(m => m.Cle_section === key && m.Revision_cible === revision);
            if (!candidates.length) throw new Error('Révision introuvable ou purgée.');
            // Si deux écrivains ont écrit cette révision, on ne sait pas lequel a gagné : refus plutôt que deviner.
            if (new Set(candidates.map(m => m.Nonce)).size > 1) throw new Error('Révision ambiguë (écritures concurrentes) : restauration refusée.');
            const n = candidates[0].Nonce;
            const text = candidates.filter(m => m.Nonce === n).sort((a, b) => a.Ordre - b.Ordre).map(m => m.Contenu).join('');
            const value = JSON.parse(text);
            return push({ [key]: value }, baseline);
        }

        return { pull, push, changedKeys, revisions, ensureSections, garbageCollect, restore };
    }

    /* Découpage de la base de l'application en sections. Chaque clé racine est une section ; les deux images
     * volumineuses de `config` (logo, signature) sont isolées pour ne pas être renvoyées à chaque réglage.
     * Toute clé racine inconnue devient simplement une section : rien n'est perdu. */
    const IMAGES = ['logo', 'signature'];
    function splitDb(db) {
        const sections = {};
        for (const k of Object.keys(db)) {
            if (k === 'config' && db.config && typeof db.config === 'object' && !Array.isArray(db.config)) {
                const rest = Object.assign({}, db.config);
                for (const img of IMAGES) if (img in rest) { sections['config.' + img] = rest[img]; delete rest[img]; }
                sections.config = rest;
            } else sections[k] = db[k];
        }
        return sections;
    }
    function joinDb(sections) {
        const db = {};
        for (const k of Object.keys(sections)) if (!k.startsWith('config.')) db[k] = sections[k];
        const aImages = IMAGES.filter(img => ('config.' + img) in sections);
        if (aImages.length && db.config && typeof db.config === 'object' && !Array.isArray(db.config)) {
            db.config = Object.assign({}, db.config); // jamais de modification de l'objet reçu
            for (const img of aImages) db.config[img] = sections['config.' + img];
        }
        return db;
    }

    /* Protection : la règle d'accès qui impose Revision = ancienne + 1 sur DNB_Sections (mise à jour ET suppression). */
    const REGLE = { formule: 'newRec.Revision != rec.Revision + 1', permissions: '-UD' };
    async function verifyProtection(api) {
        try {
            const res = rowsOf(await api.fetchTable('_grist_ACLResources')), rules = rowsOf(await api.fetchTable('_grist_ACLRules'));
            const ids = res.filter(r => r.tableId === T_SECTIONS && (r.colIds === '*' || r.colIds === '')).map(r => r.id);
            const ok = rules.some(r => ids.includes(r.resource) && String(r.aclFormula).replace(/\s+/g, ' ').trim() === REGLE.formule
                && /^-.*U/.test(r.permissionsText || '') && /D/.test(r.permissionsText || ''));
            return { ok, verifiable: true, raison: ok ? '' : 'Règle de version absente sur ' + T_SECTIONS };
        } catch (e) { return { ok: false, verifiable: false, raison: 'Règles d’accès illisibles depuis cette page : ' + (e && e.message || e) }; }
    }
    /** À exécuter par le propriétaire du document : crée les tables puis la règle de protection (idempotent). */
    async function installProtection(api) {
        const existing = (await api.listTables()).map(t => (typeof t === 'string' ? t : t.id));
        const toAdd = SCHEMA.filter(a => !existing.includes(a[1]));
        if (toAdd.length) await api.applyUserActions(toAdd);
        if ((await verifyProtection(api)).ok) return { created: toAdd.length, regle: 'déjà présente' };
        let res = rowsOf(await api.fetchTable('_grist_ACLResources')).find(r => r.tableId === T_SECTIONS && r.colIds === '*');
        if (!res) {
            await api.applyUserActions([['AddRecord', '_grist_ACLResources', null, { tableId: T_SECTIONS, colIds: '*' }]]);
            res = rowsOf(await api.fetchTable('_grist_ACLResources')).find(r => r.tableId === T_SECTIONS && r.colIds === '*');
        }
        const rules = rowsOf(await api.fetchTable('_grist_ACLRules'));
        const first = Math.min(1, ...rules.map(r => r.rulePos).filter(x => typeof x === 'number')) - 1;
        await api.applyUserActions([['AddRecord', '_grist_ACLRules', null, { resource: res.id, aclFormula: REGLE.formule, permissionsText: REGLE.permissions, rulePos: first }]]);
        const check = await verifyProtection(api);
        if (!check.ok) throw new Error('Règle ajoutée mais non vérifiée : ' + check.raison);
        return { created: toAdd.length, regle: 'installée' };
    }

    root.DnbStore = { createStore, SCHEMA, T_SECTIONS, T_MORCEAUX, TAILLE_MORCEAU, splitDb, joinDb, verifyProtection, installProtection };
    if (typeof module !== 'undefined') module.exports = root.DnbStore;
})(typeof window !== 'undefined' ? window : globalThis);
