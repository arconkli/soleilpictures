// Inline floating toolbar for editing a single selected arrow. Shows
// color, thickness, head style, dashed/solid, curve style, label, and a
// delete button. Anchored to the arrow's midpoint in board space; we
// project it through the caller's `canvasToViewport` so it tracks pan
// and zoom without scaling its own typography.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ARROW_COLOR_KEYS, ARROW_COLOR_TOKENS, arrowHeadStyle } from '../lib/arrowGeometry.js';

const THICKNESS_LABELS = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };

export function ArrowPopover({
  arrow, arrowIndex, midPoint, canvasToViewport,
  onChange, onDelete, onClose,
}) {
  const popRef = useRef(null);
  const [labelDraft, setLabelDraft] = useState(arrow?.label || '');
  const [labelEditing, setLabelEditing] = useState(false);
  // Sync the local draft when the arrow swaps under us (e.g. selection
  // moves to a different arrow) — but don't stomp on mid-typing edits.
  useEffect(() => {
    if (!labelEditing) setLabelDraft(arrow?.label || '');
  }, [arrow?.label, arrowIndex, labelEditing]);

  // Position: project canvas-space midPoint into viewport space and clamp
  // to keep the popover on-screen.
  const [pos, setPos] = useState(() => projectClamped(midPoint, canvasToViewport));
  useLayoutEffect(() => {
    setPos(projectClamped(midPoint, canvasToViewport, popRef.current));
  }, [midPoint?.x, midPoint?.y, canvasToViewport]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!arrow) return null;

  const color = arrow.color || 'ink';
  const thickness = arrow.thickness || 'thin';
  const head = arrowHeadStyle(arrow);
  const curveStraight = !!arrow.straight;
  const dashed = !!arrow.dashed;

  const commit = (patch) => onChange?.(patch);

  return (
    <div
      ref={popRef}
      className="arrow-popover"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}>

      {/* Color */}
      <div className="ap-row ap-colors" role="radiogroup" aria-label="Arrow color">
        {ARROW_COLOR_KEYS.map(k => (
          <button
            key={k}
            type="button"
            className={`ap-swatch ${color === k ? 'is-on' : ''}`}
            style={{ background: ARROW_COLOR_TOKENS[k] }}
            aria-label={`Color ${k}`}
            aria-checked={color === k}
            role="radio"
            onClick={() => commit({ color: k })}
          />
        ))}
      </div>

      <div className="ap-divider" />

      {/* Thickness */}
      <div className="ap-row ap-thickness" role="radiogroup" aria-label="Thickness">
        {['thin', 'medium', 'thick'].map(t => (
          <button
            key={t}
            type="button"
            className={`ap-thick ${thickness === t ? 'is-on' : ''}`}
            title={THICKNESS_LABELS[t]}
            aria-label={THICKNESS_LABELS[t]}
            aria-checked={thickness === t}
            role="radio"
            onClick={() => commit({ thickness: t })}>
            <span className={`ap-thick-line ap-thick-${t}`} />
          </button>
        ))}
      </div>

      <div className="ap-divider" />

      {/* Head style */}
      <div className="ap-row ap-heads" role="radiogroup" aria-label="Arrow heads">
        <button type="button"
          className={`ap-head ${head === 'none' ? 'is-on' : ''}`}
          title="No arrowheads"
          aria-checked={head === 'none'} role="radio"
          onClick={() => commit({ head: 'none', bidir: false })}>—</button>
        <button type="button"
          className={`ap-head ${head === 'single' ? 'is-on' : ''}`}
          title="Single arrowhead"
          aria-checked={head === 'single'} role="radio"
          onClick={() => commit({ head: 'single', bidir: false })}>→</button>
        <button type="button"
          className={`ap-head ${head === 'double' ? 'is-on' : ''}`}
          title="Double arrowhead"
          aria-checked={head === 'double'} role="radio"
          onClick={() => commit({ head: 'double', bidir: true })}>↔</button>
      </div>

      <div className="ap-divider" />

      {/* Curve / dashed toggles */}
      <div className="ap-row ap-toggles">
        <button type="button"
          className={`ap-toggle ${!curveStraight ? 'is-on' : ''}`}
          title={curveStraight ? 'Make curved' : 'Currently curved'}
          onClick={() => commit({ straight: false })}>
          <svg width="20" height="14" viewBox="0 0 20 14"><path d="M2 11 Q10 -2 18 11" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
        <button type="button"
          className={`ap-toggle ${curveStraight ? 'is-on' : ''}`}
          title={curveStraight ? 'Currently straight' : 'Make straight'}
          onClick={() => commit({ straight: true })}>
          <svg width="20" height="14" viewBox="0 0 20 14"><line x1="2" y1="7" x2="18" y2="7" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
        <button type="button"
          className={`ap-toggle ${dashed ? 'is-on' : ''}`}
          title={dashed ? 'Solid line' : 'Dashed line'}
          onClick={() => commit({ dashed: !dashed })}>
          <svg width="20" height="14" viewBox="0 0 20 14"><line x1="2" y1="7" x2="18" y2="7" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 3" /></svg>
        </button>
      </div>

      <div className="ap-divider" />

      {/* Label edit */}
      <div className="ap-row ap-label">
        <input
          type="text"
          className="ap-label-input"
          value={labelDraft}
          placeholder="Label…"
          maxLength={60}
          onFocus={() => setLabelEditing(true)}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={() => {
            setLabelEditing(false);
            const v = labelDraft.trim();
            if (v !== (arrow.label || '')) commit({ label: v || null });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.currentTarget.blur(); }
            if (e.key === 'Escape') {
              setLabelDraft(arrow.label || '');
              setLabelEditing(false);
              e.currentTarget.blur();
            }
          }} />
      </div>

      <div className="ap-divider" />

      <button type="button" className="ap-delete" title="Delete arrow"
        onClick={() => onDelete?.()}>
        <svg width="13" height="13" viewBox="0 0 13 13"><path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

function projectClamped(midPoint, canvasToViewport, popEl) {
  if (!midPoint || typeof canvasToViewport !== 'function') return { x: 16, y: 16 };
  const v = canvasToViewport(midPoint.x, midPoint.y);
  const popW = popEl?.offsetWidth || 380;
  const popH = popEl?.offsetHeight || 44;
  // Sit just above the arrow midpoint (offset by half the popover height
  // plus a 16px gap), then clamp inside the viewport with an 8px margin.
  const desiredX = v.x - popW / 2;
  const desiredY = v.y - popH - 14;
  const maxX = (window.innerWidth || 1200) - popW - 8;
  const maxY = (window.innerHeight || 800) - popH - 8;
  return {
    x: Math.max(8, Math.min(maxX, desiredX)),
    y: Math.max(8, Math.min(maxY, desiredY)),
  };
}
