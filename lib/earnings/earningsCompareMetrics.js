/**
 * Parse "Q1 2025" style labels, sort chronologically, and pair QoQ / YoY for earnings history.
 */

/** @param {string} s */
export function parseQuarterLabel(s) {
  const m = String(s || "")
    .trim()
    .match(/^Q([1-4])\s+(\d{4})$/i);
  if (!m) return null;
  const q = +m[1];
  const y = +m[2];
  return { q, y, ordinal: y * 4 + (q - 1), label: `Q${q} ${y}` };
}

/**
 * @param {object[]} entries raw ec_history items with .quarter
 * @returns {object[]} entries with _pq (parsed) or _pq: null; sortable
 */
export function attachParsedQuarters(entries) {
  return (entries || []).map((e) => ({
    ...e,
    _pq: parseQuarterLabel(e.quarter),
  }));
}

/**
 * Chronological order. Unparseable quarters sort last (stable).
 * @param {object[]} entriesWithPq from attachParsedQuarters
 */
export function sortEarningsChronologically(entriesWithPq) {
  const rank = (e) => (e._pq ? e._pq.ordinal : Number.MAX_SAFE_INTEGER);
  return [...entriesWithPq].sort((a, b) => rank(a) - rank(b) || String(a.quarter || "").localeCompare(String(b.quarter || "")));
}

/**
 * Backfill cross_quarter_fairness on older saved layer2_quant blobs.
 * @param {object|null} quant
 */
export function ensureCrossQuarterFairness(quant) {
  if (!quant || typeof quant !== "object") return quant;
  if (quant.cross_quarter_fairness) return quant;
  const wc = quant.word_count || 0;
  const m = wc > 0 ? 1000 / wc : 0;
  const s = quant.sentiment_lexicon || {};
  const themes = quant.themes || [];
  const totalThemeHits = themes.reduce((acc, t) => acc + (t.hits || 0), 0);
  const aiAll = quant.ai_mentions_total ?? themes.filter((t) => String(t.id || "").startsWith("ai_")).reduce((a, t) => a + (t.hits || 0), 0);
  const sc = quant.segments || {};
  const prep = sc.prepared_sentiment;
  const qa = sc.qa_sentiment;
  const prepWc = sc.prepared_word_count || 0;
  const qaWc = sc.qa_word_count || 0;
  const mp = prepWc > 0 ? 1000 / prepWc : 0;
  const mq = qaWc > 0 ? 1000 / qaWc : 0;
  quant.cross_quarter_fairness = {
    lexicon_positive_per_1000: Math.round((s.positive_hits || 0) * m * 10) / 10,
    lexicon_negative_per_1000: Math.round((s.negative_hits || 0) * m * 10) / 10,
    lexicon_net_per_1000: Math.round((s.net || 0) * m * 10) / 10,
    ai_share_of_theme_hits:
      totalThemeHits > 0 ? Math.round((aiAll / totalThemeHits) * 1000) / 1000 : null,
    words_per_sentence:
      (quant.sentence_count || 0) > 0 ? Math.round((wc / quant.sentence_count) * 10) / 10 : null,
    prepared_lexicon_net_per_1000:
      prep && prepWc > 40 ? Math.round((prep.net || 0) * mp * 10) / 10 : null,
    qa_lexicon_net_per_1000:
      qa && qaWc > 40 ? Math.round((qa.net || 0) * mq * 10) / 10 : null,
    use_for_comparisons:
      "Prefer per-1k rates and AI share of theme hits across quarters. Raw lexicon counts scale with length; LLM 0–100 scores are not word-normalized.",
  };
  return quant;
}

/**
 * Mean and sample std for an array of numbers.
 * @param {number[]} vals
 */
