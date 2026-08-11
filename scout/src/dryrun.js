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
// Yjs comes from the shared helpers, NOT from a bare 'yjs' specifier: this file
// hands the docs it builds to readCards(), and a second Yjs copy would fail that
// module's internal constructor checks. See the note in yhelpers.js.
import { loadConfig } from './config.js';
import { makeUploader } from './media.js';
import { runBurst } from './pipeline.js';
import { Y, b64ToBytes, bytesToB64, readCards } from '../../boards/src/lib/yhelpers.js';
import { scoutRpc, scoutSelect, scoutInsert } from '../../boards/src/lib/scoutDb.js';
import { normalizeHandle } from '../../boards/src/lib/scoutIdentity.js';

// Flags are stripped from the positional list. Without this, `--file` fell
// through into `files` and was opened as an image (ENOENT) — so the filing
// phase, which is the half that moves cards between boards, could never
// actually be run.
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const [handleArg, textArg, ...files] = argv.filter((a) => !a.startsWith('--'));

if (!handleArg) {
  console.error('usage: node scout/src/dryrun.js <handle> [text] [files...] [--file] [--voice]');
  console.error('  files   photos, .mov/.mp4, .m4a/.mp3, .pdf, anything');
  console.error('  --file  also exercise filing: move the run onto a real board');
  console.error('  --voice treat audio files as voice memos, so they get transcribed');
  process.exit(1);
}

const cfg = loadConfig();
const r2 = makeUploader(cfg);

function ok(label, cond, detail = '') {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
  return cond;
}

// Every type Scout accepts, not just photos. A .mov, a .m4a and a .pdf are all
// ordinary inputs now, and the assertions below are the only place their
// storage and sweep-safety get checked without a phone.
//
// A file named like a voice memo — or passed with --voice — is marked as one,
// because `voice` is a distinct provider content type and is the only thing
// that gets transcribed. A .m4a sent as a file is a music track; a .m4a sent as
// a voice message is somebody talking.
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', gif: 'image/gif',
  mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v',
  m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', caf: 'audio/x-caf',
  pdf: 'application/pdf', zip: 'application/zip',
};

