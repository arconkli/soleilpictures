// Rich tag popover that opens from a left-margin dot (DocTagGutter).
//
// Layout (~320px wide). The popover prefers VISUAL content first so a
// character tag actually shows the look — clothes/refs/etc — instead of
// just listing titles. Three sections, each conditional on having
// content, in priority order:
//
//   ┌──────────────────────────────────────┐
//   │ ▣  Pricing Plans            14 items │   chip header
//   │ ────────────────────────────────────  │
//   │ ┌──┐┌──┐┌──┐                          │
//   │ │  ││  ││  │      Image grid          │   tagged image thumbs
//   │ └──┘└──┘└──┘                          │
//   │ ┌──┐┌──┐┌──┐                          │
//   │ │  ││  ││  │                          │
//   │ └──┘└──┘└──┘                          │
//   │ ────────────────────────────────────  │
//   │ ▢▢▢▢▢▢▢▢  Spring palette              │   palette strips
//   │ ▢▢▢▢▢▢▢▢  Warm tones                  │
//   │ ────────────────────────────────────  │
//   │ ◇ Pricing tiers doc                   │   text rows (other kinds)
//   │ ◇ Personal pricing board               │
//   │                       View tag →     │
//   └──────────────────────────────────────┘
//
// Tag color is carried via a small color stamp in the header + a soft
// tag-tinted box shadow under the panel. Each cell/strip/row is its
// own button → navigates to the source entity.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Image as ImageIcon, Palette as PaletteIcon, Calendar, Link as LinkIcon, Tag as TagIcon } from '../lib/icons.js';
import { R2Image } from './R2Image.jsx';
import { ImageLightbox } from './ImageLightbox.jsx';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { fetchTagVisuals } from '../lib/tagVisuals.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

const PAD = 8;
const W = 320;

const KIND_ICON = {
  board: LayoutGrid, group: LayoutGrid, doc: FileText,
  card: StickyNote, note: StickyNote, image: ImageIcon,
  palette: PaletteIcon, schedule: Calendar, link: LinkIcon,
  tag: TagIcon,
};

