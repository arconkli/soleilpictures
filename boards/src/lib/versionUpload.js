// A file as the next version of a card (lib/cardVersions.js): uploaded the
// way a drop of the same file would be — the same upload functions, so the
// same plan caps — and turned into the fields a version entry carries.
//
// Never passes cardId: abandoned-upload recovery maps one stored file per
// card, and a version upload isn't that card's file until it's shown.
import { uploadImage, uploadVideo, uploadAudio, uploadPdf, uploadFile, captureAndUploadPoster } from './uploads.js';
import { classifyDropFile, meaningfulFileName } from './fileIngest.js';
import { probeFile } from './mediaProbe.js';

// The card kind a dropped file would become, or null.
export function versionKindOf(file, { canAttemptFiles = true } = {}) {
  const c = classifyDropFile(file, { canAttemptFiles });
  if (!c?.kind || c.route === 'blocked' || c.route === 'partial' || c.route === 'screenplay' || c.route === 'pureref') return null;
  return c.kind;
}

// A file can be a version of a card when it's the same kind of thing.
export function canBeVersionOf(card, file, opts) {
  const k = versionKindOf(file, opts);
  return !!k && !!card && k === card.kind;
}

// What a dragged item looks like while it's still over the page (no File yet,
// only DataTransferItem.type): the kind it would be, or null when unsure.
export function kindFromMime(type) {
  const t = String(type || '');
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf') return 'pdf';
  return t ? 'file' : null;
}

const extOf = (name) => (String(name || '').split('.').pop() || '').toLowerCase();

// ctx: { workspaceId, boardId, userId, local, allowLong, onProgress }
//   local — the ?local=1 harness: nothing is uploaded; the file's own blob URL.
export async function uploadVersion(file, card, ctx = {}) {
  const kind = card?.kind;
  const name = meaningfulFileName(file) || file.name || null;
  const base = { fileName: file.name || name, sizeBytes: file.size || null, mime: file.type || null };
  const media = kind === 'video' || kind === 'image' ? await probeFile(file) : null;

  if (ctx.local) {
    const url = URL.createObjectURL(file);
    if (kind === 'pdf') return { pdfSrc: url, src: url, name: file.name, sizeBytes: file.size };
    if (kind === 'file') return { fileSrc: url, ...base, ext: extOf(file.name) };
    if (kind === 'audio') return { src: url, ...base, ext: extOf(file.name) };
    return { src: url, ...base, ...(media ? { media } : {}) };
  }

  const common = { file, workspaceId: ctx.workspaceId, boardId: ctx.boardId, userId: ctx.userId, onProgress: ctx.onProgress || null, originalName: name };
  if (kind === 'image') {
    const up = await uploadImage(common);
    return { src: up.src, ...base, media: { ...(media || {}), w: up.width || media?.w, h: up.height || media?.h } };
  }
  if (kind === 'video') {
    const c = classifyDropFile(file);
    if (c.route === 'largeMedia') {
      // Past the single-request cap: the multipart route, poster made here.
      const up = await uploadFile({ ...common });
      const poster = await captureAndUploadPoster({ file, workspaceId: ctx.workspaceId, boardId: ctx.boardId, userId: ctx.userId }).catch(() => null);
      return { src: up.src, ...(poster ? { poster } : {}), ...base, ...(media ? { media } : {}) };
    }
    const up = await uploadVideo({ ...common, ...(ctx.allowLong ? { maxDurationSec: Number.POSITIVE_INFINITY } : {}) });
    return {
      src: up.src, ...(up.poster ? { poster: up.poster } : {}), ...base,
      media: media || { dur: up.duration || null, w: up.width || null, h: up.height || null },
    };
  }
  if (kind === 'audio') {
    const up = await uploadAudio(common);
    return {
      src: up.src, ...(up.cover ? { cover: up.cover } : {}), ...base, ext: extOf(file.name),
      duration: up.duration ?? null, sampleRate: up.sampleRate || null, channels: up.channels || null,
      // Not stored on the version: the waveform belongs on the card, for the one on show.
      _top: up.peaks ? { peaks: up.peaks, analyzed: 1 } : null,
    };
  }
  if (kind === 'pdf') {
    const up = await uploadPdf(common);
    return { pdfSrc: up.pdfSrc, src: up.src, name: up.name || file.name, pageCount: up.pageCount || null, sizeBytes: file.size || null };
  }
  const up = await uploadFile(common);
  return { fileSrc: up.src, fileName: up.fileName || file.name, sizeBytes: up.sizeBytes ?? file.size, mime: up.mime, ext: up.ext };
}
