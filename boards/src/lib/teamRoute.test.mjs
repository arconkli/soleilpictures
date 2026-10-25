// worker-team.js: the Team domain check. The database decides who may check
// (team_domain_challenge as the caller); DNS decides whether the record is
// there; only a match marks the domain verified, with the row's own token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleTeamRoute, runTeamDomainRecheck } from '../worker-team.js';
import { txtAnswers, dnsAnswered, domainMatches, dohUrl } from './teamDomainCheck.js';

const ORG = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'abc123';
const VALUE = `soleil-verification=${TOKEN}`;
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const dnsWith = (...data) => ({ Status: 0, Answer: data.map((d) => ({ type: 16, data: d })) });

function deps(over = {}) {
  const calls = [];
  return {
    calls,
    allow: () => true,
    rpcAsUser: async (_env, token, fn, params) => {
      calls.push(['user', fn, params, token]);
      return { ok: true, status: 200, body: [{ txt_name: 'northlight.studio', txt_value: VALUE, verified: false }] };
    },
    rpcAsService: async (_env, fn, params) => { calls.push(['service', fn, params]); return { ok: true, status: 200, body: true }; },
    selectAsService: async () => ({ ok: true, status: 200, body: [] }),
    askDns: async () => dnsWith(`"${VALUE}"`),
    ...over,
  };
}
const post = (body, auth = 'Bearer user-jwt') => new Request('https://app.example/api/team/domain-check', {
  method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const url = new URL('https://app.example/api/team/domain-check');
const call = async (d, body = { org_id: ORG, domain: 'Northlight.Studio' }, auth) => {
  const res = await handleTeamRoute(url, post(body, auth), env, d);
  return { status: res.status, body: await res.json() };
};

test('TXT answers: quoted, split and escaped strings read as DNS means them', () => {
  assert.deepEqual(txtAnswers(dnsWith('"soleil-verification=" "abc123"', '"v=spf1 -all"')), [VALUE, 'v=spf1 -all']);
  assert.deepEqual(txtAnswers(dnsWith('"say \\"hi\\""')), ['say "hi"']);
  assert.deepEqual(txtAnswers({ Status: 0, Answer: [{ type: 5, data: 'cname.example.' }] }), []);
  assert.deepEqual(txtAnswers(null), []);
  assert.equal(dnsAnswered({ Status: 0 }), true);
  assert.equal(dnsAnswered({ Status: 3 }), true);
  assert.equal(dnsAnswered({ Status: 2 }), false, 'SERVFAIL says nothing');
  assert.equal(domainMatches([` ${VALUE} `], VALUE), true);
  assert.equal(domainMatches(['soleil-verification=other'], VALUE), false);
  assert.equal(domainMatches([''], ''), false);
  assert.equal(dohUrl('a.example'), 'https://cloudflare-dns.com/dns-query?name=a.example&type=TXT');
});

test('a match marks the domain verified with the row\'s own token, after the database said who may', async () => {
  const d = deps();
  assert.deepEqual(await call(d), { status: 200, body: { ok: true, verified: true } });
  assert.deepEqual(d.calls[0], ['user', 'team_domain_challenge', { p_org_id: ORG, p_domain: 'northlight.studio' }, 'user-jwt']);
  assert.deepEqual(d.calls[1], ['service', 'team_domain_mark_verified',
    { p_org_id: ORG, p_domain: 'northlight.studio', p_ok: true, p_token: TOKEN }]);
});

test('no record, an unsure answer, or one already verified marks nothing', async () => {
  let d = deps({ askDns: async () => dnsWith('"v=spf1 -all"') });
  assert.deepEqual(await call(d), { status: 200, body: { ok: true, verified: false } });
  assert.equal(d.calls.some((c) => c[0] === 'service'), false);
  d = deps({ askDns: async () => ({ Status: 2 }) });
  assert.deepEqual(await call(d), { status: 200, body: { ok: true, verified: false, dns: 'unsure' } });
  d = deps({ askDns: async () => { throw new Error('timeout'); } });
  assert.equal((await call(d)).body.dns, 'unsure');
  d = deps({ rpcAsUser: async () => ({ ok: true, status: 200, body: [{ txt_name: 'n.example', txt_value: VALUE, verified: true }] }),
    askDns: async () => { throw new Error('never asked'); } });
  assert.deepEqual(await call(d), { status: 200, body: { ok: true, verified: true } });
  assert.equal(d.calls.length, 0);
});

test('the database\'s refusals come back as their hints, and DNS is never asked', async () => {
  const refusing = (status, body) => deps({ rpcAsUser: async () => ({ ok: false, status, body }),
    askDns: async () => { throw new Error('never asked'); } });
  assert.deepEqual(await call(refusing(403, { code: '42501', hint: 'team_not_admin' })), { status: 409, body: { error: 'team_not_admin' } });
  assert.deepEqual(await call(refusing(403, { code: '42501', hint: 'team_not_member' })), { status: 409, body: { error: 'team_not_member' } });
  assert.deepEqual(await call(refusing(404, { code: 'P0002', hint: 'team_domain_missing' })), { status: 404, body: { error: 'team_domain_missing' } });
  assert.deepEqual(await call(refusing(401, { code: 'PGRST301' })), { status: 401, body: { error: 'auth required' } });
  assert.deepEqual(await call(refusing(404, { code: 'PGRST202' })), { status: 404, body: { error: 'not_available' } });
  await assert.rejects(() => call(refusing(500, { code: 'XX000' })), /team_domain_challenge 500/, 'a server fault is a 5xx at the door');
});

test('another team\'s verified domain is refused; bad requests never reach the database', async () => {
  const d = deps({ rpcAsService: async () => ({ ok: false, status: 409, body: { code: '23505', hint: 'team_domain_taken' } }) });
  assert.deepEqual(await call(d), { status: 409, body: { error: 'team_domain_taken' } });
  const quiet = deps({ rpcAsUser: async () => { throw new Error('never called'); } });
  assert.equal((await call(quiet, { org_id: 'nope', domain: 'a.example' })).status, 400);
  assert.equal((await call(quiet, { org_id: ORG, domain: '' })).status, 400);
  assert.equal((await call(quiet, { org_id: ORG, domain: 'a.example' }, '')).status, 401);
  assert.equal((await call(deps({ allow: () => false }))).status, 429);
  const get = await handleTeamRoute(url, new Request(url, { method: 'GET' }), env, quiet);
  assert.equal(get.status, 405);
  const other = await handleTeamRoute(new URL('https://app.example/api/team/other'), post({}), env, quiet);
  assert.equal(other.status, 404);
});

test('the daily re-check unverifies only a record DNS is sure is gone', async () => {
  const rows = [
    { org_id: ORG, domain: 'kept.example', verify_token: 'k' },
    { org_id: ORG, domain: 'gone.example', verify_token: 'g' },
    { org_id: ORG, domain: 'unsure.example', verify_token: 'u' },
  ];
  const d = deps({
    selectAsService: async (_env, path) => {
      assert.match(path, /^org_domains\?verified_at=not\.is\.null&select=org_id,domain,verify_token/);
      return { ok: true, status: 200, body: rows };
    },
    askDns: async (name) => (name === 'kept.example' ? dnsWith('"soleil-verification=k"')
      : name === 'gone.example' ? { Status: 3 } : { Status: 2 }),
  });
  assert.deepEqual(await runTeamDomainRecheck(env, d), { checked: 3, unverified: 1, unsure: 1 });
  assert.deepEqual(d.calls, [['service', 'team_domain_mark_verified', { p_org_id: ORG, p_domain: 'gone.example', p_ok: false }]]);
  assert.deepEqual(await runTeamDomainRecheck({}, d), { skipped: 'no service key' });
});
