// The frame a board export is drawn in (renderThumbnail.js renderBoardPng):
// the board's own shape, where a cover is always 16:9; never closer than the
// covers' zoom; and at most EXPORT_LONG_SIDE px on its longer side before the
// renderer's 2× supersample, so 3,200 px in the file. Pure, for its test.

export const EXPORT_LONG_SIDE = 1600;

// contentW × contentH: the board's extent in board units, margin included.
export function exportFrame(contentW, contentH, maxZoom) {
  const zoom = Math.min(maxZoom, EXPORT_LONG_SIDE / Math.max(contentW, contentH, 1));
  return {
    width: Math.max(1, Math.round(contentW * zoom)),
    height: Math.max(1, Math.round(contentH * zoom)),
  };
}
