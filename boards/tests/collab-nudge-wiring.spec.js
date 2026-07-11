// Source-guard for the "build this together" collaborator-invite loop: the
// banner moved from a 5-card referral pitch to the activation beat (3 genuine
// cards) with a ShareModal CTA, and invite submissions now emit the k-factor
// numerator (invite_sent). None of it is reachable from the backend-free
// harness, so this mirrors onboarding-tour-wiring.spec's style.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const nudge = () => read('src/components/ReferralNudge.jsx');
const share = () => read('src/components/ShareModal.jsx');
const events = () => read('src/lib/analyticsEvents.js');

test.describe('collab-invite nudge wiring', () => {
  test('App dispatches at the activation beat, gated off the tour', () => {
    const s = app();
    // The dispatch must share the fv nudge's !tourActive gate: 3 cards is
    // reachable mid-tour, where a banner renders dead under the pointer lock.
    expect(s).toMatch(/!tourActive && genuine\.length >= POP_BOARD_THRESHOLD/);
    expect(s).toContain("new CustomEvent('soleil:collab-nudge')");
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
    // Once-per-account persistence keys are UNCHANGED — anyone who dismissed
    // the old referral banner must not be re-nudged by the reworked one.
    expect(s).toContain("'paid_nudge_shown_at'");
    expect(s).toContain("'invite_nudge_shown_at'");
  });

  test('the banner never stacks over the first-value upsell', () => {
    const s = nudge();
    // Both guards: DOM (fv already mounted) + timestamp (both events fired in
    // the same synchronous batch, before React rendered either banner).
    expect(s).toMatch(/querySelector\('\.fv-banner'\)/);
    expect(s).toContain("addEventListener('soleil:first-value'");
  });

  test('the CTA routes to the board-scoped Share panel with a Home fallback', () => {
    const s = app();
    expect(s).toMatch(/openCollabInvite[\s\S]{0,400}currentSurface === 'board'[\s\S]{0,200}setShareOpen\(true\)/);
    expect(s).toContain('<ReferralNudge tier={myTier.tier} onCollaborate={openCollabInvite} />');
  });

  test('invite submissions emit the k-factor numerator', () => {
    const s = share();
    expect(s).toContain('EV.INVITE_SENT');
    expect(s).toMatch(/result: 'granted'/);
    expect(s).toMatch(/result: 'pending'/);
  });

  test('the event registry defines the invite loop events', () => {
    const s = events();
    for (const ev of ['invite_nudge_view', 'invite_nudge_cta', 'invite_nudge_dismiss', 'invite_sent']) {
      expect(s).toContain(`'${ev}'`);
    }
  });
});
