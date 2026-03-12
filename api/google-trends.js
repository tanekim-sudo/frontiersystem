export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.SERPAPI_KEY || process.env.VITE_SERPAPI_KEY || req.query.api_key;
  if (!key) return res.status(500).json({ error: "SERPAPI key not configured. Add SERPAPI_KEY to Vercel environment variables." });

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== "api_key") params.set(k, v);
  }
  params.set("api_key", key);
  if (!params.get("engine")) params.set("engine", "google_trends");
  if (!params.get("data_type")) params.set("data_type", "TIMESERIES");

  const url = `https://serpapi.com/search.json?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    const txt = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: txt.slice(0, 300) });
    }
    let data;
    try { data = JSON.parse(txt); } catch { return res.status(502).json({ error: "Invalid JSON from SerpAPI" }); }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
