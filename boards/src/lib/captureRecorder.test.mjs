// captureRecorder — the parts that are decidable without a browser.
//
// The recording path itself needs getDisplayMedia and MediaRecorder, so it is
// pinned in tests/capture-takes.spec.js against a real engine. What lives here
// is everything that decides what a file is CALLED and whether a button should
// exist at all — which is where this module has actually been wrong:
// clipFilename defaulted its extension to 'mp4', so a Firefox webm shipped
// named .mp4, in direct contradiction of this file's own header.
//
// Every function under test either takes its inputs or reads a global it
// guards for, so none of this needs a DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extForBlob, captureFilename, clipFilename, stillFilename,
  recordingSupport, stillSupport, saveFile, isRecording,
} from './captureRecorder.js';

// Node 22 defines a minimal `navigator` with no mediaDevices, which is exactly
// the shape these two guards care about. `window` is absent, so stub it for the
// cases that need to get past the first check.
function withBrowserish(fn, { getDisplayMedia = undefined } = {}) {
  const hadWindow = 'window' in globalThis;
  const priorNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: getDisplayMedia ? { getDisplayMedia } : {} },
    configurable: true, writable: true,
  });
  try { return fn(); }
  finally {
    if (!hadWindow) delete globalThis.window;
    if (priorNav) Object.defineProperty(globalThis, 'navigator', priorNav);
    else delete globalThis.navigator;
  }
}

test('the extension comes from the blob, never from a guess', () => {
  assert.equal(extForBlob({ type: 'video/mp4;codecs=avc1.42E01E' }), 'mp4');
  assert.equal(extForBlob({ type: 'VIDEO/MP4' }), 'mp4');
  assert.equal(extForBlob({ type: 'video/webm;codecs=vp9' }), 'webm');
  // Anything we cannot read is webm, which is the safe assumption: naming a
  // webm .mp4 produces a file that will not open, the other way round does not.
  assert.equal(extForBlob({ type: '' }), 'webm');
  assert.equal(extForBlob(null), 'webm');
  assert.equal(extForBlob(undefined), 'webm');
});

test('clipFilename has NO default extension', () => {
  // The whole point. A default is an assumption about what the browser
  // produced, and this module's header exists to argue against exactly that.
  // A missing argument must be loud, not quietly wrong.
  const at = new Date(2026, 8, 9, 14, 5, 3);
  assert.equal(clipFilename('establish', 'webm', at), 'soleil-establish-20260909-140503.webm');
  assert.equal(clipFilename('establish', 'mp4', at), 'soleil-establish-20260909-140503.mp4');
  assert.ok(!clipFilename('establish', undefined, at).endsWith('.mp4'),
    'a missing extension must not silently become mp4');
});

test('a filename sorts, and says what it is without being opened', () => {
  const at = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(captureFilename('shot', 'png', at), 'soleil-shot-20260102-030405.png');
  // Zero-padded throughout, or a directory listing sorts January after October.
  assert.match(captureFilename('x', 'png', at), /-\d{8}-\d{6}\./);
});

test('a name that is punctuation is still a usable filename', () => {
  const at = new Date(2026, 8, 9, 0, 0, 0);
  assert.equal(captureFilename('Push In / 9:16', 'png', at), 'soleil-push-in-9-16-20260909-000000.png');
  assert.equal(captureFilename('', 'png', at), 'soleil-capture-20260909-000000.png');
  assert.equal(captureFilename('///', 'png', at), 'soleil-capture-20260909-000000.png');
  assert.equal(captureFilename(null, 'png', at), 'soleil-capture-20260909-000000.png');
});

test('the two default names are the ones the buttons use', () => {
  const at = new Date(2026, 8, 9, 0, 0, 0);
  assert.equal(clipFilename(null, 'mp4', at), 'soleil-clip-20260909-000000.mp4');
  assert.equal(stillFilename(null, at), 'soleil-shot-20260909-000000.png');
  assert.equal(stillFilename('shot-9x16', at), 'soleil-shot-9x16-20260909-000000.png');
});

test('a browser with no getDisplayMedia says so, and says what to do instead', () => {
  withBrowserish(() => {
    const rec = recordingSupport();
    const still = stillSupport();
    assert.equal(rec.ok, false);
    assert.equal(still.ok, false);
    // This is what an iPhone gets. A reason that only says "no" leaves the
    // person with nowhere to go, and the OS recorder genuinely does work.
    assert.match(rec.reason, /Control Centre/);
    assert.match(still.reason, /screenshot/);
    // Both must be non-empty — they are rendered as the button's accessible
    // name, and an empty one would leave a control that announces nothing.
    assert.ok(rec.reason.length > 20 && still.reason.length > 20);
  });
});

test('stills and recording are decided separately', () => {
  // A still needs the screen; recording also needs an encoder. They are
  // different questions and each gets its own answer.
  withBrowserish(() => {
    // getDisplayMedia present, MediaRecorder absent (as it is under Node).
    assert.equal(stillSupport().ok, true);
    assert.equal(recordingSupport().ok, false);
    assert.match(recordingSupport().reason, /no video recorder/);
  }, { getDisplayMedia: async () => ({}) });
});

test('outside a browser nothing claims to work', () => {
  assert.equal(recordingSupport().ok, false);
  assert.equal(stillSupport().ok, false);
});

test('nothing is recording until something starts', () => {
  assert.equal(isRecording(), false);
});

test('saving nothing is a no-op rather than a crash', () => {
  // The stop paths can legitimately produce a null blob (a take stopped before
  // the first timeslice), and they call straight through to here.
  assert.equal(saveFile(null, 'x.mp4'), false);
  assert.equal(saveFile(undefined, 'x.mp4'), false);
});
