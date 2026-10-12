// playerSession.test.mjs — the player's remembered settings (lib/playerSession.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPrefs, writePrefs, PREF_DEFAULTS } from './playerSession.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('defaults, round trip, and junk ignored', () => {
  const s = mem();
  assert.deepEqual(readPrefs(s), PREF_DEFAULTS);
  writePrefs({ rate: 0.5, volume: 0.4, muted: true, guide: '1.85', tcMode: 'frames' }, s);
  assert.deepEqual(readPrefs(s), { rate: 0.5, volume: 0.4, muted: true, guide: '1.85', tcMode: 'frames' });
  writePrefs({ rate: 99, volume: -1, tcMode: 'nope' }, s);
  const p = readPrefs(s);
  assert.equal(p.rate, 1);
  assert.equal(p.volume, 1);
  assert.equal(p.tcMode, null);
});

test('a storage that throws never breaks the player', () => {
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(readPrefs(bad), PREF_DEFAULTS);
  assert.equal(writePrefs({ rate: 2 }, bad), null);
  assert.deepEqual(readPrefs({ getItem: () => '[1,2]' }), PREF_DEFAULTS);
  assert.deepEqual(readPrefs(null), PREF_DEFAULTS);
});
