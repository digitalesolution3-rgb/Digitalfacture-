# DigitalFacture Pro — Guide de déploiement SaaS

**Version 3.0** | Burkina Faso | Stack : Supabase + PWA HTML/JS

---

## Structure du projet

```
digitalfacture-pro/
├── index.html                          ← App principale (corrigée)
├── config.js                           ← Config visuelle UNIQUEMENT (sans PINs)
├── manifest.json                       ← PWA manifest
├── sw.js                               ← Service Worker (cache offline)
│
├── css/
│   └── style.css                       ← Styles personnalisés
│
├── js/
│   ├── supabase_client.js              ← Client Supabase + IndexedDB + AbonnementCheck
│   ├── auth.js                         ← Auth PIN/email (remplace CONFIG.ADMIN + LICENCE)
│   ├── sync.js                         ← Sync offline→Supabase (remplace firebase_sync.js)
│   ├── utils.js                        ← Utilitaires (nombres en lettres, formatage)
│   ├── facture.js                      ← Gestion facture + impression + PDF + Bluetooth
│   ├── app.js                          ← Application principale
│   └── dev.js                          ← Panel développeur
│
├── database/
│   ├── 01_migration_schema_FINAL.sql   ← Migration BDD (exécuter EN PREMIER)
│   └── 02_migration_data_FINAL.sql     ← Migration données (exécuter EN SECOND)
│
└── edge-functions/
    └── verify-subscription/
        └── index.ts                    ← Edge Function vérification abonnement
```

---

## Déploiement — 4 étapes dans l'ordre

### Étape 1 — Base de données Supabase

**Supabase Studio → SQL Editor**

Exécuter dans cet ordre :
1. `database/01_migration_schema_FINAL.sql`
2. `database/02_migration_data_FINAL.sql`

**Ce que font ces scripts :**
- Ajoutent les colonnes manquantes sur tes tables existantes (`merchants`, `configs`, `products`, `sales`, `payments`)
- Créent les nouvelles tables (`profiles`, `abonnements`, `notifications`)
- Créent les fonctions : `verifier_pin()`, `next_sale_numero()`, `generate_merchant_slug()`, `confirmer_abonnement()`
- Activent RLS sur les nouvelles tables
- Génèrent les slugs URL pour tes merchants existants
- Migrent les PINs en clair → bcrypt
- Numérotent les ventes existantes

> ✅ **Zéro conflit** vérifié : toutes les colonnes ajoutées sont absentes du schéma actuel.
> Stratégie 100% additive — aucune donnée existante modifiée ou supprimée.

**Vérification après exécution :**
```sql
-- Toutes les tables attendues
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
-- Attendu : abonnements, activity_log, clients, configs,
--           merchants, notifications, payments, products, profiles, sales

-- Test PIN (après migration)
SELECT verifier_pin('TON_MERCHANT_ID', 'TON_PIN_EXISTANT');
-- Doit retourner : {"success": true, "nom": "...", ...}
```

---

### Étape 2 — Edge Function

**Supabase Studio → Edge Functions → New Function**

- Nom : `verify-subscription`
- Contenu : copier `edge-functions/verify-subscription/index.ts`
- Cliquer **Deploy**

**Ou via CLI :**
```bash
npm install -g supabase
supabase login
supabase link --project-ref XXXXXXXXXXXXXX
supabase functions deploy verify-subscription \
  --import-map supabase/functions/import_map.json
```

**Test :**
```bash
curl -X POST https://XXXXXX.supabase.co/functions/v1/verify-subscription \
  -H "apikey: TA_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"merchant_slug": "test-inexistant"}'
# Attendu : {"valid": false, "error": "Établissement introuvable..."}
```

---

### Étape 3 — Configuration frontend

**Dans `js/supabase_client.js`, remplacer les 2 valeurs :**

```js
const SUPABASE_URL  = "https://XXXXXXXXXXXXXX.supabase.co";  // ← Supabase Studio → Settings → API
const SUPABASE_ANON = "eyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";  // ← Clé "anon public"
```

**Dans `config.js`, personnaliser l'établissement par défaut :**
```js
ETABLISSEMENT: {
    nom:       "TON COMMERCE",
    activite:  "TON ACTIVITÉ",
    telephone: "+226 XX XX XX XX",
    ville:     "OUAGADOUGOU",
    // ...
}
```

> ⚠️ Ne jamais mettre de PINs, mots de passe ou clés secrètes dans `config.js`.

---

### Étape 4 — Déploiement web

Héberge les fichiers sur n'importe quel serveur web statique :

**Option A — Vercel (recommandé, gratuit) :**
```bash
npm i -g vercel
vercel --prod
```

