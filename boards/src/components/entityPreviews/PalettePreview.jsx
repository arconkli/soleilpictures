// Palette preview — renders the actual swatches inline so a hover
// reveals the colors without a click. Reads from card_index.meta
// (populated by syncCardIndex via boardsApi.js).

export function previewMini(row) {
  const swatches = row?.meta?.swatches || [];
  if (!swatches.length) return null;
  return (
    <div className="ent-prev-palette">
      {swatches.map((c, i) => (
        <span key={i} className="ent-prev-swatch" style={{ background: c }} title={c} />
      ))}
    </div>
  );
}

export function previewFull(row) {
  const swatches = row?.meta?.swatches || [];
  if (!swatches.length) return null;
  return (
    <div className="ent-prev-palette ent-prev-palette-full">
      {swatches.map((c, i) => (
        <span key={i} className="ent-prev-swatch" style={{ background: c }} title={c}>
          <span className="ent-prev-swatch-label">{c}</span>
        </span>
      ))}
    </div>
  );
}
