import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PARTY_HOST, PARTY_PROTOCOL, PARTY_ORIGIN, DEFAULT_PARTY_HOST } from './partyHost.js';
import { OLD_PARTY_HOST } from './partyDefaults.js';

const here = new URL('.', import.meta.url).pathname;
const boards = join(here, '..', '..');
const repo = join(boards, '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js|jsx|ts)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

test('an unstamped build talks to the default host, over https', () => {
  // The committed buildInfo.js is unstamped and node has no import.meta.env.
  assert.equal(PARTY_HOST, DEFAULT_PARTY_HOST);
  assert.equal(PARTY_PROTOCOL, 'https');
  assert.equal(PARTY_ORIGIN, `https://${DEFAULT_PARTY_HOST}`);
  assert.notEqual(DEFAULT_PARTY_HOST, OLD_PARTY_HOST);
});

test('no module reads the old dashboard variable or names the old host', () => {
  // VITE_PARTYKIT_HOST still names PartyKit in the Workers Builds dashboard; a
  // module that read it would quietly talk to a host that no longer exists.
  const allowedOldHost = new Set([
    join(here, 'partyDefaults.js'),     // OLD_PARTY_HOST, for the dual /reset
  ]);
  const offenders = [];
  for (const f of [...walk(join(boards, 'src')), ...walk(join(boards, 'party'))]) {
    const s = readFileSync(f, 'utf8');
    if (/import\.meta\.env\??\.VITE_PARTYKIT_HOST/.test(s)) offenders.push(`${f}: reads VITE_PARTYKIT_HOST`);
    if (s.includes(OLD_PARTY_HOST) && !allowedOldHost.has(f)) offenders.push(`${f}: names the old host`);
    if (/env\.PARTYKIT_HOST\b/.test(s)) offenders.push(`${f}: reads env.PARTYKIT_HOST`);
  }
  assert.deepEqual(offenders, []);
});

test('the stamp, the preconnect, Scout and the rewind function name the same host', () => {
  const stamp = read('boards/scripts/stamp-build.mjs');
  assert.match(stamp, /env\.VITE_PARTY_HOST \|\| DEFAULT_PARTY_HOST/);
  assert.ok(read('boards/index.html').includes(`<link rel="preconnect" href="https://${DEFAULT_PARTY_HOST}" crossorigin />`),
    'index.html preconnects to the party');
  assert.ok(read('scout/src/config.js').includes(`process.env.PARTY_HOST || '${DEFAULT_PARTY_HOST}'`));
  assert.ok(read('scout/fly.toml').includes(`PARTY_HOST = "${DEFAULT_PARTY_HOST}"`));
  const rewind = read('supabase/functions/workspace-rewind/index.ts');
  assert.ok(rewind.includes(`Deno.env.get("PARTY_HOST") || "${DEFAULT_PARTY_HOST}"`));
  assert.doesNotMatch(rewind, /Deno\.env\.get\("PARTYKIT_HOST"\)/);
});

test('the Worker proxies, CSP and early bundle fetches use the shared host', () => {
  const worker = read('boards/src/worker.js');
  assert.match(worker, /import \{ PARTY_HOST \} from '\.\/lib\/partyHost\.js';/);
  assert.match(worker, /connect-src 'self' [^`]*https:\/\/\$\{PARTY_HOST\} wss:\/\/\$\{PARTY_HOST\}/);
  assert.equal((worker.match(/'https:\/\/\$\{PARTY_HOST\}\/parties\/upload\/share\/share-bundle'/g) || []).length, 1);
  // A /c/ page asks this Worker (publicBundleRoute.test.mjs), which asks the party.
  assert.match(worker, /partyFetch\(env, `https:\/\/\$\{PARTY_HOST\}\/parties\/upload\/share\/public-bundle`/);
  assert.match(worker, /const target = `https:\/\/\$\{PARTY_HOST\}\/parties\/main\/\$\{encodeURIComponent\(boardId\)\}\/reset`;/);
  // Until PartyKit deletes it, the old room is reset too.
  assert.match(worker, /if \(Date\.now\(\) < Date\.parse\(OLD_PARTY_GONE_AFTER\)\) \{[\s\S]*?https:\/\/\$\{OLD_PARTY_HOST\}\/parties\/main\//);
});

test('the board provider is y-partyserver on the main party, with the liveness keepalive', () => {
  const y = read('boards/src/lib/yPartyKit.js');
  assert.match(y, /import YProvider from 'y-partyserver\/provider';/);
  assert.match(y, /new YProvider\(PARTY_HOST, boardId, ydoc, \{\s*party: 'main',/);
  assert.doesNotMatch(y, /from 'y-partykit/);
  assert.match(y, /if \(socketLooksDead\(provider\.wsLastMessageReceived, lastPingAt\)\) \{/);
  assert.match(y, /provider\.ws\.send\(encoding\.toUint8Array\(enc\)\);\n      lastPingAt = Date\.now\(\);/);
  assert.match(y, /clearInterval\(keepalive\)/);
  // The reset frame is read raw; the room never prefixes it.
  assert.match(y, /msg\.type !== 'soleil-board-reset'/);
});

test('a version restore marks itself before it resets the room', () => {
  const api = read('boards/src/lib/boardsApi.js');
  const body = api.slice(api.indexOf('export async function bulletproofRestore'));
  const write = body.indexOf('await saveBoardSnapshot(boardId, tmp);');
  const mark = body.indexOf("supabase.rpc('mark_board_restored', { p_board_id: boardId })");
  const reset = body.indexOf('await forceResetBoardRoom(boardId);');
  assert.ok(write > 0 && mark > write && reset > mark, 'write, then mark, then reset');
  assert.doesNotMatch(body.slice(mark, mark + 120), /\.catch\(/, 'never .catch() a supabase.rpc() builder');
});
