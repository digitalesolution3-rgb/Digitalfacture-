// config.js — Configuration VISUELLE de l'établissement
// ⚠️  Ce fichier contient uniquement les infos d'affichage.
//     Les PINs, l'authentification et la licence sont gérés par Supabase.
//     Ne jamais mettre de mots de passe ou clés secrètes ici.

const CONFIG = {
    VERSION: "3.0.0",  // DigitalFacture Pro SaaS

    DEV_MODE: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',

    // ─── INFOS ÉTABLISSEMENT ─────────────────────────────────
    // Ces infos s'affichent sur la facture et dans le header.
    // En production SaaS, elles sont automatiquement chargées
    // depuis Supabase (merchants + configs). Ces valeurs servent
    // de fallback si Supabase n'est pas encore configuré.
    ETABLISSEMENT: {
        nom:       "MON COMMERCE",
        activite:  "COMMERCE GÉNÉRAL",
        telephone: "+226 XX XX XX XX",
        adresse:   "Avenue de la Liberté",
        ville:     "OUAGADOUGOU",
        email:     "",
        site:      "",
        rc:        "",
        nif:       "",
        logo:      "",
        slogan:    "La qualité au meilleur prix"
    },

    // ─── CONFIGURATION FACTURE ────────────────────────────────
    FACTURE: {
        prefix:          "FAC",
        longueurNumero:  6,
        tva:             0,       // 0 = pas de TVA
        arrondi:         true,
        mentionsLegales: [
            "Merci de votre visite",
            "Aucun retour ou échange sans facture",
            "TVA non applicable, art. 293B du CGI"
        ],
        piedPage: "DigitalFacture Pro — digitalfacture.bf"
    },

    // ─── OPTIONS ─────────────────────────────────────────────
    OPTIONS: {
        resetApresImpression: true,
        offlineMode:          true,
        devise:               "F CFA",
        langue:               "fr",
        impression: {
            formatsDisponibles: ['105x148', '80x80', '58x58'],
            formatParDefaut:    '80x80',
            bluetooth:          true,
            pdf:                true
        }
    },

    // ─── THEME ───────────────────────────────────────────────
    THEME: {
        couleurPrincipale: "#0f172a",
        couleurAccent:     "#f59e0b",   // amber-500
        police:            "Inter"
    }
};

window.CONFIG = CONFIG;
