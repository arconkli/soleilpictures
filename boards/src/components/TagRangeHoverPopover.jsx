// Focused hover popover for tag-applied ranges. Replaces the generic
// EntityHoverPopover whenever the user hovers a `.tt-tag-range` span.
//
// Why a separate component: the generic popover surfaces every entity
// that matches a name (boards, cards, messages, etc.). When the user
// hovers a tagged range, they don't want a name-match list — they
// want to learn about the TAG and quickly jump to it.
//
// Layout:
//   ┌────────────────────────────────┐
//   │ ● Pricing Plans            →  │   header chip + arrow
//   ├────────────────────────────────┤
//   │ Auto-applied to this paragraph │   one-line source explanation
//   ├────────────────────────────────┤
//   │ ALSO TAGGED HERE      (12)     │   recent peeks across workspace
//   │  • Pricing board               │
//   │  • Personal Pricing group      │
//   │  • School Pricing group        │
//   │  • Free tier card              │
//   ├────────────────────────────────┤
//   │            Open tag →          │
//   └────────────────────────────────┘
//
// Single click anywhere on the header (or the footer button) opens
// the tag detail view. Inside the "also tagged" list, clicking a row
// navigates to that item.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Image, Palette, Calendar, Tag as TagIcon } from '../lib/icons.js';
import { supabase } from '../lib/supabase.js';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';

const PAD = 8;
const W = 320;
const MAX_PEEK = 5;

const KIND_ICON = {
  board: LayoutGrid, group: LayoutGrid, doc: FileText,
  card: StickyNote, note: StickyNote, image: Image,
  palette: Palette, schedule: Calendar,
};

