// Sign-in answers, made safe for a computer whose clock is off. The sign-in
// library trusts the server's "expires_at", so a clock an hour ahead made every
// new sign-in look expired on arrival: it refreshed again and again until the
// server said "slow down" (429), which the library treats as a refused sign-in
// and signs the person out.
//   1. A new session's expires_at is restated in this device's own time when
//      it differs from it by more than a minute.
//   2. A refresh the server turned away for load (429 or 5xx) is relabelled 503,
//      which the library retries with a pause and never signs out for.
// A 400 (token revoked or reused) is left alone, and so is every other request.
const dropLength = (h) => { const o = new Headers(h); o.delete('content-length'); o.delete('content-encoding'); return o; };

export async function fixAuthResponse(res, input, init, nowMs = Date.now()) {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input));
  const method = (init?.method || input?.method || 'GET').toUpperCase();
  const m = /\/auth\/v1\/([^?#]*)(?:\?([^#]*))?/.exec(url);
  if (!m) return res;
  const { status, statusText } = res;
  if (/^token\/?$/.test(m[1]) && /(^|&)grant_type=refresh_token(&|$)/.test(m[2] || '')) {
    if ((status === 429 || status >= 500) && status !== 503) {
      return new Response(res.body, { status: 503, statusText: 'Service Unavailable', headers: dropLength(res.headers) });
    }
  }
  if (method !== 'POST' || !res.ok) return res;
  let body;
  try { body = JSON.parse(await res.clone().text()); } catch (_) { return res; }
  if (!body || typeof body !== 'object' || typeof body.access_token !== 'string' || !body.access_token) return res;
  const { expires_in: inSec, expires_at: at } = body;
  if (!Number.isFinite(inSec) || inSec <= 0 || !Number.isFinite(at)) return res;
  const local = Math.round(nowMs / 1000) + inSec;
  if (Math.abs(at - local) <= 60) return res;
  body.expires_at = local;
  return new Response(JSON.stringify(body), { status, statusText, headers: dropLength(res.headers) });
}
