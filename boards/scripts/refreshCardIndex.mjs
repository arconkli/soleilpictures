#!/usr/bin/env node
// Re-derive card_index rows for already-seeded boards from their existing
// board_state snapshot — no image downloads, no layout changes. Use after a
// buildCardMeta/buildCardIndexRows change so published boards pick up new
// meta (pos, sectionHeader, resolved [#] tags) without a full rebuild.
//
//   node scripts/refreshCardIndex.mjs <slug> [<slug>...]

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSupabase } from './lib/supa.mjs';
import { decodeBoardSnapshot, buildCardIndexRows } from './lib/cardEncode.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(HERE, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const need = (n) => { const v = process.env[n]; if (!v) throw new Error(`Missing env ${n}`); return v; };
const supa = makeSupabase({ url: need('SUPABASE_URL'), serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY') });
const workspaceId = need('SEED_WORKSPACE_ID');

async function refreshBoard(boardId, label) {
  const { data: st, error } = await supa.from('board_state').select('doc').eq('board_id', boardId).single();
  if (error) throw new Error(`board_state ${label}: ${error.message}`);
  const cards = decodeBoardSnapshot(st.doc);
  const rows = buildCardIndexRows({ workspaceId, boardId, cards });
  const { error: e2 } = await supa.from('card_index').upsert(rows, { onConflict: 'board_id,card_id' });
  if (e2) throw new Error(`card_index ${label}: ${e2.message}`);
  console.log(`  ✓ ${label}: ${rows.length} rows refreshed`);
}

for (const slug of process.argv.slice(2)) {
  const { data: pb, error } = await supa.from('public_boards').select('board_id').eq('slug', slug).single();
  if (error || !pb) { console.warn(`✗ no public board for slug "${slug}"`); continue; }
  console.log(`▶ ${slug}`);
  await refreshBoard(pb.board_id, slug);
  // Children (nested boards) share the same encoding — refresh them too.
  const { data: kids } = await supa.from('boards').select('id, name').eq('parent_board_id', pb.board_id);
  for (const k of (kids || [])) await refreshBoard(k.id, `${slug} › ${k.name}`);
}
