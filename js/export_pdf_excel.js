// === MODULE: export_pdf_excel ===

// [PDF Exports]
function drawHeader(doc, title, subtitle) {
    if (typeof drawExamPdfHeader === 'function') {
        return drawExamPdfHeader(doc, { title, subtitle, y: 8, logoSize: 28 });
    }
    addSmartLogo(doc, 10, 10, 28);
    doc.setFontSize(18);
    doc.text(DB.config.schoolName, 48, 20);
    doc.setFontSize(14);
    doc.text(typeof getExamSessionLabel === 'function' ? getExamSessionLabel() : "DNB Blanc - Session " + DB.config.year, 48, 28);
    doc.setFontSize(16);
    doc.text(title, 14, 48);
    if (subtitle) {
        doc.setFontSize(12);
        doc.text(subtitle, 14, 55);
    }
    return 64;
}
function exportDisplayPDF() { const { jsPDF } = window.jspdf; const doc = new jsPDF(); let pageCount = 0; DB.rooms.forEach((r) => { if ((DB.distribution[r.nom] || []).length === 0) return; if (pageCount > 0) doc.addPage(); drawHeader(doc, `Liste d'affichage - Salle ${r.nom}`, r.isTT ? "Tiers-Temps" : "Standard"); const body = (DB.distribution[r.nom] || []).map(s => [s.nom, s.prenom, s.classe, s.tt ? "OUI" : ""]); doc.autoTable({ head: [['Nom', 'Prénom', 'Classe', 'TT']], body: body, startY: 60 }); pageCount++; }); doc.save("listes_affichage.pdf"); }
function exportDisplayXLSX() { const data = [["Salle", "Type", "Nom", "Prénom", "Classe", "TT"]]; DB.rooms.forEach((r) => { if ((DB.distribution[r.nom] || []).length === 0) return; const roomType = r.isTT ? "Tiers-Temps" : "Standard"; (DB.distribution[r.nom] || []).forEach(s => { data.push([r.nom, roomType, s.nom, s.prenom, s.classe, s.tt ? "OUI" : ""]); }); }); const ws = XLSX.utils.aoa_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Listes_Affichage"); XLSX.writeFile(wb, "Listes_Affichage.xlsx"); }
function exportSignPDF() { const { jsPDF } = window.jspdf; const doc = new jsPDF(); let pageCount = 0; DB.exams.forEach(exam => { DB.rooms.forEach(room => { if ((DB.distribution[room.nom] || []).length === 0) return; if (pageCount > 0) doc.addPage(); const dur = room.isTT ? exam.durTT : exam.durStd; const startTime = room.isTT ? (exam.timeTT || exam.time) : exam.time; const endTime = addMinutes(startTime, dur); drawHeader(doc, `Émargement - ${exam.name} - Salle ${room.nom}`, `Date: ${exam.date} | Horaire: ${startTime} - ${endTime}`); const body = (DB.distribution[room.nom] || []).map(s => [s.nom, s.prenom, s.classe, s.tt ? "TT" : "", ""]); doc.autoTable({ head: [['Nom', 'Prénom', 'Classe', 'TT', 'Signature']], body: body, startY: 65, columnStyles: { 4: { minCellWidth: 40 } } }); pageCount++; }); }); doc.save("feuilles_emargement.pdf"); }
function exportSignXLSX() { const data = [["Épreuve", "Date", "Horaire", "Salle", "Type", "Nom", "Prénom", "Classe", "TT", "Signature"]]; DB.exams.forEach(exam => { DB.rooms.forEach(room => { if ((DB.distribution[room.nom] || []).length === 0) return; const dur = room.isTT ? exam.durTT : exam.durStd; const startTime = room.isTT ? (exam.timeTT || exam.time) : exam.time; const endTime = addMinutes(startTime, dur); const roomType = room.isTT ? "Tiers-Temps" : "Standard"; const horaire = `${startTime} - ${endTime}`; (DB.distribution[room.nom] || []).forEach(s => { data.push([exam.name, exam.date, horaire, room.nom, roomType, s.nom, s.prenom, s.classe, s.tt ? "TT" : "", ""]); }); }); }); const ws = XLSX.utils.aoa_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Emargements"); XLSX.writeFile(wb, "Emargements.xlsx"); }

function openConvocOptions() { if (!DB.config.director) DB.config.director = { civ: "M. le Principal", name: "" }; if (DB.students.length === 0) return showToast("Aucun élève dans la base.", 'error'); if (Object.keys(DB.distribution).length === 0) return showToast("Veuillez faire la répartition d'abord.", 'warning'); const sel = document.getElementById('convocStudentSelect'); sel.innerHTML = '<option value="all">-- Tous les élèves --</option>'; const sortedStudents = [...DB.students].sort((a, b) => a.nom.localeCompare(b.nom)); sortedStudents.forEach(s => { let opt = document.createElement('option'); opt.value = s.id; opt.text = `${s.nom} ${s.prenom} (${s.classe})`; sel.appendChild(opt); }); document.getElementById('convocOptionsModal').style.display = 'flex'; }
function closeConvocOptions() { document.getElementById('convocOptionsModal').style.display = 'none'; }

// =========================================================
// === EXPORT CONVOCATIONS ÉLÈVES (VERSION V4 - TEXTE LONG) ===
// =========================================================

window.exportConvocationStudents = function (targetId = null) {
    // ... (début de la fonction inchangé) ...
    const txtArea = document.getElementById('txtConvocInfo');
    if (txtArea) txtArea.style.height = "250px";

    showConfirm("🖨️ IMPORTANT : MODE RECTO-VERSO\n\nCertaines convocations contiennent beaucoup de texte et seront générées sur 2 pages.\n\n👉 Veuillez régler votre imprimante sur RECTO-VERSO (bords longs).", () => {

    const generatePDF = (sortMode, specificId) => {
        // ... (configuration PDF inchangée) ...
        DB.config.schoolName = document.getElementById('schoolName').value;
        DB.config.year = document.getElementById('sessionYear').value;
        const customText = document.getElementById('txtConvocInfo').value;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');

        const PAGE_W = 210; const PAGE_H = 297; const MARGIN = 20; const TEXT_WIDTH = PAGE_W - (MARGIN * 2);
        let count = 0;

        let studentsToPrint = [];
        if (specificId && typeof specificId !== 'object') studentsToPrint = DB.students.filter(s => s.id == specificId);
        else studentsToPrint = [...DB.students];

        studentsToPrint.sort((a, b) => {
            if (sortMode === 'class') { if (a.classe < b.classe) return -1; if (a.classe > b.classe) return 1; return a.nom.localeCompare(b.nom); }
            return a.nom.localeCompare(b.nom);
        });

        if (studentsToPrint.length === 0) return showToast("Aucun élève à imprimer.", 'error');

        let studentPlacement = {};
        DB.rooms.forEach(r => { (DB.distribution[r.nom] || []).forEach(s => { studentPlacement[s.id] = { room: r.nom, isTT: r.isTT }; }); });

        studentsToPrint.forEach((student) => {
            const place = studentPlacement[student.id];

            // Check for oral assignment
            let stageAssignment = null;
            if (DB.stage && DB.stage.planning) {
                stageAssignment = DB.stage.planning.find(p => p.studentId == student.id);
            }

            // Skip if no written place AND no oral assignment
            if (!place && !stageAssignment) return;

            if (count > 0) doc.addPage(); count++;

            // --- HEADER ---
            if (typeof addSmartLogo === 'function') addSmartLogo(doc, 15, 10, 45);

            doc.setFontSize(10); doc.setTextColor(100);
            doc.text(typeof getExamTitle === 'function' ? getExamTitle() : "DNB BLANC", 195, 15, { align: 'right' });
            doc.text(`Session ${DB.config.year}`, 195, 20, { align: 'right' });

            doc.setFontSize(14); doc.setTextColor(44, 62, 80); doc.setFont("helvetica", "bold");
            doc.text(DB.config.schoolName || "Collège", 105, 18, { align: 'center' });
            doc.setFontSize(18); doc.setTextColor(0); doc.text("CONVOCATION", 105, 35, { align: 'center' });

            doc.setFillColor(248, 249, 250); doc.setDrawColor(44, 62, 80); doc.setLineWidth(0.5);
            doc.rect(15, 45, 180, 25, 'FD');

            doc.setFontSize(12); doc.setTextColor(0); doc.setFont("helvetica", "bold");
            doc.text(`Candidat(e) :  ${student.nom} ${student.prenom}`, 20, 53);
            doc.text(`Classe :  ${student.classe}`, 120, 53);

            if (student.anonymat) { doc.setTextColor(192, 57, 43); doc.text(`N° Anonymat :  ${student.anonymat}`, 20, 62); }
            else { doc.setTextColor(150); doc.setFontSize(10); doc.text("(Code non généré)", 20, 62); }

            doc.setTextColor(0); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
            if (place) {
                doc.text(`Salle : ${place.room}`, 120, 62);
                if (place.isTT) { doc.setFontSize(10); doc.setTextColor(142, 68, 173); doc.text("(Tiers-Temps)", 155, 62); }
            } else {
                doc.text(`Salle : Orale uniquement`, 120, 62);
            }

            if (place) {
                doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(11);
                doc.text("Veuillez vous présenter aux épreuves selon le planning ci-dessous :", 15, 80);
            }

            let body = [];
            DB.exams.forEach(exam => {
                // --- CORRECTIF DATE : ON FORCE MIDI POUR ÉVITER LE BUG DU JOUR ---
                // "2026-01-29" + "T12:00:00" = Date fixée à midi, insensible aux décalages horaires minimes
                const dateObj = new Date(exam.date + "T12:00:00");
                const dateStr = dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

                // --- FIN CORRECTIF ---

                let finalStart = place.isTT ? (exam.timeTT || exam.time) : exam.time;
                const slotType = place.isTT ? 'tt' : 'std';
                if (exam.slots && exam.slots[slotType] && exam.slots[slotType].length > 0) {
                    finalStart = exam.slots[slotType][0].start;
                }
                let finalDurVal = place.isTT ? exam.durTT : exam.durStd;

                body.push([
                    dateStr.charAt(0).toUpperCase() + dateStr.slice(1),
                    exam.name,
                    finalStart,
                    `${finalDurVal} min`
                ]);
            });

            if (place && DB.exams && DB.exams.length > 0) {
                doc.autoTable({
                    head: [['Date', 'Épreuve', 'Début', 'Durée']], body: body, startY: 85, theme: 'grid',
                    headStyles: { fillColor: [44, 62, 80] }, styles: { cellPadding: 3, valign: 'middle', fontSize: 10 },
                    columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center', fontStyle: 'bold' } }
                });
            }

            // --- AJOUT ORAUX ---
            // (stageAssignment already fetched above)

            if (stageAssignment) {
                let finalY = (place && doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 10 : 80;
                let jury = DB.stage.juries.find(j => j.id == stageAssignment.juryId);
                let dateStage = DB.stage.config.date || "Date à définir";

                // Formatage Date
                const dObj = new Date(dateStage);
                const dStr = dObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

                doc.setFillColor(230, 230, 250); // Lavande léger
                doc.setDrawColor(142, 68, 173); // Violet
                doc.setLineWidth(0.5);
                doc.rect(15, finalY, 180, 25, 'FD');

                doc.setFont("helvetica", "bold");
                doc.setTextColor(142, 68, 173);
                doc.setFontSize(12);
                doc.text("ÉPREUVE ORALE", 105, finalY + 8, { align: "center" });

                doc.setTextColor(0);
                doc.setFontSize(10);
                doc.text(`Date : ${dStr}`, 20, finalY + 18);
                doc.text(`Heure : ${stageAssignment.time}`, 80, finalY + 18);

                if (jury) {
                    doc.text(`Jury : ${jury.name}`, 120, finalY + 18);
                    doc.text(`Salle : ${jury.room || "?"}`, 160, finalY + 18);
                }
            }
            // ----------------------------

            // --- GESTION TEXTE ET SIGNATURE (INCHANGÉE) ---
            let currentY = (place && doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 10 : 80;
            if (stageAssignment) currentY += 35; // Décalage pour laisser la place au bloc Stage
            const signatureHeight = 40; const bottomMargin = 15;
            doc.setFontSize(10); doc.setFont("helvetica", "normal");
            const textLines = doc.splitTextToSize(customText, TEXT_WIDTH);
            const textHeight = textLines.length * 5;
            const spaceRemaining = PAGE_H - currentY - bottomMargin;
            const spaceNeededTotal = textHeight + signatureHeight + 10;
            let signatureY = 0;

            if (spaceNeededTotal < spaceRemaining) {
                doc.setFont("helvetica", "bold"); doc.text("INFORMATIONS :", 20, currentY);
                doc.setFont("helvetica", "normal"); doc.text(textLines, 20, currentY + 6);
                signatureY = currentY + 6 + textHeight + 10;
            } else {
                const boxH = 16;
                doc.setDrawColor(192, 57, 43); doc.setLineWidth(0.8); doc.setFillColor(250, 229, 211);
                doc.roundedRect(MARGIN, currentY, TEXT_WIDTH, boxH, 2, 2, 'FD');
                doc.setFillColor(241, 196, 15); doc.triangle(MARGIN + 5, currentY + 11, MARGIN + 8, currentY + 5, MARGIN + 11, currentY + 11, 'F');
                doc.setFontSize(11); doc.setTextColor(192, 57, 43); doc.setFont("helvetica", "bold");
                doc.text("VOIR CONSIGNES DÉTAILLÉES AU VERSO", 105, currentY + 10, { align: 'center' });
                signatureY = currentY + 30;

                doc.addPage();
                doc.setFontSize(16); doc.setTextColor(44, 62, 80); doc.text("CONSIGNES & INFORMATIONS", 105, 20, { align: 'center' });
                doc.setDrawColor(200); doc.setLineWidth(0.5); doc.line(MARGIN, 25, PAGE_W - MARGIN, 25);
                doc.setFontSize(11); doc.setTextColor(0); doc.setFont("helvetica", "normal");
                const versoLines = doc.splitTextToSize(customText, TEXT_WIDTH);
                doc.text(versoLines, MARGIN, 35);
                doc.setPage(doc.internal.getNumberOfPages() - 1);
            }

            const centerX = 140; if (signatureY > 260) signatureY = 260;
            doc.setTextColor(0); doc.setFontSize(11); doc.setFont("helvetica", "normal");
            doc.text(`Fait à ${DB.config.city || "SJI"}, le ${new Date().toLocaleDateString()}`, centerX, signatureY, { align: 'center' });
            doc.setFont("helvetica", "bold"); doc.text(DB.config.director.civ || "Le Chef d'Établissement", centerX, signatureY + 5, { align: 'center' });
            doc.text(DB.config.director.name || "", centerX, signatureY + 10, { align: 'center' });

            if (DB.config.signature) {
                try {
                    const imgProps = doc.getImageProperties(DB.config.signature);
                    const ratio = imgProps.width / imgProps.height; const h = 20; const w = h * ratio;
                    doc.addImage(DB.config.signature, 'PNG', centerX - (w / 2), signatureY + 15, w, h);
                } catch (e) { }
            }
        });
        doc.save(`Convocations_Eleves_${sortMode || 'Single'}.pdf`);
    };

    if (targetId && typeof targetId !== 'object' && targetId !== 'all') { generatePDF(null, targetId); return; }

    // --- POPUP CHOIX TRI ---
    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', zIndex: '9999', display: 'flex', justifyContent: 'center', alignItems: 'center' });
    const modal = document.createElement('div');
    Object.assign(modal.style, { backgroundColor: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', textAlign: 'center', maxWidth: '600px', width: '90%', fontFamily: 'Helvetica, sans-serif' });
    modal.innerHTML = `<h3 style="color:#1f3a5c; margin-top:0;">🖨️ Imprimer les Convocations</h3>`;
    const btnContainer = document.createElement('div');
    Object.assign(btnContainer.style, { display: 'flex', gap: '20px', marginTop: '25px', justifyContent: 'center' });

    function createCard(emoji, title, desc, color, action) {
        const card = document.createElement('div');
        Object.assign(card.style, { flex: '1', padding: '20px', border: '2px solid #ece9e0', borderRadius: '10px', cursor: 'pointer', transition: 'all 0.2s', backgroundColor: '#faf9f6' });
        card.innerHTML = `<div style="font-size:40px; margin-bottom:10px;">${emoji}</div><div style="font-weight:bold; color:${color}; font-size:16px;">${title}</div><div style="font-size:12px; color:#656d70; margin-top:5px;">${desc}</div>`;
        card.onclick = () => { document.body.removeChild(overlay); action(); };
        return card;
    }
    const btnClass = createCard("🏫", "Par Classe", "Trié par classe puis par nom", "#2f6f5e", () => generatePDF('class'));
    const btnAlpha = createCard("🌍", "Alphabétique", "Trié de A à Z", "#1f3a5c", () => generatePDF('alpha'));
    btnContainer.append(btnClass, btnAlpha); modal.appendChild(btnContainer);

    const btnCancel = document.createElement('div');
    btnCancel.innerText = "Annuler"; Object.assign(btnCancel.style, { marginTop: "20px", color: "#9aa0a2", cursor: "pointer", fontSize: "14px", textDecoration: "underline" });
    btnCancel.onclick = () => document.body.removeChild(overlay); modal.appendChild(btnCancel);
    overlay.appendChild(modal); document.body.appendChild(overlay);

    }); return;
};


// 3. CONVOCATIONS PROFS (Corrigé & Complet)
window.exportConvocationTeachers = function () {
    DB.config.schoolName = document.getElementById('schoolName').value;
    DB.config.year = document.getElementById('sessionYear').value;
    if (!DB.config.director) DB.config.director = { civ: "M. le Principal", name: "" };

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    let count = 0;

    DB.teachers.forEach(teacher => {
        const fullName = `${teacher.nom} ${teacher.prenom}`;
        let duties = [];

        for (const [key, assignedName] of Object.entries(DB.planning)) {
            if (assignedName !== fullName) continue;
            const parts = key.split('_');
            if (parts.length < 5) continue;
            const examIdx = parseInt(parts[0]);
            const roomName = parts[1];
            const type = parts[2];
            const slotIdx = parseInt(parts[3]);
            const exam = DB.exams[examIdx];
            let slot = { start: "??", end: "??" };
            if (exam.slots && exam.slots[type] && exam.slots[type][slotIdx]) {
                slot = exam.slots[type][slotIdx];
            } else {
                slot = { start: type === 'tt' ? (exam.timeTT || exam.time) : exam.time, end: "..." };
            }
            duties.push({ date: exam.date, start: slot.start, end: slot.end, name: exam.name, room: roomName, isTT: (type === 'tt') });
        }

        if (duties.length === 0) return;
        if (count > 0) doc.addPage(); count++;

        addSmartLogo(doc, 15, 10, 45);
        doc.setFontSize(10); doc.setTextColor(100); doc.text(typeof getExamTitle === 'function' ? getExamTitle() : "DNB BLANC", 195, 12, { align: 'right' }); doc.text(`Session ${DB.config.year}`, 195, 17, { align: 'right' });
        doc.setFontSize(14); doc.setTextColor(44, 62, 80); doc.setFont("helvetica", "bold"); doc.text(DB.config.schoolName || "Collège", 105, 18, { align: 'center' });
        doc.setFontSize(18); doc.setTextColor(0); doc.text("CONVOCATION SURVEILLANCE", 105, 40, { align: 'center' });

        doc.setFillColor(248, 249, 250); doc.setDrawColor(44, 62, 80); doc.rect(15, 50, 180, 20, 'FD');
        doc.setFontSize(12); doc.setTextColor(0); doc.setFont("helvetica", "bold"); doc.text(`${teacher.civ || ""} ${fullName}`, 20, 62);

        doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text("Planning de vos créneaux de surveillance :", 15, 85);

        duties.sort((a, b) => {
            const dateComp = a.date.localeCompare(b.date);
            if (dateComp !== 0) return dateComp;
            return a.start.localeCompare(b.start);
        });

        let body = duties.map(d => {
            // --- CORRECTIF DATE : ON FORCE MIDI ---
            const dateObj = new Date(d.date + "T12:00:00");
            const dateStr = dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
            // ------------------------------------
            return [dateStr, `${d.start} - ${d.end}`, d.name + (d.isTT ? " (TT)" : ""), d.room];
        });

        doc.autoTable({
            head: [['Date', 'Créneau', 'Épreuve', 'Salle']], body: body, startY: 90, theme: 'grid',
            headStyles: { fillColor: [44, 62, 80] }, styles: { cellPadding: 3, valign: 'middle', fontSize: 10 },
            columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 35, fontStyle: 'bold' }, 3: { cellWidth: 25, halign: 'center' } }
        });

        let finalY = doc.lastAutoTable.finalY + 30;
        if (finalY > 250) { doc.addPage(); finalY = 40; }
        doc.setFontSize(11); doc.text(`Fait à ${DB.config.city || "SJI"}, le ${new Date().toLocaleDateString()}`, 140, finalY, { align: 'center' });
        doc.setFont("helvetica", "bold"); doc.text(DB.config.director.civ || "Le Chef", 140, finalY + 5, { align: 'center' });
        doc.text(DB.config.director.name || "", 140, finalY + 10, { align: 'center' });
        if (DB.config.signature) {
            try {
                const imgProps = doc.getImageProperties(DB.config.signature);
                const ratio = imgProps.width / imgProps.height;
                doc.addImage(DB.config.signature, 'PNG', 120, finalY + 15, 20 * ratio, 20);
            } catch (e) { }
        }
    });

    doc.save("Convocations_Profs_Details.pdf");
};

// --- MODULE LOGISTIQUE & ANONYMAT (CORRIGÉ & SYNCHRONISÉ) ---

// 1. Générer les codes (Format DNB2026-IndexClasse-YY) ET Synchroniser
window.generateAnonymityCodes = function () {
    if (DB.students.length === 0) return showToast("Aucun élève dans la base.", 'error');

    // CORRECTION 1 : On définit l'année AVANT d'afficher le message
    const year = DB.config.year || "2026";

    // CORRECTION 2 : Le message d'alerte est maintenant dynamique (DNB${year})
    showConfirm(`Générer les codes d'anonymat ?\n\nFormat : DNB${year}-[N°Classe]-[Aléatoire]\n(Ex: 3A=1, 3B=2...)\n\n- OK : Tout écraser et régénérer\n- Annuler : Ne rien faire`, () => {

    let count = 0;

    // A. Identifier les classes pour l'index (3A=1, 3B=2...)
    const uniqueClasses = [...new Set(DB.students.map(s => s.classe).filter(c => c))].sort();
    let classMap = {};
    uniqueClasses.forEach((cls, index) => { classMap[cls] = index + 1; });

    // B. Générer les codes dans la liste principale
    const existingCodes = new Set();
    DB.students.forEach(s => {
        const classIndex = classMap[s.classe] || 0;
        let newCode;

        // Génération unique pour éviter les doublons
        do {
            const num = Math.floor(Math.random() * 100).toString().padStart(2, '0'); // 00 à 99
            newCode = `DNB${year}-${classIndex}-${num}`;
        } while (existingCodes.has(newCode));

        s.anonymat = newCode;
        existingCodes.add(newCode);
        count++;
    });

    // C. SYNCHRONISATION CRITIQUE (Transférer les codes vers les salles)
    Object.keys(DB.distribution).forEach(roomName => {
        if (DB.distribution[roomName]) {
            DB.distribution[roomName].forEach(studentInRoom => {
                // On retrouve l'élève original par son ID
                const original = DB.students.find(s => s.id === studentInRoom.id);
                if (original) {
                    studentInRoom.anonymat = original.anonymat; // On copie le code
                }
            });
        }
    });

    renderStudents(); // Mise à jour tableau des élèves
    showToast(`✅ Succès : ${count} codes générés et synchronisés.`, 'success');

    if (typeof autoSave === 'function') autoSave();

    });
}

// 2. Export Liste Secrétariat (VERSION VISUELLE MODERNE)
function exportAnonymityList() {
    if (DB.students.length === 0) return showToast("Aucun élève.", 'error');

    // --- A. CRÉATION DE LA POP-UP VISUELLE ---

    // 1. L'arrière-plan sombre
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0'; overlay.style.left = '0';
    overlay.style.width = '100%'; overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.6)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';

    // 2. La fenêtre blanche
    const modal = document.createElement('div');
    modal.style.backgroundColor = 'white';
    modal.style.padding = '30px';
    modal.style.borderRadius = '12px';
    modal.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
    modal.style.textAlign = 'center';
    modal.style.maxWidth = '600px';
    modal.style.width = '90%';
    modal.style.fontFamily = 'Helvetica, sans-serif';

    // 3. Titre
    const title = document.createElement('h3');
    title.innerText = "📄 Choisir le format de la liste";
    title.style.color = '#1f3a5c';
    title.style.marginTop = '0';
    modal.appendChild(title);

    // Fonction pour créer une "Carte Bouton"
    function createOptionCard(emoji, titleText, subText, color, onClick) {
        const card = document.createElement('div');
        card.style.flex = '1';
        card.style.padding = '20px';
        card.style.border = '2px solid #ece9e0';
        card.style.borderRadius = '10px';
        card.style.cursor = 'pointer';
        card.style.transition = 'all 0.2s';
        card.style.backgroundColor = '#faf9f6';

        card.innerHTML = `
                <div style="font-size:40px; margin-bottom:10px;">${emoji}</div>
                <div style="font-weight:bold; color:${color}; font-size:16px;">${titleText}</div>
                <div style="font-size:12px; color:#656d70; margin-top:5px;">${subText}</div>
            `;

        // Effet Hover
        card.onmouseenter = () => { card.style.borderColor = color; card.style.backgroundColor = 'white'; card.style.transform = 'translateY(-3px)'; card.style.boxShadow = '0 5px 15px rgba(0,0,0,0.1)'; };
        card.onmouseleave = () => { card.style.borderColor = '#ece9e0'; card.style.backgroundColor = '#faf9f6'; card.style.transform = 'translateY(0)'; card.style.boxShadow = 'none'; };

        card.onclick = () => {
            document.body.removeChild(overlay); // Fermer la pop-up
            onClick(); // Lancer l'action
        };

        return card;
    }

    // --- B. DEFINITION DES ACTIONS PDF ---

    // Action 1 : PDF Global
    const actionGlobal = () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        printHeader(doc, " - GLOBALE (A-Z)");

        // Tri de tous les élèves par Nom
        const sortedStudents = [...DB.students].sort((a, b) => a.nom.localeCompare(b.nom));
        const body = sortedStudents.map(s => [s.classe, s.nom, s.prenom, s.anonymat || "---"]);

        generateTable(doc, body);
        doc.save("Liste_Anonymat_Globale.pdf");
    };

    // Action 2 : PDF Par Classe
    const actionClass = () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const classes = [...new Set(DB.students.map(s => s.classe).filter(c => c))].sort();

        classes.forEach((cls, index) => {
            if (index > 0) doc.addPage();
            printHeader(doc, ` - CLASSE ${cls}`);

            const classStudents = DB.students.filter(s => s.classe === cls).sort((a, b) => a.nom.localeCompare(b.nom));
            const body = classStudents.map(s => [s.classe, s.nom, s.prenom, s.anonymat || "---"]);

            generateTable(doc, body);
        });
        doc.save("Liste_Anonymat_Par_Classe.pdf");
    };

    // Objectif helpers PDF:
    function printHeader(doc, titleSuffix) {
        doc.setFontSize(16); doc.setTextColor(44, 62, 80); doc.setFont("helvetica", "bold");
        doc.text(`Liste d'Anonymat${titleSuffix}`, 14, 20);
        doc.setFontSize(11); doc.setTextColor(100); doc.setFont("helvetica", "normal");
        doc.text(`Session ${DB.config.year} - ${DB.config.schoolName}`, 14, 28);
    }
    function generateTable(doc, body) {
        doc.autoTable({
            head: [['Classe', 'Nom', 'Prénom', 'Code Anonymat']],
            body: body, startY: 35, theme: 'grid', headStyles: { fillColor: [52, 73, 94] },
            columnStyles: { 3: { fontStyle: 'bold', textColor: [192, 57, 43], cellWidth: 50 } }
        });
    }

    // Action 3 : Excel Global
    const actionGlobalXLSX = () => {
        const sortedStudents = [...DB.students].sort((a, b) => a.nom.localeCompare(b.nom));
        const data = [["Classe", "Nom", "Prénom", "Code Anonymat"]];
        sortedStudents.forEach(s => data.push([s.classe, s.nom, s.prenom, s.anonymat || "---"]));
        const ws = XLSX.utils.aoa_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Anonymat_Global");
        XLSX.writeFile(wb, "Liste_Anonymat_Globale.xlsx");
    };

    // Action 4 : Excel Par Classe
    const actionClassXLSX = () => {
        const wb = XLSX.utils.book_new();
        const classes = [...new Set(DB.students.map(s => s.classe).filter(c => c))].sort();
        classes.forEach(cls => {
            const classStudents = DB.students.filter(s => s.classe === cls).sort((a, b) => a.nom.localeCompare(b.nom));
            const data = [["Classe", "Nom", "Prénom", "Code Anonymat"]];
            classStudents.forEach(s => data.push([s.classe, s.nom, s.prenom, s.anonymat || "---"]));
            const ws = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, `Classe_${cls}`);
        });
        XLSX.writeFile(wb, "Liste_Anonymat_Par_Classe.xlsx");
    };

    // --- C. ASSEMBLAGE ---

    const btnContainer1 = document.createElement('div');
    btnContainer1.style.display = 'flex';
    btnContainer1.style.gap = '20px';
    btnContainer1.style.marginTop = '25px';
    btnContainer1.style.justifyContent = 'center';

    const btnContainer2 = document.createElement('div');
    btnContainer2.style.display = 'flex';
    btnContainer2.style.gap = '20px';
    btnContainer2.style.marginTop = '15px';
    btnContainer2.style.justifyContent = 'center';

    const btnGlobal = createOptionCard("🌍", "Alpha (PDF)", "Toute l'école de A à Z", "#1f3a5c", actionGlobal);
    const btnClass = createOptionCard("📚", "Par Classe (PDF)", "Trié par classe (1 page/classe)", "#2f6f5e", actionClass);

    const btnGlobalXLSX = createOptionCard("🌍", "Alpha (Excel)", "Toute l'école de A à Z", "#6b4a72", actionGlobalXLSX);
    const btnClassXLSX = createOptionCard("📚", "Par Classe (Excel)", "Trié par classe", "#9a7a2e", actionClassXLSX);

    btnContainer1.appendChild(btnGlobal);
    btnContainer1.appendChild(btnClass);

    btnContainer2.appendChild(btnGlobalXLSX);
    btnContainer2.appendChild(btnClassXLSX);

    modal.appendChild(btnContainer1);
    modal.appendChild(btnContainer2);

    // Bouton Annuler (texte discret)
    const btnCancel = document.createElement('div');
    btnCancel.innerText = "Annuler";
    btnCancel.style.marginTop = "20px";
    btnCancel.style.color = "#9aa0a2";
    btnCancel.style.cursor = "pointer";
    btnCancel.style.fontSize = "14px";
    btnCancel.style.textDecoration = "underline";
    btnCancel.onclick = () => document.body.removeChild(overlay);
    modal.appendChild(btnCancel);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}
