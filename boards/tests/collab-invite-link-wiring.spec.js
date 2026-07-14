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
    expect(s).toContain('INVITE WITH A LINK');
    // The two link kinds render in separate sections off a kind split.
    expect(s).toMatch(/publicLinks\.filter\(l => \(l\.kind \|\| 'view'\) === 'view'\)/);
    expect(s).toMatch(/publicLinks\.filter\(l => l\.kind === 'invite'\)/);
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
