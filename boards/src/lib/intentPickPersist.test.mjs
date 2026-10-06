// intentPickPersist.test.mjs — the onboarding intent pick must reach the profile.
//
//   node --test src/lib/intentPickPersist.test.mjs
//
// For most new accounts the first board holds no words a use-case could be read
// from, so the tour's intent pick is the only use-case signal there is — and it
// used to live only in analytics_events. It is persisted under its OWN top-level
// settings key: merge_profile_settings merges top-level keys but replaces the
// `onboarding` object wholesale, and the tour persists `onboarding` in the same
// tick as the pick, so nesting it there would race and lose it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

test('the pick handler writes intent_pick as its own top-level settings key', () => {
  const start = app.indexOf("if (type === 'pick_intent')");
  assert.ok(start > 0, 'pick_intent handler found');
  const block = app.slice(start, app.indexOf("tourFireRef.current?.({ type: 'intent_picked'", start));
  assert.match(block, /updateOwnSettings\(\{ intent_pick: \{ intent, at: /, 'persists the pick');
  assert.doesNotMatch(block, /updateOwnSettings\(\{ onboarding:/, 'never inside onboarding (the tour replaces that key)');
  assert.match(block, /\.catch\(\(\) => \{\}\)/, 'a failed write never breaks the tour');
});
