# Labor & AI Demand Tracker (Python API)

FastAPI service that ingests **free** macro/labor data, starting with **Chicago Fed Labor Market Indicators** (public xlsx) and **FRED** (free API key).

**Vercel / production:** the same Chicago Fed + FRED logic also runs as **Node serverless** routes at `/api/labor/*` (see repo `api/labor/` and `lib/labor/`). Use those on deploy; use this Python stack when you want SQLite, scheduled jobs, or local-only workflows.

## Setup

From the repository root:

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r <python-backend-folder>/requirements.txt
```

Copy env keys (repo root `.env`):

```env
FRED_API_KEY=your_fred_key
# Optional later:
# BLS_API_KEY=
# GITHUB_TOKEN=
DATABASE_URL=sqlite:///./data/demand_tracker.db
```

Run API (set `PYTHONPATH` to repo root so package imports resolve):

```bash
# Windows PowerShell, from repo root
$env:PYTHONPATH = (Get-Location).Path
python -m uvicorn <python-package>.main:app --reload --port 8765
```

Health: `http://127.0.0.1:8765/health`

## First data load

```http
POST http://127.0.0.1:8765/api/refresh/chicago_fed
POST http://127.0.0.1:8765/api/refresh/fred
```

Or `POST /api/refresh/all` (FRED requires `FRED_API_KEY`).

## Main endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/labor/overview` | Chicago Fed latest row + latest FRED observations |
| GET | `/api/chicago-fed/latest` | Latest stored Chicago Fed indicators |
| GET | `/api/chicago-fed/history` | History |
| GET | `/api/signals/feed` | Recent `signals` rows |
| POST | `/api/refresh/{collector}` | `chicago_fed`, `fred`, or `all` |

Collectors for Indeed, LinkedIn, pytrends, BLS detail, layoffs, etc. are **stubs**; extend under the Python collectors folder.

## Chicago Fed workbook

Source file (no key):  
`https://www.chicagofed.org/-/media/publications/chicago-fed-labor-market-indicators/chi-labor-market-indicators.xlsx`

The parser targets sheets **`1. Rates`** and **`2. Chicago Fed Real-Time UR`** (sheet names are detected dynamically). If the Fed renames sheets, check logs and adjust `chicago_fed_collector.py`.

## SQLite

Default DB path: `data/demand_tracker.db` under the repo root (created automatically).

## Vite dev proxy

The main React app can call the Python API via the dev-server proxy prefix **`/tracker`** (see `vite.config.js`). Example:

`fetch('/tracker/api/labor/overview')` → `http://127.0.0.1:8765/api/labor/overview`
