// Pins Admin › Boards' rules (showcaseLibrary.js): what waits for an OK, what
// the library shows, the filters, the shots and the engine line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  libraryView, thumbFor, bigShot, viewsFor, shotGroups, downloadUrl, sizeLabel, usedOn, checkLines,
  linksFor, engineState, nextRun, boardById, HAND_OKS,
} from './showcaseLibrary.js';

const shot = (kind, extra = {}) => ({
  kind, label: kind, file: `${kind}.png`, thumb: `${kind}.webp`, w: 2880, h: 1800, bytes: 900000,
  url: `/api/showcase-shot/B/${kind}.png?s=abc`, thumb_url: `/api/showcase-shot/B/${kind}.webp?s=def`, ...extra,
});
const ALL = ['desk-light', 'desk-dark', 'wide', 'board-light', 'board-dark', 'phone', 'portrait', 'square'].map((k) => shot(k));
const board = (over = {}) => ({
  board_id: over.board_id || 'b1', slug: 'afterglow', title: 'Afterglow: night exteriors', story: 'Cold blue nights',
  subject: 'film-lookbook', cluster: 'Film', page_path: '/tools/cinematography-lookbook', status: 'ok', placed_on: [],
  score: { grade: 5, summary: 'Clean', tries: 1, rejected: 2, cards: 24, photos: 18 },
  credits: [{ id: 'p1', source: 'Pexels' }, { id: 'u1', source: 'Unsplash' }], made_at: '2026-10-29T13:04:00Z',
  trashed: false, live: false, shots: ALL, ...over,
});
const NOW = new Date('2026-10-29T20:00:00Z');

test('waiting is the new boards, the library the OK\'d ones; trashed boards show in neither', () => {
  const v = libraryView({ boards: [
    board({ board_id: 'a', status: 'new' }), board({ board_id: 'b' }), board({ board_id: 'c', status: 'skipped' }),
    board({ board_id: 'd', status: 'new', trashed: true }), board({ board_id: 'e', trashed: true }),
  ], ok_by_person: 4 }, {}, NOW);
  assert.deepEqual(v.waiting.map((b) => b.board_id), ['a']);
  assert.deepEqual(v.tiles.map((b) => b.board_id), ['b']);
  assert.deepEqual(v.firstTen, { done: 4, of: HAND_OKS, finished: false });
  assert.equal(v.totals.boards, 1);
  assert.equal(v.totals.shots, ALL.length);
});

test('cluster chips count the library, biggest first; an unknown cluster falls back to all', () => {
  const data = { boards: [board({ board_id: 'a' }), board({ board_id: 'b' }), board({ board_id: 'c', cluster: 'Interiors' }),
    board({ board_id: 'd', cluster: null }), board({ board_id: 'e', cluster: 'Weddings', status: 'new' })] };
  const v = libraryView(data, { cluster: 'Interiors' }, NOW);
  assert.deepEqual(v.clusters.map((c) => [c.id, c.count]), [['all', 4], ['Film', 2], ['Interiors', 1], ['Unsorted', 1]]);
  assert.deepEqual(v.tiles.map((b) => b.board_id), ['c']);
  assert.equal(libraryView(data, { cluster: 'Weddings' }, NOW).cluster, 'all');
});

test('search covers title, cluster, subject, page, slug and story, every word', () => {
  const data = { boards: [board({ board_id: 'a' }), board({ board_id: 'b', title: 'Quiet oak', cluster: 'Interiors', slug: 'quiet-oak',
    subject: 'japandi', page_path: '/tools/free-mood-board-maker', story: 'A calm room' })] };
  const ids = (q) => libraryView(data, { q }, NOW).tiles.map((b) => b.board_id);
  assert.deepEqual(ids('oak'), ['b']);
  assert.deepEqual(ids('interiors calm'), ['b']);
  assert.deepEqual(ids('cinematography'), ['a']);
  assert.deepEqual(ids('cold blue'), ['a']);
  assert.deepEqual(ids('oak blue'), []);
  assert.deepEqual(ids(''), ['a', 'b']);
});

test('"on a search page" keeps only boards made for a page', () => {
  const data = { boards: [board({ board_id: 'a' }), board({ board_id: 'b', page_path: null })] };
  const v = libraryView(data, { onPage: true }, NOW);
  assert.deepEqual(v.tiles.map((b) => b.board_id), ['a']);
  assert.equal(v.onPageCount, 1);
});

test('thumbs follow the theme switch; both alternates; a tile is never blank', () => {
  const data = { boards: [board({ board_id: 'a' }), board({ board_id: 'b' })] };
  assert.match(libraryView(data, { theme: 'dark' }, NOW).tiles[0].thumb, /desk-dark\.webp/);
  assert.match(libraryView(data, { theme: 'light' }, NOW).tiles[1].thumb, /desk-light\.webp/);
  const both = libraryView(data, { theme: 'both' }, NOW).tiles.map((t) => t.thumb);
  assert.match(both[0], /desk-light/);
  assert.match(both[1], /desk-dark/);
  assert.match(thumbFor(board({ shots: [shot('square', { thumb_url: undefined })] }), 'dark'), /square\.png/);
  assert.equal(thumbFor(board({ shots: [] })), null);
});

