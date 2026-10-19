import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { displayName, nameSortKey, itemFromIndexRow, itemFromCard, cardFromItem } from './indexRowCard.js';

test('displayName chain and kind fallbacks', () => {
  assert.equal(displayName({ kind: 'image', title: '  Hi ' }), 'Hi');
  assert.equal(displayName({ kind: 'image', meta: { fileName: 'a.jpg', name: 'b' } }), 'a.jpg');
  assert.equal(displayName({ kind: 'pdf', meta: { name: 'b.pdf' } }), 'b.pdf');
  assert.equal(displayName({ kind: 'note', snippet: '\n  first line  \nsecond' }), 'first line');
  assert.equal(displayName({ kind: 'note', snippet: 'x'.repeat(200) }).length, 80);
  const f = {
    image: 'Photo', video: 'Video', audio: 'Audio', pdf: 'PDF', file: 'File', note: 'Note', doc: 'Untitled doc',
    grid: 'Grid', palette: 'Palette', schedule: 'Schedule', art: 'Drawing', vote: 'Vote', shape: 'Shape',
    'something-new': 'Card',
  };
  for (const [k, v] of Object.entries(f)) assert.equal(displayName({ kind: k }), v);
  assert.equal(displayName({ kind: 'shape', meta: { shape: 'ellipse' } }), 'Ellipse');
  assert.equal(displayName({ kind: 'shape', meta: { shape: 'arrow', label: null } }), 'Arrow');
  assert.equal(displayName({ kind: 'palette', title: 'Night exteriors' }), 'Night exteriors');
  assert.equal(displayName({ kind: 'link', meta: { url: 'https://www.example.com/x' } }), 'example.com');
  assert.equal(displayName({ kind: 'link', meta: { url: 'nope' } }), 'Link');
  assert.equal(displayName({ kind: 'link' }), 'Link');
});

test('nameSortKey mirrors the SQL coalesce order, with no kind fallback', () => {
  const sql = fs.readFileSync(new URL('../../../supabase/migrations/0419_sidebar_files.sql', import.meta.url), 'utf8');
  const chain = [...sql.matchAll(/nullif\(btrim\(ci\.(title|meta->>'\w+')\), ''\)|left\(ci\.body, 120\)/g)].map((m) => m[1] || 'body');
  assert.deepEqual(chain.slice(0, 4), ['title', "meta->>'fileName'", "meta->>'name'", 'body']);
  assert.equal(nameSortKey({ title: ' Zed ', meta: { fileName: 'a' }, snippet: 's' }), 'zed');
  assert.equal(nameSortKey({ title: ' ', meta: { fileName: 'File.JPG', name: 'n' }, snippet: 's' }), 'file.jpg');
  assert.equal(nameSortKey({ meta: { name: 'Nm' }, snippet: 's' }), 'nm');
  assert.equal(nameSortKey({ kind: 'image', meta: {}, snippet: '' }), '');
  assert.equal(nameSortKey({ meta: {}, snippet: 'ABC '.padEnd(300, 'x') }).length, 120);
  // A built item has no title: its fallback name must not leak into the key.
  assert.equal(nameSortKey(itemFromIndexRow({ card_id: 'a', kind: 'image', title: '', snippet: '', meta: {} }, 'b')), '');
  assert.equal(nameSortKey(itemFromIndexRow({ card_id: 'a', kind: 'image', title: 'Sky', snippet: '', meta: {} }, 'b')), 'sky');
});

