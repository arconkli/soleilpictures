// Keeping a doc's range tags on their words as the text changes.
//
// A range tag is an entity_links row whose source_anchor is
// { pHash, startOffset, length[, text] }. pHash is the hash of the paragraph
// the word sits in (extractParagraphTags), so editing that paragraph orphans
// the anchor. What happens to an orphan depends on who made it:
//   * the cascade's own rows (AUTO_RANGE_SOURCES) are dropped; its next run
//     derives them again from the new text;
//   * anything else, a person's tag, is never dropped. It moves to the same
//     word in the page's current text (the anchor's text, else the tag's
//     name), or, when the word is gone, becomes a tag on the whole page.
// The cascade's garbage collection used to delete every orphan, so fixing a
// typo next to a promoted name silently deleted the person's tag.
//
// Pure (node-tested in docRangeReconcile.test.mjs); reconcilePageRanges in
// aiParagraphCascade.js applies a plan.

export const AUTO_RANGE_SOURCES = ['auto-word', 'auto-word-medium', 'auto-paragraph'];

const anchorKey = (tagId, a) => `${tagId}|${a.pHash}|${a.startOffset}|${a.length}`;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A letter or digit on either side means the match is inside a longer word.
// (Checked by hand: regex lookbehind needs Safari 16.4.)
const WORD_CHAR = /[\p{L}\p{N}]/u;

// The first whole-word occurrence of `word` in the page's paragraphs that no
// other range of the same tag already holds.
export function findWordAnchor(paragraphs, word, tagId, taken) {
  const w = String(word || '').trim();
  if (!w) return null;
  const re = new RegExp(escapeRe(w), 'gi');
  for (const p of paragraphs || []) {
    const text = String(p?.text || '');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = text[m.index - 1] || '';
      const after = text[m.index + m[0].length] || '';
      if (WORD_CHAR.test(before) || WORD_CHAR.test(after)) continue;
      const hit = { pHash: p.pHash, startOffset: m.index, length: m[0].length, text: m[0] };
      if (!taken.has(anchorKey(tagId, hit))) return hit;
    }
  }
  return null;
}

// rows: [{ id, source, target_id, source_anchor }]
// paragraphs: [{ pHash, text }], the page as it is now
// nameOf(tagId): the tag's name, the fallback word to look for
// Pure: returns { drop: [id], move: [{ id, anchor }], toPage: [id] }.
export function planRangeReconcile(rows, paragraphs, nameOf = () => '') {
  const live = new Set((paragraphs || []).map((p) => p.pHash));
  const taken = new Set();
  for (const r of rows || []) {
    const a = r?.source_anchor;
    if (a?.pHash && live.has(a.pHash)) taken.add(anchorKey(r.target_id, a));
  }
  const drop = [];
  const move = [];
  const toPage = [];
  for (const r of rows || []) {
    const a = r?.source_anchor;
    if (!a?.pHash || live.has(a.pHash)) continue;
    if (AUTO_RANGE_SOURCES.includes(r.source)) {
      drop.push(r.id);
      continue;
    }
    const hit = findWordAnchor(paragraphs, a.text || nameOf(r.target_id), r.target_id, taken);
    if (hit) {
      taken.add(anchorKey(r.target_id, hit));
      move.push({ id: r.id, anchor: { ...a, ...hit } });
    } else {
      toPage.push(r.id);
    }
  }
  return { drop, move, toPage };
}
