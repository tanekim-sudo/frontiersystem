export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.VITE_SERPAPI_KEY || req.query.api_key;
  if (!key) return res.status(500).json({ error: "SERPAPI key not configured" });

  const params = new URLSearchParams(req.query);
  params.delete("api_key");
  params.set("api_key", key);
  if (!params.get("engine")) params.set("engine", "google_trends");
  if (!params.get("data_type")) params.set("data_type", "TIMESERIES");

  const url = `https://serpapi.com/search.json?${params.toString()}`;

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      const txt = await response.text();
      return res.status(response.status).json({ error: txt.slice(0, 300) });
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
