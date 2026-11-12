// === MODULE: datavis ===
// --- PARTIE DATA VISUALISATION (FINALE V21.0) ---

function normalizeResultName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase();
}

function normalizeResultClass(value) {
    return normalizeResultName(value);
}

function getFirstNameToken(value) {
    const tokens = String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter(Boolean);
    return tokens[0] || '';
}

function getStudentResultKey(student) {
    return `${normalizeResultName(student.nom)}|${normalizeResultName(student.prenom)}`;
}

function getStudentResultLooseKey(student, includeClass = true) {
    const classPart = includeClass ? `|${normalizeResultClass(student.classe)}` : '';
    return `${normalizeResultName(student.nom)}|${getFirstNameToken(student.prenom)}${classPart}`;
}

function addUniqueMatch(map, key, student) {
    const parts = String(key || '').split('|');
    if (!key || parts.some(part => part === '')) return;
    if (map.has(key)) map.set(key, null);
    else map.set(key, student);
}

function buildUniqueStudentMap(students, keyBuilder) {
    const map = new Map();
    (students || []).forEach(student => addUniqueMatch(map, keyBuilder(student), student));
    return map;
}

function getComparableStudentPairs(blankStudents, officialStudents) {
    const officialExact = buildUniqueStudentMap(officialStudents, student => getStudentResultKey(student));
    const officialLooseClass = buildUniqueStudentMap(officialStudents, student => getStudentResultLooseKey(student, true));
    const officialLooseNoClass = buildUniqueStudentMap(officialStudents, student => getStudentResultLooseKey(student, false));
    const blankExact = buildUniqueStudentMap(blankStudents, student => getStudentResultKey(student));
    const blankLooseClass = buildUniqueStudentMap(blankStudents, student => getStudentResultLooseKey(student, true));
    const blankLooseNoClass = buildUniqueStudentMap(blankStudents, student => getStudentResultLooseKey(student, false));
    const usedOfficial = new Set();
    const rows = [];

    (blankStudents || []).forEach(student => {
        const exactKey = getStudentResultKey(student);
        let official = blankExact.get(exactKey) === student ? (officialExact.get(exactKey) || null) : null;
        let matchMode = official ? 'exact' : '';
        if (official && usedOfficial.has(official)) official = null;
        if (!official) {
            const looseClassKey = getStudentResultLooseKey(student, true);
            const looseCandidate = officialLooseClass.get(looseClassKey);
            if (looseCandidate && !usedOfficial.has(looseCandidate) && blankLooseClass.get(looseClassKey) === student) {
                official = looseCandidate;
                matchMode = 'nom + premier prénom + classe';
            }
        }
        if (!official) {
            const looseNoClassKey = getStudentResultLooseKey(student, false);
            const looseCandidate = officialLooseNoClass.get(looseNoClassKey);
            if (looseCandidate && !usedOfficial.has(looseCandidate) && blankLooseNoClass.get(looseNoClassKey) === student) {
                official = looseCandidate;
                matchMode = 'nom + premier prénom unique';
            }
        }
        if (official) usedOfficial.add(official);
        rows.push({ student, official, matchMode });
    });

    (officialStudents || []).forEach(official => {
        if (!usedOfficial.has(official)) rows.push({ student: null, official, matchMode: '' });
    });
    return rows;
}

function parseOfficialNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const clean = String(value).replace(/\u00a0/g, ' ').trim().split('/')[0].replace(',', '.');
    const num = parseFloat(clean);
    return Number.isFinite(num) ? num : null;
}

function asNumberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const num = parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(num) ? num : null;
}

function getScienceScore(student) {
    if (!student || !student.grades) return null;
    const directScience = asNumberOrNull(student.grades.sci);
    if (directScience !== null) return directScience;

    const activeSciences = DB.config.scienceSubjects || ['SVT', 'PC', 'TECH'];
    let sum = 0;
    let count = 0;
    const add = (enabledKey, gradeKey) => {
        const value = asNumberOrNull(student.grades[gradeKey]);
        if (activeSciences.includes(enabledKey) && value !== null) {
            sum += value;
            count++;
        }
    };
    add('SVT', 'svt');
    add('PC', 'pc');
    add('TECH', 'tech');
    return count > 0 ? sum / count : null;
}

function parseCsvLine(line) {
    const out = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"' && inQuotes && next === '"') {
            current += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ';' && !inQuotes) {
            out.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    out.push(current);
    return out;
}

function getOfficialColumn(headers, patterns) {
    return headers.findIndex(header => patterns.every(pattern => pattern.test(header)));
}

function officialMentionFromResult(result) {
    const label = String(result || '').toLowerCase();
    if (label.includes('félicit') || label.includes('felicit')) return 'Félicitations du jury';
    if (label.includes('très') || label.includes('tres')) return 'Très Bien';
    if (label.includes('assez')) return 'Assez Bien';
    if (label.includes('bien')) return 'Bien';
    if (label.includes('admis')) return 'Admis';
    return 'Refusé';
}

function getEmptyMentionCounts() {
    return { 'Refusé': 0, 'Admis': 0, 'Assez Bien': 0, 'Bien': 0, 'Très Bien': 0, 'Félicitations du jury': 0 };
}

function getMentionDisplayData(mentions) {
    return [
        { label: 'Félicitations du jury', short: 'Félicitations', count: mentions['Félicitations du jury'] || 0, color: '#1f3a5c', pdfColor: [44, 62, 80] },
        { label: 'Très Bien', short: 'TB', count: mentions['Très Bien'] || 0, color: '#6b4a72', pdfColor: [142, 68, 173] },
        { label: 'Bien', short: 'B', count: mentions['Bien'] || 0, color: '#1f3a5c', pdfColor: [52, 152, 219] },
        { label: 'Assez Bien', short: 'AB', count: mentions['Assez Bien'] || 0, color: '#9a7a2e', pdfColor: [243, 156, 18] },
        { label: 'Admis', short: 'Admis', count: mentions['Admis'] || 0, color: '#2f6f5e', pdfColor: [39, 174, 96] },
        { label: 'Refusé', short: 'Refusé', count: mentions['Refusé'] || 0, color: '#9a4a2e', pdfColor: [231, 76, 60] }
    ];
}

function parseOfficialResultsCsv(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '');
    const headerIndex = lines.findIndex(line => line.startsWith('Série;') || line.includes('Nom candidat;Prénom candidat'));
    if (headerIndex === -1) throw new Error("Ligne d'en-tête officielle introuvable.");

    const headers = parseCsvLine(lines[headerIndex]);
    const idx = {
        serie: getOfficialColumn(headers, [/^Série$/i]),
        classe: getOfficialColumn(headers, [/Division de classe/i]),
        numero: getOfficialColumn(headers, [/Numéro Candidat/i]),
        ine: getOfficialColumn(headers, [/^INE$/i]),
        nom: getOfficialColumn(headers, [/Nom candidat/i]),
        prenom: getOfficialColumn(headers, [/Prénom candidat/i]),
        result: getOfficialColumn(headers, [/^Résultat$/i]),
        finalAvg: getOfficialColumn(headers, [/Moyenne sur 20/i]),
        fr: getOfficialColumn(headers, [/Français/i, /Ponctuel/i]),
        math: getOfficialColumn(headers, [/Mathématiques/i, /Ponctuel/i]),
        hg: getOfficialColumn(headers, [/Histoire, géographie/i, /Ponctuel/i]),
        emc: getOfficialColumn(headers, [/Enseignement moral et civique/i, /Ponctuel/i]),
        sci: getOfficialColumn(headers, [/^004 - .*Sciences/i, /Ponctuel/i]),
        svt: getOfficialColumn(headers, [/Sciences de la vie de la Terre/i, /Ponctuel/i]),
        pc: getOfficialColumn(headers, [/Physique\s*Chimie|Physique-Chimie/i, /Ponctuel/i]),
        tech: getOfficialColumn(headers, [/Technologie/i, /Ponctuel/i]),
        oral: getOfficialColumn(headers, [/Soutenance orale/i]),
        genAvg: getOfficialColumn(headers, [/Contrôle continu de 3/i])
    };
    if (idx.nom === -1 || idx.prenom === -1 || idx.finalAvg === -1) {
        throw new Error("Colonnes obligatoires manquantes : nom, prénom ou moyenne.");
    }

    const studentByKey = new Map((DB.students || []).map(student => [getStudentResultKey(student), student]));
    const rows = [];
    const unmatched = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        if (!cells[idx.nom]) continue;
        const nom = String(cells[idx.nom] || '').trim().toUpperCase();
        const prenom = String(cells[idx.prenom] || '').trim();
        const key = `${normalizeResultName(nom)}|${normalizeResultName(prenom)}`;
        const linkedStudent = studentByKey.get(key);
        if (!linkedStudent) unmatched.push(`${nom} ${prenom}`.trim());
        const hg = parseOfficialNumber(cells[idx.hg]);
        const emc = parseOfficialNumber(cells[idx.emc]);
        const hgCombined = hg !== null && emc !== null ? ((hg * 1.5) + (emc * 0.5)) / 2 : (hg ?? emc);
        const svt = parseOfficialNumber(cells[idx.svt]);
        const pc = parseOfficialNumber(cells[idx.pc]);
        const tech = parseOfficialNumber(cells[idx.tech]);
        const directSci = parseOfficialNumber(cells[idx.sci]);
        const scienceParts = [svt, pc, tech].filter(value => value !== null);
        rows.push({
            id: linkedStudent ? normalizeStudentId(linkedStudent.id) : `official_${key}`,
            nom,
            prenom,
            classe: String(cells[idx.classe] || linkedStudent?.classe || '').trim(),
            sexe: linkedStudent?.sexe || '',
            officialResult: String(cells[idx.result] || '').trim(),
            grades: {
                fr: parseOfficialNumber(cells[idx.fr]),
                math: parseOfficialNumber(cells[idx.math]),
                hg: hgCombined,
                emc,
                sci: directSci !== null ? directSci : (scienceParts.length ? scienceParts.reduce((sum, value) => sum + value, 0) / scienceParts.length : null),
                svt,
                pc,
                tech,
                oral: parseOfficialNumber(cells[idx.oral]),
                genAvg: parseOfficialNumber(cells[idx.genAvg]),
                finalAvg: parseOfficialNumber(cells[idx.finalAvg])
            },
            officialMeta: {
                serie: cells[idx.serie] || '',
                numero: cells[idx.numero] || '',
                ine: cells[idx.ine] || '',
                rawHg: hg,
                rawEmc: emc
            }
        });
    }
    return { rows, unmatched };
}

