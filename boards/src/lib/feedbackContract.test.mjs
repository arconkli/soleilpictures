// feedbackContract — the guard that was missing.
//
// public.feedback.kind is a contract with three independent signatories:
//
//   1. the CHECK constraint on the table, which decides what may be stored
//   2. supabase/functions/send-feedback/index.ts, a service-role writer that
//      lives OUTSIDE boards/ and validates against its own hardcoded Set
//   3. submit_return_reason(), a definer function that stamps the kind itself
//
// Nothing ever compared them. 0282 shipped a function inserting
// kind='return_reason' against a constraint that has only ever permitted
// bug|idea|praise|other, so every single call raised 23514 and every answer
// the product ever received was destroyed before it reached the table.
//
// The feature was not untested. return-reason-ask.spec.js asserted, at length,
// that 0282's TEXT says 'return_reason' — it read one side of the contract and
// called that coverage. A test that reads one side of a contract is not a
// contract test.
//
// It also lived in tests/ as a Playwright spec, so `npm test` — the gate
// CLAUDE.md actually names before a commit — never ran it. This file is under
// src/lib/ deliberately.
//
// THE EXTRACTORS ALL HARD-FAIL ON ZERO MATCHES. An extractor that silently
// matches nothing agrees with everything, which is the precise failure mode
// being fixed here: a green assertion over an empty set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', '..');
const migrationsDir = path.join(repo, 'supabase', 'migrations');

const read = (p) => readFileSync(p, 'utf8');

// Migrations in applied order. Numeric prefix, not lexicographic on the whole
// name — 0080 must sort before 0310 and both before any later repair.
function migrationsInOrder() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ f, n: Number.parseInt(f.slice(0, 4), 10) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => (a.n - b.n) || a.f.localeCompare(b.f));
  assert.ok(files.length > 0, 'found no numbered migrations — the extractor is looking in the wrong place');
  return files.map((x) => ({ name: x.f, sql: read(path.join(migrationsDir, x.f)) }));
}

// Every quoted literal inside a (kind in (...)) / (kind = any (array[...]))
// list. Deliberately shape-tolerant: the constraint is written one way in the
// create-table form and another in an add-constraint form.
function kindsFromCheckBody(body) {
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

// The body of `create table … public.feedback ( … )`, or null. Brace-balanced
// on parens so a nested `check (…)` cannot end the block early.
function feedbackCreateBlock(sql) {
  const m = sql.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.feedback\s*\(/i);
  if (!m) return null;
  let depth = 0;
  const from = m.index + m[0].length - 1;
  for (let i = from; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(from + 1, i);
    }
  }
  return null;
}

// LAST WRITER WINS. Before 0310 exactly one migration defined this constraint,
// so a naive first-match grep got the right answer by accident. The moment a
// second definition exists, first-match silently reads the superseded one.
function effectiveAllowedKinds() {
  let found = null;
  for (const { name, sql } of migrationsInOrder()) {
    // add constraint feedback_kind_check check (kind in (...))
    for (const m of sql.matchAll(/add\s+constraint\s+feedback_kind_check\s+check\s*\(([\s\S]*?)\)\s*;/gi)) {
      found = { name, kinds: kindsFromCheckBody(m[1]) };
    }
    // create table … public.feedback ( … kind text not null check (kind in (...)) … )
    //
    // SCOPED TO THE FEEDBACK BLOCK. An unscoped search for a `kind` column with
    // a CHECK matches three other tables in this directory — cards (0001) and
    // seo_health_expectations (0180) — and because this resolves last-writer-
    // wins, the unscoped version silently reported the SEO table's kinds as
    // feedback's. It still failed, but it named the wrong file.
    const block = feedbackCreateBlock(sql);
    if (block) {
      for (const m of block.matchAll(/kind\s+text\s+not\s+null\s+check\s*\(\s*kind\s+in\s*\(([^)]*)\)/gi)) {
        found = { name, kinds: kindsFromCheckBody(m[1]) };
      }
    }
  }
  assert.ok(found, 'no definition of feedback.kind’s CHECK found in any migration');
  assert.ok(found.kinds.length > 0, `extracted an EMPTY kind list from ${found.name} — the regex matched but captured nothing`);
  return found;
}

