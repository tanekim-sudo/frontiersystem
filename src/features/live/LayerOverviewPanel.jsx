import React from "react";
import { Surface } from "../../components/ui/Surface.jsx";
import { colors } from "../../theme/tokens.js";

export function LayerOverviewPanel({ overview }) {
  const metrics = overview?.metrics || [];
  const leaderboard = overview?.leaderboard || [];
  const catalysts = overview?.catalysts || [];
  const scorecards = overview?.scorecards || [];
  const momentum = overview?.momentum || [];

  return (
    <Surface style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.5fr 1fr 1fr", gap: 12 }}>
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Metric Definitions</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflow: "auto" }}>
            {metrics.map((m) => (
              <div key={m.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "7px 9px", background: colors.panelAlt }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{m.name}</div>
                <div style={{ fontSize: 10, color: colors.textMuted }}>{m.cadence} · {m.unit || "index"}</div>
              </div>
            ))}
            {!metrics.length && <div style={{ fontSize: 12, color: colors.textMuted }}>No metrics seeded for this layer yet.</div>}
          </div>
        </div>

        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Leader/Laggard Snapshot</h3>
          <div style={{ maxHeight: 280, overflow: "auto", border: `1px solid ${colors.border}`, borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ color: colors.textMuted }}>
                  <th style={{ textAlign: "left", padding: 8 }}>Company</th>
                  <th style={{ textAlign: "left", padding: 8 }}>Metric</th>
                  <th style={{ textAlign: "right", padding: 8 }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r, idx) => (
                  <tr key={`${r.company_id}_${r.metric_id}_${idx}`}>
                    <td style={{ padding: 8, borderTop: `1px solid ${colors.border}` }}>{r.company_name}</td>
                    <td style={{ padding: 8, borderTop: `1px solid ${colors.border}` }}>{r.metric_id}</td>
                    <td style={{ padding: 8, borderTop: `1px solid ${colors.border}`, textAlign: "right", fontWeight: 700 }}>
                      {r.value_numeric == null ? "-" : Number(r.value_numeric).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {!leaderboard.length && (
                  <tr><td colSpan={3} style={{ padding: 10, color: colors.textMuted }}>No observations loaded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Catalyst Rail</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflow: "auto" }}>
            {catalysts.map((c) => (
              <div key={c.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "7px 9px", background: colors.panelAlt }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{c.title}</div>
                <div style={{ fontSize: 10, color: colors.textMuted }}>{c.event_type} · {c.event_date}</div>
              </div>
            ))}
            {!catalysts.length && <div style={{ fontSize: 12, color: colors.textMuted }}>No catalysts in current window.</div>}
          </div>
        </div>

        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Composite Scorecards</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflow: "auto" }}>
            {scorecards.map((s) => {
              const m = momentum.find((x) => x.company_id === s.company_id);
              return (
                <div key={s.company_id} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "7px 9px", background: colors.panelAlt }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{s.company_id}</div>
                  <div style={{ fontSize: 10, color: colors.textMuted }}>
                    score {Number(s.avg_metric_value || 0).toFixed(2)} · momentum {m?.avg_momentum_pct == null ? "n/a" : `${Number(m.avg_momentum_pct).toFixed(1)}%`}
                  </div>
                </div>
              );
            })}
            {!scorecards.length && <div style={{ fontSize: 12, color: colors.textMuted }}>Scores will populate after first ingestion runs.</div>}
          </div>
        </div>
      </div>
    </Surface>
  );
}
