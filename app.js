// js/app.js — Application principale (version SaaS Supabase)
// Firebase et LICENCE supprimés — remplacés par Auth + Sync

// Démarrer l'application (appelée par auth.js après validation abonnement)
async function demarrerApplication() {
    document.getElementById("loadingScreen").classList.add("hidden");
    document.getElementById("appContainer").classList.remove("hidden");

    mettreAJourInfosEtablissement();
    mettreAJourDate();

    // Afficher l'établissement dans le modal PIN
    const nomEl = document.getElementById("nomEtablissementLogin");
    if (nomEl) nomEl.innerText = CONFIG.ETABLISSEMENT.nom;

    // Afficher modal connexion caissier
    document.getElementById("loginCaisseModal").classList.remove("hidden");
}

// Mettre à jour date dans l'en-tête de la facture
function mettreAJourDate() {
    const d  = new Date();
    const el = document.getElementById("date-display");
    if (el) {
        el.innerHTML = `
            <span>${String(d.getDate()).padStart(2, "0")}</span>
            <span>${String(d.getMonth() + 1).padStart(2, "0")}</span>
            <span>${d.getFullYear()}</span>
        `;
    }
}

// ─── PANEL PROPRIÉTAIRE ───────────────────────────────────────

function afficherPanelProprietaire() {
    document.getElementById("ownerPanel").classList.remove("hidden");
    mettreAJourStats();
    afficherCaissiers();
    filtrerHistorique("jour");
}
window.afficherPanelProprietaire = afficherPanelProprietaire;

// Stats depuis Supabase (vue_stats_merchant) avec fallback IndexedDB
async function mettreAJourStats() {
    // Essayer Supabase d'abord
    if (navigator.onLine && Auth.getMerchantId()) {
        const stats = await Sync.chargerStats();
        if (stats) {
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.innerText = formaterMontant(val || 0);
            };
            setVal("valJour", stats.ca_jour);
            setVal("valMois", stats.ca_mois);
            setVal("valAn",   stats.ca_annee);
            return;
        }
    }

    // Fallback : IndexedDB local
    const ventes     = await OfflineDB.getAll("ventes_pending", "merchant_id", Auth.getMerchantId());
    const maintenant = new Date();
    let jour = 0, mois = 0, an = 0;

    ventes.forEach(v => {
        if (v.statut === "annulee") return;
        const d = new Date(v.created_at);
        if (d.getFullYear() !== maintenant.getFullYear()) return;
        an += v.total;
        if (d.getMonth() !== maintenant.getMonth()) return;
        mois += v.total;
        if (d.getDate() !== maintenant.getDate()) return;
        jour += v.total;
    });

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = formaterMontant(val);
    };
    setVal("valJour", jour);
    setVal("valMois", mois);
    setVal("valAn",   an);
}

// Afficher liste caissiers depuis Supabase
async function afficherCaissiers() {
    const container = document.getElementById("listeCaissiers");
    if (!container) return;

    container.innerHTML = `<p class="text-slate-500 text-xs text-center py-2">Chargement...</p>`;

    const caissiers = await Sync.chargerCaissiers();

    if (!caissiers.length) {
        container.innerHTML = `<p class="text-slate-500 text-xs text-center py-2">Aucun caissier</p>`;
        return;
    }

    container.innerHTML = caissiers.map(c => `
        <div class="bg-slate-800 p-2 rounded-lg flex justify-between items-center">
            <div>
                <span class="font-bold text-white text-sm">${c.nom}</span>
                <span class="text-slate-500 text-[10px] ml-2 capitalize">${c.role}</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="font-mono text-slate-400 text-[10px]">PIN: ••••</span>
                <span class="text-[8px] px-2 py-0.5 rounded-full ${c.actif ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}">
                    ${c.actif ? "Actif" : "Inactif"}
                </span>
            </div>
        </div>
    `).join("");
}

// Filtrer et afficher l'historique des ventes (depuis Supabase + fallback)
async function filtrerHistorique(periode) {
    // Mettre à jour les boutons
    ["filtreJour", "filtreMois", "filtreTout"].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.className = btn.className.replace("bg-amber-700", "bg-slate-700");
    });
    const btnId = { jour: "filtreJour", mois: "filtreMois", tout: "filtreTout" }[periode];
    const btnActif = document.getElementById(btnId);
    if (btnActif) btnActif.className = btnActif.className.replace("bg-slate-700", "bg-amber-700");

    const container = document.getElementById("historiqueVentes");
    if (!container) return;

    container.innerHTML = `<p class="text-slate-500 text-xs text-center py-2 animate-pulse">Chargement...</p>`;

    const ventes = await Sync.chargerVentes(periode);

    if (!ventes.length) {
        container.innerHTML = `<p class="text-slate-500 text-xs text-center py-4">Aucune vente sur cette période</p>`;
        return;
    }

    container.innerHTML = ventes.map(v => {
        const date  = new Date(v.created_at);
        const heure = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        const jour  = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
        const statut = v.statut === "annulee" ? `<span class="text-red-400 text-[8px]">ANNULÉE</span>` : "";
        return `
            <div class="bg-slate-800 rounded-lg p-2 flex justify-between items-center">
                <div>
                    <span class="text-white font-bold text-xs">${v.numero || "—"}</span>
                    <span class="text-slate-400 text-[10px] ml-2">${jour} ${heure}</span>
                    ${statut}
                </div>
                <span class="text-green-400 font-black text-xs whitespace-nowrap">
                    ${(v.total || 0).toLocaleString("fr-FR")} F
                </span>
            </div>
        `;
    }).join("");
}

// Exporter CSV depuis Supabase
async function exporterCSV() {
    const ventes = await Sync.chargerVentes("tout");
    if (!ventes.length) { afficherToast("Aucune vente à exporter", "warning"); return; }

    const lignes = [["Numéro", "Date", "Heure", "Montant (F CFA)", "Mode paiement", "Statut"].join(";")];

    ventes.forEach(v => {
        const d     = new Date(v.created_at);
        const date  = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
        const heure = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        lignes.push([v.numero || "—", date, heure, v.total || 0, v.paiement || "—", v.statut || "—"].join(";"));
    });

    const csv  = "\uFEFF" + lignes.join("\n");
    const blob = new Blob([csv], { type: "text/csv; charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `ventes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    afficherToast(`✅ ${ventes.length} ventes exportées`, "success");
}

// ─── INITIALISATION AU CHARGEMENT ────────────────────────────
window.addEventListener("load", () => {
    // Mettre à jour date toutes les minutes
    setInterval(mettreAJourDate, 60000);

    // Touche Entrée sur le PIN caissier
    const pinInput = document.getElementById("pinInput");
    if (pinInput) {
        pinInput.addEventListener("keydown", e => { if (e.key === "Enter") connexionCaissier(); });
        pinInput.addEventListener("focus",   ()  => pinInput.select());
    }
});

// ─── EXPORTS ─────────────────────────────────────────────────
window.demarrerApplication  = demarrerApplication;
window.mettreAJourDate      = mettreAJourDate;
window.mettreAJourStats     = mettreAJourStats;
window.afficherCaissiers    = afficherCaissiers;
window.filtrerHistorique    = filtrerHistorique;
window.exporterCSV          = exporterCSV;
