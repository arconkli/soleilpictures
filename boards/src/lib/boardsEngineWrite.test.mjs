// The boards engine's writer (scripts/lib/showcaseWrite.mjs writeBoard): a
// board with a sound, a PDF, a sub-cluster, tags, comments and a vote is
// stored the way the app stores each of them, and a failure undoes all of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBoard } from '../../scripts/lib/showcaseWrite.mjs';
import { fakeCrewIds, CREW } from '../../scripts/engine/crew.mjs';

// A Supabase stand-in: records every write, answers every read with nothing.
function fakeSupa({ failOn, links = null } = {}) {
  const log = [];
  let n = 0;
  const from = (table) => {
    const q = { table, op: 'select', rows: null, filters: [], selected: false };
    const result = () => {
      if (failOn && failOn === `${q.op}:${table}`) return { data: null, error: { message: `${table} refused` } };
      if (q.op === 'select') return { data: table === 'entity_links' ? links : null, error: null };
      if (q.op === 'insert' && q.selected) {
        const id = `${table}-${++n}`;
        q.rows[0].id = id;
        return { data: { id }, error: null };
      }
      return { data: null, error: null };
    };
    const b = {
      insert(rows) { q.op = 'insert'; q.rows = Array.isArray(rows) ? rows : [rows]; log.push(q); return b; },
      upsert(rows) { q.op = 'upsert'; q.rows = Array.isArray(rows) ? rows : [rows]; log.push(q); return b; },
      delete() { q.op = 'delete'; log.push(q); return b; },
      select() { if (q.op !== 'select') q.selected = true; return b; },
      eq(k, v) { q.filters.push([k, v]); return b; },
      is() { return b; },
      single() { return b; },
      maybeSingle() { return b; },
      then(ok, bad) { return Promise.resolve(result()).then(ok, bad); },
    };
    return b;
  };
  return { from, log, rows: (op, table) => log.filter((q) => q.op === op && q.table === table).flatMap((q) => q.rows || [q]) };
}

function fakeR2() {
  const puts = []; const dels = [];
  return { puts, dels, put: async (key, _b, type) => { puts.push({ key, type }); }, del: async (key) => { dels.push(key); } };
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'engine-write-'));
  const f = (name, bytes = 'x') => { const p = join(dir, name); writeFileSync(p, bytes); return p; };
  const pic = { file: f('a.jpg', 'aaaa'), w: 1600, h: 1067, sha: 'a' };
  const found = new Map([
    ['0.0', pic],
    ['0.1', { media: 'sound', file: f('s.m4a', 'sound!'), duration: 12, peaks: [0.1, 0.5], sha: 's', credit: { title: 'File:Rain.ogg' } }],
    ['0.2', { media: 'pdf', file: f('p.pdf', '%PDF'), thumb: f('p.webp', 'webp'), name: 'Call sheet.pdf', pageCount: 1, w: 300, h: 388, width: 612, height: 792 }],
    ['1.0', { file: f('b.jpg', 'bbbb'), w: 1200, h: 800, sha: 'b' }],
    ['1.1', { file: f('c.jpg', 'cccc'), w: 1200, h: 800, sha: 'c' }],
  ]);
  const childId = '11111111-2222-4333-8444-555555555555';
  const board = {
    name: 'Night market', bg: '#14161a', groups: [], arrows: [],
    strokes: [{ color: '#e5484d', width: 5, brush: 'marker', points: [[0, 0], [10, 10]] }],
    cards: [
      { id: 'img1', kind: 'image', photo: '0.0', x: 0, y: 0, w: 320, h: 213 },
      { id: 'snd1', kind: 'audio', photo: '0.1', coverPhoto: '0.0', title: 'Rain on the awning', duration: 12, x: 400, y: 0, w: 380, h: 130 },
      { id: 'pdf1', kind: 'pdf', photo: '0.2', name: 'Call sheet.pdf', pageCount: 1, x: 0, y: 300, w: 300, h: 388 },
      { id: childId, kind: 'board', x: 400, y: 300, w: 280, h: 200 },
    ],
    children: [{ id: childId, name: 'Stills', bg: '#14161a', groups: [], arrows: [], cards: [
      { id: 'c1', kind: 'image', photo: '1.0', x: 0, y: 0, w: 300, h: 200 },
      { id: 'c2', kind: 'image', photo: '1.1', x: 320, y: 0, w: 300, h: 200 },
    ] }],
    tags: [{ name: 'Night', cardIds: ['img1', 'pdf1'] }],
    comments: [{ cardId: 'img1', by: 'priya', text: 'This is the frame.', offset: { x: 330, y: 0 }, reply: { by: 'sam', text: 'Agreed.' } }],
    vote: { cardId: 'pdf1', label: 'Lock this call time?', up: 4, down: 1, offset: { x: 310, y: 0 } },
  };
  return { found, board, childId };
}

