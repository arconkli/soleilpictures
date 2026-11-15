// relativeTimeShort / relativeTimeCompact: English is what it always was; other
// languages come from Intl, so they are checked for shape, not for ICU's words.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { relativeTimeShort, relativeTimeCompact } from './relativeTime.js';
import { setUiLocale } from './uiLocale.js';

afterEach(() => setUiLocale('en'));

const NOW = new Date(2026, 5, 15, 14, 30).getTime();
const ago = (ms) => NOW - ms;
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function withNow(fn) {
  const real = Date.now;
  Date.now = () => NOW;
  try { return fn(); } finally { Date.now = real; }
}

test('relativeTimeShort in English', () => {
  withNow(() => {
    assert.equal(relativeTimeShort(ago(10 * 1000)), 'Just now');
    assert.equal(relativeTimeShort(NOW + 5000), 'Just now');
    assert.equal(relativeTimeShort(ago(5 * MIN)), '5m ago');
    assert.equal(relativeTimeShort(ago(3 * HOUR)), '3h ago');
    assert.equal(relativeTimeShort(ago(2 * DAY)), '2d ago');
    assert.equal(relativeTimeShort(ago(14 * DAY)), '2w ago');
    const same = new Date(2026, 4, 1).getTime();
    assert.equal(relativeTimeShort(same), new Date(same).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const other = new Date(2024, 4, 1).getTime();
    assert.equal(relativeTimeShort(other), new Date(other).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    assert.equal(relativeTimeShort(''), '');
    assert.equal(relativeTimeShort('nope'), '');
  });
});

test('relativeTimeCompact in English', () => {
  assert.equal(relativeTimeCompact(ago(10 * 1000), NOW), 'Just now');
  assert.equal(relativeTimeCompact(ago(40 * MIN), NOW), '40m');
  assert.equal(relativeTimeCompact(ago(2 * HOUR), NOW), '2h');
  assert.equal(relativeTimeCompact(ago(DAY), NOW), 'Yesterday');
  const a = new Date(NOW - 3 * DAY);
  assert.equal(relativeTimeCompact(+a, NOW), a.toLocaleDateString(undefined, { weekday: 'short' }));
  const same = new Date(2026, 4, 1).getTime();
  assert.equal(relativeTimeCompact(same, NOW), new Date(same).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  const other = new Date(2024, 4, 1).getTime();
  assert.equal(relativeTimeCompact(other, NOW), new Date(other).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
});

const ENGLISH = /\b(ago|Just now|Yesterday)\b/;

test('other languages: non-empty, carry the number, are not the English', () => {
  for (const locale of ['es', 'ja', 'ru']) {
    setUiLocale(locale);
    withNow(() => {
      for (const [n, ms] of [[5, 5 * MIN], [3, 3 * HOUR], [2, 2 * DAY], [2, 14 * DAY]]) {
        const out = relativeTimeShort(ago(ms));
        assert.ok(out.includes(String(n)), `${locale}: ${out}`);
        assert.ok(!ENGLISH.test(out), `${locale}: ${out}`);
      }
      const now = relativeTimeShort(ago(10 * 1000));
      assert.ok(now.length > 0 && !ENGLISH.test(now), `${locale}: ${now}`);
    });
    const m = relativeTimeCompact(ago(40 * MIN), NOW);
    assert.ok(m.includes('40'), `${locale}: ${m}`);
    assert.ok(relativeTimeCompact(ago(2 * HOUR), NOW).includes('2'));
    const y = relativeTimeCompact(ago(DAY), NOW);
    assert.ok(y.length > 0 && !ENGLISH.test(y), `${locale}: ${y}`);
    const j = relativeTimeCompact(ago(10 * 1000), NOW);
    assert.ok(j.length > 0 && !ENGLISH.test(j), `${locale}: ${j}`);
    assert.ok(relativeTimeCompact(ago(3 * DAY), NOW).length > 0);
    assert.ok(relativeTimeCompact(new Date(2024, 4, 1).getTime(), NOW).includes('2024'));
  }
});
