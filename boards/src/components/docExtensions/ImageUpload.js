// Putting an image into a doc, from the toolbar's Insert → Image, a paste or a
// drop — one path for all three.
//
// It uploads as the cluster's image (boardId — which is also how the upload
// party authorizes an editor the cluster was shared with, who could not add an
// image without it), on the doc's card (cardId), under the name the file had.
//
// While it uploads, the spot it will land in shows the picture (from the file
// itself), its name and how far it has got; a failed upload says so in the same
// spot, with Retry and Remove. All of that is a decoration: local to this
// editor, never written into the shared doc, so no collaborator ever sees a
// half-made image and a closed tab leaves nothing behind.
//
// The spot follows the text around it. A local edit maps it like any position.
// A collaborator's edit (or an undo) arrives from y-prosemirror as one
// whole-document replace, which maps every position to the end — so on those
// the spot is read back from a Yjs relative anchor (bookmarkRelPos), the way
// y-prosemirror restores the caret.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import { encodeAnchor, resolveAnchor } from '../../lib/bookmarkRelPos.js';
import { meaningfulFileName } from '../../lib/fileIngest.js';
import { resolveSrc } from '../../lib/r2.js';
import { uploadImage } from '../../lib/uploads.js';
import { rememberSize } from './ImageResizable.js';

const key = new PluginKey('docImageUpload');

// The ?docqa harness's stand-in for R2 (&uploads=1). The harness is the only
// caller and is dropped from production builds; the guard keeps it so.
let harnessUploader = null;
export function setDocImageUploader(fn) {
  if (import.meta.env.DEV) harnessUploader = fn;
}

const clampPos = (doc, pos) => Math.max(0, Math.min(pos, doc.content.size));

// Where the image goes for a caret at `pos`: at either end of a line of text,
// beside that block rather than inside it, so it doesn't split the paragraph
// and leave an empty one behind; anywhere else, where the caret is.
function landingPos(doc, pos, type) {
  const at = clampPos(doc, pos);
  const $at = doc.resolve(at);
  const block = $at.parent;
  if (!type || $at.depth === 0 || !block.isTextblock || !block.content.size) return at;
  const edge = $at.parentOffset === block.content.size ? $at.after()
    : $at.parentOffset === 0 ? $at.before() : null;
  if (edge == null) return at;
  const $edge = doc.resolve(edge);
  return $edge.parent.canReplaceWith($edge.index(), $edge.index(), type) ? edge : at;
}

const pct = (p) => Math.round(Math.max(0, Math.min(1, p || 0)) * 100);

// What went wrong, in words a person can act on. A request the network (or a
// CORS-less error from storage) killed reaches us as the browser's own
// "Failed to fetch" / "Load failed" / "NetworkError…".
function reason(e) {
  const msg = e?.message || '';
  if (!msg || /failed to fetch|load failed|networkerror/i.test(msg)) return 'Check your connection and try again.';
  return msg;
}

// Fetch the uploaded image before it replaces its placeholder, so the swap is
// picture-for-picture instead of a blank frame while the signed URL resolves
// and the bytes come back. Bounded: a slow fetch only delays the swap.
async function preload(src) {
  try {
    const url = await resolveSrc(src);
    if (!url) return;
    const img = new Image();
    img.src = url;
    await Promise.race([img.decode(), new Promise((r) => setTimeout(r, 6000))]);
  } catch (_) {}
}

// The placeholder's DOM, built from its upload's record. Progress and failure
// repaint it in place (paint) — they never dispatch a transaction, so a fast
// upload can't flood the editor or split the typing undo history.
function buildDom(rec) {
  const el = (tag, cls, attrs = {}) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const root = el('span', 'doc-upload', { contenteditable: 'false' });
  const thumb = el('span', 'doc-upload-thumb', { 'aria-hidden': 'true' });
  if (rec.preview) {
    const img = el('img', null, { alt: '', draggable: 'false' });
    img.src = rec.preview;
    thumb.appendChild(img);
  }
  const meta = el('span', 'doc-upload-meta');
  const name = el('span', 'doc-upload-name');
  name.textContent = rec.name;
  const state = el('span', 'doc-upload-state');
  const bar = el('span', 'doc-upload-bar', {
    role: 'progressbar', 'aria-label': `Uploading ${rec.name}`, 'aria-valuemin': '0', 'aria-valuemax': '100',
  });
  const fill = el('span', 'doc-upload-fill');
  bar.appendChild(fill);
  const error = el('span', 'doc-upload-error', { role: 'alert' });
  const actions = el('span', 'doc-upload-actions');
  const button = (run) => {
    const b = el('button', 'doc-upload-act', { type: 'button' });
    // Keep the caret where it is: the press must not take focus from the text.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => { e.preventDefault(); run(); });
    return b;
  };
  const retry = button(() => rec.retry());
  retry.textContent = 'Retry';
  // Cancel while it runs (a stalled upload is never stuck in the doc), Remove
  // once it has failed.
  const remove = button(() => rec.remove());
  actions.append(retry, remove);
  meta.append(name, state, bar, error, actions);
  root.append(thumb, meta);
  rec.dom = { root, state, bar, fill, error, retry, remove };
  paint(rec);
  return root;
}

