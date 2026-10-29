// boardMore.test.mjs — the first board asks for more (lib/boardMore.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_MORE_EPOCH, BOARD_MORE_KEY, BOARD_MORE_QUIET_MS, BOARD_MORE_WINDOW_MS, BOARD_MORE_OVERRIDE_KEY,
  isBoardMoreCandidate, boardMoreArm, readBoardMoreOverride, boardMoreArms, boardMoreDue,
  boardMoreCopy, noteBesidePictures, isPictureCard,
} from './boardMore.js';
import { boardMoreMayRun } from './boardMoreEpoch.js';
import { EXPERIMENTS, assignArm } from './experiments.js';
import { HINT_KINDS } from './hints.js';
import { EV } from './analyticsEvents.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const after = (ms) => new Date(Date.parse(BOARD_MORE_EPOCH) + ms).toISOString();

test('the registry runs it 50/50, on and registry-only', () => {
  const e = EXPERIMENTS[BOARD_MORE_KEY];
  assert.ok(e && e.enabled);
  assert.deepEqual(e.arms.map((a) => [a.id, a.weight]), [['A', 50], ['B', 50]]);
  assert.ok(HINT_KINDS.includes('board_more'));
  assert.equal(EV.BOARD_MORE_NUDGE, 'board_more_nudge');
});

test('the coin is even and crosses the setup test\'s evenly', () => {
  const n = 4000;
  const cells = { AA: 0, AB: 0, BA: 0, BB: 0 };
  let b = 0;
  for (let i = 0; i < n; i += 1) {
    const uid = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const mine = assignArm(BOARD_MORE_KEY, uid);
    const setup = assignArm('workspace_setup', uid);
    if (mine === 'B') b += 1;
    cells[setup + mine] += 1;
  }
  assert.ok(Math.abs(b / n - 0.5) < 0.03, `B share ${b / n}`);
  for (const [k, v] of Object.entries(cells)) assert.ok(Math.abs(v / n - 0.25) < 0.03, `${k} ${v / n}`);
});

test('candidates: made at or after the epoch, never set up', () => {
  assert.equal(isBoardMoreCandidate({ createdAt: BOARD_MORE_EPOCH }), true);
  assert.equal(isBoardMoreCandidate({ createdAt: after(-1) }), false);
  assert.equal(isBoardMoreCandidate({ createdAt: after(5), onboarding: {} }), true);
  assert.equal(isBoardMoreCandidate({ createdAt: after(5), onboarding: { seeded: true } }), false);
  assert.equal(isBoardMoreCandidate({ createdAt: after(5), onboarding: { done: true } }), false);
  assert.equal(isBoardMoreCandidate({ createdAt: null }), false);
  assert.equal(isBoardMoreCandidate({ createdAt: 'nonsense' }), false);
});

test('the arm: the override, else the coin for a candidate, else what the server holds', () => {
  assert.equal(boardMoreArm({ uid: 'u', candidate: false, override: 'B' }), 'B');
  assert.equal(boardMoreArm({ uid: 'u', candidate: true }), assignArm(BOARD_MORE_KEY, 'u'));
  assert.equal(boardMoreArm({ uid: 'u', candidate: false, enrolled: 'A' }), 'A');
  assert.equal(boardMoreArm({ uid: 'u', candidate: false, enrolled: null }), null);
  assert.equal(boardMoreArm({ uid: null, candidate: true }), null);
});

test('the QA override needs leave, and is kept for the tab', () => {
  const s = mem();
  assert.equal(readBoardMoreOverride({ search: '?more=b', storage: s, allowed: false }), null);
  assert.equal(readBoardMoreOverride({ search: '?more=b', storage: s, allowed: true }), 'B');
  assert.equal(s.getItem(BOARD_MORE_OVERRIDE_KEY), 'B');
  assert.equal(readBoardMoreOverride({ search: '', storage: s, allowed: true }), 'B');
  assert.equal(readBoardMoreOverride({ search: '?more=Z', storage: mem(), allowed: true }), null);
});

