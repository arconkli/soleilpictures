// Palette preview — renders the actual swatches inline so a hover
// reveals the colors without a click. Reads from card_index.meta
// (populated by syncCardIndex via boardsApi.js).
//
// A swatch is stored EITHER as a hex string ("#aabbcc") OR as an object
// { hex, name } — normalize to the hex string before painting it, else
// `background: [object Object]` renders a colorless box (the palette
// "shows" but with no content). Mirrors TagFeatureCard's handling.
function hexOf(c) {
  return typeof c === 'string' ? c : (c && c.hex) || null;
}

export function previewMini(row) {
  const hexes = (row?.meta?.swatches || []).map(hexOf).filter(Boolean);
  if (!hexes.length) return null;
  return (
    <div className="ent-prev-palette">
      {hexes.map((c, i) => (
        <span key={i} className="ent-prev-swatch" style={{ background: c }} title={c} />
      ))}
    </div>
  );
}

export function previewFull(row) {
  const hexes = (row?.meta?.swatches || []).map(hexOf).filter(Boolean);
  if (!hexes.length) return null;
  return (
    <div className="ent-prev-palette ent-prev-palette-full">
      {hexes.map((c, i) => (
        <span key={i} className="ent-prev-swatch" style={{ background: c }} title={c}>
          <span className="ent-prev-swatch-label">{c}</span>
        </span>
      ))}
    </div>
  );
}
