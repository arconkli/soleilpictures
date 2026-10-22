// linkTokens.test.mjs — a link's token never goes on an event, an error report
// or Meta's pixel (owner, 2026-10-20; 0474).
//
//   node --test src/lib/linkTokens.test.mjs
//
// The rule lives in four places that must agree: the client's redaction
// (linkTokens.js, which buildRow runs on every row), the database's (0474's
// helpers and triggers, for every client version and every SQL writer), the
// pixel's guard inlined in index.html, and the same test in metaPixel.js for
// the page views the app fires itself. The token keeps exactly one home,
// profiles.first_source, where the sharer's credit reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';
import { LINK_TOKEN_KEYS, TOKEN_PARAMS, redactLinkText, redactLinkTokens, urlCarriesLinkToken } from './linkTokens.js';
import { firstSourcePayload } from './eventEnv.js';

const FILE = '0474_no_link_tokens_in_telemetry.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const SRC = new URL('..', import.meta.url).pathname;

// The same fake ids 0474's proof uses.
const TOK = '00000000-0000-4000-8000-000000000001';
const BOARD = '00000000-0000-4000-8000-000000000002';

test("the client redacts 0474's own samples the way the database does", () => {
  assert.deepEqual(redactLinkTokens({
    share_token: TOK, lt_share_token: TOK, file_token: TOK, lt_file_token: TOK,
    utm_source: 'share_link', utm_campaign: TOK, lt_utm_campaign: `share_link/${TOK.toUpperCase()}`,
    landing_path: `/share/${TOK}`, href: `https://clusters.soleilpictures.com/f/${TOK}?x=1`,
    board_id: BOARD, path_b: `/b/${BOARD}`, n: 3, ok: true,
  }), {
    utm_source: 'share_link', utm_campaign: ':token', lt_utm_campaign: 'share_link/:token',
    landing_path: '/share/:token', href: 'https://clusters.soleilpictures.com/f/:token?x=1',
    board_id: BOARD, path_b: `/b/${BOARD}`, n: 3, ok: true,
  });
  assert.deepEqual(redactLinkTokens({}), {});
  assert.equal(redactLinkTokens(null), null);
  assert.equal(redactLinkText(`/T/${TOK.toUpperCase()}/`), '/T/:token/');
  assert.equal(redactLinkText(`at https://x/share/${TOK}:1:20`), 'at https://x/share/:token:1:20');
  assert.equal(redactLinkText(null), null);
  // And the proof really does hold those samples.
  for (const s of ["'lt_utm_campaign', 'share_link/' || upper(v_tok)", "'path_b', '/b/' || v_board",
    "_redact_link_text('/T/' || upper(v_tok) || '/') is distinct from '/T/:token/'"]) {
    assert.ok(sql.includes(s), `0474's proof no longer carries ${s}`);
  }
});

test('the database drops the same keys and knows the same routes', () => {
  const def = latestDefinition('_redact_link_tokens');
  assert.ok(def && def.file === FILE, '0474 owns the latest redaction');
  const lists = [...def.body.matchAll(/(?:array\[|not in \()('share_token'[^\])]*)/g)]
    .map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  assert.equal(lists.length, 2, 'the fast path and the rebuild each name the keys');
  for (const keys of lists) assert.deepEqual(keys, [...LINK_TOKEN_KEYS]);
  const alternations = [...sql.matchAll(/\/\((?:\?:)?([a-z|]+)\)\/\)?\[0-9a-f\]\{8\}/g)].map((m) => m[1]);
  assert.ok(alternations.length >= 3, 'the text helper, the fast path and the rebuild');
  for (const a of alternations) assert.equal(a, 'share|f|t');
});

