// js/dev.js — Panel développeur (version SaaS Supabase)
// CHANGEMENTS : suppression générateur licences, ajout état Supabase

let devClicks      = 0;
let devClickTimer  = null;

window.accesDeveloppeur = () => {
    devClicks++;
    clearTimeout(devClickTimer);
    devClickTimer = setTimeout(() => { devClicks = 0; }, 2000);

    if (devClicks === 5) {  // 5 clics rapides pour ouvrir
        devClicks = 0;
        clearTimeout(devClickTimer);
        const password = prompt("🔐 MODE DÉVELOPPEUR\nMot de passe :");
        if (!password) return;
        // En SaaS le mot de passe dev est dans l'env — ici on accepte "dev2024"
        if (password === "dev2024" || password === CONFIG.VERSION) {
            ouvrirPanelDev();
        } else {
            alert("⛔ Accès refusé");
        }
    }
};

function ouvrirPanelDev() {
    document.getElementById("devPanel")?.remove();

    const panel = document.createElement("div");
    panel.id = "devPanel";
    panel.innerHTML = `
        <div class="fixed inset-0 bg-black/97 z-[150] overflow-y-auto text-green-400 font-mono">
            <div class="max-w-4xl mx-auto p-6">
                <div class="flex justify-between items-center mb-6 border-b border-green-500/30 pb-4">
                    <h1 class="text-2xl font-black text-green-400">⚡ DEV — DigitalFacture Pro v${CONFIG.VERSION}</h1>
                    <button onclick="document.getElementById('devPanel').remove()"
                            class="bg-red-600 text-white px-4 py-1 rounded text-sm hover:bg-red-700">FERMER</button>
                </div>

                <!-- Onglets -->
                <div class="flex gap-2 mb-6">
                    <button onclick="devOnglet('supabase')" id="tabSupabase"
                            class="dev-tab bg-green-900 border border-green-500 px-4 py-2 rounded text-sm font-bold text-white">
                        🗄️ SUPABASE
                    </button>
                    <button onclick="devOnglet('systeme')" id="tabSysteme"
                            class="dev-tab bg-black/50 border border-green-500/30 px-4 py-2 rounded text-sm font-bold text-white hover:bg-green-900/30">
                        ⚙️ SYSTÈME
                    </button>
                    <button onclick="devOnglet('donnees')" id="tabDonnees"
                            class="dev-tab bg-black/50 border border-green-500/30 px-4 py-2 rounded text-sm font-bold text-white hover:bg-green-900/30">
                        💾 DONNÉES
                    </button>
                </div>

                <!-- ONGLET SUPABASE -->
                <div id="devOngletSupabase">
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="bg-black/50 border border-green-500/30 p-4 rounded-xl">
                            <h2 class="text-sm font-bold mb-3 text-green-300">🔌 CONNEXION SUPABASE</h2>
                            <div id="supabaseStatus" class="text-xs space-y-2">
                                <p class="text-yellow-400">Vérification...</p>
                            </div>
                            <button onclick="devTestSupabase()" class="w-full mt-3 bg-green-800 hover:bg-green-700 text-white p-2 rounded text-sm font-bold">
                                🔄 Tester la connexion
                            </button>
                        </div>
                        <div class="bg-black/50 border border-green-500/30 p-4 rounded-xl">
                            <h2 class="text-sm font-bold mb-3 text-green-300">👤 SESSION ACTUELLE</h2>
                            <div id="sessionStatus" class="text-xs space-y-1">
                                <p class="text-slate-400">Merchant ID : <span class="text-white font-mono">${Auth.getMerchantId() || "—"}</span></p>
                                <p class="text-slate-400">Caissier : <span class="text-white">${Auth.getCaissierActif()?.nom || "—"}</span></p>
                                <p class="text-slate-400">Rôle : <span class="text-white">${Auth.getCaissierActif()?.role || "—"}</span></p>
                            </div>
                        </div>
                    </div>
                    <div class="bg-black/50 border border-green-500/30 p-4 rounded-xl">
                        <h2 class="text-sm font-bold mb-3 text-green-300">📊 INDEXEDDB OFFLINE</h2>
                        <div id="idbStatus" class="text-xs space-y-1 text-slate-400">Chargement...</div>
                        <button onclick="devChargerIDB()" class="mt-3 bg-blue-900 hover:bg-blue-800 text-white px-4 py-2 rounded text-sm font-bold">
                            Actualiser
                        </button>
                    </div>
                </div>

                <!-- ONGLET SYSTÈME -->
                <div id="devOngletSysteme" class="hidden">
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="bg-black/50 border border-green-500/30 p-4 rounded">
                            <h2 class="text-sm font-bold mb-3 text-green-300">📊 CONFIG (données sensibles masquées)</h2>
                            <pre class="text-xs overflow-auto max-h-64">${JSON.stringify({
                                VERSION:        CONFIG.VERSION,
                                ETABLISSEMENT:  CONFIG.ETABLISSEMENT,
                                FACTURE:        CONFIG.FACTURE,
                                OPTIONS:        CONFIG.OPTIONS
                            }, null, 2)}</pre>
                        </div>
                        <div class="bg-black/50 border border-green-500/30 p-4 rounded">
                            <h2 class="text-sm font-bold mb-3 text-green-300">🌐 ENVIRONNEMENT</h2>
                            <pre class="text-xs space-y-1 text-green-300" id="envStatus">Chargement...</pre>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <button onclick="devAction('swclear')" class="bg-gray-800 border border-gray-500 p-3 rounded text-white hover:bg-gray-700 text-sm">🔄 Vider cache SW</button>
                        <button onclick="devAction('clearIDB')" class="bg-red-900/50 border border-red-500 p-3 rounded text-white hover:bg-red-900 text-sm">🗑️ Vider IndexedDB</button>
                    </div>
                </div>

                <!-- ONGLET DONNÉES -->
                <div id="devOngletDonnees" class="hidden">
                    <div class="grid grid-cols-3 gap-3 mb-4">
                        <button onclick="devAction('test')"         class="bg-green-900/50 border border-green-500 p-3 rounded text-white hover:bg-green-900 text-sm">🧪 Générer ventes test</button>
                        <button onclick="devAction('resetLocal')"   class="bg-red-900/50 border border-red-500 p-3 rounded text-white hover:bg-red-900 text-sm">🗑️ Reset ventes locales</button>
                        <button onclick="devAction('syncNow')"      class="bg-blue-900/50 border border-blue-500 p-3 rounded text-white hover:bg-blue-900 text-sm">☁️ Forcer sync</button>
                    </div>
                    <div class="bg-black/50 border border-green-500/30 p-4 rounded">
                        <h2 class="text-sm font-bold mb-2 text-green-300">📝 CONSOLE</h2>
                        <div id="devConsole" class="h-52 overflow-y-auto bg-black/80 p-2 text-xs font-mono border border-green-500/30 rounded">
                            <p>> Console développeur active — DigitalFacture Pro v${CONFIG.VERSION}</p>
                            <p>> Supabase configuré : ${window.sb ? "✅ OUI" : "❌ NON"}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(panel);

    // Charger l'état initial
    devTestSupabase();
    devChargerIDB();
    devChargerEnv();
}

window.devOnglet = (onglet) => {
    ["supabase", "systeme", "donnees"].forEach(o => {
        const el  = document.getElementById(`devOnglet${o.charAt(0).toUpperCase() + o.slice(1)}`);
        const tab = document.getElementById(`tab${o.charAt(0).toUpperCase() + o.slice(1)}`);
        if (el)  el.classList.toggle("hidden", o !== onglet);
        if (tab) {
            tab.className = o === onglet
                ? tab.className.replace("bg-black/50 border-green-500/30", "bg-green-900 border-green-500")
                : tab.className.replace("bg-green-900 border-green-500", "bg-black/50 border-green-500/30");
        }
    });
};

window.devTestSupabase = async () => {
    const el = document.getElementById("supabaseStatus");
    if (!el) return;
    el.innerHTML = "<p class='text-yellow-400'>Test en cours...</p>";
    try {
        const { data, error } = await sb.from("merchants").select("id").limit(1);
        if (error) throw error;
        el.innerHTML = `
            <p class="text-green-400 font-bold">✅ Connexion OK</p>
            <p class="text-slate-400">URL : <span class="text-white font-mono text-[9px]">${window.SUPABASE_URL || "configurée"}</span></p>
            <p class="text-slate-400">Résultat test : <span class="text-white">${data?.length || 0} merchant(s) visible(s)</span></p>`;
    } catch (e) {
        el.innerHTML = `
            <p class="text-red-400 font-bold">❌ Erreur</p>
            <p class="text-slate-400 text-[9px]">${e.message}</p>
            <p class="text-yellow-400 text-[9px] mt-1">Vérifiez SUPABASE_URL et SUPABASE_ANON dans supabase_client.js</p>`;
    }
};

window.devChargerIDB = async () => {
    const el = document.getElementById("idbStatus");
    if (!el) return;
    const pending  = await OfflineDB.getAll("ventes_pending", "synced", false).catch(() => []);
    const synced   = await OfflineDB.getAll("ventes_pending", "synced", true).catch(() => []);
    const produits = await OfflineDB.getAll("produits_cache").catch(() => []);
    el.innerHTML = `
        <p>Ventes en attente de sync : <span class="text-amber-400 font-bold">${pending.length}</span></p>
        <p>Ventes synchronisées : <span class="text-green-400 font-bold">${synced.length}</span></p>
        <p>Produits en cache : <span class="text-white font-bold">${produits.length}</span></p>`;
};

function devChargerEnv() {
    const el = document.getElementById("envStatus");
    if (!el) return;
    el.innerText = JSON.stringify({
        "Mode":         CONFIG.DEV_MODE ? "DEV" : "PRODUCTION",
        "En ligne":     navigator.onLine,
        "SW actif":     "serviceWorker" in navigator,
        "IndexedDB":    "indexedDB" in window,
        "Supabase SDK": !!window.supabase
    }, null, 2);
}

function devLogConsole(msg, couleur = "text-green-400") {
    const el = document.getElementById("devConsole");
    if (!el) return;
    el.innerHTML += `<p class="${couleur}"> > ${msg}</p>`;
    el.scrollTop = el.scrollHeight;
}

window.devAction = async (action) => {
    switch (action) {
        case "test":
            const nb = 5;
            for (let i = 0; i < nb; i++) {
                await OfflineDB.put("ventes_pending", {
                    id:          crypto.randomUUID(),
                    merchant_id: Auth.getMerchantId(),
                    numero:      `FAC-TEST-${i + 1}`,
                    total:       Math.floor(Math.random() * 50000) + 5000,
                    paiement:    "especes",
                    statut:      "validee",
                    items:       [{ article: "Article test", qte: 1, pu: 5000, total: 5000 }],
                    synced:      false,
                    created_at:  new Date().toISOString()
                });
            }
            devLogConsole(`✓ ${nb} ventes test créées localement`);
            devChargerIDB();
            break;

        case "resetLocal":
            if (!confirm("Supprimer toutes les ventes locales (non synchro) ?")) break;
            const pending = await OfflineDB.getAll("ventes_pending", "synced", false);
            for (const v of pending) await OfflineDB.delete("ventes_pending", v.id);
            devLogConsole(`✓ ${pending.length} ventes locales supprimées`, "text-red-400");
            devChargerIDB();
            break;

        case "syncNow":
            devLogConsole("Synchronisation forcée...", "text-yellow-400");
            await Sync._syncPending();
            devLogConsole("✓ Sync terminée", "text-green-400");
            devChargerIDB();
            break;

        case "swclear":
            if ("caches" in window) {
                const keys = await caches.keys();
                for (const k of keys) await caches.delete(k);
                devLogConsole(`✓ Cache SW vidé (${keys.length} entrée(s))`);
            }
            break;

        case "clearIDB":
            if (!confirm("Vider tout IndexedDB ? (ventes locales perdues si non synchro)")) break;
            indexedDB.deleteDatabase("digitalfacture_v1");
            devLogConsole("✓ IndexedDB supprimée — rechargez la page", "text-red-400");
            break;
    }
};