function handleOfficialResultsFile(input) {
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;
    const status = document.getElementById('officialResultsImportStatus');
    const reader = new FileReader();
    reader.onload = event => {
        try {
            const parsed = parseOfficialResultsCsv(event.target.result);
            DB.officialResults = parsed.rows;
            if (!DB.config) DB.config = {};
            DB.config.datavisSource = 'official';
            if (typeof autoSave === 'function') autoSave();
            if (status) status.textContent = `${parsed.rows.length} résultat(s) officiel(s) importé(s). ${parsed.unmatched.length} non rapproché(s) avec la base élèves.`;
            showToast(`Résultats officiels importés : ${parsed.rows.length} élève(s).`, 'success');
            if (document.getElementById('res-datavis')?.classList.contains('active')) renderDatavisStats();
        } catch (error) {
            console.error(error);
            if (status) status.textContent = "Import impossible : " + error.message;
            showToast("Import officiel impossible : " + error.message, 'error');
        } finally {
            input.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}
window.handleOfficialResultsFile = handleOfficialResultsFile;

function getDatavisSource() {
    return (DB.config && DB.config.datavisSource) || 'blank';
}

function normalizeStudentSex(student) {
    const value = String(student?.sexe || student?.genre || '').trim().toLowerCase();
    if (!value) return '';
    if (value === 'f' || value.includes('fille') || value.includes('fémin') || value.includes('femin') || value === '2' || value === 'mme' || value === 'mlle') return 'F';
    if (value === 'm' || value.includes('garçon') || value.includes('garcon') || value.includes('mascul') || value === '1' || value === 'm.' || value === 'monsieur') return 'M';
    return '';
}

function getStudentSex(student) {
    return normalizeStudentSex(student);
}

function findLinkedBaseStudent(resultStudent) {
    const exact = buildUniqueStudentMap(DB.students || [], student => getStudentResultKey(student));
    const looseClass = buildUniqueStudentMap(DB.students || [], student => getStudentResultLooseKey(student, true));
    const looseNoClass = buildUniqueStudentMap(DB.students || [], student => getStudentResultLooseKey(student, false));
    const exactStudent = exact.get(getStudentResultKey(resultStudent));
    if (exactStudent) return exactStudent;
    const classStudent = looseClass.get(getStudentResultLooseKey(resultStudent, true));
    if (classStudent) return classStudent;
    return looseNoClass.get(getStudentResultLooseKey(resultStudent, false)) || null;
}

function getActiveDatavisStudents() {
    if (getDatavisSource() !== 'official') return DB.students || [];
    return (DB.officialResults || []).map(student => {
        if (getStudentSex(student)) return student;
        const linked = findLinkedBaseStudent(student);
        return linked ? { ...student, sexe: linked.sexe } : student;
    });
}

function getDatavisSourceLabel() {
    return getDatavisSource() === 'official' ? 'DNB officiel' : 'DNB blanc';
}

function getGradeAverage(student) {
    if (!student || !student.grades) return null;
    if (student.grades.finalAvg !== null && student.grades.finalAvg !== undefined) return parseFloat(student.grades.finalAvg);
    const stats = calculateStats([student]);
    const value = parseFloat(stats.moy20.moy);
    return Number.isFinite(value) ? value : null;
}

function getComparisonRows() {
    return getComparableStudentPairs(DB.students || [], DB.officialResults || []).map(pair => {
        const student = pair.student || null;
        const official = pair.official || null;
        const blankAvg = getGradeAverage(student);
        const officialAvg = getGradeAverage(official);
        const status = student && official
            ? (pair.matchMode === 'exact' ? 'Rapproché' : `Rapproché (${pair.matchMode})`)
            : (student ? 'DNB blanc uniquement' : 'DNB officiel uniquement');
        return {
            student,
            official,
            blankAvg,
            officialAvg,
            diff: blankAvg !== null && officialAvg !== null ? officialAvg - blankAvg : null,
            status
        };
    });
}

function getComparisonDisplayName(row, field) {
    return row.student?.[field] || row.official?.[field] || '';
}

function sortComparisonRows(rows) {
    return rows.sort((a, b) =>
        getComparisonDisplayName(a, 'classe').localeCompare(getComparisonDisplayName(b, 'classe'), 'fr') ||
        getComparisonDisplayName(a, 'nom').localeCompare(getComparisonDisplayName(b, 'nom'), 'fr') ||
        getComparisonDisplayName(a, 'prenom').localeCompare(getComparisonDisplayName(b, 'prenom'), 'fr')
    );
}

// Fonction de calcul statistique
function calculateStats(students) {
    const subjects = ['total', 'fr', 'math', 'hg', 'sci', 'oral', 'moy20'];
    let result = {};

    subjects.forEach(sub => {
        let values = students.map(s => {
            if (!s.grades) return null;

            const sciScore = getScienceScore(s);

            if (sub === 'fr') return s.grades.fr;
            if (sub === 'math') return s.grades.math;
            if (sub === 'hg') return s.grades.hg;
            if (sub === 'sci') return sciScore;
            if (sub === 'oral') return s.grades.oral;

            if (sub === 'total') {
                if (s.grades.finalAvg != null) return s.grades.finalAvg;
                let t = 0;
                if (s.grades.fr != null) t += s.grades.fr;
                if (s.grades.math != null) t += s.grades.math;
                if (s.grades.hg != null) t += s.grades.hg;
                if (sciScore != null) t += sciScore;
                if (s.grades.oral != null) t += s.grades.oral;
                return t;
            }

            if (sub === 'moy20') {
                if (s.grades.finalAvg != null) return s.grades.finalAvg;
                let sum = 0, count = 0;
                if (s.grades.fr != null) { sum += s.grades.fr; count++; }
                if (s.grades.math != null) { sum += s.grades.math; count++; }
                if (s.grades.hg != null) { sum += s.grades.hg; count++; }
                if (sciScore != null) { sum += sciScore; count++; }
                if (s.grades.oral != null) { sum += s.grades.oral; count++; }
                return count > 0 ? (sum / count) : null;
            }
        }).filter(v => v !== null && v !== undefined);

        if (values.length === 0) {
            result[sub] = { min: '-', moy: '-', max: '-', med: '-', ecart: '-' };
        } else {
            values.sort((a, b) => a - b);
            const sum = values.reduce((a, b) => a + b, 0);
            const avg = sum / values.length;
            const min = values[0];
            const max = values[values.length - 1];
            let med = 0;
            const mid = Math.floor(values.length / 2);
            if (values.length % 2 !== 0) med = values[mid];
            else med = (values[mid - 1] + values[mid]) / 2;

            const squareDiffs = values.map(v => Math.pow(v - avg, 2));
            const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
            const stdDev = Math.sqrt(avgSquareDiff);

            result[sub] = {
                min: min.toFixed(1).replace('.0', ''),
                moy: avg.toFixed(1).replace('.0', ''),
                max: max.toFixed(1).replace('.0', ''),
                med: med.toFixed(1).replace('.0', ''),
                ecart: stdDev.toFixed(1).replace('.0', '')
            };
        }
    });
    return result;
}

// Calcul de la répartition des mentions
function calculateMentions(students) {
    const mentions = getEmptyMentionCounts();
    let total = 0;

    students.forEach(s => {
        if (!s.grades) return;
        if (s.officialResult) {
            mentions[officialMentionFromResult(s.officialResult)]++;
            total++;
            return;
        }
        const vn = (v) => { if (v == null || v === "") return null; const n = parseFloat(v); return isNaN(n) ? null : n; };

        const moySci = getScienceScore(s);

        // Écrits
        let sumEcrit = 0, cEcrit = 0;
        if (vn(s.grades.fr) !== null) { sumEcrit += vn(s.grades.fr); cEcrit++; }
        if (vn(s.grades.math) !== null) { sumEcrit += vn(s.grades.math); cEcrit++; }
        if (typeof getDetailHGEMC === 'function') {
            const resHG = getDetailHGEMC(s);
            if (resHG.average !== null && !isNaN(resHG.average)) { sumEcrit += resHG.average; cEcrit++; }
        } else {
            if (vn(s.grades.hg) !== null) { sumEcrit += vn(s.grades.hg); cEcrit++; }
        }
        if (moySci !== null) { sumEcrit += moySci; cEcrit++; }

        // Épreuves (écrits + oral)
        let sumEpr = sumEcrit, cEpr = cEcrit;
        if (vn(s.grades.oral) !== null) { sumEpr += vn(s.grades.oral); cEpr++; }
        const moyEpr = cEpr > 0 ? (sumEpr / cEpr) : 0;

        // Note finale
        const moyGen = vn(s.grades.genAvg) || 0;
        let finalAvg = vn(s.grades.finalAvg) || 0;
        if (finalAvg > 0) {
            // La moyenne officielle est prioritaire quand elle existe.
        } else if (moyGen > 0 && moyEpr > 0) finalAvg = (moyGen * 0.4) + (moyEpr * 0.6);
        else if (moyEpr > 0) finalAvg = moyEpr;
        else if (moyGen > 0) finalAvg = moyGen;
        else return; // pas de notes du tout

        total++;
        if (finalAvg >= 18) mentions['Félicitations du jury']++;
        else if (finalAvg >= 16) mentions['Très Bien']++;
        else if (finalAvg >= 14) mentions['Bien']++;
        else if (finalAvg >= 12) mentions['Assez Bien']++;
        else if (finalAvg >= 10) mentions['Admis']++;
        else mentions['Refusé']++;
    });

    return { mentions, total };
}

// Génère le HTML de la répartition des mentions
function buildMentionsHtml(students) {
    const { mentions, total } = calculateMentions(students);
    if (total === 0) return '';

    const pct = (n) => total > 0 ? (n / total * 100).toFixed(1) : '0';
    const data = getMentionDisplayData(mentions);

    let html = `<div style="margin-bottom:25px; padding:20px; background:#faf9f6; border-radius:12px; border:1px solid #ece9e0;">
        <h4 style="margin:0 0 15px 0; color:#1f3a5c;">🏅 Répartition des Mentions (${total} élèves)</h4>
        <div style="display:flex; gap:12px; flex-wrap:wrap; justify-content:center;">`;

    data.forEach(d => {
        const isRefuse = d.label === 'Refusé';
        const borderStyle = isRefuse ? 'border:2px solid #9a4a2e;' : 'border:1px solid #ece9e0;';
        const bgStyle = isRefuse ? 'background:#fbf3ef;' : 'background:white;';
        html += `<div style="flex:1; min-width:120px; padding:15px; border-radius:10px; text-align:center; ${borderStyle} ${bgStyle}">
            <div style="font-size:2rem; font-weight:bold; color:${d.color};">${pct(d.count)}%</div>
            <div style="font-size:0.85rem; font-weight:bold; color:${d.color};">${d.label}</div>
            <div style="font-size:0.8rem; color:${isRefuse ? '#9a4a2e' : '#9aa0a2'}; font-weight:${isRefuse ? 'bold' : 'normal'};">${d.count} élève${d.count > 1 ? 's' : ''}</div>
        </div>`;
    });

    // Barre de progression
    html += `</div><div style="margin-top:15px; height:24px; border-radius:12px; overflow:hidden; display:flex; background:#ece9e0;">`;
    data.forEach(d => {
        const w = total > 0 ? (d.count / total * 100) : 0;
        if (w > 0) html += `<div style="width:${w}%; background:${d.color}; display:flex; align-items:center; justify-content:center; color:white; font-size:0.7rem; font-weight:bold;">${w >= 5 ? pct(d.count) + '%' : ''}</div>`;
    });
    html += `</div></div>`;

    return html;
}

// Gestion des onglets
function switchDatavisTab(tabName) {
    document.querySelectorAll('.nav-pill').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btn-tab-' + tabName).classList.add('active');
    document.querySelectorAll('.datavis-view').forEach(view => view.classList.remove('active'));
    document.getElementById('view-' + tabName).classList.add('active');
}

function setResultsWorkspace(workspace) {
    const allowed = ['blank', 'official', 'annual'];
    const nextWorkspace = allowed.includes(workspace) ? workspace : 'blank';
    if (!DB.config) DB.config = {};
    DB.config.resultsWorkspace = nextWorkspace;
    if (nextWorkspace === 'blank') DB.config.datavisSource = 'blank';
    if (nextWorkspace === 'official') DB.config.datavisSource = 'official';
    if (typeof autoSave === 'function') autoSave();
    if (document.getElementById('res-datavis')?.classList.contains('active')) renderDatavisStats();
}
window.setResultsWorkspace = setResultsWorkspace;

function buildResultsWorkspaceNav(activeWorkspace) {
    const items = [
        ['blank', 'DNB blanc', 'fa-file-alt'],
        ['official', 'DNB officiel & comparaison', 'fa-landmark'],
        ['annual', 'Comparaison des années', 'fa-history']
    ];
    return `<div class="results-workspace-nav" role="tablist" aria-label="Espace de résultats">
        ${items.map(([key, label, icon]) => `<button type="button" class="results-workspace-tab ${activeWorkspace === key ? 'active' : ''}" onclick="setResultsWorkspace('${key}')" role="tab" aria-selected="${activeWorkspace === key}">
            <i class="fas ${icon}"></i><span>${label}</span>
        </button>`).join('')}
    </div>`;
}

function buildAnnualResultsWorkspaceHtml() {
    const blankCount = (DB.students || []).length;
    const officialCount = (DB.officialResults || []).length;
    const year = DB.config?.year || 'session en cours';
    return `<div id="view-annual" class="results-annual-workspace">
        <div class="results-workspace-intro">
            <div><span class="results-kicker">ARCHIVES ET PILOTAGE</span><h3>Comparer les années</h3>
                <p>Conservez une feuille statistique par session pour suivre l’évolution des résultats de l’établissement, des classes et des disciplines.</p></div>
            <i class="fas fa-chart-line results-workspace-intro-icon" aria-hidden="true"></i>
        </div>
        <div class="results-archive-grid">
            <div class="results-archive-card"><span class="results-archive-label">Session active</span><strong>${escapeHTML(String(year))}</strong><small>${escapeHTML(typeof getExamSessionLabel === 'function' ? getExamSessionLabel() : 'Examen')}</small></div>
            <div class="results-archive-card"><span class="results-archive-label">DNB blanc disponible</span><strong>${blankCount}</strong><small>élève(s) dans la session</small></div>
            <div class="results-archive-card"><span class="results-archive-label">DNB officiel disponible</span><strong>${officialCount}</strong><small>résultat(s) importé(s)</small></div>
        </div>
        <div class="results-annual-actions"><div><h4>Créer l’archive statistique de la session</h4>
            <p>Le fichier Excel contient une feuille de synthèse et le détail des élèves. Il pourra servir de base aux comparaisons des prochaines années.</p></div>
            <button class="btn btn-secondary" onclick="exportAnnualStatsSheetXLSX()"><i class="fas fa-file-excel"></i> Exporter la feuille statistique</button>
        </div>
        <div class="results-coming-soon"><i class="fas fa-layer-group" aria-hidden="true"></i>
            <div><strong>Historique pluriannuel</strong><p>Les archives annuelles seront rassemblées ici pour comparer les moyennes, taux de réussite, mentions et résultats par matière.</p></div>
        </div>
    </div>`;
}

// Affichage principal DataVis
function renderDatavisStats() {
    const workspace = DB.config?.resultsWorkspace || (getDatavisSource() === 'official' ? 'official' : 'blank');
    const dataStudents = getActiveDatavisStudents();
    if (dataStudents.length === 0 && workspace !== 'annual') {
        const container = document.getElementById('res-datavis')?.querySelector('.card');
        if (container) {
            container.innerHTML = `${buildResultsWorkspaceNav(workspace)}<h3>Tableau de Bord Statistiques</h3>
                <p style="color:#656d70;">Aucune donnée disponible pour ${getDatavisSourceLabel()}.</p>
                <button class="btn btn-secondary" onclick="DB.config.datavisSource='blank'; renderDatavisStats();">Voir DNB blanc</button>
                <button class="btn btn-primary" onclick="DB.config.datavisSource='official'; renderDatavisStats();" style="margin-left:8px;">Voir DNB officiel</button>`;
        }
        return;
    }

    const container = document.getElementById('res-datavis').querySelector('.card');
    container.innerHTML = '';
    const hasOfficial = (DB.officialResults || []).length > 0;

    // 1. MENU D'ONGLETS + BOUTONS EXPORT
    const headerHtml = `
            ${buildResultsWorkspaceNav(workspace)}
            <div class="results-workspace-banner"><div><span class="results-kicker">RÉSULTATS</span><strong>${workspace === 'blank' ? 'Analyse du DNB blanc' : 'DNB officiel et comparaison'}</strong><small>${workspace === 'blank' ? 'Suivi des évaluations préparatoires et des classes.' : 'Résultats Cyclades, rapprochement élève par élève et écarts avec le DNB blanc.'}</small></div><i class="fas ${workspace === 'blank' ? 'fa-file-alt' : 'fa-landmark'}" aria-hidden="true"></i></div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap;">
                <div class="nav-tabs-container" style="margin-bottom:0; ${workspace === 'annual' ? 'display:none;' : ''}">
                    <div id="btn-tab-charts" class="nav-pill ${workspace === 'official' ? '' : 'active'}" onclick="switchDatavisTab('charts')">
                        📊 Graphiques & Répartition
                    </div>
                    <div id="btn-tab-table" class="nav-pill" onclick="switchDatavisTab('table')">
                        📄 Tableau Statistique
                    </div>
                    <div id="btn-tab-comparison" class="nav-pill ${workspace === 'official' ? 'active' : ''}" onclick="switchDatavisTab('comparison')" style="${hasOfficial ? '' : 'display:none;'}">
                        🔁 Comparaison
                    </div>
                </div>
                <div style="display:${workspace === 'annual' ? 'none' : 'flex'}; gap:8px; align-items:center; flex-wrap:wrap;">
                    <select id="datavisSourceSelect" onchange="DB.config.datavisSource=this.value; if(typeof autoSave==='function') autoSave(); renderDatavisStats();" style="padding:8px; border:1px solid #d8d4c8; border-radius:6px; font-weight:bold;">
                        <option value="blank" ${getDatavisSource() === 'blank' ? 'selected' : ''}>DNB blanc</option>
                        <option value="official" ${getDatavisSource() === 'official' ? 'selected' : ''}>DNB officiel</option>
                    </select>
                    <button class="btn btn-dark" onclick="exportDatavisPDF()">🖨️ Rapport PDF</button>
                    <button class="btn btn-dark" onclick="exportDatavisPDFv2()" title="Nouveau design : synthèse de direction, heatmap classes, une classe = une page">✨ PDF synthèse</button>
                    <button class="btn btn-primary" onclick="exportDatavisPPTX()">▣ PowerPoint</button>
                    <button class="btn btn-primary" onclick="exportDatavisPPTXv2()" title="Nouveau design : graphiques natifs modifiables dans PowerPoint, une classe = une diapo">✨ PPTX synthèse</button>
                    <button class="btn btn-success" onclick="exportDatavisXLSX()">💾 Excel</button>
                    <button class="btn btn-secondary" onclick="exportAnnualStatsSheetXLSX()">📈 Feuille statistique</button>
                    <button class="btn btn-primary" onclick="exportOfficialComparisonXLSX()" style="${hasOfficial ? '' : 'display:none;'}">🔁 Excel comparaison</button>
                </div>
            </div>
            <div style="margin:-8px 0 18px; padding:10px 12px; background:#faf9f6; border:1px solid #e3dfd3; border-radius:8px; color:#23282a;">
                Jeu de données affiché : <strong>${getDatavisSourceLabel()}</strong> · ${dataStudents.length} élève(s)
                ${hasOfficial ? ` · Résultats officiels importés : ${(DB.officialResults || []).length}` : ''}
            </div>
        `;
    container.innerHTML += headerHtml;

    if (workspace === 'annual') {
        container.innerHTML += buildAnnualResultsWorkspaceHtml();
        return;
    }

    const classes = [...new Set(dataStudents.map(s => s.classe).filter(c => c))].sort();

    // --- VUE 1 : GRAPHIQUES ---
    let viewChartsHtml = `<div id="view-charts" class="datavis-view ${workspace === 'official' ? '' : 'active'}">`;

    // A. Cartes (Vertes) - MODIFICATION ICI POUR LE /20
    viewChartsHtml += `<div style="display:flex; flex-wrap:wrap; gap:15px; margin-bottom:25px;">`;
    classes.forEach(cls => {
        const classStudents = dataStudents.filter(s => s.classe === cls);
        const stats = calculateStats(classStudents);
        viewChartsHtml += `
            <div class="stat-card">
                <h4>${cls}</h4>
                <div class="stat-row"><span>🖍️ Français :</span> <b>${stats.fr.moy} / 20</b></div>
                <div class="stat-row"><span>🔢 Maths :</span> <b>${stats.math.moy} / 20</b></div>
                <div class="stat-row"><span>🏛️ Hist-Géo :</span> <b>${stats.hg.moy} / 20</b></div>
                <div class="stat-row"><span>🧪 Sciences :</span> <b>${stats.sci.moy} / 20</b></div>
                <div class="stat-row"><span>🎤 Oral :</span> <b>${stats.oral.moy !== '-' ? stats.oral.moy + ' / 20' : '-'}</b></div>
                <div class="stat-footer">
                    🎓 Moyenne : ${stats.moy20.moy} / 20
                </div>
            </div>`;
    });
    viewChartsHtml += `</div>`;

    // A-bis. Répartition des mentions (global)
    viewChartsHtml += buildMentionsHtml(dataStudents);

    // A-ter. Répartition des mentions par classe
    classes.forEach(cls => {
        const classStudents = dataStudents.filter(s => s.classe === cls);
        const { mentions: cMentions, total: cTotal } = calculateMentions(classStudents);
        if (cTotal === 0) return;
        const pct = (n) => cTotal > 0 ? (n / cTotal * 100).toFixed(1) : '0';
        viewChartsHtml += `<div style="margin-bottom:15px; padding:12px 18px; background:#faf9f6; border-radius:10px; border:1px solid #ece9e0;">
            <b>${cls}</b> — ${cTotal} élèves :
            <span style="color:#1f3a5c; font-weight:bold;">Félicitations ${pct(cMentions['Félicitations du jury'])}%</span> ·
            <span style="color:#6b4a72;">TB ${pct(cMentions['Très Bien'])}%</span> ·
            <span style="color:#1f3a5c;">B ${pct(cMentions['Bien'])}%</span> ·
            <span style="color:#9a7a2e;">AB ${pct(cMentions['Assez Bien'])}%</span> ·
            <span style="color:#2f6f5e;">Admis ${pct(cMentions['Admis'])}%</span> ·
            <span style="color:#9a4a2e; font-weight:bold;">Refusé ${cMentions['Refusé']} (${pct(cMentions['Refusé'])}%)</span>
        </div>`;
    });

    // B. Graphiques
    viewChartsHtml += `
            <div class="chart-grid">
                <div class="chart-box"><div class="chart-header">🖍️ Français (Répartition)</div><div class="chart-container"><canvas id="chartFr"></canvas></div></div>
                <div class="chart-box"><div class="chart-header">🔢 Mathématiques (Répartition)</div><div class="chart-container"><canvas id="chartMath"></canvas></div></div>
                <div class="chart-box"><div class="chart-header">🏛️ Hist-Géo (Répartition)</div><div class="chart-container"><canvas id="chartHg"></canvas></div></div>
                <div class="chart-box"><div class="chart-header">🧪 Sciences (Répartition)</div><div class="chart-container"><canvas id="chartSci"></canvas></div></div>
                <div class="chart-box"><div class="chart-header">🎤 Oral (Répartition)</div><div class="chart-container"><canvas id="chartOral"></canvas></div></div>
            </div>
        `;
    viewChartsHtml += `</div>`;
    container.innerHTML += viewChartsHtml;

    // --- VUE 2 : TABLEAU ---
    let viewTableHtml = `<div id="view-table" class="datavis-view">`;
    viewTableHtml += `
            <div style="overflow-x:auto;">
                <table id="fullStatTable" class="table-striped">
                    <thead>
                        <tr>
                            <th rowspan="2">Groupe</th>
                            <th colspan="5" style="text-align:center; background:#eef3f0;">Total Points / Moyenne</th>
                            <th colspan="5" style="text-align:center; background:#fbf6ef;">Français</th>
                            <th colspan="5" style="text-align:center; background:#fbf6ef;">Maths</th>
                            <th colspan="5" style="text-align:center; background:#fbf6ef;">Hist-Géo</th>
                            <th colspan="5" style="text-align:center; background:#fbf6ef;">Sciences</th>
                            <th colspan="5" style="text-align:center; background:#f1ebf0;">Oral</th>
                        </tr>
                        <tr style="font-size:0.8rem">
                            <th>Min</th><th>Moy</th><th>Max</th><th>Med</th><th>Ec-T</th>
                            <th>Min</th><th>Moy</th><th>Max</th><th>Med</th><th>Ec-T</th>
                            <th>Min</th><th>Moy</th><th>Max</th><th>Med</th><th>Ec-T</th>
                            <th>Min</th><th>Moy</th><th>Max</th><th>Med</th><th>Ec-T</th>
                            <th>Min</th><th>Moy</th><th>Max</th><th>Med</th><th>Ec-T</th>
                            <th>Min</th><th>Moy</th><th>Max</th><th>Med</th><th>Ec-T</th>
                        </tr>
                    </thead>
                    <tbody>`;

    const groups = getDatavisGroups(dataStudents).map(group => ({
        ...group,
        name: group.name === 'Cohorte' ? 'Cohorte (Global)' : group.name
    }));

    groups.forEach(g => {
        const groupStudents = dataStudents.filter(g.filter);
        const stats = calculateStats(groupStudents);
        viewTableHtml += `
            <tr>
                <td class="row-header" style="font-weight:bold;">${g.name}</td>
                <td>${stats.total.min}</td><td style="font-weight:bold">${stats.total.moy}</td><td>${stats.total.max}</td><td>${stats.total.med}</td><td style="color:#656d70">${stats.total.ecart}</td>
                <td>${stats.fr.min}</td><td style="font-weight:bold">${stats.fr.moy}</td><td>${stats.fr.max}</td><td>${stats.fr.med}</td><td style="color:#656d70">${stats.fr.ecart}</td>
                <td>${stats.math.min}</td><td style="font-weight:bold">${stats.math.moy}</td><td>${stats.math.max}</td><td>${stats.math.med}</td><td style="color:#656d70">${stats.math.ecart}</td>
                <td>${stats.hg.min}</td><td style="font-weight:bold">${stats.hg.moy}</td><td>${stats.hg.max}</td><td>${stats.hg.med}</td><td style="color:#656d70">${stats.hg.ecart}</td>
                <td>${stats.sci.min}</td><td style="font-weight:bold">${stats.sci.moy}</td><td>${stats.sci.max}</td><td>${stats.sci.med}</td><td style="color:#656d70">${stats.sci.ecart}</td>
                <td>${stats.oral.min}</td><td style="font-weight:bold">${stats.oral.moy}</td><td>${stats.oral.max}</td><td>${stats.oral.med}</td><td style="color:#656d70">${stats.oral.ecart}</td>
            </tr>`;
    });
    viewTableHtml += `</tbody></table></div>`;

    // --- Tableau des mentions par groupe ---
    viewTableHtml += `
        <div style="margin-top:30px;">
            <h4 style="color:#1f3a5c; margin-bottom:15px;">🏅 Répartition des Mentions par Groupe</h4>
            <div style="overflow-x:auto;">
                <table class="table-striped">
                    <thead>
                        <tr>
                            <th>Groupe</th>
                            <th style="text-align:center; background:#1f3a5c; color:white;">Félicitations</th>
                            <th style="text-align:center; background:#6b4a72; color:white;">Très Bien</th>
                            <th style="text-align:center; background:#1f3a5c; color:white;">Bien</th>
                            <th style="text-align:center; background:#9a7a2e; color:white;">Assez Bien</th>
                            <th style="text-align:center; background:#2f6f5e; color:white;">Admis</th>
                            <th style="text-align:center; background:#9a4a2e; color:white;">Refusé</th>
                        </tr>
                    </thead>
                    <tbody>`;

    groups.forEach(g => {
        const groupStudents = dataStudents.filter(g.filter);
        const { mentions: gMentions, total: gTotal } = calculateMentions(groupStudents);
        const pct = (n) => gTotal > 0 ? (n / gTotal * 100).toFixed(1) : '0';
        const mentionCell = (n, isRefuse) => {
            const style = isRefuse ? 'color:#9a4a2e; font-weight:bold;' : '';
            return `<td style="text-align:center; ${style}">${n} <span style="font-size:0.8rem; color:${isRefuse ? '#9a4a2e' : '#9aa0a2'};">(${pct(n)}%)</span></td>`;
        };
        viewTableHtml += `
            <tr>
                <td style="font-weight:bold;">${g.name}</td>
                ${mentionCell(gMentions['Félicitations du jury'], false)}
                ${mentionCell(gMentions['Très Bien'], false)}
                ${mentionCell(gMentions['Bien'], false)}
                ${mentionCell(gMentions['Assez Bien'], false)}
                ${mentionCell(gMentions['Admis'], false)}
                ${mentionCell(gMentions['Refusé'], true)}
            </tr>`;
    });

    viewTableHtml += `</tbody></table></div></div>`;

    viewTableHtml += `</div>`;
    container.innerHTML += viewTableHtml;

    container.innerHTML += buildOfficialComparisonHtml();

    renderHistogram('chartFr', 'fr', 20, 1, dataStudents);
    renderHistogram('chartMath', 'math', 20, 1, dataStudents);
    renderHistogram('chartHg', 'hg', 20, 1, dataStudents);
    renderHistogram('chartSci', 'sci', 20, 1, dataStudents);
    renderHistogram('chartOral', 'oral', 20, 1, dataStudents);
}

function formatDelta(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}`;
}

function buildOfficialComparisonHtml() {
    const rows = getComparisonRows();
    if ((DB.officialResults || []).length === 0) {
        return `<div id="view-comparison" class="datavis-view">
            <p style="color:#656d70;">Importez les résultats officiels pour activer la comparaison.</p>
        </div>`;
    }
    const comparable = rows.filter(row => row.blankAvg !== null && row.officialAvg !== null);
    const avgDelta = comparable.length
        ? comparable.reduce((sum, row) => sum + row.diff, 0) / comparable.length
        : null;
    const positive = comparable.filter(row => row.diff > 0.01).length;
    const negative = comparable.filter(row => row.diff < -0.01).length;
    const stable = comparable.length - positive - negative;
    const officialOnly = rows.filter(row => row.status === 'DNB officiel uniquement').length;
    const blankOnly = rows.filter(row => row.status === 'DNB blanc uniquement').length;

    return `<div id="view-comparison" class="datavis-view">
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:18px;">
            <div class="stat-card"><h4>Élèves comparables</h4><div class="stat-footer">${comparable.length}</div></div>
            <div class="stat-card"><h4>Écart moyen</h4><div class="stat-footer">${formatDelta(avgDelta)} pt</div></div>
            <div class="stat-card"><h4>Progressions</h4><div class="stat-footer" style="color:#2f6f5e;">${positive}</div></div>
            <div class="stat-card"><h4>Baisses</h4><div class="stat-footer" style="color:#9a4a2e;">${negative}</div></div>
        </div>
        <div style="color:#656d70; margin-bottom:10px;">
            Stables : ${stable}. Non rapprochés : ${officialOnly} officiel(s) uniquement, ${blankOnly} DNB blanc uniquement.
            Les écarts sont calculés sur la moyenne finale /20.
        </div>
        <div style="overflow-x:auto;">
            <table class="table-striped">
                <thead>
                    <tr>
                        <th>Élève</th>
                        <th>Classe</th>
                        <th>DNB blanc</th>
                        <th>DNB officiel</th>
                        <th>Écart</th>
                        <th>Résultat officiel</th>
                        <th>Statut</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortComparisonRows(rows).map(row => {
                        const color = row.diff === null ? '#656d70' : row.diff >= 0 ? '#2f6f5e' : '#9a4a2e';
                        return `<tr>
                            <td><strong>${escapeHTML(getComparisonDisplayName(row, 'nom'))}</strong> ${escapeHTML(getComparisonDisplayName(row, 'prenom'))}</td>
                            <td>${escapeHTML(getComparisonDisplayName(row, 'classe'))}</td>
                            <td>${row.blankAvg !== null ? row.blankAvg.toFixed(2) : '-'}</td>
                            <td>${row.officialAvg !== null ? row.officialAvg.toFixed(2) : '-'}</td>
                            <td style="font-weight:bold; color:${color};">${formatDelta(row.diff)}</td>
                            <td>${escapeHTML(row.official?.officialResult || '-')}</td>
                            <td>${escapeHTML(row.status)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    </div>`;
}

function exportOfficialComparisonXLSX() {
    if (typeof XLSX === 'undefined') return showToast("Librairie Excel non chargée.", 'error');
    if (!(DB.officialResults || []).length) return showToast("Aucun résultat officiel importé.", 'warning');
    const rows = sortComparisonRows(getComparisonRows());
    const data = [
        ['Nom', 'Prénom', 'Classe', 'Moyenne DNB blanc', 'Moyenne DNB officiel', 'Écart officiel - blanc', 'Résultat officiel', 'Statut rapprochement', 'Français officiel', 'Maths officiel', 'HG/EMC officiel', 'Sciences officiel', 'Oral officiel', 'Contrôle continu officiel']
    ];
    rows.forEach(row => {
        const officialGrades = row.official?.grades || {};
        data.push([
            getComparisonDisplayName(row, 'nom'),
            getComparisonDisplayName(row, 'prenom'),
            getComparisonDisplayName(row, 'classe'),
            row.blankAvg !== null ? Number(row.blankAvg.toFixed(2)) : '',
            row.officialAvg !== null ? Number(row.officialAvg.toFixed(2)) : '',
            row.diff !== null ? Number(row.diff.toFixed(2)) : '',
            row.official?.officialResult || '',
            row.status,
            officialGrades.fr ?? '',
            officialGrades.math ?? '',
            officialGrades.hg ?? '',
            row.official ? (getScienceScore(row.official) ?? '') : '',
            officialGrades.oral ?? '',
            officialGrades.genAvg ?? ''
        ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
        { wch: 24 }, { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 18 },
        { wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 24 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comparaison');
    XLSX.writeFile(wb, `Comparaison_DNB_Blanc_Officiel_${DB.config.year || ''}.xlsx`);
}
window.exportOfficialComparisonXLSX = exportOfficialComparisonXLSX;

function renderHistogram(canvasId, subject, maxScore, step, students = getActiveDatavisStudents()) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    if (charts[canvasId]) charts[canvasId].destroy();

    // Create gradient
    const gradientStroke = ctx.createLinearGradient(0, 230, 0, 50);
    gradientStroke.addColorStop(1, 'rgba(203,12,159,0.8)');
    gradientStroke.addColorStop(0.2, 'rgba(203,12,159,0.2)');
    gradientStroke.addColorStop(0, 'rgba(203,12,159,0.1)'); //purple colors

    const labels = []; const dataCounts = [];
    for (let i = 0; i <= maxScore; i += step) { labels.push(i.toString()); dataCounts.push(0); }
    students.forEach(s => {
        if (!s.grades) return;
        let val = null;
        if (subject === 'fr') val = s.grades.fr;
        if (subject === 'math') val = s.grades.math;
        if (subject === 'hg') val = s.grades.hg;
        if (subject === 'oral') val = s.grades.oral;
        if (subject === 'sci') val = getScienceScore(s);
        if (val !== null) {
            let bucketIndex = Math.round(val);
            if (bucketIndex < 0) bucketIndex = 0;
            if (bucketIndex > maxScore) bucketIndex = maxScore;
            dataCounts[bucketIndex]++;
        }
    });

    charts[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Nombre d\'élèves',
                data: dataCounts,
                tension: 0.4,
                borderWidth: 0,
                borderRadius: 4,
                borderSkipped: false,
                backgroundColor: gradientStroke,
                maxBarThickness: 15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
            scales: {
                y: {
                    grid: { drawBorder: false, display: true, drawOnChartArea: true, drawTicks: false, borderDash: [5, 5] },
                    ticks: { suggestedMin: 0, suggestedMax: 10, beginAtZero: true, padding: 15, font: { size: 11, family: "Open Sans", style: 'normal', lineHeight: 2 }, color: "#b2b9bf" }
                },
                x: {
                    grid: { drawBorder: false, display: false, drawOnChartArea: false, drawTicks: false, borderDash: [5, 5] },
                    ticks: { display: true, color: '#b2b9bf', padding: 20, font: { size: 11, family: "Open Sans", style: 'normal', lineHeight: 2 } }
                }
            }
        }
    });
}

function getReportExamLabel() {
    if (getDatavisSource() === 'official') return 'DNB officiel';
    if (DB.config.examType === 'Autre') return DB.config.customExamName || 'Examen';
    return DB.config.examType || 'DNB blanc';
}

function getReportFileLabel() {
    return getDatavisSource() === 'official'
        ? 'DNB_Officiel'
        : (typeof getSafeExamFileLabel === 'function' ? getSafeExamFileLabel() : 'Examen');
}

function getRateText(count, total) {
    return total > 0 ? `${(count / total * 100).toFixed(1)}%` : '-';
}

function getReportDataset(students) {
    const stats = calculateStats(students);
    const mentionSummary = calculateMentions(students);
    const mentions = mentionSummary.mentions;
    const total = mentionSummary.total;
    const successCount = total - (mentions['Refusé'] || 0);
    const excellenceCount = (mentions['Très Bien'] || 0) + (mentions['Félicitations du jury'] || 0);
    const classes = [...new Set(students.map(s => s.classe).filter(Boolean))].sort();
    const groups = getDatavisGroups(students);
    const groupRows = groups.map(g => {
        const groupStudents = students.filter(g.filter);
        const groupStats = calculateStats(groupStudents);
        const groupMentions = calculateMentions(groupStudents);
        const refused = groupMentions.mentions['Refusé'] || 0;
        return {
            name: g.name,
            count: groupStudents.length,
            avg: groupStats.moy20.moy,
            fr: groupStats.fr.moy,
            math: groupStats.math.moy,
            hg: groupStats.hg.moy,
            sci: groupStats.sci.moy,
            oral: groupStats.oral.moy,
            successRate: getRateText(groupMentions.total - refused, groupMentions.total),
            excellenceRate: getRateText((groupMentions.mentions['Très Bien'] || 0) + (groupMentions.mentions['Félicitations du jury'] || 0), groupMentions.total)
        };
    });
    return {
        stats,
        mentions,
        total,
        successCount,
        successRate: getRateText(successCount, total),
        excellenceCount,
        excellenceRate: getRateText(excellenceCount, total),
        groups: groupRows,
        mentionData: getMentionDisplayData(mentions),
        subjectRows: [
            ['Français', stats.fr.moy, stats.fr.med, stats.fr.min, stats.fr.max, stats.fr.ecart],
            ['Mathématiques', stats.math.moy, stats.math.med, stats.math.min, stats.math.max, stats.math.ecart],
            ['Hist-géo / EMC', stats.hg.moy, stats.hg.med, stats.hg.min, stats.hg.max, stats.hg.ecart],
            ['Sciences', stats.sci.moy, stats.sci.med, stats.sci.min, stats.sci.max, stats.sci.ecart],
            ['Oral', stats.oral.moy, stats.oral.med, stats.oral.min, stats.oral.max, stats.oral.ecart]
        ]
    };
}

function getChartImage(id) {
    const canvas = document.getElementById(id);
    if (!canvas || !canvas.width || !canvas.height) return null;
    return canvas.toDataURL("image/png", 1.0);
}

function drawPdfTitle(doc, title, subtitle) {
    const pageWidth = doc.internal.pageSize.width;
    doc.setFillColor(31, 52, 82);
    doc.rect(0, 0, pageWidth, 36, 'F');
    doc.setFillColor(217, 43, 132);
    doc.rect(0, 36, pageWidth, 3, 'F');
    addSmartLogo(doc, 10, 5, 28);
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(title, pageWidth / 2, 16, { align: 'center' });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(subtitle, pageWidth / 2, 26, { align: 'center' });
    doc.setTextColor(0);
}

function drawPdfSectionTitle(doc, title, y) {
    doc.setTextColor(31, 52, 82);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, 14, y);
    doc.setDrawColor(217, 43, 132);
    doc.setLineWidth(0.8);
    doc.line(14, y + 3, 62, y + 3);
    doc.setTextColor(0);
}

function drawPdfKpi(doc, x, y, w, title, value, detail, color) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, w, 28, 3, 3, 'FD');
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(80, 91, 110);
    doc.text(title, x + 5, y + 8);
    doc.setFontSize(18);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(String(value), x + 5, y + 19);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(String(detail || ''), x + 5, y + 25);
    doc.setTextColor(0);
}

function addPdfFooter(doc) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(130);
        doc.text(`Rapport statistique - ${getReportExamLabel()} - Session ${DB.config.year || ''}`, 14, 292);
        doc.text(`${i}/${pageCount}`, 196, 292, { align: 'right' });
    }
    doc.setTextColor(0);
}

