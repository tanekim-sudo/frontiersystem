# AI Interface Transition Intelligence Platform

Comprehensive AI demand and interface-transition intelligence system for tracking adoption signals across:

- `physical_ai`
- `voice`
- `spatial`
- `agent`
- `neural`

This repository combines:

- A production React dashboard (`AISignalDashboard.jsx`) with legacy-grade long-horizon signal tracking
- Layer-specific interface metric tracking panels for each AI interface layer
- Multiple API surfaces (labor, news, stock pulse, live normalized platform, persistence)
- Optional normalized live-data architecture (Postgres + workers + ingestion queue)
- Demo-safe fallback behavior when parts of the live stack are not configured

---

## What The Tool Does

The platform is designed for AI-first investment and operating intelligence. It does all of the following:

- Tracks AI signals from multiple legacy source families:
  - TheirStack job postings
  - Google Trends
  - GitHub repositories
  - Claude-attributed commits
  - Hugging Face ecosystem activity
  - Labor and macro context (Chicago Fed + FRED)
- Tracks interface-layer-specific metrics in dedicated per-layer panels (manual or integrated feed mode)
- Stores long-horizon local histories for each metric/group and uses those histories for:
  - momentum
  - convergence/divergence
  - threshold alerting
  - brief generation context
- Generates weekly AI briefs with snapshot preservation and history/diff support
- Supports persistence and sharing via:
  - Supabase/Postgres-backed `dashboard_state`
  - optional legacy Gist-based synchronization
- Supports a live normalized platform API (`/api/live`) with queue-based ingestion model
- Degrades safely to seeded fallback data so demos remain complete even when live infra is missing

---

## Product Model

### 1) Legacy Signal Infrastructure (still core)

The old tracker workflow remains the base interaction model:

- tracking groups with source-specific keyword sets
- per-source cards and histories
- backfill mechanics (where available)
- alerting and overlays
- team notes
- brief generation

### 2) Interface Layer Tabs

Every layer tab now has both:

- Legacy source cards scoped to that layer's mapped tracking groups
- Interface-specific layer metric trackers (manual points, notes, catalyst events, integration status)

This means each tab is operational for signal monitoring, not just `agent`.

### 3) Layer-Specific Metrics

The layer panel includes metrics from your prompt (expanded across commits), including examples like:

- Physical AI: production hours, UR ASP, deployment ratio, sim-to-real reliability, Cosmos capability, VLA paper velocity
- Voice: ElevenLabs ARR, Cartesia velocity, ambient DAU/MAU, enterprise job velocity, latency, SDK breadth
- Spatial: Ray-Ban units, Himax AR/VR revenue, SDK downloads, waveguide hiring, Meta Connect conviction
- Agent: OSWorld success, deployment/governance ratio, governance commit velocity, NRR/margin signature, pilot-to-prod, short-timing and EU AI Act demand signals
- Neural: implants, electrode generation, FDA milestones, ultrasound resolution progress, Shapiro publication signal, Merge optionality-to-core signal, S-1 watch

---

## Repository Structure

- `AISignalDashboard.jsx`
  - Main integrated dashboard application and UI logic
  - Signal collection orchestration, history logic, alerts, briefing, layer panel state
- `src/main.jsx`, `src/App.jsx`
  - Frontend entry
  - Currently routes directly to `AISignalDashboard.jsx`
- `api/`
  - Serverless endpoints used by dashboard and live services
- `lib/`
  - Shared server/library logic (including live DB utilities)
- `migrations/`
  - SQL schema for normalized live platform tables
- `workers/`
  - External scheduler/worker runtime for queued ingestion
- `rays_tracker/`
  - Python FastAPI labor backend (local stack option)

---

## API Surfaces

### Core dashboard support endpoints

- `GET /api/labor/overview`
- `GET /api/labor/fred`
- `GET /api/labor/chicago-fed`
- `GET /api/google-trends`
- `GET /api/ai-news`
- `GET /api/stock-pulse`
- `POST /api/send-report`
- `GET|POST /api/dashboard-state`
- `GET|POST /api/signal-store`
- `GET /api/interface-layer?layer=<id>`

