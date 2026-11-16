// A comment's @-mentions, as text: the one box every comment is written in
// (components/comments/CommentComposer.jsx) and the words as they are read
// (MentionText.jsx).

// The unbroken "@word" the caret is at the end of, scanning back from it
// (the rule MessageComposer uses): { tokenStart, query },
// or null when the caret isn't in one.
export function detectMentionToken(text, caret) {
  let i = caret - 1;
  while (i >= 0 && /\S/.test(text[i]) && text[i] !== '@') i--;
  if (i < 0 || text[i] !== '@') return null;
  return { tokenStart: i, query: text.slice(i + 1, caret) };
}

// The ids of the people picked whose @name is still in the text when it's
// sent: someone can pick a person and then delete the mention again.
export function matchMentions(body, picked) {
  return [...new Set(picked.filter((m) => body.includes('@' + m.name)).map((m) => m.id))];
}

// Who an edit of a comment names that the comment did not name before: the
// only people an edit could have news for. (`before`, `after`: ids, or
// { id } objects.) A changed comment tells nobody today; this is what the
// doc.mention notice takes when it does.
export function addedMentionIds(before, after) {
  const id = (m) => (m && typeof m === 'object' ? m.id : m);
  const had = new Set((before || []).map(id).filter(Boolean));
  return [...new Set((after || []).map(id).filter((x) => x && !had.has(x)))];
}

// Letters and digits in any script, and the underscore: what a name may not
// run straight into, or out of.
const WORD = /[\p{L}\p{N}_]/u;

// A comment's words cut at its mentions, for drawing them as chips:
// [{ type: 'text', text } | { type: 'mention', id, name }]. Only "@Name" for
// the people in `mentions` counts (anyone else's "@word" stays text), the
// longest name first so "@Jon Park" isn't read as "@Jon", and never inside a
// word: "mail@Jon" and "@Jonathan" are text.
export function mentionSegments(body, mentions) {
  const text = String(body ?? '');
  if (!text) return [];
  const names = [];
  const seen = new Set();
  for (const m of Array.isArray(mentions) ? mentions : []) {
    if (!m || !m.id || typeof m.name !== 'string' || !m.name || seen.has(m.name)) continue;
    seen.add(m.name);
    names.push(m);
  }
  names.sort((a, b) => b.name.length - a.name.length);
  const out = [];
  let from = 0;
  const push = (to) => { if (to > from) out.push({ type: 'text', text: text.slice(from, to) }); };
  if (names.length) {
    for (let i = text.indexOf('@'); i !== -1; i = text.indexOf('@', i + 1)) {
      if (i < from) continue;
      if (i > 0 && WORD.test(charBefore(text, i))) continue;
      const hit = names.find((m) => text.startsWith(m.name, i + 1)
        && !WORD.test(charAt(text, i + 1 + m.name.length)));
      if (!hit) continue;
      push(i);
      out.push({ type: 'mention', id: hit.id, name: hit.name });
      from = i + 1 + hit.name.length;
    }
  }
  push(text.length);
  return out;
}

// The people still mentioned in the words, each once, in the order they come:
// [{ id, name }]. The one rule for what a comment sends, what its draft keeps
// and what is drawn as a chip, so the three never disagree.
export function mentionsIn(body, picked) {
  const out = [];
  const seen = new Set();
  for (const s of mentionSegments(body, picked)) {
    if (s.type !== 'mention' || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, name: s.name });
  }
  return out;
}

function charAt(text, i) {
  const cp = text.codePointAt(i);
  return cp == null ? '' : String.fromCodePoint(cp);
}
function charBefore(text, i) {
  const lo = text.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) return String.fromCodePoint(text.codePointAt(i - 2));
  return text[i - 1];
}

// Lower case with the accents off, for finding a person as they are typed:
// "zoe" finds "Zoë", "manon l" finds "Manon Leclerc".
export function foldName(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

// The people an "@query" offers, at most `max`: names that start with it
// first, then names with a word that starts with it, then names that hold it.
// The order given is kept inside each of those.
export function filterMentionPeople(people, query, max = 6) {
  const q = foldName(query).trim();
  const list = (Array.isArray(people) ? people : []).filter((p) => p && p.id && p.name);
  if (!q) return list.slice(0, max);
  const tiers = [[], [], []];
  for (const p of list) {
    const n = foldName(p.name);
    if (n.startsWith(q)) tiers[0].push(p);
    else if (n.split(/\s+/).some((w) => w.startsWith(q))) tiers[1].push(p);
    else if (n.includes(q)) tiers[2].push(p);
  }
  return tiers.flat().slice(0, max);
}

// The "@word" the caret is in, for the picker: detectMentionToken, but only
// when the "@" starts a word ("mail@jo" opens nothing). A query may hold
// `spaces` spaces (one unless told; the picker passes what the longest name
// it offers has) so "@Manon L" keeps narrowing. A token that already starts
// with a picked name and a space is finished: "@Jon Park a" opens nothing
// once Jon Park was picked. { tokenStart, query } or null.
export function mentionQueryAt(text, caret, { spaces = 1, picked = null } = {}) {
  const s = String(text ?? '');
  const upto = s.slice(0, caret);
  const n = Math.max(0, Math.min(8, Math.floor(Number(spaces)) || 0));
  const m = new RegExp(`(^|[^\\p{L}\\p{N}_@])@([^\\s@]*(?: [^\\s@]+){0,${n}})$`, 'u').exec(upto);
  if (!m) return null;
  const query = m[2];
  for (const p of Array.isArray(picked) ? picked : []) {
    if (p && typeof p.name === 'string' && p.name && query.startsWith(p.name + ' ')) return null;
  }
  return { tokenStart: upto.length - query.length - 1, query };
}

// How many spaces the longest name among the people has: what the picker
// lets a query hold.
export function mentionQuerySpaces(people) {
  let most = 0;
  for (const p of Array.isArray(people) ? people : []) {
    const k = typeof p?.name === 'string' && p.name.trim() ? p.name.trim().split(/\s+/).length - 1 : 0;
    if (k > most) most = k;
  }
  return most;
}
