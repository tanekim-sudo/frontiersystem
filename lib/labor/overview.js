import { fetchChicagoFedLabor } from "./chicagoFed.js";
import { fetchAllFredLatest, SERIES_MAP, fetchFredSeries } from "./fred.js";

/**
 * @param {{ fredApiKey?: string }} opts
 */
export async function buildLaborOverview(opts = {}) {
  const notes = [];
  const fredKey = (opts.fredApiKey || "").trim();

  let chicago = null;
  try {
    const parsed = await fetchChicagoFedLabor();
    chicago = {
      release_date: parsed.release_date,
      forecast_unemployment: parsed.forecast_unemployment,
      layoffs_separations_rate: parsed.layoffs_separations_rate,
      hiring_rate_unemployed: parsed.hiring_rate_unemployed,
      forecast_50pct_lower: parsed.forecast_50pct_lower,
      forecast_50pct_upper: parsed.forecast_50pct_upper,
      official_u3: parsed.official_u3,
      source: "chicago_fed_xlsx",
    };
  } catch (e) {
    notes.push(`Chicago Fed: ${e.message || e}`);
  }

  let fred_latest = [];
  if (!fredKey) {
    notes.push("FRED: set FRED_API_KEY in Vercel (or .env locally) for macro series.");
  } else {
    try {
      const bundle = await fetchAllFredLatest(fredKey);
      fred_latest = Object.entries(bundle).map(([id, x]) => ({
        series_id: id,
        name: x.meta?.name,
        type: x.meta?.type,
        date: x.latest?.date ?? null,
        value: x.latest?.value ?? null,
        error: x.error,
      }));
    } catch (e) {
      notes.push(`FRED: ${e.message || e}`);
    }
  }

  return {
    chicago_fed: chicago,
    fred_latest,
    source_notes: notes,
    fetched_at: new Date().toISOString(),
  };
}

export { SERIES_MAP, fetchFredSeries, fetchChicagoFedLabor };
