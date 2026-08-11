// Source-guard for the invite-link loop (0189): role-bearing /share links
// that grant editor/viewer access via an explicit claim — never on a bare
// GET. The claim flows need a real backend (the ?local=1 harness stubs
// Supabase), so this guards the wiring the same way collab-nudge-wiring
// does: by reading the source.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const authGate = () => read('src/auth/AuthGate.jsx');
const publicView = () => read('src/components/PublicBoardView.jsx');
const joinCard = () => read('src/components/JoinBoardCard.jsx');
const share = () => read('src/components/ShareModal.jsx');
const api = () => read('src/lib/boardsApi.js');
const party = () => read('party/upload.ts');
const perm = () => read('src/hooks/useBoardPermission.js');

test.describe('collab invite-link wiring', () => {
  test('AuthGate captures ?join= and claims it in BOTH session paths', () => {
    const s = authGate();
    // Capture on mount, before any auth roundtrip (survives the OTP hop).
    expect(s).toContain('captureJoinToken()');
    expect(s).toMatch(/searchParams\.get\('join'\)/);
    // Claimed after the initial-session restore AND after the
    // onAuthStateChange sign-in — the two ways a session can arrive.
    expect(s.match(/await consumePendingJoin\(/g)?.length).toBe(2);
    // The claim clears the stash on any outcome so a dead token never loops.
    expect(s).toMatch(/finally\s*\{\s*clearJoin\(\)/);
  });

  test('the signed-out landing says WHAT you were invited to', () => {
    // Someone who clicked "Join as editor" used to arrive at the bare sign-in
    // screen with nothing tying it to the cluster they had just been looking
    // at — and bounced. ?invite= has carried that context since 0086 via
    // peekPendingInviteEmail; ?join= is multi-use so there is no address to
    // pre-fill, but the cluster name is the part that matters.
    const s = authGate();
    expect(s).toContain('peekJoinBoardName');
    expect(s).toContain('EV.LANDING_JOIN_PREFILL');
    expect(s).toMatch(/You've been invited to collaborate/);
    // Degrade, never block: a revoked/expired/deleted token raises P0002 and
    // must leave the ordinary landing intact.
    expect(s).toMatch(/peekJoinBoardName\(token\)[\s\S]{0,400}\.catch\(\(\) => \{\}\)/);
    // The addressed invite still wins when both are somehow present.
    expect(s).toMatch(/!inviteHint && joinHint/);
    // It reads the SAME stash the claim consumes — not a second URL parse.
    expect(s).toMatch(/const token = readJoin\(\);/);
  });

  test('every claim outcome is recorded, not just the granting one', () => {
    // claim_collab_link writes its own invite_link_claimed row ONLY on the
    // fresh-join branch: 'upgraded', 'already' and 'noop' each return early.
    // Those claims left no trace at all, so a join click could vanish with
    // neither a success nor a failure against it — which is exactly what the
    // funnel showed after the ambiguity bug was fixed.
    const s = authGate();
    expect(s).toMatch(/EV\.INVITE_LINK_CLAIM_RESULT, \{ status: row\?\.status \|\| 'unknown' \}/);
    // Logged immediately after the RPC returns and before the redirect
    // bookkeeping, so an unexpected row shape can't skip the event.
    const body = s.slice(s.indexOf('async function consumePendingJoin'));
    expect(body.indexOf('INVITE_LINK_CLAIM_RESULT'))
      .toBeLessThan(body.indexOf('if (row?.workspace_id)'));
    // The failure path stays.
    expect(s).toContain('EV.INVITE_LINK_CLAIM_FAILED');
  });

  test('the Share panel is reachable from the sidebar, on the right cluster', () => {
    // Share existed only on the board toolbar and ⌘K, which is a large part of
    // why most owners never opened it. Right-clicking cluster B while viewing
    // cluster A must share B, so this cannot reuse openCollabInvite (which
    // only navigates when the current surface isn't already a board).
    const app = read('src/App.jsx');
    const tree = read('src/components/SidebarBoardTree.jsx');
    expect(tree).toMatch(/id: 'share', label: 'Share…', run: \(\) => onShareBoard\?\.\(board\.id\)/);
    expect(app).toContain('onShareBoard={openShareForBoard}');
    expect(app).toMatch(/openShareForBoard[\s\S]{0,500}boardId !== currentId \|\| currentSurface !== 'board'/);
    expect(app).toMatch(/openShareForBoard[\s\S]{0,500}setStack\(\[boardId\]\)/);
    // The funnel can tell the entry points apart.
    expect(app).toMatch(/EV\.SHARE_OPEN, \{ board_id: currentId, surface: shareSurfaceRef\.current \}/);
  });

  test('the /share viewer renders the confirm card off bundle.join and never auto-claims', () => {
    const s = publicView();
    // The card arms off the bundle's join descriptor…
    expect(s).toMatch(/bundle\.join\?\.kind === 'invite'/);
    expect(s).toContain('<JoinBoardCard');
    // …and joining is a plain href through the ?join= param — the viewer
    // itself must never call the claim RPC (a GET must not grant access).
    expect(s).toMatch(/&join=\$\{encodeURIComponent\(token\)\}/);
    expect(s).not.toContain('claimCollabLink');
    // The generic signup prompt yields to the join card, not stacks with it.
    expect(s).toMatch(/joinInfo && token \? \(/);
  });

  test('the join card is claim-on-click with view + click analytics', () => {
    const s = joinCard();
    expect(s).toContain('EV.INVITE_LINK_VIEW');
    expect(s).toContain('EV.INVITE_LINK_JOIN_CLICK');
    // Dismissible — an invitee can just look around.
    expect(s).toContain('Just look around');
  });

  test('ShareModal mints invite links and fires the created event', () => {
    const s = share();
    expect(s).toContain('createCollabLink');
    expect(s).toContain('EV.INVITE_LINK_CREATED');
    expect(s).toContain('INVITE TO COLLABORATE');
    // The two link kinds render in separate sections off a kind split.
    expect(s).toMatch(/publicLinks\.filter\(l => \(l\.kind \|\| 'view'\) === 'view'\)/);
    expect(s).toMatch(/publicLinks\.filter\(l => l\.kind === 'invite'\)/);
  });

  test('the modal is ordered by what people actually do', () => {
    // Demand order, measured: 29 of the first 32 links ever made were view
    // links and exactly one email invite was ever sent, yet the email form led
    // the modal and the link sections sat below it. Collaborating comes first,
    // then the view-only link, then the access list, then Explore.
    const s = share();
    const order = ['INVITE TO COLLABORATE', 'ANYONE WITH THE LINK', 'PEOPLE WITH ACCESS', 'ExplorePublishSection board='];
    const at = order.map(k => s.indexOf(k));
    at.forEach((i, n) => expect(i, `${order[n]} missing`).toBeGreaterThan(-1));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // Inside the collaborate section the mint button must precede the
    // role/expiry selects — they were in front of it, so the one action the
    // modal exists for was never the first thing you could press.
    expect(s.indexOf('share-invite-btn-primary')).toBeLessThan(s.indexOf('share-link-options'));
    // Email invite is the secondary path in that same section, not the lead.
    expect(s.indexOf('Or invite by email')).toBeGreaterThan(s.indexOf('share-invite-btn-primary'));
  });

  test('every copy of a link is recorded', () => {
    // Copying is the act that sends a cluster to another human; from inside
    // the modal it used to emit nothing at all, leaving share_open as the last
    // observable step. One funnel: all copy paths go through copyLinkUrl.
    const s = share();
    expect(s).toMatch(/const copyLinkUrl = async \(token, kind\)[\s\S]{0,400}EV\.SHARE_LINK_COPIED/);
    expect(s).toMatch(/copyLinkUrl\(token, 'view'\)/);
    expect(s).toMatch(/copyLinkUrl\(token, 'invite'\)/);
    // onCopyPublicLink must delegate rather than write its own clipboard call,
    // or the row "Copy" buttons go dark again.
    expect(s).toMatch(/onCopyPublicLink = async \(token\) => \{\s*\n\s*const copied = await copyLinkUrl\(token\)/);
  });

  test('the anonymous copy-share-link path can never hand out an invite link', () => {
    const s = api();
    // ensurePublicLink reuses by scope — it must filter to view links or a
    // one-tap "Copy share link" could distribute an editor-granting key.
    expect(s).toMatch(/ensurePublicLink[\s\S]{0,600}\(l\.kind \|\| 'view'\) === 'view'/);
  });

  test('the party passes the join descriptor through the share bundle', () => {
    const s = party();
    expect(s).toMatch(/join: bundle\.join \|\| null/);
  });

  test('the demo tier is no longer demoted to viewer on shared boards', () => {
    const s = perm();
    expect(s).not.toContain("'tier-demoted'");
    // Waitlist stays defensively blocked.
    expect(s).toContain("'tier-blocked'");
  });
});
