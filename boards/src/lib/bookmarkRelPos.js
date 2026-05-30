// Durable bookmark anchors.
//
// A bookmark used to store a raw integer ProseMirror position. That position
// drifts the moment any text is inserted before it — the bookmark then points
// at the wrong spot. Yjs gives us *relative* positions that ride along with the
// content: encode the anchor against the shared Y.XmlFragment on save, and
// decode it back to an absolute position on jump. Inserts/deletes elsewhere no
// longer break it.
//
// We reach the Yjs binding through Tiptap's Collaboration extension, which is
// built on y-prosemirror's ySyncPlugin. `ySyncPluginKey.getState(editor.state)`
// exposes `{ type, binding }`; `binding.mapping` is the PM⇄Yjs node map. The two
// converters and the plugin key are the public y-prosemirror API (v1.3.7).

import * as Y from 'yjs';
import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from 'y-prosemirror';

function syncState(editor) {
  try {
    const st = ySyncPluginKey.getState(editor?.state);
    if (!st || !st.type || !st.binding?.mapping) return null;
    return { type: st.type, mapping: st.binding.mapping };
  } catch (_) {
    return null;
  }
}

// Uint8Array <-> base64 (small payloads — a relative position is a handful of
// bytes, so the simple String.fromCharCode path is fine).
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Encode an absolute PM position to a durable, serializable relative anchor.
// Returns a base64 string, or null if the editor isn't bound yet.
export function encodeAnchor(editor, pos) {
  const st = syncState(editor);
  if (!st) return null;
  try {
    const rel = absolutePositionToRelativePosition(pos, st.type, st.mapping);
    return bytesToB64(Y.encodeRelativePosition(rel));
  } catch (_) {
    return null;
  }
}

// Resolve a stored relative anchor back to an absolute PM position. Returns a
// number, or null if it can't be resolved (caller should fall back to the
// legacy integer anchor and clamp).
export function resolveAnchor(editor, encoded) {
  if (!encoded) return null;
  const st = syncState(editor);
  if (!st) return null;
  try {
    const rel = Y.decodeRelativePosition(b64ToBytes(encoded));
    const abs = relativePositionToAbsolutePosition(st.type.doc, st.type, rel, st.mapping);
    return typeof abs === 'number' ? abs : null;
  } catch (_) {
    return null;
  }
}