test('itemFromIndexRow', () => {
  const row = {
    board_id: 'rowboard', card_id: 'c1', kind: 'image', title: '', snippet: 'x'.repeat(300),
    meta: { src: 's', unplaced: true, sizeBytes: 12 }, created_at: '2026-01-01T00:00:00Z', updated_at: 'junk', seq: 3,
  };
  const it = itemFromIndexRow(row, 'b1');
  assert.equal(it.key, 'b1:c1');
  assert.equal(it.boardId, 'b1');
  assert.equal(it.shelf, 'photos');
  assert.equal(it.name.length, 80);
  assert.equal(it.snippet.length, 160);
  assert.equal(it.createdAt, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(it.updatedAt, null);
  assert.equal(it.unplaced, true);
  assert.equal(it.sizeBytes, 12);
  assert.equal(it.seq, 3);
  assert.equal(itemFromIndexRow(row).boardId, 'rowboard');
  assert.equal(itemFromIndexRow({ ...row, shelf: 'more' }, 'b').shelf, 'more');
  assert.equal(itemFromIndexRow({ card_id: 'x', kind: 'board' }, 'b'), null);
  assert.equal(itemFromIndexRow({ card_id: 'x', kind: 'boardlink' }, 'b'), null);
  const bare = itemFromIndexRow({ card_id: 'x', kind: 'note' }, 'b');
  assert.deepEqual([bare.meta, bare.snippet, bare.sizeBytes, bare.createdAt, bare.seq], [{}, '', null, null, null]);
});

test('itemFromCard matches itemFromIndexRow of the equivalent row', () => {
  const card = {
    id: 7, kind: 'image', fileName: 'IMG_1.jpg', src: 'https://x/y.jpg', alt: 'sky', w: 100, h: 50,
    x: 10.4, y: 20.6, unplaced: true, sizeBytes: 999, groupId: 'g1',
    createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-02T00:00:00Z',
  };
  const live = itemFromCard(card, { boardId: 'b1', workspaceId: 'w' });
  const row = {
    card_id: '7', kind: 'image', title: '', snippet: '',
    meta: {
      src: 'https://x/y.jpg', alt: 'sky', w: 100, h: 50, fileName: 'IMG_1.jpg',
      pos: { x: 10, y: 21, w: 100, h: 50 }, unplaced: true, sizeBytes: 999, groupId: 'g1', groupName: '',
    },
    created_at: card.createdAt, updated_at: card.updatedAt,
  };
  const closed = itemFromIndexRow(row, 'b1');
  assert.deepEqual(live, closed);
  assert.equal(live.name, 'IMG_1.jpg');
});

test('itemFromCard nulls', () => {
  assert.equal(itemFromCard({ id: 'onb-1', kind: 'note' }, { boardId: 'b' }), null);
  assert.equal(itemFromCard({ id: 'c', kind: 'board' }, { boardId: 'b' }), null);
  const n = itemFromCard({ id: 'c', html: '<p>Hello &amp; bye</p>' }, { boardId: 'b' });
  assert.equal(n.kind, 'note');
  assert.equal(n.snippet, 'Hello & bye');
  assert.equal(n.name, 'Hello & bye');
});

test('cardFromItem', () => {
  const item = itemFromIndexRow({
    card_id: 'c', kind: 'note', title: 'T', snippet: 'a <b> & "q"', meta: {},
  }, 'b');
  const c = cardFromItem(item);
  assert.equal(c.html, '<p>a &lt;b&gt; &amp; &quot;q&quot;</p>');
  assert.equal(c.id, 'c');
  assert.equal(c.title, 'T');
  assert.ok(!('src' in c));
  const link = cardFromItem(itemFromIndexRow({ card_id: 'l', kind: 'link', meta: { url: 'https://a.b' } }, 'b'));
  assert.equal(link.url, 'https://a.b');
  assert.equal(link.link, 'https://a.b');
  assert.ok(!('html' in link));
  const img = cardFromItem(itemFromIndexRow({
    card_id: 'i', kind: 'image', meta: { src: 's', w: 5, pos: { x: 1, y: 2, w: 9, h: 8 }, sizeBytes: 4, unplaced: true },
  }, 'b'));
  assert.deepEqual([img.src, img.x, img.y, img.w, img.h, img.sizeBytes, img.unplaced], ['s', 1, 2, 5, 8, 4, true]);
  assert.ok(!Object.values(img).includes(undefined));
});
