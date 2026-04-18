/**
 * SerpAPI Google News — AI / tech market headlines for the dashboard pulse strip.
 * GET /api/ai-news?q=...&hl=en&gl=us
 */
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

  const q =
    req.query.q ||
    "(artificial intelligence OR generative AI OR NVIDIA OR OpenAI OR Anthropic OR TSMC OR hyperscaler) (stock OR earnings OR chip OR cloud OR capex OR regulation)";
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

    const raw = data.news_results || [];
    const articles = raw.slice(0, 14).map((r) => ({
      title: r.title || "",
      source: typeof r.source === "string" ? r.source : r.source?.name || "",
      date: r.date || "",
      snippet: r.snippet || r.summary || "",
      link: r.link || "",
    }));

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=120");
    return res.status(200).json({
      fetched_at: new Date().toISOString(),
      query: q,
      articles,
    });
  } catch (e) {
    if (e.name === "AbortError") {
      return res.status(504).json({ error: "SerpAPI request timed out after 15s" });
    }
    return res.status(500).json({ error: e.message || "Upstream request failed" });
  }
}
