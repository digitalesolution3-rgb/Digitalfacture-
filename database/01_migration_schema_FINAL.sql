-- ============================================================
-- DIGITALFACTURE PRO — MIGRATION v1 → SaaS
-- FICHIER 1/2 : Migration schéma (VERSION CORRIGÉE)
-- ============================================================
-- ✅ ZÉRO CONFLIT vérifié colonne par colonne :
--    Toutes les nouvelles colonnes sont ABSENTES du schéma actuel.
--    Toutes les nouvelles tables sont ABSENTES du schéma actuel.
--    Stratégie 100% additive — aucune donnée touchée.
--
-- BUGS CORRIGÉS vs version précédente :
--    [1] RAISE NOTICE hors DO → déplacé dans des blocs DO
--    [2] CREATE POLICY IF NOT EXISTS (invalide) → DROP IF EXISTS + CREATE
--    [3] message_accueil utilisé comme prefix → supprimé, 'FAC' direct
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ════════════════════════════════════════════════════════════
-- PARTIE A : EXTENSION DES TABLES EXISTANTES
-- (ALTER TABLE … ADD COLUMN IF NOT EXISTS → sans risque)
-- ════════════════════════════════════════════════════════════

-- ── A1. merchants ────────────────────────────────────────────
-- Colonnes absentes confirmées : slug, activite, adresse, email,
-- site_web, rc, nif, logo_url, type_commerce, statut_abo, jours_grace
-- Note : "type" existe déjà → on ajoute "type_commerce" (nom différent ✅)
-- Note : "updated_at" existe déjà → pas retouché ✅

ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS slug              TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS activite          TEXT,
    ADD COLUMN IF NOT EXISTS adresse           TEXT,
    ADD COLUMN IF NOT EXISTS email             TEXT,
    ADD COLUMN IF NOT EXISTS site_web          TEXT,
    ADD COLUMN IF NOT EXISTS rc                TEXT,
    ADD COLUMN IF NOT EXISTS nif               TEXT,
    ADD COLUMN IF NOT EXISTS logo_url          TEXT,
    ADD COLUMN IF NOT EXISTS type_commerce     TEXT DEFAULT 'detail'
                             CHECK (type_commerce IN ('gros','semi_gros','detail','mixte')),
    ADD COLUMN IF NOT EXISTS statut_abo        TEXT NOT NULL DEFAULT 'actif'
                             CHECK (statut_abo IN ('actif','grace','suspendu','expire','inactif')),
    ADD COLUMN IF NOT EXISTS jours_grace       INTEGER NOT NULL DEFAULT 3;

CREATE INDEX IF NOT EXISTS idx_merchants_slug       ON merchants(slug);
CREATE INDEX IF NOT EXISTS idx_merchants_statut_abo ON merchants(statut_abo);
CREATE INDEX IF NOT EXISTS idx_merchants_expiry     ON merchants(licence_expiry);


-- ── A2. configs ──────────────────────────────────────────────
-- Colonnes absentes confirmées : pin_hash, updated_at
-- Note : "pin" existe → on garde pour transition, on ajoute pin_hash

ALTER TABLE configs
    ADD COLUMN IF NOT EXISTS pin_hash   TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();


-- ── A3. products ─────────────────────────────────────────────
-- Colonnes absentes confirmées : prix_semi_gros, prix_gros,
-- qte_min_semi_gros, qte_min_gros, stock_alerte, unite, actif, code
-- Note : "updated_at" existe déjà ✅

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS prix_semi_gros    NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS prix_gros         NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS qte_min_semi_gros INTEGER,
    ADD COLUMN IF NOT EXISTS qte_min_gros      INTEGER,
    ADD COLUMN IF NOT EXISTS stock_alerte      INTEGER DEFAULT 5,
    ADD COLUMN IF NOT EXISTS unite             TEXT DEFAULT 'unité',
    ADD COLUMN IF NOT EXISTS actif             BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS code              TEXT;

CREATE INDEX IF NOT EXISTS idx_products_actif ON products(actif);


-- ── A4. sales ────────────────────────────────────────────────
-- Colonnes absentes confirmées : caissier_id, numero, sous_total,
-- tva_taux, tva_montant, remise, statut, synced_at, updated_at

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS caissier_id  TEXT,
    ADD COLUMN IF NOT EXISTS numero       TEXT,
    ADD COLUMN IF NOT EXISTS sous_total   NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tva_taux     NUMERIC(5,2)  DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tva_montant  NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS remise       NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS statut       TEXT DEFAULT 'validee'
                             CHECK (statut IN ('validee','annulee','credit')),
    ADD COLUMN IF NOT EXISTS synced_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_sales_created  ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_statut   ON sales(statut);
