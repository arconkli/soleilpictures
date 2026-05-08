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
// You can read the entire tag at a glance — no per-item click
// required. Cards under a tagged board / group are fetched
// inline (card_index lookup) and labeled with their actual body
// text. Empty cards are still rendered, just dimmed, so the
// hierarchy stays intact.
//
// Data source: get_things_tagged(tag_id) for the directly-tagged
// rows; card_index for the children of each tagged board / group.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Image, Palette, Calendar, Link as LinkIcon } from '../lib/icons.js';
import { relativeTimeShort } from '../lib/relativeTime.js';

const KIND_ICON = {
  board: LayoutGrid, doc: FileText, group: LayoutGrid,
  card: StickyNote, note: StickyNote, image: Image,
  palette: Palette, schedule: Calendar, link: LinkIcon,
};

function kindIcon(kind) { return KIND_ICON[kind] || StickyNote; }

// Excerpt for any item that lacks a real title — falls back to body.
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

export function TagDetailView({ tag, onOpenItem, onClose }) {
  const [rows, setRows] = useState([]);                  // directly tagged rows
  const [boardCards, setBoardCards] = useState(new Map()); // boardId -> cards
  const [groupCards, setGroupCards] = useState(new Map()); // groupKey -> cards
  const [loading, setLoading] = useState(true);

  // Reload directly-tagged rows.
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

  // Partition directly-tagged rows by kind.
  const direct = useMemo(() => {
    const out = { boards: [], groups: [], cards: [] };
    for (const r of rows) {
      if (r.kind === 'board') out.boards.push(r);
      else if (r.kind === 'group') out.groups.push(r);
      else out.cards.push(r);
    }
    return out;
  }, [rows]);

  // For each tagged board, fetch ALL its cards from card_index so
  // the user can scroll through them as previews.
  useEffect(() => {
    if (direct.boards.length === 0) return;
    let cancelled = false;
    const ids = direct.boards.map(b => b.board_id || b.id).filter(Boolean);
    if (ids.length === 0) return;
    supabase.from('card_index')
      .select('board_id, card_id, kind, title, body, meta, updated_at')
      .in('board_id', ids)
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        const m = new Map();
        for (const c of (data || [])) {
          if (!m.has(c.board_id)) m.set(c.board_id, []);
          m.get(c.board_id).push(c);
        }
        setBoardCards(m);
      });
    return () => { cancelled = true; };
  }, [direct.boards]);

  // For each tagged group, fetch its member cards (cards whose
  // card_index.meta.groupId matches).
  useEffect(() => {
    if (direct.groups.length === 0) return;
    let cancelled = false;
    const allBoardIds = direct.groups.map(g => g.board_id).filter(Boolean);
    if (allBoardIds.length === 0) return;
    // We can't filter on a JSON path with `in()` so we fetch all
    // cards for these boards and partition client-side.
    supabase.from('card_index')
      .select('board_id, card_id, kind, title, body, meta, updated_at')
      .in('board_id', allBoardIds)
      .then(({ data }) => {
        if (cancelled) return;
        const m = new Map();
        for (const c of (data || [])) {
          const gid = c.meta?.groupId;
          if (!gid) continue;
          const key = `${c.board_id}::${gid}`;
          if (!m.has(key)) m.set(key, []);
          m.get(key).push(c);
        }
        setGroupCards(m);
      });
    return () => { cancelled = true; };
  }, [direct.groups]);

  if (!tag) return null;
  const dot = tag.color || fallbackColor(tag.slug || tag.name);

  // Render helpers ----------------------------------------------------------

  const renderCardPreview = (c) => {
    const Icn = kindIcon(c.kind);
    const excerpt = itemExcerpt(c);
    return (
      <button key={`c:${c.board_id}:${c.card_id}`}
              className="tag-detail-card-preview"
              onClick={() => onOpenItem?.({
                kind: c.kind, id: `${c.board_id}:${c.card_id}`,
                board_id: c.board_id, card_id: c.card_id,
              })}>
        <span className="tag-detail-card-preview-kind">
          <Icon as={Icn} size={11} />
        </span>
        <span className="tag-detail-card-preview-text">
          {excerpt || <span className="tag-detail-card-preview-empty">empty {c.kind}</span>}
        </span>
      </button>
    );
  };

  const renderGroupBlock = (g, opts = {}) => {
    const key = `${g.board_id}::${g.group_id || g.id}`;
    const cards = groupCards.get(key) || [];
    const sourceBadge = g.applied_source && g.applied_source !== 'user' ? g.applied_source : null;
    return (
      <div key={`grp:${key}`} className="tag-detail-group-block">
        <div className="tag-detail-block-head">
          <Icon as={LayoutGrid} size={12} />
          <span className="tag-detail-block-title">{g.title || 'Group'}</span>
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
    // Partition: cards in tagged groups vs ungrouped/other-grouped
    const groupedHere = direct.groups.filter(g => g.board_id === id);
    const groupedHereKeys = new Set(groupedHere.map(g => `${g.board_id}::${g.group_id || g.id}`));
    const groupedCardKeys = new Set();
    for (const k of groupedHereKeys) {
      const arr = groupCards.get(k) || [];
      for (const c of arr) groupedCardKeys.add(`${c.board_id}::${c.card_id}`);
    }
    const looseCards = allCards.filter(c => !groupedCardKeys.has(`${c.board_id}::${c.card_id}`));
    const sourceBadge = b.applied_source && b.applied_source !== 'user' ? b.applied_source : null;
    return (
      <div key={`brd:${id}`} className="tag-detail-board-block">
        <div className="tag-detail-block-head is-board">
          <Icon as={LayoutGrid} size={13} />
          <span className="tag-detail-block-title">{b.title || 'Board'}</span>
          {sourceBadge && (
            <span className={`tag-detail-block-attr is-${sourceBadge}`}>{sourceBadge}</span>
          )}
          <button className="tag-detail-block-open"
                  onClick={() => onOpenItem?.({ kind: 'board', id, board_id: id })}>
            Open
          </button>
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

  // Standalone groups not under a tagged board (rare).
  const orphanGroups = direct.groups.filter(g => !direct.boards.some(b => (b.board_id || b.id) === g.board_id));
  // Standalone cards (directly tagged but their board isn't).
  const orphanCards = direct.cards;

  return (
    <div className="tag-detail">
      <div className="tag-detail-head">
        <span className="tag-detail-dot" style={{ background: dot }} />
        <h1 className="tag-detail-name">{tag.name}</h1>
        <span className="tag-detail-count">
          {rows.length} {rows.length === 1 ? 'item' : 'items'}
        </span>
        <span className="tag-detail-spacer" />
        {onClose && (
          <button className="tag-detail-close" onClick={onClose} aria-label="Close">×</button>
        )}
      </div>

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
              }))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
