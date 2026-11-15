// A photo's Download on an iPhone or iPad goes to the share sheet
// (lib/photoSave.js); everywhere else it stays the download it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { photoDeliveryFor, sharePhoto, deliverPhoto, setPhotoSaveToast } from './photoSave.js';

const named = (name) => Object.assign(new Error(name), { name });
const blob = () => new Blob(['abc'], { type: 'image/png' });
// A navigator whose share answers from `outcomes` in order: 'ok', an error to
// reject with, or 'throw' for a synchronous throw.
function fakeNav(outcomes = ['ok'], { canShare = () => true } = {}) {
  const nav = {
    calls: [],
    share(data) {
      const o = outcomes[Math.min(nav.calls.length, outcomes.length - 1)];
      nav.calls.push(data);
      if (o === 'throw') throw new TypeError('no share');
      return o === 'ok' ? Promise.resolve() : Promise.reject(o);
    },
  };
  if (canShare) nav.canShare = canShare;
  return nav;
}
const counter = () => { const f = () => { f.n += 1; }; f.n = 0; return f; };
const tick = () => new Promise((r) => setTimeout(r, 0));

test('photoDeliveryFor: only iOS web that can share files shares', () => {
  assert.equal(photoDeliveryFor({ native: false, ios: true, canShareFiles: true }), 'share');
  assert.equal(photoDeliveryFor({ native: true, ios: true, canShareFiles: true }), 'download');
  assert.equal(photoDeliveryFor({ native: false, ios: false, canShareFiles: true }), 'download');
  assert.equal(photoDeliveryFor({ native: false, ios: true, canShareFiles: false }), 'download');
  assert.equal(photoDeliveryFor({ native: true, ios: false, canShareFiles: false }), 'download');
});

test('sharePhoto: the four outcomes', async () => {
  const file = new File([blob()], 'a.png', { type: 'image/png' });
  assert.equal(await sharePhoto(file, fakeNav(['ok'])), 'shared');
  assert.equal(await sharePhoto(file, fakeNav([named('AbortError')])), 'cancelled');
  assert.equal(await sharePhoto(file, fakeNav([named('NotAllowedError')])), 'blocked');
  assert.equal(await sharePhoto(file, fakeNav([new TypeError('bad')])), 'failed');
  assert.equal(await sharePhoto(file, fakeNav(['throw'])), 'failed');
});

test('sharePhoto calls share before it returns, with the file', () => {
  const file = new File([blob()], 'a.png', { type: 'image/png' });
  const nav = fakeNav(['ok']);
  sharePhoto(file, nav);
  assert.equal(nav.calls.length, 1);
  assert.deepEqual(nav.calls[0], { files: [file] });
});

test('deliverPhoto: not iOS downloads and never shares', async () => {
  const nav = fakeNav(); const fallback = counter();
  await deliverPhoto(blob(), 'a.png', { nav, ios: false, native: false, toast: null, fallback });
  assert.equal(fallback.n, 1);
  assert.equal(nav.calls.length, 0);
});

test('deliverPhoto: the native app downloads and never shares', async () => {
  const nav = fakeNav(); const fallback = counter();
  await deliverPhoto(blob(), 'a.png', { nav, ios: true, native: true, toast: null, fallback });
  assert.equal(fallback.n, 1);
  assert.equal(nav.calls.length, 0);
});

test('deliverPhoto: iOS that cannot share files downloads', async () => {
  for (const canShare of [null, () => false, () => { throw new Error('x'); }]) {
    const nav = fakeNav(['ok'], { canShare }); const fallback = counter();
    await deliverPhoto(blob(), 'a.png', { nav, ios: true, native: false, toast: null, fallback });
    assert.equal(fallback.n, 1);
    assert.equal(nav.calls.length, 0);
  }
});

test('deliverPhoto: iOS shares the photo as a named, typed file, inside the call', async () => {
  const nav = fakeNav(['ok']); const fallback = counter(); const toast = counter();
  const done = deliverPhoto(blob(), 'a.png', { nav, ios: true, native: false, toast, fallback });
  assert.equal(nav.calls.length, 1, 'share is called before any await');
  await done;
  const [file] = nav.calls[0].files;
  assert.equal(file.name, 'a.png');
  assert.equal(file.type, 'image/png');
  assert.equal(file.size, 3);
  assert.equal(fallback.n, 0);
  assert.equal(toast.n, 0);
});

test('deliverPhoto: a blob with no type is shared as a JPEG', async () => {
  const nav = fakeNav(['ok']);
  await deliverPhoto(new Blob(['abc']), 'a.jpg', { nav, ios: true, native: false, toast: null, fallback: counter() });
  assert.equal(nav.calls[0].files[0].type, 'image/jpeg');
});

