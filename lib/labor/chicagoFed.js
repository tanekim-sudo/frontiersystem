/**
 * Chicago Fed Labor Market Indicators xlsx (free, no key).
 * Mirrors rays_tracker/collectors/chicago_fed_collector.py
 */
import * as XLSX from "xlsx";

export const CHICAGO_FED_URL =
  "https://www.chicagofed.org/-/media/publications/chicago-fed-labor-market-indicators/chi-labor-market-indicators.xlsx";

const UA = "RaysCapital-Research/1.0";

function findSheet(names, pred) {
  for (const n of names) {
    if (pred(n)) return n;
  }
  return null;
}

function cleanCell(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isNaN(v)) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  return v;
}

function num(x) {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normDateKey(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  return null;
}

/**
 * @param {Buffer|ArrayBuffer} content
 */
export function parseChicagoFedExcel(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
  const sheetNames = wb.SheetNames;

  const ratesName = findSheet(sheetNames, (s) => s.trim().startsWith("1.") && s.includes("Rates"));
  const rtName = findSheet(
    sheetNames,
    (s) => s.includes("Real-Time UR") && !s.includes("Contributions") && !s.includes("Probs"),
  );
  if (!ratesName || !rtName) {
    throw new Error(`Unexpected workbook sheets: ${sheetNames.join(", ")}`);
  }

  const ratesRows = XLSX.utils.sheet_to_json(wb.Sheets[ratesName], { defval: null });
  const rates = ratesRows
    .map((r) => ({
      ...r,
      _d: normDateKey(r.date),
    }))
    .filter((r) => r._d);

  const rtAoa = XLSX.utils.sheet_to_json(wb.Sheets[rtName], { header: 1, defval: null });
  const headerRow = rtAoa[1];
  if (!headerRow || !headerRow.length) {
    throw new Error("Real-Time UR sheet missing header row");
  }
  const rt = [];
  for (let i = 2; i < rtAoa.length; i++) {
    const row = rtAoa[i];
    if (!row || !row.length) continue;
    const o = {};
    headerRow.forEach((h, j) => {
      if (h != null && h !== "") o[h] = row[j];
    });
    const dk = normDateKey(o.date);
    if (dk) rt.push({ ...o, _d: dk });
  }

  const ratesByD = Object.fromEntries(rates.map((r) => [r._d, r]));
  const rateCols = ["layoffs_other_seps", "hiring_rate_uw", "fcr", "s", "f"];
  const merged = rt.map((row) => {
    const extra = ratesByD[row._d];
    const out = { ...row };
    if (extra) {
      for (const c of rateCols) {
        if (extra[c] != null && extra[c] !== "") out[c] = extra[c];
      }
    }
    return out;
  });
  merged.sort((a, b) => a._d.localeCompare(b._d));
  if (!merged.length) throw new Error("No merged Chicago Fed rows");

  const last = merged[merged.length - 1];
  const latest = {};
  for (const [k, v] of Object.entries(last)) {
    latest[k] = cleanCell(v);
  }

  const ratesClean = rates.filter((r) => num(r.layoffs_other_seps) != null);
  const lastRates = ratesClean.length ? ratesClean[ratesClean.length - 1] : {};

  const releaseRaw = latest.date || latest._d;
  const releaseS = typeof releaseRaw === "string" ? releaseRaw.slice(0, 10) : normDateKey(releaseRaw) || "";

  let lo = num(latest.forecast25f);
  if (lo == null) lo = num(latest.forecast25a);
  let hi = num(latest.forecast75f);
  if (hi == null) hi = num(latest.forecast75a);
  const fc50f = num(latest.forecast50f);
  const fc50a = num(latest.forecast50a);
  const forecastU = fc50f != null ? fc50f : fc50a;

  let lay = num(latest.layoffs_other_seps);
  let hire = num(latest.hiring_rate_uw);
  if (lay == null && lastRates.layoffs_other_seps != null) lay = num(lastRates.layoffs_other_seps);
  if (hire == null && lastRates.hiring_rate_uw != null) hire = num(lastRates.hiring_rate_uw);

  const official = num(latest.official_u3);

  const raw = {
    sheet_names: sheetNames,
    latest_release_date: releaseS,
    latest_row: latest,
    source_url: CHICAGO_FED_URL,
  };

  return {
    release_date: releaseS,
    forecast_unemployment: forecastU,
    forecast_50pct_lower: lo,
    forecast_50pct_upper: hi,
    layoffs_separations_rate: lay,
    hiring_rate_unemployed: hire,
    official_u3: official,
    raw,
  };
}

export async function downloadChicagoFedXlsx() {
  const res = await fetch(CHICAGO_FED_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Chicago Fed download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchChicagoFedLabor() {
  const buf = await downloadChicagoFedXlsx();
  return parseChicagoFedExcel(buf);
}
