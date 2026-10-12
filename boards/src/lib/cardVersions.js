// File versions on a card. A card holds its current file at the top level, as
// it always has (src / poster / pdfSrc / fileSrc / fileName …), so every
// renderer, download, the API and an older app keep working untouched. The
// history lives beside it in one plain array, oldest first, current included:
//
//   card.versions = [{ src:'r2:…', poster:'r2:…', id, n, at, by, fileName, sizeBytes, mime, media, … }]
//   card.verId    = the id of the version on show
//
// Every operation here is a pure patch builder; the caller applies the patch
// with ONE mutators.updateCard, so each is one undo step.
//
// ── Why the entry's key order matters ──────────────────────────────────────
// Storage keeps a file only while some board's document still mentions it
// (_r2_keys_in_doc, migration 0127): a regex over the document's raw bytes for
// r2:<key>. Inside a plain array/object, Yjs writes each value straight after a
// one-byte type tag — and the tags for "object" and "string" are the letters
// 'v' and 'w', which the regex happily continues into. An r2: string that is
// the LAST field of an entry followed by another entry reads as "<key>v" — a
// key that matches no file — and the real file is deleted a month later. So
// normalizeVersionEntry always writes the file keys FIRST and `id` straight
// after them: what follows a key is then the next field name's length byte,
// which ends the match. cardVersions.test.mjs runs the real regex over real
// Yjs bytes to hold this.
//
// Deleting a version keeps it for DELETED_KEEP_DAYS with `del` set (Restore in
// Info), because a file that leaves the document is eligible for deletion
// straight away (0293 keeps last_referenced_at; the op log only records keys
// from new cards). Pruned after that, by the next edit.

export const VERSION_LIMIT = 50;
export const DELETED_KEEP_DAYS = 30;

// Fields that hold a file key, per kind — written first in an entry.
export const R2_FIELDS = {
  image: ['src'],
  video: ['src', 'poster'],
  audio: ['src', 'cover'],
  pdf: ['pdfSrc', 'src'],
  file: ['fileSrc'],
};
// The main file's field (which version a card shows is decided by it).
export const FILE_FIELD = { image: 'src', video: 'src', audio: 'src', pdf: 'pdfSrc', file: 'fileSrc' };
// Everything else that belongs to one version and is mirrored at the top level.
const VERSION_FIELDS = {
  image: ['fileName', 'sizeBytes', 'mime', 'media', 'adjust'],
  video: ['fileName', 'sizeBytes', 'mime', 'media'],
  audio: ['fileName', 'sizeBytes', 'mime', 'ext', 'duration', 'sampleRate', 'channels'],
  pdf: ['name', 'pageCount', 'sizeBytes'],
  file: ['fileName', 'sizeBytes', 'mime', 'ext'],
};
// Derived per-file data that must be recomputed after a switch, not carried.
const CLEAR_ON_SWITCH = { audio: ['peaks', 'analyzed'], image: [], video: [], pdf: [], file: [] };

export function canVersion(card) {
  return !!card && Object.prototype.hasOwnProperty.call(FILE_FIELD, card.kind) && !card.pending && !card.locked;
}

function fileKey(kind, obj) {
  const v = obj?.[FILE_FIELD[kind]];
  return typeof v === 'string' && v ? v : '';
}

// A version entry with its file keys first and `id` right after them.
export function normalizeVersionEntry(kind, fields) {
  const out = {};
  for (const f of R2_FIELDS[kind] || []) {
    const v = fields?.[f];
    if (typeof v === 'string' && v) out[f] = v;
  }
  out.id = String(fields?.id || newVersionId());
  out.n = Number.isFinite(fields?.n) ? fields.n : 1;
  out.at = fields?.at || null;
  out.by = fields?.by || null;
  for (const f of VERSION_FIELDS[kind] || []) {
    const v = fields?.[f];
    if (v !== undefined && v !== null && v !== '') out[f] = v;
  }
  if (fields?.label) out.label = String(fields.label).slice(0, 80);
  if (fields?.del) out.del = fields.del;
  if (fields?.untracked) out.untracked = true;
  return out;
}

