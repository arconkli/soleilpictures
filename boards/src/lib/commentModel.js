// One shape for a comment and its conversation, whichever store it lives in:
// the canvas (public.comments rows), a doc or a note (the Y.Doc docComments
// map, as docState.readComments / readThread hand it over) and a shared file
// (get_file_comments rows). The shared comment parts (components/comments/)
// read only this shape; each surface keeps its own store and its own writes.
//
//   Row    { id, authorId|null, authorName, authorAvatar|null, authorColor|null,
//            body, mentions: [{id,name}], createdAt (ms), editedAt (ms)|null,
//            deleted, pending?, failed?, meta? }
//   Thread { id, root: Row, replies: Row[], resolved, resolvedBy: {id,name}|null,
//            resolvedAt (ms)|null, unread?, lastActivityAt (ms) }
//
// Pure: no React, no network, no clock but the one passed in.

// A time as epoch milliseconds (lib/toMs.js, a file of its own: the canvas
// reads times before this model has arrived).
import { toMs } from './toMs.js';
export { toMs };

// A face is only ever loaded over https (the same rule as the shared-file
// rail: a name or a body is never an address we fetch).
export function safeAvatar(u) {
  return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null;
}

// `people` as a surface has them: a Map by id, an object by id, a list of
// { id, name, avatar | avatar_url, color }, or a function id → person.
// → a function id → { id, name, avatar, color } | null.
export function personLookup(people) {
  const shape = (id, p) => {
    if (!p) return null;
    if (typeof p === 'string') return { id, name: p, avatar: null, color: null };
    const name = p.name || p.display_name || p.displayName || null;
    return { id, name, avatar: safeAvatar(p.avatar ?? p.avatar_url ?? p.avatarUrl), color: p.color || null };
  };
  if (!people) return () => null;
  if (typeof people === 'function') return (id) => (id ? shape(id, people(id)) : null);
  if (people instanceof Map) return (id) => (id ? shape(id, people.get(id)) : null);
  if (Array.isArray(people)) {
    const by = new Map(people.filter((p) => p && p.id).map((p) => [p.id, p]));
    return (id) => (id ? shape(id, by.get(id)) : null);
  }
  return (id) => (id ? shape(id, people[id]) : null);
}

