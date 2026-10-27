// teamLinks: the two Team links' parsing, their stash and the one-shot note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTeamToken, teamLinkFromSearch, stashTeamLink, readTeamLink, clearTeamLink, stashTeamNote, takeTeamNote,
  TEAM_LINK_KEY, TEAMJOIN_PARAM, TEAMINVITE_PARAM } from './teamLinks.js';
import { joinUrl } from './teamModel.js';

const A = '7f0c2a9e-1b3d-4c5e-8f60-123456789abc';
const B = '11111111-2222-3333-4444-555555555555';

function fakeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function withStorage(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const ls = fakeStore();
  const ss = fakeStore();
  const prev = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  globalThis.window = { localStorage: ls, sessionStorage: ss };
  globalThis.localStorage = ls;
  globalThis.sessionStorage = ss;
  try { return fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'window', had); else delete globalThis.window;
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

test('parseTeamToken: a UUID, lowercased; junk is null', () => {
  assert.equal(parseTeamToken(A), A);
  assert.equal(parseTeamToken(A.toUpperCase()), A);
  assert.equal(parseTeamToken(`  ${A} `), A);
  assert.equal(parseTeamToken('nl-7f3k2q'), null);
  assert.equal(parseTeamToken(''), null);
  assert.equal(parseTeamToken(null), null);
  assert.equal(parseTeamToken(42), null);
});

test('teamLinkFromSearch: join, invite, invite first, junk', () => {
  assert.deepEqual(teamLinkFromSearch(`?teamjoin=${A}`), { kind: 'join', token: A });
  assert.deepEqual(teamLinkFromSearch(`teamjoin=${A}`), { kind: 'join', token: A });
  assert.deepEqual(teamLinkFromSearch(`?teaminvite=${B}`), { kind: 'invite', token: B });
  assert.deepEqual(teamLinkFromSearch(`?teamjoin=${A}&teaminvite=${B}`), { kind: 'invite', token: B });
  assert.deepEqual(teamLinkFromSearch(`?teaminvite=junk&teamjoin=${A}`), { kind: 'join', token: A });
  assert.equal(teamLinkFromSearch('?teamjoin=junk'), null);
  assert.equal(teamLinkFromSearch(''), null);
  assert.equal(teamLinkFromSearch(undefined), null);
});

test('the link stash round-trips and rejects bad shapes', () => withStorage(() => {
  assert.equal(readTeamLink(), null);
  stashTeamLink({ kind: 'join', token: A.toUpperCase() });
  assert.deepEqual(readTeamLink(), { kind: 'join', token: A });
  clearTeamLink();
  assert.equal(readTeamLink(), null);
  stashTeamLink({ kind: 'other', token: A });
  stashTeamLink({ kind: 'join', token: 'junk' });
  assert.equal(readTeamLink(), null);
  localStorage.setItem('soleil.boards.pending.teamlink', JSON.stringify({ kind: 'bogus', token: A }));
  assert.equal(readTeamLink(), null);
  localStorage.setItem('soleil.boards.pending.teamlink', 'not json');
  assert.equal(readTeamLink(), null);
}));

test('the note is taken once; empty and non-strings are ignored', () => withStorage(() => {
  assert.equal(takeTeamNote(), null);
  stashTeamNote('');
  stashTeamNote(null);
  stashTeamNote(7);
  assert.equal(takeTeamNote(), null);
  stashTeamNote('You’re in Northlight.');
  assert.equal(takeTeamNote(), 'You’re in Northlight.');
  assert.equal(takeTeamNote(), null);
}));

test('joinUrl: the default host and a given one', () => {
  assert.equal(joinUrl('abc'), 'clusters.soleilpictures.com/?teamjoin=abc');
  assert.equal(joinUrl('abc', 'preview.example.dev'), 'preview.example.dev/?teamjoin=abc');
});

// AuthGate is the entry chunk, so it checks for a team link without importing
// this module: its key and its address test must stay this module's.
test('AuthGate\'s own check names this stash key and both params', () => {
  const gate = readFileSync(new URL('../auth/AuthGate.jsx', import.meta.url), 'utf8');
  assert.ok(gate.includes(`const TEAM_LINK_KEY = '${TEAM_LINK_KEY}';`));
  const m = gate.match(/const TEAM_LINK_IN_URL = (\/.*\/);/);
  assert.ok(m, 'AuthGate tests the address for a team link');
  const re = new RegExp(m[1].slice(1, -1));
  assert.ok(re.test(`?${TEAMJOIN_PARAM}=x`) && re.test(`?a=1&${TEAMINVITE_PARAM}=x`));
  assert.ok(!re.test('?wsjoin=x') && !re.test('?steamjoin=x'));
  assert.doesNotMatch(gate, /from '..\/lib\/teamLinks\.js'/, 'AuthGate must not import teamLinks (entry chunk)');
});