const attachments = [];
for (const f of files) {
  const bytes = new Uint8Array(await readFile(f));
  const name = basename(f);
  const ext = name.split('.').pop().toLowerCase();
  attachments.push({
    bytes,
    mimeType: MIME[ext] || 'application/octet-stream',
    name,
    voice: flags.has('--voice') && /^(m4a|caf|wav|mp3)$/.test(ext),
  });
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
const board = boards.find((b) => b.id === (row.target_board_id || row.bin_board_id)) || boards[0];
ok('a board exists for the identity', !!board, board?.name);
ok('the Bin is pinned by id, not found by name', !!row.bin_board_id);

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

// Would the R2 orphan sweep reclaim this row? Mirrors the predicate in
// migration 0068 §58 EXACTLY rather than approximating it:
//
//   unreferenced AND (retention_locked_until IS NULL OR it has passed)
//
// The distinction is load-bearing. A card in the Y.Doc points at the ORIGINAL
// key, so the board_state trigger only ever back-references originals — the
// derived preview/-sm variants are unreferenced by design and are protected
// instead by retention_locked_until (0105, 0131), which the sweep honours.
// Asserting "everything references the board" therefore fails on a corpus that
// is completely safe, and a false alarm on the one check that guards against
// silently deleting someone's photos is worse than no check: it teaches you to
// ignore it.
const sweepWouldReclaim = (i) => {
  const refs = (i.referenced_in_board_ids || []).length;
  if (refs > 0) return false;
  const lock = i.retention_locked_until ? Date.parse(i.retention_locked_until) : null;
  return !(lock && lock > Date.now());
};

// A burst that reached the pipeline must always produce words. Silence was a
// real defect — any attachment that was not an image fell through every branch
// and returned nothing at all — and it is invisible in every other assertion
// here, because the cards check passes just fine when the reply is empty.
ok('the bot said something', typeof out.reply === 'string' && out.reply.length > 0,
   out.reply ? '' : 'SILENT — a burst must never produce no reply');

// Every kind that arrived should have become its own kind of card, and each
// one's bytes must be reachable. `pdfSrc`/`fileSrc` are different fields from
// `src`, and a card pointing at the wrong one renders nothing.
const SRC_FIELD = { image: 'src', video: 'src', audio: 'src', pdf: 'pdfSrc', file: 'fileSrc' };
for (const kind of ['video', 'audio', 'pdf', 'file']) {
  const got = cards.filter((c) => c.kind === kind);
  if (!got.length) continue;
  ok(`${kind} cards point at their bytes`,
     got.every((c) => String(c[SRC_FIELD[kind]] || '').startsWith('r2:')),
     `${got.length} card(s)`);
}
const audioCards = cards.filter((c) => c.kind === 'audio');
if (audioCards.length && flags.has('--voice')) {
  // Not a hard failure: transcription needs CF credentials and a model that may
  // be busy, and the design is that a missing transcript costs the transcript
  // and never the card. Reported so a silent regression is still visible.
  const withText = audioCards.filter((c) => c.body);
  console.log(`  ${withText.length ? 'PASS' : 'note'}  voice notes transcribed`
    + `  ${withText.length}/${audioCards.length}`
    + (withText.length ? `  "${String(withText[0].body).slice(0, 60)}…"` : '  (no CF_AI_TOKEN?)'));
}

const imageCards = cards.filter((c) => c.kind === 'image');
if (imageCards.length) {
  const imgs = await scoutSelect(cfg, 'images',
    `board_id=eq.${board.id}`
    + '&select=storage_path,referenced_in_board_ids,retention_locked_until,width,height');
  ok('an images row exists per image card', imgs.length >= imageCards.length,
     `${imgs.length} row(s)`);

  // The originals specifically MUST be reachable from the board — that is what
  // the board_state trigger exists to guarantee, and a preview alone is not the
  // user's photo.
  const originals = imgs.filter((i) => !/\/previews\//.test(i.storage_path || ''));
  ok('every ORIGINAL is referenced by the board',
     originals.length > 0 && originals.every((i) => (i.referenced_in_board_ids || []).includes(board.id)),
     `${originals.length} original(s)`);

  const doomed = imgs.filter(sweepWouldReclaim);
  ok('SWEEP SAFETY: nothing here is sweep-eligible', doomed.length === 0,
     doomed.length ? `${doomed.length} row(s) the sweep would delete: ${doomed.map((i) => i.storage_path).join(', ')}`
                   : `${originals.length} referenced, ${imgs.length - originals.length} retention-locked`);
  // Scoped to the keys IMAGE CARDS actually point at. The `images` table is the
  // universal object registry — a video, an audio file and a PDF all get rows
  // there so /sign-reads will authorize them — and those rows legitimately carry
  // no dimensions. Asserting over the whole table was right when Scout only
  // handled photos and became a false alarm the moment it did not.
  const photoKeys = new Set(imageCards.map((c) => String(c.src || '').replace(/^r2:/, '')));
  const photoRows = imgs.filter((i) => photoKeys.has(i.storage_path));
  ok('image dimensions were probed', photoRows.length > 0 && photoRows.every((i) => i.width && i.height),
     `${photoRows.length} photo row(s)`);

  // The orientation regression, against real bytes: a portrait frame is stored
  // landscape with an EXIF tag, and sharp's metadata() reports the UNROTATED
  // size — so the stored dimensions must match the card, and both must be
  // portrait. Checked by comparing the two rather than trusting either.
  for (const c of imageCards) {
    const row = imgs.find((i) => i.storage_path === String(c.src || '').replace(/^r2:/, ''));
    if (!row?.width || !row?.height) continue;
    const rowPortrait = row.height > row.width;
    const cardPortrait = c.h > c.w;
    ok(`orientation agrees for ${row.storage_path.slice(-12)}`, rowPortrait === cardPortrait,
       `stored ${row.width}x${row.height}, card ${c.w}x${c.h}`);
  }

  // A portrait frame must have a portrait card. sharp's metadata() reports the
  // UNROTATED size after .rotate(), so this is where that regression shows up
  // against real camera files rather than a synthetic fixture.
  const portrait = imageCards.filter((c) => c.h > c.w);
  console.log(`  note  ${portrait.length}/${imageCards.length} card(s) are portrait`
    + ' — check this matches the photos you sent');
}

// Sweep safety for EVERY kind, not just photos. recompute_image_refs scans the
// decoded doc for `r2:` keys regardless of which field holds them, so a video
// src and a pdfSrc are covered by the same trigger — but that is a claim worth
// checking rather than believing, because being wrong deletes somebody's file
// thirty days later with no warning.
const mediaCards = cards.filter((c) => ['video', 'audio', 'pdf', 'file'].includes(c.kind));
if (mediaCards.length) {
  const rows = await scoutSelect(cfg, 'images',
    `board_id=eq.${board.id}&select=storage_path,referenced_in_board_ids,retention_locked_until`);
  const keys = new Set(mediaCards.map((c) => String(c[SRC_FIELD[c.kind]] || '').replace(/^r2:/, '')));
  const theirs = rows.filter((r) => keys.has(r.storage_path));
  ok('an images row exists for every non-photo card', theirs.length >= keys.size,
     `${theirs.length}/${keys.size}`);
  ok('SWEEP SAFETY: every non-photo file is referenced by the board',
     theirs.length > 0 && theirs.every((r) => (r.referenced_in_board_ids || []).includes(board.id)),
     `${theirs.length} row(s)`);
}

const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
let overlaps = 0;
const body = cards.filter((c) => !c.sectionHeader);
for (let i = 0; i < body.length; i++) {
  for (let j = i + 1; j < body.length; j++) if (rectsOverlap(body[i], body[j])) overlaps++;
}
ok('no cards overlap', overlaps === 0, overlaps ? `${overlaps} collision(s)` : '');

// ── Filing ───────────────────────────────────────────────────────────────────
//
// The move path, exercised end to end: propose → confirm → verify. The check
// that matters most is the LAST one. A move rewrites two board_state rows, and
// recompute_image_refs (0127) fires per board — so a move that writes the source
// but not the destination leaves photos referenced by nothing, and the R2 orphan
// sweep silently deletes them 30 days later. Same failure class as the original
// triple-write bug, one layer up.
if (flags.has('--file') && imageCards.length) {
  const destName = `Dry Run Destination ${new Date().toISOString().slice(0, 10)}`;
  console.log(`\n--- filing into "${destName}" ---`);

  // The destination has to EXIST first. Scout deliberately does not invent a
  // board from a name it doesn't recognise — it says so and keeps collecting in
  // the Bin — so a dry run that never creates one was only ever testing the
  // "board not found" reply, which is why the move path went unexercised.
  const destId = crypto.randomUUID();
  await scoutInsert(cfg, 'boards', [{
    id: destId,
    workspace_id: board.workspace_id,
    parent_board_id: null,
    name: destName,
    view: 'canvas',
    created_by: row.user_id,
  }], { returning: 'minimal' });
  const seed = new Y.Doc();
  await scoutInsert(cfg, 'board_state', [{
    board_id: destId,
    doc: bytesToB64(Y.encodeStateAsUpdate(seed)),
    updated_at: new Date().toISOString(),
  }], { onConflict: 'board_id', returning: 'minimal' });
  seed.destroy();

  const before = await scoutSelect(cfg, 'card_index',
    `board_id=eq.${board.id}&select=card_id`);

  const propose = await runBurst(cfg, r2, {
    ...burst, texts: [`put these in ${destName}`], attachments: [],
  });
  console.log(propose.reply || '(silent)');
  ok('a move was proposed rather than performed', !!propose.proposed);
  ok('the proposal carried a contact sheet', !!propose.attachment,
     propose.attachment ? `${Math.round(propose.attachment.length / 1024)}KB` : 'no image');

  const confirm = await runBurst(cfg, r2, { ...burst, texts: ['yes'], attachments: [] });
  console.log(confirm.reply || '(silent)');
  ok('cards moved on confirmation', (confirm.moved || 0) > 0, `${confirm.moved} card(s)`);
  ok('the result carried a moodboard preview', !!confirm.attachment);

  const dest = (await scoutSelect(cfg, 'boards',
    `workspace_id=eq.${board.workspace_id}&name=eq.${encodeURIComponent(destName)}`
    + '&deleted_at=is.null&select=id&limit=1'))?.[0];

  if (ok('the destination board exists', !!dest)) {
    const after = await scoutSelect(cfg, 'card_index', `board_id=eq.${board.id}&select=card_id`);
    const landed = await scoutSelect(cfg, 'card_index', `board_id=eq.${dest.id}&select=card_id`);
    ok('card_index rows LEFT the Bin', after.length < before.length,
       `${before.length} → ${after.length}`);
    ok('card_index rows ARRIVED on the destination', landed.length >= (confirm.moved || 0),
       `${landed.length} row(s)`);

    // The move is where this is most likely to go wrong: it rewrites TWO boards'
    // docs, and a card that left the source before it landed on the destination
    // is briefly referenced by neither. Checked against the sweep's real
    // predicate, same as above.
    const movedImgs = await scoutSelect(cfg, 'images',
      `board_id=eq.${board.id}&select=storage_path,referenced_in_board_ids,retention_locked_until`);
    const doomedAfter = movedImgs.filter(sweepWouldReclaim);
    ok('SWEEP SAFETY AFTER MOVE: nothing became sweep-eligible', doomedAfter.length === 0,
       doomedAfter.length ? `${doomedAfter.length} row(s) would be deleted in 30 days`
                          : `${movedImgs.length} row(s) still protected`);

    const destState = await scoutSelect(cfg, 'board_state', `board_id=eq.${dest.id}&select=doc`);
    if (destState?.[0]?.doc) {
      const d2 = new Y.Doc();
      Y.applyUpdate(d2, b64ToBytes(destState[0].doc));
      const destCards = readCards(d2).filter((c) => !c.sectionHeader);
      d2.destroy();
      let collisions = 0;
      for (let i = 0; i < destCards.length; i++) {
        for (let j = i + 1; j < destCards.length; j++) {
          if (rectsOverlap(destCards[i], destCards[j])) collisions++;
        }
      }
      ok('the moodboard has no overlapping cards', collisions === 0,
         collisions ? `${collisions} collision(s)` : `${destCards.length} card(s)`);
      ok('moved cards kept their colour data', destCards.some((c) => Array.isArray(c.lab)));
    }
  }
}

console.log(`\n${process.exitCode ? 'DRY RUN FAILED' : 'dry run passed'}\n`);