// EXPORT PDF DATAVIS enrichi
function exportDatavisPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const dataStudents = getActiveDatavisStudents();
    if (dataStudents.length === 0) return showToast("Aucune donnée à exporter pour " + getDatavisSourceLabel(), 'error');

    const report = getReportDataset(dataStudents);
    const subtitle = `${DB.config.schoolName || 'Établissement'} · Session ${DB.config.year || ''} · ${dataStudents.length} élève(s) · Source ${getDatavisSourceLabel()}`;

    drawPdfTitle(doc, `Rapport statistique - ${getReportExamLabel()}`, subtitle);
    drawPdfSectionTitle(doc, "Synthèse générale", 52);
    drawPdfKpi(doc, 14, 60, 42, "Effectif", dataStudents.length, "élèves analysés", [31, 52, 82]);
    drawPdfKpi(doc, 60, 60, 42, "Moyenne", `${report.stats.moy20.moy}/20`, `médiane ${report.stats.moy20.med}`, [217, 43, 132]);
    drawPdfKpi(doc, 106, 60, 42, "Réussite", report.successRate, `${report.successCount}/${report.total}`, [39, 174, 96]);
    drawPdfKpi(doc, 152, 60, 42, "Excellence", report.excellenceRate, `${report.excellenceCount} TB ou +`, [44, 62, 80]);

    drawPdfSectionTitle(doc, "Répartition des mentions", 104);
    let yPos = 114;
    report.mentionData.forEach(m => {
        const pctText = getRateText(m.count, report.total);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(m.pdfColor[0], m.pdfColor[1], m.pdfColor[2]);
        doc.text(`${m.label}`, 18, yPos);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(80);
        doc.text(`${m.count} (${pctText})`, 70, yPos);
        doc.setFillColor(235, 239, 245);
        doc.roundedRect(100, yPos - 4, 78, 5, 2, 2, 'F');
        const barW = report.total ? (m.count / report.total) * 78 : 0;
        if (barW > 0) {
            doc.setFillColor(m.pdfColor[0], m.pdfColor[1], m.pdfColor[2]);
            doc.roundedRect(100, yPos - 4, barW, 5, 2, 2, 'F');
        }
        yPos += 10;
    });

    drawPdfSectionTitle(doc, "Moyennes par discipline", 184);
    doc.autoTable({
        head: [['Discipline', 'Moyenne', 'Médiane', 'Min', 'Max', 'Écart-type']],
        body: report.subjectRows,
        startY: 194,
        theme: 'striped',
        headStyles: { fillColor: [31, 52, 82], textColor: 255 },
        styles: { fontSize: 9, halign: 'center' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }
    });

    doc.addPage();
    drawPdfTitle(doc, "Analyse par groupes", subtitle);
    doc.autoTable({
        head: [['Groupe', 'Eff.', 'Moy.', 'Réussite', 'Excellence', 'Fr', 'Maths', 'HG/EMC', 'Sciences', 'Oral']],
        body: report.groups.map(g => [g.name, g.count, g.avg, g.successRate, g.excellenceRate, g.fr, g.math, g.hg, g.sci, g.oral]),
        startY: 50,
        theme: 'grid',
        headStyles: { fillColor: [31, 52, 82], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        styles: { fontSize: 8, halign: 'center' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }
    });

    yPos = doc.lastAutoTable.finalY + 12;
    if (yPos > 235) { doc.addPage(); drawPdfTitle(doc, "Mentions par groupes", subtitle); yPos = 50; }
    doc.autoTable({
        head: [['Groupe', 'Félicitations', 'Très Bien', 'Bien', 'Assez Bien', 'Admis', 'Refusé']],
        body: report.groups.map(g => {
            const definition = getDatavisGroups(dataStudents).find(group => group.name === g.name);
            const groupStudents = definition ? dataStudents.filter(definition.filter) : [];
            const { mentions: gm, total: gt } = calculateMentions(groupStudents);
            const cell = key => `${gm[key] || 0} (${getRateText(gm[key] || 0, gt)})`;
            return [g.name, cell('Félicitations du jury'), cell('Très Bien'), cell('Bien'), cell('Assez Bien'), cell('Admis'), cell('Refusé')];
        }),
        startY: yPos,
        theme: 'grid',
        headStyles: { fillColor: [217, 43, 132], textColor: 255 },
        styles: { fontSize: 8, halign: 'center' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold' }, 1: { fontStyle: 'bold' }, 6: { textColor: [231, 76, 60], fontStyle: 'bold' } }
    });

    const chartsIds = ['chartFr', 'chartMath', 'chartHg', 'chartSci', 'chartOral'];
    const chartTitles = ['Français', 'Maths', 'Hist-Géo', 'Sciences', 'Oral'];
    const hasCharts = chartsIds.some(id => getChartImage(id));
    if (hasCharts) {
        doc.addPage();
        drawPdfTitle(doc, "Distribution des notes", subtitle);
        yPos = 52;
        let x = 14;
        chartsIds.forEach((id, idx) => {
            const imgData = getChartImage(id);
            if (!imgData) return;
            if (yPos + 62 > 282) { doc.addPage(); drawPdfTitle(doc, "Distribution des notes", subtitle); yPos = 52; x = 14; }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(31, 52, 82);
            doc.text(chartTitles[idx], x + 42, yPos - 3, { align: 'center' });
            doc.addImage(imgData, 'PNG', x, yPos, 86, 52);
            if (x > 60) { x = 14; yPos += 66; } else { x = 110; }
        });
    }

    addPdfFooter(doc);
    doc.save(`Rapport_Statistiques_${getReportFileLabel()}_${DB.config.year || ''}.pdf`);
}

function pptColor(hex) {
    return String(hex || '').replace('#', '').toUpperCase();
}

function addPptHeader(ppt, slide, title, subtitle) {
    slide.background = { color: 'F8FAFC' };
    slide.addShape(ppt.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.78, fill: { color: '1F3452' }, line: { color: '1F3452' } });
    slide.addShape(ppt.ShapeType.rect, { x: 0, y: 0.78, w: 13.333, h: 0.06, fill: { color: 'D92B84' }, line: { color: 'D92B84' } });
    slide.addText(title, { x: 0.45, y: 0.18, w: 8.2, h: 0.32, fontFace: 'Aptos Display', fontSize: 17, bold: true, color: 'FFFFFF' });
    slide.addText(subtitle, { x: 0.45, y: 0.52, w: 10.5, h: 0.2, fontSize: 8, color: 'DDE6F3' });
}

