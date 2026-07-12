// Source-guard for the /api/email-thumb Worker route (welcome email embeds
// the recipient's own board thumbnail — the <img> URL must stay publicly
// fetchable, HMAC-gated, and non-indexable). The Worker runs at the edge, not
// in the Playwright harness, so this mirrors the onboarding-tour-wiring.spec
// "this machinery is wired in" style.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const worker = () => read('src/worker.js');

test.describe('email-thumb worker route wiring', () => {
  test('the route is registered with a UUID-shaped matcher', () => {
    const s = worker();
    expect(s).toContain('\\/api\\/email-thumb\\/([0-9a-f-]{36})');
    expect(s).toMatch(/handleEmailThumb\(env, emailThumbMatch\[1\]/);
  });

  test('the signature derivation carries the versioned domain-separation tag', () => {
    // lifecycle-email-cron mirrors this derivation byte for byte; the tag is
    // the contract. Changing it breaks every thumb URL in already-sent email.
    const s = worker();
    expect(s).toContain('email-thumb-v1');
    expect(s).toContain("enc.encode(`email-thumb:${boardId}`)");
  });

  test('the HMAC secret comes from app_config, never a Supabase credential', () => {
    // The worker and the edge runtime hold DIFFERENT-format Supabase keys —
    // a credential-derived HMAC mismatched on every request (x-miss: sig).
    // Both sides must read the shared app_config row (migration 0186).
    const s = worker();
    expect(s).toContain('email_thumb_hmac');
    expect(s).not.toContain('SUPABASE_SERVICE_ROLE_KEY}:email-thumb-v1');
  });

  test('every reject path falls back to the logo, never an error status', () => {
    // Email clients render whatever comes back — a 4xx shows a broken-image
    // icon in the user's welcome email. The 302→logo keeps it presentable.
    const fn = worker().split('async function handleEmailThumb')[1]?.split('async function')[0] || '';
    expect(fn).toContain('/clusters-logo-dark.png');
    expect(fn).toMatch(/status: 302/);
  });

  test('served bytes are cache-bounded and hidden from crawlers', () => {
    const fn = worker().split('async function handleEmailThumb')[1]?.split('async function')[0] || '';
    expect(fn).toContain("'x-robots-tag': 'noindex'");
    expect(fn).toContain('public, max-age=3600');
    // Deleted boards must not keep serving their thumbnail.
    expect(fn).toContain('row.deleted_at');
  });
});
