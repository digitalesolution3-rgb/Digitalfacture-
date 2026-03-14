// js/facture.js — Gestion des factures (version SaaS)
// CHANGEMENTS vs version originale :
//   - connexionCaissier()  → déplacée dans auth.js (PIN via Supabase)
//   - validerVente()       → écrasée par sync.js (sauvegarde Supabase)
//   - mettreAJourStats()   → déplacée dans app.js (depuis Supabase)
//   - afficherCaissiers()  → déplacée dans app.js (depuis Supabase)
//   - afficherToast()      → conservée ici (utilisée partout)
// Le reste est identique à la version originale.

let caissierActif      = null;
let numeroFactureActuel = "";
let appareilsBluetooth  = [];
let imprimanteConnectee = null;

// Initialiser facture
function initFacture() {
    resetCompteurFacture();
    numeroFactureActuel = genererNumeroFacture();
    document.getElementById("factureNumero").innerText = numeroFactureActuel;
    afficherMentionsLegales();
    const tvaTxt = document.getElementById("tvaTaux");
    if (tvaTxt) tvaTxt.innerText = CONFIG.FACTURE.tva;
}

// Ajouter ligne
function addRow() {
    const row = document.createElement("tr");
    row.className = "border-b border-gray-200";
    row.innerHTML = `
        <td class="border-r-2 border-black p-0">
            <input type="text" class="w-full p-1 uppercase font-bold text-[11px] outline-none" placeholder="Article">
        </td>
        <td class="border-r-2 border-black p-0">
            <input type="number" class="w-full text-center qte font-bold text-[11px] p-1 outline-none" value="1" min="1" oninput="calculer()">
        </td>
        <td class="border-r-2 border-black p-0">
            <input type="number" class="w-full text-center pu font-bold text-[11px] p-1 outline-none" placeholder="0" min="0" oninput="calculer()">
        </td>
        <td class="text-right p-1 font-black total-ligne">0</td>
        <td class="no-print p-0 w-5">
            <button onclick="supprimerLigne(this)" class="text-red-500 font-black text-xs px-1 hover:bg-red-100 rounded" title="Supprimer">✕</button>
        </td>`;
    document.getElementById("lignes-facture").appendChild(row);
}

// Supprimer ligne
function supprimerLigne(btn) {
    const tbody = document.getElementById("lignes-facture");
    if (tbody.rows.length <= 1) { afficherToast("Impossible de supprimer la dernière ligne", "warning"); return; }
    btn.closest("tr").remove();
    calculer();
}

// Calculer totaux
function calculer() {
    let totalGeneral = 0;
    document.querySelectorAll("#lignes-facture tr").forEach(tr => {
        const qte  = parseFloat(tr.querySelector(".qte")?.value) || 0;
        const pu   = parseFloat(tr.querySelector(".pu")?.value)  || 0;
        const tot  = qte * pu;
        const el   = tr.querySelector(".total-ligne");
        if (el) el.innerText = tot.toLocaleString("fr-FR");
        totalGeneral += tot;
    });

    if (CONFIG.FACTURE.tva > 0) {
        const montantTVA = totalGeneral * CONFIG.FACTURE.tva / 100;
        totalGeneral    += montantTVA;
        const tvaMontantEl = document.getElementById("tvaMontant");
        if (tvaMontantEl) tvaMontantEl.innerText = montantTVA.toLocaleString("fr-FR");
        document.getElementById("tvaSection").classList.remove("hidden");
    } else {
        document.getElementById("tvaSection").classList.add("hidden");
    }

    if (CONFIG.FACTURE.arrondi) totalGeneral = Math.round(totalGeneral);

    document.getElementById("grandTotal").innerText = totalGeneral.toLocaleString("fr-FR");

    document.getElementById("lettres").innerHTML = `
        <span class="text-[8px] uppercase">Arrêté la présente facture à la somme de :</span><br>
        <span class="text-[10px] font-bold italic">${nombreEnLettres(totalGeneral)}</span>
    `;
}

