// Compact tag popover that opens from a left-margin dot (DocTagGutter).
//
// Layout (~260px wide):
//   ┌──────────────────────────────────────┐
//   │ ▣  Pricing Plans            14 items │   chip header (color stamp + name + count)
//   │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
//   │ ▢ thumb   Free plan                  │   peek rows (cap 4)
//   │ ▢▢▢       Pricing palette            │
//   │ ◇         Pricing tiers doc          │
//   │ ◇         Personal Pricing           │
//   │                       View tag →     │   footer link (on hover)
//   └──────────────────────────────────────┘
//
// Tag color appears as a small rounded stamp in the header and tints
// the box-shadow so the popover feels bound to the tag without the
// heavy left stripe of the prior design. Translucent backdrop + a
// short slide-in from the anchor side complete the lighter feel.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Image as ImageIcon, Palette as PaletteIcon, Calendar, Link as LinkIcon, Tag as TagIcon } from '../lib/icons.js';
import { R2Image } from './R2Image.jsx';
import { supabase } from '../lib/supabase.js';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';

const PAD = 8;
const W = 260;
const MAX_PEEK = 4;

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
  const [openSide, setOpenSide] = useState('right'); // which side of the anchor we ended up on
  const [enter, setEnter] = useState(false);
  const navigate = useEntityNavigate();

  const [peeks, setPeeks] = useState({ rows: [], total: 0, loading: true });

  useEffect(() => {
    // Trigger entrance transition on the next frame.
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
          .limit(40);
        if (cancelled) return;
        const rows = links || [];
        // Hydrate via entity_search for the bulk of kinds.
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
        const hydrated = [];
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
          const title = (hit.title || '').trim() || (hit.body || '').trim().slice(0, 40);
          if (!title) continue;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          hydrated.push({
            kind: hit.kind || r.source_kind,
            title,
            row: hit,
            navTarget,
          });
          if (hydrated.length >= MAX_PEEK) break;
        }
        if (!cancelled) setPeeks({ rows: hydrated, total: count ?? rows.length, loading: false });
      } catch (_) {
        if (!cancelled) setPeeks({ rows: [], total: 0, loading: false });
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
      // Vertically center on the dot, then clamp.
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
  }, [anchor, peeks.rows.length]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onDown = (e) => {
      if (!popRef.current) return;
      if (popRef.current.contains(e.target)) return;
      // Don't close if the click was on the dot or tinted word that
      // OPENED the popover — that just causes a flash close+reopen.
      if (e.target.closest?.('.doc-tag-gutter-dot, .tt-tag-word')) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const openTag = () => {
    onClose?.();
    document.dispatchEvent(new CustomEvent('soleil-open-tag', { detail: { tagId } }));
  };

  const total = peeks.total;

  return createPortal(
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
      {peeks.loading && (
        <div className="tag-pop-empty">Loading…</div>
      )}
      {!peeks.loading && peeks.rows.length === 0 && (
        <div className="tag-pop-empty">No other items tagged.</div>
      )}
      {peeks.rows.length > 0 && (
        <div className="tag-pop-list">
          {peeks.rows.map((p, i) => (
            <PeekRow key={i} peek={p}
                     onClick={() => { onClose?.(); navigate(p.navTarget); }} />
          ))}
        </div>
      )}
      <button className="tag-pop-footer" onClick={openTag}>
        View tag <span aria-hidden="true">→</span>
      </button>
    </div>,
    document.body,
  );
}

function PeekRow({ peek, onClick }) {
  const Icn = KIND_ICON[peek.kind] || StickyNote;
  const meta = peek.row?.meta || null;
  // Visual preview where it makes sense — same rule the tag detail
  // view uses: image + palette get a thumbnail; everything else
  // shows just the kind icon.
  let visual = null;
  if (peek.kind === 'image' && meta?.src) {
    visual = (
      <span className="tag-pop-row-thumb is-image">
        <R2Image src={meta.src} alt="" />
      </span>
    );
  } else if (peek.kind === 'palette' && Array.isArray(meta?.swatches) && meta.swatches.length) {
    visual = (
      <span className="tag-pop-row-thumb is-palette">
        {meta.swatches.slice(0, 4).map((c, i) => (
          <span key={i} style={{ background: c }} />
        ))}
      </span>
    );
  } else {
    visual = (
      <span className="tag-pop-row-thumb is-icon">
        <Icon as={Icn} size={12} />
      </span>
    );
  }
  return (
    <button className="tag-pop-row" onClick={onClick} title={peek.title}>
      {visual}
      <span className="tag-pop-row-title">{peek.title}</span>
    </button>
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
