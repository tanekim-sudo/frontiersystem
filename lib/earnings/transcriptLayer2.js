/**
 * Layer-2 earnings transcript analytics (deterministic, client-side).
 * Complements LLM linguistic scoring: theme concentration, LM-style lexicon sentiment,
 * forward-looking / uncertainty density, and AI-related mention rates.
 *
 * Lexicon approach is inspired by Loughran–McDonald finance word lists (subset, not full LM);
 * institutional practice often combines lexicons with LLMs (e.g. S&P / market intelligence research).
 */

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {string} text */
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\r\n/g, "\n")
    .replace(/[^\p{L}\p{N}\s'.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} text */
function wordCount(text) {
  const n = normalizeText(text);
  if (!n) return 0;
  return n.split(/\s+/).filter((w) => w.length > 0).length;
}

/** @param {string} text */
function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
}

/**
 * Multi-word phrases first (longer first), then single tokens with word boundaries.
 * @param {string} haystack normalized lowercase single-spaced
 * @param {string[]} terms
 */
function countTermHits(haystack, terms) {
  let total = 0;
  const byTerm = [];
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  for (const raw of sorted) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    let n = 0;
    if (t.includes(" ")) {
      let pos = 0;
      while (pos < haystack.length) {
        const i = haystack.indexOf(t, pos);
        if (i < 0) break;
        const before = i === 0 || haystack[i - 1] === " ";
        const after = i + t.length >= haystack.length || haystack[i + t.length] === " ";
        if (before && after) {
          n += 1;
        }
        pos = i + 1;
      }
    } else {
      const re = new RegExp(`\\b${escapeRe(t)}\\b`, "g");
      let m;
      while ((m = re.exec(haystack)) !== null) {
        n += 1;
      }
    }
    if (n > 0) byTerm.push({ term: raw, count: n });
    total += n;
  }
  return { total, byTerm };
}

const THEME_LEXICONS = [
  {
    id: "ai_core",
    label: "AI / ML & inference",
    terms: [
      "artificial intelligence",
      "machine learning",
      "deep learning",
      "neural network",
      "large language model",
      "llm",
      "generative ai",
      "gen ai",
      "genai",
      "transformer",
      "fine-tuning",
      "fine tuning",
      "pre-trained",
      "pretrained",
      "inference",
      "training cluster",
      "gpu",
      "tpu",
      "accelerator",
      "copilot",
      "agentic",
      "autonomous agent",
      "retrieval augmented",
      "embedding",
      "foundation model",
      "multimodal",
      "tokenizer",
      "parameter model",
      "open source model",
    ],
  },
  {
    id: "ai_product_gtm",
    label: "AI product & monetization",
    terms: [
      "api revenue",
      "consumption based",
      "per token",
      "per seat",
      "subscription",
      "enterprise agreement",
      "azure openai",
      "vertex ai",
      "bedrock",
      "chatbot",
      "virtual assistant",
      "ai studio",
      "developer platform",
      "model marketplace",
    ],
  },
  {
    id: "ai_capex_infra",
    label: "AI capex & infrastructure",
    terms: [
      "data center",
      "datacenter",
      "hyperscale",
      "hyperscaler",
      "capex",
      "capital expenditure",
      "build out",
      "build-out",
      "networking equipment",
      "backlog",
      "foundry",
      "wafer",
      "co-packaged",
      "liquid cooling",
      "power and cooling",
      "ai factory",
    ],
  },
  {
    id: "ai_risk_trust",
    label: "AI risk, trust & regulation",
    terms: [
      "regulation",
      "regulatory",
      "eu ai act",
      "copyright",
      "litigation",
      "lawsuit",
      "class action",
      "hallucination",
      "safety",
      "alignment",
      "bias",
      "deepfake",
      "misinformation",
      "guardrail",
      "responsible ai",
    ],
  },
  {
    id: "macro_guidance",
    label: "Guidance & macro framing",
    terms: [
      "guidance",
      "outlook",
      "we expect",
      "we anticipate",
      "we believe",
      "forecast",
      "trajectory",
      "run rate",
      "constant currency",
      "fx headwind",
      "macroeconomic",
      "macro environment",
      "seasonality",
    ],
  },
];

/** Subset style: Loughran–McDonald–inspired finance sentiment (not the full licensed lists). */
const LM_POSITIVE = [
  "ability", "achieve", "advantage", "attractive", "beat", "boom", "confident", "deliver", "durable",
  "efficiency", "exceed", "expansion", "gain", "growth", "improve", "innovative", "leading", "momentum",
  "optimistic", "outperform", "profit", "profitability", "record", "resilient", "strength", "strong",
  "success", "superior", "tailwind", "upside", "win", "winning", "robust", "solid",
];

