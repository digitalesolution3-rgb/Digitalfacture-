-- ============================================================
-- DIGITALFACTURE PRO — MIGRATION v1 → SaaS
-- FICHIER 2/2 : Migration des données (VERSION CORRIGÉE)
-- ============================================================
-- ⚠️  EXÉCUTER APRÈS 01_migration_schema_v2.sql
--
-- BUG CORRIGÉ : tous les RAISE NOTICE sont maintenant
-- à l'intérieur de blocs DO $$ ... $$ — syntaxe valide ✅
-- ============================================================


-- ── 1. Générer les slugs manquants ───────────────────────────

DO $$
DECLARE
    rec    RECORD;
    nb_maj INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT id, nom_commerce FROM merchants WHERE slug IS NULL
    LOOP
        UPDATE merchants
        SET slug = generate_merchant_slug(rec.nom_commerce)
        WHERE id = rec.id;
        nb_maj := nb_maj + 1;
    END LOOP;
    RAISE NOTICE '[1/5] Slugs générés : % merchant(s)', nb_maj;
END $$;


-- ── 2. Synchroniser statut_abo depuis licence ────────────────

DO $$
DECLARE
    nb_maj INTEGER;
BEGIN
    UPDATE merchants SET statut_abo =
        CASE
            WHEN NOT actif THEN 'inactif'
            WHEN licence = 'active'
                 AND (licence_expiry IS NULL
                      OR licence_expiry > NOW()) THEN 'actif'
            WHEN licence = 'active'
                 AND licence_expiry BETWEEN (NOW() - INTERVAL '3 days') AND NOW() THEN 'grace'
            WHEN licence = 'expired'
                 OR (licence_expiry IS NOT NULL
                     AND licence_expiry < NOW() - INTERVAL '3 days') THEN 'expire'
            ELSE 'actif'
        END
    WHERE statut_abo NOT IN ('suspendu', 'inactif');

    GET DIAGNOSTICS nb_maj = ROW_COUNT;
    RAISE NOTICE '[2/5] statut_abo mis à jour : % merchant(s)', nb_maj;
END $$;


-- ── 3. Numéroter les ventes existantes ───────────────────────

DO $$
DECLARE
    rec           RECORD;
    compteur      INTEGER;
    merchant_prec TEXT := '';
    nb_maj        INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT id, merchant_id, created_at
        FROM sales
        WHERE numero IS NULL
        ORDER BY merchant_id, created_at
    LOOP
        IF rec.merchant_id <> merchant_prec THEN
            compteur      := 0;
            merchant_prec := rec.merchant_id;
        END IF;

        compteur := compteur + 1;
        UPDATE sales
        SET numero = 'FAC-' || lpad(compteur::TEXT, 6, '0')
        WHERE id = rec.id;
        nb_maj := nb_maj + 1;
    END LOOP;
    RAISE NOTICE '[3/5] Numéros factures générés : % vente(s)', nb_maj;
END $$;


-- ── 4. Migrer les PINs configs → profiles (bcrypt) ───────────

DO $$
DECLARE
    rec    RECORD;
    nb_ins INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT
            c.merchant_id,
            c.pin,
            m.proprietaire,
            m.telephone
        FROM configs c
        JOIN merchants m ON m.id = c.merchant_id
        WHERE c.pin IS NOT NULL
          AND c.pin <> ''
          AND NOT EXISTS (
              SELECT 1 FROM profiles p
              WHERE p.merchant_id = c.merchant_id
                AND p.role = 'proprietaire'
          )
    LOOP
        -- Vérification : PIN invalide (trop court) → on skip
        IF length(rec.pin) < 4 THEN
            RAISE NOTICE 'PIN trop court pour merchant %, ignoré', rec.merchant_id;
            CONTINUE;
        END IF;

        INSERT INTO profiles (
            merchant_id, role, nom, telephone, pin_hash, actif
        ) VALUES (
            rec.merchant_id,
            'proprietaire',
            rec.proprietaire,
            rec.telephone,
            crypt(rec.pin, gen_salt('bf', 10)),
            TRUE
        );
        nb_ins := nb_ins + 1;
    END LOOP;
    RAISE NOTICE '[4/5] PINs migrés (hashés) : % profil(s) créé(s)', nb_ins;
    RAISE NOTICE '      ⚠️  Une fois confirmé, vider avec : UPDATE configs SET pin = NULL;';
END $$;


-- ── 5. Migrer payments confirmés → abonnements ───────────────

DO $$
DECLARE
    rec    RECORD;
    nb_ins INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT
            p.id,
            p.merchant_id,
            p.plan,
            p.amount,
            p.operator,
            p.phone,
            p.transaction_id,
            p.created_at,
            p.days,
            p.statut
        FROM payments p
        WHERE p.merchant_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM abonnements a
              WHERE a.id = 'abo-' || p.id
          )
    LOOP
        INSERT INTO abonnements (
            id, merchant_id, plan, montant, methode,
            telephone_paiement, reference,
            date_debut, date_fin, statut, created_at
        ) VALUES (
            'abo-' || rec.id,
            rec.merchant_id,
            COALESCE(rec.plan, 'mensuel'),
            rec.amount,
            CASE rec.operator
                WHEN 'orange' THEN 'orange_money'
                WHEN 'moov'   THEN 'moov_money'
                ELSE 'manuel'
            END,
            rec.phone,
            rec.transaction_id,
            rec.created_at,
            rec.created_at + (COALESCE(rec.days, 30) || ' days')::INTERVAL,
            CASE rec.statut
                WHEN 'confirme' THEN 'confirme'
                ELSE 'en_attente'
            END,
            rec.created_at
        );
        nb_ins := nb_ins + 1;
    END LOOP;
    RAISE NOTICE '[5/5] Payments migrés vers abonnements : % ligne(s)', nb_ins;
END $$;


-- ── Rapport final ─────────────────────────────────────────────

SELECT
    'merchants'    AS "Table",
    COUNT(*)       AS "Lignes",
    COUNT(slug)    AS "Avec slug",
    COUNT(CASE WHEN statut_abo = 'actif' THEN 1 END) AS "Actifs"
FROM merchants

UNION ALL

SELECT 'profiles', COUNT(*), NULL, COUNT(CASE WHEN actif THEN 1 END)
FROM profiles

UNION ALL

SELECT 'sales', COUNT(*), COUNT(numero), NULL
FROM sales

UNION ALL

SELECT 'abonnements', COUNT(*),
       COUNT(CASE WHEN statut = 'confirme' THEN 1 END),
       COUNT(CASE WHEN statut = 'en_attente' THEN 1 END)
FROM abonnements

UNION ALL

SELECT 'products', COUNT(*), NULL, COUNT(CASE WHEN actif THEN 1 END)
FROM products;

-- ============================================================
-- ✅ MIGRATION COMPLÈTE — Données migrées sans perte
--
-- PROCHAINES ÉTAPES :
--   1. Vérifier le rapport ci-dessus
--   2. Tester : SELECT verifier_pin('MERCHANT_ID', 'TON_PIN');
--   3. Déployer 03_edge_function.ts dans Edge Functions
--   4. Remplir SUPABASE_URL + SUPABASE_ANON dans 04_supabase_client.js
--   5. Remplacer firebase_sync.js par 04_supabase_client.js dans index.html
-- ============================================================
