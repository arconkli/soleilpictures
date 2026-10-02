// cardFromUpload — a FINISHED card from a file and what its upload returned.
//
// A canvas drop adds a card first, marked pending, and patches it when the
// upload lands — right for a board someone is watching. A folder import writes
// into clusters nobody has open, so it builds each card complete instead:
// nothing pending for the abandoned-upload sweep to find (lib/abandonedUploads),
// nothing optimistic for capRefusal to roll back. Field for field, each kind
// ends where the matching drop path in CanvasSurface ends.

import { meaningfulFileName, fitImageDims } from './fileIngest.js';
import { parseLoopMeta } from './loopMeta.js';

const ID_PREFIX = { image: 'img', video: 'vid', audio: 'aud', pdf: 'pdf', file: 'file' };

// The kind of card an item becomes, whichever upload route carried it.
export function cardKindFor(item) {
  if (item.route === 'image') return 'image';
  if (item.route === 'video' || (item.route === 'largeMedia' && item.kind === 'video')) return 'video';
  if (item.route === 'audio' || (item.route === 'largeMedia' && item.kind === 'audio')) return 'audio';
  if (item.route === 'pdf') return 'pdf';
  return 'file';
}

export function cardIdFor(item, n, rand = Math.random) {
  return `${ID_PREFIX[cardKindFor(item)]}-${Date.now()}-${n}-${Math.floor(rand() * 1e6)}`;
}

// The size a card should be laid out at, once its upload has measured it.
export function measuredSize(item, up) {
  const kind = cardKindFor(item);
  if (kind === 'image' && up?.width && up?.height) return fitImageDims(up.width, up.height);
  if (kind === 'video' && up?.width && up?.height) {
    const w = Math.max(240, Math.min(560, up.width));
    return { w, h: Math.max(160, Math.round(w * (up.height / up.width))) };
  }
  return { w: item.w, h: item.h };
}

export function cardFromUpload({ id, item, up, rect }) {
  const { file } = item;
  const kind = cardKindFor(item);
  const pos = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
  const name = meaningfulFileName(file);
  const ext = (String(file?.name || '').split('.').pop() || '').toLowerCase();

  if (kind === 'image') {
    return { id, kind, src: up.src, ...pos, ...(name ? { fileName: name } : {}) };
  }
  if (kind === 'video') {
    return { id, kind, src: up.src, ...(up.poster ? { poster: up.poster } : {}), ...pos, ...(name ? { fileName: name } : {}) };
  }
  if (kind === 'audio') {
    // `title` is the editable display name; fileName/ext/mime/sizeBytes are the
    // download authority (CanvasSurface.dropAudioFile says why).
    return {
      id, kind,
      title: file?.name || 'Audio', fileName: file?.name || null,
      mime: file?.type || null, sizeBytes: file?.size || null, ext,
      ...(up.duration ? { duration: up.duration } : {}),
      ...(up.peaks ? { peaks: up.peaks, sampleRate: up.sampleRate || null, channels: up.channels || null } : {}),
      ...(up.analyzed ? { analyzed: up.analyzed } : {}),
      ...(up.cover ? { cover: up.cover } : {}),
      ...parseLoopMeta(file?.name),
      ...pos,
    };
  }
  if (kind === 'pdf') {
    return {
      id, kind, name: up.name || file?.name || 'PDF',
      src: up.src || null, pdfSrc: up.pdfSrc, pageCount: up.pageCount || null, ...pos,
    };
  }
  return {
    id, kind: 'file',
    fileSrc: up.src, fileName: up.fileName || file?.name || 'File',
    mime: up.mime || file?.type || null, sizeBytes: up.sizeBytes ?? file?.size ?? null,
    ext: up.ext || ext, ...pos,
  };
}
