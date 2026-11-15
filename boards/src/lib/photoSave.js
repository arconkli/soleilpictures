// A photo's Download on an iPhone or iPad (iOS web, not the native app).
//
// There, <a download> asks "Do you want to download…" and puts the file in
// Files > Downloads, never in Photos. The share sheet's Save Image does put it
// in Photos, so a photo goes to navigator.share as a file instead. Everything
// else (Android, a computer, the native app, a browser that can't share files)
// keeps the caller's `fallback`, which is the download it always had.
//
// navigator.share only works inside a tap. The photo is fetched first, so on a
// slow connection the tap's permission can run out before the share: the share
// is then refused (NotAllowedError) and a toast offers a Save button, whose
// tap is a fresh one. No `await` may come before a `nav.share` call here.
//
// Plain functions with an injectable `nav` so node can test them
// (photoSave.test.mjs).
import { t } from '@lingui/core/macro';

export function photoDeliveryFor({ native, ios, canShareFiles }) {
  return !native && ios && canShareFiles ? 'share' : 'download';
}

// 'shared' | 'cancelled' (the person closed the sheet) | 'blocked' (the tap's
// permission ran out) | 'failed'. nav.share is called synchronously, so a call
// made inside a tap counts as that tap.
export function sharePhoto(file, nav = navigator) {
  let p;
  try { p = nav.share({ files: [file] }); }
  catch (_) { return Promise.resolve('failed'); }
  return Promise.resolve(p).then(
    () => 'shared',
    (err) => (err?.name === 'AbortError' ? 'cancelled' : err?.name === 'NotAllowedError' ? 'blocked' : 'failed'),
  );
}

// The app's toast, set by FeedbackProvider (components/AppFeedback.jsx). Read
// at call time; null on a surface with no provider.
let photoSaveToast = null;
export function setPhotoSaveToast(fn) {
  photoSaveToast = fn;
  return () => { if (photoSaveToast === fn) photoSaveToast = null; };
}

// The share sheet offers Save Image only for a file it knows is a picture.
// Storage can serve a photo as application/octet-stream, or with no type at
// all, so a blob whose type is not an image takes its type from the name.
// Every extension a downloaded photo's name can end in (imageFilename.js
// IMAGE_EXT_RE). A name with none of them keeps the blob's own type.
const IMAGE_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', svg: 'image/svg+xml',
  tif: 'image/tiff', tiff: 'image/tiff', jxl: 'image/jxl',
};
export function photoFileType(blobType, name) {
  if (String(blobType || '').startsWith('image/')) return blobType;
  const ext = /\.([a-z0-9]+)$/i.exec(String(name || ''))?.[1]?.toLowerCase();
  return IMAGE_TYPES[ext] || blobType || 'image/jpeg';
}

export function deliverPhoto(blob, name, { nav = navigator, ios, native, toast = photoSaveToast, fallback } = {}) {
  const file = new File([blob], name, { type: photoFileType(blob.type, name) });
  let canShareFiles = false;
  try { canShareFiles = !!nav.canShare({ files: [file] }); } catch (_) { canShareFiles = false; }
  if (photoDeliveryFor({ native, ios, canShareFiles }) !== 'share') return Promise.resolve(fallback());
  return sharePhoto(file, nav).then((result) => {
    if (result === 'failed') return fallback();
    if (result !== 'blocked') return undefined;
    if (!toast) return fallback();
    // One group, so a second refused Download joins the toast on screen and
    // its Save shares the newest photo.
    toast({
      group: 'photo-save',
      type: 'info',
      message: t`Your photo is ready to save.`,
      action: {
        label: t({ message: 'Save', context: 'save a photo' }),
        onClick: () => {
          sharePhoto(file, nav).then((r) => { if (r === 'failed' || r === 'blocked') fallback(); });
        },
      },
      ttl: 12000,
    });
    return undefined;
  });
}