// parseTotal — gère les séparateurs fr-FR (\u00a0, \u202f, espace)
function parseTotal() {
    const str = document.getElementById("grandTotal").innerText
        .replace(/[\u00a0\u202f\s]/g, "")
        .replace(",", ".");
    return parseFloat(str) || 0;
}

// Réinitialiser facture
function resetFacture() {
    document.getElementById("lignes-facture").innerHTML = `
        <tr class="border-b border-gray-200">
            <td class="border-r-2 border-black p-0"><input type="text" class="w-full p-1 uppercase font-bold text-[11px] outline-none" placeholder="Article"></td>
            <td class="border-r-2 border-black p-0"><input type="number" class="w-full text-center qte font-bold text-[11px] p-1 outline-none" value="1" min="1" oninput="calculer()"></td>
            <td class="border-r-2 border-black p-0"><input type="number" class="w-full text-center pu font-bold text-[11px] p-1 outline-none" placeholder="0" min="0" oninput="calculer()"></td>
            <td class="text-right p-1 font-black total-ligne">0</td>
            <td class="no-print p-0 w-5"></td>
        </tr>`;
    document.getElementById("grandTotal").innerText = "0";
    document.getElementById("tvaSection").classList.add("hidden");
    document.getElementById("lettres").innerHTML = "Arrêté la présente facture à la somme de...";

    caissierActif       = null;
    imprimanteConnectee = null;
    document.getElementById("nomCaissier").innerText = "---";
    document.getElementById("caisseContent").classList.add("pointer-events-none", "opacity-20");
    document.getElementById("loginCaisseModal").classList.remove("hidden");
    document.getElementById("pinInput").value = "";
    initFacture();
}

