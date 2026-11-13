/* Pont Orga Exam ↔ Grist, mode « tables » : les tables structurées DNB_* sont la source de vérité (voir grist_rows.js).
 * Règles de sûreté :
 *  - aucune écriture tant que la protection par ligne n'est pas vérifiée dans le document ;
 *  - chaque envoi part d'une lecture fraîche de Grist et d'une fusion à trois (ce que j'avais lu / mon projet / Grist) :
 *    une modification faite par un autre, ou saisie directement dans Grist, n'est jamais annulée par mon envoi ;
 *  - même cellule modifiée des deux côtés = conflit affiché, jamais tranché en silence ;
 *  - un fichier importé dans l'application n'est pas publié automatiquement.
 * Le stockage par blocs (grist_store.js) reste dans le document comme archive : ce pont n'y écrit jamais,
 * sauf sur demande explicite « Revenir aux blocs ». */
(function () {
    if (window === window.parent) return;
    const R = window.DnbRows, M = window.DnbTables;
    if (!R || !M) { console.error('grist_rows.js / grist_tables.js manquants'); return; }
    const POLL_MS = 60000, DELAI_ENVOI_MS = 3000;
    const st = { mode: 'init', msg: '', base: null, sig: null, conflits: [], distant: 0, problemes: [], occupe: false, timer: null, chargement: false, actif: false };
    let grist, store, box, retourBlocs = null;

    const esc = s => (typeof escapeHTML === 'function' ? escapeHTML(s) : String(s));
    const local = () => JSON.parse(JSON.stringify(DB));
    /* Projet par défaut de l'application, pris au chargement (dans Grist, rien n'est restauré avant). L'application
     * plante sur un projet incomplet : avant de charger un projet venu de Grist, on comble les sections et les
     * réglages absents avec ces valeurs par défaut. Ces ajouts repartent ensuite vers Grist comme une modification normale. */
    const DEFAUTS = (() => { try { return JSON.parse(JSON.stringify(DB)); } catch (e) { return {}; } })();
    const estObjet = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    function completer(db) {
        const d = JSON.parse(JSON.stringify(DEFAUTS)), out = Object.assign({}, d, db);
        for (const k of Object.keys(d)) if (estObjet(d[k]) && estObjet(db[k])) out[k] = Object.assign({}, d[k], db[k]);
        return out;
    }
    const heure = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const erreur = e => setMode('erreur', 'Erreur : ' + (e && e.message || e));
    const NOMS = t => t.replace('DNB_', '').replace(/_/g, ' ').toLowerCase();

    const TITRES = { init: 'connexion…', sync: 'synchronisé (tables)', conflit: 'conflit', erreur: 'erreur', nonprotege: 'tables non protégées', local: 'projet local (non publié)', vide: 'tables vides' };
    const COULEURS = { init: '#656d70', sync: '#2f6f5e', conflit: '#9a4a2e', erreur: '#9a4a2e', nonprotege: '#9a4a2e', local: '#9a7a2e', vide: '#9a7a2e' };
    function bouton(label, fn, primaire) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'margin:4px 6px 0 0;padding:5px 9px;border-radius:6px;border:1px solid #9fb0c3;cursor:pointer;background:' + (primaire ? '#1f3a5c;color:#fff' : '#f4f6f8');
        b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { erreur(e); } finally { b.disabled = false; } };
        return b;
    }
    const etape = t => { const m = box && box.querySelector('[data-m]'); if (m) m.textContent = t; };
    function setMode(mode, msg) {
        st.mode = mode; st.msg = msg || '';
        if (!box) { box = document.createElement('div'); box.setAttribute('data-pont', 'tables');
            box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9000;background:#fff;color:#20314a;border:1px solid #b7c5d4;border-radius:8px;padding:10px 12px;box-shadow:0 4px 18px #0002;font:13px sans-serif;max-width:380px';
            document.body.appendChild(box); }
        box.innerHTML = '<strong style="color:' + COULEURS[mode] + '">Grist — ' + esc(TITRES[mode] || mode) + '</strong><div data-m style="margin:4px 0"></div><div data-b></div>';
        box.querySelector('[data-m]').textContent = st.msg + (st.problemes.length ? ' Attention : ' + st.problemes.length + ' doublon(s) de clé dans Grist (la ligne la plus ancienne fait foi).' : '');
        const zone = box.querySelector('[data-b]'), ajoute = (l, f, p) => zone.appendChild(bouton(l, f, p));
        if (mode === 'nonprotege') ajoute('Réparer la protection (propriétaire)', reparer, true);
        if (mode === 'vide') ajoute('Publier le projet local dans les tables', () => publier(), true);
        if (mode === 'local') { ajoute('Recharger depuis Grist', () => charger(), true); ajoute('Publier (remplace le contenu des tables)', confirmerPublication); }
        if (mode === 'sync') {
            ajoute('Enregistrer maintenant', () => envoyer(), true);
            if (st.distant) ajoute('Charger les modifications faites dans Grist (' + st.distant + ' ligne(s))', () => charger(), true);
            if (!st.lecteursOK) ajoute('Masquer les données sensibles aux lecteurs (propriétaire)', async () => { const r = await R.installerDroitsLecteurs(grist.docApi); st.lecteursOK = r.ok; setMode('sync', r.ok ? 'Colonnes sensibles masquées pour le rôle Lecteur.' : 'Masquage incomplet : ' + r.manques.join(', ')); });
            if (retourBlocs) ajoute('Revenir aux blocs…', confirmerRetour);
        }
        if (mode === 'conflit') { ajoute('Prendre la version de Grist', () => resoudre('distant'), true); ajoute('Garder la mienne', () => resoudre('local')); }
    }

    async function reparer() { const r = await R.install(grist.docApi); if (!r.ok) throw new Error('Installation incomplète (' + r.etape + ') : ' + r.details.join(' ; ')); await demarrer(); }

    async function demarrer() {
        st.actif = true;
        setMode('init', 'Vérification des tables…');
        const v = await R.verify(grist.docApi);
        if (!v.ok) return setMode('nonprotege', (v.lisible ? 'Éléments manquants : ' + v.manques.slice(0, 4).join(', ') + (v.manques.length > 4 ? '…' : '') : 'Règles illisibles avec ce compte') + '. Aucune écriture n’est faite.');
        try { st.lecteursOK = (await R.verifierDroitsLecteurs(grist.docApi)).ok; } catch (e) { st.lecteursOK = false; }
        etape('Lecture des tables…');
        const lu = await store.pull(); st.sig = lu.sig; st.problemes = lu.problems;
        if (store.vide(lu.etat)) { st.base = R.instantane({}); return setMode('vide', 'Les tables ne contiennent aucun projet. Le projet local n’est pas envoyé automatiquement.'); }
        if (!(DB.students && DB.students.length) && !(DB.rooms && DB.rooms.length)) return appliquer(lu.db, 'Chargé depuis Grist à ' + heure() + '.');
        if (R.ecart(local(), lu.db) === 0) { st.base = R.instantane(lu.db); return setMode('sync', 'Projet identique à Grist (' + heure() + ').'); }
        setMode('local', 'Un projet existe dans Grist et un projet local différent est ouvert : choisissez.');
        showConfirm('Un projet existe dans les tables Grist.\nLe charger remplace le projet ouvert dans l’application (exportez-le avant si besoin).',
            () => charger().catch(erreur), () => setMode('local', 'Le projet local n’est pas publié : rien n’est envoyé à Grist.'));
    }

    /* Met un projet dans l'application et en fait la nouvelle base de fusion. */
    async function appliquer(db, msg) {
        st.chargement = true; clearTimeout(st.timer); st.timer = null;
        try {
            await new Promise((res, rej) => {
                const delai = setTimeout(() => rej(new Error('L’application n’a pas terminé le chargement (aucune réponse après 20 s).')), 20000);
                window.__dnbChargementInterne = true;
                loadGlobalData(new File([JSON.stringify(completer(db))], 'grist.data', { type: 'application/json' }), () => { clearTimeout(delai); res(); });
            });
        } finally { st.chargement = false; window.__dnbChargementInterne = false; }
        // la base est ce que Grist contient (db), pas ce que l'application en a fait : les réparations
        // faites au chargement (identifiants manquants…) seront vues comme mes modifications et publiées normalement.
        st.base = R.instantane(db); st.distant = 0; st.conflits = [];
        setMode('sync', msg);
    }
    /* Recharge depuis Grist en conservant mes modifications non publiées (fusion). */
    async function charger() {
        etape('Lecture des tables…');
        const lu = await store.pull(); st.sig = lu.sig; st.problemes = lu.problems;
        if (st.mode === 'local' || !st.base) return appliquer(lu.db, 'Chargé depuis Grist à ' + heure() + '.');
        const f = store.fusion(st.base, local(), lu.etat, 'distant');
        if (f.conflits.length) return signalerConflits(f.conflits);
        await appliquer(f.db, 'Modifications de Grist chargées à ' + heure() + '.');
        programmerEnvoi(true);
    }

    function signalerConflits(conflits) {
        st.conflits = conflits;
        const parTable = {}; for (const c of conflits) parTable[c.table] = (parTable[c.table] || 0) + 1;
        setMode('conflit', 'La même donnée a été modifiée dans Grist et ici : ' + Object.keys(parTable).map(t => parTable[t] + ' dans ' + NOMS(t)).join(', ') + '. Rien n’a été écrasé ; choisissez.');
    }
    async function resoudre(priorite) {
        const lu = await store.pull(); st.sig = lu.sig; st.problemes = lu.problems;
        const f = store.fusion(st.base, local(), lu.etat, priorite);
        const r = await store.push(f.db, lu.etat);
        if (!r.ok) return setMode('conflit', 'Grist a encore changé pendant l’envoi. Réessayez.');
        await appliquer(f.db, (priorite === 'local' ? 'Votre version a été publiée' : 'La version de Grist a été retenue') + ' à ' + heure() + '.');
        st.sig = (await store.pull()).sig;
    }

    /* Envoi : lecture fraîche, fusion, envoi des seules lignes qui changent. */
    async function envoyer() {
        if (st.occupe || st.mode !== 'sync') return;
        st.occupe = true;
        try {
            for (let essai = 0; essai < 3; essai++) {
                const moi = local();
                const lu = await store.pull(); st.sig = lu.sig; st.problemes = lu.problems;
                const f = store.fusion(st.base, moi, lu.etat, 'distant');
                if (f.conflits.length) return signalerConflits(f.conflits);
                const r = await store.push(f.db, lu.etat);
                if (!r.ok) continue;                                 // quelqu'un a écrit entre ma lecture et mon envoi : on recommence
                st.timer = null;
                // la base devient ce que l'application contient réellement ; ce que Grist a en plus reste « à charger »
                st.base = R.instantane(moi); st.distant = R.ecart(moi, f.db);
                st.sig = (await store.pull()).sig;
                if (r.n || st.distant) setMode('sync', (r.n ? 'Enregistré dans Grist à ' + heure() + ' (' + r.n + ' ligne(s)).' : st.msg) + (st.distant ? ' Des modifications faites dans Grist sont disponibles.' : ''));
                return;
            }
            setMode('erreur', 'Envoi impossible : le document change sans arrêt. Vos données locales sont intactes ; réessayez.');
        } finally { st.occupe = false; }
    }
    function confirmerPublication() {
        showConfirm('Publier le projet local dans les tables Grist ?\nLe contenu actuel des tables est remplacé par le projet ouvert (les lignes absentes du projet sont marquées supprimées, jamais effacées).', () => publier().catch(erreur));
    }
    async function publier() {
        etape('Envoi vers les tables…');
        const moi = local(), lu = await store.pull();
        const r = await store.push(moi, lu.etat);
        if (!r.ok) return setMode('erreur', 'Grist a refusé l’écriture' + (r.partiel ? ' en cours d’envoi (publication partielle : relancez)' : '') + '. Vos données locales sont intactes.');
        const relu = await store.pull(); st.sig = relu.sig; st.problemes = relu.problems;
        if (R.ecart(moi, relu.db) !== 0) return setMode('erreur', 'Relecture différente de ce qui a été envoyé : publication à vérifier. Vos données locales sont intactes.');
        st.base = R.instantane(moi); st.distant = 0; st.conflits = [];
        setMode('sync', 'Projet publié dans les tables à ' + heure() + ' (' + r.n + ' ligne(s)), relecture conforme.');
    }

    async function verifierDistant() {
        if (st.mode !== 'sync' || st.occupe || !st.sig) return;
        if (!(await store.changed(st.sig)).length) return;
        const lu = await store.pull(); st.sig = lu.sig; st.problemes = lu.problems;
        const moi = local(), f = store.fusion(st.base, moi, lu.etat, 'distant');
        const n = f.conflits.length ? f.conflits.length : R.ecart(moi, f.db);
        if (n !== st.distant) { st.distant = n; setMode('sync', n ? 'Des modifications ont été faites dans Grist.' : st.msg); }
    }
    function programmerEnvoi(force) {
        if (!st.actif || st.chargement || st.mode !== 'sync') return;
        clearTimeout(st.timer);
        st.timer = setTimeout(() => envoyer().catch(erreur), force ? 0 : DELAI_ENVOI_MS);
    }

    function confirmerRetour() {
        showConfirm('Revenir au stockage par blocs ?\nLe projet ouvert est publié dans les blocs (nouvelle révision), puis ce document repasse en mode blocs. Les tables restent en place, sans être mises à jour.',
            () => retourBlocs(local()).then(() => R.ecrireMode(grist.docApi, 'blocs')).then(() => { st.actif = false; clearTimeout(st.timer); box.remove(); box = null; try { window.location.reload(); } catch (e) { /* rechargement manuel */ } }).catch(erreur));
    }

    function brancher(g) {
        if (store) return;
        grist = g; store = R.createRowStore(grist.docApi);
        const original = window.autoSave;
        if (typeof original === 'function') window.autoSave = function () { const r = original.apply(this, arguments); programmerEnvoi(); return r; };
        // un fichier importé par l'utilisateur remplace tout le projet : jamais publié sans confirmation
        const charge = window.loadGlobalData;
        if (typeof charge === 'function') window.loadGlobalData = function (file, cb) {
            const interne = window.__dnbChargementInterne;
            return charge.call(this, file, function () { if (cb) cb.apply(this, arguments);
                if (!interne && st.actif && (st.mode === 'sync' || st.mode === 'conflit')) { clearTimeout(st.timer); st.timer = null; setMode('local', 'Un fichier a été importé dans l’application : il n’est pas publié automatiquement.'); } });
        };
        window.addEventListener('beforeunload', e => { if (st.actif && st.timer && st.mode === 'sync') { e.preventDefault(); e.returnValue = ''; } });
        setInterval(() => { if (st.actif && !document.hidden) verifierDistant().catch(() => {}); }, POLL_MS);
    }

    window.DnbPontTables = {
        /* Ce document est-il en mode tables ? (marque écrite en fin de bascule) */
        async actif(g) { return (await R.lireMode(g.docApi)) === 'tables'; },
        /* options.retourBlocs(db) : publie db dans les blocs (fourni par le pont des blocs). */
        async demarrer(g, options) { brancher(g); retourBlocs = options && options.retourBlocs || null; return demarrer(); },
        /* Bascule blocs -> tables : installe, prouve la protection, publie le projet ouvert, relit, puis seulement écrit la marque. */
        async convertir(g, db, etapeFn) {
            const dire = etapeFn || (() => {});
            dire('Création des tables et des règles…');
            const i = await R.install(g.docApi);
            if (!i.ok) throw new Error('Installation incomplète (' + i.etape + ') : ' + i.details.join(' ; '));
            dire('Envoi du projet dans les tables…');
            const s = R.createRowStore(g.docApi), lu = await s.pull();
            const r = await s.push(db, lu.etat);
            if (!r.ok) throw new Error('Grist a refusé l’écriture dans les tables' + (r.partiel ? ' (envoi partiel)' : '') + '. Le document reste en mode blocs.');
            dire('Relecture de contrôle…');
            const relu = await s.pull();
            if (!M.deepEqual(relu.db, db)) throw new Error('La relecture des tables diffère du projet envoyé. Le document reste en mode blocs.');
            await R.ecrireMode(g.docApi, 'tables');
            return { lignes: r.n };
        },
        _etat: st, _verifier: () => verifierDistant()
    };
})();
