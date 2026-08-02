// Source-guards for analytics-hygiene invariants that live across App.jsx and
// the feedback toast stack (collab-nudge-wiring pattern: the Supabase Workspace
// path isn't reachable from the backend-free harness, so pin the contract by
// reading the source).
//
// The invariants:
//  1. card_placed means "a user placed cards" — the remix clone batch must not
//     double-log it (remix_clone already carries kind + n for that batch).
//  2. A toast's onDismiss fires on the hand-dismiss (X) path ONLY — never on
//     TTL expiry, and never on an action-button click (action = engaged; the
//     three outcomes must stay mutually exclusive for funnel reads).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const appFeedback = () => read('src/components/AppFeedback.jsx');
const overlay = () => read('src/components/FeedbackOverlay.jsx');

test.describe('telemetry hygiene', () => {
  test('the remix clone batch suppresses card_placed (remix_clone owns that count)', () => {
    const s = app();
    expect(s).toMatch(/addCards\?\.\(pend\.cards, \{ suppressPlaced: true \}\)/);
    // addCards honors the flag around its CARD_PLACED beacon.
    const fn = s.slice(s.indexOf('const addCards = (cardsToAdd'), s.indexOf('const updateCard'));
    expect(fn).toContain('suppressPlaced');
    expect(fn.indexOf('suppressPlaced')).toBeLessThan(fn.indexOf('EV.CARD_PLACED'));
  });

  test('toast onDismiss is stored per toast and fired by the manual path only', () => {
    const s = appFeedback();
    // toast() accepts + stores onDismiss on the item.
    expect(s).toMatch(/onDismiss = null/);
    expect(s).toMatch(/\{ id, type, message, action, onDismiss, exiting: false \}/);
    // The expiry timer keeps calling the PLAIN dismiss — never the manual one.
    expect(s).toMatch(/setTimeout\(\(\) => dismissToast\(id\)/);
    // The manual wrapper reads the item through a ref (no side effects inside a
    // setState updater — StrictMode double-invokes those) and skips toasts
    // already exiting (an X during the expiry exit animation must not log).
    const manual = s.slice(s.indexOf('dismissToastManual'));
    expect(manual.length).toBeGreaterThan(0);
    expect(manual.slice(0, 400)).toContain('exiting');
    expect(manual.slice(0, 400)).toContain('onDismiss?.()');
  });

  test('the overlay routes X through the manual dismiss, action clicks through the plain one', () => {
    const s = overlay();
    // X button → manual (falls back to plain for old callers).
    expect(s).toMatch(/className="toast-dismiss"[^]*?\(onManualDismiss \|\| onDismissToast\)\(item\.id\)/);
    // Action button → plain dismiss only (engaged ≠ dismissed).
    const action = s.slice(s.indexOf('className="toast-action"'), s.indexOf('className="toast-dismiss"'));
    expect(action).toContain('onDismissToast(item.id)');
    expect(action).not.toContain('onManualDismiss');
  });
});
