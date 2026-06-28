import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Image as ImageIcon, Palette, Calendar, Link as LinkIcon } from '../lib/icons.js';
import { COVER_TINTS } from './primitives.jsx';
import { supabase } from '../lib/supabase.js';

const TILE_KIND_ICON = {
  board: LayoutGrid,
  doc: FileText,
  card: StickyNote,
  docPos: FileText,
  url: LinkIcon,
};

const PAD = 8;
const W = 320;

// Hover-preview card for a Link. Shows up on link hover (after a debounce
// in the parent), stays put while the user moves into it, fades out on
// outside mouseleave + grace period.
//
// Props:
//   anchor   — DOMRect of the source link span
//   link     — { id, name?, targets: [...] }
//   onMouseEnter / onMouseLeave — caller controls the hover lifecycle so the
//                                 card stays open while the cursor is on it
export function LinkHoverCard({ anchor, link, onMouseEnter, onMouseLeave }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const popH = popRef.current?.scrollHeight || 180;
      const spaceBelow = vh - anchor.bottom - PAD;
      const placeAbove = spaceBelow < popH + PAD && anchor.top - PAD > spaceBelow;
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

  if (!link) return null;

  const targets = link.targets || [];
  const primary = targets[0];
  const more = targets.length - 1;

  return createPortal(
    <div
      ref={popRef}
      className="link-hover surface-frosted"
      style={{ top: pos.top, left: pos.left, width: W }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {primary && <TargetPreview target={primary} />}
      {more > 0 && (
        <div className="link-hover-more t-meta">+ {more} more {more === 1 ? 'target' : 'targets'}</div>
      )}
    </div>,
    document.body,
  );
}

// One target's preview row. Fetches a tiny bit of metadata from Postgres
// for board/card/doc targets so the card has real content, not just a name.
function TargetPreview({ target }) {
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (!supabase || !target) return;
    let cancelled = false;
    (async () => {
      try {
        if (target.kind === 'board') {
          const { data } = await supabase.from('boards').select('name,cover,view').eq('id', target.id).maybeSingle();
          if (!cancelled && data) setMeta({ title: data.name, sub: `${data.view || 'canvas'} cluster`, cover: data.cover });
        } else if (target.kind === 'card') {
          const { data } = await supabase.from('card_index').select('title,body,kind').eq('board_id', target.boardId).eq('card_id', target.cardId).maybeSingle();
          if (!cancelled && data) setMeta({ title: data.title || 'Untitled card', sub: data.kind, body: data.body });
        } else if (target.kind === 'doc' || target.kind === 'docPos') {
          const { data } = await supabase.from('card_index').select('title,body,kind').eq('card_id', target.docCardId).maybeSingle();
          if (!cancelled && data) setMeta({ title: data.title || 'Untitled doc', sub: 'doc', body: data.body });
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [target?.kind, target?.id, target?.boardId, target?.cardId, target?.docCardId, target?.href]);

  const IconCmp = TILE_KIND_ICON[target.kind] || LinkIcon;

  if (target.kind === 'url') {
    let host = target.href;
    try { host = new URL(target.href).hostname; } catch {}
    return (
      <div className="link-hover-row">
        <div className="link-hover-cover" style={{ background: 'var(--bg-3)' }}>
          <img alt="" src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`} width={28} height={28} />
        </div>
        <div className="link-hover-meta">
          <div className="t-eyebrow link-hover-kind">URL</div>
          <div className="link-hover-title">{host}</div>
          <div className="link-hover-sub t-meta">{target.href}</div>
        </div>
      </div>
    );
  }

  const tint = COVER_TINTS[meta?.cover] || COVER_TINTS.warm;
  return (
    <div className="link-hover-row">
      <div className="link-hover-cover" style={{ background: `linear-gradient(135deg, ${tint}, color-mix(in oklab, ${tint} 35%, var(--bg-2)))`, color: 'var(--ink-0)' }}>
        <Icon as={IconCmp} size={16} />
      </div>
      <div className="link-hover-meta">
        <div className="t-eyebrow link-hover-kind">{(meta?.sub || target.kind).toUpperCase()}</div>
        <div className="link-hover-title">{meta?.title || target.name || 'Untitled'}</div>
        {meta?.body && <div className="link-hover-sub t-meta">{meta.body.slice(0, 140)}{meta.body.length > 140 ? '…' : ''}</div>}
      </div>
    </div>
  );
}