const SOURCE_LABEL = {
  'auto-paragraph': 'Auto-applied to this paragraph',
  'auto-sentence':  'Auto-applied to this sentence',
  'auto-word':      'Auto-detected mention',
  'auto-doc':       'Auto-applied to this page',
  'auto':           'Auto-applied',
  'user':           'You applied this tag',
  'ai':             'AI-applied',
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
  const navigate = useEntityNavigate();

  const [peeks, setPeeks] = useState({ rows: [], total: 0, loading: true });

  // Pull a small sample of other places this tag is applied. Cheap
  // single query; results scale fine to dozens of items.
  useEffect(() => {
    if (!supabase || !workspaceId || !tagId) return;
    let cancelled = false;
    (async () => {
      try {
        // Get up to 6 applied rows, prioritizing entity kinds that
        // describe a "container" or named item over arbitrary card ids.
        const { data: links, count } = await supabase.from('entity_links')
          .select('source_kind, source_id, source_board_id, source_page_id', { count: 'exact' })
          .eq('source_workspace', workspaceId)
          .eq('target_kind', 'tag')
          .eq('target_id', tagId)
          .eq('link_kind', 'applied')
          .order('created_at', { ascending: false })
          .limit(50);
        if (cancelled) return;
        const rows = links || [];
        // Hydrate titles. Board/group/doc/card all live in entity_search;
        // doc pages need doc_page_index.
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
          esIds.length ? supabase.from('entity_search').select('id, kind, title, board_id, card_id').eq('workspace_id', workspaceId).in('id', esIds) : Promise.resolve({ data: [] }),
          pageIds.length ? supabase.from('doc_page_index').select('doc_card_id, page_id, page_title').in('page_id', pageIds) : Promise.resolve({ data: [] }),
        ]);
        const byEs = new Map((esResp.data || []).map(r => [r.id, r]));
        const byPage = new Map((pageResp.data || []).map(r => [r.page_id, r]));
        const hydrated = [];
        const seenKeys = new Set();
        for (const r of rows) {
          let title = '';
          let kind = r.source_kind;
          let key, navTarget;
          if (r.source_kind === 'board') {
            const e = byEs.get(r.source_id);
            title = e?.title || '';
            key = `board:${r.source_id}`;
            navTarget = { kind: 'board', id: r.source_id };
          } else if (r.source_kind === 'group') {
            const e = byEs.get(`${r.source_board_id}:g:${r.source_id}`);
            title = e?.title || 'Group';
            key = `group:${r.source_id}`;
            navTarget = { kind: 'board', id: r.source_board_id };
          } else if (r.source_kind === 'doc') {
            if (r.source_page_id) {
              const p = byPage.get(r.source_page_id);
              title = p?.page_title || 'Doc page';
              key = `doc:${r.source_id}:${r.source_page_id}`;
              navTarget = { kind: 'doc', docCardId: r.source_id, pageId: r.source_page_id };
            } else {
              const e = byEs.get(r.source_id);
              title = e?.title || 'Doc';
              key = `doc:${r.source_id}`;
              navTarget = { kind: 'doc', docCardId: r.source_id };
            }
          } else {
            const e = byEs.get(`${r.source_board_id}:${r.source_id}`);
            title = e?.title || (r.source_kind === 'note' ? 'Note' : 'Card');
            key = `${r.source_kind}:${r.source_board_id}:${r.source_id}`;
            navTarget = { kind: r.source_kind, boardId: r.source_board_id, cardId: r.source_id };
          }
          if (!title.trim()) continue;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          hydrated.push({ kind, title: title.trim(), navTarget });
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
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchor, peeks.rows.length]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose?.();
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

  const sourceLabel = SOURCE_LABEL[source] || 'Tagged';

  return createPortal(
    <div ref={popRef}
         className="tag-hover-pop surface-frosted"
         style={{ top: pos.top, left: pos.left, width: W }}
         onMouseEnter={onMouseEnter}
         onMouseLeave={onMouseLeave}>
      <button className="tag-hover-pop-head" onClick={openTag} title="Open tag">
        <span className="tag-hover-pop-dot" style={{ background: tagColor }} />
        <span className="tag-hover-pop-name">{tagName || 'Tag'}</span>
        <span className="tag-hover-pop-arrow">→</span>
      </button>
      <div className="tag-hover-pop-source">{sourceLabel}</div>
      {peeks.rows.length > 0 && (
        <div className="tag-hover-pop-list">
          <div className="tag-hover-pop-list-head">
            <span>Also tagged here</span>
            {peeks.total > peeks.rows.length && (
              <span className="tag-hover-pop-list-more">{peeks.total}</span>
            )}
          </div>
          {peeks.rows.map((p, i) => {
            const Icn = KIND_ICON[p.kind] || StickyNote;
            return (
              <button key={i}
                      className="tag-hover-pop-row"
                      onClick={() => { onClose?.(); navigate(p.navTarget); }}>
                <Icon as={Icn} size={11} />
                <span className="tag-hover-pop-row-title">{p.title}</span>
              </button>
            );
          })}
        </div>
      )}
      {peeks.loading && (
        <div className="tag-hover-pop-list">
          <div className="tag-hover-pop-list-head">Loading…</div>
        </div>
      )}
      <button className="tag-hover-pop-foot" onClick={openTag}>
        Open tag →
      </button>
    </div>,
    document.body,
  );
}

// Convenience: detect tag-range data from a DOM element produced by
// TagRangePlugin. Returns null if `el` isn't (or isn't inside) a tag
// range element.
export function readTagRangeFromEl(el) {
  const target = el?.closest?.('.tt-tag-range');
  if (!target) return null;
  const tagId = target.getAttribute('data-tag-id') || null;
  const tagName = target.getAttribute('data-tag-name') || null;
  const style = target.getAttribute('style') || '';
  // Inline style sets --tag-color: <hex>. Pull it back out.
  const colorMatch = style.match(/--tag-color:\s*([^;]+)/);
  const tagColor = colorMatch ? colorMatch[1].trim() : '#888';
  return { el: target, tagId, tagName, tagColor };
}
