// Split a paragraph's plain text into sentence spans. Each span is
// returned with its offset inside the paragraph so callers can build
// entity_links source_anchor rows ({ pHash, startOffset, length }) for
// sentence-level or word+context-level tag applies.
//
// Tokenizer: basic /[.!?]\s+/ boundary. Doesn't handle abbreviations
// like "Mr. Smith" or "U.S." perfectly — those will occasionally
// over-split. Acceptable for v1; we can swap in a smarter splitter
// later if it becomes a real problem.

export function splitSentences(text) {
  if (!text) return [];
  const t = String(text);
  const out = [];
  const re = /[.!?]+\s+/g;          // boundary AFTER terminal punctuation
  let last = 0;
  let m;
  while ((m = re.exec(t)) !== null) {
    const end = m.index + m[0].length;
    const slice = t.slice(last, end).trimEnd();
    if (slice.length > 0) {
      out.push({
        text: slice,
        startOffset: last,
        length: slice.length,
      });
    }
    last = end;
  }
  if (last < t.length) {
    const tail = t.slice(last).trimEnd();
    if (tail.length > 0) {
      out.push({
        text: tail,
        startOffset: last,
        length: tail.length,
      });
    }
  }
  return out;
}

// For a single word match inside a paragraph, build a "word + context"
// span — the matched range plus up to `wordsAround` whitespace-delimited
// words on each side. Returns { startOffset, length } clipped to the
// paragraph bounds.
export function wordContextSpan(text, matchStart, matchEnd, wordsAround = 3) {
  const t = String(text || '');
  if (matchStart < 0 || matchEnd > t.length || matchEnd <= matchStart) {
    return { startOffset: Math.max(0, matchStart), length: Math.max(0, matchEnd - matchStart) };
  }
  // Walk backward to absorb `wordsAround` whitespace-separated tokens.
  let s = matchStart;
  let backWordsLeft = wordsAround;
  while (s > 0 && backWordsLeft > 0) {
    // Skip whitespace immediately before s.
    while (s > 0 && /\s/.test(t[s - 1])) s--;
    if (s === 0) break;
    // Eat a word.
    while (s > 0 && !/\s/.test(t[s - 1])) s--;
    backWordsLeft--;
  }
  // Walk forward likewise.
  let e = matchEnd;
  let fwdWordsLeft = wordsAround;
  while (e < t.length && fwdWordsLeft > 0) {
    while (e < t.length && /\s/.test(t[e])) e++;
    if (e === t.length) break;
    while (e < t.length && !/\s/.test(t[e])) e++;
    fwdWordsLeft--;
  }
  return { startOffset: s, length: e - s };
}
