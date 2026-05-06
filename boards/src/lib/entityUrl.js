// `?to=<ref>` URL grammar — encodes any EntityRef as a short URL-safe
// token. Symmetric with entityRef.js's coerceRef.
//
// Token format: `<kindCode>:<param1>:<param2>...`
//   b:<boardId>
//   c:<boardId>:<cardId>
//   d:<docCardId>
//   dp:<docCardId>:<pageId>:<from>:<to>          (anchor optional)
//   m:<messageId>
//   u:<userId>
//   url:<encoded href>
//
// UUIDs and ids are written raw (already URL-safe). hrefs are
// percent-encoded. The legacy `?m=<id>` query param is supported as
// an alias for `?to=m:<id>` so old permalinks keep resolving.
//
// Round-trip: refFromUrl(new URL(entityUrl(ref)).searchParams) deepEquals(ref).

import { coerceRef } from './entityRef.js';

export function entityToken(ref) {
  if (!ref || !ref.kind) return '';
  switch (ref.kind) {
    case 'board':   return `b:${ref.id}`;
    case 'card':    return `c:${ref.boardId}:${ref.cardId}`;
    case 'doc':     return `d:${ref.docCardId}`;
    case 'docPos':  {
      const a = ref.anchor;
      const tail = a && a.from != null ? `:${a.from}:${a.to ?? a.from}` : '';
      return `dp:${ref.docCardId}:${ref.pageId}${tail}`;
    }
    case 'message': return `m:${ref.id}`;
    case 'user':    return `u:${ref.id}`;
    case 'url':     return `url:${encodeURIComponent(ref.href)}`;
    default:        return '';
  }
}

export function tokenToRef(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.indexOf(':');
  if (i < 0) return null;
  const code = token.slice(0, i);
  const rest = token.slice(i + 1);
  switch (code) {
    case 'b':   return { kind: 'board', id: rest };
    case 'c':   {
      const [boardId, cardId] = rest.split(':');
      if (!boardId || !cardId) return null;
      return { kind: 'card', boardId, cardId };
    }
    case 'd':   return { kind: 'doc', docCardId: rest };
    case 'dp':  {
      const [docCardId, pageId, from, to] = rest.split(':');
      if (!docCardId || !pageId) return null;
      const anchor = from != null && from !== ''
        ? { from: Number(from), to: Number(to ?? from) }
        : null;
      return { kind: 'docPos', docCardId, pageId, ...(anchor ? { anchor } : {}) };
    }
    case 'm':   return { kind: 'message', id: rest };
    case 'u':   return { kind: 'user', id: rest };
    case 'url': return { kind: 'url', href: decodeURIComponent(rest) };
    default:    return null;
  }
}

// Build a full URL from the current origin + path, replacing any
// existing ?to= or ?m=. Used by "Copy link" actions everywhere.
export function entityUrl(ref, { origin, pathname } = {}) {
  const r = coerceRef(ref);
  if (!r) return '';
  const tok = entityToken(r);
  if (!tok) return '';
  const o = origin   ?? (typeof window !== 'undefined' ? window.location.origin   : '');
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return `${o}${p}?to=${tok}`;
}

// Parse the search params and return the ref to navigate to, or null
// if no link param is present. Supports both `?to=<token>` and the
// legacy `?m=<messageId>` alias.
export function refFromSearchParams(params) {
  const to = params.get('to');
  if (to) return tokenToRef(to);
  const m = params.get('m');
  if (m) return { kind: 'message', id: m };
  return null;
}

// Convenience for the most common caller: parse window.location.
export function refFromCurrentUrl() {
  if (typeof window === 'undefined') return null;
  return refFromSearchParams(new URLSearchParams(window.location.search));
}

// Strip the link query params from the URL after a permalink has been
// resolved so a refresh doesn't re-trigger the navigation.
export function stripLinkParamsFromUrl() {
  if (typeof window === 'undefined') return;
  const u = new URL(window.location.href);
  u.searchParams.delete('to');
  u.searchParams.delete('m');
  const next = u.pathname + (u.search ? u.search : '') + u.hash;
  window.history.replaceState({}, '', next);
}
