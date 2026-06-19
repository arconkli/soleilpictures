// Tap-to-decide popover for a discovered candidate name.
//
// A candidate name is a recurring capitalized proper noun that isn't a
// tag yet (e.g. a character or setting that only ever appears in prose).
// The doc editor paints these with a faint dotted underline (.tt-candidate);
// tapping one opens this popover right where the user is reading:
//
//   ┌───────────────────────────────┐
//   │ Enoch                      5×  │
//   │ Make “Enoch” a…                │
//   │  [ 👤 Character ] [ 📍 Setting ]│
//   │ “…then Enoch turned to the…”   │
//   │ Not a name                     │
//   └───────────────────────────────┘
//
// Promote → ensureTag + entity_type (handled by the caller); the autotag
// triggers spread it across the workspace and it gains the rich
// hover-to-explore card. Dismiss → a workspace-wide entity_ignore_terms
// tombstone so it stops surfacing. No separate inbox.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { ENTITY_TYPES } from '../lib/entityTypes.js';

const PAD = 8;
const W = 264;

export function CandidatePromptPopover({ anchor, name, count, sample, busy, onPromote, onDismiss, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, w: W });
  const [enter, setEnter] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEnter(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const h = ref.current?.scrollHeight || 150;
      const w = Math.min(W, vw - 2 * PAD);
      // Prefer just below the word; flip above if it would overflow.
      let top = anchor.bottom + 8;
      if (top + h > vh - PAD) top = Math.max(PAD, anchor.top - h - 8);
      const left = Math.max(PAD, Math.min(vw - w - PAD, anchor.left));
      setPos({ top, left, w });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchor, sample]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      // A tap on another candidate re-targets — let that click through.
      if (e.target.closest?.('.tt-candidate')) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose]);

  const n = Number(count) || 0;

  return createPortal(
    <div ref={ref}
         className={`tag-pop cand-pop ${enter ? 'is-in' : ''}`}
         style={{ top: pos.top, left: pos.left, width: pos.w }}>
      <div className="cand-pop-head">
        <span className="cand-pop-name">{name}</span>
        {n > 0 && <span className="tag-pop-count">{n}×</span>}
      </div>
      <div className="cand-pop-q">Make this a…</div>
      <div className="cand-pop-actions">
        {ENTITY_TYPES.map((t) => (
          <button key={t.value} className="cand-pop-btn" disabled={busy}
                  onClick={() => onPromote?.(t.value)}>
            <Icon as={t.Icon} size={14} /> {t.label}
          </button>
        ))}
      </div>
      {sample && <div className="cand-pop-sample">“…{sample}…”</div>}
      <button className="cand-pop-dismiss" disabled={busy} onClick={() => onDismiss?.()}>
        Not a name
      </button>
    </div>,
    document.body,
  );
}
