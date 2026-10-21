// Where a toolbar's popover goes against the control that opened it: on the
// side it asks for (under the button, or over it for a bar along the bottom)
// when it fits there, else on whichever side has more room, and always inside
// the window, `pad` from each edge. With `fitHeight` a long list is capped to
// the room on its side (and to `maxHeightRatio` of the window) and scrolls.
// Pure, for hooks/useAnchoredPopover.js.
//
//   anchor    the control's box (getBoundingClientRect)
//   size      the panel's { width, height } — its whole height, for fitHeight
//   viewport  { width, height }
//   → { top, left, side: 'below' | 'above', maxHeight: number | null }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function placeAnchored(anchor, size, viewport, opts = {}) {
  const { side = 'below', align = 'start', gap = 6, pad = 8, fitHeight = false, maxHeightRatio = 0.7 } = opts;
  const { width: w, height: h } = size;
  const { width: vw, height: vh } = viewport;

  const room = {
    below: vh - anchor.bottom - gap - pad,
    above: anchor.top - gap - pad,
  };
  const other = side === 'above' ? 'below' : 'above';
  let chosen = side === 'above' ? 'above' : 'below';
  if (h > room[chosen] && (h <= room[other] || room[other] > room[chosen])) chosen = other;

  let maxHeight = null;
  let height = h;
  if (fitHeight) {
    maxHeight = Math.max(0, Math.min(room[chosen], Math.round(vh * maxHeightRatio)));
    height = Math.min(h, maxHeight);
  }
  const top = clamp(chosen === 'below' ? anchor.bottom + gap : anchor.top - gap - height, pad, vh - height - pad);

  const start = align === 'end' ? anchor.right - w
    : align === 'center' ? anchor.left + anchor.width / 2 - w / 2
      : anchor.left;
  const left = clamp(start, pad, vw - w - pad);

  return { top, left, side: chosen, maxHeight };
}