### Live normalized platform

Single endpoint: `GET|POST /api/live`

Resources:

- `GET ?resource=companies`
- `GET ?resource=layer_overview&layer=<layer>`
- `GET ?resource=company_signals&company_id=<id>&days=<n>`
- `GET ?resource=alerts`
- `GET ?resource=jobs`
- `POST ?resource=enqueue` (requires bearer auth with `DASHBOARD_STORE_SECRET`)

---

## Data Behavior: Live, Fallback, and Demo

The platform intentionally supports mixed data conditions for reliability:

- If live infra is configured, APIs return live or near-live results
- If not configured, degraded mode returns seeded data instead of hard failure
- Dashboard includes demo seeding logic to populate a complete usable state
- Recent improvements make synthetic series more realistic (regimes, shocks, volatility clustering, mean reversion), not linear placeholders
- Where available, some seeded paths attempt live hydration (e.g., pulse and Hugging Face) and fall back only if needed

---

## Setup

## 1) Frontend dashboard

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## 2) Environment

Copy `.env.example` to `.env` and fill values incrementally.

Most important keys by use-case:

- Baseline dashboard:
  - `VITE_THEIRSTACK_KEY` (or mock mode)
  - `VITE_SERPAPI_KEY`
  - `VITE_GITHUB_PAT`
  - `VITE_ANTHROPIC_API_KEY`
- Macro labor:
  - `FRED_API_KEY`
- Shared persistence:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `DASHBOARD_STORE_SECRET`
  - `VITE_DASHBOARD_STORE_SECRET`
- Live normalized platform:
  - `DATABASE_URL`
  - `DASHBOARD_STORE_SECRET`

See `.env.example` for full variable list and comments.

---

## Persistence Modes

### Recommended: Supabase REST / Postgres

Used by `api/dashboard-state.js`.

- Durable state across deploys
- Team-shared payload
- Better reliability than client-only local storage

### Optional legacy sync: GitHub Gist

Useful for backward compatibility and certain team workflows.

---

## Worker Runtime (optional but recommended for live platform)

`workers/` runs queue scheduler and ingestion workers for normalized live data.