const LM_NEGATIVE = [
  "adverse", "challenge", "challenging", "contraction", "decline", "declining", "difficult", "downgrade",
  "erosion", "fail", "headwind", "impair", "layoff", "weakness", "loss", "litigation", "miss", "obsolete",
  "penalty", "risk", "sever", "shortfall", "slow", "slowing", "stagnant", "strain", "threat", "volatile",
  "warn", "weak", "weaker", "worse", "deteriorate", "uncollectible", "restructuring",
];

const FORWARD_LOOKING = [
  "we expect", "we anticipate", "we project", "we believe", "going forward", "next quarter",
  "next fiscal", "full year", "fiscal year", "outlook", "guidance", "forecast", "will continue",
  "poised to", "positioned to", "should drive", "trajectory", "runway", "pipeline", "backlog",
  "long term", "long-term", "medium term", "medium-term",
];

const UNCERTAINTY = [
  "approximately", "roughly", "may", "might", "could", "uncertain", "unclear", "difficult to predict",
  "too early", "variable", "fluctuate", "contingent", "subject to", "no assurance", "cannot predict",
  "if economic", "depending on", "volatile", "visibility",
];

function countPhraseList(haystack, phrases) {
  let total = 0;
  const byPhrase = [];
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    const t = p.toLowerCase();
    let n = 0;
    let pos = 0;
    while (pos < haystack.length) {
      const i = haystack.indexOf(t, pos);
      if (i < 0) break;
      const before = i === 0 || haystack[i - 1] === " ";
      const after = i + t.length >= haystack.length || haystack[i + t.length] === " ";
      if (before && after) {
        n += 1;
        pos = i + t.length;
      } else pos = i + 1;
    }
    if (n > 0) byPhrase.push({ phrase: p, count: n });
    total += n;
  }
  return { total, byPhrase };
}

function lexiconSentimentNet(haystack, positive, negative) {
  let pos = 0;
  let neg = 0;
  const posDetail = countTermHits(haystack, positive);
  pos += posDetail.total;
  const negDetail = countTermHits(haystack, negative);
  neg += negDetail.total;
  return {
    positive_hits: pos,
    negative_hits: neg,
    net: pos - neg,
    pos_ratio: pos / (pos + neg + 1),
    positive_terms: posDetail.byTerm.slice(0, 8),
    negative_terms: negDetail.byTerm.slice(0, 8),
  };
}

function splitPreparedVsQA(raw) {
  const lower = String(raw || "").toLowerCase();
  const markers = [
    "question-and-answer session",
    "question and answer session",
    "question-and-answer",
    "question and answer",
    "q&a session",
    "q & a session",
    "operator:",
    "conference call operator",
  ];
  let best = -1;
  let bestM = "";
  for (const m of markers) {
    const i = lower.indexOf(m);
    if (i >= 0 && (best < 0 || i < best)) {
      best = i;
      bestM = m;
    }
  }
  if (best < 0) return { split_found: false, marker: null, prepared: raw, qa: "" };
  return {
    split_found: true,
    marker: bestM,
    prepared: String(raw).slice(0, best),
    qa: String(raw).slice(best),
  };
}

function herfindahlFromCounts(counts) {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { hhi: 0, normalized_concentration: 0, n: counts.filter((c) => c > 0).length };
  const shares = counts.map((c) => c / sum);
  const hhi = shares.reduce((acc, s) => acc + s * s, 0);
  const nEff = counts.filter((c) => c > 0).length;
  const norm = nEff > 1 ? (hhi - 1 / nEff) / (1 - 1 / nEff) : 0;
  return { hhi, normalized_concentration: Math.max(0, Math.min(1, norm)), n: nEff };
}

