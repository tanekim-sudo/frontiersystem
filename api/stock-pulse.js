/**
 * AI-relevant stock pulse — Yahoo Finance quotes + optional SerpAPI news line per name.
 * GET /api/stock-pulse?tickers=MSFT,AAPL,NVDA,GOOGL,META,PLTR,ANTH
 * ANTH is synthetic (private); others use Yahoo delayed quote.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const DEFAULT_TICKERS = ["MSFT", "AAPL", "NVDA", "GOOGL", "META", "PLTR", "ANTH"];

const NOTE_FALLBACK = {
  MSFT: "Azure / M365 vs AI capex — watch margin mix and datacenter spend cadence.",
  AAPL: "Device cycle and China; Services attach supports the multiple.",
  NVDA: "Datacenter GPU demand vs custom silicon — core read-through for AI infra.",
  GOOGL: "Search TAC, Cloud/TPU, and open-model distribution vs API growth.",
  META: "Reels monetization and Reality Labs vs GenAI capex and Llama ecosystem.",
  PLTR: "Gov + commercial AIP seats vs deal timing and valuation sensitivity.",
  ANTH: "Private LLM leader — no tape; track enterprise ARR, resale, and compute economics.",
};

function isoWeekKeyUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

async function fetchSerpNewsLine(apiKey, query) {
  const params = new URLSearchParams({
    engine: "google_news",
    api_key: apiKey,
    q: query,
    gl: "us",
    hl: "en",
  });
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "AISignalDashboard/1.0" },
    signal: controller.signal,
  });
  clearTimeout(t);
  if (!res.ok) return null;
  const data = await res.json();
  const first = (data.news_results || [])[0];
  const title = first?.title || first?.snippet;
  if (!title) return null;
  return String(title).slice(0, 160);
}

async function fetchYahooQuotes(symbols) {
  if (!symbols.length) return [];
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Yahoo quote ${res.status}: ${t.slice(0, 120)}`);
  }
  const json = await res.json();
  if (json.quoteResponse?.error) {
    throw new Error(String(json.quoteResponse.error.description || json.quoteResponse.error));
  }
  const arr = json.quoteResponse?.result;
  if (!Array.isArray(arr)) return [];
  return arr;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const serpKey = (process.env.SERPAPI_KEY || process.env.VITE_SERPAPI_KEY || req.query.api_key || "").trim();

  const raw = (req.query.tickers || DEFAULT_TICKERS.join(","))
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const order = raw.length ? raw : DEFAULT_TICKERS;
  const publicSyms = [...new Set(order.filter((t) => t !== "ANTH"))];

  const week_key = isoWeekKeyUTC(new Date());
  const yahooBySymbol = {};

  try {
    if (publicSyms.length) {
      const quotes = await fetchYahooQuotes(publicSyms);
      for (const q of quotes) {
        if (q?.symbol) yahooBySymbol[q.symbol] = q;
      }
    }
  } catch (e) {
    return res.status(502).json({ error: e.message || "Yahoo Finance unavailable", week_key });
  }

  const noteTasks = order.map(async (ticker) => {
    if (!serpKey) return { ticker, note: null };
    const q =
      ticker === "ANTH"
        ? "Anthropic AI funding OR valuation OR revenue"
        : `${ticker} stock OR earnings OR guidance`;
    try {
      const note = await fetchSerpNewsLine(serpKey, q);
      return { ticker, note };
    } catch {
      return { ticker, note: null };
    }
  });
  const noteResults = await Promise.all(noteTasks);
  const noteByTicker = Object.fromEntries(noteResults.map((r) => [r.ticker, r.note]));

  const stocks = [];

  for (const ticker of order) {
    if (ticker === "ANTH") {
      stocks.push({
        ticker: "ANTH",
        name: "Anthropic",
        private: true,
        price: null,
        priceDisplay: "—",
        changePct: null,
        changeLabel: "Private",
        fiftyTwoWeekChangePct: null,
        note: noteByTicker.ANTH || NOTE_FALLBACK.ANTH,
        noteSource: noteByTicker.ANTH ? "news" : "fallback",
      });
      continue;
    }

    const q = yahooBySymbol[ticker];
    if (!q) {
      stocks.push({
        ticker,
        name: ticker,
        price: null,
        priceDisplay: "—",
        changePct: null,
        changeLabel: "—",
        fiftyTwoWeekChangePct: null,
        note: noteByTicker[ticker] || NOTE_FALLBACK[ticker] || "",
        noteSource: noteByTicker[ticker] ? "news" : "fallback",
        yahooError: "No quote",
      });
      continue;
    }

    const price = q.regularMarketPrice;
    const pct = q.regularMarketChangePercent;
    const w52 = q.fiftyTwoWeekChangePercent;
    const priceDisplay =
      price != null && Number.isFinite(Number(price))
        ? q.currency === "USD"
          ? `$${Number(price).toFixed(2)}`
          : `${Number(price).toFixed(2)} ${q.currency || ""}`.trim()
        : "—";

    let changeLabel = "—";
    if (pct != null && Number.isFinite(Number(pct))) {
      const n = Number(pct);
      changeLabel = `${n >= 0 ? "+" : ""}${n.toFixed(1)}% 1d`;
    }
    if (w52 != null && Number.isFinite(Number(w52))) {
      const w = Number(w52);
      changeLabel =
        changeLabel === "—"
          ? `${w >= 0 ? "+" : ""}${w.toFixed(1)}% 52w`
          : `${changeLabel} · ${w >= 0 ? "+" : ""}${w.toFixed(1)}% 52w`;
    }

    stocks.push({
      ticker,
      name: q.shortName || q.longName || ticker,
      private: false,
      price,
      priceDisplay,
      changePct: pct != null ? Number(pct) : null,
      changeLabel,
      fiftyTwoWeekChangePct: w52 != null ? Number(w52) : null,
      note: noteByTicker[ticker] || NOTE_FALLBACK[ticker] || "",
      noteSource: noteByTicker[ticker] ? "news" : "fallback",
      marketState: q.marketState || null,
    });
  }

  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=60");
  return res.status(200).json({
    fetched_at: new Date().toISOString(),
    week_key,
    tickers: order,
    stocks,
    serp_notes: Boolean(serpKey),
  });
}
