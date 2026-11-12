/* Orga Exam — modèle structuré Grist (les tables sont la source de vérité).
 *
 * encode(db)  -> { TABLE: [ {Cle, Ordre, <colonnes typées>, Extra} ] }
 * decode(rows) -> db
 * Garantie visée et testée : decode(encode(db)) est égal à db (égalité profonde), quel que soit db.
 *
 * Règles de fidélité :
 *  - une colonne typée ne reçoit une valeur que si elle a le type attendu ; sinon la valeur reste dans Extra ;
 *  - Extra (JSON) porte tout champ non modélisé, les valeurs nulles ou atypiques, et `_absents` (champs
 *    modélisés absents de l'objet d'origine) ;
 *  - à la lecture, une colonne non vide l'emporte toujours (c'est ainsi qu'une saisie faite dans Grist
 *    revient dans l'application) ; une colonne vide laisse parler Extra.
 *
 * Protection par ligne (mesurée sur l'instance le 12/11/2026, propriétaire) :
 *  colonnes techniques Base (Int), Jeton (Text), Revision (Int, formule de déclenchement +1 à chaque
 *  modification), règle « newRec.Jeton != rec.Jeton and newRec.Base != rec.Revision » -> -U, et -D.
 */
(function (root) {
    'use strict';
    const P = 'DNB_';
    const T = { ELEVES: P + 'Eleves', SALLES: P + 'Salles', ENS: P + 'Enseignants', AFFECT: P + 'Affectations',
        SURV: P + 'Surveillances', EPREUVES: P + 'Epreuves', O_CAND: P + 'Oraux_Candidats', O_ENS: P + 'Oraux_Enseignants',
        O_PASS: P + 'Oraux_Passages', S_JURYS: P + 'Stage_Jurys', S_PASS: P + 'Stage_Passages', RESULTATS: P + 'Resultats',
        PRESENCES: P + 'Presences', PARAMS: P + 'Parametres' };

    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    function getPath(o, path) { let c = o; for (const k of path.split('.')) { if (!isObj(c) || !has(c, k)) return { ok: false }; c = c[k]; } return { ok: true, v: c }; }
    function setPath(o, path, v) { const ks = path.split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) { if (!isObj(c[ks[i]])) c[ks[i]] = {}; c = c[ks[i]]; } c[ks[ks.length - 1]] = v; }
    function delPath(o, path) { const ks = path.split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) { if (!isObj(c[ks[i]])) return; c = c[ks[i]]; } delete c[ks[ks.length - 1]]; }
    function deepEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
        const ka = Object.keys(a), kb = Object.keys(b);
        return ka.length === kb.length && ka.every(k => has(b, k) && deepEqual(a[k], b[k]));
    }

    const RESERVES = ['_valeur', '_absents', '_id', '_copie', '_n', '_extra_illisible'];
    /* Nom de salle, de jury ou de profil utilisable tel quel comme valeur de colonne et dans une clé. */
    const cleSure = k => typeof k === 'string' && k !== '' && k.trim() === k && !k.includes('|') && k !== '(actif)';
    const VIDE = { Text: '', Bool: false, Int: 0, Numeric: 0 };
    const typeOk = (type, v) => type === 'Text' ? typeof v === 'string'
        : type === 'Bool' ? typeof v === 'boolean'
        : type === 'Int' ? Number.isInteger(v)
        : typeof v === 'number' && Number.isFinite(v);
    const estVide = (type, v) => v === null || v === undefined || v === VIDE[type] || (type !== 'Text' && v === '');

    /* fields : [chemin dans l'objet, colonne, type]. Listes de textes : type 'Liste' (jointes par « , »). */
    function toRow(obj, fields) {
        const row = {}, absents = [];
        // non-objet, ou objet portant un nom réservé : conservé entier, aucune colonne typée
        const entier = !isObj(obj) || RESERVES.some(k => has(obj, k));
        const reste = entier ? { _valeur: clone(obj) } : clone(obj);
        for (const [path, col, type] of fields) {
            const g = entier ? { ok: false } : getPath(obj, path);
            if (type === 'Liste') {
                const ok = g.ok && Array.isArray(g.v) && g.v.length > 0 && g.v.every(x => typeof x === 'string' && x !== '' && x.trim() === x && !x.includes(','));
                row[col] = ok ? g.v.join(', ') : '';
                if (ok) delPath(reste, path); else if (!g.ok && !entier) absents.push(path);
                continue;
            }
            if (g.ok && typeOk(type, g.v)) { row[col] = g.v; delPath(reste, path); }
            else { row[col] = type === 'Text' ? '' : (type === 'Bool' ? false : null); if (!g.ok && !entier) absents.push(path); }
        }
        if (absents.length) reste._absents = absents;
        row.Extra = Object.keys(reste).length ? JSON.stringify(reste) : '';
        return row;
    }
    function fromRow(row, fields) {
        let reste = {};
        if (row.Extra) { try { reste = JSON.parse(row.Extra); } catch (e) { reste = { _extra_illisible: String(row.Extra) }; } }
        if (!isObj(reste)) reste = { _valeur: reste };
        if (has(reste, '_valeur') && Object.keys(reste).length === 1) return reste._valeur;
        const absents = new Set(Array.isArray(reste._absents) ? reste._absents : []); delete reste._absents;
        const obj = reste;
        for (const [path, col, type] of fields) {
            const v = row[col];
            if (type === 'Liste') {
                if (typeof v === 'string' && v.trim() !== '') setPath(obj, path, v.split(',').map(s => s.trim()).filter(Boolean));
                continue;
            }
            if (estVide(type, v)) {
                if (absents.has(path) || getPath(obj, path).ok) continue;   // absent d'origine, ou valeur atypique gardée dans Extra
                setPath(obj, path, VIDE[type]);
            } else setPath(obj, path, type === 'Text' ? String(v) : (type === 'Bool' ? !!v : Number(v)));
        }
        return obj;
    }

    /* ---------- Définition des colonnes ---------- */
    const NOTES_BLANC = [['grades.fr', 'Note_Francais'], ['grades.math', 'Note_Maths'], ['grades.hg', 'Note_HG'], ['grades.emc', 'Note_EMC'],
        ['grades.svt', 'Note_SVT'], ['grades.pc', 'Note_PC'], ['grades.tech', 'Note_Techno'], ['grades.oral', 'Note_Oral'], ['grades.genAvg', 'Moyenne']].map(x => [...x, 'Numeric']);
    const F = {
        [T.ELEVES]: [['nom', 'Nom', 'Text'], ['prenom', 'Prenom', 'Text'], ['classe', 'Classe', 'Text'], ['sexe', 'Sexe', 'Text'], ['mef', 'MEF', 'Text'],
            ['anonymat', 'Anonymat', 'Text'], ['tt', 'Tiers_temps', 'Bool'], ['labels', 'Amenagements', 'Liste'], ...NOTES_BLANC],
        [T.SALLES]: [['nom', 'Nom', 'Text'], ['capacite', 'Capacite', 'Int'], ['isTT', 'Tiers_temps', 'Bool'], ['isAmen', 'Amenagee', 'Bool'], ['nbSurv', 'Nb_surveillants', 'Int']],
        [T.ENS]: [['civ', 'Civilite', 'Text'], ['nom', 'Nom', 'Text'], ['prenom', 'Prenom', 'Text'], ['matiere', 'Discipline', 'Text'], ['noHSE', 'Sans_HSE', 'Bool']],
        [T.AFFECT]: [],   // colonnes calculées à la main : Salle, Eleve
        [T.SURV]: [],     // Source, Epreuve, Salle, Type, Creneau, Poste, Enseignant
        [T.EPREUVES]: [['name', 'Nom', 'Text'], ['date', 'Date', 'Text'], ['time', 'Heure', 'Text'], ['timeTT', 'Heure_tiers_temps', 'Text'], ['durStd', 'Duree_min', 'Int'], ['durTT', 'Duree_tiers_temps_min', 'Int']],
        [T.O_CAND]: [['nom', 'Nom', 'Text'], ['prenom', 'Prenom', 'Text'], ['classe', 'Classe', 'Text'], ['sexe', 'Sexe', 'Text'], ['langue', 'Langue', 'Text'],
            ['parcours', 'Parcours', 'Text'], ['sujet', 'Sujet', 'Text'], ['groupId', 'Groupe', 'Text'], ['isPriority', 'Prioritaire', 'Bool']],
        [T.O_ENS]: [['nom', 'Nom', 'Text'], ['prenom', 'Prenom', 'Text'], ['matiere', 'Discipline', 'Text'], ['startTime', 'Debut', 'Text'], ['endTime', 'Fin', 'Text'],
            ['langue', 'Langue', 'Text'], ['jury', 'Jury', 'Text'], ['salle', 'Salle', 'Text'], ['isReserve', 'Reserve', 'Bool']],
        [T.O_PASS]: [['type', 'Type', 'Text'], ['theme', 'Theme', 'Text'], ['langue', 'Langue', 'Text'], ['startTime', 'Debut', 'Text'], ['endTime', 'Fin', 'Text']],
        [T.S_JURYS]: [['name', 'Nom', 'Text'], ['room', 'Salle', 'Text'], ['members', 'Membres', 'Liste']],
        [T.S_PASS]: [['juryId', 'Jury', 'Int'], ['time', 'Heure', 'Text'], ['studentId', 'Eleve_ancien', 'Int']],
        [T.RESULTATS]: [['nom', 'Nom', 'Text'], ['prenom', 'Prenom', 'Text'], ['classe', 'Classe', 'Text'], ['sexe', 'Sexe', 'Text'], ['officialResult', 'Resultat', 'Text'],
            ['officialMeta.serie', 'Serie', 'Text'], ['officialMeta.numero', 'Numero_candidat', 'Text'], ['officialMeta.ine', 'INE', 'Text'],
            ...[['grades.fr', 'Note_Francais'], ['grades.math', 'Note_Maths'], ['grades.hg', 'Note_HG'], ['grades.emc', 'Note_EMC'], ['grades.sci', 'Note_Sciences'],
                ['grades.oral', 'Note_Oral'], ['grades.genAvg', 'Moyenne'], ['grades.finalAvg', 'Moyenne_finale'], ['officialMeta.rawHg', 'Brut_HG'], ['officialMeta.rawEmc', 'Brut_EMC']].map(x => [...x, 'Numeric'])],
        [T.PRESENCES]: [],
        [T.PARAMS]: []
    };
    const COLS_A_LA_MAIN = {
        [T.AFFECT]: [['Salle', 'Text'], ['Eleve', 'Text']],
        [T.SURV]: [['Source', 'Text'], ['Epreuve', 'Int'], ['Salle', 'Text'], ['Type', 'Text'], ['Creneau', 'Int'], ['Poste', 'Int'], ['Enseignant', 'Text']],
        [T.EPREUVES]: [['Profil', 'Text']],
        [T.O_PASS]: [['Jury', 'Text'], ['Eleves', 'Text']],
        [T.PRESENCES]: [['Profil', 'Text']],
        [T.PARAMS]: [['Valeur', 'Text']]
    };
    const TECH = [['Cle', 'Text'], ['Ordre', 'Int'], ['Extra', 'Text'], ['Supprime', 'Bool'], ['Base', 'Int'], ['Jeton', 'Text'], ['Revision', 'Int']];
    const SCHEMA = Object.keys(F).map(t => ({ table: t, colonnes: [TECH[0], TECH[1], ...(COLS_A_LA_MAIN[t] || []), ...F[t].map(([, c, ty]) => [c, ty === 'Liste' ? 'Text' : ty]), ...TECH.slice(2)] }));
    /* Colonnes sensibles : à restreindre par des règles d'accès de colonne pour les simples lecteurs. */
    const SENSIBLES = { [T.ELEVES]: ['Tiers_temps', 'Amenagements', ...NOTES_BLANC.map(x => x[1]), 'Extra'],
        [T.RESULTATS]: ['INE', 'Numero_candidat', 'Resultat', 'Note_Francais', 'Note_Maths', 'Note_HG', 'Note_EMC', 'Note_Sciences', 'Note_Oral', 'Moyenne', 'Moyenne_finale', 'Brut_HG', 'Brut_EMC', 'Extra'] };

    /* ---------- Clés stables ---------- */
    function cles(list, idDe) {
        const vues = new Set();
        return list.map((o, i) => {
            const id = isObj(o) ? idDe(o) : undefined;
            const propre = (typeof id === 'string' && id !== '' && !id.includes('|')) || Number.isInteger(id);
            const cle = propre ? String(id) : '#' + i;
            if (propre && !cle.startsWith('#') && !vues.has(cle) && !RESERVES.some(x => has(o, x))) { vues.add(cle); return { cle, genere: false }; }
            let c = '#' + i; while (vues.has(c)) c += '~'; vues.add(c); return { cle: c, genere: true };
        });
    }
    /* Liste d'objets à identifiant : l'identifiant devient Cle (et sort de Extra) sauf clé générée. */
    function listeVersLignes(list, table, champId) {
        const ks = cles(list, o => o[champId]);
        return list.map((o, i) => {
            const k = ks[i];
            let src = o;
            if (!k.genere && isObj(o)) { src = Object.assign({}, o); delete src[champId]; }
            const row = toRow(src, F[table]);
            if (!k.genere && typeof o[champId] === 'number') { const e = row.Extra ? JSON.parse(row.Extra) : {}; e._id = 'n'; row.Extra = JSON.stringify(e); }
            return Object.assign({ Cle: k.cle, Ordre: i }, row);
        });
    }
    function lignesVersListe(rows, table, champId) {
        return trier(rows).map(r => {
            let typeId = String(r.Cle).startsWith('#') ? null : 's'; let extra = r.Extra;   // clé « #n » : générée, l'identifiant éventuel est dans Extra
            if (extra) { try { const e = JSON.parse(extra); if (isObj(e) && has(e, '_id')) { typeId = e._id; delete e._id; extra = Object.keys(e).length ? JSON.stringify(e) : ''; } } catch (e) { /* géré par fromRow */ } }
            const o = fromRow(Object.assign({}, r, { Extra: extra }), F[table]);
            if (typeId && isObj(o)) o[champId] = typeId === 'n' ? Number(r.Cle) : String(r.Cle);
            return o;
        });
    }
    const trier = rows => rows.filter(r => !r.Supprime).slice().sort((a, b) => (a.Ordre || 0) - (b.Ordre || 0) || String(a.Cle).localeCompare(String(b.Cle)));

    /* ---------- Sections particulières ---------- */
    const RE_SURV = /^(\d+)_(.+)_(std|tt|dict)_(\d+)_(\d+)$/, RE_RES = /^(\d+)_reserve_(\d+)$/;
    function survVersLignes(obj, source, out) {
        Object.keys(obj).forEach((k, i) => {
            const v = obj[k], row = { Cle: source + '|' + k, Ordre: i, Source: source, Epreuve: null, Salle: '', Type: '', Creneau: null, Poste: null, Enseignant: '', Extra: '' };
            const m = RE_SURV.exec(k), r = RE_RES.exec(k);
            if (m) Object.assign(row, { Epreuve: +m[1], Salle: m[2], Type: m[3], Creneau: +m[4], Poste: +m[5] });
            else if (r) Object.assign(row, { Epreuve: +r[1], Type: 'reserve', Poste: +r[2] });
            if (typeof v === 'string' && v !== '') row.Enseignant = v; else row.Extra = JSON.stringify({ _valeur: v });
            out.push(row);
        });
    }
    function lignesVersSurv(rows, source) {
        const o = {};
        for (const r of trier(rows.filter(x => x.Source === source || String(x.Cle).startsWith(source + '|')))) {
            let k = String(r.Cle).startsWith(source + '|') ? String(r.Cle).slice(source.length + 1) : null;
            if (k === null) continue;
            let v = r.Enseignant || '';
            if (!r.Enseignant && r.Extra) { try { v = JSON.parse(r.Extra)._valeur; } catch (e) { v = ''; } }
            o[k] = v;
        }
        return o;
    }

    /* Copies d'élèves (répartition, passages d'oraux) : on ne stocke que la référence quand la copie est
     * identique à la fiche ; sinon la copie divergente est conservée telle quelle. */
    function refOuCopie(copie, index) {
        const id = isObj(copie) ? copie.id : undefined;
        if ((typeof id === 'string' || typeof id === 'number') && index.has(String(id)) && deepEqual(index.get(String(id)), copie)) return { ref: id };
        return { copie: clone(copie) };
    }
    const indexer = list => { const m = new Map(); if (Array.isArray(list)) for (const o of list) if (isObj(o) && (typeof o.id === 'string' || typeof o.id === 'number') && !m.has(String(o.id))) m.set(String(o.id), o); return m; };

    const SECTIONS_TABLES = ['students', 'rooms', 'teachers', 'distribution', 'planning', 'planningReserve', 'exams', 'examProfiles', 'oralConfig', 'stage', 'officialResults', 'examAttendance', 'examAttendanceProfiles'];
    const param = (out, cle, v, ordre) => out[T.PARAMS].push({ Cle: cle, Ordre: ordre || 0, Valeur: JSON.stringify(v), Extra: '' });

    function encode(db) {
        const out = {}; for (const t of Object.keys(F)) out[t] = [];
        const structure = { racine: Object.keys(db) };
        const brut = (k) => param(out, 'brut|' + k, db[k]);   // section non conforme : conservée entière

        if (has(db, 'students')) Array.isArray(db.students) ? out[T.ELEVES] = listeVersLignes(db.students, T.ELEVES, 'id') : brut('students');
        if (has(db, 'rooms')) Array.isArray(db.rooms) ? out[T.SALLES] = listeVersLignes(db.rooms, T.SALLES, 'id') : brut('rooms');
        if (has(db, 'teachers')) Array.isArray(db.teachers) ? out[T.ENS] = listeVersLignes(db.teachers, T.ENS, 'id') : brut('teachers');
        if (has(db, 'officialResults')) Array.isArray(db.officialResults) ? out[T.RESULTATS] = listeVersLignes(db.officialResults, T.RESULTATS, 'id') : brut('officialResults');

        if (has(db, 'distribution')) {
            const d = db.distribution;
            if (isObj(d) && Object.values(d).every(Array.isArray) && Object.keys(d).every(cleSure)) {
                const idx = indexer(db.students); structure.distribution = Object.keys(d);
                for (const salle of Object.keys(d)) d[salle].forEach((c, i) => {
                    const r = refOuCopie(c, idx);
                    out[T.AFFECT].push({ Cle: salle + '|' + i, Ordre: out[T.AFFECT].length, Salle: salle, Eleve: has(r, 'ref') ? String(r.ref) : '',
                        Extra: has(r, 'ref') ? (typeof r.ref === 'number' ? '{"_n":1}' : '') : JSON.stringify({ _copie: r.copie }) });
                });
            } else brut('distribution');
        }
        for (const [k, source] of [['planning', 'planning'], ['planningReserve', 'reserve']]) if (has(db, k)) {
            if (isObj(db[k]) && Object.keys(db[k]).every(x => !x.includes('|'))) { structure[k] = true; survVersLignes(db[k], source, out[T.SURV]); } else brut(k);
        }
        const epreuves = (list, profil, cle) => list.forEach((e, i) => out[T.EPREUVES].push(Object.assign({ Cle: cle + '|' + i, Ordre: out[T.EPREUVES].length, Profil: profil }, toRow(e, F[T.EPREUVES]))));
        if (has(db, 'exams')) Array.isArray(db.exams) ? epreuves(db.exams, '(actif)', 'actif') : brut('exams');
        if (has(db, 'examProfiles')) {
            const p = db.examProfiles;
            if (isObj(p) && Object.values(p).every(Array.isArray) && Object.keys(p).every(cleSure)) { structure.examProfiles = Object.keys(p); for (const k of Object.keys(p)) epreuves(p[k], k, 'profil|' + k); }
            else brut('examProfiles');
        }
        const presences = (list, profil, cle) => list.forEach((e, i) => out[T.PRESENCES].push({ Cle: cle + '|' + i, Ordre: out[T.PRESENCES].length, Profil: profil, Extra: JSON.stringify({ _valeur: e }) }));
        if (has(db, 'examAttendance')) Array.isArray(db.examAttendance) ? presences(db.examAttendance, '(actif)', 'actif') : brut('examAttendance');
        if (has(db, 'examAttendanceProfiles')) {
            const p = db.examAttendanceProfiles;
            if (isObj(p) && Object.values(p).every(Array.isArray) && Object.keys(p).every(cleSure)) { structure.examAttendanceProfiles = Object.keys(p); for (const k of Object.keys(p)) presences(p[k], k, 'profil|' + k); }
            else brut('examAttendanceProfiles');
        }

        if (has(db, 'oralConfig')) {
            const oc = db.oralConfig;
            if (isObj(oc)) {
                const st = { cles: Object.keys(oc) }; const reste = Object.assign({}, oc);
                if (Array.isArray(oc.students)) { out[T.O_CAND] = listeVersLignes(oc.students, T.O_CAND, 'id'); delete reste.students; st.students = true; }
                if (Array.isArray(oc.teachers)) { out[T.O_ENS] = listeVersLignes(oc.teachers, T.O_ENS, 'id'); delete reste.teachers; st.teachers = true; }
                const d = oc.distribution;
                if (isObj(d) && Object.values(d).every(Array.isArray) && Object.keys(d).every(cleSure)) {
                    const idx = indexer(oc.students); st.distribution = Object.keys(d); delete reste.distribution;
                    for (const jury of Object.keys(d)) d[jury].forEach((s, i) => {
                        let src = s, eleves = '';
                        if (isObj(s) && Array.isArray(s.students)) {
                            const refs = s.students.map(c => refOuCopie(c, idx));
                            if (refs.length && refs.every(r => has(r, 'ref') && typeof r.ref === 'string' && r.ref !== '' && r.ref.trim() === r.ref && !r.ref.includes(','))) { eleves = refs.map(r => r.ref).join(', '); src = Object.assign({}, s); delete src.students; }
                        }
                        out[T.O_PASS].push(Object.assign({ Cle: jury + '|' + i, Ordre: out[T.O_PASS].length, Jury: jury, Eleves: eleves }, toRow(src, F[T.O_PASS])));
                    });
                }
                structure.oralConfig = st;
                Object.keys(reste).forEach((k, i) => param(out, 'oralConfig|' + k, reste[k], i));
            } else brut('oralConfig');
        }
        if (has(db, 'stage')) {
            const s = db.stage;
            if (isObj(s)) {
                const st = { cles: Object.keys(s) }; const reste = Object.assign({}, s);
                if (Array.isArray(s.juries)) { out[T.S_JURYS] = listeVersLignes(s.juries, T.S_JURYS, 'id'); delete reste.juries; st.juries = true; }
                if (Array.isArray(s.planning)) { out[T.S_PASS] = s.planning.map((p, i) => Object.assign({ Cle: '#' + i, Ordre: i }, toRow(p, F[T.S_PASS]))); delete reste.planning; st.planning = true; }
                structure.stage = st;
                Object.keys(reste).forEach((k, i) => param(out, 'stage|' + k, reste[k], i));
            } else brut('stage');
        }
        /* Tout le reste : une ligne par clé de premier niveau des objets, sinon la section entière. */
        for (const k of Object.keys(db)) {
            if (SECTIONS_TABLES.includes(k)) continue;
            if (isObj(db[k]) && Object.keys(db[k]).length && Object.keys(db[k]).every(x => !x.includes('|')) && !k.includes('|')) {
                structure['objet|' + k] = Object.keys(db[k]);
                Object.keys(db[k]).forEach((x, i) => param(out, k + '|' + x, db[k][x], i));
            } else param(out, 'section|' + k, db[k]);
        }
        param(out, '_structure', structure, -1);
        return out;
    }

    function decode(rows) {
        const R = t => (rows[t] || []).filter(r => !r.Supprime);
        const P = new Map(); for (const r of R(T.PARAMS)) { try { P.set(String(r.Cle), JSON.parse(r.Valeur)); } catch (e) { P.set(String(r.Cle), { _illisible: String(r.Valeur) }); } }
        const structure = P.get('_structure') || {};
        const parPrefixe = (pre) => trier(R(T.PARAMS)).filter(r => String(r.Cle).startsWith(pre + '|')).map(r => [String(r.Cle).slice(pre.length + 1), P.get(String(r.Cle))]);
        const db = {};
        const grouper = (lignes, champ, cles) => { const o = {}; for (const k of cles || []) o[k] = []; for (const r of lignes) { const k = (typeof r[champ] === 'string' && r[champ] !== '') ? r[champ] : '(sans nom)'; if (!has(o, k)) o[k] = []; o[k].push(r); } return o; };

        const section = {
            students: () => lignesVersListe(R(T.ELEVES), T.ELEVES, 'id'),
            rooms: () => lignesVersListe(R(T.SALLES), T.SALLES, 'id'),
            teachers: () => lignesVersListe(R(T.ENS), T.ENS, 'id'),
            officialResults: () => lignesVersListe(R(T.RESULTATS), T.RESULTATS, 'id'),
            distribution: () => {
                const idx = indexer(db.students);
                const g = grouper(trier(R(T.AFFECT)), 'Salle', structure.distribution), o = {};
                for (const salle of Object.keys(g)) o[salle] = g[salle].map(r => {
                    let e = {}; if (r.Extra) { try { e = JSON.parse(r.Extra); } catch (x) { e = {}; } }
                    if (has(e, '_copie')) return e._copie;
                    return idx.has(String(r.Eleve)) ? clone(idx.get(String(r.Eleve))) : { id: e._n ? Number(r.Eleve) : String(r.Eleve) };
                });
                return o;
            },
            planning: () => lignesVersSurv(R(T.SURV), 'planning'),
            planningReserve: () => lignesVersSurv(R(T.SURV), 'reserve'),
            exams: () => trier(R(T.EPREUVES)).filter(r => String(r.Cle).startsWith('actif|') || r.Profil === '(actif)').map(r => fromRow(r, F[T.EPREUVES])),
            examProfiles: () => { const l = trier(R(T.EPREUVES)).filter(r => !(String(r.Cle).startsWith('actif|') || r.Profil === '(actif)')); const g = grouper(l, 'Profil', structure.examProfiles), o = {}; for (const k of Object.keys(g)) o[k] = g[k].map(r => fromRow(r, F[T.EPREUVES])); return o; },
            examAttendance: () => trier(R(T.PRESENCES)).filter(r => r.Profil === '(actif)').map(r => fromRow(r, [])),
            examAttendanceProfiles: () => { const l = trier(R(T.PRESENCES)).filter(r => r.Profil !== '(actif)'); const g = grouper(l, 'Profil', structure.examAttendanceProfiles), o = {}; for (const k of Object.keys(g)) o[k] = g[k].map(r => fromRow(r, [])); return o; },
            oralConfig: () => {
                const st = structure.oralConfig || {}, o = {}, autres = new Map(parPrefixe('oralConfig'));
                const cands = lignesVersListe(R(T.O_CAND), T.O_CAND, 'id'); const idx = indexer(cands);
                const valeurs = {
                    students: () => cands, teachers: () => lignesVersListe(R(T.O_ENS), T.O_ENS, 'id'),
                    distribution: () => { const g = grouper(trier(R(T.O_PASS)), 'Jury', st.distribution), d = {}; for (const j of Object.keys(g)) d[j] = g[j].map(r => {
                        const s = fromRow(r, F[T.O_PASS]);
                        if (typeof r.Eleves === 'string' && r.Eleves.trim() !== '' && isObj(s)) s.students = r.Eleves.split(',').map(x => x.trim()).filter(Boolean).map(id => idx.has(id) ? clone(idx.get(id)) : { id });
                        return s; }); return d; }
                };
                const ordre = st.cles || [...autres.keys(), 'students', 'teachers', 'distribution'];
                for (const k of ordre) { if (autres.has(k)) o[k] = autres.get(k); else if (valeurs[k] && (st[k] || !st.cles)) o[k] = valeurs[k](); }
                for (const [k, v] of autres) if (!has(o, k)) o[k] = v;
                return o;
            },
            stage: () => {
                const st = structure.stage || {}, o = {}, autres = new Map(parPrefixe('stage'));
                const valeurs = { juries: () => lignesVersListe(R(T.S_JURYS), T.S_JURYS, 'id'), planning: () => trier(R(T.S_PASS)).map(r => fromRow(r, F[T.S_PASS])) };
                const ordre = st.cles || [...autres.keys(), 'juries', 'planning'];
                for (const k of ordre) { if (autres.has(k)) o[k] = autres.get(k); else if (valeurs[k] && (st[k] || !st.cles)) o[k] = valeurs[k](); }
                for (const [k, v] of autres) if (!has(o, k)) o[k] = v;
                return o;
            }
        };
        const racine = Array.isArray(structure.racine) ? structure.racine.slice() : [];
        for (const k of ['students', ...Object.keys(section)]) if (!racine.includes(k) && !Array.isArray(structure.racine)) racine.push(k);
        for (const [c] of P) { const m = /^(?:brut|section)\|(.+)$/.exec(c); if (m && !racine.includes(m[1])) racine.push(m[1]); else { const x = /^([^|_][^|]*)\|/.exec(c); if (x && !['oralConfig', 'stage', 'brut', 'section'].includes(x[1]) && !racine.includes(x[1])) racine.push(x[1]); } }
        // les élèves d'abord : la répartition s'appuie dessus
        if (racine.includes('students')) db.students = P.has('brut|students') ? P.get('brut|students') : section.students();
        const res = {};
        for (const k of racine) {
            if (k === 'students') res[k] = db.students;
            else if (P.has('brut|' + k)) res[k] = P.get('brut|' + k);
            else if (P.has('section|' + k)) res[k] = P.get('section|' + k);
            else if (section[k]) res[k] = section[k]();
            else { const o = {}; const cles = structure['objet|' + k]; const vals = new Map(parPrefixe(k)); for (const x of cles || []) if (vals.has(x)) o[x] = vals.get(x); for (const [x, v] of vals) if (!has(o, x)) o[x] = v; res[k] = o; }
        }
        return res;
    }

    const api = { T, SCHEMA, SENSIBLES, encode, decode, deepEqual, toRow, fromRow };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.DnbTables = api;
})(typeof window !== 'undefined' ? window : globalThis);
