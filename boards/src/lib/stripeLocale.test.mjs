// Stripe Checkout and the billing portal open in the account's language
// (user_metadata.locale). The functions are Deno, so the source check reads
// them as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripeLocale, STRIPE_LOCALES } from '../../../supabase/functions/_shared/stripeLocale.mjs';

const root = new URL('../../../supabase/functions/', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('each of the seven languages comes back as itself', () => {
  assert.equal(STRIPE_LOCALES.length, 7);
  for (const l of ['en', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru']) {
    assert.equal(stripeLocale({ user_metadata: { locale: l } }), l);
  }
});

test('anything else is nothing, so Stripe follows the browser', () => {
  assert.equal(stripeLocale({ user_metadata: {} }), undefined);
  assert.equal(stripeLocale({}), undefined);
  assert.equal(stripeLocale(null), undefined);
  assert.equal(stripeLocale(undefined), undefined);
  for (const bad of ['', 'de', 'pt', 'PT-BR', 42, null]) {
    assert.equal(stripeLocale({ user_metadata: { locale: bad } }), undefined, String(bad));
  }
});

test('every Checkout and portal session create passes the account locale', () => {
  const files = ['create-checkout-session/index.ts', 'team-billing/index.ts', 'create-portal-session/index.ts'];
  let creates = 0;
  for (const f of files) {
    const src = read(f);
    assert.match(src, /from "\.\.\/_shared\/stripeLocale\.mjs"/, `${f} imports stripeLocale`);
    assert.match(src, /stripeLocale\(/, `${f} calls stripeLocale`);
    for (const m of src.matchAll(/(checkout|billingPortal)\.sessions\.create\(/g)) {
      creates += 1;
      if (src.slice(m.index).startsWith('checkout.sessions.create(teamCheckoutParams(')) continue; // its params carry it, below
      const call = src.slice(m.index, src.indexOf('});', m.index));
      assert.match(call, /\.\.\.\(locale \? \{ locale \} : \{\}\)/, `${f}: ${m[0]} passes locale`);
    }
  }
  assert.equal(creates, 5, 'two in create-checkout-session, two in team-billing, one in create-portal-session');
  assert.match(read('team-billing/index.ts'), /teamCheckoutParams\(\{[\s\S]*?locale: stripeLocale\(user\)/);
  assert.match(read('_shared/teamBillingCore.mjs'), /\.\.\.\(locale \? \{ locale \} : \{\}\)/);
});
