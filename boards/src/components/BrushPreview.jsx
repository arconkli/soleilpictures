// A brush shown as the stroke it draws, not as its name.
//
// "Pencil" and "Marker" are meaningless as words until you see the line: the
// difference between them is taper, opacity and how the ends cap. So the picker
// on both drawing surfaces renders an actual stroke through the real renderer,
// which also means a brush can never be previewed as something it doesn't draw.

import { toPathD, isFilledPath, strokeOpacity, strokeLineCap } from '../lib/strokeRender.js';

export const BRUSH_ORDER = ['pen', 'marker', 'highlighter', 'pencil'];
export const BRUSH_LABELS = {
  pen: 'Pen',
  marker: 'Marker',
  highlighter: 'Highlighter',
  pencil: 'Pencil',
};

// Light → heavy → light, so each preview shows the taper the brush produces
// rather than a flat bar.
const PREVIEW_POINTS = [
  [6, 18, 0.25], [16, 11, 0.6], [28, 8, 0.95], [40, 12, 0.6], [50, 17, 0.25],
];

// The <path> alone — callers supply the <svg viewBox="0 0 56 26"> around it so
// they control the size.
//
// The ink is `currentColor`, NOT the user's chosen colour. Both toolbars are
// dark chrome and the pad's default colour is near-black, so previewing in the
// working colour drew four invisible smudges. What the picker has to show is the
// SHAPE — taper, cap, opacity — and currentColor keeps that legible in either
// theme and picks up the button's own active/resting ink for free.
//
// The blend mode is dropped for the same reason: multiply against dark chrome
// annihilates the highlighter. Its translucency still reads through `opacity`.
export function BrushPreview({ brush = 'pen', width = 6 }) {
  const s = { color: 'currentColor', width, brush, points: PREVIEW_POINTS };
  const filled = isFilledPath(s);
  const alpha = strokeOpacity(s);
  return (
    <path d={toPathD(s)}
          fill={filled ? 'currentColor' : 'none'}
          stroke={filled ? 'none' : 'currentColor'}
          strokeWidth={filled ? undefined : width}
          strokeLinecap={filled ? undefined : strokeLineCap(s)}
          strokeLinejoin={filled ? undefined : 'round'}
          opacity={alpha === 1 ? undefined : alpha} />
  );
}
