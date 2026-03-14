// js/utils.js - Fonctions utilitaires

// Convertir nombre en lettres (F CFA)
function nombreEnLettres(nombre) {
    if (nombre === 0 || nombre === null || nombre === undefined || isNaN(nombre)) return "ZÉRO FRANC";

    const unite = ['', 'UN', 'DEUX', 'TROIS', 'QUATRE', 'CINQ', 'SIX', 'SEPT', 'HUIT', 'NEUF', 'DIX',
        'ONZE', 'DOUZE', 'TREIZE', 'QUATORZE', 'QUINZE', 'SEIZE', 'DIX-SEPT', 'DIX-HUIT', 'DIX-NEUF'];

    // BUG CORRIGÉ : convert() gère maintenant 0-999 (incluant les centaines)
    function convert(n) {
        if (n === 0) return '';
        if (n < 20) return unite[n];
        if (n < 70) return (Math.floor(n / 10) === 2 ? 'VINGT' :
                            Math.floor(n / 10) === 3 ? 'TRENTE' :
                            Math.floor(n / 10) === 4 ? 'QUARANTE' :
                            Math.floor(n / 10) === 5 ? 'CINQUANTE' : 'SOIXANTE') +
                           (n % 10 ? '-' + unite[n % 10] : '');
        // BUG CORRIGÉ : SOIXANTE-DIX (70) était manquant → n%10 vaut 0, unite[0+10]='DIX'
        if (n < 80) return 'SOIXANTE-' + unite[n % 10 + 10]; // 70→SOIXANTE-DIX, 71→SOIXANTE-ONZE…
        // BUG CORRIGÉ : QUATRE-VINGT (80) ne prend pas de 'S' suivi
        if (n < 90) return 'QUATRE-VINGT' + (n % 10 ? '-' + unite[n % 10] : '');
        // BUG CORRIGÉ : 90 retournait 'QUATRE-VINGT' au lieu de 'QUATRE-VINGT-DIX'
        if (n < 100) return 'QUATRE-VINGT-' + unite[n % 10 + 10]; // 90→QUATRE-VINGT-DIX, 91→ONZE…
        // BUG CORRIGÉ : les centaines (100-999) retournaient '' auparavant
        const centaines = Math.floor(n / 100);
        const reste = n % 100;
        const prefixe = centaines === 1 ? 'CENT' : unite[centaines] + ' CENT' + (reste === 0 ? 'S' : '');
        return prefixe + (reste > 0 ? ' ' + convert(reste) : '');
    }

    function convertMillier(n) {
        if (n < 1000) return convert(n);
        if (n < 1000000) {
            const milliers = Math.floor(n / 1000);
            const reste = n % 1000;
            let resultat = milliers === 1 ? 'MILLE' : convert(milliers) + ' MILLE';
            if (reste > 0) resultat += ' ' + convert(reste);
            return resultat;
        }
        if (n < 1000000000) {
            const millions = Math.floor(n / 1000000);
            const reste = n % 1000000;
            let resultat = millions === 1 ? 'UN MILLION' : convert(millions) + ' MILLIONS';
            if (reste > 0) resultat += ' ' + convertMillier(reste);
            return resultat;
        }
        return 'NOMBRE TROP GRAND';
    }
    
    const partieEntiere = Math.floor(nombre);
    let resultat = convertMillier(partieEntiere);
    resultat += ` FRANC${partieEntiere > 1 ? 'S' : ''} CFA`;
    
    return resultat;
}

// Formater montant
function formaterMontant(montant) {
    return montant.toLocaleString('fr-FR') + ' ' + CONFIG.OPTIONS.devise;
}

// Mettre à jour les infos établissement
function mettreAJourInfosEtablissement() {
    const etab = CONFIG.ETABLISSEMENT;
    
    // Mettre à jour tous les champs
    document.querySelectorAll('#displayNom, #factureNom, #infoNom').forEach(el => {
        if (el) el.innerText = etab.nom;
    });
    
    document.querySelectorAll('#displayActivite, #factureActivite, #infoActivite').forEach(el => {
        if (el) el.innerText = etab.activite;
    });
    
    document.querySelectorAll('#displayTel, #factureTel, #infoTel').forEach(el => {
        if (el) el.innerText = etab.telephone;
    });
    
    document.querySelectorAll('#displayAdresse, #factureAdresse, #infoAdresse').forEach(el => {
        if (el) el.innerText = etab.adresse;
    });
    
    document.querySelectorAll('#displayVille, #factureVille, #infoVille').forEach(el => {
        if (el) el.innerText = etab.ville;
    });
    
    if (document.getElementById('infoEmail')) {
        document.getElementById('infoEmail').innerText = etab.email;
    }
    
    if (document.getElementById('infoRc')) {
        document.getElementById('infoRc').innerText = etab.rc;
    }
    
    if (document.getElementById('infoNif')) {
        document.getElementById('infoNif').innerText = etab.nif;
    }
    
    if (document.getElementById('factureRc')) {
        document.getElementById('factureRc').innerText = etab.rc ? 'RC: ' + etab.rc : '';
    }
    
    if (document.getElementById('factureNif')) {
        document.getElementById('factureNif').innerText = etab.nif ? 'NIF: ' + etab.nif : '';
    }
}

// Afficher mentions légales
function afficherMentionsLegales() {
    const mentions = document.getElementById('mentionsLegales');
    if (mentions && CONFIG.FACTURE.mentionsLegales) {
        mentions.innerHTML = CONFIG.FACTURE.mentionsLegales.map(m => 
            `<div>${m}</div>`
        ).join('');
    }
}

// Générer numéro facture auto
let compteurFacture = 1;
function genererNumeroFacture() {
    const prefix = CONFIG.FACTURE.prefix;
    const longueur = CONFIG.FACTURE.longueurNumero;
    const numero = String(compteurFacture++).padStart(longueur, '0');
    return `${prefix}-${numero}`;
}

// Réinitialiser compteur facture (chaque jour)
function resetCompteurFacture() {
    const today = new Date().toDateString();
    const lastReset = localStorage.getItem('lastFactureReset');

    if (lastReset !== today) {
        compteurFacture = 1;
        localStorage.setItem('lastFactureReset', today);
        localStorage.removeItem('lastFactureNum');
    } else {
        // Récupérer dernier numéro et reprendre à partir de là
        const lastNum = localStorage.getItem('lastFactureNum');
        // BUG CORRIGÉ: parseInt peut perdre les zéros → stocker en entier, padStart au moment d'afficher
        compteurFacture = lastNum ? (parseInt(lastNum, 10) + 1) : 1;
    }
}

// Sauvegarder dernier numéro (stocker la valeur entière, sans padding)
function sauvegarderDernierNumero(numero) {
    // BUG CORRIGÉ: split('-')[1] peut échouer si le préfixe contient '-'
    // On extrait le numéro en cherchant la dernière partie après le dernier '-'
    const parts = numero.split('-');
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) {
        localStorage.setItem('lastFactureNum', num);
    }
}

// Exporter
window.nombreEnLettres = nombreEnLettres;
window.formaterMontant = formaterMontant;
window.mettreAJourInfosEtablissement = mettreAJourInfosEtablissement;
window.afficherMentionsLegales = afficherMentionsLegales;
window.genererNumeroFacture = genererNumeroFacture;
window.resetCompteurFacture = resetCompteurFacture;
window.sauvegarderDernierNumero = sauvegarderDernierNumero;