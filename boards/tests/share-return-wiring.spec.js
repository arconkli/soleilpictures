// share-return-wiring.spec.js — source-guard: a sign-up that began on a /share
// page goes back there once a session exists. AuthGate never renders in the
// ?local=1 harness and the share viewer has no session there, so this asserts
// on CODE SHAPE (the collab-nudge idiom).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const gate = () => read('src/auth/AuthGate.jsx');
const view = () => read('src/components/PublicBoardView.jsx');
const events = () => read('src/lib/analyticsEvents.js');

test.describe('share return wiring', () => {
  test('AuthGate stashes the marker on mount and consumes it in BOTH session paths before rendering the app', () => {
    const s = gate();
    expect(s).toMatch(/from '\.\.\/lib\/shareReturn\.js'/);
    expect(s).toMatch(/captureRemixSource\(\);\s*captureShareReturn\(\);/);
    const consumes = s.match(/if \(consumeShareReturn\(\)\) return;/g) || [];
    expect(consumes.length).toBe(2);
    // Each consume precedes its setSession.
    const first = s.indexOf('if (consumeShareReturn()) return;');
    const setA = s.indexOf('if (!cancelled) setSession(data.session);');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(setA);
    const second = s.indexOf('if (consumeShareReturn()) return;', first + 1);
    const setB = s.indexOf('if (!cancelled) setSession(sess);');
    expect(second).toBeLessThan(setB);
  });

  test('only the sign-up/sign-in CTAs carry the marker — not the brand mark, remix or join', () => {
    const s = view();
    expect(s).toMatch(/RETURN_SURFACES = new Set\(\['signin', 'topbar', 'prompt', 'article', 'empty_board'\]\)/);
    expect(s).toMatch(/withShareReturn\(/);
  });

  test('a signed-in viewer gets Save a copy, no Sign in link, and no sign-up prompt', () => {
    const s = view();
    expect(s).toMatch(/signedIn/);
    expect(s).toMatch(/auth\?\.getSession\(\)/);
    expect(s).toMatch(/signedIn \? 'Save a copy' : remixLabel/);
    expect(s).toMatch(/\{!signedIn && \(\s*<a className="public-signin-quiet"/);
    expect(s).toMatch(/signedIn \? null : \(\s*<SharePrompt/);
  });

  test('the dead-link and empty-board states offer a signed-in viewer Open Clusters, not sign-up (SHARE-16)', () => {
    const s = view();
    for (const surface of ['invalid_page', 'empty_board']) {
      const at = s.indexOf(`ctaHref(ctx, '${surface}')`);
      expect(at, `${surface} CTA is gone`).toBeGreaterThan(-1);
      const block = s.slice(s.lastIndexOf('<div className="public-empty-actions">', at), at);
      expect(block).toMatch(/\{signedIn \? \(\s*<a className="public-cta" href="\/">Open Clusters<\/a>\s*\) : \(/);
    }
    // Every Sign in link on the page is behind the signed-out branch.
    expect(s).not.toMatch(/public-empty-actions">\s*<a className="public-signin-quiet"/);
  });

  test('the catalog names the landing event', () => {
    expect(events()).toMatch(/SHARE_RETURN_LANDED:\s*'share_return_landed'/);
  });
});
