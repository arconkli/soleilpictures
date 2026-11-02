// postsApi.js — the Posts tab's reads, through the Worker's admin-only proxy
// (worker-admin-posts.js). An <img> can't carry the bearer token, so slides are
// fetched here and handed out as blob URLs; Save all reuses the same blobs, so
// the share sheet opens inside the tap (Safari needs that).
import { supabase } from '../../../lib/supabase.js';
import { slideUrl } from '../../../lib/phonePanel.js';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Signed out');
  return { authorization: `Bearer ${token}` };
}

async function get(path) {
  const r = await fetch(path, { headers: await authHeaders() });
  if (!r.ok) {
    const e = new Error(r.status === 404 ? 'Posts aren’t set up' : r.status === 403 ? 'Admin only' : 'Couldn’t reach the posts page');
    e.status = r.status;
    throw e;
  }
  return r;
}

const files = new Map(); // slide path → Promise<File>

export const postsApi = {
  async days() {
    return (await get('/api/admin/posts/days.json')).json();
  },
  async posted() {
    return ((await (await get('/api/admin/posts/posted')).json()).posted) || [];
  },
  async markPosted(n) {
    const r = await fetch('/api/admin/posts/posted', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'content-type': 'application/json' },
      body: JSON.stringify({ n: Number(n) }),
    });
    if (!r.ok) throw new Error('Couldn’t mark it posted');
  },
  // A slide as a File (for sharing); cached for the session.
  slide(date, file) {
    const path = slideUrl(date, file);
    if (!files.has(path)) {
      const p = get(path).then((r) => r.blob()).then((b) => new File([b], file, { type: b.type || 'image/jpeg' }));
      p.catch(() => files.delete(path));
      files.set(path, p);
    }
    return files.get(path);
  },
};
