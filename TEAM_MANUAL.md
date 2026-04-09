# AI Demand Signal Tracker — Team Manual

## What This Tool Is

The AI Demand Signal Tracker is an intelligence dashboard that monitors real-time signals of enterprise AI adoption and market demand. It pulls data from multiple independent sources — job postings, search trends, code repositories, model downloads, earnings calls, and US macro indicators — to give your team a single view of where AI demand is heading.

The core thesis: by tracking multiple independent signals and watching for divergences or convergence between them, you can identify shifts in enterprise AI spending 1–3 quarters before they show up in revenue numbers.

---

## Quick Start

### Minimum Setup

1. Deploy to Vercel (or run locally with `npm run dev`)
2. Set environment variables (see [Environment Variables](#environment-variables) below)
3. Create your first **tracking group** (e.g. "AI Infrastructure", "GenAI Tools")
4. Add keywords to each group for each data source
5. Hit **Refresh** to pull initial data

### Required Keys (at minimum)

| Key | What it unlocks |
|-----|----------------|
| `VITE_ANTHROPIC_API_KEY` | Weekly briefs, earnings analyzer, divergence interpretation |
| `VITE_GITHUB_PAT` | GitHub repo counts, Claude Code attribution tracking |

### Recommended Keys

| Key | What it unlocks |
|-----|----------------|
| `FRED_API_KEY` | Full US macro/labor data (22 FRED series) |
| `VITE_SERPAPI_KEY` | Google Trends search interest tracking |
| `VITE_THEIRSTACK_KEY` | Live job posting data (demo mode works without) |
| `DASHBOARD_STORE_SECRET` + Supabase vars | Team-wide cloud persistence |

---

## Dashboard Layout (Top to Bottom)

### 1. Control Strip (sticky header)

Always visible at the top. Key actions:

- **Generate Brief / Regenerate Brief** — creates the AI-powered weekly intelligence brief. Shows elapsed time during generation. You can navigate away while it generates.
- **View Brief** — opens the most recent brief.
- **Brief History** — side drawer showing all past weekly briefs.
- **Pause / Resume** — toggles the automatic refresh scheduler.
- **Refresh** — manually refreshes all enabled data sources.
- **Cloud ↑ / ↓** — manually push or pull data from cloud storage.

Status badges show: whether the tool is live (API keys detected), auto-refresh status, last sync time, and per-source refresh countdowns.

### 2. Settings Panel

Collapsed by default. Four tabs:

**Instructions** — overview of data sources and setup. Points to `.env.example` for configuration.

**Signal Groups** — manage your tracking groups:
- Each group has a name and color
- Keywords are configured per data source (see [Signal Groups](#signal-groups) below)
- Add or remove groups here

**Weights & Alerts** — control how signals are scored:
- Per-source weight sliders affect the composite demand score
- Alert threshold (% week-over-week change) controls when divergence alerts fire

**Mailing List** — configure EmailJS credentials and recipient list for sending briefs via email.

### 3. Brief Flagging Thresholds

Six sliders (one per signal source) controlling the minimum % change required for a signal to be flagged in the weekly brief. Range: 0.1% to 50%. Signals below their threshold get one line in the brief; signals above get detailed analysis.

- **Job Postings** (TheirStack)
- **Google Trends**
- **GitHub Repos**
- **Claude Attribution**
- **HuggingFace** (total downloads)
- **Composite** (overall demand score)

### 4. Tracking-Group Metrics

One card per enabled data source. Each card shows all your tracking groups as rows with:

- **Current count** — latest value from the most recent refresh
- **WoW % badge** — week-over-week change (green = up, red = down)
- **Stage badge** — (TheirStack only) dominant adoption stage detected in job language
- **Sparkline** — mini chart of recent history
- **Chart button** — opens full growth trend chart with time range selector (1M through All) and EMA smoothing toggle
- **Refresh button** — refresh just that group for that source
- **Backfill button** — (where available) pull historical data

**Expanding a row** shows:
- Keyword configuration (add/remove keyword chips per source)
- Latest results list (job titles, descriptions, etc.)
- Source diagnostics (GitHub query preview, etc.)

### 5. Signal Divergence Overlay

Select 2+ signals using the checkboxes next to each tracking group row. The overlay chart normalizes all selected signals to a 0–100 scale and plots them together. Use this to spot:

- **Divergences** — when signals that normally move together start separating
- **Convergence** — when independent signals start confirming each other

The **AI Interpret** button (requires Anthropic key) asks Claude to analyze detected divergences and explain what they might mean for AI demand.

### 6. Earnings Call Analyzer

Paste or upload an earnings call transcript for AI-powered linguistic analysis. The analyzer scores the call across five dimensions:

- **Confidence Language** — hedging vs. certainty in forward guidance
- **Specificity** — vague promises vs. concrete metrics and timelines
- **Consistency** — alignment between prepared remarks and Q&A answers
- **Deflection Patterns** — how management handles difficult questions
- **Forward Guidance Quality** — actionable vs. aspirational language

You can compare multiple quarters for the same company to track communication shifts over time. A large score change (≥15 points) between quarters is flagged as a potential communication shift.

**How to use:**
1. Select a company (preset tickers or enter custom)
2. Select quarter and year
3. Paste the transcript text (or drag/drop a .txt file)
4. Optionally paste the prior quarter's transcript for comparison
5. Click **Analyze**

### 7. Macro Labor & Economy (US)

National-level economic context powered by the Chicago Fed and FRED. This section helps you understand whether the broader economy supports or threatens AI spending.

**Chicago Fed section (no API key needed):**
- Unemployment nowcast vs. official U-3 rate
- Layoffs/separations rate vs. hiring rate
- Regime indicator (expansion, softening, contraction risk)

**FRED section (requires `FRED_API_KEY`):**
Nine thematic categories with multi-year charts:

| Category | What it tells you |
|----------|-------------------|
| **Labor** | Unemployment (U-3, U-6), participation, payrolls, jobless claims |
| **JOLTS** | Job openings, hires, quits — measures labor market tightness |
| **Wages** | Average hourly earnings — wage pressure indicator |
| **Growth & demand** | GDP, industrial production, retail sales, consumption |
| **Housing** | Housing starts — a leading economic indicator |
| **Sentiment** | Consumer sentiment — predicts spending pullbacks |
| **Financial stress** | VIX, NFCI, St. Louis stress index — funding environment |
| **Rates** | Treasury yields and yield curve spread — recession signals |
| **Tech production** | Computer and electronics industrial production — AI hardware demand |

Hover over any series name or badge for a plain-English explanation of what that metric means and why it matters.

### 8. HuggingFace Leaderboard

Tracks download volumes across 12 major AI organizations. Updated on refresh or auto-fetched when data is >6 hours old.

**Features:**
- **Podium** — top 3 by total downloads
- **Full table** — click any row to expand and see top models
- **Download growth chart** — all organizations over time with time range selector
- **Head-to-Head Comparison** — pick any two companies (or one company vs. **Industry Average**) to compare normalized growth. The chart shows % change from the start of the selected time range, making relative growth visible regardless of absolute download volume.

**How to use the comparison:**
1. Use the "Company" dropdown to select a company
2. Use the "Compare to" dropdown to select another company or **Industry Average**
3. Or click rows in the table to quickly assign A/B selections
4. Badges show **FASTER**, **ABOVE AVG**, or **BELOW AVG**

### 9. Divergence Alerts

Automatically fires when any signal's week-over-week change exceeds the alert threshold (configurable in Settings → Weights & Alerts). Alerts can be pinned for tracking. The feed shows the most recent 20 alerts.

---

## Signal Groups

Signal groups (also called "verticals" or "tracking groups") are the core organizational unit. Each group represents a theme or market segment you want to track — for example "AI Infrastructure", "GenAI Applications", "Computer Vision", etc.

**Each group has per-source keywords:**

| Source | Keyword format | Example |
|--------|---------------|---------|
| TheirStack | Job title + description keywords | title: "AI engineer", desc: "LLM", "RAG" |
| Google Trends | Search terms | "AI copilot", "RAG pipeline" |
| GitHub Repos | Repository search query | "ai", "machine learning" |
| Claude Attribution | Commit search query | "claude", "anthropic" |

Keywords drive all data collection. More specific keywords = more meaningful signal. Very broad keywords (e.g. just "ai" for GitHub) will return high counts but less actionable signal — you'll see a "keywords may be too broad" warning.

---

## Weekly Intelligence Brief

The brief is an AI-generated report covering the past week's signal movements, stock context, macro conditions, and actionable takeaways.

**What it covers:**
1. **The Week in 60 Seconds** — headline summary
2. **Stock Pulse** — AI-relevant stock movements (MSFT, NVDA, GOOGL, META, PLTR, etc.)
3. **Flagged Signals** — detailed analysis of any signals that crossed your configured thresholds
4. **Macro & News** — relevant economic and AI industry developments (sourced via live web search)
5. **Conviction Calls** — specific actionable takeaways
6. **Risks** — what to watch for

**Key behaviors:**
- Only signals that **cross your threshold** get detailed coverage. Everything else gets one line.
- Uses **3-week % change** as the primary metric (more stable than single-week)
- Claude performs **live web searches** during generation for current stock prices, news, and policy developments
- Generation runs in the background — you can continue using the dashboard
- Briefs are saved per-week and accessible via Brief History
- Briefs can be emailed to your mailing list via EmailJS

---

## Cloud Persistence

Data syncs automatically to your configured cloud backend so it survives browser clears, deploys, and works across team members.

**Priority order:**
1. **Supabase/Postgres** (recommended for teams) — set `DASHBOARD_STORE_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
2. **Server-side Gist proxy** — set `SIGNAL_STORE_SECRET` and related vars
3. **Direct GitHub Gist** — uses `VITE_GITHUB_PAT` (not ideal for teams)

**What syncs:** All configuration, signal history, briefs, HuggingFace data, labor snapshots, earnings analyses, mailing list, and more.

**Sync happens automatically** after every refresh and data change. You can also manually push/pull via the Cloud ↑/↓ buttons in the header.

---

## Environment Variables

Copy `.env.example` to `.env` for local development. For Vercel, add these in Settings → Environment Variables.

### Client-Side (exposed to browser)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_THEIRSTACK_KEY` | No | TheirStack job posting API. Demo mode works without it. |
| `VITE_THEIRSTACK_MOCK` | No | Set to `true` to force simulated job data even with a key |
| `VITE_SERPAPI_KEY` | No | SerpAPI for Google Trends data and 12-month backfill |
| `VITE_GITHUB_PAT` | Recommended | GitHub Personal Access Token (read access to public repos) |
| `VITE_ANTHROPIC_API_KEY` | Recommended | Powers weekly briefs, earnings analyzer, divergence AI interpretation |
| `VITE_DASHBOARD_STORE_SECRET` | For teams | Must match server-side `DASHBOARD_STORE_SECRET` |
| `VITE_SIGNAL_STORE_SECRET` | Optional | Auth for Gist proxy (legacy) |
| `VITE_SIGNAL_DATA_GIST_ID` | Optional | Direct Gist binding (legacy) |

### Server-Side Only

| Variable | Required | Description |
|----------|----------|-------------|
| `FRED_API_KEY` | For macro data | US labor & economic series. Get from fred.stlouisfed.org |
| `SUPABASE_URL` | For teams | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For teams | Supabase service role key |
| `DASHBOARD_STORE_SECRET` | For teams | Shared secret (must match `VITE_DASHBOARD_STORE_SECRET`) |

### Supabase Setup (one-time)

1. Create a free project at [supabase.com](https://supabase.com)
2. Run this SQL in Supabase → SQL Editor:

```sql
create table if not exists public.dashboard_state (
  id text primary key default 'default',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

3. Copy your project URL and service role key from Supabase → Project Settings → API
4. Pick any random string as `DASHBOARD_STORE_SECRET` and set it in both the server and client variables

---

## Data Refresh Cadence

| Source | Default cadence | Notes |
|--------|----------------|-------|
| TheirStack Jobs | Weekly | Live API or demo mode |
| Google Trends | Weekly | Relative interest score (not absolute counts) |
| GitHub Repos | Weekly | Current-week repo count. Backfill is disabled (API unreliable for historical queries). |
| Claude Attribution | Weekly | Commit counts mentioning Claude/Anthropic |
| HuggingFace | 6 hours | Auto-fetches when stale |
| FRED / Chicago Fed | On demand | Click Refresh in the macro section |

The **auto-refresh scheduler** (toggleable via Pause/Resume) checks source staleness and refreshes automatically. Manual Refresh is always available.

---

## Tips for Your Team

1. **Start with 2–3 focused tracking groups** rather than many broad ones. "AI Infrastructure" with keywords like "GPU cluster", "ML ops", "model serving" will produce more actionable signal than a group with just "AI".

2. **Check the brief weekly.** It's designed to be the primary output — a 2-page summary of what moved and what it means. Adjust thresholds so only meaningful changes get flagged.

3. **Use the divergence overlay** when you see a signal spike. Select the spiking signal plus 2–3 others to see if the movement is isolated or part of a broader trend.

4. **Compare HuggingFace downloads against the Industry Average** to identify which companies are gaining or losing momentum relative to the market.

5. **The macro section provides context, not signal.** If unemployment is rising and financial stress is elevated, enterprise AI budgets are likely under pressure regardless of what the demand signals show.

6. **Brief thresholds matter.** If your briefs are too long, raise the thresholds. If they're missing important movements, lower them. The 3-week change metric is more stable than single-week.

7. **Cloud sync is essential for teams.** Set up Supabase so everyone shares the same data, history, and configuration. Without it, each team member has isolated local data.
