/* Orga Exam — préparer la session suivante.
 *
 * Produit, à partir du projet ouvert, un projet NEUF pour l'année suivante, téléchargé sous forme de fichier .data.
 * Le projet ouvert et le document Grist courant ne sont pas modifiés.
 * Principe : liste blanche. Seul ce qui est explicitement repris ci-dessous passe dans le nouveau projet ; tout le
 * reste (élèves, notes, aménagements individuels, répartition, surveillances, oraux, résultats, présences, journal,
 * et toute section inconnue) est laissé de côté. Usage prévu : un document Grist neuf par session.
 */
(function (root) {
    'use strict';
    const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const CONFIG_REPRIS = ['schoolName', 'year', 'city', 'logo', 'signature', 'director', 'nbSurv', 'examType', 'customExamName', 'scienceSubjects', 'labels', 'splitHGEMC',
        'teacherConvocInstructions', 'instructionTemplates', 'activeExamProfileKey', 'datavisSource', 'resultsWorkspace', 'oralStart', 'oralEnd', 'oralDuration'];
    const ORAL_REPRIS = ['general', 'pauses', 'languages', 'themes', 'grille', 'convocParams', 'simpleConvocParams', 'profConvocParams'];
    const ENSEIGNANT_REPRIS = ['id', 'civ', 'nom', 'prenom', 'matiere', 'noHSE'];
    const SALLE_REPRIS = ['id', 'nom', 'capacite', 'isTT', 'isAmen', 'nbSurv'];
    const nb = v => Array.isArray(v) ? v.length : obj(v) ? Object.keys(v).length : 0;

    /* options : { enseignants: bool (défaut true), dates: bool (défaut false) }. defauts : projet par défaut de l'application. */
    function preparerNouvelleSession(db, defauts, options) {
        const o = Object.assign({ enseignants: true, dates: false }, options || {});
        const src = obj(db) ? db : {}, p = clone(obj(defauts) ? defauts : {}) || {};
        const rapport = { conserve: [], efface: [], ignore: [] };
        const garde = (t, n) => rapport.conserve.push(n === undefined ? t : t + ' (' + n + ')');
        const efface = (t, n) => { if (n) rapport.efface.push(t + ' (' + n + ')'); };
        const epreuves = l => (Array.isArray(l) ? l : []).filter(obj).map(e => { const x = {}; for (const k of ['name', 'time', 'timeTT', 'durStd', 'durTT']) if (has(e, k)) x[k] = clone(e[k]); x.date = o.dates && typeof e.date === 'string' ? e.date : ''; return x; });

        // Configuration de l'établissement
        const c = obj(src.config) ? src.config : {}; p.config = obj(p.config) ? p.config : {};
        for (const k of CONFIG_REPRIS) if (has(c, k)) p.config[k] = clone(c[k]);
        if (o.dates && has(c, 'oralDate')) p.config.oralDate = clone(c.oralDate);
        if (obj(c.aeshConvocations)) { p.config.aeshConvocations = { lines: '', instructions: typeof c.aeshConvocations.instructions === 'string' ? c.aeshConvocations.instructions : '', assignments: {} };
            efface('affectations et noms d’AESH', nb(c.aeshConvocations.assignments)); }
        for (const k of Object.keys(c)) if (!CONFIG_REPRIS.includes(k) && k !== 'aeshConvocations' && k !== 'oralDate') rapport.ignore.push('config.' + k);
        garde('établissement, logo, signature, direction, libellés d’aménagements, modèles de consignes');

        // Salles, enseignants
        p.rooms = (Array.isArray(src.rooms) ? src.rooms : []).filter(obj).map(r => { const x = {}; for (const k of SALLE_REPRIS) if (has(r, k)) x[k] = clone(r[k]); return x; });
        garde('salles', p.rooms.length);
        const ens = (Array.isArray(src.teachers) ? src.teachers : []).filter(obj);
        p.teachers = o.enseignants ? ens.map(t => { const x = {}; for (const k of ENSEIGNANT_REPRIS) if (has(t, k)) x[k] = clone(t[k]); return x; }) : [];
        if (o.enseignants) garde('enseignants', p.teachers.length); else efface('enseignants', ens.length);

        // Épreuves : intitulés, horaires et durées repris ; dates seulement sur demande
        if (has(src, 'exams')) p.exams = epreuves(src.exams);
        if (obj(src.examProfiles)) { p.examProfiles = {}; for (const k of Object.keys(src.examProfiles)) p.examProfiles[k] = epreuves(src.examProfiles[k]); }
        garde('épreuves : intitulés, horaires, durées' + (o.dates ? ', dates' : ' (dates vidées)'));
        if (obj(src.examAttendanceProfiles)) { p.examAttendanceProfiles = {}; let n = 0; for (const k of Object.keys(src.examAttendanceProfiles)) { n += nb(src.examAttendanceProfiles[k]); p.examAttendanceProfiles[k] = []; } efface('absences et retards', n + nb(src.examAttendance)); }
        else efface('absences et retards', nb(src.examAttendance));

        // Oral : réglages et grille repris ; candidats, jurys et passages effacés
        const oc = obj(src.oralConfig) ? src.oralConfig : null;
        if (oc) {
            const base = obj(p.oralConfig) ? p.oralConfig : {};
            for (const k of ORAL_REPRIS) if (has(oc, k)) base[k] = clone(oc[k]);
            if (obj(base.general) && !o.dates) base.general.date = '';
            base.students = []; base.teachers = []; base.distribution = {};
            p.oralConfig = base;
            for (const k of Object.keys(oc)) if (!ORAL_REPRIS.includes(k) && !['students', 'teachers', 'distribution'].includes(k)) rapport.ignore.push('oralConfig.' + k);
            garde('oral : réglages, thèmes, grille d’évaluation, modèles de convocation');
            efface('candidats de l’oral', nb(oc.students)); efface('jurys de l’oral (enseignants)', nb(oc.teachers));
            efface('passages d’oral', Object.values(obj(oc.distribution) ? oc.distribution : {}).reduce((n, l) => n + nb(l), 0));
        }
        // Ancien module de stage : réglages repris, jurys et passages effacés
        if (obj(src.stage)) {
            const sc = obj(src.stage.config) ? clone(src.stage.config) : {};
            if (!o.dates && has(sc, 'date')) sc.date = '';
            if (!o.enseignants) sc.teacherPool = [];
            p.stage = { config: sc, juries: [], planning: [] };
            efface('jurys de stage', nb(src.stage.juries)); efface('passages de stage', nb(src.stage.planning));
        }

        // Tout ce qui concerne les élèves de la session écoulée
        p.students = []; p.distribution = {}; p.planning = {}; p.planningReserve = {}; p.officialResults = []; p.examAttendance = []; p.examDayLog = [];
        efface('élèves, avec leurs notes et aménagements', nb(src.students));
        efface('élèves répartis en salles', Object.values(obj(src.distribution) ? src.distribution : {}).reduce((n, l) => n + nb(l), 0));
        efface('surveillances', nb(src.planning) + nb(src.planningReserve));
        efface('résultats officiels', nb(src.officialResults));
        efface('lots de correction', Object.values(obj(src.corrections) && obj(src.corrections.lots) ? src.corrections.lots : {}).reduce((n, l) => n + nb(l), 0));
        efface('journal du jour J', nb(src.examDayLog));
        delete p.corrections; delete p.examDayChecklist;

        const connues = ['config', 'students', 'rooms', 'teachers', 'distribution', 'planning', 'planningReserve', 'officialResults', 'exams', 'examProfiles', 'examAttendance', 'examAttendanceProfiles',
            'oralConfig', 'stage', 'uiState', 'edt', 'corrections', 'examDayLog', 'examDayChecklist'];
        for (const k of Object.keys(src)) if (!connues.includes(k)) rapport.ignore.push(k);
        return { projet: p, rapport };
    }

    const api = { preparerNouvelleSession };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.DnbNouvelleSession = api;

    /* ---------- Interface ---------- */
    let DEFAUTS = {};
    function ouvrir() {
        const fond = document.createElement('div');
        fond.style.cssText = 'position:fixed;inset:0;background:#0006;z-index:9500;display:flex;align-items:center;justify-content:center';
        const carte = document.createElement('div');
        carte.style.cssText = 'background:#fff;color:#20314a;border-radius:10px;padding:20px 22px;max-width:560px;width:92%;max-height:86vh;overflow:auto;font:14px sans-serif;box-shadow:0 8px 30px #0004';
        fond.appendChild(carte);
        const etat = { enseignants: true, dates: false };
        const ligne = (t, items) => { if (!items.length) return; const h = document.createElement('div'); h.style.cssText = 'font-weight:bold;margin:10px 0 4px'; h.textContent = t; carte.appendChild(h);
            const ul = document.createElement('ul'); ul.style.cssText = 'margin:0 0 0 18px;padding:0'; for (const i of items) { const li = document.createElement('li'); li.textContent = i; ul.appendChild(li); } carte.appendChild(ul); };
        function rendre() {
            carte.textContent = '';
            const r = preparerNouvelleSession(DB, DEFAUTS, etat);
            const h = document.createElement('h3'); h.style.cssText = 'margin:0 0 8px'; h.textContent = 'Préparer la session suivante'; carte.appendChild(h);
            const p = document.createElement('p'); p.style.cssText = 'margin:0 0 8px';
            p.textContent = 'Un fichier de projet neuf est téléchargé. Le projet ouvert n’est pas modifié. Pour la nouvelle session : créez un document Grist neuf, ouvrez-y l’application, chargez ce fichier puis publiez-le.';
            carte.appendChild(p);
            for (const [cle, texte] of [['enseignants', 'Conserver la liste des enseignants'], ['dates', 'Conserver les dates des épreuves et de l’oral']]) {
                const l = document.createElement('label'); l.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;cursor:pointer';
                const c = document.createElement('input'); c.type = 'checkbox'; c.checked = etat[cle]; c.style.cssText = 'display:inline-block;width:auto;margin:0;flex:none'; c.onchange = () => { etat[cle] = c.checked; rendre(); };
                l.appendChild(c); l.appendChild(document.createTextNode(texte)); carte.appendChild(l);
            }
            ligne('Repris dans le nouveau projet', r.rapport.conserve);
            ligne('Laissé de côté (absent du nouveau fichier)', r.rapport.efface);
            ligne('Sections non reconnues, non reprises par prudence', r.rapport.ignore);
            const pied = document.createElement('div'); pied.style.cssText = 'margin-top:14px;text-align:right';
            const bouton = (t, fn, primaire) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn;
                b.style.cssText = 'margin-left:8px;padding:7px 12px;border-radius:6px;border:1px solid #9fb0c3;cursor:pointer;background:' + (primaire ? '#1f3a5c;color:#fff' : '#f4f6f8'); pied.appendChild(b); };
            bouton('Annuler', () => fond.remove());
            bouton('Télécharger le projet de la nouvelle session', () => {
                const d = new Date(), a = document.createElement('a');
                a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(r.projet));
                a.download = d.getFullYear() + ' ' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getDate()).padStart(2, '0') + ' - Nouvelle session DNB.data';
                a.click(); fond.remove();
                if (typeof showToast === 'function') showToast('Projet de la nouvelle session téléchargé. Le projet ouvert n’a pas été modifié.', 'success');
            }, true);
            carte.appendChild(pied);
        }
        rendre(); document.body.appendChild(fond);
    }
    function installer() {
        try { DEFAUTS = JSON.parse(JSON.stringify(DB)); } catch (e) { DEFAUTS = {}; }   // projet par défaut, pris avant tout chargement
        const ref = document.getElementById('btnGlobalSave'); if (!ref || document.getElementById('btnNouvelleSession')) return;
        const b = document.createElement('button'); b.id = 'btnNouvelleSession'; b.type = 'button'; b.className = 'btn btn-secondary';
        b.style.cssText = 'width:100%;margin-top:8px;font-size:0.85rem'; b.textContent = 'Préparer la session suivante…'; b.onclick = ouvrir;
        ref.insertAdjacentElement('afterend', b);
    }
    root.DnbNouvelleSession.ouvrir = ouvrir;
    if (typeof document !== 'undefined') installer();
})(typeof window !== 'undefined' ? window : globalThis);
