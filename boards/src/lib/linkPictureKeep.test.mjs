// linkPictureKeep.test.mjs — which link cards and link cells get their own copy
// of the picture they show, and how the canvas draws and writes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isWebAddress, isKept, keptPicture, pictureTag, pickLinkPictures, keptFields,
  loadLinkTried, saveLinkTried, LINK_PER_OPEN,
} from './linkPictureKeep.js';
import { noteTried, urlKey, stopsThePass, RETRY_AFTER_MS } from './hotlinkBackfill.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(SRC, p), 'utf8');
const link = (id, image, extra = {}) => ({ id, kind: 'link', source: 'https://site.example', image, ...extra });
const grid = (id) => ({ id, kind: 'grid' });
const KEY = 'r2:ws-1/previews/link/aaaa-bbbb-cccc-dddd-eeee.png';

test('a web address is http or https, nothing else', () => {
  assert.equal(isWebAddress('https://cdn.example.com/og.png'), true);
  assert.equal(isWebAddress('HTTP://cdn.example.com/og.png'), true);
  for (const v of ['r2:ws/a.png', 'data:image/png;base64,AA', 'blob:x', '', null, undefined, 5, {}]) assert.equal(isWebAddress(v), false, String(v));
});

test('kept means the full r2: sentinel, taken from the picture the card shows now', () => {
  const image = 'https://cdn.example.com/og.png';
  assert.equal(isKept({ image, imageKey: KEY, imageKeyOf: image }), true);
  assert.equal(isKept({ image }), false, 'no copy yet');
  assert.equal(isKept({ image, imageKey: KEY }), false, 'no source recorded');
  assert.equal(isKept({ image, imageKey: KEY, imageKeyOf: 'https://cdn.example.com/other.png' }), false, 'the picture changed since');
  assert.equal(isKept({ image, imageKey: 'ws-1/previews/link/a.png', imageKeyOf: image }), false, 'a bare key is not the sentinel the sweep looks for');
  assert.equal(isKept({ image, imageKey: 7, imageKeyOf: image }), false);
  assert.equal(keptPicture({ image, imageKey: KEY, imageKeyOf: image }), KEY, 'what R2Image is given');
  assert.equal(keptPicture({ image, imageKey: KEY, imageKeyOf: 'https://cdn.example.com/other.png' }), null, 'a stale copy is not drawn');
  assert.equal(keptPicture({ image: null, imageKey: KEY, imageKeyOf: null }), null);
  assert.equal(keptPicture({ image: 'r2:ws/x.png', imageKey: KEY, imageKeyOf: 'r2:ws/x.png' }), null, 'only a web picture has a copy to draw');
});

test('the fields written onto a card or cell leave image alone', () => {
  assert.deepEqual(keptFields(KEY, 'https://cdn.example.com/og.png'), { imageKey: KEY, imageKeyOf: 'https://cdn.example.com/og.png' });
  assert.ok(!('image' in keptFields(KEY, 'https://cdn.example.com/og.png')), 'image is the source and the fallback: never rewritten');
});

test('candidates are link cards with a web picture that is not already kept', () => {
  const image = 'https://cdn.example.com/og.png';
  const cards = [
    link('a', image),
    link('kept', image, { imageKey: KEY, imageKeyOf: image }),
    link('stale', image, { imageKey: KEY, imageKeyOf: 'https://cdn.example.com/old.png' }),
    link('none', undefined),
    link('ours', 'r2:ws/x.png'),
    link('data', 'data:image/png;base64,AA'),
    { id: 'img', kind: 'image', src: image, image },
    { id: 'note', kind: 'note', image },
  ];
  const picks = pickLinkPictures(cards, { now: 0 });
  assert.deepEqual(picks.map((p) => p.cardId), ['a', 'stale']);
  assert.deepEqual(picks[0], { cardId: 'a', cellId: null, image, tag: pictureTag('a', null, image) });
});

