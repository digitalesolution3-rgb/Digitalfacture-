// js/auth.js
// Remplace : CONFIG.ADMIN (PINs en clair) + LICENCE (vérification locale)
// Fournit   : connexion caissier par PIN bcrypt, connexion proprio par email,
//             vérification abonnement serveur, gestion de session offline

const Auth = {
    _merchant:      null,   // Données merchant depuis Supabase
    _caissierActif: null,   // Caissier connecté via PIN
    _session:       null,   // Session Supabase Auth (proprio uniquement)

    // ─── INITIALISATION ──────────────────────────────────────
    // Appelée au démarrage — remplace verifierLicenceDemarrage()
    async init() {
        // Lire le slug depuis l'URL : app.digitalfacture.bf/mon-commerce
        const slug = window.location.pathname.split("/").filter(Boolean)[0];

        if (!slug) {
            this._bloquer("URL invalide. Accédez via votre lien établissement.");
            return false;
        }

        const abo = await AbonnementCheck.verifier(slug);

        if (!abo.valid) {
            this._afficherBlocage(abo);
            return false;
        }

        // Stocker les données merchant
        this._merchant    = abo.merchant;
        window.MERCHANT   = abo.merchant;

        // Mettre à jour le panel abonnement dans le propriétaire
        this._mettreAJourPanelAbo(abo);

        // Appliquer la config merchant (couleur, devise…)
        this._appliquerConfig(abo.merchant?.config);

        // Alertes non bloquantes (expire bientôt / période de grâce)
        if (["GRACE", "EXPIRE_BIENTOT"].includes(abo.statut)) {
            setTimeout(() => afficherToast(abo.message, "warning"), 1500);
        }

        return true;
    },

    // ─── CONNEXION CAISSIER (PIN) ─────────────────────────────
    // Le PIN est vérifié côté PostgreSQL via bcrypt — jamais en clair
    async connexionParPin(pin) {
        if (!this._merchant?.id) return { success: false, message: "Établissement non chargé." };

        const { data, error } = await sb.rpc("verifier_pin", {
            p_merchant_id: this._merchant.id,
            p_pin:         pin
        });

        if (error || !data?.success) {
            return { success: false, message: data?.message || "PIN incorrect." };
        }

        this._caissierActif = { ...data, loginAt: Date.now() };

        // Persister en IndexedDB pour résistance offline
        await OfflineDB.put("session", { key: "caissier", value: this._caissierActif });

        return { success: true, caissier: this._caissierActif };
    },

    // ─── CONNEXION PROPRIÉTAIRE (email + mot de passe) ────────
    async connexionProprietaire(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return { success: false, message: this._erreurAuth(error.message) };

        const { data: profil } = await sb
            .from("profiles")
            .select("id, nom, role, merchant_id, actif")
            .eq("auth_user_id", data.user.id)
            .single();

        if (!profil?.actif) {
            await sb.auth.signOut();
            return { success: false, message: "Compte inactif ou introuvable." };
        }

        this._session = data.session;
        return { success: true, profil };
    },

    // ─── DÉCONNEXION ─────────────────────────────────────────
    async deconnexion() {
        this._caissierActif = null;
        await OfflineDB.delete("session", "caissier");
        if (this._session) {
            await sb.auth.signOut();
            this._session = null;
        }
        window.location.reload();
    },

    // ─── GETTERS ─────────────────────────────────────────────
    getMerchant()      { return this._merchant; },
    getMerchantId()    { return this._merchant?.id || null; },
    getCaissierActif() { return this._caissierActif; },
    estConnecte()      { return !!this._caissierActif || !!this._session; },

    // ─── PRIVÉ ───────────────────────────────────────────────
    _appliquerConfig(cfg) {
        if (!cfg) return;
        if (cfg.devise)        CONFIG.OPTIONS.devise = cfg.devise;
        if (cfg.couleur_theme) document.documentElement.style.setProperty("--couleur-theme", cfg.couleur_theme);
        if (cfg.message_accueil && !CONFIG.ETABLISSEMENT.slogan) CONFIG.ETABLISSEMENT.slogan = cfg.message_accueil;
    },

    _mettreAJourPanelAbo(abo) {
        const m = abo.merchant;
        if (!m) return;
        const setTxt = (id, val) => { const el = document.getElementById(id); if (el && val) el.innerText = val; };
        const statuts = { ACTIF: "✅ Actif", EXPIRE_BIENTOT: "⚠️ Expire bientôt", GRACE: "⚠️ Période de grâce", EXPIRE: "❌ Expiré", SUSPENDU: "🚫 Suspendu" };
        setTxt("aboStatut", statuts[abo.statut] || abo.statut);
        setTxt("aboPlan",   m.plan);
        setTxt("aboExpiry", m.licence_expiry ? new Date(m.licence_expiry).toLocaleDateString("fr-FR") : "—");
        setTxt("aboJours",  abo.joursRestants !== undefined ? `${abo.joursRestants} jour(s)` : "—");
    },

    _bloquer(msg) {
        const el = document.getElementById("loadingScreen");
        if (el) el.innerHTML = `<div class="text-center p-8"><div class="text-5xl mb-4">⚠️</div><p class="text-white font-bold text-lg">${msg}</p></div>`;
    },

    _afficherBlocage(abo) {
        document.getElementById("loadingScreen")?.classList.add("hidden");
        const icons  = { EXPIRE: "⏰", SUSPENDU: "🚫", INCONNU: "⚠️" };
        const titres = { EXPIRE: "Abonnement expiré", SUSPENDU: "Compte suspendu", INCONNU: "Connexion requise" };
        const el = document.getElementById("licenceBlockModal");
        if (el) {
            document.getElementById("licenceBlockIcon").innerText    = icons[abo.statut]  || "🚫";
            document.getElementById("licenceBlockTitre").innerText   = titres[abo.statut] || "Accès bloqué";
            document.getElementById("licenceBlockMessage").innerText = abo.message;
            el.classList.remove("hidden");
        }
    },

    _erreurAuth(msg) {
        const map = {
            "Invalid login credentials": "Email ou mot de passe incorrect",
            "Email not confirmed":        "Email non confirmé. Vérifiez votre boîte mail.",
            "Too many requests":          "Trop de tentatives. Réessayez dans quelques minutes."
        };
        return map[msg] || "Erreur de connexion. Réessayez.";
    }
};
window.Auth = Auth;


