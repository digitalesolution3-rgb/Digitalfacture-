// js/sync.js
// Remplace : firebase_sync.js
// Fournit   : sync offline-first IndexedDB → Supabase, Realtime multi-appareils

const Sync = {
    _channel:  null,
    _pending:  0,
    _syncing:  false,

    // ─── INIT ────────────────────────────────────────────────
    async init(merchantId) {
        if (!merchantId) return;

        // Realtime : nouvelles ventes depuis d'autres appareils
        this._channel = sb
            .channel(`merchant-${merchantId}`)
            .on("postgres_changes", {
                event: "*", schema: "public", table: "sales",
                filter: `merchant_id=eq.${merchantId}`
            }, () => {
                if (typeof mettreAJourStats === "function") mettreAJourStats();
            })
            .subscribe((status) => this._indicateur(status === "SUBSCRIBED"));

        // Sync automatique au retour réseau
        window.addEventListener("online",  () => this._syncPending());
        window.addEventListener("offline", () => this._indicateur(false));

        // Sync initiale
        await this._syncPending();
    },

    // ─── SAUVEGARDER UNE VENTE (offline-first) ───────────────
    async sauvegarderVente(vente) {
        const data = {
            ...vente,
            id:          vente.id || crypto.randomUUID(),
            merchant_id: Auth.getMerchantId(),
            synced:      false,
            created_at:  new Date().toISOString()
        };

        // 1. Toujours écrire en local d'abord
        await OfflineDB.put("ventes_pending", data);

        // 2. Si en ligne → sync immédiate
        if (navigator.onLine) {
            await this._pushVente(data);
        } else {
            this._pending++;
            this._indicateur(false);
            afficherToast("Vente sauvegardée localement (hors ligne)", "info");
        }

        return data;
    },

    // ─── CHARGER HISTORIQUE VENTES ────────────────────────────
    async chargerVentes(filtre = "jour") {
        const mid = Auth.getMerchantId();
        if (!mid) return [];

        let q = sb.from("sales")
            .select("id, numero, created_at, total, statut, paiement, client_nom")
            .eq("merchant_id", mid)
            .order("created_at", { ascending: false })
            .limit(300);

        const now = new Date();
        if (filtre === "jour") {
            q = q.gte("created_at", new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString());
        } else if (filtre === "mois") {
            q = q.gte("created_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
        }

        const { data, error } = await q;
        if (error) return await OfflineDB.getAll("ventes_pending", "merchant_id", mid);
        return data || [];
    },

    // ─── CHARGER STATS ───────────────────────────────────────
    async chargerStats() {
        const mid = Auth.getMerchantId();
        if (!mid) return null;
        const { data } = await sb.from("vue_stats_merchant").select("*").eq("merchant_id", mid).single();
        return data;
    },

    // ─── CHARGER CAISSIERS ───────────────────────────────────
    async chargerCaissiers() {
        const mid = Auth.getMerchantId();
        if (!mid) return [];
        const { data } = await sb.from("profiles")
            .select("id, nom, role, actif, derniere_connexion")
            .eq("merchant_id", mid)
            .in("role", ["caissier", "gerant"])
            .order("nom");
        return data || [];
    },

    // ─── PRIVÉ ───────────────────────────────────────────────
    async _syncPending() {
        if (this._syncing || !navigator.onLine) return;

        const pending = await OfflineDB.getAll("ventes_pending", "synced", false);
        if (!pending.length) return;

        this._syncing = true;
        let ok = 0;

        for (const v of pending) {
            if (await this._pushVente(v)) ok++;
        }

        this._syncing  = false;
        this._pending  = pending.length - ok;

        if (ok > 0) {
            afficherToast(`${ok} vente(s) synchronisée(s) ✓`, "success");
            if (typeof mettreAJourStats === "function") mettreAJourStats();
        }
        this._indicateur(this._pending === 0);
    },

    async _pushVente(vente) {
        try {
            const { synced, ...data } = vente;
            const { error } = await sb.from("sales").upsert(data, { onConflict: "id" });
            if (error) throw error;
            await OfflineDB.put("ventes_pending", { ...vente, synced: true });
            return true;
        } catch (e) {
            console.warn("Sync échoué:", vente.id, e.message);
            return false;
        }
    },

    _indicateur(online) {
        const el = document.getElementById("utilisateursEnLigne");
        if (!el) return;
        if (online && this._pending === 0) {
            el.innerHTML = `<span class="bg-green-700 text-white px-2 py-1 rounded-full text-[8px] font-bold" title="Synchronisé avec le cloud">☁️ Sync</span>`;
        } else if (this._pending > 0) {
            el.innerHTML = `<span class="bg-amber-600 text-white px-2 py-1 rounded-full text-[8px] font-bold" title="${this._pending} en attente">⏳ ${this._pending}</span>`;
        } else {
            el.innerHTML = `<span class="bg-slate-600 text-white px-2 py-1 rounded-full text-[8px] font-bold" title="Hors ligne">📵 Local</span>`;
        }
    }
};
window.Sync = Sync;


// ─── REMPLACEMENT DE validerVente() ──────────────────────────
// Remplace la fonction originale de facture.js
// (la version originale est conservée mais écrasée ici)
async function validerVente(avecPDF = false) {
    const total = parseTotal();
    if (!total || total <= 0) { afficherToast("La facture est vide", "error"); return; }

    const caissier = Auth.getCaissierActif();
    if (!caissier) { afficherToast("Aucun caissier connecté", "error"); return; }

    // Collecter les lignes
    const articles = [];
    document.querySelectorAll("#lignes-facture tr").forEach(tr => {
        const art = tr.querySelector("td:first-child input")?.value?.trim() || "—";
        const qte = parseFloat(tr.querySelector(".qte")?.value) || 0;
        const pu  = parseFloat(tr.querySelector(".pu")?.value)  || 0;
        if (qte > 0 && pu > 0) articles.push({ article: art, qte, pu, total: qte * pu });
    });

    if (!articles.length) { afficherToast("Aucune ligne valide", "error"); return; }

    // Numéro de facture (RPC Supabase ou fallback local)
    let numero = numeroFactureActuel;
    if (navigator.onLine) {
        const { data } = await sb.rpc("next_sale_numero", { p_merchant_id: Auth.getMerchantId() });
        if (data) numero = data;
    }

    const vente = {
        merchant_id: Auth.getMerchantId(),
        caissier_id: caissier.id,
        numero,
        client_nom:  null,
        items:       articles,
        total,
        paiement:    "especes",
        statut:      "validee"
    };

    await Sync.sauvegarderVente(vente);
    sauvegarderDernierNumero(numero);
    mettreAJourStats();
    afficherToast(`✅ Facture ${numero} validée !`, "success");

    // Supprimer ancienne modale si elle existe
    document.getElementById("printModal")?.remove();
    afficherDialogueImpression(avecPDF);
}

function validerEtPDF() { validerVente(true); }

// ─── PARTAGE WHATSAPP ─────────────────────────────────────────
function partagerWhatsApp() {
    const nom    = document.getElementById("factureNom")?.innerText || "";
    const numero = document.getElementById("factureNumero")?.innerText || "";
    const total  = document.getElementById("grandTotal")?.innerText || "0";
    const cfg    = window.MERCHANT?.config;
    const waMsg  = cfg?.wa_message || `Bonjour ! Voici votre facture ${numero} de ${total} F CFA de ${nom}. Merci pour votre achat !`;
    const waNum  = cfg?.wa_message ? "" : "";
    const url    = `https://wa.me/${waNum.replace(/\D/g, "")}?text=${encodeURIComponent(waMsg)}`;
    window.open(url, "_blank");
}
window.partagerWhatsApp = partagerWhatsApp;