function addPptKpi(ppt, slide, x, y, w, title, value, detail, color) {
    slide.addShape(ppt.ShapeType.roundRect, { x, y, w, h: 0.92, rectRadius: 0.06, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0' } });
    slide.addText(title, { x: x + 0.14, y: y + 0.12, w: w - 0.25, h: 0.18, fontSize: 8, bold: true, color: '526173' });
    slide.addText(String(value), { x: x + 0.14, y: y + 0.34, w: w - 0.25, h: 0.3, fontSize: 18, bold: true, color });
    slide.addText(String(detail || ''), { x: x + 0.14, y: y + 0.68, w: w - 0.25, h: 0.16, fontSize: 7, color: '6B7280' });
}

function addPptBar(ppt, slide, x, y, w, label, count, total, color) {
    const pct = total > 0 ? count / total : 0;
    slide.addText(label, { x, y: y - 0.02, w: 2.4, h: 0.18, fontSize: 8, bold: true, color });
    slide.addText(`${count} (${getRateText(count, total)})`, { x: x + 2.35, y: y - 0.02, w: 1.1, h: 0.18, fontSize: 7, color: '4B5563' });
    slide.addShape(ppt.ShapeType.roundRect, { x: x + 3.55, y, w, h: 0.12, rectRadius: 0.03, fill: { color: 'E5E7EB' }, line: { color: 'E5E7EB' } });
    if (pct > 0) {
        slide.addShape(ppt.ShapeType.roundRect, { x: x + 3.55, y, w: Math.max(0.03, w * pct), h: 0.12, rectRadius: 0.03, fill: { color }, line: { color } });
    }
}

function exportDatavisPPTX() {
    const PptxCtor = window.PptxGenJS || window.pptxgen;
    if (!PptxCtor) return showToast("Librairie PowerPoint non chargée.", 'error');
    const dataStudents = getActiveDatavisStudents();
    if (dataStudents.length === 0) return showToast("Aucune donnée à exporter pour " + getDatavisSourceLabel(), 'error');

    const ppt = new PptxCtor();
    ppt.layout = 'LAYOUT_WIDE';
    ppt.author = DB.config.schoolName || 'Orga DNB';
    ppt.subject = `Rapport statistique ${getReportExamLabel()}`;
    ppt.title = `Rapport statistique - ${getReportExamLabel()}`;
    ppt.company = DB.config.schoolName || '';
    ppt.lang = 'fr-FR';
    ppt.theme = {
        headFontFace: 'Aptos Display',
        bodyFontFace: 'Aptos',
        lang: 'fr-FR'
    };

    const report = getReportDataset(dataStudents);
    const subtitle = `${DB.config.schoolName || 'Établissement'} · Session ${DB.config.year || ''} · ${dataStudents.length} élève(s) · ${getDatavisSourceLabel()}`;

    let slide = ppt.addSlide();
    addPptHeader(ppt, slide, `Rapport statistique - ${getReportExamLabel()}`, subtitle);
    slide.addText('Synthèse générale', { x: 0.55, y: 1.08, w: 5, h: 0.35, fontSize: 22, bold: true, color: '1F3452' });
    addPptKpi(ppt, slide, 0.6, 1.7, 2.7, 'Effectif', dataStudents.length, 'élèves analysés', '1F3452');
    addPptKpi(ppt, slide, 3.55, 1.7, 2.7, 'Moyenne', `${report.stats.moy20.moy}/20`, `médiane ${report.stats.moy20.med}`, 'D92B84');
    addPptKpi(ppt, slide, 6.5, 1.7, 2.7, 'Réussite', report.successRate, `${report.successCount}/${report.total}`, '27AE60');
    addPptKpi(ppt, slide, 9.45, 1.7, 2.7, 'Excellence', report.excellenceRate, `${report.excellenceCount} TB ou +`, '2C3E50');
    slide.addText('Moyennes par discipline', { x: 0.65, y: 3.0, w: 4.2, h: 0.25, fontSize: 15, bold: true, color: '1F3452' });
    slide.addTable([
        ['Discipline', 'Moyenne', 'Médiane', 'Min', 'Max'],
        ...report.subjectRows.map(row => [row[0], row[1], row[2], row[3], row[4]])
    ], {
        x: 0.65, y: 3.38, w: 6.1, h: 2.35,
        border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
        fill: { color: 'FFFFFF' },
        color: '1F2937',
        fontSize: 8,
        autoFit: false,
        margin: 0.05,
        valign: 'mid',
        rowH: 0.34,
        colW: [1.65, 1.0, 1.0, 0.75, 0.75]
    });
    slide.addText('Répartition des mentions', { x: 7.15, y: 3.0, w: 4.2, h: 0.25, fontSize: 15, bold: true, color: '1F3452' });
    let barY = 3.43;
    report.mentionData.forEach(m => {
        addPptBar(ppt, slide, 7.15, barY, 1.9, m.label, m.count, report.total, pptColor(m.color));
        barY += 0.36;
    });

    slide = ppt.addSlide();
    addPptHeader(ppt, slide, 'Analyse par groupes', subtitle);
    slide.addTable([
        ['Groupe', 'Eff.', 'Moy.', 'Réussite', 'Excellence', 'Fr', 'Maths', 'HG/EMC', 'Sciences', 'Oral'],
        ...report.groups.map(g => [g.name, g.count, g.avg, g.successRate, g.excellenceRate, g.fr, g.math, g.hg, g.sci, g.oral])
    ], {
        x: 0.45, y: 1.12, w: 12.45, h: 5.55,
        border: { type: 'solid', color: 'CBD5E1', pt: 0.4 },
        fill: { color: 'FFFFFF' },
        color: '1F2937',
        fontSize: 7,
        margin: 0.04,
        rowH: 0.28,
        colW: [1.35, 0.55, 0.7, 0.85, 0.95, 0.62, 0.62, 0.7, 0.75, 0.62]
    });

    const chartIds = ['chartFr', 'chartMath', 'chartHg', 'chartSci', 'chartOral'];
    const chartTitles = ['Français', 'Mathématiques', 'Hist-géo / EMC', 'Sciences', 'Oral'];
    const chartImages = chartIds.map((id, idx) => ({ title: chartTitles[idx], img: getChartImage(id) })).filter(item => item.img);
    if (chartImages.length) {
        slide = ppt.addSlide();
        addPptHeader(ppt, slide, 'Distribution des notes', subtitle);
        const slots = [
            [0.55, 1.18], [6.95, 1.18], [0.55, 4.0], [6.95, 4.0]
        ];
        chartImages.slice(0, 4).forEach((item, idx) => {
            const [x, y] = slots[idx];
            slide.addText(item.title, { x, y: y - 0.28, w: 5.6, h: 0.22, fontSize: 12, bold: true, color: '1F3452', align: 'center' });
            slide.addImage({ data: item.img, x, y, w: 5.65, h: 2.2 });
        });
        if (chartImages.length > 4) {
            slide = ppt.addSlide();
            addPptHeader(ppt, slide, 'Distribution des notes', subtitle);
            slide.addText(chartImages[4].title, { x: 2.1, y: 1.05, w: 9, h: 0.3, fontSize: 14, bold: true, color: '1F3452', align: 'center' });
            slide.addImage({ data: chartImages[4].img, x: 2.1, y: 1.48, w: 9, h: 4.6 });
        }
    }

    slide = ppt.addSlide();
    addPptHeader(ppt, slide, 'Lecture rapide', subtitle);
    const bestSubject = report.subjectRows
        .filter(row => row[1] !== '-')
        .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0];
    const weakSubject = report.subjectRows
        .filter(row => row[1] !== '-')
        .sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]))[0];
    const bullets = [
        `Taux de réussite : ${report.successRate}.`,
        `Part d'excellence (Très Bien ou Félicitations) : ${report.excellenceRate}.`,
        bestSubject ? `Discipline la plus favorable : ${bestSubject[0]} (${bestSubject[1]}/20).` : '',
        weakSubject ? `Point de vigilance : ${weakSubject[0]} (${weakSubject[1]}/20).` : '',
        'Les tableaux par groupes permettent de comparer classes, filles et garçons.'
    ].filter(Boolean);
    slide.addText(bullets.map(text => ({ text, options: { bullet: { type: 'bullet' } } })), {
        x: 0.85, y: 1.35, w: 11.2, h: 2.2, fontSize: 18, color: '1F2937', breakLine: false, fit: 'shrink'
    });
    slide.addText('Ce support est prévu pour une diffusion synthétique. Le PDF conserve le détail complet.', {
        x: 0.85, y: 5.25, w: 11.2, h: 0.45, fontSize: 13, italic: true, color: '64748B'
    });

    ppt.writeFile({ fileName: `Rapport_Statistiques_${getReportFileLabel()}_${DB.config.year || ''}.pptx` });
}
window.exportDatavisPPTX = exportDatavisPPTX;

