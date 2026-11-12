/* Connexion expérimentale Grist : sauvegardes complètes, explicites et ajoutées sans écrasement. */
(function () {
    if (window === window.parent) return;
    const TABLE = 'OrgaExamSauvegardes';
    const apiScript = document.createElement('script');
    apiScript.src = 'https://docs.getgrist.com/grist-plugin-api.js';
    apiScript.onload = () => {
        const grist = window.grist;
        grist.ready({ requiredAccess: 'full' });
        let connected = new URLSearchParams(window.location.search).get('access') === 'full';
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9000;background:white;color:#20314a;border:1px solid #b7c5d4;border-radius:8px;padding:12px;box-shadow:0 4px 18px #0002;font:14px sans-serif;max-width:340px';
        box.innerHTML = '<strong>Grist — expérimental</strong><p data-status>En attente de l’autorisation Grist…</p><button data-save disabled>Enregistrer dans Grist</button> <button data-load disabled>Charger depuis Grist</button><p><button data-schema disabled>Créer les tables de démonstration</button></p><p style="font-size:12px">Sauvegardes complètes manuelles. Les utilisateurs doivent coordonner leurs modifications.</p>';
        document.body.appendChild(box);
        const status = box.querySelector('[data-status]');
        const save = box.querySelector('[data-save]');
        const load = box.querySelector('[data-load]');
        const schema = box.querySelector('[data-schema]');
        function setStatus(message) { status.textContent = message; }
        save.disabled = load.disabled = schema.disabled = !connected;
        if (connected) setStatus('Accès demandé. Les données restent locales jusqu’à un enregistrement manuel.');
        grist.onOptions((options, interaction) => {
            connected = new URLSearchParams(window.location.search).get('access') === 'full' || (interaction && (interaction.accessLevel || interaction.access_level) === 'full');
            save.disabled = load.disabled = schema.disabled = !connected;
            setStatus(connected ? 'Connecté. Les données restent locales jusqu’à un enregistrement manuel.' : 'Autorise l’accès complet au document de test dans Grist.');
        });
        async function rows() {
            try { return await grist.docApi.fetchTable(TABLE); }
            catch (e) { throw new Error('Table OrgaExamSauvegardes inaccessible. Crée-la avec les colonnes Date_UTC, Libelle et Donnees_JSON (texte). ' + e.message); }
        }
        schema.onclick = async () => {
            schema.disabled = true;
            try { const n = await window.createDnbDemoSchema(grist.docApi); setStatus(n + ' tables créées avec des exemples fictifs.'); }
            catch (e) { setStatus('Création impossible : ' + e.message); }
            finally { schema.disabled = !connected; }
        };
        save.onclick = async () => {
            save.disabled = load.disabled = true;
            try {
                await rows();
                const now = new Date().toISOString();
                await grist.docApi.applyUserActions([['AddRecord', TABLE, null, {
                    Date_UTC: now, Libelle: (DB.config && DB.config.year || '') + ' — sauvegarde manuelle', Donnees_JSON: JSON.stringify(DB)
                }]]);
                setStatus('Sauvegarde ajoutée à Grist : ' + new Date(now).toLocaleString('fr-FR'));
            } catch (e) { setStatus('Échec : ' + e.message); }
            finally { save.disabled = load.disabled = schema.disabled = !connected; }
        };
        load.onclick = async () => {
            save.disabled = load.disabled = true;
            try {
                const t = await rows();
                if (!t.id.length) throw new Error('Aucune sauvegarde dans Grist.');
                const i = t.id.reduce((best, id, idx) => id > t.id[best] ? idx : best, 0);
                const json = t.Donnees_JSON[i];
                const data = JSON.parse(json);
                if (!data || !data.config || !Array.isArray(data.students) || !Array.isArray(data.rooms) || !Array.isArray(data.teachers)) throw new Error('Sauvegarde invalide.');
                showConfirm('Charger la sauvegarde Grist du ' + (t.Date_UTC[i] || 'date inconnue') + ' ? Les données actuellement ouvertes dans l’application seront remplacées. Exporte-les avant si nécessaire.', () => {
                    loadGlobalData(new File([json], 'sauvegarde-grist.data', { type: 'application/json' }));
                    setStatus('Chargement demandé depuis Grist.');
                });
            } catch (e) { setStatus('Échec : ' + e.message); }
            finally { save.disabled = load.disabled = schema.disabled = !connected; }
        };
    };
    apiScript.onerror = () => console.error('Impossible de charger l’API des widgets Grist.');
    document.head.appendChild(apiScript);
})();
