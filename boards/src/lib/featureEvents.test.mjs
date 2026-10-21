// featureEvents.test.mjs — no feature reaches production recording nothing.
//
//   node --test src/lib/featureEvents.test.mjs
//
// The holds are read from appHost.js's source, not by calling featureFlags():
// in node every hold reads as closed, and what matters here is which ones
// production opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EV } from './analyticsEvents.js';
import { FEATURE_EVENTS } from './featureEvents.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..');
const appHost = readFileSync(path.join(here, 'appHost.js'), 'utf8');

// featureFlags()'s holds, { key, fn }.
const holds = (() => {
  const block = appHost.match(/export function featureFlags\(\) \{\s*const holds = \{([\s\S]*?)\};/);
  assert.ok(block, 'featureFlags() still lists its holds in one object');
  return [...block[1].matchAll(/^\s*(\w+):\s*(\w+),?\s*$/gm)].map((m) => ({ key: m[1], fn: m[2] }));
})();

// A hold is open in production when its function is nothing but `return true;`.
function isOpen(fn) {
  const m = appHost.match(new RegExp(`export function ${fn}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `appHost.js defines ${fn}`);
  return m[1].replace(/\s+/g, ' ').trim() === 'return true;';
}

// Every EV key something in src emits, by reference.
const emitted = (() => {
  const keys = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx|mjs)$/.test(name) || /\.test\.mjs$/.test(name)) continue;
      if (name === 'analyticsEvents.js' || name === 'featureEvents.js') continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/\bEV\.([A-Z0-9_]+)\b/g)) keys.add(m[1]);
    }
  };
  walk(src);
  return keys;
})();
const keyOf = new Map(Object.entries(EV).map(([k, v]) => [v, k]));
const ROLES = ['exposure', 'action', 'outcome', 'failure'];

test('the holds are found, and every one has an entry', () => {
  assert.ok(holds.length >= 10, `found ${holds.length} holds; the parse is reading the wrong thing`);
  for (const { key } of holds) {
    assert.ok(FEATURE_EVENTS[key], `${key} is held in featureFlags() but has no entry in featureEvents.js`);
  }
});

test('a feature open in production says who saw it and what came of it', () => {
  const holdFn = new Map(holds.map((h) => [h.key, h.fn]));
  for (const [feature, entry] of Object.entries(FEATURE_EVENTS)) {
    const fn = holdFn.get(feature);
    const open = !fn || isOpen(fn);
    if (entry.unmeasured) {
      assert.ok(!open, `${feature} is open in production but records nothing: ${entry.unmeasured}`);
      continue;
    }
    assert.ok(entry.exposure?.length > 0, `${feature} has no exposure event`);
    assert.ok(entry.outcome?.length > 0, `${feature} has no outcome event`);
  }
  // The feature this file exists because of.
  assert.ok(FEATURE_EVENTS.messages?.outcome?.includes(EV.MSG_SEND));
});

test('every listed event is in EV, and something in src emits it', () => {
  for (const [feature, entry] of Object.entries(FEATURE_EVENTS)) {
    for (const role of ROLES) {
      for (const name of entry[role] || []) {
        const key = keyOf.get(name);
        assert.ok(key, `${feature}.${role} lists ${String(name)}, which is not in EV`);
        assert.ok(emitted.has(key), `${feature}.${role} lists EV.${key}, which nothing in src emits`);
      }
    }
  }
});

test('entries are shaped one way or the other', () => {
  for (const [feature, entry] of Object.entries(FEATURE_EVENTS)) {
    if ('unmeasured' in entry) {
      assert.deepEqual(Object.keys(entry), ['unmeasured'], `${feature}: unmeasured stands alone`);
      assert.ok(typeof entry.unmeasured === 'string' && entry.unmeasured.length > 20, `${feature}: say why`);
      continue;
    }
    assert.deepEqual(Object.keys(entry), ROLES, `${feature}: exposure, action, outcome, failure, in that order`);
    for (const role of ROLES) assert.ok(Array.isArray(entry[role]), `${feature}.${role} is a list`);
  }
});

test('the open check reads a hold the way production does', () => {
  // fileShares and the 10-22 holds opened by becoming `return true;`; templateStore and scheduleCreation still ask the host.
  assert.equal(isOpen('fileSharesAllowed'), true);
  assert.equal(isOpen('sidebarFilesAllowed'), true);
  assert.equal(isOpen('templateStoreAllowed'), false);
  assert.equal(isOpen('scheduleCreationAllowed'), false);
});
