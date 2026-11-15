// 0891: covering indexes for the admin reads of analytics_events. The file is
// applied one statement at a time outside a transaction, so its shape is the
// safety: every build and drop CONCURRENTLY, each replacement in place before
// the index it replaces goes. Text only, no Postgres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';

const FILE = '0891_admin_read_indexes.sql';
const text = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
// Comments are not statements; whitespace is not wiring.
const code = text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const statements = code.split(';').map(s => s.trim()).filter(Boolean);

// New index -> its exact definition, and the old index it replaces (if any).
const INDEXES = [
  {
    name: 'analytics_events_user_time_cover',
    def: '(user_id, occurred_at desc) include (event, session_id) where user_id is not null',
    replaces: 'events_user_time',
  },
  {
    name: 'analytics_events_occurred_cover',
    def: '(occurred_at desc) include (user_id, session_id)',
    replaces: 'analytics_events_occurred_at_idx',
  },
  {
    name: 'analytics_events_session_time_user',
    def: '(session_id, occurred_at) include (user_id)',
    replaces: 'events_session',
  },
  {
    name: 'analytics_events_card_placed_user_time',
    def: "(user_id, occurred_at) where event = 'card_placed'",
    replaces: null,
  },
];

const createOf = (name) => `create index concurrently if not exists ${name} on public.analytics_events`;
const dropOf = (name) => `drop index concurrently if exists public.${name}`;

test('the file fits apply_migration and has no transaction block', () => {
  assert.ok(text.length < 5000, `${FILE} is ${text.length} characters; the limit is 5,000`);
  assert.doesNotMatch(code, /\b(begin|commit|start transaction)\b/i,
    'CONCURRENTLY cannot run inside a transaction');
});

test('the header says how the release run applies it', () => {
  assert.match(text, /ONE STATEMENT AT A TIME with execute_sql/);
  assert.match(text, /creates before drops/);
  assert.match(text, /INVALID index/);
});

test('every index is built and dropped CONCURRENTLY, and nothing else', () => {
  const creates = statements.filter(s => /^create\b/i.test(s));
  const drops = statements.filter(s => /^drop\b/i.test(s));
  assert.equal(creates.length, 4);
  assert.equal(drops.length, 3);
  for (const s of creates) assert.ok(s.startsWith('create index concurrently if not exists '), s);
  for (const s of drops) assert.match(s, /^drop index concurrently if exists public\.[a-z_]+$/, s);
  const others = statements.filter(s => !/^(create|drop)\b/i.test(s));
  assert.deepEqual(others, [
    'alter table public.analytics_events set (autovacuum_vacuum_insert_scale_factor = 0.02)',
  ]);
});

test('each new index has exactly the keys, include columns and predicate', () => {
  for (const ix of INDEXES) {
    assert.ok(statements.includes(`${createOf(ix.name)} ${ix.def}`),
      `${ix.name} should be ${ix.def}`);
  }
});

test('a replacement keeps the old index\'s predicate and adds none', () => {
  // events_user_time was partial on user_id; the other two had no predicate,
  // and a stricter replacement would stop serving some of their queries.
  const partial = INDEXES.filter(ix => / where /.test(ix.def)).map(ix => ix.name);
  assert.deepEqual(partial, ['analytics_events_user_time_cover', 'analytics_events_card_placed_user_time']);
});

test('each old index is dropped only after its replacement, and after every create', () => {
  const lastCreate = Math.max(...INDEXES.map(ix => code.indexOf(createOf(ix.name))));
  for (const ix of INDEXES.filter(i => i.replaces)) {
    const c = code.indexOf(createOf(ix.name));
    const d = code.indexOf(dropOf(ix.replaces));
    assert.ok(c > -1, `${ix.name} is created`);
    assert.ok(d > -1, `${ix.replaces} is dropped`);
    assert.ok(c < d, `${ix.name} is created before ${ix.replaces} is dropped`);
    assert.ok(lastCreate < d, `${ix.replaces} is dropped after every create`);
  }
});

test('only the three replaced indexes are dropped', () => {
  const dropped = statements.filter(s => /^drop\b/i.test(s)).map(s => s.split('public.')[1]).sort();
  assert.deepEqual(dropped, INDEXES.map(ix => ix.replaces).filter(Boolean).sort());
});

test('inserts trigger a vacuum sooner, so the scans stay index-only', () => {
  assert.match(code, /alter table public\.analytics_events set \(autovacuum_vacuum_insert_scale_factor = 0\.02\)/);
  const lastDrop = code.lastIndexOf('drop index');
  assert.ok(code.indexOf('alter table') > lastDrop);
});