// =========================================================
// === MODULE ETIQUETTES (V5 - UI MODERNE "BRIQUES") ===
// =========================================================

// 1. Ouvre la fenêtre de configuration avec la nouvelle UI
function openLabelConfig(type) {
    if (!DB.students || DB.students.length === 0) return showToast("Aucun élève dans la base.", 'error');

    // Sécurité Anonymat
    if (type === 'anonymat') {
        const hasCodes = DB.students.some(s => s.anonymat && s.anonymat.length > 0);
        if (!hasCodes) {
            showAlertModal("⚠️ Action impossible : Codes non générés.\n\n👉 Cliquez d'abord sur '🎲 Générer Codes'.", 'warning');
            return;
        }
    }

    const isTable = (type === 'table');
    let title = isTable ? "🏷️ Étiquettes de Table" : "✂️ Étiquettes de Copies";
    let defCols = isTable ? 2 : 3;
    let defRows = isTable ? 4 : 8;

    // --- ÉTAT INITIAL DE L'INTERFACE ---
    // On stocke les choix de l'utilisateur ici
    let uiState = {
        qty: 'single',      // 'single' ou 'exams'
        group: 'student',   // 'student' ou 'subject'
        sort: isTable ? 'room' : 'alpha' // 'alpha' ou 'room'
    };

    // --- STYLES CSS POUR LES BRIQUES ---
    // Style inactif (gris)
    const sBrick = "flex:1; padding:15px 10px; border:2px solid #e3dfd3; background:#faf9f6; border-radius:8px; cursor:pointer; text-align:center; transition:all 0.2s ease; color:#656d70;";
    // Style actif (bleu, en relief)
    const sBrickActive = "flex:1; padding:15px 10px; border:2px solid #1f3a5c; background:#eef2f0; border-radius:8px; cursor:pointer; text-align:center; transition:all 0.2s ease; color:#1f3a5c; font-weight:bold; box-shadow:0 4px 8px rgba(52, 152, 219, 0.2); transform:translateY(-2px);";

    // --- CONSTRUCTION DU HTML DE LA MODALE ---
    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; display:flex; justify-content:center; align-items:center;";

    const modal = document.createElement('div');
    // Modale un peu plus large pour accueillir les briques
    modal.style.cssText = "background:white; border-radius:12px; width:420px; font-family:'Segoe UI', sans-serif; box-shadow:0 15px 40px rgba(0,0,0,0.3); overflow:hidden; display:flex; flex-direction:column; max-height:95vh;";

    let contentHtml = `
        <div style="background:#1f3a5c; color:white; padding:15px; text-align:center;">
            <h3 style="margin:0; font-size:1.2rem;">${title}</h3>
        </div>
        <div style="padding:20px; overflow-y:auto; background:#f3f1ea;">
    `;

    if (!isTable) {
        // --- SECTION 1 : QUANTITÉ (Anonymat uniquement) ---
        contentHtml += `
            <div style="margin-bottom:20px;">
                <label style="font-weight:bold; color:#23282a; display:block; margin-bottom:10px;">1. Quantité d'étiquettes :</label>
                <div style="display:flex; gap:10px;">
                    <div id="brick-qty-single" style="${sBrickActive}">
                        <div style="font-size:1.4rem;">👤</div>
                        <div>Une seule<br><small style="font-weight:normal">Par élève</small></div>
                    </div>
                    <div id="brick-qty-exams" style="${sBrick}">
                        <div style="font-size:1.4rem;">📚</div>
                        <div>Par Épreuve<br><small style="font-weight:normal">${DB.exams.length} matières</small></div>
                    </div>
                </div>
            </div>

            <div id="section-group" style="margin-bottom:20px; display:none; padding-left:15px; border-left:3px solid #1f3a5c; animation:fadeIn 0.3s;">
                <label style="font-weight:bold; color:#1f3a5c; display:block; margin-bottom:10px;">↳ Option de Regroupement :</label>
                <div style="display:flex; gap:10px;">
                    <div id="brick-group-student" style="${sBrickActive}">
                        <div style="font-size:1.2rem;">👨‍🎓</div>
                        <div>Par Candidat<br><small style="font-weight:normal">Toutes ses matières à la suite</small></div>
                    </div>
                    <div id="brick-group-subject" style="${sBrick}">
                        <div style="font-size:1.2rem;">📂</div>
                        <div>Par Épreuve<br><small style="font-weight:normal">Groupé par matière (Saut de page)</small></div>
                    </div>
                </div>
            </div>
        `;
    }

    // --- SECTION 2 : TRI ---
    contentHtml += `
        <div style="margin-bottom:20px;">
            <label style="font-weight:bold; color:#23282a; display:block; margin-bottom:10px;">${isTable ? '1.' : '2.'} Organisation du tri :</label>
            <div style="display:flex; gap:10px;">
                <div id="brick-sort-alpha" style="${uiState.sort === 'alpha' ? sBrickActive : sBrick}">
                    <div style="font-size:1.4rem;">🇦.🇿</div>
                    <div>Global<br><small style="font-weight:normal">Alphabétique</small></div>
                </div>
                <div id="brick-sort-room" style="${uiState.sort === 'room' ? sBrickActive : sBrick}">
                    <div style="font-size:1.4rem;">🏫</div>
                    <div>Par Salle<br><small style="font-weight:normal">Selon répartition</small></div>
                </div>
            </div>
        </div>
    `;

    // --- SECTION GRILLE ---
    contentHtml += `
        <div style="background:white; padding:15px; border-radius:8px; border:1px solid #e3dfd3; display:flex; justify-content:space-between; align-items:center;">
            <div><span style="font-weight:bold; color:#4b5254;">📏 Grille (A4)</span></div>
            <div style="display:flex; gap:10px;">
                <div style="text-align:center;"><small>Colonnes</small><br><input type="number" id="lblCols" value="${defCols}" min="1" max="5" style="width:45px; text-align:center; padding:5px; border:1px solid #d8d4c8; border-radius:4px;"></div>
                <div style="text-align:center;"><small>Lignes</small><br><input type="number" id="lblRows" value="${defRows}" min="1" max="20" style="width:45px; text-align:center; padding:5px; border:1px solid #d8d4c8; border-radius:4px;"></div>
            </div>
        </div>
        </div> <div style="padding:15px; background:white; border-top:1px solid #ece9e0; display:flex; gap:10px;">
            <button id="btnCan" class="btn btn-secondary" style="flex:1; padding:10px;">Annuler</button>
            <button id="btnGen" class="btn btn-success" style="flex:2; padding:10px; font-size:1.1rem; font-weight:bold;">🖨️ Générer PDF</button>
        </div>
    `;

    modal.innerHTML = contentHtml;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // --- LOGIQUE D'INTERACTION (RAFRAÎCHISSEMENT DE L'UI) ---
    function refreshUI() {
        if (isTable) return; // Pas besoin pour les tables

        // 1. Gestion des briques Quantité
        document.getElementById('brick-qty-single').style.cssText = (uiState.qty === 'single') ? sBrickActive : sBrick;
        document.getElementById('brick-qty-exams').style.cssText = (uiState.qty === 'exams') ? sBrickActive : sBrick;

        // 2. Affichage conditionnel de la section Regroupement
        const groupSection = document.getElementById('section-group');
        if (uiState.qty === 'exams') {
            groupSection.style.display = 'block';
            // Mise à jour des briques Regroupement
            document.getElementById('brick-group-student').style.cssText = (uiState.group === 'student') ? sBrickActive : sBrick;
            document.getElementById('brick-group-subject').style.cssText = (uiState.group === 'subject') ? sBrickActive : sBrick;
        } else {
            groupSection.style.display = 'none';
        }
    }

    // Fonction générique pour gérer le clic sur une brique de tri
    function handleSortClick(mode) {
        uiState.sort = mode;
        document.getElementById('brick-sort-alpha').style.cssText = (mode === 'alpha') ? sBrickActive : sBrick;
        document.getElementById('brick-sort-room').style.cssText = (mode === 'room') ? sBrickActive : sBrick;
    }

    // --- ATTACHEMENT DES ÉVÉNEMENTS (CLICS) ---
    if (!isTable) {
        document.getElementById('brick-qty-single').onclick = () => { uiState.qty = 'single'; refreshUI(); };
        document.getElementById('brick-qty-exams').onclick = () => { uiState.qty = 'exams'; refreshUI(); };
        document.getElementById('brick-group-student').onclick = () => { uiState.group = 'student'; refreshUI(); };
        document.getElementById('brick-group-subject').onclick = () => { uiState.group = 'subject'; refreshUI(); };
    }

    document.getElementById('brick-sort-alpha').onclick = () => handleSortClick('alpha');
    document.getElementById('brick-sort-room').onclick = () => handleSortClick('room');

    // Boutons footer
    document.getElementById('btnCan').onclick = () => document.body.removeChild(overlay);
    document.getElementById('btnGen').onclick = () => {
        const c = parseInt(document.getElementById('lblCols').value) || defCols;
        const r = parseInt(document.getElementById('lblRows').value) || defRows;

        // Préparation des paramètres pour la génération
        let params = {
            qtyMode: uiState.qty,
            sortMode: uiState.sort,
            groupMode: uiState.group
        };

        document.body.removeChild(overlay);
        // Petit délai pour laisser la UI se fermer
        setTimeout(() => generateLabelsPDF(type, c, r, params), 50);
    };

    // Initialisation visuelle au lancement
    refreshUI();
}

