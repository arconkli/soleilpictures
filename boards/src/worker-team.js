// /api/team/* — what a team needs the Worker for (Team S4).
//
// POST /api/team/domain-check {org_id, domain}: an owner or admin asks whether
// the TXT record their team was given is published yet. AUTH: the caller's
// session JWT, and the database decides who may: team_domain_challenge (0540)
// runs AS the caller and refuses anyone but the team's owner and admins. Only
// after it answered does the Worker ask DNS, and only on a match does it mark
// the domain verified with the service role (team_domain_mark_verified, 0534),
// which checks the token is still that row's.
//
// runTeamDomainRecheck, the daily cron: every verified domain is asked again,
// and one whose record DNS says is gone loses verified_at, which pauses
// auto-join until a check passes (0534). An answer DNS isn't sure of changes
// nothing.
//
// Dependencies arrive as a parameter so teamRoute.test.mjs can drive the
// refusals and the marking without a network.

import { dohUrl, txtAnswers, dnsAnswered, domainMatches } from './lib/teamDomainCheck.js';
import { makeRateLimiter } from './lib/webImageSave.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = 'soleil-verification=';
const RECHECK_MAX = 500;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// PostgREST, answering with its body either way: a refusal's hint is what the
// page shows, so it is read rather than thrown away.
async function rest(env, key, bearer, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

const rpcAsUser = (env, token, fn, params) =>
  rest(env, env.SUPABASE_ANON_KEY, token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(params || {}) });
const rpcAsService = (env, fn, params) =>
  rest(env, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_ROLE_KEY, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(params || {}) });
const selectAsService = (env, path) =>
  rest(env, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_ROLE_KEY, path, { method: 'GET' });

async function askDns(name) {
  const r = await fetch(dohUrl(name), { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}

// Six checks a minute per session, per isolate: it bounds a loop, not a
// determined caller, and DNS over HTTPS costs nothing.
const DEFAULT_DEPS = { rpcAsUser, rpcAsService, selectAsService, askDns, allow: makeRateLimiter({ perMinute: 6 }) };

export async function handleTeamRoute(url, request, env, deps = DEFAULT_DEPS) {
  if (url.pathname !== '/api/team/domain-check') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const bearer = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!bearer) return json({ error: 'auth required' }, 401);
  let body = null;
  try { body = await request.json(); } catch { body = null; }
  const orgId = typeof body?.org_id === 'string' ? body.org_id : '';
  const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  if (!UUID_RE.test(orgId) || !domain || domain.length > 253) return json({ error: 'bad_request' }, 400);
  if (!deps.allow(bearer[1])) return json({ error: 'too_many' }, 429);

  const ch = await deps.rpcAsUser(env, bearer[1], 'team_domain_challenge', { p_org_id: orgId, p_domain: domain });
  if (!ch.ok) {
    if (ch.status === 401 || ch.body?.code === 'PGRST301' || ch.body?.code === 'PGRST303') return json({ error: 'auth required' }, 401);
    // 0540 not applied yet: the check isn't there to run.
    if (ch.body?.code === 'PGRST202') return json({ error: 'not_available' }, 404);
    const hint = ch.body?.hint || null;
    if (hint === 'team_domain_missing') return json({ error: hint }, 404);
    if (hint) return json({ error: hint }, 409);
    throw new Error(`team_domain_challenge ${ch.status}`);
  }
  const row = Array.isArray(ch.body) ? ch.body[0] : ch.body;
  if (!row || typeof row.txt_value !== 'string' || !row.txt_value.startsWith(PREFIX)) {
    return json({ error: 'team_domain_missing' }, 404);
  }
  if (row.verified) return json({ ok: true, verified: true });

  const dns = await deps.askDns(row.txt_name).catch(() => null);
  if (!dns || !dnsAnswered(dns)) return json({ ok: true, verified: false, dns: 'unsure' });
  if (!domainMatches(txtAnswers(dns), row.txt_value)) return json({ ok: true, verified: false });

  const mark = await deps.rpcAsService(env, 'team_domain_mark_verified', {
    p_org_id: orgId, p_domain: domain, p_ok: true, p_token: row.txt_value.slice(PREFIX.length),
  });
  if (!mark.ok) {
    if (mark.body?.hint === 'team_domain_taken') return json({ error: 'team_domain_taken' }, 409);
    throw new Error(`team_domain_mark_verified ${mark.status}`);
  }
  return json({ ok: true, verified: mark.body === true });
}

export async function runTeamDomainRecheck(env, deps = DEFAULT_DEPS) {
  if (!env?.SUPABASE_SERVICE_ROLE_KEY) return { skipped: 'no service key' };
  const list = await deps.selectAsService(env,
    `org_domains?verified_at=not.is.null&select=org_id,domain,verify_token&order=verified_at.asc&limit=${RECHECK_MAX}`);
  if (!list.ok) throw new Error(`org_domains read ${list.status}`);
  const out = { checked: 0, unverified: 0, unsure: 0 };
  for (const d of Array.isArray(list.body) ? list.body : []) {
    out.checked += 1;
    const dns = await deps.askDns(d.domain).catch(() => null);
    if (!dns || !dnsAnswered(dns)) { out.unsure += 1; continue; }
    if (domainMatches(txtAnswers(dns), PREFIX + d.verify_token)) continue;
    const r = await deps.rpcAsService(env, 'team_domain_mark_verified', { p_org_id: d.org_id, p_domain: d.domain, p_ok: false });
    if (!r.ok) throw new Error(`team_domain_mark_verified ${r.status}`);
    out.unverified += 1;
  }
  return out;
}
