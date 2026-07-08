#!/usr/bin/env node
// One-time setup for the board generator: create a dedicated "showcase" user +
// workspace that owns all the seeded example boards (so they don't clutter a
// real account), and put it on the Creator tier so the demo card cap
// (enforce_demo_card_cap_trg) never truncates a board.
//
// Prints SEED_USER_ID / SEED_WORKSPACE_ID to paste into scripts/.env.
// Idempotent-ish: re-running reuses the same user if it already exists.
//
//   node scripts/setupShowcase.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const HERE = dirname(fileURLToPath(import.meta.url));
for (const line of existsSync(resolve(HERE, '.env')) ? readFileSync(resolve(HERE, '.env'), 'utf8').split('\n') : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.SEED_USER_EMAIL || 'showcase@soleilpictures.com';
const WS_NAME = process.env.SEED_WORKSPACE_NAME || 'Clusters Showcase';
if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in scripts/.env'); process.exit(1); }

const supa = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// 1) Create (or find) the showcase auth user.
let userId = null;
{
  const { data, error } = await supa.auth.admin.createUser({
    email: EMAIL, email_confirm: true, user_metadata: { full_name: WS_NAME },
  });
  if (error) {
    // Already exists → find it by paging the admin list.
    if (/already been registered|already exists/i.test(error.message)) {
      for (let page = 1; page <= 20 && !userId; page++) {
        const { data: list } = await supa.auth.admin.listUsers({ page, perPage: 200 });
        const u = (list?.users || []).find((x) => x.email === EMAIL);
        if (u) userId = u.id;
        if (!list?.users?.length) break;
      }
      if (!userId) throw new Error(`user ${EMAIL} exists but could not be found via listUsers`);
      console.log(`• reused existing user ${EMAIL}`);
    } else { throw error; }
  } else {
    userId = data.user.id;
    console.log(`• created user ${EMAIL}`);
  }
}

// 2) Put it on the 'paid' tier so the demo card cap (which only fires when the
//    board owner's tier = 'demo') never truncates a board.
{
  const { error } = await supa.from('profiles').update({ tier: 'paid' }).eq('user_id', userId);
  if (error) console.warn(`  (tier update warning: ${error.message})`);
  else console.log('• tier → paid (uncapped)');
}

// 3) Ensure a workspace it owns (creates workspace + owner membership + root board).
const { data: ws, error: wsErr } = await supa.rpc('get_or_create_personal_workspace', {
  p_user_id: userId, p_name: WS_NAME,
});
if (wsErr) throw wsErr;
const wsId = ws?.id || ws?.[0]?.id;
console.log(`• workspace "${WS_NAME}" ${wsId}`);

console.log('\nPaste into scripts/.env:');
console.log(`SEED_USER_ID=${userId}`);
console.log(`SEED_WORKSPACE_ID=${wsId}`);
