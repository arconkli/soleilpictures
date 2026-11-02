// worker-admin-posts.js — /api/admin/posts/…, the admin phone panel's Posts tab.
//
// The daily TikTok slideshows live on a private page whose address is the
// secret, and "Posted" is a message on a private ntfy topic. Both sit in one
// admin-only row (migration 0840) that admin_posts_source() hands back only to
// an admin, so this route runs that RPC AS the caller (their bearer token) and
// fetches the page's files on their behalf. The address and topic never leave
// the Worker: not in a response, a header, an error or a log line.
//
//   GET  /api/admin/posts/days.json                 the page's day list
//   GET  /api/admin/posts/2026-11-01/<name>.jpg     one slide
//   GET  /api/admin/posts/posted                    {posted:[n…]} from the last 24 h
//   POST /api/admin/posts/posted   {"n": 14}        marks a post posted (as the page does)

export const ADMIN_POSTS_PREFIX = '/api/admin/posts/';
const NTFY = 'https://ntfy.sh/';
const FILE_RE = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(jpe?g|png|webp)$/;
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// What a path under the prefix may be: 'days', 'posted', {file, type}, or null.
export function adminPostsTarget(rest) {
  if (rest === 'days.json') return 'days';
  if (rest === 'posted') return 'posted';
  if (FILE_RE.test(rest) && !rest.includes('..')) {
    return { file: rest, type: TYPES[rest.split('.').pop().toLowerCase()] };
  }
  return null;
}

const plain = (text, status, extra = {}) => new Response(text, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra },
});
const jsonOut = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
});

// deps.rpc(fn, params, token) runs an RPC as the caller (worker.js's userRpc);
// deps.fetch is the upstream fetch (faked in tests).
export async function handleAdminPosts(request, rest, deps) {
  const doFetch = deps.fetch || fetch;
  const target = adminPostsTarget(rest);
  if (!target) return plain('Not found', 404);
  const isPost = request.method === 'POST';
  if (!(request.method === 'GET' || (isPost && target === 'posted'))) {
    return plain('Method not allowed', 405, { allow: target === 'posted' ? 'GET, POST' : 'GET' });
  }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return plain('Unauthorized', 401);
  let src = null;
  try {
    src = await deps.rpc('admin_posts_source', {}, token);
  } catch (e) {
    // _require_admin() raises 42501, which PostgREST answers 401/403; an expired
    // token is a 401 too. Anything else is the check failing, not a refusal.
    const msg = String(e?.message || '');
    return /^rpc \S+ (401|403):/.test(msg) || msg.includes('42501') ? plain('Forbidden', 403) : plain('Check failed', 502);
  }
  if (!src || typeof src.base !== 'string' || typeof src.topic !== 'string') return plain('Posts not set up', 404);

  try {
    if (target === 'posted') {
      if (isPost) {
        let n = null;
        try { n = (await request.json())?.n; } catch { /* fall through */ }
        if (!Number.isInteger(n) || n < 1 || n > 1e6) return plain('Bad post number', 400);
        const r = await doFetch(`${NTFY}${src.topic}-posted`, { method: 'POST', body: `posted #${n}` });
        return r.ok ? jsonOut({ ok: true }) : plain('Upstream failed', 502);
      }
      const r = await doFetch(`${NTFY}${src.topic}-posted/json?poll=1&since=24h`);
      if (!r.ok) return plain('Upstream failed', 502);
      const posted = [];
      for (const line of (await r.text()).split('\n')) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          const n = m?.event === 'message' ? Number(String(m.message).match(/#(\d+)/)?.[1]) : NaN;
          if (Number.isInteger(n) && n > 0 && !posted.includes(n)) posted.push(n);
        } catch { /* skip a bad line */ }
      }
      return jsonOut({ posted });
    }

    const path = target === 'days' ? 'days.json' : target.file;
    // The page is a workers.dev Worker on this account, which the preview (also
    // workers.dev) may not fetch by URL (Cloudflare 1042, a 404), so the page's
    // files go through the POSTS service binding when there is one. A binding
    // keeps the URL's path, so the page's token path still applies.
    const r = deps.posts ? await deps.posts.fetch(src.base + path) : await doFetch(src.base + path);
    if (r.status === 404) return plain('Not found', 404);
    if (!r.ok) return plain('Upstream failed', 502);
    const body = await r.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': target === 'days' ? 'application/json; charset=utf-8' : target.type,
        'cache-control': target === 'days' ? 'private, no-store' : 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return plain('Upstream failed', 502);
  }
}
