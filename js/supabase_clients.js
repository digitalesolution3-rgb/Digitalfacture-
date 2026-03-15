// js/supabase_client.js
// Remplace : config.js (partie FIREBASE) + firebase_sync.js
// Fournit   : client Supabase global, IndexedDB offline, vérification abonnement

// ─── À REMPLIR : Supabase Studio → Settings → API ────────────
const SUPABASE_URL  = "https://kkjhsaoaqvggjendbhax.supabase.co";  // ← TON URL
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtramhzYW9hcXZnZ2plbmRiaGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MDA2NjQsImV4cCI6MjA4ODk3NjY2NH0.TP8VO5_CiHrsuvcigah_5INl7znDozQlEvKBO2xKpLc";  // ← TA CLÉ ANON

const EDGE_URL = `${SUPABASE_URL}/functions/v1`;

// Crée le client global (le SDK Supabase est chargé via CDN dans index.html)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth:     { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 10 } }
});
window.sb = sb;


// ══════════════════════════════════════════════════════════════
// OFFLINE DB (IndexedDB)
// Stockage local robuste — remplace localStorage pour les ventes
// ══════════════════════════════════════════════════════════════
const OfflineDB = {
    db: null,

    async init() {
        return new Promise((res, rej) => {
            const req = indexedDB.open("digitalfacture_v1", 2);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("ventes_pending")) {
                    const s = db.createObjectStore("ventes_pending", { keyPath: "id" });
                    s.createIndex("merchant_id", "merchant_id");
                    s.createIndex("synced",      "synced");
                }
                if (!db.objectStoreNames.contains("session")) {
                    db.createObjectStore("session", { keyPath: "key" });
                }
                if (!db.objectStoreNames.contains("produits_cache")) {
                    const p = db.createObjectStore("produits_cache", { keyPath: "id" });
                    p.createIndex("merchant_id", "merchant_id");
                }
            };

            req.onsuccess = (e) => { this.db = e.target.result; res(this.db); };
            req.onerror   = ()  => rej(req.error);
        });
    },

    async put(store, data) {
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, "readwrite");
            const r  = tx.objectStore(store).put(data);
            r.onsuccess = () => res(r.result);
            r.onerror   = () => rej(r.error);
        });
    },

    async getAll(store, index = null, val = null) {
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, "readonly");
            const s  = tx.objectStore(store);
            const r  = index ? s.index(index).getAll(val) : s.getAll();
            r.onsuccess = () => res(r.result);
            r.onerror   = () => rej(r.error);
        });
    },

    async delete(store, key) {
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, "readwrite");
            const r  = tx.objectStore(store).delete(key);
            r.onsuccess = () => res();
            r.onerror   = () => rej(r.error);
        });
    }
};
window.OfflineDB = OfflineDB;


// ══════════════════════════════════════════════════════════════
// VÉRIFICATION ABONNEMENT
// Vérifie côté serveur via Edge Function (infalsifiable)
// Cache local 24h pour le mode offline
// ══════════════════════════════════════════════════════════════
const AbonnementCheck = {
    CACHE_KEY:    "df_abo_cache",
    CACHE_TTL_MS: 24 * 60 * 60 * 1000,  // 24 heures

    async verifier(merchantSlug) {
        // 1. Vérification serveur si en ligne
        if (navigator.onLine) {
            try {
                const resp = await fetch(`${EDGE_URL}/hyper-endpoint`, {
                    method:  "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "apikey": SUPABASE_ANON
                    },
                    body: JSON.stringify({ merchant_slug: merchantSlug })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    localStorage.setItem(this.CACHE_KEY, JSON.stringify({ ...data, cachedAt: Date.now() }));
                    return data;
                }
            } catch (e) {
                console.warn("Vérification abonnement offline:", e.message);
            }
        }

        // 2. Fallback : cache local
        const cached = localStorage.getItem(this.CACHE_KEY);
        if (cached) {
            const d = JSON.parse(cached);
            if (Date.now() - d.cachedAt < this.CACHE_TTL_MS) {
                return { ...d, offline: true };
            }
        }

        // 3. Aucune donnée — bloquer par sécurité
        return { valid: false, statut: "INCONNU", message: "Vérifiez votre connexion internet." };
    }
};
window.AbonnementCheck = AbonnementCheck;