CREATE INDEX IF NOT EXISTS idx_sales_caissier ON sales(caissier_id);
CREATE INDEX IF NOT EXISTS idx_sales_synced   ON sales(synced_at) WHERE synced_at IS NULL;


-- ── A5. payments ─────────────────────────────────────────────
-- Colonnes absentes confirmées : confirme_par, confirme_le,
-- note_admin, date_debut, date_fin, updated_at
-- Note : "statut" existe déjà ✅

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS confirme_par TEXT,
    ADD COLUMN IF NOT EXISTS confirme_le  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS note_admin   TEXT,
    ADD COLUMN IF NOT EXISTS date_debut   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS date_fin     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();


-- ════════════════════════════════════════════════════════════
-- PARTIE B : NOUVELLES TABLES
-- (toutes absentes du schéma actuel ✅)
-- ════════════════════════════════════════════════════════════

-- ── B1. profiles : rôles et authentification ─────────────────
-- id TEXT pour cohérence avec le reste du schéma (merchants.id = TEXT)

CREATE TABLE IF NOT EXISTS profiles (
    id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    auth_user_id       TEXT UNIQUE,             -- UID Supabase Auth (NULL pour caissiers)
    merchant_id        TEXT REFERENCES merchants(id) ON DELETE CASCADE,
    role               TEXT NOT NULL DEFAULT 'caissier'
                       CHECK (role IN ('super_admin','proprietaire','gerant','caissier')),
    nom                TEXT NOT NULL,
    telephone          TEXT,
    pin_hash           TEXT,                    -- bcrypt — caissiers/gérants uniquement
    actif              BOOLEAN NOT NULL DEFAULT TRUE,
    derniere_connexion TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_merchant  ON profiles(merchant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role      ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_auth_user ON profiles(auth_user_id);


-- ── B2. abonnements : cycle de vie des abonnements ───────────

CREATE TABLE IF NOT EXISTS abonnements (
    id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    merchant_id        TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    plan               TEXT NOT NULL
                       CHECK (plan IN ('trial','mensuel','trimestriel','annuel')),
    montant            NUMERIC(12,2) NOT NULL,
    methode            TEXT NOT NULL DEFAULT 'orange_money'
                       CHECK (methode IN ('orange_money','moov_money','cinetpay','paydunya','especes','manuel')),
    telephone_paiement TEXT,
    reference          TEXT,
    payment_id         TEXT REFERENCES payments(id) ON DELETE SET NULL,
    date_debut         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    date_fin           TIMESTAMPTZ NOT NULL,
    statut             TEXT NOT NULL DEFAULT 'en_attente'
                       CHECK (statut IN ('en_attente','confirme','echec','rembourse')),
    confirme_par       TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    confirme_le        TIMESTAMPTZ,
    note_admin         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abonnements_merchant  ON abonnements(merchant_id);
CREATE INDEX IF NOT EXISTS idx_abonnements_statut    ON abonnements(statut);
CREATE INDEX IF NOT EXISTS idx_abonnements_date_fin  ON abonnements(date_fin);


-- ── B3. notifications : historique WhatsApp/SMS ──────────────

CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    merchant_id TEXT REFERENCES merchants(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    canal       TEXT NOT NULL CHECK (canal IN ('whatsapp','sms','in_app')),
    destinataire TEXT NOT NULL,
    message     TEXT NOT NULL,
    statut      TEXT NOT NULL DEFAULT 'envoye',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifs_merchant ON notifications(merchant_id);


-- ════════════════════════════════════════════════════════════
-- PARTIE C : FONCTIONS UTILITAIRES
-- (CREATE OR REPLACE → sans risque de conflit)
-- ════════════════════════════════════════════════════════════

-- Trigger updated_at générique
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Ajouter les triggers uniquement s'ils n'existent pas
DO $$
BEGIN
    -- merchants a déjà updated_at mais probablement pas le trigger → on l'ajoute
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_merchants_updated_at'
    ) THEN
        CREATE TRIGGER trg_merchants_updated_at
            BEFORE UPDATE ON merchants
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_profiles_updated_at'
    ) THEN
        CREATE TRIGGER trg_profiles_updated_at
            BEFORE UPDATE ON profiles
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sales_updated_at'
    ) THEN
        CREATE TRIGGER trg_sales_updated_at
            BEFORE UPDATE ON sales
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;


-- Génération de slug unique
CREATE OR REPLACE FUNCTION generate_merchant_slug(nom_input TEXT)
RETURNS TEXT AS $$
DECLARE
    base_slug  TEXT;
    final_slug TEXT;
    counter    INTEGER := 0;
BEGIN
    base_slug := lower(regexp_replace(
        translate(nom_input,
            'àáâãäèéêëìíîïòóôõöùúûüç ÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇ',
            'aaaaaeeeeiiiioooooouuuuc aaaaaeeeeiiiioooooouuuuc'
        ), '[^a-z0-9]+', '-', 'g'));
    base_slug  := trim(both '-' from base_slug);
    base_slug  := left(base_slug, 40);
    final_slug := base_slug;

    WHILE EXISTS (SELECT 1 FROM merchants WHERE slug = final_slug) LOOP
        counter    := counter + 1;
        final_slug := base_slug || '-' || counter;
    END LOOP;

    RETURN final_slug;
END;
$$ LANGUAGE plpgsql;


-- Prochain numéro de facture (CORRIGÉ : plus de message_accueil comme prefix)
CREATE OR REPLACE FUNCTION next_sale_numero(p_merchant_id TEXT)
RETURNS TEXT AS $$
DECLARE
    dernier INTEGER;
BEGIN
    SELECT COALESCE(MAX(
        (regexp_match(numero, '\d+$'))[1]::INTEGER
    ), 0)
    INTO dernier
    FROM sales
    WHERE merchant_id = p_merchant_id;

    RETURN 'FAC-' || lpad((dernier + 1)::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;


-- Vérification PIN caissier (bcrypt)
-- CORRIGÉ : anti-brute-force pg_sleep dans le bon bloc
CREATE OR REPLACE FUNCTION verifier_pin(
    p_merchant_id TEXT,
    p_pin         TEXT
)
RETURNS JSONB AS $$
DECLARE
    profil profiles%ROWTYPE;
BEGIN
    SELECT * INTO profil
    FROM profiles
    WHERE merchant_id = p_merchant_id
      AND role IN ('caissier', 'gerant')
      AND actif = TRUE
      AND pin_hash IS NOT NULL
      AND pin_hash = crypt(p_pin, pin_hash)
    LIMIT 1;

    IF NOT FOUND THEN
        PERFORM pg_sleep(0.5);
        RETURN jsonb_build_object('success', FALSE, 'message', 'PIN incorrect');
    END IF;

    UPDATE profiles SET derniere_connexion = NOW() WHERE id = profil.id;

    RETURN jsonb_build_object(
        'success',     TRUE,
        'id',          profil.id,
        'nom',         profil.nom,
        'role',        profil.role,
        'merchant_id', profil.merchant_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Confirmer un abonnement (super admin)
CREATE OR REPLACE FUNCTION confirmer_abonnement(
    p_abonnement_id TEXT,
    p_admin_id      TEXT,
    p_note          TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    abo abonnements%ROWTYPE;
BEGIN
    SELECT * INTO abo FROM abonnements WHERE id = p_abonnement_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Abonnement introuvable');
    END IF;

    UPDATE abonnements
    SET statut       = 'confirme',
        confirme_par = p_admin_id,
        confirme_le  = NOW(),
        note_admin   = p_note
    WHERE id = p_abonnement_id;

    UPDATE merchants
    SET licence         = 'active',
        statut_abo      = 'actif',
        plan_type       = abo.plan,
        licence_expiry  = abo.date_fin,
        updated_at      = NOW()
    WHERE id = abo.merchant_id;

    RETURN jsonb_build_object(
        'success',     TRUE,
        'merchant_id', abo.merchant_id,
        'date_fin',    abo.date_fin
    );
END;
$$ LANGUAGE plpgsql;


-- Statut abonnement en temps réel
CREATE OR REPLACE FUNCTION get_merchant_statut(p_merchant_id TEXT)
RETURNS TEXT AS $$
DECLARE
    m     merchants%ROWTYPE;
    jours INTEGER;
BEGIN
    SELECT * INTO m FROM merchants WHERE id = p_merchant_id;
    IF NOT FOUND THEN RETURN 'inactif'; END IF;
    IF m.statut_abo IN ('suspendu','inactif') THEN RETURN m.statut_abo; END IF;
    IF m.licence_expiry IS NULL THEN RETURN 'actif'; END IF;

    jours := EXTRACT(DAY FROM (m.licence_expiry - NOW()))::INTEGER;

    IF jours > 0             THEN RETURN 'actif'; END IF;
    IF jours >= -m.jours_grace THEN RETURN 'grace'; END IF;
    RETURN 'expire';
END;
$$ LANGUAGE plpgsql STABLE;


-- ════════════════════════════════════════════════════════════
-- PARTIE D : RLS — POLICIES
-- CORRIGÉ : DROP POLICY IF EXISTS avant CREATE POLICY
--           (PostgreSQL ne supporte pas CREATE POLICY IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE abonnements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Helpers
CREATE OR REPLACE FUNCTION current_merchant_id()
RETURNS TEXT AS $$
    SELECT merchant_id FROM profiles
    WHERE auth_user_id = auth.uid()::TEXT LIMIT 1
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
    SELECT role FROM profiles
    WHERE auth_user_id = auth.uid()::TEXT LIMIT 1
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Profiles
DROP POLICY IF EXISTS "proprio_read_profiles" ON profiles;
CREATE POLICY "proprio_read_profiles"
    ON profiles FOR SELECT
    USING (
        merchant_id = current_merchant_id()
        AND current_user_role() IN ('proprietaire','gerant','super_admin')
    );

DROP POLICY IF EXISTS "proprio_manage_profiles" ON profiles;
CREATE POLICY "proprio_manage_profiles"
    ON profiles FOR ALL
    USING (
        merchant_id = current_merchant_id()
        AND current_user_role() = 'proprietaire'
    );

-- Abonnements
DROP POLICY IF EXISTS "proprio_read_abonnements" ON abonnements;
CREATE POLICY "proprio_read_abonnements"
    ON abonnements FOR SELECT
    USING (
        merchant_id = current_merchant_id()
        AND current_user_role() IN ('proprietaire','super_admin')
    );


-- ════════════════════════════════════════════════════════════
-- PARTIE E : VUES ANALYTICS
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vue_stats_merchant AS
SELECT
    merchant_id,
    COUNT(*) FILTER (WHERE created_at::DATE = CURRENT_DATE
                     AND statut = 'validee')                AS ventes_jour,
    COUNT(*) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
                     AND statut = 'validee')                AS ventes_mois,
    COUNT(*) FILTER (WHERE DATE_TRUNC('year', created_at) = DATE_TRUNC('year', NOW())
                     AND statut = 'validee')                AS ventes_annee,
    COALESCE(SUM(total) FILTER (
        WHERE created_at::DATE = CURRENT_DATE AND statut = 'validee'), 0)  AS ca_jour,
    COALESCE(SUM(total) FILTER (
        WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
        AND statut = 'validee'), 0)                          AS ca_mois,
    COALESCE(SUM(total) FILTER (
        WHERE DATE_TRUNC('year', created_at) = DATE_TRUNC('year', NOW())
        AND statut = 'validee'), 0)                          AS ca_annee
FROM sales
WHERE statut != 'annulee'
GROUP BY merchant_id;


CREATE OR REPLACE VIEW vue_superadmin AS
SELECT
    m.id,
    m.nom_commerce,
    m.ville,
    m.plan_type,
    m.statut_abo,
    m.licence_expiry,
    get_merchant_statut(m.id)                                     AS statut_reel,
    EXTRACT(DAY FROM (m.licence_expiry - NOW()))::INTEGER         AS jours_restants,
    COUNT(DISTINCT p.id) FILTER (WHERE p.role = 'caissier')      AS nb_caissiers,
    COUNT(DISTINCT s.id)                                          AS nb_ventes_total,
    COALESCE(SUM(s.total) FILTER (
        WHERE DATE_TRUNC('month', s.created_at) = DATE_TRUNC('month', NOW())
        AND s.statut = 'validee'), 0)                             AS ca_mois_fcfa,
    COUNT(DISTINCT a.id) FILTER (WHERE a.statut = 'en_attente')  AS paiements_en_attente
FROM merchants m
LEFT JOIN profiles    p ON p.merchant_id = m.id AND p.actif = TRUE
LEFT JOIN sales       s ON s.merchant_id = m.id
LEFT JOIN abonnements a ON a.merchant_id = m.id
WHERE m.actif = TRUE
GROUP BY m.id
ORDER BY m.created_at DESC;


-- ════════════════════════════════════════════════════════════
-- VÉRIFICATION RAPIDE (copie-colle après exécution)
-- ════════════════════════════════════════════════════════════
/*
-- 1. Toutes les tables présentes
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
-- Attendu : abonnements, activity_log, clients, configs,
--           merchants, notifications, payments, products, profiles, sales

-- 2. Nouvelles colonnes sur merchants
SELECT column_name FROM information_schema.columns
WHERE table_name = 'merchants'
ORDER BY ordinal_position;
-- Doit inclure : slug, statut_abo, type_commerce, jours_grace...

-- 3. Fonctions créées
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' ORDER BY routine_name;

-- 4. Test verifier_pin (après migration des données)
-- SELECT verifier_pin('TON_MERCHANT_ID', 'TON_PIN');
*/

-- ============================================================
-- ✅ FICHIER 1/2 PRÊT — Zéro conflit, 3 bugs corrigés
-- Prochaine étape : exécuter 02_migration_data_corrige.sql
-- ============================================================
