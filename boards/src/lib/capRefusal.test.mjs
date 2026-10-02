// capRefusal — a card-cap refusal may take back only what this tab just placed
// through the cap gate. Everything else it refuses is existing work, and before
// 2026-10-01 the refusal deleted it with no undo: the first sync after a paid
// period ended removed every card whose 10-second sync had not run while the
// account was paid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlacementLedger, WITHDRAW_WINDOW_MS } from './capRefusal.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('a card this tab just placed through the gate is taken back; nothing else is', () => {
  const c = clock();
  const ledger = createPlacementLedger({ now: c.now });
  ledger.note(['image-new-1', 'image-new-2']);
  const { withdraw, keep } = ledger.split(['image-new-1', 'image-old', 'image-new-2', 'note-restored']);
  assert.deepEqual(withdraw, ['image-new-1', 'image-new-2']);
  assert.deepEqual(keep, ['image-old', 'note-restored']);
});

test('a refusal with an empty ledger keeps every card (the paid-period-ended case)', () => {
  // Cards placed while paid were never noted: the gate did not apply to them.
  const ledger = createPlacementLedger();
  const { withdraw, keep } = ledger.split(['a', 'b', 'c']);
  assert.deepEqual(withdraw, []);
  assert.deepEqual(keep, ['a', 'b', 'c']);
});

test('a placement older than the window is existing work and is kept', () => {
  const c = clock();
  const ledger = createPlacementLedger({ now: c.now });
  ledger.note(['card-1']);
  c.advance(WITHDRAW_WINDOW_MS + 1);
  const { withdraw, keep } = ledger.split(['card-1']);
  assert.deepEqual(withdraw, []);
  assert.deepEqual(keep, ['card-1']);
  assert.equal(ledger.size, 0, 'expired entries are pruned');
});

test('inside the window a slow refusal still takes the card back', () => {
  const c = clock();
  const ledger = createPlacementLedger({ now: c.now });
  ledger.note(['card-1']);
  c.advance(WITHDRAW_WINDOW_MS - 1);
  assert.deepEqual(ledger.split(['card-1']).withdraw, ['card-1']);
});

test('the window comfortably covers the 10-second sync that normally carries the refusal', () => {
  assert.ok(WITHDRAW_WINDOW_MS >= 60_000);
  // …and is short enough that a tab left open across a plan change cannot
  // reach back into work placed hours earlier.
  assert.ok(WITHDRAW_WINDOW_MS <= 15 * 60_000);
});

test('a withdrawn id leaves the ledger, so a later refusal of the same id keeps it', () => {
  const ledger = createPlacementLedger();
  ledger.note(['x']);
  assert.deepEqual(ledger.split(['x']).withdraw, ['x']);
  assert.deepEqual(ledger.split(['x']), { withdraw: [], keep: ['x'] });
});

test('split works on rows through idOf, and returns the rows themselves', () => {
  const ledger = createPlacementLedger();
  ledger.note(['image-1']);
  const rows = [{ card_id: 'image-1', kind: 'image' }, { card_id: 'note-9', kind: 'note' }];
  const { withdraw, keep } = ledger.split(rows, (r) => r.card_id);
  assert.equal(withdraw[0], rows[0]);
  assert.equal(keep[0], rows[1]);
});

test('ids are compared as strings, and empty ids are never noted', () => {
  const ledger = createPlacementLedger();
  ledger.note([42, null, undefined, '']);
  assert.equal(ledger.size, 1);
  assert.deepEqual(ledger.split(['42']).withdraw, ['42']);
});

test('clear() forgets everything (sign-out)', () => {
  const ledger = createPlacementLedger();
  ledger.note(['a', 'b']);
  ledger.clear();
  assert.deepEqual(ledger.split(['a', 'b']).withdraw, []);
});

// ── Wiring. Playwright is not in CI, so the guards that matter live here. ──

const boardsApi = read('./boardsApi.js');
const app = read('../App.jsx');

const capBranch = (() => {
  const start = boardsApi.indexOf('if (_isCapRefusal(ups.error)) {');
  const end = boardsApi.indexOf("} else if (ups.error) {", start);
  assert.ok(start > 0 && end > start, 'cap branch found');
  return boardsApi.slice(start, end);
})();

