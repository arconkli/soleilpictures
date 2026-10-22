import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WATCH_PCT_BUCKETS, createWatch, watchPlay, watchTick, watchPause, watchEnded, watchSummary,
} from './filmWatch.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a viewing has one first play however often it resumes, and sums up once', () => {
  const w = createWatch();
  assert.equal(watchPlay(w, 1000), true);
  assert.equal(watchPlay(w, 1500), false, 'already playing');
  watchTick(w, 4, 20);
  watchPause(w, 5000, 4);
  assert.equal(watchPlay(w, 9000), false, 'a resume is not a new play');
  watchTick(w, 9.5, 20);
  const out = watchSummary(w, 12000);
  assert.deepEqual(out, { played_s: 7, pct: 25, dur_s: 20 });
  assert.equal(watchSummary(w, 20000), null, 'summed up once');
  assert.equal(watchPlay(w, 21000), false);
});

test('a clip nobody played is no viewing, wherever its playhead was dragged', () => {
  const w = createWatch();
  watchTick(w, 18, 20);
  watchPause(w, 1000, 19);
  assert.equal(watchSummary(w, 2000), null);
  assert.equal(w.maxT, 0);
});

test('played to the end reads 100, and so does stopping within half a second of it', () => {
  const ended = createWatch();
  watchPlay(ended, 0);
  watchTick(ended, 9.8, 10.01);
  watchPause(ended, 10000, 9.8);
  watchEnded(ended, 10.01);
  assert.equal(watchSummary(ended, 10000).pct, 100);

  const nearly = createWatch();
  watchPlay(nearly, 0);
  watchTick(nearly, 29.6, 30);
  assert.equal(watchSummary(nearly, 30000).pct, 100);

  const most = createWatch();
  watchPlay(most, 0);
  watchTick(most, 28, 30);
  assert.equal(watchSummary(most, 28000).pct, 90);
});

test('the furthest point reached counts, not where the playhead was left', () => {
  const w = createWatch();
  watchPlay(w, 0);
  watchTick(w, 80, 100);
  watchTick(w, 10, 100);   // seeked back while playing
  watchPause(w, 1000, 12);
  assert.equal(watchSummary(w, 1000).pct, 75);
});

test('buckets, an unknown length, and a viewing still playing when it ends', () => {
  assert.deepEqual(WATCH_PCT_BUCKETS, [0, 10, 25, 50, 75, 90, 100]);
  const w = createWatch();
  watchPlay(w, 500);
  watchTick(w, 3, NaN);
  assert.deepEqual(watchSummary(w, 2500), { played_s: 2, pct: null, dur_s: null });
  const tiny = createWatch();
  watchPlay(tiny, 0);
  watchTick(tiny, 0.2, 60);
  assert.equal(watchSummary(tiny, 300).pct, 0);
  assert.doesNotThrow(() => { watchPlay(null, 1); watchTick(undefined, 1, 1); watchPause(null, 1, 1); watchEnded(null, 1); });
  assert.equal(watchSummary(null, 1), null);
});

test('the film player feeds it from the element\'s own events and logs each piece once', () => {
  const src = read('../components/film/FilmPlayer.jsx');
  assert.match(src, /if \(watchPlay\(watchRef\.current, performance\.now\(\)\)\) \{/);
  assert.match(src, /v\.addEventListener\('timeupdate', onTime\);/);
  assert.match(src, /v\.removeEventListener\('timeupdate', onTime\);/);
  assert.match(src, /window\.addEventListener\('pagehide', onHide\);/);
  // A failure is logged once per clip and reason a page load.
  assert.match(src, /if \(filmFailsLogged\.has\(key\)\) return;/);
  // Every failure the player shows says which it is: each object handed to
  // setFailure carries a reason beside its title.
  const calls = [];
  for (let i = src.indexOf('setFailure('); i >= 0; i = src.indexOf('setFailure(', i + 1)) {
    let depth = 0;
    let j = i + 'setFailure'.length;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    calls.push(src.slice(i + 'setFailure('.length, j));
  }
  const shown = calls.filter((a) => a !== 'null');
  assert.ok(shown.length >= 3, 'the decode, no-picture and stall failures');
  for (const args of shown) {
    const titles = (args.match(/title:/g) || []).length;
    const reasons = args.match(/reason: '(decode|no_picture|stalled)'/g) || [];
    assert.ok(titles > 0 && reasons.length === titles, `a failure without a reason: ${args.slice(0, 90)}`);
  }
});