// Kinds stamped by a definer function, e.g.
//   insert into public.feedback (user_id, kind, message) values (v_uid, 'return_reason', …)
function kindsInsertedByMigrations() {
  const out = new Map();
  for (const { name, sql } of migrationsInOrder()) {
    for (const m of sql.matchAll(/insert\s+into\s+public\.feedback\s*\(([^)]*)\)\s*values\s*\(([\s\S]*?)\)\s*(?:on\s+conflict|;|returning)/gi)) {
      const cols = m[1].split(',').map((s) => s.trim().toLowerCase());
      const idx = cols.indexOf('kind');
      if (idx === -1) continue;
      const vals = m[2].split(',').map((s) => s.trim());
      const lit = vals[idx] && vals[idx].match(/^'([a-z_]+)'$/);
      if (lit) out.set(lit[1], name);
    }
  }
  return out;
}

// The other writer, and the one most likely to be forgotten: it is a Deno
// edge function outside boards/, so nothing in this package references it.
function kindsAcceptedBySendFeedback() {
  const src = read(path.join(repo, 'supabase', 'functions', 'send-feedback', 'index.ts'));
  const m = src.match(/const\s+KINDS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'could not find the KINDS Set in send-feedback/index.ts');
  const kinds = [...m[1].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]);
  assert.ok(kinds.length > 0, 'send-feedback KINDS extracted as EMPTY');
  return kinds;
}

// The closed list the RPC validates p_choice against.
function choicesInMigrations() {
  let found = null;
  for (const { name, sql } of migrationsInOrder()) {
    for (const m of sql.matchAll(/v_choice\s+not\s+in\s*\(([^)]*)\)/gi)) {
      const ids = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
      if (ids.length) found = { name, ids };
    }
  }
  assert.ok(found, 'no closed choice list found in any migration');
  return found;
}

// The client half of that same list.
function choicesInClient() {
  const src = read(path.join(here, '..', 'components', 'ReturnReasonAsk.jsx'));
  const start = src.indexOf('const CHOICES');
  assert.ok(start > -1, 'ReturnReasonAsk.jsx no longer declares CHOICES');
  const end = src.indexOf('];', start);
  assert.ok(end > start, 'could not find the end of the CHOICES literal');
  const ids = [...src.slice(start, end).matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'CHOICES extracted as EMPTY');
  // The null answer is deliberately NOT a row in CHOICES — as a peer it would
  // be the cheapest thing on screen to press — but the client can still send
  // it, so the server has to accept it and this comparison has to see it.
  const nothing = src.match(/const\s+NOTHING\s*=\s*'([a-z_]+)'/);
  assert.ok(nothing, 'ReturnReasonAsk.jsx no longer declares NOTHING');
  return [...ids, nothing[1]];
}

test('every kind any writer stores is permitted by the table', () => {
  const { name, kinds } = effectiveAllowedKinds();
  const allowed = new Set(kinds);

  for (const [kind, from] of kindsInsertedByMigrations()) {
    assert.ok(
      allowed.has(kind),
      `${from} inserts feedback.kind='${kind}', which ${name}'s CHECK forbids. `
      + `Every such write raises 23514 and is lost. Allowed: ${[...allowed].join(', ')}`,
    );
  }

  for (const kind of kindsAcceptedBySendFeedback()) {
    assert.ok(
      allowed.has(kind),
      `send-feedback accepts kind='${kind}', which ${name}'s CHECK forbids.`,
    );
  }
});

test('the admin Feedback tab can filter to every kind that exists', () => {
  const { kinds } = effectiveAllowedKinds();
  const tab = read(path.join(here, '..', 'pages', 'admin', 'AdminFeedbackTab.jsx'));
  const m = tab.match(/const\s+KINDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'AdminFeedbackTab.jsx no longer declares KINDS');
  const listed = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.ok(listed.length > 0, 'admin KINDS extracted as EMPTY');
  for (const k of kinds) {
    assert.ok(listed.includes(k), `feedback rows can hold kind='${k}' but the admin filter cannot ask for them`);
  }

  // The pill picks its colour from its own allowlist and prints the raw kind,
  // so an unlisted kind renders silently in the styling reserved for 'other'.
  const pills = read(path.join(here, '..', 'pages', 'admin', 'AdminPills.jsx'));
  const p = pills.match(/const\s+k\s*=\s*\[([^\]]*)\]\.includes\(kind\)/);
  assert.ok(p, 'FeedbackKindPill no longer guards its class list the expected way');
  const styled = [...p[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  for (const k of kinds) {
    assert.ok(styled.includes(k), `FeedbackKindPill has no colour for kind='${k}' — it would wear 'other' styling`);
  }
});

test('the closed choice list is identical in the client and the RPC', () => {
  const { name, ids } = choicesInMigrations();
  const client = choicesInClient();
  assert.deepEqual(
    [...client].sort(),
    [...ids].sort(),
    `ReturnReasonAsk.jsx CHOICES and ${name}'s closed list disagree. `
    + 'A choice the client can send and the server rejects raises 22023 and is lost.',
  );
});
