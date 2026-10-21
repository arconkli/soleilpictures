// scheduleRetired.test.mjs — nothing on production makes a schedule card.
//
//   node --test src/lib/scheduleRetired.test.mjs
//
// Schedule is retired (owner, 2026-10-18: "we NO LONGER have the schedule
// feature"; 2026-10-20: everything related to it stays off production).
// Existing cards keep rendering, so the code stays; what must never reach
// production is a way to make a new one. appHost.scheduleCreationAllowed() is
// that hold, and other sessions promote all of main, so this pins it shut and
// checks that every way to make a schedule card still asks it. Read from the
// source, not called: in node every hold reads as closed, and what matters is
// what the production bundle does.
//
// Removing the schedule code for good? Delete this test along with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..');

const RETIRED = 'Schedule is retired (owner, 2026-10-20): nothing related to it goes to production';

// What a file does outside the hold: the menu rows it wraps,
// `...(scheduleCreationAllowed() ? [ … ] : [])`, and the props it guards,
// `scheduleCreationAllowed() ? handler : null`, taken out, and whole-line
// comments dropped so prose that names a function doesn't count as a use.
function outsideTheHold(code) {
  return code
    .replace(/\.\.\.\(scheduleCreationAllowed\(\) \? \[[\s\S]*?\] : \[\]\)/g, '')
    .replace(/scheduleCreationAllowed\(\) \? \w+ : null/g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*\/|\*|\/\*)/.test(l))
    .join('\n');
}

// Every source file the production bundle can include: src/ without the tests
// and the dev-only local harness.
function appFiles(dir = src, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'local') appFiles(full, out);
    } else if (/\.(jsx?|mjs)$/.test(name) && !name.endsWith('.test.mjs')) {
      out.push(full);
    }
  }
  return out;
}

const files = appFiles().map((full) => ({
  rel: path.relative(src, full),
  code: readFileSync(full, 'utf8'),
}));

test('the schedule hold never opens on production', () => {
  const m = files.find((f) => f.rel === path.join('lib', 'appHost.js')).code
    .match(/export function scheduleCreationAllowed\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'appHost.js no longer defines scheduleCreationAllowed(), and every way to make a schedule card asks it');
  assert.equal(m[1].replace(/\s+/g, ' ').trim(), 'return import.meta.env.DEV || onPreviewHost();',
    `${RETIRED}. scheduleCreationAllowed() stays dev and preview only; it is not one of the holds the sidebar release flips.`);
});

test('every way to make a schedule card asks the hold first', () => {
  // The Add registry's row calls mutators.addSchedule. The right-click Add
  // submenu, the mobile "+" sheet and the empty-board tiles all resolve
  // through it, and the rail's + has its own Schedule row.
  const offers = files
    .filter((f) => /\baddSchedule\s*(\?\.)?\(|id: ?'schedule'/.test(outsideTheHold(f.code)))
    .map((f) => f.rel);
  assert.deepEqual(offers, [],
    `${RETIRED}. These offer or make a schedule card without asking scheduleCreationAllowed():\n  ${offers.join('\n  ')}`);

  // The second way in: a shoot day scaffolds a schedView:'day' card on its own
  // (productionDay.js), without mutators.addSchedule. Only App's
  // handleAddShootDay calls it, and the canvas gets that as onAddShootDay,
  // behind the hold.
  const importers = files
    .filter((f) => /from ['"][./]*(lib\/)?productionDay(\.js)?['"]/.test(f.code))
    .map((f) => f.rel);
  assert.deepEqual(importers, ['App.jsx'],
    `${RETIRED}. productionDay.js makes schedule cards, so only App.jsx's held handleAddShootDay may import it`);
  const app = outsideTheHold(files.find((f) => f.rel === 'App.jsx').code);
  assert.equal((app.match(/\bhandleAddShootDay\b/g) || []).length, 1,
    `${RETIRED}. App.jsx uses handleAddShootDay somewhere other than its definition and the held onAddShootDay prop`);
});
