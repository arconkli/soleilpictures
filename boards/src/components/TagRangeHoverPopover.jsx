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
import { supabase } from '../lib/supabase.js';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';

const PAD = 8;
const W = 320;
// Per-section caps. The image grid is scrollable, so we collect a lot
// — including images pulled transitively from tagged groups/boards.
// The AI can't see image content, so almost no images are ever tagged
// directly; the only realistic path is via a tagged container.
const MAX_IMAGES = 120;
const MAX_PALETTES = 3;
const MAX_OTHER = 4;
// We fetch more than we'll show so each section has enough candidates
// to fill its cap. Caps apply per-kind, not globally.
const FETCH_LIMIT = 80;
// Per-container scan cap. A board with thousands of images shouldn't
// pull every row into a hover popover.
const IMAGES_PER_CONTAINER = 60;

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
  // lightbox drops them back into the popover scroll.
  const [lightbox, setLightbox] = useState(null);
  const navigate = useEntityNavigate();

  const [data, setData] = useState({
    images: [], palettes: [], other: [], total: 0, loading: true,
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => setEnter(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!supabase || !workspaceId || !tagId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: links, count } = await supabase.from('entity_links')
          .select('source_kind, source_id, source_board_id, source_page_id', { count: 'exact' })
          .eq('source_workspace', workspaceId)
          .eq('target_kind', 'tag')
          .eq('target_id', tagId)
          .eq('link_kind', 'applied')
          .order('created_at', { ascending: false })
          .limit(FETCH_LIMIT);
        if (cancelled) return;
        const rows = links || [];
        const esIds = [];
        const pageIds = [];
        for (const r of rows) {
          if (r.source_kind === 'board') esIds.push(r.source_id);
          else if (r.source_kind === 'group') esIds.push(`${r.source_board_id}:g:${r.source_id}`);
          else if (r.source_kind === 'card' || r.source_kind === 'note') esIds.push(`${r.source_board_id}:${r.source_id}`);
          else if (r.source_kind === 'doc') {
            esIds.push(r.source_id);
            if (r.source_page_id) pageIds.push(r.source_page_id);
          }
        }
        const [esResp, pageResp] = await Promise.all([
          esIds.length
            ? supabase.from('entity_search')
                .select('id, kind, title, body, meta, board_id, card_id')
                .eq('workspace_id', workspaceId)
                .in('id', esIds)
            : Promise.resolve({ data: [] }),
          pageIds.length
            ? supabase.from('doc_page_index')
                .select('doc_card_id, page_id, page_title')
                .in('page_id', pageIds)
            : Promise.resolve({ data: [] }),
        ]);
        const byEs = new Map((esResp.data || []).map(r => [r.id, r]));
        const byPage = new Map((pageResp.data || []).map(r => [r.page_id, r]));
        const seenKeys = new Set();
        // Dedup images by their card identity, not by section key —
        // the same image card might be reachable directly AND via its
        // tagged group, and we should only show it once.
        const seenImageCards = new Set();
        const images = [];
        const palettes = [];
        const other = [];
        // Track tagged groups + boards so we can pull their images
        // transitively after the direct pass below.
        const taggedGroups = []; // [{ boardId, groupId }]
        const taggedBoards = []; // [boardId]
        for (const r of rows) {
          if (r.source_kind === 'group' && r.source_board_id && r.source_id) {
            taggedGroups.push({ boardId: r.source_board_id, groupId: r.source_id });
          } else if (r.source_kind === 'board' && r.source_id) {
            taggedBoards.push(r.source_id);
          }
        }
        for (const r of rows) {
          let key, navTarget, hit;
          if (r.source_kind === 'board') {
            hit = byEs.get(r.source_id);
            key = `board:${r.source_id}`;
            navTarget = { kind: 'board', id: r.source_id };
          } else if (r.source_kind === 'group') {
            hit = byEs.get(`${r.source_board_id}:g:${r.source_id}`);
            key = `group:${r.source_id}`;
            navTarget = { kind: 'board', id: r.source_board_id };
          } else if (r.source_kind === 'doc') {
            if (r.source_page_id) {
              const p = byPage.get(r.source_page_id);
              hit = { kind: 'doc', title: p?.page_title || 'Doc page', board_id: null, card_id: r.source_id, meta: null, body: null };
              key = `doc:${r.source_id}:${r.source_page_id}`;
              navTarget = { kind: 'doc', docCardId: r.source_id, pageId: r.source_page_id };
            } else {
              hit = byEs.get(r.source_id);
              key = `doc:${r.source_id}`;
              navTarget = { kind: 'doc', docCardId: r.source_id };
            }
          } else {
            hit = byEs.get(`${r.source_board_id}:${r.source_id}`);
            key = `${r.source_kind}:${r.source_board_id}:${r.source_id}`;
            navTarget = { kind: r.source_kind, boardId: r.source_board_id, cardId: r.source_id };
          }
          if (!hit) continue;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          const meta = hit.meta || null;
          const title = (hit.title || '').trim() || (hit.body || '').trim().slice(0, 40);

          // Route into the right section. Image + palette skip the
          // title-required gate since their visual IS the content.
          if (hit.kind === 'image' && meta?.src) {
            const cardKey = `${hit.board_id || r.source_board_id}:${hit.card_id || r.source_id}`;
            if (!seenImageCards.has(cardKey) && images.length < MAX_IMAGES) {
              seenImageCards.add(cardKey);
              images.push({ src: meta.src, title, navTarget });
            }
            continue;
          }
          if (hit.kind === 'palette' && Array.isArray(meta?.swatches) && meta.swatches.length) {
            if (palettes.length < MAX_PALETTES) {
              palettes.push({ swatches: meta.swatches, title, navTarget });
            }
            continue;
          }
          if (!title) continue;
          if (other.length < MAX_OTHER) {
            other.push({ kind: hit.kind || r.source_kind, title, navTarget });
          }
        }

        // Transitive pass: any tagged group or board pulls in its
        // image cards. The AI can't see image content so directly-
        // tagged images are rare; tagging the container is the
        // realistic path.
        if (taggedGroups.length || taggedBoards.length) {
          const groupQueries = taggedGroups.map(g => supabase.from('card_index')
            .select('board_id, card_id, title, meta')
            .eq('workspace_id', workspaceId)
            .eq('board_id', g.boardId)
            .eq('kind', 'image')
            .filter('meta->>groupId', 'eq', g.groupId)
            .limit(IMAGES_PER_CONTAINER));
          const boardQueries = taggedBoards.map(b => supabase.from('card_index')
            .select('board_id, card_id, title, meta')
            .eq('workspace_id', workspaceId)
            .eq('board_id', b)
            .eq('kind', 'image')
            .limit(IMAGES_PER_CONTAINER));
          const responses = await Promise.all([...groupQueries, ...boardQueries]);
          if (cancelled) return;
          for (const resp of responses) {
            for (const c of (resp.data || [])) {
              if (images.length >= MAX_IMAGES) break;
              const src = c.meta?.src;
              if (!src) continue;
              const cardKey = `${c.board_id}:${c.card_id}`;
              if (seenImageCards.has(cardKey)) continue;
              seenImageCards.add(cardKey);
              images.push({
                src,
                title: c.title || '',
                navTarget: { kind: 'image', boardId: c.board_id, cardId: c.card_id },
              });
            }
            if (images.length >= MAX_IMAGES) break;
          }
        }

        if (!cancelled) setData({
          images, palettes, other,
          total: count ?? rows.length,
          loading: false,
        });
      } catch (_) {
        if (!cancelled) setData({ images: [], palettes: [], other: [], total: 0, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, tagId]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const popH = popRef.current?.scrollHeight || 200;
      const spaceRight = vw - anchor.right - PAD;
      const openLeft = spaceRight < W + PAD;
      const left = openLeft
        ? Math.max(PAD, anchor.left - W - 12)
        : Math.min(vw - W - PAD, anchor.right + 12);
      const desiredTop = anchor.top + (anchor.height / 2) - (popH / 2);
      const top = Math.max(PAD, Math.min(vh - popH - PAD, desiredTop));
      setPos({ top, left });
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
      if (e.key !== 'Escape') return;
      // If the lightbox is open, let it handle Escape first — the
      // user wants to close the image, not the popover.
      if (lightbox) return;
      onClose?.();
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
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose, lightbox]);

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
         style={{ top: pos.top, left: pos.left, width: W, '--tag-color': tagColor }}
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
                    onClick={() => setLightbox({ src: im.src, title: im.title || '', alt: im.title || '' })}
                    title={im.title || 'Image'}>
              <R2Image src={im.src} alt="" />
            </button>
          ))}
        </div>
      )}

      {data.palettes.length > 0 && (
        <div className="tag-pop-palettes">
          {data.palettes.map((p, i) => (
            <button key={i} className="tag-pop-palette"
                    onClick={() => go(p.navTarget)} title={p.title || 'Palette'}>
              <span className="tag-pop-palette-swatches">
                {p.swatches.slice(0, 10).map((c, j) => (
                  <span key={j} style={{ background: c }} />
                ))}
              </span>
              {p.title && <span className="tag-pop-palette-title">{p.title}</span>}
            </button>
          ))}
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

      <button className="tag-pop-footer" onClick={openTag}>
        View tag <span aria-hidden="true">→</span>
      </button>
    </div>
    {lightbox && (
      <ImageLightbox
        src={lightbox.src}
        title={lightbox.title}
        alt={lightbox.alt}
        onClose={() => setLightbox(null)}
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
  return { el: target, tagId, tagName, tagColor };
}