// Mention ids as stored → [{ id, name }], for the ones `who` can name (a chip
// needs the name that is in the text). Already-shaped entries pass through.
function mentionList(stored, who) {
  if (!Array.isArray(stored)) return [];
  const out = [];
  const seen = new Set();
  for (const m of stored) {
    const id = m && typeof m === 'object' ? m.id : m;
    if (!id || seen.has(id)) continue;
    const name = (m && typeof m === 'object' && m.name) || who(id)?.name || null;
    if (!name) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

function finish(id, root, replies, extra) {
  const times = [root, ...replies].map((r) => r.createdAt).filter((t) => t != null);
  return {
    id, root, replies,
    resolved: false, resolvedBy: null, resolvedAt: null,
    ...extra,
    lastActivityAt: times.length ? Math.max(...times) : null,
  };
}

const byCreated = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || String(a.id).localeCompare(String(b.id));
const byRootCreated = (a, b) => byCreated(a.root, b.root);

// ── Canvas: public.comments rows ────────────────────────────────────────────
// Root rows (reply_to null) with their replies, oldest thread first. A reply
// whose parent isn't in the list is left out (its thread was deleted). The
// table has no "who resolved it" today, so resolvedBy / resolvedAt are read
// when a row carries them and are null otherwise; the same for edited_at and
// mentions (uuid[]). updated_at is not "edited": moving a comment writes it.
export function fromCanvasRows(rows, people) {
  const who = personLookup(people);
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.id) : [];
  const row = (r) => {
    const p = who(r.author);
    const deleted = !!r.deleted_at;
    return {
      id: r.id,
      authorId: r.author || null,
      authorName: p?.name || 'Member',
      authorAvatar: p?.avatar || null,
      authorColor: p?.color || null,
      body: deleted ? '' : String(r.body ?? ''),
      mentions: deleted ? [] : mentionList(r.mentions, who),
      createdAt: toMs(r.created_at),
      editedAt: toMs(r.edited_at),
      deleted,
      ...(r.pending ? { pending: true } : null),
      ...(r.failed ? { failed: true } : null),
    };
  };
  const replies = new Map();
  for (const r of list) {
    if (!r.reply_to) continue;
    if (!replies.has(r.reply_to)) replies.set(r.reply_to, []);
    replies.get(r.reply_to).push(row(r));
  }
  return list.filter((r) => !r.reply_to).map((r) => {
    const root = row(r);
    root.meta = {
      boardId: r.board_id || null,
      anchorKind: r.anchor_kind || null,
      anchorId: r.anchor_id ?? null,
      anchorX: r.anchor_x ?? null,
      anchorY: r.anchor_y ?? null,
      offsetX: r.offset_x ?? 0,
      offsetY: r.offset_y ?? 0,
      docPageId: r.doc_page_id ?? null,
      hidden: !!r.hidden,
    };
    const byId = r.resolved && r.resolved_by ? r.resolved_by : null;
    return finish(r.id, root, (replies.get(r.id) || []).sort(byCreated), {
      resolved: !!r.resolved,
      resolvedBy: byId ? { id: byId, name: who(byId)?.name || 'Member' } : null,
      resolvedAt: r.resolved ? toMs(r.resolved_at) : null,
    });
  }).sort(byRootCreated);
}

// ── Docs and notes: one thread out of docComments ───────────────────────────
// `entry` is a thread as docState.readThread / readComments compose it from
// the map's keys (lib/commentKeys.js: the thread, its `~r~` replies, its `~s`
// state): { id, pageId, ts, author, authorId, authorColor, body, mentions
// (ids), replies: [{ id, ts, author, authorId, authorColor, body, mentions }],
// resolved, resolvedBy, resolvedByName, resolvedAt }. The name written with
// the comment is kept unless `people` knows the person's name now.
export function fromDocThread(entry, people) {
  if (!entry || typeof entry !== 'object' || !entry.id) return null;
  const who = personLookup(people);
  const row = (r, id) => {
    const p = who(r.authorId);
    const deleted = !!r.deleted;
    return {
      id,
      authorId: r.authorId || null,
      authorName: p?.name || (typeof r.author === 'string' && r.author.trim()) || 'Someone',
      authorAvatar: p?.avatar || null,
      authorColor: p?.color || (typeof r.authorColor === 'string' ? r.authorColor : null),
      body: deleted ? '' : String(r.body ?? ''),
      mentions: deleted ? [] : mentionList(r.mentions, who),
      createdAt: toMs(r.ts),
      editedAt: toMs(r.editedAt),
      deleted,
    };
  };
  const root = row(entry, entry.id);
  root.meta = { pageId: entry.pageId ?? null };
  const replies = (Array.isArray(entry.replies) ? entry.replies : [])
    .filter((r) => r && typeof r === 'object')
    .map((r, i) => row(r, r.id || `${entry.id}~${i}`))
    .sort(byCreated);
  const resolved = !!entry.resolved;
  const byId = resolved && typeof entry.resolvedBy === 'string' ? entry.resolvedBy : null;
  const byName = resolved ? (who(byId)?.name || entry.resolvedByName || null) : null;
  return finish(entry.id, root, replies, {
    resolved,
    resolvedBy: byId || byName ? { id: byId, name: byName || 'Someone' } : null,
    resolvedAt: resolved ? toMs(entry.resolvedAt) : null,
  });
}

// ── Shared files: get_file_comments rows ────────────────────────────────────
// The rows as the RPC returns them (flat; a reply names its parent in
// reply_to). No author id ever leaves the database: `mine`, `can_delete` and
// `can_resolve` say what the caller may do, and travel in meta. A deleted row
// (kept only while it has replies) carries no words, and here no name and no
// face either. Where a comment sits (at_ms, page) and whether it is on the
// version being shown ride in meta. Threads in the order written;
// fileShares.groupComments still decides the rail's order.
export function fromFileRows(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.id) : [];
  const row = (r) => {
    const deleted = !!r.deleted;
    const a = r.author || {};
    return {
      id: r.id,
      authorId: null,
      authorName: deleted ? '' : ((typeof a.name === 'string' && a.name.trim()) || 'Someone'),
      authorAvatar: deleted ? null : safeAvatar(a.avatar_url),
      authorColor: deleted ? null : (typeof a.color === 'string' ? a.color : null),
      body: deleted ? '' : String(r.body ?? ''),
      mentions: [],
      createdAt: toMs(r.created_at),
      editedAt: deleted ? null : toMs(r.edited_at),
      deleted,
      meta: {
        atMs: r.at_ms ?? null,
        page: r.page ?? null,
        onCurrent: r.on_current !== false,
        mine: !!r.mine,
        canDelete: !!r.can_delete,
        canResolve: !!r.can_resolve,
      },
    };
  };
  const replies = new Map();
  for (const r of list) {
    if (!r.reply_to) continue;
    if (!replies.has(r.reply_to)) replies.set(r.reply_to, []);
    replies.get(r.reply_to).push(row(r));
  }
  return list.filter((r) => !r.reply_to)
    .map((r) => finish(r.id, row(r), (replies.get(r.id) || []).sort(byCreated), { resolved: !!r.resolved }))
    .sort(byRootCreated);
}
