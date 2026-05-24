import { SEED_COMPANIES, SEED_METRICS, authorizedLive, makeJobId, withLiveDb } from "../lib/server/live-db.js";

function parseQuery(req) {
  if (req.query && typeof req.query === "object") return req.query;
  try {
    const u = new URL(req.url || "", "http://localhost");
    return Object.fromEntries(u.searchParams.entries());
  } catch {
    return {};
  }
}

async function readRequestBody(req) {
  if (req.body != null && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function listCompanies(client) {
  const r = await client.query(
    `select c.id, c.name, c.ticker, c.layer, c.industry, c.active,
      coalesce(json_agg(distinct jsonb_build_object(
        'metric_id', m.id,
        'value', o.value_numeric,
        'observed_at', o.observed_at
      )) filter (where m.id is not null), '[]'::json) as latest_signals
     from public.companies c
     left join lateral (
       select o1.*
       from public.observations o1
       where o1.company_id = c.id
       order by o1.observed_at desc
       limit 12
     ) o on true
     left join public.metric_definitions m on m.id = o.metric_id
     where c.active = true
     group by c.id, c.name, c.ticker, c.layer, c.industry, c.active
     order by c.layer, c.name`,
  );
  return r.rows;
}

async function layerOverview(client, layer) {
  const metrics = await client.query(
    `select m.id, m.name, m.unit, m.cadence, m.threshold_value, m.threshold_direction
     from public.metric_definitions m
     where m.layer = $1
     order by m.name`,
    [layer],
  );
  const leaders = await client.query(
    `select c.id as company_id, c.name as company_name, o.metric_id, o.value_numeric, o.observed_at
     from public.observations o
     join public.companies c on c.id = o.company_id
     join public.metric_definitions m on m.id = o.metric_id
     where c.layer = $1
       and o.observed_at = (
         select max(o2.observed_at)
         from public.observations o2
         where o2.company_id = o.company_id and o2.metric_id = o.metric_id
       )
     order by o.value_numeric desc nulls last
     limit 30`,
    [layer],
  );
  const catalysts = await client.query(
    `select id, title, event_type, event_date, importance, company_id
     from public.catalyst_events
     where layer = $1 and event_date >= current_date - interval '14 day'
     order by event_date asc
     limit 25`,
    [layer],
  );
  const scoreRows = await client.query(
    `with latest as (
      select o.company_id, o.metric_id, o.value_numeric,
        row_number() over (partition by o.company_id, o.metric_id order by o.observed_at desc) as rn
      from public.observations o
      join public.companies c on c.id = o.company_id
      where c.layer = $1
    )
    select company_id, avg(value_numeric) as avg_metric_value
    from latest
    where rn = 1 and value_numeric is not null
    group by company_id
    order by avg_metric_value desc nulls last`,
    [layer],
  );
  const momentumRows = await client.query(
    `with ranked as (
      select o.company_id, o.metric_id, o.value_numeric, o.observed_at,
        row_number() over (partition by o.company_id, o.metric_id order by o.observed_at desc) as rn
      from public.observations o
      join public.companies c on c.id = o.company_id
      where c.layer = $1 and o.value_numeric is not null
    ),
    paired as (
      select a.company_id, a.metric_id, a.value_numeric as latest, b.value_numeric as prev
      from ranked a
      left join ranked b on b.company_id = a.company_id and b.metric_id = a.metric_id and b.rn = 2
      where a.rn = 1
    )
    select company_id,
      avg(case when prev is not null and prev <> 0 then ((latest - prev)/abs(prev))*100 else null end) as avg_momentum_pct
    from paired
    group by company_id
    order by avg_momentum_pct desc nulls last`,
    [layer],
  );

  return {
    layer,
    metrics: metrics.rows,
    leaderboard: leaders.rows,
    catalysts: catalysts.rows,
    scorecards: scoreRows.rows,
    momentum: momentumRows.rows,
  };
}

async function companySignals(client, companyId, days = 120) {
  const r = await client.query(
    `select o.company_id, c.name as company_name, c.layer, o.metric_id, m.name as metric_name, m.unit, o.source_id,
      o.value_numeric, o.value_text, o.confidence, o.observed_at, o.raw_json
     from public.observations o
     join public.companies c on c.id = o.company_id
     join public.metric_definitions m on m.id = o.metric_id
     where o.company_id = $1
       and o.observed_at >= now() - ($2::text || ' day')::interval
     order by o.observed_at desc`,
    [companyId, String(days)],
  );
  return r.rows;
}

async function liveAlerts(client) {
  const thresholdHits = await client.query(
    `select c.id as company_id, c.name as company_name, c.layer, m.id as metric_id, m.name as metric_name,
      m.threshold_value, m.threshold_direction, o.value_numeric, o.observed_at
     from public.observations o
     join public.companies c on c.id = o.company_id
     join public.metric_definitions m on m.id = o.metric_id
     where m.threshold_value is not null
       and o.observed_at = (
         select max(o2.observed_at)
         from public.observations o2
         where o2.company_id = o.company_id and o2.metric_id = o.metric_id
       )
       and (
         (m.threshold_direction = 'gte' and o.value_numeric >= m.threshold_value) or
         (m.threshold_direction = 'lte' and o.value_numeric <= m.threshold_value) or
         (m.threshold_direction is null and o.value_numeric >= m.threshold_value)
       )
     order by o.observed_at desc
     limit 50`,
  );
  const staleRuns = await client.query(
    `select collector_id, layer, status, started_at, finished_at, error_message
     from public.ingestion_runs
     where status = 'failed' or (finished_at is null and started_at < now() - interval '2 hour')
     order by started_at desc
     limit 25`,
  );
  return {
    threshold_hits: thresholdHits.rows,
    run_health: staleRuns.rows,
  };
}

async function enqueueIngestion(client, body) {
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [body];
  const inserted = [];
  for (const job of jobs) {
    const jobType = job?.job_type || "collector_run";
    const layer = job?.layer || "agent";
    const companyId = job?.company_id || null;
    const payload = job?.payload && typeof job.payload === "object" ? job.payload : {};
    const priority = Number.isFinite(Number(job?.priority)) ? Number(job.priority) : 100;
    const scheduledAt = job?.scheduled_at || new Date().toISOString();
    const r = await client.query(
      `insert into public.ingestion_jobs
       (job_type, layer, company_id, payload, priority, status, scheduled_at)
       values ($1,$2,$3,$4::jsonb,$5,'queued',$6)
       returning id, job_type, layer, company_id, status, scheduled_at, priority`,
      [jobType, layer, companyId, JSON.stringify(payload), priority, scheduledAt],
    );
    inserted.push(r.rows[0]);
  }
  const runId = makeJobId("enqueue");
  await client.query(
    `insert into public.ingestion_runs (id, collector_id, company_id, layer, status, started_at, finished_at, records_written, metadata)
     values ($1,'enqueue_api',null,'system','success',now(),now(),$2,$3::jsonb)`,
    [runId, inserted.length, JSON.stringify({ jobs_enqueued: inserted.length })],
  );
  return inserted;
}

function fallbackLayerOverview(layer) {
  const metrics = SEED_METRICS.filter((m) => m.layer === layer).map((m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    cadence: m.cadence,
    threshold_value: m.threshold_value ?? null,
    threshold_direction: m.threshold_direction ?? null,
  }));
  const layerCompanies = SEED_COMPANIES.filter((c) => c.layer === layer);
  const nowIso = new Date().toISOString();
  const leaderboard = [];
  for (const c of layerCompanies) {
    for (const m of metrics.slice(0, Math.min(metrics.length, 8))) {
      const score = 60 + ((Math.abs((c.id + m.id).split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 38));
      leaderboard.push({
        company_id: c.id,
        company_name: c.name,
        metric_id: m.id,
        value_numeric: score,
        observed_at: nowIso,
      });
    }
  }
  leaderboard.sort((a, b) => Number(b.value_numeric || 0) - Number(a.value_numeric || 0));

  const defaultCatalysts = {
    physical_ai: [{ id: "corl", title: "CoRL proceedings annual signal pass", event_type: "research_release", event_date: "2026-11-20", importance: 3, company_id: null }],
    voice: [{ id: "tts_bench", title: "Quarterly TTS latency benchmark refresh", event_type: "benchmark", event_date: "2026-07-10", importance: 2, company_id: "elevenlabs" }],
    spatial: [{ id: "meta_connect", title: "Meta Connect", event_type: "annual_catalyst", event_date: "2026-09-15", importance: 3, company_id: "meta_spatial" }],
    agent: [{ id: "eu_ai_act", title: "EU AI Act broad applicability", event_type: "regulatory", event_date: "2026-08-02", importance: 3, company_id: null }],
    neural: [{ id: "fda_cycle", title: "Quarterly FDA BCI approvals cycle check", event_type: "regulatory", event_date: "2026-10-01", importance: 2, company_id: null }],
  };
  return {
    layer,
    metrics,
    leaderboard: leaderboard.slice(0, 40),
    catalysts: defaultCatalysts[layer] || [],
    scorecards: layerCompanies.map((c, i) => ({
      company_id: c.id,
      avg_metric_value: 95 - i * 3,
    })),
    momentum: layerCompanies.map((c, i) => ({
      company_id: c.id,
      avg_momentum_pct: 7 - i * 1.2,
    })),
    source_confidence: "mock_composite",
    data_completeness_pct: 100,
  };
}

function fallbackCompanySignals(companyId) {
  const company = SEED_COMPANIES.find((c) => c.id === companyId);
  if (!company) return [];
  const metrics = SEED_METRICS.filter((m) => m.layer === company.layer);
  const out = [];
  const now = Date.now();
  for (const metric of metrics) {
    for (let i = 0; i < 16; i++) {
      const t = new Date(now - (15 - i) * 7 * 86400000);
      const basis = Math.abs((company.id + metric.id).split("").reduce((a, ch) => a + ch.charCodeAt(0), 0));
      let value = 0;
      if ((metric.unit || "").includes("usd")) value = 20_000_000 + basis * 1400 + i * 450_000;
      else if ((metric.unit || "").includes("hours")) value = 40_000 + basis * 14 + i * 700;
      else if ((metric.unit || "").includes("units")) value = 120_000 + basis * 9 + i * 1200;
      else if ((metric.unit || "").includes("milliseconds")) value = 280 - (basis % 35) - i;
      else if ((metric.unit || "").includes("percent")) value = 42 + (basis % 30) + i * 0.6;
      else if ((metric.unit || "").includes("ratio")) value = 0.8 + (basis % 140) / 100 + i * 0.03;
      else if ((metric.unit || "").includes("count")) value = 250 + (basis % 600) + i * 35;
      else value = 55 + (basis % 40) + i * 1.4;
      out.push({
        company_id: company.id,
        company_name: company.name,
        layer: company.layer,
        metric_id: metric.id,
        metric_name: metric.name,
        unit: metric.unit,
        source_id: "demo_fallback",
        value_numeric: Number(value.toFixed(3)),
        value_text: null,
        confidence: "medium",
        observed_at: t.toISOString(),
        raw_json: { mode: "degraded_demo", source_type: "mock", collector: "seeded_final_state_preview" },
      });
    }
  }
  return out;
}

function fallbackResponse(resource, query) {
  if (!resource || resource === "companies") {
    return {
      resource: "companies",
      data: SEED_COMPANIES.map((c) => ({ ...c, active: true, latest_signals: [] })),
    };
  }
  if (resource === "layer_overview") {
    const layer = String(query.layer || "agent");
    return { resource: "layer_overview", data: fallbackLayerOverview(layer) };
  }
  if (resource === "company_signals") {
    const companyId = String(query.company_id || "").trim();
    if (!companyId) throw new Error("company_id is required");
    return { resource: "company_signals", data: fallbackCompanySignals(companyId) };
  }
  if (resource === "alerts") {
    return { resource: "alerts", data: { threshold_hits: [], run_health: [{ collector_id: "live_backend", layer: "system", status: "degraded_no_database", started_at: new Date().toISOString(), finished_at: null, error_message: "DATABASE_URL not configured" }] } };
  }
  if (resource === "jobs") {
    return { resource: "jobs", data: [] };
  }
  throw new Error(`Unknown resource: ${resource}`);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  const q = parseQuery(req);
  const resource = String(q.resource || "").trim();

  try {
    if (req.method === "POST") {
      if (!authorizedLive(req)) return res.status(401).json({ error: "Unauthorized" });
      const body = await readRequestBody(req);
      if (resource !== "enqueue") {
        return res.status(400).json({ error: "POST supports only resource=enqueue" });
      }
      try {
        const jobs = await withLiveDb((client) => enqueueIngestion(client, body));
        return res.status(200).json({ ok: true, jobs });
      } catch (e) {
        if ((e.message || "").includes("DATABASE_URL")) {
          return res.status(200).json({ ok: true, degraded: true, jobs: [], note: "Live database not configured; enqueue accepted in no-op mode." });
        }
        throw e;
      }
    }

    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    try {
      const data = await withLiveDb(async (client) => {
        if (!resource || resource === "companies") return { resource: "companies", data: await listCompanies(client) };
        if (resource === "layer_overview") {
          const layer = String(q.layer || "agent");
          return { resource: "layer_overview", data: await layerOverview(client, layer) };
        }
        if (resource === "company_signals") {
          const companyId = String(q.company_id || "").trim();
          if (!companyId) throw new Error("company_id is required");
          const days = Number(q.days || 120);
          return { resource: "company_signals", data: await companySignals(client, companyId, days) };
        }
        if (resource === "alerts") {
          return { resource: "alerts", data: await liveAlerts(client) };
        }
        if (resource === "jobs") {
          const jobs = await client.query(
            `select id, job_type, layer, company_id, status, scheduled_at, attempts, last_error
             from public.ingestion_jobs
             order by scheduled_at desc
             limit 200`,
          );
          return { resource: "jobs", data: jobs.rows };
        }
        throw new Error(`Unknown resource: ${resource}`);
      });
      return res.status(200).json({ ...data, fetched_at: new Date().toISOString() });
    } catch (e) {
      if ((e.message || "").includes("DATABASE_URL")) {
        const data = fallbackResponse(resource, q);
        return res.status(200).json({
          ...data,
          degraded: true,
          note: "DATABASE_URL not configured; serving fallback seeded live data.",
          fetched_at: new Date().toISOString(),
        });
      }
      throw e;
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e), resource });
  }
}
