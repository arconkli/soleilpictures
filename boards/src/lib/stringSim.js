// String similarity helpers shared between tag UI bits.
//
// levenshtein: capped edit distance. Caller passes a maxDist for early-exit;
// if the true distance exceeds it the function returns maxDist + 1.
//
// normalizeName: the canonical form we compare names in — lowercase, trimmed,
// internal whitespace collapsed.
//
// namesAreSimilar: the rule we use to decide whether two suggestion names
// should collapse into one. Returns the match kind for debugging/inspection
// or null when the names are distinct.

export function levenshtein(a, b, maxDist = 3) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > maxDist) return maxDist + 1;
  if (!al) return bl;
  if (!bl) return al;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const curr = new Array(bl + 1);
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = curr;
  }
  return prev[bl];
}

export function normalizeName(s) {
  return (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
}

// Decide whether two names refer to the same concept for dedup purposes.
//   'exact'     — same normalized string
//   'substring' — one normalized name fully contains the other (and the
//                 shorter is ≥ 4 chars, to avoid e.g. "ad" matching "branding")
//   'near'      — Levenshtein distance ≤ 2 on the normalized forms, with both
//                 names ≥ 4 chars (catches typos / minor variants)
//   null        — not similar enough to merge
export function namesAreSimilar(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return null;
  if (na === nb) return 'exact';
  const shorter = na.length <= nb.length ? na : nb;
  const longer = shorter === na ? nb : na;
  if (shorter.length >= 4 && longer.includes(shorter)) return 'substring';
  if (na.length >= 4 && nb.length >= 4) {
    const d = levenshtein(na, nb, 2);
    if (d <= 2) return 'near';
  }
  return null;
}
