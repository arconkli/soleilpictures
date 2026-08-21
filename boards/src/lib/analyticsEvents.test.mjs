// analyticsEvents.test.mjs — the catalog cannot rot.
//
//   node --test src/lib/analyticsEvents.test.mjs
//
// EV is described as "the single source of truth", but nothing enforced it, and
// two kinds of drift had already set in:
//
//   1. Entries declared and never emitted. A name in the catalog reads as a
//      measured thing. Querying for one that no code fires returns zero rows,
//      which is indistinguishable from "nobody does this" — the most expensive
//      possible failure mode for a product decision.
//
//   2. Call sites emitting a raw literal whose constant already exists. The
//      constant then looks unused, so the next person deletes or renames it and
//      the literal silently keeps firing the old name.
//
// Both are cheap to detect and expensive to discover from data, so they are a
// failing test rather than a convention.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EV } from './analyticsEvents.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

// Events written by SQL, not by the client. Each names the migration that
// fires it, so this list can be checked rather than trusted.
const SERVER_EMITTED = new Map([
  ['SUBSCRIPTION_STARTED',   'stripe webhook handler'],
  ['BILLING_FLAG',           'stripe-webhook onChargeTrouble + billing-reconcile-cron'],
  ['REFERRAL_SIGNUP',        '0163_referrals.sql'],
  ['REFERRAL_ACTIVATED',     '0163_referrals.sql'],
  ['REFERRAL_REWARD_GRANTED','0163_referrals.sql'],
  ['INVITE_LINK_CLAIMED',    '0189_collab_invite_links.sql / 0199'],
]);

// Comments are documentation, not wiring. This file's own header shows a
// `logEvent('pricing_view', …)` example, and several modules document the
// events they emit — counting those as emission sites would report violations
// that don't exist and, worse, mark a genuinely dead entry as alive.
//
// Deliberately LINE-BASED, not a real comment parser. A `/*…*/` regex is
// actively dangerous here: `accept="image/*"` in the photo picker opens a match
// that runs to the next `*/` hundreds of lines later, blanking real emission
// sites and reporting live events as dead. Line prefixes cannot do that.
//
// Lines are blanked rather than deleted so reported line numbers still match
// the file. A trailing `//` is left alone so a URL inside a string can't
// truncate code, and a single-line `/* … */` is not handled — both mean an
// occasional missed detection rather than a false accusation, which is the
// safe direction for a test that gates every commit.
function stripComments(text) {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trimStart();
      return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : line;
    })
    .join('\n');
}

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      sourceFiles(p, out);
    } else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\.mjs$/.test(name)
               && !p.endsWith(join('lib', 'analyticsEvents.js'))) {
      out.push(p);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC).map((p) => {
  const raw = readFileSync(p, 'utf8');
  return { path: p, rel: relative(SRC, p), raw, text: stripComments(raw) };
});

test('the source tree is actually being scanned', () => {
  // A silently empty scan would make both checks below vacuously pass, which is
  // the classic way an enforcement test stops enforcing anything.
  assert.ok(FILES.length > 100, `expected to scan the app, found ${FILES.length} files`);
  assert.ok(FILES.some((f) => f.text.includes('EV.')), 'no EV usage found anywhere — the scan is broken');
});

test('every catalog entry has an emission site', () => {
  const used = new Set();
  for (const f of FILES) {
    for (const m of f.text.matchAll(/\bEV\.([A-Z0-9_]+)\b/g)) used.add(m[1]);
  }

  const dead = Object.keys(EV).filter((k) => !used.has(k) && !SERVER_EMITTED.has(k));
  assert.deepEqual(dead, [],
    `these EV entries are declared but never emitted, so querying them returns zero rows and reads as "nobody does this":\n` +
    dead.map((k) => `  EV.${k} = '${EV[k]}'`).join('\n') +
    `\n\nWire each one up, delete it, or add it to SERVER_EMITTED with the migration that fires it.`);
});

test('SERVER_EMITTED lists only entries the client really does not emit', () => {
  const used = new Set();
  for (const f of FILES) {
    for (const m of f.text.matchAll(/\bEV\.([A-Z0-9_]+)\b/g)) used.add(m[1]);
  }
  const wrong = [...SERVER_EMITTED.keys()].filter((k) => used.has(k));
  assert.deepEqual(wrong, [],
    `these are in SERVER_EMITTED but the client emits them too — the allowlist is hiding a real check:\n` +
    wrong.map((k) => `  EV.${k}`).join('\n'));

  const unknown = [...SERVER_EMITTED.keys()].filter((k) => !(k in EV));
  assert.deepEqual(unknown, [], 'SERVER_EMITTED names an entry that is not in EV');
});

test('no emission site uses a raw literal that already has a constant', () => {
  const byValue = new Map(Object.entries(EV).map(([k, v]) => [v, k]));

  // logEvent('x', …) / logEventNow('x', …) / logEventOnce(dedupKey, 'x', …).
  // logEventOnce takes the dedup key FIRST, so its event name is the second
  // argument — treating it like the others would report false violations.
  const PATTERNS = [
    /\blogEvent(?:Now)?\(\s*(['"])([a-z0-9_]+)\1/g,
    /\blogEventOnce\(\s*[^,]+,\s*(['"])([a-z0-9_]+)\1/g,
  ];

  const offenders = [];
  for (const f of FILES) {
    for (const re of PATTERNS) {
      for (const m of f.text.matchAll(re)) {
        const name = m[2];
        if (!byValue.has(name)) continue;   // an event with no constant is a separate concern
        const line = f.text.slice(0, m.index).split('\n').length;
        offenders.push(`  ${f.rel}:${line} emits '${name}' — use EV.${byValue.get(name)}`);
      }
    }
  }

  assert.deepEqual(offenders, [],
    `these call sites emit a raw literal whose constant already exists, which makes the constant look unused ` +
    `and lets a later rename silently keep firing the old name:\n${offenders.join('\n')}`);
});
