// Tagging-quality eval. Pure functions — no Supabase, no DOM, no
// embedder. Callers compute distances and pass them in; runEval
// produces precision / recall / F1 / confusion matrix / per-row
// disagreements against hand-labeled ground truth.
//
// Used by AdminTaggingTab to:
//   1. Score the current AUTO_DIST against the test set.
//   2. Drive a what-if slider that recomputes metrics live.
//
// Decoupling distance computation from the metric math means we can
// unit-test this with synthetic inputs and reuse it for any future
// threshold sweep / auto-tune.

// Decide what the system would do at a given (autoDist, suggestDist)
// given a cosine distance:
//   < autoDist                → 'should_apply'   (auto-apply band)
//   autoDist .. suggestDist   → suggestion (counted as 'should_apply'
//                                            for eval purposes — a
//                                            suggestion still surfaces
//                                            the tag for the user)
//   >= suggestDist            → 'should_not_apply'
//
// Treating the SUGGEST band as a "yes" matches the user's recall
// target: every tag a user would apply should at least appear in the
// inbox. If you want a stricter "auto-apply only" eval, pass the
// same value for both thresholds.
export function predictLabel(distance, autoDist, suggestDist) {
  if (distance < suggestDist) return 'should_apply';
  return 'should_not_apply';
}

// runEval — the core function.
//
// labels:       [{ tag_id, source_kind, source_id, label, ... }]
// scoredPairs:  [{ tag_id, source_kind, source_id, distance }]
// autoDist:     auto-apply threshold (cosine distance)
// suggestDist:  suggestion-band upper bound (cosine distance)
//
// For each label, look up the corresponding distance in scoredPairs.
// Labels without a matching pair are ignored (and listed in
// `unmatched`). For each matched pair, compare predicted vs. labeled.
export function runEval({ labels, scoredPairs, autoDist, suggestDist }) {
  const byKey = new Map();
  for (const p of scoredPairs) byKey.set(pairKey(p), p);

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const disagreements = [];
  const matched = [];
  const unmatched = [];

  for (const lab of labels) {
    const pair = byKey.get(pairKey(lab));
    if (!pair) { unmatched.push(lab); continue; }
    const predicted = predictLabel(pair.distance, autoDist, suggestDist);
    const truth = lab.label;
    const row = { ...lab, distance: pair.distance, predicted };
    matched.push(row);
    if (truth === 'should_apply' && predicted === 'should_apply')       tp += 1;
    else if (truth === 'should_apply' && predicted === 'should_not_apply') { fn += 1; disagreements.push(row); }
    else if (truth === 'should_not_apply' && predicted === 'should_apply') { fp += 1; disagreements.push(row); }
    else                                                                tn += 1;
  }

  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall    = tp + fn === 0 ? null : tp / (tp + fn);
  const f1        = (precision == null || recall == null || precision + recall === 0)
    ? null
    : (2 * precision * recall) / (precision + recall);

  return {
    confusion: { tp, fp, tn, fn },
    precision,
    recall,
    f1,
    disagreements,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
  };
}

function pairKey(p) {
  return `${p.tag_id}::${p.source_kind}::${p.source_id}`;
}

// Histogram helper — bins distances into N buckets across [0, max).
// Used by the per-tag drill-down to visualize the distribution of
// distances from a tag's centroid to every card in the workspace.
//
// rows: [{ distance, applied: bool }]
// Returns: [{ from, to, applied, notApplied }] of length `bins`.
export function buildHistogram(rows, { bins = 10, max = 0.55 } = {}) {
  const step = max / bins;
  const out = Array.from({ length: bins }, (_, i) => ({
    from: i * step,
    to: (i + 1) * step,
    applied: 0,
    notApplied: 0,
  }));
  for (const r of rows) {
    if (r.distance >= max) continue; // outside the chart — drop
    let idx = Math.floor(r.distance / step);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    if (r.applied) out[idx].applied += 1;
    else           out[idx].notApplied += 1;
  }
  return out;
}

// Summary stats for a tag's distance distribution. Used by the
// overview table — gives a single-number sense of "how tight is this
// centroid."
export function summarize(distances) {
  if (!distances.length) return { count: 0, mean: null, p50: null, p95: null, max: null };
  const sorted = [...distances].sort((a, b) => a - b);
  const mean = sorted.reduce((s, d) => s + d, 0) / sorted.length;
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    count: sorted.length,
    mean,
    p50: p(0.5),
    p95: p(0.95),
    max: sorted[sorted.length - 1],
  };
}