let seq = 0;
export function newVersionId(now = Date.now()) {
  seq = (seq + 1) % 1296;
  return `v${now.toString(36)}${seq.toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}

// The version the card's top-level fields describe, as an entry.
function topLevelEntry(card, extra) {
  const f = {};
  for (const k of [...(R2_FIELDS[card.kind] || []), ...(VERSION_FIELDS[card.kind] || [])]) f[k] = card[k];
  return normalizeVersionEntry(card.kind, { ...f, ...extra });
}

// Every version, oldest first. A card that has never had a second version
// gets its first one synthesized ('v1', from its own create stamp). A top-
// level file no entry knows about — written by an older app's "Replace
// image", or two people adding versions at once — shows as an untracked
// newest version, so nothing ever disappears from the list.
export function versionsOf(card) {
  if (!card || !FILE_FIELD[card.kind]) return [];
  const raw = Array.isArray(card.versions) ? card.versions.filter((v) => v && typeof v === 'object' && v.id) : [];
  if (!raw.length) {
    return fileKey(card.kind, card) ? [topLevelEntry(card, { id: 'v1', n: 1, at: card.createdAt || null, by: card.createdBy || null })] : [];
  }
  const list = raw.map((v) => normalizeVersionEntry(card.kind, v));
  const top = fileKey(card.kind, card);
  if (top && !list.some((v) => fileKey(card.kind, v) === top)) {
    const n = Math.max(...list.map((v) => v.n || 0)) + 1;
    list.push(topLevelEntry(card, { id: `vtop${n}`, n, at: card.updatedAt || null, by: card.updatedBy || null, untracked: true }));
  }
  return list;
}

export function liveVersions(card) {
  return versionsOf(card).filter((v) => !v.del);
}

// The version on show: whichever entry holds the top-level file.
export function currentOf(card) {
  const list = versionsOf(card);
  const top = fileKey(card?.kind, card);
  return list.find((v) => fileKey(card.kind, v) === top) || list[list.length - 1] || null;
}

export function versionLabel(v) {
  return v ? `v${v.n || 1}` : '';
}

// What the top level must say to show `entry`: its fields, and null for any
// version field it doesn't have (so a previous version's poster can't linger).
function mirrorOf(kind, entry) {
  const patch = {};
  for (const f of [...(R2_FIELDS[kind] || []), ...(VERSION_FIELDS[kind] || [])]) {
    patch[f] = entry[f] !== undefined ? entry[f] : null;
  }
  for (const f of CLEAR_ON_SWITCH[kind] || []) patch[f] = null;
  return patch;
}

// Keep the card's width; fit its height to the new aspect when it changed
// by more than 2%.
function refit(card, entry) {
  const w = entry?.media?.w, h = entry?.media?.h;
  if (!(w > 0 && h > 0 && card?.w > 0 && card?.h > 0)) return {};
  const cur = card.h / card.w, next = h / w;
  return Math.abs(cur - next) / next > 0.02 ? { h: Math.round(card.w * next) } : {};
}

// The list as stored: `untracked` is a display state — once written, it's a
// real version.
function storeList(kind, list) {
  return list.map((v) => {
    const { untracked, ...rest } = v;
    return normalizeVersionEntry(kind, rest);
  });
}

// Add a new version and show it. `fields` are the new file's (src, poster,
// fileName, sizeBytes, mime, media…). Returns { patch, entry } or null when
// the card can't take another (VERSION_LIMIT live versions).
export function addVersionPatch(card, fields, { by = null, at = new Date().toISOString(), id = null, label = null } = {}) {
  if (!canVersion(card) || !fileKey(card.kind, fields)) return null;
  const list = versionsOf(card);
  if (list.filter((v) => !v.del).length >= VERSION_LIMIT) return null;
  const n = Math.max(0, ...list.map((v) => v.n || 0)) + 1;
  const entry = normalizeVersionEntry(card.kind, { ...fields, id: id || newVersionId(), n, at, by, label });
  const patch = {
    ...mirrorOf(card.kind, entry),
    ...refit(card, entry),
    versions: storeList(card.kind, [...list, entry]),
    verId: entry.id,
  };
  return { patch, entry };
}

// Show another version (Make current).
export function setCurrentPatch(card, id) {
  const list = versionsOf(card);
  const entry = list.find((v) => v.id === id && !v.del);
  if (!entry) return null;
  return { ...mirrorOf(card.kind, entry), ...refit(card, entry), versions: storeList(card.kind, list), verId: entry.id };
}

// Delete a version: kept, marked, for DELETED_KEEP_DAYS. Deleting the one on
// show switches to the newest one left. The last live version can't go —
// that's deleting the file, which is the card's own Delete.
export function deleteVersionPatch(card, id, now = new Date().toISOString()) {
  const list = versionsOf(card);
  const target = list.find((v) => v.id === id && !v.del);
  const live = list.filter((v) => !v.del);
  if (!target || live.length <= 1) return null;
  const next = list.map((v) => (v.id === id ? { ...v, del: now } : v));
  const cur = currentOf(card);
  if (cur?.id !== id) return { versions: storeList(card.kind, next) };
  const fallback = [...next].reverse().find((v) => !v.del);
  return { ...mirrorOf(card.kind, fallback), ...refit(card, fallback), versions: storeList(card.kind, next), verId: fallback.id };
}

export function restoreVersionPatch(card, id) {
  const list = versionsOf(card);
  if (!list.some((v) => v.id === id && v.del)) return null;
  return { versions: storeList(card.kind, list.map((v) => (v.id === id ? (({ del, ...rest }) => rest)(v) : v))) };
}

export function labelVersionPatch(card, id, label) {
  const list = versionsOf(card);
  if (!list.some((v) => v.id === id)) return null;
  const clean = String(label || '').trim().slice(0, 80);
  return { versions: storeList(card.kind, list.map((v) => (v.id === id ? { ...v, label: clean || undefined } : v))) };
}

// Versions deleted longer ago than DELETED_KEEP_DAYS drop out for good.
export function pruneDeletedPatch(card, now = Date.now()) {
  if (!Array.isArray(card?.versions)) return null;
  const cutoff = now - DELETED_KEEP_DAYS * 86400000;
  const list = versionsOf(card);
  const keep = list.filter((v) => !(v.del && Date.parse(v.del) < cutoff));
  return keep.length === list.length ? null : { versions: storeList(card.kind, keep) };
}

// "Keep as separate file": the new file as a card of its own, beside the one
// it was dropped on (the caller undoes the version first).
export function separateCardFrom(card, entry, newId) {
  const c = { id: newId, kind: card.kind };
  for (const f of [...(R2_FIELDS[card.kind] || []), ...(VERSION_FIELDS[card.kind] || [])]) {
    if (entry[f] !== undefined) c[f] = entry[f];
  }
  if (Number.isFinite(card.x) && Number.isFinite(card.w)) { c.x = card.x + card.w + 24; c.y = card.y; c.w = card.w; c.h = card.h; }
  if (card.unplaced === true) c.unplaced = true;
  return c;
}
