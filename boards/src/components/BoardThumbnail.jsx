// Mini render of a board's contents — used inside BoardCard's cover.
//
// Round 21 — renders to a Canvas2D bitmap (via lib/renderThumbnail.js),
// exports as a blob URL, displays as an <img>. Replaces Round 20's
// SVG-data-URL approach which couldn't load external images.
//
// Why this design (preserved from Round 20):
// - The thumbnail is an <img> of a real bitmap → Chrome treats it as
//   a cached bitmap and GPU-stretches on canvas zoom (cheap), instead
//   of re-rasterizing vector content (the 500-700 ms hitch the user
//   originally reported).
// Why this design (new in Round 21):
// - A real canvas (not SVG-in-img) can drawImage cross-origin photos,
//   so image cards finally render their actual content rather than
//   placeholder rects.
//
// Async: rendering involves loading each image-card's photo, so the
// thumbnail appears after a brief delay on cold loads. After that, the
// in-memory cache (renderThumbnail.js) makes subsequent renders sync-ish.

import { memo, useEffect, useState } from 'react';
import { renderThumbnailToBlob } from '../lib/renderThumbnail.js';

function BoardThumbnailImpl({ cards, strokes, boards = {} }) {
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    if ((!cards || cards.length === 0) && (!strokes || strokes.length === 0)) {
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    let createdUrl = null;
    renderThumbnailToBlob({ cards, strokes, boards }).then(url => {
      if (cancelled) {
        // Component unmounted while we were rendering. Don't leak the
        // blob URL even though the renderer's cache holds a reference;
        // the cache hit on the next mount will re-create one.
        return;
      }
      createdUrl = url;
      setBlobUrl(prev => {
        // We DON'T revokeObjectURL the previous URL here because the
        // renderThumbnail module's cache may still hold it. Revoking
        // would invalidate future cache hits. The cache enforces its
        // own size limit + revokes on eviction.
        return url;
      });
    }).catch(() => {
      if (!cancelled) setBlobUrl(null);
    });
    return () => { cancelled = true; };
  }, [cards, strokes, boards]);

  if (!blobUrl) return null;

  return (
    <img
      className="bc-thumb"
      src={blobUrl}
      alt=""
      draggable={false}
    />
  );
}

// Memoized. cards / strokes / boards come from useBoardPreview's cache —
// stable refs unless the underlying data changes — so the default
// shallow compare prevents re-renders when CanvasSurface re-renders for
// unrelated reasons (pan, presence ticks).
export const BoardThumbnail = memo(BoardThumbnailImpl);
