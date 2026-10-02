// creatorIntent.test.mjs — the "Get Creator" click survives sign-in, and nothing
// else does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  stashCreatorIntent, readCreatorIntent, clearCreatorIntent,
  CREATOR_INTENT_KEY, CREATOR_INTENT_MAX_AGE_MS,
} from './creatorIntent.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    raw: m,
  };
}

test('a stashed intent reads back with its plan and age', () => {
  const s = memoryStorage();
  assert.equal(stashCreatorIntent({ plan: 'annual', now: 1_000 }, s), true);
  const got = readCreatorIntent({ now: 61_000 }, s);
  assert.deepEqual(got, { plan: 'annual', from: 'public_pricing', ageMs: 60_000 });
});

test('an unknown plan is stored as monthly, the page default', () => {
  const s = memoryStorage();
  stashCreatorIntent({ plan: 'lifetime', now: 0 }, s);
  assert.equal(readCreatorIntent({ now: 1 }, s).plan, 'monthly');
});

test('an expired intent is gone, and removed on read', () => {
  const s = memoryStorage();
  stashCreatorIntent({ plan: 'monthly', now: 0 }, s);
  assert.equal(readCreatorIntent({ now: CREATOR_INTENT_MAX_AGE_MS + 1 }, s), null);
  assert.equal(s.raw.has(CREATOR_INTENT_KEY), false, 'an expired entry must not linger');
});

test('garbage, a missing timestamp and a future timestamp all read as nothing', () => {
  for (const raw of ['not json', '{"plan":"monthly"}', '{"plan":"monthly","at":null}', '{"plan":"x","at":1}']) {
    const s = memoryStorage();
    s.setItem(CREATOR_INTENT_KEY, raw);
    assert.equal(readCreatorIntent({ now: 10 }, s), null, raw);
    assert.equal(s.raw.has(CREATOR_INTENT_KEY), false, `malformed ${raw} must be cleared`);
  }
  const s = memoryStorage();
  stashCreatorIntent({ plan: 'monthly', now: 1_000 }, s);
  assert.equal(readCreatorIntent({ now: 10 }, s), null, 'a clock that went backwards is not a fresh intent');
});

test('storage that throws never breaks the page', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(stashCreatorIntent({ plan: 'monthly' }, broken), false);
  assert.equal(readCreatorIntent({}, broken), null);
  assert.doesNotThrow(() => clearCreatorIntent(broken));
});

test('clear removes it', () => {
  const s = memoryStorage();
  stashCreatorIntent({ plan: 'monthly', now: 0 }, s);
  clearCreatorIntent(s);
  assert.equal(readCreatorIntent({ now: 1 }, s), null);
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('the public Get Creator button writes the intent BEFORE it navigates away', () => {
  const page = read('auth/PublicPricingPage.jsx');
  const stash = page.indexOf('stashCreatorIntent(');
  const nav = page.indexOf("window.location.assign('/')");
  assert.ok(stash > 0, 'PublicPricingPage no longer stashes the Creator intent');
  assert.ok(nav > 0 && stash < nav, 'the intent must be written before the page leaves');
});

test('the app claims the slot before it opens the resumed offer', () => {
  const hook = read('hooks/useCreatorIntentResume.js');
  const claim = hook.indexOf("claimUpsellSlot('pricing-intent')");
  const open = hook.indexOf('resumeRef.current(intent.plan)');
  assert.ok(claim > 0 && open > 0 && claim < open,
    'an offer opened without claiming the slot is the 16 ms cap-wall bug: ambient surfaces have nothing to defer to');
  const slot = read('lib/upsellSlot.js');
  assert.match(slot, /'pricing-intent'/, "upsellSlot must know the 'pricing-intent' kind or every claim fails closed");
  const app = read('App.jsx');
  assert.match(app, /useCreatorIntentResume\(/, 'App no longer resumes a stashed Creator intent');
});
