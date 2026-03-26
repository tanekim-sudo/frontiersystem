/**
 * Server-side persistence for the Signal Dashboard — reads/writes the same GitHub Gist
 * using a secret PAT that never ships to the browser.
 *
 * Vercel env:
 *   SIGNAL_STORE_SECRET       — long random string; must match VITE_SIGNAL_STORE_SECRET
 *   SIGNAL_DATA_GITHUB_PAT    — GitHub PAT with `gist` scope (server only, not VITE_)
 *   SIGNAL_DATA_GIST_ID       — optional; strongly recommended for production
 */

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();

  const secret = process.env.SIGNAL_STORE_SECRET;
  const auth = req.headers.authorization || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const pat = process.env.SIGNAL_DATA_GITHUB_PAT || process.env.GITHUB_TOKEN || "";
  if (!pat) {
    return res.status(500).json({ error: "SIGNAL_DATA_GITHUB_PAT (or GITHUB_TOKEN) not configured" });
  }

  const gh = (path, opts = {}) =>
    fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.headers || {}),
      },
    });

  if (req.method === "GET") {
    let gistId = (process.env.SIGNAL_DATA_GIST_ID || "").trim();
    if (!gistId) {
      for (let page = 1; page <= 25; page++) {
        const r = await gh(`/gists?per_page=100&page=${page}`);
        if (!r.ok) return res.status(502).json({ error: "GitHub gists list failed" });
        const gists = await r.json();
        if (!Array.isArray(gists) || gists.length === 0) break;
        const found = gists.find((g) => g.description?.includes("Signal Intelligence Dashboard") && g.files?.["signal-data.json"]);
        if (found) {
          gistId = found.id;
          break;
        }
        if (gists.length < 100) break;
      }
    }
    if (!gistId) return res.status(404).json({ empty: true, error: "No signal store gist" });

    const r = await gh(`/gists/${gistId}`);
    if (!r.ok) return res.status(r.status === 404 ? 404 : 502).json({ empty: r.status === 404, error: "Gist fetch failed" });
    const g = await r.json();
    const content = g.files?.["signal-data.json"]?.content;
    if (!content) return res.status(404).json({ empty: true, error: "Gist has no signal-data.json" });
    try {
      const data = JSON.parse(content);
      return res.status(200).json({ data, gistId: g.id });
    } catch {
      return res.status(502).json({ error: "Invalid JSON in gist" });
    }
  }

  if (req.method === "POST" || req.method === "PUT") {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
    }
    const payload = body?.data ?? body;
    if (!payload || typeof payload !== "object") return res.status(400).json({ error: "Missing data object" });

    const content = JSON.stringify(payload);
    const files = { "signal-data.json": { content } };
    let gistId = (process.env.SIGNAL_DATA_GIST_ID || "").trim();

    if (gistId) {
      const r = await gh(`/gists/${gistId}`, {
        method: "PATCH",
        body: JSON.stringify({ files }),
      });
      if (r.ok) return res.status(200).json({ ok: true, gistId });
      if (r.status !== 404) {
        const err = await r.text();
        return res.status(502).json({ error: err.slice(0, 300) });
      }
      gistId = "";
    }

    const r = await gh("/gists", {
      method: "POST",
      body: JSON.stringify({ description: GIST_DESC, public: false, files }),
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(502).json({ error: err.slice(0, 300) });
    }
    const g = await r.json();
    return res.status(201).json({ ok: true, gistId: g.id, hint: "Set SIGNAL_DATA_GIST_ID in Vercel to this id for stable binding" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