// 2. Génération du PDF (Moteur V5 - Identique fonctionnellement à la V4)
function generateLabelsPDF(type, nbCols, nbRows, params) {
    if (!window.jspdf) return showToast("Erreur : librairie PDF non chargée.", 'error');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const items = [];

    // --- HELPER AJOUT ---
    function addItem(s, roomName, subject = null) {
        if (type === 'anonymat') {
            if (s.anonymat) {
                items.push({
                    type: 'anonymat',
                    l1: "DNB " + (DB.config.year || "2026"),
                    l2: s.anonymat,
                    subject: subject,
                    room: roomName
                });
            }
        } else {
            items.push({
                type: 'table',
                l1: `DNB ${DB.config.year || "2026"} - ${roomName}`,
                l2: `${s.nom} ${s.prenom}`,
                l3: `Classe : ${s.classe}`,
                room: roomName,
                isCode: !!s.anonymat,
                code: s.anonymat
            });
        }
    }

    // --- TRAITEMENT LISTE ---
    function processStudentList(studentList, roomName) {
        if (params.qtyMode === 'single') {
            studentList.forEach(s => addItem(s, roomName));
        }
        else if (params.qtyMode === 'exams') {
            if (params.groupMode === 'student') {
                studentList.forEach(s => {
                    DB.exams.forEach(ex => addItem(s, roomName, ex.name));
                });
            }
            else if (params.groupMode === 'subject') {
                DB.exams.forEach(ex => {
                    studentList.forEach(s => addItem(s, roomName, ex.name));
                    items.push({ type: 'BREAK', room: roomName });
                });
            }
        }
    }

    // --- LOGIQUE DE TRI ---
    if (type === 'table' || (type === 'anonymat' && params.sortMode === 'room')) {
        const hasDistrib = DB.distribution && Object.keys(DB.distribution).length > 0;
        if (hasDistrib) {
            Object.keys(DB.distribution).sort().forEach(room => {
                const list = DB.distribution[room].sort((a, b) => a.nom.localeCompare(b.nom));
                processStudentList(list, room);
                if (items.length > 0 && items[items.length - 1].type !== 'BREAK') items.push({ type: 'BREAK', room: room });
            });
        } else {
            const list = [...DB.students].sort((a, b) => a.nom.localeCompare(b.nom));
            processStudentList(list, "---");
        }
    } else {
        const list = [...DB.students].sort((a, b) => a.nom.localeCompare(b.nom));
        processStudentList(list, "Toutes Salles");
    }

    if (items.length === 0) return showToast("Rien à imprimer !", 'warning');

    // --- IMPRESSION ---
    const m = 10;
    const boxW = (210 - 2 * m) / nbCols;
    const boxH = (297 - 2 * m) / nbRows;
    const perPage = nbCols * nbRows;

    let idxPage = 0;
    let currentRoom = null;
    let currentSubject = null;

    while (items.length > 0 && items[items.length - 1].type === 'BREAK') items.pop();

    items.forEach((item, i) => {
        if (item.type === 'BREAK') {
            idxPage = perPage; return;
        }

        let newPage = false;
        if (idxPage >= perPage) newPage = true;
        if ((params.sortMode === 'room' || type === 'table') && item.room !== currentRoom) {
            if (currentRoom !== null) newPage = true;
        }

        if (i === 0 || newPage) {
            if (i > 0) doc.addPage();
            idxPage = 0;
            currentRoom = item.room;
            currentSubject = item.subject;

            doc.setFontSize(8); doc.setTextColor(150);
            let header = (type === 'table') ? `Salle : ${currentRoom}` : ((params.sortMode === 'room') ? `Salle : ${currentRoom}` : "Global Alpha");
            if (params.qtyMode === 'exams' && params.groupMode === 'subject' && currentSubject) header += ` - Épreuve : ${currentSubject}`;
            doc.text(header, m, 5);
        }

        const col = idxPage % nbCols;
        const row = Math.floor(idxPage / nbCols);
        const x = m + col * boxW;
        const y = m + row * boxH;
        const cx = x + boxW / 2;
        const cy = y + boxH / 2;

        doc.setDrawColor(200); doc.setLineWidth(0.1); doc.setLineDash([2, 2]);
        doc.rect(x, y, boxW, boxH); doc.setLineDash([]);
        doc.setTextColor(0);

        if (type === 'anonymat') {
            doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
            doc.text(item.l1, cx, y + 10, { align: 'center' });

            doc.setFontSize(22); doc.setFont("courier", "bold"); doc.setTextColor(0);
            doc.text(item.l2, cx, cy + 2, { align: 'center' });

            if (item.subject) {
                doc.setFillColor(241, 242, 246); doc.rect(x + 5, y + boxH - 14, boxW - 10, 9, 'F');
                doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(44, 62, 80);
                doc.text(item.subject, cx, y + boxH - 7, { align: 'center' });
            }
        } else {
            doc.setFontSize(8); doc.setTextColor(100);
            doc.text(item.l1, cx, y + 8, { align: 'center' });
            doc.setFontSize(14); doc.setTextColor(0); doc.setFont("helvetica", "bold");
            doc.text(doc.splitTextToSize(item.l2, boxW - 4), cx, cy, { align: 'center' });
            doc.setFontSize(10); doc.setFont("helvetica", "normal");
            doc.text(item.l3, cx, cy + 8, { align: 'center' });
            if (item.isCode) {
                doc.setFont("courier", "bold"); doc.setTextColor(192, 57, 43); doc.setFontSize(10);
                doc.text(item.code, x + boxW - 2, y + boxH - 2, { align: 'right' });
            }
        }
        idxPage++;
    });

    doc.save(`Etiquettes_${type}.pdf`);
}

