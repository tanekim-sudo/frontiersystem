/** FRED observations — server-side only (API key). */

export const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

export const SERIES_MAP = {
  UNRATE: { name: "Unemployment Rate U-3", type: "unemployment" },
  U6RATE: { name: "Broad Unemployment U-6", type: "unemployment" },
  ICSA: { name: "Initial UI Claims Weekly", type: "unemployment" },
  CCSA: { name: "Continuing UI Claims", type: "unemployment" },
  JTSJOL: { name: "JOLTS Job Openings", type: "labor_demand" },
  JTSQUR: { name: "JOLTS Quit Rate", type: "worker_confidence" },
  PAYEMS: { name: "Total Nonfarm Payrolls", type: "employment" },
  CES0500000003: { name: "Average Hourly Earnings", type: "wages" },
  LNS11300000: { name: "Labor Force Participation Rate", type: "labor_supply" },
};

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
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`FRED ${seriesId} HTTP ${res.status}: ${t.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.observations || [];
}

export async function fetchAllFredLatest(apiKey) {
  const results = {};
  for (const seriesId of Object.keys(SERIES_MAP)) {
    try {
      const obs = await fetchFredSeries(seriesId, apiKey);
      const latest = obs[0];
      const val = latest?.value;
      results[seriesId] = {
        meta: SERIES_MAP[seriesId],
        latest: latest
          ? {
              date: latest.date,
              value: val === "." || val == null ? null : Number(val),
              realtime_start: latest.realtime_start,
            }
          : null,
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
