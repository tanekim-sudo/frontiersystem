import React from "react";
import { colors, gradients } from "../../theme/tokens.js";

export function Surface({ children, style = {}, className = "" }) {
  return (
    <div
      className={className}
      style={{
        background: gradients.card,
        border: `1px solid ${colors.border}`,
        borderRadius: 14,
        boxShadow: "0 8px 24px rgba(0,0,0,.25)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