function exportSimulationXLSX() {
    // 1. On vérifie qu'il y a des données
    if (DB.students.length === 0) return showToast("Aucun élève à exporter.", 'error');

    // 2. On prépare les en-têtes du fichier Excel
    const data = [
        ["Nom", "Prénom", "Classe", "Moy. Écrits", "Note Oral", "Moy. Épreuves (60%)", "Moy. Générale (40%)", "NOTE FINALE DNB", "Mention"]
    ];

    // 3. On récupère la configuration des sciences
    const activeSciences = DB.config.scienceSubjects || ['SVT', 'PC', 'TECH'];

    // 4. On boucle sur chaque élève (calculs identiques à renderSimulation)
    DB.students.forEach(s => {
        if (!s.grades) return;
        const vn = (v) => { if (v == null || v === "") return null; const n = parseFloat(v); return isNaN(n) ? null : n; };

        // Calcul Sciences
        let sumSci = 0, countSci = 0, vv;
        if (activeSciences.includes('SVT') && (vv = vn(s.grades.svt)) !== null) { sumSci += vv; countSci++; }
        if (activeSciences.includes('PC') && (vv = vn(s.grades.pc)) !== null) { sumSci += vv; countSci++; }
        if (activeSciences.includes('TECH') && (vv = vn(s.grades.tech)) !== null) { sumSci += vv; countSci++; }
        const moySci = countSci > 0 ? (sumSci / countSci) : null;

        // Calcul Écrits (avec HG/EMC pondéré si séparé)
        let sumEcrit = 0, countEcrit = 0;
        if ((vv = vn(s.grades.fr)) !== null) { sumEcrit += vv; countEcrit++; }
        if ((vv = vn(s.grades.math)) !== null) { sumEcrit += vv; countEcrit++; }
        if (typeof getDetailHGEMC === 'function') {
            const resHG = getDetailHGEMC(s);
            if (resHG.average !== null && !isNaN(resHG.average)) { sumEcrit += resHG.average; countEcrit++; }
        } else {
            if ((vv = vn(s.grades.hg)) !== null) { sumEcrit += vv; countEcrit++; }
        }
        if (moySci !== null) { sumEcrit += moySci; countEcrit++; }
        const moyEcritsVal = countEcrit > 0 ? (sumEcrit / countEcrit) : 0;

        // Calcul Épreuves (Écrits + Oral)
        let sumEpreuves = sumEcrit;
        let countEpreuves = countEcrit;
        if ((vv = vn(s.grades.oral)) !== null) {
            sumEpreuves += vv;
            countEpreuves++;
        }
        const moyEpreuves = countEpreuves > 0 ? (sumEpreuves / countEpreuves) : 0;

        // Calcul Final
        const moyGen = vn(s.grades.genAvg) || 0;
        let finalAvg = 0;
        if (moyGen > 0 && moyEpreuves > 0) finalAvg = (moyGen * 0.4) + (moyEpreuves * 0.6);
        else if (moyEpreuves > 0) finalAvg = moyEpreuves;
        else if (moyGen > 0) finalAvg = moyGen;

        // Calcul Mention
        let mention = "Refusé";
        if (finalAvg >= 10) mention = "Admis";
        if (finalAvg >= 12) mention = "Assez Bien";
        if (finalAvg >= 14) mention = "Bien";
        if (finalAvg >= 16) mention = "Très Bien";
        if (finalAvg >= 18) mention = "TB (Félicitations)";

        // 5. On ajoute la ligne au tableau Excel
        data.push([
            s.nom,
            s.prenom,
            s.classe,
            parseFloat(moyEcritsVal.toFixed(2)),       // Moyenne Écrits
            vn(s.grades.oral) !== null ? vn(s.grades.oral) : "", // Note Oral
            parseFloat(moyEpreuves.toFixed(2)),      // Moyenne Épreuves
            vn(s.grades.genAvg) !== null ? vn(s.grades.genAvg) : "", // Moyenne Générale
            parseFloat(finalAvg.toFixed(2)),         // NOTE FINALE
            mention                                  // Mention
        ]);
    });

    // 6. Création du fichier Excel avec SheetJS
    const ws = XLSX.utils.aoa_to_sheet(data); // Convertit le tableau en feuille
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Simulation DNB");

    // Téléchargement
    XLSX.writeFile(wb, "Simulation_DNB_Complet.xlsx");
}
function exportDatavisXLSX() {
    const dataStudents = getActiveDatavisStudents();
    if (dataStudents.length === 0) return showToast("Aucune donnée à exporter.", 'error');

    // 1. Préparation des colonnes
    // On crée un tableau avec une ligne d'en-tête
    const data = [
        ["Groupe", "Effectif", "Moyenne Générale /20", "Français /20", "Maths /20", "Hist-Géo /20", "Sciences /20", "Oral /20"]
    ];

    // 2. Définition des groupes à analyser, partagée avec les autres sorties.
    const groups = getDatavisGroups(dataStudents).map(group => ({
        ...group,
        name: group.name === 'Cohorte' ? 'Cohorte (Global)' : `Classe ${group.name}`
    }));
    groups[0].name = 'Cohorte (Global)';
    groups.slice(1).forEach(group => {
        if (group.name === 'Classe Filles') group.name = 'Filles';
        if (group.name === 'Classe Garçons') group.name = 'Garçons';
        if (group.name === 'Classe Sexe non renseigné') group.name = 'Sexe non renseigné';
    });

    // 3. Boucle de calcul (identique au tableau affiché à l'écran)
    groups.forEach(g => {
        // On filtre les élèves du groupe actuel
        const groupStudents = dataStudents.filter(g.filter);
        const count = groupStudents.length;

        if (count > 0) {
            // On utilise la fonction existante calculateStats pour avoir les moyennes
            const stats = calculateStats(groupStudents);

            // On ajoute la ligne dans le tableau Excel
            data.push([
                g.name,                 // Nom du groupe
                count,                  // Effectif
                parseFloat(stats.moy20.moy), // Moyenne Générale
                parseFloat(stats.fr.moy),    // Français
                parseFloat(stats.math.moy),  // Maths
                parseFloat(stats.hg.moy),    // Hist-Géo
                parseFloat(stats.sci.moy),   // Sciences
                stats.oral.moy !== '-' ? parseFloat(stats.oral.moy) : "-" // Oral
            ]);
        } else {
            // Si le groupe est vide (ex: une classe sans élèves importés)
            data.push([g.name, 0, "-", "-", "-", "-", "-", "-"]);
        }
    });

    // 4. Génération du fichier
    const ws = XLSX.utils.aoa_to_sheet(data); // Convertit le tableau JS en feuille Excel

    // Petit ajustement esthétique des largeurs de colonnes (optionnel mais propre)
    ws['!cols'] = [
        { wch: 20 }, // Largeur Groupe
        { wch: 10 }, // Largeur Effectif
        { wch: 20 }, // Largeur Moyenne Gen
        { wch: 15 }, // Largeur Fr
        { wch: 15 }, // Largeur Math
        { wch: 15 }, // Largeur HG
        { wch: 15 }, // Largeur Sci
        { wch: 15 }  // Largeur Oral
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statistiques");

    // Téléchargement
    const safeExamLabel = getDatavisSource() === 'official'
        ? 'DNB_Officiel'
        : (typeof getSafeExamFileLabel === 'function' ? getSafeExamFileLabel() : 'Examen');
    XLSX.writeFile(wb, `Statistiques_${safeExamLabel}.xlsx`);
}

function statNumber(value) {
    if (value === '-' || value === null || value === undefined || value === '') return '';
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : '';
}

function percentNumber(count, total) {
    return total > 0 ? Number((count / total).toFixed(4)) : '';
}

function getDatavisGroups(students) {
    const classes = [...new Set(students.map(s => s.classe).filter(c => c))].sort();
    const groups = [
        { name: "Cohorte", type: "Global", filter: s => true },
        { name: "Filles", type: "Sexe", filter: s => getStudentSex(s) === 'F' },
        { name: "Garçons", type: "Sexe", filter: s => getStudentSex(s) === 'M' }
    ];
    if (students.some(s => !getStudentSex(s))) groups.push({ name: "Sexe non renseigné", type: "Sexe", filter: s => !getStudentSex(s) });
    classes.forEach(c => groups.push({ name: c, type: "Classe", filter: s => s.classe === c }));
    return groups;
}

function buildStatsArchiveRow(students, groupName, groupType) {
    const stats = calculateStats(students);
    const { mentions, total } = calculateMentions(students);
    const examLabel = getDatavisSource() === 'official'
        ? 'DNB officiel'
        : (DB.config.examType === 'Autre' ? (DB.config.customExamName || 'Examen') : (DB.config.examType || 'DNB blanc'));
    return [
        DB.config.year || '',
        DB.config.schoolName || '',
        examLabel,
        getDatavisSourceLabel(),
        groupType,
        groupName,
        students.length,
        statNumber(stats.moy20.moy),
        statNumber(stats.moy20.med),
        statNumber(stats.moy20.min),
        statNumber(stats.moy20.max),
        statNumber(stats.moy20.ecart),
        statNumber(stats.fr.moy),
        statNumber(stats.math.moy),
        statNumber(stats.hg.moy),
        statNumber(stats.sci.moy),
        statNumber(stats.oral.moy),
        mentions['Félicitations du jury'],
        mentions['Refusé'],
        mentions['Admis'],
        mentions['Assez Bien'],
        mentions['Bien'],
        mentions['Très Bien'],
        total,
        percentNumber(mentions['Félicitations du jury'], total),
        percentNumber(mentions['Refusé'], total),
        percentNumber(mentions['Admis'], total),
        percentNumber(mentions['Assez Bien'], total),
        percentNumber(mentions['Bien'], total),
        percentNumber(mentions['Très Bien'], total)
    ];
}

function exportAnnualStatsSheetXLSX() {
    if (typeof XLSX === 'undefined') return showToast("Librairie Excel non chargée.", 'error');
    const dataStudents = getActiveDatavisStudents();
    if (dataStudents.length === 0) return showToast("Aucune donnée statistique à exporter.", 'error');

    const archiveHeaders = [
        "Année", "Établissement", "Examen", "Source", "Type groupe", "Groupe", "Effectif",
        "Moyenne générale", "Médiane générale", "Min générale", "Max générale", "Écart-type général",
        "Moyenne français", "Moyenne maths", "Moyenne hist-géo/EMC", "Moyenne sciences", "Moyenne oral",
        "Nb félicitations", "Nb refusés", "Nb admis", "Nb assez bien", "Nb bien", "Nb très bien", "Total mentions",
        "Taux félicitations", "Taux refusés", "Taux admis", "Taux assez bien", "Taux bien", "Taux très bien"
    ];
    const groups = getDatavisGroups(dataStudents);
    const archiveRows = [archiveHeaders];
    groups.forEach(group => {
        const groupStudents = dataStudents.filter(group.filter);
        if (groupStudents.length > 0 || group.type !== 'Classe') {
            archiveRows.push(buildStatsArchiveRow(groupStudents, group.name, group.type));
        }
    });

    const detailsRows = [[
        "Nom", "Prénom", "Classe", "Source", "Moyenne finale", "Français", "Maths", "Hist-géo/EMC",
        "Sciences", "Oral", "Contrôle continu", "Résultat officiel"
    ]];
    dataStudents
        .slice()
        .sort((a, b) => (a.classe || '').localeCompare(b.classe || '', 'fr') || (a.nom || '').localeCompare(b.nom || '', 'fr'))
        .forEach(student => {
            const grades = student.grades || {};
            detailsRows.push([
                student.nom || '',
                student.prenom || '',
                student.classe || '',
                getDatavisSourceLabel(),
                getGradeAverage(student) ?? '',
                grades.fr ?? '',
                grades.math ?? '',
                grades.hg ?? '',
                getScienceScore(student) ?? '',
                grades.oral ?? '',
                grades.genAvg ?? '',
                student.officialResult || ''
            ]);
        });

    const wb = XLSX.utils.book_new();
    const wsArchive = XLSX.utils.aoa_to_sheet(archiveRows);
    wsArchive['!cols'] = archiveHeaders.map(header => ({ wch: Math.min(Math.max(header.length + 2, 12), 24) }));
    const wsDetails = XLSX.utils.aoa_to_sheet(detailsRows);
    wsDetails['!cols'] = [
        { wch: 24 }, { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 12 },
        { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 34 }
    ];
    XLSX.utils.book_append_sheet(wb, wsArchive, "Archive annuelle");
    XLSX.utils.book_append_sheet(wb, wsDetails, "Détail élèves");

    const sourceLabel = getDatavisSource() === 'official' ? 'DNB_Officiel' : 'DNB_Blanc';
    XLSX.writeFile(wb, `Feuille_Statistique_${sourceLabel}_${DB.config.year || ''}.xlsx`);
}
window.exportAnnualStatsSheetXLSX = exportAnnualStatsSheetXLSX;
// ============================================================
// === MODULE DE SAUVEGARDE AUTOMATIQUE (CORRIGÉ & COMPLET) ===
// ============================================================

// 1. ROBUST AUTO-SAVE (MULTI-SLOT)
const SAVE_SLOTS = ['DNB_Manager_Current', 'DNB_Manager_Backup_1', 'DNB_Manager_Backup_2', 'DNB_Manager_Backup_3'];
let lastRotationTime = Date.now();

function autoSave() {
    if (typeof DB === 'undefined' || !DB) return;

    // 1. Sauvegarde slot CURRENT (safeSetItem gère un éventuel quota dépassé)
    const savedOK = safeSetItem(SAVE_SLOTS[0], JSON.stringify(DB));

    // 2. Rotation des backups (toutes les 5 min) — uniquement si la sauvegarde principale a réussi
    if (savedOK && Date.now() - lastRotationTime > 5 * 60 * 1000) {
        lastRotationTime = Date.now();
        // Rotation : 2->3, 1->2, 0->1
        if (localStorage.getItem(SAVE_SLOTS[2])) safeSetItem(SAVE_SLOTS[3], localStorage.getItem(SAVE_SLOTS[2]));
        if (localStorage.getItem(SAVE_SLOTS[1])) safeSetItem(SAVE_SLOTS[2], localStorage.getItem(SAVE_SLOTS[1]));
        safeSetItem(SAVE_SLOTS[1], localStorage.getItem(SAVE_SLOTS[0]));
        console.log("🔄 Rotation des backups effectuée.");
    }

    // Logic Alerte Bouton
    if (firstUnsavedTime === null) {
        firstUnsavedTime = Date.now();
        checkSaveStatus();
    }
}

// 3. Déclencheurs (Debounce)
let saveTimeout;
const triggerSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(autoSave, 2000); // Save après 2s d'inactivité
};

