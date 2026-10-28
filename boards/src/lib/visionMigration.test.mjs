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
