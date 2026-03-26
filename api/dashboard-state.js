/**
 * Canonical dashboard persistence (Supabase / Neon / any Postgres).
 *
 * Vercel env:
 *   DATABASE_URL           — pooled URI (e.g. Supabase port 6543)
 *   DASHBOARD_STORE_SECRET — shared secret; must match VITE_DASHBOARD_STORE_SECRET in the client build
 */

import pg from "pg";

const { Pool } = pg;

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 20_000,
      ssl: connectionString.includes("supabase.com") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
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

  const p = getPool();
  if (!p) {
    return res.status(500).json({ error: "DATABASE_URL not configured" });
  }

  let client;
  try {
    client = await p.connect();
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
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body || "{}");
        } catch {
          return res.status(400).json({ error: "Invalid JSON body" });
        }
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
    return res.status(500).json({ error: e.message || String(e) });
  } finally {
    if (client) client.release();
  }
}
