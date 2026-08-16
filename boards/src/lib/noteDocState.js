// Per-note collaborative text substrate.
//
// Each note card gets its OWN nested Y.XmlFragment, stored inside the card's
// Y.Map under `noteFragment` (mirroring the CARD-mode doc store in docState.js,
// but a single fragment — a note has no pages). Nesting it inside the card map
// means whole-doc persistence (Y.encodeStateAsUpdate), realtime sync
// (Y.applyUpdate), and version-restore all cover it with ZERO changes to
// yboard.js, and it rides the `cards` type already in the board UndoManager.
//
// The fragment is the collaborative source of truth while editing; a derived
// `card.html` string is written through on every edit (noteFragmentToHtml) so
// the many read-only consumers (canvas/share display, thumbnails, card_index,
// list views, copy-out) keep working unchanged.

import * as Y from 'yjs';
import { generateJSON, generateHTML, getSchema } from '@tiptap/core';
import {
  prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON,
  ySyncPluginKey, defaultDeleteFilter, defaultProtectedNodes,
} from 'y-prosemirror';
import { noteExtensions } from '../components/noteExtensions/noteExtensions.js';
import { pageFragmentToText } from './docState.js';

// Origin for note STRUCTURAL ops (fragment create/seed) and the derived-html
// write-through. Deliberately NOT 'local' so the board-level Y.UndoManager
// (which tracks origin 'local' over cards/doc maps) does NOT capture per-note
// edits — that would cause the split-brain ⌘Z documented in docState.js. Still
// broadcast to peers (ySupabase skips only 'remote') and still persisted
// (yboard persists every non-snapshot origin). Live co-typing edits flow
// through Tiptap's Collaboration plugin under its own origin, also not 'local'.
export const NOTE_ORIGIN = 'note-struct';

export const NOTE_FRAGMENT_KEY = 'noteFragment';
export const NOTE_SEEDED_KEY = 'noteFragmentSeeded';

// Lazily-built ProseMirror schema for the note extensions (used by the seeder).
let _schema = null;
function noteSchema() {
  if (!_schema) _schema = getSchema(noteExtensions);
  return _schema;
}

// Duck-typed XmlFragment getter (constructor name is mangled in prod builds).
export function getNoteFragment(cardYMap) {
  const f = cardYMap?.get?.(NOTE_FRAGMENT_KEY);
  return (f && typeof f.toArray === 'function') ? f : null;
}

// Idempotent: create the nested fragment if missing. Returns it.
export function ensureNoteFragment(ydoc, cardYMap) {
  if (!ydoc || !cardYMap) return null;
  const existing = getNoteFragment(cardYMap);
  if (existing) return existing;
  ydoc.transact(() => {
    if (!getNoteFragment(cardYMap)) cardYMap.set(NOTE_FRAGMENT_KEY, new Y.XmlFragment());
  }, NOTE_ORIGIN);
  return getNoteFragment(cardYMap);
}

// ── Per-note undo that SURVIVES closing the editor ──────────────────────────
// NoteTiptapSurface mounts only while a note is being edited, and y-prosemirror's
// yUndoPlugin creates + destroys its UndoManager with the editor view — so
// every exit-edit used to wipe the note's undo history for good. Instead we
// mint ONE UndoManager per fragment, cached here, and hand it to the editor
// via Collaboration.configure({ yUndoOptions: { undoManager } }). The
// extension-collaboration wrapper detaches it on unmount but leaves a
// `restore` hook; reviving it on the next edit session brings the whole
// history back. Config mirrors yUndoPlugin's defaults exactly (trackedOrigins
// = the sync plugin's origin, protected paragraphs, addToHistory opt-out) —
// checklist toggles from the read-only display are deliberately NOT tracked
// here (they transact under 'local' and belong to the board UndoManager,
// since no editor is mounted to receive a Cmd+Z).
//
// WeakMap keyed on the fragment: entries die with the board's Y.Doc, so
// switching boards can't leak managers.
const noteUndoManagers = new WeakMap();
export function getNoteUndoManager(ydoc, cardYMap) {
  const frag = ensureNoteFragment(ydoc, cardYMap);
  if (!frag) return null;
  let um = noteUndoManagers.get(frag);
  if (!um) {
    um = new Y.UndoManager(frag, {
      trackedOrigins: new Set([ySyncPluginKey]),
      deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes),
      captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
      captureTimeout: 500,
    });
    noteUndoManagers.set(frag, um);
  } else if (typeof um.restore === 'function') {
    // Dormant manager from a previous edit session — reattach it (idempotent:
    // lib0 observer sets dedupe the handler references).
    try { um.restore(); } catch (_) {}
    um.restore = () => {};
  }
  return um;
}

// ── Note comments ───────────────────────────────────────────────────────────
// Notes reuse the doc editor's whole comment stack: the CommentMark carries the
// anchor (inside the fragment, so the range survives concurrent edits), and the
// thread bodies live in a Y.Map on the note's own card map. docState's
// addCommentThread / addCommentReply / resolveComment / deleteCommentThread /
// readComments only ever touch `scope.comments`, so handing them this shim is
// enough — no forked implementation, no second storage format.
//
// Key deliberately matches the doc cards' ('docComments') so anything that
// walks card maps looking for threads finds both with one lookup.
export const NOTE_COMMENTS_KEY = 'docComments';

function getNoteComments(cardYMap) {
  const m = cardYMap?.get?.(NOTE_COMMENTS_KEY);
  return (m && typeof m.forEach === 'function' && typeof m.set === 'function') ? m : null;
}

