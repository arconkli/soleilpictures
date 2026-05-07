// Single source of truth for entity-kind tinting. Used by EntityLink
// (hover tint) and any future kind-aware UI (backlinks panel, picker
// rows, etc). Returns a CSS-color string.

const KIND_COLORS = {
  card:    '#4f8df8',  // blue — generic card
  board:   '#a78bfa',  // violet — boards
  doc:     '#0ea5e9',  // sky    — docs
  note:    '#f59e0b',  // amber  — notes
  image:   '#f472b6',  // pink   — images
  palette: '#34d399',  // mint   — palettes
  group:   '#cbd5e1',  // slate  — groups
  url:     '#94a3b8',  // gray   — external URLs
  user:    '#22d3ee',  // cyan   — people
  message: '#10b981',  // green  — chat
  tag:     '#ec4899',  // rose   — tags
};

export function entityKindColor(kind) {
  if (!kind) return 'var(--soleil)';
  return KIND_COLORS[kind] || 'var(--soleil)';
}
