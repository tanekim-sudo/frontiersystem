import React from "react";
import { Surface } from "../../components/ui/Surface.jsx";
import { colors } from "../../theme/tokens.js";

export function CompanyGrid({ companies, activeLayer, selectedCompanyId, onSelect }) {
  const filtered = (companies || []).filter((c) => !activeLayer || c.layer === activeLayer);
  return (
    <Surface style={{ padding: 12, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>Company Universe</div>
        <div style={{ fontSize: 11, color: colors.textMuted }}>{filtered.length} active companies in layer</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
        {filtered.map((c) => {
          const active = c.id === selectedCompanyId;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              style={{
                textAlign: "left",
                borderRadius: 10,
                border: `1px solid ${active ? "rgba(67,217,255,.55)" : colors.border}`,
                background: active ? "rgba(67,217,255,.1)" : colors.panelAlt,
                color: colors.text,
                padding: "9px 10px",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700 }}>{c.name}</div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                {c.ticker ? `${c.ticker} · ` : ""}{c.industry || "Unclassified"}
              </div>
            </button>
          );
        })}
      </div>
    </Surface>
  );
}
