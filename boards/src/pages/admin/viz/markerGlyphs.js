// markerGlyphs.js — one shape per kind of dated marker.
//
// Shared by the weekly charts (a glyph at the top of a marker's line) and the
// markers list beside them, so the two can never draw the same kind in two
// different shapes.
//
// Every kind is drawn in the same neutral ink: kinds are told apart by SHAPE,
// never by colour. The palette has no hue to spare (see viz/palette.js), and a
// colour per kind would put a status colour or the reserved gold on a mark that
// is not a status. ◆ is kept for the owner's own `ship` notes; a changelog entry
// is a batch of release notes rather than a ship date, so it is the hollow ◇.
//
// The glyphs are real text, never CSS `content:`, because generated text enters
// the accessible name. Callers mark them aria-hidden and say the kind in words.

export const GLYPH = Object.freeze({
  ship: '◆',
  changelog: '◇',
  event: '●',
  note: '●',
  alert: '⚠',
  break: '┆',
});

export const MARKER_KINDS = Object.keys(GLYPH);

/**
 * The glyph for a marker kind; any kind not in GLYPH draws '●'. Own keys only,
 * so a kind that happens to name something on Object.prototype ('constructor',
 * 'toString') is still unknown rather than a function rendered as text.
 */
export function glyphFor(kind) {
  return Object.prototype.hasOwnProperty.call(GLYPH, kind) ? GLYPH[kind] : '●';
}
