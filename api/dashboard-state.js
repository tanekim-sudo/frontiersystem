/**
 * Dashboard persistence: Postgres via `pg` OR Supabase REST (recommended on Vercel).
 *
 * Option A — Supabase REST (avoids pooler/pg driver issues; use if /api/dashboard-state returns 500):
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...  (Project Settings → API → service_role — server only, never VITE_)
 *   DASHBOARD_STORE_SECRET + VITE_DASHBOARD_STORE_SECRET (unchanged)
 *
 * Option B — Direct DATABASE_URL + pg:
 *   DATABASE_URL=postgresql://...  (not sqlite://)
 */

import pg from "pg";

function useSupabaseRest() {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return !!(url && key);
}

function normalizeDatabaseUrl(url) {
  if (!url || typeof url !== "string") return url;
  const trimmed = url.trim();
  if (!trimmed.includes("supabase.com")) return trimmed;
  try {
    const u = new URL(trimmed);
    if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "require");
    return u.toString();
  } catch {
    return trimmed;
  }
}

function dbHintMessage(msg, code) {
  const lower = (msg || "").toLowerCase();
  if (lower.includes("password authentication failed")) {
    return "Check DATABASE_URL password (reset in Supabase → Settings → Database if needed).";
  }
  if (lower.includes("does not exist") && lower.includes("host")) {
    return "Check DATABASE_URL host — copy the URI again from Supabase → Settings → Database.";
  }
  if (code === "SELF_SIGNED_CERT_IN_CHAIN" || lower.includes("certificate")) {
    return "TLS issue: use sslmode=require in DATABASE_URL.";
  }
  if (lower.includes("prepared statement") || lower.includes("portal")) {
    return "PgBouncer conflict: use Session pooler / direct URL, or set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (REST mode).";
  }
  return "Try adding SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (see api/dashboard-state.js). Or open Network → response JSON for details.";
}

async function readRequestBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  if (req.method !== "POST" && req.method !== "PUT") return {};
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function ensureSchema(client) {
  await client.query(`
    create table if not exists public.dashboard_state (
      id text primary key default 'default',
      payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `);
}

function authorized(req) {
  const secret = process.env.DASHBOARD_STORE_SECRET || "";
  const auth = req.headers.authorization || "";
  return secret && auth === `Bearer ${secret}`;
}

async function handleSupabaseRest(req, res) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const restHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (req.method === "GET") {
    const url = `${base}/rest/v1/dashboard_state?id=eq.default&select=payload,updated_at`;
    const fr = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const text = await fr.text();
    let rows;
    try {
      rows = text ? JSON.parse(text) : [];
    } catch {
      return res.status(502).json({ error: "Invalid JSON from Supabase", detail: text.slice(0, 200) });
    }
    if (!fr.ok) {
      return res.status(502).json({
        error: rows?.message || rows?.error || text?.slice(0, 300) || `Supabase HTTP ${fr.status}`,
        hint: "Create table dashboard_state in SQL Editor if missing. Check SUPABASE_URL and service_role key.",
      });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ empty: true, error: "No row yet" });
    }
    const row = rows[0];
    return res.status(200).json({
      data: row.payload,
      updatedAt: row.updated_at,
    });
  }

  if (req.method === "POST" || req.method === "PUT") {
    let body;
    try {
      body = await readRequestBody(req);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
    const payload = body?.data ?? body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Missing data object" });
    }

    const row = {
      id: "default",
      payload,
      updated_at: new Date().toISOString(),
    };

    const fr = await fetch(`${base}/rest/v1/dashboard_state`, {
      method: "POST",
      headers: {
        ...restHeaders,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(row),
    });
    const text = await fr.text();
    if (!fr.ok) {
      let detail;
      try {
        detail = JSON.parse(text);
      } catch {
        detail = text;
      }
      return res.status(502).json({
        error: typeof detail === "object" ? (detail.message || JSON.stringify(detail).slice(0, 400)) : String(detail).slice(0, 400),
        hint: "Ensure table `public.dashboard_state` exists (id text PK, payload jsonb, updated_at timestamptz). SQL is in .env.example.",
      });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!authorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (useSupabaseRest()) {
    try {
      return await handleSupabaseRest(req, res);
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e), hint: "Supabase REST handler failed." });
    }
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl || String(rawUrl).includes("[YOUR-PASSWORD]")) {
    return res.status(500).json({
      error: "Set DATABASE_URL (Postgres) or use SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for REST mode.",
      hint: "REST mode avoids Vercel + pooler errors — copy Project URL and service_role from Supabase → Settings → API.",
    });
  }

  if (String(rawUrl).toLowerCase().startsWith("sqlite:")) {
    return res.status(500).json({
      error: "DATABASE_URL points at SQLite — use your Supabase Postgres URI, or use SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
    });
  }

  const connectionString = normalizeDatabaseUrl(rawUrl);
  const client = new pg.Client({
    connectionString,
    ssl: rawUrl.includes("supabase.com") ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
  } catch (e) {
    const msg = e.message || String(e);
    return res.status(500).json({
      error: msg,
      code: e.code,
      hint: dbHintMessage(msg, e.code),
    });
  }

  try {
    await ensureSchema(client);

    if (req.method === "GET") {
      const r = await client.query(
        "select payload, updated_at from public.dashboard_state where id = $1",
        ["default"],
      );
      if (r.rowCount === 0) {
        return res.status(404).json({ empty: true, error: "No row yet" });
      }
      const row = r.rows[0];
      return res.status(200).json({
        data: row.payload,
        updatedAt: row.updated_at,
      });
    }

    if (req.method === "POST" || req.method === "PUT") {
      let body;
      try {
        body = await readRequestBody(req);
      } catch {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
      const payload = body?.data ?? body;
      if (!payload || typeof payload !== "object") {
        return res.status(400).json({ error: "Missing data object" });
      }

      await client.query(
        `insert into public.dashboard_state (id, payload, updated_at)
         values ('default', $1::jsonb, now())
         on conflict (id) do update set payload = excluded.payload, updated_at = now()`,
        [JSON.stringify(payload)],
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    const msg = e.message || String(e);
    return res.status(500).json({
      error: msg,
      code: e.code,
      hint: dbHintMessage(msg, e.code),
    });
  } finally {
    await client.end().catch(() => {});
  }
}
