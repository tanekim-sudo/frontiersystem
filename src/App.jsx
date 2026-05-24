import React, { useCallback, useEffect, useMemo, useState } from "react";
import LegacyApp from "../AISignalDashboard.jsx";
import { DashboardShell } from "./layout/DashboardShell.jsx";
import { fetchCompanies, fetchCompanySignals, fetchLayerOverview, fetchLiveAlerts } from "./domain/liveApi.js";
import { LayerOverviewPanel } from "./features/live/LayerOverviewPanel.jsx";
import { CompanyGrid } from "./features/live/CompanyGrid.jsx";
import { CompanySignalsPanel } from "./features/live/CompanySignalsPanel.jsx";
import { AlertsAndBriefPanel } from "./features/live/AlertsAndBriefPanel.jsx";
import { RealityCheckPanel } from "./features/live/RealityCheckPanel.jsx";

export default function App() {
  const [viewMode, setViewMode] = useState(() => {
    try {
      const v = localStorage.getItem("frontier_view_mode");
      return v === "live" || v === "legacy" ? v : "legacy";
    } catch {
      return "legacy";
    }
  });
  const [activeLayer, setActiveLayer] = useState("agent");
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [layerOverview, setLayerOverview] = useState(null);
  const [companySignals, setCompanySignals] = useState([]);
  const [alerts, setAlerts] = useState({ threshold_hits: [], run_health: [] });
  const [error, setError] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [liveModeAvailable, setLiveModeAvailable] = useState(true);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  );
  const isDegradedMode = useMemo(
    () => (alerts?.run_health || []).some((r) => r.status === "degraded_no_database" || String(r.error_message || "").includes("DATABASE_URL")),
    [alerts],
  );

  useEffect(() => {
    try {
      localStorage.setItem("frontier_view_mode", viewMode);
    } catch {}
  }, [viewMode]);

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
        const sig = await fetchCompanySignals(companyId, 180);
        setCompanySignals(sig);
      } else {
        setCompanySignals([]);
      }
      setLastFetchedAt(new Date());
      setLiveModeAvailable(true);
    } catch (e) {
      setError(e.message || String(e));
      setLiveModeAvailable(false);
    }
  }, [activeLayer, selectedCompanyId]);

  useEffect(() => {
    loadLive();
  }, [loadLive]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    fetchCompanySignals(selectedCompanyId, 180)
      .then((d) => setCompanySignals(d))
      .catch((e) => setError(e.message || String(e)));
  }, [selectedCompanyId]);

  const freshnessLabel = lastFetchedAt
    ? `${Math.max(0, Math.round((Date.now() - lastFetchedAt.getTime()) / 60000))}m ago`
    : "n/a";

  const ModeToggle = (
    <div
      style={{
        position: "fixed",
        right: 14,
        top: 14,
        zIndex: 9999,
        display: "flex",
        gap: 6,
        background: "rgba(9,13,24,.85)",
        border: "1px solid rgba(255,255,255,.18)",
        borderRadius: 10,
        padding: 6,
        backdropFilter: "blur(8px)",
      }}
    >
      <button
        onClick={() => setViewMode("legacy")}
        style={{
          border: "1px solid rgba(255,255,255,.2)",
          background: viewMode === "legacy" ? "rgba(67,217,255,.22)" : "rgba(255,255,255,.06)",
          color: "#e9f0ff",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Legacy Signal Stack
      </button>
      <button
        onClick={() => setViewMode("live")}
        style={{
          border: "1px solid rgba(255,255,255,.2)",
          background: viewMode === "live" ? "rgba(67,217,255,.22)" : "rgba(255,255,255,.06)",
          color: "#e9f0ff",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Frontier Live Mode
      </button>
    </div>
  );

  if (viewMode === "legacy") {
    return (
      <div>
        {ModeToggle}
        <div style={{ background: "#172338", color: "#cfe3ff", padding: "8px 12px", fontFamily: "Inter, sans-serif", fontSize: 12 }}>
          Legacy signal infrastructure and graph dashboard restored as primary mode. Use the top-right toggle to open the new live platform mode.
        </div>
        <LegacyApp />
      </div>
    );
  }

  return (
    <>
      {ModeToggle}
      {!liveModeAvailable && (
        <div style={{ background: "#2b1d1d", color: "#ffd4d4", padding: "8px 12px", fontFamily: "Inter, sans-serif", fontSize: 12 }}>
          Live mode warning: {error || "unknown error"}.
        </div>
      )}
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
      </DashboardShell>
    </>
  );
}
