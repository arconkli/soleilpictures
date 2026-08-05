// Scout — end-to-end pipeline exercise with NO messaging provider involved.
//
// Runs a synthetic burst straight through runBurst() against the real Supabase
// + R2, then asserts the things that actually matter and that are easy to get
// silently wrong:
//
//   · board_state decodes back to the cards we think we wrote
//   · card_index has a row per card (this is also the demo-cap enforcement path)
//   · images.referenced_in_board_ids contains the board  ← sweep safety
//   · no two cards overlap
//
// The image-refs check is the important one. If board_state never gets written,
// recompute_image_refs (0127) never fires, referenced_in_board_ids stays empty,
// and the R2 orphan sweep eventually deletes the user's photos. That failure is
// invisible for 30 days, which is exactly why it's asserted here.
//
// Usage:
//   node scout/src/dryrun.js +15555550123 "scene 4 diner, check power drops" a.jpg b.jpg

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import * as Y from 'yjs';
import { loadConfig } from './config.js';
import { makeUploader } from './media.js';
import { runBurst } from './pipeline.js';
import { b64ToBytes, readCards } from '../../boards/src/lib/yhelpers.js';
import { scoutRpc, scoutSelect } from '../../boards/src/lib/scoutDb.js';
import { normalizeHandle } from '../../boards/src/lib/scoutIdentity.js';

const [, , handleArg, textArg, ...files] = process.argv;

if (!handleArg) {
  console.error('usage: node scout/src/dryrun.js <handle> [text] [image files...]');
  process.exit(1);
}

const cfg = loadConfig();
const r2 = makeUploader(cfg);

function ok(label, cond, detail = '') {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
  return cond;
}

const attachments = [];
for (const f of files) {
  const bytes = new Uint8Array(await readFile(f));
  const name = basename(f);
  const ext = name.split('.').pop().toLowerCase();
  const mimeType = ({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', gif: 'image/gif',
  })[ext] || 'application/octet-stream';
  attachments.push({ bytes, mimeType, name });
}

console.log(`\nScout dry run — ${attachments.length} attachment(s), text: ${textArg ? JSON.stringify(textArg) : '(none)'}\n`);

const burst = {
  platform: 'imessage',
  threadKey: `dryrun:${handleArg}`,
  handle: handleArg,
  service: 'iMessage',
  texts: textArg ? [textArg] : [],
  attachments,
};

const out = await runBurst(cfg, r2, burst);

console.log('--- bot reply ---');
console.log(out.reply || '(silent)');
console.log('-----------------\n');

// ── Verification ─────────────────────────────────────────────────────────────
const ident = await scoutRpc(cfg, 'scout_resolve_identity', {
  p_platform: 'imessage',
  p_handle: normalizeHandle(handleArg),
  p_thread_key: burst.threadKey,
});
const row = Array.isArray(ident) ? ident[0] : ident;
if (!row?.user_id) {
  console.error('FAIL: no identity was created');
  process.exit(1);
}

const boards = await scoutSelect(cfg, 'boards',
  `workspace_id=not.is.null&created_by=eq.${row.user_id}&deleted_at=is.null&select=id,name,workspace_id&order=created_at.asc`);
const board = boards.find((b) => b.id === row.target_board_id) || boards[0];
ok('a board exists for the identity', !!board, board?.name);

const stateRows = await scoutSelect(cfg, 'board_state', `board_id=eq.${board.id}&select=doc`);
ok('board_state row exists', !!stateRows?.[0]?.doc);

const doc = new Y.Doc();
Y.applyUpdate(doc, b64ToBytes(stateRows[0].doc));
const cards = readCards(doc);
doc.destroy();
ok('board_state decodes to cards', cards.length > 0, `${cards.length} card(s)`);

const idxRows = await scoutSelect(cfg, 'card_index', `board_id=eq.${board.id}&select=card_id,kind`);
const indexable = cards.filter((c) => c.seed !== true);
ok('card_index mirrors every card', idxRows.length >= indexable.length,
   `${idxRows.length} index row(s) vs ${indexable.length} card(s)`);

const imageCards = cards.filter((c) => c.kind === 'image');
if (imageCards.length) {
  const imgs = await scoutSelect(cfg, 'images',
    `board_id=eq.${board.id}&select=storage_path,referenced_in_board_ids,width,height`);
  ok('an images row exists per image card', imgs.length >= imageCards.length,
     `${imgs.length} row(s)`);
  const allReferenced = imgs.every((i) => (i.referenced_in_board_ids || []).includes(board.id));
  ok('SWEEP SAFETY: every image references the board', allReferenced,
     allReferenced ? '' : 'orphan sweep would delete these');
  ok('image dimensions were probed', imgs.every((i) => i.width && i.height));
}

const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
let overlaps = 0;
const body = cards.filter((c) => !c.sectionHeader);
for (let i = 0; i < body.length; i++) {
  for (let j = i + 1; j < body.length; j++) if (rectsOverlap(body[i], body[j])) overlaps++;
}
ok('no cards overlap', overlaps === 0, overlaps ? `${overlaps} collision(s)` : '');

console.log(`\n${process.exitCode ? 'DRY RUN FAILED' : 'dry run passed'}\n`);
