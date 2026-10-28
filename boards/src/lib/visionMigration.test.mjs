// visionMigration.test.mjs — 0593 stores what the vision model says about a
// picture, hands pictures to the describe job and holds its budget.
//
//   node --test src/lib/visionMigration.test.mjs
//
// What this guards:
//   * one prompt version: the claim and the finish re-describe a picture when
//     lib/vision.js's PROMPT_VERSION moves past theirs, so the numbers match;
//   * the 0311 habit: every `_` function closed to PUBLIC, anon and
//     authenticated and open to service_role, ai_budget_take signed-in only,
//     and the file proves it;
//   * who reads a description: finished ones only, of a picture the reader can
//     read, never the lease or the status; no client writes;
//   * the lease: claim skips locked rows, finish and release need the token;
//   * vision never applies anything: no write to card_index or entity_links;
//   * turning the AI switch off deletes the descriptions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';
import { PROMPT_VERSION } from './vision.js';

const sql = readFileSync(join(MIGRATIONS_DIR, '0593_image_vision.sql'), 'utf8');
const code = sql.replace(/--[^\n]*/g, '');
const fnBody = (name) => {
  const at = code.indexOf(`function public.${name}(`);
  assert.ok(at >= 0, `${name} is defined`);
  const open = code.indexOf('$$', at);
  return code.slice(open + 2, code.indexOf('$$', open + 2));
};

const INTERNAL = {
  _ai_budget_take: '(uuid, text, integer)',
  _image_describe_claim: '(integer, integer)',
  _image_describe_finish: '(uuid, uuid, text, text, text[], jsonb, text, integer, integer, text)',
  _image_describe_release: '(uuid, uuid)',
  _image_card_embed_due: '(integer)',
};

