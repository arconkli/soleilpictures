// "Tag detail" surface — what you see after clicking a tag in the
// sidebar. Conceptually it's a per-tag inbox: every card / board / doc /
// note tagged with this tag, ordered by recency-of-application, click
// to navigate.
//
// Data source: get_things_tagged(tag_id) RPC (migration 0036d). It
// joins entity_links → entity_search in one round trip so we get
// title + meta + thumbnail data without a second query.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Image, Palette, Calendar, Link as LinkIcon } from '../lib/icons.js';
import { relativeTimeShort } from '../lib/relativeTime.js';

const SECTION_ORDER = ['board', 'doc', 'group', 'card', 'note', 'image', 'palette', 'schedule', 'link'];

const KIND_ICON = {
  board: LayoutGrid, doc: FileText, group: LayoutGrid,
  card: StickyNote, note: StickyNote, image: Image,
  palette: Palette, schedule: Calendar, link: LinkIcon,
};
const KIND_LABEL = {
  board: 'Boards', doc: 'Docs', group: 'Groups',
  card: 'Cards', note: 'Notes', image: 'Images',
  palette: 'Palettes', schedule: 'Schedules', link: 'Links',
};

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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

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

    // Realtime: refresh when applications change for THIS tag.
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

  const groupedByKind = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.kind || 'card';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  }, [rows]);

  if (!tag) return null;
  const dot = tag.color || fallbackColor(tag.slug || tag.name);

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

        {SECTION_ORDER.filter(k => groupedByKind.has(k)).map(kind => {
          const items = groupedByKind.get(kind) || [];
          const Icn = KIND_ICON[kind] || StickyNote;
          return (
            <div key={kind} className="tag-detail-section">
              <div className="tag-detail-section-head">
                <Icon as={Icn} size={12} />
                <span className="tag-detail-section-label">{KIND_LABEL[kind] || kind}</span>
                <span className="tag-detail-section-count">{items.length}</span>
              </div>
              <div className="tag-detail-rows">
                {items.map(it => {
                  const sourceBadge = it.applied_source && it.applied_source !== 'user'
                    ? it.applied_source : null;
                  return (
                    <button key={`${kind}:${it.id}`}
                            className="tag-detail-row"
                            onClick={() => onOpenItem?.(it)}>
                      <Icon as={Icn} size={11} />
                      <span className="tag-detail-row-title">{it.title || 'Untitled'}</span>
                      {sourceBadge && (
                        <span className={`tag-detail-row-attr is-${sourceBadge}`}>{sourceBadge}</span>
                      )}
                      <span className="tag-detail-row-when">
                        {relativeTimeShort(it.applied_at)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