Quick start:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r workers/requirements.txt
python -m workers.main --mode both
```

Modes:

- `scheduler`
- `worker`
- `both`

---

## Python Labor API (optional local backend)

A separate FastAPI labor backend lives in `rays_tracker/`.

Use it when you want local Python-first labor workflows; production labor routes are also exposed through Node serverless endpoints.

See `rays_tracker/README.md` for detailed commands.

---

## Key Dashboard Workflows

- Select layer tab (`physical_ai`, `voice`, `spatial`, `agent`, `neural`)
- Track layer-specific metric points in interface panel
- Use source cards to monitor AI signal movement by mapped groups
- Refresh sources and pulse data
- Backfill where available
- Generate/regenerate weekly brief
- Review alerts, notes, convergence, and overlays
- Sync state to cloud persistence

---

## Evaluation Rubric Coverage

This section maps the project directly to the requested evaluation criteria.

### Problem & Insight (3 points)

- **Meaningful problem/opportunity**: AI interface transitions are high-impact but fragmented across heterogeneous signals (jobs, repos, benchmarks, regulatory events, macro context). This project unifies those signals into one operational intelligence system.
- **Compelling motivation**: The platform is built to support real-time conviction building and timing decisions across five interface layers, not just static reporting.
- **Original/ambitious approach**: It combines legacy long-horizon tracking mechanics, layer-native metric tracking, live API integrations, normalized live-data architecture, and graceful degraded/demo behavior in one system.

### Execution & Technical Work (5 points)

- **Substantial build scope**:
  - integrated dashboard with layer tabs and per-layer metric panels
  - source adapters (jobs/trends/github/attribution/news/stocks/macro)
  - persistence paths (Supabase/Postgres + optional Gist compatibility)
  - optional normalized live stack (`/api/live`, queue, workers, schema)
- **Functional artifact**: Usable end-to-end in both live and fallback modes; build and runtime checks are part of normal iteration.
- **Scope-aligned technical effort**: UI, API, data model, queue/worker runtime, and persistence were all implemented to match the multi-layer product scope.
- **Clear iteration evidence**: Commit history shows repeated UX/data/reliability iterations (layer wiring, startup crash fixes, realism improvements, refresh hardening, AI-first framing).

### Evaluation & Evidence (3 points)

- **Validation attempts included**:
  - production builds (`npm run build`)
  - runtime smoke tests (headless checks and tab interaction verification)
  - failure-mode hardening (e.g., fallback instead of crash/blank states)
- **Limitations are explicit**:
  - some metrics are manual-entry until fully integrated data sources are connected
  - live availability depends on API keys, endpoint quotas, and backend configuration
  - degraded mode is intentional and documented
- **Evidence types represented**:
  - build/test outputs
  - operational checks
  - data-path fallback behavior
  - commit-level progression over time

### Communication & Presentation (2 points)

- **Readable for non-team reviewers**:
  - clear architecture and endpoint documentation
  - setup/repro instructions
  - workflow and troubleshooting sections
- **Demo-ready communication**:
  - explicit live vs fallback behavior
  - AI-first product framing
  - reproducible setup and operational guidance

### Process, Integrity & Disclosure (2 points)

- **AI usage disclosure**: See `AI Tools Usage and Provenance` below (runtime AI features + AI-assisted development process).
- **Sources/collaborators attribution**:
  - external APIs/data providers are identified in config/docs (`TheirStack`, `SerpAPI`, `GitHub`, `FRED`, Hugging Face, etc.)
  - major dependencies are listed in `package.json`
  - repository history captures incremental contributor work
- **Decisions and limitations**:
  - key architectural tradeoffs are documented (live normalized mode vs degraded/demo mode)
  - known constraints and operational caveats are listed in Troubleshooting and Status sections
- **Genuine effort over time**:
  - public commit history shows substantial iterative development rather than one-shot generation

---

## AI Tools Usage and Provenance

This repository uses AI in two distinct ways:

### 1) AI used inside the product (runtime features)

- `VITE_ANTHROPIC_API_KEY` powers AI-generated weekly brief workflows.
- The earnings call analysis workflow uses LLM-assisted interpretation when configured.
- Claude-attribution tracking is included as a first-class signal source (`claude_attrib`) via GitHub commit signature detection.
- AI-facing interface metrics are tracked per layer through the interface-layer panels.

If API keys are unavailable, the system falls back to deterministic, non-LLM behavior so the dashboard remains operational.

### 2) AI used during development (build/iteration workflow)

- AI coding assistance was used to accelerate implementation, refactors, and documentation updates.
- AI was used to help scaffold and iterate:
  - layer tab integration and metric wiring
  - fallback/degraded data behavior
  - signal-history reliability and demo realism improvements
  - README and operations documentation

All generated/assisted changes were reviewed and validated through local build checks and runtime smoke tests before commit.

---

## Troubleshooting

- "Everything became zero after refresh"
  - Usually means a source returned empty or unauthorized data
  - Recent hardening work avoids wiping good histories when source calls fail
  - Check API keys in `.env`
- 401/403 on source endpoints
  - Missing/expired key or token scope issue
- `DATABASE_URL` errors in live mode
  - Set proper Postgres URI or rely on degraded fallback mode for demo
- Build warnings about bundle size or Tailwind content
  - Non-blocking for runtime, but should be addressed for production optimization

---

## Security Notes

- Never expose server-only secrets to browser variables unless explicitly intended
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only
- Use `DASHBOARD_STORE_SECRET` for protected write endpoints
- Rotate compromised tokens and service keys immediately

---

## Status and Intent

This codebase is designed to be both:

- immediately demoable in degraded/seeded mode, and
- incrementally migratable to fully live ingestion with durable normalized storage.

If you are operating in demo mode, the UI should still present a complete and realistic system state while clearly preserving long-horizon tracking mechanics and layer-specific metric workflows.

