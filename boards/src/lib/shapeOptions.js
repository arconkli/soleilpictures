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

export const SHAPES = [
  { id: 'rect', label: 'Rect' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'star', label: 'Star' },
];

export const DASH_STYLES = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
];
