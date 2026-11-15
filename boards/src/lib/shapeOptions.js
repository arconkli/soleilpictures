// The shape vocabulary, in one place.
//
// These lists were private to ToolOptionsBar.jsx, which is where you pick a
// shape for a card you already made. Settings → Card defaults now picks what a
// NEW shape starts as, and the two must offer the same set — a default of a
// kind the toolbar cannot render, or a dash style the canvas ignores, is a
// setting that appears to work and doesn't.
//
// `shape` and `dash` are already read by the add-shape mutator in App.jsx
// alongside stroke, fill and strokeWidth; those three had controls and these
// two did not.

import { t } from '@lingui/core/macro';
export const SHAPES = [
  { id: 'rect', get label() { return t`Rect`; } },
  { id: 'ellipse', get label() { return t`Ellipse`; } },
  { id: 'line', get label() { return t`Line`; } },
  { id: 'arrow', get label() { return t`Arrow`; } },
  { id: 'diamond', get label() { return t`Diamond`; } },
  { id: 'triangle', get label() { return t`Triangle`; } },
  { id: 'hexagon', get label() { return t`Hexagon`; } },
  { id: 'star', get label() { return t({ message: 'Star', context: 'shape' }); } },
];

export const DASH_STYLES = [
  { id: 'solid', get label() { return t`Solid`; } },
  { id: 'dashed', get label() { return t`Dashed`; } },
  { id: 'dotted', get label() { return t`Dotted`; } },
];
