// Source-guard for the "build this together" collaborator-invite loop: a
// board-scoped ShareModal CTA landing on the invite-link section, with invite
// submissions emitting the k-factor numerator (invite_sent). The nudge is
// eligible per newly populated board (7d cooldown, lifetime cap) under
// settings.collab_nudge — NOT the legacy referral_prompts keys, which were
// shared with the retired 5-card banner and permanently muted most of the base.
// None of it is reachable from the backend-free harness, so this mirrors
// onboarding-tour-wiring.spec's style.
//
// AS OF 2026-08-31 THE BANNER IS INERT. App no longer dispatches
// soleil:collab-nudge, so nothing here asserts that it appears — the tests below
// guard the retirement (App), the still-working invite path (ShareModal, sidebar)
// and the component's continued readiness to be switched back on. The banner's
// own internals are still guarded because leaving them to rot is how a revert
// turns into a rebuild. See the comment block at the old dispatch site for the
// numbers that retired it.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const nudge = () => read('src/components/ReferralNudge.jsx');
const share = () => read('src/components/ShareModal.jsx');
const events = () => read('src/lib/analyticsEvents.js');

test.describe('collab-invite nudge wiring', () => {
  test('App no longer spends the activation beat on the collaborator nudge', () => {
    const s = app();
    // RETIRED 2026-08-31. Most people shown it dismissed it and the
    // click-through was a small single-digit percentage. It asked for a second
    // human who cares about this specific board, and it spent the activation
    // beat to do it. The capability is untouched — Share panel and sidebar still
    // reach openCollabInvite — only the unprompted interruption is gone.
    // Matched as the DISPATCH, not as the bare string: the comment block that
    // records why this went away necessarily names the event, and a guard that
    // cannot tell code from prose would force that explanation to be deleted.
    expect(s).not.toMatch(/new CustomEvent\('soleil:collab-nudge'/);
    expect(s).not.toMatch(/dispatchEvent\(\s*ev\s*\)/);
    // The old 5-card referral dispatch must not come back in its place either.
    expect(s).not.toContain('soleil:referral-nudge');
    expect(s).not.toMatch(/genuine\.length >= 5\b/);
    // The comment must survive with it: a bare deletion reads as an accident and
    // invites someone to "restore" the dispatch without the numbers.
    expect(s).toMatch(/COLLABORATOR NUDGE NO LONGER TAKES THIS BEAT/);
  });

  test('the banner listens for the collab signal and reports as invite_nudge', () => {
    const s = nudge();
    expect(s).toContain("addEventListener('soleil:collab-nudge'");
    expect(s).toContain('EV.INVITE_NUDGE_VIEW');
    expect(s).toContain('EV.INVITE_NUDGE_CTA');
    expect(s).toContain('EV.INVITE_NUDGE_DISMISS');
  });

  test('eligibility is per-board with a cooldown and a lifetime cap — off the legacy keys', () => {
    const s = nudge();
    // The new settings blob: { count, last_at, boards } under collab_nudge.
    expect(s).toContain('collab_nudge');
    expect(s).toMatch(/COOLDOWN_MS/);
    expect(s).toMatch(/LIFETIME_CAP/);
    expect(s).toMatch(/boards\.includes\(boardId\)/);
    // The legacy once-per-account keys must NOT gate the reworked banner:
    // they were shared with the retired 5-card referral banner, so reusing
    // them permanently muted everyone who ever saw it.
    expect(s).not.toContain("'invite_nudge_shown_at'");
    expect(s).not.toContain("'paid_nudge_shown_at'");
    expect(s).not.toContain('referral_prompts');
  });

  test('the banner never stacks over another upgrade surface', () => {
    const s = nudge();
    // Was a `.fv-banner` DOM query plus a soleil:first-value timestamp. That
    // pair only guarded ONE direction and could not see the cap-hit modal at
    // all, so a bulk import put all three surfaces on screen inside seven
    // seconds. Both are replaced by the shared slot.
    expect(s).toContain("claimUpsellSlot('invite-nudge')");
    expect(s).not.toMatch(/querySelector\('\.fv-banner'\)/);
    expect(s).not.toContain("addEventListener('soleil:first-value'");
    // Declining must not persist anything — App re-dispatches on every card
    // change past the bar, and a stand-down that burned the once-per-session
    // flag would retire the banner for the rest of the session.
    expect(s.indexOf("claimUpsellSlot('invite-nudge')"))
      .toBeLessThan(s.indexOf('firedRef.current = true'));
  });

  test('the first-value upsell is no longer gated on a beat nobody claims', () => {
    const s = app();
    // With the dispatch gone, `collabTookTheBeat` could only ever be false, and
    // leaving the conjunct in place would be a dead gate on a live surface —
    // the exact shape that silently retired the first-value banner once before.
    // Again matched as code, not prose — the retirement comment names the flag.
    expect(s).not.toMatch(/collabTookTheBeat\s*=/);
    expect(s).not.toMatch(/!collabTookTheBeat/);
    expect(s).toMatch(/genuine\.length >= 2\) \{\s*\n\s*window\.dispatchEvent\(new CustomEvent\('soleil:first-value'\)\)/);
    // The upsell keeps its own tour gate and its own 2-card threshold.
    expect(s).toMatch(/!tourActive && genuine\.length >= 2/);
  });

  test('the banner is left inert rather than deleted, so the revert is one line', () => {
    // Restoring the experiment must be re-adding the dispatch and nothing else.
    // The component still listens, still claims the shared slot, and is still
    // rendered — it simply never hears the event now.
    const n = nudge();
    expect(n).toContain("addEventListener('soleil:collab-nudge'");
    expect(n).toMatch(/e\?\.preventDefault\?\.\(\)/);
    expect(n.indexOf('preventDefault')).toBeGreaterThan(n.indexOf('boards.includes(boardId)'));
  });

  test('the CTA routes to the Share panel on the nudged board, invite-link section first', () => {
    const s = app();
    // On a board: open ShareModal scrolled to the invite-link section.
    expect(s).toMatch(/openCollabInvite[\s\S]{0,600}setShareInitialSection\('invite-link'\)/);
    expect(s).toMatch(/openCollabInvite[\s\S]{0,800}currentSurface === 'board'/);
    // Off-board with a known board: navigate there first, THEN share — only a
    // truly board-less context falls back to the account Invite tab.
    expect(s).toMatch(/openBoard\(boardId\);\s*\n\s*goShare\(\)/);
    expect(s).toMatch(/openInviteFriends\(surface\)/);
    // The banner hands the board id through.
    expect(s).toContain('<ReferralNudge tier={myTier.tier} onCollaborate={openCollabInvite} />');
    expect(nudge()).toMatch(/onCollaborate\?\.\(surface, boardIdRef\.current\)/);
  });

  test('invite submissions emit the k-factor numerator', () => {
    const s = share();
    expect(s).toContain('EV.INVITE_SENT');
    expect(s).toMatch(/result: 'granted'/);
    expect(s).toMatch(/result: 'pending'/);
  });

  test('the event registry defines the invite loop events', () => {
    const s = events();
    for (const ev of [
      'invite_nudge_view', 'invite_nudge_cta', 'invite_nudge_dismiss', 'invite_sent',
      'invite_link_created', 'invite_link_view', 'invite_link_join_click', 'invite_link_claimed',
    ]) {
      expect(s).toContain(`'${ev}'`);
    }
  });
});
