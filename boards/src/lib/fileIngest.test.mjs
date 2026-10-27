// classifyDropFile is the single routing table for BOTH ingest surfaces (the
// canvas drop pipeline and the list-view one), so a divergence here is a
// divergence between two user-visible behaviours that are supposed to be the
// same gesture. It is pure and synchronous, which makes it cheap to pin.
//
// The case that motivated this file: Safari reports an EMPTY File.type for
// .flac and some .aiff, so those fell past the `audio/` prefix test into the
// generic file route — which is paid-gated for a free owner. A producer
// dropping a sample pack got a silent partial refusal with no stated reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDropFile, sizeBucket, fitImageDims, meaningfulFileName, fileMetaFor,
  isAnimatedImageBytes, isAnimatedImageKey,
  FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP, FREE_FILE_CAP, FREE_FILE_CAP_LABEL, FALLBACK_DIMS,
} from './fileIngest.js';
import { VIEW_MAX_BYTES } from './fileView.js';

// Minimal File stand-in — classifyDropFile only reads .type/.name/.size.
const f = (name, type, size = 1024) => ({ name, type, size });

// 0367: file TYPES are open on the free plan; only SIZE stays Creator's.
test('a free owner may drop any file type up to the free file cap', () => {
  // (A .psd is a picture card since views; see the raw and Photoshop test below.)
  for (const [name, type] of [['mock.fig', ''], ['pack.zip', 'application/zip'],
                              ['brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
    const c = classifyDropFile(f(name, type, FREE_FILE_CAP), { canAttemptFiles: false });
    assert.equal(c.route, 'file', `${name} is a file card on free`);
    assert.equal(c.kind, 'file');
  }
});

test('a free owner takes any file at any size — the drive decides (0413)', () => {
  const big = classifyDropFile(f('pack.zip', 'application/zip', FREE_FILE_CAP + 1), { canAttemptFiles: false });
  assert.equal(big.route, 'file', 'a big zip is a file card on every plan');
  const pdf = classifyDropFile(f('deck.pdf', 'application/pdf', FREE_PDF_CAP + 1), { canAttemptFiles: false });
  assert.equal(pdf.route, 'file', 'a big PDF is a downloadable file card on every plan');
  // A paid owner routes the same way.
  assert.equal(classifyDropFile(f('pack.zip', 'application/zip', FREE_FILE_CAP + 1), { canAttemptFiles: true }).route, 'file');
  assert.equal(classifyDropFile(f('deck.pdf', 'application/pdf', FREE_PDF_CAP + 1), { canAttemptFiles: true }).route, 'file');
  // No route refuses a file for its size any more.
  for (const [name, type] of [['clip.mov', 'video/quicktime'], ['stem.wav', 'audio/wav'], ['deck.pdf', 'application/pdf'], ['take.braw', '']]) {
    assert.notEqual(classifyDropFile(f(name, type, 4 * 1024 ** 3), { canAttemptFiles: false }).route, 'blocked', name);
  }
});

test('audio mime types route to the audio card', () => {
  for (const type of ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac',
                      'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/opus', 'audio/aiff']) {
    const c = classifyDropFile(f('loop.bin', type));
    assert.equal(c.route, 'audio', `${type} should route to audio`);
    assert.equal(c.kind, 'audio');
  }
});

test('audio with an EMPTY mime falls back to the extension', () => {
  // Safari does this for .flac; some pickers do it for .wav and .aiff.
  for (const name of ['Kick.wav', 'Pad.aiff', 'Pad.aif', 'Stab.flac', 'Vox.m4a',
                      'Perc.aac', 'Amb.ogg', 'Amb.opus', 'Bass.mp3', 'Memo.caf']) {
    const c = classifyDropFile(f(name, ''));
    assert.equal(c.route, 'audio', `${name} with no mime should still route to audio`);
  }
});

test('video with no mime, or the generic one, falls back to the extension', () => {
  // A system with nothing registered for .mov or .mkv says nothing, and the
  // clip became a file card with no player.
  for (const name of ['Take 3.mov', 'TAKE.MOV', 'a.qt', 'a.mp4', 'a.m4v', 'a.webm', 'a.mkv', 'a.avi',
                      'a.wmv', 'a.flv', 'a.mpg', 'a.mpeg', 'a.m2ts', 'a.3gp', 'a.3g2', 'a.ogv']) {
    assert.equal(classifyDropFile(f(name, '')).route, 'video', `${name} with no mime`);
    assert.equal(classifyDropFile(f(name, 'application/octet-stream')).route, 'video', `${name} as octet-stream`);
  }
  // Over the inline size it is still a clip, sent in parts.
  const big = classifyDropFile(f('Edit.mov', '', FREE_VIDEO_CAP + 1));
  assert.deepEqual([big.route, big.kind], ['largeMedia', 'video']);
  // .ts and .mts are TypeScript as often as a camera's; a system that knows
  // the camera's file says video/mp2t.
  assert.equal(classifyDropFile(f('index.ts', '')).route, 'file');
  assert.equal(classifyDropFile(f('mod.mts', '')).route, 'file');
  assert.equal(classifyDropFile(f('00001.MTS', 'video/mp2t')).route, 'video');
  // Typed as something else, a name doesn't win.
  assert.equal(classifyDropFile(f('clips.mov.zip', 'application/zip')).route, 'file');
});

test('the extension fallback does NOT fire when a mime is present', () => {
  // A file genuinely typed as something else must not be hijacked by its name.
  const c = classifyDropFile(f('notes.wav.zip', 'application/zip'));
  assert.equal(c.route, 'file');
});

test('a non-audio empty-mime file is still a file card', () => {
  assert.equal(classifyDropFile(f('archive.zip', '')).route, 'file');
  assert.equal(classifyDropFile(f('README', '')).route, 'file');
});

test('big audio goes to multipart on every plan, and stays an audio card', () => {
  const big = f('stem.wav', 'audio/wav', FREE_AUDIO_CAP + 1);
  assert.equal(classifyDropFile(big, { canAttemptFiles: true }).route, 'largeMedia');
  assert.equal(classifyDropFile(big, { canAttemptFiles: true }).kind, 'audio',
    'a big loop is still an AUDIO card, not a generic file');
  assert.equal(classifyDropFile(big, { canAttemptFiles: false }).route, 'largeMedia', 'a free owner too (0413)');
});

test('at exactly the cap the free inline route still applies', () => {
  assert.equal(classifyDropFile(f('a.wav', 'audio/wav', FREE_AUDIO_CAP)).route, 'audio');
  assert.equal(classifyDropFile(f('v.mp4', 'video/mp4', FREE_VIDEO_CAP)).route, 'video');
  assert.equal(classifyDropFile(f('d.pdf', 'application/pdf', FREE_PDF_CAP)).route, 'pdf');
});

test('images, video and pdf keep their existing routes', () => {
  assert.equal(classifyDropFile(f('a.png', 'image/png')).route, 'image');
  assert.equal(classifyDropFile(f('a.HEIC', '')).route, 'image');
  assert.equal(classifyDropFile(f('a.mp4', 'video/mp4')).route, 'video');
  assert.equal(classifyDropFile(f('a.pdf', '')).route, 'pdf');
});

test('an image is never blocked, even for a free owner', () => {
  // The paid gate is about "upload anything", not about photographs.
  assert.equal(classifyDropFile(f('a.jpg', 'image/jpeg'), { canAttemptFiles: false }).route, 'image');
});

test('every route carries usable fallback dims', () => {
  for (const c of [classifyDropFile(f('a.png', 'image/png')),
                   classifyDropFile(f('a.mp4', 'video/mp4')),
                   classifyDropFile(f('a.wav', 'audio/wav')),
                   classifyDropFile(f('a.pdf', 'application/pdf')),
                   classifyDropFile(f('a.zip', 'application/zip'))]) {
    assert.ok(c.w > 0 && c.h > 0, `${c.route} needs fallback dims to lay out before upload`);
  }
  assert.deepEqual(
    { w: classifyDropFile(f('a.wav', 'audio/wav')).w, h: classifyDropFile(f('a.wav', 'audio/wav')).h },
    FALLBACK_DIMS.audio);
});

test('sizeBucket stays low-cardinality and never leaks raw bytes', () => {
  const MB = 1024 * 1024;
  assert.equal(sizeBucket(0), 'lt_10mb');
  assert.equal(sizeBucket(9 * MB), 'lt_10mb');
  assert.equal(sizeBucket(11 * MB), '10_50mb');
  assert.equal(sizeBucket(60 * MB), '50_200mb');
  assert.equal(sizeBucket(300 * MB), '200mb_1gb');
  assert.equal(sizeBucket(2048 * MB), 'gt_1gb');
});

test('fitImageDims preserves aspect while clamping', () => {
  const big = fitImageDims(4000, 2000);
  assert.equal(Math.max(big.w, big.h), 1200);
  assert.equal(big.w / big.h, 2);
  const small = fitImageDims(10, 5);
  assert.equal(Math.min(small.w, small.h), 80);
});

// The three routes a drop takes on purpose rather than by accident: a partial
// download is skipped, a screenplay becomes a script on every tier, and a free
// owner's PureRef scene gets the truth instead of a storage pitch.
test('unfinished downloads are skipped before any mime test', () => {
  for (const name of ['photo.jpg.crdownload', 'clip.mp4.part', 'x.download', 'a.opdownload', 'b.tmp']) {
    assert.equal(classifyDropFile(f(name, '')).route, 'partial', name);
    assert.equal(classifyDropFile(f(name, 'image/jpeg'), { canAttemptFiles: false }).route, 'partial', `${name} typed`);
  }
});

test('screenplays become scripts on every tier, never the paid file route', () => {
  for (const can of [true, false]) {
    assert.equal(classifyDropFile(f('draft.fountain', ''), { canAttemptFiles: can }).route, 'screenplay');
    assert.equal(classifyDropFile(f('draft.FDX', 'application/xml'), { canAttemptFiles: can }).route, 'screenplay');
  }
});

test("a free owner's PureRef scene is not pitched; a paying owner keeps any-file-type", () => {
  assert.equal(classifyDropFile(f('refs.pur', ''), { canAttemptFiles: false }).route, 'pureref');
  assert.equal(classifyDropFile(f('refs.pur', ''), { canAttemptFiles: true }).route, 'file');
});

test('the skipped-files sentence covers both kinds and is silent when nothing was skipped', async () => {
  const { skippedFilesNotice } = await import('./fileIngest.js');
  assert.equal(skippedFilesNotice({}), null);
  assert.match(skippedFilesNotice({ partial: 1 }), /an unfinished download/);
  assert.match(skippedFilesNotice({ partial: 3 }), /3 unfinished downloads/);
  assert.match(skippedFilesNotice({ pureref: 1 }), /PureRef/);
  assert.doesNotMatch(skippedFilesNotice({ partial: 1, pureref: 2 }), /paid|upgrade|Creator/i);
});

// ── meaningfulFileName / fileMetaFor ────────────────────────────────────────

test('a real file name is kept, normalised to a clean basename', () => {
  assert.equal(meaningfulFileName({ name: 'diner_ext_dusk_04.jpg' }), 'diner_ext_dusk_04.jpg');
  assert.equal(meaningfulFileName({ name: 'IMG_2034.HEIC' }), 'IMG_2034.HEIC');
  assert.equal(meaningfulFileName({ name: 'Screenshot 2026-10-02 at 10.11.12.png' }), 'Screenshot 2026-10-02 at 10.11.12.png');
  // macOS decomposed accent → composed, so it matches a typed search.
  assert.equal(meaningfulFileName({ name: 'cafe\u0301.jpg' }), 'caf\u00e9.jpg');
  // A path never survives, and control characters are dropped.
  assert.equal(meaningfulFileName({ name: 'refs/scene 4/diner.png' }), 'diner.png');
  assert.equal(meaningfulFileName({ name: 'C:\\shots\\a.png' }), 'a.png');
  assert.equal(meaningfulFileName({ name: 'a\u0007b\u0000.png' }), 'ab.png');
  assert.equal(meaningfulFileName({ name: 'x'.repeat(300) + '.png' }).length, 200);
});

test('what a browser invents for a paste is not a name', () => {
  for (const n of ['image.png', 'image.jpg', 'Image.PNG', 'image', 'blob', 'Pasted Graphic.png',
    'Pasted Graphic 3.png', 'pasted image.png', 'Untitled.png', 'untitled-2.jpg', '', '   ']) {
    assert.equal(meaningfulFileName({ name: n }), null, JSON.stringify(n));
  }
  assert.equal(meaningfulFileName(null), null);
  assert.equal(meaningfulFileName({}), null);
  // …but a name that merely starts with one of those words is real.
  assert.equal(meaningfulFileName({ name: 'image_board_final.png' }), 'image_board_final.png');
});

test('fileMetaFor adds the name or nothing at all', () => {
  assert.deepEqual(fileMetaFor({ name: 'diner.jpg' }), { fileName: 'diner.jpg' });
  assert.deepEqual(fileMetaFor({ name: 'image.png' }), {});
});

// ── Raws and Photoshop documents are pictures, by their views ────────────

test('a .psd or a camera raw is a picture card whatever type the system gives it; over the view ceiling a file card', () => {
  for (const [name, type] of [['comp.psd', 'image/vnd.adobe.photoshop'], ['comp.psd', 'image/x-photoshop'],
                              ['comp.psd', 'application/x-photoshop'], ['comp.psd', ''],
                              ['DSC00412.ARW', 'image/x-sony-arw'], ['IMG_1.CR2', 'image/x-canon-cr2'],
                              ['IMG_1.CR3', ''], ['shot.dng', 'image/x-adobe-dng'], ['big.psb', ''],
                              ['DSCF1.RAF', 'application/octet-stream']]) {
    for (const canAttemptFiles of [true, false]) {
      const c = classifyDropFile(f(name, type), { canAttemptFiles });
      assert.equal(c.route, 'image', `${name} (${type || 'no type'}) is a picture`);
      assert.equal(c.kind, 'image');
    }
  }
  // No view is made over the ceiling, and no browser draws them: a file card.
  assert.equal(classifyDropFile(f('poster.psb', '', VIEW_MAX_BYTES + 1)).route, 'file');
  assert.equal(classifyDropFile(f('DSC00412.ARW', 'image/x-sony-arw', VIEW_MAX_BYTES + 1)).route, 'file');
  assert.equal(classifyDropFile(f('DSC00412.ARW', 'image/x-sony-arw', VIEW_MAX_BYTES)).route, 'image');
  // A type that says something else entirely is believed.
  assert.equal(classifyDropFile(f('notes.psd', 'text/plain')).route, 'file');
  // TIFF and HEIC stay images: Safari draws them, and every other browser
  // shows their view (lib/fileView.js).
  assert.equal(classifyDropFile(f('scan.tif', 'image/tiff')).route, 'image');
  assert.equal(classifyDropFile(f('IMG_1.HEIC', 'image/heic')).route, 'image');
  assert.equal(classifyDropFile(f('IMG_1.HEIC', '')).route, 'image');
  // So does every photo that gets a view, with no type or the generic one.
  for (const [name, type] of [['DSCF0001.HIF', ''], ['plate.exr', ''], ['scan.jp2', 'application/octet-stream'],
                              ['a.jxl', ''], ['scan.TIFF', 'application/octet-stream']]) {
    assert.equal(classifyDropFile(f(name, type)).route, 'image', `${name} (${type || 'no type'})`);
  }
  assert.equal(classifyDropFile(f('notes.txt', '')).route, 'file');
  assert.equal(classifyDropFile(f('blob.bin', 'application/octet-stream')).route, 'file');
  assert.equal(classifyDropFile(f('a.png', 'image/png')).route, 'image');
});

// ── Animated images keep the original as their canvas tier (MEDIA-01) ──────

const bytes = (...parts) => {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return Uint8Array.from(out);
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const pngChunk = (type, len) => [...u32(len), ...bytes(type), ...new Array(len).fill(0), 0, 0, 0, 0];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test('a GIF is animated by key and by bytes', () => {
  assert.equal(isAnimatedImageKey('ws/abc.gif'), true);
  assert.equal(isAnimatedImageKey('ws/abc.GIF'), true);
  assert.equal(isAnimatedImageKey('ws/abc.png'), false);
  assert.equal(isAnimatedImageKey(null), false);
  assert.equal(isAnimatedImageBytes(bytes('GIF89a', new Array(20).fill(0))), true);
});

test('an animated WebP is told apart from a still one by its VP8X flag', () => {
  const head = (flags) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [flags], new Array(20).fill(0));
  assert.equal(isAnimatedImageBytes(head(0x02)), true);
  assert.equal(isAnimatedImageBytes(head(0x10)), false, 'alpha only');
  assert.equal(isAnimatedImageBytes(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', new Array(20).fill(0))), false);
});

test('an APNG is told apart from a PNG by an acTL before the first IDAT', () => {
  const apng = Uint8Array.from([...PNG_SIG, ...pngChunk('IHDR', 13), ...pngChunk('acTL', 8), ...pngChunk('IDAT', 4)]);
  const png = Uint8Array.from([...PNG_SIG, ...pngChunk('IHDR', 13), ...pngChunk('IDAT', 4), ...pngChunk('acTL', 8)]);
  assert.equal(isAnimatedImageBytes(apng), true);
  assert.equal(isAnimatedImageBytes(png), false);
});

test('a JPEG, a short read or nothing at all is not animated', () => {
  assert.equal(isAnimatedImageBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)])), false);
  assert.equal(isAnimatedImageBytes(Uint8Array.from([0x47, 0x49])), false);
  assert.equal(isAnimatedImageBytes(null), false);
});

test("a document lands at its family's size, any other file at a file card's", () => {
  const c = (name, type = '') => classifyDropFile(f(name, type, 1000));
  assert.deepEqual([c('Pitch.pptx').w, c('Pitch.pptx').h], [400, 225]);
  assert.deepEqual([c('Festival.key').w, c('Festival.key').h], [400, 225]);
  assert.deepEqual([c('Budget.xlsx').w, c('Budget.xlsx').h], [300, 388]);
  const docx = c('Treatment.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.deepEqual([docx.w, docx.h], [300, 388]);
  assert.deepEqual([c('selects.zip').w, c('selects.zip').h], [240, 150]);
  assert.equal(c('Pitch.pptx').route, 'file');
});
