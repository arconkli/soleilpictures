// Text pins on supabase/migrations/0660_media_copies.sql: that the MCP can
// apply it, that no client can call its functions, and that its copy names
// are lib/playCopy.js's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyKeys, isCopyKey } from './playCopy.js';

const sql = readFileSync(new URL('../../../supabase/migrations/0660_media_copies.sql', import.meta.url), 'utf8');
// Comments first: an apostrophe in one ("the copies' rows") would open a string.
const statements = sql.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
const FUNCTIONS = [
  '_media_copy_request(text,text,uuid,boolean)',
  '_media_copy_claim(integer)',
  '_media_copy_heartbeat(text,integer)',
  '_media_copy_finish(text,text,jsonb)',
  '_media_copy_due()',
];

test('0660 has no DROP and no DELETE FROM statement (the MCP refuses them)', () => {
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
    ['select on table public.media_copies to authenticated'], 'members may only read the record');
});

test('the copy names derived in SQL are lib/playCopy.js\'s', () => {
  // _media_copy_finish derives the keys it records; checked against Postgres's
  // regexp_replace for these keys when 0660 was written.
  assert.ok(sql.includes(String.raw`regexp_replace(p_storage_path, '^(.*/)?([^/]*?)(\.[A-Za-z0-9]{1,8})?$', '\1previews/\2')`));
  assert.ok(sql.includes(`when v_job.kind = 'audio' then '.play.m4a' else '.play.mp4' end`));
  assert.ok(sql.includes(`v_base || '.poster.webp'`));
  const ws = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
  assert.deepEqual(copyKeys(`${ws}/clip.final.mov`), {
    video: `${ws}/previews/clip.final.play.mp4`,
    audio: `${ws}/previews/clip.final.play.m4a`,
    poster: `${ws}/previews/clip.final.poster.webp`,
  });
  assert.equal(copyKeys(`${ws}/noext`).video, `${ws}/previews/noext.play.mp4`);
  assert.equal(copyKeys(`${ws}/a.waytoolongext`).video, `${ws}/previews/a.waytoolongext.play.mp4`);
  // …and a copy is never itself an original, in either place.
  assert.ok(sql.includes(String.raw`p_storage_path ~* '/previews/[^/]+\.(play\.(mp4|m4a)|poster\.webp)$'`));
  assert.ok(isCopyKey(`${ws}/previews/x.play.mp4`) && isCopyKey(`${ws}/previews/x.POSTER.WEBP`));
  assert.ok(!isCopyKey(`${ws}/previews/x.webp`), 'an image preview is not a copy');
});

test('copies are retention-locked, and a job gets three tries and a bounded lease', () => {
  assert.equal((sql.match(/retention_locked_until\)\s*\n\s*values \([^)]*timestamptz '2999-01-01'\)/g) || []).length, 2);
  assert.match(sql, /m\.attempts < 3/);
  assert.match(sql, /greatest\(60, least\(coalesce\(p_lease_seconds, 900\), 3600\)\)/);
  assert.match(sql, /for update skip locked/);
});
