// docText — a document's words, read straight off its Y types.
//
// Search inside documents (Drive basics, item 4) needs every doc's text in
// doc_page_index, and until now the only writer was the doc EDITOR: a doc that
// nobody had opened since that index existed was invisible to search, however
// much was written in it. Board saves now index every doc on the board
// (boardsApi), and they need the text without an editor or a DOM — which is
// what this is.
//
// It also fixes what the old DOM path produced. textContent concatenates text
// nodes with nothing between blocks, so "Exterior.\nNight." indexed as
// "Exterior.Night." and a search for "night" at a word start missed it. Here a
// block boundary is a word boundary.
//
// Pure (yjs only), so it tests under node with real Y.Docs.

import * as Y from 'yjs';

export function fragmentText(node) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n instanceof Y.XmlText) {
      for (const op of n.toDelta()) if (typeof op.insert === 'string') out.push(op.insert);
      return;
    }
    if (n instanceof Y.XmlElement || n instanceof Y.XmlFragment) {
      for (const child of n.toArray()) walk(child);
      out.push(' ');
    }
  };
  walk(node);
  return out.join('').replace(/\s+/g, ' ').trim();
}

const sheetIdOf = (s) => (s && typeof s.get === 'function' ? s.get('id') : s?.id) || null;

// The pages of a doc held on a card (docState.cardScope's layout), each with its
// text: the page's primary fragment, then any extra sheets, in order.
export function docPagesText(cardYMap) {
  const get = (k) => (cardYMap && typeof cardYMap.get === 'function' ? cardYMap.get(k) : null);
  const pages = get('docPages');
  if (!pages || typeof pages.toArray !== 'function') return [];
  const content = get('docPageContent');
  const sheets = get('docPageSheets');
  const sheetContent = get('docSheetContent');
  const out = [];
  for (const raw of pages.toArray()) {
    const page = raw && typeof raw.toJSON === 'function' ? raw.toJSON() : raw;
    if (!page?.id) continue;
    const parts = [fragmentText(content?.get?.(page.id))];
    const list = sheets?.get?.(page.id);
    for (const s of (list && typeof list.toArray === 'function' ? list.toArray() : [])) {
      const sid = sheetIdOf(s);
      if (sid && sid !== page.id) parts.push(fragmentText(sheetContent?.get?.(sid)));
    }
    out.push({ id: page.id, name: String(page.name || ''), text: parts.filter(Boolean).join(' ').trim() });
  }
  return out;
}

// A cheap fingerprint of what the index would hold, so a board save that did
// not touch a doc does not rewrite its rows. djb2 over the text, plus ids and
// names; collisions only cost one skipped (and later corrected) write.
export function docSignature(pages) {
  let h = 5381;
  const mix = (s) => { for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; };
  for (const p of pages || []) { mix(p.id); mix('\u0001'); mix(p.name); mix('\u0001'); mix(p.text); mix('\u0002'); }
  return `${(pages || []).length}:${h >>> 0}`;
}

// The words around the first match, for a search result. Whole words at the
// edges, an ellipsis where the text was cut.
export function snippetAround(text, query, radius = 60) {
  const s = String(text || '');
  const q = String(query || '').trim().toLowerCase();
  if (!s) return '';
  const i = q ? s.toLowerCase().indexOf(q) : -1;
  if (i < 0) return s.length > radius * 2 ? `${s.slice(0, radius * 2).replace(/\s+\S*$/, '')}…` : s;
  let a = Math.max(0, i - radius);
  let b = Math.min(s.length, i + q.length + radius);
  if (a > 0) { const sp = s.indexOf(' ', a); if (sp > -1 && sp < i) a = sp + 1; }
  if (b < s.length) { const sp = s.lastIndexOf(' ', b); if (sp > i + q.length) b = sp; }
  return `${a > 0 ? '…' : ''}${s.slice(a, b)}${b < s.length ? '…' : ''}`;
}
