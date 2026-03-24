import { fetchChicagoFedLabor } from "./chicagoFed.js";
import { fetchAllFredHistories, SERIES_MAP, fetchFredSeries } from "./fred.js";

const CHI_TS_MAX = 260;

/**
 * @param {{ fredApiKey?: string }} opts
 */
export async function buildLaborOverview(opts = {}) {
  const notes = [];
  const fredKey = (opts.fredApiKey || "").trim();

  let chicago = null;
  let chicago_timeseries = [];
  try {
    const parsed = await fetchChicagoFedLabor();
    const ts = Array.isArray(parsed.timeseries) ? parsed.timeseries : [];
    chicago_timeseries = ts.length > CHI_TS_MAX ? ts.slice(-CHI_TS_MAX) : ts;
    chicago = {
      release_date: parsed.release_date,
      forecast_unemployment: parsed.forecast_unemployment,
      layoffs_separations_rate: parsed.layoffs_separations_rate,
      hiring_rate_unemployed: parsed.hiring_rate_unemployed,
      forecast_50pct_lower: parsed.forecast_50pct_lower,
      forecast_50pct_upper: parsed.forecast_50pct_upper,
      official_u3: parsed.official_u3,
      source: "chicago_fed_xlsx",
      history_weeks: chicago_timeseries.length,
    };
  } catch (e) {
    notes.push(`Chicago Fed: ${e.message || e}`);
  }

  let fred_latest = [];
  let fred_histories = null;

  if (!fredKey) {
    notes.push("FRED: set FRED_API_KEY in Vercel (or .env locally) for macro series, charts, and history.");
  } else {
    try {
      fred_histories = await fetchAllFredHistories(fredKey, { observationStart: "2015-01-01", limit: 360 });
      fred_latest = Object.entries(fred_histories).map(([id, x]) => {
        const obs = x.observations || [];
        const last = obs.length ? obs[obs.length - 1] : null;
        return {
          series_id: id,
          name: x.meta?.name,
          category: x.meta?.category,
          date: last?.date ?? null,
          value: last?.value ?? null,
          error: x.error,
          points: obs.length,
        };
      });
    } catch (e) {
      notes.push(`FRED: ${e.message || e}`);
    }
  }

  return {
    chicago_fed: chicago,
    chicago_fed_timeseries: chicago_timeseries,
    fred_latest,
    fred_histories,
    series_catalog: SERIES_MAP,
    source_notes: notes,
    fetched_at: new Date().toISOString(),
  };
}

export { SERIES_MAP, fetchFredSeries, fetchChicagoFedLabor };
