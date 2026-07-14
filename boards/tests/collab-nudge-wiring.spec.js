// Source-guard for the "build this together" collaborator-invite loop: the
// banner fires at the activation beat (3 genuine cards) with a board-scoped
// ShareModal CTA that lands on the invite-link section, and invite
// submissions emit the k-factor numerator (invite_sent). Since the collab
// rework the nudge is re-eligible per newly populated board (7d cooldown,
// lifetime cap) under settings.collab_nudge — NOT the legacy
// referral_prompts keys, which were shared with the retired 5-card banner
// and permanently muted most of the base. None of it is reachable from the
// backend-free harness, so this mirrors onboarding-tour-wiring.spec's style.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const nudge = () => read('src/components/ReferralNudge.jsx');
const share = () => read('src/components/ShareModal.jsx');
const events = () => read('src/lib/analyticsEvents.js');

test.describe('collab-invite nudge wiring', () => {
  test('App dispatches at the activation beat with the board id, gated off the tour', () => {
    const s = app();
    // The dispatch must share the fv nudge's !tourActive gate: 3 cards is
    // reachable mid-tour, where a banner renders dead under the pointer lock.
    expect(s).toMatch(/!tourActive && genuine\.length >= POP_BOARD_THRESHOLD/);
    // The event carries WHICH board crossed the bar — the banner's per-board
    // eligibility and the CTA's navigate-then-share routing both need it.
    expect(s).toMatch(/new CustomEvent\('soleil:collab-nudge', \{ detail: \{ boardId: currentId \} \}\)/);
    // The old 5-card referral dispatch must not come back alongside it.
    expect(s).not.toContain('soleil:referral-nudge');
    expect(s).not.toMatch(/genuine\.length >= 5\b/);
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

  test('the banner never stacks over the first-value upsell', () => {
    const s = nudge();
    // Both guards: DOM (fv already mounted) + timestamp (both events fired in
    // the same synchronous batch, before React rendered either banner).
    expect(s).toMatch(/querySelector\('\.fv-banner'\)/);
    expect(s).toContain("addEventListener('soleil:first-value'");
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
