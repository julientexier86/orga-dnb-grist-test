/* Pont Orga Exam ↔ Grist : stockage versionné par sections (voir grist_store.js).
 * Règles de sûreté :
 *  - aucune écriture tant que la règle de version n'est pas vérifiée dans le document ;
 *  - jamais de remplacement silencieux : charger ou écraser demande toujours une action explicite ;
 *  - une écriture refusée laisse les données locales intactes ;
 *  - seules MES sections modifiées sont publiées : une section modifiée par un autre n'est jamais écrasée sans choix. */
(function () {
    if (window === window.parent) return;               // uniquement quand l'application est embarquée dans Grist
    const Store = window.DnbStore;
    if (!Store) { console.error('grist_store.js manquant'); return; }
    const POLL_MS = 60000, DELAI_ENVOI_MS = 3000;
    const st = { mode: 'init', msg: '', baseline: {}, conflits: [], distant: [], verifiable: true, occupe: false, timer: null, chargement: false, ok: false, illisibles: [] };
    let grist, store;

    const esc = s => (typeof escapeHTML === 'function' ? escapeHTML(s) : String(s));
    const sections = () => Store.splitDb(JSON.parse(JSON.stringify(DB)));
    const heure = d => new Date(d || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const auteur = () => { try { return localStorage.getItem('DNB_Auteur') || ''; } catch (e) { return ''; } };
    const erreur = e => setMode('erreur', 'Erreur : ' + (e && e.message || e));

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9000;background:#fff;color:#20314a;border:1px solid #b7c5d4;border-radius:8px;padding:10px 12px;box-shadow:0 4px 18px #0002;font:13px sans-serif;max-width:360px';
    document.body.appendChild(box);

    function bouton(label, fn, primaire) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'margin:4px 6px 0 0;padding:5px 9px;border-radius:6px;border:1px solid #9fb0c3;cursor:pointer;background:' + (primaire ? '#1f3a5c;color:#fff' : '#f4f6f8');
        b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { erreur(e); } finally { b.disabled = false; } };
        return b;
    }
    const TITRES = { historique: 'historique', sync: 'synchronisé', conflit: 'conflit', erreur: 'erreur', nonprotege: 'stockage non protégé', absent: 'stockage à initialiser', local: 'projet local (non synchronisé)', illisible: 'section(s) illisible(s)', vide: 'Grist vide', init: 'connexion…' };
    const COULEURS = { historique: '#20314a', sync: '#2f6f5e', conflit: '#9a4a2e', erreur: '#9a4a2e', nonprotege: '#9a4a2e', absent: '#9a7a2e', local: '#9a7a2e', illisible: '#9a4a2e', vide: '#9a7a2e', init: '#656d70' };

    const etape = t => { const m = box.querySelector('[data-m]'); if (m) m.textContent = t; };
    function setMode(mode, msg) {
        st.mode = mode; st.msg = msg || '';
        box.innerHTML = '<strong style="color:' + COULEURS[mode] + '">Grist — ' + esc(TITRES[mode] || mode) + '</strong><div data-m style="margin:4px 0"></div><div data-b></div><div data-n style="margin-top:6px;font-size:12px"></div>';
        box.querySelector('[data-m]').textContent = st.msg;
        const zone = box.querySelector('[data-b]');
        const ajoute = (l, f, p) => zone.appendChild(bouton(l, f, p));
        if (mode === 'absent' || mode === 'nonprotege') {
            ajoute('Initialiser / vérifier le stockage (propriétaire)', installer, true);
            if (mode === 'nonprotege' && !st.verifiable) ajoute('J’ai vérifié la règle dans Grist', () => { st.ok = true; return demarrer(); });
        }
        if (mode === 'illisible') { ajoute('Charger les sections lisibles', () => chargerDistant(null, true), true); ajoute('Restaurer une version…', () => historique(st.illisibles[0]), true); ajoute('Publier le projet local (répare)', confirmerPublication); }
        if (mode === 'vide') ajoute('Publier le projet local dans Grist', publierTout, true);
        if (mode === 'local') { ajoute('Charger depuis Grist', () => chargerDistant(null), true); ajoute('Publier (remplace Grist)', confirmerPublication); }
        if (mode === 'sync') {
            ajoute('Enregistrer maintenant', () => envoyer(), true);
            ajoute('Historique / restaurer…', () => historique());
            if (window.DnbPontTables) ajoute('Passer aux tables structurées…', confirmerBascule);
            if (st.distant.length) ajoute('Charger ' + st.distant.length + ' section(s) modifiée(s) par un autre', () => chargerDistant(st.distant), true);
        }
        if (mode === 'conflit') { ajoute('Prendre leur version', () => chargerDistant(st.conflits), true); ajoute('Garder la mienne', garderLaMienne); }
        if (mode === 'sync' || mode === 'conflit') {
            const n = box.querySelector('[data-n]'), i = document.createElement('input');
            i.placeholder = 'Votre nom (journal des modifications)'; i.value = auteur(); i.style.cssText = 'width:100%;box-sizing:border-box;padding:3px 6px';
            i.onchange = () => { try { localStorage.setItem('DNB_Auteur', i.value.trim()); } catch (e) { /* ignoré */ } };
            n.appendChild(i);
        }
    }

    /** Écran d'historique : choisir une section puis une révision à restaurer (nouvelle révision, rien n'est effacé). */
    async function historique(cle) {
        const retour = { mode: st.mode, msg: st.msg };
        if (st.mode === 'historique') return;
        st.mode = 'historique'; clearTimeout(st.timer); st.timer = null;      // aucun envoi automatique pendant l'écran
        const cles = Object.keys(await store.revisions()).sort();
        cle = cle || cles[0];
        const revs = cle ? await store.history(cle) : [];
        box.innerHTML = '<strong style="color:#20314a">Grist — historique</strong><div data-m style="margin:4px 0"></div><div data-b></div>';
        const zone = box.querySelector('[data-b]'), m = box.querySelector('[data-m]');
        m.textContent = cle ? 'Section « ' + cle + ' » : choisissez la version à restaurer.' : 'Aucune section publiée.';
        const sel = document.createElement('select'); sel.style.cssText = 'width:100%;margin-bottom:4px';
        for (const c of cles) { const o = document.createElement('option'); o.value = c; o.textContent = c + (st.illisibles.includes(c) ? ' (illisible)' : ''); o.selected = c === cle; sel.appendChild(o); }
        sel.onchange = () => { st.mode = retour.mode; historique(sel.value).catch(erreur); };
        zone.appendChild(sel);
        for (const v of revs) {
            const ok = v.complet && !v.courante;
            const l = 'Révision ' + v.revision + (v.courante ? ' (actuelle)' : '') + ' · ' + Math.round(v.taille / 1024) + ' Ko' + (v.complet ? '' : ' · incomplète') + (v.verifiable ? '' : ' · non vérifiable');
            const b = bouton(l, () => restaurer(cle, v, retour), ok); b.disabled = !ok; b.style.display = 'block'; b.style.width = '100%'; b.style.textAlign = 'left';
            zone.appendChild(b);
        }
        zone.appendChild(bouton('Retour', async () => { st.mode = retour.mode; if (retour.mode === 'illisible') await demarrer(); else setMode(retour.mode, retour.msg); }));
    }

    function restaurer(cle, v, retour) {
        showConfirm('Restaurer la section « ' + esc(cle) + ' » à la révision ' + v.revision + ' ?\nCela crée une nouvelle révision (rien n’est effacé) et remplace cette section dans l’application ouverte.', async () => {
            try {
                const r = await store.restore(cle, v.revision, null, v.nonce);
                st.mode = retour.mode === 'historique' ? 'sync' : retour.mode;
                if (!r.committed) return signalerRefus(r);
                await chargerDistant([cle], true);
            } catch (e) { st.mode = retour.mode; erreur(e); }
        }, () => {});
    }

    async function installer() {
        const res = await Store.installProtection(grist.docApi);
        st.ok = true; await demarrer(); box.querySelector('[data-m]').textContent += ' (règle ' + res.regle + ')';
    }

    /** Publie un projet dans les blocs (utilisé par « Revenir aux blocs » du pont des tables). */
    async function publierDansBlocs(db) {
        const lu = await store.pull();
        const r = await store.push(Store.splitDb(db), lu.baseline);
        if (!r.committed) throw new Error('Les blocs ont refusé l’écriture : le document reste en mode tables.');
    }
    function confirmerBascule() {
        showConfirm('Passer ce document aux tables structurées ?\nLes 15 tables DNB_* sont créées et protégées, le projet ouvert y est copié puis relu pour contrôle. Les blocs actuels restent dans le document comme archive et ne sont plus mis à jour. Réservé au propriétaire du document.', async () => {
            try {
                await envoyer();                                  // l'archive en blocs est d'abord mise à jour
                if (st.mode !== 'sync') return;                   // conflit ou refus : on ne bascule pas
                clearTimeout(st.timer); st.timer = null;
                await window.DnbPontTables.convertir(grist, JSON.parse(JSON.stringify(DB)), etape);
                await demarrer();
            } catch (e) { erreur(e); }
        }, () => {});
    }

    async function demarrer() {
        if (window.DnbPontTables) {
            let tables = false; try { tables = await window.DnbPontTables.actif(grist); } catch (e) { tables = false; }
            if (tables) { st.mode = 'tables'; clearTimeout(st.timer); st.timer = null; box.style.display = 'none'; return window.DnbPontTables.demarrer(grist, { retourBlocs: publierDansBlocs }); }
        }
        const noms = (await grist.docApi.listTables()).map(t => (typeof t === 'string' ? t : t.id));
        if (!noms.includes(Store.T_SECTIONS) || !noms.includes(Store.T_MORCEAUX)) return setMode('absent', 'Les tables de stockage n’existent pas dans ce document.');
        const prot = await Store.verifyProtection(grist.docApi);
        st.verifiable = prot.verifiable;
        if (!prot.ok && !st.ok) return setMode('nonprotege', prot.raison + '. Aucune écriture n’est faite tant que la protection contre les écrasements n’est pas en place.');
        const lu = await store.pull();
        st.baseline = lu.baseline; st.illisibles = lu.problems.map(p => p.cle);
        if (lu.problems.length) return setMode('illisible', 'Section(s) illisible(s) dans Grist : ' + lu.problems.map(p => p.cle).join(', ') + '. Aucune écriture automatique ; choisissez.');
        if (!Object.keys(lu.sections).length) return setMode('vide', 'Aucun projet dans ce document Grist. Le projet local n’est pas envoyé automatiquement.');
        if (!(DB.students && DB.students.length) && !(DB.rooms && DB.rooms.length)) return chargerDistant(null);
        const dernier = Object.values(lu.meta).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || {};
        setMode('local', 'Un projet existe dans Grist et un projet local est ouvert : choisissez.');
        showConfirm('Un projet existe dans Grist.\nDernière publication : ' + esc(dernier.auteur || 'auteur inconnu') + ', ' + esc(dernier.date || 'date inconnue') + '.\nLe charger remplace le projet ouvert dans l’application (exportez-le avant si besoin).',
            () => chargerDistant(null).catch(erreur), () => setMode('local', 'Le projet local n’est pas synchronisé : rien n’est envoyé à Grist.'));
    }

    /** cles = null : tout le projet est remplacé par celui de Grist ; sinon seules ces sections, le reste local est conservé. */
    async function chargerDistant(cles, ignorerProblemes) {
        etape('Lecture de Grist…');
        const lu = await store.pull();
        etape('Chargement dans l’application…');
        st.illisibles = lu.problems.map(p => p.cle);
        if (lu.problems.length && !ignorerProblemes) throw new Error('Section(s) illisible(s) dans Grist : ' + lu.problems.map(p => p.cle).join(', '));
        const cibles = cles || Object.keys(lu.sections);
        const local = (cles || ignorerProblemes) ? sections() : {};   // chargement partiel : les sections absentes de Grist gardent leur valeur locale (sinon l'application plante)
        for (const k of cibles) if (k in lu.sections) local[k] = lu.sections[k];
        const base = cles ? Object.assign({}, st.baseline) : {};
        for (const k of cibles) if (lu.baseline[k]) base[k] = lu.baseline[k];
        st.chargement = true; clearTimeout(st.timer); st.timer = null;
        try {
            await new Promise((res, rej) => {
                const delai = setTimeout(() => rej(new Error('L’application n’a pas terminé le chargement (aucune réponse après 20 s).')), 20000);
                loadGlobalData(new File([JSON.stringify(Store.joinDb(local))], 'grist.data', { type: 'application/json' }), () => { clearTimeout(delai); res(); });
            });
        }
        finally { st.chargement = false; }
        st.baseline = base; st.conflits = st.conflits.filter(k => !cibles.includes(k)); st.distant = st.distant.filter(k => !cibles.includes(k));
        setMode('sync', 'Chargé depuis Grist à ' + heure() + '.');
    }

    function confirmerPublication() {
        showConfirm('Publier le projet local dans Grist ?\nCela crée une nouvelle révision de chaque section modifiée ; les révisions précédentes restent restaurables (3 conservées).', () => publierTout().catch(erreur));
    }
    async function publierTout() {
        const lu = await store.pull();
        const r = await store.push(sections(), lu.baseline);
        if (!r.committed) return signalerRefus(r);
        st.baseline = r.baseline; st.distant = []; st.conflits = [];
        setMode('sync', 'Projet publié dans Grist à ' + heure() + ' (' + r.saved.length + ' section(s)).');
    }

    function signalerRefus(r) {
        if (r.refused) return setMode('erreur', 'Grist a refusé l’écriture (droits insuffisants ou règle mal posée). Vos données locales sont intactes.');
        st.conflits = r.conflicts;
        setMode('conflit', 'Modifié par un autre utilisateur : ' + r.conflicts.join(', ') + '. Vos modifications restent locales, rien n’a été écrasé.');
    }

    async function envoyer() {
        if (st.occupe || st.mode !== 'sync') return;
        st.occupe = true;
        try {
            // l'envoi automatique ne touche jamais une section illisible : seul « Publier (répare) », explicite, le fait
            const mes = (await store.changedKeys(sections(), st.baseline)).filter(k => !(st.illisibles || []).includes(k));
            if (!mes.length) { st.timer = null; return; }
            const r = await store.push(sections(), st.baseline, { seulement: mes });
            if (!r.committed) return signalerRefus(r);
            st.baseline = r.baseline; st.timer = null;
            if (r.saved.length) { st.distant = st.distant.filter(k => !r.saved.includes(k)); setMode('sync', 'Enregistré dans Grist à ' + heure() + ' (' + r.saved.join(', ') + ').'); }
        } finally { st.occupe = false; }
    }

    async function garderLaMienne() {
        const mes = await store.changedKeys(sections(), st.baseline);   // uniquement ce que j'ai moi-même modifié
        const frais = await store.pull();
        const r = await store.push(sections(), frais.baseline, { seulement: mes });
        if (!r.committed) return signalerRefus(r);
        const base = Object.assign({}, st.baseline);
        for (const k of mes) base[k] = r.baseline[k];                    // les autres sections gardent leur ancienne référence
        st.baseline = base; st.conflits = [];
        setMode('sync', 'Vos modifications ont été publiées à ' + heure() + ' (' + mes.join(', ') + ').');
        await verifierDistant();
    }

    async function verifierDistant() {
        if (st.mode !== 'sync' && st.mode !== 'conflit') return;
        const rev = await store.revisions();
        const nouveaux = Object.keys(rev).filter(k => rev[k].revision > ((st.baseline[k] || {}).revision || 0) && !st.conflits.includes(k) && !(st.illisibles || []).includes(k));   // une section illisible n'est pas « modifiée par un autre »
        if (nouveaux.join() === st.distant.join()) return;
        st.distant = nouveaux;
        if (st.mode === 'sync') setMode('sync', nouveaux.length ? 'Modifications disponibles de ' + [...new Set(nouveaux.map(k => rev[k].auteur || 'un autre utilisateur'))].join(', ') + '.' : st.msg);
    }

    function programmerEnvoi() {
        if (st.chargement || st.mode !== 'sync') return;
        clearTimeout(st.timer);
        st.timer = setTimeout(() => envoyer().catch(erreur), DELAI_ENVOI_MS);
    }

    const script = document.createElement('script');
    script.src = 'https://grist.numerique.gouv.fr/grist-plugin-api.js';
    script.onload = () => {
        grist = window.grist; grist.ready({ requiredAccess: 'full' });
        store = Store.createStore(grist.docApi, { auteur });
        const original = window.autoSave;
        if (typeof original === 'function') window.autoSave = function () { const r = original.apply(this, arguments); programmerEnvoi(); return r; };
        window.addEventListener('beforeunload', e => { if (st.timer && st.mode === 'sync') { e.preventDefault(); e.returnValue = ''; } });
        setInterval(() => { if (!document.hidden) verifierDistant().catch(() => {}); }, POLL_MS);
        setMode('init', 'Vérification du stockage…');
        demarrer().catch(erreur);
    };
    script.onerror = () => setMode('erreur', 'Impossible de charger l’API des widgets Grist.');
    document.head.appendChild(script);
})();
