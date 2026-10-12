// The video-poster and audio-peaks backfills keep their work when the cards
// array changes mid-download (PERF-05). The hooks need React to run, so this
// pins the shape that makes it true: the job is cancelled by a scope that only
// the board/workspace/user/role deps bump, never by the `cards` effect's
// cleanup, and results go through refs that see the latest cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

for (const name of ['useVideoPosterBackfill.js', 'useAudioPeaksBackfill.js']) {
  test(`${name}: an edit mid-download does not discard the job`, () => {
    const src = readFileSync(join(here, '..', 'hooks', name), 'utf8');
    // The effect that depends on `cards` returns no cleanup at all.
    const effects = src.split('useEffect(').slice(1);
    const cardsEffect = effects.find(e => /\}, \[cards,/.test(e));
    assert.ok(cardsEffect, 'there is an effect keyed on cards');
    const body = cardsEffect.slice(0, cardsEffect.search(/\}, \[cards,/));
    assert.doesNotMatch(body, /return \(\) =>/, 'a cards change must not cancel the running job');
    assert.match(body, /runningRef\.current/, 'one pass at a time instead of a cancelled restart');
    // The scope effect is keyed on everything except cards.
    const scopeEffect = effects.find(e => /scopeRef\.current \+= 1/.test(e));
    assert.ok(scopeEffect && !/\[[^\]]*\bcards\b[^\]]*\]/.test(scopeEffect.slice(0, 200)), 'scope ignores cards');
    assert.match(src, /updateRef\.current\?\.\(/, 'writes go through the latest mutator');
    assert.match(src, /cardsRef\.current/, 'a deleted card is not written back');
    // A job from a board we already left still holds runningRef when the new
    // board's effect runs; its drain must re-run that effect.
    assert.match(src, /if \(cancelled\(\)\) setDrained\(/, 'a cancelled job re-triggers the pass when it drains');
    assert.match(src, /\}, \[cards,[^\]]*\bdrained\]/, 'the pass re-runs on drain');
  });
}
