// starterDocs — documents a page promises, written when its visitor arrives.
//
// /tools/directors-treatment is titled "Director's Treatment Template", and
// until now pressing its button gave a blank board — the page described a
// template and the product never handed one over. Pressing it now notes the
// request (starterIntent.js) and the signed-in app writes this document onto
// the cluster that opens: a cover, then a page per section, each headed and
// with a line on what goes there. The sections are the SAME list the page
// prints as its steps (starterSections.js, which seoLanding.js reads), so the
// page and the document cannot come to disagree about what a treatment holds.
//
// Pure: plain ProseMirror JSON, written by docState.writeScriptBody — one page
// at a time, inside the card's own creation transaction.
//
// It is placed as a SEED (not indexed, not counted, stamping no activation) and
// stays one only while it is untouched: the first change to what it holds —
// a word typed, a prompt deleted, a page renamed or added, an image dropped in
// — makes it the person's own work, and App drops the flag
// (isPristineStarter, below). From then on it is indexed like any document:
// searchable, counted as one card, and the activation it now represents is
// stamped when it happens rather than when we placed a template.

import * as Y from 'yjs';
import { fragmentText } from './docText.js';
import { initCardDocStore, cardScope, writeScriptBody } from './docState.js';
import { TREATMENT_SECTIONS, isStarterKind } from './starterSections.js';

export { TREATMENT_SECTIONS, TREATMENT_EXPORT_STEP, treatmentPageSteps, isStarterKind, STARTER_KINDS } from './starterSections.js';

const heading = (text, level = 1) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

export const STARTER_DOCS = Object.freeze({
  treatment: Object.freeze({
    title: 'Director’s treatment',
    pages: Object.freeze([
      { name: 'Cover', content: [heading('Untitled treatment'), paragraph('Director · Production company · Draft date')] },
      ...TREATMENT_SECTIONS.map((s) => ({ name: s.t, content: [heading(s.t), paragraph(s.prompt)] })),
    ]),
  }),
});

// Where a starter document goes on a board that already has things on it:
// beside them, top-aligned, rather than on top of the first one. A centre, as
// addStarterDoc takes it (it subtracts half the card). Null on an empty board.
export function starterDocSpot(cards, { w = 320, h = 240, gap = 80 } = {}) {
  const live = (cards || []).filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y));
  if (!live.length) return null;
  const right = Math.max(...live.map((c) => c.x + (Number.isFinite(c.w) ? c.w : 0)));
  const top = Math.min(...live.map((c) => c.y));
  return { x: right + gap + w / 2, y: top + h / 2 };
}

// What a doc card holds, as a comparable string: each page's name, its words
// and how many blocks it has, in page order. Ids are left out — they differ
// from card to card — so two untouched starters fingerprint the same.
export function docFingerprint(cardYMap) {
  const get = (k) => (cardYMap && typeof cardYMap.get === 'function' ? cardYMap.get(k) : null);
  const pages = get('docPages');
  if (!pages || typeof pages.toArray !== 'function') return '[]';
  const content = get('docPageContent');
  const sheets = get('docPageSheets');
  const sheetContent = get('docSheetContent');
  const out = [];
  for (const raw of pages.toArray()) {
    const p = raw && typeof raw.toJSON === 'function' ? raw.toJSON() : raw;
    if (!p?.id) continue;
    const frags = [content?.get?.(p.id)];
    const list = sheets?.get?.(p.id);
    for (const s of (list && typeof list.toArray === 'function' ? list.toArray() : [])) {
      const sid = s && typeof s.get === 'function' ? s.get('id') : s?.id;
      if (sid && sid !== p.id) frags.push(sheetContent?.get?.(sid));
    }
    const live = frags.filter(Boolean);
    out.push([
      String(p.name || ''),
      live.map((f) => fragmentText(f)).filter(Boolean).join(' '),
      live.reduce((n, f) => n + (typeof f.length === 'number' ? f.length : 0), 0),
    ]);
  }
  return JSON.stringify(out);
}

// Write a starter document into a fresh doc card's Y.Map: its store, then a
// page at a time. App's addStarterDoc calls this inside the card's creation
// transaction; the fingerprint below calls it on a scratch doc.
export function writeStarterDoc(ydoc, cardYMap, kind) {
  initCardDocStore(ydoc, cardYMap);
  const scope = cardScope(cardYMap);
  for (const p of starterDocPages(kind)) {
    try { writeScriptBody(ydoc, scope, p.docJSON, { name: p.name }); } catch (_) { /* a page short */ }
  }
}

// The fingerprint an untouched starter of `kind` has — built by the same write
// App does, on a scratch doc, so it cannot drift from it.
const _pristine = new Map();
export function pristineFingerprint(kind) {
  if (_pristine.has(kind)) return _pristine.get(kind);
  if (!isStarterKind(kind)) return null;
  const ydoc = new Y.Doc();
  const ym = new Y.Map();
  ydoc.transact(() => {
    ydoc.getMap('cards').set('starter', ym);
    writeStarterDoc(ydoc, ym, kind);
  });
  const fp = docFingerprint(ym);
  _pristine.set(kind, fp);
  return fp;
}

// Still exactly the template it was placed as?
export function isPristineStarter(cardYMap) {
  const kind = cardYMap?.get?.('starter');
  const fp = pristineFingerprint(kind);
  return fp != null && docFingerprint(cardYMap) === fp;
}

// Doc stores whose change means the content changed (not its settings).
const DOC_CONTENT_KEYS = new Set(['docPages', 'docPageContent', 'docPageSheets', 'docSheetContent']);

// The ids of starter cards (still seeds) whose content these observeDeep
// events — observed on the board's `cards` map — touched.
export function starterDocsTouched(events, cards) {
  const ids = new Set();
  for (const ev of events || []) {
    const path = ev?.path || [];
    if (path.length < 2 || !DOC_CONTENT_KEYS.has(path[1])) continue;
    const ym = cards?.get?.(path[0]);
    if (ym && typeof ym.get === 'function' && ym.get('seed') === true && ym.get('starter')) ids.add(path[0]);
  }
  return [...ids];
}

// [{ name, docJSON }] for writeScriptBody, or [] for a kind there is no
// document for.
export function starterDocPages(kind) {
  if (!isStarterKind(kind)) return [];
  return STARTER_DOCS[kind].pages.map((p) => ({ name: p.name, docJSON: { type: 'doc', content: p.content } }));
}