function paint(rec) {
  const d = rec.dom;
  if (!d) return;
  const failed = rec.error != null;
  d.root.classList.toggle('is-failed', failed);
  d.state.hidden = failed;
  d.bar.hidden = failed;
  d.error.hidden = !failed;
  d.retry.hidden = !failed;
  d.remove.textContent = failed ? 'Remove' : 'Cancel';
  if (failed) {
    d.error.textContent = `Couldn't upload ${rec.name}. ${rec.error}`;
    return;
  }
  const p = pct(rec.progress);
  d.state.textContent = p >= 100 ? 'Finishing…' : `Uploading · ${p}%`;
  d.bar.setAttribute('aria-valuenow', String(p));
  d.fill.style.width = `${p}%`;
}

export const ImageUploadPlaceholders = Extension.create({
  name: 'docImageUpload',
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: () => new Map(),
        apply(tr, items, oldState) {
          const meta = tr.getMeta(key);
          let next = items;
          if (tr.docChanged && items.size) {
            const remote = !!tr.getMeta(ySyncPluginKey)?.isChangeOrigin;
            next = new Map();
            for (const [id, it] of items) {
              // The sync binding is shared by every state, and by now it maps
              // the incoming content, so the old state can resolve against it.
              const anchored = remote && it.anchor ? resolveAnchor({ state: oldState }, it.anchor) : null;
              const pos = anchored ?? (remote ? it.pos : tr.mapping.map(it.pos));
              next.set(id, { ...it, pos: clampPos(tr.doc, pos) });
            }
          }
          if (!meta) return next;
          if (next === items) next = new Map(items);
          if (meta.add) next.set(meta.add.id, meta.add);
          if (meta.remove) next.delete(meta.remove);
          return next;
        },
      },
      props: {
        decorations(state) {
          const items = key.getState(state);
          if (!items?.size) return null;
          const type = state.schema.nodes.image;
          const decos = [];
          for (const it of items.values()) {
            decos.push(Decoration.widget(landingPos(state.doc, it.pos, type), () => buildDom(it.rec), {
              key: it.id, side: -1, ignoreSelection: true, stopEvent: () => true,
            }));
          }
          return DecorationSet.create(state.doc, decos);
        },
      },
    })];
  },
});

// Upload `file` into `editor` at `pos` (the caret when null). `toast` hears
// only what the placeholder can't say, once the editor holding it has closed.
export function uploadImageIntoDoc(editor, file, { pos = null, workspaceId, userId, scope = null, toast = null } = {}) {
  if (!editor || editor.isDestroyed || !file?.type?.startsWith('image/')) return;
  if (!key.getState(editor.state)) return; // an editor without the extension
  // At the caret, an image takes the place of what is selected, as a paste of
  // anything would.
  if (pos == null && !editor.state.selection.empty) editor.commands.deleteSelection();
  const at = pos ?? editor.state.selection.from;
  const id = `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const rec = { name: meaningfulFileName(file) || 'Image', preview: null, progress: 0, error: null, dom: null };
  try { rec.preview = URL.createObjectURL(file); } catch (_) {}
  const release = () => {
    if (rec.preview) { try { URL.revokeObjectURL(rec.preview); } catch (_) {} }
    rec.preview = null;
  };
  const live = () => !editor.isDestroyed && key.getState(editor.state)?.has(id);
  rec.remove = () => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, { remove: id }));
    release();
  };
  const run = async () => {
    rec.error = null;
    rec.progress = 0;
    paint(rec);
    let payload;
    try {
      payload = await (harnessUploader || uploadImage)({
        file, workspaceId, userId,
        boardId: scope?.boardId || null,
        cardId: scope?.cardId || null,
        originalName: meaningfulFileName(file),
        onProgress: (p) => { rec.progress = p; paint(rec); },
      });
    } catch (e) {
      console.error('image upload failed', e);
      if (live()) {
        rec.error = reason(e);
        paint(rec);
      } else if (editor.isDestroyed) {
        release();
        toast?.({ type: 'error', message: `Couldn't upload ${rec.name}. ${reason(e)}` });
      }
      return;
    }
    rec.progress = 1;
    paint(rec);
    rememberSize(payload.src, payload.width, payload.height);
    await preload(payload.src);
    if (!live()) {
      // Cancelled while it ran, or its page closed: nothing to place it in.
      if (editor.isDestroyed) {
        toast?.({ type: 'info', message: `${rec.name} finished uploading after its page closed. Add it again to place it.` });
      }
      release();
      return;
    }
    const { state } = editor;
    const where = landingPos(state.doc, key.getState(state).get(id).pos, state.schema.nodes.image);
    // Its own step in ⌘Z, apart from whatever was being typed as it landed;
    // and the caret stays where that typing is, not on the image.
    const undo = yUndoPluginKey.getState(state)?.undoManager;
    undo?.stopCapturing();
    editor.chain()
      .command(({ tr }) => { tr.setMeta(key, { remove: id }); return true; })
      .insertContentAt(where, { type: 'image', attrs: { src: payload.src } }, { updateSelection: false })
      .run();
    undo?.stopCapturing();
    release();
  };
  rec.retry = run;
  editor.view.dispatch(editor.state.tr.setMeta(key, {
    add: { id, anchor: encodeAnchor(editor, at), pos: clampPos(editor.state.doc, at), rec },
  }));
  run();
}
