import { fetchAllFredLatest, fetchFredSeries, SERIES_MAP } from "../../lib/labor/fred.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const key = (process.env.FRED_API_KEY || "").trim();
  if (!key) {
    return res.status(500).json({
      error: "FRED_API_KEY not configured. Add it in Vercel Environment Variables (server-side, no VITE_ prefix).",
    });
  }

  try {
    const q = req.query || {};
    const series = q.series || q.series_id;
    if (series) {
      const obs = await fetchFredSeries(String(series), key);
      return res.status(200).json({
        series_id: String(series),
        meta: SERIES_MAP[String(series)] || { name: series },
        observations: obs,
      });
    }
    const all = await fetchAllFredLatest(key);
    return res.status(200).json({ series: all });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
