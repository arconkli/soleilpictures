// What the AI routes share: the JSON answer, the daily AI budget and the
// workspace AI switch.

// Asks tags_embed_budget_take, as the caller, whether these characters fit
// today's budget.
// 'ok' | 'over' | 'error'. 'error' (the RPC failed or timed out) is not a
// spent budget: answered as 503, which the client retries in a minute,
// rather than a 429, which parks it for an hour.
export async function takeEmbedBudget(env, request, chars) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/tags_embed_budget_take`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: request.headers.get('authorization') || '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_chars: chars }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return 'error';
    const yes = await r.json().catch(() => null);
    if (yes === true) return 'ok';
    return yes === false ? 'over' : 'error';
  } catch (_) {
    return 'error';
  }
}

export function budgetRefusal(verdict, what) {
  return verdict === 'over'
    ? json({ error: `daily ${what} budget reached` }, 429)
    : json({ error: 'budget check unavailable, try again shortly' }, 503);
}

// The workspace's AI switch, read as the caller (members can read their
// workspace). The client checks first; this is the backstop for a stale tab.
// Only an explicit false refuses.
export async function workspaceAiOff(env, request, workspaceId) {
  if (!workspaceId || !/^[0-9a-f-]{36}$/i.test(String(workspaceId))) return false;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=ai_tagger_enabled`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: request.headers.get('authorization') || '',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows[0]?.ai_tagger_enabled === false;
  } catch (_) {
    return false;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
