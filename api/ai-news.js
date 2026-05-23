/**
 * SerpAPI Google News — curated items for **AI / compute demand** (not generic stock spam).
 * GET /api/ai-news?q=...&hl=en&gl=us
 */

/** Tight query: infra + semis + hyperscalers, crossed with outcomes (earnings/capex/demand). */
const DEFAULT_Q = `((TSMC OR NVIDIA OR ASML OR Micron OR "data center" OR datacenter OR hyperscaler OR "AI chip" OR GPU OR inference OR "OpenAI" OR Anthropic OR "Google Cloud" OR Azure OR "AWS" OR "Meta AI") (earnings OR revenue OR capex OR forecast OR demand OR supply OR backlog OR semiconductor OR foundry OR "beat estimates"))`;

/** Pull more from SerpAPI, then rank down to a short list. */
const RAW_CAP = 36;
const OUT_CAP = 6;

const TITLE_SPAM_RE =
  /\b(top\s*\d+|under\s*\$\d+|if you (had|invested)|try not to cry|stocks?\s+to\s+watch|promising\s+\w*\s*stocks?|won'?t believe|shocking|moonshot|to the moon|click (here|now)|subscribe|one (weird )?trick|you'?ll never|get rich|penny stock)\b/i;

const TITLE_NOISE_RE =
  /\b(allbirds|footwear|shoe(s)?\b.*\bAI|pivot(s)? from shoes|illinois state lawmakers?|state lawmakers?\s+work toward|explores regulatory use)\b/i;

const TITLE_WEAK_RE = /\bavid\b.*\b(google cloud|partnership)\b|top\s+\d+\s+ai\s+stocks?\b/i;

const DEMAND_SIGNAL_RE =
  /\b(tsmc|nvidia|asml|micron|amd|intel|blackwell|h100|b200|gpu|tpu|asic|foundry|wafer|cowos|advanced packaging|datacenter|data center|hyperscaler|capex|cloud (spend|revenue)|inference|training cluster|ai chip|semiconductor|fab\b|backlog|lead times|hbm|memory\b|earnings|revenue|forecast|demand|supply|shortage|allocation|raised guidance|beats? estimates)\b/i;

const TIER1_SOURCE_RE =
  /reuters|bloomberg|financial times|ft\.com|\bft\b|wsj|wall street journal|cnbc|the information|axios|techcrunch|arstechnica|wired|the verge|economist/i;

function scoreArticle(a) {
  const blob = `${a.title || ""} ${a.snippet || ""}`.toLowerCase();
  let s = 0;
  if (DEMAND_SIGNAL_RE.test(blob)) s += 4;
  if (TIER1_SOURCE_RE.test(String(a.source || "").toLowerCase())) s += 2;
  if (/(earnings|revenue|profit|forecast|guidance|demand|backlog|raised|beat)/i.test(blob)) s += 2;
  if (/(regulation|lawmaker|bill|senate|congress|eu ai act|ftc|sec\b)/i.test(blob) && /federal|congress|eu |sec |ftc /i.test(blob)) s += 0.5;
  if (TITLE_SPAM_RE.test(a.title || "") || TITLE_NOISE_RE.test(a.title || "") || TITLE_WEAK_RE.test(a.title || "")) s -= 20;
  if (/\b(state|city|county)\s+(lawmaker|senator|rep\.)\b/i.test(blob) && !/\b(federal|congress|white house)\b/i.test(blob)) s -= 3;
  const tlen = (a.title || "").length;
  if (tlen > 0 && tlen < 28) s -= 1;
  return s;
}

function filterAndRankNews(raw) {
  const rows = (raw || [])
    .map((r) => ({
      title: r.title || "",
      source: typeof r.source === "string" ? r.source : r.source?.name || "",
      date: r.date || "",
      snippet: (r.snippet || r.summary || "").slice(0, 220),
      link: r.link || "",
    }))
    .filter((a) => a.title.length > 12);

  const scored = rows
    .map((a) => ({ ...a, _score: scoreArticle(a) }))
    .filter((a) => a._score >= 2)
    .sort((x, y) => y._score - x._score);

  const seen = new Set();
  const out = [];
  const pushUnique = (a, rel) => {
    const key = a.title.slice(0, 48).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      title: a.title,
      source: a.source,
      date: a.date,
      snippet: a.snippet,
      link: a.link,
      relevance: rel,
    });
  };

  for (const a of scored) {
    pushUnique(a, Math.round(Math.min(10, Math.max(1, a._score))));
    if (out.length >= OUT_CAP) break;
  }

  if (!out.length && rows.length) {
    const loose = rows
      .filter((a) => !TITLE_SPAM_RE.test(a.title) && !TITLE_NOISE_RE.test(a.title) && !TITLE_WEAK_RE.test(a.title))
      .slice(0, OUT_CAP);
    loose.forEach((a) => {
      if (out.length >= OUT_CAP) return;
      pushUnique(a, 1);
    });
  }

  return { articles: out, raw_count: rows.length, filtered_count: scored.length };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.SERPAPI_KEY || process.env.VITE_SERPAPI_KEY || req.query.api_key;
  if (!key) {
    return res.status(500).json({
      error:
        "SERPAPI key not configured. Set SERPAPI_KEY in Vercel Environment Variables (or .env for local dev).",
    });
  }

  const q = req.query.q || DEFAULT_Q;
  const hl = req.query.hl || "en";
  const gl = req.query.gl || "us";

  const params = new URLSearchParams({
    engine: "google_news",
    api_key: key,
    q: String(q),
    hl: String(hl),
    gl: String(gl),
  });

  const url = `https://serpapi.com/search.json?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "AISignalDashboard/1.0" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const txt = await response.text();

    if (response.status === 401 || response.status === 403) {
      return res.status(response.status).json({ error: "SerpAPI key invalid or expired." });
    }
    if (response.status === 402) {
      return res.status(402).json({ error: "SerpAPI credits exhausted." });
    }
    if (!response.ok) {
      return res.status(response.status).json({ error: `SerpAPI error ${response.status}: ${txt.slice(0, 200)}` });
    }

    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      return res.status(502).json({ error: "Invalid JSON from SerpAPI" });
    }

    const raw = (data.news_results || []).slice(0, RAW_CAP);
    const { articles, raw_count, filtered_count } = filterAndRankNews(raw);

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=120");
    return res.status(200).json({
      fetched_at: new Date().toISOString(),
      query: q,
      articles,
      curation: {
        raw_count,
        filtered_count,
        shown: articles.length,
        cap: OUT_CAP,
        note: "Ranked for AI / compute / cloud demand signals; clickbait and most local political items removed.",
      },
    });
  } catch (e) {
    if (e.name === "AbortError") {
      return res.status(504).json({ error: "SerpAPI request timed out after 15s" });
    }
    return res.status(500).json({ error: e.message || "Upstream request failed" });
  }
}