test('a sound, a PDF and a sub-cluster are stored like uploads, the sub-cluster a board under the board', async () => {
  const { found, board, childId } = fixture();
  const supa = fakeSupa(); const r2 = fakeR2();
  const crew = fakeCrewIds();
  const out = await writeBoard({ supa, r2, workspaceId: 'ws', userId: 'me', parentId: 'subject', board, found, crew });

  const boards = supa.rows('insert', 'boards');
  assert.deepEqual(boards.map((b) => [b.id, b.parent_board_id]), [[out.boardId, 'subject'], [childId, out.boardId]]);

  const byCard = (id) => out.cards.find((c) => c.id === id);
  const snd = byCard('snd1'); const pdf = byCard('pdf1'); const img = byCard('img1');
  assert.match(snd.src, /^r2:ws\/.+\.m4a$/);
  assert.match(snd.cover, /^r2:ws\/.+\.jpg$/);
  assert.notEqual(snd.cover, img.src, 'the cover is its own copy');
  assert.match(pdf.pdfSrc, /^r2:ws\/.+\.pdf$/);
  assert.match(pdf.src, /^r2:ws\/.+\.webp$/);
  for (const c of out.cards) for (const k of ['photo', 'photos', 'coverPhoto']) assert.equal(k in c, false, `${c.id} keeps ${k}`);

  const images = supa.rows('insert', 'images');
  const mine = images.filter((r) => r.board_id === out.boardId);
  assert.equal(mine.length, 5, 'picture, sound, cover, PDF and its page picture');
  assert.deepEqual(mine.filter((r) => r.card_id === 'snd1').length, 2);
  assert.equal(mine.find((r) => r.storage_path.endsWith('.pdf')).original_name, 'Call sheet.pdf');
  assert.ok(mine.every((r) => r.size_bytes > 0));
  assert.equal(images.filter((r) => r.board_id === childId).length, 2, 'the sub-cluster\'s own pictures');
  assert.deepEqual(r2.puts.filter((p) => p.key.endsWith('.m4a')).map((p) => p.type), ['audio/mp4']);
  assert.deepEqual(r2.puts.filter((p) => p.key.endsWith('.pdf')).map((p) => p.type), ['application/pdf']);

  const states = supa.rows('upsert', 'board_state');
  assert.deepEqual(states.map((s) => s.board_id), [out.boardId, childId]);
});

test('the tags, comments and vote are the crew\'s, each ballot a different person', async () => {
  const { found, board } = fixture();
  const supa = fakeSupa(); const r2 = fakeR2();
  const crew = fakeCrewIds();
  const out = await writeBoard({ supa, r2, workspaceId: 'ws', userId: 'me', parentId: 'subject', board, found, crew });

  const [tag] = supa.rows('insert', 'tags');
  assert.equal(tag.name, 'Night');
  assert.equal('slug' in tag, false, 'the slug is the database\'s to set');
  const links = supa.rows('insert', 'entity_links');
  assert.deepEqual(links.map((l) => [l.source_kind, l.source_id, l.target_kind, l.target_id, l.link_kind, l.source_board_id]),
    [['card', 'img1', 'tag', tag.id, 'applied', out.boardId], ['card', 'pdf1', 'tag', tag.id, 'applied', out.boardId]]);

  const comments = supa.rows('insert', 'comments');
  assert.equal(comments.length, 2);
  assert.equal(comments[0].author, crew.get('priya'));
  assert.equal(comments[0].anchor_kind, 'card');
  assert.equal(comments[0].anchor_id, 'img1');
  assert.deepEqual([comments[0].offset_x, comments[0].offset_y], [330, 0]);
  assert.equal(comments[1].author, crew.get('sam'));
  assert.equal(comments[1].reply_to, comments[0].id);

  const [vote] = supa.rows('insert', 'vote_cards');
  assert.equal(vote.anchor_id, 'pdf1');
  assert.equal(vote.label, 'Lock this call time?');
  const ballots = supa.rows('insert', 'vote_card_ballots');
  assert.equal(new Set(ballots.map((b) => b.user_id)).size, 5);
  assert.deepEqual(ballots.map((b) => b.value), [1, 1, 1, 1, -1]);
  assert.ok(ballots.every((b) => b.vote_card_id === vote.id && b.board_id === out.boardId));
  assert.ok(ballots.every((b) => CREW.some((m) => crew.get(m.key) === b.user_id)));
});

test('a tag the app\'s auto-tagger already put on a card is not linked twice', async () => {
  const { found, board } = fixture();
  board.tags = [{ name: 'Night', cardIds: ['img1', 'pdf1', 'img1'] }];
  // The fake answers the tag lookup with nothing, so the tag is new: its id is the first insert's.
  const supa = fakeSupa({ links: [{ source_id: 'pdf1', target_id: 'tags-1' }] });
  await writeBoard({ supa, r2: fakeR2(), workspaceId: 'ws', userId: 'me', parentId: 'subject', board, found, crew: fakeCrewIds() });
  const [tag] = supa.rows('insert', 'tags');
  assert.equal(tag.id, 'tags-1');
  assert.deepEqual(supa.rows('insert', 'entity_links').map((l) => l.source_id), ['img1']);
});

test('a failure undoes the sub-cluster before the board, the new tag and every file', async () => {
  const { found, board, childId } = fixture();
  const supa = fakeSupa({ failOn: 'insert:vote_cards' }); const r2 = fakeR2();
  await assert.rejects(writeBoard({ supa, r2, workspaceId: 'ws', userId: 'me', parentId: 'subject', board, found, crew: fakeCrewIds() }), /vote_cards refused/);
  const gone = supa.log.filter((q) => q.op === 'delete' && q.table === 'boards').map((q) => q.filters[0][1]);
  assert.equal(gone.length, 2);
  assert.equal(gone[0], childId, 'the sub-cluster goes first');
  assert.equal(supa.log.filter((q) => q.op === 'delete' && q.table === 'tags').length, 1);
  assert.deepEqual([...r2.dels].sort(), r2.puts.map((p) => p.key).sort());
});

test('a comment by someone without an account stops the write', async () => {
  const { found, board } = fixture();
  const crew = fakeCrewIds(); crew.delete('sam');
  await assert.rejects(writeBoard({ supa: fakeSupa(), r2: fakeR2(), workspaceId: 'ws', userId: 'me', parentId: 'subject', board, found, crew }), /no crew id for "sam"/);
});