test('syncCardIndex sends only the ledger\'s cards as withdrawable ids', () => {
  assert.match(capBranch, /_placements\.split\(fresh, r => r\.card_id\)/);
  assert.match(capBranch, /cardIds: withdraw\.map\(r => r\.card_id\)/);
  assert.match(capBranch, /rejected: withdraw\.length/);
  assert.match(capBranch, /kept: keep\.length/);
  assert.doesNotMatch(capBranch, /cardIds: fresh/, 'every refused card used to be withdrawn');
});

test('the cap branch no longer returns before the orphan cleanup', () => {
  // A board holding a refused card otherwise never releases the count of the
  // cards deleted from it — deleting to make room makes none.
  assert.doesNotMatch(capBranch.replace(/\/\/.*$/gm, ''), /\breturn\b/);
});

test('every add mutator notes its placements only when the cap gate applied (or could not be decided)', () => {
  assert.match(app, /if \(gated && placedId\) notePlacedThroughCap\(\[placedId\]\);/);
  assert.match(app, /if \(\(csBatch\.capped \|\| !csBatch\.resolved\) && !neutralMove && !opts\.moveFrom\) notePlacedThroughCap\(placedIds\);/);
  assert.match(app, /if \(csDup\.capped \|\| !csDup\.resolved\) notePlacedThroughCap\(newIds\);/);
  // addCard's flag is set by the capped branch or an unresolved tier, and only
  // for a card that costs something — an empty grid is never refused, so it is
  // never noted.
  assert.match(app, /if \(cs\.capped && cost > 0\) \{\s*gated = true;/);
  assert.match(app, /if \(!cs\.resolved && cost > 0\) gated = true;/);
});

test('a kept-only refusal is logged as held, never as a blocked create, and opens no wall', () => {
  const start = app.indexOf('const onCapped = (e) => {');
  const body = app.slice(start, app.indexOf("window.addEventListener('soleil:card-index-capped'", start));
  const held = body.indexOf('EV.CARD_INDEX_HELD');
  const bail = body.indexOf('if (!(Number(e?.detail?.rejected) > 0)) { refreshCap(); return; }');
  const blocked = body.indexOf('EV.CARD_CREATE_BLOCKED');
  const withdraw = body.indexOf('deleteCardsSilent');
  const wall = body.indexOf('pitchCapWall(');
  assert.ok(held > 0 && bail > held, 'held is logged before the bail-out');
  assert.ok(blocked > bail && withdraw > bail && wall > bail, 'nothing past the bail-out runs for kept cards');
});

// ── Review round, 2026-10-01 ──
test('forgetWhere drops only what the predicate names', () => {
  const ledger = createPlacementLedger();
  ledger.note(['a', 'b', 'c']);
  ledger.forgetWhere((id) => id !== 'b');
  assert.deepEqual(ledger.split(['a', 'b', 'c']).withdraw, ['b']);
});

test('a card the index holds leaves the ledger, so an undo at the limit keeps it', () => {
  const tail = boardsApi.slice(boardsApi.indexOf('if (cleaned) cache.ids = liveIds;'));
  assert.match(tail, /_placements\.forgetWhere\(\(id\) => cache\.sigs\.has\(id\)\);/);
});

test('orphans are released BEFORE the upsert, so room a deletion freed counts in the same sync', () => {
  const sync = boardsApi.slice(boardsApi.indexOf('async function _doSyncCardIndex('));
  const cleanup = sync.indexOf("const orphanIds = (existing.data || [])");
  const upsert = sync.indexOf("const ups = await supabase.from('card_index').upsert(changed");
  assert.ok(cleanup > 0 && upsert > 0 && cleanup < upsert);
  assert.doesNotMatch(sync.slice(0, upsert), /if \(existing\.error\) return;/, 'a failed read must not abandon the upsert');
});

test('an unresolved tier still records this tab\'s placements', () => {
  assert.match(app, /if \(!cs\.resolved && cost > 0\) gated = true;/);
  assert.match(app, /if \(\(csBatch\.capped \|\| !csBatch\.resolved\) && !neutralMove && !opts\.moveFrom\) notePlacedThroughCap\(placedIds\);/);
  assert.match(app, /if \(csDup\.capped \|\| !csDup\.resolved\) notePlacedThroughCap\(newIds\);/);
});

test('the tier refetch runs after the withdrawal\'s refund, on every path', () => {
  const start = app.indexOf('const onCapped = (e) => {');
  const body = app.slice(start, app.indexOf("window.addEventListener('soleil:card-index-capped'", start));
  const withdraw = body.indexOf('deleteCardsSilent?.(rejectedIds)');
  const last = body.lastIndexOf('refreshCap();');
  assert.ok(withdraw > 0 && last > withdraw, 'refetch after the refund');
  assert.match(body, /if \(!\(Number\(e\?\.detail\?\.rejected\) > 0\)\) \{ refreshCap\(\); return; \}/, 'kept-only refusals still refresh');
  assert.equal((body.match(/myTier\.refetch\?\.\(\)/g) || []).length, 1, 'one refetch site, inside refreshCap');
});

test('a read from elsewhere re-arms the post-sync refetch for every board\'s sync, and the sync\'s own read never does', () => {
  const tier = readFileSync(join(here, '../hooks/useMyTier.js'), 'utf8');
  assert.match(tier, /if \(!fromIndexSync\) _store\.lastReadAt = Date\.now\(\);/);
  assert.match(tier, /const owed = _store\.placedDelta !== 0 \|\| readRecently;/);
  assert.doesNotMatch(tier, /readSinceSync/, 'a flag the first board to announce used up — the second board was never re-read');
  const win = Number((tier.match(/const READ_REARM_MS = (\d+);/) || [])[1]);
  assert.ok(win >= 10_000 + 2_000, 'the window outlasts the ten-second sync throttle');
  assert.match(tier, /_fetchTier\(\{ fromIndexSync: true \}\)/);
});

test('a row that weighs nothing lands whatever the room, and is never reported refused untried', () => {
  const land = boardsApi.slice(boardsApi.indexOf('async function landUpToCap('), boardsApi.indexOf('async function landCostlyUpToCap('));
  assert.match(land, /const free = rows\.filter\(\(r\) => Number\(r\.weight \?\? 1\) === 0\);/);
  assert.match(land, /await supabase\.from\('card_index'\)\.upsert\(free,/);
  assert.match(land, /landCostlyUpToCap\(\{ boardId, rows: costly, sigFor, cache \}\)/, 'only costly rows meet the room');
  assert.doesNotMatch(land, /refusedFree/, 'a failed write of a free row is never reported as a refusal');
});

// ── Second review round, 2026-10-01: behaviour lives in cardIndexSync.test.mjs.
test('charges and refunds both go through what the index counts, and only on the owner\'s own board', () => {
  assert.match(app, /const countedWeight = \(get\) => \(isAbandonedUpload\(get\) \? 0 : cardIndexWeight\(get\('kind'\) \|\| 'note', get\)\);/);
  assert.match(app, /const placementCost = \(card\) => countedWeight\(\(k\) => card\?\.\[k\]\);/);
  assert.match(app, /const dupCost = \(ym\) => countedWeight\(\(k\) => ym\.get\(k\)\);/);
  assert.match(app, /if \(cost > 0 && cs\.own\) myTier\.notePlaced\?\.\(cost\);/);
  assert.match(app, /if \(genuineCost && csBatch\.own && !neutralMove\) myTier\.notePlaced\?\.\(genuineCost\);/);
  assert.match(app, /if \(dupTotal && csDup\.own\) myTier\.notePlaced\?\.\(dupTotal\);/);
  // Refunds: weight, not one per card (an empty grid was never charged), never
  // for a card the index skips, never for an id not on the board.
  assert.match(app, /const freed = capSource\(\)\.own \? countedWeightOf\(m, ids\) : 0;/);
  assert.match(app, /const freed = refund && capSource\(\)\.own \? countedWeightOf\(m, present\) : 0;/);
  assert.doesNotMatch(app, /ids\.filter\(id => !isSeedCard\(\{ id, seed: m\.get\(id\)\?\.get\('seed'\) \}\)\)\.length/, 'the old one-per-card refund is gone');
});

test('a move between panes deletes from its source only what landed, and a same-workspace move is never gated', () => {
  const canvas = read('../components/CanvasSurface.jsx');
  const drop = canvas.slice(canvas.indexOf("const res = mutators.addCards?.(newCards, isCopy ? {} : { moveFrom: sourceBoardId });"));
  assert.ok(drop.length > 0, 'the cross-pane drop passes moveFrom');
  assert.match(drop, /const placed = new Set\(res\?\.placedIds \|\| \[\]\);/);
  assert.match(drop, /const moved = payload\.filter\(\(_, i\) => placed\.has\(newCards\[i\]\.id\)\)\.map\(\(c\) => c\.id\);/);
  assert.match(drop, /detail: \{ sourceBoardId, cardIds: moved, neutral: !!res\?\.neutral \}/);
  assert.match(canvas, /if \(!isCopy && placed\) \{/, 'the single-card path too');
  assert.match(app, /const neutralMove = !!opts\.restore \|\| \(!!fromWs && fromWs === boardsRef\.current\?\.\[boardId\]\?\.workspace_id\);/);
  assert.match(app, /if \(csBatch\.capped && !neutralMove\) \{/);
  assert.match(app, /return \{ added: cardsToAdd\.length, requested, capHit, placedIds, neutral: neutralMove \};/);
});

test('a cluster is never made at the limit, and its card is put back without a wall', () => {
  const nb = app.slice(app.indexOf('const addNewBoard = async ('), app.indexOf('const addNewProject = async ('));
  const ask = nb.indexOf('if (capHit) { noteBlocked(\'demo_cap\'); surfaceCapHit(cs); return null; }');
  const make = nb.indexOf('await createBoard(');
  assert.ok(ask > 0 && make > ask, 'the cap is asked before the cluster exists');
  assert.match(app, /mainMutators\.addCards\?\.\(newCards, \{ restore: true \}\);/, 'the reconcile effect restores, never adds');
});

// ── Third review round (round-2 fixes), 2026-10-02 ──
test('has() says whether a refusal would take a card back', () => {
  const c = clock();
  const ledger = createPlacementLedger({ now: c.now });
  ledger.note(['a']);
  assert.equal(ledger.has('a'), true);
  assert.equal(ledger.has('b'), false);
  c.advance(WITHDRAW_WINDOW_MS + 1);
  assert.equal(ledger.has('a'), false, 'outside the window it is existing work');
});

test('a card moved in is never one a refusal may take back — its source already deleted it', () => {
  assert.match(app, /&& !neutralMove && !opts\.moveFrom\) notePlacedThroughCap\(placedIds\);/);
});

test('whose cap applies, and whether a move stays in one workspace, read the live boards map', () => {
  assert.match(app, /const boardsRef = useRef\(boards\);\s*boardsRef\.current = boards;/);
  const cap = app.slice(app.indexOf('const capSource = () => {'), app.indexOf('const surfaceCapHit = '));
  assert.match(cap, /const b = boardsRef\.current\?\.\[boardId\];/);
  assert.doesNotMatch(cap, /\bboards\?\.\[boardId\]/, 'the mutators\' closure froze an empty map after a reload');
});

test('a move into another owner\'s cluster gives the mover their room back; a move inside one workspace does not', () => {
  const canvas = read('../components/CanvasSurface.jsx');
  assert.match(canvas, /mutators\.deleteCardsForMove\?\.\(idList, \{ refund: neutral === false \}\);/);
  const fm = app.slice(app.indexOf('const deleteCardsForMove = ('), app.indexOf('const duplicateCards = '));
  assert.match(fm, /const freed = refund && capSource\(\)\.own \? countedWeightOf\(m, ids\) : 0;/);
});

test('ids minted in one batch are unique by their index, and a copy of a starter card is a real card', () => {
  const canvas = read('../components/CanvasSurface.jsx');
  assert.match(canvas, /id: `\$\{c\.kind \|\| 'card'\}-\$\{stamp\}-\$\{i\}-\$\{Math\.floor\(Math\.random\(\) \* 1e6\)\}`/);
  const dup = app.slice(app.indexOf('const duplicateCards = ('), app.indexOf('const duplicateCard = '));
  assert.match(dup, /obj\.id = `\$\{obj\.kind \|\| 'card'\}-\$\{stamp\}-\$\{i\}-/);
  assert.match(dup, /delete obj\.seed;/);
});

test('a cluster made from the sidebar or pasted asks the cap first, and restored cards re-read the count', () => {
  for (const [from, to] of [['const createBoardInside = async (', 'const setBoardBgColorById'], ['const pasteBoardInto = async (', '// ── Workspace sharing']]) {
    const fn = app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
    const ask = fn.search(/const ask = askCapFor\(/);
    assert.ok(ask > 0 && ask < fn.indexOf('await createBoard('), `${from}: the cap is asked before the cluster exists`);
    assert.match(fn, /if \(!ask\.ok\) return;/);
    assert.match(fn, /if \(ask\.cs\.own\) myTier\.notePlaced\?\.\(/);
  }
  assert.match(app, /mainMutators\.addCards\?\.\(newCards, \{ restore: true \}\);\s*expectIndexChange\(\);/);
  const tier = read('../hooks/useMyTier.js');
  assert.match(tier, /export function expectIndexChange\(\) \{ _store\.lastReadAt = Date\.now\(\); \}/);
});
