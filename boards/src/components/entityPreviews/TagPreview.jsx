// Tag preview — color swatch + creation kind. Used by hover popovers
// and the backlinks panel when looking at a tag entity.
//
// The data shape arrives from entity_search:
//   { id, kind:'tag', title:<name>, meta:{ color, createdKind } }

import { tagFallbackColor } from '../../lib/tagColor.js';

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
