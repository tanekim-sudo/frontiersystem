import { fetchChicagoFedLabor } from "../../lib/labor/chicagoFed.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const data = await fetchChicagoFedLabor();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
