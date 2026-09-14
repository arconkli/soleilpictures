// signin-typo-wiring.spec.js — source-guard for the sign-in form's typo offer and
// the honest wrong-code copy (AuthGate renders only signed-out, off-harness).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const gate = () => read('src/auth/AuthGate.jsx');
const events = () => read('src/lib/analyticsEvents.js');

test.describe('sign-in typo + code copy wiring', () => {
  test('the form offers the fix on both stages and logs both events', () => {
    const s = gate();
    expect(s).toMatch(/import \{ suggestEmail \} from '\.\.\/lib\/emailTypo\.js'/);
    expect((s.match(/typoOffer\('email'\)/g) || []).length).toBe(1);
    expect((s.match(/typoOffer\('code'\)/g) || []).length).toBe(1);
    expect(s).toMatch(/EV\.EMAIL_TYPO_SUGGESTED/);
    expect(s).toMatch(/EV\.EMAIL_TYPO_ACCEPTED/);
    expect(s).toMatch(/className="auth-link auth-typo"/);
  });

  test('a wrong code is not called expired', () => {
    const s = gate();
    const combined = s.indexOf("msg.includes('expired') && msg.includes('invalid')");
    const expired = s.indexOf("if (msg.includes('expired'))                          return \"That code expired");
    expect(combined).toBeGreaterThan(-1);
    expect(combined).toBeLessThan(expired);
    const e = events();
    const c = e.indexOf("m.includes('expired') && m.includes('invalid')");
    const x = e.indexOf("if (m.includes('expired'))                            return 'expired';");
    expect(c).toBeGreaterThan(-1);
    expect(c).toBeLessThan(x);
    expect(e).toMatch(/return 'code_rejected'/);
  });
});