test('deliverPhoto: a blob that is not typed as an image takes its type from the name', async () => {
  const typeOf = async (b, name) => {
    const nav = fakeNav(['ok']);
    await deliverPhoto(b, name, { nav, ios: true, native: false, toast: null, fallback: counter() });
    return nav.calls[0].files[0].type;
  };
  assert.equal(await typeOf(new Blob(['abc'], { type: 'application/octet-stream' }), 'a.png'), 'image/png');
  assert.equal(await typeOf(new Blob(['abc'], { type: 'binary/octet-stream' }), 'a.JPEG'), 'image/jpeg');
  assert.equal(await typeOf(new Blob(['abc']), 'a.png'), 'image/png');
  assert.equal(await typeOf(new Blob(['abc']), 'a.webp'), 'image/webp');
  assert.equal(await typeOf(new Blob(['abc']), 'a.gif'), 'image/gif');
  assert.equal(await typeOf(new Blob(['abc']), 'a.heic'), 'image/heic');
  assert.equal(await typeOf(new Blob(['abc'], { type: 'application/octet-stream' }), 'scan.tif'), 'image/tiff');
  assert.equal(await typeOf(new Blob(['abc']), 'a.jfif'), 'image/jpeg');
  // No image extension: the blob's own type when it has one, else a JPEG.
  assert.equal(await typeOf(new Blob(['abc'], { type: 'application/octet-stream' }), 'download'), 'application/octet-stream');
  assert.equal(await typeOf(new Blob(['abc'], { type: 'application/octet-stream' }), 'a.bin'), 'application/octet-stream');
  assert.equal(await typeOf(new Blob(['abc']), 'download'), 'image/jpeg');
  // An image type the blob already has is kept, whatever the name says.
  assert.equal(await typeOf(new Blob(['abc'], { type: 'image/webp' }), 'a.png'), 'image/webp');
});

test('deliverPhoto: closing the sheet does nothing more', async () => {
  const nav = fakeNav([named('AbortError')]); const fallback = counter(); const toast = counter();
  await deliverPhoto(blob(), 'a.png', { nav, ios: true, native: false, toast, fallback });
  assert.equal(fallback.n, 0);
  assert.equal(toast.n, 0);
});

test('deliverPhoto: a refused share offers Save, whose tap shares again at once', async () => {
  const nav = fakeNav([named('NotAllowedError'), 'ok']); const fallback = counter();
  const toasts = [];
  await deliverPhoto(blob(), 'a.png', { nav, ios: true, native: false, toast: (o) => toasts.push(o), fallback });
  assert.equal(toasts.length, 1);
  assert.equal(fallback.n, 0);
  const [o] = toasts;
  assert.equal(o.group, 'photo-save', 'a repeat joins the toast on screen');
  assert.equal(o.type, 'info');
  assert.equal(o.message, 'Your photo is ready to save.');
  assert.equal(o.action.label, 'Save');
  assert.equal(o.ttl, 12000);
  o.action.onClick();
  assert.equal(nav.calls.length, 2, 'the second share is inside the tap');
  assert.equal(nav.calls[1].files[0], nav.calls[0].files[0]);
  await tick();
  assert.equal(fallback.n, 0);
});

test('deliverPhoto: Save that is refused or fails downloads instead', async () => {
  for (const second of [named('NotAllowedError'), new TypeError('bad'), 'throw']) {
    const nav = fakeNav([named('NotAllowedError'), second]); const fallback = counter();
    const toasts = [];
    await deliverPhoto(blob(), 'a.png', { nav, ios: true, native: false, toast: (o) => toasts.push(o), fallback });
    toasts[0].action.onClick();
    await tick();
    assert.equal(fallback.n, 1);
  }
});

test('deliverPhoto: a refused share with no toast downloads', async () => {
  const nav = fakeNav([named('NotAllowedError')]); const fallback = counter();
  await deliverPhoto(blob(), 'a.png', { nav, ios: true, native: false, toast: null, fallback });
  assert.equal(fallback.n, 1);
});

test('deliverPhoto: a share that fails downloads', async () => {
  for (const o of [new TypeError('bad'), 'throw']) {
    const nav = fakeNav([o]); const fallback = counter(); const toast = counter();
    await deliverPhoto(blob(), 'a.png', { nav, ios: true, native: false, toast, fallback });
    assert.equal(fallback.n, 1);
    assert.equal(toast.n, 0);
  }
});

test('setPhotoSaveToast: the hook is read at call time, and unsubscribing clears only its own', async () => {
  const a = counter(); const b = counter();
  const offA = setPhotoSaveToast(a);
  const run = (fallback) => deliverPhoto(blob(), 'a.png', { nav: fakeNav([named('NotAllowedError')]), ios: true, native: false, fallback });
  await run(counter());
  assert.equal(a.n, 1);
  const offB = setPhotoSaveToast(b);
  offA(); // b is still the hook
  await run(counter());
  assert.equal(b.n, 1);
  offB();
  const fallback = counter();
  await run(fallback);
  assert.equal(fallback.n, 1);
  assert.equal(a.n + b.n, 2);
});
