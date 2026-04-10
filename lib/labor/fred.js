/** FRED observations — server-side only (API key). */

export const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

/**
 * Curated for labor-market + macro context around hiring / tech / risk.
 * category: used to group charts in the dashboard.
 */
export const SERIES_MAP = {
  // —— Labor ——
  UNRATE: { name: "Unemployment Rate (U-3)", category: "labor" },
  U6RATE: { name: "U-6 Underemployment", category: "labor" },
  EMRATIO: { name: "Employment-Population Ratio", category: "labor" },
  CIVPART: { name: "Labor Force Participation", category: "labor" },
  PAYEMS: { name: "Nonfarm Payrolls (000s)", category: "labor" },
  CES0500000003: { name: "Avg Hourly Earnings (private)", category: "wages" },
  ICSA: { name: "Initial Jobless Claims", category: "labor" },
  CCSA: { name: "Continuing Claims", category: "labor" },
  // —— Labor demand / churn (JOLTS) ——
  JTSJOL: { name: "JOLTS Job Openings", category: "jolts" },
  JTSHIR: { name: "JOLTS Hires", category: "jolts" },
  JTSQUR: { name: "JOLTS Quit Rate", category: "jolts" },
  JTSR: { name: "Job Openings Rate", category: "jolts" },
  // —— Growth & demand ——
  GDPC1: { name: "Real GDP", category: "growth" },
  INDPRO: { name: "Industrial Production", category: "growth" },
  RSXFS: { name: "Retail Sales (ex food)", category: "growth" },
  PCEC96: { name: "Real Personal Consumption", category: "growth" },
  // —— Inflation (CPI & PCE price indexes) ——
  CPIAUCSL: { name: "CPI — All Urban Consumers (All Items)", category: "inflation" },
  PCEPI: { name: "PCE Price Index", category: "inflation" },
  PCEPILFE: { name: "Core PCE Price Index (ex food & energy)", category: "inflation" },
  HOUST: { name: "Housing Starts", category: "housing" },
  // —— Sentiment & stress ——
  UMCSENT: { name: "U Michigan Consumer Sentiment", category: "sentiment" },
  VIXCLS: { name: "VIX (close)", category: "financial_stress" },
  NFCI: { name: "Chicago Fed NFCI", category: "financial_stress" },
  STLFSI4: { name: "St. Louis Fed Financial Stress", category: "financial_stress" },
  // —— Rates ——
  DGS10: { name: "10Y Treasury Yield", category: "rates" },
  DGS2: { name: "2Y Treasury Yield", category: "rates" },
  T10Y2Y: { name: "10Y–2Y Treasury Spread", category: "rates" },
  // —— Tech-related production ——
  IPG3341S: { name: "Computer & Electronic Products IP", category: "tech_production" },
  IPG3342S: { name: "Computer Equipment IP", category: "tech_production" },
};

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.status === 429 && attempt < retries) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    return res;
  }
}

export async function fetchFredSeries(seriesId, apiKey, { observationStart = "2022-01-01", limit = 52 } = {}) {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: observationStart,
    sort_order: "desc",
    limit: String(limit),
  });
  const url = `${FRED_BASE}?${params}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    const t = await res.text();
    let msg;
    try { const j = JSON.parse(t); msg = j.error_message || t.slice(0, 120); } catch { msg = t.slice(0, 120); }
    throw new Error(`FRED ${seriesId}: ${msg}`);
  }
  const data = await res.json();
  return data.observations || [];
}

/** Observations oldest → newest for Recharts. */
export function observationsToAscending(obs) {
  const out = (obs || [])
    .map((o) => ({
      date: o.date,
      value: o.value === "." || o.value == null ? null : Number(o.value),
    }))
    .filter((x) => x.value != null && !Number.isNaN(x.value));
  out.reverse();
  return out;
}

export async function fetchFredSeriesAscending(seriesId, apiKey, observationStart = "2015-01-01", limit = 320) {
  const raw = await fetchFredSeries(seriesId, apiKey, { observationStart, limit });
  return observationsToAscending(raw);
}

export async function fetchAllFredLatest(apiKey) {
  const results = {};
  for (const seriesId of Object.keys(SERIES_MAP)) {
    try {
      const obs = await fetchFredSeries(seriesId, apiKey, { observationStart: "2020-01-01", limit: 8 });
      const asc = observationsToAscending(obs);
      const latest = asc.length ? asc[asc.length - 1] : null;
      results[seriesId] = {
        meta: SERIES_MAP[seriesId],
        latest: latest ? { date: latest.date, value: latest.value } : null,
        error: null,
      };
    } catch (e) {
      results[seriesId] = {
        meta: SERIES_MAP[seriesId],
        latest: null,
        error: e.message || String(e),
      };
    }
  }
  return results;
}

/** Full history for charts. Fetches in small batches to stay under FRED rate limits. */
export async function fetchAllFredHistories(apiKey, { observationStart = "2015-01-01", limit = 320 } = {}) {
  const ids = Object.keys(SERIES_MAP);
  const out = {};
  const BATCH = 4;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map((id) => fetchFredSeriesAscending(id, apiKey, observationStart, limit)),
    );
    batch.forEach((id, j) => {
      const r = settled[j];
      if (r.status === "fulfilled") {
        out[id] = { meta: SERIES_MAP[id], observations: r.value, error: null };
      } else {
        out[id] = {
          meta: SERIES_MAP[id],
          observations: [],
          error: r.reason?.message || String(r.reason),
        };
      }
    });
    if (i + BATCH < ids.length) await new Promise(r => setTimeout(r, 1200));
  }
  return out;
}