function saveGlobalData() {
    const d = new Date();
    const fn = `${d.getFullYear()} ${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getDate().toString().padStart(2, '0')} - Sauvegarde DNB.data`;
    const a = document.createElement('a');
    a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(DB));
    a.download = fn;
    a.click();

    // RESET DE L'ALERTE
    firstUnsavedTime = null;
    updateSaveButtonStatus(); // Arrête le clignotement
    showToast("✅ Projet exporté avec succès !", 'success');
}

// Fonction qui vérifie le temps écoulé et change le style du bouton
function updateSaveButtonStatus() {
    const btn = document.getElementById('btnGlobalSave');
    if (!btn) return;

    if (firstUnsavedTime !== null && (Date.now() - firstUnsavedTime > SAVE_ALERT_DELAY)) {
        // Ça fait plus de 10 min
        if (!btn.classList.contains('btn-alert-save')) {
            btn.classList.add('btn-alert-save');
            btn.innerHTML = "⚠️ Sauvegarde Requise !";
            btn.title = "Dernier export fichier il y a plus de 10 minutes";
        }
    } else {
        // Tout va bien
        btn.classList.remove('btn-alert-save');
        btn.innerHTML = "💾 Sauvegarder Projet";
        btn.title = "";
    }
}

// Vérification régulière (toutes les minutes)
setInterval(updateSaveButtonStatus, 60000);