export function TagRangeHoverPopover({
  anchor,
  tagId,
  tagName,
  tagColor,
  source,
  workspaceId,
  sourceAnchor,
  onRemove,
  onMouseEnter,
  onMouseLeave,
  onClose,
}) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [openSide, setOpenSide] = useState('right');
  const [enter, setEnter] = useState(false);
  // When the user clicks an image thumb we open a fullscreen
  // lightbox INSTEAD of navigating to the source board — they're
  // browsing the popover, not trying to leave it. Closing the
  // lightbox drops them back into the popover scroll. We track an
  // index into data.images so ArrowLeft/ArrowRight can flip through
  // the whole tag's image set fullscreen.
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const navigate = useEntityNavigate();

  const [data, setData] = useState({
    images: [], palettes: [], other: [], total: 0, loading: true,
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => setEnter(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(d => ({ ...d, loading: true }));
    // Shared fetch (lib/tagVisuals) — same logic powers the generic
    // name-hover popover, and a short-TTL cache keeps re-hover instant.
    fetchTagVisuals({ tagId, workspaceId }).then(res => {
      if (cancelled) return;
      setData({ ...res, loading: false });
      try { logEvent(EV.TAG_HOVER_OPEN, { tag_id: tagId, surface: 'doc' }); } catch (_) {}
    });
    return () => { cancelled = true; };
  }, [workspaceId, tagId]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const popH = popRef.current?.scrollHeight || 200;
      // Cap width to the viewport so the popover never overflows a narrow phone.
      const w = Math.min(W, vw - 2 * PAD);
      const spaceRight = vw - anchor.right - PAD;
      const openLeft = spaceRight < w + PAD;
      const left = openLeft
        ? Math.max(PAD, anchor.left - w - 12)
        : Math.min(vw - w - PAD, anchor.right + 12);
      const desiredTop = anchor.top + (anchor.height / 2) - (popH / 2);
      const top = Math.max(PAD, Math.min(vh - popH - PAD, desiredTop));
      setPos({ top, left, w });
      setOpenSide(openLeft ? 'left' : 'right');
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchor, data.images.length, data.palettes.length, data.other.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (lightboxIdx != null) {
        // While the lightbox is open it owns the keyboard: Escape
        // closes it, ←/→ flip through the popover's image list.
        if (e.key === 'Escape') { setLightboxIdx(null); e.stopPropagation(); return; }
        if (e.key === 'ArrowLeft' && data.images.length > 0) {
          e.preventDefault(); e.stopPropagation();
          setLightboxIdx((i) => (i - 1 + data.images.length) % data.images.length);
          return;
        }
        if (e.key === 'ArrowRight' && data.images.length > 0) {
          e.preventDefault(); e.stopPropagation();
          setLightboxIdx((i) => (i + 1) % data.images.length);
          return;
        }
        return;
      }
      if (e.key === 'Escape') onClose?.();
    };
    const onDown = (e) => {
      if (!popRef.current) return;
      if (popRef.current.contains(e.target)) return;
      if (e.target.closest?.('.doc-tag-gutter-dot, .tt-tag-word')) return;
      // Lightbox is a sibling portal — clicks inside it (including
      // the backdrop) should never close the popover behind it.
      if (e.target.closest?.('.lightbox')) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKey, true);
    // pointerdown (capture) too so a tap-away closes it on touch.
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose, lightboxIdx, data.images.length]);

  const openTag = () => {
    onClose?.();
    document.dispatchEvent(new CustomEvent('soleil-open-tag', { detail: { tagId } }));
  };

  const total = data.total;
  const hasAny = data.images.length || data.palettes.length || data.other.length;
  const go = (target) => { onClose?.(); navigate(target); };

  return createPortal(
    <>
    <div ref={popRef}
         className={`tag-pop tag-pop-from-${openSide} ${enter ? 'is-in' : ''}`}
         style={{ top: pos.top, left: pos.left, width: pos.w ?? W, '--tag-color': tagColor }}
         onMouseEnter={onMouseEnter}
         onMouseLeave={onMouseLeave}>
      <button className="tag-pop-header" onClick={openTag} title="Open tag detail">
        <span className="tag-pop-stamp" aria-hidden="true" />
        <span className="tag-pop-name">{tagName || 'Tag'}</span>
        {total > 0 && (
          <span className="tag-pop-count">{total} {total === 1 ? 'item' : 'items'}</span>
        )}
      </button>

      {data.loading && <div className="tag-pop-empty">Loading…</div>}

      {!data.loading && !hasAny && (
        <div className="tag-pop-empty">No other items tagged.</div>
      )}

      {data.images.length > 0 && (
        <div className="tag-pop-images">
          {data.images.map((im, i) => (
            <button key={i} className="tag-pop-thumb"
                    onClick={() => setLightboxIdx(i)}
                    title={im.title || 'Image'}>
              <R2Image src={im.src} alt="" />
            </button>
          ))}
        </div>
      )}

      {data.palettes.length > 0 && (
        <div className="tag-pop-palettes">
          {data.palettes.map((p, i) => {
            // Palette swatches come from card metadata as either plain
            // hex strings (legacy) or { name, hex } objects (current —
            // see cards.jsx / CanvasSurface.jsx). Normalize before
            // setting background, or invalid CSS makes the strip blank.
            const colors = (p.swatches || [])
              .map(c => (typeof c === 'string' ? c : c?.hex))
              .filter(Boolean)
              .slice(0, 10);
            return (
              <button key={i} className="tag-pop-palette"
                      onClick={() => go(p.navTarget)} title={p.title || 'Palette'}>
                <span className="tag-pop-palette-swatches">
                  {colors.map((color, j) => (
                    <span key={j} style={{ background: color }} />
                  ))}
                </span>
                {p.title && <span className="tag-pop-palette-title">{p.title}</span>}
              </button>
            );
          })}
        </div>
      )}

      {data.other.length > 0 && (
        <div className="tag-pop-list">
          {data.other.map((p, i) => {
            const Icn = KIND_ICON[p.kind] || StickyNote;
            return (
              <button key={i} className="tag-pop-row"
                      onClick={() => go(p.navTarget)} title={p.title}>
                <span className="tag-pop-row-icon"><Icon as={Icn} size={12} /></span>
                <span className="tag-pop-row-title">{p.title}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="tag-pop-footer-row">
        {onRemove && sourceAnchor && (
          <button className="tag-pop-footer tag-pop-footer-danger"
                  onClick={() => onRemove(sourceAnchor)}>
            Remove tag
          </button>
        )}
        <button className="tag-pop-footer" onClick={openTag}>
          View tag <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
    {lightboxIdx != null && data.images[lightboxIdx] && (
      <ImageLightbox
        src={data.images[lightboxIdx].src}
        title={data.images[lightboxIdx].title || ''}
        alt={data.images[lightboxIdx].title || ''}
        onClose={() => setLightboxIdx(null)}
      />
    )}
    </>,
    document.body,
  );
}

// Convenience: detect tag-range data from a DOM element. Kept for
// callers that might want to revive text-hover later; currently unused
// since the margin dot is the only hover trigger.
export function readTagRangeFromEl(el) {
  const target = el?.closest?.('.tt-tag-range, .tt-tag-word');
  if (!target) return null;
  const tagId = target.getAttribute('data-tag-id') || null;
  const tagName = target.getAttribute('data-tag-name') || null;
  const style = target.getAttribute('style') || '';
  const colorMatch = style.match(/--tag-color:\s*([^;]+)/);
  const tagColor = colorMatch ? colorMatch[1].trim() : '#888';
  // Read the source_anchor that the TagRangePlugin painted onto the
  // element so callers can identify the exact entity_links row (for
  // remove-tag, for example).
  const pHash = target.getAttribute('data-phash') || null;
  const startStr = target.getAttribute('data-start');
  const lengthStr = target.getAttribute('data-length');
  const startOffset = startStr === '' || startStr == null ? null : Number(startStr);
  const length = lengthStr === '' || lengthStr == null ? null : Number(lengthStr);
  const sourceAnchor = pHash && Number.isFinite(startOffset) && Number.isFinite(length)
    ? { pHash, startOffset, length } : null;
  return { el: target, tagId, tagName, tagColor, sourceAnchor };
}
