// share-ambient.spec.js
//
// Sharing should be a thing the product offers, not a thing you go and find.
//
// The shape this fixes: the topbar's LABELLED "Share" button opened a 929-line
// access console (two link kinds with their own checkboxes, email invites, a
// member list, Explore publishing), while the one-tap copy sat beside it as an
// unlabelled link glyph. Most people who reached for sharing landed in an admin
// screen; only a handful ever found the affordance that just hands them a link.
// The two are now swapped, and a work burst offers the share outright.
//
// SOURCE-LEVEL, deliberately. All of this lives in App.jsx's body, and App.jsx
// early-returns to LocalBoardsApp under ?local=1 — the harness never mounts any
// of it, and LocalBoardsApp has no share control to mirror. The rules
// themselves are unit-tested (shareAsk.test.mjs, upsellSlot.test.mjs); this
// pins the wiring, the same way collab-nudge-wiring.spec.js does.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const app       = () => read('src/App.jsx');
const modal     = () => read('src/components/ShareModal.jsx');
const authGate  = () => read('src/auth/AuthGate.jsx');
const events    = () => read('src/lib/analyticsEvents.js');

test.describe('the labelled control does the easy thing', () => {
  test('the board offers exactly ONE share control, and it copies', () => {
    const s = app();
    // Labelled button → one-tap copy.
    expect(s).toMatch(/className="tb-btn"[\s\S]{0,120}onClick=\{quickCopyShareLink\}/);
    // There was briefly a second one — an icon opening the access console next
    // to it — while the console was still a 929-line admin screen worth routing
    // around. Two adjacent share affordances reproduce the original confusion in
    // the other direction, and on a phone .tb-btn-label is hidden, so they
    // render as two unlabelled share glyphs with nothing to tell them apart.
    expect(s).not.toMatch(/className="tb-icon"[\s\S]{0,200}setShareOpen\(true\)/);

    // The old inversion must not come back either. Sliced rather than matched
    // with a bounded regex: now that the branch is short, any window wide
    // enough to cover it also reaches the viewer branch below, where opening
    // the console IS the correct behaviour.
    const at = s.indexOf('{canEditCurrent ? (\n              <button className="tb-btn" onClick={quickCopyShareLink}');
    expect(at, 'the editor branch of the topbar share control moved').toBeGreaterThan(-1);
    const editorBranch = s.slice(at, s.indexOf(') : (', at));
    expect(editorBranch).toContain('quickCopyShareLink');
    expect(editorBranch, 'the editor branch opens the console instead of copying').not.toContain('setShareOpen');
  });

  test('the console keeps a door from the board — the copy toast', () => {
    // With no permanent icon, the toast is the one board-surface route in. Its
    // other two doors (⌘K, sidebar right-click) are pinned by
    // collab-invite-link-wiring.spec.js.
    const s = app();
    expect(s).toMatch(/Share link copied[\s\S]{0,200}label: 'Manage access', onClick: \(\) => setShareOpen\(true\)/);
  });

  test('viewers get the console as their share button — they cannot mint a link', () => {
    const s = app();
    expect(s).toMatch(/canEditCurrent \? \([\s\S]{0,900}\) : \([\s\S]{0,300}setShareOpen\(true\)[\s\S]{0,200}Share<\/span>/);
  });

  test('the one-tap copy is no longer indistinguishable from opening the dialog', () => {
    const s = app();
    // It emits the same event ShareModal uses for the same act…
    expect(s).toMatch(/SHARE_LINK_COPIED, \{ kind: 'view', surface: 'topbar'/);
    // …and no longer masquerades as a dialog open.
    expect(s).not.toMatch(/SHARE_OPEN, \{ board_id: currentBoard\.id, quick: true \}/);
    // The catalog warns that historic rows are mixed, so a future reader splits them.
    expect(events()).toMatch(/share_open[\s\S]{0,400}quick/);
  });

  test('one control, one word for it, and no query paid to letter it', () => {
    const s = app();
    // The button is always "Share". It briefly alternated to "Copy link" once a
    // link existed, which is accurate but gives one control two names for the
    // same act — the confusion this whole surface was being cleaned up to end.
    expect(s).toMatch(/onClick=\{quickCopyShareLink\}[\s\S]{0,200}<span className="tb-btn-label">Share<\/span>/);
    expect(s).not.toMatch(/\? 'Copy link' : 'Share'/);
    // sharedBoardIds survives for what it is actually load-bearing for:
    // suppressing the share ask on a board already shared.
    expect(s).toMatch(/alreadyShared: sharedBoardIds\.has\(boardId\)/);
    // Still never fetched — listPublicLinks is per-board and a query on every
    // board open is the wrong trade.
    expect(s).not.toMatch(/listPublicLinks\(/);
  });
});

test.describe('the ask to show the work', () => {
  test('fires at the work beat, decoupled through a window event', () => {
    const s = app();
    expect(s).toMatch(/dispatchEvent\(new CustomEvent\('soleil:share-ask'/);
    expect(s).toMatch(/addEventListener\('soleil:share-ask'/);
    // Dispatched after the two existing nudges so ordering stays legible.
    expect(s.indexOf("'soleil:first-value'")).toBeLessThan(s.indexOf("'soleil:share-ask'"));
  });

  test('claims the shared slot, so it can never land on top of the wall', () => {
    const s = app();
    expect(s).toMatch(/claimUpsellSlot\('share-ask'\)/);
  });

  test('declining NEVER burns the once-per-board stamp', () => {
    // The dead-gate shape: stamping at a gate that declines retires the surface
    // for that board permanently, for everyone it declines.
    //
    // Scoped to the handler — App.jsx has other localStorage.setItem(key, …)
    // call sites hundreds of thousands of characters earlier, and a whole-file
    // indexOf silently compares against one of those instead.
    const s = app();
    const start = s.indexOf('const onAsk = (e) =>');
    const end = s.indexOf("window.addEventListener('soleil:share-ask'");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = s.slice(start, end);

    const rule = handler.indexOf('shouldAskToShare(');
    const claim = handler.indexOf("claimUpsellSlot('share-ask')");
    const stamp = handler.indexOf('localStorage.setItem(key,');
    expect(rule).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(-1);
    expect(rule).toBeLessThan(claim);
    expect(claim).toBeLessThan(stamp);
    // Both gates must return, not fall through.
    expect(handler).toMatch(/shouldAskToShare\(\{[\s\S]{0,220}\}\)\) return;/);
    expect(handler).toMatch(/claimUpsellSlot\('share-ask'\)\) return;/);
  });

  test('the ask and the act are one tap — no dialog to abandon', () => {
    const s = app();
    expect(s).toMatch(/SHARE_ASK_TAKEN[\s\S]{0,200}quickCopyShareLinkRef\.current/);
  });
});

test.describe('collaboration is measurable without archaeology', () => {
  test('every grant mechanism records HOW access was created', () => {
    expect(modal()).toMatch(/ACCESS_GRANTED[\s\S]{0,200}how: inviteRole === 'workspace' \? 'workspace' : 'email'/);
    expect(authGate()).toMatch(/ACCESS_GRANTED[\s\S]{0,120}how: 'invite_link'/);
    // Only branches that actually granted something count.
    expect(authGate()).toMatch(/status === 'joined' \|\| row\?\.status === 'upgraded'/);
  });

  test('co-creation is recorded as it happens, not derived from card actors', () => {
    const s = app();
    // A guest placing a card into somebody else's workspace.
    expect(s).toMatch(/workspace\.created_by !== user\.id/);
    expect(s).toMatch(/CO_CREATION_STARTED/);
    // Once per board, not per card.
    expect(s).toMatch(/logEventOnce\(`co_creation:\$\{boardId\}`/);
  });

  test('the catalog explains what each collaboration event answers', () => {
    const s = events();
    expect(s).toMatch(/access_granted[\s\S]{0,300}WHICH MECHANISM/);
    expect(s).toMatch(/co_creation_started[\s\S]{0,300}OUTCOME metric/);
  });
});
