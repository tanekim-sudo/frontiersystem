async function parseJson(res) {
  const txt = await res.text();
  try {
    return txt ? JSON.parse(txt) : {};
  } catch {
    return { error: txt || "Invalid JSON response" };
  }
}

export async function fetchCompanies() {
  const res = await fetch("/api/live?resource=companies");
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data || [];
}

export async function fetchLayerOverview(layer) {
  const res = await fetch(`/api/live?resource=layer_overview&layer=${encodeURIComponent(layer)}`);
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data || { layer, metrics: [], leaderboard: [], catalysts: [] };
}

export async function fetchCompanySignals(companyId, days = 120) {
  const res = await fetch(`/api/live?resource=company_signals&company_id=${encodeURIComponent(companyId)}&days=${days}`);
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data || [];
}

export async function fetchLiveAlerts() {
  const res = await fetch("/api/live?resource=alerts");
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data || { threshold_hits: [], run_health: [] };
}

export async function enqueueLiveIngestion(jobs, authToken) {
  const body = Array.isArray(jobs) ? { jobs } : jobs;
  const res = await fetch("/api/live?resource=enqueue", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.jobs || [];
}
