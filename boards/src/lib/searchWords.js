// ⌘K search words. Each command keeps its English words and gains a translatable
// message holding the same words (comma-separated); a person can then find the
// command by typing either. CommandPalette matches the keywords and never shows them.
//
// In English the translated message is the English words joined, so the array
// comes back unchanged. Otherwise: the English words, then the translated words
// split on , 、 ， ; each trimmed and lower-cased, empties and repeats dropped
// (the first is kept).
export function searchWords(english, translated) {
  if (typeof translated !== 'string' || translated === english.join(', ')) return english;
  const out = [];
  const seen = new Set();
  for (const raw of [...english, ...translated.split(/[,、，;]/)]) {
    const word = String(raw).trim().toLowerCase();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}