test('every route that opens something by its token is redacted and keeps the pixel away', () => {
  const main = read('../main.jsx');
  const routes = [...main.matchAll(/pathname\.match\(\/\^\\\/([a-z]+)\\\/\(\[0-9a-f-\]\{36\}\)/g)].map((m) => m[1]);
  assert.deepEqual(routes.sort(), ['f', 'share', 't'],
    'a new token route needs its place in linkTokens.js, 0474 (a new migration) and index.html');
  for (const r of routes) {
    assert.equal(redactLinkText(`/${r}/${TOK}`), `/${r}/:token`);
    assert.equal(urlCarriesLinkToken({ pathname: `/${r}/${TOK}`, search: '' }), true);
  }
});

test('the helpers and both trigger functions are closed, definer, and proven', () => {
  for (const fn of ['_redact_link_text(text)', '_redact_link_tokens(jsonb)',
    '_tg_redact_event_links()', '_tg_redact_client_error_links()']) {
    const esc = fn.replace(/[()]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated`), fn);
    assert.ok(sql.includes(`'public.${fn}'`), `${fn}: a REVOKE that reports success proves nothing`);
  }
  for (const fn of ['_tg_redact_event_links', '_tg_redact_client_error_links']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(\\)\\s+returns trigger\\s+language plpgsql\\s+security definer`),
      `${fn} must run as definer: the helpers it calls are closed to the inserting role`);
  }
});

test('events are redacted before the archive copies them, and error reports too', () => {
  assert.match(sql, /create or replace trigger analytics_events_c_redact_links\s+before insert on public\.analytics_events\s+for each row execute function public\._tg_redact_event_links\(\)/);
  assert.match(sql, /create or replace trigger client_errors_redact_links\s+before insert on public\.client_errors\s+for each row execute function public\._tg_redact_client_error_links\(\)/);
  // Postgres fires same-timing triggers in name order.
  const order = ['analytics_events_a_caller_guard', 'analytics_events_b_stamp_country',
    'analytics_events_c_redact_links', 'analytics_events_divert_synthetic'];
  assert.deepEqual([...order].sort(), order);
  assert.match(sql, new RegExp(`'${order.slice(0, 2).join(',')},'\\s+'${order.slice(2).join(',')}'`),
    "0474's proof must check the same order");
  // Created after the history pass, so no client's insert waits on it.
  assert.ok(sql.indexOf('create or replace trigger analytics_events_c_redact_links') > sql.indexOf('do $proof$'));
});

test('buildRow redacts every row the client sends', () => {
  const src = read('./analytics.js');
  assert.match(src, /props:\s+redactLinkTokens\(merged\),/);
  assert.match(src, /path:\s+typeof window !== 'undefined' \? redactLinkText\(window\.location\.pathname\) : null,/);
});

test("the token's one home is the profile: the stamp sends it unredacted", () => {
  const src = read('./analytics.js');
  assert.match(src, /firstSourcePayload\(getFirstSource\(\), ENV\)/);
  assert.match(src, /src\.share_token = String\(token\)\.slice\(0, 40\);/, 'the share page seeds the token for the stamp');
  const bag = { share_token: TOK, utm_source: 'share_link', utm_campaign: TOK, landing_path: `/share/${TOK}` };
  assert.equal(firstSourcePayload(bag, 'prod').share_token, TOK, "the sharer's credit reads it from profiles.first_source");
  assert.doesNotMatch(sql, /\bupdate\s+public\.profiles\b/i, '0474 must leave profiles.first_source alone');
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'local') walk(p, out); }
    else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

// The argument text of the call whose '(' is at `open`, by paren depth.
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

test('no event is handed a token by name', () => {
  // The redaction drops the four keys it knows; a token under any other name
  // would ride through, so none may be passed at all.
  const named = /(?:(?<!\$)\{|,)\s*(token|share_token|file_token|template_token|join_token|invite_token)\s*(?::|,|\})/;
  let calls = 0;
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\blogEvent(?:Now|Once)?\(/g)) {
      calls++;
      const args = argsAt(src, m.index + m[0].length - 1);
      assert.doesNotMatch(args, named, `${file.slice(SRC.length)}: ${args.slice(0, 120)}`);
    }
  }
  assert.ok(calls > 200, `found ${calls} log calls; the scan lost its way`);
});

