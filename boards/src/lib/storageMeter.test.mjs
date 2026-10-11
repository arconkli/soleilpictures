// The Settings storage meter: neutral fill at rest, and a failed usage fetch
// says so with a Retry instead of drawing "0 B / —" as if it were real
// (MEDIA-17). React-bound, so this pins the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tab = readFileSync(join(here, '..', 'components', 'settings', 'BillingTab.jsx'), 'utf8');
const hook = readFileSync(join(here, '..', 'hooks', 'useStorageUsage.js'), 'utf8');
const meter = tab.slice(tab.indexOf('export function StorageMeter'));

test('the resting fill is neutral ink, never gold', () => {
  assert.doesNotMatch(meter.slice(0, meter.indexOf('\n}\n')), /--soleil/);
  assert.match(meter, /background: near \? '#ef4444' : 'var\(--ink-2\)'/);
});

test('a failed fetch is an error state with Retry', () => {
  assert.match(hook, /setError\(true\)/);
  assert.match(hook, /return \{ \.\.\.data, loading, error, refetch: fetchUsage \}/);
  assert.match(meter, /if \(usage\.error && !usage\.loading\)/);
  assert.match(meter, /Couldn’t load storage/);
  assert.match(meter, /onClick=\{\(\) => usage\.refetch\(\)\}/);
});
