// Where the browser lands for the Team plan: /team, /team?checkout=cs_…
// (Stripe's success), /team?checkout=canceled, /team?billing=1 (the Customer
// Portal's return). Pure, so it can be tested in node.

export function readTeamReturn(pathname, search) {
  if (pathname !== '/team' && pathname !== '/team/') return null;
  let params;
  try { params = new URLSearchParams(search || ''); } catch (_) { params = new URLSearchParams(); }
  const checkout = params.get('checkout');
  if (checkout === 'canceled') return { kind: 'canceled' };
  if (checkout && checkout.startsWith('cs_')) return { kind: 'checkout', sessionId: checkout };
  if (params.get('billing') === '1') return { kind: 'billing' };
  return { kind: 'open' };
}

// Stripe can take a few seconds to finish: ask again after 2, 4 and 8 s.
export const VERIFY_RETRY_MS = [2000, 4000, 8000];

export async function verifyWithRetry(verify, sessionId, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let answer = await verify(sessionId);
  for (const ms of VERIFY_RETRY_MS) {
    if (answer?.error !== 'not_complete') return answer;
    await wait(ms);
    answer = await verify(sessionId);
  }
  return answer?.error === 'not_complete' ? { ...answer, gaveUp: true } : answer;
}