// ─── FONCTIONS GLOBALES (compatibilité app.js / facture.js) ──

// Remplace connexionCaissier() de facture.js
async function connexionCaissier() {
    const pin = (document.getElementById("pinInput")?.value || "").trim();
    if (pin.length < 4) {
        afficherToast("PIN : minimum 4 chiffres", "error");
        return;
    }
    const r = await Auth.connexionParPin(pin);
    if (!r.success) {
        afficherToast(r.message, "error");
        document.getElementById("pinInput").value = "";
        document.getElementById("pinInput").focus();
        return;
    }
    window.caissierActif = r.caissier;
    document.getElementById("nomCaissier").innerText = r.caissier.nom;
    document.getElementById("loginCaisseModal").classList.add("hidden");
    document.getElementById("caisseContent").classList.remove("pointer-events-none", "opacity-20");
    afficherToast(`Bienvenue, ${r.caissier.nom} !`, "success");
    initFacture();
    // Démarrer la sync Supabase après connexion
    await Sync.init(Auth.getMerchantId());
}

// Remplace deconnexion() de app.js
async function deconnexion() {
    if (!confirm("Confirmer la déconnexion ? La caisse sera réinitialisée.")) return;
    await Auth.deconnexion();
}

// Ouvre le panel propriétaire (sans PIN — l'accès est géré par Supabase Auth)
function ouvrirPanelProprietaire() {
    document.getElementById("ownerPanel").classList.remove("hidden");
    mettreAJourStats();
    afficherCaissiers();
    filtrerHistorique("jour");
}

// Crée un nouveau caissier via RPC Supabase
async function creerCaissier() {
    const nom = document.getElementById("nouveauCaissierNom")?.value?.trim();
    const tel = document.getElementById("nouveauCaissierTel")?.value?.trim();
    const pin = document.getElementById("nouveauCaissierPin")?.value?.trim();

    if (!nom || !pin) { afficherToast("Nom et PIN requis", "error"); return; }
    if (pin.length < 4) { afficherToast("PIN trop court (min 4 chiffres)", "error"); return; }

    const { data, error } = await sb.rpc("creer_caissier", {
        p_nom:       nom,
        p_pin:       pin,
        p_telephone: tel || null
    });

    if (error || !data?.success) {
        afficherToast(data?.error || error?.message || "Erreur création caissier", "error");
        return;
    }

    afficherToast(`✅ Caissier ${nom} créé !`, "success");
    document.getElementById("modalAjoutCaissier").classList.add("hidden");
    document.getElementById("nouveauCaissierNom").value = "";
    document.getElementById("nouveauCaissierTel").value = "";
    document.getElementById("nouveauCaissierPin").value = "";
    afficherCaissiers();
}

// Ouvre la modal ajout caissier
function ouvrirModalAjoutCaissier() {
    document.getElementById("modalAjoutCaissier").classList.remove("hidden");
    document.getElementById("nouveauCaissierNom").focus();
}

// Ouvre la modal renouvellement abonnement
function ouvrirModalRenouvellement() {
    const merchantId = Auth.getMerchantId() || "???";
    document.getElementById("refPaiement").innerText = `DF-${merchantId.substring(0, 8).toUpperCase()}`;
    document.getElementById("modalRenouvellement").classList.remove("hidden");
}

// Soumettre une demande de renouvellement (statut "en_attente")
async function soumettreRenouvellement() {
    const plan = document.querySelector('input[name="planRenouvellement"]:checked')?.value;
    const montants = { mensuel: 5000, trimestriel: 13500, annuel: 48000 };
    const durees   = { mensuel: 30,   trimestriel: 90,    annuel: 365  };
    const merchantId = Auth.getMerchantId();

    if (!merchantId) { afficherToast("Non connecté à un établissement", "error"); return; }

    const dateFin = new Date();
    dateFin.setDate(dateFin.getDate() + durees[plan]);

    const { error } = await sb.from("abonnements").insert({
        merchant_id: merchantId,
        plan,
        montant:     montants[plan],
        methode:     "orange_money",
        date_debut:  new Date().toISOString(),
        date_fin:    dateFin.toISOString(),
        statut:      "en_attente"
    });

    if (error) { afficherToast("Erreur envoi demande", "error"); return; }

    document.getElementById("modalRenouvellement").classList.add("hidden");
    afficherToast("✅ Demande envoyée ! Validation sous 24h.", "success");
}

// ─── Démarrage ───────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
    await OfflineDB.init();
    const ok = await Auth.init();
    if (ok) demarrerApplication();
});