test('link cells of a grid are candidates, read through cellsOf', () => {
  const image = 'https://cdn.example.com/c.png';
  const cells = {
    c1: { type: 'link', image },
    c2: { type: 'link', image, imageKey: KEY, imageKeyOf: image },
    c3: { type: 'image', src: 'https://cdn.example.com/x.png', image },
    c4: { type: 'text', image },
    c5: { type: 'link', image: 'https://cdn.example.com/d.png' },
    c6: { type: 'link' },
  };
  const asked = [];
  const picks = pickLinkPictures([grid('g1'), link('l1', image), { id: 'n', kind: 'note' }], {
    now: 0, cellsOf: (c) => { asked.push(c.id); return c.id === 'g1' ? cells : null; },
  });
  assert.deepEqual(picks.map((p) => [p.cardId, p.cellId]), [['g1', 'c1'], ['g1', 'c5'], ['l1', null]]);
  assert.deepEqual(asked, ['g1'], 'only grids are read, and a link card needs no cells');
  assert.equal(picks[0].tag, pictureTag('g1', 'c1', image));
  assert.notEqual(pictureTag('g1', 'c1', image), pictureTag('g1', 'c5', image), 'one address in two cells is two candidates');
  // A grid that cannot be read is skipped, not thrown on.
  assert.deepEqual(pickLinkPictures([grid('g2')], { cellsOf: () => null }), []);
  assert.deepEqual(pickLinkPictures([grid('g2')]), [], 'cellsOf is optional');
});

test('a link card or cell is judged on its own address, so a changed picture is kept again', () => {
  const was = 'https://cdn.example.com/old.png';
  const now = 'https://cdn.example.com/new.png';
  const refreshed = link('a', now, { imageKey: KEY, imageKeyOf: was });
  assert.deepEqual(pickLinkPictures([refreshed], { now: 0 }).map((p) => p.image), [now]);
  assert.deepEqual(pickLinkPictures([link('a', now, { imageKey: KEY, imageKeyOf: now })], { now: 0 }), []);
});

test('LINK_PER_OPEN is 8, and limit caps one pick as it caps a pass', () => {
  assert.equal(LINK_PER_OPEN, 8);
  const cards = Array.from({ length: 20 }, (_, i) => link(`c${i}`, `https://cdn.example.com/${i}.png`));
  assert.equal(pickLinkPictures(cards, { now: 0 }).length, LINK_PER_OPEN, 'the default is a pass\'s worth');
  assert.equal(pickLinkPictures(cards, { now: 0, limit: 3 }).length, 3);
  assert.deepEqual(pickLinkPictures(cards, { now: 0, limit: 1 }).map((p) => p.cardId), ['c0']);
  assert.deepEqual(pickLinkPictures(cards, { now: 0, limit: 0 }), []);
  // Cells count against the same limit as cards.
  const cells = { a: { type: 'link', image: 'https://cdn.example.com/a.png' }, b: { type: 'link', image: 'https://cdn.example.com/b.png' } };
  assert.equal(pickLinkPictures([grid('g'), ...cards], { now: 0, limit: 5, cellsOf: () => cells }).length, 5);
});

test('skipping what was asked about this session, cannot be copied, or was tried in the last day', () => {
  const now = 10 * RETRY_AFTER_MS;
  const cards = ['1', '2', '3', '4', '5'].map((n) => link(n, `https://a.example/${n}.png`));
  const tried = {};
  noteTried(tried, 'https://a.example/1.png', 'not_an_image', 0);                    // never again
  noteTried(tried, 'https://a.example/2.png', 'source_unavailable', now - 1000);        // wait
  noteTried(tried, 'https://a.example/3.png', 'source_unavailable', now - RETRY_AFTER_MS - 1); // a day ago: retry
  const attempted = new Set([pictureTag('4', null, 'https://a.example/4.png')]);
  assert.deepEqual(pickLinkPictures(cards, { attempted, tried, now }).map((p) => p.cardId), ['3', '5']);
  // The memo is keyed by address, so the same picture on another card is skipped too.
  assert.deepEqual(pickLinkPictures([link('x', 'https://a.example/1.png')], { tried, now }), []);
  // And a cell is skipped by the same memo.
  assert.deepEqual(pickLinkPictures([grid('g')], { tried, now, cellsOf: () => ({ k: { type: 'link', image: 'https://a.example/1.png' } }) }), []);
});

test('the memo is its own — a link picture refused does not silence a hotlink repair, and the reverse', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const tried = {};
  noteTried(tried, 'https://a.example/1.png', 'too_large', 5);
  saveLinkTried(storage, tried);
  assert.deepEqual(loadLinkTried(storage), tried, 'survives a reload');
  assert.deepEqual([...store.keys()], ['soleil.linkPictureTried.v1'], 'its own key, not soleil.hotlinkTried.v1');
  assert.ok(urlKey('https://a.example/1.png') in loadLinkTried(storage));
  assert.deepEqual(loadLinkTried({ getItem: () => '[1,2]' }), {});
  assert.deepEqual(loadLinkTried({ getItem: () => '{not json' }), {});
  assert.deepEqual(loadLinkTried(null), {});
  assert.doesNotThrow(() => saveLinkTried({ setItem: () => { throw new Error('quota'); } }, {}));
  assert.doesNotThrow(() => saveLinkTried(null, {}));
});

