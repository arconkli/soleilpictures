// "Save a copy" of a file shared with you: the party route's pure core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  saveRefusal, copyPlan, copyKey, savedCardId, savedCard, savedImageRow,
  SINGLE_COPY_MAX_BYTES, COPY_PART_BYTES, SAVED_CARD_DIMS, SAVE_REFUSAL_STATUS,
} from './fileShareSave.js';
import { FALLBACK_DIMS } from './fileIngest.js';

const ok = (file, extra = {}) => ({
  status: 'ok', access: 'view', allow_download: true,
  file: { kind: 'video', name: 'Cut v3.mov', mime: 'video/quicktime', size: 1234, duration: 42.5, ext: 'mov', ...file },
  keys: { src: 'ws-a/11111111-1111-1111-1111-111111111111.mov', poster: 'ws-a/p.jpg' },
  ...extra,
});

test('a file can be saved only when it opens, downloads, and is a stored file', () => {
  assert.equal(saveRefusal(null), 'gone');
  assert.equal(saveRefusal({ status: 'gone' }), 'gone');
  assert.equal(saveRefusal({ status: 'sign_in' }), 'sign_in');
  assert.equal(saveRefusal({ status: 'no_access' }), 'no_access');
  assert.equal(saveRefusal(ok({}, { allow_download: false })), 'no_download', 'the sharer turned downloading off');
  assert.equal(saveRefusal(ok({ kind: 'doc' })), 'not_saveable');
  assert.equal(saveRefusal(ok({}, { keys: {} })), 'gone');
  assert.equal(saveRefusal(ok({})), null);
  for (const r of ['sign_in', 'no_access', 'gone', 'not_saveable', 'no_download', 'not_writer', 'over_quota', 'wrong_workspace']) {
    assert.ok(SAVE_REFUSAL_STATUS[r] >= 400, r);
  }
  assert.equal(SAVE_REFUSAL_STATUS.over_quota, 402, 'the storage wall, as for an upload');
});

test('one CopyObject up to the ceiling, parts above it that cover every byte once', () => {
  assert.equal(copyPlan(0), null);
  assert.deepEqual(copyPlan(1), { mode: 'single', bytes: 1 });
  assert.deepEqual(copyPlan(SINGLE_COPY_MAX_BYTES), { mode: 'single', bytes: SINGLE_COPY_MAX_BYTES });
  assert.ok(SINGLE_COPY_MAX_BYTES < 5 * 1024 ** 3, 'under R2’s 5 GiB CopyObject limit');
  const n = 3 * COPY_PART_BYTES + 17;
  const plan = copyPlan(n, { singleMax: COPY_PART_BYTES });
  assert.equal(plan.mode, 'multipart');
  assert.equal(plan.parts.length, 4);
  let next = 0;
  plan.parts.forEach((p, i) => {
    assert.equal(p.partNumber, i + 1);
    assert.equal(p.start, next);
    assert.ok(p.end >= p.start);
    next = p.end + 1;
  });
  assert.equal(next, n, 'the ranges end at the last byte');
  assert.equal(plan.parts.at(-1).end - plan.parts.at(-1).start + 1, 17);
});

test('the new key is this workspace’s, in the upload shape, with the source extension', () => {
  const k = copyKey('ws-b', 'ws-a/abc.MOV', 'u-1');
  assert.equal(k, 'ws-b/u-1.mov');
  assert.equal(copyKey('ws-b', 'ws-a/noext', 'u-2'), 'ws-b/u-2.bin');
  assert.equal(copyKey('ws-b', 'ws-a/x.tar.gz', 'u-3'), 'ws-b/u-3.gz');
});

