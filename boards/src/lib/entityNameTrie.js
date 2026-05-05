// In-memory Trie of normalized entity names → entity records.
// Used by the auto-detect plugin and the @-mention picker.
//
// Records: { kind, id, name, boardId?, cardId?, docCardId? }
//
// Matches are word-boundary-anchored: "we organized things" doesn't fire
// "organization" — only standalone tokens do.

export function createNameIndex() {
  const root = node();
  let recordsCache = [];

  function add(record) {
    const key = norm(record.name);
    if (!key) return;
    let n = root;
    for (const ch of key) { n = n.children[ch] || (n.children[ch] = node()); }
    if (!n.records.find(r => sameRecord(r, record))) n.records.push(record);
    recordsCache.push(record);
  }

  function clear() {
    root.children = {};
    root.records = [];
    recordsCache = [];
  }

  // Find the longest matching entity-name span starting at position `start`
  // in `text`. Match must end at a word boundary. Returns null on no match.
  function longestMatchAt(text, start) {
    let n = root;
    let bestEnd = -1;
    let bestRecords = null;
    let i = start;
    while (i < text.length) {
      const ch = norm1(text[i]);
      if (ch == null) {
        // Hit a non-word char. If we have a complete match, lock it in.
        if (n.records.length && atWordBoundary(text, i)) {
          bestEnd = i; bestRecords = n.records;
        }
        break;
      }
      n = n.children[ch];
      if (!n) break;
      i++;
      if (n.records.length && (i === text.length || atWordBoundary(text, i))) {
        bestEnd = i; bestRecords = n.records;
      }
    }
    if (bestEnd > start && bestRecords) {
      return { start, end: bestEnd, records: bestRecords };
    }
    return null;
  }

  // Iterate every match in a text range. Non-overlapping, longest-first.
  function* findMatches(text, fromIndex = 0, toIndex = text.length) {
    let i = fromIndex;
    while (i < toIndex) {
      while (i < toIndex && !isWordChar(text[i])) i++;
      if (i >= toIndex) break;
      const m = longestMatchAt(text, i);
      if (m && m.end <= toIndex) { yield m; i = m.end; }
      else { i++; }
    }
  }

  return {
    add, clear, longestMatchAt, findMatches,
    get records() { return recordsCache; },
  };
}

function node() { return { children: {}, records: [] }; }
function norm(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function norm1(ch) {
  // Word chars + spaces flatten to a single space in the Trie key.
  // Anything else (punctuation) breaks the match.
  if (/[A-Za-z0-9]/.test(ch)) return ch.toLowerCase();
  if (/\s/.test(ch)) return ' ';
  return null;
}
function isWordChar(ch) { return /[A-Za-z0-9]/.test(ch); }
function atWordBoundary(text, pos) { return pos >= text.length || !isWordChar(text[pos]); }
function sameRecord(a, b) { return a.kind === b.kind && a.id === b.id; }
