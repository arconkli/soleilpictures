// sessionRepair.js — a data request refused because its sign-in token had
// expired is sent again once, with a fresh token.
//
// The auth client refreshes the token before it expires, by its own clock.
// When that clock is behind the server's (a laptop back from sleep, a phone
// whose time was set by hand), the server calls the token expired while the
// client still trusts it, and every read and write comes back 401 (PGRST303)
// until the client's next refresh: the app sat there going stale. Here a data
// request refused that way gets a refresh, one shared by every request refused
// at the same time, and is sent again once with the new token. A refresh the
// auth server refuses (the session is gone) signs the person out inside the
// auth client itself (SIGNED_OUT), and AuthGate shows the sign-in screen.
//
// Only data requests (/rest/v1/: tables and RPCs) are retried. The auth
// endpoints pass straight through, so the refresh can never loop on itself,
// and storage, functions and uploads answer an expired token in words of
// their own. Pure apart from what it is handed (sessionRepair.test.mjs).
// supabase.js loads this module on the client's first 401, so the entry chunk
// carries only a stub.

const DATA_REQUEST = /^https?:\/\/[^/?#]+\/rest\/v1\//i;

function urlOf(input) {
  return typeof input === 'string' ? input : String(input?.url || input || '');
}

function bearerOf(headers) {
  try {
    const v = new Headers(headers || undefined).get('authorization') || '';
    return /^bearer\s+(.+)$/i.exec(v)?.[1] || null;
  } catch (_) { return null; }
}

// The PostgREST code an answer's body names: {"code":"PGRST303","message":"JWT expired",…}.
export function bodyErrorCode(text) {
  try { const code = JSON.parse(text)?.code; return typeof code === 'string' ? code : null; } catch (_) { return null; }
}

// fetchNow: the fetch to send with, looked up on each call (netWatch.js wraps
// the global after this is built). getAuth: the auth client, or null.
export function makeSessionRepair({ fetchNow, getAuth }) {
  let refreshing = null;
  const refreshOnce = () => {
    if (!refreshing) {
      refreshing = Promise.resolve()
        .then(() => getAuth()?.refreshSession())
        .then((r) => r?.data?.session?.access_token || null, () => null)
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  };

  return async function repairExpired(res, input, init) {
    if (res?.status !== 401 || !DATA_REQUEST.test(urlOf(input))) return res;
    // A streamed body went with the first send; there is nothing to send again.
    if (typeof init?.body?.getReader === 'function') return res;
    let code = null;
    try { code = bodyErrorCode(await res.clone().text()); } catch (_) { return res; }
    if (code !== 'PGRST303') return res;
    const auth = getAuth();
    if (!auth) return res;
    const sent = bearerOf(init?.headers);
    // Another refused request may have refreshed already: then the stored
    // token is new, and this one only needs sending again with it.
    let token = null;
    try { token = (await auth.getSession())?.data?.session?.access_token || null; } catch (_) {}
    if (!token || token === sent) token = await refreshOnce();
    if (!token || token === sent) return res;
    const headers = new Headers(init?.headers || undefined);
    headers.set('Authorization', `Bearer ${token}`);
    return fetchNow(input, { ...(init || {}), headers });
  };
}

export function makeSessionRepairFetch({ fetchNow, getAuth }) {
  const repair = makeSessionRepair({ fetchNow, getAuth });
  return async (input, init) => repair(await fetchNow(input, init), input, init);
}
