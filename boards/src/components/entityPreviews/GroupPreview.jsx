// Group preview — member count + outline color swatch.

export function previewMini(row) {
  const meta = row?.meta || {};
  const count = meta.memberCount || 0;
  const color = meta.color || (meta.outline ? 'var(--soleil)' : null);
  return (
    <div className="ent-prev-meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {color && (
        <span style={{
          display: 'inline-block', width: 10, height: 10,
          background: color, borderRadius: 2,
        }} />
      )}
      <span>{count} {count === 1 ? 'card' : 'cards'}</span>
    </div>
  );
}

export const previewFull = previewMini;
