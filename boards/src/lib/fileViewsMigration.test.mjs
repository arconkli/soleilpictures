// Text pins on supabase/migrations/0661_file_views.sql: that the MCP can
// apply it, that no client can call its functions, and that its view names
// are lib/fileView.js's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewKeys, isViewKey } from './fileView.js';

const sql = readFileSync(new URL('../../../supabase/migrations/0661_file_views.sql', import.meta.url), 'utf8');
// Comments first: an apostrophe in one would open a string.
const statements = sql.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
const FUNCTIONS = [
  '_file_view_request(text,text,uuid,boolean)',
  '_file_view_claim(integer)',
  '_file_view_heartbeat(text,integer)',
  '_file_view_finish(text,text,jsonb)',
  '_file_view_due()',
];

test('0661 has no DROP and no DELETE FROM statement (the MCP refuses them)', () => {
  assert.doesNotMatch(statements, /\bdrop\s/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i, 'not even in a comment or a string');
});

test('every function is definer, pinned to no search path, and the service role\'s alone', () => {
  const made = [...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi)].map((m) => m[1]);
  assert.deepEqual(made.sort(), FUNCTIONS.map((f) => f.split('(')[0]).sort());
  for (const f of FUNCTIONS) {
    const name = f.split('(')[0];
    const at = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i'));
    const header = sql.slice(at, sql.indexOf('$function$', at));
    assert.match(header, /security definer/, `${name} is definer`);
    assert.match(header, /set search_path to ''/, `${name} pins search_path`);
    const spaced = f.replace(/,/g, ',\\s*').replace(/[()]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke execute on function public\\.${spaced} from public, anon, authenticated;`), `${name} revoked`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${spaced} to service_role;`), `${name} granted`);
    assert.ok(sql.includes(`'public.${f}'`), `${name} is in the proof block`);
  }
  const grants = [...statements.matchAll(/\bgrant\s+([^;]+);/gi)].map((m) => m[1]);
  assert.deepEqual(grants.filter((g) => /\bto\s+(anon|authenticated|public)\b/i.test(g)),
    ['select on table public.file_views to authenticated'], 'members may only read the record');
});

test('the view names derived in SQL are lib/fileView.js\'s', () => {
  // _file_view_finish derives the keys it records.
  assert.ok(sql.includes(String.raw`regexp_replace(p_storage_path, '^(.*/)?([^/]+)$', '\1previews/\2')`));
  assert.ok(sql.includes(`v_view := v_base || '.view.webp';`));
  assert.ok(sql.includes(`v_sm := v_base || '.view_sm.webp';`));
  const ws = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
  assert.deepEqual(viewKeys(`${ws}/scan.final.tif`), {
    view: `${ws}/previews/scan.final.tif.view.webp`,
    sm: `${ws}/previews/scan.final.tif.view_sm.webp`,
  });
  // …and nothing under previews/ is ever an original, in either place.
  assert.ok(sql.includes(`if p_storage_path like '%/previews/%' then return 'not_view'; end if;`));
  assert.ok(isViewKey(`${ws}/previews/x.heic.view.webp`) && isViewKey(`${ws}/previews/x.heic.VIEW_SM.WEBP`));
});

test('views are retention-locked, a browser\'s preview is never replaced, and a job gets three tries', () => {
  assert.equal((sql.match(/retention_locked_until\)\s*\n\s*values \([^)]*timestamptz '2999-01-01'\)/g) || []).length, 2);
  assert.match(sql, /where i\.storage_path = p_storage_path and i\.preview_path is null;/);
  assert.match(sql, /if v_state is null and v_img\.preview_path is not null then return 'has_preview'; end if;/);
  // A view re-queued because its object went missing is not a browser's preview.
  assert.match(sql, /and i\.preview_path not like '%\.view\.webp';/);
  assert.match(sql, /f\.attempts < 3/);
  assert.match(sql, /greatest\(60, least\(coalesce\(p_lease_seconds, 900\), 3600\)\)/);
  assert.match(sql, /for update skip locked/);
});
