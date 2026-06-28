// One delivery path for every generated export (PDF, Fountain, FDX, HTML, MD)
// that works on web AND inside the native Capacitor app.
//
// Web: a Blob-URL <a download> (the classic browser save).
// Native (iOS/Android WebView): <a download> does NOT save a file and
// window.print()/PDF dialogs don't exist, so instead we write the blob to the
// app's cache directory and present the OS share sheet ("Save to Files", Mail,
// AirDrop, …). The native plugins are imported lazily so the web bundle never
// pulls them in.

import { Capacitor } from '@capacitor/core';

// Classic web download. Exported so callers that are explicitly web-only (or
// want to bypass the native sheet) can reuse it.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Blob → base64 (no data: prefix), the shape @capacitor/filesystem wants.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = String(r.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

const isNative = () => {
  try { return !!(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); }
  catch (_) { return false; }
};

// Deliver a finished file to the user. Resolves once handed off (download
// triggered, or the native share sheet dismissed); throws on failure so the
// caller can surface a toast. `filename` MUST carry the extension — the OS uses
// it to pick the file type for the share sheet.
export async function deliverFile(blob, filename) {
  if (isNative()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const data = await blobToBase64(blob);
    // Cache dir is the right home for a transient export the user is about to
    // save/share elsewhere; the OS reclaims it without our bookkeeping.
    const written = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    try {
      await Share.share({ title: filename, url: written.uri });
    } catch (err) {
      // Dismissing the share sheet rejects with "Share canceled" — that's a user
      // choice, not a failure (the file was generated + written fine). Only let
      // genuine errors propagate so the caller's "Export failed" toast is honest.
      if (/cancel/i.test(String(err?.message || err))) return;
      throw err;
    }
    return;
  }
  downloadBlob(blob, filename);
}