test("index.html's guard and urlCarriesLinkToken answer every case alike", () => {
  const html = read('../../index.html');
  const fn = html.match(/function soleilLinkToken\(p, q\) \{[\s\S]*?\n {4}\}/);
  assert.ok(fn, 'index.html lost soleilLinkToken');
  const inline = vm.runInNewContext(`(${fn[0]})`);
  const carries = [
    [`/share/${TOK}`, ''], [`/f/${TOK}`, ''], [`/t/${TOK}`, `?b=${BOARD}`], [`/SHARE/${TOK.toUpperCase()}`, ''],
    ['/resume', `?rt=${'a'.repeat(64)}&w=${BOARD}`], ['/resume/', ''],
    ['/', `?utm_source=share_link&utm_medium=remix&utm_campaign=${TOK}&remix=t_${TOK}`],
    ['/', `?utm_source=file_share&utm_medium=cta&utm_campaign=${TOK}`],
    ...TOKEN_PARAMS.map((k) => ['/', `?${k}=${TOK}`]),
    ['/', `?utm_source=share_link&join=${TOK}`],
  ];
  const clean = [
    ['/', ''], ['/', '?utm_source=meta&utm_medium=paid&utm_campaign=fall_launch&fbclid=IwAR0abc'],
    ['/', `?b=${BOARD}&w=${BOARD}`], ['/', '?rejoin=1&reinvite=2'], ['/', '?ref=ABC123'],
    ['/', `?msclkid=${'ab'.repeat(16)}`], ['/pricing', '?lc=winback.v2'], ['/c/some-board', ''],
    ['/docs/getting-started', ''], ['/sharepoint', ''], ['/f', ''], ['/resume-tips', ''],
  ];
  for (const [p, q] of carries) {
    assert.equal(urlCarriesLinkToken({ pathname: p, search: q }), true, `${p}${q}`);
    assert.equal(inline(p, q), true, `index.html: ${p}${q}`);
  }
  for (const [p, q] of clean) {
    assert.equal(urlCarriesLinkToken({ pathname: p, search: q }), false, `${p}${q}`);
    assert.equal(inline(p, q), false, `index.html: ${p}${q}`);
  }
});

test('the pixel never loads where this page or the one before it holds a token', () => {
  const html = read('../../index.html');
  assert.ok(html.includes('var linkToken = soleilLinkToken(location.pathname, location.search)\n'
    + '      || (soleilRef !== null && soleilLinkToken(soleilRef.pathname, soleilRef.search));'));
  const guard = html.indexOf('if (navigator.globalPrivacyControl !== true && !linkToken) {');
  assert.ok(guard > html.indexOf('var linkToken'), 'the guard reads linkToken after it is set');
  assert.ok(guard < html.indexOf('connect.facebook.net/en_US/fbevents.js'), 'the loader sits inside the guard');
  assert.match(read('./metaPixel.js'),
    /export function trackPageView\(\) \{\s+if \(!fbqReady\(\) \|\| urlCarriesLinkToken\(window\.location\)\) return;/,
    "the app's own page views skip a token address too");
});

test('every param a link capture reads is a token param or opens nothing', () => {
  // Read by the capture sites and safe to report: a workspace or board id opens
  // nothing without membership, lc is an email's campaign tag, back says where
  // to return, ref is a referral code.
  const OPENS_NOTHING = new Set(['w', 'b', 'lc', 'back', 'ref']);
  const consts = {};
  for (const f of ['./workspaceLink.js', './shareReturn.js']) {
    for (const m of read(f).matchAll(/(?:export )?const ([A-Z][A-Z_]+) = '([a-z_]+)';/g)) consts[m[1]] = m[2];
  }
  const seen = new Set();
  for (const f of ['../auth/AuthGate.jsx', './shareReturn.js', '../components/fileShare/SharedFileHost.jsx',
    '../pages/ResumePage.jsx', './joinLink.js', './workspaceLink.js', './remix.js']) {
    for (const m of read(f).matchAll(/(?:searchParams|params|\bp|\))\.get\((?:'([a-z_]+)'|([A-Z][A-Z_]+))\)/g)) {
      const name = m[1] || consts[m[2]];
      assert.ok(name, `${f}: ${m[0]} names a constant this test cannot resolve`);
      seen.add(name);
      assert.ok(TOKEN_PARAMS.includes(name) || OPENS_NOTHING.has(name),
        `${f} reads ?${name}=: add it to TOKEN_PARAMS (and index.html) if it carries a token, or to OPENS_NOTHING here`);
    }
  }
  for (const k of TOKEN_PARAMS) assert.ok(seen.has(k), `TOKEN_PARAMS names ?${k}=, which no capture site reads`);
});
