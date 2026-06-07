import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Link as LinkIcon } from '../lib/icons.js';
import { COVER_TINTS } from './primitives.jsx';

const TILE_KIND_ICON = {
  board: LayoutGrid,
  doc: FileText,
  card: StickyNote,
  docPos: FileText,
  url: LinkIcon,
};

const PAD = 8;
const W = 480;

// Mini-gallery popover for multi-target Links. Anchored beneath the link.
// Single-target links don't use this — they navigate directly.
export function LinkPopover({ anchor, link, onNavigate, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const popH = popRef.current?.scrollHeight || 280;
      const spaceBelow = vh - anchor.bottom - PAD;
      const placeAbove = spaceBelow < 280 && anchor.top - PAD > spaceBelow;
      const top = placeAbove
        ? Math.max(PAD, anchor.top - popH - PAD)
        : Math.min(vh - popH - PAD, anchor.bottom + PAD);
      const left = Math.min(Math.max(PAD, anchor.left), vw - W - PAD);
      setPos({ top, left });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!link) return null;

  return createPortal(
    <div
      ref={popRef}
      className="link-popover surface-frosted"
      style={{ top: pos.top, left: pos.left, width: W }}
    >
      <div className="link-popover-head">
        <span className="t-eyebrow">{link.targets.length} TARGETS</span>
        {link.name && <span className="link-popover-name">{link.name}</span>}
      </div>
      <div className="link-popover-grid">
        {link.targets.map((t, i) => (
          <button key={i} className="link-popover-tile" onClick={() => onNavigate?.(t)}>
            <TilePreview target={t} />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function TilePreview({ target }) {
  const IconCmp = TILE_KIND_ICON[target.kind] || LinkIcon;
  if (target.kind === 'url') {
    let host = target.href;
    try { host = new URL(target.href).hostname; } catch {}
    return (
      <>
        <div className="link-popover-tile-cover" style={{ background: 'var(--bg-3)' }}>
          <img alt="" src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`} width={32} height={32} />
        </div>
        <div className="link-popover-tile-meta">
          <div className="link-popover-tile-title">{host}</div>
          <div className="link-popover-tile-sub t-meta">URL</div>
        </div>
      </>
    );
  }
  const tint = COVER_TINTS.warm;
  return (
    <>
      <div className="link-popover-tile-cover" style={{ background: `linear-gradient(135deg, ${tint}, color-mix(in oklab, ${tint} 40%, var(--bg-2)))`, color: 'var(--ink-0)' }}>
        <Icon as={IconCmp} size={20} />
      </div>
      <div className="link-popover-tile-meta">
        <div className="link-popover-tile-title">{target.name || target.id || target.cardId || target.docCardId || 'Untitled'}</div>
        <div className="link-popover-tile-sub t-meta">{target.kind}</div>
      </div>
    </>
  );
}
