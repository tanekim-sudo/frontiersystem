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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}body{background:${C.bg};color:${C.text}}
@keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(15,123,85,0)}50%{box-shadow:0 0 0 4px rgba(15,123,85,.12)}}
.fade-in{animation:fadeIn .2s ease}.glow{animation:glow 2s ease-in-out infinite}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
input,textarea,select{background:${C.white};border:1px solid ${C.border};color:${C.text};font-family:'Inter',sans-serif;font-size:13px;padding:7px 10px;border-radius:6px;outline:none;transition:border-color .15s}
input:focus,textarea:focus{border-color:${C.cyan};box-shadow:0 0 0 3px ${C.cyanBg}}
textarea{font-family:'JetBrains Mono',monospace;font-size:12px;resize:vertical}table{border-collapse:collapse;width:100%}
.recharts-cartesian-grid-horizontal line,.recharts-cartesian-grid-vertical line{stroke:${C.borderLight}}
`;

// ── UI PRIMITIVES ────────────────────────────────────────────────────────────

function Btn({children,onClick,disabled,variant="default",style:sx,...r}){
  const base={...font.sans,fontSize:13,fontWeight:500,padding:"7px 14px",borderRadius:7,cursor:disabled?"not-allowed":"pointer",border:"1px solid",transition:"all .15s",display:"inline-flex",alignItems:"center",gap:6,opacity:disabled?.45:1};
  const vs={default:{background:C.white,borderColor:C.border,color:C.text},primary:{background:C.cyan,borderColor:C.cyan,color:"#fff"},ghost:{background:"transparent",borderColor:"transparent",color:C.textSec},danger:{background:C.white,borderColor:"#fca5a5",color:C.red}};
  return <button onClick={onClick} disabled={disabled} style={{...base,...vs[variant],...sx}} {...r}>{children}</button>;
}
function Badge({children,color=C.textSec,bg}){ return <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 9px",borderRadius:999,fontSize:11,fontWeight:600,...font.sans,background:bg||color+"14",color,whiteSpace:"nowrap"}}>{children}</span>; }
function Spinner({size=14,color:cl=C.cyan}){ return <svg width={size} height={size} viewBox="0 0 24 24" style={{animation:"spin .7s linear infinite"}}><circle cx="12" cy="12" r="10" fill="none" stroke={C.border} strokeWidth="3"/><path d="M12 2 a10 10 0 0 1 10 10" fill="none" stroke={cl} strokeWidth="3" strokeLinecap="round"/></svg>; }
function Card({children,style:sx,className}){ return <div className={className} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:10,padding:18,...sx}}>{children}</div>; }

function GaugeSVG({value,size=80,color}){
  const cx=size/2,cy=size/2+5,r=size/2-8,s=Math.PI*.8,e=Math.PI*.2,tot=2*Math.PI-(s-e),va=s-(value/100)*tot;
  const arc=(a,b)=>{const x1=cx+r*Math.cos(a),y1=cy-r*Math.sin(a),x2=cx+r*Math.cos(b),y2=cy-r*Math.sin(b);return`M ${x1} ${y1} A ${r} ${r} 0 ${Math.abs(a-b)>Math.PI?1:0} ${a>b?1:0} ${x2} ${y2}`;};
  return <svg width={size} height={size-4} viewBox={`0 0 ${size} ${size-4}`}><path d={arc(s,e)} fill="none" stroke={C.border} strokeWidth={5} strokeLinecap="round"/><path d={arc(s,va)} fill="none" stroke={color||C.cyan} strokeWidth={5} strokeLinecap="round"/><text x={cx} y={cy-1} textAnchor="middle" fill={C.text} style={{...font.mono,fontSize:18,fontWeight:700}}>{value}</text><text x={cx} y={cy+12} textAnchor="middle" fill={C.textMuted} style={{...font.sans,fontSize:7.5,fontWeight:600}}>SCORE</text></svg>;
}

function ChipEditor({items,onChange,color=C.textMuted,placeholder="Add…"}){
  const[adding,setAdding]=useState(false);const[text,setText]=useState("");const ref=useRef(null);
  useEffect(()=>{if(adding&&ref.current)ref.current.focus();},[adding]);
  return(<div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center"}}>
    {items.map((item,i)=>(<EditableChip key={`${item}-${i}`} value={item} onEdit={v=>{const n=[...items];n[i]=v;onChange(n);}} onRemove={()=>onChange(items.filter((_,j)=>j!==i))}/>))}
    {adding?(<input ref={ref} value={text} onChange={e=>setText(e.target.value)} placeholder={placeholder} onKeyDown={e=>{if(e.key==="Enter"&&text.trim()){onChange([...items,text.trim()]);setText("");setAdding(false);}if(e.key==="Escape"){setAdding(false);setText("");}}} onBlur={()=>{setAdding(false);setText("");}} style={{width:120,fontSize:12,padding:"3px 8px"}}/>):(<Btn variant="ghost" onClick={()=>setAdding(true)} style={{fontSize:11,padding:"2px 8px",color}}>+</Btn>)}
  </div>);
}
function EditableChip({value,onEdit,onRemove}){
  const[editing,setEditing]=useState(false);const[text,setText]=useState(value);const ref=useRef(null);
  useEffect(()=>{if(editing&&ref.current)ref.current.focus();},[editing]);
  if(editing)return <input ref={ref} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&text.trim()){onEdit(text.trim());setEditing(false);}if(e.key==="Escape"){setText(value);setEditing(false);}}} onBlur={()=>{setText(value);setEditing(false);}} style={{width:Math.max(60,text.length*7+16),fontSize:12,padding:"3px 8px"}}/>;
  return(<span style={{display:"inline-flex",alignItems:"center",gap:3,background:C.nested,border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 6px 3px 10px",fontSize:12,color:C.textSec,cursor:"pointer",...font.sans}}><span onClick={()=>setEditing(true)}>{value}</span><span onClick={e=>{e.stopPropagation();onRemove();}} style={{cursor:"pointer",color:C.textMuted,fontSize:14,lineHeight:1}}>×</span></span>);
}
function TabBar({tabs,active,onChange}){
  return(<div style={{display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,marginBottom:16}}>{tabs.map(t=>(<button key={t.id} onClick={()=>onChange(t.id)} style={{...font.sans,fontSize:12,fontWeight:500,padding:"10px 16px",cursor:"pointer",background:"transparent",border:"none",borderBottom:active===t.id?`2px solid ${C.cyan}`:"2px solid transparent",color:active===t.id?C.cyan:C.textSec,transition:"all .15s"}}>{t.label}</button>))}</div>);
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
  if (data.length < 2) return <div style={{...font.sans,fontSize:11,color:C.textMuted,padding:"8px 0"}}>Chart appears after 2+ data points. Refresh to collect data.</div>;
  return (
    <div style={{ width: "100%", height: 120 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top:5,right:10,bottom:5,left:10 }}>
          <XAxis dataKey="date" tick={{fontSize:9,fill:C.textMuted}} interval="preserveStartEnd" />
          <YAxis tick={{fontSize:9,fill:C.textMuted}} width={45} />
          <Tooltip contentStyle={{...font.sans,fontSize:11,background:C.white,border:`1px solid ${C.border}`,borderRadius:6}} labelStyle={{fontWeight:600}} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{r:2,fill:color}} name={label} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── OVERLAY COMPARISON CHART ─────────────────────────────────────────────────

function OverlayChart({ selectedKeys, allHistories, sources, verticals }) {
  if (selectedKeys.length === 0) return null;

  const merged = {};
  selectedKeys.forEach((sk, idx) => {
    const hist = allHistories[sk] || [];
    hist.forEach(h => {
      const d = h.date;
      if (!merged[d]) merged[d] = { date: d };
      merged[d][sk] = h.value;
    });
  });
  const data = Object.values(merged).sort((a,b) => Object.keys(merged).indexOf(Object.keys(merged).find(k => merged[k] === a)) - Object.keys(merged).indexOf(Object.keys(merged).find(k => merged[k] === b)));

  const maxPerKey = {};
  selectedKeys.forEach(sk => {
    const hist = allHistories[sk] || [];
    maxPerKey[sk] = Math.max(1, ...hist.map(h => h.value));
  });
  const normalized = data.map(d => {
    const n = { date: d.date };
    selectedKeys.forEach(sk => { if (d[sk] != null) n[sk] = Math.round((d[sk] / maxPerKey[sk]) * 100); });
    return n;
  });

  const labelFor = (sk) => {
    const [vId, sId] = sk.split("_");
    const v = verticals.find(x => x.id === vId);
    const s = sources.find(x => x.id === sId);
    return `${v?.name||vId} · ${s?.name||sId}`;
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{...font.sans,fontSize:14,fontWeight:600,marginBottom:4}}>Signal Overlay Comparison</div>
      <div style={{fontSize:11,color:C.textMuted,marginBottom:8}}>All signals normalized to 0–100 scale for comparison. Rising together = convergence (strong signal). Diverging = mixed demand picture.</div>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <LineChart data={normalized} margin={{ top:5,right:10,bottom:5,left:10 }}>
            <XAxis dataKey="date" tick={{fontSize:9,fill:C.textMuted}} interval="preserveStartEnd" />
            <YAxis tick={{fontSize:9,fill:C.textMuted}} width={30} domain={[0,100]} />
            <Tooltip contentStyle={{...font.sans,fontSize:11,background:C.white,border:`1px solid ${C.border}`,borderRadius:6}} />
            <Legend wrapperStyle={{fontSize:10}} />
            {selectedKeys.map((sk, i) => (
              <Line key={sk} type="monotone" dataKey={sk} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{r:2}} name={labelFor(sk)} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── SIGNAL PANEL ─────────────────────────────────────────────────────────────

function SignalPanel({ source, verticals, signalResults, loading, errors, onFetch, onUpdateKeywords, overlaySelected, onToggleOverlay }) {
  const [expanded, setExpanded] = useState(null);
  const [showChart, setShowChart] = useState(null);
  const kwLabel = { titleKeywords:"Title", descriptionKeywords:"Desc", keywords:"Query" };
  const info = SOURCE_INFO[source.id];

  return (
    <Card style={{ padding:0, overflow:"hidden" }}>
      <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}`, background:C.nested }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{...font.sans,fontSize:14,fontWeight:600,color:C.text}}>{source.name}</span>
            <Badge color={source.enabled?C.green:C.textMuted} bg={source.enabled?C.greenBg:C.nested}>{source.enabled?"Enabled":"Disabled"}</Badge>
            <Badge color={C.textMuted}>{source.cadence}</Badge>
          </div>
          <Btn variant="primary" onClick={()=>onFetch(source.id)} disabled={!source.enabled||Object.values(loading).some(Boolean)} style={{fontSize:11,padding:"5px 10px"}}>
            {loading[source.id]?<><Spinner size={11} color="#fff"/> Fetching…</>:"Fetch All"}
          </Btn>
        </div>
        {info && (
          <div style={{ marginTop:8, padding:"8px 10px", background:C.white, borderRadius:6, border:`1px solid ${C.borderLight}` }}>
            <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:2}}>{info.metric}</div>
            <div style={{fontSize:11,color:C.textMuted,lineHeight:1.5,marginBottom:4}}>{info.how}</div>
            <div style={{fontSize:11,color:C.amber,lineHeight:1.5,borderTop:`1px solid ${C.borderLight}`,paddingTop:4,marginTop:2}}>
              <span style={{fontWeight:600}}>Investment implication: </span>{info.investment}
            </div>
          </div>
        )}
      </div>
      <table><thead><tr style={{background:C.white}}>
        {["","Vertical","Keywords","Value","Stage","Status",""].map((h,i)=>(
          <th key={i} style={{...font.sans,fontSize:10,fontWeight:600,color:C.textMuted,textTransform:"uppercase",letterSpacing:.5,padding:"8px 12px",textAlign:i>=3&&i<=5?"center":"left",borderBottom:`1px solid ${C.border}`,width:i===0?28:undefined}}>{h}</th>
        ))}
      </tr></thead>
      <tbody>
        {verticals.map(v => {
          const key=`${v.id}_${source.id}`, res=signalResults[key], err=errors[key], isL=loading[key], kw=v.keywords?.[source.id]||{};
          const isExp=expanded===v.id, isChart=showChart===v.id;
          const isOverlay = overlaySelected.includes(key);
          return (
            <React.Fragment key={v.id}>
              <tr style={{borderBottom:`1px solid ${C.borderLight}`}} onMouseEnter={e=>e.currentTarget.style.background=C.nested} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"10px 6px 10px 12px",verticalAlign:"top"}}>
                  <input type="checkbox" checked={isOverlay} onChange={()=>onToggleOverlay(key)} title="Add to overlay comparison" style={{cursor:"pointer",accentColor:C.cyan}} />
                </td>
                <td style={{padding:"10px 6px",fontSize:13,fontWeight:500,color:C.text,verticalAlign:"top",width:120,cursor:"pointer"}} onClick={()=>setExpanded(isExp?null:v.id)}>
                  <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:v.color||C.cyan,marginRight:8,verticalAlign:"middle"}}/>{v.name}
                </td>
                <td style={{padding:"8px 6px",verticalAlign:"top"}}>
                  {Object.entries(kw).map(([field,vals])=>{const arr=Array.isArray(vals)?vals:[vals]; return(<div key={field} style={{marginBottom:4}}><span style={{fontSize:9,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:.5,marginRight:6}}>{kwLabel[field]||field}</span><ChipEditor items={arr} onChange={nv=>onUpdateKeywords(v.id,source.id,field,nv)} color={C.cyan} placeholder="Add keyword…"/></div>);})}
                </td>
                <td style={{padding:"10px 6px",textAlign:"center",verticalAlign:"top"}}>
                  {isL?<Spinner size={14}/>:err?<Badge color={C.red} bg={C.redBg}>{err}</Badge>:res?<span style={{...font.mono,fontSize:15,fontWeight:700}}>{(res.count||0).toLocaleString()}</span>:<span style={{color:C.textMuted}}>—</span>}
                </td>
                <td style={{padding:"10px 6px",textAlign:"center",verticalAlign:"top"}}>
                  {res?.classification?.dominantStage?(<div><Badge color={res.classification.dominantStage.color}>{res.classification.dominantStage.name}</Badge>{res.classification.confidence!=null&&<div style={{...font.mono,fontSize:10,color:res.classification.confidence>=40?C.green:C.amber,marginTop:2}}>{res.classification.confidence}%</div>}</div>):<span style={{color:C.textMuted}}>—</span>}
                </td>
                <td style={{padding:"10px 6px",textAlign:"center",verticalAlign:"top"}}>
                  <div style={{display:"flex",gap:4,justifyContent:"center",alignItems:"center"}}>
                    <Btn variant="ghost" onClick={e=>{e.stopPropagation();setShowChart(isChart?null:v.id);}} style={{fontSize:10,padding:"2px 6px"}} title="Toggle growth chart">{isChart?"▼":"📈"}</Btn>
                    <Btn variant="ghost" onClick={e=>{e.stopPropagation();onFetch(source.id,v.id);}} disabled={isL} style={{fontSize:10,padding:"2px 6px"}}>{isL?<Spinner size={10}/>:"↻"}</Btn>
                  </div>
                </td>
                <td/>
              </tr>
              {isChart && (
                <tr className="fade-in"><td colSpan={7} style={{padding:"6px 12px 12px",background:C.nested}}>
                  <div style={{...font.sans,fontSize:11,fontWeight:600,color:C.textSec,marginBottom:4}}>Growth Trend — {source.name} × {v.name}</div>
                  <SignalHistoryChart signalKey={key} color={v.color||C.cyan} label={source.name} />
                </td></tr>
              )}
              {isExp && res?.items && (
                <tr className="fade-in"><td colSpan={7} style={{padding:"0 12px 12px",background:C.nested}}>
                  <div style={{maxHeight:200,overflowY:"auto",fontSize:12}}>
                    {res.items.map((item,i)=>(<div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${C.borderLight}`,display:"flex",alignItems:"flex-start",gap:8}}>
                      {item.classification&&<span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:DEFAULT_STAGES.find(s=>s.name===item.classification.stageName)?.color||C.textMuted,marginTop:5,flexShrink:0}}/>}
                      <div><div style={{fontWeight:500,color:C.text}}>{item.title}</div>{item.body&&<div style={{color:C.textMuted,fontSize:11,marginTop:1}}>{item.body.slice(0,150)}</div>}</div>
                    </div>))}
                  </div>
                </td></tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody></table>
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

  return (
    <Card style={{padding:0,overflow:"hidden",marginBottom:20}}>
      <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,background:C.nested}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:18}}>🤗</span>
            <span style={{...font.sans,fontSize:14,fontWeight:600,color:C.text}}>Hugging Face Model Downloads</span>
            <Badge color={C.green} bg={C.greenBg}>Public API</Badge>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {data?.timestamp&&<span style={{fontSize:11,color:C.textMuted}}>{timeAgo(data.timestamp)}</span>}
            <Btn variant="ghost" onClick={()=>setShowHist(!showHist)} style={{fontSize:11,padding:"4px 8px"}}>{showHist?"Hide Chart":"📈 Chart"}</Btn>
            <Btn variant="primary" onClick={doFetch} disabled={isL} style={{fontSize:11,padding:"5px 10px"}}>{isL?<><Spinner size={11} color="#fff"/> Fetching…</>:"Refresh"}</Btn>
          </div>
        </div>
        <div style={{marginTop:8,padding:"8px 10px",background:C.white,borderRadius:6,border:`1px solid ${C.borderLight}`}}>
          <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:2}}>Cumulative model downloads (top 10 models per org) from Hugging Face</div>
          <div style={{fontSize:11,color:C.textMuted,lineHeight:1.5,marginBottom:4}}>Hugging Face is the de facto platform for publishing and downloading open-source AI models. Download volume reflects real enterprise and developer adoption of each company's model ecosystem.</div>
          <div style={{fontSize:11,color:C.amber,lineHeight:1.5,borderTop:`1px solid ${C.borderLight}`,paddingTop:4}}>
            <span style={{fontWeight:600}}>Investment implication: </span>Download ratios between orgs reveal competitive moat strength in the open-source AI layer. A company whose models are downloaded 5x less than competitors has weaker developer lock-in and ecosystem gravity — this translates to weaker inference revenue, less fine-tuning activity on their architecture, and lower switching costs for enterprises. Watch for rank changes: an org climbing rapidly signals a model breakout (e.g. Llama moment) that can reshape vendor selection across entire verticals within quarters.
          </div>
        </div>
      </div>

      {showHist && hfHist.length >= 2 && (
        <div style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{...font.sans,fontSize:11,fontWeight:600,color:C.textSec,marginBottom:4}}>Download Growth Over Time</div>
          <div style={{width:"100%",height:180}}>
            <ResponsiveContainer>
              <LineChart data={hfHist} margin={{top:5,right:10,bottom:5,left:10}}>
                <XAxis dataKey="date" tick={{fontSize:9,fill:C.textMuted}} interval="preserveStartEnd"/>
                <YAxis tick={{fontSize:9,fill:C.textMuted}} width={50} tickFormatter={fmtDL}/>
                <Tooltip contentStyle={{...font.sans,fontSize:11,background:C.white,border:`1px solid ${C.border}`,borderRadius:6}} formatter={v=>fmtDL(v)}/>
                <Legend wrapperStyle={{fontSize:9}}/>
                {HF_ORGS.map(org=>(<Line key={org.id} type="monotone" dataKey={org.id} stroke={org.color} strokeWidth={1.5} dot={false} name={org.name} connectNulls/>))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {err&&<div style={{padding:"10px 16px",background:C.redBg,color:C.red,fontSize:12}}>{err}</div>}
      <table><thead><tr style={{background:C.white}}>
        {["#","Organization","Downloads (top 10 models)","Top Model",""].map((h,i)=>(
          <th key={i} style={{...font.sans,fontSize:10,fontWeight:600,color:C.textMuted,textTransform:"uppercase",letterSpacing:.5,padding:"8px 12px",textAlign:i===0?"center":"left",borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>
        ))}
      </tr></thead>
      <tbody>
        {orgs.map((org,rank)=>{
          const meta=HF_ORGS.find(o=>o.id===org.orgId)||{name:org.orgId,color:C.textMuted};
          const pct=maxDl>0?(org.totalDownloads/maxDl)*100:0;
          const isExp=expanded===org.orgId;
          const rv=rank>0&&orgs[0].totalDownloads>0?(orgs[0].totalDownloads/Math.max(org.totalDownloads,1)).toFixed(1):null;
          return(<React.Fragment key={org.orgId}>
            <tr style={{borderBottom:`1px solid ${C.borderLight}`,cursor:"pointer"}} onClick={()=>setExpanded(isExp?null:org.orgId)} onMouseEnter={e=>e.currentTarget.style.background=C.nested} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <td style={{padding:"10px 12px",textAlign:"center",...font.mono,fontSize:13,fontWeight:700,color:rank<3?meta.color:C.textMuted,width:36}}>{rank+1}</td>
              <td style={{padding:"10px 12px",fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap"}}><span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:meta.color,marginRight:8,verticalAlign:"middle"}}/>{meta.name}{rv&&<span style={{fontSize:10,color:C.textMuted,marginLeft:6}}>({rv}x less than #1)</span>}</td>
              <td style={{padding:"10px 12px",minWidth:250}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:18,background:C.nested,borderRadius:4,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:meta.color,borderRadius:4,transition:"width .5s ease"}}/></div><span style={{...font.mono,fontSize:13,fontWeight:700,color:C.text,minWidth:55,textAlign:"right"}}>{fmtDL(org.totalDownloads)}</span></div></td>
              <td style={{padding:"10px 12px",fontSize:11,color:C.textSec,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{org.topModels[0]?<>{org.topModels[0].id.split("/").pop()} <span style={{color:C.textMuted}}>({fmtDL(org.topModels[0].downloads)})</span></>:"—"}</td>
              <td style={{padding:"10px 8px",textAlign:"center",fontSize:11,color:C.textMuted}}>{isExp?"▲":"▼"}</td>
            </tr>
            {isExp&&(<tr className="fade-in"><td colSpan={5} style={{padding:"0 12px 12px",background:C.nested}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,maxWidth:700}}>{org.topModels.map((m,i)=>(<div key={m.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:C.white,borderRadius:6,border:`1px solid ${C.borderLight}`}}><span style={{...font.mono,fontSize:10,color:C.textMuted,width:16}}>{i+1}</span><div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.id}</div><div style={{fontSize:10,color:C.textMuted}}>{m.pipeline||"—"}</div></div><span style={{...font.mono,fontSize:11,fontWeight:600,color:meta.color,whiteSpace:"nowrap"}}>{fmtDL(m.downloads)}</span></div>))}</div></td></tr>)}
          </React.Fragment>);
        })}
        {orgs.length===0&&!isL&&<tr><td colSpan={5} style={{padding:20,textAlign:"center",color:C.textMuted,fontSize:13}}>Click Refresh to fetch from Hugging Face.</td></tr>}
        {isL&&orgs.length===0&&<tr><td colSpan={5} style={{padding:20,textAlign:"center"}}><Spinner size={16}/><span style={{marginLeft:8,fontSize:13,color:C.textMuted}}>Fetching…</span></td></tr>}
      </tbody></table>
    </Card>
  );
}

// ── COMPOSITE CARDS ──────────────────────────────────────────────────────────

function CompositeCards({verticals,composites,stageTaxonomy}){
  return(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
    {verticals.map(v=>{
      const comp=composites[v.id]||{score:0,breakdown:{}};const stage=resolveStage(comp.score,stageTaxonomy);
      return(<Card key={v.id} className={stage.index>=stageTaxonomy.length-1?"glow":""} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,border:stage.index>=stageTaxonomy.length-1?`2px solid ${stage.color}`:undefined}}>
        <div style={{display:"flex",justifyContent:"space-between",width:"100%",alignItems:"center"}}><span style={{...font.sans,fontSize:14,fontWeight:600,color:C.text}}>{v.name}</span><Badge color={stage.color}>{stage.name}</Badge></div>
        <GaugeSVG value={comp.score} size={80} color={v.color||C.cyan}/>
        <div style={{...font.sans,fontSize:11,color:C.textMuted,textAlign:"center"}}>{stage.description}</div>
        <div style={{width:"100%"}}>{Object.entries(comp.breakdown).map(([sid,b])=>(<div key={sid} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}><span style={{...font.sans,fontSize:10,color:C.textMuted,width:80,textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.source.name}</span><div style={{flex:1,height:4,background:C.nested,borderRadius:2,overflow:"hidden"}}><div style={{width:`${b.score}%`,height:"100%",background:v.color||C.cyan,borderRadius:2}}/></div><span style={{...font.mono,fontSize:10,color:C.textMuted,width:24,textAlign:"right"}}>{b.score}</span></div>))}</div>
      </Card>);
    })}
  </div>);
}

// ── ALERT FEED ───────────────────────────────────────────────────────────────

function AlertFeed({alerts,onPin}){
  const sorted=[...alerts.filter(a=>a.pinned),...alerts.filter(a=>!a.pinned)].slice(0,20);
  const sevC={amber:C.amber,red:C.red,cyan:C.cyan,green:C.green};
  if(sorted.length===0)return <Card><div style={{...font.sans,fontSize:13,color:C.textMuted,textAlign:"center",padding:16}}>No alerts. Fetch data to generate divergence analysis.</div></Card>;
  return(<Card><div style={{...font.sans,fontSize:14,fontWeight:600,color:C.text,marginBottom:10}}>Divergence Alerts</div><div style={{maxHeight:200,overflowY:"auto"}}>{sorted.map(a=>(<div key={a.id} className="fade-in" style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 0",borderBottom:`1px solid ${C.borderLight}`}}><div style={{width:7,height:7,borderRadius:"50%",background:sevC[a.severity]||C.textMuted,marginTop:5,flexShrink:0}}/><div style={{flex:1}}><div style={{display:"flex",gap:6,alignItems:"center",marginBottom:2}}><span style={{fontSize:11,color:C.textMuted}}>{new Date(a.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span><Badge color={sevC[a.severity]||C.textMuted}>{a.vertical}</Badge></div><div style={{fontSize:13,color:C.text}}>{a.text}</div></div><button onClick={()=>onPin(a.id)} style={{background:"none",border:"none",cursor:"pointer",color:a.pinned?C.amber:C.textMuted,fontSize:13}}>📌</button></div>))}</div></Card>);
}

// ── CONFIG PANEL ─────────────────────────────────────────────────────────────

function ConfigPanel({config,setConfig,onClose}){
  const[tab,setTab]=useState("verticals");
  const tabs=[{id:"verticals",label:"Verticals"},{id:"sources",label:"Signal Sources"},{id:"classifier",label:"Classifier"},{id:"scoring",label:"Scoring"},{id:"apikeys",label:"API Keys"},{id:"data",label:"Data"}];
  const update=fn=>setConfig(prev=>{const next=fn(prev);sv("config",next);return next;});

  return(
    <div style={{position:"fixed",top:0,right:0,bottom:0,width:580,maxWidth:"95vw",background:C.white,borderLeft:`1px solid ${C.border}`,boxShadow:"-4px 0 24px rgba(0,0,0,.08)",zIndex:200,display:"flex",flexDirection:"column",...font.sans}} className="fade-in">
      <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:16,fontWeight:700}}>⚙ Configuration</span><Btn variant="ghost" onClick={onClose} style={{fontSize:18,padding:4}}>✕</Btn></div>
      <TabBar tabs={tabs} active={tab} onChange={setTab}/>
      <div style={{flex:1,overflowY:"auto",padding:"0 20px 20px"}}>

        {tab==="verticals"&&(<div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <h4 style={{fontSize:14,fontWeight:600}}>Verticals / Keyword Groups</h4>
            <Btn variant="primary" onClick={()=>update(c=>({...c,verticals:[...c.verticals,{id:`v_${Date.now()}`,name:"New Group",color:PALETTE[c.verticals.length%PALETTE.length],description:"",keywords:{theirstack:{titleKeywords:[],descriptionKeywords:[]},google_trends:{keywords:[]},github_repos:{keywords:[]},claude_attrib:{keywords:[]}}}]}))} style={{fontSize:11}}>+ Add Group</Btn>
          </div>
          <div style={{fontSize:12,color:C.textMuted,marginBottom:12}}>Each group is an independent keyword set tracked across all signal sources. Create groups for different verticals, technologies, or competitors you want to monitor separately.</div>
          {config.verticals.map((v,vi)=>(<Card key={v.id} style={{marginBottom:10,padding:14,background:C.nested}}>
            <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
              <input value={v.name} onChange={e=>update(c=>{const vs=[...c.verticals];vs[vi]={...vs[vi],name:e.target.value};return{...c,verticals:vs};})} style={{flex:1,fontWeight:600}}/>
              <input type="color" value={v.color||"#0284c7"} onChange={e=>update(c=>{const vs=[...c.verticals];vs[vi]={...vs[vi],color:e.target.value};return{...c,verticals:vs};})} style={{width:36,height:32,padding:2,cursor:"pointer"}}/>
              <Btn variant="danger" onClick={()=>{if(confirm(`Remove "${v.name}"?`))update(c=>({...c,verticals:c.verticals.filter((_,i)=>i!==vi)}));}} style={{fontSize:11,padding:"4px 8px"}}>✕</Btn>
            </div>
            {config.sources.map(src=>{const kw=v.keywords?.[src.id]||{};return(<div key={src.id} style={{marginBottom:8,paddingLeft:8,borderLeft:`2px solid ${C.border}`}}><div style={{fontSize:11,fontWeight:600,color:C.textMuted,textTransform:"uppercase",marginBottom:4}}>{src.name}</div>{Object.entries(kw).map(([field,vals])=>(<div key={field} style={{marginBottom:4}}><div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>{field}</div><ChipEditor items={Array.isArray(vals)?vals:[vals]} onChange={nv=>update(c=>{const vs=[...c.verticals];const vv={...vs[vi]};vv.keywords={...vv.keywords,[src.id]:{...vv.keywords[src.id],[field]:nv}};vs[vi]=vv;return{...c,verticals:vs};})} color={C.cyan}/></div>))}</div>);})}
          </Card>))}
        </div>)}

        {tab==="sources"&&(<div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h4 style={{fontSize:14,fontWeight:600}}>Signal Sources</h4><Btn variant="primary" onClick={()=>update(c=>({...c,sources:[...c.sources,{id:`src_${Date.now()}`,name:"New Source",type:"count",weight:0.1,cadence:"weekly",enabled:true,apiConfig:{endpoint:"",method:"GET",authType:"bearer",authHeader:"",proxyPrefix:"",bodyTemplate:""},responsePaths:{countPath:"",itemsPath:"",titleField:"",bodyField:""}}]}))} style={{fontSize:11}}>+ Add Source</Btn></div>
          {config.sources.map((src,si)=>(<Card key={src.id} style={{marginBottom:10,padding:14,background:C.nested}}>
            <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
              <input value={src.name} onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],name:e.target.value};return{...c,sources:ss};})} style={{flex:1,fontWeight:600}}/>
              <select value={src.type} onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],type:e.target.value};return{...c,sources:ss};})} style={{width:130}}>{["count","classified_text","index"].map(t=><option key={t} value={t}>{t}</option>)}</select>
              <select value={src.cadence} onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],cadence:e.target.value};return{...c,sources:ss};})} style={{width:100}}>{["realtime","daily","weekly"].map(c2=><option key={c2} value={c2}>{c2}</option>)}</select>
              <label style={{display:"flex",alignItems:"center",gap:4,fontSize:12,cursor:"pointer"}}><input type="checkbox" checked={src.enabled} onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],enabled:e.target.checked};return{...c,sources:ss};})}/>Enabled</label>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
              <div><label style={{fontSize:10,color:C.textMuted}}>Weight</label><input type="number" step="0.05" min="0" max="1" value={src.weight} onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],weight:parseFloat(e.target.value)||0};return{...c,sources:ss};})} style={{width:"100%"}}/></div>
              <div><label style={{fontSize:10,color:C.textMuted}}>Method</label><select value={src.apiConfig.method} onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],apiConfig:{...ss[si].apiConfig,method:e.target.value}};return{...c,sources:ss};})} style={{width:"100%"}}><option>GET</option><option>POST</option></select></div>
            </div>
            <div style={{marginBottom:6}}><label style={{fontSize:10,color:C.textMuted}}>Endpoint</label><input value={src.apiConfig.endpoint} onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],apiConfig:{...ss[si].apiConfig,endpoint:e.target.value}};return{...c,sources:ss};})} style={{width:"100%"}}/></div>
            <div style={{marginBottom:6}}><label style={{fontSize:10,color:C.textMuted}}>Body / Query Template</label><textarea rows={4} value={src.apiConfig.bodyTemplate} onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],apiConfig:{...ss[si].apiConfig,bodyTemplate:e.target.value}};return{...c,sources:ss};})} style={{width:"100%"}}/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>{["countPath","itemsPath","titleField","bodyField"].map(f=>(<div key={f}><label style={{fontSize:10,color:C.textMuted}}>{f}</label><input value={src.responsePaths[f]||""} onChange={e=>update(c=>{const ss=[...c.sources];ss[si]={...ss[si],responsePaths:{...ss[si].responsePaths,[f]:e.target.value}};return{...c,sources:ss};})} style={{width:"100%"}}/></div>))}</div>
            <div style={{marginTop:8}}><Btn variant="danger" onClick={()=>update(c=>({...c,sources:c.sources.filter((_,i)=>i!==si)}))} style={{fontSize:11}}>Remove Source</Btn></div>
          </Card>))}
        </div>)}

        {tab==="classifier"&&(<div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h4 style={{fontSize:14,fontWeight:600}}>Classification Stages</h4><Btn variant="primary" onClick={()=>update(c=>({...c,stages:[...c.stages,{id:`stg_${Date.now()}`,name:"New Stage",color:C.purple,weight:c.stages.length+1,titlePatterns:[],descriptionPatterns:[]}]}))} style={{fontSize:11}}>+ Add Stage</Btn></div>
          {config.stages.map((stg,si)=>(<Card key={stg.id} style={{marginBottom:10,padding:14,background:C.nested}}>
            <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}><input value={stg.name} onChange={e=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],name:e.target.value};return{...c,stages:ss};})} style={{flex:1,fontWeight:600}}/><input type="color" value={stg.color} onChange={e=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],color:e.target.value};return{...c,stages:ss};})} style={{width:36,height:32,padding:2}}/><input type="number" value={stg.weight} onChange={e=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],weight:parseFloat(e.target.value)||0};return{...c,stages:ss};})} style={{width:60}} title="Weight"/><Btn variant="danger" onClick={()=>update(c=>({...c,stages:c.stages.filter((_,i)=>i!==si)}))} style={{fontSize:11,padding:"4px 8px"}}>✕</Btn></div>
            <div style={{marginBottom:6}}><div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>Title Patterns</div><ChipEditor items={stg.titlePatterns} onChange={v=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],titlePatterns:v};return{...c,stages:ss};})}/></div>
            <div><div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>Description Patterns</div><ChipEditor items={stg.descriptionPatterns} onChange={v=>update(c=>{const ss=[...c.stages];ss[si]={...ss[si],descriptionPatterns:v};return{...c,stages:ss};})}/></div>
          </Card>))}
        </div>)}

        {tab==="scoring"&&(<div>
          <h4 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Stage Taxonomy</h4>
          {config.stageTaxonomy.map((t,ti)=>(<div key={ti} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}><input type="number" value={t.min} onChange={e=>update(c=>{const st=[...c.stageTaxonomy];st[ti]={...st[ti],min:parseInt(e.target.value)||0};return{...c,stageTaxonomy:st};})} style={{width:50}}/><span style={{color:C.textMuted}}>–</span><input type="number" value={t.max} onChange={e=>update(c=>{const st=[...c.stageTaxonomy];st[ti]={...st[ti],max:parseInt(e.target.value)||0};return{...c,stageTaxonomy:st};})} style={{width:50}}/><input value={t.name} onChange={e=>update(c=>{const st=[...c.stageTaxonomy];st[ti]={...st[ti],name:e.target.value};return{...c,stageTaxonomy:st};})} style={{flex:1}}/><input type="color" value={t.color} onChange={e=>update(c=>{const st=[...c.stageTaxonomy];st[ti]={...st[ti],color:e.target.value};return{...c,stageTaxonomy:st};})} style={{width:36,height:32,padding:2}}/></div>))}
          <h4 style={{fontSize:14,fontWeight:600,margin:"20px 0 12px"}}>Stage Multipliers</h4>
          {config.stages.map(stg=>(<div key={stg.id} style={{display:"flex",gap:8,marginBottom:6,alignItems:"center"}}><span style={{fontSize:12,color:C.textSec,width:100}}>{stg.name}</span><input type="number" step="0.1" value={config.stageMultipliers[stg.id]||1} onChange={e=>update(c=>({...c,stageMultipliers:{...c.stageMultipliers,[stg.id]:parseFloat(e.target.value)||1}}))} style={{width:70}}/></div>))}
        </div>)}

        {tab==="apikeys"&&(<div>
          <h4 style={{fontSize:14,fontWeight:600,marginBottom:4}}>API Keys</h4>
          <div style={{fontSize:12,color:C.textMuted,marginBottom:14}}>Keys loaded from <code style={{...font.mono,background:C.nested,padding:"1px 4px",borderRadius:3}}>.env</code> automatically.</div>
          {config.sources.map(src=>{const kid=src.apiConfig.authType==="bearer"&&src.apiConfig.endpoint.includes("github")?"github":src.id;const ek=ENV_KEYS[kid]||ENV_KEYS[src.id]||"";const he=!!ek;const ho=!!(config.apiKeys[kid]);
            return(<div key={src.id} style={{marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><label style={{fontSize:13,fontWeight:500}}>{src.name}</label><div style={{display:"flex",gap:6}}>{he&&<Badge color={C.green} bg={C.greenBg}>.env loaded</Badge>}{ho&&<Badge color={C.amber} bg={C.amberBg}>Override</Badge>}{!he&&!ho&&<Badge color={C.red} bg={C.redBg}>No key</Badge>}</div></div><input type="password" value={config.apiKeys[kid]||""} onChange={e=>update(c=>({...c,apiKeys:{...c.apiKeys,[kid]:e.target.value}}))} style={{width:"100%"}} placeholder={he?"Using .env — paste to override":"Paste key…"}/></div>);
          })}
        </div>)}

        {tab==="data"&&(<div>
          <h4 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Data Management</h4>
          <div style={{fontSize:13,color:C.textSec,marginBottom:12}}>{getCacheStats().count} entries · {getCacheStats().sizeKB} KB</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Btn onClick={()=>{const b=new Blob([JSON.stringify(config,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="signal-dash-config.json";a.click();}}>Export Config</Btn>
            <Btn onClick={()=>{const all={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(PFX))all[k]=localStorage.getItem(k);}const b=new Blob([JSON.stringify(all,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="signal-dash-data.json";a.click();}}>Export Data</Btn>
            <Btn onClick={()=>{const inp=document.createElement("input");inp.type="file";inp.accept=".json";inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const c=JSON.parse(ev.target.result);setConfig(c);sv("config",c);alert("Imported.");}catch{alert("Invalid JSON.");}};r.readAsText(f);};inp.click();}}>Import Config</Btn>
            <Btn variant="danger" onClick={()=>{if(confirm("Clear all cached data?")){const keys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(PFX)&&k!==PFX+"config")keys.push(k);}keys.forEach(k=>localStorage.removeItem(k));alert("Cleared.");}}}>Clear Cache</Btn>
          </div>
        </div>)}
      </div>
    </div>
  );
}

// ── QUICK ADD GROUP (main UI) ────────────────────────────────────────────────

function QuickAddGroup({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef(null);
  useEffect(() => { if (open && ref.current) ref.current.focus(); }, [open]);

  if (!open) return <Btn onClick={() => setOpen(true)} style={{ fontSize: 12 }}>+ New Signal Group</Btn>;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input ref={ref} value={name} onChange={e => setName(e.target.value)} placeholder="Group name (e.g. Healthcare AI)" style={{ width: 200 }}
        onKeyDown={e => { if (e.key === "Enter" && name.trim()) { onAdd(name.trim()); setName(""); setOpen(false); } if (e.key === "Escape") { setOpen(false); setName(""); } }} />
      <Btn variant="primary" onClick={() => { if (name.trim()) { onAdd(name.trim()); setName(""); setOpen(false); } }} style={{ fontSize: 11 }}>Create</Btn>
      <Btn variant="ghost" onClick={() => { setOpen(false); setName(""); }} style={{ fontSize: 11 }}>Cancel</Btn>
    </div>
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
  const [showConfig,setShowConfig]=useState(false);
  const [nextRefresh,setNextRefresh]=useState({});
  const [schedulerActive,setSchedulerActive]=useState(true);
  const [overlaySelected,setOverlaySelected]=useState([]);
  const [allHistories,setAllHistories]=useState({});
  const configRef=useRef(config);const srRef=useRef(signalResults);const ldRef=useRef(loading);
  useEffect(()=>{configRef.current=config;},[config]);
  useEffect(()=>{srRef.current=signalResults;},[signalResults]);
  useEffect(()=>{ldRef.current=loading;},[loading]);
  useEffect(()=>{sv("config",config);},[config]);

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

  // Auto-refresh scheduler
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

  return(
    <div style={{background:C.bg,minHeight:"100vh",...font.sans}}>
      <style>{CSS}</style>
      <div style={{position:"sticky",top:0,zIndex:100,background:C.white,borderBottom:`1px solid ${C.border}`,padding:"12px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <h1 style={{fontSize:17,fontWeight:700,margin:0}}>Signal Intelligence Dashboard</h1>
          {anyLoading&&<Spinner size={16}/>}
          {hasKeys&&<Badge color={C.green} bg={C.greenBg}>● Live</Badge>}
          {schedulerActive&&hasKeys&&<Badge color={C.cyan} bg={C.cyanBg}>Auto-refresh ON</Badge>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{display:"flex",gap:4}}>{config.sources.filter(s=>s.enabled).map(src=>{const nxt=nextRefresh[src.id];const rem=nxt?Math.max(0,nxt-Date.now()):0;return <Badge key={src.id} color={C.green} bg={C.greenBg}>{src.name.split(" ")[0]} {rem>0?humanInterval(rem):"..."}</Badge>;})}</div>
          <Btn variant={schedulerActive?"default":"primary"} onClick={()=>setSchedulerActive(p=>!p)} style={{fontSize:11}}>{schedulerActive?"Pause":"Resume"}</Btn>
          <Btn variant="primary" onClick={refreshAll} disabled={anyLoading||!hasKeys}>{anyLoading?<><Spinner size={12} color="#fff"/> Refreshing…</>:"Refresh Now"}</Btn>
          <Btn onClick={()=>doCloudSync("up")} style={{fontSize:11}} disabled={cloudStatus.endsWith("…")} title="Save all data to GitHub Gist">{cloudStatus==="saving…"?<><Spinner size={10}/> Saving</>:cloudStatus==="synced"?"Synced":"Cloud Save"}</Btn>
          <Btn onClick={()=>doCloudSync("down")} style={{fontSize:11}} disabled={cloudStatus.endsWith("…")} title="Load data from GitHub Gist">{cloudStatus==="loading…"?<><Spinner size={10}/> Loading</>:"Cloud Load"}</Btn>
          {cloudStatus==="error"&&<Badge color={C.red} bg={C.redBg}>Sync failed</Badge>}
          <Btn onClick={()=>setShowConfig(true)}>⚙ Config</Btn>
        </div>
      </div>

      <div style={{padding:"20px 24px",maxWidth:1400,margin:"0 auto"}}>
        {/* Quick add + overlay toggle */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <QuickAddGroup onAdd={addGroup}/>
          {overlaySelected.length>0&&<Badge color={C.purple} bg={C.purpleBg}>{overlaySelected.length} signals selected for overlay</Badge>}
        </div>

        {/* Overlay comparison chart */}
        {overlaySelected.length>=2 && <OverlayChart selectedKeys={overlaySelected} allHistories={allHistories} sources={config.sources} verticals={config.verticals}/>}

        {/* Signal Panels */}
        <div style={{display:"flex",flexDirection:"column",gap:16,marginBottom:24}}>
          {config.sources.filter(s=>s.enabled).map(src=>(<SignalPanel key={src.id} source={src} verticals={config.verticals} signalResults={signalResults} loading={loading} errors={errors} onFetch={fetchSource} onUpdateKeywords={updateKeywords} overlaySelected={overlaySelected} onToggleOverlay={toggleOverlay}/>))}
        </div>

        <HuggingFaceLeaderboard/>

        <div style={{marginBottom:20}}><div style={{fontSize:14,fontWeight:600,marginBottom:10}}>Pipeline Pressure Scores</div><CompositeCards verticals={config.verticals} composites={composites} stageTaxonomy={config.stageTaxonomy}/></div>

        <AlertFeed alerts={alerts} onPin={id=>setAlerts(p=>p.map(a=>a.id===id?{...a,pinned:!a.pinned}:a))}/>

        {!hasKeys&&(<Card style={{marginTop:16,textAlign:"center",padding:32,background:C.blueBg,border:"1px solid #bfdbfe"}}>
          <div style={{fontSize:24,marginBottom:8}}>⚡</div>
          <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>Add API keys to .env to activate live data</div>
          <pre style={{...font.mono,fontSize:12,textAlign:"left",display:"inline-block",background:C.nested,padding:14,borderRadius:8,color:C.textSec}}>{`VITE_THEIRSTACK_KEY=your_key\nVITE_SERPAPI_KEY=your_key\nVITE_GITHUB_PAT=your_pat`}</pre>
        </Card>)}
      </div>

      {showConfig&&<ConfigPanel config={config} setConfig={setConfig} onClose={()=>setShowConfig(false)}/>}
      {showConfig&&<div onClick={()=>setShowConfig(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.15)",zIndex:199}}/>}
    </div>
  );
}
