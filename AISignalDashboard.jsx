// ══════════════════════════════════════════════════════════════════════════════
// SIGNAL INTELLIGENCE DASHBOARD v2
// History tracking, growth charts, overlay comparison, investment commentary
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ComposedChart, Bar, Area, ReferenceLine, ReferenceDot } from "recharts";

const PFX = "sid_v3_";
const C = {
  bg: "#f7f8fa", white: "#fff", nested: "#f1f3f6", border: "#e1e4ea", borderLight: "#eceef3",
  text: "#1a1d26", textSec: "#4b5163", textMuted: "#8b92a5",
  cyan: "#0284c7", cyanBg: "#e0f2fe",
  amber: "#b45309", amberBg: "#fef3c7",
  red: "#c0392b", redBg: "#fef2f2",
  green: "#0f7b55", greenBg: "#ecfdf5",
  purple: "#6d28d9", purpleBg: "#f3f0ff",
  blue: "#2563eb", blueBg: "#eff6ff",
  orange: "#ea580c", orangeBg: "#fff7ed",
};
const font = { sans: { fontFamily: "'Inter',system-ui,sans-serif" }, mono: { fontFamily: "'JetBrains Mono',monospace" } };
const PALETTE = ["#0284c7","#2563eb","#b45309","#0f7b55","#6d28d9","#c0392b","#ea580c","#e11d48","#0891b2","#4f46e5"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── PERSISTENCE (localStorage + GitHub Gist cloud sync) ──────────────────────
// localStorage is the primary store for speed. A GitHub Gist acts as the
// permanent cloud database — data syncs on load and after each fetch cycle.
// This means data survives browser clears, different machines, and deploys.

const GIST_ID_KEY = PFX + "gist_id";

function ld(k, fb) { try { const r = localStorage.getItem(PFX + k); return r ? JSON.parse(r) : fb; } catch { return fb; } }
function sv(k, d) { try { localStorage.setItem(PFX + k, JSON.stringify(d)); } catch {} }

function getAllData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PFX) && k !== GIST_ID_KEY) {
      try { data[k.slice(PFX.length)] = JSON.parse(localStorage.getItem(k)); } catch {}
    }
  }
  return data;
}

