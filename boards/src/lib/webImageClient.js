// Ask the Worker to keep a copy of a web image (worker-media.js).
//
// Never throws. `{ ok: true, src, … }` is a copy to move the card onto;
// `{ ok: false, code }` means the card stays the hotlink it already is, which
// is never worse than before — so nothing here is ever shown as an error.
//
// The caller hands over `getToken` (the canvas reads its own session), which
// keeps this module free of the Supabase client and testable under node.

const PATH = '/api/media/save-url';
// A route that is not there (a dev server with no Worker) or a Worker that is
// struggling is not asked again for a minute, so a run of drags does not
// become a run of failing requests.
const COOLDOWN_MS = 60_000;
let cooldownUntil = 0;

export async function saveWebImageCopy({
  url, boardId, cardId = null, getToken = null, fetchImpl = (...a) => fetch(...a), now = () => Date.now(),
} = {}) {
  if (!/^https?:\/\//i.test(String(url || '')) || !boardId) return { ok: false, code: 'skipped' };
  if (now() < cooldownUntil) return { ok: false, code: 'cooldown' };
  try {
    const token = getToken ? await getToken() : null;
    if (!token) return { ok: false, code: 'signed_out' };
    const r = await fetchImpl(PATH, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url, boardId, cardId }),
    });
    const isJson = /application\/json/i.test(r.headers.get('content-type') || '');
    const data = isJson ? await r.json().catch(() => null) : null;
    if (!isJson || r.status >= 500 || r.status === 429) cooldownUntil = now() + COOLDOWN_MS;
    if (!r.ok) return { ok: false, code: data?.error || `http_${r.status}` };
    if (typeof data?.src !== 'string' || !data.src.startsWith('r2:')) return { ok: false, code: 'bad_response' };
    return { ok: true, ...data };
  } catch (_) {
    return { ok: false, code: 'network' };
  }
}

// Tests only.
export function _resetWebImageCooldown() { cooldownUntil = 0; }
