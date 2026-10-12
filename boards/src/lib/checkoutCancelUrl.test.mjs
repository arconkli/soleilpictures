// checkoutCancelUrl.test.mjs — cancelling a checkout started in the app goes
// back to the app, not to the marketing /pricing page (ACCOUNT-10).
//
// create-checkout-session chose its cancel_url once for every caller. The
// upgrade modal (chip, first-value banner, cap wall, import dialog, Settings)
// all send someone who pressed Stripe's back arrow to /pricing, outside the
// app, with only a small brand link home. The function now picks between two
// FIXED urls by the surface the client already sends; the client never
// supplies a url.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

function inAppSurfaces() {
  const src = read('../../../supabase/functions/create-checkout-session/index.ts');
  const m = src.match(/const IN_APP_SURFACES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'IN_APP_SURFACES not found in create-checkout-session');
  return { src, set: new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])) };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}

test('the cancel url is one of two fixed urls, chosen by surface', () => {
  const { src } = inAppSurfaces();
  assert.match(src, /const cancelUrl\s+= IN_APP_SURFACES\.has\(surface\)\s*\n?\s*\? `\$\{APP_URL\}\/\?checkout=canceled`\s*\n?\s*: `\$\{APP_URL\}\/pricing`;/);
  assert.doesNotMatch(src, /cancel_url:\s*body\./, 'never a url from the request');
});

test('every in-app PricingModal surface returns to the app; /pricing callers keep /pricing', () => {
  const { set } = inAppSurfaces();
  const literal = new Set(['modal']);   // PricingModal's default
  for (const f of walk(SRC_DIR)) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<PricingModal\b[^>]*\bsurface="([a-z_]+)"/g)) literal.add(m[1]);
  }
  // UpgradeModal picks between these two.
  literal.add('first_value');
  for (const s of literal) assert.ok(set.has(s), `in-app surface "${s}" would land on /pricing`);
  assert.ok(!set.has('page'), '/pricing itself keeps /pricing');
  assert.ok(!set.has('waitlist_status'), 'the waitlist screen keeps /pricing');
});
