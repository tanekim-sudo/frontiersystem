import React from "react";
import { colors } from "../../theme/tokens.js";

export function Pill({ children, tone = "neutral" }) {
  const palette = {
    neutral: { bg: "rgba(142,165,203,.12)", color: colors.textMuted, border: "rgba(142,165,203,.35)" },
    good: { bg: "rgba(46,217,140,.12)", color: colors.good, border: "rgba(46,217,140,.35)" },
    warn: { bg: "rgba(255,202,87,.12)", color: colors.warn, border: "rgba(255,202,87,.35)" },
    bad: { bg: "rgba(255,107,107,.12)", color: colors.bad, border: "rgba(255,107,107,.35)" },
    accent: { bg: "rgba(67,217,255,.12)", color: colors.accent, border: "rgba(67,217,255,.35)" },
  };
  const p = palette[tone] || palette.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${p.border}`,
        color: p.color,
        background: p.bg,
      }}
    >
      {children}
    </span>
  );
}
