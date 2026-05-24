import React, { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Surface } from "../../components/ui/Surface.jsx";
import { colors } from "../../theme/tokens.js";

export function CompanySignalsPanel({ company, signals }) {
  const grouped = useMemo(() => {
    const map = new Map();
    for (const s of signals || []) {
      if (!map.has(s.metric_id)) map.set(s.metric_id, []);
      map.get(s.metric_id).push({
        date: (s.observed_at || "").slice(0, 10),
        value: s.value_numeric == null ? null : Number(s.value_numeric),
      });
    }
    for (const [k, v] of map.entries()) {
      v.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      map.set(k, v.slice(-30));
    }
    return map;
  }, [signals]);

  return (
    <Surface style={{ padding: 12, marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>
        {company?.name || "Company"} Signal Trajectories
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 10 }}>
        {[...grouped.entries()].map(([metricId, series]) => (
          <div key={metricId} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: 8, background: colors.panelAlt }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{metricId}</div>
            <div style={{ width: "100%", height: 140 }}>
              <ResponsiveContainer>
                <LineChart data={series}>
                  <XAxis dataKey="date" tick={{ fill: colors.textMuted, fontSize: 9 }} />
                  <YAxis tick={{ fill: colors.textMuted, fontSize: 9 }} width={40} />
                  <Tooltip contentStyle={{ background: "#0f1730", border: `1px solid ${colors.border}`, borderRadius: 8 }} />
                  <Line type="monotone" dataKey="value" stroke={colors.accent} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
        {!grouped.size && <div style={{ color: colors.textMuted, fontSize: 12 }}>No signal history available yet for this company.</div>}
      </div>
    </Surface>
  );
}
