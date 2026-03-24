export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.SERPAPI_KEY || process.env.VITE_SERPAPI_KEY || req.query.api_key;
  if (!key) return res.status(500).json({ error: "SERPAPI key not configured. Set SERPAPI_KEY in Vercel Environment Variables (Settings > Environment Variables). The key must be the non-VITE_ prefixed version for serverless functions." });

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== "api_key") params.set(k, v);
  }
  params.set("api_key", key);
  if (!params.get("engine")) params.set("engine", "google_trends");
  if (!params.get("data_type")) params.set("data_type", "TIMESERIES");

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
      return res.status(response.status).json({ error: "SerpAPI key invalid or expired. Check your SERPAPI_KEY in Vercel Environment Variables." });
    }
    if (response.status === 402) {
      return res.status(402).json({ error: "SerpAPI credits exhausted. Check your plan at serpapi.com/manage-api" });
    }
    if (!response.ok) {
      return res.status(response.status).json({ error: `SerpAPI error ${response.status}: ${txt.slice(0, 200)}` });
    }

    let data;
    try { data = JSON.parse(txt); } catch { return res.status(502).json({ error: "Invalid JSON from SerpAPI" }); }

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=1800");
    return res.status(200).json(data);
  } catch (e) {
    if (e.name === "AbortError") {
      return res.status(504).json({ error: "SerpAPI request timed out after 15s" });
    }
    return res.status(500).json({ error: e.message || "Upstream request failed" });
  }
}
