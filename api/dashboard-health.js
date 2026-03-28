/**
 * Health check for /api/dashboard-state connectivity.
 * GET /api/dashboard-health → JSON with diagnostics.
 * No auth required — returns status only, never data.
 */

import pg from "pg";

function useSupabaseRest() {
  return !!((process.env.SUPABASE_URL || "").trim() && (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const checks = {
    timestamp: new Date().toISOString(),
    DATABASE_URL_set: !!(process.env.DATABASE_URL || "").trim(),
    DATABASE_URL_is_postgres: (process.env.DATABASE_URL || "").startsWith("postgresql://"),
    DATABASE_URL_has_placeholder: (process.env.DATABASE_URL || "").includes("[YOUR-PASSWORD]"),
    DASHBOARD_STORE_SECRET_set: !!(process.env.DASHBOARD_STORE_SECRET || "").trim(),
    SUPABASE_URL_set: !!(process.env.SUPABASE_URL || "").trim(),
    SUPABASE_SERVICE_ROLE_KEY_set: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    mode: useSupabaseRest() ? "supabase_rest" : (process.env.DATABASE_URL || "").startsWith("postgresql://") ? "pg_direct" : "not_configured",
    db_reachable: false,
    table_exists: false,
    row_count: null,
    error: null,
  };

  if (useSupabaseRest()) {
    const base = process.env.SUPABASE_URL.replace(/\/$/, "");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const r = await fetch(`${base}/rest/v1/dashboard_state?select=id&limit=10`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      const text = await r.text();
      if (r.ok) {
        checks.db_reachable = true;
        try {
          const rows = JSON.parse(text);
          checks.table_exists = true;
          checks.row_count = Array.isArray(rows) ? rows.length : 0;
        } catch {
          checks.table_exists = false;
          checks.error = "JSON parse failed on REST response";
        }
      } else {
        checks.db_reachable = true;
        let detail;
        try {
          detail = JSON.parse(text);
        } catch {
          detail = text;
        }
        const msg = typeof detail === "object" ? (detail.message || detail.error || JSON.stringify(detail)) : String(detail);
        if (msg.includes("does not exist") || msg.includes("relation")) {
          checks.table_exists = false;
          checks.error = "Table public.dashboard_state does not exist. Run the CREATE TABLE in SQL Editor.";
        } else {
          checks.error = msg.slice(0, 300);
        }
      }
    } catch (e) {
      checks.error = e.message || String(e);
    }
  } else if (checks.DATABASE_URL_is_postgres && !checks.DATABASE_URL_has_placeholder) {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: (process.env.DATABASE_URL || "").includes("supabase.com") ? { rejectUnauthorized: false } : undefined,
    });
    try {
      await client.connect();
      checks.db_reachable = true;
      const r = await client.query(
        "select count(*) as cnt from information_schema.tables where table_schema = 'public' and table_name = 'dashboard_state'",
      );
      checks.table_exists = parseInt(r.rows[0]?.cnt, 10) > 0;
      if (checks.table_exists) {
        const cr = await client.query("select count(*) as cnt from public.dashboard_state");
        checks.row_count = parseInt(cr.rows[0]?.cnt, 10);
      } else {
        checks.error = "Table public.dashboard_state does not exist. Run the CREATE TABLE in SQL Editor.";
      }
    } catch (e) {
      checks.error = e.message || String(e);
    } finally {
      await client.end().catch(() => {});
    }
  } else {
    checks.error = checks.DATABASE_URL_has_placeholder
      ? "DATABASE_URL still has [YOUR-PASSWORD]. Replace with real password."
      : "No database configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL (postgres://).";
  }

  const ok = checks.db_reachable && checks.table_exists && checks.DASHBOARD_STORE_SECRET_set;
  return res.status(ok ? 200 : 503).json({ ok, ...checks });
}
