import React, { useMemo } from "react";
import { Surface } from "../../components/ui/Surface.jsx";
import { colors } from "../../theme/tokens.js";

function buildBrief({ layer, company, signals, alerts }) {
  const rows = signals || [];
  const byMetric = new Map();
  for (const r of rows) {
    if (!byMetric.has(r.metric_id)) byMetric.set(r.metric_id, []);
    byMetric.get(r.metric_id).push(r);
  }
  const keyMoves = [...byMetric.entries()].map(([metric, points]) => {
    const sorted = [...points].sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)));
    const last = sorted.at(-1);
    const prev = sorted.at(-2);
    const l = Number(last?.value_numeric);
    const p = Number(prev?.value_numeric);
    const pct = Number.isFinite(l) && Number.isFinite(p) && p !== 0 ? ((l - p) / Math.abs(p)) * 100 : null;
    return { metric, last: last?.value_numeric ?? null, pct };
  }).slice(0, 8);

  return [
    `# Live Brief — ${layer}`,
    "",
    `Company focus: ${company?.name || "N/A"}`,
    "",
    "## What changed",
    ...keyMoves.map((m) => `- ${m.metric}: ${m.last ?? "n/a"}${m.pct == null ? "" : ` (${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(1)}%)`}`),
    "",
    "## Alert context",
    `- Threshold hits: ${(alerts?.threshold_hits || []).length}`,
    `- Run-health warnings: ${(alerts?.run_health || []).length}`,
    "",
    "## PM Actions",
    "- Validate top threshold breaches against source confidence and recency.",
    "- Prioritize fresh collection runs for stale companies and lagging metrics.",
    "- Reweight portfolio conviction where cross-company momentum diverges.",
  ].join("\n");
}

export function AlertsAndBriefPanel({ layer, company, signals, alerts }) {
  const briefText = useMemo(() => buildBrief({ layer, company, signals, alerts }), [layer, company, signals, alerts]);
  return (
    <Surface style={{ padding: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Live Alerts</div>
          <div style={{ maxHeight: 220, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {(alerts?.threshold_hits || []).map((a, idx) => (
              <div key={`${a.company_id}_${a.metric_id}_${idx}`} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "7px 9px", background: colors.panelAlt }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{a.company_name} · {a.metric_name}</div>
                <div style={{ fontSize: 10, color: colors.textMuted }}>
                  {a.value_numeric} vs threshold {a.threshold_value} · {(a.observed_at || "").slice(0, 10)}
                </div>
              </div>
            ))}
            {(alerts?.run_health || []).map((r, idx) => (
              <div key={`${r.collector_id}_${idx}`} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "7px 9px", background: "rgba(255,107,107,.08)" }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{r.collector_id}</div>
                <div style={{ fontSize: 10, color: colors.textMuted }}>{r.status} · {(r.started_at || "").slice(0, 16).replace("T", " ")}</div>
              </div>
            ))}
            {!((alerts?.threshold_hits || []).length + (alerts?.run_health || []).length) && (
              <div style={{ color: colors.textMuted, fontSize: 12 }}>No active alerts.</div>
            )}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Live Brief Workspace</div>
          <textarea
            readOnly
            value={briefText}
            style={{
              width: "100%",
              minHeight: 240,
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: colors.panelAlt,
              color: colors.text,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
              lineHeight: 1.5,
              padding: 10,
              resize: "vertical",
            }}
          />
        </div>
      </div>
    </Surface>
  );
}