**Option B — Netlify :**
Glisser-déposer le dossier sur app.netlify.com

**Option C — Serveur propre :**
Copier tous les fichiers dans le dossier public de ton serveur Nginx/Apache.

**URL finale de chaque établissement :**
```
https://ton-domaine.com/slug-du-commerce
```
Le slug est auto-généré depuis `nom_commerce` lors de la migration.

---

## Créer ton premier établissement

**Dans Supabase SQL Editor :**

```sql
-- 1. Créer le tenant (génère aussi le slug)
SELECT creer_tenant_et_proprio(
    'Boutique Aminata Ouaga',  -- nom
    'Ouagadougou',              -- ville
    'detail',                   -- type : gros | semi_gros | detail | mixte
    'Aminata SAWADOGO',         -- nom proprio
    'trial',                    -- plan : trial | mensuel | trimestriel | annuel
    14                          -- durée en jours
);
-- Copier le tenant_id retourné

-- 2. Créer le compte Auth du propriétaire
-- Supabase Studio → Authentication → Users → Add User
-- Cocher "Auto Confirm User" → Copier l'UID

-- 3. Attacher le proprio au tenant
SELECT attacher_proprietaire(
    '<UID_AUTH_PROPRIO>',   -- UID copié depuis Auth
    '<TENANT_ID>',          -- ID retourné par creer_tenant_et_proprio
    'Aminata SAWADOGO'
);
```

---

## Système d'authentification

### Caissiers — connexion par PIN
- PIN 4 à 6 chiffres stocké en **bcrypt** (PostgreSQL)
- Aucun compte Supabase Auth requis
- Vérification via `SELECT verifier_pin(merchant_id, pin)`
- Anti-brute-force : pause 500ms après PIN incorrect

### Propriétaires — connexion email + mot de passe
- Compte Supabase Auth (email/password)
- Session JWT persistante avec auto-refresh
- Accès au panel propriétaire et aux stats

### Super Admin
- Compte Supabase Auth dédié
- Accès à toutes les fonctions d'administration
- Dashboard via `vue_superadmin`

---

## Abonnements

| Plan | Durée | Prix |
|------|-------|------|
| Trial | 14 jours | Gratuit |
| Mensuel | 30 jours | 5 000 F CFA |
| Trimestriel | 90 jours | 13 500 F CFA |
| Annuel | 365 jours | 48 000 F CFA |

**Flux de paiement (semi-automatique) :**
1. Propriétaire clique "Renouveler" → choisit son plan
2. Une ligne est créée dans `abonnements` avec `statut = 'en_attente'`
3. Il envoie le paiement via Orange Money / Moov Money
4. Super Admin confirme avec `SELECT confirmer_abonnement(abonnement_id, admin_id)`
5. `merchants.licence_expiry` et `merchants.statut_abo` sont mis à jour automatiquement

---

## Mode offline

L'application fonctionne **sans internet** grâce à :

1. **Service Worker** : met en cache tous les fichiers locaux
2. **IndexedDB** (`OfflineDB`) : stocke les ventes localement
3. **Sync automatique** : dès que le réseau revient, les ventes sont envoyées à Supabase
4. **Cache abonnement** : la vérification est mise en cache 24h

---

## Variables importantes

| Fichier | Variable | Valeur |
|---------|----------|--------|
| `js/supabase_client.js` | `SUPABASE_URL` | URL de ton projet Supabase |
| `js/supabase_client.js` | `SUPABASE_ANON` | Clé anon publique |
| `config.js` | `ETABLISSEMENT` | Infos visuelles de l'établissement |
| `config.js` | `FACTURE.tva` | Taux TVA (0 = pas de TVA) |

---

## Checklist de mise en production

- [ ] `01_migration_schema_FINAL.sql` exécuté avec succès
- [ ] `02_migration_data_FINAL.sql` exécuté avec succès
- [ ] `SELECT verifier_pin(...)` testé et fonctionnel
- [ ] Edge Function `verify-subscription` déployée
- [ ] `SUPABASE_URL` et `SUPABASE_ANON` renseignés dans `supabase_client.js`
- [ ] `config.js` personnalisé (nom, activité, téléphone)
- [ ] Super Admin créé dans Supabase Auth
- [ ] Premier merchant créé avec `creer_tenant_et_proprio()`
- [ ] Test connexion caissier par PIN ✓
- [ ] Test vente → sauvegarde Supabase ✓
- [ ] Test mode offline → sync au retour réseau ✓
- [ ] PWA installable depuis le navigateur ✓

---

## Support

DigitalFacture Pro — Solution SaaS de facturation pour le Burkina Faso  
*Propulsé par Supabase — Conçu pour fonctionner offline*