test('only new accounts, or a QA tab, fetch the rest', () => {
  assert.equal(boardMoreMayRun({ createdAt: after(0) }), true);
  assert.equal(boardMoreMayRun({ createdAt: after(-1000) }), false);
  assert.equal(boardMoreMayRun({ createdAt: after(-1000), search: '?more=A', qaAllowed: false }), false);
  assert.equal(boardMoreMayRun({ createdAt: after(-1000), search: '?more=A', qaAllowed: true }), true);
  const s = mem(); s.setItem(BOARD_MORE_OVERRIDE_KEY, 'B');
  assert.equal(boardMoreMayRun({ createdAt: after(-1000), storage: s, qaAllowed: true }), true);
});

test('a card landing arms it at 3 to 9; opening a board does not', () => {
  assert.equal(boardMoreArms({ prev: 2, next: 3 }), true);
  assert.equal(boardMoreArms({ prev: 8, next: 9 }), true);
  assert.equal(boardMoreArms({ prev: 1, next: 2 }), false);
  assert.equal(boardMoreArms({ prev: 9, next: 10 }), false);
  assert.equal(boardMoreArms({ prev: 2, next: 40 }), false, 'a folder straight past 10 already did it');
  assert.equal(boardMoreArms({ prev: 5, next: 5 }), false);
  assert.equal(boardMoreArms({ prev: 6, next: 5 }), false, 'a delete arms nothing');
});

test('the moment: the same rule in both arms', () => {
  const base = { arm: 'B', done: false, createdAt: after(0), now: after(60_000), canEdit: true, cards: 3, uploading: false, quietFor: BOARD_MORE_QUIET_MS, busy: false };
  assert.equal(boardMoreDue(base), true);
  assert.equal(boardMoreDue({ ...base, arm: 'A' }), true);
  assert.equal(boardMoreDue({ ...base, arm: null }), false);
  assert.equal(boardMoreDue({ ...base, done: true }), false);
  assert.equal(boardMoreDue({ ...base, cards: 2 }), false);
  assert.equal(boardMoreDue({ ...base, cards: 9 }), true);
  assert.equal(boardMoreDue({ ...base, cards: 10 }), false);
  assert.equal(boardMoreDue({ ...base, canEdit: false }), false);
  assert.equal(boardMoreDue({ ...base, uploading: true }), false);
  assert.equal(boardMoreDue({ ...base, busy: true }), false);
  assert.equal(boardMoreDue({ ...base, quietFor: BOARD_MORE_QUIET_MS - 1 }), false);
  assert.equal(boardMoreDue({ ...base, now: after(BOARD_MORE_WINDOW_MS) }), false, 'first week only');
  assert.equal(boardMoreDue({ ...base, createdAt: null }), false);
  assert.equal(boardMoreDue({ ...base, done: true, now: after(BOARD_MORE_WINDOW_MS * 4), qa: true }), true, 'QA tries again');
});

test('the words: a folder on a computer, photos on a phone, kept short beside two buttons', () => {
  const desk = boardMoreCopy({ canFolder: true });
  assert.equal(desk.message, 'Good start. Add more?');
  assert.deepEqual(desk.actions.map((a) => [a.id, a.label]), [['folder', 'Bring in a folder'], ['note', 'Add a note']]);
  const phone = boardMoreCopy({ canFolder: false });
  assert.equal(phone.message, 'Good start. Add more?');
  assert.deepEqual(phone.actions.map((a) => [a.id, a.label]), [['photos', 'Add photos'], ['note', 'Add a note']]);
});

test('the note goes beside the pictures', () => {
  const cards = [
    { kind: 'image', x: 100, y: 80, w: 200, h: 150 },
    { kind: 'image', x: 320, y: 60, w: 160, h: 300 },
    { kind: 'note', x: 900, y: 50, w: 200, h: 100 },
  ];
  assert.deepEqual(noteBesidePictures(cards), { x: 320 + 160 + 40 + 100, y: 60 }, 'right of the right-most picture, not the note');
  assert.deepEqual(noteBesidePictures(cards, { phone: true }), { x: 320 + 100, y: 60 + 300 + 20 }, 'below the lowest on a phone');
  assert.deepEqual(noteBesidePictures([{ kind: 'link', x: 10, y: 10, w: 100, h: 50 }]), { x: 250, y: 10 });
  assert.equal(noteBesidePictures([]), null);
  assert.equal(noteBesidePictures(null), null);
  assert.equal(isPictureCard({ kind: 'video' }), true);
  assert.equal(isPictureCard({ kind: 'pdf' }), false);
});