// Dialogue impression
function afficherDialogueImpression(ouvrirPDF = false) {
    const modal = document.createElement("div");
    modal.id = "printModal";
    modal.innerHTML = `
        <div class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
                <h3 class="font-black text-center text-xl mb-4">🖨️ OPTIONS D'IMPRESSION</h3>
                <div class="space-y-4">
                    <div>
                        <label class="font-bold text-sm block mb-2">Format papier :</label>
                        <select id="printFormat" class="w-full border-2 border-gray-300 p-3 rounded-xl">
                            <option value="105x148">105 × 148 mm (A6)</option>
                            <option value="80x80" selected>80 × 80 mm (Thermique)</option>
                            <option value="58x58">58 × 58 mm (Mini)</option>
                        </select>
                    </div>
                    <div>
                        <label class="font-bold text-sm block mb-2">Imprimante Bluetooth :</label>
                        <button onclick="rechercherImprimantesBluetooth()"
                                class="w-full bg-blue-600 text-white p-3 rounded-xl font-bold">🔍 RECHERCHER</button>
                        <div id="bluetoothDevices" class="mt-2 max-h-40 overflow-y-auto border border-gray-200 rounded-xl p-2"></div>
                    </div>
                    <div id="connectedPrinter" class="text-sm text-green-600 font-bold hidden">✅ Imprimante connectée</div>
                    <div class="grid grid-cols-2 gap-3 mt-4">
                        <button onclick="telechargerPDF()"
                                class="bg-purple-600 text-white p-4 rounded-xl font-black flex flex-col items-center hover:bg-purple-700">
                            <span class="text-2xl">📥</span><span class="text-xs">TÉLÉCHARGER PDF</span>
                        </button>
                        <button onclick="imprimerFormat()"
                                class="bg-green-600 text-white p-4 rounded-xl font-black flex flex-col items-center hover:bg-green-700">
                            <span class="text-2xl">🖨️</span><span class="text-xs">IMPRIMER</span>
                        </button>
                    </div>
                    <button onclick="fermerDialogueImpression()"
                            class="w-full bg-gray-200 hover:bg-gray-300 p-3 rounded-xl font-bold">FERMER SANS IMPRIMER</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (ouvrirPDF) setTimeout(() => telechargerPDF(), 300);
}

function fermerDialogueImpression() {
    document.getElementById("printModal")?.remove();
}

// Bluetooth
async function rechercherImprimantesBluetooth() {
    if (!navigator.bluetooth) { afficherToast("Bluetooth non supporté sur ce navigateur", "error"); return; }
    const devicesDiv = document.getElementById("bluetoothDevices");
    if (!devicesDiv) return;
    devicesDiv.innerHTML = "<p class=\"text-center text-gray-500 py-2\">🔍 Recherche...</p>";
    try {
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ["000018f0-0000-1000-8000-00805f9b34fb"]
        });
        appareilsBluetooth.push(device);
        const idx = appareilsBluetooth.length - 1;
        devicesDiv.innerHTML = `
            <div class="flex justify-between items-center p-2 border-b hover:bg-gray-50">
                <div>
                    <span class="font-bold">${device.name || "Imprimante"}</span>
                    <span class="text-xs text-gray-500 block">${device.id}</span>
                </div>
                <button onclick="connecterImprimante(${idx})" class="bg-blue-600 text-white px-3 py-1 rounded text-sm">Connecter</button>
            </div>`;
    } catch (e) {
        devicesDiv.innerHTML = "<p class=\"text-center text-red-500 py-2\">❌ Annulé ou aucun appareil</p>";
    }
}

async function connecterImprimante(idx) {
    try {
        const device = appareilsBluetooth[idx];
        if (!device) return;
        await device.gatt.connect();
        imprimanteConnectee = device;
        const el = document.getElementById("connectedPrinter");
        if (el) { el.classList.remove("hidden"); el.innerHTML = `✅ Connecté à ${device.name || "Imprimante"}`; }
        afficherToast(`✅ ${device.name || "Imprimante"} connectée`, "success");
    } catch (e) {
        afficherToast("❌ Échec connexion Bluetooth", "error");
    }
}

async function imprimerFormat() {
    const format = document.getElementById("printFormat")?.value || "80x80";
    const widths  = { "105x148": "105mm", "58x58": "58mm" };
    const printWidth  = widths[format] || "80mm";
    const fontSize    = format === "58x58" ? "8px" : "10px";

    const style = document.createElement("style");
    style.id = "print-style-temp";
    style.textContent = `@media print {
        body > *:not(#facture-ticket) { display: none !important; }
        #facture-ticket { width: ${printWidth} !important; padding: 3mm !important; margin: 0 auto !important; font-size: ${fontSize} !important; border: none !important; box-shadow: none !important; }
        #facture-ticket input { border: none !important; background: transparent !important; padding: 1px !important; }
        .no-print { display: none !important; }
    }`;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => {
        document.getElementById("print-style-temp")?.remove();
        fermerDialogueImpression();
        if (CONFIG.OPTIONS.resetApresImpression) resetFacture();
    }, 1000);
}

function telechargerPDF() {
    const format = document.getElementById("printFormat")?.value || "80x80";
    const sourceEl = document.getElementById("facture-ticket");

    // Capturer les valeurs AVANT le clonage
    const inputValues = [];
    sourceEl.querySelectorAll("input").forEach(i => inputValues.push(i.value || ""));

    const clone = sourceEl.cloneNode(true);

    // Réinjecter les valeurs dans le clone
    clone.querySelectorAll("input").forEach((input, i) => {
        const span = document.createElement("span");
        span.className = input.className;
        span.innerText = inputValues[i] || "";
        input.parentNode.replaceChild(span, input);
    });
    clone.querySelectorAll(".no-print, button").forEach(el => el.remove());

    const widths   = { "105x148": "105mm", "58x58": "58mm" };
    const largeur  = widths[format] || "80mm";
    const fontSize = format === "58x58" ? "8px" : "10px";

    const pdfHTML = `<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8"><title>Facture ${numeroFactureActuel}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Courier New',monospace;background:white;display:flex;justify-content:center;padding:4mm}#facture{width:${largeur};padding:2mm;font-size:${fontSize}}table{width:100%;border-collapse:collapse}td,th{border:1px solid black;padding:2px 3px;font-size:calc(${fontSize} * 0.9)}.text-right{text-align:right}.text-center{text-align:center}.font-bold,.font-black{font-weight:bold}.uppercase{text-transform:uppercase}.italic{font-style:italic}.hidden{display:none!important}.flex{display:flex}.justify-between{justify-content:space-between}.items-center{align-items:center}.items-start{align-items:flex-start}.border-b-2{border-bottom:2px solid black}.border-t-2{border-top:2px solid black}.border-r-2{border-right:2px solid black}.border-2{border:2px solid black}.border-collapse{border-collapse:collapse}.w-full{width:100%}.bg-gray-100{background:#f3f4f6}.p-1{padding:2px}.p-2{padding:4px}.pb-2{padding-bottom:4px}.mt-2{margin-top:4px}.mt-3{margin-top:6px}.mt-4{margin-top:8px}.mt-6{margin-top:12px}.my-2{margin:4px 0}.grid{display:grid}.grid-cols-3{grid-template-columns:repeat(3,1fr)}.tracking-tighter{letter-spacing:-0.05em}.w-24{width:5rem}.shrink-0{flex-shrink:0}.border-dotted{border-style:dotted}.text-gray-600{color:#4b5563}.text-gray-500{color:#6b7280}.leading-none{line-height:1}.rounded{border-radius:4px}.space-y-0\\.5>*+*{margin-top:2px}@media print{@page{size:${largeur} auto;margin:0}body{padding:0}}</style>
</head><body><div id="facture">${clone.innerHTML}</div>
<script>window.onload=function(){setTimeout(function(){window.print();},250);}<\/script>
</body></html>`;

    const blob   = new Blob([pdfHTML], { type: "text/html; charset=utf-8" });
    const url    = URL.createObjectURL(blob);
    const win    = window.open(url, "_blank", "width=450,height=700");

    if (!win) {
        const a = document.createElement("a");
        a.href = url; a.download = `FACTURE_${numeroFactureActuel}.html`; a.click();
        afficherToast("Popup bloquée — fichier téléchargé.", "warning");
    }

    setTimeout(() => URL.revokeObjectURL(url), 10000);
    fermerDialogueImpression();
    if (CONFIG.OPTIONS.resetApresImpression) setTimeout(() => resetFacture(), 4000);
}

// Toast de notification (utilisé partout dans l'app)
function afficherToast(message, type = "info") {
    const colors = { success: "bg-green-600", error: "bg-red-600", warning: "bg-yellow-500", info: "bg-sky-600" };
    const toast  = document.createElement("div");
    toast.className = `fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] px-4 py-3 rounded-xl text-white font-bold text-sm shadow-2xl transition-all duration-300 max-w-xs text-center ${colors[type] || colors.info}`;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity   = "0";
        toast.style.transform = "translateX(-50%) translateY(20px)";
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}

// Exports globaux
window.addRow                         = addRow;
window.supprimerLigne                 = supprimerLigne;
window.calculer                       = calculer;
window.validerEtPDF                   = validerEtPDF;
window.resetFacture                   = resetFacture;
window.initFacture                    = initFacture;
window.afficherToast                  = afficherToast;
window.rechercherImprimantesBluetooth = rechercherImprimantesBluetooth;
window.connecterImprimante            = connecterImprimante;
window.imprimerFormat                 = imprimerFormat;
window.telechargerPDF                 = telechargerPDF;
window.fermerDialogueImpression       = fermerDialogueImpression;
window.afficherDialogueImpression     = afficherDialogueImpression;
