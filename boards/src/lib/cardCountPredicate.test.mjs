// A card count that joins card_index to boards without filtering
// boards.deleted_at counts cards on soft-deleted clusters. That is what made
// /admin disagree with the cap (see migration 0339).
//
// Migrations are immutable history, so this only guards files numbered at or
// above the one that fixed it. Raising FIRST_GUARDED is never the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIRST_GUARDED = 338;
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

// Heuristic line-window lint: for every line naming card_index, look at the
// surrounding window. A window that also names boards and aggregates with
// count()/sum() but never says deleted_at is the defect. max()/min() are not
// flagged — "when did they last make something" is an activity question, and
// a card made in a since-deleted cluster still happened.
//
// Because the window is fixed-width it can catch an aggregate belonging to a
// neighbouring clause. A query that genuinely must span deleted clusters
// carries `card-count-lint: activity` in a comment beside it, which suppresses
// the hit and forces whoever writes it to say so out loud.
const SUPPRESS = /card-count-lint:\s*activity/i;

export function findUnfilteredCardCounts(sql, windowLines = 6) {
  const lines = sql.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (!/card_index/i.test(line)) return;
    const win = lines.slice(Math.max(0, i - windowLines), i + windowLines + 1).join('\n');
    if (!/\bboards\b/i.test(win)) return;
    if (!/\b(count|sum)\s*\(/i.test(win)) return;
    if (/deleted_at/i.test(win)) return;
    if (SUPPRESS.test(win)) return;
    hits.push({ line: i + 1, text: line.trim() });
  });
  return hits;
}

test('detector flags an unfiltered card count', () => {
  const bad = `
    select b.created_by as uid,
           count(*)::int as card_count
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  `;
  assert.equal(findUnfilteredCardCounts(bad).length, 1);
});

test('detector accepts a count that filters deleted_at', () => {
  const good = `
    select coalesce(sum(ci.weight), 0)::integer
      from public.card_index ci
      join public.boards b on b.id = ci.board_id
     where b.deleted_at is null
  `;
  assert.deepEqual(findUnfilteredCardCounts(good), []);
});

test('detector ignores non-aggregate uses of card_index', () => {
  const activity = `
    select b.created_by as uid,
           max(ci.updated_at) filter (where ci.card_id not like 'onb-%') as last_card_at
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  `;
  assert.deepEqual(findUnfilteredCardCounts(activity), []);
  assert.deepEqual(findUnfilteredCardCounts('insert into public.card_index (board_id) values ($1)'), []);
});

test('an explicit activity suppression silences the lint', () => {
  const spanning = `
    -- card-count-lint: activity — last_card_at must survive the cluster
    select b.created_by as uid,
           max(ci.updated_at) as last_card_at,
           count(*) as ignore_me
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  `;
  assert.deepEqual(findUnfilteredCardCounts(spanning), []);
  assert.equal(findUnfilteredCardCounts(spanning.replace(/-- card-count-lint.*\n/, '')).length, 1);
});

test('no guarded migration counts cards without filtering deleted clusters', () => {
  const offenders = [];
  for (const name of readdirSync(MIGRATIONS).sort()) {
    if (!name.endsWith('.sql')) continue;
    const num = Number(name.slice(0, 4));
    if (!Number.isFinite(num) || num < FIRST_GUARDED) continue;
    for (const hit of findUnfilteredCardCounts(readFileSync(join(MIGRATIONS, name), 'utf8'))) {
      offenders.push(`${name}:${hit.line}  ${hit.text}`);
    }
  }
  assert.deepEqual(offenders, [], `Card counts missing a boards.deleted_at filter:\n${offenders.join('\n')}`);
});
