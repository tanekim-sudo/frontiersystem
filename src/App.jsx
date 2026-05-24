import React, { useCallback, useEffect, useMemo, useState } from "react";
import LegacyApp from "../AISignalDashboard.jsx";
import { DashboardShell } from "./layout/DashboardShell.jsx";
import { fetchCompanies, fetchCompanySignals, fetchLayerOverview, fetchLiveAlerts } from "./domain/liveApi.js";
import { LayerOverviewPanel } from "./features/live/LayerOverviewPanel.jsx";
import { CompanyGrid } from "./features/live/CompanyGrid.jsx";
import { CompanySignalsPanel } from "./features/live/CompanySignalsPanel.jsx";
import { AlertsAndBriefPanel } from "./features/live/AlertsAndBriefPanel.jsx";
import { RealityCheckPanel } from "./features/live/RealityCheckPanel.jsx";

const LIVE_HISTORY_KEY = "sid_v3_live_histories";

function readLiveHistories() {
  try {
    const raw = localStorage.getItem(LIVE_HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLiveHistories(histories) {
  try {
    localStorage.setItem(LIVE_HISTORY_KEY, JSON.stringify(histories));
  } catch {}
}

function mergeSignals(existing, incoming) {
  const map = new Map();
  for (const row of existing || []) {
    const k = `${row.metric_id}|${row.observed_at}|${row.source_id || ""}`;
    map.set(k, row);
  }
  for (const row of incoming || []) {
    const k = `${row.metric_id}|${row.observed_at}|${row.source_id || ""}`;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)));
}

export default function App() {
  const [activeLayer, setActiveLayer] = useState("agent");
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [layerOverview, setLayerOverview] = useState(null);
  const [companySignals, setCompanySignals] = useState([]);
  const [alerts, setAlerts] = useState({ threshold_hits: [], run_health: [] });
  const [error, setError] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [showLegacyFullscreen, setShowLegacyFullscreen] = useState(false);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  );
  const isDegradedMode = useMemo(
    () => (alerts?.run_health || []).some((r) => r.status === "degraded_no_database" || String(r.error_message || "").includes("DATABASE_URL")),
    [alerts],
  );

  const loadLive = useCallback(async () => {
    try {
      setError(null);
      const [co, lo, al] = await Promise.all([
        fetchCompanies(),
        fetchLayerOverview(activeLayer),
        fetchLiveAlerts(),
      ]);
      setCompanies(co);
      setLayerOverview(lo);
      setAlerts(al);
      const selectedStillValid = selectedCompanyId && co.some((x) => x.id === selectedCompanyId && x.layer === activeLayer);
      const companyId = selectedStillValid ? selectedCompanyId : (co.find((x) => x.layer === activeLayer)?.id || co[0]?.id || null);
      setSelectedCompanyId(companyId);
      if (companyId) {
        const localHist = readLiveHistories();
        const localSeries = Array.isArray(localHist[companyId]) ? localHist[companyId] : [];
        if (localSeries.length) setCompanySignals(localSeries);
        const sig = await fetchCompanySignals(companyId, 180);
        const merged = mergeSignals(localSeries, sig || []);
        const nextHist = { ...localHist, [companyId]: merged.slice(-1200) };
        writeLiveHistories(nextHist);
        setCompanySignals(nextHist[companyId]);
      } else {
        setCompanySignals([]);
      }
      setLastFetchedAt(new Date());
    } catch (e) {
      setError(e.message || String(e));
    }
  }, [activeLayer, selectedCompanyId]);

  useEffect(() => {
    loadLive();
  }, [loadLive]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    const localHist = readLiveHistories();
    const localSeries = Array.isArray(localHist[selectedCompanyId]) ? localHist[selectedCompanyId] : [];
    if (localSeries.length) setCompanySignals(localSeries);
    fetchCompanySignals(selectedCompanyId, 180)
      .then((d) => {
        const merged = mergeSignals(localSeries, d || []);
        const nextHist = { ...localHist, [selectedCompanyId]: merged.slice(-1200) };
        writeLiveHistories(nextHist);
        setCompanySignals(nextHist[selectedCompanyId]);
      })
      .catch((e) => setError(e.message || String(e)));
  }, [selectedCompanyId]);

  const freshnessLabel = lastFetchedAt
    ? `${Math.max(0, Math.round((Date.now() - lastFetchedAt.getTime()) / 60000))}m ago`
    : "n/a";

  return (
    <>
      <DashboardShell
        activeLayer={activeLayer}
        onLayerChange={setActiveLayer}
        freshnessLabel={freshnessLabel}
        runHealthCount={(alerts?.run_health || []).length}
        queueBacklog={0}
        onRefresh={loadLive}
      >
        {error && <div style={{ marginBottom: 10, color: "#ff9fa4", fontWeight: 700 }}>Live warning: {error}</div>}
        <LayerOverviewPanel overview={layerOverview} />
        <CompanyGrid
          companies={companies}
          activeLayer={activeLayer}
          selectedCompanyId={selectedCompanyId}
          onSelect={setSelectedCompanyId}
        />
        <CompanySignalsPanel company={selectedCompany} signals={companySignals} />
        <AlertsAndBriefPanel layer={activeLayer} company={selectedCompany} signals={companySignals} alerts={alerts} />
        <RealityCheckPanel degraded={isDegradedMode} />
        <div style={{ marginTop: 14, border: "1px solid rgba(67,217,255,.25)", borderRadius: 12, padding: 12, background: "rgba(67,217,255,.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Legacy Signal Infrastructure Module</div>
          <div style={{ fontSize: 11, opacity: 0.86, marginBottom: 10 }}>
            The original dashboard is intentionally retained as a compact module in this new shell, and live metrics now persist into the same long-horizon local tracking mechanism.
          </div>
          <button
            onClick={() => setShowLegacyFullscreen(true)}
            style={{
              border: "1px solid rgba(67,217,255,.5)",
              background: "rgba(67,217,255,.14)",
              color: "#dff6ff",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Open Full Legacy Dashboard
          </button>
        </div>
      </DashboardShell>
      {showLegacyFullscreen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 12000 }}>
          <div style={{ position: "absolute", inset: 14, background: "#0b1324", border: "1px solid rgba(255,255,255,.18)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,.12)", color: "#dfe8ff", fontFamily: "Inter, sans-serif" }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Legacy Signal Dashboard (Integrated Module)</div>
              <button
                onClick={() => setShowLegacyFullscreen(false)}
                style={{ border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.08)", color: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}
              >
                Close
              </button>
            </div>
            <div style={{ height: "calc(100% - 44px)", overflow: "auto", background: "#f3f5f9" }}>
              <LegacyApp />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