test('the card a copy becomes is the card the canvas makes for that upload', () => {
  assert.deepEqual(SAVED_CARD_DIMS, FALLBACK_DIMS, 'same new-card sizes as the canvas');
  assert.match(savedCardId('video', 1700000000000, 0.5), /^vid-1700000000000-500000$/);
  assert.match(savedCardId('pdf', 1, 0), /^pdf-1-0$/);

  const vid = savedCard(ok({}), { cardId: 'vid-1', srcKey: 'ws-b/n.mov', posterKey: 'ws-b/p.jpg' });
  assert.deepEqual(vid, {
    id: 'vid-1', kind: 'video', w: 360, h: 202, src: 'r2:ws-b/n.mov', sizeBytes: 1234, mime: 'video/quicktime',
    poster: 'r2:ws-b/p.jpg', fileName: 'Cut v3.mov', duration: 42.5,
  });
  assert.ok(!('x' in vid) && !('y' in vid), 'no position: the append route stores it off the board');

  const pdf = savedCard(ok({ kind: 'pdf', name: 'Script.pdf', page_count: 120 }), { cardId: 'pdf-1', srcKey: 'ws-b/s.pdf', posterKey: 'ws-b/s1.jpg' });
  assert.equal(pdf.pdfSrc, 'r2:ws-b/s.pdf');
  assert.equal(pdf.src, 'r2:ws-b/s1.jpg', 'a PDF’s src is its page-one picture');
  assert.equal(pdf.pageCount, 120);

  const file = savedCard(ok({ kind: 'file', name: 'selects.zip', ext: 'zip', mime: 'application/zip' }), { cardId: 'file-1', srcKey: 'ws-b/z.zip' });
  assert.equal(file.fileSrc, 'r2:ws-b/z.zip');
  assert.equal(file.ext, 'zip');
  assert.equal(file.fileName, 'selects.zip');

  assert.deepEqual([file.w, file.h], [360, 220], 'a saved zip lands at its contact sheet’s size');
  const bin = savedCard(ok({ kind: 'file', name: 'firmware.bin', ext: 'bin', mime: 'application/octet-stream' }), { cardId: 'file-4', srcKey: 'ws-b/f.bin' });
  assert.deepEqual([bin.w, bin.h], [240, 150], 'any other file at a file card’s');
  const deck = savedCard(ok({ kind: 'file', name: 'Pitch.pptx', ext: 'pptx' }), { cardId: 'file-2', srcKey: 'ws-b/p.pptx' });
  assert.deepEqual([deck.w, deck.h], [400, 225], 'a saved deck lands at a slide’s size');
  const docx = savedCard(ok({ kind: 'file', name: 'Treatment.docx', ext: 'docx' }), { cardId: 'file-3', srcKey: 'ws-b/t.docx' });
  assert.deepEqual([docx.w, docx.h], [300, 388], 'a saved document lands at a page’s size');

  const img = savedCard(ok({ kind: 'image', name: 'still.jpg' }), { cardId: 'img-1', srcKey: 'ws-b/i.jpg' });
  assert.deepEqual(img, { id: 'img-1', kind: 'image', w: 320, h: 240, src: 'r2:ws-b/i.jpg', fileName: 'still.jpg' });

  const aud = savedCard(ok({ kind: 'audio', name: 'loop.wav', ext: 'wav' }), { cardId: 'aud-1', srcKey: 'ws-b/a.wav' });
  assert.equal(aud.title, 'loop.wav');
  assert.equal(aud.src, 'r2:ws-b/a.wav');
});

test('the copy’s images row is the one an upload inserts, in the caller’s workspace', () => {
  assert.deepEqual(
    savedImageRow({ workspaceId: 'ws-b', boardId: 'b-1', cardId: 'vid-1', key: 'ws-b/n.mov', bytes: 99.7, userId: 'u', originalName: 'Cut v3.mov' }),
    { workspace_id: 'ws-b', board_id: 'b-1', card_id: 'vid-1', storage_path: 'ws-b/n.mov', size_bytes: 99, uploaded_by: 'u', original_name: 'Cut v3.mov' },
  );
});

test('the party route: bearer-only, the caller decides access, keys never leave the Worker', () => {
  const s = readFileSync(new URL('../../party/upload.ts', import.meta.url), 'utf8');
  const at = s.indexOf('async handleFileSave(');
  assert.ok(at > 0, 'the route exists');
  const body = s.slice(at, s.indexOf('\n  }\n', at));
  // After the JWT gate, never before it.
  assert.ok(s.indexOf('endsWith("/file-save")') > s.indexOf('if (!claims?.sub)'), 'dispatched after the JWT check');
  assert.match(body, /rpc\/get_file_share/);
  assert.match(body, /Authorization: `Bearer \$\{accessToken\}`/, 'get_file_share runs as the caller');
  assert.match(body, /saveRefusal\(result\)/);
  assert.match(body, /can_write_board/);
  assert.match(body, /authorize_upload/);
  assert.match(body, /record_upload_intent/);
  assert.match(body, /this\.copyObject\(r2, env, srcKey, dstKey, plan, contentType\)/);
  assert.match(body, /rest\/v1\/images/);
  const cp = s.slice(s.indexOf('async copyObject('), s.indexOf('async copyObject(') + 3000);
  assert.match(cp, /"x-amz-copy-source": source/);
  assert.match(cp, /"x-amz-copy-source-range": `bytes=\$\{p\.start\}-\$\{p\.end\}`/);
  assert.match(cp, /await this\.abortMultipart\(r2, env, dstKey, uploadId\);/, 'a failed part copy cleans up');
  assert.doesNotMatch(body, /keys:\s*result\.keys|\bkeys\b:/, 'the response never carries the source keys');
});
