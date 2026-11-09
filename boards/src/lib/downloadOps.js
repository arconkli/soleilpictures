// downloadOps — a file download, or a zip of many, as one row in the activity
// tray, with the coded error toasts every surface shares.
//
// The Files page, the canvas and the sidebar's Files menu all take files out
// of a cluster. The Files page had the tray row, Cancel, progress and the
// toasts; the sidebar called cardDownload bare, so a 30-file zip showed
// nothing for a minute and a failure was an unhandled rejection. Both now go
// through here so the words and the codes live once.
//
// `toast` takes what feedback.toast takes; it may be missing.

import { trackOp } from './activityOps.js';
import {
  downloadCardAsset, downloadCardAssets, bulkDownloadSupported, AssetFetchError,
} from './cardDownload.js';
import { assetFilename } from './cardAssetName.js';
import { wantsDirectDownload } from './downloadPlan.js';
import { getDeviceInfo } from './device.js';
import { downloadFailedWords } from './transferWords.js';

export async function downloadOneTracked(card, kind, {
  boardId = null, boardName = null, surface, toast, key = `download:${card.id}`,
} = {}) {
  const name = assetFilename(card, kind);
  let ios = false;
  try { ios = getDeviceInfo().os === 'iOS'; } catch (_) {}
  // A hand-off the browser takes over: nothing says when it lands.
  const direct = wantsDirectDownload(card, kind, { native: !bulkDownloadSupported(), ios });
  try {
    await trackOp({
      kind: 'download', label: name, boardId, boardName,
      key,
      doneLabel: (r) => (r === false ? null : direct ? 'Download started' : `Downloaded ${name}`),
    }, () => downloadCardAsset(card, kind, { surface }));
  } catch (err) {
    toast?.({ type: 'error', code: 'file_download_failed', message: downloadFailedWords(err) });
  }
}

export async function downloadManyTracked(items, {
  zipName, boardId = null, boardName = null, surface, toast,
} = {}) {
  if (!items.length) return;
  if (!bulkDownloadSupported()) {
    // deliverFile writes through a FileReader as base64 on native; a
    // half-gigabyte zip becomes ~667 MB of string and takes the app out.
    toast?.({ type: 'warning', message: 'Download files one at a time in the app.' });
    return;
  }
  try {
    // The tray row: the fetch phase fills 0-0.9 by files done, packing the rest.
    const out = await trackOp({
      kind: 'download', label: zipName, boardId, boardName,
      total: items.length, cancellable: true, doneLabel: `Downloaded ${zipName}`,
    }, ({ signal, progress }) => downloadCardAssets(
      items.map(it => ({ card: it.card, kind: it.kind })),
      {
        zipName, surface, signal,
        onProgress: (p) => {
          if (p.phase === 'fetch') progress({ done: p.done, total: p.total, fraction: 0.9 * (p.done / Math.max(1, p.total)) });
          else if (p.total > 0 && p.done != null) progress({ fraction: 0.9 + 0.1 * (p.done / p.total) });
        },
      }));
    if (!out) return;   // Cancel: nothing left, nothing to say
    const { count, skipped, failed } = out;
    // Say what was left out rather than quietly shipping a smaller archive
    // than the one that was asked for — and distinguish "there was nothing
    // behind it" (a note, an empty card) from "storage would not give it
    // back", which is the one worth telling someone about.
    const left = [];
    if (skipped) left.push(`${skipped} had no file`);
    if (failed) left.push(`${failed} could not be read from storage`);
    if (!count) {
      toast?.({ type: 'warning', message: 'Nothing there could be downloaded.' });
    } else if (left.length) {
      toast?.({
        type: 'warning',
        message: `Downloaded ${count} file${count === 1 ? '' : 's'} — ${left.join(', ')}.`,
      });
    }
  } catch (err) {
    if (err?.code === 'zip_too_large') {
      toast?.({ type: 'error', code: 'zip_too_large', message: err.message });
    } else if (err instanceof AssetFetchError && err.unreachable) {
      // R2 returns no CORS header on an error response, so the browser
      // cannot tell us whether the signature died or this origin is simply
      // not on the bucket's allowlist. Naming the origin is what makes the
      // difference checkable by whoever reads the message.
      const origin = (typeof window !== 'undefined' && window.location?.origin) || 'this address';
      toast?.({
        type: 'error',
        code: 'zip_storage_blocked',
        message: `Storage would not hand those files back to ${origin}. Downloading one at a time still works.`,
      });
    } else {
      toast?.({ type: 'error', code: 'zip_download_failed', message: downloadFailedWords(err, 'Couldn’t download those files. Try again.') });
    }
  }
}
