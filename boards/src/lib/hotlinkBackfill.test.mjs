// hotlinkBackfill.test.mjs — which old hotlinks a board open copies, and what
// is remembered so an impossible one is not fetched on every open.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isHotlinkImage, pickHotlinks, noteTried, loadTried, saveTried, urlKey, stopsThePass,
  HOTLINK_PER_OPEN, RETRY_AFTER_MS,
} from './hotlinkBackfill.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const img = (id, src, extra = {}) => ({ id, kind: 'image', src, ...extra });

test('only a finished image card pointing at the web is a hotlink', () => {
  assert.equal(isHotlinkImage(img('a', 'https://cdn.example.com/a.jpg')), true);
  assert.equal(isHotlinkImage(img('a', 'http://cdn.example.com/a.jpg')), true);
  for (const c of [
    img('a', 'r2:ws/a.jpg'), img('a', 'data:image/png;base64,AA'), img('a', 'blob:x'),
    img('a', 'https://cdn.example.com/a.jpg', { pending: true }),
    { id: 'l', kind: 'link', src: 'https://x.example' }, img('a', null),
  ]) assert.equal(isHotlinkImage(c), false, JSON.stringify(c));
});

test('a few per open, skipping what was tried this session or cannot be copied', () => {
  const now = 10 * RETRY_AFTER_MS;
  const cards = [
    img('1', 'https://a.example/1.jpg'), img('2', 'https://a.example/2.jpg'), img('3', 'https://a.example/3.jpg'),
    img('4', 'https://a.example/4.jpg'), img('5', 'https://a.example/5.jpg'), img('6', 'https://a.example/6.jpg'),
  ];
  const tried = {};
  noteTried(tried, 'https://a.example/1.jpg', 'not_an_image', 0);            // never again
  noteTried(tried, 'https://a.example/2.jpg', 'source_unavailable', now - 1000); // yesterday-ish: wait
  noteTried(tried, 'https://a.example/3.jpg', 'source_unavailable', now - RETRY_AFTER_MS - 1); // a day ago: retry
  const attempted = new Set(['4|https://a.example/4.jpg']);
  const picks = pickHotlinks(cards, { attempted, tried, now });
  assert.deepEqual(picks.map((c) => c.id), ['3', '5', '6']);
  assert.equal(picks.length <= HOTLINK_PER_OPEN, true);
  assert.deepEqual(pickHotlinks(cards, { tried, now, limit: 0 }), []);
});

test('the memo survives a reload, stays small, and shrugs off junk', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const tried = {};
  for (let i = 0; i < 520; i++) noteTried(tried, `https://a.example/${i}.jpg`, 'too_large', i);
  assert.equal(Object.keys(tried).length, 500, 'capped');
  assert.ok(!(urlKey('https://a.example/0.jpg') in tried), 'the oldest go first');
  saveTried(storage, tried);
  assert.deepEqual(loadTried(storage), tried);
  assert.deepEqual(loadTried({ getItem: () => '[1,2]' }), {});
  assert.deepEqual(loadTried({ getItem: () => '{not json' }), {});
  assert.deepEqual(loadTried(null), {});
  assert.doesNotThrow(() => saveTried({ setItem: () => { throw new Error('quota'); } }, {}));
  assert.ok(urlKey('https://x.example/' + 'a'.repeat(1900)).length < 20, 'a signed link is not stored whole');
});

test('account- and route-level refusals stop the pass; picture-level ones do not', () => {
  for (const c of ['over_quota', 'not_writer', 'rate_limited', 'cooldown', 'signed_out', 'busy']) assert.equal(stopsThePass(c), true, c);
  for (const c of ['not_an_image', 'too_large', 'source_unavailable', 'network']) assert.equal(stopsThePass(c), false, c);
});

test('the canvas runs it for writers only, after the server snapshot, and re-checks each card before moving it', () => {
  const canvas = readFileSync(resolve(SRC, 'components/CanvasSurface.jsx'), 'utf8');
  const fx = canvas.slice(canvas.indexOf('const hotlinkPassRef = useRef('));
  const body = fx.slice(0, fx.indexOf('}, [board?.id, cards, canEdit, isPublic, useLocalImages, boardSynced]);'));
  assert.match(body, /if \(!canEdit \|\| isPublic \|\| useLocalImages \|\| !board\?\.id \|\| !boardSynced\) return undefined;/);
  assert.match(body, /if \(!live \|\| live\.src !== c\.src\) continue;/, 'a card re-pointed meanwhile is left alone');
  assert.match(body, /sweepMutatorsRef\.current\?\.updateCardSilent\?\.\(c\.id, \{\s*src: res\.src, sourceUrl: c\.src/);
  assert.match(body, /if \(stopsThePass\(code\)\) return;/);
});
