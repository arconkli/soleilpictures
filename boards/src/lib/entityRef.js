// Canonical EntityRef shape used by every linking surface.
//
// One ref describes one "thing you can link to." The picker, the doc
// link mark, the message attachment, the canvas chip card, and the
// auto-detect scanner all speak this same shape so a ref written by
// one surface can be rendered or navigated from any other.
//
// Shapes (one entry per `kind`):
//   { kind: 'board',    id }
//   { kind: 'card',     boardId, cardId }
//   { kind: 'doc',      docCardId }
//   { kind: 'docPos',   docCardId, pageId, anchor:{from,to}? }
//   { kind: 'message',  id }
//   { kind: 'user',     id }
//   { kind: 'url',      href }
//
// Card subkinds (image / note / palette / schedule / link) all use
// `kind: 'card'` — the per-kind preview lives in entityKinds.js based
// on the card row that gets fetched. This keeps the ref shape stable
// while letting registry kinds specialize their rendering.
//
// Workspace id is implicit (the active workspace). Cross-workspace
// linking is out of scope for v1.

export function isRef(r) {
  return !!r && typeof r === 'object' && typeof r.kind === 'string';
}

export function equalRef(a, b) {
  if (!isRef(a) || !isRef(b)) return false;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'board':   return a.id === b.id;
    case 'card':    return a.boardId === b.boardId && a.cardId === b.cardId;
    case 'doc':     return a.docCardId === b.docCardId;
    case 'docPos':  return a.docCardId === b.docCardId && a.pageId === b.pageId
                        && (a.anchor?.from ?? null) === (b.anchor?.from ?? null)
                        && (a.anchor?.to ?? null)   === (b.anchor?.to ?? null);
    case 'message': return a.id === b.id;
    case 'user':    return a.id === b.id;
    case 'url':     return a.href === b.href;
    default:        return false;
  }
}

// Stable string key for cache lookups. Different from the URL form
// (entityUrl.js) which is short + URL-safe — this is a debug-friendly
// internal key. Don't use it in URLs.
export function refKey(r) {
  if (!isRef(r)) return '';
  switch (r.kind) {
    case 'board':   return `board:${r.id}`;
    case 'card':    return `card:${r.boardId}:${r.cardId}`;
    case 'doc':     return `doc:${r.docCardId}`;
    case 'docPos':  return `docPos:${r.docCardId}:${r.pageId}:${r.anchor?.from ?? ''}-${r.anchor?.to ?? ''}`;
    case 'message': return `message:${r.id}`;
    case 'user':    return `user:${r.id}`;
    case 'url':     return `url:${r.href}`;
    default:        return `${r.kind}:?`;
  }
}

// Coerce assorted legacy shapes into a canonical ref. Keep this
// permissive so callers don't have to manually re-shape every payload.
export function coerceRef(input) {
  if (!input) return null;
  if (typeof input === 'string') return { kind: 'url', href: input };
  if (!input.kind) return null;
  switch (input.kind) {
    case 'board':
      return { kind: 'board', id: input.id ?? input.boardId };
    case 'boardlink':
      return { kind: 'board', id: input.id ?? input.boardId };
    case 'card':
      return { kind: 'card', boardId: input.boardId, cardId: input.cardId ?? input.id };
    case 'doc':
      return { kind: 'doc', docCardId: input.docCardId ?? input.id };
    case 'docPos':
      return {
        kind: 'docPos',
        docCardId: input.docCardId,
        pageId: input.pageId,
        anchor: input.anchor || null,
      };
    case 'message':
      return { kind: 'message', id: input.id ?? input.messageId };
    case 'user':
      return { kind: 'user', id: input.id ?? input.userId };
    case 'url':
      return { kind: 'url', href: input.href ?? input.url };
    default:
      return null;
  }
}
