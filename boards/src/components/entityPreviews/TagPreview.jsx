// Tag preview — color swatch + creation kind. Used by hover popovers
// and the backlinks panel when looking at a tag entity.
//
// The data shape arrives from entity_search:
//   { id, kind:'tag', title:<name>, meta:{ color, createdKind } }

export function previewMini(row) {
  const meta = row?.meta || {};
  const color = meta.color || tagFallbackColor(row?.title || row?.id);
  const kind = meta.createdKind && meta.createdKind !== 'user'
    ? meta.createdKind
    : null;
  return (
    <div className="ent-prev-meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block', width: 8, height: 8,
        background: color, borderRadius: 999,
        boxShadow: '0 0 0 1.5px var(--bg-1)',
      }} />
      <span>Tag</span>
      {kind && (
        <span style={{
          font: '700 9px/1 var(--font-display)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          padding: '1px 4px',
          borderRadius: 2,
          background: 'var(--bg-2)',
        }}>{kind}</span>
      )}
    </div>
  );
}

export const previewFull = previewMini;

// Same deterministic palette TagPicker uses, kept in sync. If a tag
// has no explicit color, hash the slug to one of these so the
// preview matches what the chip looks like elsewhere.
const TAG_PALETTE = [
  '#4f8df8', '#22d3ee', '#10b981', '#84cc16', '#f59e0b',
  '#ef4444', '#ec4899', '#a78bfa', '#6366f1', '#0ea5e9',
];
function tagFallbackColor(slug) {
  const s = (slug || 'tag').toString();
  let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}