function loadAllData(data) {
  Object.entries(data).forEach(([k, v]) => {
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

let _syncDebounce = null;
let _cloudInitDone = false;
function debouncedSyncToGist(pat, delayMs = 5000) {
  if (!_cloudInitDone) return;
  if (_syncDebounce) clearTimeout(_syncDebounce);
  _syncDebounce = setTimeout(() => { syncToGist(pat).catch(() => {}); _syncDebounce = null; }, delayMs);
}

async function syncToGist(pat) {
  if (!pat) return;
  if (!_cloudInitDone) return;
  const data = getAllData();
  const localKeys = Object.keys(data);
  const localCfg = data.config;
  const localEmpty = !localCfg || !localCfg.verticals || localCfg.verticals.length === 0;
  const localThin = localKeys.length < 3;
  if (localEmpty || localThin) {
    const gistId = localStorage.getItem(GIST_ID_KEY);
    if (gistId) {
      try {
        const chk = await fetch(`https://api.github.com/gists/${gistId}`, { headers: { Authorization: `Bearer ${pat}` } });
        if (chk.ok) {
          const g = await chk.json();
          const content = g.files["signal-data.json"]?.content;
          if (content) {
            const cloud = JSON.parse(content);
            const cloudKeys = Object.keys(cloud);
            if (cloud.config?.verticals?.length > 0) return;
            if (cloudKeys.length > localKeys.length + 5) return;
          }
        }
      } catch {}
    }
  }
  const gistId = localStorage.getItem(GIST_ID_KEY);
  const body = { description: "Signal Intelligence Dashboard — persistent data store", public: false, files: { "signal-data.json": { content: JSON.stringify(data) } } };

  try {
    if (gistId) {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, { method: "PATCH", headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok && res.status === 404) {
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
  if (!pat) return false;
  const gistId = localStorage.getItem(GIST_ID_KEY);
  if (!gistId) {
    try {
      const res = await fetch("https://api.github.com/gists?per_page=50", { headers: { Authorization: `Bearer ${pat}` } });
      if (!res.ok) return false;
      const gists = await res.json();
      const found = gists.find(g => g.description?.includes("Signal Intelligence Dashboard") && g.files["signal-data.json"]);
      if (found) { localStorage.setItem(GIST_ID_KEY, found.id); return syncFromGist(pat); }
    } catch {}
    return false;
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
  h.push({
    ts: now.getTime(),
    isoDate: now.toISOString(),
    value,
    date: now.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  });
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

const LABOR_FRED_CAT_ORDER = ["labor", "jolts", "wages", "growth", "housing", "sentiment", "financial_stress", "rates", "tech_production"];
const LABOR_FRED_CAT_LABEL = {
  labor: "Labor",
  jolts: "JOLTS",
  wages: "Wages",
  growth: "Growth & demand",
  housing: "Housing",
  sentiment: "Sentiment",
  financial_stress: "Financial stress",
  rates: "Rates",
  tech_production: "Tech production",
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
const HSPFX = "aitracker_";

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
/** Deterministic pseudo job counts for any keyword set + date range (demo when TheirStack API is off). */
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
  const rng = mockTheirStackRng((seed ^ Math.floor(midMs / 86400000)) >>> 0);
  const base = 12 + (Math.abs(seed) % 140);
  const growth = 1 + Math.min(2.4, Math.max(0, monthsSince2021 * 0.011));
  const seasonal = 1 + 0.09 * Math.sin((monthsSince2021 / 12) * Math.PI * 2);
  const noise = 0.82 + rng() * 0.38;
  const wave = 1 + 0.11 * Math.sin((midMs / (86400000 * 23)) * Math.PI * 2);
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
      if (sig?.time_series?.recent_values) sig.time_series.recent_values = sig.time_series.recent_values.slice(-8);
    });
    if (v.theirstack_historical?.recent_monthly) v.theirstack_historical.recent_monthly = v.theirstack_historical.recent_monthly.slice(-6);
    if (v.theirstack_historical?.inflection_points) v.theirstack_historical.inflection_points = v.theirstack_historical.inflection_points.slice(-3);
  });
  s = JSON.stringify(copy);
  if (s.length <= maxChars) return copy;
  (copy.verticals || []).forEach((v) => {
    const sigs = v.signals || {};
    Object.values(sigs).forEach(sig => {
      if (sig?.time_series?.recent_values) sig.time_series.recent_values = sig.time_series.recent_values.slice(-5);
    });
    if (v.divergence_signals?.length > 3) v.divergence_signals = v.divergence_signals.slice(0, 3);
  });
  s = JSON.stringify(copy);
  if (s.length <= maxChars) return copy;
  const ca = copy.cross_vertical_analysis;
  if (ca?.lag_leader_relationships) ca.lag_leader_relationships = ca.lag_leader_relationships.slice(0, 4);
  if (copy.ai_supply_side?.hf_download_trend?.recent_values) copy.ai_supply_side.hf_download_trend.recent_values = copy.ai_supply_side.hf_download_trend.recent_values.slice(-5);
  return copy;
}
function offlineBriefFromContext(ctx) {
  const date = new Date(ctx.generated_at).toLocaleString();
  const header = `AI DEMAND SIGNAL WEEKLY INTELLIGENCE REPORT\nWeek of ${ctx.week}\nGenerated: ${date} (AI-powered analysis unavailable — raw data summary)\nVerticals tracked: ${ctx.total_verticals_tracked || 0} | Composite range: ${ctx.composite_score_summary?.lowest || 0}–${ctx.composite_score_summary?.highest || 0}\n`;

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
    return `${v.name} | ${reg} | Composite: ${v.composite_score} | Jobs: ${j?.current_count || "n/a"} (${ts?.pct_change_vs_previous != null ? (ts.pct_change_vs_previous >= 0 ? "+" : "") + ts.pct_change_vs_previous + "%" : "n/a"} vs prev) | Trends: ${g?.current_index || "n/a"} | Repos: ${r?.active_repos_30d || "n/a"}`;
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
function simpleMarkdownToHtml(md) {
  if (!md) return "";
  const esc = (s) => escapeHtml(s);
  const lines = String(md).split("\n");
  const out = [];
  let para = [];
  const flush = () => {
    if (!para.length) return;
    const raw = esc(para.join(" ")).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    out.push(`<p style="margin:0 0 12px;line-height:1.65;color:#1a1d26">${raw}</p>`);
    para = [];
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    if (t.startsWith("### ")) {
      flush();
      out.push(`<h3 style="font:700 15px Inter,system-ui,sans-serif;margin:18px 0 6px;color:#1a1d26">${esc(t.slice(4))}</h3>`);
      continue;
    }
    if (t.startsWith("## ")) {
      flush();
      out.push(`<h2 style="font:700 17px Inter,system-ui,sans-serif;margin:20px 0 8px;color:#1a1d26">${esc(t.slice(3))}</h2>`);
      continue;
    }
    if (t.startsWith("# ")) {
      flush();
      out.push(`<h1 style="font:700 20px Inter,system-ui,sans-serif;margin:0 0 10px;color:#1a1d26">${esc(t.slice(2))}</h1>`);
      continue;
    }
    if (/^━+$/.test(t) || t === "---") {
      flush();
      out.push("<hr style=\"border:none;border-top:1px solid #e1e4ea;margin:16px 0\" />");
      continue;
    }
    para.push(t);
  }
  flush();
  return out.join("\n");
}
function buildSvgSparkline(vals, w, h, stroke) {
  const v = (vals || []).map(Number);
  if (v.length < 2) return "";
  const pad = 6;
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const step = (w - 2 * pad) / (v.length - 1);
  const d = v.map((n, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (n - lo) / span) * (h - 2 * pad);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;max-width:100%"><rect fill="#f8fafc" width="100%" height="100%" rx="6"/><path d="${d}" fill="none" stroke="${stroke}" stroke-width="2"/></svg>`;
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
  const charts = buildBriefChartsHtml(snapshot);
  const inner = diffMode
    ? paragraphDiffHtml(baseForDiff, markdownBody)
    : `${charts}<div style="font:15px/1.65 Georgia,serif;color:#1a1d26">${simpleMarkdownToHtml(markdownBody)}</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Weekly Brief ${escapeHtml(week)}</title></head><body style="margin:0;padding:28px;background:#f0f2f5;font-family:Inter,system-ui,sans-serif"><div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e1e4ea;border-radius:12px;padding:24px 28px">${inner}</div></body></html>`;
}
function BriefSnapshotCharts({ ctx }) {
  if (!ctx?.verticals?.length) return null;
  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
      <div style={{ ...font.sans, fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        Dashboard trend charts (snapshot sent to Claude)
      </div>
      {ctx.verticals.map((v) => {
        const mon = v.theirstack_historical?.recent_monthly || [];
        const jobData = mon.length >= 2
          ? mon.map((m) => ({ x: m.month?.slice(2) || m.month, y: m.count || 0 }))
          : (v.signals?.job_postings?.time_series?.recent_values || []).map((p, i) => ({ x: String(i), y: p.value || 0 }));
        const trendData = (v.signals?.google_trends?.time_series?.recent_values || []).map((p, i) => ({ x: (p.date || "").slice(5, 10) || String(i), y: p.value || 0 }));
        return (
          <div key={v.name} style={{ marginBottom: 14, padding: 12, background: C.nested, borderRadius: 10, border: `1px solid ${C.border}` }}>
            <div style={{ ...font.sans, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>{v.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 4 }}>Jobs</div>
                {jobData.length >= 2 ? (
                  <div style={{ width: "100%", height: 72 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={jobData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                        <XAxis dataKey="x" tick={{ fontSize: 9 }} stroke={C.border} />
                        <YAxis width={32} tick={{ fontSize: 9 }} stroke={C.border} />
                        <Tooltip />
                        <Line type="monotone" dataKey="y" stroke={C.cyan} strokeWidth={2} dot={false} name="Jobs" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: C.textMuted }}>Need more history</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 4 }}>Google Trends</div>
                {trendData.length >= 2 ? (
                  <div style={{ width: "100%", height: 72 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                        <XAxis dataKey="x" tick={{ fontSize: 9 }} stroke={C.border} />
                        <YAxis width={32} tick={{ fontSize: 9 }} stroke={C.border} />
                        <Tooltip />
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
function paragraphDiffHtml(oldText, newText) {
  const oldP = (oldText || "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const newP = (newText || "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  return newP.map((p, i) => {
    const changed = p !== (oldP[i] || "");
    const bg = changed ? "background:#fff7ed;border-left:3px solid #f59e0b;padding-left:8px;" : "";
    return `<p style="${bg}">${escapeHtml(p)}</p>`;
  }).join("");
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
    apiConfig: { endpoint: "https://api.github.com/search/repositories", method: "GET", authType: "bearer", authHeader: "", proxyPrefix: "", bodyTemplate: "q={{keywords}}+pushed:>{{since30d}}&sort=updated&per_page=5" },
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
  let msg = "";
  try {
    const j = await res.clone().json();
    msg = String(j.message || "").toLowerCase();
  } catch {}
  if (res.status === 401) return "Invalid or expired GitHub token";
  if (res.status === 429) return "GitHub API rate limited — retry in a few minutes";
  if (res.status === 403) {
    if (msg.includes("rate limit") || msg.includes("abuse") || msg.includes("too many") || msg.includes("quota"))
      return "GitHub API rate limited (403) — wait or use a PAT with higher limits";
    if (msg.includes("sso")) return "GitHub SSO required — authorize your PAT for the org";
    return "GitHub denied the request (403) — check PAT scopes and org access";
  }
  return msg ? `GitHub: ${msg.slice(0, 120)}` : `GitHub HTTP ${res.status}`;
}

async function callSource(source, vertical, configKeys) {
  const cfg = source.apiConfig, vkw = vertical.keywords?.[source.id] || {};
  const today = new Date().toISOString().slice(0, 10);
  const since30d = new Date(Date.now()-30*86400000).toISOString().slice(0,10), since7d = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const tv = { ...vkw, since30d, since7d, today };
  if (vkw.keywords) tv.keywords = Array.isArray(vkw.keywords) ? vkw.keywords.filter(Boolean).join(",") : vkw.keywords;
  if (vkw.titleKeywords) tv.titleKeywords = vkw.titleKeywords;
  if (vkw.descriptionKeywords) tv.descriptionKeywords = vkw.descriptionKeywords;
  const hasKw = (tv.keywords && tv.keywords.length > 0) || (Array.isArray(tv.titleKeywords) ? tv.titleKeywords.filter(Boolean).length > 0 : !!tv.titleKeywords) || (Array.isArray(tv.descriptionKeywords) ? tv.descriptionKeywords.filter(Boolean).length > 0 : !!tv.descriptionKeywords);
  if (!hasKw && source.id !== "claude_attrib") throw new Error("No keywords configured");
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
    const gte = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const count = mockTheirStackCountForRange(vertical, gte, lte);
    const sample = Math.min(25, Math.max(5, Math.ceil(count / 50)));
    return {
      metadata: { total_results: count },
      data: buildMockTheirStackJobItems(sample, vertical),
    };
  }
  const filled = fillTemplate(templateStr, tv);
  const ep = cfg.proxyPrefix ? cfg.proxyPrefix + cfg.endpoint : cfg.endpoint;
  const headers = { Accept: source.id === "claude_attrib" ? "application/vnd.github.cloak-preview+json" : "application/json" };
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
    const gte = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const count = mockTheirStackCountForRange(vertical, gte, lte);
    const sample = Math.min(25, Math.max(5, Math.ceil(count / 50)));
    return {
      metadata: { total_results: count },
      data: buildMockTheirStackJobItems(sample, vertical),
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

function evalAlerts(verticals, sr, rules) {
  const alerts=[];
  verticals.forEach(v => {
    const jr=sr[`${v.id}_theirstack`]; const jvi=jr?Math.min(((jr.count||0)/100)*100,200):0;
    const jsw=jr?.classification?.dominantStage?.weight||0;
    const ctx={jobVolWoW:0,jobVolIndex:jvi,jobStageWeight:jsw,prevJobVolWoW:0,jobStageJump:0};
    rules.filter(r=>r.enabled).forEach(rule => { try{if(new Function(...Object.keys(ctx),`return(${rule.condition})`)(...Object.values(ctx)))alerts.push({id:`${v.id}_${rule.id}_${Date.now()}`,ts:Date.now(),vertical:v.name,text:rule.message,severity:rule.severity});}catch{} });
  });
  return alerts;
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}body{background:#f0f2f5;color:${C.text}}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeInSlow{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(2,132,199,0)}50%{box-shadow:0 0 0 6px rgba(2,132,199,.1)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
.fade-in{animation:fadeIn .25s ease}.fade-in-slow{animation:fadeInSlow .4s ease}
.glow{animation:glow 2.5s ease-in-out infinite}
.shimmer{background:linear-gradient(90deg,${C.nested} 25%,${C.white} 50%,${C.nested} 75%);background-size:200% 100%;animation:shimmer 1.5s infinite}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-thumb{background:#c4c9d4;border-radius:3px}::-webkit-scrollbar-thumb:hover{background:#a0a8b8}
input,textarea,select{background:${C.white};border:1.5px solid ${C.border};color:${C.text};font-family:'Inter',sans-serif;font-size:13px;padding:8px 12px;border-radius:8px;outline:none;transition:all .2s}
input:focus,textarea:focus,select:focus{border-color:${C.cyan};box-shadow:0 0 0 3px ${C.cyanBg}}
textarea{font-family:'JetBrains Mono',monospace;font-size:12px;resize:vertical}
table{border-collapse:separate;border-spacing:0;width:100%}
.recharts-cartesian-grid-horizontal line,.recharts-cartesian-grid-vertical line{stroke:${C.borderLight}}
.metric-card{transition:transform .15s,box-shadow .15s}.metric-card:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(0,0,0,.08)}
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
function Badge({children,color=C.textSec,bg,size="sm"}){
  const sz=size==="lg"?{padding:"4px 12px",fontSize:12}:{padding:"3px 9px",fontSize:10.5};
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,...sz,borderRadius:999,fontWeight:700,...font.sans,background:bg||color+"14",color,whiteSpace:"nowrap",letterSpacing:"0.02em",textTransform:"uppercase"}}>{children}</span>;
}
function Spinner({size=14,color:cl=C.cyan}){ return <svg width={size} height={size} viewBox="0 0 24 24" style={{animation:"spin .7s linear infinite",flexShrink:0}}><circle cx="12" cy="12" r="10" fill="none" stroke={C.border} strokeWidth="3"/><path d="M12 2 a10 10 0 0 1 10 10" fill="none" stroke={cl} strokeWidth="3" strokeLinecap="round"/></svg>; }
function Card({children,style:sx,className,hover}){ return <div className={className} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:20,boxShadow:"0 1px 3px rgba(0,0,0,.04)",...sx}}>{children}</div>; }

function SectionHeader({icon,title,subtitle,right,badge}){
  return(<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:8}}>
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:subtitle?4:0}}>
        {icon&&<span style={{display:"flex",alignItems:"center"}}>{icon}</span>}
        <h2 style={{...font.sans,fontSize:18,fontWeight:700,letterSpacing:"-0.02em",color:C.text,margin:0}}>{title}</h2>
        {badge}
      </div>
      {subtitle&&<p style={{...font.sans,fontSize:13,color:C.textMuted,lineHeight:1.5,maxWidth:600,margin:0}}>{subtitle}</p>}
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
    metric: "Active GitHub repositories matching keywords (pushed in last 30 days)",
    how: "GET to GitHub Search API /search/repositories — filters by keyword and pushed:>30d ago. Measures active open-source development activity.",
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
    how: 'GET to GitHub Search API /search/commits — searches for "Co-Authored-By: Claude" in commit messages within the past 7 days.',
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
    "Live hiring demand: counts US job posts matching your keywords (titles + descriptions). Rising volume usually means more AI headcount budget and vendor spend over the next several quarters.",
  google_trends:
    "Search attention, not revenue: Google’s 0–100 index for your keywords vs their own past peak. Shows awareness and research — often before budgets lock in, but can outpace actual hiring.",
  github_repos:
    "Builder activity: public repos matching your themes with pushes in the last 30 days. More activity usually means developers experimenting — often months ahead of enterprise rollouts.",
  claude_attrib:
    "Real tool usage: GitHub commits in the last 7 days co-authored by Claude. A fast read on whether AI coding assistants are embedded in day-to-day engineering.",
  historical:
    "TheirStack history blend: hiring momentum and anomalies from monthly job data — sharpens the composite when backfill has run.",
  githubHistorical:
    "GitHub depth: historical repo/watchlist signal so OSS traction affects the score, not just one snapshot.",
};

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

function AnnotationForm({ signalKey, signalLabel, onAdd, onClose }) {
  const [type, setType] = useState("inflection");
  const [note, setNote] = useState("");
  const [author, setAuthor] = useState(() => ld("annotation_author", ""));
  const submit = () => {
    if (!note.trim()) return;
    sv("annotation_author", author);
    onAdd({ signalKey, signalLabel, type, note: note.trim(), author: author.trim() || "Team" });
    onClose();
  };
  const inputSt = { ...font.sans, fontSize: 12, padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.text, width: "100%" };
  return (
    <div className="fade-in" style={{ padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text }}>Add annotation — {signalLabel}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: 16 }}>✕</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {ANNOTATION_TYPES.map(t => (
          <button key={t.id} onClick={() => setType(t.id)}
            style={{ ...font.sans, fontSize: 11, padding: "4px 10px", borderRadius: 16, cursor: "pointer", border: type === t.id ? `2px solid ${t.color}` : `1px solid ${C.border}`, background: type === t.id ? t.color + "18" : C.white, color: type === t.id ? t.color : C.textSec, fontWeight: type === t.id ? 700 : 500 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="What did you observe? Why does it matter?" rows={2} style={{ ...inputSt, resize: "vertical", marginBottom: 6 }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Your name" style={{ ...inputSt, maxWidth: 160 }} />
        <Btn size="sm" variant="accent" onClick={submit} disabled={!note.trim()}>Save</Btn>
      </div>
    </div>
  );
}

function AnnotationLog({ annotations, signalKey, onDelete }) {
  const filtered = signalKey ? annotations.filter(a => a.signalKey === signalKey) : annotations;
  if (!filtered.length) return null;
  const sorted = [...filtered].sort((a, b) => b.ts - a.ts);
  return (
    <div style={{ marginTop: 8 }}>
      {sorted.slice(0, 10).map(ann => {
        const tp = ANNOTATION_TYPES.find(t => t.id === ann.type) || ANNOTATION_TYPES[4];
        return (
          <div key={ann.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderBottom: `1px solid ${C.borderLight}` }}>
            <span style={{ color: tp.color, fontSize: 12, flexShrink: 0, marginTop: 1 }}>{tp.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...font.sans, fontSize: 11, color: C.text }}>{ann.note}</div>
              <div style={{ ...font.sans, fontSize: 10, color: C.textMuted }}>{tp.label} · {ann.author || "Team"} · {new Date(ann.isoDate).toLocaleDateString()}{ann.signalLabel ? ` · ${ann.signalLabel}` : ""}</div>
            </div>
            {onDelete && <button onClick={() => onDelete(ann.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: 12, flexShrink: 0 }}>✕</button>}
          </div>
        );
      })}
    </div>
  );
}

function zoomedYDomain(values) {
  if (!values?.length) return [0, "auto"];
  const nums = values.filter(v => typeof v === "number" && isFinite(v));
  if (nums.length < 2) return [0, "auto"];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min;
  if (range === 0) return [Math.max(0, min - 1), max + 1];
  if (min === 0) return [0, max + range * 0.1];
  const pad = range * 0.15;
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}

function SignalHistoryChart({ signalKey, color, label }) {
  const raw = getSignalHistory(signalKey);
  if (raw.length < 2) return <div style={{...font.sans,fontSize:12,color:C.textMuted,padding:"12px 0",textAlign:"center"}}>Chart appears after 2+ data points. Data is recorded permanently on each refresh.</div>;
  const data = raw.map(p => ({ ...p, _ts: new Date(p.isoDate || p.ts).getTime() })).sort((a,b)=>a._ts-b._ts);
  const showDots = data.length <= 60;
  const yDomain = zoomedYDomain(data.map(d => d.value));
  const vals = data.map(d => d.value);
  let pctChange = data.length >= 2 ? (((data[data.length - 1].value - data[0].value) / Math.max(data[0].value, 1)) * 100) : 0;
  let pctNote = null;
  const hi = Math.max(...vals), lo = Math.min(...vals);
  if (data.length >= 6 && lo > 0 && hi / lo > 50) {
    const k = Math.max(2, Math.floor(data.length * 0.2));
    const earlyMean = mean(vals.slice(0, k));
    const lateMean = mean(vals.slice(-k));
    if (earlyMean > 0) {
      pctChange = ((lateMean - earlyMean) / earlyMean) * 100;
      pctNote = "early vs late avg";
    }
  }
  return (
    <div style={{ width: "100%", height: 160 }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <span style={{...font.sans,fontSize:10,color:C.textMuted}}>{data.length} data points since {formatChartDateShort(data[0]?.isoDate)}</span>
        <span style={{...font.mono,fontSize:10,fontWeight:700,color:pctChange > 0 ? C.green : pctChange < 0 ? C.red : C.textMuted}} title={pctNote || "First point vs last point"}>{pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%{pctNote ? " *" : ""} overall</span>
      </div>
      {pctNote && <div style={{...font.sans,fontSize:9,color:C.textMuted,textAlign:"right",marginBottom:4,lineHeight:1.3}}>* {pctNote}: used when the first points are on a different scale than recent data (run Backfill to align windows).</div>}
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top:8,right:16,bottom:8,left:8 }}>
          <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin","dataMax"]}
            tickFormatter={ts=>formatChartDateShort(new Date(ts).toISOString())}
            tick={{fontSize:9,fill:C.textMuted,...font.sans}} interval="preserveStartEnd" tickCount={6} />
          <YAxis tick={{fontSize:10,fill:C.textMuted,...font.mono}} width={55} domain={yDomain} allowDataOverflow={true} />
          <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}} labelStyle={{fontWeight:700}} labelFormatter={ts=>formatChartDate(new Date(ts).toISOString())} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5}
            dot={showDots?{r:3,fill:C.white,stroke:color,strokeWidth:2}:false}
            activeDot={{r:5,fill:color}} name={label} />
        </LineChart>
      </ResponsiveContainer>
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
      hist.forEach(h => {
        const ts = new Date(h.isoDate || h.ts).getTime();
        allPoints.push({ _ts: ts, sk, value: h.value });
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
    return { data: rows };
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
      <SectionHeader icon={<IcoC name="layers" size={18} color={C.purple}/>} title="Signal Divergence Overlay" subtitle="Normalized 0–100. Divergences >1.5σ from historical co-movement are flagged automatically." badge={<Badge color={C.purple} bg={C.purpleBg}>{selectedKeys.length} signals</Badge>}/>
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
              <Line key={sk} type="monotone" dataKey={sk} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={showDots?{r:3}:false} name={labelFor(sk)} connectNulls />
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
    () =>
      snapHist
        .filter((r) => r.ts)
        .slice(-80)
        .map((r) => ({
          t: r.ts,
          label: new Date(r.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          forecast_u: r.forecast_u,
          jolts: r.jolts,
        })),
    [snapHist],
  );

  const fredSeriesInCat = fredByCat[fredCat] || [];

  return (
    <Card style={{ borderLeft: `4px solid ${C.amber}`, padding: 0, overflow: "hidden" }} className="fade-in">
      <div style={{ padding: "18px 22px 14px", background: C.white }}>
        <SectionHeader
          icon={<IcoC name="barChart" size={18} color={C.amber} />}
          title="Macro labor & economy (US)"
          subtitle="Chicago Fed nowcast (weekly xlsx, no key) + expanded FRED context (hiring, JOLTS, growth, rates, stress, tech IP). Charts use multi-year history; each refresh appends a snapshot you can compare over time."
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

        {laborOverview?.chicago_fed && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
            <div style={{ background: C.nested, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>UR forecast (50th)</div>
              <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: C.text }}>{laborOverview.chicago_fed.forecast_unemployment != null ? `${laborOverview.chicago_fed.forecast_unemployment}%` : "—"}</div>
            </div>
            <div style={{ background: C.nested, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Layoffs &amp; sep.</div>
              <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: C.text }}>{laborOverview.chicago_fed.layoffs_separations_rate != null ? laborOverview.chicago_fed.layoffs_separations_rate.toFixed(2) : "—"}</div>
            </div>
            <div style={{ background: C.nested, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Hiring (unemp.)</div>
              <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: C.text }}>{laborOverview.chicago_fed.hiring_rate_unemployed != null ? laborOverview.chicago_fed.hiring_rate_unemployed.toFixed(1) : "—"}</div>
            </div>
            {laborOverview.chicago_fed.official_u3 != null && (
              <div style={{ background: C.nested, borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>BLS U-3</div>
                <div style={{ ...font.mono, fontSize: 18, fontWeight: 800, color: C.text }}>{laborOverview.chicago_fed.official_u3}%</div>
              </div>
            )}
          </div>
        )}

        {chiTs.length >= 2 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>Chicago Fed — unemployment nowcast vs official U-3 ({chiTs.length} weekly points)</div>
            <div style={{ height: 200, width: "100%" }}>
              <ResponsiveContainer>
                <LineChart data={chiTs} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: C.textMuted }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: C.textMuted }} width={36} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="official_u3" name="Official U-3" stroke={C.blue} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="forecast_unemployment" name="Nowcast (50th)" stroke={C.amber} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, margin: "14px 0 6px" }}>Chicago Fed — layoffs / separations vs hiring (unemployed)</div>
            <div style={{ height: 200, width: "100%" }}>
              <ResponsiveContainer>
                <LineChart data={chiTs} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: C.textMuted }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: C.textMuted }} width={36} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="layoffs_separations_rate" name="Layoffs & sep. rate" stroke={C.red} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="hiring_rate_unemployed" name="Hiring rate (U)" stroke={C.green} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {snapChart.length >= 2 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...font.sans, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>Your refresh snapshots (stored locally)</div>
            <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6 }}>Each macro refresh records Chicago nowcast, JOLTS openings, and UI claims when FRED is configured.</div>
            <div style={{ height: 160, width: "100%" }}>
              <ResponsiveContainer>
                <LineChart data={snapChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
        )}

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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
              {fredSeriesInCat.map((s, idx) => {
                const col = PALETTE[idx % PALETTE.length];
                const data = (s.observations || []).map((o) => ({ date: o.date, v: o.value }));
                if (s.error) {
                  return (
                    <div key={s.id} style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.borderLight}`, background: C.nested }}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{s.id}</div>
                      <div style={{ fontSize: 10, color: C.red }}>{s.error}</div>
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
                return (
                  <div key={s.id} style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.borderLight}`, background: C.white }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 2 }}>{s.meta?.name || s.id}</div>
                    <div style={{ fontSize: 9, color: C.textMuted, fontFamily: font.mono.fontFamily, marginBottom: 6 }}>{s.id}</div>
                    <div style={{ height: 120, width: "100%" }}>
                      <ResponsiveContainer>
                        <LineChart data={data} margin={{ top: 2, right: 4, left: -18, bottom: 0 }}>
                          <XAxis dataKey="date" tick={{ fontSize: 8, fill: C.textMuted }} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 8, fill: C.textMuted }} width={44} domain={["auto", "auto"]} />
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
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 6 }}>FRED — latest print (all series)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 160, overflowY: "auto", padding: 4, background: C.nested, borderRadius: 10 }}>
              {laborOverview.fred_latest
                .filter((x) => !x.error)
                .map((x) => (
                  <span key={x.series_id} style={{ ...font.sans, fontSize: 10, padding: "4px 8px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }}>
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
        <Expandable title="How this relates to your tracking groups">
          <div style={{ padding: "10px 14px", fontSize: 12, color: C.textSec, lineHeight: 1.6 }}>
            <strong style={{ color: C.text }}>Per-group cards</strong> (TheirStack, Trends, etc.) use <em>your</em> keywords. This section is <strong>US-wide context</strong>: regime (unemployment, claims, JOLTS), demand (GDP, retail, consumption), stress (VIX, NFCI), rates (curve), and tech-related industrial production.
            Chicago Fed data is <strong>backfilled from the public xlsx</strong> each time you refresh. FRED history is <strong>backfilled from the FRED API</strong> when <code style={{ fontSize: 11 }}>FRED_API_KEY</code> is set server-side.
          </div>
        </Expandable>
      </div>
    </Card>
  );
}

// ── SIGNAL PANEL (redesigned) ────────────────────────────────────────────────

function SignalPanel({ source, verticals, signalResults, loading, errors, onFetch, onUpdateKeywords, overlaySelected, onToggleOverlay, tsHistoryByVertical, historyProgress, onBackfillHistory, onBackfillSignal, demoTheirStack }) {
  const [expandedVert, setExpandedVert] = useState(null);
  const [showChart, setShowChart] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const kwLabel = { titleKeywords:"Title keywords", descriptionKeywords:"Description keywords", keywords:"Search query" };
  const info = SOURCE_INFO[source.id];
  const iconMap = {theirstack:"briefcase",google_trends:"trendUp",github_repos:"code",claude_attrib:"bot"};
  const iconName = iconMap[source.id] || "activity";

  const totalCount = verticals.reduce((sum, v) => {
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
                {demoTheirStack && <Badge color={C.cyan} bg={C.cyanBg} size="sm" title="No TheirStack API key — counts are deterministic estimates from your keywords">Demo estimates</Badge>}
              </div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {totalCount>0&&<span style={{...font.mono,fontSize:22,fontWeight:800,color:C.cyan}}>{totalCount.toLocaleString()}</span>}
            <Btn variant="primary" size="sm" onClick={()=>onFetch(source.id)} disabled={!source.enabled||Object.values(loading).some(Boolean)}>
              {loading[source.id]?<><Spinner size={12} color="#fff"/> Fetching</>:"Refresh"}
            </Btn>
          </div>
        </div>

        {info&&(
          <Expandable title="Show methodology, lead/lag timing & signal interpretation guide">
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
              {info.movements&&(
                <div style={{marginTop:4}}>
                  <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.text,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>What Movements Mean</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {Object.entries(info.movements).map(([k,m])=>{
                      const sevColor = k.includes("strongUp")||k.includes("enterprisePattern")||k.includes("titleShift") ? C.green : k.includes("moderateUp")||k.includes("languageShift") ? C.blue : k.includes("flat")||k.includes("plateau") ? C.textMuted : k.includes("decline")||k.includes("strongDown") ? C.red : C.amber;
                      return (
                        <div key={k} style={{padding:"10px 12px",background:sevColor+"06",border:`1px solid ${sevColor}18`,borderRadius:8}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                            <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:sevColor,flexShrink:0}}/>
                            <span style={{...font.sans,fontSize:12,fontWeight:700,color:C.text}}>{m.label}</span>
                          </div>
                          <div style={{...font.sans,fontSize:11.5,color:C.textSec,lineHeight:1.55,marginBottom:6}}>{m.meaning}</div>
                          <div style={{...font.sans,fontSize:11,color:sevColor,lineHeight:1.5,fontWeight:600,paddingLeft:14,borderLeft:`2px solid ${sevColor}44`}}>{m.marketImpact}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Expandable>
        )}
        {info && (
          <div style={{ marginTop: 14, padding: "12px 16px", background: "#f4f7fb", borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>For the team — what this number means</div>
            <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.55, maxWidth: 920 }}>
              {SOURCE_METRIC_BLURB[source.id] || info.metric}
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, lineHeight: 1.45 }}>Technical: {info.metric}</div>
          </div>
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
          const trend = prevVal && res?.count ? Math.round(((res.count - prevVal)/Math.max(prevVal,1))*100) : null;

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
                   err ? <Badge color={C.red} bg={C.redBg} size="sm">{err.slice(0,25)}</Badge> :
                   res ? <div>
                     <div style={{...font.mono,fontSize:22,fontWeight:800,color:C.text,letterSpacing:"-0.03em"}}>{(res.count||0).toLocaleString()}</div>
                     {trend!=null&&<Badge color={trend>=0?C.green:C.red} bg={trend>=0?C.greenBg:C.redBg} size="sm">{trend>=0?"+":""}{trend}%</Badge>}
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
                      {(()=>{const sd=hist.map(p=>({...p,_ts:new Date(p.isoDate||p.ts).getTime()})).sort((a,b)=>a._ts-b._ts);const yd=zoomedYDomain(sd.map(d=>d.value));return(
                      <ResponsiveContainer><LineChart data={sd} margin={{top:2,right:2,bottom:2,left:2}}>
                        <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin","dataMax"]} hide />
                        <YAxis hide domain={yd} allowDataOverflow={true} />
                        <Line type="monotone" dataKey="value" stroke={v.color||C.cyan} strokeWidth={2} dot={false}/>
                      </LineChart></ResponsiveContainer>);})()}
                    </div>
                  ) : <div style={{height:36,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:10,color:C.textMuted}}>No history</span></div>}
                </div>

                {/* Actions */}
                <div style={{display:"flex",gap:4,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                  {source.id === "theirstack" && !tsHist?.monthly?.length && (
                    <Btn variant="default" size="sm" onClick={()=>onBackfillHistory?.(v.id)} disabled={historyProgress?.active} title="Backfill TheirStack history from 2021">
                      <IcoC name="layers" size={13} color={C.textSec}/> Backfill Jobs
                    </Btn>
                  )}
                  {(source.id === "google_trends" || source.id === "github_repos" || source.id === "claude_attrib") && (
                    <Btn variant="default" size="sm" onClick={()=>onBackfillSignal?.(v.id, source.id)} disabled={historyProgress?.active} title={source.id === "google_trends" ? "Backfill ~12 months of Google Trends (needs SerpAPI key)" : source.id === "github_repos" ? "Rebuild history: 30-day repo counts sampled weekly (matches Refresh)" : "Rebuild history: 7-day Claude counts sampled weekly (matches Refresh)"}>
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
                  <SignalHistoryChart signalKey={key} color={v.color||C.cyan} label={source.name} />
                  {source.id === "theirstack" && tsHist?.weekly?.length >= 2 && (
                    <div style={{marginTop:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>Weekly Historical ({tsHist.weekly.length} weeks)</div>
                        {tsHist.derived && <div style={{display:"flex",gap:8}}>
                          {tsHist.derived.velocitySlope != null && <Badge color={tsHist.derived.velocitySlope > 0 ? C.green : C.red} bg={tsHist.derived.velocitySlope > 0 ? C.greenBg : C.redBg} size="sm">Velocity: {tsHist.derived.velocitySlope > 0 ? "+" : ""}{tsHist.derived.velocitySlope.toFixed(1)}</Badge>}
                          {tsHist.derived.anomalyZ != null && Math.abs(tsHist.derived.anomalyZ) > 1.5 && <Badge color={C.amber} bg={C.amberBg} size="sm">Z: {tsHist.derived.anomalyZ.toFixed(1)}</Badge>}
                        </div>}
                      </div>
                      <div style={{height:120}}>
                        {(()=>{const yd=zoomedYDomain(tsHist.weekly.map(w=>w.count));return(
                        <ResponsiveContainer>
                          <ComposedChart data={tsHist.weekly} margin={{top:4,right:8,bottom:4,left:4}}>
                            <XAxis dataKey="week" tick={{fontSize:9,fill:C.textMuted}} interval="preserveStartEnd" />
                            <YAxis tick={{fontSize:9,fill:C.textMuted}} width={50} domain={yd} allowDataOverflow={true} />
                            <Tooltip contentStyle={{fontSize:11,borderRadius:8}} />
                            <Bar dataKey="count" fill={v.color || C.cyan} opacity={0.5} radius={[2,2,0,0]} />
                            <Line type="monotone" dataKey="count" stroke={v.color || C.cyan} strokeWidth={2} dot={false} />
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
                  {/* Keywords */}
                  <div style={{marginBottom:12}}>
                    <div style={{...font.sans,fontSize:11,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Active Keywords</div>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {Object.entries(kw).map(([field,vals])=>{
                        const arr=Array.isArray(vals)?vals:[vals];
                        return(<div key={field} style={{display:"flex",alignItems:"flex-start",gap:12}}>
                          <span style={{...font.sans,fontSize:11,fontWeight:700,color:C.textSec,minWidth:130,paddingTop:5}}>{kwLabel[field]||field}</span>
                          <ChipEditor items={arr} onChange={nv=>onUpdateKeywords(v.id,source.id,field,nv)} color={C.cyan} placeholder="Add keyword…"/>
                        </div>);
                      })}
                    </div>
                  </div>

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
  const [showHist,setShowHist]=useState(false);

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
        <SectionHeader icon={<IcoC name="database" size={18} color={C.blue}/>} title="Hugging Face Leaderboard" subtitle="Open-source model adoption across major AI companies. Download volume = developer ecosystem gravity. Lead time: 3–9 months before enterprise deployment revenue."
          badge={<Badge color={C.green} bg={C.greenBg} size="sm">Public API</Badge>}
          right={<>
            {data?.timestamp&&<span style={{...font.sans,fontSize:11,color:C.textMuted}}>{timeAgo(data.timestamp)}</span>}
            <Btn variant={showHist?"primary":"ghost"} size="sm" onClick={()=>setShowHist(!showHist)}><IcoC name="barChart" size={13} color={showHist?"#fff":C.textSec}/> Trend</Btn>
            <Btn variant="primary" size="sm" onClick={doFetch} disabled={isL}>{isL?<><Spinner size={12} color="#fff"/> Fetching</>:"Refresh"}</Btn>
          </>}
        />
        <Expandable title="Show lead/lag timing & signal interpretation guide">
          <div style={{padding:"10px 14px",background:C.white,borderRadius:10,border:`1px solid ${C.borderLight}`,display:"flex",flexDirection:"column",gap:8}}>
            <div style={{fontSize:12,lineHeight:1.6,padding:"10px 12px",background:C.cyanBg,borderRadius:8,border:`1px solid ${C.cyan}22`,color:C.text}}>
              <span style={{fontWeight:700,color:C.cyan,display:"block",marginBottom:2}}>Lead/Lag: 3–9 months</span>
              Hugging Face downloads track developer experimentation and early production deployment of open-source models. Enterprise deployment follows 1–3 quarters after download surges, as companies move from testing to production. Cloud providers embedding HF models (Azure AI Foundry: 1.7M+ models, Google Cloud CDN: 2M+ models) compress this lag.
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

      {showHist && hfHist.length >= 2 && (
        <div className="fade-in" style={{padding:"14px 22px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:4}}>Download Growth Over Time</div>
          <div style={{...font.sans,fontSize:10,color:C.textMuted,marginBottom:6}}>{hfHist.length} data points since {formatChartDateShort(new Date(hfHist[0]?.ts).toISOString())}</div>
          <div style={{width:"100%",height:200}}>
            {(()=>{const hd=hfHist.map(p=>({...p,_ts:p.ts||Date.now()}));const allVals=hd.flatMap(p=>HF_ORGS.map(o=>p[o.id]).filter(v=>typeof v==="number"&&v>0));const yd=zoomedYDomain(allVals);return(
            <ResponsiveContainer>
              <LineChart data={hd} margin={{top:8,right:16,bottom:8,left:8}}>
                <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin","dataMax"]}
                  tickFormatter={ts=>formatChartDateShort(new Date(ts).toISOString())}
                  tick={{fontSize:9,fill:C.textMuted}} interval="preserveStartEnd" tickCount={6} />
                <YAxis tick={{fontSize:10,fill:C.textMuted,...font.mono}} width={55} tickFormatter={fmtDL} domain={yd} allowDataOverflow={true}/>
                <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}} formatter={v=>fmtDL(v)} labelFormatter={ts=>formatChartDate(new Date(ts).toISOString())} />
                <Legend wrapperStyle={{fontSize:10,...font.sans}}/>
                {HF_ORGS.map(org=>(<Line key={org.id} type="monotone" dataKey={org.id} stroke={org.color} strokeWidth={2} dot={false} name={org.name} connectNulls/>))}
              </LineChart>
            </ResponsiveContainer>);})()}
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
            return(<React.Fragment key={org.orgId}>
              <tr style={{cursor:"pointer",transition:"background .15s"}} onClick={()=>setExpanded(isExp?null:org.orgId)} onMouseEnter={e=>e.currentTarget.style.background=C.nested} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"12px 14px",textAlign:"center",...font.mono,fontSize:14,fontWeight:800,color:rank<3?meta.color:C.textMuted,width:40}}>{rank+1}</td>
                <td style={{padding:"12px 14px",fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap"}}>
                  <span style={{display:"inline-block",width:10,height:10,borderRadius:"50%",background:meta.color,marginRight:10,verticalAlign:"middle"}}/>{meta.name}
                  {rv&&<span style={{fontSize:10,color:C.textMuted,marginLeft:8}}>({rv}x less)</span>}
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

// ── ALERT FEED (redesigned) ──────────────────────────────────────────────────

function AlertFeed({alerts,onPin}){
  const sorted=[...alerts.filter(a=>a.pinned),...alerts.filter(a=>!a.pinned)].slice(0,20);
  const sevC={amber:C.amber,red:C.red,cyan:C.cyan,green:C.green};
  const sevDot=(sev)=><span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:sevC[sev]||C.textMuted,flexShrink:0,marginTop:4}}/>;
  if(sorted.length===0)return null;
  return(<Card>
    <SectionHeader icon={<IcoC name="zap" size={18} color={C.amber}/>} title="Divergence Alerts" subtitle="Automated signals when metrics diverge from expected patterns." badge={<Badge color={C.amber} bg={C.amberBg} size="sm">{sorted.length} active</Badge>}/>
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
  const withBand = data.map(d => ({ ...d, bandLow: Math.max(0, baseline - std), bandHigh: baseline + std }));
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

  const stageHelp = {
    s1: "Mostly research-oriented language in job posts.",
    s2: "Signals active proofs of concept and small pilots.",
    s3: "Signals real deployment and implementation activity.",
    s4: "Signals procurement, ownership, and committed spend.",
  };
  const sourceHelp = {
    theirstack: "Hiring demand",
    google_trends: "Buyer interest",
    github_repos: "Developer ecosystem",
    claude_attrib: "Real AI coding usage",
  };

  const scoringContent=(<div>
    <div style={{marginBottom:14,padding:"10px 12px",background:C.nested,border:`1px solid ${C.borderLight}`,borderRadius:10}}>
      <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:2}}>Simple mode</div>
      <div style={{...font.sans,fontSize:12,color:C.textSec,lineHeight:1.45}}>
        1) Choose how important each signal is in the overall score. 2) Give each language stage a boost multiplier.
        Higher multiplier = stronger pressure score when those job-language patterns appear.
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
      <div>
        <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>Signal importance (weights)</div>
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

      <div>
        <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>Job language stages</div>
        {config.stages.map((stg,si)=>(
          <div key={stg.id} style={{marginBottom:10,padding:"8px 10px",border:`1px solid ${C.borderLight}`,borderRadius:10,background:C.white}}>
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:5}}>
              <input type="color" value={stg.color} onChange={e=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],color:e.target.value};return{...c,stages:ss};})} style={{width:20,height:20,padding:1,border:`1px solid ${C.border}`,borderRadius:4}}/>
              <input value={stg.name} onChange={e=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],name:e.target.value};return{...c,stages:ss};})} style={{flex:1,fontSize:12,fontWeight:600,padding:"4px 8px"}}/>
              <span style={{...font.sans,fontSize:10.5,color:C.textMuted}}>boost</span>
              <input type="number" step="0.1" min="0.5" max="3" value={config.stageMultipliers[stg.id]||1}
                onChange={e=>update(c=>({...c,stageMultipliers:{...c.stageMultipliers,[stg.id]:parseFloat(e.target.value)||1}}))}
                style={{width:58,fontSize:12,padding:"4px 6px"}}/>
            </div>
            <div style={{...font.sans,fontSize:10.5,color:C.textMuted}}>{stageHelp[stg.id]||"Language classification stage"}</div>
          </div>
        ))}
      </div>
    </div>

    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,gap:8,flexWrap:"wrap"}}>
      <span style={{...font.sans,fontSize:11,color:C.textMuted}}>Don’t overthink it: the defaults are already tuned for directional monitoring.</span>
      <Btn size="sm" onClick={()=>update(c=>({...c,stages:JSON.parse(JSON.stringify(DEFAULT_STAGES)),stageTaxonomy:JSON.parse(JSON.stringify(DEFAULT_STAGE_TAXONOMY)),stageMultipliers:{s1:0.7,s2:1,s3:1.2,s4:1.5}}))}>Reset to recommended labels</Btn>
    </div>
  </div>);

  const githubContent=(<div>
    <div style={{...font.sans,fontSize:12,color:C.textSec,marginBottom:10}}>
      Add repos per signal group for GitHub historical analysis (owner/repo). Tier controls weighting in the composite GitHub score.
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
          {mailingList.length} recipient{mailingList.length!==1?"s":""}. Emails sent via EmailJS (free, 200/month).
        </div>
      </div>
    )}
  </div>);

  const instructionsContent=(<div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
      {[
        { icon: "briefcase", color: C.cyan, title: "Job Postings (TheirStack)", desc: "Counts AI-related job postings matching your keywords across US employers. Tracks hiring volume, language stage classification (exploration vs. deployment), and historical trends back to 2021. Requires TheirStack API key." },
        { icon: "trendUp", color: C.blue, title: "Google Trends (SerpAPI)", desc: "Measures relative search interest (0\u2013100) for your keywords on Google. Computes momentum vs. 4-week rolling average. Backfills 12 months of weekly data in a single API call. Leads enterprise procurement by 3\u20139 months. Requires SerpAPI key." },
        { icon: "code", color: C.green, title: "GitHub Repos", desc: "Counts active repositories matching your keywords with pushes in the last 30 days. Tracks open-source ecosystem growth \u2014 leads enterprise adoption by 6\u201318 months. Backfills monthly repo counts for the past year. Requires GitHub PAT." },
        { icon: "bot", color: C.purple, title: "Claude Code Attribution", desc: "Counts GitHub commits with 'Co-Authored-By: Claude' signatures in the past 7 days. The most real-time signal \u2014 0\u20133 month lead on AI platform revenue. Backfills monthly counts for the past year. Requires GitHub PAT." },
        { icon: "database", color: C.amber, title: "Hugging Face Leaderboard", desc: "Tracks model download volumes across major AI companies (OpenAI, Google, Meta, Microsoft, etc.) from the Hugging Face API. Measures supply-side AI capability growth. No API key required \u2014 public API." },
        { icon: "barChart", color: C.orange, title: "Composite Scoring & Stages", desc: "Combines all signals into a weighted composite score (0\u2013100) per vertical. Classifies each into adoption stages: Watchlist \u2192 Validating \u2192 Rolling Out \u2192 Committed. Weights are adjustable in settings." },
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
        { title: "Historical Backfill", desc: "Every signal source has a Backfill button. TheirStack queries monthly job counts from Jan 2021. Google Trends fetches 5 years of weekly data in one call. GitHub counts repos/commits per month going back to 2021 (or 2023 for Claude). All historical data is stored permanently." },
        { title: "Growth Charts & Signal Divergence Overlay", desc: "Every metric records a data point on each refresh, building a persistent time-series graph. Click the chart icon to see growth trends. Select 2–4 signals across verticals and metric types to overlay them on a normalized 0–100 scale. The system automatically detects divergences (e.g., job postings rising while API wrapper traffic drops = CIO mandate without real adoption) — these are your actual investment signals." },
        { title: "AI-Powered Divergence Analysis", desc: "When you overlay 2+ signals, the system uses z-score statistics (1.5σ threshold) and Pearson correlation to detect when historically co-moving signals diverge. Click 'AI Interpret' to have Claude generate a narrative explaining what the divergence means for investment timing (e.g., 'RFP spike → jobs lag → budget confirm' pattern detection)." },
        { title: "AI-Powered Weekly Intelligence Report", desc: "Uses Claude (Anthropic API) to synthesize all dashboard data into a comprehensive investment memo. Includes regime classification, inflection detection, divergence analysis, cross-vertical intelligence, and 5 actionable recommendations with conviction levels. Requires Anthropic API key." },
        { title: "Cloud Persistence", desc: "All data automatically syncs to a private GitHub Gist so it is shared across all team members and survives redeploys. Requires GitHub PAT with gist scope." },
        { title: "Auto-Refresh Scheduler", desc: "Signals auto-refresh on their configured cadence (weekly by default). The scheduler also backfills recent TheirStack history automatically if stale. Pause/resume from the nav bar." },
        { title: "Email Reports", desc: "Generated weekly reports can be emailed to your entire team via EmailJS (free, no domain verification needed). Set up your EmailJS account and configure it in the Mailing List tab. 200 emails/month on the free plan." },
      ].map((item, i) => (
        <div key={i} style={{padding:"10px 14px",background:C.nested,borderRadius:10}}>
          <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:3}}>{item.title}</div>
          <div style={{...font.sans,fontSize:11,color:C.textSec,lineHeight:1.5}}>{item.desc}</div>
        </div>
      ))}
    </div>
    <div style={{...font.sans,fontSize:13,fontWeight:700,color:C.text,marginBottom:8}}>Required API keys (set in .env file)</div>
    <div style={{...font.sans,fontSize:11,color:C.textSec,lineHeight:1.7,fontFamily:"monospace",background:C.nested,padding:"14px 18px",borderRadius:10,marginBottom:8}}>
      VITE_THEIRSTACK_KEY=your-key &nbsp;&nbsp;<span style={{color:C.textMuted}}># theirstack.com — job posting data</span><br/>
      VITE_THEIRSTACK_MOCK=true &nbsp;&nbsp;<span style={{color:C.textMuted}}># optional — force demo job data even if a key is set</span><br/>
      VITE_SERPAPI_KEY=your-key &nbsp;&nbsp;<span style={{color:C.textMuted}}># serpapi.com — Google Trends data</span><br/>
      VITE_GITHUB_PAT=your-pat &nbsp;&nbsp;<span style={{color:C.textMuted}}># github.com — repos, commits, cloud sync</span><br/>
      VITE_ANTHROPIC_API_KEY=your-key &nbsp;&nbsp;<span style={{color:C.textMuted}}># anthropic.com — weekly AI report</span><br/>
      FRED_API_KEY=your-key &nbsp;&nbsp;<span style={{color:C.textMuted}}># fred.stlouisfed.org — server-side only; powers /api/labor on Vercel + Vite dev</span>
    </div>
    <div style={{...font.sans,fontSize:11,color:C.textMuted}}>
      Without VITE_THEIRSTACK_KEY, job counts and backfills use realistic simulated series so charts and briefs still work. Anthropic is optional (for the AI weekly report). Hugging Face data is free and requires no key. Chicago Fed + FRED live under <strong>National context</strong> after your tracking-group cards; add FRED_API_KEY for full FRED on Vercel.
    </div>
  </div>);

  const items=[
    {id:"instructions",label:"Instructions",content:instructionsContent},
    {id:"groups",label:"Signal Groups",content:groupsContent},
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
  const [tsHistoryByVertical,setTsHistoryByVertical]=useState({});
  const [historyProgress,setHistoryProgress]=useState({active:false,verticalId:null,current:0,total:0,label:""});
  const [crossCorr,setCrossCorr]=useState(()=>ld(crossCorrKey(),[]));
  const [patternNotes,setPatternNotes]=useState({});
  const [annotations,setAnnotations]=useState(()=>getAnnotations());
  const [showAnnotationForm,setShowAnnotationForm]=useState(null);
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
    const pat=resolveGitPat();if(pat)debouncedSyncToGist(pat);
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
      setBriefContent(cur.content_markdown);
      setBriefBaseForDiff(cur.first_content_markdown || cur.content_markdown);
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

  const doCloudSync=useCallback(async(direction)=>{
    const pat=resolveGitPat();if(!pat)return;
    setCloudStatus(direction==="up"?"saving…":"loading…");
    try{
      if(direction==="up"){await syncToGist(pat);lastSyncRef.current=Date.now();}
      else{const ok=await syncFromGist(pat);if(ok){setConfig(ld("config",buildDefaultConfig()));lastSyncRef.current=Date.now();}}
      setCloudStatus("synced");
    }catch{setCloudStatus("error");}
    setTimeout(()=>setCloudStatus("idle"),3000);
  },[resolveGitPat]);

  const autoHistoryFetchedRef = useRef(false);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const pat=resolveGitPat();
      if(pat){setCloudStatus("loading…");try{await syncFromGist(pat);if(!cancelled){setConfig(ld("config",buildDefaultConfig()));setMailingList(ld("mailing_list",[]));}}catch{}if(!cancelled){setCloudStatus("idle");lastSyncRef.current=Date.now();}}
      await new Promise(r=>setTimeout(r,100));
      if(!cancelled){cloudSyncDoneRef.current=true;_cloudInitDone=true;}
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
    const id=setInterval(()=>{const pat=resolveGitPat();if(pat)syncToGist(pat).catch(()=>{});},120000);
    const onUnload=()=>{if(!_cloudInitDone)return;const pat=resolveGitPat();if(pat){const data=getAllData();const gistId=localStorage.getItem(GIST_ID_KEY);if(gistId){const body=JSON.stringify({files:{"signal-data.json":{content:JSON.stringify(data)}}});try{fetch(`https://api.github.com/gists/${gistId}`,{method:"PATCH",headers:{Authorization:`Bearer ${pat}`,"Content-Type":"application/json"},body,keepalive:true});}catch(e){}}}};
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
    const pat=resolveGitPat();if(pat)debouncedSyncToGist(pat,3000);
  },[resolveGitPat]);

  const refreshAll=useCallback(async()=>{
    const cfg=configRef.current;
    await Promise.allSettled(cfg.sources.filter(s=>s.enabled).map(src=>fetchSource(src.id)));
    const sr=srRef.current;const na=evalAlerts(cfg.verticals,sr,cfg.alertRules);
    if(na.length>0)setAlerts(p=>[...na,...p].slice(0,50));
    doCloudSync("up");
  },[fetchSource,doCloudSync]);

  const updateKeywords=useCallback((vertId,sourceId,field,nv)=>{
    setConfig(prev=>{const vs=prev.verticals.map(v=>v.id!==vertId?v:{...v,keywords:{...v.keywords,[sourceId]:{...v.keywords[sourceId],[field]:nv}}});const next={...prev,verticals:vs};sv("config",next);return next;});
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

  const fetchGitHubCountInRange = useCallback(async (vertical, sourceId, gte, lte) => {
    const token = ENV_KEYS.github || "";
    const headers = token ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } : { Accept: "application/vnd.github+json" };
    let q = "";
    if (sourceId === "github_repos") {
      const kw = vertical.keywords?.github_repos?.keywords;
      const terms = Array.isArray(kw) ? kw.filter(Boolean).join("+") : (kw || "");
      if (!terms) return 0;
      q = `${terms}+pushed:${gte}..${lte}`;
      const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&per_page=1`, { headers });
      if (res.status === 422) return 0;
      if (!res.ok) throw new Error(await githubApiErrorMessage(res));
      const json = await res.json();
      return json.total_count || 0;
    } else if (sourceId === "claude_attrib") {
      const vkw = vertical.keywords?.claude_attrib || {};
      const extraKw = Array.isArray(vkw.keywords) ? vkw.keywords.filter(Boolean) : [];
      const base = extraKw.length > 0
        ? `"Co-Authored-By: Claude"+${extraKw.map(k => `"${k}"`).join("+")}`
        : `"Co-Authored-By: Claude"`;
      q = `${base}+committer-date:${gte}..${lte}`;
      const res = await fetch(`https://api.github.com/search/commits?q=${encodeURIComponent(q)}&sort=committer-date&per_page=1`, { headers: { ...headers, Accept: "application/vnd.github.cloak-preview+json" } });
      if (res.status === 422) return 0;
      if (!res.ok) throw new Error(await githubApiErrorMessage(res));
      const json = await res.json();
      return json.total_count || 0;
    }
    return 0;
  }, []);

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
    const histCacheKey = `backfill_v2_${signalKey}`;
    const cached = ld(histCacheKey, null);
    if (cached?.version === 2 && cached?.points?.length > 8) {
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
        sv(histCacheKey, { version: 2, generatedAt: new Date().toISOString(), points: recorded });
        setAllHistories(prev => ({ ...prev, [signalKey]: getSignalHistory(signalKey) }));
      } catch (e) {
        setErrors(prev => ({ ...prev, [signalKey]: e.message }));
      }
      setHistoryProgress({ active: false, verticalId: null, current: 0, total: 0, label: "" });
      return;
    }

    if (sourceId === "github_repos" || sourceId === "claude_attrib") {
      const weeks = weekIntervals(78, new Date());
      setHistoryProgress({ active: true, verticalId, current: 0, total: weeks.length, label: `Backfilling ${vert.name} ${sourceId === "github_repos" ? "GitHub Repos (30d windows)" : "Claude (7d windows)"}...` });
      const recorded = [];
      for (let i = 0; i < weeks.length; i++) {
        if (cancelHistoryRef.current) break;
        const w = weeks[i];
        try {
          let count;
          let gteR = w.gte;
          let lteR = w.lte;
          if (sourceId === "github_repos") {
            const lteD = new Date(w.lte + "T12:00:00Z");
            const gteD = new Date(lteD);
            gteD.setUTCDate(gteD.getUTCDate() - 29);
            gteR = gteD.toISOString().slice(0, 10);
            lteR = w.lte;
            count = await fetchGitHubCountInRange(vert, sourceId, gteR, lteR);
          } else {
            count = await fetchGitHubCountInRange(vert, sourceId, w.gte, w.lte);
          }
          const ts = new Date(w.lte + "T12:00:00Z").getTime();
          const entry = { ts, isoDate: new Date(ts).toISOString(), value: count, date: w.key };
          recorded.push(entry);
          const h = ld(`hist_${signalKey}`, []);
          if (!h.some(x => Math.abs(x.ts - ts) < 86400000 * 4)) {
            h.push(entry);
            h.sort((a, b) => a.ts - b.ts);
            if (h.length > 500) h.splice(0, h.length - 500);
            sv(`hist_${signalKey}`, h);
          }
        } catch (e) {
          if (e.message?.includes("rate limit")) { await sleep(60000); i--; continue; }
          setErrors(prev => ({ ...prev, [signalKey]: e.message }));
          break;
        }
        setHistoryProgress({ active: true, verticalId, current: i + 1, total: weeks.length, label: `Backfilling ${vert.name} ${sourceId === "github_repos" ? "repos" : "Claude"} (${i + 1}/${weeks.length})...` });
        await sleep(2200);
      }
      if (recorded.length > 0) {
        sv(histCacheKey, { version: 2, generatedAt: new Date().toISOString(), points: recorded });
        setAllHistories(prev => ({ ...prev, [signalKey]: getSignalHistory(signalKey) }));
      }
      setHistoryProgress({ active: false, verticalId: null, current: 0, total: 0, label: "" });
      return;
    }
    const pat=resolveGitPat();if(pat)debouncedSyncToGist(pat,2000);
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
      await sleep(300);
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
      await sleep(300);
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
    const pat=resolveGitPat();if(pat)debouncedSyncToGist(pat,2000);
  }, [fetchTheirStackCountInRange, recomputeCrossCorr, resolveGitPat]);

  const autoFetchRecentHistory = useCallback(async (verticalId) => {
    const vert = configRef.current.verticals.find(v => v.id === verticalId);
    if (!vert) return;
    const source = configRef.current.sources.find(s => s.id === "theirstack");
    if (!source) return;
    const keys = configRef.current.apiKeys;
    if (!resolveTheirStackMocking(source, keys) && !resolveKey(source, keys)) return;
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
      await sleep(400);
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
    const pat=resolveGitPat();if(pat)debouncedSyncToGist(pat);
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
        recent_values: sorted.slice(-12).map(p => ({ date: p.isoDate || new Date(p.ts).toISOString(), value: p.value })),
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
        composite_score: comp.score || 0,
        pipeline_stage: { index: stage.index + 1, label: stage.name, description: stage.description || "" },
        score_breakdown: Object.entries(comp.breakdown || {}).map(([k,b]) => ({ source: b?.source?.name || k, raw_score: b?.score || 0, weight: b?.weight || 0 })),
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

    const avgComposite = verticalsCtx.length ? Math.round(verticalsCtx.reduce((s,v)=>s+v.composite_score,0)/verticalsCtx.length) : 0;
    const maxComposite = verticalsCtx.length ? Math.max(...verticalsCtx.map(v=>v.composite_score)) : 0;
    const minComposite = verticalsCtx.length ? Math.min(...verticalsCtx.map(v=>v.composite_score)) : 0;

    const fingerprint = JSON.stringify(Object.keys(signalResults).sort().map((k) => [k, signalResults[k]?.count ?? 0]));

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
      composite_score_summary: { average: avgComposite, highest: maxComposite, lowest: minComposite, spread: maxComposite - minComposite },
      verticals: verticalsCtx,
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
    };
    return trimPayloadSize(ctx, 22000);
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
      26000,
    );
    const wk = ctx.week || weekKeyFromDate(new Date());
    setBriefWeek(wk);
    setBriefOpen(true);
    setBriefLoading(true);
    setBriefProgressSec(0);
    let tmr = null;
    try {
      tmr = setInterval(() => setBriefProgressSec((s) => Math.min(60, s + 1)), 1000);
      const apiKey = ENV_KEYS.anthropic;
      if (!apiKey) throw new Error("Missing VITE_ANTHROPIC_API_KEY");
      const systemPrompt = `You are the Head of AI Demand Intelligence at a technology-focused hedge fund managing $2B+ in AI-exposed positions. Every week you produce the team's definitive report — the single document the entire investment team reads Monday morning to calibrate thesis and sizing.

YOUR ANALYTICAL FRAMEWORK:
- Numbers first, narrative second. Every claim must cite a specific metric, rate of change, or comparison.
- RATES OF CHANGE matter more than levels. A count of 5,000 means nothing — is it up 40% from baseline? Flat for 3 months? Decelerating from +60%?
- SECOND DERIVATIVES are the real signal. If growth was +30% last period and +15% this period, growth is decelerating even though the number rises. This determines position timing.
- DIVERGENCES between signals are the highest-alpha intelligence. When hiring says one thing and developer activity says another, that gap reveals timing mismatches.
- INTELLECTUAL HONESTY: thin data gets flagged. Ambiguous signals get both interpretations. Never manufacture drama from noise.

SIGNAL TIMING KNOWLEDGE (use for predictions):
- Job Postings: Lead vendor revenue by 2-4 quarters (6-12 months). Hiring intent → procurement (1-2Q) → contract (1Q) → revenue (1Q). Title shifts from strategy→engineering roles compress this to 3-6 months.
- Google Trends: 1-4 weeks for volatility. 3-9 months for procurement impact. Spikes predict trading volume within 1-2 weeks. Sustained rises indicate pipeline building over 2 quarters.
- GitHub Repos: 6-18 months lead. OSS maturity → enterprise evaluation → procurement. Longest lead but highest structural conviction. Language shifts (Python→TypeScript) signal production readiness.
- Claude Code Attribution: 0-3 months. Most real-time signal. Directly reflects current AI tool adoption. Revenue impact for coding platforms is same-quarter. Compute demand impact within 1 quarter.
- Hugging Face Downloads: 3-12 months. Open-source model adoption leads enterprise deployment decisions. Download concentration shifts signal vendor market share changes 2-4 quarters ahead.
MACRO IN THE PAYLOAD (when macro_labor_context is present):
- Treat Chicago Fed / FRED as **national regime context**, usually **lagging or coincident** relative to hiring, search, repos, and Claude attribution. They explain *environment*, not a second headline score.
- Do **not** invent a unified "macro heat" or single composite index. Instead, name **specific pairs or triplets** of series (e.g. JOLTS vs. job-posting momentum; claims vs. Claude; sentiment vs. trends) and discuss **alignment or tension** with explicit uncertainty.
- A major part of your value is **correlation discovery**: patterns a human skimming charts would miss — especially **cross-domain** (micro demand signals ↔ macro; vertical A ↔ vertical B; level vs. momentum vs. second derivative).

MARKET CONTEXT (illustrative baseline — refresh with live facts when you have them):
- AI coding tools at 73% daily enterprise usage (up from 41% in 2025). Claude Code at 69% market share.
- S&P 500 Software Index RSI hit 18 — most oversold since 1990. SaaS stocks down 15-30% YTD despite 16.8% projected 2026 earnings growth.
- Enterprise IT spending growing 3.6% in 2026. AI capex doubling to $660-690B but hiring decoupled from spend.
- Only 37.4% of workers use generative AI on the job despite tool availability. 90% of AI job postings from just 1% of companies.

DESK RESEARCH & MACRO (this dashboard has no live web search — reason carefully from your knowledge):
- Anchor commentary to report_calendar.generated_at and the ISO week in the payload.
- Connect labor market themes (hiring freezes vs AI-skilled demand), rates/credit, mega-cap tech & AI capex, and enterprise software budget cycles to the DIRECTION and INFLECTION of each signal. Use explicit epistemic hygiene: label links as "consistent with," "plausible channel," or "speculative" — do not claim causation without evidence.
- If data_quality_flags mention simulated TheirStack jobs, say so once; still interpret momentum and divergences vs Google Trends, GitHub, and Claude attribution.

WRITING RULES:
- Plain prose. No corporate-speak ("it is worth noting," "interestingly," "moving forward" are banned).
- Every sentence must contain a number, comparison, rate of change, or forward-looking implication.
- Use precise language: "accelerating" = rate of increase increasing. "Surging" = >30%. "Plateauing" = <5%.
- Be specific about timeframes. "Over the last 3 observations" not "recently."`;

      const userPrompt = `═══════════════════════════════════════════════════════════════
WEEKLY AI DEMAND SIGNAL INTELLIGENCE — RAW DATA PAYLOAD
Week: ${ctx.week} | Generated: ${ctx.generated_at}
═══════════════════════════════════════════════════════════════

${JSON.stringify(ctx, null, 1)}

═══════════════════════════════════════════════════════════════
OUTPUT — USE THIS EXACT STRUCTURE
═══════════════════════════════════════════════════════════════

AI DEMAND SIGNAL WEEKLY INTELLIGENCE REPORT
Week of ${ctx.week}
Generated: ${ctx.generated_at} | ${ctx.total_verticals_tracked} verticals tracked

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

KEY TAKEAWAYS
(Exactly 5 bullets. Each ≤18 words. Each bullet must include at least one number, percent, or comparative.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VISUAL TREND STRIPS
For EVERY vertical, one line using Unicode blocks ▁▂▃▄▅▆▇█ only (no other chart libs):
- Build Jobs strip from theirstack_historical.recent_monthly[].count OR signals.job_postings.time_series.recent_values[].value
- Build Trends strip from signals.google_trends.time_series.recent_values[].value
Format: [Vertical] | Jobs: [strip] | Trends: [strip]
If a series has <2 points, write "insufficient points" instead of a strip.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MACRO & EXTERNAL CONTEXT (DESK RESEARCH — IMPLICATIONS, NOT HEADLINES)
Relative to generated_at / ISO week:
- If macro_labor_context includes chicago_fed / fred_headlines / chicago_recent_weeks: anchor **at least 2 bullets** to those **numbers** (levels or recent direction). Still label macro as **lagging/coincident** vs. your leading demand signals where relevant.
- LAST ~7 DAYS: 3 bullets — typical macro/tech narrative themes; each bullet ties to a specific metric in the payload and states a plausible transmission channel (e.g., "If credit spreads widened, job-posting velocity in X vertical could reflect…").
- LAST ~30 DAYS: 3 bullets — labor, rates expectations, enterprise IT / SaaS sentiment, AI capex narrative; each maps to at least one signal movement.
- BROADER ECONOMY: 3 bullets — unemployment / JOLTS style framing, productivity & automation debate, semiconductor–cloud–model vendor chain; explain how each could bias hiring vs search vs OSS activity.
Use "consistent with / plausible / speculative" language. Do not fabricate specific headline events or exact unemployment prints unless they are widely known for that period; prefer thematic framing.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CORRELATIONS & BLIND SPOTS (REQUIRED — THIS IS THE CORE VALUE)
The reader is not asking for a macro heat map. They want **insights they would not notice themselves**.

- Provide **exactly 4** items prefixed **NON-OBVIOUS:**. Each must **combine at least two distinct domains** from the payload (examples: vertical A jobs momentum + vertical B trends; JOLTS or claims + Claude commits; Chicago Fed nowcast trajectory + Google Trends; Hugging Face + payrolls; two second-derivatives that disagree).
- For each item: (1) the juxtaposition, (2) why a human skimming the dashboard would miss it, (3) a **testable** implication with **approximate timing** using the lead/lag framework, (4) one sentence on **what would falsify** the take.
- If macro_labor_context is empty or thin, still deliver 4 items using only vertical signals + cross_corr — and state that the macro snapshot was unavailable.
- Do **not** output a composite macro score or ranked heat index.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXECUTIVE SUMMARY
(3-4 sentences. The single most important development. What changed vs last week. One-sentence directional call sharp enough to open a Monday meeting.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REGIME DASHBOARD
(Table: [Vertical] | [REGIME: ACCELERATING/STEADY_GROWTH/PLATEAUING/DECELERATING/CONTRACTING/BOTTOMING/INFLECTING_UP] | Composite: [score] | Jobs: [count] ([pct]% chg) | Trends: [index] | Repos: [count] | Key driver)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NARRATIVE FLOW (READ ORDER)
One short paragraph explaining how a PM should read this memo top-to-bottom (what to skim vs what to read slowly).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SIGNAL MOVEMENT ANALYSIS
For each metric with meaningful movement:
- WHAT moved, by how much, in what vertical
- WHY it matters: use the timing knowledge above. Job postings +30% → vendor revenue inflection in 2-4Q. Claude attribution surging → compute demand THIS quarter. Google Trends spike → procurement pipeline building over next 2Q.
- CONFIDENCE: HIGH/MEDIUM/LOW

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DIVERGENCE ANALYSIS (HIGHEST ALPHA)
For each divergence between signals:
- THE GAP: Which signals disagree, magnitude
- THE INTERPRETATION: What adoption phase mismatch this reveals (e.g., "CIO mandate without developer adoption" = budget committed but tools not yet deployed; resolution: jobs lead, repos follow in 2-3 months)
- THE TRADE: Specific positioning this divergence suggests
- RESOLUTION TIMELINE: When and how will this resolve? Which signal is leading?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INVESTMENT PREDICTIONS (NEW — THIS IS THE KEY SECTION)
Make 3-5 specific, falsifiable predictions based on signal analysis. Be pragmatic and reasonable — ground every prediction in the data. Use the signal timing knowledge.

For each prediction:
- PREDICTION: A specific, testable claim about what will happen and when
- SUPPORTING EVIDENCE: Which signals point to this outcome, with specific numbers
- TIMING: When this should materialize (use the lead/lag framework — jobs lead revenue by 2-4Q, search leads procurement by 2-3Q, etc.)
- AFFECTED SECTORS/THEMES: Which areas of the market this impacts (AI infrastructure, cloud compute, professional services, SaaS platforms, semiconductor, etc.)
- CONFIDENCE: HIGH/MEDIUM/LOW with brief justification
- WHAT WOULD INVALIDATE: Specific data point that would reverse this prediction

Example predictions (use as format guide, not content):
- "Enterprise AI hiring in [vertical] will drive a procurement cycle reaching vendor revenue by Q3 2026, based on +30% WoW job posting growth sustained over 4 weeks and title mix shifting toward implementation roles."
- "Open-source model download concentration shifting from [provider A] to [provider B] on Hugging Face signals market share rotation that will appear in cloud provider earnings in 2-3 quarters."
- "The divergence between rising search interest and flat hiring in [vertical] will resolve bearishly — this is awareness without budget commitment, and search should decline within 8 weeks."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VERTICAL DEEP DIVES
(One paragraph per vertical: signal levels with context, momentum, divergences, forward view, key risk.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ACTIONABLE RECOMMENDATIONS
(5 recommendations ordered by conviction. Each must include: SIGNAL driving it, ACTION (be concrete — "increase exposure," "initiate position," "reduce allocation"), CONVICTION, TIMEFRAME, INVALIDATION trigger.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INTERPRETATION & IMPLICATIONS
For each major trend direction (up / flat / down) in jobs, trends, repos, and Claude attribution: state what it would imply for (1) near-term vendor revenue, (2) 2–4 quarter positioning, (3) tail risks if the trend reverses.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RISK FACTORS & CONTRARIAN VIEW
RISKS: What could make the AI demand picture misleading? Which conclusions rest on thin data?
CONTRARIAN TAKE: 2-3 sentences arguing against your own analysis. If bullish, what's the bear case? If bearish, where's the bull case?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DATA CONFIDENCE: Grade A/B/C/D. Flag stale or missing signals.`;


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
          max_tokens: 12000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Claude API ${res.status}: ${txt.slice(0, 180)}`);
      }
      const js = await res.json();
      const text = (js?.content || []).map(c => c?.text || "").join("\n").trim();
      if (!text) throw new Error("Claude returned empty content");
      const existing = ld(briefStorageKey(wk), null) || (()=>{try{return JSON.parse(localStorage.getItem(briefStorageKey(wk))||"null");}catch{return null;}})();
      const toStore = {
        generated_at: new Date().toISOString(),
        content_markdown: text,
        data_snapshot: ctx,
        first_content_markdown: existing?.first_content_markdown || existing?.content_markdown || text,
      };
      localStorage.setItem(briefStorageKey(wk), JSON.stringify(toStore));
      localStorage.setItem(BRIEF_LAST_KEY, toStore.generated_at);
      setBriefContent(text);
      setBriefBaseForDiff(toStore.first_content_markdown || text);
      setBriefSnapshot(ctx);
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
      const pat=resolveGitPat();if(pat)debouncedSyncToGist(pat,2000);
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
              {lastBriefObj?.content_markdown ? "Regenerate Brief" : "Generate Brief"}
            </Btn>
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

        <div style={{...font.sans,fontSize:12,color:C.textSec,lineHeight:1.55,marginBottom:16,padding:"12px 16px",background:C.white,border:`1px solid ${C.borderLight}`,borderRadius:12}}>
          <strong style={{color:C.text}}>Where your data lives:</strong> groups, history, and settings are stored in <strong>this browser</strong> (localStorage). Redeploying the app does not erase them unless you use a different URL, clear site data, or another device.
          {!resolveGitPat() && (
            <span> Add <code style={{fontSize:11}}>VITE_GITHUB_PAT</code> and use the cloud icons in the header to save and restore a backup (private GitHub Gist).</span>
          )}
          {resolveGitPat() && (
            <span> Your GitHub PAT is set — use cloud <strong>up</strong> after changes and cloud <strong>down</strong> on a new browser to restore.</span>
          )}
        </div>

        {/* ─── Settings (always visible, collapsed by default) ─── */}
        <div style={{marginBottom:20}}>
          <InlineSettings config={config} setConfig={setConfig} githubWatchlists={githubWatchlists} setGithubWatchlists={setGithubWatchlists} mailingList={mailingList} onUpdateMailingList={updateMailingList} onCloudSync={()=>{const pat=resolveGitPat();if(pat)debouncedSyncToGist(pat);}}/>
        </div>

        {/* ─── Empty state prompt ─── */}
        {config.verticals.length === 0 && (
          <Card className="fade-in" style={{padding:"28px 32px",marginBottom:20,textAlign:"center",background:`linear-gradient(135deg,${C.cyan}06,${C.blue}06)`}}>
            <IcoC name="trendUp" size={24} color={C.cyan}/>
            <div style={{...font.sans,fontSize:16,fontWeight:700,color:C.text,margin:"12px 0 6px"}}>Create your first tracking group to get started</div>
            <p style={{...font.sans,fontSize:12,color:C.textSec,margin:"0 0 16px",lineHeight:1.6,maxWidth:520,marginLeft:"auto",marginRight:"auto"}}>
              A tracking group is a vertical, theme, or sector you want to monitor — e.g. "Healthcare AI", "Autonomous Vehicles", "AI Coding Tools". Click the <strong>Instructions</strong> tab above for full details on what this tool tracks.
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
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {config.verticals.map(v=>(<Badge key={v.id} color={v.color||C.cyan} bg={(v.color||C.cyan)+"14"} size="sm">{v.name}</Badge>))}
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

        {/* Overlay chart */}
        {overlaySelected.length>=2 && <OverlayChart selectedKeys={overlaySelected} allHistories={allHistories} sources={config.sources} verticals={config.verticals}/>}

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
              />
            ))}
          </div>
        </div>

        <div style={{marginBottom:10}}>
          <div style={{...font.sans,fontSize:13,fontWeight:700,color:C.text}}>National context</div>
          <div style={{...font.sans,fontSize:11,color:C.textMuted,marginTop:4}}>US-wide labor indicators — not filtered by your keywords.</div>
        </div>
        <div style={{marginBottom:28}}>
          <LaborMacroPanel
            onAfterLoad={() => {
              const pat = resolveGitPat();
              if (pat) debouncedSyncToGist(pat, 4000);
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
          <HuggingFaceLeaderboard onDataChanged={()=>{const pat=resolveGitPat();if(pat)debouncedSyncToGist(pat,3000);}}/>
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
                onClick={()=>{setBriefWeek(b.week);setBriefContent(b.content_markdown||"");setBriefBaseForDiff(b.first_content_markdown||b.content_markdown||"");setBriefSnapshot(b.data_snapshot||null);setBriefOpen(true);setBriefHistoryOpen(false);}}>
                <div style={{fontSize:12,fontWeight:700,color:C.text}}>{b.week}</div>
                <div style={{fontSize:11,color:C.textMuted}}>{new Date(b.generated_at).toLocaleString()}</div>
              </div>
            ))}
            {!briefHistory.length && <div style={{fontSize:12,color:C.textMuted}}>No saved briefs yet.</div>}
          </div>
        </>
      )}

      {briefOpen && (
        <div style={{position:"fixed",inset:0,zIndex:230,background:"rgba(245,247,250,.97)",display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",borderBottom:`1px solid ${C.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:18,height:18,borderRadius:99,background:C.cyan,opacity:briefLoading?0.6:1,animation:briefLoading?"pulse 1.2s ease-in-out infinite":"none"}} />
              <div style={{fontSize:14,fontWeight:700}}>AI Demand Signal Weekly Brief</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <label style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:C.textSec}}><input type="checkbox" checked={briefDiffMode} onChange={e=>setBriefDiffMode(e.target.checked)} /> Show Changes</label>
              <Btn size="sm" onClick={()=>navigator.clipboard?.writeText(briefContent || "")}>Copy as Markdown</Btn>
              <Btn size="sm" onClick={()=>navigator.clipboard?.writeText((briefContent || "").replace(/[#*_`>-]/g,""))}>Copy as Plain Text</Btn>
              <Btn size="sm" variant={mailingList.length>0?"primary":"default"} disabled={emailSending||!briefContent} onClick={()=>sendReportEmail(briefContent,briefWeek,briefSnapshot)}>
                {emailSending ? <><Spinner size={11} color="#fff"/> Sending</> : <><IcoC name="mail" size={12} color={mailingList.length>0?"#fff":C.textSec}/> Email to Team ({mailingList.length})</>}
              </Btn>
              {emailStatus && <span style={{...font.sans,fontSize:11,color:emailStatus.startsWith("Failed")?C.red:emailStatus.startsWith("Sent")?C.green:C.textSec}}>{emailStatus}</span>}
              <Btn size="sm" onClick={()=>{
                const w = window.open("", "_blank");
                if (!w) return;
                w.document.write(briefEmailHtmlDocument(briefWeek, briefSnapshot, briefContent || "", briefDiffMode, briefBaseForDiff));
                w.document.close();
              }}>Open in New Tab</Btn>
              <Btn size="sm" variant="ghost" onClick={()=>setBriefOpen(false)}>Close</Btn>
            </div>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"22px 28px"}}>
            {briefLoading ? (
              <div style={{maxWidth:700,margin:"80px auto",textAlign:"center"}}>
                <div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Synthesizing signals...</div>
                <div style={{fontSize:12,color:C.textMuted,marginBottom:10}}>Estimated time: 10-15 seconds</div>
                <div style={{height:8,background:C.nested,borderRadius:999,overflow:"hidden",maxWidth:360,margin:"0 auto"}}>
                  <div style={{height:"100%",width:`${Math.min(100,Math.round((briefProgressSec/15)*100))}%`,background:C.cyan,transition:"width .5s"}} />
                </div>
              </div>
            ) : (
              <div style={{maxWidth:900,margin:"0 auto",background:C.white,border:`1px solid ${C.border}`,borderRadius:12,padding:"22px 26px"}}>
                <div style={{fontSize:12,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:700,color:C.textMuted,borderBottom:`1px solid ${C.border}`,paddingBottom:8,marginBottom:12}}>
                  AI Demand Signal Weekly Brief | {briefWeek}
                </div>
                <div style={{fontFamily:"Georgia, serif",fontSize:16,lineHeight:1.7,color:C.text}}>
                  {briefDiffMode ? (
                    <div dangerouslySetInnerHTML={{ __html: paragraphDiffHtml(briefBaseForDiff, briefContent) }} />
                  ) : (
                    <pre style={{whiteSpace:"pre-wrap",margin:0,fontFamily:"Georgia, serif"}}>{briefContent}</pre>
                  )}
                  {briefSnapshot ? <BriefSnapshotCharts ctx={briefSnapshot} /> : null}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