function meanStd(vals) {
  const v = vals.filter((x) => typeof x === "number" && !Number.isNaN(x));
  if (v.length === 0) return { mean: 0, std: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (v.length < 2) return { mean, std: 0 };
  const varc = v.reduce((a, x) => a + (x - mean) ** 2, 0) / (v.length - 1);
  return { mean, std: Math.sqrt(varc) || 0 };
}

/** @param {number} x @param {number} mean @param {number} std */
export function zScore(x, mean, std) {
  if (std < 1e-9) return 0;
  return (x - mean) / std;
}

/**
 * Attach z-scores vs company cohort for key volume/rate metrics.
 * @param {object[]} sortedChronological entries with layer2_quant + cross_quarter_fairness
 */
export function attachCompanyZScores(sortedChronological) {
  const wcs = sortedChronological.map((e) => e.layer2_quant?.word_count).filter((x) => x > 0);
  const ai = sortedChronological.map((e) => e.layer2_quant?.ai_density_per_1000_words).filter((x) => typeof x === "number");
  const net1k = sortedChronological
    .map((e) => e.layer2_quant?.cross_quarter_fairness?.lexicon_net_per_1000)
    .filter((x) => typeof x === "number");
  const wcStats = meanStd(wcs);
  const aiStats = meanStd(ai);
  const netStats = meanStd(net1k);
  return sortedChronological.map((e) => {
    const q = e.layer2_quant;
    const fq = q?.cross_quarter_fairness;
    if (!q) return { ...e, _z: null };
    return {
      ...e,
      _z: {
        word_count: zScore(q.word_count || 0, wcStats.mean, wcStats.std),
        ai_density_per_1000: zScore(q.ai_density_per_1000_words || 0, aiStats.mean, aiStats.std),
        lexicon_net_per_1000: zScore(fq?.lexicon_net_per_1000 ?? 0, netStats.mean, netStats.std),
      },
    };
  });
}

/**
 * @param {object} sortedEntry with _pq
 * @param {object[]} sortedAll same company, chronological
 * @param {number} index
 */
export function getQoQPeer(sortedAll, index) {
  if (index <= 0) return null;
  return sortedAll[index - 1];
}

/**
 * Same fiscal quarter, prior calendar year (latest matching row before current index).
 * @param {object[]} sortedAll chronological
 * @param {number} index
 */
export function getYoYPeer(sortedAll, index) {
  const cur = sortedAll[index]?._pq;
  if (!cur) return null;
  let best = null;
  let bestOrd = -1;
  for (let j = 0; j < index; j++) {
    const e = sortedAll[j];
    if (!e._pq) continue;
    if (e._pq.q === cur.q && e._pq.y === cur.y - 1 && e._pq.ordinal > bestOrd) {
      best = e;
      bestOrd = e._pq.ordinal;
    }
  }
  return best;
}

function numDelta(a, b) {
  if (typeof a !== "number" || typeof b !== "number" || Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) * 10) / 10;
}

/**
 * @param {object} entry
 * @param {object|null} prior
 */
export function compareFairMetrics(entry, prior) {
  const q = entry?.layer2_quant;
  const pq = prior?.layer2_quant;
  const ef = q?.cross_quarter_fairness;
  const pf = pq?.cross_quarter_fairness;
  if (!q || !pq) return null;
  return {
    overall_score: numDelta(entry.overall_quality_score, prior.overall_quality_score),
    ai_density_per_1000: numDelta(q.ai_density_per_1000_words, pq.ai_density_per_1000_words),
    lexicon_net_per_1000: numDelta(ef?.lexicon_net_per_1000, pf?.lexicon_net_per_1000),
    forward_per_1000: numDelta(q.forward_looking?.per_1000_words, pq.forward_looking?.per_1000_words),
    uncertainty_per_1000: numDelta(q.uncertainty_language?.per_1000_words, pq.uncertainty_language?.per_1000_words),
    ai_share_of_theme_hits: numDelta(ef?.ai_share_of_theme_hits, pf?.ai_share_of_theme_hits),
    word_count: numDelta(q.word_count, pq.word_count),
    theme_hhi: numDelta(q.theme_concentration?.herfindahl_hhi, pq.theme_concentration?.herfindahl_hhi),
  };
}
