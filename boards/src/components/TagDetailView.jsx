// "Tag detail" surface — a scroll-through preview of every board,
// group, and card carrying this tag. Layout is a HIERARCHY rather
// than a flat list:
//
//   [Pricing board]
//     ├─ Personal Pricing  (tagged group)
//     │   • Free / 10GB of space
//     │   • $10 mo / 100GB
//     │   • $25 mo / unlimited
//     ├─ Business Pricing  (tagged group)
//     │   • $8 / per user
//     │   • $20 / per user
//     └─ School Pricing  (tagged group)
//         • $12 / per user
//
// Every item title is clickable (navigates to the source) and
// right-clickable (Remove tag / Confirm / Don't suggest again).
// A filter pill at the top toggles between All / Auto / Manual.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Image, Palette, Calendar, Link as LinkIcon } from '../lib/icons.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import {
  untagCard, untagBoard, untagGroup,
  confirmAppliedTag, dismissAutotagSuggestion,
} from '../lib/tagsApi.js';
import { useFeedback } from './AppFeedback.jsx';

const KIND_ICON = {
  board: LayoutGrid, doc: FileText, group: LayoutGrid,
  card: StickyNote, note: StickyNote, image: Image,
  palette: Palette, schedule: Calendar, link: LinkIcon,
};

function kindIcon(kind) { return KIND_ICON[kind] || StickyNote; }

function itemExcerpt(it) {
  const title = (it.title || '').trim();
  if (title) return title;
  const body = (it.body || it.card_body || '').trim();
  if (body) return body.length > 100 ? body.slice(0, 97) + '…' : body;
  return null;
}