test('the pass stops on the same codes as the hotlink pass', () => {
  for (const c of ['over_quota', 'not_writer', 'rate_limited', 'cooldown', 'signed_out', 'busy']) assert.equal(stopsThePass(c), true, c);
  for (const c of ['not_an_image', 'too_large', 'source_unavailable', 'network']) assert.equal(stopsThePass(c), false, c);
});

test('the canvas runs it for writers only, after the server snapshot, one request at a time, and re-checks before writing', () => {
  const canvas = read('components/CanvasSurface.jsx');
  const fx = canvas.slice(canvas.indexOf('const linkPassRef = useRef('));
  const body = fx.slice(0, fx.indexOf('}, [board?.id, linkSig, canEdit, isPublic, useLocalImages, boardSynced]);'));
  assert.ok(body.length > 200, 'found the effect');
  assert.match(body, /if \(!canEdit \|\| isPublic \|\| useLocalImages \|\| !board\?\.id \|\| !boardSynced\) return undefined;/);
  assert.match(body, /pass\.n >= LINK_PER_OPEN/, 'a per-open cap');
  assert.match(body, /if \(pass\.busy\) return;/, 'one pass at a time');
  assert.match(body, /purpose: 'link'/, 'asks the route for a link picture, not an upload');
  assert.match(body, /if \(stopsThePass\(code\)\) return;/);
  assert.match(body, /saveLinkTried\(store, noteTried\(loadLinkTried\(store\), c\.image, code\)\)/, 'its own memo');
  assert.match(body, /live\.image !== c\.image/, 'a card re-pointed meanwhile is left alone');
  // Not the person's edit: no "modified by" stamp, off the undo stack.
  assert.match(body, /\(m\?\.updateCardMeta \|\| m\?\.updateCardSilent\)\?\.\(c\.cardId, keptFields\(res\.src, c\.image\)\)/);
  assert.match(body, /setGridCell\(ydocRef\.current, cardYMap, c\.cellId, keptFields\(res\.src, c\.image\), 'upload'\)/);
  assert.ok(!/logEvent/.test(body), 'a silent pass: an ok:false event would read as a failure in Admin › Issues');
});

test('a link card and a link cell draw from the copy and fall back to the site\'s picture', () => {
  const cards = read('components/cards.jsx');
  const shared = read('components/cards/gridCellShared.jsx');
  // One component draws both, so the two cannot disagree about when a copy is used.
  assert.match(shared, /export function LinkPicture\(/);
  assert.match(shared, /const kept = keptPicture\(\{ image, imageKey, imageKeyOf \}\);/);
  assert.match(shared, /if \(!kept \|\| broken === kept\) return fallback;/);
  assert.match(shared, /<R2Image\s+progressive\s+src=\{kept\}/);
  assert.match(shared, /onError=\{\(\) => setBroken\(kept\)\}/);
  assert.match(shared, /state === 'none'/, 'a copy that cannot be signed hands back to the site too: R2Image calls no onError for it');
  // The link card: the old <img> is the fallback, unchanged.
  assert.match(cards, /<LinkPicture image=\{image\} imageKey=\{imageKey\} imageKeyOf=\{imageKeyOf\}/);
  assert.match(cards, /<img className="lc-preview-img" src=\{image\} alt=""\s+onError=\{\(e\) => \{ e\.currentTarget\.style\.display = 'none'; \}\} \/>/);
  // The cell: cardId is `${cardId}:${cellId}`, the same scheduler id the image cell uses.
  assert.match(shared, /<LinkPicture[\s\S]*?cardId=\{cardId && cellId \? `\$\{cardId\}:\$\{cellId\}` : undefined\}[\s\S]*?fallback=\{<img className="gc-link-img" src=\{cell\.image\}/);
  const canvas = read('components/CanvasSurface.jsx');
  assert.match(canvas, /image=\{c\.image\} imageKey=\{c\.imageKey\} imageKeyOf=\{c\.imageKeyOf\}[\s\S]*?cardId=\{c\.id\} boardId=\{board\.id\} backfillEnabled=\{canEdit\}/);
});
