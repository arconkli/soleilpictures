// The comments island counts from the rows themselves (lib/commentCanvas.js
// openCommentTally), because the conversation model arrives later, with the
// pins. The list behind it counts conversations (canvasThreads, threadAnchor,
// threadUnread). These hold the two to the same answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openCommentTally, threadAnchor } from './commentCanvas.js';
import { canvasThreads, threadUnread } from './commentPins.js';

const ME = 'me';
const ANA = 'ana';
const CARDS = new Map([['c1', { x: 0, y: 0, w: 100, h: 80 }], ['c2', { x: 300, y: 0, w: 100, h: 80, rotation: 30 }]]);
const GROUPS = new Map([['g1', { x: 0, y: 0, w: 400, h: 300 }]]);
const groupBox = (id) => GROUPS.get(id) || null;
const cardBox = (id) => CARDS.get(id) || null;

// What the list shows: the same steps as canvasThreads.js useCanvasThreads and
// CanvasCommentsList.jsx's `lists`.
function fromModel(rows, meId, views) {
  const open = canvasThreads(rows, () => null)
    .map((t) => ({ ...t, resolved: t.resolved || !!t.root.meta?.hidden }))
    .filter((t) => threadAnchor(t, { cardBox, groupBox }) && !t.resolved);
  return {
    open: open.length,
    unread: open.some((t) => !!meId && !!views && threadUnread(t, meId, views.get(t.id))),
  };
}
const tally = (rows, meId, views) => openCommentTally(rows, { hasCard: (id) => CARDS.has(id), groupBox }, meId, views);

let n = 0;
const row = (over = {}) => {
  n += 1;
  return {
    id: `r${n}`, board_id: 'b', author: ANA, body: 'x', anchor_kind: 'point', anchor_x: 10, anchor_y: 20,
    created_at: `2026-11-01T10:${String(n % 60).padStart(2, '0')}:00Z`, reply_to: null, resolved: false, hidden: false,
    deleted_at: null, ...over,
  };
};

function fixture() {
  const onCard = row({ anchor_kind: 'card', anchor_id: 'c1' });
  const onTurned = row({ anchor_kind: 'card', anchor_id: 'c2', author: ME });
  const onGone = row({ anchor_kind: 'card', anchor_id: 'gone' });
  const onGroup = row({ anchor_kind: 'group', anchor_id: 'g1' });
  const onGoneGroup = row({ anchor_kind: 'group', anchor_id: 'nope' });
  const onPoint = row();
  const onBoard = row({ anchor_kind: 'board' });
  const resolved = row({ resolved: true });
  const hidden = row({ hidden: true });
  const inDoc = row({ anchor_kind: 'doc_range', anchor_id: 'c1' });
  const deletedRoot = row({ deleted_at: '2026-11-02T00:00:00Z', author: ME });
  return [
    onCard, onTurned, onGone, onGroup, onGoneGroup, onPoint, onBoard, resolved, hidden, inDoc, deletedRoot,
    row({ reply_to: onTurned.id, author: ANA, created_at: '2026-11-03T09:00:00Z' }),
    row({ reply_to: onCard.id, author: ME }),
    row({ reply_to: onGone.id }),
    row({ reply_to: resolved.id }),
    row({ reply_to: deletedRoot.id, author: ANA, deleted_at: '2026-11-02T01:00:00Z' }),
    row({ reply_to: 'not-here' }),
    null, { body: 'no id' },
  ];
}

test('the island counts the conversations the list shows as open', () => {
  const rows = fixture();
  const got = tally(rows, ME, null);
  assert.deepEqual(got, fromModel(rows, ME, null));
  // on a card, a turned card, a section, a point, the cluster, and a deleted
  // comment that still stands where it was
  assert.equal(got.open, 6);
  assert.equal(got.unread, false);
});

test('nothing is unread until "when I last looked" has come back, or with nobody signed in', () => {
  const rows = fixture();
  assert.equal(tally(rows, ME, null).unread, false);
  assert.equal(tally(rows, null, new Map()).unread, false);
  assert.deepEqual(tally(rows, null, new Map()), fromModel(rows, null, new Map()));
});

test('unread agrees with the list whatever I have and have not looked at', () => {
  const rows = fixture();
  const roots = rows.filter((r) => r && r.id && !r.reply_to).map((r) => r.id);
  const late = '2026-12-01T00:00:00Z';
  const early = '2026-10-01T00:00:00Z';
  const cases = [
    new Map(),
    new Map(roots.map((id) => [id, late])),
    new Map(roots.map((id) => [id, early])),
    new Map(roots.map((id) => [id, Date.parse(late)])),
    ...roots.map((skip) => new Map(roots.filter((id) => id !== skip).map((id) => [id, late]))),
    ...roots.map((only) => new Map([[only, late]])),
    // looked after the first words and before the reply
    new Map(roots.map((id) => [id, '2026-11-02T12:00:00Z'])),
  ];
  for (const views of cases) {
    assert.deepEqual(tally(rows, ME, views), fromModel(rows, ME, views), JSON.stringify([...views]));
    assert.deepEqual(tally(rows, ANA, views), fromModel(rows, ANA, views), `ana ${JSON.stringify([...views])}`);
  }
  assert.equal(tally(rows, ME, new Map()).unread, true);
  assert.equal(tally(rows, ME, new Map(roots.map((id) => [id, late]))).unread, false);
});

test('my own words, deleted words and what is resolved or gone are never unread', () => {
  const mine = row({ author: ME });
  const gone = row({ anchor_kind: 'card', anchor_id: 'gone' });
  const done = row({ resolved: true });
  const rows = [mine, gone, done, row({ reply_to: mine.id, deleted_at: '2026-11-02T00:00:00Z' })];
  assert.deepEqual(tally(rows, ME, new Map()), { open: 1, unread: false });
  assert.deepEqual(tally(rows, ME, new Map()), fromModel(rows, ME, new Map()));
});

test('no rows, or none of mine to count: nothing open', () => {
  assert.deepEqual(openCommentTally(null), { open: 0, unread: false });
  assert.deepEqual(openCommentTally([], {}, ME, new Map()), { open: 0, unread: false });
  // without a way to ask, a card's or a section's comment has nowhere to be
  assert.deepEqual(openCommentTally([row({ anchor_kind: 'card', anchor_id: 'c1' })]), { open: 0, unread: false });
});

// The canvas loads these at once; one import of the pins' own modules from
// any of them puts the pins back into the app's first download
// (scripts/bundleBudget.mjs LAZY_IN_APP catches it in a build; this says
// which line did it).
test('what the canvas loads at once imports nothing the pins are built on', () => {
  const eager = [
    'lib/commentCanvas.js', 'lib/toMs.js', 'hooks/useCanvasComments.js',
    'components/CanvasSurface.jsx', 'components/comments/CanvasCommentsIsland.jsx',
    'components/comments/commentPartsLazy.jsx', 'components/comments/canvasPartsLazy.jsx',
  ];
  const lazyOnly = /from\s+'[^']*(?:commentPins|commentModel|commentParked|commentRules|commentDraft|canvasThreads|CanvasCommentPins|CanvasCommentCard|CanvasCommentsList|commentLinkUrl)(?:\.jsx?)?'/;
  for (const f of eager) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const hit = src.split('\n').find((line) => /^\s*import\s/.test(line) && lazyOnly.test(line));
    assert.equal(hit, undefined, `${f}: ${hit}`);
  }
});