const TAG_PALETTE = [
  '#4f8df8', '#22d3ee', '#10b981', '#84cc16', '#f59e0b',
  '#ef4444', '#ec4899', '#a78bfa', '#6366f1', '#0ea5e9',
];
function fallbackColor(slugOrName) {
  const s = (slugOrName || '').toString();
  let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

export function TagDetailView({ tag, workspaceId, userId, onOpenItem, onClose }) {
  const feedback = useFeedback();
  const [rows, setRows] = useState([]);
  const [boardCards, setBoardCards] = useState(new Map());
  const [groupCards, setGroupCards] = useState(new Map());
  const [loading, setLoading] = useState(true);
  // Filter: 'all' | 'auto' | 'user'. Stored in localStorage so the
  // user's choice persists across reloads / tab switches.
  const [sourceFilter, setSourceFilter] = useState(() => {
    if (typeof localStorage === 'undefined') return 'all';
    try {
      const v = localStorage.getItem('soleil.tags.detail.filter');
      return (v === 'auto' || v === 'user') ? v : 'all';
    } catch (_) { return 'all'; }
  });
  const setFilter = (v) => {
    setSourceFilter(v);
    try { localStorage.setItem('soleil.tags.detail.filter', v); } catch (_) {}
  };
  // Right-click menu state.
  const [menu, setMenu] = useState(null); // { x, y, kind, id, boardId, source }
  useEffect(() => {
    if (!menu) return;
    const onAway = (e) => { if (!e.target.closest?.('.tag-detail-menu')) setMenu(null); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', onAway, { capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onAway, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!tag?.id) { setRows([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    supabase.rpc('get_things_tagged', { p_tag_id: tag.id, p_limit: 300 })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.warn('[tags] get_things_tagged failed', error); setRows([]); }
        else { setRows(Array.isArray(data) ? data : []); }
      })
      .catch(err => { console.warn('[tags] get_things_tagged failed', err); })
      .finally(() => { if (!cancelled) setLoading(false); });

    const sfx = Math.random().toString(36).slice(2, 9);
    const chan = supabase.channel(`tag-detail:${tag.id}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'entity_links',
      }, (payload) => {
        const n = payload?.new || {};
        const o = payload?.old || {};
        const isThisTag =
          (n.target_kind === 'tag' && n.target_id === tag.id && n.link_kind === 'applied') ||
          (o.target_kind === 'tag' && o.target_id === tag.id && o.link_kind === 'applied');
        if (!isThisTag) return;
        supabase.rpc('get_things_tagged', { p_tag_id: tag.id, p_limit: 300 })
          .then(({ data }) => { if (!cancelled) setRows(Array.isArray(data) ? data : []); })
          .catch(() => {});
      })
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(chan); } catch (_) {}
    };
  }, [tag?.id]);

  // Filtered rows by source. Filter applies to directly-tagged items
  // only — child previews are content, not tag applications.
  const filteredRows = useMemo(() => {
    if (sourceFilter === 'all') return rows;
    return rows.filter(r => {
      const src = r.applied_source || 'user';
      if (sourceFilter === 'user') return src === 'user';
      if (sourceFilter === 'auto') return src !== 'user';
      return true;
    });
  }, [rows, sourceFilter]);

  const direct = useMemo(() => {
    const out = { boards: [], groups: [], cards: [] };
    for (const r of filteredRows) {
      if (r.kind === 'board') out.boards.push(r);
      else if (r.kind === 'group') out.groups.push(r);
      else out.cards.push(r);
    }
    return out;
  }, [filteredRows]);

  const hasOwnText = (c) =>
    (c.title && c.title.trim().length > 0) ||
    (c.body  && c.body.trim().length  > 0);

  // Keep these queries on the UNFILTERED boards/groups so changing
  // the filter doesn't re-fetch. The filter is purely a render gate.
  const allBoards = useMemo(() => rows.filter(r => r.kind === 'board'), [rows]);
  const allGroups = useMemo(() => rows.filter(r => r.kind === 'group'), [rows]);

  useEffect(() => {
    if (allBoards.length === 0) return;
    let cancelled = false;
    const ids = allBoards.map(b => b.board_id || b.id).filter(Boolean);
    if (ids.length === 0) return;
    supabase.from('card_index')
      .select('board_id, card_id, kind, title, body, meta, updated_at')
      .in('board_id', ids)
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        const m = new Map();
        for (const c of (data || [])) {
          if (!hasOwnText(c)) continue;
          if (!m.has(c.board_id)) m.set(c.board_id, []);
          m.get(c.board_id).push(c);
        }
        setBoardCards(m);
      });
    return () => { cancelled = true; };
  }, [allBoards]);

  useEffect(() => {
    if (allGroups.length === 0) return;
    let cancelled = false;
    const allBoardIds = allGroups.map(g => g.board_id).filter(Boolean);
    if (allBoardIds.length === 0) return;
    supabase.from('card_index')
      .select('board_id, card_id, kind, title, body, meta, updated_at')
      .in('board_id', allBoardIds)
      .then(({ data }) => {
        if (cancelled) return;
        const m = new Map();
        for (const c of (data || [])) {
          if (!hasOwnText(c)) continue;
          const gid = c.meta?.groupId;
          if (!gid) continue;
          const key = `${c.board_id}::${gid}`;
          if (!m.has(key)) m.set(key, []);
          m.get(key).push(c);
        }
        setGroupCards(m);
      });
    return () => { cancelled = true; };
  }, [allGroups]);

  if (!tag) return null;
  const dot = tag.color || fallbackColor(tag.slug || tag.name);

  // Index for "is this card directly tagged" lookup — controls
  // whether the right-click menu offers Remove vs nothing.
  const directCardKey = (boardId, cardId) => `${boardId}:${cardId}`;
  const directCardSet = useMemo(() => {
    const s = new Map(); // key -> applied_source
    for (const c of (direct.cards || [])) {
      const k = directCardKey(c.board_id, c.card_id);
      s.set(k, c.applied_source || 'user');
    }
    return s;
  }, [direct.cards]);

  // ── Actions ─────────────────────────────────────────────────────────────
  // Remove always dismisses too. Otherwise the autotag triggers
  // re-apply the tag on the next card_index UPDATE if the text
  // word-matches — making "Remove tag" pointless. Dismissing on
  // remove makes the action stick. To bring the tag back, just
  // manually re-tag the item; the user-application path clears the
  // dismissal so it doesn't get filtered next round.
  const removeTag = async (target) => {
    try {
      const targetKind = target.kind === 'group' ? 'group' :
                         target.kind === 'board' ? 'board' : 'card';
      if (targetKind === 'card') {
        await untagCard({ boardId: target.boardId, cardId: target.id, tagId: tag.id });
      } else if (targetKind === 'board') {
        await untagBoard({ boardId: target.id, tagId: tag.id });
      } else if (targetKind === 'group') {
        await untagGroup({ boardId: target.boardId, groupId: target.id, tagId: tag.id });
      }
      await dismissAutotagSuggestion({
        workspaceId: workspaceId || tag.workspace_id,
        targetKind, targetId: target.id, tagId: tag.id, userId,
      });
    } catch (err) {
      feedback?.toast?.({ type: 'error', message: 'Remove failed: ' + (err.message || err) });
    }
  };

  const confirmTag = async (target) => {
    try {
      const sourceKind = target.kind === 'group' ? 'group' :
                         target.kind === 'board' ? 'board' : 'card';
      const sourceBoardId = sourceKind === 'card' ? target.boardId :
                            sourceKind === 'group' ? target.boardId : null;
      await confirmAppliedTag({ sourceKind, sourceId: target.id, sourceBoardId, tagId: tag.id });
    } catch (err) {
      feedback?.toast?.({ type: 'error', message: 'Confirm failed: ' + (err.message || err) });
    }
  };

  const navigate = (target) => {
    onOpenItem?.(target);
  };

  const openMenu = (e, target) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ ...target, x: e.clientX, y: e.clientY });
  };

  // ── Render helpers ──────────────────────────────────────────────────────

  const renderCardPreview = (c) => {
    const Icn = kindIcon(c.kind);
    const excerpt = itemExcerpt(c);
    const dKey = directCardKey(c.board_id, c.card_id);
    const directSource = directCardSet.get(dKey); // undefined if not tagged
    const navTarget = {
      kind: c.kind, id: `${c.board_id}:${c.card_id}`,
      board_id: c.board_id, card_id: c.card_id,
    };
    const menuTarget = {
      kind: c.kind, id: c.card_id, boardId: c.board_id,
      source: directSource, // null if it's a child preview, not directly tagged
    };
    return (
      <button key={`c:${c.board_id}:${c.card_id}`}
              className="tag-detail-card-preview"
              title="Click to open · right-click for actions"
              onClick={() => navigate(navTarget)}
              onContextMenu={(e) => openMenu(e, menuTarget)}>
        <span className="tag-detail-card-preview-kind">
          <Icon as={Icn} size={11} />
        </span>
        <span className="tag-detail-card-preview-text">
          {excerpt || <span className="tag-detail-card-preview-empty">empty {c.kind}</span>}
        </span>
        {directSource && directSource !== 'user' && (
          <span className="tag-detail-card-preview-badge">{directSource}</span>
        )}
      </button>
    );
  };

  const renderGroupBlock = (g, opts = {}) => {
    const key = `${g.board_id}::${g.group_id || g.id}`;
    const cards = groupCards.get(key) || [];
    const sourceBadge = g.applied_source && g.applied_source !== 'user' ? g.applied_source : null;
    const navTarget = { kind: 'board', id: g.board_id, board_id: g.board_id };
    const menuTarget = {
      kind: 'group', id: g.group_id || g.id, boardId: g.board_id,
      source: g.applied_source || 'user',
    };
    return (
      <div key={`grp:${key}`} className="tag-detail-group-block">
        <div className="tag-detail-block-head">
          <Icon as={LayoutGrid} size={12} />
          <button className="tag-detail-block-title-link"
                  title="Click to open the parent board · right-click for actions"
                  onClick={() => navigate(navTarget)}
                  onContextMenu={(e) => openMenu(e, menuTarget)}>
            {g.title || 'Group'}
          </button>
          {opts.boardCrumb && g.board_name && (
            <span className="tag-detail-block-crumb">{g.board_name}</span>
          )}
          {g.member_count != null && (
            <span className="tag-detail-block-attr is-count">{g.member_count}</span>
          )}
          {sourceBadge && (
            <span className={`tag-detail-block-attr is-${sourceBadge}`}>{sourceBadge}</span>
          )}
        </div>
        {cards.length > 0 ? (
          <div className="tag-detail-card-grid">
            {cards.map(renderCardPreview)}
          </div>
        ) : (
          <div className="tag-detail-block-empty">No cards in this group yet.</div>
        )}
      </div>
    );
  };

  const renderBoardBlock = (b) => {
    const id = b.board_id || b.id;
    const allCards = boardCards.get(id) || [];
    const groupedHere = direct.groups.filter(g => g.board_id === id);
    const groupedHereKeys = new Set(groupedHere.map(g => `${g.board_id}::${g.group_id || g.id}`));
    const groupedCardKeys = new Set();
    for (const k of groupedHereKeys) {
      const arr = groupCards.get(k) || [];
      for (const c of arr) groupedCardKeys.add(`${c.board_id}::${c.card_id}`);
    }
    const looseCards = allCards.filter(c => !groupedCardKeys.has(`${c.board_id}::${c.card_id}`));
    const sourceBadge = b.applied_source && b.applied_source !== 'user' ? b.applied_source : null;
    const navTarget = { kind: 'board', id, board_id: id };
    const menuTarget = { kind: 'board', id, boardId: id, source: b.applied_source || 'user' };
    return (
      <div key={`brd:${id}`} className="tag-detail-board-block">
        <div className="tag-detail-block-head is-board">
          <Icon as={LayoutGrid} size={13} />
          <button className="tag-detail-block-title-link"
                  title="Click to open · right-click for actions"
                  onClick={() => navigate(navTarget)}
                  onContextMenu={(e) => openMenu(e, menuTarget)}>
            {b.title || 'Board'}
          </button>
          {sourceBadge && (
            <span className={`tag-detail-block-attr is-${sourceBadge}`}>{sourceBadge}</span>
          )}
        </div>
        {groupedHere.map(g => renderGroupBlock(g))}
        {looseCards.length > 0 && (
          <div className="tag-detail-card-grid">
            {looseCards.map(renderCardPreview)}
          </div>
        )}
      </div>
    );
  };

  const orphanGroups = direct.groups.filter(g => !direct.boards.some(b => (b.board_id || b.id) === g.board_id));
  const taggedBoardIds = new Set(direct.boards.map(b => b.board_id || b.id));
  const orphanCards = direct.cards.filter(c => !taggedBoardIds.has(c.board_id));

  // Quick counts for filter pills (raw counts, not filtered).
  const counts = useMemo(() => {
    let auto = 0, user = 0;
    for (const r of rows) {
      if ((r.applied_source || 'user') === 'user') user += 1;
      else auto += 1;
    }
    return { all: rows.length, auto, user };
  }, [rows]);

  return (
    <div className="tag-detail">
      <div className="tag-detail-head">
        <span className="tag-detail-dot" style={{ background: dot }} />
        <h1 className="tag-detail-name">{tag.name}</h1>
        <span className="tag-detail-count">
          {filteredRows.length} {filteredRows.length === 1 ? 'item' : 'items'}
        </span>
        <span className="tag-detail-spacer" />
        {onClose && (
          <button className="tag-detail-close" onClick={onClose} aria-label="Close">×</button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="tag-detail-filter">
          <button className={`tag-detail-filter-pill ${sourceFilter === 'all' ? 'is-on' : ''}`}
                  onClick={() => setFilter('all')}>
            All <span className="tag-detail-filter-count">{counts.all}</span>
          </button>
          <button className={`tag-detail-filter-pill ${sourceFilter === 'user' ? 'is-on' : ''}`}
                  onClick={() => setFilter('user')}>
            Manual <span className="tag-detail-filter-count">{counts.user}</span>
          </button>
          <button className={`tag-detail-filter-pill ${sourceFilter === 'auto' ? 'is-on' : ''}`}
                  onClick={() => setFilter('auto')}>
            Auto <span className="tag-detail-filter-count">{counts.auto}</span>
          </button>
        </div>
      )}

      <div className="tag-detail-body">
        {loading && <div className="tag-detail-empty">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="tag-detail-empty">
            Nothing tagged with <strong>{tag.name}</strong> yet.
            <div className="tag-detail-empty-hint">
              Right-click a card and choose Tag…, or drag this tag onto something.
            </div>
          </div>
        )}
        {!loading && rows.length > 0 && filteredRows.length === 0 && (
          <div className="tag-detail-empty">
            No {sourceFilter === 'auto' ? 'auto-applied' : 'manually applied'} items.
          </div>
        )}

        {direct.boards.map(renderBoardBlock)}
        {orphanGroups.map(g => renderGroupBlock(g, { boardCrumb: true }))}

        {orphanCards.length > 0 && (
          <div className="tag-detail-loose-cards">
            <div className="tag-detail-block-head">
              <Icon as={StickyNote} size={12} />
              <span className="tag-detail-block-title">Other items</span>
              <span className="tag-detail-block-attr is-count">{orphanCards.length}</span>
            </div>
            <div className="tag-detail-card-grid">
              {orphanCards.map(c => renderCardPreview({
                board_id: c.board_id, card_id: c.card_id, kind: c.kind,
                title: c.title, body: c.card_body || c.body,
                applied_source: c.applied_source,
              }))}
            </div>
          </div>
        )}
      </div>

      {menu && (
        <div className="tag-detail-menu" role="menu"
             style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 60 }}
             onMouseDown={(e) => e.stopPropagation()}>
          <button className="tag-detail-menu-item" role="menuitem"
                  onClick={() => {
                    const m = menu; setMenu(null);
                    navigate({
                      kind: m.kind === 'group' ? 'board' : m.kind,
                      id: m.kind === 'group' ? m.boardId
                          : (m.kind === 'board' ? m.id : `${m.boardId}:${m.id}`),
                      board_id: m.boardId, card_id: m.kind !== 'board' && m.kind !== 'group' ? m.id : undefined,
                    });
                  }}>
            Open
          </button>
          {menu.source && menu.source !== 'user' && (
            <button className="tag-detail-menu-item" role="menuitem"
                    onClick={() => { const m = menu; setMenu(null); confirmTag(m); }}>
              Confirm tag
            </button>
          )}
          {menu.source && (
            <button className="tag-detail-menu-item" role="menuitem"
                    title="Removes this tag and won't auto-apply it here again. Drag it back to undo."
                    onClick={() => { const m = menu; setMenu(null); removeTag(m); }}>
              Remove tag
            </button>
          )}
          {!menu.source && (
            <span className="tag-detail-menu-hint">
              This card isn't tagged directly — it shows here because its board/group is.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
