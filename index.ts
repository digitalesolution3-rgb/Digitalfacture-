// ============================================================
// DIGITALFACTURE PRO — MIGRATION v1 → SaaS
// FICHIER 3/4 : Edge Function verify-subscription
//               (adaptée au schéma existant : table merchants)
// ============================================================
// DÉPLOIEMENT :
//   Supabase Studio → Edge Functions → New Function
//   Nom : verify-subscription
//   Coller ce code → Deploy
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { merchant_slug, merchant_id } = await req.json();

    if (!merchant_slug && !merchant_id) {
      return new Response(
        JSON.stringify({ valid: false, error: "merchant_slug ou merchant_id requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Requête sur la table merchants (schéma existant)
    const query = supabase
      .from("merchants")
      .select(`
        id, nom_commerce, ville, type, plan_type,
        statut_abo, licence, licence_expiry, jours_grace, actif,
        config:configs(couleur_theme, devise, message_accueil, wa_message)
      `);

    const { data: merchant, error } = await (merchant_slug
      ? query.eq("slug", merchant_slug).eq("actif", true).single()
      : query.eq("id", merchant_id).eq("actif", true).single());

    if (error || !merchant) {
      return new Response(
        JSON.stringify({ valid: false, error: "Établissement introuvable ou inactif" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Calcul statut en temps réel ──────────────────────────
    const now        = new Date();
    const grace      = merchant.jours_grace ?? 3;
    let joursRestants: number | null = null;
    let statut: string;
    let valide: boolean;
    let message: string;

    if (!merchant.actif) {
      statut = "INACTIF"; valide = false;
      message = "Compte désactivé.";
    } else if (merchant.statut_abo === "suspendu") {
      statut = "SUSPENDU"; valide = false;
      message = "Abonnement suspendu. Contactez l'administrateur.";
    } else if (!merchant.licence_expiry) {
      // Pas de date d'expiration → compte permanent (rare, pour tests)
      statut = "ACTIF"; valide = true;
      message = "Actif — sans expiration";
    } else {
      const expiration = new Date(merchant.licence_expiry);
      const msRestants = expiration.getTime() - now.getTime();
      joursRestants = Math.ceil(msRestants / (1000 * 60 * 60 * 24));

      if (joursRestants > 7) {
        statut = "ACTIF"; valide = true;
        message = `Actif — ${joursRestants} jour(s) restant(s)`;
      } else if (joursRestants > 0) {
        statut = "EXPIRE_BIENTOT"; valide = true;
        message = `⚠️ Expire dans ${joursRestants} jour(s)`;
      } else if (joursRestants >= -grace) {
        statut = "GRACE"; valide = true;
        message = `⚠️ Période de grâce : ${grace + joursRestants} jour(s) restant(s)`;
      } else {
        statut = "EXPIRE"; valide = false;
        message = `Abonnement expiré depuis ${Math.abs(joursRestants)} jour(s)`;
      }
    }

    // ── Mettre à jour statut_abo si changé ───────────────────
    const statutDb = valide
      ? (joursRestants !== null && joursRestants < 0 ? "grace" : "actif")
      : (joursRestants !== null && joursRestants < -grace ? "expire" : merchant.statut_abo);

    if (statutDb !== merchant.statut_abo
        && merchant.statut_abo !== "suspendu"
        && merchant.statut_abo !== "inactif") {
      await supabase
        .from("merchants")
        .update({ statut_abo: statutDb, updated_at: new Date().toISOString() })
        .eq("id", merchant.id);
    }

    // Config pour le frontend
    const config = merchant.config?.[0] ?? {};

    return new Response(
      JSON.stringify({
        valid: valide,
        statut,
        message,
        joursRestants,
        merchant: {
          id:             merchant.id,
          nom:            merchant.nom_commerce,
          ville:          merchant.ville,
          plan:           merchant.plan_type,
          licence_expiry: merchant.licence_expiry,
          config: {
            couleur_theme:  config.couleur_theme  ?? "#E8730C",
            devise:         config.devise         ?? "FCFA",
            message_accueil: config.message_accueil ?? "",
            wa_message:     config.wa_message     ?? "",
          },
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Edge Function error:", err);
    return new Response(
      JSON.stringify({ valid: false, error: "Erreur interne" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
