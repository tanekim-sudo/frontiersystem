# Interface-Layer Intelligence Tracker — Team Manual

## Mission

This platform tracks the interface layer of AI adoption across five investable transitions:

1. Physical AI
2. Voice
3. Spatial
4. Agent
5. Neural

The system keeps all existing signal infrastructure (jobs, trends, GitHub, Claude attribution, macro, HuggingFace, briefs) and reorganizes research workflow around layer-specific operating dashboards.

---

## Operating Model

### Layer tabs

Use the top-level layer tabs as the primary navigation model:

- `Physical AI`
- `Voice`
- `Spatial`
- `Agent`
- `Neural`

Each layer tab contains:

- canonical signal definitions
- manual data-entry controls
- stored signal history
- analyst notes
- catalyst/event markers
- integration status (stub/live)

### Existing signals (preserved)

The prior infrastructure remains active and refreshable under the `Agent` layer context:

- TheirStack jobs
- Google Trends
- GitHub repo velocity
- Claude code attribution
- HuggingFace leaderboard
- Macro/news pulse
- Weekly brief generation

---

## Signal Framework by Layer

## 1) Physical AI

- Production hours database (Formic, Agility, Zipline, Waymo)
- Teradyne UR ASP (quarterly)
- Deployment+operations / R&D hiring ratio
- Sim-to-real transfer reliability

Falsification rule:

- If contact-rich sim-to-real reliability sustains >=85%, real-world deployment-data moat weakens materially.

## 2) Voice

- ElevenLabs ARR trajectory
- Cartesia commit velocity and SDK breadth
- Ambient voice DAU/MAU (presence apps, not chatbot usage)
- Enterprise voice AI job velocity (Fortune 500)
- TTS latency benchmark composite

## 3) Spatial

- Meta Ray-Ban inferred units
- Himax AR/VR revenue
- Spatial SDK downloads
- Waveguide manufacturing-hire signal
- Annual catalyst: Meta Connect

## 4) Agent

- OSWorld benchmark success rate
- Enterprise software deployment+governance / research jobs ratio
- Governance-infra GitHub velocity
- NRR vs gross margin false-moat signature
- Pilot-to-production conversion rate
- Regulatory catalyst: EU AI Act full applicability (2026-08-02)

## 5) Neural

- Patient implant count
- Electrode count trajectory by generation
- FDA milestone tracker
- Through-skull ultrasound resolution signals
- S-1 filing watchlist for major private BCI companies

---

## Data Capture Protocol

For each manual datapoint, capture:

- `value`
- `period` (e.g., `2026-W22`, `2026-Q3`, `2026-05`)
- `source note` (filing, release, transcript, primary call)
- `confidence` (`low`, `medium`, `high`)

Data quality discipline:

- never infer precision not present in source
- separate observed value from interpretation
- log caveats in signal notes
- use event markers for catalysts, not raw value fields

---

## API Keys and Placeholder Strategy

The app is designed to run in manual/stub mode with zero integration keys.

You can optionally add keys in:

- `.env` (recommended, takes precedence)
- Settings -> API Keys (dashboard-stored placeholders)

Placeholder variables:

- `VITE_FORMIC_API_KEY`
- `VITE_AGILITY_API_KEY`
- `VITE_ZIPLINE_API_KEY`
- `VITE_WAYMO_API_KEY`
- `VITE_TERADYNE_API_KEY`
- `VITE_ELEVENLABS_API_KEY`
- `VITE_CARTESIA_API_KEY`
- `VITE_OSWORLD_API_KEY`
- `VITE_FDA_API_KEY`
- `VITE_SEC_API_KEY`

---

## Brief and Alert Use

Weekly briefs now include interface-layer intelligence context:

- layer signal momentum
- threshold/falsification proximity
- catalyst windows
- notes + event annotations

Alerting includes:

- threshold watch triggers
- catalyst window reminders
- existing signal divergence alerts

---

## Workflow Checklist (Weekly)

1. Refresh integrations per layer tab.
2. Enter new manual datapoints with source notes.
3. Add/adjust catalyst markers.
4. Review legacy infrastructure in Agent layer.
5. Generate brief and review caveats before distribution.
6. Push updates to cloud storage.

---

## Governance Notes

- This is an internal decision-support system, not an external report generator.
- Treat manual entries as audit-traceable research artifacts.
- Keep assumptions falsifiable and dated.
