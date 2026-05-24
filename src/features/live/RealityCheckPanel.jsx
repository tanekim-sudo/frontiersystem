import React from "react";
import { Surface } from "../../components/ui/Surface.jsx";
import { colors } from "../../theme/tokens.js";

const REALIZATION_GUIDE = [
  {
    layer: "Physical AI",
    fakeNow: [
      "Production hours, UR ASP, sim-to-real reliability, and CoRL transfer scores are mock-generated.",
      "No press-release parser or investor disclosure ETL is running yet.",
    ],
    realNeeds: [
      "Press release + investor relations ingestion pipelines per company with source de-dup and unit normalization.",
      "Quarterly earnings extraction rules for ASP/revenue line-items.",
      "Paper ingestion + benchmark extraction (NVIDIA Cosmos/GR00T/Skild/Physical Intelligence).",
    ],
  },
  {
    layer: "Voice",
    fakeNow: [
      "ARR trajectory, ambient DAU/MAU, enterprise job velocity, and latency benchmarks are synthetic.",
      "No direct SDK telemetry or app analytics connectors are active.",
    ],
    realNeeds: [
      "Revenue/funding event parser from disclosures and databases.",
      "GitHub ingestion for commit velocity and SDK repos.",
      "Latency benchmarking runner that executes TTS tests by provider/region on schedule.",
    ],
  },
  {
    layer: "Spatial",
    fakeNow: [
      "Ray-Ban inferred units, SDK downloads, waveguide manufacturing hiring, and Meta Connect impact are mock values.",
      "No supply-chain channel feeds connected.",
    ],
    realNeeds: [
      "Earnings transcript + filing parser for units/revenue inferences.",
      "Developer SDK download source connectors and backlog fill.",
      "Targeted hiring ETL for Dispelix/WaveOptics process engineering roles.",
    ],
  },
  {
    layer: "Agent",
    fakeNow: [
      "OSWorld score and false-moat signature are seeded preview metrics.",
      "No primary-research feed for pilot-to-production conversion yet.",
    ],
    realNeeds: [
      "OSWorld/agent benchmark ingestion and run-history normalization.",
      "Job posting decomposition pipeline (deployment+governance vs research).",
      "Enterprise KPI extraction (NRR, gross margin) from filings/transcripts and guidance tables.",
    ],
  },
  {
    layer: "Neural",
    fakeNow: [
      "Implant counts, electrode progression, FDA milestones, and S-1 probability are mock trajectories.",
      "No clinical trial or PMA event sync active yet.",
    ],
    realNeeds: [
      "FDA/openFDA ingestion and milestone state machine per program.",
      "Clinical publication monitor (lab feeds + preprint + peer-reviewed).",
      "SEC/private filing monitor and weighted probability model for S-1 timing.",
    ],
  },
];

const RESEARCH_LINKS = [
  { label: "SEC EDGAR APIs (company facts/submissions)", url: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces" },
  { label: "SEC ticker to CIK mapping file", url: "https://www.sec.gov/files/company_tickers.json" },
  { label: "openFDA API overview", url: "https://open.fda.gov/apis/" },
  { label: "openFDA device PMA endpoint", url: "https://open.fda.gov/apis/device/pma/" },
  { label: "FRED API docs", url: "https://fred.stlouisfed.org/docs/api/fred/" },
  { label: "GitHub REST search docs", url: "https://docs.github.com/en/rest/search/search" },
  { label: "GitHub REST rate limits", url: "https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api" },
  { label: "SerpAPI Google Trends", url: "https://serpapi.com/google-trends-api" },
  { label: "TheirStack jobs API", url: "https://theirstack.com/en/docs/api-reference/jobs/search_jobs_v1" },
  { label: "EU AI Act timeline (EU Commission)", url: "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai" },
];

export function RealityCheckPanel({ degraded }) {
  return (
    <Surface style={{ padding: 12, marginTop: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>What Is Fake Right Now vs What You Need For Real Live Tracking</div>
      <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 10 }}>
        Current mode: {degraded ? "degraded seeded preview (mock-first full-state visualization)" : "live database mode"}.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px,1fr))", gap: 10, marginBottom: 12 }}>
        {REALIZATION_GUIDE.map((g) => (
          <div key={g.layer} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.panelAlt, padding: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{g.layer}</div>
            <div style={{ fontSize: 11, color: colors.warn, fontWeight: 700, marginBottom: 4 }}>Fake now</div>
            <ul style={{ margin: "0 0 8px 16px", padding: 0, fontSize: 10.5, color: colors.textMuted, lineHeight: 1.4 }}>
              {g.fakeNow.map((x) => <li key={x}>{x}</li>)}
            </ul>
            <div style={{ fontSize: 11, color: colors.good, fontWeight: 700, marginBottom: 4 }}>Needed for real</div>
            <ul style={{ margin: "0 0 0 16px", padding: 0, fontSize: 10.5, color: colors.textMuted, lineHeight: 1.4 }}>
              {g.realNeeds.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Research links for implementation</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 6 }}>
        {RESEARCH_LINKS.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ color: colors.accent, fontSize: 11, textDecoration: "none" }}>
            {l.label}
          </a>
        ))}
      </div>
    </Surface>
  );
}
