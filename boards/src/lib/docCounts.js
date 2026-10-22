// A doc's words and characters, as its footer and a phone's ⋯ count them. A
// word ends at a block's end and at a line break as well as at a space (the
// doc's textContent runs one paragraph's last word into the next one's
// first); a character is one typed, not a break between blocks.
export function docCounts(doc) {
  if (!doc) return { words: 0, chars: 0 };
  const spaced = doc.textBetween(0, doc.content.size, ' ', ' ').trim();
  return { words: spaced ? spaced.split(/\s+/).length : 0, chars: doc.textContent.length };
}
