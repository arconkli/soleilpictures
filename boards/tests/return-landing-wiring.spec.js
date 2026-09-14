// return-landing-wiring.spec.js — source-guard for the returning-user path.
// ?local=1 mounts LocalBoardsApp and AuthGate never renders there, so the
// App/AuthGate wiring is asserted on CODE SHAPE (the collab-nudge idiom).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const gate = () => read('src/auth/AuthGate.jsx');
const ask = () => read('src/components/ReturnReasonAsk.jsx');

test.describe('return landing wiring', () => {
  test('the last-seen stamp is written from the presence path, and App reads it back', () => {
    expect(gate()).toMatch(/recordSeen\(user\?\.id\)/);
    const s = app();
    expect(s).toMatch(/takeReturn\(user\?\.id\)/);
    expect(s).not.toMatch(/soleil_last_seen_day_\$\{user\?\.id/);
  });

  test('a returning person with cards is not re-toured', () => {
    expect(app()).toMatch(/dismissOnboarding\('returned_with_cards'\)/);
  });

  test('an empty stack on a new device falls back to the most recent populated cluster', () => {
    expect(app()).toMatch(/EV\.LANDING_FALLBACK/);
  });

  test('the power reveal takes the slot before it burns its one-shot', () => {
    const s = app();
    const claim = s.indexOf("claimUpsellSlot('power-reveal')");
    const latch = s.indexOf('if (!revealSeen(picked.key)) return;');
    expect(claim).toBeGreaterThan(-1);
    expect(latch).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(latch);
  });

  test('skip is logged, and the ask honours a server-side asked flag', () => {
    const a = ask();
    expect(a).toMatch(/via: 'skip'/);
    expect(a).toMatch(/askedOnServer/);
    expect(app()).toMatch(/return_reason_asked_at/);
  });
});
