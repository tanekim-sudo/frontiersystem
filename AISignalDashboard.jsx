// ══════════════════════════════════════════════════════════════════════════════
// SIGNAL INTELLIGENCE DASHBOARD v2
// History tracking, growth charts, overlay comparison, investment commentary
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ComposedChart, Bar, Area, ReferenceLine, ReferenceDot, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, CartesianGrid } from "recharts";
import { computeEarningsTranscriptLayer2 } from "./lib/earnings/transcriptLayer2.js";
import {
  attachParsedQuarters,
  sortEarningsChronologically,
  ensureCrossQuarterFairness,
  attachCompanyZScores,
  getQoQPeer,
  getYoYPeer,
  compareFairMetrics,
} from "./lib/earnings/earningsCompareMetrics.js";

const PFX = "sid_v3_";
const HSPFX = "aitracker_";
const C = {
  bg: "#f5f6f8", white: "#fff", nested: "#f0f1f4", border: "#d8dbe2", borderLight: "#e8eaef",
  text: "#1c1f26", textSec: "#515868", textMuted: "#8890a0",
  cyan: "#1a6b8a", cyanBg: "#eaf3f7",
  amber: "#8a6a1a", amberBg: "#f7f2e6",
  red: "#943232", redBg: "#f7eded",
  green: "#2d6b4f", greenBg: "#edf5f1",
  purple: "#584a8a", purpleBg: "#f0eef5",
  blue: "#3d5a9e", blueBg: "#edf1f8",
  orange: "#8a5a2d", orangeBg: "#f7f1ea",
};
const font = { sans: { fontFamily: "'Inter',system-ui,sans-serif" }, mono: { fontFamily: "'JetBrains Mono',monospace" } };
const PALETTE = ["#1a6b8a","#3d5a9e","#8a6a1a","#2d6b4f","#584a8a","#943232","#8a5a2d","#7a3d5e","#4a7a8a","#4a5a7a"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── PERSISTENCE (localStorage + GitHub Gist cloud sync) ──────────────────────
// localStorage is the primary store for speed. A GitHub Gist acts as the
// permanent cloud database — data syncs on load and after each fetch cycle.
// This means data survives browser clears, different machines, and deploys.

const GIST_ID_KEY = PFX + "gist_id";

function envSignalGistId() {
  try {
    const v = import.meta.env.VITE_SIGNAL_DATA_GIST_ID;
    return v && String(v).trim() ? String(v).trim() : "";
  } catch {
    return "";
  }
}

/** When set, load/save goes through /api/signal-store (server holds GitHub PAT + gist id). */
function signalStoreSecret() {
  try {
    const v = import.meta.env.VITE_SIGNAL_STORE_SECRET;
    return v && String(v).trim() ? String(v).trim() : "";
  } catch {
    return "";
  }
}

/** When set (with server DATABASE_URL + DASHBOARD_STORE_SECRET), Postgres is the canonical cloud store. */
function databaseStoreSecret() {
  try {
    const v = import.meta.env.VITE_DASHBOARD_STORE_SECRET;
    return v && String(v).trim() ? String(v).trim() : "";
  } catch {
    return "";
  }
}

/** Prefer env so preview deploys / cleared storage still bind to the same Gist. */
function effectiveGistId() {
  const envId = envSignalGistId();
  if (envId) {
    try { localStorage.setItem(GIST_ID_KEY, envId); } catch {}
    return envId;
  }
  try {
    return localStorage.getItem(GIST_ID_KEY) || "";
  } catch {
    return "";
  }
}

let _resolveGitPat = () => "";
function setGitPatResolver(fn) {
  _resolveGitPat = typeof fn === "function" ? fn : () => "";
}

/** Debounced cloud save after edits — excludes heavy history keys (backfill spam). */
function shouldMirrorIdentityKeyToGist(k) {
  if (k === "config" || k === "mailing_list" || k === "emailjs_config") return true;
  if (k === "annotations" || k === "annotation_author") return true;
  if (k === "hf_lb" || k === "hist_hf") return true;
  if (k === "hist_labor_macro") return true;
  if (k.startsWith("hist_")) return true;
  if (k.startsWith(`${HSPFX}brief_`)) return true;
  if (k.startsWith(`${HSPFX}github_watchlist_`)) return true;
  if (k.startsWith(`${HSPFX}github_live_`) || k.startsWith(`${HSPFX}github_history_`)) return true;
  if (k === `${HSPFX}crosscorr`) return true;
  if (k.startsWith(`${HSPFX}patterns_`)) return true;
  if (k.startsWith(`${HSPFX}history_latest_`) || k.startsWith(`${HSPFX}weekly_latest_`)) return true;
  if (k === "ec_history") return true;
  return false;
}

function ld(k, fb) { try { const r = localStorage.getItem(PFX + k); return r ? JSON.parse(r) : fb; } catch { return fb; } }
function sv(k, d) {
  try { localStorage.setItem(PFX + k, JSON.stringify(d)); } catch {}
  if (shouldMirrorIdentityKeyToGist(k)) {
    const pat = _resolveGitPat();
    if (pat || signalStoreSecret() || databaseStoreSecret()) debouncedSyncToGist(pat, 4500);
  }
}

async function findSignalDataGistId(pat) {
  const marker = "Signal Intelligence Dashboard";
  for (let page = 1; page <= 25; page++) {
    const res = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${pat}` } });
    if (!res.ok) break;
    const gists = await res.json();
    if (!Array.isArray(gists) || gists.length === 0) break;
    const found = gists.find((g) => g.description?.includes(marker) && g.files["signal-data.json"]);
    if (found) return found.id;
    if (gists.length < 100) break;
  }
  return null;
}

function getAllData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PFX) && k !== GIST_ID_KEY) {
      const inner = k.slice(PFX.length);
      if (inner.startsWith("hist_") && inner.includes("github_repos")) {
        try {
          const arr = JSON.parse(localStorage.getItem(k));
          if (Array.isArray(arr) && arr.filter(p => p.value === 0 || p.value == null).length > arr.length * 0.3) continue;
        } catch { continue; }
      }
      try { data[inner] = JSON.parse(localStorage.getItem(k)); } catch {}
    } else if (k?.startsWith(HSPFX) && !k?.startsWith(PFX)) {
      try { data[`__raw_${k}`] = JSON.parse(localStorage.getItem(k)); } catch {}
    }
  }
  return data;
}

function loadAllData(data) {
  Object.entries(data).forEach(([k, v]) => {
    if (k.includes("github_repos") && k.startsWith("hist_") && Array.isArray(v)) {
      const zeros = v.filter(p => p.value === 0 || p.value == null).length;
      if (zeros > v.length * 0.3) return;
    }
    if (k.startsWith("__raw_")) {
      const rawKey = k.slice(6);
      const existing = localStorage.getItem(rawKey);
      if (!existing) { try { localStorage.setItem(rawKey, JSON.stringify(v)); } catch {} }
      return;
    }
    const existing = localStorage.getItem(PFX + k);
    const existingParsed = existing ? (() => { try { return JSON.parse(existing); } catch { return null; } })() : null;
    if (Array.isArray(v) && Array.isArray(existingParsed)) {
      const merged = [...existingParsed];
      const existingTs = new Set(existingParsed.map(e => e.ts));
      v.forEach(entry => { if (!existingTs.has(entry.ts)) merged.push(entry); });
      merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      if (merged.length > 500) merged.splice(0, merged.length - 500);
      sv(k, merged);
    } else if (k === "config" && v && typeof v === "object") {
      if (!existingParsed || !existingParsed.verticals?.length) {
        sv(k, v);
      } else {
        const cloud = v;
        const local = existingParsed;
        const cloudVIds = new Set((cloud.verticals || []).map((vt) => vt.id));
        const mergedVerts = [...(cloud.verticals || [])];
        (local.verticals || []).forEach((vt) => {
          if (!cloudVIds.has(vt.id)) mergedVerts.push(vt);
        });
        // Local first so a thin/partial gist (e.g. missing apiKeys) does not wipe browser fields; union verticals so groups never disappear.
        const merged = { ...local, ...cloud, verticals: mergedVerts };
        sv(k, merged);
      }
    } else if (!existingParsed) {
      sv(k, v);
    } else if (k !== "config" && v && typeof v === "object" && !Array.isArray(v) && existingParsed && typeof existingParsed === "object" && !Array.isArray(existingParsed)) {
      sv(k, { ...existingParsed, ...v });
    }
  });
}

async function syncFromSignalStoreProxy() {
  const secret = signalStoreSecret();
  if (!secret) return false;
  try {
    const res = await fetch("/api/signal-store", { headers: { Authorization: `Bearer ${secret}` } });
    if (res.status === 404) {
      try {
        const j = await res.json();
        if (j.empty) return false;
      } catch {
        return false;
      }
      return false;
    }
    if (!res.ok) return false;
    const j = await res.json();
    if (j.data && typeof j.data === "object") {
      loadAllData(j.data);
      return true;
    }
  } catch {}
  return false;
}

async function syncToSignalStoreProxy() {
  if (!_cloudInitDone) return;
  const secret = signalStoreSecret();
  if (!secret) return;
  const data = getAllData();
  const localKeys = Object.keys(data);
  const localCfg = data.config;
  const localEmpty = !localCfg || !localCfg.verticals || localCfg.verticals.length === 0;
  const localThin = localKeys.length < 3;
  if (localEmpty || localThin) {
    try {
      const chk = await fetch("/api/signal-store", { headers: { Authorization: `Bearer ${secret}` } });
      if (!chk.ok && chk.status !== 404) return;
      if (chk.ok) {
        const j = await chk.json();
        const cloud = j.data;
        if (cloud && typeof cloud === "object") {
          const cloudKeys = Object.keys(cloud);
          if (cloud.config?.verticals?.length > 0) return;
          if (cloudKeys.length > localKeys.length + 5) return;
        }
      }
    } catch {
      return;
    }
  }
  try {
    await fetch("/api/signal-store", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
  } catch {}
}

async function syncFromDatabaseProxy(retries = 2) {
  const secret = databaseStoreSecret();
  if (!secret) return false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("/api/dashboard-state", { headers: { Authorization: `Bearer ${secret}` } });
      if (res.status === 404) {
        try { const j = await res.json(); if (j.empty) return false; } catch { return false; }
        return false;
      }
      if (res.status === 401) return false;
      if (!res.ok) {
        if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
        return false;
      }
      const j = await res.json();
      if (j.data && typeof j.data === "object") {
        loadAllData(j.data);
        return true;
      }
    } catch {
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
    }
  }
  return false;
}

async function syncToDatabaseProxy(retries = 1) {
  if (!_cloudInitDone) return;
  const secret = databaseStoreSecret();
  if (!secret) return;
  const data = getAllData();
  const localKeys = Object.keys(data);
  const localCfg = data.config;
  const localEmpty = !localCfg || !localCfg.verticals || localCfg.verticals.length === 0;
  const localThin = localKeys.length < 3;
  if (localEmpty || localThin) {
    try {
      const chk = await fetch("/api/dashboard-state", { headers: { Authorization: `Bearer ${secret}` } });
      if (!chk.ok && chk.status !== 404) return;
      if (chk.ok) {
        const j = await chk.json();
        const cloud = j.data;
        if (cloud && typeof cloud === "object") {
          const cloudKeys = Object.keys(cloud);
          if (cloud.config?.verticals?.length > 0) return;
          if (cloudKeys.length > localKeys.length + 5) return;
        }
      }
    } catch {
      return;
    }
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("/api/dashboard-state", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      if (res.ok || res.status === 401 || res.status === 400) return;
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
    } catch {
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
    }
  }
}

let _syncDebounce = null;
let _cloudInitDone = false;
function debouncedSyncToGist(pat, delayMs = 5000) {
  if (!_cloudInitDone) return;
  if (_syncDebounce) clearTimeout(_syncDebounce);
  _syncDebounce = setTimeout(() => { syncToGist(pat).catch(() => {}); _syncDebounce = null; }, delayMs);
}

async function syncToGist(pat) {
  if (databaseStoreSecret()) return syncToDatabaseProxy();
  if (signalStoreSecret()) return syncToSignalStoreProxy();
  if (!pat) return;
  if (!_cloudInitDone) return;
  const data = getAllData();
  const localKeys = Object.keys(data);
  const localCfg = data.config;
  const localEmpty = !localCfg || !localCfg.verticals || localCfg.verticals.length === 0;
  const localThin = localKeys.length < 3;
  if (localEmpty || localThin) {
    const gistId = effectiveGistId();
    if (gistId) {
      try {
        const chk = await fetch(`https://api.github.com/gists/${gistId}`, { headers: { Authorization: `Bearer ${pat}` } });
        if (!chk.ok) return;
        const g = await chk.json();
        const content = g.files["signal-data.json"]?.content;
        if (content) {
          const cloud = JSON.parse(content);
          const cloudKeys = Object.keys(cloud);
          if (cloud.config?.verticals?.length > 0) return;
          if (cloudKeys.length > localKeys.length + 5) return;
        }
      } catch {
        return;
      }
    }
  }
  const gistId = effectiveGistId();
  const body = { description: "Signal Intelligence Dashboard — persistent data store", public: false, files: { "signal-data.json": { content: JSON.stringify(data) } } };

  try {
    if (gistId) {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, { method: "PATCH", headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok && res.status === 404) {
        if (envSignalGistId()) return;
        localStorage.removeItem(GIST_ID_KEY);
        return syncToGist(pat);
      }
    } else {
      const res = await fetch("https://api.github.com/gists", { method: "POST", headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { const g = await res.json(); localStorage.setItem(GIST_ID_KEY, g.id); }
    }
  } catch {}
}

async function syncFromGist(pat) {
  if (databaseStoreSecret()) {
    const ok = await syncFromDatabaseProxy();
    if (ok) return true;
  }
  if (signalStoreSecret()) return syncFromSignalStoreProxy();
  if (!pat) return false;
  let gistId = effectiveGistId();
  if (!gistId) {
    try {
      const discovered = await findSignalDataGistId(pat);
      if (!discovered) return false;
      localStorage.setItem(GIST_ID_KEY, discovered);
      gistId = discovered;
    } catch {
      return false;
    }
  }
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: { Authorization: `Bearer ${pat}` } });
    if (!res.ok) return false;
    const g = await res.json();
    const content = g.files["signal-data.json"]?.content;
    if (content) { loadAllData(JSON.parse(content)); return true; }
  } catch {}
  return false;
}

function purgeGitHubReposBackfill() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.includes("backfill_v")) localStorage.removeItem(k);
  }
}

// ── SHARED ANNOTATION LOG ────────────────────────────────────────────────────
function getAnnotations() { return ld("annotations", []); }
function addAnnotation(ann) {
  const all = getAnnotations();
  all.push({ id: Date.now() + "_" + Math.random().toString(36).slice(2, 7), ts: Date.now(), isoDate: new Date().toISOString(), ...ann });
  sv("annotations", all);
  return all;
}
function deleteAnnotation(id) {
  const all = getAnnotations().filter(a => a.id !== id);
  sv("annotations", all);
  return all;
}

function getSignalHistory(signalKey) {
  const h = ld(`hist_${signalKey}`, []);
  return h.map(p => ({ ...p, isoDate: p.isoDate || new Date(p.ts).toISOString() }));
}
function appendSignalHistory(signalKey, value) {
  const h = ld(`hist_${signalKey}`, []);
  const now = new Date();
  const entry = {
    ts: now.getTime(),
    isoDate: now.toISOString(),
    value,
    date: now.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  };
  const last = h.length > 0 ? h[h.length - 1] : null;
  const minGap = 4 * 3600 * 1000;
  if (last && (now.getTime() - last.ts) < minGap) {
    h[h.length - 1] = entry;
  } else {
    h.push(entry);
  }
  if (h.length > 500) h.splice(0, h.length - 500);
  sv(`hist_${signalKey}`, h);
  return h.map(p => ({ ...p, isoDate: p.isoDate || new Date(p.ts).toISOString() }));
}
function getHFHistory() { return ld("hist_hf", []); }
function appendHFHistory(orgs) {
  const h = getHFHistory();
  const entry = { ts: Date.now(), date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
  orgs.forEach((o) => { entry[o.orgId] = o.totalDownloads; });
  h.push(entry);
  if (h.length > 100) h.splice(0, h.length - 100);
  sv("hist_hf", h);
  return h;
}

/** Local trail when you refresh macro labor (syncs via Gist with other dashboard data). */
function getLaborMacroHistory() { return ld("hist_labor_macro", []); }
function appendLaborMacroSnapshot(row) {
  const h = getLaborMacroHistory();
  h.push({ ts: Date.now(), ...row });
  if (h.length > 260) h.splice(0, h.length - 260);
  sv("hist_labor_macro", h);
  return h;
}

const TIME_RANGES = [
  { id: "1m", label: "1M", filterFn: (d, dateKey) => { const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 1); return new Date(d[dateKey]) >= cutoff; } },
  { id: "3m", label: "3M", filterFn: (d, dateKey) => { const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 3); return new Date(d[dateKey]) >= cutoff; } },
  { id: "6m", label: "6M", filterFn: (d, dateKey) => { const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6); return new Date(d[dateKey]) >= cutoff; } },
  { id: "1y", label: "1Y", filterFn: (d, dateKey) => { const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1); return new Date(d[dateKey]) >= cutoff; } },
  { id: "2y", label: "2Y", filterFn: (d, dateKey) => { const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 2); return new Date(d[dateKey]) >= cutoff; } },
  { id: "5y", label: "5Y", filterFn: (d, dateKey) => { const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 5); return new Date(d[dateKey]) >= cutoff; } },
  { id: "all", label: "All", filterFn: () => true },
];

function filterByTimeRange(data, rangeId, dateKey = "date") {
  const range = TIME_RANGES.find((r) => r.id === rangeId) || TIME_RANGES[0];
  return data.filter((d) => range.filterFn(d, dateKey));
}

function TimeRangeSelector({ value, onChange, style }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, background: C.nested, borderRadius: 6, padding: 2, ...style }}>
      {TIME_RANGES.map((r) => (
        <button key={r.id} type="button" onClick={() => onChange(r.id)} style={{
          ...font.sans, fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4, border: "none",
          background: value === r.id ? C.white : "transparent", color: value === r.id ? C.text : C.textMuted,
          cursor: "pointer", boxShadow: value === r.id ? "0 1px 2px rgba(0,0,0,.08)" : "none",
        }}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

const LABOR_FRED_CAT_ORDER = ["labor", "jolts", "wages", "growth", "inflation", "housing", "sentiment", "financial_stress", "rates", "tech_production"];
const LABOR_FRED_CAT_LABEL = {
  labor: "Labor",
  jolts: "JOLTS",
  wages: "Wages",
  growth: "Growth & demand",
  inflation: "Inflation (CPI & PCE)",
  housing: "Housing",
  sentiment: "Sentiment",
  financial_stress: "Financial stress",
  rates: "Rates",
  tech_production: "Tech production",
};
const LABOR_FRED_CAT_EXPLAIN = {
  labor: "Core employment metrics — how many people are working, looking for work, or dropping out. Rising unemployment or falling participation = weaker demand for AI products.",
  jolts: "Job Openings & Labor Turnover Survey — measures how many positions are open, how many people are being hired, and how many are quitting. High openings + high quits = hot labor market. Falling openings = companies are pulling back.",
  wages: "How fast paychecks are growing. Rising wages = companies competing for talent = healthy demand. Stalling wages = budget pressure, potential hiring freezes.",
  growth: "Overall economic output (GDP) and consumer spending. Strong GDP = enterprise budgets grow, more AI procurement. Weak GDP = cost-cutting mode.",
  inflation: "Consumer and PCE price indexes — the cost backdrop for wages, rates, and AI pricing power. High or sticky inflation keeps the Fed cautious and tightens real budgets.",
  housing: "Housing starts and permits signal 6–12 months of economic confidence. Housing slumps often precede broader slowdowns that hit tech budgets.",
  sentiment: "Consumer and business confidence surveys. When people feel pessimistic, spending and hiring slow down — even before hard data confirms it.",
  financial_stress: "Measures of banking system strain and credit conditions. High stress = banks tighten lending = less capital for AI investments and startups.",
  rates: "Federal Reserve interest rates and bond yields. Higher rates = more expensive to borrow = less venture funding = slower AI startup growth.",
  tech_production: "Industrial production of computers, semiconductors, and electronic components. Direct measure of tech hardware demand — leading indicator for AI infrastructure buildout.",
};
const FRED_SERIES_EXPLAIN = {
  UNRATE: "U-3 unemployment rate — the headline number you see in news. % of labor force actively looking for work but can't find it. Below 4% = very tight. Above 5% = trouble.",
  U6RATE: "U-6 unemployment — the REAL unemployment rate. Includes people who gave up looking and those stuck in part-time work who want full-time. Always higher than U-3. The gap between U-6 and U-3 shows hidden labor market pain.",
  EMRATIO: "Employment-to-population ratio — what % of working-age adults actually have a job. More honest than unemployment rate because it counts people who stopped looking. Higher = stronger economy.",
  CIVPART: "Labor force participation rate — what % of working-age population is either employed or actively looking. When this falls, people are leaving the workforce entirely (retirement, discouragement, school).",
  PAYEMS: "Total nonfarm payrolls (in thousands) — the single most-watched jobs number. This is the \"economy added X jobs\" headline. Consistently above ~150K/month = healthy.",
  ICSA: "Initial jobless claims — how many people filed for unemployment for the first time THIS WEEK. The most real-time labor signal. Spikes = sudden layoffs. Below ~225K = stable. Above ~300K = trouble.",
  CCSA: "Continuing claims — how many people are STILL collecting unemployment. When this rises while initial claims are stable, people can't find new jobs. Bad for AI hiring demand.",
  JTSJOL: "JOLTS Job Openings — total unfilled positions across the US (in thousands). More openings = companies are growing. When this drops, enterprise procurement slows 1–2 quarters later.",
  JTSHIR: "JOLTS Hires — how many people were actually hired this month (thousands). Falling hires even when openings are high = companies are posting jobs but not filling them (cautious).",
  JTSQUR: "JOLTS Quits rate — % of workers voluntarily leaving their jobs. High quits = workers feel confident they can find something better = strong economy. Falling quits = people are scared to leave.",
  JTSR: "Job openings rate — openings as a % of total employment plus openings. Higher = more demand for workers relative to supply.",
  GDPC1: "Real GDP (inflation-adjusted) — total economic output. The ultimate \"is the economy growing\" number. Negative = recession.",
  INDPRO: "Industrial Production Index — output from factories, mines, utilities. When this falls, physical economy is contracting.",
  RSXFS: "Retail sales excluding food services — how much consumers are actually spending. Consumer spending is 70% of GDP.",
  PCEC96: "Real personal consumption — what households spend (inflation-adjusted). The most direct demand signal.",
  CPIAUCSL: "CPI-U all items (seasonally adjusted) — the headline consumer price index. Year-over-year change is the \"inflation\" number often quoted in the press; here you see the index level over time.",
  PCEPI: "Personal Consumption Expenditures price index — broad consumption deflator. The Fed watches PCE (with core PCE) more than CPI for its inflation mandate.",
  PCEPILFE: "Core PCE — PCE excluding food and energy. The Fed's preferred gauge for underlying inflation trends; less volatile than headline.",
  HOUST: "New housing starts — builders break ground only when they're confident. A leading indicator that predicts economic conditions 6–12 months out.",
  UMCSENT: "University of Michigan Consumer Sentiment — survey of how optimistic Americans feel about the economy. Drops here predict spending pullbacks.",
  VIXCLS: "VIX — the \"fear index.\" Measures expected stock market volatility. Below 15 = calm. 20–30 = nervous. Above 30 = panic.",
  NFCI: "National Financial Conditions Index — combines 100+ financial indicators. Negative = easy money. Positive = tight conditions. When this rises, venture capital and AI funding dry up.",
  STLFSI4: "St. Louis Financial Stress Index — similar to NFCI but focused on stress signals. Above 0 = above-average stress. Spikes during banking crises.",
  DGS10: "10-Year Treasury yield — the benchmark interest rate for the economy. Higher = more expensive to borrow = harder for startups to raise money.",
  DGS2: "2-Year Treasury yield — reflects where markets think the Fed will set rates soon. When 2Y > 10Y, that's a yield curve inversion = recession signal.",
  T10Y2Y: "10Y minus 2Y spread — the yield curve slope. Negative = inverted = historically predicts recessions within 6–18 months. Positive and rising = expansion.",
  IPG3341S: "Industrial production: computer & electronic products. Direct measure of tech hardware manufacturing output.",
  IPG3342S: "Industrial production: communications equipment. Signals demand for networking/telecom hardware.",
};

function timeAgo(ts) {
  if (!ts) return "Never"; const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "Just now"; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`;
}
function staleMs(cadence) { return cadence === "realtime" ? 30*60000 : cadence === "daily" ? 23*3600000 : 6*86400000; }
function cadenceToMs(cadence) { return cadence === "realtime" ? 5*60000 : cadence === "daily" ? 60*60000 : 6*3600000; }
function getCacheStats() { let c=0,s=0; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(PFX)){c++;s+=(localStorage.getItem(k)||"").length;}} return{count:c,sizeKB:Math.round(s/1024)}; }

// ── HISTORICAL ENGINE ────────────────────────────────────────────────────────

const HIST_START = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

function hashKeywordsForVertical(vertical) {
  const ks = Object.values(vertical.keywords || {}).flatMap((obj) =>
    Object.values(obj || {}).flatMap((v) => (Array.isArray(v) ? [...v] : [String(v || "")]))
  ).map((s) => String(s || "").trim().toLowerCase()).filter(Boolean).sort();
  const raw = ks.join("|");
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) + raw.charCodeAt(i);
  return `k${Math.abs(h >>> 0).toString(36)}`;
}

function theirStackMockForced() {
  try {
    const v = String(import.meta.env.VITE_THEIRSTACK_MOCK || "").toLowerCase();
    return v === "true" || v === "1" || import.meta.env.VITE_THEIRSTACK_MOCK === true;
  } catch {
    return false;
  }
}
function mockTheirStackRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** Deterministic pseudo job counts for any keyword set + date range (demo when TheirStack API is off).
 *  Seed is pinned to ISO week of the midpoint so refreshes within the same week always return the same value. */
function mockTheirStackCountForRange(vertical, gte, lte) {
  const kw = vertical.keywords?.theirstack || {};
  const parts = [...(Array.isArray(kw.titleKeywords) ? kw.titleKeywords : []), ...(Array.isArray(kw.descriptionKeywords) ? kw.descriptionKeywords : [])]
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);
  const seedStr = `${vertical.id}|${parts.join(",")}`;
  let seed = 2166136261;
  for (let i = 0; i < seedStr.length; i++) seed = Math.imul(seed ^ seedStr.charCodeAt(i), 16777619);
  const gteMs = new Date(gte + "T12:00:00Z").getTime();
  const lteMs = new Date(lte + "T12:00:00Z").getTime();
  const midMs = (gteMs + lteMs) / 2;
  const spanDays = Math.max(1, Math.round((lteMs - gteMs) / 86400000) + 1);
  const monthsSince2021 = (midMs - Date.UTC(2021, 0, 15)) / (30.44 * 86400000);
  const weekIndex = Math.floor(midMs / (86400000 * 7));
  const rng = mockTheirStackRng((seed ^ weekIndex) >>> 0);
  const base = 12 + (Math.abs(seed) % 140);
  const growth = 1 + Math.min(2.4, Math.max(0, monthsSince2021 * 0.011));
  const seasonal = 1 + 0.06 * Math.sin((monthsSince2021 / 12) * Math.PI * 2);
  const noise = 0.97 + rng() * 0.06;
  const wave = 1 + 0.03 * Math.sin((weekIndex / 17) * Math.PI * 2);
  const dailyRate = (base * growth * seasonal * noise * wave) / 28;
  let count = Math.round(dailyRate * spanDays);
  count = Math.max(2, Math.min(12000, count));
  return count;
}
function buildMockTheirStackJobItems(nSample, vertical) {
  const titles = [
    "Senior ML Engineer — Production AI", "AI Product Manager", "MLOps Engineer", "GenAI Solutions Architect",
    "VP Data & AI Strategy", "AI Implementation Specialist", "Applied Scientist", "AI Governance Lead",
  ];
  const descs = [
    "deploy production models", "proof of concept pilot", "evaluate vendors", "strategy roadmap", "budget approval",
    "scale inference", "compliance automation",
  ];
  const kw = vertical.keywords?.theirstack || {};
  const focus = String((Array.isArray(kw.titleKeywords) && kw.titleKeywords[0]) || "AI").replace(/[<>]/g, "");
  const out = [];
  const rng = mockTheirStackRng((hashKeywordsForVertical(vertical).length * 9973) >>> 0);
  for (let i = 0; i < nSample; i++) {
    const t = titles[Math.floor(rng() * titles.length)];
    const d = descs[Math.floor(rng() * descs.length)];
    out.push({
      job_title: `${focus} · ${t}`,
      short_description: `Enterprise team hiring for ${d}. Stack: cloud, LLMs, safety.`,
    });
  }
  return out;
}
function historyKey(verticalId, keywordsHash) { return `${HSPFX}history_${verticalId}_${keywordsHash}`; }
function weeklyKey(verticalId, keywordsHash) { return `${HSPFX}weekly_${verticalId}_${keywordsHash}`; }
function historyLatestKey(verticalId) { return `${HSPFX}history_latest_${verticalId}`; }
function weeklyLatestKey(verticalId) { return `${HSPFX}weekly_latest_${verticalId}`; }
function patternNoteKey(verticalId) { return `${HSPFX}patterns_${verticalId}`; }
function crossCorrKey() { return `${HSPFX}crosscorr`; }
function ghWatchlistKey(verticalId) { return `${HSPFX}github_watchlist_${verticalId}`; }
function ghHistoryKey(verticalId) { return `${HSPFX}github_history_${verticalId}`; }
function ghLiveKey(verticalId) { return `${HSPFX}github_live_${verticalId}`; }
const GH_TIER_WEIGHTS = { CORE_FRAMEWORK: 1.0, ENTERPRISE_TOOL: 1.5, REFERENCE_IMPL: 0.5 };

function monthIntervals(fromDate = HIST_START, toDate = new Date()) {
  const out = [];
  const cur = new Date(fromDate + "T00:00:00");
  cur.setUTCDate(1);
  const end = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), 1));
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    const first = new Date(Date.UTC(y, m, 1));
    const last = new Date(Date.UTC(y, m + 1, 0));
    out.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      gte: first.toISOString().slice(0, 10),
      lte: last.toISOString().slice(0, 10),
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}
function weekIntervals(weeks = 12, toDate = new Date()) {
  const out = [];
  const end = new Date(toDate);
  end.setUTCHours(0, 0, 0, 0);
  for (let i = weeks - 1; i >= 0; i--) {
    const lte = new Date(end);
    lte.setUTCDate(end.getUTCDate() - i * 7);
    const gte = new Date(lte);
    gte.setUTCDate(lte.getUTCDate() - 6);
    const wk = isoWeekKey(lte);
    out.push({ key: wk, gte: gte.toISOString().slice(0, 10), lte: lte.toISOString().slice(0, 10) });
  }
  return out;
}
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
function mean(arr) { if (!arr.length) return 0; return arr.reduce((a, b) => a + b, 0) / arr.length; }
function smoothEMA(data, key, alpha = 0.3) {
  if (!data.length) return data;
  let ema = data[0][key];
  return data.map((d, i) => {
    const v = typeof d[key] === "number" && isFinite(d[key]) ? d[key] : ema;
    ema = i === 0 ? v : alpha * v + (1 - alpha) * ema;
    return { ...d, [`${key}_smooth`]: Math.round(ema * 100) / 100, [`${key}_raw`]: d[key] };
  });
}

/** Time-series sanitizer: dedup by day, reject point-level outlier spikes, clamp impossible swings. */
function sanitizeTimeSeries(data, valueKey = "value", opts = {}) {
  if (!data || data.length < 2) return data;
  const { maxSwingPct = 300, iqrMultiplier = 2.5 } = opts;
  let sorted = [...data].sort((a, b) => {
    const ta = a._ts || new Date(a.isoDate || a.ts || 0).getTime();
    const tb = b._ts || new Date(b.isoDate || b.ts || 0).getTime();
    return ta - tb;
  });
  const byDay = new Map();
  sorted.forEach(p => {
    const dk = (p.isoDate || new Date(p._ts || p.ts || 0).toISOString()).slice(0, 10);
    byDay.set(dk, p);
  });
  sorted = Array.from(byDay.values());
  if (sorted.length < 3) return sorted;

  const filteredVals = sorted.map(d => d[valueKey]).filter(v => typeof v === "number" && isFinite(v));
  if (filteredVals.length < 4) return sorted;
  const sortedVals = [...filteredVals].sort((a, b) => a - b);
  const q1 = sortedVals[Math.floor(sortedVals.length * 0.25)];
  const q3 = sortedVals[Math.floor(sortedVals.length * 0.75)];
  const iqr = q3 - q1;
  const fence = iqr > 0 ? iqr * iqrMultiplier : Infinity;
  const lo = q1 - fence;
  const hi = q3 + fence;
  return sorted.map((d, i) => {
    const v = d[valueKey];
    if (typeof v !== "number" || !isFinite(v)) return d;
    if (v < lo || v > hi) {
      const neighbors = sorted.slice(Math.max(0, i - 2), i + 3).filter((_, j) => j !== Math.min(2, i)).map(n => n[valueKey]).filter(n => typeof n === "number" && isFinite(n) && n >= lo && n <= hi);
      const replacement = neighbors.length > 0 ? Math.round(neighbors.reduce((a, b) => a + b, 0) / neighbors.length) : v;
      return { ...d, [valueKey]: replacement, _outlierClamped: true };
    }
    if (i > 0 && i < sorted.length - 1) {
      const prev = sorted[i - 1][valueKey];
      const next = sorted[i + 1][valueKey];
      if (typeof prev === "number" && typeof next === "number" && prev > 0 && next > 0) {
        const avgNeighbor = (prev + next) / 2;
        const swingFromAvg = Math.abs(v - avgNeighbor) / Math.max(avgNeighbor, 1) * 100;
        if (swingFromAvg > maxSwingPct) {
          return { ...d, [valueKey]: Math.round(avgNeighbor), _spikeClamped: true };
        }
      }
    }
    return d;
  });
}
function stddev(arr) { if (arr.length < 2) return 0; const m = mean(arr); return Math.sqrt(mean(arr.map(v => (v - m) ** 2))); }
function linearRegressionSlope(yVals) {
  const n = yVals.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(yVals);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (yVals[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
function rollingAvg(arr, win = 3) {
  return arr.map((_, i) => {
    const s = Math.max(0, i - win + 1);
    return mean(arr.slice(s, i + 1));
  });
}
function zScore(v, all) {
  const sd = stddev(all);
  if (!sd) return 0;
  return (v - mean(all)) / sd;
}
function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const aa = a.slice(0, n), bb = b.slice(0, n);
  const am = mean(aa), bm = mean(bb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = aa[i] - am, y = bb[i] - bm;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den ? num / den : 0;
}
function normalizeSeries(s) {
  const lo = Math.min(...s), hi = Math.max(...s);
  if (hi - lo < 1e-9) return s.map(() => 0.5);
  return s.map(v => (v - lo) / (hi - lo));
}
function dtwDistance6(a, b) {
  const n = Math.min(6, a.length, b.length);
  if (n === 0) return 1;
  const A = normalizeSeries(a.slice(-n));
  const B = normalizeSeries(b.slice(-n));
  const dp = Array.from({ length: n + 1 }, () => Array(n + 1).fill(Infinity));
  dp[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = Math.abs(A[i - 1] - B[j - 1]);
      dp[i][j] = cost + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[n][n] / n;
}
function detectInflections(monthly, baseline) {
  if (!monthly?.length) return [];
  const events = [];
  const counts = monthly.map(m => m.count || 0);
  const vel = counts.map((_, i) => i === 0 ? 0 : counts[i] - counts[i - 1]);
  const acc = vel.map((_, i) => i === 0 ? 0 : vel[i] - vel[i - 1]);
  let crossed = false;
  for (let i = 0; i < monthly.length; i++) {
    const m = monthly[i];
    const c = counts[i];
    if (!crossed && baseline > 0 && c >= 1.5 * baseline) {
      events.push({ month: m.month, label: "First breakout >1.5x baseline", type: "breakout" });
      crossed = true;
    }
    if (i >= 3 && vel[i] > 0 && vel.slice(i - 3, i).every(v => v <= 0)) events.push({ month: m.month, label: "Velocity turned positive", type: "reversal" });
    if (i >= 3 && acc[i] > 0 && acc.slice(i - 3, i).every(v => v <= 0)) events.push({ month: m.month, label: "Momentum flip positive", type: "momentum_flip" });
  }
  return events;
}
function deriveHistoryMetrics(monthly, weekly) {
  const counts = monthly.map(m => m.count || 0);
  const baseSlice = monthly.filter(m => m.month >= "2021-01" && m.month <= "2022-12").map(m => m.count || 0);
  const baseline = mean(baseSlice.length ? baseSlice : counts);
  const baselineStdDev = stddev(baseSlice.length ? baseSlice : counts);
  const cur = counts[counts.length - 1] || 0;
  const peakCount = counts.length ? Math.max(...counts) : 0;
  const peakIdx = counts.findIndex(v => v === peakCount);
  const peakMonth = peakIdx >= 0 ? monthly[peakIdx].month : "";
  const currentVsBaseline = baseline > 0 ? cur / baseline : 0;
  const vel6 = linearRegressionSlope(counts.slice(-6));
  const momVelSeries = counts.map((_, i) => i === 0 ? 0 : counts[i] - counts[i - 1]);
  const accel = linearRegressionSlope(momVelSeries.slice(-6));
  const allTimeHighPct = peakCount > 0 ? (cur / peakCount) * 100 : 0;
  let monthsAbove2xBaseline = 0;
  for (let i = counts.length - 1; i >= 0; i--) {
    if (baseline > 0 && counts[i] >= 2 * baseline) monthsAbove2xBaseline++;
    else break;
  }
  const z = zScore(cur, counts);
  const inflections = detectInflections(monthly, baseline);
  const rolling3 = rollingAvg(counts, 3);
  const monthlyWithIdx = monthly.map((m, i) => ({
    ...m,
    index: baseline > 0 ? Math.round((m.count / baseline) * 100) : 0,
    rolling3: Math.round(rolling3[i] || 0),
    z: baselineStdDev > 0 ? (m.count - baseline) / baselineStdDev : 0,
    inflection: inflections.find(e => e.month === m.month)?.label || "",
  }));
  const weeklyWithIdx = (weekly || []).map((w) => ({ ...w, index: baseline > 0 ? Math.round((w.count / baseline) * 100) : 0 }));
  return {
    monthly: monthlyWithIdx,
    weekly: weeklyWithIdx,
    derived: {
      baseline,
      baselineStdDev,
      peakCount,
      peakMonth,
      currentVsBaseline,
      velocitySlope: vel6,
      accelerationScore: accel,
      anomalyZ: z,
      allTimeHighPct,
      monthsAbove2xBaseline,
      inflections,
    },
  };
}
function computeCrossCorrMatrix(histByVertical) {
  const ids = Object.keys(histByVertical);
  const matrix = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      const a = (histByVertical[ids[i]]?.monthly || []).map(x => x.count || 0);
      const b = (histByVertical[ids[j]]?.monthly || []).map(x => x.count || 0);
      let bestLag = 0, bestR = -2;
      for (let lag = 0; lag <= 12; lag++) {
        const aa = a.slice(lag);
        const bb = b.slice(0, b.length - lag);
        const r = correlation(aa, bb);
        if (r > bestR) { bestR = r; bestLag = lag; }
      }
      matrix.push({ leader: ids[i], follower: ids[j], lagMonths: bestLag, r: bestR });
    }
  }
  return matrix;
}

// ── GITHUB HISTORICAL ENGINE ────────────────────────────────────────────────

function monthFromTs(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}
function rollingAvgSeries(rows, key, win = 3) {
  return rows.map((_, i) => {
    const s = Math.max(0, i - win + 1);
    return mean(rows.slice(s, i + 1).map(r => r[key] || 0));
  });
}
function generateGitHubBigQuerySQL(repos) {
  const cleaned = [...new Set((repos || []).map(r => (r.repo || "").trim()).filter(Boolean))];
  const repoIn = cleaned.length ? cleaned.map(r => `'${r}'`).join(",\n    ") : "'owner/repo'";
  return `SELECT
  FORMAT_TIMESTAMP('%Y-%m', created_at) AS month,
  repo.name AS repo_name,
  type AS event_type,
  COUNT(*) AS event_count
FROM
  \`githubarchive.month.*\`
WHERE
  _TABLE_SUFFIX BETWEEN '202101' AND FORMAT_TIMESTAMP('%Y%m', CURRENT_TIMESTAMP())
  AND repo.name IN (
    ${repoIn}
  )
  AND type IN ('WatchEvent', 'ForkEvent', 'PushEvent')
GROUP BY
  month, repo_name, event_type
ORDER BY
  month ASC, repo_name ASC`;
}
function parseCsvRows(text) {
  if (window.Papa?.parse) {
    const parsed = window.Papa.parse(text, { header: true, skipEmptyLines: true });
    return parsed.data || [];
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map((ln) => {
    const cols = ln.split(",");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || "").trim(); });
    return obj;
  });
}
function aggregateGitHubCsv(rows, watchlist) {
  const required = ["month", "repo_name", "event_type", "event_count"];
  if (!rows.length || required.some(k => !(k in rows[0]))) throw new Error("CSV must include month, repo_name, event_type, event_count");
  const tierByRepo = {};
  (watchlist || []).forEach(w => { if (w.repo) tierByRepo[w.repo] = w.tier || "CORE_FRAMEWORK"; });
  const map = {};
  rows.forEach((r) => {
    const month = (r.month || "").trim();
    const repo = (r.repo_name || "").trim();
    const type = (r.event_type || "").trim();
    const c = Number(r.event_count || 0);
    if (!month) return;
    if (!map[month]) map[month] = { month, stars:0, forks:0, pushes:0, total_events:0, weighted_events:0, enterprise_events:0 };
    if (type === "WatchEvent") map[month].stars += c;
    if (type === "ForkEvent") map[month].forks += c;
    if (type === "PushEvent") map[month].pushes += c;
    map[month].total_events += c;
    const tier = tierByRepo[repo] || "CORE_FRAMEWORK";
    const w = GH_TIER_WEIGHTS[tier] || 1;
    map[month].weighted_events += c * w;
    if (tier === "ENTERPRISE_TOOL") map[month].enterprise_events += c;
  });
  const monthly = Object.values(map).sort((a,b)=>a.month.localeCompare(b.month));
  const baseline2021 = mean(monthly.filter(m => m.month.startsWith("2021-")).map(m => m.total_events));
  const starsVel = linearRegressionSlope(monthly.slice(-3).map(m => m.stars || 0));
  const rolling = rollingAvgSeries(monthly, "total_events", 3);
  const out = monthly.map((m, i) => ({
    ...m,
    rolling3: Math.round(rolling[i] || 0),
    index: baseline2021 > 0 ? Math.round((m.total_events / baseline2021) * 100) : 0,
    enterprise_ratio: m.total_events > 0 ? (m.enterprise_events / m.total_events) * 100 : 0,
  }));
  const cur = out[out.length - 1] || { total_events:0, index:0, enterprise_ratio:0 };
  return {
    monthly: out,
    derived: {
      baseline2021,
      currentIndex: cur.index || 0,
      currentVsBaseline: baseline2021 > 0 ? (cur.total_events / baseline2021) : 0,
      starVelocity: starsVel,
      enterpriseRepoRatio: cur.enterprise_ratio || 0,
    }
  };
}
function lastNArchiveHours(n = 3) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getTime() - i * 3600000);
    out.push({
      hour: `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}-${d.getUTCHours()}`,
      url: `https://data.gharchive.org/${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}-${d.getUTCHours()}.json.gz`
    });
  }
  return out;
}
async function streamGhArchiveFile(url, onEvent) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`GH Archive HTTP ${res.status}`);
  if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream unsupported");
  const ds = new DecompressionStream("gzip");
  const reader = res.body.pipeThrough(ds).getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf("\n");
    while (idx >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) {
        try { onEvent(JSON.parse(line)); } catch {}
      }
      idx = buf.indexOf("\n");
    }
  }
  if (buf.trim()) { try { onEvent(JSON.parse(buf)); } catch {} }
}
function computeLagBetweenSeries(leadMonthly, followMonthly) {
  const a = (leadMonthly || []).map(m => m.total_events ?? m.count ?? 0);
  const b = (followMonthly || []).map(m => m.count ?? m.total_events ?? 0);
  let bestLag = 0, bestR = -2;
  for (let lag = 0; lag <= 12; lag++) {
    const aa = a.slice(lag);
    const bb = b.slice(0, b.length - lag);
    const r = correlation(aa, bb);
    if (r > bestR) { bestR = r; bestLag = lag; }
  }
  return { lagMonths: bestLag, r: bestR };
}

// ── WEEKLY BRIEF ENGINE ──────────────────────────────────────────────────────

function weekKeyFromDate(dt = new Date()) {
  const w = isoWeekKey(dt); // YYYY-W##
  return w;
}
function briefStorageKey(weekKey) { return `${HSPFX}brief_${weekKey}`; }
const BRIEF_LAST_KEY = `${HSPFX}brief_last_generated`;

function pruneOldBriefs(maxWeeks = 12) {
  const now = Date.now();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(`${HSPFX}brief_`) || k === BRIEF_LAST_KEY) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k) || "{}");
      const ts = new Date(v.generated_at || 0).getTime();
      if (!ts || now - ts > maxWeeks * 7 * 86400000) localStorage.removeItem(k);
    } catch {}
  }
}
function trimPayloadSize(obj, maxChars = 20000) {
  let s = JSON.stringify(obj);
  if (s.length <= maxChars) return obj;
  const copy = JSON.parse(JSON.stringify(obj));
  (copy.verticals || []).forEach((v) => {
    const sigs = v.signals || {};
    Object.values(sigs).forEach(sig => {
      if (sig?.time_series?.recent_values) sig.time_series.recent_values = sig.time_series.recent_values.slice(-21);
    });
    if (v.theirstack_historical?.recent_monthly) v.theirstack_historical.recent_monthly = v.theirstack_historical.recent_monthly.slice(-6);
    if (v.theirstack_historical?.inflection_points) v.theirstack_historical.inflection_points = v.theirstack_historical.inflection_points.slice(-3);
  });
  s = JSON.stringify(copy);
  if (s.length <= maxChars) return copy;
  (copy.verticals || []).forEach((v) => {
    const sigs = v.signals || {};
    Object.values(sigs).forEach(sig => {
      if (sig?.time_series?.recent_values) sig.time_series.recent_values = sig.time_series.recent_values.slice(-14);
    });
    if (v.divergence_signals?.length > 3) v.divergence_signals = v.divergence_signals.slice(0, 3);
  });
  s = JSON.stringify(copy);
  if (s.length <= maxChars) return copy;
  const ca = copy.cross_vertical_analysis;
  if (ca?.lag_leader_relationships) ca.lag_leader_relationships = ca.lag_leader_relationships.slice(0, 4);
  if (copy.ai_supply_side?.hf_download_trend?.recent_values) copy.ai_supply_side.hf_download_trend.recent_values = copy.ai_supply_side.hf_download_trend.recent_values.slice(-14);
  return copy;
}
function sanitizeBriefOutput(text) {
  if (!text) return "";
  // Strip markdown links entirely — drop both label and URL since labels are often citation titles
  text = text.replace(/\[([^\]]*)\]\(https?:\/\/[^)]+\)/g, (_, label) => {
    // Keep the label only if it looks like real prose (not a citation title with " - " site name pattern)
    if (/\s-\s.*(CNBC|Yahoo|Google|Finance|Forbes|Reuters|Bloomberg|Seeking Alpha|devFlokers|Forge|Relvai|marketingprofs|crescendo)/i.test(label)) return "";
    return label;
  });
  // Strip raw URLs
  text = text.replace(/https?:\/\/\S+/g, "");
  // Strip %%LINK%%...%%ENDLINK%% artifacts
  text = text.replace(/%%LINK%%(.+?)%%HREF%%[^%]*%%ENDLINK%%/g, "");
  text = text.replace(/%%(?:LINK|HREF|ENDLINK)%%/g, "");
  // Strip SOURCES/References sections at the end (multiple patterns)
  text = text.replace(/\n+━*\s*\n*(?:SOURCES?|REFERENCES?)\s*\n[\s\S]*$/im, "");
  text = text.replace(/\n+#{1,3}\s*(?:SOURCES?|REFERENCES?)\s*\n[\s\S]*$/im, "");
  text = text.replace(/\n+\d+\s*(?:SOURCES?|REFERENCES?)\s*\n[\s\S]*$/im, "");
  // Strip numbered source/reference lists
  text = text.replace(/\n+\d+\.\s*\[?[^\n]*https?:\/\/[^\n]*/g, "");
  // Strip "Source:" inline
  text = text.replace(/\s*Sources?:?\s*(?:https?:\/\/\S+|\S+\.(?:com|org|net|io)\S*)/gi, "");
  // Strip "according to [source]" parentheticals
  text = text.replace(/\s*\((?:source|via|per|from):?\s*[^)]*\)/gi, "");
  // Strip "(Composite Score: N)"
  text = text.replace(/\s*\(Composite Score:?\s*\d+\)/gi, "");
  // Strip "Composite Score: N" without parens
  text = text.replace(/Composite Score:?\s*\d+/gi, "");
  // Clean orphaned pipe separators (e.g. " | " left after link removal)
  text = text.replace(/\s*\|\s*\|\s*/g, " ");
  text = text.replace(/\s*\|\s*$/gm, "");
  text = text.replace(/^\s*\|\s*/gm, "");
  text = text.replace(/\s+\|\s+(?=\n|$)/g, "");
  // Clean double/triple spaces left by removals
  text = text.replace(/ {2,}/g, " ");
  // Clean lines that are now just whitespace or punctuation
  text = text.replace(/^\s*[|,;]\s*$/gm, "");
  // Clean excess blank lines
  text = text.replace(/\n{3,}/g, "\n\n");
  // Collapse duplicated SEO-style titles (e.g. "| News |" loops) and exact phrase repeats
  text = text.replace(/(?:\s*\|\s*[^|\n]{1,50}){4,}/g, " ");
  text = text.replace(/(.{30,100})(?:\s+\1){2,}/gi, "$1");
  return text.trim();
}

function offlineBriefFromContext(ctx) {
  const date = new Date(ctx.generated_at).toLocaleString();
  const header = `AI DEMAND SIGNAL WEEKLY INTELLIGENCE REPORT\nWeek of ${ctx.week}\nGenerated: ${date} (AI-powered analysis unavailable — raw data summary)\nVerticals tracked: ${ctx.total_verticals_tracked || 0}\n`;

  const regime = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nREGIME DASHBOARD\n` + (ctx.verticals || []).map((v) => {
    const j = v.signals?.job_postings;
    const g = v.signals?.google_trends;
    const r = v.signals?.github_repos;
    const ts = j?.time_series;
    const mom = ts?.rolling_momentum_5pt_pct;
    let reg = "STEADY_GROWTH";
    if (mom > 15) reg = "ACCELERATING";
    else if (mom < -15) reg = "DECELERATING";
    else if (mom !== null && Math.abs(mom) <= 5) reg = "PLATEAUING";
    return `${v.name} | ${reg} | Jobs: ${j?.current_count || "n/a"} (${ts?.pct_change_vs_previous != null ? (ts.pct_change_vs_previous >= 0 ? "+" : "") + ts.pct_change_vs_previous + "%" : "n/a"} vs prev) | Trends: ${g?.current_index || "n/a"} | Repos: ${r?.active_repos_30d || "n/a"}`;
  }).join("\n");

  const divs = (ctx.verticals || []).filter(v => v.divergence_signals?.length > 0);
  const divSection = divs.length ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nDIVERGENCES DETECTED\n` + divs.flatMap(v => v.divergence_signals.map(d => `${v.name}: ${d.pair} — ${d.interpretation}`)).join("\n") : "";

  const cv = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCROSS-VERTICAL\n${(ctx.cross_vertical_analysis)?.systemic_vs_sector === "systemic_wave" ? "Multiple verticals moving in concert — signals a systemic AI adoption wave." : "Verticals diverging — sector-specific dynamics dominate. Watch for rotation signals."}`;

  const hf = ctx.ai_supply_side?.hugging_face_leaderboard;
  const supply = hf?.length ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nAI SUPPLY SIDE (Hugging Face)\n` + hf.map(h => `${h.org}: ${(h.total_downloads/1e6).toFixed(1)}M downloads, ${h.model_count} models`).join("\n") : "";

  const dq = ctx.data_quality_flags?.length ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nDATA QUALITY FLAGS\n${ctx.data_quality_flags.map(x => `- ${x}`).join("\n")}` : "";

  const vis = (ctx.verticals || []).map((v) => {
    const jm = (v.theirstack_historical?.recent_monthly || []).map((m) => m.count || 0);
    const jv = jm.length >= 2 ? jm : (v.signals?.job_postings?.time_series?.recent_values || []).map((p) => p.value || 0);
    const tv = (v.signals?.google_trends?.time_series?.recent_values || []).map((p) => p.value || 0);
    return `${v.name}  Jobs ${asciiSparkline(jv)}  Trends ${asciiSparkline(tv)}`;
  }).join("\n");
  const visSection = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nTREND STRIPS (ASCII)\n${vis}`;

  return `${header}${regime}${divSection}${cv}${supply}${dq}${visSection}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nNOTE: Full AI-powered analysis (inflection detection, divergence interpretation, actionable recommendations) requires Anthropic API key. This is a raw data summary only.`;
}
function asciiSparkline(values) {
  const v = (values || []).map(Number).filter((x) => !Number.isNaN(x));
  if (!v.length) return "—";
  const blocks = "▁▂▃▄▅▆▇█";
  const lo = Math.min(...v), hi = Math.max(...v);
  if (hi <= lo) return blocks[4].repeat(v.length);
  return v.map((n) => {
    const t = (n - lo) / (hi - lo);
    const idx = Math.min(blocks.length - 1, Math.round(t * (blocks.length - 1)));
    return blocks[idx];
  }).join("");
}
function buildBriefAsciiCharts(snapshot) {
  if (!snapshot?.verticals?.length) return "";
  const lines = snapshot.verticals.map((v) => {
    const jm = (v.theirstack_historical?.recent_monthly || []).map((m) => m.count || 0);
    const jv = jm.length >= 2 ? jm : (v.signals?.job_postings?.time_series?.recent_values || []).map((p) => p.value || 0);
    const tv = (v.signals?.google_trends?.time_series?.recent_values || []).map((p) => p.value || 0);
    return `${v.name}: Jobs ${asciiSparkline(jv)} | Trends ${asciiSparkline(tv)}`;
  });
  return `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nDASHBOARD TREND STRIPS (ASCII)\n${lines.join("\n")}`;
}
function simpleMarkdownToHtml(md, opts = {}) {
  if (!md) return "";
  const reader = !!opts.reader;
  const clean = sanitizeBriefOutput(md);
  const esc = (s) => escapeHtml(s);
  const F = "Inter,system-ui,-apple-system,sans-serif";
  const serif = "'Source Serif 4',Georgia,serif";
  const bodyFont = reader ? `400 16px/1.75 ${serif}` : `400 14px/1.75 ${F}`;
  const lines = String(clean).split("\n");
  const out = [];
  let para = [];
  const flush = () => {
    if (!para.length) return;
    let raw = esc(para.join(" "));
    raw = raw.replace(/\*\*(.+?)\*\*/g, "<strong style=\"font-weight:600\">$1</strong>");
    out.push(`<p style="margin:0 0 ${reader ? "18px" : "14px"};line-height:1.75;color:#1f2937;font:${bodyFont}">${raw}</p>`);
    para = [];
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (t.startsWith("### ")) { flush(); out.push(`<h3 style="font:600 ${reader ? "15px" : "14px"}/1.3 ${F};margin:20px 0 8px;color:#111827">${esc(t.slice(4))}</h3>`); continue; }
    if (t.startsWith("## ")) { flush(); out.push(`<h2 style="font:700 ${reader ? "18px" : "16px"}/1.3 ${F};margin:24px 0 10px;color:#111827">${esc(t.slice(3))}</h2>`); continue; }
    if (t.startsWith("# ")) { flush(); out.push(`<h1 style="font:700 ${reader ? "22px" : "20px"}/1.2 ${F};margin:0 0 12px;color:#111827;letter-spacing:-0.02em">${esc(t.slice(2))}</h1>`); continue; }
    if (/^━+$/.test(t) || t === "---") { flush(); out.push(`<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0" />`); continue; }
    if (t.startsWith("• ") || t.startsWith("- ") || t.startsWith("* ")) { flush(); out.push(`<div style="display:flex;gap:8px;margin:0 0 8px;font:${reader ? `400 16px/1.65 ${serif}` : `400 14px/1.65 ${F}`};color:#1f2937"><span style="color:#9ca3af;flex-shrink:0;font-size:8px;margin-top:7px">●</span><span>${esc(t.slice(2)).replace(/\*\*(.+?)\*\*/g, "<strong style=\"font-weight:600\">$1</strong>")}</span></div>`); continue; }
    para.push(t);
  }
  flush();
  return out.join("\n");
}
function buildSvgSparkline(vals, w, h, stroke) {
  const v = (vals || []).map(Number);
  if (v.length < 2) return "";
  const pad = { t: 8, r: 8, b: 8, l: 8 };
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const step = cw / (v.length - 1);
  const pts = v.map((n, i) => {
    const x = pad.l + i * step;
    const y = pad.t + (1 - (n - lo) / span) * ch;
    return [x, y];
  });
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const areaD = d + `L${pts[pts.length - 1][0].toFixed(1)},${(h - pad.b).toFixed(1)}L${pts[0][0].toFixed(1)},${(h - pad.b).toFixed(1)}Z`;
  const gradId = `sg_${Math.random().toString(36).slice(2, 8)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;max-width:100%"><defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${stroke}" stop-opacity="0.12"/><stop offset="100%" stop-color="${stroke}" stop-opacity="0.01"/></linearGradient></defs><rect fill="#f9fafb" width="100%" height="100%" rx="6"/><path d="${areaD}" fill="url(#${gradId})"/><path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.5" fill="${stroke}"/></svg>`;
}
function buildBriefChartsHtml(ctx) {
  if (!ctx?.verticals?.length) return "";
  const parts = [`<div style="font:12px Inter,system-ui,sans-serif;color:#4b5163;margin-bottom:12px">Trend snapshots from your dashboard at report generation time.</div>`];
  for (const v of ctx.verticals) {
    const mon = v.theirstack_historical?.recent_monthly || [];
    const jobVals = mon.length >= 2 ? mon.map((m) => m.count || 0) : (v.signals?.job_postings?.time_series?.recent_values || []).map((p) => p.value || 0);
    const trendVals = (v.signals?.google_trends?.time_series?.recent_values || []).map((p) => p.value || 0);
    parts.push(`<div style="margin-bottom:14px;padding:12px;border:1px solid #e1e4ea;border-radius:8px;background:#fff">`);
    parts.push(`<div style="font:600 13px Inter,system-ui,sans-serif;color:#1a1d26;margin-bottom:8px">${escapeHtml(v.name)}</div>`);
    parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`);
    if (jobVals.length >= 2) {
      parts.push(`<td style="vertical-align:top;width:50%;padding-right:6px"><div style="font:10px Arial,sans-serif;color:#8b92a5;margin-bottom:4px">Job postings (index / count)</div>${buildSvgSparkline(jobVals, 280, 52, "#0284c7")}</td>`);
    } else {
      parts.push(`<td style="vertical-align:top;width:50%;padding-right:6px"><div style="font:10px Arial,sans-serif;color:#8b92a5">Jobs: need more history</div></td>`);
    }
    if (trendVals.length >= 2) {
      parts.push(`<td style="vertical-align:top;width:50%;padding-left:6px"><div style="font:10px Arial,sans-serif;color:#8b92a5;margin-bottom:4px">Google Trends (0–100)</div>${buildSvgSparkline(trendVals, 280, 52, "#2563eb")}</td>`);
    } else {
      parts.push(`<td style="vertical-align:top;width:50%;padding-left:6px"><div style="font:10px Arial,sans-serif;color:#8b92a5">Trends: need more history</div></td>`);
    }
    parts.push(`</tr></table></div>`);
  }
  return `<div style="margin:0 0 20px 0">${parts.join("")}</div>`;
}
function briefEmailHtmlDocument(week, snapshot, markdownBody, diffMode, baseForDiff) {
  const F = "Inter,system-ui,-apple-system,sans-serif";
  const cleanBody = sanitizeBriefOutput(markdownBody || "");
  const cleanBase = sanitizeBriefOutput(baseForDiff || "");
  if (!diffMode && snapshot) return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Weekly Brief ${escapeHtml(week)}</title></head><body style="margin:0;padding:32px;background:#f3f4f6;font-family:${F}">${buildVisualBriefHtml(cleanBody, snapshot, week)}</body></html>`;
  const charts = buildBriefChartsHtml(snapshot);
  const inner = diffMode
    ? paragraphDiffHtml(cleanBase, cleanBody)
    : `${charts}<div style="font:14px/1.75 ${F};color:#1f2937">${simpleMarkdownToHtml(cleanBody)}</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Weekly Brief ${escapeHtml(week)}</title></head><body style="margin:0;padding:32px;background:#f3f4f6;font-family:${F}"><div style="max-width:740px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:32px 36px">${inner}</div></body></html>`;
}

function buildSvgBarChart(values, labels, w, h, color, labelColor = "#9ca3af") {
  if (!values?.length || values.length < 2) return "";
  const pad = { t: 10, r: 10, b: 22, l: 42 };
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
  const max = Math.max(...values, 1);
  const barW = Math.max(4, Math.min(20, (cw / values.length) * 0.65));
  const gap = (cw - barW * values.length) / Math.max(1, values.length - 1);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;max-width:100%"><rect fill="#f9fafb" width="100%" height="100%" rx="6"/>`;
  for (let i = 0; i <= 3; i++) {
    const y = pad.t + ch - (ch * i / 3);
    const lbl = Math.round(max * i / 3);
    svg += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#f3f4f6" stroke-width="1"/>`;
    svg += `<text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" fill="${labelColor}" font-size="8" font-family="Inter,system-ui,sans-serif">${lbl}</text>`;
  }
  values.forEach((v, i) => {
    const bh = Math.max(1, (v / max) * ch);
    const x = pad.l + i * (barW + gap);
    const y = pad.t + ch - bh;
    const isLast = i === values.length - 1;
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${color}" rx="2" opacity="${isLast ? "1" : "0.6"}"/>`;
    if (labels?.[i] && (i === 0 || i === values.length - 1 || i % Math.max(1, Math.floor(values.length / 5)) === 0)) {
      svg += `<text x="${x + barW / 2}" y="${h - 5}" text-anchor="middle" fill="${labelColor}" font-size="7" font-family="Inter,system-ui,sans-serif">${escapeHtml(String(labels[i]).slice(-5))}</text>`;
    }
  });
  svg += `</svg>`;
  return svg;
}

function buildVisualBriefHtml(text, ctx, week, opts = {}) {
  const reader = !!opts.reader;
  text = sanitizeBriefOutput(text || "");
  if (!ctx) {
    const inner = simpleMarkdownToHtml(text, { reader });
    const wrap = reader
      ? `<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:40px 44px 48px;box-shadow:0 25px 50px -12px rgba(0,0,0,.1)">${inner}</div>`
      : `<div style="max-width:740px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:32px 36px"><div style="font:15px/1.75 Georgia,serif;color:#1a1d26">${inner}</div></div>`;
    return wrap;
  }
  const esc = escapeHtml;
  const F = "Inter,system-ui,-apple-system,sans-serif";
  const cardPad = reader ? "26px 30px" : "24px 28px";
  const card = (content, opts = {}) => `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:${reader ? "12px" : "10px"};padding:${cardPad};margin-bottom:${reader ? "16px" : "14px"};${opts.accent ? `border-top:3px solid ${opts.accent}` : ""}">${content}</div>`;
  const secLabel = (title) => `<div style="font:600 10px/1 ${F};text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;margin-bottom:14px">${esc(title)}</div>`;
  const badge = (label, level) => {
    const m = { HIGH: { bg: "#ecfdf5", fg: "#059669" }, MEDIUM: { bg: "#fefce8", fg: "#a16207" }, LOW: { bg: "#fef2f2", fg: "#dc2626" }, ACCELERATING: { bg: "#ecfdf5", fg: "#059669" }, STEADY_GROWTH: { bg: "#ecfdf5", fg: "#059669" }, INFLECTING_UP: { bg: "#eff6ff", fg: "#2563eb" }, PLATEAUING: { bg: "#fefce8", fg: "#a16207" }, DECELERATING: { bg: "#fef2f2", fg: "#dc2626" }, CONTRACTING: { bg: "#fef2f2", fg: "#dc2626" }, BOTTOMING: { bg: "#faf5ff", fg: "#7c3aed" } };
    const s = m[level] || m.MEDIUM;
    return `<span style="display:inline-block;padding:3px 10px;border-radius:99px;font:600 9px/1.2 ${F};background:${s.bg};color:${s.fg};letter-spacing:0.02em">${esc(label)}</span>`;
  };
  const fmtPct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v}%`;
  const fmtNum = (v) => v == null ? "—" : typeof v === "number" ? v.toLocaleString() : v;
  const kpiCell = (label, value, color) => `<div style="flex:1;min-width:100px;padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #f3f4f6"><div style="font:500 9px/1 ${F};color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${esc(label)}</div><div style="font:700 18px/1 ${F};color:${color || "#111827"}">${value}</div></div>`;

  const parts = [];
  const rootMax = reader ? "min(680px,100%)" : "860px";
  parts.push(`<div style="max-width:${rootMax};margin:0 auto;font-family:${F};color:#111827;${reader ? "letter-spacing:0.01em" : ""}">`);

  // ── MASTHEAD ──
  const dateStr = ctx.generated_at ? new Date(ctx.generated_at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "";
  const mastPad = reader ? "32px 36px" : "28px 32px";
  const mastRadius = reader ? "12px" : "10px";
  parts.push(`<div style="background:#111827;color:#fff;border-radius:${mastRadius};padding:${mastPad};margin-bottom:${reader ? "18px" : "14px"}">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">` +
    `<div><div style="font:300 10px/1 ${F};text-transform:uppercase;letter-spacing:0.14em;color:#6b7280;margin-bottom:8px">Weekly Intelligence Brief</div>` +
    `<div style="font:700 24px/1.1 ${F};letter-spacing:-0.02em">AI Demand Signals</div>` +
    `<div style="font:400 12px/1 ${F};color:#9ca3af;margin-top:8px">Week of ${esc(week)} · ${esc(dateStr)}</div></div>` +
    `</div></div>`);

  // ── REGIME TABLE ──
  if (ctx.verticals?.length) {
    let table = secLabel("Signal Regime Dashboard");
    table += `<div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f9fafb">`;
    ["Vertical", "Regime", "Jobs", "Trends", "Repos", "Claude"].forEach((h) => {
      table += `<th style="text-align:left;padding:10px 12px;font:600 9px/1 ${F};color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e7eb;white-space:nowrap">${h}</th>`;
    });
    table += `</tr></thead><tbody>`;
    ctx.verticals.forEach((v, i) => {
      const jobs = v.signals?.job_postings;
      const trends = v.signals?.google_trends;
      const repos = v.signals?.github_repos;
      const claude = v.signals?.claude_code_attribution;
      const stage = v.pipeline_stage;
      const mom = jobs?.time_series?.rolling_momentum_5pt_pct;
      let regime = "STEADY_GROWTH";
      if (mom > 15) regime = "ACCELERATING";
      else if (mom < -15) regime = "DECELERATING";
      else if (mom != null && Math.abs(mom) <= 5) regime = "PLATEAUING";
      else if (stage?.label) regime = stage.label.toUpperCase().replace(/\s+/g, "_");
      const bdr = i < ctx.verticals.length - 1 ? "border-bottom:1px solid #f3f4f6;" : "";
      const tblKw = Object.values(v.keywords || {}).flatMap(obj => Object.values(obj || {}).flatMap(arr => Array.isArray(arr) ? arr.filter(Boolean) : [String(arr || "")].filter(Boolean)));
      const tblUniqueKw = [...new Set(tblKw)].slice(0, 5);
      table += `<tr><td style="padding:10px 12px;${bdr}"><div style="font:600 12px/1.3 ${F}">${esc(v.name)}</div>${tblUniqueKw.length ? `<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:2px">${tblUniqueKw.map(k => `<span style="font:400 8px/1 ${F};padding:1px 5px;border-radius:3px;background:#f3f4f6;color:#9ca3af">${esc(k)}</span>`).join("")}${tblKw.length > 5 ? `<span style="font:400 8px/1 ${F};color:#9ca3af">+${tblKw.length - 5}</span>` : ""}</div>` : ""}</td>`;
      table += `<td style="padding:10px 12px;${bdr}">${badge(regime.replace(/_/g, " "), regime)}</td>`;
      table += `<td style="padding:10px 12px;font:500 12px ${F};${bdr}">${fmtNum(jobs?.current_count)} <span style="color:#9ca3af;font-size:10px">${fmtPct(jobs?.time_series?.pct_change_vs_previous)}</span></td>`;
      table += `<td style="padding:10px 12px;font:500 12px ${F};${bdr}">${fmtNum(trends?.current_index)}</td>`;
      table += `<td style="padding:10px 12px;font:500 12px ${F};${bdr}">${fmtNum(repos?.active_repos_30d)}</td>`;
      table += `<td style="padding:10px 12px;font:500 12px ${F};${bdr}">${fmtNum(claude?.commits_7d)}</td></tr>`;
    });
    table += `</tbody></table></div>`;
    parts.push(card(table));
  }

  // ── SIGNAL CHARTS PER VERTICAL ──
  if (ctx.verticals?.length) {
    ctx.verticals.forEach((v) => {
      const mon = v.theirstack_historical?.recent_monthly || [];
      const jobVals = mon.length >= 2 ? mon.map((m) => m.count || 0) : (v.signals?.job_postings?.time_series?.recent_values || []).map((p) => p.value || 0);
      const jobLabels = mon.length >= 2 ? mon.map((m) => m.month || "") : (v.signals?.job_postings?.time_series?.recent_values || []).map((p) => p.date?.slice(5, 10) || "");
      const trendVals = (v.signals?.google_trends?.time_series?.recent_values || []).map((p) => p.value || 0);
      const trendLabels = (v.signals?.google_trends?.time_series?.recent_values || []).map((p) => p.date?.slice(5, 10) || "");
      const repoVals = (v.signals?.github_repos?.time_series?.recent_values || []).map((p) => p.value || 0);
      const claudeVals = (v.signals?.claude_code_attribution?.time_series?.recent_values || []).map((p) => p.value || 0);
      const noData = `<div style="font:400 11px ${F};color:#d1d5db;padding:18px 0;text-align:center">No data</div>`;
      const chartLabel = (t) => `<div style="font:600 9px/1 ${F};color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${t}</div>`;
      const chartDates = (labels) => labels.length >= 2 ? `<div style="display:flex;justify-content:space-between;font:400 8px ${F};color:#d1d5db;margin-top:3px"><span>${esc(labels[0])}</span><span>${esc(labels[labels.length - 1])}</span></div>` : "";

      const allKw = Object.values(v.keywords || {}).flatMap(obj => Object.values(obj || {}).flatMap(arr => Array.isArray(arr) ? arr.filter(Boolean) : [String(arr || "")].filter(Boolean)));
      const uniqueKw = [...new Set(allKw)];
      let html = `<div style="margin-bottom:14px">` +
        `<div style="display:flex;align-items:center;gap:10px;margin-bottom:${uniqueKw.length ? 6 : 0}px">` +
        `<div style="font:700 15px/1 ${F};color:#111827">${esc(v.name)}</div>` +
        (v.pipeline_stage?.label ? ` ${badge(v.pipeline_stage.label, v.pipeline_stage.label.toUpperCase().replace(/\s+/g, "_"))}` : "") +
        `</div>` +
        (uniqueKw.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${uniqueKw.map(k => `<span style="font:500 10px/1 ${F};padding:3px 8px;border-radius:4px;background:#f3f4f6;color:#6b7280">${esc(k)}</span>`).join("")}</div>` : "") +
        `</div>`;
      html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">`;
      html += `<div>${chartLabel("Job Postings")}${jobVals.length >= 2 ? buildSvgBarChart(jobVals, jobLabels, 360, 90, "#2563eb", "#9ca3af") : noData}</div>`;
      html += `<div>${chartLabel("Google Trends")}${trendVals.length >= 2 ? buildSvgSparkline(trendVals, 360, 80, "#7c3aed") : noData}${chartDates(trendLabels)}</div>`;
      if (repoVals.length >= 2) html += `<div>${chartLabel("GitHub Repos")}${buildSvgSparkline(repoVals, 360, 70, "#059669")}</div>`;
      if (claudeVals.length >= 2) html += `<div>${chartLabel("Claude Attribution")}${buildSvgSparkline(claudeVals, 360, 70, "#7c3aed")}</div>`;
      html += `</div>`;

      // KPI strip
      const jobs = v.signals?.job_postings;
      const trends = v.signals?.google_trends;
      const kpis = [];
      if (jobs?.time_series) kpis.push(kpiCell("Jobs Momentum", fmtPct(jobs.time_series.rolling_momentum_5pt_pct), (jobs.time_series.rolling_momentum_5pt_pct || 0) >= 0 ? "#059669" : "#dc2626"));
      if (trends?.momentum_pct != null) kpis.push(kpiCell("Trends Momentum", fmtPct(trends.momentum_pct), trends.momentum_pct >= 0 ? "#059669" : "#dc2626"));
      if (jobs?.time_series?.z_score_current != null) kpis.push(kpiCell("Z-Score", String(jobs.time_series.z_score_current), "#111827"));
      if (v.theirstack_historical?.current_vs_baseline_pct != null) kpis.push(kpiCell("vs Baseline", fmtPct(v.theirstack_historical.current_vs_baseline_pct), "#111827"));
      if (kpis.length) html += `<div style="display:flex;gap:10px;flex-wrap:wrap">${kpis.join("")}</div>`;

      if (v.divergence_signals?.length) {
        html += `<div style="margin-top:14px">`;
        v.divergence_signals.forEach((d) => {
          html += `<div style="padding:10px 14px;margin-bottom:6px;border-left:3px solid #f59e0b;background:#fffbeb;border-radius:0 6px 6px 0;font:400 12px/1.5 ${F};color:#111827"><strong style="font-weight:600">${esc(d.pair?.replace(/_/g, " ") || "divergence")}</strong> — ${esc(d.interpretation || "")}</div>`;
        });
        html += `</div>`;
      }
      parts.push(card(html, { accent: v.pipeline_stage?.index >= 3 ? "#059669" : v.pipeline_stage?.index <= 1 ? "#dc2626" : "#2563eb" }));
    });
  }

  // ── MACRO CONTEXT ──
  if (ctx.macro_labor_context && ctx.macro_labor_context.fred_headlines?.length) {
    let macroHtml = secLabel("Macro Context");
    if (ctx.macro_labor_context.chicago_recent_weeks?.length >= 2) {
      const cw = ctx.macro_labor_context.chicago_recent_weeks;
      const uVals = cw.map((r) => r.forecast_u).filter((v) => v != null);
      const u3Vals = cw.map((r) => r.u3).filter((v) => v != null);
      const cwLabels = cw.map((r) => r.date?.slice(5) || "");
      if (uVals.length >= 2) {
        macroHtml += `<div style="margin-bottom:14px"><div style="font:600 9px/1 ${F};color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Chicago Fed Nowcast vs U-3</div>`;
        macroHtml += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">`;
        macroHtml += `<div>${buildSvgSparkline(uVals, 380, 60, "#f59e0b")}<div style="font:400 8px ${F};color:#9ca3af;margin-top:2px">Nowcast</div></div>`;
        if (u3Vals.length >= 2) macroHtml += `<div>${buildSvgSparkline(u3Vals, 380, 60, "#2563eb")}<div style="font:400 8px ${F};color:#9ca3af;margin-top:2px">U-3</div></div>`;
        macroHtml += `</div></div>`;
      }
    }
    const headlines = ctx.macro_labor_context.fred_headlines.slice(0, 12);
    macroHtml += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">`;
    headlines.forEach((h) => {
      macroHtml += `<div style="padding:10px 12px;background:#f9fafb;border-radius:8px;border:1px solid #f3f4f6"><div style="font:500 8px/1 ${F};color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">${esc((h.name || h.id || "").slice(0, 28))}</div><div style="font:700 15px/1 ${F};color:#111827">${h.value != null ? h.value : "—"}</div><div style="font:400 8px/1 ${F};color:#d1d5db;margin-top:3px">${esc(h.date || "")}</div></div>`;
    });
    macroHtml += `</div>`;
    parts.push(card(macroHtml, { accent: "#f59e0b" }));
  }

  // ── HUGGINGFACE ──
  if (ctx.ai_supply_side?.hugging_face_leaderboard?.length) {
    let hfHtml = secLabel("AI Supply Side — HuggingFace");
    const hfOrgs = ctx.ai_supply_side.hugging_face_leaderboard;
    const maxDl = Math.max(...hfOrgs.map((o) => o.total_downloads || 0), 1);
    hfHtml += `<div style="display:grid;gap:8px">`;
    hfOrgs.forEach((o, i) => {
      const pct = ((o.total_downloads || 0) / maxDl * 100).toFixed(0);
      hfHtml += `<div style="display:flex;align-items:center;gap:10px"><span style="font:600 10px ${F};color:#9ca3af;min-width:18px;text-align:right">${i + 1}</span><span style="font:600 11px ${F};color:#111827;min-width:90px">${esc(o.org)}</span><div style="flex:1;height:16px;background:#f5f3ff;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#7c3aed;border-radius:4px;transition:width .3s"></div></div><span style="font:500 10px ${F};color:#6b7280;min-width:64px;text-align:right">${(o.total_downloads || 0).toLocaleString()}</span></div>`;
    });
    hfHtml += `</div>`;
    if (ctx.ai_supply_side.hf_download_trend?.recent_values?.length >= 2) {
      const dlVals = ctx.ai_supply_side.hf_download_trend.recent_values.map((p) => p.value || 0);
      hfHtml += `<div style="margin-top:14px"><div style="font:600 9px/1 ${F};color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Download Trend</div>${buildSvgSparkline(dlVals, 420, 60, "#7c3aed")}</div>`;
    }
    parts.push(card(hfHtml, { accent: "#7c3aed" }));
  }

  // ── ANALYSIS TEXT (from Claude) ──
  const analysisHtml = buildAnalysisSectionsHtml(text, { reader });
  if (analysisHtml) parts.push(analysisHtml);

  // ── DATA QUALITY ──
  if (ctx.data_quality_flags?.length) {
    let dqHtml = secLabel("Data Quality");
    ctx.data_quality_flags.forEach((f) => {
      dqHtml += `<div style="padding:4px 0;font:400 11px/1.5 ${F};color:#dc2626">⚠ ${esc(f)}</div>`;
    });
    parts.push(card(dqHtml, { accent: "#dc2626" }));
  }

  // ── FOOTER ──
  parts.push(`<div style="text-align:center;padding:16px 0 8px;font:400 10px ${F};color:#d1d5db">Generated by AI Demand Signal Tracker · ${esc(dateStr)}</div>`);

  parts.push(`</div>`);
  return parts.join("");
}

function buildAnalysisSectionsHtml(text, opts = {}) {
  if (!text) return "";
  const reader = !!opts.reader;
  const esc = escapeHtml;
  const F = "Inter,system-ui,-apple-system,sans-serif";
  const serif = "'Source Serif 4',Georgia,'Times New Roman',serif";
  const bodyFont = reader ? `400 16px/1.75 ${serif}` : `400 13.5px/1.7 ${F}`;
  const bodyPad = reader ? "22px 28px 28px" : "18px 24px";
  const pGap = reader ? "20px" : "14px";
  const lh = reader ? "1.75" : "1.7";
  const sectionMeta = {
    "WEEK IN 60": { color: "#2563eb", icon: "01" }, "60 SECONDS": { color: "#2563eb", icon: "01" }, "KEY TAKEAWAYS": { color: "#2563eb", icon: "01" },
    "MACRO LANDSCAPE": { color: "#f59e0b", icon: "02" }, "MACRO": { color: "#f59e0b", icon: "02" },
    "STOCK PULSE": { color: "#7c3aed", icon: "03" }, "AI STOCK": { color: "#7c3aed", icon: "03" },
    "STREET IS MISSING": { color: "#f59e0b", icon: "04" }, "WHAT THE STREET": { color: "#f59e0b", icon: "04" },
    "SIGNAL DEEP": { color: "#2563eb", icon: "05" }, "SIGNAL MOVEMENT": { color: "#2563eb", icon: "05" },
    "DIVERGENCE": { color: "#f59e0b", icon: "06" }, "CORRELATIONS": { color: "#7c3aed", icon: "06" },
    "HEARING": { color: "#059669", icon: "07" }, "WHAT I": { color: "#059669", icon: "07" },
    "CONVICTION": { color: "#059669", icon: "08" }, "INVESTMENT PREDICTIONS": { color: "#059669", icon: "08" }, "ACTIONABLE": { color: "#059669", icon: "08" },
    "RISK RADAR": { color: "#dc2626", icon: "09" }, "RISK FACTORS": { color: "#dc2626", icon: "09" }, "CONTRARIAN": { color: "#dc2626", icon: "09" },
    "DATA QUALITY": { color: "#6b7280", icon: "10" }, "DATA CONFIDENCE": { color: "#6b7280", icon: "10" }, "SOURCES": { color: "#6b7280", icon: "10" },
    "EXECUTIVE SUMMARY": { color: "#2563eb", icon: "00" }, "VERTICAL DEEP": { color: "#2563eb", icon: "05" },
    "INTERPRETATION": { color: "#2563eb", icon: "05" }, "REGIME": { color: "#2563eb", icon: "02" },
    "FLAGGED SIGNAL": { color: "#2563eb", icon: "04" }, "FLAGGED": { color: "#2563eb", icon: "04" },
    "WHAT WE GOT WRONG": { color: "#f59e0b", icon: "07" }, "GOT WRONG": { color: "#f59e0b", icon: "07" },
    "RISKS": { color: "#dc2626", icon: "09" },
  };
  const getMeta = (title) => {
    const upper = title.toUpperCase();
    for (const [k, m] of Object.entries(sectionMeta)) { if (upper.includes(k)) return m; }
    return { color: "#6b7280", icon: "—" };
  };
  let normalized = text.replace(/━{3,}|═{3,}/g, "\n§§SPLIT§§\n");
  normalized = normalized.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, title) => `§§SPLIT§§\n${title.trim()}`);
  const sections = normalized.split("§§SPLIT§§").map((s) => s.trim()).filter(Boolean);
  const parts = [];
  for (const section of sections) {
    const lines = section.split("\n");
    let title = "";
    let bodyLines = lines;
    if (lines[0] && /^[A-Z][A-Z &\-—()\/]{3,}/.test(lines[0].trim())) {
      title = lines[0].trim();
      bodyLines = lines.slice(1);
    }
    if (title.includes("VISUAL TREND") || title.includes("REGIME DASHBOARD")) continue;
    if (/^SOURCES?$|^REFERENCES?$/i.test(title.trim())) continue;
    const meta = getMeta(title);
    let body = bodyLines.join("\n").trim();
    if (!body) continue;
    body = body.replace(/\[([^\]]*)\]\(https?:\/\/[^)]+\)/g, "$1");
    body = body.replace(/https?:\/\/\S+/g, "");
    body = body.replace(/%%LINK%%(.+?)%%HREF%%[^%]*%%ENDLINK%%/g, "$1");
    body = body.replace(/%%(?:LINK|HREF|ENDLINK)%%/g, "");
    body = esc(body);
    body = body.replace(/\*\*(.+?)\*\*/g, "<strong style=\"font-weight:600\">$1</strong>");
    body = body.replace(/\n\n/g, `</p><p style="margin:0 0 ${pGap};line-height:${lh}">`);
    body = body.replace(/\n/g, "<br/>");
    body = body.replace(/• /g, `<span style="color:${meta.color};font-size:7px;vertical-align:middle;margin-right:6px">●</span>`);
    body = `<p style="margin:0 0 ${pGap};line-height:${lh}">${body}</p>`;
    const secHeadPad = reader ? "16px 26px 14px" : "14px 24px 12px";
    const secRadius = reader ? "12px" : "10px";
    const titleRow = title
      ? `<div style="display:flex;align-items:center;gap:10px;padding:${secHeadPad};border-bottom:1px solid #f3f4f6;background:${reader ? "#fafaf9" : "#f9fafb"}"><span style="font:700 11px/1 ${F};color:${meta.color};min-width:18px">${meta.icon}</span><div style="font:600 ${reader ? "12px" : "11px"}/1 ${F};text-transform:uppercase;letter-spacing:0.08em;color:#4b5163">${esc(title)}</div></div>`
      : "";
    const html = `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:${secRadius};padding:0;margin-bottom:${reader ? "18px" : "14px"};overflow:hidden">` +
      titleRow +
      `<div style="padding:${bodyPad};font:${bodyFont};color:#1f2937">${body}</div></div>`;
    parts.push(html);
  }
  return parts.join("");
}
function BriefSnapshotCharts({ ctx }) {
  if (!ctx?.verticals?.length) return null;
  const fmtJobY = (v) => {
    if (v == null || !Number.isFinite(v)) return "";
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(0)}k`;
    return String(Math.round(v));
  };
  return (
    <div style={{ marginTop: 22, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
      <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        Signal trend charts
      </div>
      <div style={{ ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.45, marginBottom: 14 }}>
        Snapshots from when this brief was generated. Each group uses its own vertical scale (jobs can be monthly totals or recent points) — compare <strong style={{ color: C.text }}>shape and direction</strong>, not the absolute level across groups.
      </div>
      {ctx.verticals.map((v) => {
        const mon = v.theirstack_historical?.recent_monthly || [];
        const jobMonthly = mon.length >= 2;
        const jobData = jobMonthly
          ? mon.map((m) => ({ x: m.month?.slice(2) || m.month, y: m.count || 0 }))
          : (v.signals?.job_postings?.time_series?.recent_values || []).map((p, i) => ({ x: String(i), y: p.value || 0 }));
        const trendData = (v.signals?.google_trends?.time_series?.recent_values || []).map((p, i) => ({ x: (p.date || "").slice(5, 10) || String(i), y: p.value || 0 }));
        return (
          <div key={v.name} style={{ marginBottom: 14, padding: 14, background: C.nested, borderRadius: 10, border: `1px solid ${C.border}` }}>
            <div style={{ ...font.sans, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>{v.name}</div>
            <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginBottom: 10 }}>Jobs: {jobMonthly ? "monthly counts" : "recent snapshots"} · Trends: index 0–100</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, minHeight: 100 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.textSec, marginBottom: 6 }}>Job postings</div>
                {jobData.length >= 2 ? (
                  <div style={{ width: "100%", height: 96 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={jobData} margin={{ top: 6, right: 6, bottom: 6, left: 2 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.borderLight} vertical={false} />
                        <XAxis dataKey="x" tick={{ fontSize: 10, fill: C.textMuted }} stroke={C.border} />
                        <YAxis width={40} tick={{ fontSize: 10, fill: C.textMuted }} stroke={C.border} tickFormatter={fmtJobY} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="y" stroke={C.cyan} strokeWidth={2} dot={false} name="Jobs" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: C.textMuted }}>Need more history</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.textSec, marginBottom: 6 }}>Google Trends</div>
                {trendData.length >= 2 ? (
                  <div style={{ width: "100%", height: 96 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 6, right: 6, bottom: 6, left: 2 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.borderLight} vertical={false} />
                        <XAxis dataKey="x" tick={{ fontSize: 10, fill: C.textMuted }} stroke={C.border} />
                        <YAxis width={36} tick={{ fontSize: 10, fill: C.textMuted }} stroke={C.border} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="y" stroke={C.blue} strokeWidth={2} dot={false} name="Trends" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: C.textMuted }}>Need more history</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Join single newlines inside prose so diff blocks are not one broken clause per line. */
function mergeSoftBreaksForBrief(text) {
  if (!text) return "";
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isHdr = /^#{1,3}\s/.test(trimmed);
    const isBullet = /^[-•*]\s/.test(trimmed);
    const isRule = /^━+$|^---+/.test(trimmed);
    if (isHdr || isBullet || isRule) {
      out.push(trimmed);
      continue;
    }
    const last = out[out.length - 1];
    if (
      last != null &&
      !/^#{1,3}\s/.test(last) &&
      !/^[-•*]\s/.test(last) &&
      !/^━+$|^---+$/.test(last)
    ) {
      const joinable =
        !/[.!?:…]\s*$/.test(last) &&
        /^[a-z(`"'“‘—–-]/.test(trimmed) &&
        !/^[A-Z][a-z]+\s+[A-Z]/.test(trimmed);
      if (joinable) {
        out[out.length - 1] = `${last} ${trimmed}`;
        continue;
      }
    }
    out.push(trimmed);
  }
  return out.join("\n");
}

function splitBriefParagraphs(md) {
  return mergeSoftBreaksForBrief(sanitizeBriefOutput(md || ""))
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Word overlap score in [0, 1] — cheap stand-in for “same paragraph”. */
function briefParagraphSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const wa = new Set(
    a
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
  const wb = new Set(
    b
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
  if (!wa.size && !wb.size) return a.trim() === b.trim() ? 1 : 0;
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return (2 * inter) / (wa.size + wb.size);
}

/**
 * Map each new paragraph to the best unused old paragraph (not index-aligned).
 * Avoids false “everything changed” when a paragraph is inserted or removed.
 */
function alignBriefParagraphsForDiff(oldParas, newParas) {
  const usedOld = new Set();
  const rows = [];
  for (const pNew of newParas) {
    let bestJ = -1;
    let bestScore = 0;
    for (let j = 0; j < oldParas.length; j++) {
      if (usedOld.has(j)) continue;
      const s = briefParagraphSimilarity(pNew, oldParas[j]);
      if (s > bestScore) {
        bestScore = s;
        bestJ = j;
      }
    }
    const matched = bestJ >= 0 && bestScore >= 0.62;
    if (matched) usedOld.add(bestJ);
    const oldText = matched ? oldParas[bestJ] : "";
    const changed = !matched || pNew !== oldText;
    rows.push({ text: pNew, changed, status: !matched ? "new" : changed ? "revised" : "same" });
  }
  const removed = [];
  for (let j = 0; j < oldParas.length; j++) {
    if (!usedOld.has(j)) removed.push(oldParas[j]);
  }
  return { rows, removed };
}

function paragraphDiffHtml(oldText, newText) {
  const F = "Inter,system-ui,-apple-system,sans-serif";
  const oldP = splitBriefParagraphs(oldText);
  const newP = splitBriefParagraphs(newText);
  const { rows, removed } = alignBriefParagraphsForDiff(oldP, newP);
  const legend =
    `<div style="font:500 12px/1.5 ${F};color:#4b5563;margin:0 0 20px;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">` +
    `<strong style="color:#111827">How to read this diff</strong> — Blocks are matched by <em>content</em>, not position, so edits do not falsely highlight everything below an insertion. ` +
    `<span style="border-left:3px solid #f59e0b;padding-left:8px;margin-left:4px">Amber bar</span> = new or revised section; plain = unchanged since the first saved version of this week.</div>`;
  const blocks = rows
    .map(({ text, changed, status }) => {
      const inner = simpleMarkdownToHtml(text);
      if (!changed) {
        return `<div style="margin:0 0 12px;padding:2px 0">${inner}</div>`;
      }
      const label =
        status === "new"
          ? `<div style="font:600 9px/1 ${F};text-transform:uppercase;letter-spacing:0.06em;color:#b45309;margin:0 0 8px">New in this version</div>`
          : `<div style="font:600 9px/1 ${F};text-transform:uppercase;letter-spacing:0.06em;color:#b45309;margin:0 0 8px">Revised</div>`;
      return (
        `<div style="margin:0 0 16px;padding:14px 16px 14px 18px;background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0">` +
        label +
        `<div style="font:400 14px/1.7 ${F};color:#1f2937">${inner}</div></div>`
      );
    })
    .join("");
  let tail = "";
  if (removed.length) {
    const rInner = removed.map((t) => simpleMarkdownToHtml(t)).join("");
    tail =
      `<details style="margin-top:8px;font:${F}"><summary style="font:600 11px/1.4 ${F};color:#6b7280;cursor:pointer;user-select:none">` +
      `${removed.length} section${removed.length > 1 ? "s" : ""} removed since first save</summary>` +
      `<div style="margin-top:10px;padding:12px 14px;background:#f3f4f6;border-radius:8px;border:1px solid #e5e7eb;font:400 13px/1.65 ${F};color:#6b7280">${rInner}</div></details>`;
  }
  return `<div style="max-width:720px;margin:0 auto">${legend}${blocks}${tail}</div>`;
}
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── ENV KEYS ─────────────────────────────────────────────────────────────────

const ENV_KEYS = {
  theirstack: import.meta.env.VITE_THEIRSTACK_KEY || "",
  google_trends: import.meta.env.VITE_SERPAPI_KEY || "",
  github: import.meta.env.VITE_GITHUB_PAT || "",
  anthropic: import.meta.env.VITE_ANTHROPIC_API_KEY || "",
};
function resolveKey(source, configKeys) {
  const gh = source.apiConfig.authType === "bearer" && source.apiConfig.endpoint.includes("github");
  const kid = gh ? "github" : source.id;
  // Always prefer .env keys for internal use; config keys are fallback only.
  return ENV_KEYS[kid] || ENV_KEYS[source.id] || configKeys[kid] || "";
}
function resolveTheirStackMocking(source, configKeys) {
  if (source?.id !== "theirstack") return false;
  if (theirStackMockForced()) return true;
  return !resolveKey(source, configKeys);
}

// ── DEFAULT CONFIG ───────────────────────────────────────────────────────────

const DEFAULT_SOURCES = [
  { id: "theirstack", name: "TheirStack Jobs", type: "classified_text", weight: 0.4, cadence: "daily", enabled: true,
    apiConfig: { endpoint: "https://api.theirstack.com/v1/jobs/search", method: "POST", authType: "bearer", authHeader: "", proxyPrefix: "",
      bodyTemplate: JSON.stringify({ page:0,limit:25,posted_at_max_age_days:30,job_title_or:"{{titleKeywords}}",job_description_pattern_or:"{{descriptionKeywords}}",job_country_code_or:["US"],order_by:[{desc:true,field:"date_posted"}],include_total_results:true },null,2) },
    responsePaths: { countPath: "metadata.total_results", itemsPath: "data", titleField: "job_title", bodyField: "short_description" } },
  { id: "google_trends", name: "Google Trends", type: "index", weight: 0.25, cadence: "weekly", enabled: true,
    apiConfig: { endpoint: "/api/google-trends", method: "GET", authType: "query_param", authHeader: "api_key", proxyPrefix: "", bodyTemplate: "engine=google_trends&data_type=TIMESERIES&q={{keywords}}" },
    responsePaths: { countPath: "", itemsPath: "interest_over_time.timeline_data", titleField: "", bodyField: "" } },
  { id: "github_repos", name: "GitHub Repos", type: "count", weight: 0.15, cadence: "weekly", enabled: true,
    apiConfig: { endpoint: "https://api.github.com/search/repositories", method: "GET", authType: "bearer", authHeader: "", proxyPrefix: "", bodyTemplate: "q={{keywords}}+pushed:{{since7d}}..{{today}}&sort=updated&per_page=1" },
    responsePaths: { countPath: "total_count", itemsPath: "items", titleField: "full_name", bodyField: "description" } },
  { id: "claude_attrib", name: "Claude Code Attribution", type: "count", weight: 0.2, cadence: "weekly", enabled: true,
    apiConfig: { endpoint: "https://api.github.com/search/commits", method: "GET", authType: "bearer", authHeader: "", proxyPrefix: "", bodyTemplate: 'q="Co-Authored-By: Claude"+committer-date:{{since7d}}..{{today}}&sort=committer-date&order=desc&per_page=1' },
    responsePaths: { countPath: "total_count", itemsPath: "items", titleField: "commit.message", bodyField: "" } },
];

const DEFAULT_VERTICALS = [];

const DEFAULT_STAGES = [
  { id:"s1",name:"Early Research",color:C.blue,weight:1,titlePatterns:["strategy","innovation","ai lead","evaluating","exploring","research"],descriptionPatterns:["assess","evaluate","pilot program","proof of concept planning"] },
  { id:"s2",name:"Pilot Testing",color:C.amber,weight:2,titlePatterns:["implement","poc","project manager ai","ai analyst","pilot","prototype"],descriptionPatterns:["proof of concept","testing","trial","initial deployment"] },
  { id:"s3",name:"Implementation",color:C.orange,weight:3,titlePatterns:["platform engineer","ai engineer","production","model validation","ml engineer","mlops","delivery"],descriptionPatterns:["production","scale","deploy","infrastructure","pipeline"] },
  { id:"s4",name:"Budget Committed",color:C.red,weight:4,titlePatterns:["product owner","controls automation","gxp","soc automation","ai operations","specialist"],descriptionPatterns:["vendor","contract","procurement","budget","implementation partner"] },
];

const DEFAULT_STAGE_TAXONOMY = [
  { min:0,max:30,name:"Watchlist",color:C.textMuted,description:"Very early — interest exists, spend likely distant" },
  { min:30,max:55,name:"Validating",color:C.blue,description:"Teams are testing tools and building internal conviction" },
  { min:55,max:75,name:"Rolling Out",color:C.amber,description:"Deployment is starting and budgets are moving" },
  { min:75,max:100,name:"Committed",color:C.green,description:"Active budget cycle and near-term vendor spend" },
];

const DEFAULT_ALERT_RULES = [
  { id:"r1",condition:"jobVolWoW > 30 && jobStageWeight <= 1",message:"Volume spike without language shift — CIO mandate signal, not real usage",severity:"amber",enabled:true },
  { id:"r2",condition:"jobVolWoW < -10 && prevJobVolWoW < -10",message:"Sustained volume decline — monitor for budget freeze",severity:"red",enabled:true },
  { id:"r3",condition:"jobStageJump >= 2",message:"Rapid language shift detected — budget acceleration signal",severity:"green",enabled:true },
  { id:"r4",condition:"jobVolIndex > 130 && jobStageWeight >= 4",message:"Strong convergence — job signal at maximum pressure",severity:"green",enabled:true },
];

function buildDefaultConfig() {
  return {
    sources: JSON.parse(JSON.stringify(DEFAULT_SOURCES)),
    verticals: JSON.parse(JSON.stringify(DEFAULT_VERTICALS)),
    stages: JSON.parse(JSON.stringify(DEFAULT_STAGES)),
    stageTaxonomy: JSON.parse(JSON.stringify(DEFAULT_STAGE_TAXONOMY)),
    alertRules: JSON.parse(JSON.stringify(DEFAULT_ALERT_RULES)),
    alertThreshold: 10,
    briefThresholds: {
      theirstack: 8,
      google_trends: 10,
      github_repos: 5,
      claude_attrib: 5,
      hf_downloads: 10,
    },
    apiKeys: {}, scoreWeights: {},
    stageMultipliers: { s1:0.7, s2:1.0, s3:1.2, s4:1.5 },
  };
}

// ── GENERIC API CALLER ───────────────────────────────────────────────────────

function resolvePath(obj, path) {
  if (!path) return obj;
  return path.split(".").reduce((o, k) => { if (!o) return undefined; const m = k.match(/^(.+)\[\*\]$/); return m ? o[m[1]] : o[k]; }, obj);
}
function fillTemplate(tpl, vars) {
  let out = tpl;
  Object.entries(vars).forEach(([k, v]) => { out = out.replace(new RegExp(`"?{{${k}}}"?`, "g"), Array.isArray(v) ? JSON.stringify(v) : String(v)); });
  return out;
}

async function githubApiErrorMessage(res) {
  const retryAfter = res.headers?.get?.("retry-after");
  const reset = res.headers?.get?.("x-ratelimit-reset");
  const remaining = res.headers?.get?.("x-ratelimit-remaining");
  let resetHint = "";
  if (retryAfter) resetHint = ` Retry after ${retryAfter}s.`;
  else if (reset) {
    const t = parseInt(reset, 10);
    if (!Number.isNaN(t)) resetHint = ` Resets ~${new Date(t * 1000).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.`;
  }
  if (remaining !== null && remaining !== "") resetHint += ` Requests left (this window): ${remaining}.`;
  const patHint = "";

  let msg = "";
  try {
    const j = await res.clone().json();
    msg = String(j.message || "").toLowerCase();
  } catch {}
  if (res.status === 401) return "Invalid or expired GitHub token." + resetHint;
  if (res.status === 429) return "GitHub API rate limited (429)." + resetHint + patHint;
  if (res.status === 403) {
    if (msg.includes("rate limit") || msg.includes("abuse") || msg.includes("too many") || msg.includes("quota") || msg.includes("throttl"))
      return "GitHub API rate limited (403)." + resetHint + patHint;
    if (msg.includes("sso")) return "GitHub SSO required — authorize your PAT for the org";
    return "GitHub denied the request (403) — check PAT scopes and org access." + resetHint;
  }
  return (msg ? `GitHub: ${msg.slice(0, 120)}` : `GitHub HTTP ${res.status}`) + resetHint;
}

async function callSource(source, vertical, configKeys) {
  const cfg = source.apiConfig, vkw = vertical.keywords?.[source.id] || {};
  const today = new Date().toISOString().slice(0, 10);
  const since30d = new Date(Date.now()-30*86400000).toISOString().slice(0,10), since7d = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const tv = { ...vkw, since30d, since7d, today };
  if (vkw.keywords) {
    const kwArr = Array.isArray(vkw.keywords) ? vkw.keywords.filter(Boolean) : [vkw.keywords];
    const isGitHub = source.id === "github_repos" || source.id === "claude_attrib";
    tv.keywords = isGitHub ? kwArr.map(k => k.includes(" ") ? `"${k}"` : k).join("+") : kwArr.join(",");
  }
  if (vkw.titleKeywords) tv.titleKeywords = vkw.titleKeywords;
  if (vkw.descriptionKeywords) tv.descriptionKeywords = vkw.descriptionKeywords;
  const hasKw = (tv.keywords && tv.keywords.length > 0) || (Array.isArray(tv.titleKeywords) ? tv.titleKeywords.filter(Boolean).length > 0 : !!tv.titleKeywords) || (Array.isArray(tv.descriptionKeywords) ? tv.descriptionKeywords.filter(Boolean).length > 0 : !!tv.descriptionKeywords);
  if (!hasKw && source.id !== "claude_attrib") throw new Error(`No keywords configured for ${source.name}. Add keywords in the signal group settings for this source.`);
  let templateStr = cfg.bodyTemplate;
  if (source.id === "claude_attrib") {
    const extraKw = Array.isArray(vkw.keywords) ? vkw.keywords.filter(Boolean) : [];
    if (extraKw.length > 0) {
      const kwQ = extraKw.map(k => `"${k}"`).join("+");
      templateStr = templateStr.replace('"Co-Authored-By: Claude"', `"Co-Authored-By: Claude"+${kwQ}`);
    }
  }
  if (resolveTheirStackMocking(source, configKeys)) {
    const lte = new Date().toISOString().slice(0, 10);
    const gte = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const count = mockTheirStackCountForRange(vertical, gte, lte);
    const sample = Math.min(25, Math.max(5, Math.ceil(count / 50)));
    return {
      metadata: { total_results: count },
      data: buildMockTheirStackJobItems(sample, vertical),
    };
  }
  const filled = fillTemplate(templateStr, tv);
  const ep = cfg.proxyPrefix ? cfg.proxyPrefix + cfg.endpoint : cfg.endpoint;
  const headers = { Accept: source.id === "claude_attrib" ? "application/vnd.github.cloak-preview+json" : source.id === "github_repos" ? "application/vnd.github+json" : "application/json" };
  const key = resolveKey(source, configKeys);
  if (cfg.authType === "bearer" && key) headers.Authorization = `Bearer ${key}`;
  if (cfg.authType === "header" && cfg.authHeader && key) headers[cfg.authHeader] = key;
  let url = ep, body;
  if (cfg.method === "GET") {
    let qs = filled;
    if (source.id === "google_trends") {
      qs = qs.replace(/q=([^&]*)/, (_, v) => "q=" + encodeURIComponent(v));
    }
    url = ep + (ep.includes("?")?"&":"?") + qs + (cfg.authType==="query_param" && key ? `&${cfg.authHeader||"api_key"}=${key}` : "");
  }
  else { headers["Content-Type"] = "application/json"; body = filled; }
  let res;
  if (source.id === "google_trends") {
    const qs = url.split("?").slice(1).join("?");
    const tryFetch = async (u) => { const r = await fetch(u, { method: "GET", headers }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; };
    try { res = await tryFetch(url); } catch {
      try { res = await tryFetch("/serpapi/search.json?" + qs); } catch {
        try {
          const serpKey = key || "";
          const directQs = qs.includes("api_key=") ? qs : qs + (serpKey ? `&api_key=${serpKey}` : "");
          res = await tryFetch("https://serpapi.com/search.json?" + directQs);
        } catch {
          throw new Error("Cannot reach Google Trends — verify SERPAPI_KEY in Vercel env vars and that your API credits are active");
        }
      }
    }
  } else {
    try {
      res = await fetch(url, { method: cfg.method, headers, body });
    } catch (networkErr) {
      throw new Error("Network error — check connection");
    }
  }
  const isGitHubSource = source.id === "github_repos" || source.id === "claude_attrib";
  if (isGitHubSource && (res.status === 401 || res.status === 403 || res.status === 429)) {
    throw new Error(await githubApiErrorMessage(res));
  }
  if (source.id === "theirstack" && !resolveTheirStackMocking(source, configKeys) && (res.status === 402 || res.status === 429)) {
    const lte = new Date().toISOString().slice(0, 10);
    const gte = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const count = mockTheirStackCountForRange(vertical, gte, lte);
    const sample = Math.min(25, Math.max(5, Math.ceil(count / 50)));
    return {
      metadata: { total_results: count },
      data: buildMockTheirStackJobItems(sample, vertical),
      _mockFallback: true,
    };
  }
  if (!isGitHubSource && (res.status===401||res.status===403)) throw new Error("Invalid API key");
  if (res.status===402) throw new Error("API credits exhausted");
  if (res.status===429) throw new Error("Rate limited");
  if (res.status===400) { let detail=""; try{const j=await res.clone().json();detail=j.error||"";}catch{} throw new Error(detail ? `Bad request: ${detail.slice(0,60)}` : "Bad request — check keywords"); }
  if (!res.ok) { let detail=""; try{const j=await res.clone().json();detail=j.error||"";}catch{} throw new Error(detail ? detail.slice(0,80) : `HTTP ${res.status}`); }
  return res.json();
}

// ── RESPONSE PARSERS ─────────────────────────────────────────────────────────

function parseSourceResponse(source, json) {
  if (source.id === "google_trends") { const tl=json.interest_over_time?.timeline_data||[]; const vals=tl.map(d=>d.values?.[0]?parseInt(d.values[0].extracted_value??d.values[0].value,10):0); const cur=vals.length>0?vals[vals.length-1]:0; const l4=vals.slice(-4); const avg=l4.length>0?Math.round(l4.reduce((a,b)=>a+b,0)/l4.length):0; const mom=avg>0?Math.round(((cur-avg)/avg)*100):0; return { count:cur, items:[{title:`Relative interest: ${cur} (0–100 scale)`,body:`4wk avg: ${avg}, momentum: ${mom>0?"+":""}${mom}%`}], values:vals, momentum:mom }; }
  if (source.id === "claude_attrib") { const c=json.total_count||0; return { count:c, items:[{title:`${c.toLocaleString()} Claude-attributed commits (7d)`,body:"Signature: Co-Authored-By: Claude"}] }; }
  const p = source.responsePaths;
  const count = p.countPath ? resolvePath(json,p.countPath)||0 : 0;
  const items = (p.itemsPath ? resolvePath(json,p.itemsPath)||[] : []).slice(0,25).map(item => ({ title: p.titleField?resolvePath(item,p.titleField)||"":"", body: p.bodyField?resolvePath(item,p.bodyField)||"":"", raw:item }));
  return { count: typeof count==="number"?count:parseInt(count,10)||0, items };
}

// ── CLASSIFIER ───────────────────────────────────────────────────────────────

function classifyItems(items, stages) {
  if (!items?.length || !stages?.length) return { dominantStage:stages?.[0]||null, confidence:0, breakdown:{}, stagedItems:[] };
  const bk = {}; stages.forEach(s => { bk[s.id]={stage:s,count:0}; });
  const staged = items.map(item => {
    let best=stages[0], bs=0; const tl=(item.title||"").toLowerCase(), bl=(item.body||"").toLowerCase();
    for (const s of stages) { let sc=0; (s.titlePatterns||[]).forEach(p=>{if(tl.includes(p.toLowerCase()))sc+=2;}); (s.descriptionPatterns||[]).forEach(p=>{if(bl.includes(p.toLowerCase()))sc+=1;}); if(sc>bs){bs=sc;best=s;} }
    if(bk[best.id])bk[best.id].count++;
    return { ...item, classification:{stageId:best.id,stageName:best.name,stageColor:best.color,score:bs,matched:bs>0} };
  });
  let dom=stages[0],mx=0; Object.values(bk).forEach(b=>{if(b.count>mx){mx=b.count;dom=b.stage;}});
  const matched=staged.filter(i=>i.classification.matched).length;
  return { dominantStage:dom, confidence:Math.round((matched/items.length)*100), breakdown:bk, stagedItems:staged };
}

// ── COMPOSITE SCORING ────────────────────────────────────────────────────────

function computeComposite(vertId, sr, sources, stageMultipliers, histPack, ghPack) {
  let tw=0,ws=0; const bk={};
  sources.filter(s=>s.enabled).forEach(src => {
    const res=sr[`${vertId}_${src.id}`]; if(!res) return;
    let n=0;
    if(src.type==="index") n=Math.min(res.count||0,100);
    else if(src.type==="count") n=Math.min(((res.count||0)/100)*100,100);
    else if(src.type==="classified_text"){const vn=Math.min(((res.count||0)/200)*100,100);const sm=stageMultipliers[res.classification?.dominantStage?.id]||1;n=Math.min(vn*sm,100);}
    bk[src.id]={source:src,score:Math.round(n),raw:res}; ws+=n*src.weight; tw+=src.weight;
  });
  let baseScore = Math.min(tw>0?Math.round(ws/tw):0,100);
  const hist = histPack?.[vertId];
  if (hist?.derived) {
    const velNorm = Math.max(0, Math.min(100, 50 + hist.derived.velocitySlope));
    const anomalyScore = Math.max(0, Math.min(100, (Math.abs(hist.derived.anomalyZ || 0) / 3) * 100));
    const accelBonus = hist.derived.accelerationScore > 0 ? 10 : hist.derived.accelerationScore < 0 ? -10 : 0;
    const blended = (baseScore * 0.7) + (velNorm * 0.15) + (anomalyScore * 0.15) + accelBonus;
    baseScore = Math.max(0, Math.min(100, Math.round(blended)));
    bk.historical = { source: { name: "Historical Momentum" }, score: Math.round((velNorm + anomalyScore) / 2), raw: hist.derived };
  }
  const gh = ghPack?.[vertId];
  if (gh?.derived) {
    const ghIdx = Math.max(0, Math.min(100, (gh.derived.currentIndex || 0) / 3));
    const ent = Math.max(0, Math.min(100, gh.derived.enterpriseRepoRatio || 0));
    baseScore = Math.max(0, Math.min(100, Math.round((baseScore * 0.85) + (ghIdx * 0.1) + (ent * 0.05))));
    bk.githubHistorical = { source: { name: "GitHub Historical" }, score: Math.round((ghIdx + ent)/2), raw: gh.derived };
  }
  return { score:baseScore, breakdown:bk };
}
function resolveStage(score, tax) { for(let i=tax.length-1;i>=0;i--){if(score>=tax[i].min)return{...tax[i],index:i};} return{...tax[0],index:0}; }

// ── ALERT ENGINE ─────────────────────────────────────────────────────────────

function evalAlerts(verticals, sr, rules, threshold = 10) {
  const alerts = [];
  verticals.forEach(v => {
    const jr = sr[`${v.id}_theirstack`];
    const tr = sr[`${v.id}_google_trends`];
    const gr = sr[`${v.id}_github_repos`];
    const cl = sr[`${v.id}_claude_attrib`];
    const jvi = jr ? Math.min(((jr.count || 0) / 100) * 100, 200) : 0;
    const jsw = jr?.classification?.dominantStage?.weight || 0;

    const jobHist = getSignalHistory(`${v.id}_theirstack`);
    const trendHist = getSignalHistory(`${v.id}_google_trends`);
    const repoHist = getSignalHistory(`${v.id}_github_repos`);
    const claudeHist = getSignalHistory(`${v.id}_claude_attrib`);

    const pctChange = (hist) => {
      if (hist.length < 2) return 0;
      const prev = hist[hist.length - 2]?.value || 0;
      const cur = hist[hist.length - 1]?.value || 0;
      return prev > 0 ? ((cur - prev) / prev) * 100 : 0;
    };
    const jobPct = pctChange(jobHist);
    const trendPct = pctChange(trendHist);
    const repoPct = pctChange(repoHist);
    const claudePct = pctChange(claudeHist);

    if (Math.abs(jobPct) >= threshold) {
      alerts.push({ id: `${v.id}_job_chg_${Date.now()}`, ts: Date.now(), vertical: v.name, text: `Job postings ${jobPct > 0 ? "up" : "down"} ${Math.abs(jobPct).toFixed(0)}% (${jr?.count || 0} count) — crosses ${threshold}% threshold`, severity: jobPct > 0 ? "green" : "red" });
    }
    if (Math.abs(trendPct) >= threshold) {
      alerts.push({ id: `${v.id}_trend_chg_${Date.now()}`, ts: Date.now(), vertical: v.name, text: `Google Trends ${trendPct > 0 ? "up" : "down"} ${Math.abs(trendPct).toFixed(0)}% (index ${tr?.count || 0}) — crosses ${threshold}% threshold`, severity: trendPct > 0 ? "green" : "amber" });
    }
    if (Math.abs(repoPct) >= threshold) {
      alerts.push({ id: `${v.id}_repo_chg_${Date.now()}`, ts: Date.now(), vertical: v.name, text: `GitHub repos ${repoPct > 0 ? "up" : "down"} ${Math.abs(repoPct).toFixed(0)}% (${gr?.count || 0} active) — crosses ${threshold}% threshold`, severity: repoPct > 0 ? "green" : "amber" });
    }
    if (Math.abs(claudePct) >= threshold) {
      alerts.push({ id: `${v.id}_claude_chg_${Date.now()}`, ts: Date.now(), vertical: v.name, text: `Claude attribution ${claudePct > 0 ? "up" : "down"} ${Math.abs(claudePct).toFixed(0)}% (${cl?.count || 0} commits) — crosses ${threshold}% threshold`, severity: claudePct > 0 ? "green" : "amber" });
    }

    const ctx = { jobVolWoW: jobPct, jobVolIndex: jvi, jobStageWeight: jsw, prevJobVolWoW: 0, jobStageJump: 0 };
    rules.filter(r => r.enabled).forEach(rule => { try { if (new Function(...Object.keys(ctx), `return(${rule.condition})`)(...Object.values(ctx))) alerts.push({ id: `${v.id}_${rule.id}_${Date.now()}`, ts: Date.now(), vertical: v.name, text: rule.message, severity: rule.severity }); } catch {} });
  });
  return alerts;
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}body{background:#ecedf0;color:${C.text}}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeInSlow{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(26,107,138,0)}50%{box-shadow:0 0 0 4px rgba(26,107,138,.06)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
.fade-in{animation:fadeIn .25s ease}.fade-in-slow{animation:fadeInSlow .4s ease}
.glow{animation:glow 2.5s ease-in-out infinite}
.shimmer{background:linear-gradient(90deg,${C.nested} 25%,${C.white} 50%,${C.nested} 75%);background-size:200% 100%;animation:shimmer 1.5s infinite}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-thumb{background:#c4c9d4;border-radius:3px}::-webkit-scrollbar-thumb:hover{background:#a0a8b8}
input,textarea,select{background:${C.white};border:1.5px solid ${C.border};color:${C.text};font-family:'Inter',sans-serif;font-size:13px;padding:8px 12px;border-radius:8px;outline:none;transition:all .2s}
input:focus,textarea:focus,select:focus{border-color:${C.cyan};box-shadow:0 0 0 2px ${C.cyanBg}}
textarea{font-family:'JetBrains Mono',monospace;font-size:12px;resize:vertical}
table{border-collapse:separate;border-spacing:0;width:100%}
.recharts-cartesian-grid-horizontal line,.recharts-cartesian-grid-vertical line{stroke:${C.borderLight}}
.metric-card{transition:transform .12s,box-shadow .12s}.metric-card:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.06)}
.signal-section{transition:all .2s}
.nav-btn{transition:all .15s;border:1.5px solid transparent}.nav-btn:hover{border-color:${C.border};background:${C.nested}}
`;

// ── UI PRIMITIVES ────────────────────────────────────────────────────────────

function Ico({d,size=16,color="currentColor",style:sx}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,...sx}}><path d={d}/></svg>;}
const IC = {
  briefcase:"M20 7H4a1 1 0 0 0-1 1v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a1 1 0 0 0-1-1ZM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2",
  trendUp:"M23 6l-9.5 9.5-5-5L1 18M17 6h6v6",
  code:"M16 18l6-6-6-6M8 6l-6 6 6 6",
  bot:"M12 8V4M18 12a6 6 0 0 1-12 0V10a6 6 0 0 1 12 0v2ZM9 16h0M15 16h0",
  refresh:"M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  barChart:"M18 20V10M12 20V4M6 20v-6",
  settings:"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  zap:"M13 2L3 14h9l-1 8 10-12h-9l1-8Z",
  activity:"M22 12h-4l-3 9L9 3l-3 9H2",
  cloudUp:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v9M16 16l-4-4-4 4",
  cloudDown:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 21v-9M8 17l4 4 4-4",
  mail:"M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2Zm16 2-8 5-8-5",
  userPlus:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6M23 11h-6",
  trash:"M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
  layers:"M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  pin:"M12 17v5M9 11l-6-2 9-6 9 6-6 2M9 11v4a3 3 0 0 0 6 0v-4",
  crosshair:"M22 12h-4M6 12H2M12 6V2M12 22v-4M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z",
  gitBranch:"M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9",
  database:"M12 2C6.48 2 2 4.02 2 6.5V17.5C2 19.98 6.48 22 12 22S22 19.98 22 17.5V6.5C22 4.02 17.52 2 12 2ZM2 6.5C2 8.98 6.48 11 12 11S22 8.98 22 6.5M2 12c0 2.48 4.48 4.5 10 4.5S22 14.48 22 12",
  pause:"M10 4H6v16h4V4ZM18 4h-4v16h4V4Z",
  play:"M5 3l14 9-14 9V3Z",
  shield:"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
};
function IcoC({name,size=16,color="currentColor",style:sx}){return IC[name]?<Ico d={IC[name]} size={size} color={color} style={sx}/>:null;}

function Btn({children,onClick,disabled,variant="default",size="md",style:sx,...r}){
  const sizes={sm:{fontSize:11,padding:"5px 10px",borderRadius:6},md:{fontSize:13,padding:"8px 16px",borderRadius:8},lg:{fontSize:14,padding:"10px 20px",borderRadius:10}};
  const base={...font.sans,fontWeight:600,cursor:disabled?"not-allowed":"pointer",border:"1.5px solid",transition:"all .15s",display:"inline-flex",alignItems:"center",gap:6,opacity:disabled?.4:1,letterSpacing:"-0.01em",...sizes[size]};
  const vs={
    default:{background:C.white,borderColor:C.border,color:C.text},
    primary:{background:C.cyan,borderColor:C.cyan,color:"#fff"},
    ghost:{background:"transparent",borderColor:"transparent",color:C.textSec},
    danger:{background:"#fff5f5",borderColor:"#fca5a5",color:C.red},
    success:{background:C.greenBg,borderColor:"#86efac",color:C.green},
    accent:{background:C.text,borderColor:C.text,color:"#fff"},
  };
  return <button onClick={onClick} disabled={disabled} style={{...base,...vs[variant],...sx}} {...r}>{children}</button>;
}
function Badge({children,color=C.textSec,bg,size="sm",...rest}){
  const sz=size==="lg"?{padding:"4px 12px",fontSize:12}:{padding:"3px 9px",fontSize:10.5};
  return <span {...rest} style={{display:"inline-flex",alignItems:"center",gap:4,...sz,borderRadius:4,fontWeight:600,...font.sans,background:bg||color+"10",color,whiteSpace:"nowrap",letterSpacing:"0.01em"}}>{children}</span>;
}
function Spinner({size=14,color:cl=C.cyan}){ return <svg width={size} height={size} viewBox="0 0 24 24" style={{animation:"spin .7s linear infinite",flexShrink:0}}><circle cx="12" cy="12" r="10" fill="none" stroke={C.border} strokeWidth="3"/><path d="M12 2 a10 10 0 0 1 10 10" fill="none" stroke={cl} strokeWidth="3" strokeLinecap="round"/></svg>; }
function Card({children,style:sx,className,hover,...rest}){ return <div className={className} {...rest} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:20,boxShadow:"0 1px 2px rgba(0,0,0,.03)",...sx}}>{children}</div>; }

function SectionHeader({icon,title,subtitle,right,badge}){
  return(<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:8}}>
    <div>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:subtitle?3:0}}>
        {icon&&<span style={{display:"flex",alignItems:"center"}}>{icon}</span>}
        <h2 style={{...font.sans,fontSize:15,fontWeight:700,letterSpacing:"-0.01em",color:C.text,margin:0}}>{title}</h2>
        {badge}
      </div>
      {subtitle&&<p style={{...font.sans,fontSize:12,color:C.textMuted,lineHeight:1.5,maxWidth:600,margin:0}}>{subtitle}</p>}
    </div>
    {right&&<div style={{display:"flex",alignItems:"center",gap:8}}>{right}</div>}
  </div>);
}

function ChipEditor({items,onChange,color=C.textMuted,placeholder="Add…"}){
  const[adding,setAdding]=useState(false);const[text,setText]=useState("");const ref=useRef(null);
  useEffect(()=>{if(adding&&ref.current)ref.current.focus();},[adding]);
  return(<div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center"}}>
    {items.map((item,i)=>(<EditableChip key={`${item}-${i}`} value={item} onEdit={v=>{const n=[...items];n[i]=v;onChange(n);}} onRemove={()=>onChange(items.filter((_,j)=>j!==i))}/>))}
    {adding?(<input ref={ref} value={text} onChange={e=>setText(e.target.value)} placeholder={placeholder} onKeyDown={e=>{if(e.key==="Enter"&&text.trim()){onChange([...items,text.trim()]);setText("");setAdding(false);}if(e.key==="Escape"){setAdding(false);setText("");}}} onBlur={()=>{setAdding(false);setText("");}} style={{width:130,fontSize:12,padding:"4px 10px"}}/>):(<button onClick={()=>setAdding(true)} style={{...font.sans,fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:6,cursor:"pointer",background:C.cyanBg,color:C.cyan,border:`1px dashed ${C.cyan}44`,transition:"all .15s"}}>+ add</button>)}
  </div>);
}
function EditableChip({value,onEdit,onRemove}){
  const[editing,setEditing]=useState(false);const[text,setText]=useState(value);const ref=useRef(null);
  useEffect(()=>{if(editing&&ref.current)ref.current.focus();},[editing]);
  if(editing)return <input ref={ref} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&text.trim()){onEdit(text.trim());setEditing(false);}if(e.key==="Escape"){setText(value);setEditing(false);}}} onBlur={()=>{setText(value);setEditing(false);}} style={{width:Math.max(70,text.length*7+20),fontSize:12,padding:"4px 10px"}}/>;
  return(<span style={{display:"inline-flex",alignItems:"center",gap:4,background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,padding:"4px 8px 4px 12px",fontSize:12,fontWeight:500,color:C.text,cursor:"pointer",...font.sans,transition:"all .15s"}}><span onClick={()=>setEditing(true)} style={{maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{value}</span><span onClick={e=>{e.stopPropagation();onRemove();}} style={{cursor:"pointer",color:C.textMuted,fontSize:15,lineHeight:1,marginLeft:2,transition:"color .15s"}}>×</span></span>);
}
function TabBar({tabs,active,onChange}){
  return(<div style={{display:"flex",gap:2,background:C.nested,borderRadius:10,padding:3,marginBottom:16}}>{tabs.map(t=>(<button key={t.id} onClick={()=>onChange(t.id)} style={{...font.sans,fontSize:12,fontWeight:600,padding:"8px 16px",cursor:"pointer",background:active===t.id?C.white:"transparent",border:"none",borderRadius:8,color:active===t.id?C.text:C.textMuted,transition:"all .15s",boxShadow:active===t.id?"0 1px 3px rgba(0,0,0,.08)":"none"}}>{t.label}</button>))}</div>);
}
function Expandable({title,children,defaultOpen=false}){
  const[open,setOpen]=useState(defaultOpen);
  return(<div style={{borderTop:`1px solid ${C.borderLight}`,marginTop:8}}>
    <button onClick={()=>setOpen(!open)} style={{...font.sans,width:"100%",textAlign:"left",background:"none",border:"none",padding:"10px 0",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",color:C.textSec,fontSize:12,fontWeight:600}}>
      <span>{title}</span><span style={{fontSize:14,transition:"transform .2s",transform:open?"rotate(180deg)":"rotate(0)"}}>{open?"▾":"▸"}</span>
    </button>
    {open&&<div className="fade-in" style={{paddingBottom:12}}>{children}</div>}
  </div>);
}

// ── SOURCE DESCRIPTIONS WITH INVESTMENT IMPLICATIONS ─────────────────────────

const SOURCE_INFO = {
  theirstack: {
    metric: "Total matching job postings (US, last 30 days)",
    how: "POST to TheirStack /v1/jobs/search — aggregates LinkedIn, Indeed, Glassdoor & thousands of ATS platforms (Greenhouse, Lever, Workable) into one deduplicated count. Title keywords match against job_title_or, description keywords match against job_description_pattern_or.",
    investment: "Job postings are the strongest leading indicator of enterprise AI spend. Rising counts signal expanding headcount budgets (6-12 month forward spend). A shift from 'AI strategy' titles to 'ML engineer' or 'platform engineer' titles indicates the transition from exploration to committed deployment — this is when procurement cycles begin. Sustained 30%+ WoW growth with language shift = high-confidence budget acceleration signal. Declining postings after a peak often precedes earnings misses in AI-exposed vendors.",
    leadLag: "6–12 months. Job postings lead vendor revenue by 2–4 quarters. Hiring intent → procurement cycle (1–2Q) → vendor contract (1Q) → revenue recognition (1Q). Contract hiring surges compress this to 3–6 months.",
    movements: {
      strongUp: { label: "Sustained +30% WoW growth", meaning: "Budget acceleration phase. Enterprise has moved past evaluation into committed headcount expansion. Procurement cycle has begun or is imminent. Vendor revenue inflection likely in 2–4 quarters.", marketImpact: "Bullish for AI infrastructure vendors, cloud providers, and professional services firms in this vertical. Watch for vendor earnings beats 2–3 quarters out." },
      moderateUp: { label: "+10–30% WoW growth", meaning: "Active evaluation expanding into pilot staffing. Budgets are being allocated but not yet committed. Decision-makers are building internal teams to evaluate and deploy.", marketImpact: "Early signal — position for vendors serving this vertical. Too early for high-conviction plays but worth monitoring for acceleration." },
      flat: { label: "±10% WoW (stable)", meaning: "Steady-state demand. Either the vertical hasn't caught the AI wave yet, or it has already absorbed it into baseline hiring. Check other signals for context.", marketImpact: "Neutral. If flat while other signals (search, repos) are rising, this is a divergence — indicates 'tire-kicking' without budget commitment." },
      moderateDown: { label: "-10–30% WoW decline", meaning: "Budget tightening or hiring freeze. Could indicate: (a) project completion and move to maintenance, (b) macro headwinds hitting the vertical, or (c) shift from hiring to vendor procurement (outsourcing the AI work).", marketImpact: "Watch for the cause. If paired with rising vendor adoption signals, it means build-vs-buy has shifted to buy — bullish for vendors. If across-the-board decline, defensive positioning warranted." },
      strongDown: { label: "Sustained -30% WoW decline", meaning: "Budget freeze or strategic retreat. The vertical is pulling back from AI investment. Two consecutive months of decline historically precedes earnings misses in AI-exposed vendors serving this vertical.", marketImpact: "Bearish for vendors with concentrated exposure to this vertical. Reduce positions. Watch for contagion to adjacent verticals." },
      titleShift: { label: "Title mix shifting from strategy → engineering", meaning: "The most important signal in this metric. When 'AI Strategy Lead' postings decline while 'ML Engineer', 'MLOps', 'Platform Engineer' postings rise, the vertical has crossed from exploration to implementation. Procurement is active.", marketImpact: "High-conviction bullish signal. This is where the budget commitment happens. Vendor revenue acceleration begins 1–2 quarters after this shift." },
    },
  },
  google_trends: {
    metric: "Google Trends relative interest index (0–100 scale, not absolute search counts)",
    how: "GET via SerpAPI google_trends engine — returns a normalized search interest score where 100 = peak popularity for that keyword in the selected time range, 50 = half that peak, 0 = insufficient data. This is NOT an absolute count of Google searches. It measures relative popularity compared to the keyword's own historical peak within the time window. Momentum compares the current reading to the 4-week rolling average.",
    investment: "Search interest is a demand-side awareness proxy. Rising trends for specific AI tools or methodologies (e.g. 'AI copilot', 'RAG pipeline') signal enterprise decision-makers in active evaluation. Momentum > +15% suggests accelerating mindshare — procurement teams are researching. A divergence between high search trends and low job postings suggests 'tire-kicking' — awareness without budget commitment. Convergence of both rising = strong conviction signal for AI infrastructure vendors.",
    leadLag: "1–4 weeks for volatility/attention effects. 3–9 months for enterprise procurement impact. Search spikes predict increased trading volume within 1–2 weeks (academic: Granger-causal at p<0.05). Enterprise procurement cycles triggered by search activity materialize in 2–3 quarters.",
    movements: {
      strongUp: { label: "Index jumps >20 points in <4 weeks", meaning: "Viral attention event — could be a product launch, regulatory announcement, or industry inflection. Decision-makers across the vertical are actively researching. This is the 'awareness shock' that precedes enterprise evaluation cycles.", marketImpact: "Short-term: increased trading volume and volatility in related stocks within 1–2 weeks. Medium-term: if sustained >4 weeks, procurement teams are entering evaluation — vendor pipeline builds over next 2 quarters." },
      moderateUp: { label: "Steady +5–15 point climb over 8+ weeks", meaning: "Organic demand growth. Not a spike — sustained interest indicates a structural shift in the vertical's relationship with the technology. This is the most reliable search signal because it filters out noise.", marketImpact: "Medium-conviction bullish. Vendor pipeline is building. Revenue impact in 2–4 quarters. More reliable than spike signals because it indicates genuine adoption momentum, not hype." },
      peakAndDecline: { label: "Index hits 80+ then drops 30%+", meaning: "Hype cycle peak followed by 'trough of disillusionment.' The vertical had intense initial interest but is now in evaluation fatigue or has decided against adoption. Common with immature or overhyped technologies.", marketImpact: "Bearish short-term for vendors targeting this vertical. But watch for a 'plateau of productivity' signal — if index stabilizes at 40–60 range, the serious buyers remain. The tourists have left." },
      flat: { label: "Index stable 20–50 range", meaning: "Steady background awareness. The vertical knows about the technology but isn't actively researching it. Either already adopted (check job postings) or not yet motivated (watch for a catalyst).", marketImpact: "Neutral. Pair with other signals. Flat search + rising jobs = internal mandate (search happened months ago). Flat search + flat jobs = no current demand catalyst." },
      divergenceWithJobs: { label: "Search rising + Jobs flat/falling", meaning: "CRITICAL DIVERGENCE: Awareness without budget commitment. The vertical is 'tire-kicking.' Decision-makers are interested personally but haven't convinced budget holders. This gap closes either by jobs rising (bull case) or search declining (bear case).", marketImpact: "Wait for resolution. Do NOT position based on search alone when jobs diverge. The gap typically resolves within 2–3 months." },
    },
  },
  github_repos: {
    metric: "Active GitHub repositories matching keywords (pushed in date range)",
    how: "GET to GitHub Search API /search/repositories — filters by keyword and pushed:date..date range. Measures active open-source development activity.",
    investment: "Open-source activity is a supply-side innovation proxy. Growing repo counts indicate an expanding developer ecosystem building tooling around a technology. This leads enterprise adoption by 6-18 months — enterprises build on mature OSS. Rapid growth (>50% increase) in repos for a specific framework signals it may become the dominant standard, making vendors built on that stack more defensible. Declining activity = consolidation phase, fewer new entrants, potential winner-take-most dynamics.",
    leadLag: "6–18 months. OSS ecosystem maturity leads enterprise deployment by 2–6 quarters. Developer experimentation (repos) → open-source tooling matures → enterprise evaluates mature stack → procurement. This is the longest lead-time signal but also the highest-conviction for structural trends.",
    movements: {
      strongUp: { label: "+50% or more repo growth in 30 days", meaning: "Ecosystem explosion. A new framework or approach has captured developer mindshare. Generative AI repos grew 178% YoY through 2025 — this level of growth indicates a technology is transitioning from experimental to infrastructure-grade.", marketImpact: "Bullish for platforms built on this stack. Enterprises adopt mature OSS — high repo growth today means vendor integration opportunities in 3–6 quarters. Identify which companies are building on this ecosystem." },
      moderateUp: { label: "+15–50% repo growth over 30 days", meaning: "Healthy ecosystem expansion. Developer interest is translating into projects. This is typical of technologies past the 'hype' phase entering real tooling development.", marketImpact: "Constructive for the ecosystem. Start identifying which enterprise vendors are wrapping services around this OSS. Revenue impact in 4–6 quarters as enterprises need commercial support." },
      flat: { label: "±15% stable repo count", meaning: "Mature technology. Developer ecosystem is established but not rapidly expanding. Could indicate: (a) technology is broadly adopted (check HF downloads), or (b) interest has plateaued.", marketImpact: "Neutral for new plays. If the tech is already broadly adopted, winners are known. Look for 'second derivative' — adjacent tooling repos growing even if core repos are stable." },
      declining: { label: "Repo count declining >15%", meaning: "Consolidation or abandonment. Developer attention is shifting away. If this is a narrow framework, it may be losing to a competitor. If broad technology, developers may be moving from experimentation to fewer, higher-quality production implementations.", marketImpact: "Differentiate cause: consolidation (bullish for winners) vs abandonment (bearish for the technology). Declining repos + rising enterprise adoption = healthy maturation. Declining repos + declining everything = the technology is failing." },
      languageShift: { label: "Primary language of repos shifts (e.g., Python → TypeScript)", meaning: "Enterprise signal. TypeScript overtook Python on GitHub in Aug 2025, reflecting enterprise preference for type-safe systems paired with AI tools. When repos shift from scripting languages to enterprise languages, it signals the technology is crossing from prototyping to production.", marketImpact: "Bullish for enterprise readiness. Production-grade repos attract enterprise evaluation. Revenue impact for tooling vendors begins 2–3 quarters after the language shift." },
    },
  },
  claude_attrib: {
    metric: "GitHub commits with AI co-author signatures (last 7 days)",
    how: 'GET to GitHub Search API /search/commits — searches for "Co-Authored-By: Claude" in commit messages. The big number on each **tracking group** row is GitHub\'s `total_count` for **that group\'s query only** (we do **not** add counts across groups). Live **Refresh** uses a rolling **~7-day** committer-date window in the query template. **History / growth chart** stores **one point per ISO week** (weekly backfill or snapshot) — so the chart can look jumpy vs. the 7d headline: different windows, GitHub index lag, and early weeks with partial coverage. Volatility is normal: org-wide commit bursts, merge commits, keyword narrowing/broadening, API rate limits, and GitHub search freshness all move `total_count` without a single "error" in your setup.',
    investment: "AI-attributed commits are a direct measure of AI coding tool penetration into real development workflows. Growth here tracks the actual productization of AI assistants — not just interest, but daily usage. Accelerating attribution rates signal that AI coding tools are reaching 'default tool' status, which directly impacts: (1) developer productivity metrics in earnings calls, (2) seat expansion for AI coding platforms, (3) compute demand for inference at scale. This is the most concrete 'AI is being used' signal vs. 'AI is being talked about'.",
    leadLag: "0–3 months. This is the most real-time signal. Attribution rates directly reflect current tool usage. Revenue impact for AI coding platforms (Anthropic, GitHub/Microsoft) is nearly immediate — seat counts expand within the same quarter. Compute demand impact (cloud providers) follows within 1 quarter.",
    movements: {
      strongUp: { label: "+40% WoW attribution growth", meaning: "Viral adoption event. A new model release, pricing change, or enterprise rollout is driving rapid uptake. Claude Code reached 69% market share by Jan 2026, growing from near-zero in 9 months — this is the speed at which AI tool adoption moves.", marketImpact: "Immediately bullish for the AI coding platform (Anthropic revenue), cloud compute providers (inference demand), and the broader 'AI is real' thesis. This signal has zero lag — it IS the adoption." },
      moderateUp: { label: "+10–40% WoW steady growth", meaning: "Organic adoption expansion. More developers are integrating AI into daily workflows. 73% of engineering teams now use AI coding tools daily (up from 41% in 2025). Steady growth indicates the tool is becoming default behavior, not a novelty.", marketImpact: "Bullish for platform revenue (seat expansion) and compute providers (inference volume). Productivity gains (2.1x features shipped/sprint, 38% fewer bugs) flow into enterprise earnings 1–2 quarters later as hiring needs decrease." },
      plateau: { label: "Attribution count stabilizes (±10%)", meaning: "Market saturation for the current tool version. The existing user base is stable. New growth requires: (a) a new model release driving capability step-change, (b) enterprise mandates pushing remaining holdouts, or (c) expansion into new geographies/industries.", marketImpact: "Neutral for the platform. Revenue stabilizes but doesn't decline. Watch for competitive dynamics — if Claude attribution plateaus while Copilot attribution rises, market share is shifting." },
      decline: { label: "Attribution count drops >15%", meaning: "Competitive displacement or backlash. Developers are switching tools or reverting to manual coding. Could be: (a) a better competitor emerged, (b) enterprise policy restricted AI tool use, or (c) a model quality regression.", marketImpact: "Bearish for the specific platform. Identify the beneficiary — attribution is a zero-sum game across tools. If ALL AI attribution declines, this is a bearish signal for the entire AI coding thesis." },
      enterprisePattern: { label: "Weekday/weekend ratio shifts toward weekdays", meaning: "Enterprise adoption signal. When attribution concentrates on weekdays, it means companies — not hobbyists — are driving usage. Enterprise seats are 3–5x more valuable than individual developer seats.", marketImpact: "Bullish for enterprise revenue. Enterprise contracts are larger, stickier, and have expansion potential. This pattern shift precedes seat count acceleration in earnings reports by 1 quarter." },
    },
  },
};

/** Short, visible blurbs for all teammates — what the number is and how it ties to AI demand. */
const SOURCE_METRIC_BLURB = {
  theirstack:
    "Job posting counts from TheirStack for this group’s keywords — absolute hires signal, not normalized.",
  google_trends:
    "Google Trends **index 0–100** for this group’s keywords (relative to that keyword’s peak in the chart window — not search volume, not additive across groups).",
  github_repos:
    "GitHub **repository** search hit count for this group’s keywords in the pushed-date range — not commits.",
  claude_attrib:
    "GitHub **commit** search: `total_count` of commits whose message matches `Co-Authored-By: Claude` (plus optional keyword filters) — **rolling ~7 days** on Refresh; weekly points in history.",
  historical:
    "Historical hiring momentum from backfill data.",
  githubHistorical:
    "Historical repo activity from backfill data.",
};

/** Movement-pattern text for weekly brief only (removed from dashboard methodology UI). */
function buildSignalMovementInterpretationForBrief() {
  const out = {};
  for (const [id, info] of Object.entries(SOURCE_INFO)) {
    if (!info?.movements) continue;
    out[id] = Object.entries(info.movements).map(([key, m]) => ({
      key,
      label: m.label,
      meaning: m.meaning,
      market_impact: m.marketImpact,
    }));
  }
  return out;
}

// ── SIGNAL HISTORY CHART ─────────────────────────────────────────────────────

function formatChartDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month:"short", day:"numeric" }) + " " + d.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" });
}
function formatChartDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = (now - d) / 86400000;
  if (diffDays < 1) return d.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" });
  if (diffDays < 365) return d.toLocaleDateString("en-US", { month:"short", day:"numeric" });
  return d.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"2-digit" });
}

// ── ANNOTATION TYPES ─────────────────────────────────────────────────────────
const ANNOTATION_TYPES = [
  { id: "inflection", label: "Inflection Detected", color: "#ef4444", icon: "⬥" },
  { id: "thesis_change", label: "Thesis Change", color: "#f59e0b", icon: "◆" },
  { id: "catalyst", label: "Catalyst / Event", color: "#8b5cf6", icon: "★" },
  { id: "risk", label: "Risk Flag", color: "#ec4899", icon: "⚠" },
  { id: "note", label: "General Note", color: "#6b7280", icon: "●" },
];

function AnnotationMarker({ ann, x, chartHeight }) {
  const tp = ANNOTATION_TYPES.find(t => t.id === ann.type) || ANNOTATION_TYPES[4];
  const [hover, setHover] = useState(false);
  return (
    <g onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ cursor: "pointer" }}>
      <line x1={x} x2={x} y1={0} y2={chartHeight - 30} stroke={tp.color} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6} />
      <text x={x} y={12} textAnchor="middle" fill={tp.color} fontSize={14} fontWeight="bold">{tp.icon}</text>
      {hover && (
        <foreignObject x={x - 120} y={18} width={240} height={100}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ ...font.sans, fontSize: 11, background: C.white, border: `1px solid ${tp.color}44`, borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 12px rgba(0,0,0,.12)" }}>
            <div style={{ fontWeight: 700, color: tp.color, marginBottom: 2 }}>{tp.icon} {tp.label}</div>
            <div style={{ color: C.text, marginBottom: 3 }}>{ann.note}</div>
            <div style={{ color: C.textMuted, fontSize: 10 }}>{ann.author || "Team"} · {new Date(ann.isoDate).toLocaleDateString()}</div>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function TeamNotesPanel({ annotations, onAdd, onDelete, verticals }) {
  const [composing, setComposing] = useState(false);
  const [type, setType] = useState("note");
  const [note, setNote] = useState("");
  const [author, setAuthor] = useState(() => ld("annotation_author", ""));
  const [linkedGroup, setLinkedGroup] = useState("");
  const [filterType, setFilterType] = useState("all");
  const textRef = useRef(null);

  useEffect(() => { if (composing && textRef.current) textRef.current.focus(); }, [composing]);

  const submit = () => {
    if (!note.trim()) return;
    sv("annotation_author", author);
    onAdd({
      type,
      note: note.trim(),
      author: author.trim() || "Team",
      signalKey: linkedGroup || null,
      signalLabel: linkedGroup ? (verticals.find(v => v.id === linkedGroup)?.name || linkedGroup) : null,
    });
    setNote("");
    setType("note");
    setLinkedGroup("");
    setComposing(false);
  };

  const sorted = [...annotations].sort((a, b) => b.ts - a.ts);
  const filtered = filterType === "all" ? sorted : sorted.filter(a => a.type === filterType);

  return (
    <Card style={{ marginBottom: 20, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ ...font.sans, fontSize: 14, fontWeight: 700, color: C.text }}>Team Notes</div>
          <div style={{ ...font.sans, fontSize: 11, color: C.textMuted, marginTop: 2 }}>Log observations, thesis changes, risks, and catalysts. Notes sync across browsers via cloud backup.</div>
        </div>
        <Btn variant={composing ? "ghost" : "accent"} size="sm" onClick={() => setComposing(!composing)}>
          {composing ? "Cancel" : "+ Add Note"}
        </Btn>
      </div>

      {/* Compose form */}
      {composing && (
        <div className="fade-in" style={{ padding: "14px 18px", background: C.nested, borderBottom: `1px solid ${C.borderLight}` }}>
          {/* Note type selector */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {ANNOTATION_TYPES.map(t => (
              <button key={t.id} onClick={() => setType(t.id)} style={{ ...font.sans, fontSize: 11, fontWeight: type === t.id ? 700 : 500, padding: "5px 12px", borderRadius: 20, cursor: "pointer", border: type === t.id ? `2px solid ${t.color}` : `1px solid ${C.borderLight}`, background: type === t.id ? t.color + "14" : C.white, color: type === t.id ? t.color : C.textSec, transition: "all .12s" }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Note text */}
          <textarea ref={textRef} value={note} onChange={e => setNote(e.target.value)} placeholder="What did you observe? Why does it matter for the thesis?" rows={3} style={{ ...font.sans, fontSize: 13, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 10, background: C.white, color: C.text, width: "100%", resize: "vertical", lineHeight: 1.5, marginBottom: 8 }} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && note.trim()) submit(); }} />

          {/* Bottom row: group link + author + save */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={linkedGroup} onChange={e => setLinkedGroup(e.target.value)} style={{ ...font.sans, fontSize: 12, padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.text, minWidth: 140 }}>
              <option value="">No group (general)</option>
              {verticals.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Your name" style={{ ...font.sans, fontSize: 12, padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.text, width: 140 }} />
            <Btn size="sm" variant="accent" onClick={submit} disabled={!note.trim()}>Save note</Btn>
            <span style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginLeft: "auto" }}>Ctrl+Enter to save</span>
          </div>
        </div>
      )}

      {/* Filter bar + notes list */}
      <div style={{ padding: "10px 18px" }}>
        {annotations.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
            <button onClick={() => setFilterType("all")} style={{ ...font.sans, fontSize: 10, fontWeight: filterType === "all" ? 700 : 500, padding: "3px 10px", borderRadius: 12, border: `1px solid ${filterType === "all" ? C.cyan : C.borderLight}`, background: filterType === "all" ? C.cyanBg : "transparent", color: filterType === "all" ? C.cyan : C.textMuted, cursor: "pointer" }}>All ({annotations.length})</button>
            {ANNOTATION_TYPES.map(t => {
              const count = annotations.filter(a => a.type === t.id).length;
              if (!count) return null;
              return <button key={t.id} onClick={() => setFilterType(t.id)} style={{ ...font.sans, fontSize: 10, fontWeight: filterType === t.id ? 700 : 500, padding: "3px 10px", borderRadius: 12, border: `1px solid ${filterType === t.id ? t.color : C.borderLight}`, background: filterType === t.id ? t.color + "14" : "transparent", color: filterType === t.id ? t.color : C.textMuted, cursor: "pointer" }}>{t.icon} {t.label} ({count})</button>;
            })}
          </div>
        )}

        {filtered.length === 0 ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ ...font.sans, fontSize: 12, color: C.textMuted }}>No notes yet. Click <strong>+ Add Note</strong> to log an observation.</div>
          </div>
        ) : (
          <div>
            {filtered.slice(0, 20).map(ann => {
              const tp = ANNOTATION_TYPES.find(t => t.id === ann.type) || ANNOTATION_TYPES[4];
              const groupVert = ann.signalKey ? verticals.find(v => v.id === ann.signalKey) : null;
              return (
                <div key={ann.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: tp.color + "14", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                    <span style={{ fontSize: 13, color: tp.color }}>{tp.icon}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...font.sans, fontSize: 12, color: C.text, lineHeight: 1.5 }}>{ann.note}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                      <span style={{ ...font.sans, fontSize: 10, fontWeight: 600, color: tp.color }}>{tp.label}</span>
                      {groupVert && <span style={{ ...font.sans, fontSize: 10, padding: "1px 6px", borderRadius: 4, background: (groupVert.color || C.cyan) + "14", color: groupVert.color || C.cyan, fontWeight: 600 }}>{groupVert.name}</span>}
                      <span style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>{ann.author || "Team"}</span>
                      <span style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>{new Date(ann.isoDate).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                  <button onClick={() => onDelete(ann.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: 14, flexShrink: 0, padding: "4px", opacity: 0.5, transition: "opacity .15s" }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5} title="Delete note">✕</button>
                </div>
              );
            })}
            {filtered.length > 20 && <div style={{ ...font.sans, fontSize: 11, color: C.textMuted, textAlign: "center", padding: "8px 0" }}>Showing 20 of {filtered.length} notes</div>}
          </div>
        )}
      </div>
    </Card>
  );
}

function zoomedYDomain(values) {
  if (!values?.length) return [0, "auto"];
  const nums = values.filter(v => typeof v === "number" && isFinite(v));
  if (nums.length < 2) return [0, "auto"];
  const sorted = [...nums].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const upperFence = q3 + iqr * 3;
  const clamped = nums.map(v => Math.min(v, upperFence || v));
  const min = Math.min(...clamped);
  const max = Math.max(...clamped);
  const range = max - min;
  if (range === 0) return [Math.max(0, min - 1), max + 1];
  if (min === 0) return [0, max + range * 0.1];
  const pad = range * 0.15;
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}

function SignalHistoryChart({ signalKey, color, label, sourceId }) {
  const [sigRange, setSigRange] = useState("1y");
  const [smooth, setSmooth] = useState(true);
  const raw = getSignalHistory(signalKey);
  if (raw.length < 2) return <div style={{...font.sans,fontSize:12,color:C.textMuted,padding:"12px 0",textAlign:"center"}}>Chart appears after 2+ data points.</div>;
  let allData = sanitizeTimeSeries(raw.map(p => ({ ...p, _ts: new Date(p.isoDate || p.ts).getTime() })).sort((a,b)=>a._ts-b._ts), "value");

  // Handle scale breaks: when live-refresh and backfill data use different query windows
  // (30d live vs 7d backfill) or when old corrupt data exists at a completely different magnitude.
  // Strategy: find the majority cluster and keep it, filtering out the minority scale.
  if (allData.length >= 5) {
    const posVals = allData.map(d => d.value).filter(v => typeof v === "number" && isFinite(v) && v > 0);
    if (posVals.length >= 5) {
      const svs = [...posVals].sort((a, b) => a - b);
      const scaleRange = svs[svs.length - 1] / Math.max(svs[0], 1);
      if (scaleRange > 20) {
        const median = svs[Math.floor(svs.length / 2)];
        const loBound = median / 10, hiBound = median * 10;
        const majority = allData.filter(d => {
          const v = d.value;
          return typeof v === "number" && v >= loBound && v <= hiBound;
        });
        if (majority.length >= 3 && majority.length >= allData.length * 0.4) allData = majority;
      }
    }
  }

  const filtered = filterByTimeRange(allData, sigRange, "isoDate");
  if (filtered.length < 2) return <div style={{...font.sans,fontSize:12,color:C.textMuted,padding:"12px 0",textAlign:"center"}}>Not enough data in selected range. <TimeRangeSelector value={sigRange} onChange={setSigRange} style={{marginLeft:8}} /></div>;
  const emaAlpha = filtered.length <= 10 ? 0.15 : filtered.length <= 30 ? 0.2 : 0.25;
  const data = smooth && filtered.length >= 4 ? smoothEMA(filtered, "value", emaAlpha) : filtered;
  const showDots = filtered.length <= 60;
  const chartVals = data.map(d => smooth ? (d.value_smooth ?? d.value) : d.value);
  const yDomain = zoomedYDomain(chartVals);
  const vals = filtered.map(d => d.value);
  let pctNote = null;
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const firstVal = filtered[0]?.value || 0;
  const lastVal = filtered[filtered.length - 1]?.value || 0;
  let pctChange = 0;
  const useEarlyLateAvg = filtered.length >= 6 && (lo === 0 || hi / Math.max(lo, 1) > 10);
  if (useEarlyLateAvg) {
    const k = Math.max(2, Math.floor(filtered.length * 0.2));
    const earlyMean = mean(vals.slice(0, k));
    const lateMean = mean(vals.slice(-k));
    if (earlyMean > 0) {
      pctChange = ((lateMean - earlyMean) / earlyMean) * 100;
      pctNote = "early vs late avg";
    } else if (lateMean > 0) {
      pctChange = NaN;
      pctNote = "from zero baseline";
    }
  } else if (filtered.length >= 2 && firstVal > 0) {
    pctChange = ((lastVal - firstVal) / firstVal) * 100;
  }
  return (
    <div style={{ width: "100%", height: 180 }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <span style={{...font.sans,fontSize:10,color:C.textMuted}}>{filtered.length} data points since {formatChartDateShort(filtered[0]?.isoDate)}</span>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <label style={{...font.sans,fontSize:9,color:C.textMuted,display:"flex",alignItems:"center",gap:3,cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={smooth} onChange={e=>setSmooth(e.target.checked)} style={{width:12,height:12,accentColor:color}} />Smooth
          </label>
          <span style={{...font.mono,fontSize:10,fontWeight:700,color: Number.isNaN(pctChange) ? C.textMuted : pctChange > 0 ? C.green : pctChange < 0 ? C.red : C.textMuted}} title={pctNote || "First point vs last point"}>
            {Number.isNaN(pctChange) ? "n/a *" : `${pctChange > 0 ? "+" : ""}${Math.abs(pctChange) > 99999 ? `${(pctChange / 1000).toFixed(0)}K` : pctChange.toFixed(1)}%${pctNote ? " *" : ""}`} overall
          </span>
          <TimeRangeSelector value={sigRange} onChange={setSigRange} />
        </div>
      </div>
      {pctNote && <div style={{...font.sans,fontSize:9,color:C.textMuted,textAlign:"right",marginBottom:4,lineHeight:1.3}}>* {pctNote}: early data may be on a different scale — chart will normalize as more refreshes accumulate.</div>}
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top:8,right:16,bottom:8,left:8 }}>
          <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin","dataMax"]}
            tickFormatter={ts=>formatChartDateShort(new Date(ts).toISOString())}
            tick={{fontSize:9,fill:C.textMuted,...font.sans}} interval="preserveStartEnd" tickCount={6} />
          <YAxis tick={{fontSize:10,fill:C.textMuted,...font.mono}} width={55} domain={yDomain} allowDataOverflow={true} />
          <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}} labelStyle={{fontWeight:700}} labelFormatter={ts=>formatChartDate(new Date(ts).toISOString())}
            formatter={(val, name) => [typeof val === "number" ? val.toLocaleString() : val, name]} />
          {smooth && filtered.length >= 4 && (
            <Line type="monotone" dataKey="value_raw" stroke={color} strokeWidth={1} strokeOpacity={0.25}
              dot={showDots?{r:2,fill:color,fillOpacity:0.3,strokeWidth:0}:false} activeDot={false} name={`${label} (raw)`} />
          )}
          <Line type="monotone" dataKey={smooth && filtered.length >= 4 ? "value_smooth" : "value"} stroke={color} strokeWidth={2.5}
            dot={!smooth && showDots?{r:3,fill:C.white,stroke:color,strokeWidth:2}:false}
            activeDot={{r:5,fill:color}} name={label} />
        </LineChart>
      </ResponsiveContainer>
      {sourceId === "claude_attrib" && (
        <div style={{ ...font.sans, fontSize: 9, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>
          Each point is GitHub <span style={{ ...font.mono, fontSize: 9, color: C.textSec }}>total_count</span> for that snapshot’s commit search (often a different window than the ~7d headline after Refresh).
          The faint line is raw API readings; real commit bursts, merge waves, index freshness, and query changes all move the count — that is expected volatility, not a broken chart.
        </div>
      )}
    </div>
  );
}

// ── OVERLAY COMPARISON CHART ─────────────────────────────────────────────────

function computeZScoreDiv(seriesA, seriesB) {
  if (seriesA.length < 4 || seriesB.length < 4) return null;
  const diffs = [];
  const len = Math.min(seriesA.length, seriesB.length);
  for (let i = 0; i < len; i++) {
    if (seriesA[i] != null && seriesB[i] != null) diffs.push(seriesA[i] - seriesB[i]);
  }
  if (diffs.length < 4) return null;
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length;
  const std = Math.sqrt(variance);
  if (std < 0.5) return { z: 0, mean, std, currentDiff: diffs[diffs.length - 1] };
  const z = (diffs[diffs.length - 1] - mean) / std;
  return { z, mean, std, currentDiff: diffs[diffs.length - 1] };
}

function pearsonCorr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  const ax = a.slice(0, n), bx = b.slice(0, n);
  const ma = ax.reduce((s, v) => s + v, 0) / n, mb = bx.reduce((s, v) => s + v, 0) / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) { num += (ax[i] - ma) * (bx[i] - mb); dA += (ax[i] - ma) ** 2; dB += (bx[i] - mb) ** 2; }
  const den = Math.sqrt(dA * dB);
  return den === 0 ? 0 : num / den;
}

// ── SIGNAL CONVERGENCE PANEL ─────────────────────────────────────────────────

const SOURCE_COLORS = { theirstack: "#2563eb", google_trends: "#7c3aed", github_repos: "#059669", claude_attrib: "#d97706" };
const SOURCE_LABELS = { theirstack: "Job Postings", google_trends: "Google Trends", github_repos: "GitHub Repos", claude_attrib: "Claude Attribution" };

function vertHasKeywords(vert, srcId) {
  if (srcId === "claude_attrib") return true;
  const kw = vert?.keywords?.[srcId];
  if (!kw) return false;
  return Object.values(kw).some(v => Array.isArray(v) ? v.filter(Boolean).length > 0 : !!v);
}

function computeConvergence(vertId, sources, vert) {
  const signals = [];
  sources.forEach(srcId => {
    if (!vertHasKeywords(vert, srcId)) return;
    const hist = getSignalHistory(`${vertId}_${srcId}`);
    if (hist.length < 2) return;
    const sorted = [...hist].sort((a, b) => a.ts - b.ts);
    const vals = sorted.map(p => p.value);
    const n = vals.length;
    const latest = vals[n - 1] || 0;
    const prev = n >= 2 ? vals[n - 2] : null;
    const wow = prev && prev > 0 ? ((latest - prev) / prev) * 100 : null;
    const val3 = n >= 4 ? vals[n - 4] : (n >= 2 ? vals[0] : null);
    const chg3w = val3 && val3 > 0 ? ((latest - val3) / val3) * 100 : null;
    const avg = n > 0 ? vals.reduce((a, b) => a + b, 0) / n : 0;
    const std = n > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / (n - 1)) : 0;
    const z = std > 0 ? (latest - avg) / std : 0;
    const direction = (chg3w || wow || 0) > 0 ? "up" : (chg3w || wow || 0) < 0 ? "down" : "flat";
    signals.push({ srcId, latest, wow: wow != null ? Math.round(wow) : null, chg3w: chg3w != null ? Math.round(chg3w) : null, z: Number(z.toFixed(2)), direction, dataPoints: n });
  });
  const moving = signals.filter(s => s.direction !== "flat");
  const upCount = moving.filter(s => s.direction === "up").length;
  const downCount = moving.filter(s => s.direction === "down").length;
  const dominant = upCount > downCount ? "up" : downCount > upCount ? "down" : "mixed";
  const aligned = Math.max(upCount, downCount);
  const total = signals.length;
  const convergenceScore = total >= 2 ? Math.round((aligned / total) * 100) : 0;
  let verdict = "INSUFFICIENT DATA";
  if (total >= 3 && aligned >= 3) verdict = dominant === "up" ? "STRONG CONVERGENCE ↑" : "STRONG CONVERGENCE ↓";
  else if (total >= 2 && aligned >= 2) verdict = dominant === "up" ? "MODERATE ALIGNMENT ↑" : "MODERATE ALIGNMENT ↓";
  else if (total >= 2 && upCount > 0 && downCount > 0) verdict = "DIVERGING";
  else if (total >= 2) verdict = "WEAK / MIXED";
  return { signals, dominant, aligned, total, convergenceScore, verdict };
}

function ConvergenceBadge({ verdict }) {
  const colors = {
    "STRONG CONVERGENCE ↑": { bg: "#dcfce7", color: "#166534", border: "#86efac" },
    "STRONG CONVERGENCE ↓": { bg: "#fef2f2", color: "#991b1b", border: "#fca5a5" },
    "MODERATE ALIGNMENT ↑": { bg: "#ecfdf5", color: "#065f46", border: "#a7f3d0" },
    "MODERATE ALIGNMENT ↓": { bg: "#fff7ed", color: "#9a3412", border: "#fdba74" },
    "DIVERGING": { bg: "#fefce8", color: "#854d0e", border: "#fde68a" },
    "WEAK / MIXED": { bg: "#f9fafb", color: "#6b7280", border: "#e5e7eb" },
    "INSUFFICIENT DATA": { bg: "#f9fafb", color: "#9ca3af", border: "#e5e7eb" },
  };
  const c = colors[verdict] || colors["INSUFFICIENT DATA"];
  return <span style={{ ...font.sans, fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 6, background: c.bg, color: c.color, border: `1px solid ${c.border}`, letterSpacing: "0.02em" }}>{verdict}</span>;
}

function SignalConvergencePanel({ verticals, sources, signalResults }) {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [compareGroups, setCompareGroups] = useState([]);
  const [timeRange, setTimeRange] = useState("3m");
  const sourceIds = sources.filter(s => s.enabled).map(s => s.id);

  const convergenceData = useMemo(() => {
    const data = {};
    verticals.forEach(v => { data[v.id] = computeConvergence(v.id, sourceIds, v); });
    return data;
  }, [verticals, sourceIds, signalResults]);

  const filterByRange = useCallback((hist) => {
    if (!hist?.length) return [];
    const now = Date.now();
    const ms = { "1m": 30, "3m": 90, "6m": 180, "1y": 365 }[timeRange] * 86400000;
    return hist.filter(p => (now - (p.ts || new Date(p.isoDate).getTime())) < ms);
  }, [timeRange]);

  const buildChartData = useCallback((vertId, srcId) => {
    const raw = getSignalHistory(`${vertId}_${srcId}`);
    const filtered = filterByRange(raw);
    if (filtered.length < 2) return [];
    const sorted = [...filtered].sort((a, b) => a.ts - b.ts);
    const sanitized = sanitizeTimeSeries(sorted.map(p => ({ ...p, _ts: new Date(p.isoDate || p.ts).getTime() })).sort((a, b) => a._ts - b._ts), "value");
    return sanitized.length >= 4 ? smoothEMA(sanitized, "value", 0.15) : sanitized;
  }, [filterByRange]);

  const activeGroup = selectedGroup || (verticals.length > 0 ? verticals[0].id : null);
  const activeVert = verticals.find(v => v.id === activeGroup);

  return (
    <Card style={{ marginBottom: 20, padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${C.borderLight}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ ...font.sans, fontSize: 14, fontWeight: 700, color: C.text }}>Signal Convergence</div>
            <div style={{ ...font.sans, fontSize: 11, color: C.textMuted, marginTop: 2 }}>Multiple independent signals moving together is when you act. Single signals mean little.</div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {["1m", "3m", "6m", "1y"].map(r => (
              <button key={r} onClick={() => setTimeRange(r)} style={{ ...font.sans, fontSize: 10, fontWeight: timeRange === r ? 700 : 500, padding: "4px 10px", borderRadius: 6, border: `1px solid ${timeRange === r ? C.cyan : C.borderLight}`, background: timeRange === r ? C.cyanBg : "transparent", color: timeRange === r ? C.cyan : C.textSec, cursor: "pointer" }}>{r.toUpperCase()}</button>
            ))}
          </div>
        </div>

        {/* Convergence summary strip */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {verticals.map(v => {
            const conv = convergenceData[v.id];
            const isActive = activeGroup === v.id;
            return (
              <button key={v.id} onClick={() => setSelectedGroup(v.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, border: isActive ? `2px solid ${v.color || C.cyan}` : `1px solid ${C.borderLight}`, background: isActive ? (v.color || C.cyan) + "0a" : C.white, cursor: "pointer", transition: "all .15s" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: v.color || C.cyan, flexShrink: 0 }} />
                <span style={{ ...font.sans, fontSize: 12, fontWeight: 600, color: C.text }}>{v.name}</span>
                <ConvergenceBadge verdict={conv?.verdict || "INSUFFICIENT DATA"} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Active group detail view */}
      {activeVert && (() => {
        const conv = convergenceData[activeVert.id];
        const allKw = Object.values(activeVert.keywords || {}).flatMap(obj => Object.values(obj || {}).flatMap(arr => Array.isArray(arr) ? arr.filter(Boolean) : [String(arr || "")].filter(Boolean)));
        const uniqueKw = [...new Set(allKw)];

        return (
          <div style={{ padding: "16px 20px" }}>
            {/* Group header with keywords */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: activeVert.color || C.cyan }} />
              <span style={{ ...font.sans, fontSize: 16, fontWeight: 700, color: C.text }}>{activeVert.name}</span>
              <ConvergenceBadge verdict={conv?.verdict || "INSUFFICIENT DATA"} />
              {conv?.convergenceScore > 0 && <span style={{ ...font.mono, fontSize: 11, color: C.textMuted }}>{conv.convergenceScore}% aligned</span>}
            </div>
            {uniqueKw.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
                {uniqueKw.map((k, i) => <span key={i} style={{ ...font.sans, fontSize: 10, padding: "2px 8px", borderRadius: 4, background: C.nested, color: C.textSec, border: `1px solid ${C.borderLight}` }}>{k}</span>)}
              </div>
            )}

            {/* Side-by-side charts — only sources with keywords (claude_attrib always shows) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 16 }}>
              {sourceIds.filter(srcId => vertHasKeywords(activeVert, srcId)).map(srcId => {
                const data = buildChartData(activeVert.id, srcId);
                const sig = conv?.signals?.find(s => s.srcId === srcId);
                const color = SOURCE_COLORS[srcId] || C.cyan;
                const label = SOURCE_LABELS[srcId] || srcId;
                return (
                  <div key={srcId} style={{ background: C.nested, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.borderLight}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.text }}>{label}</span>
                      {sig && (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {sig.chg3w != null && <span style={{ ...font.mono, fontSize: 11, fontWeight: 700, color: sig.chg3w >= 0 ? "#059669" : "#dc2626" }}>{sig.chg3w >= 0 ? "+" : ""}{sig.chg3w}%<span style={{ ...font.sans, fontSize: 8, color: C.textMuted, marginLeft: 2 }}>3w</span></span>}
                          {sig.wow != null && <span style={{ ...font.mono, fontSize: 10, color: C.textMuted }}>{sig.wow >= 0 ? "+" : ""}{sig.wow}% w/w</span>}
                        </div>
                      )}
                    </div>
                    {/* Direction indicator */}
                    {sig && (
                      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 14 }}>{sig.direction === "up" ? "↑" : sig.direction === "down" ? "↓" : "→"}</span>
                        <span style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>Z-score: <strong style={{ color: Math.abs(sig.z) >= 2 ? "#dc2626" : C.text }}>{sig.z}</strong></span>
                        <span style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>{sig.dataPoints} pts</span>
                      </div>
                    )}
                    {data.length >= 2 ? (
                      <div style={{ height: 120 }}>
                        <ResponsiveContainer>
                          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                            <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={ts => formatChartDateShort(new Date(ts).toISOString())} tick={{ fontSize: 8, fill: C.textMuted }} interval="preserveStartEnd" tickCount={4} />
                            <YAxis tick={{ fontSize: 8, fill: C.textMuted }} width={36} domain={zoomedYDomain(data.map(d => d.value_smooth ?? d.value))} allowDataOverflow />
                            <Tooltip contentStyle={{ fontSize: 10, borderRadius: 8, ...font.sans }} labelFormatter={ts => formatChartDate(new Date(ts).toISOString())} formatter={v => [Math.round(v), label]} />
                            <Line type="monotone" dataKey={data[0]?.value_smooth != null ? "value_smooth" : "value"} stroke={color} strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ ...font.sans, fontSize: 11, color: C.textMuted }}>Need 2+ data points</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actionable interpretation */}
            {conv && conv.signals.length >= 2 && (
              <div style={{ background: conv.verdict.includes("STRONG") ? (conv.dominant === "up" ? "#f0fdf4" : "#fef2f2") : "#fffbeb", borderRadius: 10, padding: "14px 16px", border: `1px solid ${conv.verdict.includes("STRONG") ? (conv.dominant === "up" ? "#bbf7d0" : "#fecaca") : "#fde68a"}` }}>
                <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>Signal reading</div>
                <div style={{ ...font.sans, fontSize: 12, color: C.textSec, lineHeight: 1.6 }}>
                  {conv.verdict.includes("STRONG CONVERGENCE") && conv.dominant === "up" && (
                    <><strong>{conv.aligned} of {conv.total} signals rising together.</strong> This is the strongest pattern — independent data sources confirming the same acceleration. Job postings lead revenue by 1-2 quarters; GitHub activity leads enterprise adoption by 6-18 months. This vertical warrants attention for procurement timing.</>
                  )}
                  {conv.verdict.includes("STRONG CONVERGENCE") && conv.dominant === "down" && (
                    <><strong>{conv.aligned} of {conv.total} signals declining together.</strong> Coordinated decline across independent sources. This suggests the vertical is past peak hype or facing structural headwinds. Watch for contract non-renewals and budget reallocation.</>
                  )}
                  {conv.verdict.includes("MODERATE") && (
                    <><strong>{conv.aligned} of {conv.total} signals moving {conv.dominant === "up" ? "up" : "down"}.</strong> Partial alignment — not yet conclusive. One more confirming signal would upgrade this to high conviction. Monitor the lagging signals for confirmation or reversal.</>
                  )}
                  {conv.verdict === "DIVERGING" && (
                    <><strong>Signals are splitting — some up, some down.</strong> This is the most informative pattern. It often indicates a phase transition: e.g., job postings rising (budget commitment) while search interest falls (hype fading) means the vertical is moving from exploration to deployment. Read the specific divergence to determine which signal is leading.</>
                  )}
                  {conv.verdict === "WEAK / MIXED" && (
                    <>Signals are not showing a clear directional pattern. This vertical is either stable, noisy, or in transition. No actionable signal yet — check back next week.</>
                  )}
                  {conv.verdict === "INSUFFICIENT DATA" && (
                    <>Not enough data points to assess convergence. Refresh data or wait for more history to accumulate.</>
                  )}
                </div>
                {/* Per-signal breakdown */}
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {conv.signals.map(s => (
                    <div key={s.srcId} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 6, background: C.white, border: `1px solid ${C.borderLight}` }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: SOURCE_COLORS[s.srcId] }} />
                      <span style={{ ...font.sans, fontSize: 10, fontWeight: 600, color: C.text }}>{SOURCE_LABELS[s.srcId]}</span>
                      <span style={{ fontSize: 12 }}>{s.direction === "up" ? "↑" : s.direction === "down" ? "↓" : "→"}</span>
                      {s.chg3w != null && <span style={{ ...font.mono, fontSize: 10, fontWeight: 700, color: s.chg3w >= 0 ? "#059669" : "#dc2626" }}>{s.chg3w >= 0 ? "+" : ""}{s.chg3w}%</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cross-group comparison toggle */}
            {verticals.length >= 2 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>Compare groups side-by-side</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {verticals.filter(v => v.id !== activeVert.id).map(v => {
                    const isComp = compareGroups.includes(v.id);
                    return (
                      <button key={v.id} onClick={() => setCompareGroups(prev => isComp ? prev.filter(x => x !== v.id) : [...prev, v.id].slice(-1))} style={{ ...font.sans, fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: isComp ? `2px solid ${v.color || C.cyan}` : `1px solid ${C.borderLight}`, background: isComp ? (v.color || C.cyan) + "12" : "transparent", color: isComp ? (v.color || C.cyan) : C.textSec, cursor: "pointer" }}>
                        {v.name}
                      </button>
                    );
                  })}
                </div>

                {/* Side-by-side comparison — shared calendar window (matches time range selector above) */}
                {compareGroups.length > 0 && (() => {
                  const compVert = verticals.find(v => v.id === compareGroups[0]);
                  if (!compVert) return null;
                  const compConv = convergenceData[compVert.id];
                  const nowMs = Date.now();
                  const windowDays = { "1m": 30, "3m": 90, "6m": 180, "1y": 365 }[timeRange] || 90;
                  const windowMs = windowDays * 86400000;
                  const domainStart = nowMs - windowMs;
                  const domainEnd = nowMs;
                  const windowLabel = timeRange === "1m" ? "Last 30 days" : timeRange === "3m" ? "Last 90 days" : timeRange === "6m" ? "Last 180 days" : "Last 365 days";
                  const domainStartIso = new Date(domainStart).toISOString();
                  const domainEndIso = new Date(domainEnd).toISOString();
                  return (
                    <div style={{ padding: "14px 0" }}>
                      <div style={{ ...font.sans, fontSize: 11, color: C.text, marginBottom: 10, padding: "10px 12px", background: C.white, borderRadius: 8, border: `1px solid ${C.borderLight}`, lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 800, letterSpacing: "0.04em", color: C.textSec }}>SHARED TIMELINE</span>
                        <span style={{ color: C.textMuted, margin: "0 6px" }}>·</span>
                        <strong>{windowLabel}</strong>
                        <span style={{ color: C.textMuted }}> (same as Signal Convergence range selector)</span>
                        <div style={{ ...font.mono, fontSize: 10, color: C.textSec, marginTop: 6 }}>
                          {formatChartDate(domainStartIso)} → {formatChartDate(domainEndIso)}
                        </div>
                        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                          Both columns use this identical X-axis window so sparklines align in calendar time. % values are 3-week change (not axis scale).
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="ec-compare-chart-grid">
                        {[activeVert, compVert].map((v) => {
                          const c = v.id === activeVert.id ? conv : compConv;
                          return (
                            <div key={v.id} style={{ background: C.nested, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.borderLight}`, borderTop: `3px solid ${v.color || C.cyan}`, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                                <span style={{ ...font.sans, fontSize: 13, fontWeight: 700, color: C.text }}>{v.name}</span>
                                <ConvergenceBadge verdict={c?.verdict || "INSUFFICIENT DATA"} />
                              </div>
                              {sourceIds.filter((srcId) => vertHasKeywords(v, srcId)).map((srcId) => {
                                const data = buildChartData(v.id, srcId);
                                const sig = c?.signals?.find((s) => s.srcId === srcId);
                                const dk = data[0]?.value_smooth != null ? "value_smooth" : "value";
                                return (
                                  <div key={srcId} style={{ marginBottom: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                      <span style={{ ...font.sans, fontSize: 10, fontWeight: 600, color: SOURCE_COLORS[srcId] }}>{SOURCE_LABELS[srcId]}</span>
                                      {sig?.chg3w != null && (
                                        <span style={{ ...font.mono, fontSize: 10, fontWeight: 700, color: sig.chg3w >= 0 ? "#059669" : "#dc2626" }} title="Approx. change over last 3 weeks of data — independent of chart time window">
                                          {sig.chg3w >= 0 ? "+" : ""}{sig.chg3w}% <span style={{ ...font.sans, fontWeight: 500, color: C.textMuted }}>3w</span>
                                        </span>
                                      )}
                                    </div>
                                    {data.length >= 2 ? (
                                      <div style={{ height: 78, width: "100%" }}>
                                        <ResponsiveContainer width="100%" height={78}>
                                          <LineChart data={data} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
                                            <XAxis
                                              dataKey="_ts"
                                              type="number"
                                              scale="time"
                                              domain={[domainStart, domainEnd]}
                                              tickFormatter={(ts) => formatChartDateShort(new Date(ts).toISOString())}
                                              tick={{ fontSize: 7, fill: C.textMuted }}
                                              stroke={C.borderLight}
                                              tickLine={false}
                                              axisLine={{ stroke: C.borderLight }}
                                              interval="preserveStartEnd"
                                              minTickGap={28}
                                              height={22}
                                            />
                                            <YAxis hide domain={zoomedYDomain(data.map((d) => d[dk]))} allowDataOverflow />
                                            <Tooltip
                                              contentStyle={{ fontSize: 10, borderRadius: 8, ...font.sans, border: `1px solid ${C.border}` }}
                                              labelFormatter={(ts) => formatChartDate(new Date(ts).toISOString())}
                                              formatter={(val) => [Math.round(Number(val)), SOURCE_LABELS[srcId]]}
                                            />
                                            <Line type="monotone" dataKey={dk} stroke={SOURCE_COLORS[srcId]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                          </LineChart>
                                        </ResponsiveContainer>
                                      </div>
                                    ) : (
                                      <div style={{ height: 78, display: "flex", alignItems: "center", justifyContent: "center", border: `1px dashed ${C.borderLight}`, borderRadius: 6 }}>
                                        <span style={{ ...font.sans, fontSize: 9, color: C.textMuted }}>No data in this window</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })()}
    </Card>
  );
}

function OverlayChart({ selectedKeys, allHistories, sources, verticals }) {
  const [aiNarrative, setAiNarrative] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const narrativeCacheRef = useRef({});

  const labelFor = useCallback((sk) => {
    const parts = sk.split("_");
    const sId = parts.pop();
    const vId = parts.join("_");
    const v = verticals.find(x => x.id === vId) || verticals.find(x => sk.startsWith(x.id));
    const s = sources.find(x => x.id === sId);
    return `${v?.name||vId} · ${s?.name||sId}`;
  }, [verticals, sources]);

  const { data } = useMemo(() => {
    if (selectedKeys.length === 0) return { data: [] };
    const allPoints = [];
    selectedKeys.forEach((sk) => {
      const hist = allHistories[sk] || [];
      const sanitized = sanitizeTimeSeries(hist.map(h => ({ ...h, _ts: new Date(h.isoDate || h.ts).getTime() })).sort((a,b) => a._ts - b._ts), "value");
      sanitized.forEach(h => {
        allPoints.push({ _ts: h._ts, sk, value: h.value });
      });
    });
    allPoints.sort((a,b) => a._ts - b._ts);
    const allTs = [...new Set(allPoints.map(p => p._ts))].sort((a,b)=>a-b);
    const mx = {}, mn = {};
    selectedKeys.forEach(sk => {
      const vals = (allHistories[sk] || []).map(h => h.value);
      mx[sk] = Math.max(1, ...vals);
      mn[sk] = Math.min(0, ...vals);
    });
    const rows = allTs.map(ts => {
      const row = { _ts: ts };
      allPoints.filter(p => p._ts === ts).forEach(p => {
        const range = mx[p.sk] - mn[p.sk];
        row[p.sk] = range > 0 ? Math.round(((p.value - mn[p.sk]) / range) * 100) : 50;
      });
      return row;
    });
    let smoothed = rows;
    if (rows.length >= 4) {
      selectedKeys.forEach(sk => { smoothed = smoothEMA(smoothed, sk, 0.25); });
    }
    return { data: smoothed };
  }, [selectedKeys, allHistories]);

  const divergences = useMemo(() => {
    if (selectedKeys.length < 2 || data.length < 3) return [];
    const results = [];
    for (let i = 0; i < selectedKeys.length; i++) {
      for (let j = i + 1; j < selectedKeys.length; j++) {
        const a = selectedKeys[i], b = selectedKeys[j];
        const aVals = [], bVals = [];
        data.forEach(row => {
          if (row[a] != null && row[b] != null) { aVals.push(row[a]); bVals.push(row[b]); }
        });
        const zResult = computeZScoreDiv(aVals, bVals);
        if (!zResult) continue;
        const corr = pearsonCorr(aVals, bVals);
        const absZ = Math.abs(zResult.z);
        const aLabel = labelFor(a), bLabel = labelFor(b);
        const aShort = aLabel.split("·")[1]?.trim() || aLabel;
        const bShort = bLabel.split("·")[1]?.trim() || bLabel;
        const aRecent = aVals.slice(-3), bRecent = bVals.slice(-3);
        const aDir = aRecent.length >= 2 ? aRecent[aRecent.length-1] - aRecent[0] : 0;
        const bDir = bRecent.length >= 2 ? bRecent[bRecent.length-1] - bRecent[0] : 0;
        const aUp = aDir > 0, bUp = bDir > 0;

        if (absZ >= 1.5) {
          const isOpposite = (aDir > 3 && bDir < -3) || (aDir < -3 && bDir > 3);
          let signal, severity, type;
          if (isOpposite) {
            signal = `${aUp?"↑":"↓"} ${aShort} vs ${bUp?"↑":"↓"} ${bShort} — ${absZ.toFixed(1)}σ divergence (historically correlated r=${corr.toFixed(2)})`;
            severity = C.red; type = "opposing";
          } else if (corr > 0.5 && absZ >= 2.0) {
            signal = `${aShort} + ${bShort} co-movement breaking down — spread at ${absZ.toFixed(1)}σ (historical r=${corr.toFixed(2)})`;
            severity = C.red; type = "breakdown";
          } else {
            signal = `${aShort} vs ${bShort} — spread at ${absZ.toFixed(1)}σ from mean (${zResult.currentDiff > 0 ? "A leading" : "B leading"})`;
            severity = C.amber; type = "spread";
          }
          results.push({ signal, severity, type, z: absZ, corr, aLabel, bLabel, aShort, bShort, aDir, bDir });
        } else if (corr > 0.6 && absZ < 0.5 && Math.abs(aDir) > 5 && Math.abs(bDir) > 5 && aUp === bUp) {
          results.push({
            signal: `${aShort} + ${bShort} — strong co-movement confirmed (r=${corr.toFixed(2)}, both ${aUp?"rising":"falling"})`,
            severity: C.green, type: "confirmation", z: absZ, corr, aLabel, bLabel, aShort, bShort, aDir, bDir
          });
        }
      }
    }
    return results.sort((a, b) => b.z - a.z);
  }, [data, selectedKeys, labelFor]);

  const generateNarrative = useCallback(async () => {
    const apiKey = ENV_KEYS.anthropic;
    if (!apiKey || divergences.length === 0) return;
    const cacheKey = divergences.map(d => d.signal).join("|");
    if (narrativeCacheRef.current[cacheKey]) { setAiNarrative(narrativeCacheRef.current[cacheKey]); return; }
    setAiLoading(true);
    try {
      const ctx = divergences.map(d => `- [${d.type}] ${d.signal}`).join("\n");
      const signalLabels = selectedKeys.map(sk => labelFor(sk)).join(", ");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 800,
          system: "You are a senior quantitative analyst interpreting signal divergences for enterprise AI demand tracking. Be direct and actionable. Write 2-4 short paragraphs. Use specific numbers from the data. End with a clear call-to-action for the investment team.",
          messages: [{ role: "user", content: `Analyze these signal divergences detected across: ${signalLabels}\n\nDivergences:\n${ctx}\n\nInterpret what pattern these divergences reveal about enterprise AI adoption timing. Specifically address: (1) What phase mismatch this indicates (e.g., mandate vs adoption, awareness vs spend), (2) Which signal is likely leading/lagging, (3) What this means for vendor/infrastructure timing over the next 3-6 months.` }],
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = await res.json();
      const text = json.content?.[0]?.text || "No analysis generated.";
      narrativeCacheRef.current[cacheKey] = text;
      setAiNarrative(text);
    } catch (e) { setAiNarrative(`Analysis unavailable: ${e.message}`); }
    setAiLoading(false);
  }, [divergences, selectedKeys, labelFor]);

  if (selectedKeys.length === 0 || data.length === 0) return null;
  const showDots = data.length <= 60;

  return (
    <Card style={{ marginBottom: 20, borderLeft:`4px solid ${C.purple}` }}>
      <SectionHeader icon={<IcoC name="layers" size={18} color={C.purple}/>} title="Signal Divergence Overlay" subtitle="" badge={<Badge color={C.purple} bg={C.purpleBg}>{selectedKeys.length} signals</Badge>}/>
      <div style={{...font.sans,fontSize:10,color:C.textMuted,marginBottom:4}}>{data.length} data points since {formatChartDateShort(new Date(data[0]?._ts).toISOString())}</div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top:8,right:16,bottom:8,left:8 }}>
            <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin","dataMax"]}
              tickFormatter={ts=>formatChartDateShort(new Date(ts).toISOString())}
              tick={{fontSize:9,fill:C.textMuted}} interval="preserveStartEnd" tickCount={6} />
            <YAxis tick={{fontSize:10,fill:C.textMuted}} width={35} domain={[0,100]} label={{value:"Normalized",angle:-90,position:"insideLeft",style:{fontSize:9,fill:C.textMuted}}}/>
            <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}} labelFormatter={ts=>formatChartDate(new Date(ts).toISOString())} formatter={(v)=>[`${v}/100`]}/>
            <Legend wrapperStyle={{fontSize:11,...font.sans}} />
            <ReferenceLine y={50} stroke={C.border} strokeDasharray="4 4" />
            {selectedKeys.map((sk, i) => (
              <Line key={sk} type="monotone" dataKey={data.length >= 4 && data[0]?.[`${sk}_smooth`] != null ? `${sk}_smooth` : sk} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={showDots?{r:3}:false} name={labelFor(sk)} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {divergences.length > 0 && (
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.text,textTransform:"uppercase",letterSpacing:"0.05em"}}>
              Detected Divergences ({divergences.filter(d=>d.type!=="confirmation").length} anomalies, {divergences.filter(d=>d.type==="confirmation").length} confirmations)
            </div>
            {ENV_KEYS.anthropic && divergences.filter(d=>d.type!=="confirmation").length > 0 && (
              <Btn size="sm" variant="ghost" onClick={generateNarrative} disabled={aiLoading}>
                {aiLoading ? "Analyzing..." : "AI Interpret"}
              </Btn>
            )}
          </div>
          {divergences.map((d, i) => (
            <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 12px",background:d.severity+"08",border:`1px solid ${d.severity}22`,borderRadius:8}}>
              <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:d.severity,flexShrink:0,marginTop:4}}/>
              <div style={{flex:1}}>
                <div style={{...font.sans,fontSize:12,color:C.text,lineHeight:1.5}}>{d.signal}</div>
                {d.type === "opposing" && (
                  <div style={{...font.sans,fontSize:10,color:C.textMuted,marginTop:2,fontStyle:"italic"}}>
                    Possible pattern: {d.aDir > 0 ? `${d.aShort} spike → ${d.bShort} lag → watch for budget confirmation` : `${d.bShort} spike → ${d.aShort} lag → watch for budget confirmation`}
                  </div>
                )}
              </div>
              <span style={{...font.mono,fontSize:10,color:d.severity,fontWeight:700,flexShrink:0}}>{d.z.toFixed(1)}σ</span>
            </div>
          ))}
          {aiNarrative && (
            <div style={{marginTop:8,padding:"12px 16px",background:C.purpleBg,border:`1px solid ${C.purple}22`,borderRadius:10}}>
              <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.purple,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>AI Divergence Analysis</div>
              <div style={{...font.sans,fontSize:12,color:C.text,lineHeight:1.65,whiteSpace:"pre-wrap"}}>{aiNarrative}</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Chicago Fed xlsx + FRED — national macro, charts, multi-year history (FRED needs server key). */
function LaborMacroPanel({ onAfterLoad }) {
  const [laborOverview, setLaborOverview] = useState(null);
  const [laborLoad, setLaborLoad] = useState(false);
  const [laborErr, setLaborErr] = useState(null);
  const [fredCat, setFredCat] = useState("labor");
  const [snapTick, setSnapTick] = useState(0);
  const [timeRange, setTimeRange] = useState("5y");
  const onAfterRef = useRef(onAfterLoad);
  useEffect(() => {
    onAfterRef.current = onAfterLoad;
  }, [onAfterLoad]);

  const loadLabor = useCallback(async () => {
    setLaborLoad(true);
    setLaborErr(null);
    try {
      const res = await fetch("/api/labor/overview");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText || "Labor API failed");
      setLaborOverview(j);
      appendLaborMacroSnapshot({
        fetched_at: j.fetched_at,
        chicago_release: j.chicago_fed?.release_date ?? null,
        forecast_u: j.chicago_fed?.forecast_unemployment ?? null,
        official_u3: j.chicago_fed?.official_u3 ?? null,
        jolts: (j.fred_latest || []).find((x) => x.series_id === "JTSJOL")?.value ?? null,
        claims: (j.fred_latest || []).find((x) => x.series_id === "ICSA")?.value ?? null,
      });
      setSnapTick((n) => n + 1);
      onAfterRef.current?.();
    } catch (e) {
      setLaborErr(e.message || String(e));
    } finally {
      setLaborLoad(false);
    }
  }, []);

  useEffect(() => {
    loadLabor();
  }, [loadLabor]);

  const chiTs = laborOverview?.chicago_fed_timeseries || [];
  const fredHist = laborOverview?.fred_histories;
  const fredByCat = useMemo(() => {
    if (!fredHist) return {};
    const by = {};
    for (const [id, pack] of Object.entries(fredHist)) {
      const cat = pack.meta?.category || "other";
      if (!by[cat]) by[cat] = [];
      by[cat].push({ id, meta: pack.meta, observations: pack.observations || [], error: pack.error });
    }
    return by;
  }, [fredHist]);

  const snapHist = useMemo(() => getLaborMacroHistory(), [laborOverview, snapTick]);
  const snapChart = useMemo(
    () => {
      const raw = snapHist.filter((r) => r.ts);
      const byDay = new Map();
      raw.forEach((r) => {
        const dayKey = new Date(r.ts).toISOString().slice(0, 10);
        byDay.set(dayKey, r);
      });
      return Array.from(byDay.values())
        .sort((a, b) => a.ts - b.ts)
        .slice(-120)
        .map((r) => ({
          t: r.ts,
          label: new Date(r.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          forecast_u: r.forecast_u,
          jolts: r.jolts,
        }));
    },
    [snapHist],
  );

  const fredSeriesInCat = fredByCat[fredCat] || [];

  return (
    <Card style={{ borderLeft: `4px solid ${C.amber}`, padding: 0, overflow: "hidden" }} className="fade-in">
      <div style={{ padding: "18px 22px 14px", background: C.white }}>
        <SectionHeader
          icon={<IcoC name="barChart" size={18} color={C.amber} />}
          title="Macro labor & economy (US)"
          subtitle="US labor market indicators and economic context."
          badge={<Badge color={C.amber} bg={C.amber + "18"} size="sm">National</Badge>}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Btn variant="primary" size="sm" onClick={loadLabor} disabled={laborLoad}>
            {laborLoad ? <><Spinner size={12} color="#fff" /> Loading</> : <><IcoC name="refresh" size={12} color="#fff" /> Refresh / backfill history</>}
          </Btn>
          {laborOverview?.chicago_fed?.release_date && (
            <span style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>Chicago Fed row {laborOverview.chicago_fed.release_date}</span>
          )}
          {laborOverview?.fetched_at && (
            <span style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>Pulled {new Date(laborOverview.fetched_at).toLocaleString()}</span>
          )}
        </div>
      </div>
      <div style={{ padding: "0 22px 18px" }}>
        {laborErr && <div style={{ ...font.sans, fontSize: 12, color: C.red, marginBottom: 8 }}>{laborErr}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>

        {laborOverview?.chicago_fed && (()=>{
          const cf = laborOverview.chicago_fed;
          const urVal = cf.forecast_unemployment;
          const urColor = urVal == null ? C.textMuted : urVal < 4.0 ? C.green : urVal < 5.0 ? C.amber : C.red;
          const urLabel = urVal == null ? "" : urVal < 4.0 ? "Tight labor market" : urVal < 4.5 ? "Healthy range" : urVal < 5.0 ? "Softening" : "Elevated — recession watch";
          const layVal = cf.layoffs_separations_rate;
          const layColor = layVal == null ? C.textMuted : layVal < 2.0 ? C.green : layVal < 2.5 ? C.amber : C.red;
          const layLabel = layVal == null ? "" : layVal < 2.0 ? "Below avg — stable" : layVal < 2.5 ? "Normal range" : "Elevated — stress signal";
          const hireVal = cf.hiring_rate_unemployed;
          const hireColor = hireVal == null ? C.textMuted : hireVal > 50 ? C.green : hireVal > 40 ? C.amber : C.red;
          const hireLabel = hireVal == null ? "" : hireVal > 50 ? "Strong hiring" : hireVal > 40 ? "Moderate pace" : "Weak — hiring freeze risk";
          return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 14 }}>
            <div style={{ background: C.nested, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Unemployment nowcast</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <div style={{ ...font.mono, fontSize: 20, fontWeight: 800, color: urColor }}>{urVal != null ? `${urVal}%` : "—"}</div>
                {cf.official_u3 != null && <div style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>vs {cf.official_u3}% BLS</div>}
              </div>
              {urLabel && <div style={{ ...font.sans, fontSize: 9, color: urColor, marginTop: 2 }}>{urLabel}</div>}
              <div style={{ ...font.sans, fontSize: 9, color: C.textMuted, marginTop: 3 }}>The Chicago Fed's real-time estimate of true unemployment, updated weekly (before the official BLS number). Above 4.5% is a warning sign for enterprise AI budgets.</div>
            </div>
            <div style={{ background: C.nested, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Layoffs &amp; separations rate</div>
              <div style={{ ...font.mono, fontSize: 20, fontWeight: 800, color: layColor }}>{layVal != null ? layVal.toFixed(2) : "—"}<span style={{ fontSize: 11, fontWeight: 600 }}>%</span></div>
              {layLabel && <div style={{ ...font.sans, fontSize: 9, color: layColor, marginTop: 2 }}>{layLabel}</div>}
              <div style={{ ...font.sans, fontSize: 9, color: C.textMuted, marginTop: 3 }}>What % of workers left or lost their job this month. When this rises, companies are cutting costs — expect AI procurement to slow 1–2 quarters later.</div>
            </div>
            <div style={{ background: C.nested, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Hiring rate (unemployed)</div>
              <div style={{ ...font.mono, fontSize: 20, fontWeight: 800, color: hireColor }}>{hireVal != null ? hireVal.toFixed(1) : "—"}<span style={{ fontSize: 11, fontWeight: 600 }}>%</span></div>
              {hireLabel && <div style={{ ...font.sans, fontSize: 9, color: hireColor, marginTop: 2 }}>{hireLabel}</div>}
              <div style={{ ...font.sans, fontSize: 9, color: C.textMuted, marginTop: 3 }}>Of all unemployed people, what % got hired this month. Falling = it's getting harder to find work = companies are pulling back on all hiring, including AI roles.</div>
            </div>
          </div>
          );
        })()}

        {laborOverview?.chicago_fed && (()=>{
          const cf = laborOverview.chicago_fed;
          const ur = cf.forecast_unemployment;
          const lay = cf.layoffs_separations_rate;
          const hire = cf.hiring_rate_unemployed;
          const signals = [];
          let regime = "neutral";
          let regimeColor = C.textMuted;
          let regimeLabel = "Mixed / Neutral";
          if (ur != null && lay != null && hire != null) {
            if (ur < 4.2 && lay < 2.1 && hire > 45) { regime = "expansion"; regimeColor = C.green; regimeLabel = "Expansion"; signals.push("Labor market is tight — enterprise budgets are growing, AI hiring should be strong."); }
            else if (ur > 5.0 || (lay > 2.5 && hire < 38)) { regime = "contraction"; regimeColor = C.red; regimeLabel = "Contraction risk"; signals.push("Weakening labor market — expect hiring freezes and slower vendor procurement. Defensive positioning."); }
            else if (ur >= 4.2 && ur <= 5.0) { regime = "softening"; regimeColor = C.amber; regimeLabel = "Late-cycle softening"; signals.push("Labor market cooling — AI budgets may tighten in 1–2 quarters. Watch for divergence: if AI hiring holds up while broad market weakens, that's a bullish signal for AI-specific vendors."); }
          }
          if (ur != null && cf.official_u3 != null && ur > cf.official_u3 + 0.15) signals.push(`Nowcast (${ur}%) is above official BLS (${cf.official_u3}%) — real conditions may be worse than headline data suggests.`);
          if (ur != null && cf.official_u3 != null && ur < cf.official_u3 - 0.15) signals.push(`Nowcast (${ur}%) is below official BLS (${cf.official_u3}%) — conditions may be better than the latest headline.`);
          return signals.length > 0 && (
            <div style={{ marginBottom: 14, padding: "10px 14px", background: regimeColor + "0A", border: `1px solid ${regimeColor}30`, borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: regimeColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>Regime: {regimeLabel}</div>
              </div>
              {signals.map((s, i) => <div key={i} style={{ ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>{s}</div>)}
            </div>
          );
        })()}

        {(()=>{ const filteredChi = filterByTimeRange(chiTs, timeRange, "date"); return filteredChi.length >= 2 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>Chicago Fed — unemployment nowcast vs official U-3 ({filteredChi.length} weekly points)</div>
            <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginBottom: 6, lineHeight: 1.4 }}>Brown = real-time nowcast. Blue = official BLS U-3.</div>
            <div style={{ height: 240, width: "100%" }}>
              <ResponsiveContainer>
                <LineChart data={filteredChi} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: C.textMuted }} interval="preserveStartEnd" tickCount={8} />
                  <YAxis tick={{ fontSize: 9, fill: C.textMuted }} width={36} domain={["auto", "auto"]} />
                  <ReferenceLine y={4.5} stroke={C.textMuted} strokeDasharray="4 4" strokeWidth={1} label={{ value: "~Natural rate", position: "right", style: { fontSize: 8, fill: C.textMuted } }} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="official_u3" name="Official U-3" stroke={C.blue} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="forecast_unemployment" name="Nowcast (50th)" stroke={C.amber} strokeWidth={2.5} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, margin: "14px 0 6px" }}>Chicago Fed — layoffs / separations vs hiring (unemployed)</div>
            <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginBottom: 4, lineHeight: 1.4 }}>Red (left axis) = layoffs rate. Green (right axis) = hiring rate.</div>
            <div style={{ height: 220, width: "100%" }}>
              <ResponsiveContainer>
                <LineChart data={filteredChi} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: C.textMuted }} interval="preserveStartEnd" />
                  <YAxis yAxisId="layoffs" tick={{ fontSize: 9, fill: C.red }} width={40} domain={["auto", "auto"]} label={{ value: "Layoffs %", angle: -90, position: "insideLeft", style: { fontSize: 9, fill: C.red } }} />
                  <YAxis yAxisId="hiring" orientation="right" tick={{ fontSize: 9, fill: C.green }} width={40} domain={["auto", "auto"]} label={{ value: "Hiring rate", angle: 90, position: "insideRight", style: { fontSize: 9, fill: C.green } }} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line yAxisId="layoffs" type="monotone" dataKey="layoffs_separations_rate" name="Layoffs & sep. rate" stroke={C.red} strokeWidth={2} dot={false} connectNulls />
                  <Line yAxisId="hiring" type="monotone" dataKey="hiring_rate_unemployed" name="Hiring rate (U)" stroke={C.green} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );})()}

        {(()=>{const filteredSnap=filterByTimeRange(snapChart.map(d=>({...d,_iso:new Date(d.t).toISOString()})), timeRange, "_iso");return filteredSnap.length >= 2 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>Refresh snapshots</div>
            <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6 }}>Left axis: nowcast %. Right axis: JOLTS openings (thousands).</div>
            <div style={{ height: 160, width: "100%" }}>
              <ResponsiveContainer>
                <LineChart data={filteredSnap} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 8, fill: C.textMuted }} interval="preserveStartEnd" />
                  <YAxis yAxisId="l" tick={{ fontSize: 9, fill: C.textMuted }} width={32} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: C.textMuted }} width={40} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line yAxisId="l" type="monotone" dataKey="forecast_u" name="Nowcast %" stroke={C.amber} strokeWidth={2} dot connectNulls />
                  <Line yAxisId="r" type="monotone" dataKey="jolts" name="JOLTS openings" stroke={C.cyan} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );})()}

        {fredHist && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>FRED — history by theme (multi-year per series)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {LABOR_FRED_CAT_ORDER.filter((c) => (fredByCat[c] || []).length > 0).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFredCat(c)}
                  style={{
                    ...font.sans,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: `1px solid ${fredCat === c ? C.amber : C.border}`,
                    background: fredCat === c ? C.amberBg : C.white,
                    color: C.text,
                    cursor: "pointer",
                  }}
                >
                  {LABOR_FRED_CAT_LABEL[c] || c}
                </button>
              ))}
            </div>
            {LABOR_FRED_CAT_EXPLAIN[fredCat] && (
              <div style={{ ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.55, marginBottom: 12, padding: "8px 12px", background: C.nested, borderRadius: 8, border: `1px solid ${C.borderLight}` }}>
                {LABOR_FRED_CAT_EXPLAIN[fredCat]}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
              {fredSeriesInCat.map((s, idx) => {
                const col = PALETTE[idx % PALETTE.length];
                const dataAll = (s.observations || []).map((o) => ({ date: o.date, v: o.value }));
                const data = filterByTimeRange(dataAll, timeRange, "date");
                const explain = FRED_SERIES_EXPLAIN[s.id];
                if (s.error) {
                  const friendlyErr = s.error.includes("429") || s.error.includes("Rate Limit") ? "Rate limited — will retry on next refresh"
                    : s.error.includes("does not exist") ? "Series discontinued by FRED"
                    : s.error.includes("400") ? "Temporarily unavailable"
                    : "Fetch failed — will retry";
                  return (
                    <div key={s.id} style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.borderLight}`, background: C.nested }}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{s.meta?.name || s.id}</div>
                      <div style={{ fontSize: 10, color: C.amber }}>{friendlyErr}</div>
                    </div>
                  );
                }
                if (data.length < 2) {
                  return (
                    <div key={s.id} style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.borderLight}`, background: C.nested }}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{s.meta?.name || s.id}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>Not enough points</div>
                    </div>
                  );
                }
                const vals = data.map((d) => d.v).filter((v) => v != null && !isNaN(v)).sort((a, b) => a - b);
                let yDomain = ["auto", "auto"];
                let clamped = false;
                if (vals.length >= 10) {
                  const q1 = vals[Math.floor(vals.length * 0.25)];
                  const q3 = vals[Math.floor(vals.length * 0.75)];
                  const iqr = q3 - q1;
                  const lo = q1 - 3.0 * iqr;
                  const hi = q3 + 3.0 * iqr;
                  const outliers = vals.filter((v) => v < lo || v > hi);
                  if (outliers.length > 0 && outliers.length < vals.length * 0.15) {
                    const clampedVals = vals.filter((v) => v >= lo && v <= hi);
                    const cMin = clampedVals[0];
                    const cMax = clampedVals[clampedVals.length - 1];
                    const pad = (cMax - cMin) * 0.08;
                    yDomain = [Math.floor(cMin - pad), Math.ceil(cMax + pad)];
                    clamped = true;
                  }
                }
                return (
                  <div key={s.id} style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.borderLight}`, background: C.white }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 2 }}>{s.meta?.name || s.id}</div>
                    <div style={{ fontSize: 9, color: C.textMuted, fontFamily: font.mono.fontFamily, marginBottom: explain ? 2 : 6 }}>
                      {s.id}{clamped ? <span style={{ marginLeft: 6, color: C.amber }} title="Outlier spike (e.g. COVID) clipped for readability — actual peak is higher">⚠ outlier clipped</span> : null}
                    </div>
                    {explain && <div style={{ ...font.sans, fontSize: 9.5, color: C.textSec, lineHeight: 1.45, marginBottom: 6 }}>{explain}</div>}
                    <div style={{ height: 120, width: "100%" }}>
                      <ResponsiveContainer>
                        <LineChart data={data} margin={{ top: 2, right: 4, left: -18, bottom: 0 }}>
                          <XAxis dataKey="date" tick={{ fontSize: 8, fill: C.textMuted }} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 8, fill: C.textMuted }} width={44} domain={yDomain} allowDataOverflow={clamped} />
                          <Tooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} formatter={(v) => [v, ""]} />
                          <Line type="monotone" dataKey="v" stroke={col} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {laborOverview?.fred_latest?.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 6 }}>FRED — latest values</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 160, overflowY: "auto", padding: 4, background: C.nested, borderRadius: 10 }}>
              {laborOverview.fred_latest
                .filter((x) => !x.error)
                .map((x) => (
                  <span key={x.series_id} title={FRED_SERIES_EXPLAIN[x.series_id] || x.series_id} style={{ ...font.sans, fontSize: 10, padding: "4px 8px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "help" }}>
                    <b>{x.series_id}</b> {x.value != null ? x.value : "—"}{" "}
                    <span style={{ color: C.textMuted }}>({x.date || "—"})</span>
                  </span>
                ))}
            </div>
          </div>
        )}

        {laborOverview?.source_notes?.length > 0 && (
          <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginTop: 12, lineHeight: 1.5 }}>
            {laborOverview.source_notes.map((n, i) => (
              <div key={i}>• {n}</div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── SIGNAL PANEL (redesigned) ────────────────────────────────────────────────

function SignalPanel({ source, verticals, signalResults, loading, errors, onFetch, onUpdateKeywords, overlaySelected, onToggleOverlay, tsHistoryByVertical, historyProgress, onBackfillHistory, onBackfillSignal, demoTheirStack, onEditGroup }) {
  const [expandedVert, setExpandedVert] = useState(null);
  const [showChart, setShowChart] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [histSeedVer, setHistSeedVer] = useState(0);

  // Auto-seed mock history for TheirStack when history is sparse.
  // Runs for both demo mode and real-key-exhausted mode so the Growth Trend chart always has data.
  useEffect(() => {
    if (source.id !== "theirstack") return;
    let seeded = false;
    verticals.forEach(v => {
      const key = `${v.id}_${source.id}`;
      const existing = getSignalHistory(key);
      if (existing.length >= 40) return;
      const weeks = weekIntervals(78, new Date());
      const points = [];
      weeks.forEach(w => {
        const count = mockTheirStackCountForRange(v, w.gte, w.lte);
        const ts = new Date(w.lte + "T12:00:00Z").getTime();
        points.push({ ts, isoDate: new Date(ts).toISOString(), value: count, date: w.key });
      });
      const merged = [...existing];
      points.forEach(p => {
        if (!merged.some(x => Math.abs(x.ts - p.ts) < 86400000 * 3)) merged.push(p);
      });
      merged.sort((a, b) => a.ts - b.ts);
      if (merged.length > 500) merged.splice(0, merged.length - 500);
      sv(`hist_${key}`, merged);
      seeded = true;
    });
    if (seeded) setHistSeedVer(v => v + 1);
  }, [source.id, verticals]);
  const kwLabel = { titleKeywords:"Title keywords", descriptionKeywords:"Description keywords", keywords:"Search query" };
  const info = SOURCE_INFO[source.id];
  const iconMap = {theirstack:"briefcase",google_trends:"trendUp",github_repos:"code",claude_attrib:"bot"};
  const iconName = iconMap[source.id] || "activity";

  /** Summing counts across tracking groups only where it is meaningful (not Claude / not Trends index). */
  const headerSumExcluded = source.id === "claude_attrib" || source.id === "google_trends";
  const aggregateCount = headerSumExcluded
    ? null
    : verticals.reduce((sum, v) => {
        const res = signalResults[`${v.id}_${source.id}`];
        return sum + (res?.count || 0);
      }, 0);

  return (
    <Card style={{ padding:0, overflow:"hidden" }} className="signal-section fade-in-slow">
      {/* Header */}
      <div style={{ padding:"18px 22px 14px", background:C.white }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <IcoC name={iconName} size={22} color={C.cyan}/>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <h3 style={{...font.sans,fontSize:16,fontWeight:700,color:C.text,margin:0,letterSpacing:"-0.02em"}}>{source.name}</h3>
                <Badge color={source.enabled?C.green:C.textMuted} bg={source.enabled?C.greenBg:C.nested} size="sm">{source.enabled?"Live":"Off"}</Badge>
                <Badge color={C.textMuted} size="sm">{source.cadence}</Badge>
                {demoTheirStack && <Badge color={C.cyan} bg={C.cyanBg} size="sm" title="Demo mode — simulated data">Demo</Badge>}
              </div>
              <div style={{ ...font.sans, fontSize: 11, color: C.textSec, marginTop: 8, maxWidth: 720, lineHeight: 1.5 }}>
                <strong style={{ color: C.text }}>Metric:</strong> {SOURCE_METRIC_BLURB[source.id] || "See methodology."}
                {source.id === "claude_attrib" && (
                  <span> <strong style={{ color: C.text }}>Groups are independent</strong> — the header no longer sums them. Sharp moves usually reflect GitHub search windows, indexing, and activity spikes, not a broken dashboard.</span>
                )}
                {source.id === "google_trends" && (
                  <span> <strong style={{ color: C.text }}>Header does not sum groups</strong> — each row is its own 0–100 series.</span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0, maxWidth: 280 }}>
            {!headerSumExcluded && aggregateCount > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ ...font.sans, fontSize: 10, fontWeight: 600, color: C.textMuted, textAlign: "right" }}>Sum of groups</span>
                <span style={{ ...font.mono, fontSize: 22, fontWeight: 800, color: C.cyan }}>{aggregateCount.toLocaleString()}</span>
              </div>
            )}
            {headerSumExcluded && (
              <div style={{ ...font.sans, fontSize: 10, fontWeight: 600, color: C.textMuted, textAlign: "right", lineHeight: 1.4 }}>
                {source.id === "claude_attrib"
                  ? "Counts are per tracking group only — not added here."
                  : "Index is per group — not added here."}
              </div>
            )}
            <Btn variant="primary" size="sm" onClick={()=>onFetch(source.id)} disabled={!source.enabled||Object.values(loading).some(Boolean)}>
              {loading[source.id]?<><Spinner size={12} color="#fff"/> Fetching</>:"Refresh"}
            </Btn>
          </div>
        </div>

        {info&&(
          <Expandable title="Methodology">
            <div style={{padding:"10px 14px",background:C.white,borderRadius:10,border:`1px solid ${C.borderLight}`,display:"flex",flexDirection:"column",gap:10}}>
              <div style={{fontSize:12,color:C.textSec,lineHeight:1.6}}>{info.how}</div>
              {info.leadLag&&(
                <div style={{fontSize:12,lineHeight:1.6,padding:"10px 12px",background:C.cyanBg,borderRadius:8,border:`1px solid ${C.cyan}22`,color:C.text}}>
                  <span style={{fontWeight:700,color:C.cyan,display:"block",marginBottom:2}}>Lead/Lag Timing</span>{info.leadLag}
                </div>
              )}
              <div style={{fontSize:12,color:C.amber,lineHeight:1.6,padding:"10px 12px",background:C.amberBg,borderRadius:8,border:`1px solid ${C.amber}22`}}>
                <span style={{fontWeight:700,display:"block",marginBottom:2}}>Investment Implication</span>{info.investment}
              </div>
            </div>
          </Expandable>
        )}
        
      </div>

      {/* Vertical rows */}
      <div>
        {verticals.map((v, vi) => {
          const key=`${v.id}_${source.id}`, res=signalResults[key], err=errors[key], isL=loading[key], kw=v.keywords?.[source.id]||{};
          const isExp=expandedVert===v.id, isChart=showChart===v.id;
          const isOverlay = overlaySelected.includes(key);
          const tsHist = tsHistoryByVertical?.[v.id];
          const hist = getSignalHistory(key);
          const prevVal = hist.length >= 2 ? hist[hist.length-2].value : null;
          const rawTrend = prevVal && res?.count ? Math.round(((res.count - prevVal)/Math.max(prevVal,1))*100) : null;
          const trend = (source.id === "theirstack" && rawTrend != null && Math.abs(rawTrend) > 15) ? null : rawTrend;

          return (
            <div key={v.id} style={{borderTop: vi===0?`1px solid ${C.border}`:`1px solid ${C.borderLight}`}}>
              {/* Main row */}
              <div style={{padding:"14px 22px",display:"flex",alignItems:"center",gap:16,transition:"background .15s",cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.nested} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                onClick={()=>setExpandedVert(isExp?null:v.id)}>

                {/* Checkbox */}
                <input type="checkbox" checked={isOverlay} onChange={e=>{e.stopPropagation();onToggleOverlay(key);}} title="Compare in overlay" style={{cursor:"pointer",accentColor:C.cyan,width:16,height:16}} />

                {/* Vertical name */}
                <div style={{width:140,flexShrink:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{display:"inline-block",width:10,height:10,borderRadius:"50%",background:v.color||C.cyan,flexShrink:0}}/>
                    <span style={{...font.sans,fontSize:14,fontWeight:600,color:C.text}}>{v.name}</span>
                  </div>
                </div>

                {/* Big metric value */}
                <div style={{width:120,textAlign:"center",flexShrink:0}}>
                  {isL ? <Spinner size={18}/> :
                   err ? <Badge color={C.red} bg={C.redBg} size="sm" title={err}>{err.length > 42 ? `${err.slice(0, 39)}…` : err}</Badge> :
                   res ? <div>
                     <div style={{...font.mono,fontSize:22,fontWeight:800,color:C.text,letterSpacing:"-0.03em"}}>{(res.count||0).toLocaleString()}</div>
                     {source.id==="claude_attrib"&&<div style={{...font.sans,fontSize:9,color:C.textMuted,marginTop:2,lineHeight:1.25,maxWidth:118,marginLeft:"auto",marginRight:"auto"}} title="GitHub Code Search commits: total_count for this tracking group’s query only (~7d committer window on Refresh).">GitHub total_count · ~7d</div>}
                     {source.id==="google_trends"&&<div style={{...font.sans,fontSize:9,color:C.textMuted,marginTop:2,lineHeight:1.25,maxWidth:118,marginLeft:"auto",marginRight:"auto"}} title="Normalized interest vs that keyword’s peak in the chart window — not search volume.">Trends index 0–100</div>}
                     {trend!=null&&<Badge color={trend>=0?C.green:C.red} bg={trend>=0?C.greenBg:C.redBg} size="sm" title={source.id==="claude_attrib"?"Compared to the previous stored history point (often weekly). Can disagree with the ~7d headline right after Refresh.":undefined}>{trend>=0?"+":""}{trend}%</Badge>}
                     {source.id==="github_repos"&&res.count>100000&&<div style={{...font.sans,fontSize:9,color:C.amber,marginTop:2}} title="Very high count suggests keywords are too broad. Add more specific terms.">⚠ keywords may be too broad</div>}
                   </div> :
                   <span style={{color:C.textMuted,fontSize:13}}>No data</span>}
                </div>

                {/* Classification stage */}
                <div style={{width:100,textAlign:"center",flexShrink:0}}>
                  {res?.classification?.dominantStage ? (
                    <Badge color={res.classification.dominantStage.color} bg={res.classification.dominantStage.color+"18"} size="lg">{res.classification.dominantStage.name}</Badge>
                  ) : <span style={{color:C.textMuted,fontSize:12}}>—</span>}
                </div>

                {/* Sparkline — all data points, zoomed Y */}
                <div style={{flex:1,minWidth:80,maxWidth:200}}>
                  {hist.length>=2 ? (
                    <div style={{height:36}}>
                      {(()=>{const sd0=sanitizeTimeSeries(hist.map(p=>({...p,_ts:new Date(p.isoDate||p.ts).getTime()})).sort((a,b)=>a._ts-b._ts),"value");const sd=sd0.length>=4?smoothEMA(sd0,"value",0.15):sd0;const dk=sd0.length>=4?"value_smooth":"value";const yd=zoomedYDomain(sd.map(d=>d[dk]));return(
                      <ResponsiveContainer><LineChart data={sd} margin={{top:2,right:2,bottom:2,left:2}}>
                        <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin","dataMax"]} hide />
                        <YAxis hide domain={yd} allowDataOverflow={true} />
                        <Line type="monotone" dataKey={dk} stroke={v.color||C.cyan} strokeWidth={2} dot={false}/>
                      </LineChart></ResponsiveContainer>);})()}
                    </div>
                  ) : hist.length===1 ? (
                    <div style={{height:36,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:10,color:C.textMuted}}>1 point — chart after next refresh</span></div>
                  ) : <div style={{height:36,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:10,color:C.textMuted}}>No history</span></div>}
                </div>

                {/* Actions */}
                <div style={{display:"flex",gap:4,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                  {source.id === "theirstack" && !demoTheirStack && !tsHist?.monthly?.length && (
                    <Btn variant="default" size="sm" onClick={()=>onBackfillHistory?.(v.id)} disabled={historyProgress?.active} title="Backfill TheirStack history from 2021">
                      <IcoC name="layers" size={13} color={C.textSec}/> Backfill Jobs
                    </Btn>
                  )}
                  {(source.id === "google_trends" || source.id === "claude_attrib") && (
                    <Btn variant="default" size="sm" onClick={()=>onBackfillSignal?.(v.id, source.id)} disabled={historyProgress?.active} title={source.id === "google_trends" ? "Backfill ~12 months of Google Trends (needs SerpAPI key)" : "Rebuild history: weekly Claude commit counts"}>
                      <IcoC name="layers" size={13} color={C.textSec}/> Backfill
                    </Btn>
                  )}
                  <Btn variant={isChart?"primary":"ghost"} size="sm" onClick={()=>setShowChart(isChart?null:v.id)} title="Growth chart"><IcoC name="barChart" size={13} color={isChart?"#fff":C.textSec}/></Btn>
                  <Btn variant="ghost" size="sm" onClick={()=>onFetch(source.id,v.id)} disabled={isL} title="Refresh this group">{isL?<Spinner size={11}/>:<IcoC name="refresh" size={13} color={C.textSec}/>}</Btn>
                </div>

                {/* Expand indicator */}
                <span style={{fontSize:12,color:C.textMuted,transition:"transform .2s",transform:isExp?"rotate(180deg)":"rotate(0)"}}>▾</span>
              </div>

              {/* Expanded: chart */}
              {isChart&&(
                <div className="fade-in" style={{padding:"8px 22px 16px",background:C.nested,borderTop:`1px solid ${C.borderLight}`}}>
                  <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:6}}>Growth Trend — {v.name}</div>
                  <SignalHistoryChart key={`${key}_${histSeedVer}`} signalKey={key} color={v.color||C.cyan} label={source.name} sourceId={source.id} />
                  {source.id === "theirstack" && !demoTheirStack && tsHist?.weekly?.length >= 4 && (
                    <div style={{marginTop:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>Weekly Historical ({tsHist.weekly.length} weeks)</div>
                        {tsHist.derived && <div style={{display:"flex",gap:8}}>
                          {tsHist.derived.velocitySlope != null && <Badge color={tsHist.derived.velocitySlope > 0 ? C.green : C.red} bg={tsHist.derived.velocitySlope > 0 ? C.greenBg : C.redBg} size="sm">Velocity: {tsHist.derived.velocitySlope > 0 ? "+" : ""}{tsHist.derived.velocitySlope.toFixed(1)}</Badge>}
                          {tsHist.derived.anomalyZ != null && Math.abs(tsHist.derived.anomalyZ) > 1.5 && <Badge color={C.amber} bg={C.amberBg} size="sm">Z: {tsHist.derived.anomalyZ.toFixed(1)}</Badge>}
                        </div>}
                      </div>
                      <div style={{height:120}}>
                        {(()=>{const wdSan=sanitizeTimeSeries(tsHist.weekly,"count");const wd=wdSan.length>=4?smoothEMA(wdSan,"count",0.2):wdSan;const yd=zoomedYDomain(wd.map(w=>w.count_smooth??w.count));return(
                        <ResponsiveContainer>
                          <ComposedChart data={wd} margin={{top:4,right:8,bottom:4,left:4}}>
                            <XAxis dataKey="week" tick={{fontSize:9,fill:C.textMuted}} interval="preserveStartEnd" />
                            <YAxis tick={{fontSize:9,fill:C.textMuted}} width={50} domain={yd} allowDataOverflow={true} />
                            <Tooltip contentStyle={{fontSize:11,borderRadius:8}} />
                            <Bar dataKey="count" fill={v.color || C.cyan} opacity={0.3} radius={[2,2,0,0]} />
                            <Line type="monotone" dataKey={wd.length>=4?"count_smooth":"count"} stroke={v.color || C.cyan} strokeWidth={2} dot={false} />
                          </ComposedChart>
                        </ResponsiveContainer>);})()}
                      </div>
                      {!tsHist.monthly?.length && (
                        <div style={{marginTop:8,textAlign:"center"}}>
                          <Btn size="sm" variant="default" onClick={()=>onBackfillHistory?.(v.id)} disabled={historyProgress?.active}>
                            <IcoC name="layers" size={12} color={C.textSec}/> Backfill Full History (2021+)
                          </Btn>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Expanded: keywords + items */}
              {isExp && (
                <div className="fade-in" style={{padding:"12px 22px 16px",background:C.nested,borderTop:`1px solid ${C.borderLight}`}}>
                  {/* Keywords (read-only — edit via group bar above) */}
                  <div style={{marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <span style={{...font.sans,fontSize:11,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Active Keywords</span>
                      <button onClick={()=>onEditGroup?.(v.id)} style={{...font.sans,fontSize:10,fontWeight:600,color:C.cyan,background:"none",border:"none",cursor:"pointer",textDecoration:"underline",padding:0}}>Edit in group bar</button>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {Object.entries(kw).flatMap(([,vals])=>(Array.isArray(vals)?vals:[vals]).filter(Boolean)).map((kw2,i)=>(
                        <span key={i} style={{...font.sans,fontSize:11,padding:"3px 10px",borderRadius:6,background:C.white,border:`1px solid ${C.borderLight}`,color:C.textSec}}>{kw2}</span>
                      ))}
                      {Object.entries(kw).flatMap(([,vals])=>(Array.isArray(vals)?vals:[vals]).filter(Boolean)).length===0&&(
                        <span style={{...font.sans,fontSize:11,color:C.textMuted,fontStyle:"italic"}}>No keywords set</span>
                      )}
                    </div>
                  </div>

                  {/* GitHub/Claude diagnostic */}
                  {(source.id === "github_repos" || source.id === "claude_attrib") && (
                    <div style={{ marginBottom: 12, padding: "10px 14px", background: C.white, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
                      <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                        {source.id === "github_repos" ? "GitHub Search" : "Claude Attribution"} Diagnostics
                      </div>
                      {(() => {
                        const kwArr = Array.isArray(kw.keywords) ? kw.keywords.filter(Boolean) : [];
                        if (kwArr.length === 0 && source.id === "github_repos") return (
                          <div style={{ ...font.sans, fontSize: 11, color: C.red, lineHeight: 1.5 }}>
                            <strong>No keywords configured.</strong> Add keywords above to get results.
                          </div>
                        );
                        const queryPreview = source.id === "github_repos"
                          ? kwArr.map(k => k.includes(" ") ? `"${k}"` : k).join("+") + "+pushed:YYYY-MM-DD..YYYY-MM-DD"
                          : kwArr.length > 0
                            ? `"Co-Authored-By: Claude"+${kwArr.map(k => k.includes(" ") ? `"${k}"` : k).join("+")}+committer-date:YYYY-MM-DD..YYYY-MM-DD`
                            : `"Co-Authored-By: Claude"+committer-date:YYYY-MM-DD..YYYY-MM-DD`;
                        return (
                          <div>
                            <div style={{ ...font.sans, fontSize: 11, color: C.textSec, marginBottom: 4 }}>
                              <strong>Query preview:</strong>
                            </div>
                            <code style={{ ...font.mono, fontSize: 10, color: C.cyan, display: "block", padding: "6px 10px", background: C.nested, borderRadius: 6, wordBreak: "break-all", lineHeight: 1.5 }}>
                              {queryPreview}
                            </code>
                            {source.id === "github_repos" && res?.count > 100000 && (
                              <div style={{ ...font.sans, fontSize: 11, color: C.amber, marginTop: 6, lineHeight: 1.5 }}>
                                <strong>⚠ High count ({(res.count || 0).toLocaleString()}).</strong> Consider more specific keywords.
                              </div>
                            )}
                            <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>
                              {source.id === "github_repos"
                                ? "Repository search hit count for your terms in the pushed-date range — this tracking group only."
                                : kwArr.length > 0
                                  ? "Commit search: GitHub total_count matching the co-author signature and your keywords in the rolling committer-date window. This group only — counts are not added across groups."
                                  : "Commit search: GitHub total_count matching the signature only (~7d on Refresh; weekly points in history). Large global-scale number; volatility is normal (indexing, bursts, window changes). This group only — not summed with other groups."}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Items list */}
                  {res?.items?.length>0 && (
                    <div>
                      <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Latest Results ({res.items.length})</div>
                      <div style={{maxHeight:220,overflowY:"auto",borderRadius:10,border:`1px solid ${C.borderLight}`,background:C.white}}>
                        {res.items.map((item,i)=>(<div key={i} style={{padding:"10px 14px",borderBottom:i<res.items.length-1?`1px solid ${C.borderLight}`:"none",display:"flex",alignItems:"flex-start",gap:10}}>
                          {item.classification&&<span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:item.classification.stageColor||C.textMuted,marginTop:5,flexShrink:0}}/>}
                          <div style={{flex:1,minWidth:0}}><div style={{...font.sans,fontSize:13,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>{item.body&&<div style={{...font.sans,color:C.textMuted,fontSize:12,marginTop:2,lineHeight:1.4}}>{item.body.slice(0,180)}</div>}</div>
                          {item.classification?.matched&&<Badge color={item.classification.stageColor||C.textMuted} size="sm">{item.classification.stageName}</Badge>}
                        </div>))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── HUGGING FACE LEADERBOARD ─────────────────────────────────────────────────

const HF_ORGS = [
  {id:"meta-llama",name:"Meta (Llama)",color:"#0668E1"},{id:"google",name:"Google",color:"#4285F4"},
  {id:"microsoft",name:"Microsoft",color:"#00A4EF"},{id:"openai",name:"OpenAI",color:"#10A37F"},
  {id:"amazon",name:"Amazon",color:"#FF9900"},{id:"mistralai",name:"Mistral AI",color:"#F54E42"},
  {id:"Qwen",name:"Qwen (Alibaba)",color:"#FF6A00"},{id:"deepseek-ai",name:"DeepSeek",color:"#5B6AE0"},
  {id:"nvidia",name:"NVIDIA",color:"#76B900"},{id:"stabilityai",name:"Stability AI",color:"#8B5CF6"},
  {id:"EleutherAI",name:"EleutherAI",color:"#059669"},{id:"bigscience",name:"BigScience",color:"#0891B2"},
];

function fmtDL(n){ return n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(0)}K`:String(n); }

function HuggingFaceLeaderboard({onDataChanged}) {
  const [data,setData]=useState(()=>ld("hf_lb",null));
  const [hfHist,setHfHist]=useState(()=>getHFHistory());
  const [isL,setIsL]=useState(false);
  const [err,setErr]=useState(null);
  const [expanded,setExpanded]=useState(null);
  const [hfRange,setHfRange]=useState("3m");
  const [compareA,setCompareA]=useState(null);
  const [compareB,setCompareB]=useState(null);

  const doFetch=useCallback(async()=>{
    setIsL(true);setErr(null);
    try{
      const results=[];
      for(const org of HF_ORGS){try{const r=await fetch(`https://huggingface.co/api/models?author=${org.id}&sort=downloads&direction=-1&limit=10`);if(!r.ok)throw 0;const models=await r.json();results.push({orgId:org.id,totalDownloads:models.reduce((s,m)=>s+(m.downloads||0),0),modelCount:models.length,topModels:models.slice(0,5).map(m=>({id:m.id||m.modelId,downloads:m.downloads||0,likes:m.likes||0,pipeline:m.pipeline_tag||""}))});}catch{results.push({orgId:org.id,totalDownloads:0,modelCount:0,topModels:[]});}await sleep(200);}
      results.sort((a,b)=>b.totalDownloads-a.totalDownloads);
      const payload={orgs:results,timestamp:Date.now()};
      setData(payload);sv("hf_lb",payload);
      const nh = appendHFHistory(results);
      setHfHist(nh);
      const totalDl = results.reduce((s, o) => s + (o.totalDownloads || 0), 0);
      appendSignalHistory("hf_total", totalDl);
      if(onDataChanged)onDataChanged();
    }catch(e){setErr(e.message);}
    setIsL(false);
  },[onDataChanged]);

  useEffect(()=>{if(!data||!data.timestamp||(Date.now()-data.timestamp)>6*3600000)doFetch();},[]);

  const orgs=data?.orgs||[]; const maxDl=orgs.length>0?Math.max(...orgs.map(o=>o.totalDownloads)):1;
  const top3=orgs.slice(0,3);

  return (
    <Card style={{padding:0,overflow:"hidden"}} className="fade-in-slow">
      <div style={{padding:"18px 22px 14px",background:C.white}}>
        <SectionHeader icon={<IcoC name="database" size={18} color={C.blue}/>} title="Hugging Face Leaderboard" subtitle={'Hub API download totals (top 10 models per org)—an open-source adoption proxy, not model benchmark accuracy. Hub aggregates file-access counts on its servers (see HF Hub docs: Models download stats); this dashboard re-fetches if your snapshot is older than 6 hours.'}
          badge={<Badge color={C.green} bg={C.greenBg} size="sm">Public API</Badge>}
          right={<>
            {data?.timestamp&&<span style={{...font.sans,fontSize:11,color:C.textMuted}}>{timeAgo(data.timestamp)}</span>}
            <Btn variant="primary" size="sm" onClick={doFetch} disabled={isL}>{isL?<><Spinner size={12} color="#fff"/> Fetching</>:"Refresh"}</Btn>
          </>}
        />
        <Expandable title="Show lead/lag timing & signal interpretation guide">
          <div style={{padding:"10px 14px",background:C.white,borderRadius:10,border:`1px solid ${C.borderLight}`,display:"flex",flexDirection:"column",gap:8}}>
            <div style={{fontSize:12,lineHeight:1.6,padding:"10px 12px",background:C.cyanBg,borderRadius:8,border:`1px solid ${C.cyan}22`,color:C.text}}>
              <span style={{fontWeight:700,color:C.cyan,display:"block",marginBottom:2}}>Lead/Lag: 3–9 months</span>
              Hugging Face downloads track developer experimentation and early production deployment of open-source models. Enterprise deployment follows 1–3 quarters after download surges, as companies move from testing to production. Cloud providers embedding HF models (Azure AI Foundry: 1.7M+ models, Google Cloud CDN: 2M+ models) compress this lag.
            </div>
            <div style={{fontSize:11.5,lineHeight:1.6,padding:"10px 12px",background:C.nested,borderRadius:8,border:`1px solid ${C.border}`,color:C.textSec}}>
              <span style={{fontWeight:700,color:C.text,display:"block",marginBottom:4}}>What this measures (not “model accuracy”)</span>
              Numbers come from Hugging Face’s public <span style={{...font.mono,fontSize:10,color:C.text}}>/api/models</span> field <span style={{...font.mono,fontSize:10,color:C.text}}>downloads</span>, summed for each org’s ten most-downloaded models. Hub defines a download as certain server-side file requests (config weights, library-specific rules, GGUF, etc.—documented under Hub{' '}
              <a href="https://huggingface.co/docs/hub/models-download-stats" target="_blank" rel="noopener noreferrer" style={{color:C.cyan,fontWeight:700}}>Models download stats</a>). That makes this a <strong style={{color:C.text}}>popularity / adoption proxy</strong>: it can miss traffic that bypasses counted files, double-count different access patterns, and it is <strong style={{color:C.text}}>not</strong> accuracy on benchmarks or real enterprise attach. Charts over time use <strong style={{color:C.text}}>snapshots stored in this app</strong> when you open the page or click Refresh—the Hub API does not expose public per-day download history for these totals. <strong style={{color:C.text}}>Update cadence:</strong> this UI auto-refetches if the last snapshot is &gt;6 hours old; Hugging Face refreshes its published counters on a backend schedule (rolling “recent period” style stats on model pages, not real-time tick-by-tick).
            </div>
            <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.text,textTransform:"uppercase",letterSpacing:"0.05em",marginTop:4}}>What Movements Mean</div>
            <div style={{padding:"8px 12px",background:C.green+"06",border:`1px solid ${C.green}18`,borderRadius:8}}>
              <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:3}}>Download leader changes position</div>
              <div style={{...font.sans,fontSize:11.5,color:C.textSec,lineHeight:1.55,marginBottom:4}}>When a new organization overtakes the download leader, it signals a platform shift. Meta's Llama led with 23.2% of downloads by late 2025, but Qwen reached 20% — market fragmentation means enterprises are diversifying away from single-vendor dependence.</div>
              <div style={{...font.sans,fontSize:11,color:C.green,lineHeight:1.5,fontWeight:600,paddingLeft:14,borderLeft:`2px solid ${C.green}44`}}>Bullish for infrastructure-agnostic tooling vendors. Bearish for platforms locked to a single model family. Revenue impact in 2–4 quarters.</div>
            </div>
            <div style={{padding:"8px 12px",background:C.blue+"06",border:`1px solid ${C.blue}18`,borderRadius:8}}>
              <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:3}}>Broad download acceleration across all orgs</div>
              <div style={{...font.sans,fontSize:11.5,color:C.textSec,lineHeight:1.55,marginBottom:4}}>When all tracked organizations see rising downloads simultaneously, the open-source AI market is expanding structurally. This happened in 2025 when open models reached parity with proprietary systems on most enterprise tasks at 5–25x lower cost.</div>
              <div style={{...font.sans,fontSize:11,color:C.blue,lineHeight:1.5,fontWeight:600,paddingLeft:14,borderLeft:`2px solid ${C.blue}44`}}>Bullish for the entire open-source AI ecosystem. Inference compute demand rises. Enterprise deployment revenue for model-hosting platforms in 2–3 quarters.</div>
            </div>
            <div style={{padding:"8px 12px",background:C.amber+"06",border:`1px solid ${C.amber}18`,borderRadius:8}}>
              <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:3}}>Single org spiking while others flat</div>
              <div style={{...font.sans,fontSize:11.5,color:C.textSec,lineHeight:1.55,marginBottom:4}}>A new model release from one org capturing developer attention. Often follows a benchmark result or viral demo. Check if the spike sustains beyond 2 weeks — transient spikes are hype, sustained shifts indicate genuine capability advantage.</div>
              <div style={{...font.sans,fontSize:11,color:C.amber,lineHeight:1.5,fontWeight:600,paddingLeft:14,borderLeft:`2px solid ${C.amber}44`}}>Wait for confirmation. If sustained 3+ weeks, the org has a real moat. If transient, ignore. Revenue impact only from sustained shifts.</div>
            </div>
            <div style={{padding:"8px 12px",background:C.red+"06",border:`1px solid ${C.red}18`,borderRadius:8}}>
              <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:3}}>Download volume declining across the board</div>
              <div style={{...font.sans,fontSize:11.5,color:C.textSec,lineHeight:1.55,marginBottom:4}}>Enterprise and developer interest in open-source models is waning. Could indicate: (a) proprietary models pulling ahead in capability, (b) regulatory concerns, or (c) seasonal patterns (holiday periods).</div>
              <div style={{...font.sans,fontSize:11,color:C.red,lineHeight:1.5,fontWeight:600,paddingLeft:14,borderLeft:`2px solid ${C.red}44`}}>Bearish for open-source model platforms. Check if proprietary API usage (Claude, GPT) is rising simultaneously — if yes, the build-vs-buy equation has shifted toward buy.</div>
            </div>
          </div>
        </Expandable>

        {/* Top 3 podium */}
        {top3.length>=3&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:4}}>
            {[1,0,2].map(idx=>{
              const org=top3[idx]; const meta=HF_ORGS.find(o=>o.id===org.orgId)||{name:org.orgId,color:C.textMuted};
              const ranks=["1st","2nd","3rd"];const rankColors=["#D4AF37","#A0A0A0","#CD7F32"];
              return(<div key={org.orgId} style={{textAlign:"center",padding:idx===0?"16px 12px 12px":"12px",background:C.white,borderRadius:12,border:idx===0?`2px solid ${meta.color}`:`1px solid ${C.border}`,transform:idx===0?"scale(1.02)":"none",boxShadow:idx===0?"0 4px 16px rgba(0,0,0,.08)":"0 1px 3px rgba(0,0,0,.04)"}}>
                <div style={{...font.mono,fontSize:idx===0?18:14,fontWeight:800,color:rankColors[idx],marginBottom:4,letterSpacing:"-0.02em"}}>{ranks[idx]}</div>
                <div style={{...font.sans,fontSize:idx===0?14:12,fontWeight:700,color:meta.color,marginBottom:2}}>{meta.name}</div>
                <div style={{...font.mono,fontSize:idx===0?22:18,fontWeight:800,color:C.text}}>{fmtDL(org.totalDownloads)}</div>
                <div style={{...font.sans,fontSize:10,color:C.textMuted,marginTop:2}}>{org.topModels[0]?.id.split("/").pop()||""}</div>
              </div>);
            })}
          </div>
        )}

        <Expandable title="Investment implications">
          <div style={{fontSize:12,color:C.amber,lineHeight:1.6,padding:"10px 14px",background:C.amberBg,borderRadius:10,border:`1px solid ${C.amber}22`}}>
            <span style={{fontWeight:700,display:"block",marginBottom:2}}>Investment Implication</span>
            Download ratios reveal competitive moat strength in the open-source AI layer. A company downloaded 5x less has weaker developer lock-in — weaker inference revenue, less fine-tuning, lower switching costs. Watch for rank changes: rapid climbers signal a model breakout that reshapes vendor selection within quarters.
          </div>
        </Expandable>
      </div>

      {hfHist.length >= 2 && (
        <div style={{padding:"14px 22px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
            <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text}}>Download Growth Over Time</div>
            <TimeRangeSelector value={hfRange} onChange={setHfRange} />
          </div>

          {/* All-companies chart */}
          <div style={{width:"100%",height:220,marginBottom:12}}>
            {(()=>{const hdAll=sanitizeTimeSeries(hfHist.map(p=>({...p,_ts:p.ts||Date.now(),_iso:new Date(p.ts||Date.now()).toISOString()})).sort((a,b)=>a._ts-b._ts),"_ts");let hd=filterByTimeRange(hdAll,hfRange,"_iso");if(hd.length>=4){HF_ORGS.forEach(o=>{hd=smoothEMA(hd,o.id,0.2);});}const smK=hd.length>=4;const allVals=hd.flatMap(p=>HF_ORGS.map(o=>p[smK?`${o.id}_smooth`:o.id]).filter(v=>typeof v==="number"&&v>0));const yd=zoomedYDomain(allVals);return(
            <ResponsiveContainer>
              <LineChart data={hd} margin={{top:8,right:16,bottom:8,left:8}}>
                <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin","dataMax"]}
                  tickFormatter={ts=>formatChartDateShort(new Date(ts).toISOString())}
                  tick={{fontSize:9,fill:C.textMuted}} interval="preserveStartEnd" tickCount={6} />
                <YAxis tick={{fontSize:10,fill:C.textMuted,...font.mono}} width={55} tickFormatter={fmtDL} domain={yd} allowDataOverflow={true}/>
                <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}} formatter={v=>fmtDL(v)} labelFormatter={ts=>formatChartDate(new Date(ts).toISOString())} />
                <Legend wrapperStyle={{fontSize:10,...font.sans}}/>
                {HF_ORGS.map(org=>(<Line key={org.id} type="monotone" dataKey={smK?`${org.id}_smooth`:org.id} stroke={org.color} strokeWidth={2} dot={false} name={org.name} connectNulls/>))}
              </LineChart>
            </ResponsiveContainer>);})()}
          </div>

          {/* Head-to-head comparison */}
          <div style={{background:C.nested,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.borderLight}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
              <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text}}>Head-to-Head Comparison</div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                {[{label:"Company",val:compareA,set:setCompareA,color:compareA?HF_ORGS.find(o=>o.id===compareA)?.color:C.textMuted},{label:"Compare to",val:compareB,set:setCompareB,color:compareB==="__avg__"?C.textSec:compareB?HF_ORGS.find(o=>o.id===compareB)?.color:C.textMuted}].map(({label:lbl,val,set,color},di)=>(
                  <div key={lbl} style={{display:"flex",alignItems:"center",gap:4}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:color||C.textMuted}}/>
                    <select value={val||""} onChange={e=>set(e.target.value)} style={{...font.sans,fontSize:11,padding:"3px 6px",borderRadius:6,border:`1px solid ${C.border}`,background:C.white,color:C.text,cursor:"pointer"}}>
                      <option value="">{lbl}</option>
                      {di===1&&<option value="__avg__">Industry Average</option>}
                      {HF_ORGS.map(o=>(<option key={o.id} value={o.id}>{o.name}</option>))}
                    </select>
                  </div>
                ))}
                {(compareA||compareB)&&<button onClick={()=>{setCompareA(null);setCompareB(null);}} style={{...font.sans,fontSize:9,color:C.textMuted,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Clear</button>}
              </div>
            </div>

            {compareA && compareB && compareA !== compareB ? (()=>{
              const orgA = HF_ORGS.find(o=>o.id===compareA);
              const isAvg = compareB === "__avg__";
              const orgB = isAvg ? {id:"__avg__",name:"Industry Average",color:C.textSec} : HF_ORGS.find(o=>o.id===compareB);
              if(!orgA||!orgB) return null;
              const hdAll=sanitizeTimeSeries(hfHist.map(p=>({...p,_ts:p.ts||Date.now(),_iso:new Date(p.ts||Date.now()).toISOString()})).sort((a,b)=>a._ts-b._ts),"_ts");
              let hd=filterByTimeRange(hdAll,hfRange,"_iso");
              if(hd.length<2) return <div style={{...font.sans,fontSize:12,color:C.textMuted,textAlign:"center",padding:20}}>Not enough data for this time range.</div>;

              if (isAvg) {
                hd = hd.map(p => {
                  const vals = HF_ORGS.map(o => p[o.id]).filter(v => typeof v === "number" && v > 0);
                  return { ...p, __avg__: vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null };
                });
              }

              if(hd.length>=4){
                hd=smoothEMA(hd,orgA.id,0.2);
                hd=smoothEMA(hd,isAvg?"__avg__":orgB.id,0.2);
              }
              const smK=hd.length>=4;
              const keyA=smK?`${orgA.id}_smooth`:orgA.id;
              const keyB=smK?`${orgB.id}_smooth`:orgB.id;
              const baseA=hd.find(p=>typeof p[keyA]==="number"&&p[keyA]>0)?.[keyA];
              const baseB=hd.find(p=>typeof p[keyB]==="number"&&p[keyB]>0)?.[keyB];
              if(!baseA||!baseB) return <div style={{...font.sans,fontSize:12,color:C.textMuted,textAlign:"center",padding:20}}>Insufficient data for comparison.</div>;
              const normalized=hd.map(p=>{
                const vA=p[keyA]; const vB=p[keyB];
                return {...p,
                  pctA: typeof vA==="number"?((vA-baseA)/baseA)*100:null,
                  pctB: typeof vB==="number"?((vB-baseB)/baseB)*100:null,
                  rawA: vA, rawB: vB,
                };
              });
              const allPcts=normalized.flatMap(p=>[p.pctA,p.pctB]).filter(v=>v!=null);
              const minP=Math.min(...allPcts); const maxP=Math.max(...allPcts);
              const pad=Math.max((maxP-minP)*0.12,2);
              const lastA=normalized.filter(p=>p.pctA!=null).slice(-1)[0];
              const lastB=normalized.filter(p=>p.pctB!=null).slice(-1)[0];
              const aGrew=lastA?.pctA??0; const bGrew=lastB?.pctB??0;
              const aboveAvg = isAvg && aGrew > bGrew;
              const winner = isAvg ? null : (Math.abs(aGrew-bGrew)<0.5?null:aGrew>bGrew?orgA:orgB);
              return(<>
                <div style={{display:"flex",gap:20,marginBottom:10,flexWrap:"wrap"}}>
                  {[{org:orgA,last:lastA,pctKey:"pctA",rawKey:"rawA",isCompany:true},{org:orgB,last:lastB,pctKey:"pctB",rawKey:"rawB",isCompany:!isAvg}].map(({org,last,pctKey,rawKey,isCompany})=>{
                    const pctVal=last?.[pctKey];
                    return(
                    <div key={org.id} style={{flex:1,minWidth:160,padding:"10px 14px",background:C.white,borderRadius:8,border:`1px solid ${C.borderLight}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                        <div style={{width:10,height:10,borderRadius:"50%",background:org.color,opacity:isCompany?1:0.5}}/>
                        <span style={{...font.sans,fontSize:12,fontWeight:700,color:isCompany?org.color:C.textSec}}>{org.name}</span>
                        {winner?.id===org.id&&<span style={{...font.mono,fontSize:9,fontWeight:800,color:C.green,background:C.greenBg,borderRadius:4,padding:"1px 6px"}}>FASTER</span>}
                        {isAvg&&org.id===orgA.id&&aboveAvg&&<span style={{...font.mono,fontSize:9,fontWeight:800,color:C.green,background:C.greenBg,borderRadius:4,padding:"1px 6px"}}>ABOVE AVG</span>}
                        {isAvg&&org.id===orgA.id&&!aboveAvg&&Math.abs(aGrew-bGrew)>0.5&&<span style={{...font.mono,fontSize:9,fontWeight:800,color:C.red,background:C.redBg,borderRadius:4,padding:"1px 6px"}}>BELOW AVG</span>}
                      </div>
                      <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                        {pctVal!=null&&<span style={{...font.mono,fontSize:20,fontWeight:800,color:pctVal>=0?C.green:C.red}}>{pctVal>=0?"+":""}{pctVal.toFixed(1)}%</span>}
                        {isCompany&&last&&<span style={{...font.mono,fontSize:11,color:C.textMuted}}>{fmtDL(last[rawKey])}</span>}
                      </div>
                      <div style={{...font.sans,fontSize:10,color:C.textMuted,marginTop:2}}>since {formatChartDateShort(new Date(hd[0]._ts).toISOString())}</div>
                    </div>);
                  })}
                </div>
                <div style={{width:"100%",height:240}}>
                  <ResponsiveContainer>
                    <LineChart data={normalized} margin={{top:8,right:16,bottom:8,left:8}}>
                      <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin","dataMax"]}
                        tickFormatter={ts=>formatChartDateShort(new Date(ts).toISOString())}
                        tick={{fontSize:9,fill:C.textMuted}} interval="preserveStartEnd" tickCount={6} />
                      <YAxis tick={{fontSize:10,fill:C.textMuted,...font.mono}} width={48} tickFormatter={v=>`${v>=0?"+":""}${v.toFixed(0)}%`} domain={[Math.floor(minP-pad),Math.ceil(maxP+pad)]}/>
                      <ReferenceLine y={0} stroke={C.textMuted} strokeDasharray="4 4" strokeWidth={1}/>
                      <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}}
                        formatter={(v,name)=>[`${v!=null?(v>=0?"+":"")+v.toFixed(1)+"%":"—"}`,name]}
                        labelFormatter={ts=>formatChartDate(new Date(ts).toISOString())} />
                      <Line type="monotone" dataKey="pctA" stroke={orgA.color} strokeWidth={2.5} dot={false} name={orgA.name} connectNulls/>
                      <Line type="monotone" dataKey="pctB" stroke={orgB.color} strokeWidth={isAvg?2:2.5} dot={false} name={orgB.name} connectNulls strokeDasharray={isAvg?"6 3":undefined}/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>);
            })() : (
              <div style={{...font.sans,fontSize:11,color:C.textMuted,textAlign:"center",padding:"16px 0"}}>
                Select a company and compare to another company or the Industry Average.
              </div>
            )}
          </div>
        </div>
      )}

      {err&&<div style={{padding:"12px 22px",background:C.redBg,color:C.red,fontSize:13,fontWeight:600}}>{err}</div>}

      {/* Full table */}
      <div style={{padding:"0 6px 6px"}}>
        <table><thead><tr>
          {["#","Organization","Downloads (top 10)","Top Model",""].map((h,i)=>(
            <th key={i} style={{...font.sans,fontSize:10,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",padding:"10px 14px",textAlign:i===0?"center":"left",borderBottom:`2px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {orgs.map((org,rank)=>{
            const meta=HF_ORGS.find(o=>o.id===org.orgId)||{name:org.orgId,color:C.textMuted};
            const pct=maxDl>0?(org.totalDownloads/maxDl)*100:0;
            const isExp=expanded===org.orgId;
            const rv=rank>0&&orgs[0].totalDownloads>0?(orgs[0].totalDownloads/Math.max(org.totalDownloads,1)).toFixed(1):null;
            const isSelA=compareA===org.orgId;
            const isSelB=compareB===org.orgId;
            const compareHighlight=isSelA?`${meta.color}12`:isSelB?`${meta.color}08`:"transparent";
            return(<React.Fragment key={org.orgId}>
              <tr style={{cursor:"pointer",transition:"background .15s",background:compareHighlight}} onClick={()=>{if(isSelA){setCompareA(null);return;}if(isSelB){setCompareB(null);return;}if(compareB==="__avg__"){setCompareA(org.orgId);}else if(!compareA){setCompareA(org.orgId);}else if(!compareB){setCompareB(org.orgId);}else{setCompareA(compareB);setCompareB(org.orgId);}setExpanded(isExp?null:org.orgId);}} onMouseEnter={e=>{e.currentTarget.style.background=isSelA||isSelB?compareHighlight:C.nested;}} onMouseLeave={e=>{e.currentTarget.style.background=compareHighlight;}}>
                <td style={{padding:"12px 14px",textAlign:"center",...font.mono,fontSize:14,fontWeight:800,color:rank<3?meta.color:C.textMuted,width:40}}>{rank+1}</td>
                <td style={{padding:"12px 14px",fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap"}}>
                  <span style={{display:"inline-block",width:10,height:10,borderRadius:"50%",background:meta.color,marginRight:10,verticalAlign:"middle"}}/>{meta.name}
                  {rv&&<span style={{fontSize:10,color:C.textMuted,marginLeft:8}}>({rv}x less)</span>}
                  {isSelA&&<span style={{...font.mono,fontSize:9,fontWeight:800,color:C.white,background:meta.color,borderRadius:4,padding:"1px 5px",marginLeft:6,verticalAlign:"middle"}}>A</span>}
                  {isSelB&&<span style={{...font.mono,fontSize:9,fontWeight:800,color:C.white,background:meta.color,borderRadius:4,padding:"1px 5px",marginLeft:6,verticalAlign:"middle"}}>B</span>}
                </td>
                <td style={{padding:"12px 14px",minWidth:250}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{flex:1,height:20,background:C.nested,borderRadius:4,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:meta.color,borderRadius:4,transition:"width .6s ease"}}/></div>
                    <span style={{...font.mono,fontSize:14,fontWeight:800,color:C.text,minWidth:60,textAlign:"right"}}>{fmtDL(org.totalDownloads)}</span>
                  </div>
                </td>
                <td style={{padding:"12px 14px",fontSize:12,color:C.textSec,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{org.topModels[0]?<><span style={{fontWeight:600}}>{org.topModels[0].id.split("/").pop()}</span> <span style={{color:C.textMuted}}>({fmtDL(org.topModels[0].downloads)})</span></>:"—"}</td>
                <td style={{padding:"12px 10px",textAlign:"center",fontSize:12,color:C.textMuted,transition:"transform .2s",transform:isExp?"rotate(180deg)":"rotate(0)"}}>▾</td>
              </tr>
              {isExp&&(<tr className="fade-in"><td colSpan={5} style={{padding:"4px 14px 14px",background:C.nested}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,maxWidth:700}}>{org.topModels.map((m,i)=>(<div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:C.white,borderRadius:10,border:`1px solid ${C.borderLight}`}}><span style={{...font.mono,fontSize:11,fontWeight:700,color:C.textMuted,width:18}}>{i+1}</span><div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.id}</div><div style={{fontSize:10,color:C.textMuted}}>{m.pipeline||"—"}</div></div><span style={{...font.mono,fontSize:12,fontWeight:700,color:meta.color,whiteSpace:"nowrap"}}>{fmtDL(m.downloads)}</span></div>))}</div></td></tr>)}
            </React.Fragment>);
          })}
          {orgs.length===0&&!isL&&<tr><td colSpan={5} style={{padding:30,textAlign:"center",color:C.textMuted,fontSize:13}}>Click Refresh to load Hugging Face data.</td></tr>}
          {isL&&orgs.length===0&&<tr><td colSpan={5} style={{padding:30,textAlign:"center"}}><Spinner size={18}/><span style={{...font.sans,marginLeft:10,fontSize:13,color:C.textMuted}}>Fetching from Hugging Face…</span></td></tr>}
        </tbody></table>
      </div>
    </Card>
  );
}

// ── EARNINGS CALL ANALYZER ──────────────────────────────────────────────────

const EC_COMPANIES = [
  { id: "GOOGL", name: "Alphabet (Google)", color: "#4a6fa5" },
  { id: "AMZN", name: "Amazon", color: "#8a6a2d" },
  { id: "MSFT", name: "Microsoft", color: "#4a7a8a" },
  { id: "META", name: "Meta", color: "#3d5a9e" },
  { id: "NVDA", name: "NVIDIA", color: "#5a7a3d" },
  { id: "CUSTOM", name: "Custom Company", color: C.cyan },
];

const EC_SCORE_DEFS = [
  { id: "tense_distribution", label: "Tense Distribution", short: "Tense", desc: "Present-tense operational vs future-tense aspirational language" },
  { id: "specificity_gradient", label: "Specificity Gradient", short: "Specificity", desc: "Do claims get more specific or vague as significance increases?" },
  { id: "sincerity_signal", label: "Sincerity Signal", short: "Sincerity", desc: "Volunteered bad news, error acknowledgment, absence of superlatives" },
  { id: "absorption_failure", label: "Absorption Failure", short: "Absorption", desc: "Does explanation length scale with negative metric severity?" },
  { id: "register_consistency", label: "Register Consistency", short: "Register", desc: "Does language register shift between strong and weak quarters?" },
];

function ecScoreColor(score) {
  if (score >= 81) return C.green;
  if (score >= 61) return C.blue;
  if (score >= 31) return C.amber;
  return C.red;
}
function ecScoreLabel(score) {
  if (score >= 81) return "Strong Operational Signal";
  if (score >= 61) return "Operationally Grounded";
  if (score >= 31) return "Mixed Signals";
  return "Narrative-Dominant";
}

function EcScoreGauge({ score, size = 120, label }) {
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = circ * (1 - pct * 0.75);
  const color = ecScoreColor(score);
  return (
    <div style={{ textAlign: "center", width: size }}>
      <svg width={size} height={size * 0.85} viewBox={`0 0 ${size} ${size * 0.85}`}>
        <circle cx={size / 2} cy={size * 0.55} r={r} fill="none" stroke={C.nested} strokeWidth={8}
          strokeDasharray={`${circ * 0.75} ${circ * 0.25}`} strokeLinecap="round"
          transform={`rotate(135 ${size / 2} ${size * 0.55})`} />
        <circle cx={size / 2} cy={size * 0.55} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${circ * 0.75} ${circ * 0.25}`} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(135 ${size / 2} ${size * 0.55})`} style={{ transition: "stroke-dashoffset 1s ease" }} />
        <text x={size / 2} y={size * 0.52} textAnchor="middle" style={{ font: `800 ${size * 0.26}px Inter,system-ui,sans-serif`, fill: color }}>{score}</text>
        <text x={size / 2} y={size * 0.72} textAnchor="middle" style={{ font: `600 ${size * 0.075}px Inter,system-ui,sans-serif`, fill: C.textMuted }}>{ecScoreLabel(score)}</text>
      </svg>
      {label && <div style={{ ...font.sans, fontSize: 11, fontWeight: 600, color: C.textSec, marginTop: -4 }}>{label}</div>}
    </div>
  );
}

function EcQuoteCard({ quote, explanation, type, claimSig, specLevel }) {
  const borderColor = type === "operational" || type === "specific" || type === "healthy" ? C.green
    : type === "narrative" || type === "vague" || type === "failure" ? C.red : C.amber;
  return (
    <div style={{ borderLeft: `3px solid ${borderColor}`, padding: "10px 14px", marginBottom: 8, background: C.nested, borderRadius: "0 8px 8px 0" }}>
      <div style={{ ...font.sans, fontSize: 12, fontStyle: "italic", color: C.text, lineHeight: 1.55, marginBottom: 4 }}>"{quote}"</div>
      {claimSig && <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginBottom: 2 }}>Significance: {claimSig} | Specificity: {specLevel}</div>}
      <div style={{ ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.45 }}>{explanation}</div>
    </div>
  );
}

function EcLayer2Panel({ quant: quantIn, institutional }) {
  const quant = useMemo(() => {
    if (!quantIn) return null;
    if (quantIn.cross_quarter_fairness) return quantIn;
    try {
      const c = JSON.parse(JSON.stringify(quantIn));
      ensureCrossQuarterFairness(c);
      return c;
    } catch {
      return quantIn;
    }
  }, [quantIn]);
  if (!quant) return null;
  const inst = institutional && typeof institutional === "object" ? institutional : null;
  const conc = quant.theme_concentration || {};
  const sent = quant.sentiment_lexicon || {};
  const fq = quant.cross_quarter_fairness || {};
  const seg = quant.segments || {};
  return (
    <div style={{ marginBottom: 20, borderRadius: 12, border: `1px solid ${C.purple}28`, overflow: "hidden", background: C.white }}>
      <div style={{ padding: "12px 16px", background: `linear-gradient(135deg, ${C.purple}12 0%, ${C.blue}08 100%)`, borderBottom: `1px solid ${C.borderLight}` }}>
        <div style={{ ...font.sans, fontSize: 12, fontWeight: 800, color: C.text, letterSpacing: "0.02em" }}>Layer 2 — Quant signals & institutional NLP</div>
        <div style={{ ...font.sans, fontSize: 10.5, color: C.textSec, lineHeight: 1.5, marginTop: 4 }}>
          Deterministic mention density, theme concentration, LM-style lexicon tone, forward-looking / uncertainty rates, and (below) an LLM read aligned with buy-side transcript workflows: topic-weighted tone, Q&A vs prepared, and AI capex vs revenue framing.
        </div>
      </div>
      <div style={{ padding: "14px 16px" }}>
        <Expandable title="Methodology & how funds use LLMs on calls" defaultOpen={false}>
          <div style={{ ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.65, padding: "8px 0" }}>
            <strong style={{ color: C.text }}>Quant layer (always computed here):</strong> theme lexicons for AI/GTM/capex/risk/guidance; a compact finance sentiment word list inspired by Loughran–McDonald-style baselines; phrase lists for forward-looking and uncertain language; Herfindahl-style concentration across theme buckets; optional prepared vs Q&A split via common transcript markers.
            <br /><br />
            <strong style={{ color: C.text }}>Institutional context (research landscape):</strong> sell-side and quant teams have moved from pure lexicons toward LLM-based tone, materiality-weighted sentiment, and structured extraction—often with RAG over filings and multi-agent analyst-style pipelines (e.g. FinNLP / role-based agent papers, vendor research such as S&P Global Market Intelligence on lexicon-to-LLM evolution, and internal FinBERT-style encoders). This dashboard keeps your original five linguistic dimensions and adds this stack as a parallel layer—not a replacement.
            <br /><br />
            <strong style={{ color: C.text }}>Limits:</strong> lexicon hits ignore negation scoping; duplicate terms can co-fire; Hub-style download stats are unrelated—this block is transcript-only.
          </div>
        </Expandable>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 12, marginBottom: 14 }}>
          <div style={{ padding: "10px 12px", background: C.nested, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ ...font.sans, fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>Words</div>
            <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: C.text }}>{(quant.word_count || 0).toLocaleString()}</div>
          </div>
          <div style={{ padding: "10px 12px", background: C.nested, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ ...font.sans, fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>AI mentions / 1k</div>
            <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: C.purple }}>{quant.ai_density_per_1000_words ?? "—"}</div>
          </div>
          <div style={{ padding: "10px 12px", background: C.nested, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ ...font.sans, fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>Lexicon net / 1k (fair)</div>
            <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: (fq.lexicon_net_per_1000 ?? sent.net_per_1000_words ?? 0) >= 0 ? C.green : C.red }}>{fq.lexicon_net_per_1000 ?? sent.net_per_1000_words ?? "—"}</div>
            <div style={{ ...font.sans, fontSize: 9, color: C.textMuted }}>raw net {sent.net ?? 0} (length-sensitive)</div>
          </div>
          <div style={{ padding: "10px 12px", background: C.nested, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ ...font.sans, fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>AI % of theme hits</div>
            <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: C.purple }}>{fq.ai_share_of_theme_hits != null ? `${Math.round(fq.ai_share_of_theme_hits * 1000) / 10}%` : "—"}</div>
          </div>
          <div style={{ padding: "10px 12px", background: C.nested, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ ...font.sans, fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>Fwd-looking / 1k</div>
            <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: C.cyan }}>{quant.forward_looking?.per_1000_words ?? "—"}</div>
          </div>
          <div style={{ padding: "10px 12px", background: C.nested, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ ...font.sans, fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>Uncertainty / 1k</div>
            <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: C.amber }}>{quant.uncertainty_language?.per_1000_words ?? "—"}</div>
          </div>
          <div style={{ padding: "10px 12px", background: C.nested, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ ...font.sans, fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>Theme concentration</div>
            <div style={{ ...font.mono, fontSize: 14, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>HHI {conc.herfindahl_hhi ?? "—"}</div>
            <div style={{ ...font.sans, fontSize: 9, color: C.textMuted }}>norm {conc.normalized_0_1 ?? "—"} · top {conc.dominant_theme_label || "—"}</div>
          </div>
        </div>

        <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textSec, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Theme frequency & concentration (hits · per 1k words)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {(quant.themes || []).map((th) => (
            <div key={th.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: C.nested, borderRadius: 8, border: `1px solid ${C.borderLight}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.text }}>{th.label}</div>
                {th.top_matched_terms?.length > 0 && (
                  <div style={{ ...font.sans, fontSize: 9, color: C.textMuted, marginTop: 2, lineHeight: 1.35 }}>
                    Top terms: {th.top_matched_terms.map((t) => `${t.term} (${t.count})`).join(", ")}
                  </div>
                )}
              </div>
              <div style={{ ...font.mono, fontSize: 12, fontWeight: 800, color: C.blue, whiteSpace: "nowrap" }}>{th.hits} · {th.per_1000_words}/1k</div>
            </div>
          ))}
        </div>

        {(seg.prepared_sentiment || seg.qa_sentiment) && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: C.cyanBg, borderRadius: 10, border: `1px solid ${C.cyan}22` }}>
            <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.cyan, marginBottom: 6 }}>Prepared vs Q&A — lexicon net (same LM-style lists)</div>
            <div style={{ ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.55 }}>
              {seg.split_found ? (
                <>
                  <strong style={{ color: C.text }}>Prepared ({seg.prepared_word_count?.toLocaleString?.() || 0} words):</strong> net {seg.prepared_sentiment?.net ?? "—"} (pos {seg.prepared_sentiment?.positive_hits ?? 0} / neg {seg.prepared_sentiment?.negative_hits ?? 0})
                  <br />
                  <strong style={{ color: C.text }}>Q&A ({seg.qa_word_count?.toLocaleString?.() || 0} words):</strong> net {seg.qa_sentiment?.net ?? "—"} (pos {seg.qa_sentiment?.positive_hits ?? 0} / neg {seg.qa_sentiment?.negative_hits ?? 0})
                  {seg.qa_vs_prepared_net_delta != null && (
                    <><br /><strong style={{ color: C.text }}>Δ (Q&A − prepared):</strong> {seg.qa_vs_prepared_net_delta}</>
                  )}
                </>
              ) : (
                <>
                  <strong style={{ color: C.text }}>Q&A boundary not detected</strong> — lexicon net on full call: {seg.prepared_sentiment?.net ?? "—"} (pos {seg.prepared_sentiment?.positive_hits ?? 0} / neg {seg.prepared_sentiment?.negative_hits ?? 0}). Try transcripts that include an &quot;Operator&quot; or &quot;Question-and-Answer&quot; section marker.
                </>
              )}
            </div>
          </div>
        )}

        {quant.ai_sentence_spotlights?.length > 0 && (
          <div style={{ marginBottom: inst ? 14 : 0 }}>
            <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textSec, marginBottom: 6, textTransform: "uppercase" }}>Highest AI-density sentences (lexicon proxy)</div>
            {quant.ai_sentence_spotlights.map((row, i) => (
              <div key={i} style={{ ...font.sans, fontSize: 11, fontStyle: "italic", color: C.text, padding: "8px 10px", marginBottom: 6, background: C.purple + "08", borderRadius: 8, borderLeft: `3px solid ${C.purple}` }}>
                {row.sentence}
                <span style={{ fontStyle: "normal", ...font.mono, fontSize: 9, color: C.textMuted, marginLeft: 6 }}>(hits {row.score})</span>
              </div>
            ))}
          </div>
        )}

        {inst && (
          <div style={{ padding: "12px 14px", background: C.nested, borderRadius: 10, border: `1px solid ${C.purple}30` }}>
            <div style={{ ...font.sans, fontSize: 11, fontWeight: 800, color: C.purple, marginBottom: 8 }}>LLM institutional read (materiality-aware)</div>
            {inst.ai_investment_thesis_tone && (
              <div style={{ marginBottom: 8 }}>
                <span style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted }}>AI thesis tone: </span>
                <span style={{ ...font.sans, fontSize: 11, fontWeight: 800, color: C.text }}>{inst.ai_investment_thesis_tone}</span>
              </div>
            )}
            {inst.ai_thesis_rationale && <div style={{ ...font.sans, fontSize: 11, color: C.text, lineHeight: 1.55, marginBottom: 8 }}>{inst.ai_thesis_rationale}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
              {inst.prepared_remarks_ai_sentiment != null && (
                <div style={{ ...font.sans, fontSize: 11 }}><strong>Prepared AI sentiment:</strong> <span style={{ fontWeight: 800, color: inst.prepared_remarks_ai_sentiment >= 0 ? C.green : C.red }}>{inst.prepared_remarks_ai_sentiment}</span> <span style={{ color: C.textMuted }}>(−100 bearish … +100 bullish)</span></div>
              )}
              {inst.qa_session_ai_sentiment != null && (
                <div style={{ ...font.sans, fontSize: 11 }}><strong>Q&A AI sentiment:</strong> <span style={{ fontWeight: 800, color: inst.qa_session_ai_sentiment >= 0 ? C.green : C.red }}>{inst.qa_session_ai_sentiment}</span></div>
              )}
              {inst.forward_looking_strength_0_100 != null && (
                <div style={{ ...font.sans, fontSize: 11 }}><strong>Forward concrete score:</strong> {inst.forward_looking_strength_0_100}/100</div>
              )}
            </div>
            {inst.topic_weighted_financial_sentiment && (
              <div style={{ ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.5, marginBottom: 8 }}><strong style={{ color: C.text }}>Topic-weighted tone:</strong> {inst.topic_weighted_financial_sentiment}</div>
            )}
            {inst.ai_capex_vs_revenue_framing && (
              <div style={{ ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.5, marginBottom: 8 }}><strong style={{ color: C.text }}>Capex vs revenue framing:</strong> {inst.ai_capex_vs_revenue_framing}</div>
            )}
            {Array.isArray(inst.hedge_fund_style_flags) && inst.hedge_fund_style_flags.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.amber, marginBottom: 4 }}>Flags (deflection / tone / dodge patterns)</div>
                <ul style={{ margin: 0, paddingLeft: 18, ...font.sans, fontSize: 11, color: C.text, lineHeight: 1.5 }}>
                  {inst.hedge_fund_style_flags.slice(0, 8).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            {Array.isArray(inst.named_initiatives) && inst.named_initiatives.length > 0 && (
              <div>
                <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textSec, marginBottom: 4 }}>Named AI initiatives / products</div>
                {inst.named_initiatives.slice(0, 10).map((n, i) => (
                  <div key={i} style={{ padding: "6px 8px", marginBottom: 4, background: C.white, borderRadius: 6, border: `1px solid ${C.borderLight}` }}>
                    <span style={{ fontWeight: 700 }}>{n.name}</span>
                    <span style={{ ...font.sans, fontSize: 10, color: n.sentiment === "POSITIVE" ? C.green : n.sentiment === "NEGATIVE" ? C.red : C.textMuted, marginLeft: 8 }}>{n.sentiment}</span>
                    {n.evidence_quote && <div style={{ ...font.sans, fontSize: 10, color: C.textSec, marginTop: 2, fontStyle: "italic" }}>&ldquo;{n.evidence_quote}&rdquo;</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!inst && (
          <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, fontStyle: "italic" }}>Re-run Analyze to populate the LLM institutional block (older saved runs may lack it).</div>
        )}
      </div>
    </div>
  );
}

function EcRadarChart({ analysis, priorAnalysis }) {
  if (!analysis?.scores) return null;
  const data = EC_SCORE_DEFS.map(d => ({
    subject: d.short,
    current: analysis.scores[d.id]?.score || 0,
    ...(priorAnalysis?.scores ? { prior: priorAnalysis.scores[d.id]?.score || 0 } : {}),
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="72%">
        <PolarGrid stroke={C.border} />
        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: C.textSec }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9 }} />
        <Radar name="Current" dataKey="current" stroke={C.cyan} fill={C.cyan} fillOpacity={0.25} strokeWidth={2} />
        {priorAnalysis?.scores && <Radar name="Prior" dataKey="prior" stroke={C.amber} fill={C.amber} fillOpacity={0.12} strokeWidth={1.5} strokeDasharray="4 3" />}
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function EcInvestmentSignalBadge({ signal }) {
  const m = {
    LONG_SIGNAL: { label: "LONG SIGNAL", bg: "#ecfdf5", fg: C.green, icon: "↑" },
    SHORT_SIGNAL: { label: "SHORT SIGNAL", bg: "#fef2f2", fg: C.red, icon: "↓" },
    WATCH: { label: "WATCH", bg: "#fef3c7", fg: C.amber, icon: "◎" },
    NEUTRAL: { label: "NEUTRAL", bg: C.nested, fg: C.textMuted, icon: "–" },
  };
  const s = m[signal] || m.NEUTRAL;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 12px", borderRadius: 6, background: s.bg, color: s.fg, fontWeight: 700, fontSize: 12 }}>{s.icon} {s.label}</span>;
}

function fmtEcDelta(d) {
  if (d == null || Number.isNaN(d)) return "—";
  return (d > 0 ? "+" : "") + d;
}

function zBadge(z) {
  if (z == null || Number.isNaN(z)) return null;
  const a = Math.abs(z);
  if (a < 1.5) return null;
  const col = a >= 2 ? C.red : C.amber;
  return <span style={{ ...font.mono, fontSize: 9, fontWeight: 700, color: col, marginLeft: 4 }} title="z vs other saved calls for this company">z{z > 0 ? "+" : ""}{z.toFixed(1)}</span>;
}

const EC_CHART_GRID = { stroke: C.borderLight, strokeDasharray: "3 3" };
const EC_TT_BOX = {
  padding: "12px 14px",
  background: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  boxShadow: "0 8px 24px rgba(28,31,38,.12)",
  minWidth: 200,
  ...font.sans,
};

function EcCompareTooltipL1({ active, label, payload, timeline }) {
  if (!active || !payload?.length) return null;
  const row = timeline?.find((r) => r.name === label);
  const order = ["Overall", ...EC_SCORE_DEFS.map((d) => d.short)];
  const sorted = [...payload].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return (
    <div style={EC_TT_BOX}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.text, marginBottom: 2, letterSpacing: "0.02em" }}>{label}</div>
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 10, ...font.mono }}>
        {row?.words != null ? `${row.words.toLocaleString()} words` : "Layer 2 not stored · words N/A"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sorted.map((p) => (
          <div key={String(p.dataKey)} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 11 }}>
            <span style={{ color: C.textSec }}>{p.name}</span>
            <span style={{ ...font.mono, fontWeight: 700, color: p.name === "Overall" ? C.text : C.textMuted }}>
              {p.value != null && p.value !== "" && !Number.isNaN(Number(p.value)) ? Number(p.value).toFixed(0) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EcCompareTooltipL2({ active, label, payload, timeline }) {
  if (!active || !payload?.length) return null;
  const row = timeline?.find((r) => r.name === label);
  const labelMap = {
    aiPer1k: "AI lexicon hits / 1k words",
    fwd1k: "Forward-looking phrases / 1k",
    unc1k: "Uncertainty language / 1k",
    lexNet1k: "LM-style lexicon net / 1k",
  };
  return (
    <div style={EC_TT_BOX}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.text, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 10, lineHeight: 1.45 }}>
        Rates normalize for transcript length. Compare quarters on the same axes as the left panel.
      </div>
      {row?.words != null && (
        <div style={{ fontSize: 10, ...font.mono, color: C.text, marginBottom: 8 }}>Transcript volume: {row.words.toLocaleString()} words</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {payload.map((p) => (
          <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 11 }}>
            <span style={{ color: C.textSec }}>{labelMap[p.dataKey] || p.name}</span>
            <span style={{ ...font.mono, fontWeight: 700, color: C.text }}>{p.value != null && p.value !== "" ? (typeof p.value === "number" ? (Math.abs(p.value) < 100 ? p.value.toFixed(1) : p.value.toFixed(0)) : p.value) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One company: chronological charts + fair-metric table with QoQ / YoY deltas. */
function EcCompanyTemporalCompare({ company, rawEntries, color, setEcResult, setEcTab }) {
  const withPq = attachParsedQuarters(rawEntries);
  const unparsable = withPq.filter((e) => !e._pq);
  const sorted = attachCompanyZScores(
    sortEarningsChronologically(withPq).map((e) => {
      if (!e.layer2_quant) return { ...e, layer2_quant: null };
      try {
        const c = JSON.parse(JSON.stringify(e.layer2_quant));
        ensureCrossQuarterFairness(c);
        return { ...e, layer2_quant: c };
      } catch {
        return { ...e, layer2_quant: e.layer2_quant };
      }
    }),
  );
  /** Same X categories for both panels (aligned fiscal periods). */
  const unifiedTimeline = sorted.map((e) => {
    const q = e.layer2_quant;
    const fq = q?.cross_quarter_fairness;
    return {
      name: e.quarter,
      words: q?.word_count ?? null,
      score: e.overall_quality_score ?? 0,
      ...Object.fromEntries(EC_SCORE_DEFS.map((d) => [d.short, e.scores?.[d.id]?.score ?? null])),
      aiPer1k: q?.ai_density_per_1000_words ?? null,
      lexNet1k: fq?.lexicon_net_per_1000 ?? null,
      fwd1k: q?.forward_looking?.per_1000_words ?? null,
      unc1k: q?.uncertainty_language?.per_1000_words ?? null,
    };
  });
  const lexVals = unifiedTimeline.map((r) => r.lexNet1k).filter((v) => typeof v === "number" && !Number.isNaN(v));
  const lexMax = lexVals.length ? Math.max(...lexVals.map((v) => Math.abs(v)), 4) : 4;
  const rateVals = unifiedTimeline.flatMap((r) => [r.aiPer1k, r.fwd1k, r.unc1k].filter((v) => typeof v === "number"));
  const rateMax = rateVals.length ? Math.max(...rateVals, 8) : 8;

  const latest = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const deltaLegacy = prev ? (latest?.overall_quality_score || 0) - (prev?.overall_quality_score || 0) : null;
  const showDualCharts = unifiedTimeline.length >= 2;

  return (
    <div style={{ marginBottom: 24, padding: 0, border: `1px solid ${C.border}`, borderRadius: 12, background: C.white, overflow: "hidden", boxShadow: "0 1px 3px rgba(28,31,38,.06)" }}>
      <div style={{ padding: "16px 18px", borderBottom: `1px solid ${C.borderLight}`, background: `linear-gradient(180deg, ${C.nested} 0%, ${C.white} 100%)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: "0.12em", marginBottom: 4 }}>EARNINGS TRANSCRIPT · TEMPORAL COMPARE</div>
            <div style={{ ...font.sans, fontSize: 16, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>{company}</div>
            <div style={{ ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.55, marginTop: 8, maxWidth: 820 }}>
              <strong style={{ color: C.text }}>Shared horizontal axis</strong> below = fiscal periods in chronological order (not alphabetical). <strong style={{ color: C.text }}>Left</strong> = LLM communication scores (0–100, length-agnostic). <strong style={{ color: C.text }}>Right</strong> = deterministic rates per 1,000 words (fair QoQ/YoY). Gap in a right-panel line = missing Layer 2 for that quarter (re-analyze transcript).
            </div>
            {unparsable.length > 0 && (
              <div style={{ ...font.sans, fontSize: 10, color: C.amber, marginTop: 8, fontWeight: 600 }}>
                {unparsable.length} row(s) need <strong>Q1 2025</strong>-style labels for correct ordering and YoY pairing.
              </div>
            )}
          </div>
          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
            <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: "0.08em" }}>LATEST · OVERALL</div>
            <div style={{ ...font.sans, fontSize: 28, fontWeight: 800, color: ecScoreColor(latest?.overall_quality_score || 0), lineHeight: 1.1 }}>{latest?.overall_quality_score || 0}</div>
            {deltaLegacy != null && (
              <div style={{ ...font.sans, fontSize: 11, fontWeight: 600, color: deltaLegacy > 0 ? C.green : deltaLegacy < 0 ? C.red : C.textMuted, marginTop: 4 }}>
                {fmtEcDelta(deltaLegacy)} vs prior period
              </div>
            )}
            {deltaLegacy != null && Math.abs(deltaLegacy) >= 15 && (
              <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.red, marginTop: 6 }}>Large move vs prior</div>
            )}
          </div>
        </div>
      </div>

      {showDualCharts && (
        <div style={{ padding: "12px 14px 16px", background: C.white }}>
          <div style={{ ...font.sans, fontSize: 10, fontWeight: 800, color: C.textSec, letterSpacing: "0.1em", marginBottom: 10, paddingLeft: 4 }}>
            DUAL PANEL · SAME QUARTERS · LEFT = QUALITY SCORES · RIGHT = LEXICAL RATES
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 14,
              alignItems: "stretch",
            }}
            className="ec-compare-chart-grid"
          >
            {/* Panel A */}
            <div style={{ border: `1px solid ${C.borderLight}`, borderRadius: 10, overflow: "hidden", minWidth: 0, background: C.white, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "10px 14px", background: C.nested, borderBottom: `1px solid ${C.borderLight}` }}>
                <div style={{ ...font.sans, fontSize: 11, fontWeight: 800, color: C.text, letterSpacing: "0.06em" }}>PANEL A — LINGUISTIC QUALITY (LLM)</div>
                <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginTop: 3, lineHeight: 1.4 }}>
                  Vertical axis: 0–100. <span style={{ fontWeight: 700, color }}>Solid</span> = overall. <span style={{ color: C.textMuted }}>Dashed</span> = five sub-dimensions (same hue, de-emphasized).
                </div>
              </div>
              <div style={{ height: 268, padding: "4px 8px 0", width: "100%" }}>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={unifiedTimeline} margin={{ top: 12, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid {...EC_CHART_GRID} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.textSec }} stroke={C.border} tickLine={false} axisLine={{ stroke: C.border }} interval={0} angle={unifiedTimeline.length > 5 ? -32 : 0} textAnchor={unifiedTimeline.length > 5 ? "end" : "middle"} height={unifiedTimeline.length > 5 ? 52 : 28} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: C.textMuted }} stroke={C.border} width={36} tickLine={false} axisLine={false} ticks={[0, 25, 50, 75, 100]} />
                    <Tooltip content={<EcCompareTooltipL1 timeline={unifiedTimeline} />} />
                    <ReferenceLine y={50} stroke={C.borderLight} strokeDasharray="4 4" />
                    <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} iconType="line" />
                    <Line type="monotone" dataKey="score" stroke={color} strokeWidth={2.8} dot={{ fill: color, r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6 }} name="Overall" />
                    {EC_SCORE_DEFS.map((d) => (
                      <Line key={d.short} type="monotone" dataKey={d.short} stroke={color} strokeWidth={1.2} strokeDasharray="5 4" dot={false} strokeOpacity={0.22} connectNulls name={d.short} legendType="none" />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* Panel B */}
            <div style={{ border: `1px solid ${C.borderLight}`, borderRadius: 10, overflow: "hidden", minWidth: 0, background: C.white, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "10px 14px", background: C.nested, borderBottom: `1px solid ${C.borderLight}` }}>
                <div style={{ ...font.sans, fontSize: 11, fontWeight: 800, color: C.text, letterSpacing: "0.06em" }}>PANEL B — LEXICAL INTENSITY (RULE-BASED)</div>
                <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginTop: 3, lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 700, color: C.text }}>Left Y:</span> hits or phrases per 1,000 words (AI, forward, uncertainty). <span style={{ fontWeight: 700, color: C.text }}>Right Y:</span> LM-style finance lexicon net per 1k (bearish ↓ / bullish ↑). Gray line = 0 net.
                </div>
              </div>
              <div style={{ height: 268, padding: "4px 8px 0", width: "100%" }}>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={unifiedTimeline} margin={{ top: 12, right: 4, left: 0, bottom: 8 }}>
                    <CartesianGrid {...EC_CHART_GRID} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.textSec }} stroke={C.border} tickLine={false} axisLine={{ stroke: C.border }} interval={0} angle={unifiedTimeline.length > 5 ? -32 : 0} textAnchor={unifiedTimeline.length > 5 ? "end" : "middle"} height={unifiedTimeline.length > 5 ? 52 : 28} />
                    <YAxis yAxisId="left" domain={[0, Math.ceil(rateMax * 1.15)]} tick={{ fontSize: 9, fill: C.textMuted }} stroke={C.border} width={34} tickLine={false} axisLine={false} label={{ value: "Per 1k words", angle: -90, position: "insideLeft", offset: 8, style: { fill: C.textMuted, fontSize: 9, fontWeight: 600 } }} />
                    <YAxis yAxisId="right" orientation="right" domain={[-lexMax, lexMax]} tick={{ fontSize: 9, fill: C.textMuted }} stroke={C.border} width={34} tickLine={false} axisLine={false} label={{ value: "Lex net / 1k", angle: 90, position: "insideRight", offset: 8, style: { fill: C.textMuted, fontSize: 9, fontWeight: 600 } }} />
                    <Tooltip content={<EcCompareTooltipL2 timeline={unifiedTimeline} />} />
                    <ReferenceLine yAxisId="right" y={0} stroke={C.border} strokeWidth={1.5} />
                    <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} iconType="line" />
                    <Line yAxisId="left" type="monotone" dataKey="aiPer1k" name="AI / 1k" stroke={color} strokeWidth={2.6} dot={{ fill: color, r: 3.5, strokeWidth: 2, stroke: "#fff" }} connectNulls={false} activeDot={{ r: 5 }} />
                    <Line yAxisId="left" type="monotone" dataKey="fwd1k" name="Forward / 1k" stroke={C.cyan} strokeWidth={1.8} dot={{ r: 2.5, fill: C.cyan }} connectNulls={false} />
                    <Line yAxisId="left" type="monotone" dataKey="unc1k" name="Uncertainty / 1k" stroke={C.amber} strokeWidth={1.8} dot={{ r: 2.5, fill: C.amber }} connectNulls={false} />
                    <Line yAxisId="right" type="monotone" dataKey="lexNet1k" name="Lex net / 1k" stroke={C.green} strokeWidth={2.4} dot={{ fill: C.green, r: 3.5, strokeWidth: 2, stroke: "#fff" }} connectNulls={false} activeDot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          <div style={{ ...font.sans, fontSize: 9.5, color: C.textMuted, lineHeight: 1.5, marginTop: 12, padding: "10px 12px", background: C.nested, borderRadius: 8, border: `1px solid ${C.borderLight}` }}>
            <strong style={{ color: C.text }}>Read across:</strong> the same quarter column applies to both panels. Use Panel A for narrative-quality regime; use Panel B for how much AI and macro language appears per unit of text (and coarse lexicon tone). Z-scores in the table below flag outliers vs this company&apos;s own saved history.
          </div>
        </div>
      )}

      {!showDualCharts && unifiedTimeline.length === 1 && (
        <div style={{ padding: 20, textAlign: "center", ...font.sans, fontSize: 12, color: C.textMuted }}>
          Add a second quarter for side-by-side trajectory charts.
        </div>
      )}

      <div style={{ overflowX: "auto", marginTop: 0, padding: "0 14px 16px" }}>
        <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase" }}>Quarter-by-quarter (fair metrics + QoQ / YoY)</div>
        <table style={{ width: "100%", minWidth: 1100, borderCollapse: "collapse", ...font.sans, fontSize: 10 }}>
          <thead>
            <tr style={{ textAlign: "left", color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: "6px 8px" }}>Quarter</th>
              <th style={{ padding: "6px 8px" }}>Words</th>
              <th style={{ padding: "6px 8px" }}>AI/1k</th>
              <th style={{ padding: "6px 8px" }}>AI %themes</th>
              <th style={{ padding: "6px 8px" }}>Lex+/1k</th>
              <th style={{ padding: "6px 8px" }}>Lex−/1k</th>
              <th style={{ padding: "6px 8px" }}>Net/1k</th>
              <th style={{ padding: "6px 8px" }}>Fwd/1k</th>
              <th style={{ padding: "6px 8px" }}>Unc/1k</th>
              <th style={{ padding: "6px 8px" }}>HHI</th>
              <th style={{ padding: "6px 8px" }}>Ov.</th>
              <th style={{ padding: "6px 8px" }}>QoQ Δ</th>
              <th style={{ padding: "6px 8px" }}>YoY Δ</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => {
              const q = e.layer2_quant;
              const fq = q?.cross_quarter_fairness;
              const qoqP = getQoQPeer(sorted, i);
              const yoyP = getYoYPeer(sorted, i);
              const dQ = qoqP ? compareFairMetrics(e, qoqP) : null;
              const dY = yoyP ? compareFairMetrics(e, yoyP) : null;
              return (
                <tr key={`${e.quarter}-${i}`} style={{ borderBottom: `1px solid ${C.borderLight}`, cursor: "pointer" }} onClick={() => { setEcResult(rawEntries.find((r) => r.quarter === e.quarter && r.company === e.company) || e); setEcTab("dashboard"); }}>
                  <td style={{ padding: "8px", fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>{e.quarter}{!e._pq ? " *" : ""}</td>
                  <td style={{ padding: "8px", ...font.mono }}>
                    {q?.word_count?.toLocaleString?.() ?? "—"}
                    {zBadge(e._z?.word_count)}
                  </td>
                  <td style={{ padding: "8px", ...font.mono }}>
                    {q?.ai_density_per_1000_words ?? "—"}
                    {zBadge(e._z?.ai_density_per_1000)}
                  </td>
                  <td style={{ padding: "8px", ...font.mono }}>{fq?.ai_share_of_theme_hits != null ? `${Math.round(fq.ai_share_of_theme_hits * 1000) / 10}%` : "—"}</td>
                  <td style={{ padding: "8px", ...font.mono }}>{fq?.lexicon_positive_per_1000 ?? "—"}</td>
                  <td style={{ padding: "8px", ...font.mono }}>{fq?.lexicon_negative_per_1000 ?? "—"}</td>
                  <td style={{ padding: "8px", ...font.mono }}>
                    {fq?.lexicon_net_per_1000 ?? "—"}
                    {zBadge(e._z?.lexicon_net_per_1000)}
                  </td>
                  <td style={{ padding: "8px", ...font.mono }}>{q?.forward_looking?.per_1000_words ?? "—"}</td>
                  <td style={{ padding: "8px", ...font.mono }}>{q?.uncertainty_language?.per_1000_words ?? "—"}</td>
                  <td style={{ padding: "8px", ...font.mono }}>{q?.theme_concentration?.herfindahl_hhi ?? "—"}</td>
                  <td style={{ padding: "8px", ...font.mono, fontWeight: 800, color: ecScoreColor(e.overall_quality_score || 0) }}>{e.overall_quality_score ?? "—"}</td>
                  <td style={{ padding: "8px", ...font.mono, fontSize: 9, lineHeight: 1.35, color: C.textSec, maxWidth: 120 }}>
                    {!dQ ? "—" : (
                      <>
                        <span style={{ color: C.text }}>Ov {fmtEcDelta(dQ.overall_score)}</span>
                        <br />
                        AI {fmtEcDelta(dQ.ai_density_per_1000)}
                        <br />
                        N/1k {fmtEcDelta(dQ.lexicon_net_per_1000)}
                      </>
                    )}
                  </td>
                  <td style={{ padding: "8px", ...font.mono, fontSize: 9, lineHeight: 1.35, color: C.textSec, maxWidth: 120 }}>
                    {!dY ? "—" : (
                      <>
                        <span style={{ color: C.text }}>Ov {fmtEcDelta(dY.overall_score)}</span>
                        <br />
                        AI {fmtEcDelta(dY.ai_density_per_1000)}
                        <br />
                        N/1k {fmtEcDelta(dY.lexicon_net_per_1000)}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 6, marginTop: 12 }}>
        {sorted.map((e) => (
          <div key={e.quarter} onClick={() => { setEcResult(rawEntries.find((r) => r.quarter === e.quarter && r.company === e.company) || e); setEcTab("dashboard"); }}
            style={{ textAlign: "center", padding: "6px 8px", borderRadius: 8, cursor: "pointer", border: `1px solid ${C.borderLight}`, background: C.nested }}>
            <div style={{ ...font.sans, fontSize: 10, fontWeight: 600, color: C.textSec }}>{e.quarter}</div>
            <div style={{ ...font.sans, fontSize: 16, fontWeight: 800, color: ecScoreColor(e.overall_quality_score || 0) }}>{e.overall_quality_score || 0}</div>
            <EcInvestmentSignalBadge signal={e.key_diagnostics?.investment_signal} />
            {e.layer2_quant && (
              <div style={{ ...font.sans, fontSize: 9, color: C.textMuted, marginTop: 4, lineHeight: 1.35 }}>
                AI {e.layer2_quant.ai_density_per_1000_words}/1k · net/1k {e.layer2_quant.cross_quarter_fairness?.lexicon_net_per_1000 ?? "—"}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EarningsCallPanel() {
  const [ecOpen, setEcOpen] = useState(false);
  const [ecTab, setEcTab] = useState("input");
  const [ecCompany, setEcCompany] = useState("GOOGL");
  const [ecCustomName, setEcCustomName] = useState("");
  const [ecQuarter, setEcQuarter] = useState("Q1");
  const [ecYear, setEcYear] = useState("2026");
  const [ecTranscript, setEcTranscript] = useState("");
  const [ecPriorTranscript, setEcPriorTranscript] = useState("");
  const [ecAnalyzing, setEcAnalyzing] = useState(false);
  const [ecProgress, setEcProgress] = useState(0);
  const [ecResult, setEcResult] = useState(null);
  const [ecError, setEcError] = useState(null);
  const [ecHistory, setEcHistory] = useState(() => ld("ec_history", []));
  const [ecSelectedScore, setEcSelectedScore] = useState(null);
  const [ecHighlightFilter, setEcHighlightFilter] = useState("all");

  const companyName = ecCompany === "CUSTOM" ? ecCustomName : EC_COMPANIES.find(c => c.id === ecCompany)?.name || ecCompany;
  const companyColor = EC_COMPANIES.find(c => c.id === ecCompany)?.color || C.cyan;

  const priorAnalysis = useMemo(() => {
    if (!ecResult) return null;
    return ecHistory.find(h => h.company === ecResult.company && h.quarter !== `${ecQuarter} ${ecYear}`);
  }, [ecResult, ecHistory, ecQuarter, ecYear]);

  const analyzeTranscript = useCallback(async () => {
    if (!ecTranscript || ecTranscript.length < 500) { setEcError("Transcript too short — full earnings calls are typically 8,000-15,000 words."); return; }
    const apiKey = ENV_KEYS.anthropic;
    if (!apiKey) { setEcError("Missing VITE_ANTHROPIC_API_KEY"); return; }
    setEcAnalyzing(true); setEcError(null); setEcProgress(0);
    const progressTimer = setInterval(() => setEcProgress(p => Math.min(95, p + 2)), 1000);
    try {
      const systemPrompt = `You are an expert in detecting management communication quality in earnings call transcripts. You analyze whether management teams are communicating from genuine operational knowledge or from narrative management.

Core thesis: management teams whose dominant focus is genuine operational reality produce measurably different language than management teams managing a narrative. Operationally-grounded management uses present-tense specifics, scales explanation to metric severity, volunteers bad news, and sounds identical across strong and weak quarters. Narrative-focused management uses future-tense aspiration, vague categorical claims, avoids specific predictions, and shifts register when the stock moves.

You MUST use web search to find:
1. The company's most recent financial results and guidance
2. Current stock price and recent performance
3. Any analyst commentary on this earnings call
4. Industry context for the quarter being analyzed

Analyze the transcript and score on five dimensions. Be rigorous — cite exact quotes. Return structured JSON only, no markdown, no preamble.

SECOND LAYER (institutional transcript NLP, in the same JSON object): Also fill "layer2_institutional" using buy-side-style judgment: (1) weight tone by financial materiality—guidance, margins, and demand matter more than generic platitudes; (2) score AI-related discussion separately in prepared remarks vs Q&A if both exist; (3) flag hedge-fund-style communication patterns (deflection, metric dodge, abrupt tone shift under analyst pressure); (4) extract named AI products/initiatives with POSITIVE/NEUTRAL/NEGATIVE tags and short evidence quotes. Align with current practice: lexicon baselines plus LLM nuance, topic importance, and your web-search context (RAG-like grounding).`;

      const priorCtx = ecPriorTranscript ? `\n\nPRIOR QUARTER TRANSCRIPT (for register consistency comparison):\n${ecPriorTranscript.slice(0, 8000)}` : "";

      const userPrompt = `Analyze this earnings call transcript for ${companyName} ${ecQuarter} ${ecYear}.

First, use web search to look up ${companyName}'s recent financial performance, stock price, and analyst reactions to this quarter's results. Then analyze the transcript.

Score each dimension 0-100 and provide 3-5 specific quote examples for each score with explanation.${priorCtx}

TRANSCRIPT:
${ecTranscript.slice(0, 30000)}

Return this exact JSON structure (no markdown fences, no text before/after — pure JSON only):
{
  "company": "${companyName}",
  "quarter": "${ecQuarter} ${ecYear}",
  "ticker": "${ecCompany !== "CUSTOM" ? ecCompany : ""}",
  "overall_quality_score": <number 0-100>,
  "overall_interpretation": "<2-3 sentence summary>",
  "scores": {
    "tense_distribution": {
      "score": <number>,
      "interpretation": "<string>",
      "operational_quotes": [{"quote": "<exact quote>", "explanation": "<why operational>"}],
      "narrative_quotes": [{"quote": "<exact quote>", "explanation": "<why narrative>"}]
    },
    "specificity_gradient": {
      "score": <number>,
      "interpretation": "<string>",
      "specific_quotes": [{"quote": "<string>", "claim_significance": "<HIGH/MEDIUM/LOW>", "specificity_level": "<HIGH/MEDIUM/LOW>", "explanation": "<string>"}],
      "vague_quotes": [{"quote": "<string>", "claim_significance": "<HIGH/MEDIUM/LOW>", "specificity_level": "<HIGH/MEDIUM/LOW>", "explanation": "<string>"}]
    },
    "sincerity_signal": {
      "score": <number>,
      "interpretation": "<string>",
      "volunteered_bad_news": [{"quote": "<string>", "explanation": "<string>"}],
      "error_acknowledgments": [{"quote": "<string>", "explanation": "<string>"}],
      "superlative_inflation": [{"quote": "<string>", "explanation": "<string>"}],
      "specific_predictions": [{"quote": "<string>", "uncertainty_acknowledged": <boolean>, "explanation": "<string>"}]
    },
    "absorption_failure": {
      "score": <number>,
      "interpretation": "<string>",
      "healthy_scaling_examples": [{"quote": "<string>", "metric_severity": "<HIGH/MEDIUM/LOW>", "explanation_length": "<PROPORTIONAL/BRIEF/EXTENSIVE>", "explanation": "<string>"}],
      "failure_signals": [{"quote": "<string>", "metric_severity": "<HIGH/MEDIUM/LOW>", "explanation_length": "<PROPORTIONAL/BRIEF/EXTENSIVE>", "explanation": "<string>"}]
    },
    "register_consistency": {
      "score": <number>,
      "note": "${ecPriorTranscript ? "Comparative analysis with prior quarter" : "Single transcript only — baseline register markers captured"}",
      "register_markers": [{"quote": "<string>", "register_type": "<OPERATIONAL/NARRATIVE/MIXED>", "explanation": "<string>"}]
    }
  },
  "key_diagnostics": {
    "strongest_operational_signal": "<string>",
    "strongest_narrative_signal": "<string>",
    "qa_vs_prepared_divergence": "<string describing prepared remarks vs Q&A differences>",
    "overall_communication_diagnosis": "<string>",
    "nrr_trajectory_prediction": "<string>",
    "investment_signal": "<LONG_SIGNAL|SHORT_SIGNAL|WATCH|NEUTRAL>",
    "stock_context": "<current stock info from web search>",
    "analyst_sentiment": "<recent analyst commentary from web search>"
  },
  "highlighted_transcript": [
    {"text": "<sentence or phrase from transcript>", "classification": "<OPERATIONAL|NARRATIVE|NEUTRAL>", "signal_type": "<tense|specificity|sincerity|absorption>", "explanation": "<string>"}
  ],
  "layer2_institutional": {
    "ai_investment_thesis_tone": "<BULLISH|CONSTRUCTIVE|NEUTRAL|CAUTIOUS|BEARISH>",
    "ai_thesis_rationale": "<2-4 sentences: AI revenue, capex, competition, regulation>",
    "prepared_remarks_ai_sentiment": <integer -100 to 100, bullish positive for AI-related content only>,
    "qa_session_ai_sentiment": <integer -100 to 100 or null if Q&A not found>,
    "topic_weighted_financial_sentiment": "<1-2 sentences: which themes dominated—pricing, demand, capex, regulation, etc.>",
    "forward_looking_strength_0_100": <integer 0-100, higher = more concrete forward statements>,
    "hedge_fund_style_flags": ["<max 6 short strings: deflection, dodge, tone break, etc.>"],
    "ai_capex_vs_revenue_framing": "<how management balances AI spend vs monetization>",
    "named_initiatives": [{"name": "<string>", "sentiment": "<POSITIVE|NEUTRAL|NEGATIVE>", "evidence_quote": "<short exact quote>"}]
  }
}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        }),
      });
      if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 180)}`);
      const js = await res.json();
      const textBlocks = (js?.content || []).filter(c => c.type === "text").map(c => c.text || "").join("\n").trim();
      const jsonMatch = textBlocks.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Claude did not return valid JSON. Response preview: " + textBlocks.slice(0, 200));
      const parsed = JSON.parse(jsonMatch[0]);
      parsed.analyzed_at = new Date().toISOString();
      try {
        parsed.layer2_quant = computeEarningsTranscriptLayer2(ecTranscript);
      } catch {
        parsed.layer2_quant = null;
      }
      setEcResult(parsed);
      setEcTab("dashboard");
      setEcProgress(100);

      const updated = [parsed, ...ecHistory.filter(h => !(h.company === parsed.company && h.quarter === parsed.quarter))].slice(0, 40);
      setEcHistory(updated);
      sv("ec_history", updated);
    } catch (e) {
      setEcError(e.message);
    } finally {
      clearInterval(progressTimer);
      setEcAnalyzing(false);
    }
  }, [ecTranscript, ecPriorTranscript, companyName, ecCompany, ecQuarter, ecYear, ecHistory]);

  const handleFileUpload = (e, target) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const setter = target === "main" ? setEcTranscript : setEcPriorTranscript;
    const reader = new FileReader();
    reader.onload = (ev) => setter(ev.target.result);
    reader.readAsText(file);
  };

  const scoreData = ecResult?.scores || {};
  const diagData = ecResult?.key_diagnostics || {};

  const tabs = [
    { id: "input", label: "Transcript Input" },
    { id: "dashboard", label: "Analysis Dashboard" },
    { id: "evidence", label: "Evidence Panel" },
    { id: "compare", label: "Comparative View" },
  ];

  if (!ecOpen) {
    return (
      <Card style={{ cursor: "pointer", transition: "border-color .15s, box-shadow .15s" }} className="metric-card" onClick={() => setEcOpen(true)}>
        <SectionHeader
          icon={<IcoC name="layers" size={18} color={C.textSec} />}
          title="LLM Earnings Call Analyzer"
          subtitle="Detect whether management is communicating from operational reality or managing a narrative."
          badge={ecHistory.length > 0 ? <Badge color={C.textSec} bg={C.nested} size="sm">{ecHistory.length} analyzed</Badge> : null}
        />
        <div style={{ ...font.sans, fontSize:11.5, color: C.textSec, lineHeight: 1.6, marginBottom: 10, maxWidth: 800 }}>
          Upload or paste a full earnings call transcript. Claude analyzes the language on <strong style={{color:C.text}}>5 dimensions</strong> (communication quality), plus <strong style={{color:C.text}}>Layer 2</strong>: deterministic theme concentration, LM-style lexicon tone, forward-looking/uncertainty density, and an institutional LLM read (AI thesis tone, Q&A vs prepared, hedge-fund-style flags).
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginBottom: 12 }}>
          {[
            { name: "Tense Distribution", desc: "Present-tense specifics (operational) vs future-tense aspiration (narrative)" },
            { name: "Specificity Gradient", desc: "Do claims get more or less specific as significance increases?" },
            { name: "Sincerity Signal", desc: "Volunteered bad news and error acknowledgment vs superlative inflation" },
            { name: "Absorption Failure", desc: "Does explanation scale proportionally with metric severity?" },
            { name: "Register Consistency", desc: "Does language shift between strong and weak quarters?" },
          ].map(d => (
            <div key={d.name} style={{ padding: "8px 10px", background: C.nested, borderRadius: 6, border: `1px solid ${C.borderLight}` }}>
              <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 2 }}>{d.name}</div>
              <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, lineHeight: 1.4 }}>{d.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ ...font.sans, fontSize: 10.5, color: C.textMuted, lineHeight: 1.5, marginBottom: 10 }}>
          Each dimension scored 0–100 with exact quote evidence. Outputs an overall quality score, investment signal (LONG / SHORT / WATCH / NEUTRAL), and cross-quarter trajectory tracking. Claude also web-searches live stock prices, analyst reactions, and financial context for the company analyzed.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {EC_COMPANIES.filter(c => c.id !== "CUSTOM").map(c => (
            <span key={c.id} style={{ ...font.sans, fontSize: 11, padding: "3px 10px", borderRadius: 4, background: C.nested, color: C.textSec, fontWeight: 600 }}>{c.id}</span>
          ))}
          <span style={{ ...font.sans, fontSize: 10.5, color: C.textMuted, marginLeft: 4 }}>or any custom company</span>
          <span style={{ ...font.sans, fontSize: 11, fontWeight: 600, color: C.cyan, marginLeft: "auto" }}>Open analyzer &rarr;</span>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IcoC name="layers" size={18} color={C.purple} />
          <div>
            <div style={{ ...font.sans, fontSize: 14, fontWeight: 700, color: C.text }}>LLM Earnings Call Analyzer</div>
            <div style={{ ...font.sans, fontSize: 11, color: C.textMuted }}>Layer 1: five linguistic dimensions. Layer 2: quant mention/sentiment + institutional LLM transcript read.</div>
          </div>
        </div>
        <Btn size="sm" variant="ghost" onClick={() => setEcOpen(false)}>Collapse</Btn>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.nested }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setEcTab(t.id)} style={{ ...font.sans, flex: 1, fontSize: 12, fontWeight: 600, padding: "10px 12px", cursor: "pointer", background: ecTab === t.id ? C.white : "transparent", border: "none", borderBottom: ecTab === t.id ? `2px solid ${C.purple}` : "2px solid transparent", color: ecTab === t.id ? C.text : C.textMuted, transition: "all .15s" }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding: "16px 20px" }}>
        {/* ── INPUT TAB ── */}
        {ecTab === "input" && (
          <div className="fade-in">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ ...font.sans, fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4, display: "block" }}>Company</label>
                <select value={ecCompany} onChange={e => setEcCompany(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}` }}>
                  {EC_COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {ecCompany === "CUSTOM" && <input value={ecCustomName} onChange={e => setEcCustomName(e.target.value)} placeholder="Company name" style={{ width: "100%", marginTop: 6, fontSize: 12, padding: "6px 10px" }} />}
              </div>
              <div>
                <label style={{ ...font.sans, fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4, display: "block" }}>Quarter</label>
                <select value={ecQuarter} onChange={e => setEcQuarter(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}` }}>
                  {["Q1", "Q2", "Q3", "Q4"].map(q => <option key={q} value={q}>{q}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...font.sans, fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4, display: "block" }}>Year</label>
                <select value={ecYear} onChange={e => setEcYear(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}` }}>
                  {["2024", "2025", "2026"].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ ...font.sans, fontSize: 11, fontWeight: 600, color: C.textSec }}>Earnings Call Transcript</label>
                <label style={{ ...font.sans, fontSize: 11, fontWeight: 600, color: C.text, cursor: "pointer", padding: "4px 12px", border: `1.5px solid ${C.border}`, borderRadius: 6, background: C.white, display: "inline-flex", alignItems: "center", gap: 5, transition: "border-color .15s" }}>
                  <IcoC name="cloudUp" size={13} color={C.textSec} />
                  <input type="file" accept=".txt,.md,.csv,.rtf,.html,.json,.pdf" onChange={e => handleFileUpload(e, "main")} style={{ display: "none" }} /> Upload file
                </label>
              </div>
              <div
                style={{ position: "relative", borderRadius: 8, border: `1.5px dashed ${C.border}`, background: C.white, transition: "border-color .2s" }}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.cyan; }}
                onDragLeave={e => { e.currentTarget.style.borderColor = C.border; }}
                onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.border; const f = e.dataTransfer.files?.[0]; if (f) { const r = new FileReader(); r.onload = ev => setEcTranscript(ev.target.result); r.readAsText(f); } }}
              >
                <textarea value={ecTranscript} onChange={e => setEcTranscript(e.target.value)}
                  placeholder="Paste the full earnings call transcript here, or drag & drop a file (.txt, .md, .csv, .rtf, .pdf)..."
                  style={{ width: "100%", minHeight: 200, fontSize: 12, padding: "10px 14px", borderRadius: 8, border: "none", resize: "vertical", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6, background: "transparent" }} />
                {!ecTranscript && (
                  <div style={{ position: "absolute", bottom: 12, left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
                    <div style={{ ...font.sans, fontSize: 11, color: C.textMuted }}>
                      <IcoC name="cloudUp" size={16} color={C.textMuted} style={{ verticalAlign: "middle", marginRight: 6 }} />
                      Drag &amp; drop a transcript file here
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>Accepts .txt, .md, .csv, .rtf, .pdf — or paste text directly</span>
                <span style={{ ...font.mono, fontSize: 10, color: ecTranscript.length > 500 ? C.green : C.textMuted }}>{ecTranscript.split(/\s+/).filter(Boolean).length.toLocaleString()} words</span>
              </div>
            </div>

            <details style={{ marginBottom: 14 }}>
              <summary style={{ ...font.sans, fontSize: 11, color: C.textSec, cursor: "pointer" }}>Prior quarter transcript (optional — enables register consistency scoring)</summary>
              <div style={{ marginTop: 6 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                  <label style={{ ...font.sans, fontSize: 11, color: C.cyan, cursor: "pointer" }}>
                    <input type="file" accept=".txt,.md,.csv,.rtf,.html,.json" onChange={e => handleFileUpload(e, "prior")} style={{ display: "none" }} /> Upload file
                  </label>
                </div>
                <textarea value={ecPriorTranscript} onChange={e => setEcPriorTranscript(e.target.value)}
                  placeholder="Paste the prior quarter's transcript for register comparison..."
                  style={{ width: "100%", minHeight: 100, fontSize: 12, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.border}`, resize: "vertical", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }} />
              </div>
            </details>

            {ecError && <div style={{ ...font.sans, fontSize: 12, color: C.red, padding: "10px 14px", background: C.redBg, borderRadius: 8, marginBottom: 10 }}>{ecError}</div>}

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Btn variant="primary" size="sm" onClick={analyzeTranscript} disabled={ecAnalyzing || ecTranscript.length < 100}>
                {ecAnalyzing ? <><Spinner size={11} color="#fff" /> Analyzing ({Math.round(ecProgress)}%)</> : <><IcoC name="zap" size={12} color="#fff" /> Analyze Transcript</>}
              </Btn>
              {ecAnalyzing && (
                <div style={{ flex: 1, height: 6, background: C.nested, borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${ecProgress}%`, background: C.purple, transition: "width .5s" }} />
                </div>
              )}
            </div>

            {ecHistory.length > 0 && (
              <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Previous Analyses</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                  {ecHistory.slice(0, 12).map((h, i) => (
                    <div key={i} onClick={() => { setEcResult(h); setEcTab("dashboard"); }}
                      style={{ padding: "10px 12px", border: `1px solid ${C.borderLight}`, borderRadius: 10, cursor: "pointer", background: C.white, transition: "border-color .15s" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text }}>{h.company}</span>
                        <span style={{ ...font.sans, fontSize: 18, fontWeight: 800, color: ecScoreColor(h.overall_quality_score) }}>{h.overall_quality_score}</span>
                      </div>
                      <div style={{ ...font.sans, fontSize: 11, color: C.textMuted }}>{h.quarter}</div>
                      <div style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>{h.analyzed_at ? new Date(h.analyzed_at).toLocaleDateString() : ""}</div>
                    </div>
                  ))}
                </div>
                <Btn size="sm" variant="ghost" style={{ marginTop: 8 }} onClick={() => { if (confirm("Clear all earnings call history?")) { setEcHistory([]); sv("ec_history", []); } }}>Clear History</Btn>
              </div>
            )}
          </div>
        )}

        {/* ── DASHBOARD TAB ── */}
        {ecTab === "dashboard" && ecResult && (
          <div className="fade-in">
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
              {/* Left: overall gauge + signal */}
              <div style={{ flex: "0 0 auto", textAlign: "center" }}>
                <EcScoreGauge score={ecResult.overall_quality_score || 0} size={160} />
                <div style={{ marginTop: 8 }}><EcInvestmentSignalBadge signal={diagData.investment_signal} /></div>
                <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: companyColor, marginTop: 8 }}>{ecResult.company}</div>
                <div style={{ ...font.sans, fontSize: 11, color: C.textMuted }}>{ecResult.quarter}</div>
              </div>

              {/* Center: radar chart */}
              <div style={{ flex: 1, minWidth: 280 }}>
                <EcRadarChart analysis={ecResult} priorAnalysis={priorAnalysis} />
              </div>

              {/* Right: diagnostics */}
              <div style={{ flex: "0 0 280px" }}>
                <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.textSec, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Key Diagnostics</div>
                {diagData.stock_context && <div style={{ ...font.sans, fontSize: 11, color: C.text, marginBottom: 6, padding: "6px 10px", background: C.nested, borderRadius: 6 }}><strong>Stock:</strong> {diagData.stock_context}</div>}
                {diagData.nrr_trajectory_prediction && <div style={{ ...font.sans, fontSize: 11, color: C.text, marginBottom: 6, padding: "6px 10px", background: C.nested, borderRadius: 6 }}><strong>NRR Trajectory:</strong> {diagData.nrr_trajectory_prediction}</div>}
                {diagData.qa_vs_prepared_divergence && <div style={{ ...font.sans, fontSize: 11, color: C.text, marginBottom: 6, padding: "6px 10px", background: C.nested, borderRadius: 6 }}><strong>Q&A vs Prepared:</strong> {diagData.qa_vs_prepared_divergence}</div>}
                {diagData.analyst_sentiment && <div style={{ ...font.sans, fontSize: 11, color: C.text, marginBottom: 6, padding: "6px 10px", background: C.nested, borderRadius: 6 }}><strong>Analysts:</strong> {diagData.analyst_sentiment}</div>}
                {diagData.strongest_operational_signal && <div style={{ ...font.sans, fontSize: 11, color: C.green, marginBottom: 4, padding: "6px 10px", background: C.greenBg, borderRadius: 6 }}><strong>Best Signal:</strong> {diagData.strongest_operational_signal}</div>}
                {diagData.strongest_narrative_signal && <div style={{ ...font.sans, fontSize: 11, color: C.red, marginBottom: 4, padding: "6px 10px", background: C.redBg, borderRadius: 6 }}><strong>Worst Signal:</strong> {diagData.strongest_narrative_signal}</div>}
              </div>
            </div>

            {/* Overall interpretation */}
            {ecResult.overall_interpretation && (
              <div style={{ padding: "12px 16px", background: C.nested, borderRadius: 10, marginBottom: 16, borderLeft: `4px solid ${ecScoreColor(ecResult.overall_quality_score)}` }}>
                <div style={{ ...font.sans, fontSize: 13, color: C.text, lineHeight: 1.6 }}>{ecResult.overall_interpretation}</div>
              </div>
            )}

            <EcLayer2Panel quant={ecResult.layer2_quant} institutional={ecResult.layer2_institutional} />

            {/* Five score cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
              {EC_SCORE_DEFS.map(def => {
                const s = scoreData[def.id];
                if (!s) return null;
                const selected = ecSelectedScore === def.id;
                return (
                  <div key={def.id} onClick={() => setEcSelectedScore(selected ? null : def.id)}
                    style={{ padding: "14px 16px", border: `1px solid ${selected ? C.purple : C.borderLight}`, borderRadius: 12, cursor: "pointer", background: C.white, transition: "border-color .15s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.textSec }}>{def.short}</div>
                      <div style={{ ...font.sans, fontSize: 22, fontWeight: 800, color: ecScoreColor(s.score) }}>{s.score}</div>
                    </div>
                    <div style={{ height: 4, background: C.nested, borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${s.score}%`, background: ecScoreColor(s.score), transition: "width .5s" }} />
                    </div>
                    <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>{def.desc}</div>
                  </div>
                );
              })}
            </div>

            {/* Expanded score detail */}
            {ecSelectedScore && scoreData[ecSelectedScore] && (
              <div className="fade-in" style={{ padding: "14px 18px", background: C.nested, borderRadius: 12, border: `1px solid ${C.purple}22`, marginBottom: 16 }}>
                <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>{EC_SCORE_DEFS.find(d => d.id === ecSelectedScore)?.label}</div>
                <div style={{ ...font.sans, fontSize: 12, color: C.textSec, lineHeight: 1.55, marginBottom: 10 }}>{scoreData[ecSelectedScore].interpretation}</div>
                {ecSelectedScore === "tense_distribution" && (<>
                  {(scoreData.tense_distribution.operational_quotes || []).map((q, i) => <EcQuoteCard key={`op${i}`} quote={q.quote} explanation={q.explanation} type="operational" />)}
                  {(scoreData.tense_distribution.narrative_quotes || []).map((q, i) => <EcQuoteCard key={`nr${i}`} quote={q.quote} explanation={q.explanation} type="narrative" />)}
                </>)}
                {ecSelectedScore === "specificity_gradient" && (<>
                  {(scoreData.specificity_gradient.specific_quotes || []).map((q, i) => <EcQuoteCard key={`sp${i}`} quote={q.quote} explanation={q.explanation} type="specific" claimSig={q.claim_significance} specLevel={q.specificity_level} />)}
                  {(scoreData.specificity_gradient.vague_quotes || []).map((q, i) => <EcQuoteCard key={`vg${i}`} quote={q.quote} explanation={q.explanation} type="vague" claimSig={q.claim_significance} specLevel={q.specificity_level} />)}
                </>)}
                {ecSelectedScore === "sincerity_signal" && (<>
                  <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 4, textTransform: "uppercase" }}>Volunteered Bad News</div>
                  {(scoreData.sincerity_signal.volunteered_bad_news || []).map((q, i) => <EcQuoteCard key={`bn${i}`} quote={q.quote} explanation={q.explanation} type="operational" />)}
                  <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 4, marginTop: 8, textTransform: "uppercase" }}>Error Acknowledgments</div>
                  {(scoreData.sincerity_signal.error_acknowledgments || []).map((q, i) => <EcQuoteCard key={`ea${i}`} quote={q.quote} explanation={q.explanation} type="operational" />)}
                  <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 4, marginTop: 8, textTransform: "uppercase" }}>Superlative Inflation</div>
                  {(scoreData.sincerity_signal.superlative_inflation || []).map((q, i) => <EcQuoteCard key={`si${i}`} quote={q.quote} explanation={q.explanation} type="narrative" />)}
                  <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 4, marginTop: 8, textTransform: "uppercase" }}>Specific Predictions</div>
                  {(scoreData.sincerity_signal.specific_predictions || []).map((q, i) => <EcQuoteCard key={`pr${i}`} quote={q.quote} explanation={q.explanation} type={q.uncertainty_acknowledged ? "operational" : "narrative"} />)}
                </>)}
                {ecSelectedScore === "absorption_failure" && (<>
                  <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 4, textTransform: "uppercase" }}>Healthy Scaling</div>
                  {(scoreData.absorption_failure.healthy_scaling_examples || []).map((q, i) => <EcQuoteCard key={`hs${i}`} quote={q.quote} explanation={q.explanation} type="healthy" claimSig={q.metric_severity} specLevel={q.explanation_length} />)}
                  <div style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 4, marginTop: 8, textTransform: "uppercase" }}>Failure Signals</div>
                  {(scoreData.absorption_failure.failure_signals || []).map((q, i) => <EcQuoteCard key={`fs${i}`} quote={q.quote} explanation={q.explanation} type="failure" claimSig={q.metric_severity} specLevel={q.explanation_length} />)}
                </>)}
                {ecSelectedScore === "register_consistency" && (<>
                  <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginBottom: 8 }}>{scoreData.register_consistency.note}</div>
                  {(scoreData.register_consistency.register_markers || []).map((q, i) => <EcQuoteCard key={`rm${i}`} quote={q.quote} explanation={q.explanation} type={q.register_type === "OPERATIONAL" ? "operational" : q.register_type === "NARRATIVE" ? "narrative" : "mixed"} />)}
                </>)}
              </div>
            )}
          </div>
        )}

        {ecTab === "dashboard" && !ecResult && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: C.textMuted }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No analysis yet</div>
            <div style={{ fontSize: 12, marginBottom: 12 }}>Paste a transcript in the Input tab and click Analyze</div>
            <Btn size="sm" onClick={() => setEcTab("input")}>Go to Input</Btn>
          </div>
        )}

        {/* ── EVIDENCE TAB ── */}
        {ecTab === "evidence" && ecResult && (
          <div className="fade-in">
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {[{ id: "all", label: "All" }, { id: "operational", label: "Operational", color: C.green }, { id: "narrative", label: "Narrative", color: C.red }].map(f => (
                <button key={f.id} onClick={() => setEcHighlightFilter(f.id)}
                  style={{ ...font.sans, fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 6, cursor: "pointer", border: `1px solid ${ecHighlightFilter === f.id ? (f.color || C.purple) : C.borderLight}`, background: ecHighlightFilter === f.id ? (f.color || C.purple) + "14" : C.white, color: ecHighlightFilter === f.id ? (f.color || C.purple) : C.textMuted }}>{f.label}</button>
              ))}
            </div>

            <div style={{ maxHeight: 600, overflowY: "auto", padding: "2px 0" }}>
              {(ecResult.highlighted_transcript || [])
                .filter(h => ecHighlightFilter === "all" || h.classification?.toLowerCase() === ecHighlightFilter)
                .map((h, i) => {
                  const cls = h.classification?.toLowerCase();
                  const borderColor = cls === "operational" ? C.green : cls === "narrative" ? C.red : C.borderLight;
                  const bgColor = cls === "operational" ? C.greenBg : cls === "narrative" ? C.redBg : C.nested;
                  return (
                    <div key={i} style={{ borderLeft: `3px solid ${borderColor}`, padding: "8px 14px", marginBottom: 6, background: bgColor, borderRadius: "0 8px 8px 0" }}>
                      <div style={{ ...font.sans, fontSize: 12, color: C.text, lineHeight: 1.55 }}>"{h.text}"</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                        <span style={{ ...font.sans, fontSize: 10, fontWeight: 700, color: borderColor }}>{h.classification}</span>
                        {h.signal_type && <span style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>{h.signal_type}</span>}
                      </div>
                      {h.explanation && <div style={{ ...font.sans, fontSize: 11, color: C.textSec, marginTop: 3, lineHeight: 1.4 }}>{h.explanation}</div>}
                    </div>
                  );
                })}
              {(!ecResult.highlighted_transcript || ecResult.highlighted_transcript.length === 0) && (
                <div style={{ ...font.sans, fontSize: 12, color: C.textMuted, textAlign: "center", padding: 20 }}>No highlighted segments available</div>
              )}
            </div>
          </div>
        )}

        {ecTab === "evidence" && !ecResult && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: C.textMuted }}>
            <div style={{ fontSize: 12 }}>Run an analysis first to see evidence</div>
          </div>
        )}

        {/* ── COMPARE TAB ── */}
        {ecTab === "compare" && (
          <div className="fade-in">
            {ecHistory.length < 2 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: C.textMuted }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Analyze at least 2 transcripts to compare</div>
                <div style={{ fontSize: 12 }}>Use the same company name and <strong style={{ color: C.text }}>Q1 2025</strong>-style labels for YoY pairing and correct chronological order.</div>
              </div>
            ) : (
              <>
                {(() => {
                  const byCompany = {};
                  ecHistory.forEach((h) => {
                    const k = h.company || "Unknown";
                    if (!byCompany[k]) byCompany[k] = [];
                    byCompany[k].push(h);
                  });
                  return Object.entries(byCompany).map(([company, entries]) => (
                    <EcCompanyTemporalCompare
                      key={company}
                      company={company}
                      rawEntries={entries}
                      color={EC_COMPANIES.find((c) => c.name === company || c.id === company)?.color || C.cyan}
                      setEcResult={setEcResult}
                      setEcTab={setEcTab}
                    />
                  ));
                })()}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── ALERT FEED (redesigned) ──────────────────────────────────────────────────

function AlertFeed({alerts,onPin}){
  const sorted=[...alerts.filter(a=>a.pinned),...alerts.filter(a=>!a.pinned)].slice(0,20);
  const sevC={amber:C.amber,red:C.red,cyan:C.cyan,green:C.green};
  const sevDot=(sev)=><span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:sevC[sev]||C.textMuted,flexShrink:0,marginTop:4}}/>;
  if(sorted.length===0)return null;
  return(<Card>
    <SectionHeader icon={<IcoC name="zap" size={18} color={C.amber}/>} title="Divergence Alerts" subtitle="" badge={<Badge color={C.amber} bg={C.amberBg} size="sm">{sorted.length} active</Badge>}/>
    <div style={{maxHeight:240,overflowY:"auto"}}>{sorted.map(a=>(<div key={a.id} className="fade-in" style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",marginBottom:6,borderRadius:10,background:sevC[a.severity]?sevC[a.severity]+"08":"transparent",border:`1px solid ${sevC[a.severity]?sevC[a.severity]+"22":C.borderLight}`}}>
      {sevDot(a.severity)}
      <div style={{flex:1}}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
          <Badge color={sevC[a.severity]||C.textMuted} size="sm">{a.vertical}</Badge>
          <span style={{...font.sans,fontSize:11,color:C.textMuted}}>{new Date(a.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
        </div>
        <div style={{...font.sans,fontSize:13,color:C.text,lineHeight:1.4}}>{a.text}</div>
      </div>
      <button onClick={()=>onPin(a.id)} style={{background:"none",border:"none",cursor:"pointer",color:a.pinned?C.amber:C.textMuted,padding:4}} title={a.pinned?"Unpin":"Pin"}><IcoC name="pin" size={14} color={a.pinned?C.amber:C.textMuted}/></button>
    </div>))}</div>
  </Card>);
}

function convictionLabel(d) {
  if (!d) return { text: "Insufficient history", color: C.textMuted };
  const high = d.velocitySlope > 0 && d.accelerationScore > 0 && d.anomalyZ > 2 && d.monthsAbove2xBaseline >= 6;
  if (high) return { text: "HIGH CONVICTION", color: C.green };
  const med = d.velocitySlope > 0 && d.anomalyZ > 1;
  if (med) return { text: "BUILDING", color: C.amber };
  return { text: "EARLY / MIXED", color: C.textMuted };
}
function accelText(a) { return a > 0.5 ? "Accelerating ↑↑" : a < -0.5 ? "Decelerating ↓" : "Steady →"; }

function HistorySummaryCard({ vertical, hist, patternMatch }) {
  if (!hist?.derived) return null;
  const d = hist.derived;
  const c = convictionLabel(d);
  return (
    <Card style={{marginBottom:12,padding:14,borderLeft:`4px solid ${vertical.color||C.cyan}`}}>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12}}>
        <div>
          <div style={{...font.sans,fontSize:14,fontWeight:800,color:C.text,marginBottom:8}}>{vertical.name}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div style={{fontSize:12,color:C.textSec}}>Baseline Index: <b style={{color:C.text}}>{Math.round(d.currentVsBaseline*100)}</b> ({d.currentVsBaseline.toFixed(1)}x)</div>
            <div style={{fontSize:12,color:C.textSec}}>Velocity: <b style={{color:C.text}}>{d.velocitySlope>=0?"+":""}{Math.round(d.velocitySlope)}/mo</b></div>
            <div style={{fontSize:12,color:C.textSec}}>Acceleration: <b style={{color:C.text}}>{accelText(d.accelerationScore)}</b></div>
            <div style={{fontSize:12,color:C.textSec}}>Anomaly: <b style={{color:C.text}}>{d.anomalyZ.toFixed(1)}σ</b></div>
            <div style={{fontSize:12,color:C.textSec}}>All-time high: <b style={{color:C.text}}>{d.peakMonth}</b></div>
            <div style={{fontSize:12,color:C.textSec}}>Months above 2x: <b style={{color:C.text}}>{d.monthsAbove2xBaseline}</b></div>
          </div>
          {patternMatch && <div style={{marginTop:8,fontSize:12,color:C.textSec}}>Pattern match: <b>{patternMatch.verticalName}</b> {patternMatch.startMonth} ({Math.round(patternMatch.similarity*100)}% similarity)</div>}
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",background:c.color+"12",border:`1px solid ${c.color}33`,borderRadius:10}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Signal</div>
            <div style={{fontSize:14,fontWeight:800,color:c.color}}>{c.text}</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function HistoryChart({ vertical, hist, mode, resolution, range, showBand, showInflections, overlay, overlayLag }) {
  if (!hist) return null;
  const base = resolution === "weekly" ? (hist.weekly || []) : (hist.monthly || []);
  const data0 = [...base];
  let data = data0;
  if (range === "2023+") data = data0.filter(d => (d.month || d.week || "") >= "2023");
  if (range === "2024+") data = data0.filter(d => (d.month || d.week || "") >= "2024");
  if (range === "last12") data = data0.slice(-12);
  const yKey = mode === "index" ? "index" : mode === "zscore" ? "z" : "count";
  const xKey = resolution === "weekly" ? "week" : "month";
  const baseline = hist.derived?.baseline || 0;
  const std = hist.derived?.baselineStdDev || 0;
  let withBand = sanitizeTimeSeries(data.map(d => ({ ...d, bandLow: Math.max(0, baseline - std), bandHigh: baseline + std })), yKey);
  if (withBand.length >= 4) withBand = smoothEMA(withBand, yKey, 0.2);
  if (mode === "count" && withBand.length >= 4) withBand = smoothEMA(withBand, "rolling3", 0.2);
  const overlayData = (overlay || []).reduce((acc, ov) => {
    const shifted = (ov.series || []).map((d, i) => ({ x: d.month, val: d.index || 0, idx: i + (overlayLag ? (ov.lag || 0) : 0) }));
    shifted.forEach((s) => { if (!acc[s.idx]) acc[s.idx] = {}; acc[s.idx].x = s.x; acc[s.idx][ov.id] = s.val; });
    return acc;
  }, {});
  const overlayRows = Object.values(overlayData);

  return (
    <Card style={{padding:14}}>
      <div style={{width:"100%",height:320}}>
        <ResponsiveContainer>
          <ComposedChart data={withBand} margin={{top:8,right:18,bottom:12,left:8}}>
            <XAxis dataKey={xKey} tick={{fontSize:10,fill:C.textMuted}} />
            <YAxis yAxisId="left" tick={{fontSize:10,fill:C.textMuted}} width={45}/>
            <YAxis yAxisId="right" orientation="right" tick={{fontSize:10,fill:C.textMuted}} width={40}/>
            <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10}}
              formatter={(v, n) => [typeof v === "number" ? Math.round(v) : v, n]}
              labelFormatter={(l) => `${l}`} />
            <Legend wrapperStyle={{fontSize:11,...font.sans}} />
            {showBand && <Area yAxisId="left" type="monotone" dataKey="bandHigh" stroke="none" fill={C.blueBg} name="+1σ band" />}
            {showBand && <Area yAxisId="left" type="monotone" dataKey="bandLow" stroke="none" fill={C.white} name="-1σ band" />}
            <Bar yAxisId="left" dataKey={yKey} fill={vertical.color||C.cyan} opacity={0.35} name={mode === "count" ? "Monthly count" : mode === "index" ? "Baseline index" : "Z-score"} />
            <Line yAxisId="left" type="monotone" dataKey={mode === "count" ? "rolling3" : yKey} stroke={vertical.color||C.cyan} strokeWidth={2.5} dot={false} name={mode === "count" ? "3m rolling avg" : "Trend"} />
            <ReferenceLine yAxisId="left" y={mode === "count" ? baseline : 100} stroke={C.textMuted} strokeDasharray="4 4" label={{value:mode==="count"?"Pre-AI baseline":"Index 100",fill:C.textMuted,fontSize:10}} />
            {mode === "count" && <ReferenceLine yAxisId="left" y={baseline*2} stroke={C.amber} strokeDasharray="4 4" label={{value:"Breakout 2x",fill:C.amber,fontSize:10}} />}
            {showInflections && withBand.filter(d => d.inflection).map((d, i) => (
              <ReferenceDot key={i} yAxisId="left" x={d[xKey]} y={d[yKey]} r={4} fill={C.red} stroke="none" />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {overlayRows.length > 0 && (
        <div style={{marginTop:12}}>
          <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.textMuted,marginBottom:4}}>Cross-vertical overlay (index)</div>
          <div style={{width:"100%",height:180}}>
            <ResponsiveContainer>
              <LineChart data={overlayRows}>
                <XAxis dataKey="x" tick={{fontSize:10,fill:C.textMuted}} />
                <YAxis tick={{fontSize:10,fill:C.textMuted}} width={35} />
                <Tooltip />
                {overlay.map((ov, i) => <Line key={ov.id} type="monotone" dataKey={ov.id} stroke={PALETTE[i % PALETTE.length]} dot={false} name={ov.name} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
  );
}

function PatternLibrary({ verticalId, verticalName, allHistory, notes, onSaveNote }) {
  const cur = allHistory[verticalId];
  if (!cur?.monthly?.length) return null;
  const curWin = cur.monthly.map(m => m.count || 0).slice(-6);
  const matches = [];
  Object.entries(allHistory).forEach(([vid, hist]) => {
    const ser = hist?.monthly || [];
    if (ser.length < 12) return;
    for (let i = 0; i <= ser.length - 9; i++) {
      const win = ser.slice(i, i + 6).map(x => x.count || 0);
      const post3 = ser.slice(i + 6, i + 9).map(x => x.count || 0);
      const d = dtwDistance6(curWin, win);
      const similarity = Math.max(0, 1 - d);
      const post6 = ser.slice(i + 6, i + 12).map(x => x.count || 0);
      const post9 = ser.slice(i + 6, i + 15).map(x => x.count || 0);
      matches.push({
        id: `${vid}_${ser[i].month}`,
        verticalId: vid,
        verticalName: vid === verticalId ? `${verticalName} (self)` : vid,
        startMonth: ser[i].month,
        similarity,
        post3Avg: mean(post3),
        post6Avg: mean(post6),
        post9Avg: mean(post9),
        preLast: win[win.length - 1] || 0,
      });
    }
  });
  const top = matches.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  return (
    <Card style={{marginTop:12}}>
      <div style={{...font.sans,fontSize:13,fontWeight:700,color:C.text,marginBottom:8}}>Pattern Library (Top 5 similar 6-month windows)</div>
      {top.map((m) => {
        const outcome = m.preLast > 0 ? ((m.post3Avg / m.preLast) - 1) * 100 : 0;
        const outcome6 = m.preLast > 0 ? ((m.post6Avg / m.preLast) - 1) * 100 : 0;
        const outcome9 = m.preLast > 0 ? ((m.post9Avg / m.preLast) - 1) * 100 : 0;
        return (
          <div key={m.id} style={{padding:"8px 10px",border:`1px solid ${C.borderLight}`,borderRadius:10,marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
              <div style={{fontSize:12,color:C.text}}><b>{m.verticalName}</b> · {m.startMonth}</div>
              <div style={{fontSize:12,color:C.textSec}}>Similarity: <b>{Math.round(m.similarity * 100)}%</b> · +3m: <b>{outcome>=0?"+":""}{outcome.toFixed(0)}%</b> · +6m: <b>{outcome6>=0?"+":""}{outcome6.toFixed(0)}%</b> · +9m: <b>{outcome9>=0?"+":""}{outcome9.toFixed(0)}%</b></div>
            </div>
            <input value={notes?.[m.id] || ""} onChange={(e)=>onSaveNote(m.id, e.target.value)} placeholder="Add note (e.g., equity reaction, thesis implication)"
              style={{width:"100%",marginTop:6,fontSize:12,padding:"6px 8px"}} />
          </div>
        );
      })}
    </Card>
  );
}

function GitHubSummaryCard({ vertical, ghHist, lagInfo }) {
  if (!ghHist?.derived) return null;
  const d = ghHist.derived;
  return (
    <Card style={{marginBottom:10,padding:12,borderLeft:`4px solid ${C.purple}`}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div style={{fontSize:12,color:C.textSec}}>GitHub Activity: <b style={{color:C.text}}>{d.currentIndex}</b> ({d.currentVsBaseline.toFixed(2)}x 2021 baseline)</div>
        <div style={{fontSize:12,color:C.textSec}}>Star velocity: <b style={{color:C.text}}>{d.starVelocity>=0?"+":""}{Math.round(d.starVelocity)} / month</b></div>
        <div style={{fontSize:12,color:C.textSec}}>Enterprise repo ratio: <b style={{color:C.text}}>{(d.enterpriseRepoRatio||0).toFixed(1)}%</b></div>
        <div style={{fontSize:12,color:C.textSec}}>{lagInfo ? `GitHub leads jobs by ~${lagInfo.lagMonths} months (r=${lagInfo.r.toFixed(2)})` : "Load TheirStack history to estimate GitHub-jobs lag."}</div>
      </div>
      <div style={{marginTop:6,fontSize:11,color:C.textMuted}}>Vertical: {vertical?.name || "—"} · GitHub signal shown in purple.</div>
    </Card>
  );
}

function GitHubHistoryChart({ ghHist, tsHist, overlayJobs=false }) {
  if (!ghHist?.monthly?.length) return null;
  const data = ghHist.monthly.map((m)=> {
    const j = (tsHist?.monthly || []).find(x => x.month === m.month);
    return { ...m, jobsCount: j?.count || null, jobsIndex: j?.index || null };
  });
  const baseline = ghHist.derived?.baseline2021 || 0;
  return (
    <Card style={{padding:12}}>
      <div style={{width:"100%",height:300}}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{top:8,right:16,bottom:8,left:8}}>
            <XAxis dataKey="month" tick={{fontSize:10,fill:C.textMuted}} />
            <YAxis yAxisId="left" tick={{fontSize:10,fill:C.textMuted}} width={48}/>
            <YAxis yAxisId="right" orientation="right" tick={{fontSize:10,fill:C.textMuted}} width={40}/>
            <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10}} />
            <Legend wrapperStyle={{fontSize:11,...font.sans}} />
            <Bar yAxisId="left" dataKey="total_events" fill={C.purple} opacity={0.35} name="GitHub events" />
            <Line yAxisId="left" type="monotone" dataKey="rolling3" stroke={C.purple} strokeWidth={2.5} dot={false} name="GitHub 3m avg" />
            <Line yAxisId="right" type="monotone" dataKey="index" stroke={C.blue} strokeWidth={2} dot={false} name="Baseline index" />
            <ReferenceLine yAxisId="left" y={baseline} stroke={C.textMuted} strokeDasharray="4 4" label={{value:"2021 baseline",fill:C.textMuted,fontSize:10}} />
            <ReferenceLine yAxisId="left" y={baseline*2} stroke={C.amber} strokeDasharray="4 4" label={{value:"2x breakout",fill:C.amber,fontSize:10}} />
            {overlayJobs && <Line yAxisId="right" type="monotone" dataKey="jobsIndex" stroke={C.cyan} strokeWidth={2} dot={false} name="TheirStack index" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── INLINE SETTINGS ──────────────────────────────────────────────────────────

function InlineSettings({config,setConfig,githubWatchlists,setGithubWatchlists,mailingList,onUpdateMailingList,onCloudSync}){
  const[section,setSection]=useState(null);
  const update=fn=>setConfig(prev=>{const next=fn(prev);sv("config",next);return next;});

  const groupsContent=(<div>
    {config.verticals.map((v,vi)=>(<div key={v.id} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
      <input type="color" value={v.color||"#0284c7"} onChange={e=>update(c=>{const vs=[...c.verticals];vs[vi]={...vs[vi],color:e.target.value};return{...c,verticals:vs};})} style={{width:28,height:28,padding:1,border:`1px solid ${C.border}`,borderRadius:6,cursor:"pointer"}}/>
      <input value={v.name} onChange={e=>update(c=>{const vs=[...c.verticals];vs[vi]={...vs[vi],name:e.target.value};return{...c,verticals:vs};})} style={{flex:1,fontSize:13,fontWeight:600}}/>
      <Btn variant="ghost" size="sm" onClick={()=>{if(confirm(`Remove "${v.name}"?`))update(c=>({...c,verticals:c.verticals.filter((_,i)=>i!==vi)}));}}>✕</Btn>
    </div>))}
    <Btn variant="default" size="sm" onClick={()=>update(c=>({...c,verticals:[...c.verticals,{id:`v_${Date.now()}`,name:"New Group",color:PALETTE[c.verticals.length%PALETTE.length],description:"",keywords:{theirstack:{titleKeywords:[],descriptionKeywords:[]},google_trends:{keywords:[]},github_repos:{keywords:[]},claude_attrib:{keywords:[]}}}]}))}>+ Add group</Btn>
  </div>);

  const sourceHelp = {
    theirstack: "Hiring demand",
    google_trends: "Buyer interest",
    github_repos: "Developer ecosystem",
    claude_attrib: "Real AI coding usage",
  };

  const scoringContent=(<div>
    <div style={{marginBottom:14}}>
      <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>Signal importance (weights)</div>
      <div style={{...font.sans,fontSize:11,color:C.textSec,marginBottom:10,lineHeight:1.45}}>
        Relative importance of each data source when evaluating signals.
      </div>
      {config.sources.map((src,si)=>{
        const pct=Math.round((src.weight||0)*100);
        return(<div key={src.id} style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <span style={{...font.sans,fontSize:12,fontWeight:600,color:C.text}}>{src.name}</span>
            <span style={{...font.mono,fontSize:12,color:C.textSec}}>{pct}%</span>
          </div>
          <input type="range" min="0" max="100" step="5" value={pct}
            onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],weight:(parseInt(e.target.value,10)||0)/100};return{...c,sources:ss};})}
            style={{width:"100%"}}/>
          <div style={{...font.sans,fontSize:10.5,color:C.textMuted,marginTop:2}}>{sourceHelp[src.id]||"Signal contribution"}</div>
        </div>);
      })}
    </div>

    <div style={{marginTop:16,padding:"12px 14px",background:C.nested,border:`1px solid ${C.borderLight}`,borderRadius:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text}}>Alert threshold</div>
        <span style={{...font.mono,fontSize:14,fontWeight:700,color:C.textSec}}>{config.alertThreshold || 10}%</span>
      </div>
      <input type="range" min="1" max="50" step="1" value={config.alertThreshold || 10}
        onChange={e => update(c => ({ ...c, alertThreshold: parseInt(e.target.value, 10) || 10 }))}
        style={{width:"100%"}}/>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
        <span style={{...font.sans,fontSize:10,color:C.textMuted}}>1% (sensitive)</span>
        <span style={{...font.sans,fontSize:10,color:C.textMuted}}>50% (major moves only)</span>
      </div>
      <div style={{...font.sans,fontSize:11,color:C.textSec,marginTop:6,lineHeight:1.45}}>
        Signals that change by more than this percentage (week-over-week) will trigger an alert. Lower = more alerts, higher = only significant shifts.
      </div>
    </div>

    <div style={{marginTop:12}}>
      <div style={{...font.sans,fontSize:11,color:C.textMuted}}>Brief flagging thresholds are editable on the main dashboard.</div>
    </div>


  </div>);

  const githubContent=(<div>
    <div style={{...font.sans,fontSize:12,color:C.textSec,marginBottom:10}}>
      Add repos per signal group for GitHub historical analysis (owner/repo). Tier controls relative importance.
    </div>
    {config.verticals.map((v)=> {
      const list = githubWatchlists[v.id] || [];
      return (
        <Card key={v.id} style={{padding:10,marginBottom:10,background:C.nested}}>
          <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:6}}>{v.name}</div>
          {list.map((it, i) => (
            <div key={`${it.repo}_${i}`} style={{display:"grid",gridTemplateColumns:"1.6fr 1fr 120px 36px",gap:6,marginBottom:6}}>
              <input value={it.repo||""} onChange={e=>setGithubWatchlists(prev=>{const n={...prev,[v.id]:[...list]};n[v.id][i]={...n[v.id][i],repo:e.target.value};sv(ghWatchlistKey(v.id),n[v.id]);return n;})} placeholder="owner/repo" />
              <input value={it.label||""} onChange={e=>setGithubWatchlists(prev=>{const n={...prev,[v.id]:[...list]};n[v.id][i]={...n[v.id][i],label:e.target.value};sv(ghWatchlistKey(v.id),n[v.id]);return n;})} placeholder="Label (optional)" />
              <select value={it.tier||"CORE_FRAMEWORK"} onChange={e=>setGithubWatchlists(prev=>{const n={...prev,[v.id]:[...list]};n[v.id][i]={...n[v.id][i],tier:e.target.value};sv(ghWatchlistKey(v.id),n[v.id]);return n;})}>
                <option value="CORE_FRAMEWORK">CORE_FRAMEWORK</option>
                <option value="ENTERPRISE_TOOL">ENTERPRISE_TOOL</option>
                <option value="REFERENCE_IMPL">REFERENCE_IMPL</option>
              </select>
              <Btn variant="ghost" size="sm" onClick={()=>setGithubWatchlists(prev=>{const n={...prev,[v.id]:list.filter((_,ix)=>ix!==i)};sv(ghWatchlistKey(v.id),n[v.id]);return n;})}>✕</Btn>
            </div>
          ))}
          <Btn size="sm" onClick={()=>setGithubWatchlists(prev=>{const n={...prev,[v.id]:[...list,{repo:"",label:"",tier:"CORE_FRAMEWORK"}]};sv(ghWatchlistKey(v.id),n[v.id]);return n;})}>+ Add repo</Btn>
        </Card>
      );
    })}
  </div>);

  const [newEmail,setNewEmail]=useState("");
  const [emailjsCfg,setEmailjsCfg]=useState(()=>ld("emailjs_config",{service_id:"",template_id:"",public_key:""}));
  useEffect(()=>{if(section==="mailing"){setEmailjsCfg(ld("emailjs_config",{service_id:"",template_id:"",public_key:""}));}},[section]);
  const updateEmailjsCfg=(field,val)=>{const next={...emailjsCfg,[field]:val};setEmailjsCfg(next);sv("emailjs_config",next);if(onCloudSync)onCloudSync();};
  const emailjsReady=emailjsCfg.service_id&&emailjsCfg.template_id&&emailjsCfg.public_key;
  const mailingContent=(<div>
    <div style={{padding:"12px 14px",background:C.nested,borderRadius:10,marginBottom:16,border:`1px solid ${C.borderLight}`}}>
      <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:6}}>EmailJS Setup (free, no domain needed)</div>
      <div style={{...font.sans,fontSize:11,color:C.textSec,lineHeight:1.6,marginBottom:10}}>
        1. Create a free account at <a href="https://www.emailjs.com" target="_blank" rel="noreferrer" style={{color:C.cyan}}>emailjs.com</a><br/>
        2. Go to <strong>Email Services</strong> → Add service → Connect your Gmail (or any email)<br/>
        3. Go to <strong>Email Templates</strong> → Create template with these variables:<br/>
        <span style={{fontFamily:"monospace",fontSize:10,background:C.white,padding:"2px 6px",borderRadius:4,marginLeft:12}}>{"{{to_email}}"}</span> (To field),
        <span style={{fontFamily:"monospace",fontSize:10,background:C.white,padding:"2px 6px",borderRadius:4}}>{"{{subject}}"}</span> (Subject field),
        <span style={{fontFamily:"monospace",fontSize:10,background:C.white,padding:"2px 6px",borderRadius:4}}>{"{{report_content}}"}</span> (plain text + ASCII charts),
        optional <span style={{fontFamily:"monospace",fontSize:10,background:C.white,padding:"2px 6px",borderRadius:4}}>{"{{report_html}}"}</span> (full HTML with inline SVG graphs — use in template body as HTML if your provider allows)<br/>
        4. Copy your IDs below:
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{...font.sans,fontSize:11,fontWeight:600,color:C.textSec,minWidth:85}}>Service ID</span>
          <input value={emailjsCfg.service_id} onChange={e=>updateEmailjsCfg("service_id",e.target.value)} placeholder="e.g. service_abc123"
            style={{flex:1,fontSize:12,padding:"6px 10px",borderRadius:6,border:`1px solid ${C.border}`,outline:"none",...font.sans}}/>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{...font.sans,fontSize:11,fontWeight:600,color:C.textSec,minWidth:85}}>Template ID</span>
          <input value={emailjsCfg.template_id} onChange={e=>updateEmailjsCfg("template_id",e.target.value)} placeholder="e.g. template_xyz789"
            style={{flex:1,fontSize:12,padding:"6px 10px",borderRadius:6,border:`1px solid ${C.border}`,outline:"none",...font.sans}}/>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{...font.sans,fontSize:11,fontWeight:600,color:C.textSec,minWidth:85}}>Public Key</span>
          <input value={emailjsCfg.public_key} onChange={e=>updateEmailjsCfg("public_key",e.target.value)} placeholder="e.g. user_ABCdef12345"
            style={{flex:1,fontSize:12,padding:"6px 10px",borderRadius:6,border:`1px solid ${C.border}`,outline:"none",...font.sans}}/>
        </div>
      </div>
      <div style={{marginTop:8,...font.sans,fontSize:11,color:emailjsReady?C.green:C.textMuted}}>
        {emailjsReady ? "EmailJS configured — ready to send" : "Fill in all three fields to enable email sending"}
      </div>
    </div>

    <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>Recipients</div>
    <div style={{display:"flex",gap:8,marginBottom:14}}>
      <input value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="colleague@company.com"
        style={{flex:1,fontSize:13,padding:"8px 12px",borderRadius:8,border:`1px solid ${C.border}`,outline:"none",...font.sans}}
        onKeyDown={e=>{
          if(e.key==="Enter"&&newEmail.trim()&&newEmail.includes("@")){
            onUpdateMailingList([...mailingList,newEmail.trim().toLowerCase()]);
            setNewEmail("");
          }
        }}/>
      <Btn variant="primary" size="sm" disabled={!newEmail.trim()||!newEmail.includes("@")}
        onClick={()=>{if(newEmail.trim()&&newEmail.includes("@")){onUpdateMailingList([...mailingList,newEmail.trim().toLowerCase()]);setNewEmail("");}}}>
        Add
      </Btn>
    </div>
    {mailingList.length===0 ? (
      <div style={{padding:"18px 12px",textAlign:"center",background:C.nested,borderRadius:10}}>
        <div style={{...font.sans,fontSize:12,color:C.textMuted}}>No recipients yet. Add email addresses above.</div>
      </div>
    ) : (
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {mailingList.map((email,i)=>(
          <div key={email+i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:C.nested,borderRadius:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <IcoC name="mail" size={13} color={C.textSec}/>
              <span style={{...font.sans,fontSize:13,color:C.text}}>{email}</span>
            </div>
            <Btn variant="ghost" size="sm" onClick={()=>onUpdateMailingList(mailingList.filter((_,idx)=>idx!==i))}>
              <IcoC name="trash" size={12} color={C.red}/>
            </Btn>
          </div>
        ))}
        <div style={{...font.sans,fontSize:11,color:C.textMuted,marginTop:4}}>
          {mailingList.length} recipient{mailingList.length!==1?"s":""}.
        </div>
      </div>
    )}
  </div>);

  const instructionsContent=(<div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
      {[
        { icon: "briefcase", color: C.cyan, title: "Job Postings (TheirStack)", desc: "AI job postings matching your keywords across US employers." },
        { icon: "trendUp", color: C.blue, title: "Google Trends (SerpAPI)", desc: "Search interest (0\u2013100) for your keywords on Google." },
        { icon: "code", color: C.green, title: "GitHub Repos", desc: "Active repositories matching your keywords." },
        { icon: "bot", color: C.purple, title: "Claude Code Attribution", desc: "GitHub commits with Claude co-author signatures." },
        { icon: "database", color: C.amber, title: "Hugging Face Leaderboard", desc: "Hub API download counts (top models per org)—adoption proxy per HF’s download-stat rules, not benchmark accuracy. Re-fetches if snapshot >6h old. No key required." },
        { icon: "barChart", color: C.orange, title: "Signal Stages", desc: "Pipeline stage classification per tracking group." },
      ].map((item, i) => (
        <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
          <div style={{flexShrink:0,width:32,height:32,borderRadius:8,background:item.color+"14",display:"flex",alignItems:"center",justifyContent:"center",marginTop:2}}>
            <IcoC name={item.icon} size={15} color={item.color}/>
          </div>
          <div>
            <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:3}}>{item.title}</div>
            <div style={{...font.sans,fontSize:11,color:C.textSec,lineHeight:1.5}}>{item.desc}</div>
          </div>
        </div>
      ))}
    </div>
    <div style={{...font.sans,fontSize:13,fontWeight:700,color:C.text,marginBottom:10}}>Additional capabilities</div>
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
      {[
        { title: "Historical Backfill", desc: "Each signal source has a Backfill button to pull historical data." },
        { title: "Growth Charts & Divergence Overlay", desc: "Overlay 2–4 signals on a normalized scale to spot divergences." },
        { title: "AI Divergence Analysis", desc: "Claude interprets divergences between co-moving signals." },
        { title: "Alert Threshold", desc: "Set a week-over-week % change threshold for divergence alerts." },
        { title: "AI Weekly Brief", desc: "Claude-generated intelligence brief with live web search." },
        { title: "Earnings Call Analyzer", desc: "Five-dimension linguistic score plus Layer 2: theme concentration, lexicon sentiment, forward/uncertainty rates, and buy-side-style LLM extraction." },
        { title: "Cloud Persistence", desc: "Data syncs to Supabase for team-wide access across deploys." },
        { title: "Auto-Refresh", desc: "Signals refresh automatically on their configured cadence." },
        { title: "Email Reports", desc: "Send weekly briefs to your team via EmailJS." },
      ].map((item, i) => (
        <div key={i} style={{padding:"10px 14px",background:C.nested,borderRadius:10}}>
          <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:3}}>{item.title}</div>
          <div style={{...font.sans,fontSize:11,color:C.textSec,lineHeight:1.5}}>{item.desc}</div>
        </div>
      ))}
    </div>
    <div style={{...font.sans,fontSize:13,fontWeight:700,color:C.text,marginBottom:8}}>API keys & environment variables</div>
    <div style={{...font.sans,fontSize:11,color:C.textSec,lineHeight:1.7,fontFamily:"monospace",background:C.nested,padding:"14px 18px",borderRadius:10,marginBottom:8}}>
      <span style={{color:C.cyan,fontWeight:700}}>─── Data Sources ───</span><br/>
      VITE_THEIRSTACK_KEY=your-key &nbsp;&nbsp;<span style={{color:C.textMuted}}># theirstack.com — job posting data</span><br/>
      VITE_THEIRSTACK_MOCK=true &nbsp;&nbsp;<span style={{color:C.textMuted}}># optional — demo jobs without a key</span><br/>
      VITE_SERPAPI_KEY=your-key &nbsp;&nbsp;<span style={{color:C.textMuted}}># serpapi.com — Google Trends data</span><br/>
      VITE_GITHUB_PAT=your-pat &nbsp;&nbsp;<span style={{color:C.textMuted}}># github.com — repos, commits, backfill</span><br/>
      FRED_API_KEY=your-key &nbsp;&nbsp;<span style={{color:C.textMuted}}># fred.stlouisfed.org — server-side only</span><br/>
      <br/>
      <span style={{color:C.cyan,fontWeight:700}}>─── AI (Claude) ───</span><br/>
      VITE_ANTHROPIC_API_KEY=your-key &nbsp;&nbsp;<span style={{color:C.textMuted}}># weekly brief + earnings call analyzer</span><br/>
      <br/>
      <span style={{color:C.cyan,fontWeight:700}}>─── Database Persistence (Supabase) ───</span><br/>
      VITE_DASHBOARD_STORE_SECRET=any-string &nbsp;&nbsp;<span style={{color:C.textMuted}}># shared secret for client↔server auth</span><br/>
      DASHBOARD_STORE_SECRET=same-string &nbsp;&nbsp;<span style={{color:C.textMuted}}># must match the VITE_ version</span><br/>
      SUPABASE_URL=https://xxx.supabase.co &nbsp;&nbsp;<span style={{color:C.textMuted}}># from Supabase dashboard → Settings → API</span><br/>
      SUPABASE_SERVICE_ROLE_KEY=eyJ... &nbsp;&nbsp;<span style={{color:C.textMuted}}># from Supabase → Settings → API → service_role</span><br/>
      DATABASE_URL=postgresql://... &nbsp;&nbsp;<span style={{color:C.textMuted}}># fallback — only needed if not using Supabase REST</span>
    </div>
    <div style={{...font.sans,fontSize:11,color:C.textMuted,lineHeight:1.6}}>
      See <code style={{fontSize:10}}>.env.example</code> for setup details.
    </div>
  </div>);

  const items=[
    {id:"instructions",label:"Instructions",content:instructionsContent},
    {id:"groups",label:"Signal Groups",content:groupsContent},
    {id:"scoring",label:"Weights & Alerts",content:scoringContent},
    {id:"mailing",label:"Mailing List",content:mailingContent},
  ];

  return(<Card style={{padding:0,overflow:"hidden"}}>
    <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
      {items.map(it=>(<button key={it.id} onClick={()=>setSection(section===it.id?null:it.id)} style={{...font.sans,flex:1,fontSize:12,fontWeight:600,padding:"10px 12px",cursor:"pointer",background:section===it.id?C.white:C.nested,border:"none",borderBottom:section===it.id?`2px solid ${C.cyan}`:"2px solid transparent",color:section===it.id?C.text:C.textMuted,transition:"all .15s"}}>{it.label}</button>))}
    </div>
    {section&&(<div className="fade-in" style={{padding:"16px 20px"}}>
      {items.find(i=>i.id===section)?.content}
    </div>)}
  </Card>);
}

// ── MARKET & AI NEWS PULSE (on-demand macro + headlines + drivers) ─────────

const PULSE_CACHE_KEY = PFX + "pulse_cache";

function fredLatestVal(fredLatest, id) {
  const row = (fredLatest || []).find((x) => x.series_id === id);
  if (!row || row.value == null || row.error) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

function computeMacroDrivers(fredLatest) {
  const drivers = [];
  const vix = fredLatestVal(fredLatest, "VIXCLS");
  const t10y2y = fredLatestVal(fredLatest, "T10Y2Y");
  const dgs10 = fredLatestVal(fredLatest, "DGS10");
  const dgs2 = fredLatestVal(fredLatest, "DGS2");
  const nfci = fredLatestVal(fredLatest, "NFCI");
  const unrate = fredLatestVal(fredLatest, "UNRATE");
  if (vix != null && vix > 22) {
    drivers.push({ tag: "Volatility", text: `VIX ~${vix.toFixed(1)} — risk appetite often shrinks; high-multiple / long-duration tech can re-rate until volatility mean-reverts.` });
  } else if (vix != null && vix < 14) {
    drivers.push({ tag: "Calm", text: `VIX ~${vix.toFixed(1)} — complacency risk, but funding costs and AI capex narratives matter more than fear right now.` });
  }
  if (t10y2y != null && t10y2y < 0) {
    drivers.push({ tag: "Yield curve", text: `10Y–2Y spread is negative (${t10y2y.toFixed(2)} pp) — classic late-cycle signal; tightens financial conditions for long-duration equities.` });
  }
  if (nfci != null && nfci > 0.3) {
    drivers.push({ tag: "Financial conditions", text: `Chicago Fed NFCI ${nfci.toFixed(2)} — credit and funding stress rising; watch enterprise IT budgets and startup runway.` });
  } else if (nfci != null && nfci < -0.5) {
    drivers.push({ tag: "Financial conditions", text: `Chicago Fed NFCI ${nfci.toFixed(2)} — loose conditions; supports risk assets and capex, including AI infrastructure spend.` });
  }
  if (dgs10 != null && dgs2 != null) {
    drivers.push({ tag: "Rates", text: `2Y ${dgs2.toFixed(2)}% vs 10Y ${dgs10.toFixed(2)}% — the path of front-end rates drives discount rates for AI equities and private valuations.` });
  }
  if (unrate != null && unrate > 4.5) {
    drivers.push({ tag: "Labor", text: `U-3 unemployment ${unrate.toFixed(1)}% — softer labor = easier Fed eventually, but also slower enterprise hiring for AI roles near term.` });
  }
  if (drivers.length === 0 && (vix != null || dgs10 != null)) {
    drivers.push({ tag: "Backdrop", text: "Macro inputs are in a mixed/neutral band — lean on your tracking-group signals and headlines below for timing." });
  }
  return drivers.slice(0, 6);
}

function computeSignalMoves(verticals, allHistories, sources) {
  const moves = [];
  const srcList = (sources || []).filter((s) => s.enabled);
  for (const v of verticals || []) {
    for (const s of srcList) {
      const key = `${v.id}_${s.id}`;
      const hist = allHistories[key];
      if (!hist || hist.length < 2) continue;
      const a = hist[hist.length - 2].value;
      const b = hist[hist.length - 1].value;
      if (a == null || b == null) continue;
      const pct = a > 0 ? ((b - a) / a) * 100 : null;
      if (pct == null || !Number.isFinite(pct)) continue;
      moves.push({ key, group: v.name, source: s.name, sourceId: s.id, pct, prev: a, cur: b });
    }
  }
  moves.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));
  return moves.slice(0, 6);
}

function MarketAiPulsePanel({
  overview,
  newsPack,
  loading,
  error,
  onRefresh,
  macroDrivers,
  signalMoves,
  collapsed,
  onToggleCollapsed,
}) {
  const fred = overview?.fred_latest || [];
  const pick = (id) => {
    const x = fred.find((r) => r.series_id === id);
    if (!x || x.value == null) return "—";
    const n = Number(x.value);
    return Number.isFinite(n) ? (id === "UNRATE" || id === "VIXCLS" ? n.toFixed(2) : n.toFixed(2)) : "—";
  };
  const articles = newsPack?.articles || [];
  return (
    <Card style={{ borderLeft: `4px solid ${C.purple}`, padding: 0, overflow: "hidden", marginBottom: 20 }} className="fade-in">
      <div style={{ padding: "14px 20px 12px", background: C.white, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <IcoC name="activity" size={18} color={C.purple} />
            <span style={{ ...font.sans, fontSize: 15, fontWeight: 700, color: C.text }}>Live macro &amp; AI news pulse</span>
            <Badge color={C.purple} bg={C.purpleBg} size="sm">On demand</Badge>
          </div>
          <div style={{ ...font.sans, fontSize: 11, color: C.textSec, marginTop: 6, lineHeight: 1.5, maxWidth: 900 }}>
            Refresh anytime for fresh <strong style={{ color: C.text }}>FRED / Chicago Fed</strong> snapshot and <strong style={{ color: C.text }}>headlines</strong> (SerpAPI Google News).
            “Drivers” combine macro rules of thumb with your <em>largest moves between the last two history points</em> on each signal — not a forecast.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <Btn variant="primary" size="sm" onClick={onRefresh} disabled={loading}>
            {loading ? <><Spinner size={12} color="#fff" /> Updating…</> : <><IcoC name="refresh" size={12} color="#fff" /> Refresh macro &amp; news</>}
          </Btn>
          <Btn variant="ghost" size="sm" onClick={onToggleCollapsed}>{collapsed ? "Expand" : "Collapse"}</Btn>
        </div>
      </div>
      {!collapsed && (
        <div style={{ padding: "0 20px 18px" }}>
          {error && <div style={{ ...font.sans, fontSize: 12, color: C.red, marginBottom: 8 }}>{error}</div>}
          {overview?.fetched_at && (
            <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginBottom: 10 }}>
              Macro data pulled {new Date(overview.fetched_at).toLocaleString()}
              {newsPack?.fetched_at && ` · Headlines ${new Date(newsPack.fetched_at).toLocaleString()}`}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 8, marginBottom: 12 }}>
            <div style={{ background: C.nested, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>VIX</div>
              <div style={{ ...font.mono, fontSize: 18, fontWeight: 800 }}>{pick("VIXCLS")}</div>
              <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>{FRED_SERIES_EXPLAIN.VIXCLS?.slice(0, 120)}…</div>
            </div>
            <div style={{ background: C.nested, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>10Y / 2Y %</div>
              <div style={{ ...font.mono, fontSize: 18, fontWeight: 800 }}>{pick("DGS10")} / {pick("DGS2")}</div>
              <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>10Y–2Y: {pick("T10Y2Y")} pp</div>
            </div>
            <div style={{ background: C.nested, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>U-3 %</div>
              <div style={{ ...font.mono, fontSize: 18, fontWeight: 800 }}>{pick("UNRATE")}</div>
              <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>NFCI {pick("NFCI")}</div>
            </div>
          </div>
          {macroDrivers.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>Likely macro drivers (heuristic)</div>
              <ul style={{ margin: 0, paddingLeft: 18, ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.55 }}>
                {macroDrivers.map((d, i) => (
                  <li key={i} style={{ marginBottom: 4 }}><strong style={{ color: C.text }}>{d.tag}:</strong> {d.text}</li>
                ))}
              </ul>
            </div>
          )}
          {signalMoves.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>What moved most in your dashboard (last → previous history point)</div>
              <ul style={{ margin: 0, paddingLeft: 18, ...font.sans, fontSize: 11, color: C.textSec, lineHeight: 1.55 }}>
                {signalMoves.map((m) => (
                  <li key={m.key} style={{ marginBottom: 4 }}>
                    <strong style={{ color: C.text }}>{m.group}</strong> — {m.source}: {m.pct >= 0 ? "+" : ""}{m.pct.toFixed(1)}% vs prior snapshot ({SOURCE_METRIC_BLURB[m.sourceId] || "per source"}).
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>AI &amp; tech market headlines</div>
            {!articles.length && !loading && (
              <div style={{ fontSize: 11, color: C.textMuted }}>Click refresh to load headlines (requires SerpAPI key on the server).</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {articles.map((a, i) => (
                <div key={i} style={{ padding: "10px 12px", background: C.nested, borderRadius: 8, border: `1px solid ${C.borderLight}` }}>
                  <div style={{ ...font.sans, fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.4 }}>{a.title}</div>
                  <div style={{ ...font.sans, fontSize: 10, color: C.textMuted, marginTop: 4 }}>{a.source}{a.date ? ` · ${a.date}` : ""}</div>
                  {a.snippet && <div style={{ ...font.sans, fontSize: 11, color: C.textSec, marginTop: 6, lineHeight: 1.45 }}>{a.snippet}</div>}
                  {a.link && (
                    <a href={a.link} target="_blank" rel="noopener noreferrer" style={{ ...font.sans, fontSize: 10, color: C.cyan, marginTop: 6, display: "inline-block" }}>Open article</a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── APP ROOT ─────────────────────────────────────────────────────────────────

function humanInterval(ms){ return ms<60000?`${Math.round(ms/1000)}s`:ms<3600000?`${Math.round(ms/60000)}m`:`${(ms/3600000).toFixed(1)}h`; }

export default function App() {
  const [config,setConfig]=useState(()=>ld("config",buildDefaultConfig()));
  const [signalResults,setSignalResults]=useState({});
  const [loading,setLoading]=useState({});
  const [errors,setErrors]=useState({});
  const [alerts,setAlerts]=useState([]);
  const [nextRefresh,setNextRefresh]=useState({});
  const [schedulerActive,setSchedulerActive]=useState(true);
  const [overlaySelected,setOverlaySelected]=useState([]);
  const [allHistories,setAllHistories]=useState({});
  const [addingGroup,setAddingGroup]=useState(false);
  const [newGroupName,setNewGroupName]=useState("");
  const [editingGroupId,setEditingGroupId]=useState(null);
  const [tsHistoryByVertical,setTsHistoryByVertical]=useState({});
  const [historyProgress,setHistoryProgress]=useState({active:false,verticalId:null,current:0,total:0,label:""});
  const [crossCorr,setCrossCorr]=useState(()=>ld(crossCorrKey(),[]));
  const [patternNotes,setPatternNotes]=useState({});
  const [annotations,setAnnotations]=useState(()=>getAnnotations());
  const [historyOutdated,setHistoryOutdated]=useState({});
  const [githubWatchlists,setGithubWatchlists]=useState({});
  const [githubSelectedVert,setGithubSelectedVert]=useState(null);
  const [githubHistoryByVertical,setGithubHistoryByVertical]=useState({});
  const [githubLiveByVertical,setGithubLiveByVertical]=useState({});
  const [briefOpen,setBriefOpen]=useState(false);
  const [briefLoading,setBriefLoading]=useState(false);
  const [briefProgressSec,setBriefProgressSec]=useState(0);
  const [briefContent,setBriefContent]=useState("");
  const [briefWeek,setBriefWeek]=useState(weekKeyFromDate(new Date()));
  const [briefHistoryOpen,setBriefHistoryOpen]=useState(false);
  const [briefHistory,setBriefHistory]=useState([]);
  const [briefDiffMode,setBriefDiffMode]=useState(false);
  const [briefBaseForDiff,setBriefBaseForDiff]=useState("");
  const [briefSnapshot,setBriefSnapshot]=useState(null);
  const [briefReaderMode,setBriefReaderMode]=useState(false);
  const [pulseOverview,setPulseOverview]=useState(null);
  const [pulseNews,setPulseNews]=useState(null);
  const [pulseLoading,setPulseLoading]=useState(false);
  const [pulseErr,setPulseErr]=useState(null);
  const [pulseCollapsed,setPulseCollapsed]=useState(false);
  const [mailingList,setMailingList]=useState(()=>ld("mailing_list",[]));
  const [emailSending,setEmailSending]=useState(false);
  const [emailStatus,setEmailStatus]=useState(null);
  const addRef=useRef(null);
  const migratedLabelsRef=useRef(false);
  const cancelHistoryRef=useRef(false);
  const configRef=useRef(config);const srRef=useRef(signalResults);const ldRef=useRef(loading);
  const cloudSyncDoneRef=useRef(false);
  useEffect(()=>{configRef.current=config;},[config]);
  useEffect(()=>{srRef.current=signalResults;},[signalResults]);
  useEffect(()=>{ldRef.current=loading;},[loading]);
  useEffect(()=>{
    if(!cloudSyncDoneRef.current) return;
    sv("config",config);
    const pat=resolveGitPat();if(pat||signalStoreSecret()||databaseStoreSecret())debouncedSyncToGist(pat);
  },[config]);
  useEffect(()=>{if(addingGroup&&addRef.current)addRef.current.focus();},[addingGroup]);
  useEffect(() => {
    setGithubWatchlists(prev => {
      const next = { ...prev };
      let changed = false;
      config.verticals.forEach(v => {
        if (!next[v.id]) { next[v.id] = ld(ghWatchlistKey(v.id), []); changed = true; }
      });
      Object.keys(next).forEach(k => {
        if (!config.verticals.some(v => v.id === k)) { delete next[k]; changed = true; }
      });
      return changed ? next : prev;
    });
    if (githubSelectedVert && !config.verticals.some(v => v.id === githubSelectedVert)) {
      setGithubSelectedVert(config.verticals[0]?.id || null);
    }
  }, [config.verticals, githubSelectedVert]);

  useEffect(() => {
    pruneOldBriefs(12);
    const wk = weekKeyFromDate(new Date());
    let cur = null;
    try { cur = JSON.parse(localStorage.getItem(briefStorageKey(wk)) || "null"); } catch {}
    if (cur?.content_markdown) {
      setBriefWeek(wk);
      setBriefContent(sanitizeBriefOutput(cur.content_markdown));
      setBriefBaseForDiff(sanitizeBriefOutput(cur.first_content_markdown || cur.content_markdown));
      setBriefSnapshot(cur.data_snapshot || null);
    }
    const rows = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(`${HSPFX}brief_`) || k === BRIEF_LAST_KEY) continue;
      const v = (()=>{ try{return JSON.parse(localStorage.getItem(k)||"null");}catch{return null;} })();
      if (v?.generated_at) rows.push({ key: k, week: k.replace(`${HSPFX}brief_`, ""), ...v });
    }
    rows.sort((a,b)=>new Date(b.generated_at)-new Date(a.generated_at));
    setBriefHistory(rows);
  }, []);

  useEffect(() => {
    const c = ld(PULSE_CACHE_KEY, null);
    if (c?.overview) setPulseOverview(c.overview);
    if (c?.news) setPulseNews(c.news);
  }, []);

  useEffect(() => {
    purgeGitHubReposBackfill();
    const migKey = `${HSPFX}gh_repos_purge_v7`;
    if (!localStorage.getItem(migKey)) {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.includes("github_repos") && k.includes("hist")) localStorage.removeItem(k);
      }
      localStorage.setItem(migKey, "1");
    }
  }, []);

  useEffect(()=>{
    if(migratedLabelsRef.current) return;
    migratedLabelsRef.current = true;
    setConfig(prev=>{
      const oldStageNames = ["Exploration","Piloting","Deploying","Budget Live"];
      const oldTaxNames = ["Pain Threshold","Infrastructure Building","Competitive Pressure","Budget Committed"];
      const hasOldStageNames = (prev.stages||[]).some(s=>oldStageNames.includes(s.name));
      const hasOldTaxNames = (prev.stageTaxonomy||[]).some(t=>oldTaxNames.includes(t.name));
      if(!hasOldStageNames && !hasOldTaxNames) return prev;

      const nextStages = (prev.stages||[]).map((s, i)=>({
        ...s,
        name: DEFAULT_STAGES[i]?.name || s.name,
        color: DEFAULT_STAGES[i]?.color || s.color,
        weight: DEFAULT_STAGES[i]?.weight || s.weight,
      }));
      const nextTax = (prev.stageTaxonomy||[]).map((t, i)=>({
        ...t,
        name: DEFAULT_STAGE_TAXONOMY[i]?.name || t.name,
        description: DEFAULT_STAGE_TAXONOMY[i]?.description || t.description,
        color: DEFAULT_STAGE_TAXONOMY[i]?.color || t.color,
      }));
      const next = {...prev,stages:nextStages,stageTaxonomy:nextTax};
      return next;
    });
  },[]);

  useEffect(() => {
    const outdated = {};
    config.verticals.forEach((v) => {
      const hist = tsHistoryByVertical[v.id];
      if (!hist) return;
      const nowHash = hashKeywordsForVertical(v);
      if (hist.keywordsHash !== nowHash) outdated[v.id] = true;
    });
    setHistoryOutdated(outdated);
  }, [config.verticals, tsHistoryByVertical]);

  const hasKeys=useMemo(()=>{
    if (config.sources.some((src) => src.enabled && resolveKey(src, config.apiKeys))) return true;
    const ts = config.sources.find((s) => s.id === "theirstack" && s.enabled);
    return !!(ts && resolveTheirStackMocking(ts, config.apiKeys));
  },[config]);
  const [cloudStatus,setCloudStatus]=useState("idle");
  const lastSyncRef=useRef(0);

  const resolveGitPat=useCallback(()=>{
    const fromCfg=config.apiKeys?.github;
    try{
      const fromEnv = import.meta.env.VITE_GITHUB_PAT || "";
      if(fromEnv) return fromEnv;
    }catch{}
    return fromCfg || "";
  },[config.apiKeys]);

  useEffect(() => {
    setGitPatResolver(() => resolveGitPat());
    return () => setGitPatResolver(() => "");
  }, [resolveGitPat]);

  const doCloudSync=useCallback(async(direction)=>{
    const pat=resolveGitPat();if(!pat&&!signalStoreSecret()&&!databaseStoreSecret())return;
    setCloudStatus(direction==="up"?"saving…":"loading…");
    try{
      if(direction==="up"){await syncToGist(pat);lastSyncRef.current=Date.now();}
      else{const ok=await syncFromGist(pat);if(ok){purgeGitHubReposBackfill();setConfig(ld("config",buildDefaultConfig()));lastSyncRef.current=Date.now();}}
      setCloudStatus("synced");
    }catch{setCloudStatus("error");}
    setTimeout(()=>setCloudStatus("idle"),3000);
  },[resolveGitPat]);

  const autoHistoryFetchedRef = useRef(false);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const pat=resolveGitPat();
      if(pat||signalStoreSecret()||databaseStoreSecret()){setCloudStatus("loading…");try{await syncFromGist(pat);purgeGitHubReposBackfill();if(!cancelled){setConfig(ld("config",buildDefaultConfig()));setMailingList(ld("mailing_list",[]));}}catch{}if(!cancelled){setCloudStatus("idle");lastSyncRef.current=Date.now();}}
      await new Promise(r=>setTimeout(r,100));
      if(!cancelled){cloudSyncDoneRef.current=true;_cloudInitDone=true;}
      if (!cancelled) {
        const primed = getAllData();
        if (!primed.config || Object.keys(primed).length < 2) {
          const fallbackCfg = ld("config", buildDefaultConfig());
          try { localStorage.setItem(PFX + "config", JSON.stringify(fallbackCfg)); } catch {}
        }
      }
      const cached={};const cfg=ld("config",buildDefaultConfig());
      (cfg.verticals||[]).forEach(v=>{(cfg.sources||[]).forEach(src=>{
        const key=`${v.id}_${src.id}`;
        const h=getSignalHistory(key);
        if(h.length>0){cached[key]={count:h[h.length-1].value,items:[],timestamp:h[h.length-1].ts};if(!cancelled)setAllHistories(p=>({...p,[key]:h}));}
      });});
      if(!cancelled&&Object.keys(cached).length>0)setSignalResults(cached);
      const histLoaded = {};
      (cfg.verticals || []).forEach((v) => {
        const kh = hashKeywordsForVertical(v);
        const hp = ld(historyKey(v.id, kh), null) || ld(historyLatestKey(v.id), null);
        if (hp) histLoaded[v.id] = hp;
      });
      if (!cancelled && Object.keys(histLoaded).length > 0) {
        setTsHistoryByVertical(histLoaded);
        recomputeCrossCorr(histLoaded);
      }
      const ghW = {};
      const ghH = {};
      const ghL = {};
      (cfg.verticals || []).forEach((v) => {
        ghW[v.id] = ld(ghWatchlistKey(v.id), []);
        ghH[v.id] = ld(ghHistoryKey(v.id), null);
        ghL[v.id] = ld(ghLiveKey(v.id), []);
      });
      if (!cancelled) {
        setGithubWatchlists(ghW);
        setGithubHistoryByVertical(ghH);
        setGithubLiveByVertical(ghL);
        if ((cfg.verticals || [])[0]) setGithubSelectedVert(cfg.verticals[0].id);
      }
    })();
    return()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    const id=setInterval(()=>{const pat=resolveGitPat();if(signalStoreSecret()||pat||databaseStoreSecret())syncToGist(pat).catch(()=>{});},120000);
    const onUnload=()=>{if(!_cloudInitDone)return;const db=databaseStoreSecret();if(db){const data=getAllData();try{fetch("/api/dashboard-state",{method:"POST",headers:{Authorization:`Bearer ${db}`,"Content-Type":"application/json"},body:JSON.stringify({data}),keepalive:true});}catch(e){}return;}const sec=signalStoreSecret();if(sec){const data=getAllData();try{fetch("/api/signal-store",{method:"POST",headers:{Authorization:`Bearer ${sec}`,"Content-Type":"application/json"},body:JSON.stringify({data}),keepalive:true});}catch(e){}return;}const pat=resolveGitPat();if(pat){const data=getAllData();const gistId=effectiveGistId();if(gistId){const body=JSON.stringify({files:{"signal-data.json":{content:JSON.stringify(data)}}});try{fetch(`https://api.github.com/gists/${gistId}`,{method:"PATCH",headers:{Authorization:`Bearer ${pat}`,"Content-Type":"application/json"},body,keepalive:true});}catch(e){}}}};
    window.addEventListener("beforeunload",onUnload);
    return()=>{clearInterval(id);window.removeEventListener("beforeunload",onUnload);};
  },[resolveGitPat]);

  const toggleOverlay=useCallback(key=>{setOverlaySelected(p=>p.includes(key)?p.filter(k=>k!==key):[...p,key]);},[]);

  const fetchSource=useCallback(async(sourceId,verticalId)=>{
    const cfg=configRef.current;const source=cfg.sources.find(s=>s.id===sourceId);if(!source||!source.enabled)return;
    const verts=verticalId?cfg.verticals.filter(v=>v.id===verticalId):cfg.verticals;
    for(const vert of verts){
      const key=`${vert.id}_${source.id}`;
      setLoading(p=>({...p,[key]:true,[sourceId]:true}));setErrors(p=>({...p,[key]:null}));
      try{
        const json=await callSource(source,vert,cfg.apiKeys);const parsed=parseSourceResponse(source,json);
        let classification=null;
        if(source.type==="classified_text"&&parsed.items.length>0){classification=classifyItems(parsed.items,cfg.stages);parsed.items=classification.stagedItems||parsed.items;}
        const result={...parsed,classification,timestamp:Date.now()};
        setSignalResults(p=>({...p,[key]:result}));
        const h=appendSignalHistory(key,result.count||0);
        setAllHistories(p=>({...p,[key]:h}));
      }catch(e){setErrors(p=>({...p,[key]:e.message}));}
      setLoading(p=>({...p,[key]:false}));await sleep(300);
    }
    setLoading(p=>({...p,[sourceId]:false}));
    const pat=resolveGitPat();if(pat||signalStoreSecret()||databaseStoreSecret())debouncedSyncToGist(pat,3000);
  },[resolveGitPat]);

  const refreshAll=useCallback(async()=>{
    const cfg=configRef.current;
    await Promise.allSettled(cfg.sources.filter(s=>s.enabled).map(src=>fetchSource(src.id)));
    const sr=srRef.current;const na=evalAlerts(cfg.verticals,sr,cfg.alertRules,cfg.alertThreshold||10);
    if(na.length>0)setAlerts(p=>[...na,...p].slice(0,50));
    doCloudSync("up");
  },[fetchSource,doCloudSync]);

  const refreshPulse=useCallback(async()=>{
    setPulseLoading(true);
    setPulseErr(null);
    try{
      const [rMacro,rNews]=await Promise.allSettled([fetch("/api/labor/overview"),fetch("/api/ai-news")]);
      const errs=[];
      let overview=null;
      let newsPack=null;
      if(rMacro.status==="fulfilled"&&rMacro.value.ok){
        overview=await rMacro.value.json().catch(()=>null);
        if(overview) {
          setPulseOverview(overview);
          try{
            appendLaborMacroSnapshot({
              fetched_at: overview.fetched_at,
              chicago_release: overview.chicago_fed?.release_date ?? null,
              forecast_u: overview.chicago_fed?.forecast_unemployment ?? null,
              official_u3: overview.chicago_fed?.official_u3 ?? null,
              jolts: (overview.fred_latest || []).find((x) => x.series_id === "JTSJOL")?.value ?? null,
              claims: (overview.fred_latest || []).find((x) => x.series_id === "ICSA")?.value ?? null,
            });
          }catch{}
        }
      } else {
        const msg=rMacro.status==="fulfilled"?(await rMacro.value.json().catch(()=>({}))).error||`${rMacro.value.status}`:String(rMacro.reason||"macro fetch failed");
        errs.push(`Macro: ${msg}`);
      }
      if(rNews.status==="fulfilled"&&rNews.value.ok){
        newsPack=await rNews.value.json().catch(()=>null);
        if(newsPack) setPulseNews(newsPack);
      } else {
        const msg=rNews.status==="fulfilled"?(await rNews.value.json().catch(()=>({}))).error||`${rNews.value.status}`:String(rNews.reason||"news fetch failed");
        errs.push(`News: ${msg}`);
      }
      if(errs.length) setPulseErr(errs.join(" · "));
      if(overview||newsPack){
        try{ sv(PULSE_CACHE_KEY,{ overview: overview||ld(PULSE_CACHE_KEY,null)?.overview, news: newsPack||ld(PULSE_CACHE_KEY,null)?.news, savedAt: Date.now() }); }catch{}
      }
      const pat=resolveGitPat();if(pat||signalStoreSecret()||databaseStoreSecret()) debouncedSyncToGist(pat,4000);
    }catch(e){
      setPulseErr(e.message||String(e));
    }finally{
      setPulseLoading(false);
    }
  },[resolveGitPat]);

  const updateKeywords=useCallback((vertId,sourceId,field,nv)=>{
    setConfig(prev=>{
      const oldVert = prev.verticals.find(v => v.id === vertId);
      const oldVal = oldVert?.keywords?.[sourceId]?.[field];
      const oldStr = JSON.stringify(Array.isArray(oldVal) ? oldVal.filter(Boolean).sort() : oldVal);
      const newStr = JSON.stringify(Array.isArray(nv) ? nv.filter(Boolean).sort() : nv);
      const vs=prev.verticals.map(v=>v.id!==vertId?v:{...v,keywords:{...v.keywords,[sourceId]:{...v.keywords[sourceId],[field]:nv}}});
      const next={...prev,verticals:vs};sv("config",next);
      if (oldStr !== newStr) {
        const histKey = `${vertId}_${sourceId}`;
        sv(`hist_${histKey}`, []);
        setAllHistories(p => ({ ...p, [histKey]: [] }));
      }
      return next;
    });
  },[]);

  const addGroup=useCallback(name=>{
    setConfig(prev=>{
      const next={...prev,verticals:[...prev.verticals,{id:`v_${Date.now()}`,name,color:PALETTE[prev.verticals.length%PALETTE.length],description:"",keywords:{theirstack:{titleKeywords:[],descriptionKeywords:[]},google_trends:{keywords:[]},github_repos:{keywords:[]},claude_attrib:{keywords:[]}}}]};
      sv("config",next);return next;
    });
  },[]);

  const fetchTheirStackCountInRange = useCallback(async (vertical, gte, lte) => {
    const source = configRef.current.sources.find(s => s.id === "theirstack");
    if (!source) throw new Error("TheirStack source not configured");
    const cfg = source.apiConfig;
    const keys = configRef.current.apiKeys;
    if (resolveTheirStackMocking(source, keys)) {
      return mockTheirStackCountForRange(vertical, gte, lte);
    }
    const key = resolveKey(source, keys);
    if (!key) throw new Error("Missing TheirStack API key in .env");
    const kw = vertical.keywords?.theirstack || {};
    const body = JSON.parse(cfg.bodyTemplate || "{}");
    body.limit = 1;
    body.include_total_results = true;
    body.posted_at_gte = gte;
    body.posted_at_lte = lte;
    delete body.posted_at_max_age_days;
    body.job_title_or = kw.titleKeywords || [];
    body.job_description_pattern_or = kw.descriptionKeywords || [];
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (res.status === 402 || res.status === 429) {
      return mockTheirStackCountForRange(vertical, gte, lte);
    }
    if (!res.ok) throw new Error(`TheirStack HTTP ${res.status}`);
    const json = await res.json();
    return Number(json?.metadata?.total_results || 0);
  }, []);

  const fetchGoogleTrendsHistory = useCallback(async (vertical) => {
    const key = resolveKey(configRef.current.sources.find(s => s.id === "google_trends") || {}, configRef.current.apiKeys);
    if (!key) throw new Error("Missing SerpAPI key");
    const kw = vertical.keywords?.google_trends?.keywords;
    const q = Array.isArray(kw) ? kw.filter(Boolean).join(",") : (kw || "");
    if (!q) throw new Error("No keywords");
    const url = `/api/google-trends?engine=google_trends&data_type=TIMESERIES&q=${encodeURIComponent(q)}&date=today+12-m&api_key=${key}`;
    let res;
    try {
      res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      try {
        res = await fetch(`/serpapi/search.json?engine=google_trends&data_type=TIMESERIES&q=${encodeURIComponent(q)}&date=today+12-m&api_key=${key}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        res = await fetch(`https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES&q=${encodeURIComponent(q)}&date=today+12-m&api_key=${key}`);
      }
    }
    if (res.status === 402) throw new Error("API credits exhausted");
    if (!res.ok) { let detail=""; try{const j=await res.clone().json();detail=j.error||"";}catch{} throw new Error(detail || `SerpAPI HTTP ${res.status}`); }
    const json = await res.json();
    const tl = json.interest_over_time?.timeline_data || [];
    return tl.map(d => {
      const ts = parseInt(d.timestamp, 10) * 1000;
      const val = d.values?.[0] ? parseInt(d.values[0].extracted_value ?? d.values[0].value, 10) : 0;
      const dt = new Date(ts);
      return { month: dt.toISOString().slice(0, 7), date: dt.toISOString().slice(0, 10), value: val, ts };
    });
  }, []);

  const buildGitHubQuery = useCallback((vertical, sourceId) => {
    if (sourceId === "github_repos") {
      const kw = vertical.keywords?.github_repos?.keywords;
      const raw = Array.isArray(kw) ? kw.filter(Boolean) : (kw ? [kw] : []);
      if (!raw.length) return null;
      return raw.map(k => k.includes(" ") ? `"${k}"` : k).join("+");
    }
    if (sourceId === "claude_attrib") {
      const kw = vertical.keywords?.claude_attrib?.keywords;
      const raw = Array.isArray(kw) ? kw.filter(Boolean) : (kw ? [kw] : []);
      if (!raw.length) return `"Co-Authored-By: Claude"`;
      const kwPart = raw.map(k => k.includes(" ") ? `"${k}"` : k).join("+");
      return `"Co-Authored-By: Claude"+${kwPart}`;
    }
    return null;
  }, []);

  const fetchGitHubCountInRange = useCallback(async (vertical, sourceId, gte, lte) => {
    const token = ENV_KEYS.github || "";
    const headers = token ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } : { Accept: "application/vnd.github+json" };

    const baseQ = buildGitHubQuery(vertical, sourceId);
    if (!baseQ) return 0;

    let q, endpoint;
    if (sourceId === "github_repos") {
      q = `${baseQ}+pushed:${gte}..${lte}`;
      endpoint = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&per_page=1`;
    } else {
      q = `${baseQ}+committer-date:${gte}..${lte}`;
      endpoint = `https://api.github.com/search/commits?q=${encodeURIComponent(q)}&sort=committer-date&per_page=1`;
      headers.Accept = "application/vnd.github.cloak-preview+json";
    }

    const res = await fetch(endpoint, { headers });
    if (res.status === 422) return 0;
    if (!res.ok) throw new Error(await githubApiErrorMessage(res));
    const json = await res.json();
    return json.total_count || 0;
  }, [buildGitHubQuery]);

  const recomputeCrossCorr = useCallback((histObj) => {
    const matrix = computeCrossCorrMatrix(histObj);
    setCrossCorr(matrix);
    sv(crossCorrKey(), matrix);
  }, []);

  const backfillSignalSource = useCallback(async (verticalId, sourceId) => {
    const vert = configRef.current.verticals.find(v => v.id === verticalId);
    if (!vert) return;
    cancelHistoryRef.current = false;
    const signalKey = `${verticalId}_${sourceId}`;
    const histCacheKey = `backfill_v5_${signalKey}`;
    const cached = ld(histCacheKey, null);
    if (cached?.version === 5 && cached?.points?.length >= 50) {
      cached.points.forEach(p => {
        const h = ld(`hist_${signalKey}`, []);
        if (!h.some(x => x.isoDate === p.isoDate)) {
          h.push(p);
          if (h.length > 500) h.splice(0, h.length - 500);
          sv(`hist_${signalKey}`, h);
        }
      });
      setAllHistories(prev => ({ ...prev, [signalKey]: getSignalHistory(signalKey) }));
      return;
    }

    if (sourceId === "google_trends") {
      setHistoryProgress({ active: true, verticalId, current: 0, total: 1, label: `Backfilling ${vert.name} Google Trends (1yr)...` });
      try {
        const points = await fetchGoogleTrendsHistory(vert);
        const recorded = [];
        points.forEach(p => {
          const entry = { ts: p.ts, isoDate: new Date(p.ts).toISOString(), value: p.value, date: p.date };
          recorded.push(entry);
          const h = ld(`hist_${signalKey}`, []);
          if (!h.some(x => Math.abs(x.ts - p.ts) < 86400000)) {
            h.push(entry);
            h.sort((a, b) => a.ts - b.ts);
            if (h.length > 500) h.splice(0, h.length - 500);
            sv(`hist_${signalKey}`, h);
          }
        });
        sv(histCacheKey, { version: 5, generatedAt: new Date().toISOString(), points: recorded });
        setAllHistories(prev => ({ ...prev, [signalKey]: getSignalHistory(signalKey) }));
      } catch (e) {
        setErrors(prev => ({ ...prev, [signalKey]: e.message }));
      }
      setHistoryProgress({ active: false, verticalId: null, current: 0, total: 0, label: "" });
      return;
    }

    if (sourceId === "github_repos") {
      setErrors(prev => ({ ...prev, [signalKey]: "GitHub Repos backfill is disabled — the Search API returns inconsistent historical counts. Use Refresh to build history over time." }));
      return;
    }
    if (sourceId === "claude_attrib") {
      const token = ENV_KEYS.github || "";
      if (!token) {
        setErrors(prev => ({ ...prev, [signalKey]: "GitHub PAT required for backfill." }));
        return;
      }
      const baseQ = buildGitHubQuery(vert, sourceId);
      if (!baseQ) {
        setErrors(prev => ({ ...prev, [signalKey]: `No keywords configured for Claude Attribution. Add keywords in your signal group settings.` }));
        return;
      }
      const weeks = weekIntervals(78, new Date());
      setHistoryProgress({ active: true, verticalId, current: 0, total: weeks.length, label: `Backfilling ${vert.name} Claude (weekly windows)...` });
      const recorded = [];
      let consecutiveErrors = 0;
      for (let i = 0; i < weeks.length; i++) {
        if (cancelHistoryRef.current) break;
        const w = weeks[i];
        try {
          const count = await fetchGitHubCountInRange(vert, sourceId, w.gte, w.lte);
          consecutiveErrors = 0;
          const ts = new Date(w.lte + "T12:00:00Z").getTime();
          const entry = { ts, isoDate: new Date(ts).toISOString(), value: count, date: w.key };
          recorded.push(entry);
          const h = ld(`hist_${signalKey}`, []);
          if (!h.some(x => Math.abs(x.ts - ts) < 86400000 * 3)) {
            h.push(entry);
            h.sort((a, b) => a.ts - b.ts);
            if (h.length > 500) h.splice(0, h.length - 500);
            sv(`hist_${signalKey}`, h);
          }
        } catch (e) {
          if (e.message?.includes("rate limit")) { await sleep(65000); i--; continue; }
          consecutiveErrors++;
          setErrors(prev => ({ ...prev, [signalKey]: `${e.message} (week ${w.key}, ${consecutiveErrors} consecutive errors)` }));
          if (consecutiveErrors >= 5) break;
          await sleep(6000);
          continue;
        }
        setHistoryProgress({ active: true, verticalId, current: i + 1, total: weeks.length, label: `Backfilling ${vert.name} Claude (${i + 1}/${weeks.length})...` });
        await sleep(4500);
      }
      if (recorded.length > 0) {
        sv(histCacheKey, { version: 5, generatedAt: new Date().toISOString(), points: recorded });
        setAllHistories(prev => ({ ...prev, [signalKey]: getSignalHistory(signalKey) }));
      }
      setHistoryProgress({ active: false, verticalId: null, current: 0, total: 0, label: "" });
      const pat = resolveGitPat(); if (pat || signalStoreSecret() || databaseStoreSecret()) debouncedSyncToGist(pat, 2000);
      return;
    }
    const pat=resolveGitPat();if(pat||signalStoreSecret()||databaseStoreSecret())debouncedSyncToGist(pat,2000);
  }, [fetchGoogleTrendsHistory, fetchGitHubCountInRange, resolveGitPat]);

  const loadFullHistory = useCallback(async (verticalId, force = false) => {
    const vert = configRef.current.verticals.find(v => v.id === verticalId);
    if (!vert) return;
    const kh = hashKeywordsForVertical(vert);
    const hKey = historyKey(verticalId, kh);
    const wKey = weeklyKey(verticalId, kh);
    const cached = ld(hKey, null) || ld(historyLatestKey(verticalId), null);
    if (cached && !force) {
      setTsHistoryByVertical(prev => {
        const next = { ...prev, [verticalId]: cached };
        recomputeCrossCorr(next);
        return next;
      });
      setPatternNotes(ld(patternNoteKey(verticalId), {}));
      return;
    }
    const tsSource = configRef.current.sources.find(s => s.id === "theirstack");
    const isMock = resolveTheirStackMocking(tsSource, configRef.current.apiKeys);
    cancelHistoryRef.current = false;
    setHistoryProgress({active:true,verticalId,current:0,total:0,label:`Backfilling ${vert.name}...`});
    const months = monthIntervals(HIST_START, new Date());
    setHistoryProgress({active:true,verticalId,current:0,total:months.length + 52,label:`Backfilling ${vert.name} monthly...`});
    const monthly = [];
    for (let i = 0; i < months.length; i++) {
      if (cancelHistoryRef.current) break;
      const m = months[i];
      const count = await fetchTheirStackCountInRange(vert, m.gte, m.lte);
      monthly.push({ month: m.key, count });
      setHistoryProgress({active:true,verticalId,current:i+1,total:months.length + 52,label:`Backfilling ${vert.name} monthly...`});
      if (!isMock) await sleep(300);
    }
    if (cancelHistoryRef.current) { setHistoryProgress({active:false,verticalId:null,current:0,total:0,label:""}); return; }
    const weeks = weekIntervals(52, new Date());
    const weekly = [];
    for (let i = 0; i < weeks.length; i++) {
      if (cancelHistoryRef.current) break;
      const w = weeks[i];
      const count = await fetchTheirStackCountInRange(vert, w.gte, w.lte);
      weekly.push({ week: w.key, count });
      setHistoryProgress({active:true,verticalId,current:months.length + i + 1,total:months.length + 52,label:`Backfilling ${vert.name} weekly...`});
      if (!isMock) await sleep(300);
    }
    if (cancelHistoryRef.current) { setHistoryProgress({active:false,verticalId:null,current:0,total:0,label:""}); return; }
    const derivedPack = deriveHistoryMetrics(monthly, weekly);
    const payload = { verticalId, keywordsHash: kh, generatedAt: new Date().toISOString(), ...derivedPack };
    sv(hKey, payload);
    sv(wKey, { verticalId, keywordsHash: kh, weekly: derivedPack.weekly, generatedAt: payload.generatedAt });
    sv(historyLatestKey(verticalId), payload);
    sv(weeklyLatestKey(verticalId), { verticalId, keywordsHash: kh, weekly: derivedPack.weekly, generatedAt: payload.generatedAt });
    setTsHistoryByVertical(prev => {
      const next = { ...prev, [verticalId]: payload };
      recomputeCrossCorr(next);
      return next;
    });
    setPatternNotes(ld(patternNoteKey(verticalId), {}));
    setHistoryProgress({active:false,verticalId:null,current:0,total:0,label:""});
    const pat=resolveGitPat();if(pat||signalStoreSecret()||databaseStoreSecret())debouncedSyncToGist(pat,2000);
  }, [fetchTheirStackCountInRange, recomputeCrossCorr, resolveGitPat]);

  const autoFetchRecentHistory = useCallback(async (verticalId) => {
    const vert = configRef.current.verticals.find(v => v.id === verticalId);
    if (!vert) return;
    const source = configRef.current.sources.find(s => s.id === "theirstack");
    if (!source) return;
    const keys = configRef.current.apiKeys;
    const isMock = resolveTheirStackMocking(source, keys);
    if (!isMock && !resolveKey(source, keys)) return;
    const kh = hashKeywordsForVertical(vert);
    const existing = tsHistoryByVertical[verticalId];
    const numWeeks = existing ? 8 : 12;
    const weeks = weekIntervals(numWeeks, new Date());
    const fresh = [];
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      try {
        const count = await fetchTheirStackCountInRange(vert, w.gte, w.lte);
        fresh.push({ week: w.key, count });
      } catch (e) {
        if (e.message?.includes("402") || e.message?.includes("credits")) break;
        break;
      }
      if (!isMock) await sleep(400);
    }
    if (!fresh.length) return;
    const oldMonthly = existing?.monthly || [];
    const oldWeekly = (existing?.weekly || []).filter(w => !fresh.some(n => n.week === w.week));
    const weekly = [...oldWeekly, ...fresh].sort((a,b)=>a.week.localeCompare(b.week)).slice(-52);
    const derivedPack = deriveHistoryMetrics(oldMonthly, weekly);
    const payload = { verticalId, keywordsHash: kh, generatedAt: new Date().toISOString(), ...derivedPack };
    sv(historyKey(verticalId, kh), payload);
    sv(historyLatestKey(verticalId), payload);
    setTsHistoryByVertical(prev => {
      const next = { ...prev, [verticalId]: payload };
      recomputeCrossCorr(next);
      return next;
    });
  }, [fetchTheirStackCountInRange, tsHistoryByVertical, recomputeCrossCorr]);

  const cancelHistoryLoad = useCallback(()=>{ cancelHistoryRef.current = true; }, []);

  const updateMailingList = useCallback((emails) => {
    setMailingList(emails);
    sv("mailing_list", emails);
    const pat=resolveGitPat();if(pat||signalStoreSecret()||databaseStoreSecret())debouncedSyncToGist(pat);
  }, [resolveGitPat]);

  const sendReportEmail = useCallback(async (content, week, snapshot = null) => {
    if (!mailingList.length) { setEmailStatus("No recipients — add emails in the Mailing List tab"); setTimeout(()=>setEmailStatus(null), 4000); return; }
    if (!content) { setEmailStatus("No report content to send"); setTimeout(()=>setEmailStatus(null), 4000); return; }
    const emailCfg = ld("emailjs_config", null);
    if (!emailCfg?.service_id || !emailCfg?.template_id || !emailCfg?.public_key) {
      setEmailStatus("EmailJS not configured — set up in the Mailing List tab");
      setTimeout(() => setEmailStatus(null), 5000);
      return;
    }
    setEmailSending(true);
    let sent = 0, failed = 0, lastErr = "";
    const asciiBlock = buildBriefAsciiCharts(snapshot);
    const plainBundle = content + asciiBlock;
    const trimmedContent = plainBundle.length > 40000 ? plainBundle.slice(0, 40000) + "\n\n[Report truncated for email delivery]" : plainBundle;
    const reportHtml = briefEmailHtmlDocument(week, snapshot, content, false, "");
    const trimmedHtml = reportHtml.length > 52000 ? reportHtml.slice(0, 52000) + "<p>…</p></div></body></html>" : reportHtml;
    for (let i = 0; i < mailingList.length; i++) {
      setEmailStatus(`Sending ${i + 1}/${mailingList.length}...`);
      try {
        const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: emailCfg.service_id,
            template_id: emailCfg.template_id,
            user_id: emailCfg.public_key,
            template_params: {
              to_email: mailingList[i],
              subject: `AI Demand Signal Weekly Report — ${week}`,
              report_content: trimmedContent,
              report_html: trimmedHtml,
              week: week,
            },
          }),
        });
        if (res.ok) { sent++; } else {
          failed++;
          try { lastErr = await res.text(); } catch { lastErr = `HTTP ${res.status}`; }
        }
      } catch (e) { failed++; lastErr = e.message; }
      if (i < mailingList.length - 1) await sleep(1100);
    }
    setEmailSending(false);
    if (failed === 0) setEmailStatus(`Sent to ${sent} recipient${sent !== 1 ? "s" : ""}`);
    else setEmailStatus(`Sent ${sent}, failed ${failed}: ${lastErr.slice(0, 100)}`);
    setTimeout(() => setEmailStatus(null), 8000);
  }, [mailingList]);

  const savePatternNote = useCallback((verticalId, key, text) => {
    setPatternNotes(prev => {
      const next = { ...prev, [key]: text };
      sv(patternNoteKey(verticalId), next);
      return next;
    });
  }, []);

  

  const runGitHubLiveSpotCheck = useCallback(async (verticalId) => {
    const watch = githubWatchlists[verticalId] || [];
    const repos = new Set(watch.map(w => (w.repo || "").trim()).filter(Boolean));
    if (!repos.size) return;
    const files = lastNArchiveHours(3);
    const counts = {};
    [...repos].forEach(r => { counts[r] = { repo:r, stars_24h:0, forks_24h:0, pushes_24h:0, create_24h:0 }; });
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        await streamGhArchiveFile(f.url, (evt) => {
          const repo = evt?.repo?.name;
          if (!repo || !repos.has(repo)) return;
          const t = evt.type;
          if (t === "WatchEvent") counts[repo].stars_24h += 1;
          if (t === "ForkEvent") counts[repo].forks_24h += 1;
          if (t === "PushEvent") counts[repo].pushes_24h += 1;
          if (t === "CreateEvent") counts[repo].create_24h += 1;
        });
      }
      const out = Object.values(counts).map(c => ({ ...c, hour: new Date().toISOString() }));
      setGithubLiveByVertical(prev => {
        const next = { ...prev, [verticalId]: out };
        sv(ghLiveKey(verticalId), out);
        return next;
      });
    } catch (e) {
      const ok = confirm(`Archive stream failed (${e.message}). Try GitHub API fallback?`);
      if (ok) {
        const token = ENV_KEYS.github || "";
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const nowMs = Date.now();
        for (const repo of repos) {
          try {
            const res = await fetch(`https://api.github.com/repos/${repo}/events?per_page=100`, { headers });
            if (!res.ok) continue;
            const ev = await res.json();
            const rec = { repo, stars_24h:0, forks_24h:0, pushes_24h:0, create_24h:0, hour:new Date().toISOString() };
            ev.forEach((x) => {
              const ts = new Date(x.created_at).getTime();
              if (nowMs - ts > 24*3600000) return;
              if (x.type === "WatchEvent") rec.stars_24h += 1;
              if (x.type === "ForkEvent") rec.forks_24h += 1;
              if (x.type === "PushEvent") rec.pushes_24h += 1;
              if (x.type === "CreateEvent") rec.create_24h += 1;
            });
            setGithubLiveByVertical(prev => {
              const arr = [...(prev[verticalId] || []).filter(r => r.repo !== repo), rec];
              const next = { ...prev, [verticalId]: arr };
              sv(ghLiveKey(verticalId), arr);
              return next;
            });
          } catch {}
        }
      }
    }
  }, [githubWatchlists]);

  const buildGitHubSqlForVertical = useCallback((verticalId) => {
    const watch = githubWatchlists[verticalId] || [];
    return generateGitHubBigQuerySQL(watch);
  }, [githubWatchlists]);

  const importGitHubCsvForVertical = useCallback(async (verticalId, file) => {
    const txt = await file.text();
    const rows = parseCsvRows(txt);
    const watch = githubWatchlists[verticalId] || [];
    const agg = aggregateGitHubCsv(rows, watch);
    const payload = { verticalId, generatedAt: new Date().toISOString(), monthly: agg.monthly, derived: agg.derived };
    setGithubHistoryByVertical(prev => {
      const next = { ...prev, [verticalId]: payload };
      sv(ghHistoryKey(verticalId), payload);
      return next;
    });
  }, [githubWatchlists]);

  const composites=useMemo(()=>{const o={};config.verticals.forEach(v=>{o[v.id]=computeComposite(v.id,signalResults,config.sources,config.stageMultipliers,tsHistoryByVertical,githubHistoryByVertical);});return o;},[signalResults,config,tsHistoryByVertical,githubHistoryByVertical]);

  const buildBriefContext = useCallback(() => {
    const wk = weekKeyFromDate(new Date());
    const dq = [];
    const cfg = configRef.current;
    const tsSrc0 = cfg.sources.find((s) => s.id === "theirstack");
    if (tsSrc0 && resolveTheirStackMocking(tsSrc0, cfg.apiKeys)) {
      dq.push("TheirStack job counts are simulated (no API key, or VITE_THEIRSTACK_MOCK enabled). Replace with a live key when ready.");
    }

    const buildTimeSeries = (hist) => {
      if (!hist?.length) return null;
      const sorted = [...hist].sort((a,b) => a.ts - b.ts);
      const vals = sorted.map(p => p.value);
      const n = vals.length;
      const latest = vals[n - 1] || 0;
      const prev = n >= 2 ? vals[n - 2] : null;
      const pctChange = prev && prev > 0 ? Math.round(((latest - prev) / prev) * 100) : null;
      const val3wAgo = n >= 4 ? vals[n - 4] : (n >= 2 ? vals[0] : null);
      const pctChange3w = val3wAgo && val3wAgo > 0 ? Math.round(((latest - val3wAgo) / val3wAgo) * 100) : null;
      const first = vals[0] || 0;
      const allTimeChange = first > 0 ? Math.round(((latest - first) / first) * 100) : null;
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      const avg = n > 0 ? Math.round(vals.reduce((a,b)=>a+b,0) / n) : 0;
      const stddev = n > 1 ? Math.round(Math.sqrt(vals.reduce((s,v)=>s+(v-avg)**2,0)/(n-1))) : 0;
      const last5 = vals.slice(-5);
      const prev5 = vals.slice(-10, -5);
      const last3 = vals.slice(-3);
      const prev3 = vals.slice(-6, -3);
      const last5Avg = last5.length ? Math.round(last5.reduce((a,b)=>a+b,0)/last5.length) : 0;
      const prev5Avg = prev5.length ? Math.round(prev5.reduce((a,b)=>a+b,0)/prev5.length) : null;
      const last3Avg = last3.length ? Math.round(last3.reduce((a,b)=>a+b,0)/last3.length) : 0;
      const prev3Avg = prev3.length ? Math.round(prev3.reduce((a,b)=>a+b,0)/prev3.length) : null;
      const momentum5 = prev5Avg && prev5Avg > 0 ? Math.round(((last5Avg - prev5Avg) / prev5Avg) * 100) : null;
      const momentum3 = prev3Avg && prev3Avg > 0 ? Math.round(((last3Avg - prev3Avg) / prev3Avg) * 100) : null;
      const zScore = stddev > 0 ? Number(((latest - avg) / stddev).toFixed(2)) : 0;
      const diffs = [];
      for (let i = 1; i < vals.length; i++) diffs.push(vals[i] - vals[i-1]);
      const accelRecent = diffs.length >= 4 ? Math.round((diffs.slice(-2).reduce((a,b)=>a+b,0)/2) - (diffs.slice(-4,-2).reduce((a,b)=>a+b,0)/2)) : null;

      let consecutiveUp = 0, consecutiveDown = 0;
      for (let i = vals.length - 1; i >= 1; i--) {
        if (vals[i] > vals[i-1]) { if (consecutiveDown > 0) break; consecutiveUp++; }
        else if (vals[i] < vals[i-1]) { if (consecutiveUp > 0) break; consecutiveDown++; }
        else break;
      }
      return {
        data_points: n,
        observation_span_days: Math.round((new Date(sorted[n-1]?.isoDate || sorted[n-1]?.ts).getTime() - new Date(sorted[0]?.isoDate || sorted[0]?.ts).getTime()) / 86400000),
        first_recorded: sorted[0]?.isoDate || new Date(sorted[0]?.ts).toISOString(),
        latest_recorded: sorted[n-1]?.isoDate || new Date(sorted[n-1]?.ts).toISOString(),
        latest_value: latest,
        previous_value: prev,
        pct_change_vs_previous: pctChange,
        pct_change_3_weeks: pctChange3w,
        value_3_weeks_ago: val3wAgo,
        all_time_change_pct: allTimeChange,
        all_time_high: max,
        all_time_low: min,
        average: avg,
        std_deviation: stddev,
        z_score_current: zScore,
        recent_5pt_avg: last5Avg,
        prior_5pt_avg: prev5Avg,
        rolling_momentum_5pt_pct: momentum5,
        rolling_momentum_3pt_pct: momentum3,
        acceleration_signal: accelRecent,
        is_at_all_time_high: latest >= max,
        is_near_all_time_low: latest <= min * 1.1,
        consecutive_increases: consecutiveUp,
        consecutive_decreases: consecutiveDown,
        recent_values: sorted.slice(-21).map(p => ({ date: p.isoDate || new Date(p.ts).toISOString(), value: p.value })),
      };
    };

    const verticalsCtx = cfg.verticals.map((v) => {
      const comp = composites[v.id] || { score: 0, breakdown: {} };
      const jobs = signalResults[`${v.id}_theirstack`];
      const tr = signalResults[`${v.id}_google_trends`];
      const repos = signalResults[`${v.id}_github_repos`];
      const claude = signalResults[`${v.id}_claude_attrib`];
      const tsHist = tsHistoryByVertical[v.id];
      const ghHist = githubHistoryByVertical[v.id];

      if (!jobs?.count) dq.push(`${v.name}: jobs data missing or stale`);
      if (!tr?.count && tr?.count !== 0) dq.push(`${v.name}: Google Trends unavailable`);
      if (!repos?.count && repos?.count !== 0) dq.push(`${v.name}: GitHub repos unavailable`);

      const jobHist = getSignalHistory(`${v.id}_theirstack`);
      const trendHist = getSignalHistory(`${v.id}_google_trends`);
      const repoHist = getSignalHistory(`${v.id}_github_repos`);
      const claudeHist = getSignalHistory(`${v.id}_claude_attrib`);

      const stage = resolveStage(comp.score || 0, cfg.stageTaxonomy || DEFAULT_STAGE_TAXONOMY);
      const jobCount = jobs?.count || 0;
      const ghIdx = ghHist?.derived?.currentIndex || 0;
      const trendIdx = tr?.count || 0;

      const divergences = [];
      if (jobCount > 100 && ghIdx < 80) divergences.push({ pair: "jobs_vs_github", direction: "jobs_leading", magnitude: jobCount - ghIdx, interpretation: "Enterprise hiring ahead of open-source adoption — budget commitment without developer narrative" });
      else if (jobCount < 80 && ghIdx > 140) divergences.push({ pair: "jobs_vs_github", direction: "github_leading", magnitude: ghIdx - jobCount, interpretation: "Developer interest/experimentation outpacing formal hiring — early exploration phase or POC stage" });
      if (jobCount > 100 && trendIdx < 30) divergences.push({ pair: "jobs_vs_trends", direction: "jobs_leading", magnitude: jobCount - trendIdx, interpretation: "Quiet hiring — enterprises building AI capability without public buzz, potentially stealth mode" });
      else if (jobCount < 50 && trendIdx > 70) divergences.push({ pair: "jobs_vs_trends", direction: "trends_leading", magnitude: trendIdx - jobCount, interpretation: "Hype ahead of substance — public interest exceeds actual enterprise commitment" });

      const jobTs = buildTimeSeries(jobHist);
      const trendTs = buildTimeSeries(trendHist);
      if (jobTs && trendTs) {
        const jobMom = jobTs.rolling_momentum_5pt_pct || 0;
        const trendMom = trendTs.rolling_momentum_5pt_pct || 0;
        if (Math.abs(jobMom - trendMom) > 25) divergences.push({ pair: "jobs_momentum_vs_trends_momentum", job_momentum_pct: jobMom, trend_momentum_pct: trendMom, delta: jobMom - trendMom, interpretation: jobMom > trendMom ? "Hiring acceleration outpacing search interest — conviction-driven build phase" : "Search interest surging ahead of hiring — awareness phase, not yet commitment" });
      }

      return {
        name: v.name,
        keywords: v.keywords,
        pipeline_stage: { index: stage.index + 1, label: stage.name, description: stage.description || "" },
        signals: {
          job_postings: {
            current_count: jobCount,
            classification_stage: jobs?.classification?.dominantStage?.name || null,
            classification_confidence: jobs?.classification?.confidence || null,
            time_series: jobTs,
          },
          google_trends: {
            current_index: trendIdx,
            momentum_pct: tr?.momentum || null,
            time_series: trendTs,
          },
          github_repos: {
            active_repos_30d: repos?.count || 0,
            time_series: buildTimeSeries(repoHist),
          },
          claude_code_attribution: {
            commits_7d: claude?.count || 0,
            time_series: buildTimeSeries(claudeHist),
          },
        },
        theirstack_historical: tsHist?.derived ? {
          baseline_monthly_avg: tsHist.derived.baseline,
          current_vs_baseline_pct: tsHist.derived.currentVsBaseline,
          velocity_slope: tsHist.derived.velocitySlope,
          acceleration_score: tsHist.derived.accelerationScore,
          anomaly_z_score: tsHist.derived.anomalyZ,
          all_time_high_pct: tsHist.derived.allTimeHighPct,
          peak_month: tsHist.derived.peakMonth,
          peak_count: tsHist.derived.peakCount,
          months_above_2x_baseline: tsHist.derived.monthsAbove2xBaseline,
          inflection_points: (tsHist.derived.inflections || []).slice(-5),
          recent_monthly: (tsHist.monthly || []).slice(-8).map(m => ({ month: m.month, count: m.count, index: m.index })),
        } : null,
        github_historical: ghHist?.derived ? {
          current_index: ghHist.derived.currentIndex,
          star_velocity: ghHist.derived.starVelocity,
          enterprise_repo_ratio: ghHist.derived.enterpriseRepoRatio,
          github_jobs_lag_months: ghHist.derived.githubJobsLag || null,
        } : null,
        divergence_signals: divergences,
      };
    });

    const leaders = crossCorr.filter(x => x.r > 0.4).slice(0, 8).map(x => {
      const lName = cfg.verticals.find(v=>v.id===x.leader)?.name || x.leader;
      const fName = cfg.verticals.find(v=>v.id===x.follower)?.name || x.follower;
      return { leader: lName, follower: fName, lag_months: x.lagMonths, correlation: Number((x.r || 0).toFixed(2)) };
    });

    const hfData = ld("hf_lb", null);
    const hfSummary = hfData?.orgs ? hfData.orgs.slice(0, 8).map(o => {
      const org = HF_ORGS.find(h=>h.id===o.orgId);
      return { org: org?.name || o.orgId, total_downloads: o.totalDownloads, model_count: o.modelCount, top_model: o.topModels?.[0]?.id || null, top_model_downloads: o.topModels?.[0]?.downloads || null };
    }) : null;

    const hfHist = getSignalHistory("hf_total");
    const hfTimeSeries = buildTimeSeries(hfHist);

    const fingerprint = JSON.stringify(Object.keys(signalResults).sort().map((k) => [k, signalResults[k]?.count ?? 0]));

    // Compute threshold-flagged signals: which metrics crossed the user's brief thresholds this week
    const bt = cfg.briefThresholds || { theirstack: 8, google_trends: 10, github_repos: 5, claude_attrib: 5, hf_downloads: 10 };
    const flaggedSignals = [];
    const quietSignals = [];
    verticalsCtx.forEach(v => {
      const checks = [
        { source: "theirstack", label: "Job Postings", ts: v.signals.job_postings?.time_series },
        { source: "google_trends", label: "Google Trends", ts: v.signals.google_trends?.time_series },
        { source: "github_repos", label: "GitHub Repos", ts: v.signals.github_repos?.time_series },
        { source: "claude_attrib", label: "Claude Attribution", ts: v.signals.claude_code_attribution?.time_series },
      ];
      checks.forEach(({ source, label, ts }) => {
        const threshold = bt[source] || 10;
        const wow = ts?.pct_change_vs_previous;
        const chg3w = ts?.pct_change_3_weeks;
        const zScore = ts?.z_score_current;
        const crossed = (chg3w != null && Math.abs(chg3w) >= threshold) || (wow != null && Math.abs(wow) >= threshold) || (zScore != null && Math.abs(zScore) >= 2.0);
        const entry = { vertical: v.name, signal: label, source, threshold, wow_1w: wow, change_3w: chg3w, z_score: zScore, crossed };
        if (crossed) flaggedSignals.push(entry);
        else quietSignals.push(entry);
      });
    });
    if (hfTimeSeries) {
      const hfThresh = bt.hf_downloads || 10;
      const hfWow = hfTimeSeries.pct_change_vs_previous;
      const hfChg3w = hfTimeSeries.pct_change_3_weeks;
      const hfCrossed = (hfChg3w != null && Math.abs(hfChg3w) >= hfThresh) || (hfWow != null && Math.abs(hfWow) >= hfThresh);
      (hfCrossed ? flaggedSignals : quietSignals).push({ vertical: "Global", signal: "HuggingFace Downloads", source: "hf_downloads", threshold: hfThresh, wow_1w: hfWow, change_3w: hfChg3w, crossed: hfCrossed });
    }

    // Conviction ratings: how many independent sources confirm the same move per vertical
    const convictionByVertical = {};
    verticalsCtx.forEach(v => {
      const flaggedForVert = flaggedSignals.filter(f => f.vertical === v.name);
      const confirming = flaggedForVert.length;
      const sameDirection = flaggedForVert.length >= 2 && flaggedForVert.every(f => (f.change_3w || f.wow_1w || 0) >= 0) || flaggedForVert.every(f => (f.change_3w || f.wow_1w || 0) <= 0);
      const rating = confirming >= 3 ? "HIGH" : confirming === 2 && sameDirection ? "MEDIUM" : confirming >= 1 ? "SPECULATIVE" : null;
      if (rating) convictionByVertical[v.name] = { rating, confirming_sources: flaggedForVert.map(f => f.signal), direction: flaggedForVert[0]?.change_3w >= 0 ? "accelerating" : "decelerating" };
    });
    flaggedSignals.forEach(f => {
      f.conviction = convictionByVertical[f.vertical]?.rating || "SPECULATIVE";
    });

    // Prior week's brief for "What We Got Wrong" retrospective
    let priorBriefSummary = null;
    try {
      const priorDate = new Date(); priorDate.setDate(priorDate.getDate() - 7);
      const priorWeek = weekKeyFromDate(priorDate);
      const priorObj = JSON.parse(localStorage.getItem(briefStorageKey(priorWeek)) || "null");
      if (priorObj?.content_markdown) {
        const lines = priorObj.content_markdown.split("\n");
        const convictionStart = lines.findIndex(l => /CONVICTION/i.test(l));
        const riskStart = lines.findIndex((l, i) => i > convictionStart && /RISK|━━━/i.test(l));
        if (convictionStart >= 0) {
          const end = riskStart > convictionStart ? riskStart : Math.min(convictionStart + 20, lines.length);
          priorBriefSummary = { week: priorWeek, conviction_calls_text: lines.slice(convictionStart, end).join("\n").slice(0, 1500) };
        }
      }
    } catch {}

    const ctx = {
      generated_at: new Date().toISOString(),
      week: wk,
      fingerprint,
      report_calendar: {
        iso_week_id: wk,
        generated_at: new Date().toISOString(),
        instruction: "Anchor macro and news commentary to the calendar window around generated_at. Separate verified facts from plausible mechanisms.",
      },
      total_verticals_tracked: verticalsCtx.length,
      verticals: verticalsCtx,
      threshold_flagged_signals: {
        thresholds_used: bt,
        flagged: flaggedSignals,
        quiet_count: quietSignals.length,
        quiet_summary: quietSignals.length > 0 ? `${quietSignals.length} signals below their flagging threshold — stable or noise-level movement.` : "All signals flagged.",
      },
      conviction_ratings: convictionByVertical,
      prior_week_brief: priorBriefSummary,
      cross_vertical_analysis: {
        verticals_at_stage_3_plus: verticalsCtx.filter(v => v.pipeline_stage.index >= 3).map(v => v.name),
        verticals_at_stage_1: verticalsCtx.filter(v => v.pipeline_stage.index <= 1).map(v => v.name),
        systemic_vs_sector: verticalsCtx.filter(v => v.pipeline_stage.index >= 3).length >= Math.max(2, Math.ceil(verticalsCtx.length * 0.6)) ? "systemic_wave" : "sector_specific",
        lag_leader_relationships: leaders,
      },
      ai_supply_side: {
        hugging_face_leaderboard: hfSummary,
        hf_download_trend: hfTimeSeries,
      },
      data_quality_flags: [...new Set(dq)].slice(0, 15),
      signal_interpretation_guide: {
        theirstack: { leadLag: SOURCE_INFO.theirstack.leadLag, investment: SOURCE_INFO.theirstack.investment },
        google_trends: { leadLag: SOURCE_INFO.google_trends.leadLag, investment: SOURCE_INFO.google_trends.investment },
        github_repos: { leadLag: SOURCE_INFO.github_repos.leadLag, investment: SOURCE_INFO.github_repos.investment },
        claude_attrib: { leadLag: SOURCE_INFO.claude_attrib.leadLag, investment: SOURCE_INFO.claude_attrib.investment },
      },
      signal_movement_interpretation: buildSignalMovementInterpretationForBrief(),
    };
    return trimPayloadSize(ctx, 32000);
  }, [composites, signalResults, githubHistoryByVertical, tsHistoryByVertical, crossCorr]);

  const generateBrief = useCallback(async () => {
    const baseCtx = buildBriefContext();
    let macro_labor_context = null;
    try {
      const r = await fetch("/api/labor/overview");
      if (r.ok) {
        const j = await r.json();
        macro_labor_context = {
          framing:
            "US national macro (Chicago Fed nowcast + FRED). Typically lagging or coincident versus your leading signals (job postings, search, GitHub, Claude). Use for regime backdrop and correlation narratives — do not collapse into a single heat index.",
          fetched_at: j.fetched_at,
          chicago_fed: j.chicago_fed,
          fred_headlines: (j.fred_latest || [])
            .filter((x) => !x.error && x.value != null)
            .slice(0, 28)
            .map((x) => ({ id: x.series_id, name: x.name, category: x.category, value: x.value, date: x.date })),
          chicago_recent_weeks: (j.chicago_fed_timeseries || []).slice(-14).map((row) => ({
            date: row.date,
            forecast_u: row.forecast_unemployment,
            u3: row.official_u3,
            layoffs: row.layoffs_separations_rate,
            hiring_u: row.hiring_rate_unemployed,
          })),
        };
      }
    } catch {
      macro_labor_context = { note: "Macro labor endpoint unreachable for this brief run." };
    }
    const ctx = trimPayloadSize(
      {
        ...baseCtx,
        macro_labor_context: macro_labor_context || { note: "No macro snapshot returned." },
      },
      32000,
    );
    const wk = ctx.week || weekKeyFromDate(new Date());
    setBriefWeek(wk);
    setBriefLoading(true);
    setBriefProgressSec(0);
    let tmr = null;
    try {
      tmr = setInterval(() => setBriefProgressSec((s) => Math.min(60, s + 1)), 1000);
      const apiKey = ENV_KEYS.anthropic;
      if (!apiKey) throw new Error("Missing VITE_ANTHROPIC_API_KEY");
      const stockTickers = ["MSFT", "AAPL", "NVDA", "GOOGL", "META", "PLTR", "ANTH"];
      const aiCompanies = ["Anthropic", "OpenAI", "Google DeepMind", "Meta AI", "xAI", "Mistral", "Cohere", "Databricks", "Scale AI", "Palantir"];
      const systemPrompt = `You are a senior market intelligence analyst at a top-tier hedge fund writing an internal weekly signal brief. Your readers are portfolio managers who make allocation decisions based on this document. Every sentence must earn its place.

ABSOLUTE RULES — VIOLATING THESE INVALIDATES THE BRIEF:
1. NEVER include URLs, links, citations, footnotes, source lists, or references of any kind. No [text](url), no "Source:", no "according to [article]". Write with authority — state facts directly.
2. NEVER use phrases like "according to reports", "sources indicate", "based on web search". State the fact or don't include it.
3. NEVER include a SOURCES section. The brief is self-contained.
4. Write clean prose. No markdown links. No parenthetical citations. No reference numbers.
5. Be SHORT. Target 1.5 printed pages. Every word must carry weight.
6. Use 3-week change as the primary signal metric. Week-over-week is secondary confirmation.
7. ONLY write about signals marked "crossed: true" in threshold_flagged_signals. Quiet signals get one line max in the 60-second summary.
8. If ZERO signals are flagged, produce only REGIME + 60 SECONDS + STOCK PULSE. Skip everything else.

USE WEB SEARCH to gather current stock prices for ${stockTickers.join(", ")} and the 3-5 most significant AI industry developments from the past 2 weeks. Synthesize findings into your own analysis — do not quote or cite the sources.

OUTPUT FORMAT — use ## headers, ━━━ separators, **bold** for key numbers:

## REGIME
One line. EXPANSION, SOFTENING, or CONTRACTION RISK. Based on macro data provided (Chicago Fed, unemployment, financial stress, yield curve). Then 2-3 sentences on what this means for interpreting every signal that follows.

## THE WEEK IN 60 SECONDS
4-5 bullets. Hard numbers. What you'd say in an elevator with your CIO. Format: "● Signal: **number** (direction), implication in one clause."

## STOCK PULSE
For ${stockTickers.join(", ")}: ticker, price, weekly % change, one opinionated sentence on positioning. Format as a clean list, one line per ticker. Include Anthropic private market price if findable.

## FLAGGED SIGNALS
One block per flagged signal. Structure each as:
**[Group Name] — [Signal Type]** | Conviction: HIGH/MEDIUM/SPECULATIVE
- Movement: state the 3-week % change, the threshold it crossed, and whether this is acceleration or deceleration
- Forward implication: translate this signal into what it means for the next 1-3 quarters. Job postings lead revenue by 1-2 quarters. GitHub activity leads enterprise adoption by 6-18 months. Trends lead procurement by 3-9 months.
- Regime lens: one sentence on how the current macro regime modifies interpretation

## CONVICTION CALLS
Only if HIGH conviction exists (3+ independent sources confirming same direction). Each call:
- **Thesis** in one sentence
- **Evidence**: which signals converge and what the numbers are
- **Timing**: when this thesis should manifest in earnings/revenue
- **Exposed equities**: specific tickers (MSFT, NVDA, etc.) and notable privates, weighted by signal strength

## WHAT WE GOT WRONG
If prior week data is provided: review each prior conviction call. Score as CONFIRMED, EVOLVING, or WRONG with one sentence of evidence. If no prior brief exists, omit this section entirely.

## RISKS
Each risk must trace directly to a specific flagged signal from this week. No generic risks. If job postings in healthcare AI are flagged, the risk is regulatory overhang on SaMD or Epic renewal cycles — not "AI regulation may change." 2-3 risks max.

EXAMPLE OF IDEAL TONE AND DENSITY:
## REGIME
SOFTENING — Unemployment ticking to **4.5%**, financial stress low at **-0.24**, yield curve positive. Labor cooling but not contracting. AI hiring acceleration in this backdrop signals defensive capability building before potential freezes.

## THE WEEK IN 60 SECONDS
● General AI jobs: **+15%** 3-week, driven by ML engineer and platform roles — budget commitment phase
● Agentic AI search interest: **-33%** 3-week crash — hype cycle peaked, enterprise rejected pilot ROI
● Meta: **$135B** 2026 capex guidance, Muse Spark launch driving **+4%** stock move
● NVDA: **+1.7%** on sustained datacenter demand despite competition fears`;

      const flaggedCount = (ctx.threshold_flagged_signals?.flagged || []).length;
      const quietCount = ctx.threshold_flagged_signals?.quiet_count || 0;
      const priorBriefNote = ctx.prior_week_brief ? `\nPRIOR WEEK (${ctx.prior_week_brief.week}) CONVICTION CALLS for retrospective:\n${ctx.prior_week_brief.conviction_calls_text}\n` : "\nNo prior week brief available — skip WHAT WE GOT WRONG section.\n";
      const convictionNote = Object.keys(ctx.conviction_ratings || {}).length > 0 ? `\nCONVICTION RATINGS:\n${Object.entries(ctx.conviction_ratings).map(([v, r]) => `${v}: ${r.rating} (${r.confirming_sources.join(", ")}) — ${r.direction}`).join("\n")}\n` : "";
      const userPrompt = `Week: ${ctx.week} | Generated: ${ctx.generated_at}
${flaggedCount} signals flagged across thresholds. ${quietCount} below threshold (quiet).
${flaggedCount === 0 ? "ZERO flags — produce REGIME + 60 SECONDS + STOCK PULSE only. Skip all other sections." : `Deep-dive the ${flaggedCount} flagged signals. Quiet signals get one summary line max.`}
${convictionNote}${priorBriefNote}
SIGNAL DATA (do NOT cite this as a source — synthesize into your analysis):
${JSON.stringify(ctx, null, 1)}

FINAL REMINDER: No URLs. No links. No citations. No source lists. No "[text](url)" patterns. No "Source:" lines. Write clean authoritative prose. Search the web for stock prices and AI news, then write about what you found without referencing where you found it.`;




      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Claude API ${res.status}: ${txt.slice(0, 180)}`);
      }
      const js = await res.json();
      let text = (js?.content || []).filter(c => c.type === "text").map(c => c.text || "").join("\n").trim();
      text = sanitizeBriefOutput(text);
      if (!text) throw new Error("Claude returned empty content");
      text = text.replace(/^```(?:html)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const existing = ld(briefStorageKey(wk), null) || (()=>{try{return JSON.parse(localStorage.getItem(briefStorageKey(wk))||"null");}catch{return null;}})();
      const toStore = {
        generated_at: new Date().toISOString(),
        content_markdown: text,
        data_snapshot: ctx,
        first_content_markdown: existing?.first_content_markdown || existing?.content_markdown || text,
      };
      localStorage.setItem(briefStorageKey(wk), JSON.stringify(toStore));
      localStorage.setItem(BRIEF_LAST_KEY, toStore.generated_at);
      { const pat = _resolveGitPat(); if (pat || signalStoreSecret() || databaseStoreSecret()) debouncedSyncToGist(pat, 5000); }
      setBriefContent(text);
      setBriefBaseForDiff(toStore.first_content_markdown || text);
      setBriefSnapshot(ctx);
      setBriefOpen(true);
      pruneOldBriefs(12);
      const rows = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(`${HSPFX}brief_`) || k === BRIEF_LAST_KEY) continue;
        try { const v = JSON.parse(localStorage.getItem(k)); if (v?.generated_at) rows.push({ key:k, week:k.replace(`${HSPFX}brief_`, ""), ...v }); } catch {}
      }
      rows.sort((a,b)=>new Date(b.generated_at)-new Date(a.generated_at));
      setBriefHistory(rows);
    } catch (e) {
      const offline = offlineBriefFromContext(ctx);
      const toStore = {
        generated_at: new Date().toISOString(),
        content_markdown: offline,
        data_snapshot: ctx,
        first_content_markdown: offline,
      };
      localStorage.setItem(briefStorageKey(wk), JSON.stringify(toStore));
      localStorage.setItem(BRIEF_LAST_KEY, toStore.generated_at);
      setBriefContent(offline);
      setBriefBaseForDiff(offline);
      setBriefSnapshot(ctx);
      alert(`Claude unavailable: ${e.message}\nGenerated offline data summary instead.`);
    } finally {
      if (tmr) clearInterval(tmr);
      setBriefLoading(false);
      const pat=resolveGitPat();if(pat||signalStoreSecret()||databaseStoreSecret())debouncedSyncToGist(pat,2000);
    }
  }, [buildBriefContext, resolveGitPat]);

  useEffect(()=>{
    if(!schedulerActive||!hasKeys)return;
    const fetchIfStale=async source=>{if(ldRef.current[source.id])return;const cfg=configRef.current;for(const v of cfg.verticals){const h=getSignalHistory(`${v.id}_${source.id}`);const last=h.length>0?h[h.length-1].ts:0;if(!last||(Date.now()-last)>staleMs(source.cadence)){await fetchSource(source.id);return;}}};
    const init=async()=>{
      const cfg=configRef.current;
      for(const src of cfg.sources.filter(s=>s.enabled&&resolveKey(s,cfg.apiKeys))){await fetchIfStale(src);await sleep(500);}
      if(!autoHistoryFetchedRef.current){
        autoHistoryFetchedRef.current=true;
        const tsSrc=cfg.sources.find(s=>s.id==="theirstack")||{};
        const tsActive=resolveTheirStackMocking(tsSrc,cfg.apiKeys)||resolveKey(tsSrc,cfg.apiKeys);
        if(tsActive){
          for(const v of cfg.verticals){
            const existing=ld(historyLatestKey(v.id),null);
            const stale=!existing?.generatedAt||((Date.now()-new Date(existing.generatedAt).getTime())>24*3600000);
            if(stale){try{await autoFetchRecentHistory(v.id);}catch{}await sleep(500);}
          }
        }
      }
    };
    init();
    const timers={};const cfg=configRef.current;
    cfg.sources.filter(s=>s.enabled).forEach(src=>{const ms=cadenceToMs(src.cadence);setNextRefresh(p=>({...p,[src.id]:Date.now()+ms}));timers[src.id]=setInterval(()=>{fetchIfStale(src);setNextRefresh(p=>({...p,[src.id]:Date.now()+ms}));},ms);});
    return()=>Object.values(timers).forEach(clearInterval);
  },[schedulerActive,hasKeys,fetchSource,autoFetchRecentHistory]);

  const[,tick]=useState(0);useEffect(()=>{const t=setInterval(()=>tick(n=>n+1),10000);return()=>clearInterval(t);},[]);

  const anyLoading=Object.values(loading).some(Boolean);
  const currentWeekKey = weekKeyFromDate(new Date());
  const signalFingerprint = useMemo(() => JSON.stringify(Object.keys(signalResults).sort().map(k => [k, signalResults[k]?.count || 0])), [signalResults]);
  const lastBriefObj = useMemo(() => { try { return JSON.parse(localStorage.getItem(briefStorageKey(currentWeekKey)) || "null"); } catch { return null; } }, [currentWeekKey, briefContent]);
  const hasAnySignalData = useMemo(() => {
    if (Object.keys(signalResults).length > 0) return true;
    if (config.verticals.length > 0) return true;
    return false;
  }, [signalResults, config.verticals]);
  const canGenerateBrief = hasAnySignalData;
  const shouldPromoteBrief = useMemo(() => {
    if (!canGenerateBrief) return false;
    if (!lastBriefObj?.generated_at) return true;
    const olderThan5d = (Date.now() - new Date(lastBriefObj.generated_at).getTime()) > 5 * 86400000;
    const changed = JSON.stringify(lastBriefObj?.data_snapshot?.fingerprint || "") !== JSON.stringify(signalFingerprint);
    return olderThan5d || changed;
  }, [canGenerateBrief, lastBriefObj, signalFingerprint]);

  const visualBriefHtmlMemo = useMemo(
    () => buildVisualBriefHtml(briefContent || "", briefSnapshot, briefWeek, { reader: briefReaderMode }),
    [briefContent, briefSnapshot, briefWeek, briefReaderMode]
  );

  const pulseMacroDrivers = useMemo(() => computeMacroDrivers(pulseOverview?.fred_latest), [pulseOverview]);
  const pulseSignalMoves = useMemo(() => computeSignalMoves(config.verticals, allHistories, config.sources), [config.verticals, allHistories, config.sources]);

  return(
    <div style={{background:"#f0f2f5",minHeight:"100vh",...font.sans}}>
      <style>{CSS}</style>

      {/* ─── Control strip ─── */}
      <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(255,255,255,.95)",backdropFilter:"blur(12px)",borderBottom:`1px solid ${C.border}`,padding:"8px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",maxWidth:1400,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {anyLoading&&<Spinner size={14}/>}
            {hasKeys&&<Badge color={C.green} bg={C.greenBg} size="sm">Live</Badge>}
            {schedulerActive&&hasKeys&&<Badge color={C.cyan} bg={C.cyanBg} size="sm">Auto-refresh</Badge>}
            {cloudStatus==="synced"&&<Badge color={C.green} bg={C.greenBg} size="sm">Saved</Badge>}
            {cloudStatus==="error"&&<Badge color={C.red} bg={C.redBg} size="sm">Sync error</Badge>}
            {config.sources.filter(s=>s.enabled).map(src=>{const nxt=nextRefresh[src.id];const rem=nxt?Math.max(0,nxt-Date.now()):0;return rem>0?<span key={src.id} style={{...font.sans,fontSize:10,color:C.textMuted}}>{src.name.split(" ")[0]} {humanInterval(rem)}</span>:null;})}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <Btn variant={shouldPromoteBrief?"accent":"default"} size="sm" disabled={!canGenerateBrief||briefLoading} onClick={generateBrief}>
              {briefLoading ? <><Spinner size={11} color={shouldPromoteBrief?"#fff":C.textSec}/> Generating ({briefProgressSec}s)</> : lastBriefObj?.content_markdown ? "Regenerate Brief" : "Generate Brief"}
            </Btn>
            <Btn variant="default" size="sm" disabled={pulseLoading} onClick={refreshPulse} title="FRED + Chicago Fed snapshot and AI/tech headlines (SerpAPI)">
              {pulseLoading ? <><Spinner size={11} color={C.textSec}/> Pulse…</> : <><IcoC name="activity" size={11} color={C.textSec}/> Macro &amp; news</>}
            </Btn>
            {briefContent && !briefLoading && <Btn variant="ghost" size="sm" onClick={()=>setBriefOpen(true)}>View Brief</Btn>}
            <Btn variant="ghost" size="sm" onClick={()=>setBriefHistoryOpen(true)}>Brief History</Btn>
            <Btn variant={schedulerActive?"ghost":"default"} size="sm" onClick={()=>setSchedulerActive(p=>!p)} className="nav-btn">
              <IcoC name={schedulerActive?"pause":"play"} size={11}/>{schedulerActive?"Pause":"Resume"}
            </Btn>
            <Btn variant="primary" size="sm" onClick={refreshAll} disabled={anyLoading||!hasKeys}>
              {anyLoading?<><Spinner size={11} color="#fff"/> Refreshing</>:<><IcoC name="refresh" size={12} color="#fff"/> Refresh</>}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={()=>doCloudSync("up")} disabled={cloudStatus.endsWith("…")} title="Save to cloud" className="nav-btn">
              {cloudStatus==="saving…"?<Spinner size={11}/>:<IcoC name="cloudUp" size={13}/>}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={()=>doCloudSync("down")} disabled={cloudStatus.endsWith("…")} title="Load from cloud" className="nav-btn">
              {cloudStatus==="loading…"?<Spinner size={11}/>:<IcoC name="cloudDown" size={13}/>}
            </Btn>
          </div>
        </div>
      </div>

      <div style={{padding:"20px 28px 40px",maxWidth:1400,margin:"0 auto"}}>

        <MarketAiPulsePanel
          overview={pulseOverview}
          newsPack={pulseNews}
          loading={pulseLoading}
          error={pulseErr}
          onRefresh={refreshPulse}
          macroDrivers={pulseMacroDrivers}
          signalMoves={pulseSignalMoves}
          collapsed={pulseCollapsed}
          onToggleCollapsed={() => setPulseCollapsed((c) => !c)}
        />

        {/* ─── Settings (always visible, collapsed by default) ─── */}
        <div style={{marginBottom:20}}>
          <InlineSettings config={config} setConfig={setConfig} githubWatchlists={githubWatchlists} setGithubWatchlists={setGithubWatchlists} mailingList={mailingList} onUpdateMailingList={updateMailingList} onCloudSync={()=>{const pat=resolveGitPat();if(pat||signalStoreSecret()||databaseStoreSecret())debouncedSyncToGist(pat);}}/>
        </div>

        {/* ─── Empty state prompt ─── */}
        {config.verticals.length === 0 && (
          <Card className="fade-in" style={{padding:"28px 32px",marginBottom:20,textAlign:"center"}}>
            <IcoC name="trendUp" size={24} color={C.cyan}/>
            <div style={{...font.sans,fontSize:16,fontWeight:700,color:C.text,margin:"12px 0 6px"}}>Create your first tracking group to get started</div>
            <p style={{...font.sans,fontSize:12,color:C.textSec,margin:"0 0 16px",lineHeight:1.6,maxWidth:520,marginLeft:"auto",marginRight:"auto"}}>
              A tracking group is a vertical, theme, or sector you want to monitor.
            </p>
            <div style={{display:"flex",gap:8,alignItems:"center",justifyContent:"center",maxWidth:420,margin:"0 auto"}}>
              <input ref={addRef} value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} placeholder="e.g. Healthcare AI, FinTech..."
                style={{flex:1,fontSize:13,padding:"10px 14px",borderRadius:10,border:`1px solid ${C.border}`,outline:"none",...font.sans}}
                onKeyDown={e=>{if(e.key==="Enter"&&newGroupName.trim()){addGroup(newGroupName.trim());setNewGroupName("");}}}/>
              <Btn variant="primary" size="md" onClick={()=>{if(newGroupName.trim()){addGroup(newGroupName.trim());setNewGroupName("");}}}>Create Group</Btn>
            </div>
          </Card>
        )}

        {/* ─── Group bar ─── */}
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              {config.verticals.map(v=>{
                const isEditing = editingGroupId === v.id;
                return(<button key={v.id} onClick={()=>setEditingGroupId(isEditing?null:v.id)} style={{...font.sans,fontSize:12,fontWeight:600,padding:"5px 14px",borderRadius:8,cursor:"pointer",border:isEditing?`2px solid ${v.color||C.cyan}`:`1px solid ${(v.color||C.cyan)+"40"}`,background:isEditing?(v.color||C.cyan)+"18":"transparent",color:isEditing?(v.color||C.cyan):C.text,transition:"all .15s",outline:"none"}}>{v.name}</button>);
              })}
              {addingGroup?(
                <div style={{display:"flex",gap:4,alignItems:"center"}}>
                  <input ref={addRef} value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} placeholder="Group name" style={{width:160,fontSize:12,padding:"4px 8px"}}
                    onKeyDown={e=>{if(e.key==="Enter"&&newGroupName.trim()){addGroup(newGroupName.trim());setNewGroupName("");setAddingGroup(false);}if(e.key==="Escape"){setAddingGroup(false);setNewGroupName("");}}}/>
                  <Btn variant="primary" size="sm" onClick={()=>{if(newGroupName.trim()){addGroup(newGroupName.trim());setNewGroupName("");setAddingGroup(false);}}}>Add</Btn>
                </div>
              ):<Btn variant="ghost" size="sm" onClick={()=>setAddingGroup(true)}>+ Add group</Btn>}
            </div>
            {overlaySelected.length>0&&(
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{...font.sans,fontSize:11,color:C.textMuted}}>{overlaySelected.length} selected for overlay</span>
                <Btn variant="ghost" size="sm" onClick={()=>setOverlaySelected([])}>Clear</Btn>
              </div>
            )}
          </div>

          {/* Expanded keyword editor for selected group */}
          {editingGroupId && (()=>{
            const v = config.verticals.find(vt=>vt.id===editingGroupId);
            if (!v) return null;
            const sourceKwConfig = [
              { sourceId: "theirstack", label: "Job Postings (TheirStack)", fields: { titleKeywords: "Title keywords", descriptionKeywords: "Description keywords" } },
              { sourceId: "google_trends", label: "Google Trends", fields: { keywords: "Search terms" } },
              { sourceId: "github_repos", label: "GitHub Repos", fields: { keywords: "Search query" } },
              { sourceId: "claude_attrib", label: "Claude Attribution", fields: { keywords: "Search query" } },
            ];
            return(
              <Card className="fade-in" style={{marginTop:10,padding:"14px 18px",borderLeft:`3px solid ${v.color||C.cyan}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{display:"inline-block",width:10,height:10,borderRadius:"50%",background:v.color||C.cyan}}/>
                    <span style={{...font.sans,fontSize:14,fontWeight:700,color:C.text}}>{v.name}</span>
                    <span style={{...font.sans,fontSize:11,color:C.textMuted}}>— keywords across all sources</span>
                  </div>
                  <Btn variant="ghost" size="sm" onClick={()=>setEditingGroupId(null)}>Close</Btn>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                  {sourceKwConfig.map(({sourceId,label,fields})=>(
                    <div key={sourceId} style={{padding:"10px 12px",background:C.nested,borderRadius:8,border:`1px solid ${C.borderLight}`}}>
                      <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.textSec,marginBottom:8}}>{label}</div>
                      {Object.entries(fields).map(([field,fieldLabel])=>{
                        const vals = v.keywords?.[sourceId]?.[field] || [];
                        const arr = Array.isArray(vals) ? vals : [vals];
                        return(
                          <div key={field} style={{marginBottom:6}}>
                            <div style={{...font.sans,fontSize:10,color:C.textMuted,marginBottom:3}}>{fieldLabel}</div>
                            <ChipEditor items={arr} onChange={nv=>updateKeywords(v.id,sourceId,field,nv)} color={v.color||C.cyan} placeholder="Add…"/>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}
        </div>

        {/* Overlay chart */}
        {overlaySelected.length>=2 && <OverlayChart selectedKeys={overlaySelected} allHistories={allHistories} sources={config.sources} verticals={config.verticals}/>}

        {/* ─── Brief Flagging Thresholds (inline-editable) ─── */}
        <Card style={{marginBottom:20,padding:"14px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div>
              <div style={{...font.sans,fontSize:13,fontWeight:700,color:C.text}}>Brief flagging thresholds</div>
              <div style={{...font.sans,fontSize:11,color:C.textMuted,marginTop:2,lineHeight:1.4}}>Minimum week-over-week % change to flag a signal in the brief.</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))",gap:10}}>
            {[
              { key: "theirstack", label: "Job Postings" },
              { key: "google_trends", label: "Google Trends" },
              { key: "github_repos", label: "GitHub Repos" },
              { key: "claude_attrib", label: "Claude Attribution" },
              { key: "hf_downloads", label: "HuggingFace" },
            ].map(({ key, label }) => {
              const bt = config.briefThresholds || {};
              const val = bt[key] ?? 10;
              const displayVal = Number.isInteger(val) ? `${val}` : val.toFixed(1);
              return (
                <div key={key} style={{padding:"8px 10px",background:C.nested,borderRadius:6,border:`1px solid ${C.borderLight}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{...font.sans,fontSize:11,fontWeight:600,color:C.text}}>{label}</span>
                    <span style={{...font.mono,fontSize:13,fontWeight:800,color:C.textSec}}>{displayVal}%</span>
                  </div>
                  <input type="range" min="0.1" max="50" step="0.1" value={val}
                    onChange={e => setConfig(prev => {
                      const raw = parseFloat(e.target.value);
                      const clamped = Math.min(50, Math.max(0.1, Math.round(raw * 10) / 10));
                      const next = { ...prev, briefThresholds: { ...(prev.briefThresholds || {}), [key]: clamped } };
                      sv("config", next);
                      return next;
                    })}
                    style={{width:"100%"}} />
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:1}}>
                    <span style={{...font.sans,fontSize:8.5,color:C.textMuted}}>0.1%</span>
                    <span style={{...font.sans,fontSize:8.5,color:C.textMuted}}>50%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* ─── Signal Convergence Panel ─── */}
        {config.verticals.length > 0 && (
          <SignalConvergencePanel
            verticals={config.verticals}
            sources={config.sources}
            signalResults={signalResults}
          />
        )}

        {/* ─── Team Notes ─── */}
        <TeamNotesPanel
          annotations={annotations}
          onAdd={(ann) => setAnnotations(addAnnotation(ann))}
          onDelete={(id) => setAnnotations(deleteAnnotation(id))}
          verticals={config.verticals}
        />

        {/* ─── Per-group signal metrics (each row = one source × your groups & keywords) ─── */}
        <div style={{marginBottom:10}}>
          <div style={{...font.sans,fontSize:13,fontWeight:700,color:C.text}}>Tracking-group metrics</div>
          <div style={{...font.sans,fontSize:11,color:C.textMuted,marginTop:4,maxWidth:720,lineHeight:1.5}}>
            Each card is one data source. Rows are your signal groups — keywords apply per group. Use Refresh on a card or per row; Backfill where available builds history (TheirStack monthly in demo mode works without an API key).
          </div>
        </div>
        <div style={{marginBottom:28}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {config.sources.filter(s=>s.enabled).map((src)=>(
              <SignalPanel
                key={src.id}
                source={src}
                demoTheirStack={src.id === "theirstack" && resolveTheirStackMocking(src, config.apiKeys)}
                verticals={config.verticals}
                signalResults={signalResults}
                loading={loading}
                errors={errors}
                onFetch={fetchSource}
                onUpdateKeywords={updateKeywords}
                overlaySelected={overlaySelected}
                onToggleOverlay={toggleOverlay}
                tsHistoryByVertical={tsHistoryByVertical}
                historyProgress={historyProgress}
                onBackfillHistory={(vid)=>loadFullHistory(vid,true)}
                onBackfillSignal={(vid,sid)=>backfillSignalSource(vid,sid)}
                onEditGroup={(vid)=>{setEditingGroupId(vid);window.scrollTo({top:0,behavior:"smooth"});}}
              />
            ))}
          </div>
        </div>

        {/* ─── Earnings Call Analyzer ─── */}
        <div style={{marginBottom:28}}>
          <EarningsCallPanel />
        </div>

        <div style={{marginBottom:10}}>
          <div style={{...font.sans,fontSize:13,fontWeight:700,color:C.text}}>National context</div>
          <div style={{...font.sans,fontSize:11,color:C.textMuted,marginTop:4}}>US-wide labor indicators — not filtered by your keywords.</div>
        </div>
        <div style={{marginBottom:28}}>
          <LaborMacroPanel
            onAfterLoad={() => {
              const pat = resolveGitPat();
              if (pat || signalStoreSecret() || databaseStoreSecret()) debouncedSyncToGist(pat, 4000);
            }}
          />
        </div>

        {/* ─── Backfill progress (global) ─── */}
        {historyProgress.active && (
          <Card style={{marginBottom:16}} className="fade-in">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text}}>{historyProgress.label}</div>
              <Btn size="sm" variant="ghost" onClick={cancelHistoryLoad}>Cancel</Btn>
            </div>
            <div style={{...font.sans,fontSize:11,color:C.textMuted,marginBottom:4}}>{historyProgress.current}/{historyProgress.total}</div>
            <div style={{height:8,background:C.nested,borderRadius:999,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${historyProgress.total?Math.round((historyProgress.current/historyProgress.total)*100):0}%`,background:C.blue,transition:"width .2s"}}/>
            </div>
          </Card>
        )}

        {/* ─── Hugging Face ─── */}
        <div style={{marginBottom:28}}>
          <HuggingFaceLeaderboard onDataChanged={()=>{const pat=resolveGitPat();if(pat||signalStoreSecret()||databaseStoreSecret())debouncedSyncToGist(pat,3000);}}/>
        </div>

        {/* ─── Alerts ─── */}
        {alerts.length>0&&(
          <div style={{marginBottom:28}}>
            <AlertFeed alerts={alerts} onPin={id=>setAlerts(p=>p.map(a=>a.id===id?{...a,pinned:!a.pinned}:a))}/>
          </div>
        )}
      </div>

      {briefHistoryOpen && (
        <>
          <div onClick={()=>setBriefHistoryOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.18)",zIndex:220}} />
          <div style={{position:"fixed",right:0,top:0,bottom:0,width:360,background:C.white,borderLeft:`1px solid ${C.border}`,zIndex:221,padding:14,overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:14,fontWeight:700}}>Brief History</div>
              <Btn size="sm" variant="ghost" onClick={()=>setBriefHistoryOpen(false)}>Close</Btn>
            </div>
            {briefHistory.map((b)=>(
              <div key={b.key} style={{padding:"10px 10px",border:`1px solid ${C.borderLight}`,borderRadius:10,marginBottom:8,cursor:"pointer"}}
                onClick={()=>{setBriefWeek(b.week);setBriefContent(sanitizeBriefOutput(b.content_markdown||""));setBriefBaseForDiff(sanitizeBriefOutput(b.first_content_markdown||b.content_markdown||""));setBriefSnapshot(b.data_snapshot||null);setBriefOpen(true);setBriefHistoryOpen(false);}}>
                <div style={{fontSize:12,fontWeight:700,color:C.text}}>{b.week}</div>
                <div style={{fontSize:11,color:C.textMuted}}>{new Date(b.generated_at).toLocaleString()}</div>
              </div>
            ))}
            {!briefHistory.length && <div style={{fontSize:12,color:C.textMuted}}>No saved briefs yet.</div>}
          </div>
        </>
      )}

      {briefOpen && (
        <div className="brief-print-scope" style={{position:"fixed",inset:0,zIndex:230,background:briefReaderMode&&!briefDiffMode?"#e9e6e1":"#f3f4f6",display:"flex",flexDirection:"column"}}>
          {/* Toolbar */}
          <div className="brief-toolbar-print-hide" style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 24px",background:"#fff",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:8,height:8,borderRadius:99,background:briefLoading?"#f59e0b":C.cyan,animation:briefLoading?"pulse 1.2s ease-in-out infinite":"none"}} />
              <span style={{...font.sans,fontSize:13,fontWeight:700,color:C.text,letterSpacing:"-0.01em"}}>Weekly Brief</span>
              <span style={{...font.sans,fontSize:11,color:C.textMuted}}>{briefWeek}</span>
              {!briefLoading && briefContent && !briefDiffMode && briefReaderMode && (
                <span style={{...font.sans,fontSize:10,fontWeight:600,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Reader</span>
              )}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <label style={{display:"flex",alignItems:"center",gap:4,...font.sans,fontSize:11,color:C.textMuted,cursor:briefLoading?"default":"pointer",padding:"4px 8px",borderRadius:6,background:briefReaderMode&&!briefDiffMode?C.cyanBg:"transparent",opacity:briefLoading?0.5:1}} title="Readable layout: serif analysis, tighter column, print-friendly">
                <input type="checkbox" disabled={briefLoading||briefDiffMode} checked={briefReaderMode&&!briefDiffMode} onChange={e=>{const on=e.target.checked;setBriefReaderMode(on);if(on)setBriefDiffMode(false);}} style={{width:12,height:12}} /> Reader
              </label>
              <label style={{display:"flex",alignItems:"center",gap:4,...font.sans,fontSize:11,color:C.textMuted,cursor:briefLoading?"default":"pointer",padding:"4px 8px",borderRadius:6,background:briefDiffMode?C.cyanBg:"transparent",opacity:briefLoading?0.5:1}}>
                <input type="checkbox" disabled={briefLoading} checked={briefDiffMode} onChange={e=>{const on=e.target.checked;setBriefDiffMode(on);if(on)setBriefReaderMode(false);}} style={{width:12,height:12}} /> Diff
              </label>
              <Btn size="sm" variant="ghost" disabled={briefLoading||!briefContent||briefDiffMode} onClick={()=>window.print()} title="Hides this toolbar when printing">
                Print
              </Btn>
              <div style={{width:1,height:16,background:C.border,margin:"0 4px"}} />
              <Btn size="sm" onClick={()=>{const tmp=document.createElement("div");tmp.innerHTML=briefContent||"";navigator.clipboard?.writeText(tmp.textContent||tmp.innerText||"");}}>Copy Text</Btn>
              <Btn size="sm" onClick={()=>navigator.clipboard?.writeText(briefContent || "")}>Copy HTML</Btn>
              <Btn size="sm" onClick={()=>{
                const w = window.open("", "_blank");
                if (!w) return;
                w.document.write(briefEmailHtmlDocument(briefWeek, briefSnapshot, briefContent || "", briefDiffMode, briefBaseForDiff));
                w.document.close();
              }}>Preview</Btn>
              <div style={{width:1,height:16,background:C.border,margin:"0 4px"}} />
              <Btn size="sm" variant={mailingList.length>0?"primary":"default"} disabled={emailSending||!briefContent} onClick={()=>sendReportEmail(briefContent,briefWeek,briefSnapshot)}>
                {emailSending ? <><Spinner size={11} color="#fff"/> Sending</> : <><IcoC name="mail" size={12} color={mailingList.length>0?"#fff":C.textSec}/> Email ({mailingList.length})</>}
              </Btn>
              {emailStatus && <span style={{...font.sans,fontSize:10,color:emailStatus.startsWith("Failed")?C.red:emailStatus.startsWith("Sent")?C.green:C.textSec,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{emailStatus}</span>}
              <div style={{width:1,height:16,background:C.border,margin:"0 4px"}} />
              <Btn size="sm" variant="ghost" onClick={()=>setBriefOpen(false)} style={{fontWeight:600}}>Close</Btn>
            </div>
          </div>
          {/* Body */}
          <div className="brief-print-body" style={{flex:1,overflowY:"auto",padding:briefReaderMode&&!briefDiffMode?"36px 28px 48px":"28px 32px"}}>
            {briefLoading ? (
              <div style={{maxWidth:480,margin:"120px auto",textAlign:"center"}}>
                <div style={{...font.sans,fontSize:20,fontWeight:700,color:C.text,marginBottom:10,letterSpacing:"-0.02em"}}>Building your brief</div>
                <div style={{...font.sans,fontSize:12,color:C.textMuted,marginBottom:16,lineHeight:1.6}}>Searching live markets, AI news, and analyzing your dashboard signals</div>
                <div style={{height:4,background:"#e5e7eb",borderRadius:999,overflow:"hidden",maxWidth:320,margin:"0 auto"}}>
                  <div style={{height:"100%",width:`${Math.min(100,Math.round((briefProgressSec/50)*100))}%`,background:C.cyan,borderRadius:999,transition:"width .5s"}} />
                </div>
                <div style={{...font.mono,fontSize:11,color:C.textMuted,marginTop:10}}>{briefProgressSec}s</div>
              </div>
            ) : (
              <div style={{maxWidth:briefReaderMode&&!briefDiffMode?820:900,margin:"0 auto"}}>
                {briefDiffMode ? (
                  <div style={{background:"#fff",border:`1px solid #e5e7eb`,borderRadius:10,padding:"28px 32px"}}>
                    <div style={{...font.sans,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:600,color:C.textMuted,borderBottom:`1px solid #f3f4f6`,paddingBottom:10,marginBottom:16}}>
                      Diff View · {briefWeek}
                    </div>
                    <div style={{ ...font.sans, fontSize: 14, lineHeight: 1.7, color: C.text }} dangerouslySetInnerHTML={{ __html: paragraphDiffHtml(briefBaseForDiff, briefContent) }} />
                    {briefSnapshot ? <BriefSnapshotCharts ctx={briefSnapshot} /> : null}
                  </div>
                ) : (
                  <div
                    style={
                      briefReaderMode
                        ? {
                            background: C.white,
                            borderRadius: 12,
                            border: `1px solid ${C.borderLight}`,
                            boxShadow: "0 25px 50px -12px rgba(0,0,0,.12)",
                            padding: "8px 12px 20px",
                            overflow: "hidden",
                          }
                        : undefined
                    }
                    dangerouslySetInnerHTML={{ __html: visualBriefHtmlMemo }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