function topAiSentences(sentences, limit = 6) {
  const aiLex = THEME_LEXICONS.find((t) => t.id === "ai_core");
  const terms = aiLex ? aiLex.terms : [];
  const scored = sentences.map((sent) => {
    const sn = normalizeText(sent);
    const { total } = countTermHits(sn, terms);
    return { sentence: sent.slice(0, 280), score: total, wc: wordCount(sent) };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * @param {string} transcriptText
 * @returns {object}
 */
export function computeEarningsTranscriptLayer2(transcriptText) {
  const raw = String(transcriptText || "");
  const haystack = normalizeText(raw);
  const wc = wordCount(raw);
  const sentences = splitSentences(raw);
  const per1k = wc > 0 ? 1000 / wc : 0;

  const themes = THEME_LEXICONS.map((theme) => {
    const { total, byTerm } = countTermHits(haystack, theme.terms);
    return {
      id: theme.id,
      label: theme.label,
      hits: total,
      per_1000_words: Math.round(total * per1k * 10) / 10,
      top_matched_terms: byTerm.slice(0, 6),
    };
  });

  const themeHits = themes.map((t) => t.hits);
  const { hhi, normalized_concentration, n: activeThemes } = herfindahlFromCounts(themeHits);
  const topTheme = [...themes].sort((a, b) => b.hits - a.hits)[0];

  const fl = countPhraseList(haystack, FORWARD_LOOKING);
  const unc = countPhraseList(haystack, UNCERTAINTY);
  const sent = lexiconSentimentNet(haystack, LM_POSITIVE, LM_NEGATIVE);

  const seg = splitPreparedVsQA(raw);
  const prepNorm = normalizeText(seg.prepared);
  const qaNorm = normalizeText(seg.qa);
  const prepWc = wordCount(seg.prepared);
  const qaWc = wordCount(seg.qa);
  const sentPrep = prepWc > 40 ? lexiconSentimentNet(prepNorm, LM_POSITIVE, LM_NEGATIVE) : null;
  const sentQa = seg.split_found && qaWc > 40 ? lexiconSentimentNet(qaNorm, LM_POSITIVE, LM_NEGATIVE) : null;

  const aiCoreHits = themes.find((t) => t.id === "ai_core")?.hits || 0;
  const aiAllHits = themes.filter((t) => t.id.startsWith("ai_")).reduce((s, t) => s + t.hits, 0);
  const totalThemeHits = themeHits.reduce((a, b) => a + b, 0);
  const mp = prepWc > 0 ? 1000 / prepWc : 0;
  const mq = qaWc > 0 ? 1000 / qaWc : 0;

  const cross_quarter_fairness = {
    lexicon_positive_per_1000: Math.round((sent.positive_hits || 0) * per1k * 10) / 10,
    lexicon_negative_per_1000: Math.round((sent.negative_hits || 0) * per1k * 10) / 10,
    lexicon_net_per_1000: Math.round((sent.net || 0) * per1k * 10) / 10,
    ai_share_of_theme_hits:
      totalThemeHits > 0 ? Math.round((aiAllHits / totalThemeHits) * 1000) / 1000 : null,
    words_per_sentence: sentences.length > 0 ? Math.round((wc / sentences.length) * 10) / 10 : null,
    prepared_lexicon_net_per_1000:
      sentPrep && prepWc > 40 ? Math.round((sentPrep.net || 0) * mp * 10) / 10 : null,
    qa_lexicon_net_per_1000:
      sentQa && qaWc > 40 ? Math.round((sentQa.net || 0) * mq * 10) / 10 : null,
    use_for_comparisons:
      "Prefer per-1k rates and AI share of theme hits across quarters. Raw hit counts and net lexicon counts scale with transcript length; overall LLM scores (0–100) are already length-agnostic.",
  };

  return {
    version: 1,
    word_count: wc,
    sentence_count: sentences.length,
    ai_mentions_total: aiAllHits,
    ai_core_hits: aiCoreHits,
    ai_density_per_1000_words: Math.round(aiAllHits * per1k * 10) / 10,
    themes,
    theme_concentration: {
      herfindahl_hhi: Math.round(hhi * 1000) / 1000,
      normalized_0_1: Math.round(normalized_concentration * 1000) / 1000,
      active_theme_buckets: activeThemes,
      dominant_theme_id: topTheme?.id || null,
      dominant_theme_label: topTheme?.label || null,
      dominant_share_of_theme_hits:
        themeHits.reduce((a, b) => a + b, 0) > 0
          ? Math.round((topTheme.hits / themeHits.reduce((a, b) => a + b, 0)) * 1000) / 1000
          : 0,
    },
    forward_looking: {
      hits: fl.total,
      per_1000_words: Math.round(fl.total * per1k * 10) / 10,
      top_phrases: fl.byPhrase.slice(0, 8),
    },
    uncertainty_language: {
      hits: unc.total,
      per_1000_words: Math.round(unc.total * per1k * 10) / 10,
      top_phrases: unc.byPhrase.slice(0, 8),
    },
    sentiment_lexicon: {
      ...sent,
      positive_per_1000_words: cross_quarter_fairness.lexicon_positive_per_1000,
      negative_per_1000_words: cross_quarter_fairness.lexicon_negative_per_1000,
      net_per_1000_words: cross_quarter_fairness.lexicon_net_per_1000,
      label: "LM-style finance lexicon (subset)",
      caveat:
        "Lexicon counts are a baseline institutional benchmark; nuance and negation are not fully modeled. Pair with Layer-2 LLM read.",
    },
    cross_quarter_fairness,
    segments: {
      split_found: seg.split_found,
      marker: seg.marker,
      prepared_word_count: prepWc,
      qa_word_count: qaWc,
      prepared_sentiment: sentPrep,
      qa_sentiment: sentQa,
      qa_vs_prepared_net_delta:
        sentPrep && sentQa ? Math.round((sentQa.net - sentPrep.net) * 10) / 10 : null,
    },
    ai_sentence_spotlights: topAiSentences(sentences),
    methodology_blurb:
      "Theme lexicons + LM-inspired term lists quantify mention frequency and coarse tone. Cutting-edge buy-side workflows often layer this with LLM sentiment, topic importance weighting, and RAG over filings (see e.g. S&P Global Market Intelligence research on lexicon-to-LLM evolution, FinNLP multi-agent literature, and internal FinBERT-style models).",
  };
}