test('the claim and the finish describe at lib/vision.js\'s prompt version', () => {
  const versions = [...code.matchAll(/c_version constant integer := (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(versions, [PROMPT_VERSION, PROMPT_VERSION]);
});

test('every internal function is closed to clients, open to the Worker, and the file proves it', () => {
  for (const [name, args] of Object.entries(INTERNAL)) {
    assert.ok(code.includes(`revoke execute on function public.${name}${args} from public, anon, authenticated;`), name);
    assert.ok(code.includes(`grant execute on function public.${name}${args} to service_role;`), name);
    assert.ok(code.includes(`'public.${name}${args.replace(/, /g, ',')}'`), `${name} is in the proof block`);
    assert.match(fnBody(name), /\S/);
  }
  assert.ok(code.includes('revoke execute on function public._tg_workspaces_ai_off_cleanup() from public, anon, authenticated;'));
  assert.ok(code.includes('revoke execute on function public.ai_budget_take(uuid, text, integer) from public, anon;'));
  assert.ok(code.includes('grant execute on function public.ai_budget_take(uuid, text, integer) to authenticated, service_role;'));
  assert.match(code, /do \$proof\$[\s\S]*has_function_privilege[\s\S]*end \$proof\$;/);
});

test('every function runs with a fixed search_path, and the definer ones are the internal ones and the wrapper', () => {
  const defs = [...code.matchAll(/create or replace function public\.(\w+)\([\s\S]*?as \$\$/g)];
  assert.ok(defs.length >= 7);
  for (const [whole, name] of defs) {
    assert.match(whole, /set search_path = public/, name);
    assert.match(whole, /security definer/, name);
  }
});

test('a description is read only when done, through the picture\'s own access, and never written by a client', () => {
  assert.match(code, /create policy "image descriptions read" on public\.image_descriptions\s+for select to authenticated/);
  assert.match(code, /status = 'done'\s+and exists \(select 1 from public\.images i/);
  assert.ok(code.includes('revoke all on public.image_descriptions from public, anon, authenticated;'));
  assert.ok(code.includes('grant select (image_id, description, keywords, attrs, described_at) on public.image_descriptions to authenticated;'));
  assert.doesNotMatch(code, /grant (insert|update|delete|all)[^;]*image_descriptions[^;]*authenticated/);
  assert.ok(code.includes('revoke all on public.ai_usage from public, anon, authenticated;'));
});

test('a lease is claimed with skip locked and only its holder can finish or release', () => {
  assert.match(fnBody('_image_describe_claim'), /for update skip locked/);
  assert.match(fnBody('_image_describe_finish'), /d\.lease_token = p_token/);
  assert.match(fnBody('_image_describe_release'), /lease_token = p_token/);
  assert.match(fnBody('_image_describe_finish'), /ai_tagger_enabled is not false/, 'finish re-checks the switch');
});

test('the budget locks, checks the total before the owner, and pages once a day when the total runs out', () => {
  const body = fnBody('_ai_budget_take');
  assert.match(body, /pg_advisory_xact_lock/);
  assert.ok(body.indexOf('v_global_cap') < body.indexOf('v_mine + p_units'));
  assert.match(body, /ops_alert_raise\('ai_budget'/);
  assert.match(body, /interval '24 hours'/);
  assert.match(fnBody('ai_budget_take'), /can_write_workspace\(p_workspace\)/);
  assert.match(fnBody('ai_budget_take'), /_actor_active\(\)/);
});

test('vision writes only its own table: never card_index, entity_links or tags', () => {
  assert.doesNotMatch(code, /(insert into|update|delete from)\s+public\.(card_index|entity_links|tags)\b/);
  assert.doesNotMatch(code, /description[^;\n]*into public\.card_index/);
});

test('pictures in workspaces with AI off are never claimed, and switching it off deletes their descriptions', () => {
  const claim = fnBody('_image_describe_claim');
  assert.equal((claim.match(/ai_tagger_enabled is not false/g) || []).length, 2, 'both the queueing and the claim check it');
  assert.match(claim, /storage_path !~ '\/\(previews\|thumbs\)\/'/, 'previews and thumbs are not uploads');
  assert.match(fnBody('_image_card_embed_due'), /cw\.ai_tagger_enabled is not false/, 'the embed lane reads each card\'s own workspace');
  assert.match(fnBody('_image_describe_finish'), /cw\.ai_tagger_enabled is not false/, 'so do the cards a finish hands back');
  const off = fnBody('_tg_workspaces_ai_off_cleanup');
  assert.match(off, /delete from public\.image_descriptions where workspace_id = new\.id/);
  assert.match(off, /delete from public\.card_embeddings/);
  assert.match(code, /after update of ai_tagger_enabled on public\.workspaces/);
});

// ── 0594: pictures suggest the tags they show ──────────────────────────────
import { SUGGEST_DIST } from './clusterMath.js';

const sql94 = readFileSync(join(MIGRATIONS_DIR, '0594_vision_suggestions.sql'), 'utf8').replace(/--[^\n]*/g, '');
const body94 = (name) => {
  const at = sql94.indexOf(`function public.${name}(`);
  assert.ok(at >= 0, `${name} is defined in 0594`);
  const open = sql94.indexOf('$$', at);
  return sql94.slice(open + 2, sql94.indexOf('$$', open + 2));
};

test('0594 suggests only: tag_suggestions, never entity_links, three a card, tombstones kept', () => {
  const b = body94('_suggest_tags_for_card');
  assert.doesNotMatch(b, /insert into public\.entity_links/);
  assert.match(b, /insert into public\.tag_suggestions/);
  assert.match(b, /on conflict \(tag_id, source_kind, source_id\) do nothing/);
  assert.match(b, /limit 3/);
  assert.match(b, /not exists \(select 1 from public\.autotag_ignored/);
  assert.match(b, /el\.link_kind = 'applied' and el\.target_kind = 'tag'/);
  assert.match(b, /ai_tagger_enabled is not false/);
  assert.match(b, /_tag_is_spreadable\(t\.slug, t\.status\)/);
  assert.equal(Number(b.match(/c_band constant double precision := ([\d.]+)/)[1]), SUGGEST_DIST, 'the band is the client\'s');
});

test('0594 matches whole words on both sides, so "golden hour" and plurals match and "carpet" does not', () => {
  const b = body94('_suggest_tags_for_card');
  assert.match(b, /regexp_replace\(lower\(coalesce\(d\.description, ''\) \|\| ' ' \|\| array_to_string\(d\.keywords, ' '\)\), '\[\^a-z0-9\]\+', '-', 'g'\)/);
  assert.match(b, /'-' \|\| regexp_replace\(lower\(t\.slug\), '\[\^a-z0-9\]\+', '-', 'g'\) \|\| '\(s\|es\)\?-'/);
  // The same rule in JS, to read what it means.
  const words = (s) => `-${s.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-`;
  const hit = (text, slug) => new RegExp(`-${slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}(s|es)?-`).test(words(text));
  assert.ok(hit('Two cars at golden hour', 'car'));
  assert.ok(hit('Two cars at golden hour', 'golden hour'));
  assert.ok(hit('Two cars at golden hour', 'golden-hour'));
  assert.ok(!hit('A carpet of leaves', 'car'));
  assert.ok(!hit('A carpet of leaves', 'pet'));
});

test('0594 closes its function to clients, and switching AI off also clears open vision suggestions', () => {
  assert.ok(sql94.includes('revoke execute on function public._suggest_tags_for_card(uuid, text) from public, anon, authenticated;'));
  assert.ok(sql94.includes('grant execute on function public._suggest_tags_for_card(uuid, text) to service_role;'));
  assert.match(sql94, /do \$proof\$[\s\S]*_suggest_tags_for_card\(uuid,text\)[\s\S]*end \$proof\$;/);
  const off = body94('_tg_workspaces_ai_off_cleanup');
  assert.match(off, /delete from public\.image_descriptions where workspace_id = new\.id/, '0593\'s deletes stay');
  assert.match(off, /delete from public\.card_embeddings/);
  assert.match(off, /delete from public\.tag_suggestions\s+where workspace_id = new\.id and origin in \('vision', 'vision-embed'\) and dismissed_at is null/);
  assert.match(sql94, /check \(origin in \('embed', 'vision', 'vision-embed'\)\)/);
});

// ── 0595: search finds a picture by what is in it ──────────────────────────
import { entitySearchFilter } from './entitySearchFilter.js';

const sql95 = readFileSync(join(MIGRATIONS_DIR, '0595_search_sees_pictures.sql'), 'utf8').replace(/--[^\n]*/g, '');

test('0595 restates every branch of entity_search, adds seen last, and stays security invoker', () => {
  assert.match(sql95, /create or replace view public\.entity_search with \(security_invoker = on\) as/);
  assert.equal((sql95.match(/UNION ALL/g) || []).length, 4, 'boards, cards, groups, people, tags');
  assert.equal((sql95.match(/NULL::text AS seen/g) || []).length, 4);
  assert.match(sql95, /\) AS seen\s+FROM card_index ci\s+WHERE NOT EXISTS/);
  for (const branch of ['FROM boards b', 'FROM card_index ci', 'FROM group_index gi', 'FROM workspace_user_directory()', 'FROM tags t']) {
    assert.ok(sql95.includes(branch), branch);
  }
});

test('0595 reads only what a signed-in reader may select from image_descriptions', () => {
  const lookup = sql95.slice(sql95.indexOf('(SELECT CASE WHEN d.description'), sql95.indexOf(') AS seen'));
  assert.match(lookup, /FROM images i JOIN image_descriptions d ON d\.image_id = i\.id/);
  assert.doesNotMatch(sql95, /d\.(status|lease_token|lease_until|tokens_in|tokens_out|error_code)/, 'a security-invoker view may not touch an ungranted column');
  assert.match(lookup, /i\.storage_path = substr\(ci\.meta ->> 'src', 4\) AND i\.deleted_at IS NULL/);
});

test('the search filter looks in seen', () => {
  assert.match(entitySearchFilter('red car'), /,seen\.ilike\.%red car%$/);
});

// ── 0596: what a described picture shows, read by the people who can see it ─
const sql96 = readFileSync(join(MIGRATIONS_DIR, '0596_picture_reads.sql'), 'utf8').replace(/--[^\n]*/g, '');

test('0596 reads run as the reader, never as their definer, and are closed to anon', () => {
  for (const [name, args] of [['image_seen_for_board', '(uuid)'], ['similar_pictures', '(uuid, text, integer)']]) {
    const head = sql96.slice(sql96.indexOf(`function public.${name}(`), sql96.indexOf('as $$', sql96.indexOf(`function public.${name}(`)));
    assert.match(head, /security invoker/, name);
    assert.doesNotMatch(head, /security definer/, name);
    assert.match(head, /set search_path = public/, name);
    assert.ok(sql96.includes(`revoke execute on function public.${name}${args} from public, anon;`), name);
    assert.ok(sql96.includes(`grant execute on function public.${name}${args} to authenticated, service_role;`), name);
  }
  assert.match(sql96, /prosecdef\) then\s+raise exception '0596: a picture read runs as its definer/);
});

test('0596 hands out only finished descriptions and never likens a picture to itself', () => {
  assert.match(sql96, /and d\.description is not null/);
  assert.doesNotMatch(sql96, /d\.(status|lease_token|tokens_in)/, 'only the columns a reader may select');
  assert.match(sql96, /\(ci\.meta->>'src'\) is distinct from me\.src/);
  assert.match(sql96, /limit least\(greatest\(coalesce\(p_limit, 12\), 1\), 48\)/);
});
