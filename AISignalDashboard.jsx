// ══════════════════════════════════════════════════════════════════════════════
// SIGNAL INTELLIGENCE DASHBOARD v2
// History tracking, growth charts, overlay comparison, investment commentary
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const PFX = "sid_v2_";
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
    if (k === "config" && existing) return;
    const existingArr = existing ? JSON.parse(existing) : null;
    if (Array.isArray(v) && Array.isArray(existingArr)) {
      const merged = [...existingArr];
      const existingTs = new Set(existingArr.map(e => e.ts));
      v.forEach(entry => { if (!existingTs.has(entry.ts)) merged.push(entry); });
      merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      if (merged.length > 200) merged.splice(0, merged.length - 200);
      sv(k, merged);
    } else if (!existing) {
      sv(k, v);
    }
  });
}

async function syncToGist(pat) {
  if (!pat) return;
  const data = getAllData();
  const gistId = localStorage.getItem(GIST_ID_KEY);
  const body = { description: "Signal Intelligence Dashboard — persistent data store", public: false, files: { "signal-data.json": { content: JSON.stringify(data) } } };

  try {
    if (gistId) {
      await fetch(`https://api.github.com/gists/${gistId}`, { method: "PATCH", headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

function getSignalHistory(signalKey) { return ld(`hist_${signalKey}`, []); }
function appendSignalHistory(signalKey, value) {
  const h = getSignalHistory(signalKey);
  h.push({ ts: Date.now(), value, date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) });
  if (h.length > 200) h.splice(0, h.length - 200);
  sv(`hist_${signalKey}`, h);
  return h;
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

function timeAgo(ts) {
  if (!ts) return "Never"; const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "Just now"; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`;
}
function staleMs(cadence) { return cadence === "realtime" ? 30*60000 : cadence === "daily" ? 23*3600000 : 6*86400000; }
function cadenceToMs(cadence) { return cadence === "realtime" ? 5*60000 : cadence === "daily" ? 60*60000 : 6*3600000; }
function getCacheStats() { let c=0,s=0; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(PFX)){c++;s+=(localStorage.getItem(k)||"").length;}} return{count:c,sizeKB:Math.round(s/1024)}; }

// ── ENV KEYS ─────────────────────────────────────────────────────────────────

const ENV_KEYS = {
  theirstack: import.meta.env.VITE_THEIRSTACK_KEY || "",
  google_trends: import.meta.env.VITE_SERPAPI_KEY || "",
  github: import.meta.env.VITE_GITHUB_PAT || "",
};
function resolveKey(source, configKeys) {
  const gh = source.apiConfig.authType === "bearer" && source.apiConfig.endpoint.includes("github");
  const kid = gh ? "github" : source.id;
  return configKeys[kid] || ENV_KEYS[kid] || ENV_KEYS[source.id] || "";
}

// ── DEFAULT CONFIG ───────────────────────────────────────────────────────────

const DEFAULT_SOURCES = [
  { id: "theirstack", name: "TheirStack Jobs", type: "classified_text", weight: 0.4, cadence: "weekly", enabled: true,
    apiConfig: { endpoint: "https://api.theirstack.com/v1/jobs/search", method: "POST", authType: "bearer", authHeader: "", proxyPrefix: "",
      bodyTemplate: JSON.stringify({ page:0,limit:25,posted_at_max_age_days:30,job_title_or:"{{titleKeywords}}",job_description_pattern_or:"{{descriptionKeywords}}",job_country_code_or:["US"],order_by:[{desc:true,field:"date_posted"}],include_total_results:true },null,2) },
    responsePaths: { countPath: "metadata.total_results", itemsPath: "data", titleField: "job_title", bodyField: "short_description" } },
  { id: "google_trends", name: "Google Trends", type: "index", weight: 0.25, cadence: "weekly", enabled: true,
    apiConfig: { endpoint: "/serpapi/search.json", method: "GET", authType: "query_param", authHeader: "api_key", proxyPrefix: "", bodyTemplate: "engine=google_trends&data_type=TIMESERIES&q={{keywords}}" },
    responsePaths: { countPath: "", itemsPath: "interest_over_time.timeline_data", titleField: "", bodyField: "" } },
  { id: "github_repos", name: "GitHub Repos", type: "count", weight: 0.15, cadence: "weekly", enabled: true,
    apiConfig: { endpoint: "https://api.github.com/search/repositories", method: "GET", authType: "bearer", authHeader: "", proxyPrefix: "", bodyTemplate: "q={{keywords}}+pushed:>{{since30d}}&sort=updated&per_page=5" },
    responsePaths: { countPath: "total_count", itemsPath: "items", titleField: "full_name", bodyField: "description" } },
  { id: "claude_attrib", name: "Claude Code Attribution", type: "count", weight: 0.2, cadence: "weekly", enabled: true,
    apiConfig: { endpoint: "https://api.github.com/search/commits", method: "GET", authType: "bearer", authHeader: "", proxyPrefix: "", bodyTemplate: 'q="Co-Authored-By: Claude"+committer-date:>{{since7d}}&sort=committer-date&order=desc&per_page=1' },
    responsePaths: { countPath: "total_count", itemsPath: "items", titleField: "commit.message", bodyField: "" } },
];

const DEFAULT_VERTICALS = [
  { id: "vert1", name: "Your Vertical", color: C.cyan, description: "",
    keywords: {
      theirstack: { titleKeywords: ["AI engineer","machine learning"], descriptionKeywords: ["artificial intelligence","LLM"] },
      google_trends: { keywords: ["enterprise AI adoption","AI copilot"] },
      github_repos: { keywords: ["llm-agents","ai-orchestration"] },
      claude_attrib: { keywords: ["Co-Authored-By: Claude"] },
    } },
];

const DEFAULT_STAGES = [
  { id:"s1",name:"Exploration",color:C.blue,weight:1,titlePatterns:["strategy","innovation","ai lead","evaluating","exploring","research"],descriptionPatterns:["assess","evaluate","pilot program","proof of concept planning"] },
  { id:"s2",name:"Piloting",color:C.amber,weight:2,titlePatterns:["implement","poc","project manager ai","ai analyst","pilot","prototype"],descriptionPatterns:["proof of concept","testing","trial","initial deployment"] },
  { id:"s3",name:"Deploying",color:C.orange,weight:3,titlePatterns:["platform engineer","ai engineer","production","model validation","ml engineer","mlops","delivery"],descriptionPatterns:["production","scale","deploy","infrastructure","pipeline"] },
  { id:"s4",name:"Budget Live",color:C.red,weight:4,titlePatterns:["product owner","controls automation","gxp","soc automation","ai operations","specialist"],descriptionPatterns:["vendor","contract","procurement","budget","implementation partner"] },
];

const DEFAULT_STAGE_TAXONOMY = [
  { min:0,max:30,name:"Pain Threshold",color:C.textMuted,description:"12-18 months to budget" },
  { min:30,max:55,name:"Infrastructure Building",color:C.blue,description:"6-12 months to budget" },
  { min:55,max:75,name:"Competitive Pressure",color:C.amber,description:"3-6 months to budget" },
  { min:75,max:100,name:"Budget Committed",color:C.green,description:"0-3 months — DEPLOY COVERAGE" },
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

async function callSource(source, vertical, configKeys) {
  const cfg = source.apiConfig, vkw = vertical.keywords?.[source.id] || {};
  const since30d = new Date(Date.now()-30*86400000).toISOString().slice(0,10), since7d = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const tv = { ...vkw, since30d, since7d };
  if (vkw.keywords) tv.keywords = Array.isArray(vkw.keywords) ? vkw.keywords.join(",") : vkw.keywords;
  if (vkw.titleKeywords) tv.titleKeywords = vkw.titleKeywords;
  if (vkw.descriptionKeywords) tv.descriptionKeywords = vkw.descriptionKeywords;
  const filled = fillTemplate(cfg.bodyTemplate, tv);
  const ep = cfg.proxyPrefix ? cfg.proxyPrefix + cfg.endpoint : cfg.endpoint;
  const headers = { Accept: "application/json" };
  const key = resolveKey(source, configKeys);
  if (cfg.authType === "bearer" && key) headers.Authorization = `Bearer ${key}`;
  if (cfg.authType === "header" && cfg.authHeader && key) headers[cfg.authHeader] = key;
  let url = ep, body;
  if (cfg.method === "GET") { url = ep + (ep.includes("?")?"&":"?") + filled + (cfg.authType==="query_param" && key ? `&${cfg.authHeader||"api_key"}=${key}` : ""); }
  else { headers["Content-Type"] = "application/json"; body = filled; }
  const res = await fetch(url, { method: cfg.method, headers, body });
  if (res.status===401||res.status===403) throw new Error("Invalid API key");
  if (res.status===429) throw new Error("Rate limited");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── RESPONSE PARSERS ─────────────────────────────────────────────────────────

function parseSourceResponse(source, json) {
  if (source.id === "google_trends") { const tl=json.interest_over_time?.timeline_data||[]; const vals=tl.map(d=>d.values?.[0]?parseInt(d.values[0].extracted_value??d.values[0].value,10):0); const cur=vals.length>0?vals[vals.length-1]:0; const l4=vals.slice(-4); const avg=l4.length>0?Math.round(l4.reduce((a,b)=>a+b,0)/l4.length):0; const mom=avg>0?Math.round(((cur-avg)/avg)*100):0; return { count:cur, items:[{title:`Index: ${cur}/100`,body:`4wk avg: ${avg}, momentum: ${mom>0?"+":""}${mom}%`}], values:vals, momentum:mom }; }
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
    return { ...item, classification:{stageId:best.id,stageName:best.name,score:bs,matched:bs>0} };
  });
  let dom=stages[0],mx=0; Object.values(bk).forEach(b=>{if(b.count>mx){mx=b.count;dom=b.stage;}});
  const matched=staged.filter(i=>i.classification.matched).length;
  return { dominantStage:dom, confidence:Math.round((matched/items.length)*100), breakdown:bk, stagedItems:staged };
}

// ── COMPOSITE SCORING ────────────────────────────────────────────────────────

function computeComposite(vertId, sr, sources, stageMultipliers) {
  let tw=0,ws=0; const bk={};
  sources.filter(s=>s.enabled).forEach(src => {
    const res=sr[`${vertId}_${src.id}`]; if(!res) return;
    let n=0;
    if(src.type==="index") n=Math.min(res.count||0,100);
    else if(src.type==="count") n=Math.min(((res.count||0)/100)*100,100);
    else if(src.type==="classified_text"){const vn=Math.min(((res.count||0)/200)*100,100);const sm=stageMultipliers[res.classification?.dominantStage?.id]||1;n=Math.min(vn*sm,100);}
    bk[src.id]={source:src,score:Math.round(n),raw:res}; ws+=n*src.weight; tw+=src.weight;
  });
  return { score:Math.min(tw>0?Math.round(ws/tw):0,100), breakdown:bk };
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
  layers:"M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  pin:"M12 17v5M9 11l-6-2 9-6 9 6-6 2M9 11v4a3 3 0 0 0 6 0v-4",
  crosshair:"M22 12h-4M6 12H2M12 6V2M12 22v-4M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z",
  gitBranch:"M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9",
  database:"M12 2C6.48 2 2 4.02 2 6.5V17.5C2 19.98 6.48 22 12 22S22 19.98 22 17.5V6.5C22 4.02 17.52 2 12 2ZM2 6.5C2 8.98 6.48 11 12 11S22 8.98 22 6.5M2 12c0 2.48 4.48 4.5 10 4.5S22 14.48 22 12",
  pause:"M10 4H6v16h4V4ZM18 4h-4v16h4V4Z",
  play:"M5 3l14 9-14 9V3Z",
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

function MetricCard({icon,label,value,unit,sublabel,color,trend,onClick}){
  return(<div className="metric-card" onClick={onClick} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 20px",cursor:onClick?"pointer":"default",borderLeft:`4px solid ${color||C.cyan}`,boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
      <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:600,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.05em",...font.sans}}>{icon}{label}</div>
      {trend!=null&&<Badge color={trend>=0?C.green:C.red} bg={trend>=0?C.greenBg:C.redBg} size="sm">{trend>=0?"+":""}{trend}%</Badge>}
    </div>
    <div style={{...font.mono,fontSize:28,fontWeight:800,color:color||C.text,letterSpacing:"-0.03em",lineHeight:1}}>{value}{unit&&<span style={{fontSize:14,fontWeight:500,color:C.textMuted,marginLeft:4}}>{unit}</span>}</div>
    {sublabel&&<div style={{...font.sans,fontSize:11,color:C.textMuted,marginTop:6}}>{sublabel}</div>}
  </div>);
}

function GaugeSVG({value,size=90,color}){
  const cx=size/2,cy=size/2+5,r=size/2-10,s=Math.PI*.8,e=Math.PI*.2,tot=2*Math.PI-(s-e),va=s-(value/100)*tot;
  const arc=(a,b)=>{const x1=cx+r*Math.cos(a),y1=cy-r*Math.sin(a),x2=cx+r*Math.cos(b),y2=cy-r*Math.sin(b);return`M ${x1} ${y1} A ${r} ${r} 0 ${Math.abs(a-b)>Math.PI?1:0} ${a>b?1:0} ${x2} ${y2}`;};
  return <svg width={size} height={size-4} viewBox={`0 0 ${size} ${size-4}`}><path d={arc(s,e)} fill="none" stroke={C.border} strokeWidth={6} strokeLinecap="round"/><path d={arc(s,va)} fill="none" stroke={color||C.cyan} strokeWidth={6} strokeLinecap="round"/><text x={cx} y={cy-2} textAnchor="middle" fill={C.text} style={{...font.mono,fontSize:22,fontWeight:800}}>{value}</text><text x={cx} y={cy+13} textAnchor="middle" fill={C.textMuted} style={{...font.sans,fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em"}}>SCORE</text></svg>;
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
  },
  google_trends: {
    metric: "Google Trends interest index (0–100 scale, relative search volume)",
    how: "GET via SerpAPI google_trends engine — returns a normalized search interest score where 100 = peak popularity for that keyword in the selected time range. Momentum compares current value to the 4-week rolling average.",
    investment: "Search interest is a demand-side awareness proxy. Rising trends for specific AI tools or methodologies (e.g. 'AI copilot', 'RAG pipeline') signal enterprise decision-makers in active evaluation. Momentum > +15% suggests accelerating mindshare — procurement teams are researching. A divergence between high search trends and low job postings suggests 'tire-kicking' — awareness without budget commitment. Convergence of both rising = strong conviction signal for AI infrastructure vendors.",
  },
  github_repos: {
    metric: "Active GitHub repositories matching keywords (pushed in last 30 days)",
    how: "GET to GitHub Search API /search/repositories — filters by keyword and pushed:>30d ago. Measures active open-source development activity.",
    investment: "Open-source activity is a supply-side innovation proxy. Growing repo counts indicate an expanding developer ecosystem building tooling around a technology. This leads enterprise adoption by 6-18 months — enterprises build on mature OSS. Rapid growth (>50% increase) in repos for a specific framework signals it may become the dominant standard, making vendors built on that stack more defensible. Declining activity = consolidation phase, fewer new entrants, potential winner-take-most dynamics.",
  },
  claude_attrib: {
    metric: "GitHub commits with AI co-author signatures (last 7 days)",
    how: 'GET to GitHub Search API /search/commits — searches for "Co-Authored-By: Claude" in commit messages within the past 7 days.',
    investment: "AI-attributed commits are a direct measure of AI coding tool penetration into real development workflows. Growth here tracks the actual productization of AI assistants — not just interest, but daily usage. Accelerating attribution rates signal that AI coding tools are reaching 'default tool' status, which directly impacts: (1) developer productivity metrics in earnings calls, (2) seat expansion for AI coding platforms, (3) compute demand for inference at scale. This is the most concrete 'AI is being used' signal vs. 'AI is being talked about'.",
  },
};

// ── SIGNAL HISTORY CHART ─────────────────────────────────────────────────────

function SignalHistoryChart({ signalKey, color, label }) {
  const data = getSignalHistory(signalKey);
  if (data.length < 2) return <div style={{...font.sans,fontSize:12,color:C.textMuted,padding:"12px 0",textAlign:"center"}}>Chart appears after 2+ refreshes. Refresh signals to start collecting data points.</div>;
  return (
    <div style={{ width: "100%", height: 140 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top:8,right:16,bottom:8,left:8 }}>
          <XAxis dataKey="date" tick={{fontSize:10,fill:C.textMuted,...font.sans}} interval="preserveStartEnd" />
          <YAxis tick={{fontSize:10,fill:C.textMuted,...font.mono}} width={50} />
          <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}} labelStyle={{fontWeight:700}} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={{r:3,fill:C.white,stroke:color,strokeWidth:2}} activeDot={{r:5,fill:color}} name={label} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── OVERLAY COMPARISON CHART ─────────────────────────────────────────────────

function OverlayChart({ selectedKeys, allHistories, sources, verticals }) {
  if (selectedKeys.length === 0) return null;
  const merged = {};
  selectedKeys.forEach((sk) => {
    const hist = allHistories[sk] || [];
    hist.forEach(h => { const d = h.date; if (!merged[d]) merged[d] = { date: d }; merged[d][sk] = h.value; });
  });
  const data = Object.values(merged);
  const maxPerKey = {};
  selectedKeys.forEach(sk => { const hist = allHistories[sk] || []; maxPerKey[sk] = Math.max(1, ...hist.map(h => h.value)); });
  const normalized = data.map(d => { const n = { date: d.date }; selectedKeys.forEach(sk => { if (d[sk] != null) n[sk] = Math.round((d[sk] / maxPerKey[sk]) * 100); }); return n; });
  const labelFor = (sk) => { const [vId, sId] = sk.split("_"); const v = verticals.find(x => x.id === vId); const s = sources.find(x => x.id === sId); return `${v?.name||vId} · ${s?.name||sId}`; };

  return (
    <Card style={{ marginBottom: 20, borderLeft:`4px solid ${C.purple}` }}>
      <SectionHeader icon={<IcoC name="layers" size={18} color={C.purple}/>} title="Signal Overlay" subtitle="All signals normalized to 0–100 for comparison. Converging lines = strong multi-factor demand signal." badge={<Badge color={C.purple} bg={C.purpleBg}>{selectedKeys.length} signals</Badge>}/>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={normalized} margin={{ top:8,right:16,bottom:8,left:8 }}>
            <XAxis dataKey="date" tick={{fontSize:10,fill:C.textMuted}} interval="preserveStartEnd" />
            <YAxis tick={{fontSize:10,fill:C.textMuted}} width={35} domain={[0,100]} />
            <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}} />
            <Legend wrapperStyle={{fontSize:11,...font.sans}} />
            {selectedKeys.map((sk, i) => (
              <Line key={sk} type="monotone" dataKey={sk} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={{r:3}} name={labelFor(sk)} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── SIGNAL PANEL (redesigned) ────────────────────────────────────────────────

function SignalPanel({ source, verticals, signalResults, loading, errors, onFetch, onUpdateKeywords, overlaySelected, onToggleOverlay }) {
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
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <h3 style={{...font.sans,fontSize:16,fontWeight:700,color:C.text,margin:0,letterSpacing:"-0.02em"}}>{source.name}</h3>
                <Badge color={source.enabled?C.green:C.textMuted} bg={source.enabled?C.greenBg:C.nested} size="sm">{source.enabled?"Live":"Off"}</Badge>
                <Badge color={C.textMuted} size="sm">{source.cadence}</Badge>
              </div>
              {info&&<div style={{fontSize:12,color:C.textMuted,marginTop:3,maxWidth:500}}>{info.metric}</div>}
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
          <Expandable title={showInfo?"Hide methodology & investment implications":"Show methodology & investment implications"}>
            <div style={{padding:"10px 14px",background:C.white,borderRadius:10,border:`1px solid ${C.borderLight}`}}>
              <div style={{fontSize:12,color:C.textSec,lineHeight:1.6,marginBottom:8}}>{info.how}</div>
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
                   err ? <Badge color={C.red} bg={C.redBg} size="sm">{err.slice(0,15)}</Badge> :
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

                {/* Sparkline mini */}
                <div style={{flex:1,minWidth:80,maxWidth:200}}>
                  {hist.length>=2 ? (
                    <div style={{height:36}}>
                      <ResponsiveContainer><LineChart data={hist.slice(-10)} margin={{top:2,right:2,bottom:2,left:2}}>
                        <Line type="monotone" dataKey="value" stroke={v.color||C.cyan} strokeWidth={2} dot={false}/>
                      </LineChart></ResponsiveContainer>
                    </div>
                  ) : <div style={{height:36,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:10,color:C.textMuted}}>No history</span></div>}
                </div>

                {/* Actions */}
                <div style={{display:"flex",gap:4,flexShrink:0}} onClick={e=>e.stopPropagation()}>
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
                          {item.classification&&<span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:DEFAULT_STAGES.find(s=>s.name===item.classification.stageName)?.color||C.textMuted,marginTop:5,flexShrink:0}}/>}
                          <div style={{flex:1,minWidth:0}}><div style={{...font.sans,fontSize:13,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title}</div>{item.body&&<div style={{...font.sans,color:C.textMuted,fontSize:12,marginTop:2,lineHeight:1.4}}>{item.body.slice(0,180)}</div>}</div>
                          {item.classification?.matched&&<Badge color={DEFAULT_STAGES.find(s=>s.name===item.classification.stageName)?.color||C.textMuted} size="sm">{item.classification.stageName}</Badge>}
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

function HuggingFaceLeaderboard() {
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
    }catch(e){setErr(e.message);}
    setIsL(false);
  },[]);

  useEffect(()=>{if(!data||!data.timestamp||(Date.now()-data.timestamp)>6*3600000)doFetch();},[]);

  const orgs=data?.orgs||[]; const maxDl=orgs.length>0?Math.max(...orgs.map(o=>o.totalDownloads)):1;
  const top3=orgs.slice(0,3);

  return (
    <Card style={{padding:0,overflow:"hidden"}} className="fade-in-slow">
      <div style={{padding:"18px 22px 14px",background:C.white}}>
        <SectionHeader icon={<IcoC name="database" size={18} color={C.blue}/>} title="Hugging Face Leaderboard" subtitle="Open-source model adoption across major AI companies. Download volume = developer ecosystem gravity."
          badge={<Badge color={C.green} bg={C.greenBg} size="sm">Public API</Badge>}
          right={<>
            {data?.timestamp&&<span style={{...font.sans,fontSize:11,color:C.textMuted}}>{timeAgo(data.timestamp)}</span>}
            <Btn variant={showHist?"primary":"ghost"} size="sm" onClick={()=>setShowHist(!showHist)}><IcoC name="barChart" size={13} color={showHist?"#fff":C.textSec}/> Trend</Btn>
            <Btn variant="primary" size="sm" onClick={doFetch} disabled={isL}>{isL?<><Spinner size={12} color="#fff"/> Fetching</>:"Refresh"}</Btn>
          </>}
        />

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
          <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>Download Growth Over Time</div>
          <div style={{width:"100%",height:200}}>
            <ResponsiveContainer>
              <LineChart data={hfHist} margin={{top:8,right:16,bottom:8,left:8}}>
                <XAxis dataKey="date" tick={{fontSize:10,fill:C.textMuted}} interval="preserveStartEnd"/>
                <YAxis tick={{fontSize:10,fill:C.textMuted,...font.mono}} width={55} tickFormatter={fmtDL}/>
                <Tooltip contentStyle={{...font.sans,fontSize:12,background:C.white,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 4px 12px rgba(0,0,0,.08)"}} formatter={v=>fmtDL(v)}/>
                <Legend wrapperStyle={{fontSize:10,...font.sans}}/>
                {HF_ORGS.map(org=>(<Line key={org.id} type="monotone" dataKey={org.id} stroke={org.color} strokeWidth={2} dot={false} name={org.name} connectNulls/>))}
              </LineChart>
            </ResponsiveContainer>
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

// ── COMPOSITE CARDS (redesigned) ─────────────────────────────────────────────

function CompositeCards({verticals,composites,stageTaxonomy}){
  return(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
    {verticals.map(v=>{
      const comp=composites[v.id]||{score:0,breakdown:{}};const stage=resolveStage(comp.score,stageTaxonomy);
      const isHot=stage.index>=stageTaxonomy.length-1;
      return(<Card key={v.id} className={`metric-card ${isHot?"glow":""}`} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,borderTop:`4px solid ${v.color||C.cyan}`,borderColor:isHot?stage.color:undefined}}>
        <div style={{display:"flex",justifyContent:"space-between",width:"100%",alignItems:"center"}}>
          <span style={{...font.sans,fontSize:15,fontWeight:700,color:C.text}}>{v.name}</span>
          <Badge color={stage.color} bg={stage.color+"18"} size="lg">{stage.name}</Badge>
        </div>
        <GaugeSVG value={comp.score} size={90} color={v.color||C.cyan}/>
        <div style={{...font.sans,fontSize:12,color:C.textMuted,textAlign:"center",lineHeight:1.4}}>{stage.description}</div>
        <div style={{width:"100%",marginTop:4}}>{Object.entries(comp.breakdown).map(([sid,b])=>(<div key={sid} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
          <span style={{...font.sans,fontSize:11,fontWeight:600,color:C.textMuted,width:90,textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.source.name}</span>
          <div style={{flex:1,height:5,background:C.nested,borderRadius:3,overflow:"hidden"}}><div style={{width:`${b.score}%`,height:"100%",background:v.color||C.cyan,borderRadius:3,transition:"width .4s ease"}}/></div>
          <span style={{...font.mono,fontSize:11,fontWeight:700,color:C.text,width:28,textAlign:"right"}}>{b.score}</span>
        </div>))}</div>
      </Card>);
    })}
  </div>);
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

// ── INLINE SETTINGS ──────────────────────────────────────────────────────────

function InlineSettings({config,setConfig}){
  const[section,setSection]=useState(null);
  const update=fn=>setConfig(prev=>{const next=fn(prev);sv("config",next);return next;});

  const apiKeysContent=(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:12}}>
    {config.sources.map(src=>{
      const kid=src.apiConfig.authType==="bearer"&&src.apiConfig.endpoint.includes("github")?"github":src.id;
      const ek=ENV_KEYS[kid]||ENV_KEYS[src.id]||"";const he=!!ek;const ho=!!(config.apiKeys[kid]);
      return(<div key={src.id}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <label style={{...font.sans,fontSize:12,fontWeight:600,color:C.text}}>{src.name}</label>
          {he&&<Badge color={C.green} bg={C.greenBg} size="sm">Connected</Badge>}
          {!he&&!ho&&<Badge color={C.textMuted} size="sm">Not set</Badge>}
        </div>
        <input type="password" value={config.apiKeys[kid]||""} onChange={e=>update(c=>({...c,apiKeys:{...c.apiKeys,[kid]:e.target.value}}))} style={{width:"100%",fontSize:12}} placeholder={he?"Using .env":"Paste key…"}/>
      </div>);
    })}
  </div>);

  const groupsContent=(<div>
    {config.verticals.map((v,vi)=>(<div key={v.id} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
      <input type="color" value={v.color||"#0284c7"} onChange={e=>update(c=>{const vs=[...c.verticals];vs[vi]={...vs[vi],color:e.target.value};return{...c,verticals:vs};})} style={{width:28,height:28,padding:1,border:`1px solid ${C.border}`,borderRadius:6,cursor:"pointer"}}/>
      <input value={v.name} onChange={e=>update(c=>{const vs=[...c.verticals];vs[vi]={...vs[vi],name:e.target.value};return{...c,verticals:vs};})} style={{flex:1,fontSize:13,fontWeight:600}}/>
      <Btn variant="ghost" size="sm" onClick={()=>{if(confirm(`Remove "${v.name}"?`))update(c=>({...c,verticals:c.verticals.filter((_,i)=>i!==vi)}));}}>✕</Btn>
    </div>))}
    <Btn variant="default" size="sm" onClick={()=>update(c=>({...c,verticals:[...c.verticals,{id:`v_${Date.now()}`,name:"New Group",color:PALETTE[c.verticals.length%PALETTE.length],description:"",keywords:{theirstack:{titleKeywords:[],descriptionKeywords:[]},google_trends:{keywords:[]},github_repos:{keywords:[]},claude_attrib:{keywords:[]}}}]}))}>+ Add group</Btn>
  </div>);

  const dataContent=(<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
    <span style={{...font.sans,fontSize:12,color:C.textMuted}}>{getCacheStats().count} entries / {getCacheStats().sizeKB} KB</span>
    <Btn size="sm" onClick={()=>{const b=new Blob([JSON.stringify(config,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="config.json";a.click();}}>Export</Btn>
    <Btn size="sm" onClick={()=>{const inp=document.createElement("input");inp.type="file";inp.accept=".json";inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const c=JSON.parse(ev.target.result);setConfig(c);sv("config",c);}catch{}};r.readAsText(f);};inp.click();}}>Import</Btn>
    <Btn size="sm" variant="danger" onClick={()=>{if(confirm("Clear all cached signal data?")){const keys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(PFX)&&k!==PFX+"config")keys.push(k);}keys.forEach(k=>localStorage.removeItem(k));}}}>Clear cache</Btn>
  </div>);

  const advancedContent=(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
    <div>
      <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>Classification Stages</div>
      {config.stages.map((stg,si)=>(<div key={stg.id} style={{display:"flex",gap:6,marginBottom:6,alignItems:"center"}}>
        <input type="color" value={stg.color} onChange={e=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],color:e.target.value};return{...c,stages:ss};})} style={{width:24,height:24,padding:1,border:`1px solid ${C.border}`,borderRadius:4}}/>
        <input value={stg.name} onChange={e=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],name:e.target.value};return{...c,stages:ss};})} style={{flex:1,fontSize:12}}/>
        <input type="number" value={stg.weight} onChange={e=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],weight:parseFloat(e.target.value)||0};return{...c,stages:ss};})} style={{width:44,fontSize:12}} title="Weight"/>
      </div>))}
    </div>
    <div>
      <div style={{...font.sans,fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>Score Thresholds</div>
      {config.stageTaxonomy.map((t,ti)=>(<div key={ti} style={{display:"flex",gap:6,marginBottom:6,alignItems:"center"}}>
        <input type="number" value={t.min} onChange={e=>update(c=>{const st=[...c.stageTaxonomy];st[ti]={...st[ti],min:parseInt(e.target.value)||0};return{...c,stageTaxonomy:st};})} style={{width:40,fontSize:12}}/>
        <span style={{color:C.textMuted,fontSize:11}}>–</span>
        <input type="number" value={t.max} onChange={e=>update(c=>{const st=[...c.stageTaxonomy];st[ti]={...st[ti],max:parseInt(e.target.value)||0};return{...c,stageTaxonomy:st};})} style={{width:40,fontSize:12}}/>
        <input value={t.name} onChange={e=>update(c=>{const st=[...c.stageTaxonomy];st[ti]={...st[ti],name:e.target.value};return{...c,stageTaxonomy:st};})} style={{flex:1,fontSize:12}}/>
      </div>))}
    </div>
  </div>);

  const items=[
    {id:"keys",label:"API Keys",content:apiKeysContent},
    {id:"groups",label:"Signal Groups",content:groupsContent},
    {id:"advanced",label:"Scoring & Classification",content:advancedContent},
    {id:"data",label:"Data",content:dataContent},
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
  const addRef=useRef(null);
  const configRef=useRef(config);const srRef=useRef(signalResults);const ldRef=useRef(loading);
  useEffect(()=>{configRef.current=config;},[config]);
  useEffect(()=>{srRef.current=signalResults;},[signalResults]);
  useEffect(()=>{ldRef.current=loading;},[loading]);
  useEffect(()=>{sv("config",config);},[config]);
  useEffect(()=>{if(addingGroup&&addRef.current)addRef.current.focus();},[addingGroup]);

  const hasKeys=useMemo(()=>config.sources.some(src=>resolveKey(src,config.apiKeys)),[config]);
  const [cloudStatus,setCloudStatus]=useState("idle");
  const lastSyncRef=useRef(0);

  const resolveGitPat=useCallback(()=>{
    const fromCfg=config.apiKeys?.github;
    if(fromCfg)return fromCfg;
    try{return import.meta.env.VITE_GITHUB_PAT||"";}catch{return "";}
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

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const pat=resolveGitPat();
      if(pat){setCloudStatus("loading…");try{await syncFromGist(pat);if(!cancelled)setConfig(ld("config",buildDefaultConfig()));}catch{}if(!cancelled){setCloudStatus("idle");lastSyncRef.current=Date.now();}}
      const cached={};const cfg=ld("config",buildDefaultConfig());
      (cfg.verticals||[]).forEach(v=>{(cfg.sources||[]).forEach(src=>{
        const key=`${v.id}_${src.id}`;
        const h=getSignalHistory(key);
        if(h.length>0){cached[key]={count:h[h.length-1].value,items:[],timestamp:h[h.length-1].ts};if(!cancelled)setAllHistories(p=>({...p,[key]:h}));}
      });});
      if(!cancelled&&Object.keys(cached).length>0)setSignalResults(cached);
    })();
    return()=>{cancelled=true;};
  },[]);

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
        const result={...parsed,classification};
        setSignalResults(p=>({...p,[key]:result}));
        const h=appendSignalHistory(key,result.count||0);
        setAllHistories(p=>({...p,[key]:h}));
      }catch(e){setErrors(p=>({...p,[key]:e.message}));}
      setLoading(p=>({...p,[key]:false}));await sleep(300);
    }
    setLoading(p=>({...p,[sourceId]:false}));
    if(Date.now()-lastSyncRef.current>30000){const pat=resolveGitPat();if(pat){syncToGist(pat).catch(()=>{});lastSyncRef.current=Date.now();}}
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

  useEffect(()=>{
    if(!schedulerActive||!hasKeys)return;
    const fetchIfStale=async source=>{if(ldRef.current[source.id])return;const cfg=configRef.current;for(const v of cfg.verticals){const h=getSignalHistory(`${v.id}_${source.id}`);const last=h.length>0?h[h.length-1].ts:0;if(!last||(Date.now()-last)>staleMs(source.cadence)){await fetchSource(source.id);return;}}};
    const init=async()=>{const cfg=configRef.current;for(const src of cfg.sources.filter(s=>s.enabled&&resolveKey(s,cfg.apiKeys))){await fetchIfStale(src);await sleep(500);}};
    init();
    const timers={};const cfg=configRef.current;
    cfg.sources.filter(s=>s.enabled).forEach(src=>{const ms=cadenceToMs(src.cadence);setNextRefresh(p=>({...p,[src.id]:Date.now()+ms}));timers[src.id]=setInterval(()=>{fetchIfStale(src);setNextRefresh(p=>({...p,[src.id]:Date.now()+ms}));},ms);});
    return()=>Object.values(timers).forEach(clearInterval);
  },[schedulerActive,hasKeys,fetchSource]);

  const[,tick]=useState(0);useEffect(()=>{const t=setInterval(()=>tick(n=>n+1),10000);return()=>clearInterval(t);},[]);

  const composites=useMemo(()=>{const o={};config.verticals.forEach(v=>{o[v.id]=computeComposite(v.id,signalResults,config.sources,config.stageMultipliers);});return o;},[signalResults,config]);
  const anyLoading=Object.values(loading).some(Boolean);
  const hasData=Object.keys(signalResults).length>0;

  const summaryMetrics=useMemo(()=>{
    const m={jobs:0,trends:0,repos:0,claude:0};
    Object.entries(signalResults).forEach(([k,v])=>{
      if(k.includes("theirstack"))m.jobs+=(v.count||0);
      if(k.includes("google_trends"))m.trends=Math.max(m.trends,v.count||0);
      if(k.includes("github_repos"))m.repos+=(v.count||0);
      if(k.includes("claude_attrib"))m.claude+=(v.count||0);
    });
    return m;
  },[signalResults]);

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

        {/* ─── Settings (always visible, collapsed by default) ─── */}
        <div style={{marginBottom:20}}>
          <InlineSettings config={config} setConfig={setConfig}/>
        </div>

        {/* ─── Summary metrics ─── */}
        {hasData&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,marginBottom:24}} className="fade-in">
            <MetricCard icon={<IcoC name="briefcase" size={13} color={C.cyan}/>} label="Job Postings" value={summaryMetrics.jobs.toLocaleString()} sublabel="Matching positions (30d)" color={C.cyan}/>
            <MetricCard icon={<IcoC name="trendUp" size={13} color={C.blue}/>} label="Search Interest" value={summaryMetrics.trends} unit="/100" sublabel="Google Trends index" color={C.blue}/>
            <MetricCard icon={<IcoC name="code" size={13} color={C.green}/>} label="Active Repos" value={summaryMetrics.repos.toLocaleString()} sublabel="GitHub repos (30d push)" color={C.green}/>
            <MetricCard icon={<IcoC name="bot" size={13} color={C.purple}/>} label="AI Commits" value={summaryMetrics.claude.toLocaleString()} sublabel="Claude-attributed (7d)" color={C.purple}/>
          </div>
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

        {/* ─── Signal Sources ─── */}
        <div style={{marginBottom:28}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {config.sources.filter(s=>s.enabled).map(src=>(<SignalPanel key={src.id} source={src} verticals={config.verticals} signalResults={signalResults} loading={loading} errors={errors} onFetch={fetchSource} onUpdateKeywords={updateKeywords} overlaySelected={overlaySelected} onToggleOverlay={toggleOverlay}/>))}
          </div>
        </div>

        {/* ─── Hugging Face ─── */}
        <div style={{marginBottom:28}}>
          <HuggingFaceLeaderboard/>
        </div>

        {/* ─── Pipeline Pressure ─── */}
        <div style={{marginBottom:28}}>
          <CompositeCards verticals={config.verticals} composites={composites} stageTaxonomy={config.stageTaxonomy}/>
        </div>

        {/* ─── Alerts ─── */}
        {alerts.length>0&&(
          <div style={{marginBottom:28}}>
            <AlertFeed alerts={alerts} onPin={id=>setAlerts(p=>p.map(a=>a.id===id?{...a,pinned:!a.pinned}:a))}/>
          </div>
        )}
      </div>
    </div>
  );
}
