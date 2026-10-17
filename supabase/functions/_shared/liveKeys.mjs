// liveKeys — which stored files a cluster's saved state still USES.
//
// board_state.doc is a base64 Yjs update. The database finds the files a
// cluster references with a regex over those bytes (_r2_keys_in_doc, 0127),
// and that is right for what it guards: the orphan sweep must never delete a
// file that undo, the trash or version history could still bring back.
//
// It is wrong for STORAGE. The room's Y.Doc runs with garbage collection off
// (y-partykit turns it off whenever `persist` is set), so a deleted card's
// content — its `r2:` key included — stays in every update the room saves. A
// person who deletes a file to make room would never get the room back.
//
// Applying the update to a fresh Y.Doc, which collects garbage by default,
// drops the content of everything deleted. Encoding THAT and running the same
// regex gives the keys a cluster still uses: the storage-liveness job feeds
// them to storage_liveness_record (0411), and only the storage count reads
// the result. Pure and dependency-free (Yjs is passed in) so node tests and
// the Deno edge function run the same code.

// Same character class and minimum length as _r2_keys_in_doc.
export const R2_KEY_PATTERN = 'r2:([A-Za-z0-9_\\-./]{20,})';

export function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Keys in raw update bytes, read the way the SQL scan reads them: every byte
// is one character, so a key can only match inside a run of plain ASCII.
export function r2KeysInBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  const keys = new Set();
  for (const m of s.matchAll(new RegExp(R2_KEY_PATTERN, 'g'))) keys.add(m[1]);
  return [...keys].sort();
}

// The keys a saved cluster still uses, with deleted content dropped.
export function liveKeysFromDoc(Y, b64) {
  // An empty saved state (a cluster that never held anything) uses nothing.
  if (!b64) return [];
  const doc = new Y.Doc(); // gc: true
  try {
    Y.applyUpdate(doc, base64ToBytes(b64));
    return r2KeysInBytes(Y.encodeStateAsUpdate(doc));
  } finally {
    doc.destroy();
  }
}
