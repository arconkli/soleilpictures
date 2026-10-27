// profileWrites.test.mjs — what the client writes to profiles is what a person
// is allowed to write there.
//
// Since 0091 profiles is fail-closed: authenticated may INSERT and UPDATE only
// the columns re-granted there. saveOwnProfile was an upsert, and PostgREST's
// upsert names user_id in its ON CONFLICT … DO UPDATE SET, a column a person may
// insert but never update, so every Profile save (name, colour, picture) was
// refused with a 403 from 2026-05-28 until 2026-10-26.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname;
const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url).pathname;

// The columns authenticated holds INSERT and UPDATE on, replaying every
// migration's grants and revokes on public.profiles in order.
function profileGrants() {
  const grants = { insert: new Set(), update: new Set() };
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const raw of sql.split(';')) {
      const s = raw.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!/ on (table )?public\.profiles (to|from) /.test(s) || !/\bauthenticated\b/.test(s)) continue;
      const grant = s.startsWith('grant ');
      if (!grant && !s.startsWith('revoke ')) continue;
      const privs = s.slice(0, s.indexOf(' on '));
      for (const kind of ['insert', 'update']) {
        const cols = privs.match(new RegExp(`\\b${kind}\\s*\\(([^)]*)\\)`));
        const whole = new RegExp(`\\b${kind}\\b(?!\\s*\\()`).test(privs) || /\ball\b/.test(privs);
        if (cols) {
          for (const c of cols[1].split(',').map((x) => x.trim())) {
            if (grant) grants[kind].add(c); else grants[kind].delete(c);
          }
        } else if (whole && !grant) {
          grants[kind].clear();
        }
      }
    }
  }
  return grants;
}

function clientSources(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'local' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) clientSources(p, out);
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name) && !/^worker/.test(e.name)) out.push(p);
  }
  return out;
}

test('the grants replay to what 0091 left a person able to write', () => {
  const { insert, update } = profileGrants();
  for (const c of ['display_name', 'color', 'avatar_url', 'notification_prefs']) {
    assert.ok(update.has(c), `UPDATE (${c})`);
    assert.ok(insert.has(c), `INSERT (${c})`);
  }
  assert.ok(insert.has('user_id'), 'INSERT (user_id)');
  assert.ok(!update.has('user_id'), 'user_id is never updatable');
});

test('nothing in the client upserts into profiles', () => {
  const hits = [];
  for (const file of clientSources()) {
    const s = readFileSync(file, 'utf8');
    for (const m of s.matchAll(/from\(\s*'profiles'\s*\)/g)) {
      // The rest of the builder chain: up to its statement's end.
      const chain = s.slice(m.index, m.index + 400).split(';')[0];
      if (/\.upsert\(/.test(chain)) hits.push(file.slice(SRC.length));
    }
  }
  assert.deepEqual(hits, [], 'an upsert SETs user_id, which a person may not update: update, then insert');
});

test('saveOwnProfile writes only columns a person may update and insert', () => {
  const api = readFileSync(join(SRC, 'lib/boardsApi.js'), 'utf8');
  const start = api.indexOf('export async function saveOwnProfile(');
  assert.ok(start >= 0);
  const body = api.slice(start, api.indexOf('\n}\n', start));
  const cols = [...body.matchAll(/\bfields\.([a-z_]+)\s*=/g)].map((m) => m[1]);
  assert.deepEqual(cols.sort(), ['avatar_url', 'color', 'display_name']);
  const { insert, update } = profileGrants();
  for (const c of cols) {
    assert.ok(update.has(c), `UPDATE (${c}) is granted`);
    assert.ok(insert.has(c), `INSERT (${c}) is granted`);
  }
  assert.match(body, /\.update\(fields\)/);
  assert.match(body, /\.insert\(\{ user_id: userId, \.\.\.fields \}\)/);
});