// Vérification immédiate au cas où
function checkSaveStatus() {
    // Si on vient de modifier, on vérifie dans SAVE_ALERT_DELAY ms
    setTimeout(updateSaveButtonStatus, SAVE_ALERT_DELAY + 1000);
}

function loadGlobalData(file, onLoaded) {
    const f = file instanceof File ? file : document.getElementById('loadInput').files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => {
        try {
            DB = JSON.parse(e.target.result);

            // --- DATA REPAIR (Legacy Support) ---
            // Assign IDs to Teachers & Rooms if missing (Legacy files usually rely on index/name)
            if (DB.teachers && Array.isArray(DB.teachers)) {
                DB.teachers.forEach((t, i) => { if (!t.id) t.id = "T" + (Date.now() + i); });
            }
            if (DB.rooms && Array.isArray(DB.rooms)) {
                DB.rooms.forEach((r, i) => { if (!r.id) r.id = "R" + (Date.now() + i); });
            }
            // ------------------------------------

            // MIGRATION / SÉCURITÉ ORAUX STAGE
            if (!DB.stage) {
                DB.stage = {
                    config: { date: "2026-06-01", start: "08:00", end: "17:00", duration: 20, break: 0, lunchStart: "12:00", lunchEnd: "13:30" },
                    juries: [],
                    planning: []
                };
            }
            // Ensure DB.edt is initialized
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

            // --- MIGRATION LEGACY (Sauvegarde Utilisateur) ---
            if (DB.oralJuries && Array.isArray(DB.oralJuries) && DB.oralJuries.length > 0) {
                console.log("♻️ Migration des données orales détectée...");

                // Helpers locaux pour migration sûre
                const timeToMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
                const minToTime = min => {
                    let h = Math.floor(min / 60);
                    let m = min % 60;
                    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
                };

                // 1. Config
                if (DB.config.oralDate) DB.stage.config.date = DB.config.oralDate;
                if (DB.config.oralStart) DB.stage.config.start = DB.config.oralStart;
                if (DB.config.oralEnd) DB.stage.config.end = DB.config.oralEnd;
                if (DB.config.oralDuration) DB.stage.config.duration = parseInt(DB.config.oralDuration);

                // 2. Juries & Planning
                DB.stage.juries = [];
                DB.stage.planning = [];

                DB.oralJuries.forEach((oldJ, idx) => {
                    // Création du Jury
                    let newJury = {
                        id: oldJ.id || Date.now() + idx,
                        name: "Jury " + (idx + 1),
                        room: "",
                        members: []
                    };

                    // Mapping Salle (Nom -> ID)
                    if (oldJ.room) {
                        let roomObj = DB.rooms.find(r => r.nom === oldJ.room);
                        if (roomObj) newJury.room = roomObj.id;
                    }

                    // Mapping Profs (Nom -> ID)
                    if (oldJ.teachers && Array.isArray(oldJ.teachers)) {
                        oldJ.teachers.forEach(tName => {
                            if (!tName.trim()) return;
                            // Recherche approximative nom/prenom
                            let tObj = DB.teachers.find(t => (t.nom + " " + t.prenom).includes(tName.trim()) || tName.includes(t.nom));
                            if (tObj) newJury.members.push(tObj.id);
                        });
                    }
                    DB.stage.juries.push(newJury);

                    // Mapping Elèves -> Planning (Generation des heures)
                    if (oldJ.students && Array.isArray(oldJ.students)) {
                        let cursorMin = timeToMin(DB.stage.config.start);
                        const dur = DB.stage.config.duration;
                        const pause = DB.stage.config.break || 0;
                        // Helper simple pour l'heure
                        // Note: On ne gère pas la pause dej ici pour la migration brutale, on séquence juste.

                        oldJ.students.forEach(st => {
                            // Retrouver l'ID élève réel dans DB.students (les IDs peuvent avoir changé ou être identiques)
                            // On préfère matcher par ID si possible, sinon Nom/Prénom
                            let realStudent = DB.students.find(s => s.id == st.id);
                            if (!realStudent) {
                                realStudent = DB.students.find(s => s.nom === st.nom && s.prenom === st.prenom);
                            }

                            if (realStudent) {
                                DB.stage.planning.push({
                                    juryId: newJury.id,
                                    studentId: realStudent.id,
                                    time: minToTime(cursorMin)
                                });
                                cursorMin += dur + pause;
                            }
                        });
                    }
                });

                // Nettoyage pour ne pas re-migrer
                delete DB.oralJuries;
                showToast("✅ Données orales récupérées et converties !", 'success');
            }
            // -----------------------------------------------------

            // Ecrase config si vide
            if (!DB.config.schoolName) DB.config.schoolName = "";

            // REFRESH FULL UI
            renderStageConfigUI(); // Force refresh of Stage Config specifically

            // 1. ON FORCE LE VERROUILLAGE
            DB.uiState = DB.uiState || {};
            if (!DB.uiState.locked) DB.uiState.locked = { students: true, rooms: true, teachers: true, distrib: true, grades: true, simul: true };

            // 2. Initialisation des variables manquantes (sécurité)
            if (DB.config.director) {
                document.getElementById('dirName').value = DB.config.director.name || "";
                setDirectorCiv(DB.config.director.civ || "M. le Principal");
            }
            if (DB.config.nbSurv === undefined) DB.config.nbSurv = 1;
            if (!DB.config.scienceSubjects) DB.config.scienceSubjects = ['SVT', 'PC', 'TECH'];

            // Correction des horaires TT si manquants
            DB.exams.forEach(ex => { if (!ex.timeTT) ex.timeTT = ex.time; });

            // 3. Mise à jour de l'affichage
            renderExamTable();
            checkLogo();
            checkSignature();

            // Mise à jour visuelle des cadenas
            updateLockUI('students'); updateLockUI('rooms'); updateLockUI('teachers'); updateDistribLock(); updateLockUI('grades'); updateLockUI('simul');

            // Mise à jour des autres sections
            renderVisualDistribution();

            // Remplissage des champs de configuration
            if (DB.config.director) {
                document.getElementById('dirName').value = DB.config.director.name || "";
                const radios = document.getElementsByName('dirCiv');
                for (let r of radios) { if (r.value === DB.config.director.civ) r.checked = true; }
            }
            if (DB.config.schoolName) document.getElementById('schoolName').value = DB.config.schoolName;
            if (DB.config.year) document.getElementById('sessionYear').value = DB.config.year;
            if (DB.config.city) document.getElementById('schoolCity').value = DB.config.city;
            // Mise à jour des cases à cocher Sciences
            document.getElementById('chkSVT').checked = DB.config.scienceSubjects.includes('SVT');
            document.getElementById('chkPC').checked = DB.config.scienceSubjects.includes('PC');
            document.getElementById('chkTech').checked = DB.config.scienceSubjects.includes('TECH');

            // RESTAURATION MODULE ORAL V2.7 (DB.oralConfig)
            if (typeof setupOralDatabase === 'function') setupOralDatabase();
            if (typeof refreshOralConfigUI === 'function') refreshOralConfigUI();
            if (typeof renderOralTeachersTable === 'function') renderOralTeachersTable();
            if (typeof renderOralStudentsTable === 'function') renderOralStudentsTable();
            // --------------------------------------------------

            showToast("Données chargées et sécurisées !", 'success');
            if (typeof onLoaded === 'function') onLoaded();
        } catch (err) {
            console.error(err);
            showAlertModal("Erreur lors du chargement : " + err.message, 'error');
        }
    };
    r.readAsText(f);
}


