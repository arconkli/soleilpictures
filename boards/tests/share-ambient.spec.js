// share-ambient.spec.js
//
// Sharing should be a thing the product offers, not a thing you go and find.
//
// The shape this fixes: the topbar's LABELLED "Share" button opened a 929-line
// access console (two link kinds with their own checkboxes, email invites, a
// member list, Explore publishing), while the one-tap copy sat beside it as an
// unlabelled link glyph. Most people who reached for sharing landed in an admin
// screen; only a handful ever found the affordance that just hands them a link.
//
// It was fixed twice. First by swapping the two affordances, which was the wrong
// repair: it treated the panel as unfixable and left two share controls side by
// side. Then by fixing the PANEL (~20 resting controls → 7, copy first) and
// collapsing the toolbar back to one Share that opens it. What is pinned below
// is that second state — one control, and the copy is one press inside the door
// rather than instead of it. A work burst still offers the share outright, and
// that offer stays a toast whose action IS the share.
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

test.describe('one Share control, and Share opens sharing', () => {
  test('the board offers exactly ONE share control, and it opens the panel', () => {
    const s = app();
    expect(s).toMatch(/className="tb-btn" onClick=\{\(\) => setShareOpen\(true\)\} title="Share this cluster"/);
    // Not two: an icon beside it opening the console is what the intermediate
    // fix shipped, and on a phone .tb-btn-label is hidden, so the pair rendered
    // as two unlabelled share glyphs with nothing to tell them apart.
    expect(s).not.toMatch(/className="tb-icon"[\s\S]{0,200}setShareOpen\(true\)/);
    // And it does not branch on permission — a viewer and an editor press the
    // same button and the panel decides what it can offer them.
    expect(s).not.toMatch(/canEditCurrent \? \([\s\S]{0,300}tb-btn-label">Share/);
  });

  test('the toolbar no longer copies behind the panel\'s back', () => {
    // A toolbar that mints a link without opening anything is a second, silent
    // share mechanism — the shape that produced two live links per board and a
    // funnel where choosing was invisible.
    const s = app();
    expect(s).not.toMatch(/className="tb-btn"[\s\S]{0,160}onClick=\{quickCopyShareLink\}/);
    // quickCopyShareLink survives for the SHARE ASK, whose whole point is that
    // the ask and the act are one tap with no dialog to abandon.
    expect(s).toMatch(/SHARE_ASK_TAKEN[\s\S]{0,200}quickCopyShareLinkRef\.current/);
  });

  test('opening the panel lands you on the copy, not on the close button', () => {
    // Modal focuses the first focusable, which is the header X. With the toolbar
    // no longer copying, Share → Enter has to put a link on the clipboard or the
    // one-press path is genuinely gone rather than relocated.
    const m = modal();
    expect(m).toMatch(/initialFocusRef=\{canInvite \? takeLinkRef : undefined\}/);
    expect(m).toMatch(/share-invite-btn-primary"\s*\n\s*ref=\{takeLinkRef\}/);
  });

  test('the copy is still distinguishable from the dialog open', () => {
    const s = app();
    // The ask's copy emits the same event ShareModal uses for the same act…
    expect(s).toMatch(/SHARE_LINK_COPIED, \{ kind: 'view', surface: 'topbar'/);
    // …and no longer masquerades as a dialog open.
    expect(s).not.toMatch(/SHARE_OPEN, \{ board_id: currentBoard\.id, quick: true \}/);
    // The catalog warns that historic rows are mixed, so a future reader splits them.
    expect(events()).toMatch(/share_open[\s\S]{0,400}quick/);
  });

  test('nothing is fetched on board open just to letter a button', () => {
    const s = app();
    // sharedBoardIds is load-bearing for one thing: suppressing the share ask on
    // a board already shared. It never labelled anything and must not start.
    expect(s).toMatch(/alreadyShared: sharedBoardIds\.has\(boardId\)/);
    expect(s).not.toMatch(/\? 'Copy link' : 'Share'/);
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