test('the big picture: view × theme, the phone falls back to its one shot, missing views are hidden', () => {
  const b = board();
  assert.equal(bigShot(b, 'app', 'dark').kind, 'desk-dark');
  assert.equal(bigShot(b, 'board', 'light').kind, 'board-light');
  assert.equal(bigShot(b, 'phone', 'dark').kind, 'phone');
  const lightOnly = board({ shots: [shot('desk-light'), shot('phone')] });
  assert.equal(bigShot(lightOnly, 'app', 'dark').kind, 'desk-light');
  assert.deepEqual(viewsFor(lightOnly).map((v) => v.id), ['app', 'phone']);
});

test('shot groups: fixed order, close-ups apart, zip apart, unsigned rows dropped', () => {
  const b = board({ shots: [shot('square'), shot('card', { file: 'card-image-1.png' }), shot('wide'),
    shot('zip', { file: 'all.zip', w: 0, h: 0, bytes: 5 * 1024 * 1024 }), shot('desk-light'), { kind: 'portrait', file: 'portrait.png' }] });
  const g = shotGroups(b);
  assert.deepEqual(g.shots.map((s) => s.kind), ['wide', 'desk-light', 'square']);
  assert.equal(g.closeUps.length, 1);
  assert.equal(g.zip.file, 'all.zip');
  assert.equal(sizeLabel(g.zip), '5.0 MB');
  assert.equal(sizeLabel(g.shots[0]), '2880×1800');
});

test('download links ask for a readable name', () => {
  const b = board();
  assert.equal(downloadUrl(b, shot('wide')), '/api/showcase-shot/B/wide.png?s=abc&dl=afterglow-wide.png');
  assert.equal(downloadUrl(b, shot('zip', { file: 'all.zip', url: '/api/showcase-shot/B/all.zip?s=z' })),
    '/api/showcase-shot/B/all.zip?s=z&dl=afterglow-shots.zip');
  assert.equal(downloadUrl(b, { kind: 'wide' }), null);
});

test('used on: the search page, other placements, and the public page once live', () => {
  assert.deepEqual(usedOn(board()), [{ label: 'Search page', path: '/tools/cinematography-lookbook' }]);
  assert.deepEqual(usedOn(board({ live: true, placed_on: ['/tools/cinematography-lookbook', '/best/mood-board-apps'] })).map((u) => u.path),
    ['/tools/cinematography-lookbook', '/best/mood-board-apps', '/c/afterglow']);
  assert.deepEqual(usedOn(board({ page_path: null })), []);
});

test('check lines come from what the engine recorded', () => {
  const lines = checkLines(boardById({ boards: [board()] }, 'b1'));
  assert.ok(lines.includes('18 photos, every one passed the AI check'));
  assert.ok(lines.some((l) => l.includes('Pexels and Unsplash')));
  assert.ok(lines.includes("Claude's look: 5 of 5 against the bar"));
  assert.ok(checkLines(boardById({ boards: [board({ score: { grade: 4, tries: 2 } })] }, 'b1'))
    .includes("Claude's look: 4 of 5 against the bar (on try 2)"));
});

test('links: the app deep link, Capture Mode, and the live page only when live', () => {
  assert.deepEqual(linksFor(board()), { app: '/?to=b:b1', capture: '/?to=b:b1&capture=1', live: null });
  assert.equal(linksFor(board({ live: true })).live, '/c/afterglow');
});

test('engine line: on, quiet after a day and a half, stuck when the last run failed, never run', () => {
  const b = [board()];
  const ok = engineState({ started_at: '2026-10-29T13:00:00Z', finished_at: '2026-10-29T13:20:00Z', ok: true }, b, NOW);
  assert.equal(ok.tone, 'ok');
  assert.match(ok.detail, /last board today/);
  assert.match(ok.detail, /next tomorrow 6:00/);
  assert.equal(engineState({ started_at: '2026-10-27T13:00:00Z', finished_at: '2026-10-27T13:20:00Z', ok: true }, b, NOW).text, 'Engine quiet');
  const stuck = engineState({ started_at: '2026-10-29T13:00:00Z', finished_at: '2026-10-29T13:20:00Z', ok: false, note: 'grade 2/5' }, b, NOW);
  assert.equal(stuck.text, 'Engine stuck');
  assert.match(stuck.detail, /grade 2\/5/);
  assert.equal(engineState(null, [], NOW).text, 'Engine not run yet');
});

test('the next run is the next 06:00', () => {
  const before = new Date(2026, 9, 29, 5, 30);
  const after = new Date(2026, 9, 29, 6, 1);
  assert.equal(nextRun(before).getDate(), 29);
  assert.equal(nextRun(after).getDate(), 30);
  assert.equal(nextRun(after).getHours(), 6);
});

test('the first ten stop counting at ten', () => {
  assert.deepEqual(libraryView({ boards: [], ok_by_person: 14 }, {}, NOW).firstTen, { done: 10, of: 10, finished: true });
});
