/**
 * Canonical dashboard persistence (Supabase / Neon / any Postgres).
 *
 * Vercel env:
 *   DATABASE_URL           — Supabase *transaction* pooler (6543) or *session* pooler / direct (5432)
 *   DASHBOARD_STORE_SECRET — must match VITE_DASHBOARD_STORE_SECRET
 *
 * If you see 500s with the transaction pooler (6543), switch to the **Session mode**
 * connection string in Supabase → Settings → Database (port 5432 pooler), or direct DB URL.
 */

import pg from "pg";

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
    return "TLS issue: use sslmode=require in DATABASE_URL (added automatically for supabase.com).";
  }
  if (lower.includes("prepared statement") || lower.includes("portal")) {
    return "PgBouncer conflict: in Supabase use **Session pooler** (5432) or **Direct connection** instead of Transaction pooler (6543), or see Supabase docs for serverless + Postgres.";
  }
  return "Open the failed request in Network → response JSON for `error`. Verify DATABASE_URL uses your real DB password (URL-encode special characters).";
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

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!authorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl || String(rawUrl).includes("[YOUR-PASSWORD]")) {
    return res.status(500).json({
      error: "DATABASE_URL missing or still contains [YOUR-PASSWORD] placeholder — set the real Supabase URI on Vercel.",
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
