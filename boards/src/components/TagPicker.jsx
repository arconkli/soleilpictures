// Tag picker popover. Shows existing tags as suggestions while the user
// types; Enter creates the tag if it doesn't exist yet. Multi-select via
// click-to-toggle. Designed to be opened against an anchor rect with
// fixed positioning so it survives canvas pan/zoom.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const POP_W = 280;

export function TagPicker({
  open, anchorRect, onClose,
  tags = [],                 // [{ id, name, slug, color, kind }]
  appliedIds = new Set(),    // tag ids currently on the target
  onToggle,                  // (tag) => void  — applied to target
  onCreate,                  // (name) => void — creates a new tag (and applies)
}) {
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return tags;
    return tags.filter(t => (t.slug || t.name || '').includes(q));
  }, [tags, q]);
  const hasExact = q.length > 0 && tags.some(t => (t.slug || '') === q);

  if (!open) return null;
  const top = Math.min(window.innerHeight - 360, (anchorRect?.bottom ?? 100) + 6);
  const left = Math.max(8, Math.min(window.innerWidth - POP_W - 8, anchorRect?.left ?? 100));

  return createPortal(
    <div ref={ref} className="tag-picker"
         role="dialog"
         style={{ position: 'fixed', top, left, width: POP_W }}>
      <input className="tag-picker-input"
             autoFocus
             placeholder="Filter tags or type a new one…"
             value={query}
             onChange={(e) => { setQuery(e.target.value); setHover(0); }}
             onKeyDown={(e) => {
               if (e.key === 'Enter') {
                 e.preventDefault();
                 if (q && !hasExact) { onCreate?.(query.trim()); onClose?.(); return; }
                 const m = matches[hover];
                 if (m) onToggle?.(m);
               }
               if (e.key === 'ArrowDown') { e.preventDefault(); setHover(h => Math.min(h + 1, matches.length - 1)); }
               if (e.key === 'ArrowUp')   { e.preventDefault(); setHover(h => Math.max(h - 1, 0)); }
             }} />
      <div className="tag-picker-list">
        {matches.length === 0 && !q && (
          <div className="tag-picker-empty">No tags yet — type a name above.</div>
        )}
        {matches.map((t, i) => {
          const applied = appliedIds.has(t.id);
          return (
            <button key={t.id}
                    className={`tag-picker-row ${applied ? 'is-applied' : ''} ${i === hover ? 'is-hover' : ''}`}
                    onMouseEnter={() => setHover(i)}
                    onClick={() => { onToggle?.(t); }}>
              <span className="tag-picker-dot" style={{ background: t.color || tagFallbackColor(t.slug || t.name) }} />
              <span className="tag-picker-name">{t.name}</span>
              {t.kind !== 'user' && <span className={`tag-picker-kind tag-picker-kind-${t.kind}`}>{t.kind}</span>}
              {applied && <span className="tag-picker-check">✓</span>}
            </button>
          );
        })}
        {q && !hasExact && (
          <button className={`tag-picker-row tag-picker-create ${matches.length === hover ? 'is-hover' : ''}`}
                  onClick={() => { onCreate?.(query.trim()); onClose?.(); }}>
            <span className="tag-picker-dot" style={{ background: tagFallbackColor(q) }} />
            <span className="tag-picker-name">Create "<b>{query.trim()}</b>"</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Inline auto-tag confirmation prompt: when a card title matches an
// existing tag, surface a soft inline "Tag this as #foo?" suggestion the
// user can confirm or dismiss.
export function TagDisambiguationPrompt({ candidate, onAccept, onDismiss }) {
  if (!candidate) return null;
  return (
    <div className="tag-disambig" role="status">
      <span className="tag-disambig-text">
        Tag this as <strong>#{candidate.name}</strong>?
      </span>
      <button type="button" className="tag-disambig-yes" onClick={onAccept}>Yes</button>
      <button type="button" className="tag-disambig-no" onClick={onDismiss}>No</button>
    </div>
  );
}

// Deterministic palette so tags without a color still get a consistent
// hue across surfaces.
const TAG_PALETTE = [
  '#4f8df8', '#22d3ee', '#10b981', '#84cc16', '#f59e0b',
  '#ef4444', '#ec4899', '#a78bfa', '#6366f1', '#0ea5e9',
];
function tagFallbackColor(slug) {
  const s = (slug || 'tag').toString();
  let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

// Render a single tag chip — used inline on cards and group labels.
export function TagChip({ tag, onClick, onRemove }) {
  if (!tag) return null;
  const cls = [
    'tag-chip',
    tag.source && tag.source !== 'user' ? `is-${tag.source}` : '',
  ].filter(Boolean).join(' ');
  return (
    <span className={cls}
          style={{ '--tag-c': tag.color || tagFallbackColor(tag.slug || tag.name) }}
          onClick={onClick}>
      <span className="tag-chip-dot" />
      <span className="tag-chip-name">{tag.name}</span>
      {onRemove && (
        <button type="button"
                className="tag-chip-x"
                aria-label={`Remove ${tag.name}`}
                onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>
      )}
    </span>
  );
}