document.addEventListener('change', triggerSave);
document.addEventListener('input', triggerSave);
document.addEventListener('mouseup', () => setTimeout(autoSave, 500)); // Click ending logic

// 4. Restauration au démarrage (LOGIQUE MISE À JOUR)
window.addEventListener('load', function () {
    // Dans Grist, la source de vérité est le document : la sauvegarde locale du navigateur est commune à tous les
    // documents ouverts sur ce poste et peut être périmée. La restaurer publierait son contenu dans le document
    // affiché (éventuellement un autre document). Le bouton n'est donc proposé que hors de Grist.
    if (window !== window.parent) return;
    setTimeout(() => {
        const backup = localStorage.getItem('DNB_Manager_Current');
        if (backup) {
            let btn = document.createElement('button');
            btn.innerHTML = "⚠️ <strong>Une sauvegarde existe</strong> : Restaurer la session ?";
            btn.style.cssText = "position:fixed; top:10px; left:50%; transform:translateX(-50%); background:#9a4a2e; color:white; padding:12px 25px; border:none; border-radius:50px; z-index:10000; cursor:pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.3); font-size:1rem; animation: slideDown 0.5s;";

            btn.onclick = function () {
                showConfirm("Attention : Cela va écraser les données actuelles par la sauvegarde automatique. Continuer ?", () => {
                    try {
                        DB = JSON.parse(backup);

                        // A. Initialisation des défauts (Migration)
                        if (!DB.config.labels) DB.config.labels = JSON.parse(JSON.stringify(DEFAULT_LABELS));
                        if (!DB.config.scienceSubjects) DB.config.scienceSubjects = ['SVT', 'PC', 'TECH'];
                        if (!DB.edt) {
                            DB.edt = { cancelled: [], maintained: [] };
                        } else {
                            // Restore Date objects for DB.edt
                            if (DB.edt.cancelled) {
                                DB.edt.cancelled.forEach(c => {
                                    if (typeof c.start === 'string') c.start = new Date(c.start);
                                    if (typeof c.end === 'string') c.end = new Date(c.end);
                                });
                            }
                            if (DB.edt.maintained) {
                                DB.edt.maintained.forEach(m => {
                                    if (typeof m.start === 'string') m.start = new Date(m.start);
                                    if (typeof m.end === 'string') m.end = new Date(m.end);
                                });
                            }
                        }

                        // B. Relance sécurisée des affichages
                        const safeRun = (fn) => { try { if (typeof fn === 'function') fn(); } catch (e) { console.warn(e); } };

                        safeRun(renderExamTable);
                        safeRun(checkLogo);
                        safeRun(checkSignature);
                        safeRun(renderStudents);
                        safeRun(renderRooms);
                        safeRun(renderTeachers);
                        safeRun(renderVisualDistribution);
                        safeRun(renderGrades);
                        safeRun(renderSimulation);
                        safeRun(renderPlanning);
                        safeRun(renderAmenagements);

                        if (document.getElementById('res-datavis') && document.getElementById('res-datavis').querySelector('.card')) {
                            safeRun(renderDatavisStats);
                        }

                        // C. Mise à jour de l'interface (Cadenas & Config)
                        updateLockUI('students'); updateLockUI('rooms'); updateLockUI('teachers');
                        updateDistribLock(); updateLockUI('grades'); updateLockUI('simul');

                        // Restauration Champs Config de base
                        if (DB.config.schoolName) document.getElementById('schoolName').value = DB.config.schoolName;
                        if (DB.config.year) document.getElementById('sessionYear').value = DB.config.year;
                        if (DB.config.city) document.getElementById('schoolCity').value = DB.config.city;
                        if (typeof syncExamTypeUI === 'function') syncExamTypeUI();
                        // --- CORRECTIF 1 : DIRECTION ---
                        if (DB.config.director) {
                            if (document.getElementById('dirName')) document.getElementById('dirName').value = DB.config.director.name || "";
                            // On utilise la fonction visuelle pour réactiver la bonne "brique"
                            if (typeof setDirectorCiv === 'function') setDirectorCiv(DB.config.director.civ || "M. le Principal");
                        }

                        // --- CORRECTIF 2 : SCIENCES ---
                        if (DB.config.scienceSubjects) {
                            document.getElementById('chkSVT').checked = DB.config.scienceSubjects.includes('SVT');
                            document.getElementById('chkPC').checked = DB.config.scienceSubjects.includes('PC');
                            document.getElementById('chkTech').checked = DB.config.scienceSubjects.includes('TECH');
                        }

                        // Restauration module Oral V2.7
                        if (typeof setupOralDatabase === 'function') setupOralDatabase();
                        if (typeof refreshOralConfigUI === 'function') refreshOralConfigUI();
                        if (typeof renderOralStudentsTable === 'function') renderOralStudentsTable();
                        if (typeof renderOralTeachersTable === 'function') renderOralTeachersTable();

                        showToast("✅ Session restaurée avec succès !", 'success');
                        btn.remove();
                    } catch (e) {
                        console.error(e);
                        showAlertModal("Erreur lors de la restauration : " + e.message, 'error');
                    }
                });
            };

            let btnClose = document.createElement('span');
            btnClose.innerHTML = " ✖";
            btnClose.style.marginLeft = "10px";
            btnClose.onclick = (e) => { e.stopPropagation(); btn.remove(); };
            btn.appendChild(btnClose);
            document.body.appendChild(btn);
        }
    }, 800);
});
