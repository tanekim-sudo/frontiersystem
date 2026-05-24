import React from "react";
import { colors, font, gradients } from "../theme/tokens.js";
import { Pill } from "../components/ui/Pill.jsx";

const LAYERS = [
  { id: "physical_ai", label: "Physical" },
  { id: "voice", label: "Voice" },
  { id: "spatial", label: "Spatial" },
  { id: "agent", label: "Agent" },
  { id: "neural", label: "Neural" },
];

export function DashboardShell({
  activeLayer,
  onLayerChange,
  freshnessLabel,
  runHealthCount,
  queueBacklog,
  onRefresh,
  children,
}) {
  return (
    <div style={{ minHeight: "100vh", background: gradients.app, color: colors.text, fontFamily: font.sans }}>
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "16px 24px 28px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: colors.textMuted, fontWeight: 700 }}>
              Frontier Interface Transition Engine
            </div>
            <div style={{ fontSize: 25, fontWeight: 800, marginTop: 4 }}>
              Live Interface-Layer Intelligence Dashboard
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Pill tone="accent">Freshness {freshnessLabel}</Pill>
            <Pill tone={runHealthCount > 0 ? "warn" : "good"}>Run Health {runHealthCount}</Pill>
            <Pill tone={queueBacklog > 20 ? "warn" : "neutral"}>Queue {queueBacklog}</Pill>
            <button
              onClick={onRefresh}
              style={{
                border: `1px solid ${colors.border}`,
                background: "rgba(67,217,255,.12)",
                color: colors.accent,
                borderRadius: 10,
                padding: "8px 12px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Refresh Live
            </button>
          </div>
        </header>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {LAYERS.map((l) => {
            const active = l.id === activeLayer;
            return (
              <button
                key={l.id}
                onClick={() => onLayerChange(l.id)}
                style={{
                  borderRadius: 10,
                  border: `1px solid ${active ? "rgba(67,217,255,.5)" : colors.border}`,
                  background: active ? "rgba(67,217,255,.14)" : "rgba(255,255,255,.02)",
                  color: active ? colors.accent : colors.textMuted,
                  fontWeight: 700,
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                {l.label}
              </button>
            );
          })}
        </div>

        {children}
      </div>
    </div>
  );
}