// Idempotent, like ensureNoteFragment. Returns the Y.Map.
export function ensureNoteComments(ydoc, cardYMap) {
  if (!ydoc || !cardYMap) return null;
  const existing = getNoteComments(cardYMap);
  if (existing) return existing;
  ydoc.transact(() => {
    if (!getNoteComments(cardYMap)) cardYMap.set(NOTE_COMMENTS_KEY, new Y.Map());
  }, NOTE_ORIGIN);
  return getNoteComments(cardYMap);
}

// A docState-compatible scope exposing ONLY comments. Everything else stays
// undefined on purpose: a note has no pages, sheets or bookmarks, and a helper
// reaching for one should fail loudly rather than half-work.
export function noteCommentScope(ydoc, cardYMap) {
  const comments = ensureNoteComments(ydoc, cardYMap);
  return comments ? { comments } : null;
}

// Strip the note chrome the schema does NOT model before seeding: link previews
// are regenerated by linkifyNoteHtml on write-through, and dismissed-preview
// markers are tracked as a card field — neither belongs in the fragment.
export function stripNoteChromeForSeed(html) {
  if (!html || typeof document === 'undefined') return html || '';
  const root = document.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll('.note-link-preview, .note-preview-hidden').forEach((el) => el.remove());
  return root.innerHTML;
}

// html → ProseMirror JSON (chrome stripped), using the note schema.
export function noteHtmlToJSON(html) {
  return generateJSON(stripNoteChromeForSeed(html), noteExtensions);
}

// ProseMirror JSON → html, using the note schema.
export function noteJSONToHtml(json) {
  return generateHTML(json, noteExtensions);
}

// Y.XmlFragment → cached html string (the write-through serializer). Produces
// the legacy note contract directly because the custom nodes' renderHTML do.
export function noteFragmentToHtml(fragment) {
  if (!fragment) return '';
  try {
    const json = yXmlFragmentToProsemirrorJSON(fragment);
    return generateHTML(json, noteExtensions);
  } catch (_) {
    return '';
  }
}

// Plain-text projection (card_index body / thumbnail fallback). Reuses the doc
// fragment text walker — it is schema-agnostic (duck-typed Yjs tree walk).
export function noteFragmentToText(fragment, max = 500) {
  return pageFragmentToText(fragment, max);
}

// Seed an empty fragment from a note's legacy `card.html`. Idempotent: guarded
// by NOTE_SEEDED_KEY and a fragment-length check so an intentionally-emptied
// note is never re-seeded from stale html. Runs under NOTE_ORIGIN; the nested
// prosemirror→fragment transact joins this outer transaction (Yjs reentrancy)
// so the whole seed is a single non-'local' step.
export function seedNoteFragmentFromHtml(ydoc, cardYMap, html) {
  if (!ydoc || !cardYMap) return null;
  const frag = ensureNoteFragment(ydoc, cardYMap);
  if (!frag) return null;
  if (cardYMap.get(NOTE_SEEDED_KEY) || frag.length > 0) {
    if (!cardYMap.get(NOTE_SEEDED_KEY)) {
      ydoc.transact(() => cardYMap.set(NOTE_SEEDED_KEY, true), NOTE_ORIGIN);
    }
    return frag;
  }
  const clean = stripNoteChromeForSeed(html);
  ydoc.transact(() => {
    // Re-check inside the transaction to lose cleanly to a concurrent seed.
    if (cardYMap.get(NOTE_SEEDED_KEY) || frag.length > 0) {
      cardYMap.set(NOTE_SEEDED_KEY, true);
      return;
    }
    if (clean && clean.replace(/<[^>]+>/g, '').trim()) {
      const json = generateJSON(clean, noteExtensions);
      prosemirrorJSONToYXmlFragment(noteSchema(), json, frag);
    }
    cardYMap.set(NOTE_SEEDED_KEY, true);
  }, NOTE_ORIGIN);
  return frag;
}

// Write derived cache fields (html / h) onto the card map under NOTE_ORIGIN, so
// they persist + sync but stay OFF the board Y.UndoManager (which tracks
// 'local'). That keeps canvas ⌘Z from reverting the html cache out of step with
// the fragment — per-keystroke note undo belongs to Tiptap's own y-undo.
export function setNoteCacheFields(ydoc, cardYMap, patch) {
  if (!ydoc || !cardYMap || !patch) return;
  ydoc.transact(() => {
    for (const [k, v] of Object.entries(patch)) cardYMap.set(k, v);
  }, NOTE_ORIGIN);
}

// Diff-update a note's fragment to match an external html change made WITHOUT a
// mounted editor — e.g. toggling a checklist item on the read-only display.
// prosemirrorJSONToYXmlFragment (updateYFragment) does a structural diff, so
// unchanged nodes keep their CRDT identity and only the real change syncs. Keeps
// the fragment (source of truth) consistent with the derived card.html so the
// change isn't lost the next time the note is opened for editing.
export function applyHtmlToNoteFragment(ydoc, cardYMap, html) {
  if (!ydoc || !cardYMap) return;
  const frag = ensureNoteFragment(ydoc, cardYMap);
  if (!frag) return;
  const clean = stripNoteChromeForSeed(html);
  if (!clean || !clean.replace(/<[^>]+>/g, '').trim()) return; // never blank the fragment
  ydoc.transact(() => {
    const json = generateJSON(clean, noteExtensions);
    prosemirrorJSONToYXmlFragment(noteSchema(), json, frag);
    cardYMap.set(NOTE_SEEDED_KEY, true);
  }, NOTE_ORIGIN);
}