// --- EXPORT : FEUILLES DE SAISIE ANONYMES PAR MATIÈRE ---
async function exportAnonymousGradeSheet() {
    if (!DB.students || DB.students.length === 0) return showToast("❌ Aucun élève dans la base.", 'error');
    if (typeof ExcelJS === 'undefined') {
        const script = document.createElement('script');
        script.src = 'js/vendor/exceljs.min.js';   // copie locale (ExcelJS 4.3.0, licence MIT) : plus de dépendance à un CDN
        document.head.appendChild(script);
        await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = () => reject(new Error('ExcelJS introuvable')); });
    }
    const workbook = new ExcelJS.Workbook();
    let subjects = ["Français", "Mathématiques", "HG", "EMC"];
    const activeSciences = DB.config.scienceSubjects || [];
    if (activeSciences.length > 0) {
        subjects = subjects.concat(activeSciences);
    } else {
        subjects.push("Sciences");
    }
    const sortedStudents = [...DB.students]
        .filter(s => s.anonymat)
        .sort((a, b) => a.anonymat.localeCompare(b.anonymat));
    subjects.forEach(subjectName => {
        const sheet = workbook.addWorksheet(subjectName);
        sheet.columns = [
            { header: "Code Anonymat", key: "anonymat", width: 25 },
            { header: `${subjectName}`, key: "note", width: 20 }
        ];
        const headerRow = sheet.getRow(1);
        headerRow.height = 25;
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
        sortedStudents.forEach(s => {
            const row = sheet.addRow({ anonymat: s.anonymat, note: "" });
            row.height = 20;
            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
        });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Bordereaux_Saisie_Par_Matiere.xlsx`;
    anchor.click();
    window.URL.revokeObjectURL(url);
}
