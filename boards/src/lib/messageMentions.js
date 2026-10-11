// Find @mention pills in a chat message's text. Pure, so node --test can pin it.
//
// It used to be one greedy regex, /@([a-zA-Z0-9_'’\- ]{1,40})/, which let
// spaces in and so ate the rest of the sentence: "@Sam Smith can you check the
// lighting" became a single 40-character pill (COMMS-05). A pill now covers
// only a name the message actually carries — a mentioned person's name or an
// attached entity's title — matched longest first, so "@Sam Smith" beats
// "@Sam" and "@Sam" never swallows "@Samantha".
//
// When the message has mentions whose names aren't resolved yet (profiles
// load async), a bare "@word" still pills — one word, never a phrase.

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const ONE_WORD = /^[\p{L}\p{N}_'’-]{1,40}/u;

// targets: [{ name, ...anything }] — the hit is handed back on the segment.
// Returns [{ text }] and [{ text, mention: target | null }] segments in order;
// mention null means "looks like a mention, name not resolved".
export function scanMentions(str, targets = [], { allowUnresolved = false } = {}) {
  if (!str) return [];
  const names = [];
  for (const t of targets) {
    const name = String(t?.name || '').trim();
    if (name) names.push({ lower: name.toLowerCase(), len: name.length, target: t });
  }
  names.sort((a, b) => b.len - a.len);

  const out = [];
  const lower = str.toLowerCase();
  let from = 0;
  let i = str.indexOf('@');
  while (i !== -1) {
    // An @ glued to a word ("me@studio.com") is not a mention.
    const glued = i > 0 && WORD_CHAR.test(str[i - 1]);
    let len = 0; let hit = null;
    if (!glued) {
      for (const n of names) {
        if (lower.startsWith(n.lower, i + 1) && !WORD_CHAR.test(str[i + 1 + n.len] || '')) {
          len = n.len; hit = n.target; break;
        }
      }
      if (!hit && allowUnresolved) {
        const w = ONE_WORD.exec(str.slice(i + 1));
        if (w) len = w[0].length;
      }
    }
    if (len > 0) {
      if (i > from) out.push({ text: str.slice(from, i) });
      out.push({ text: str.slice(i, i + 1 + len), mention: hit });
      from = i + 1 + len;
      i = str.indexOf('@', from);
    } else {
      i = str.indexOf('@', i + 1);
    }
  }
  if (from < str.length) out.push({ text: str.slice(from) });
  return out;
}
