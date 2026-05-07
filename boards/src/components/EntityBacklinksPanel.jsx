// "Linked from" side drawer for any entity. Shows EVERY place that
// references the entity, combining two sources:
//
//   1. Explicit links via entity_links (the get_entity_backlinks RPC).
//      These are manual `@` mentions, dropped chip cards, message
//      attachments, and link-marks inside docs.
//
//   2. Text occurrences via get_entity_mentions(name). These are auto-
//      detected name appearances in any doc page / message / card
//      title or body — the same data that fills the popover's
//      "APPEARS IN" section.
//
// We dedupe by (sourceKind, sourceId, sourcePageId) so a doc that
// has both an explicit link AND a text mention doesn't appear twice.

import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import { X, FileText, MessageSquare, StickyNote, Pin } from '../lib/icons.js';
import { getKind } from '../lib/entityKinds.js';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { supabase } from '../lib/supabase.js';
import { useEntityTrie } from '../hooks/useEntityNameTrie.js';
import { relativeTimeShort } from '../lib/relativeTime.js';

export function EntityBacklinksPanel({ ref: targetRef, onClose }) {
  const navigate = useEntityNavigate();
  const { workspaceId } = useEntityTrie();
  const [linkRows, setLinkRows] = useState([]);
  const [mentionRows, setMentionRows] = useState([]);
  const [entityName, setEntityName] = useState(targetRef?._name || '');
  const [loading, setLoading] = useState(true);
  const def = targetRef ? getKind(targetRef.kind) : null;
  const TitleIcon = def?.icon;

  // Fetch entity name if not provided. Used for the title and to
  // drive the text-mention RPC.
  useEffect(() => {
    if (!targetRef || !supabase || entityName) return;
    let cancelled = false;
    (async () => {
      try {
        if (targetRef.kind === 'board' && targetRef.id) {
          const { data } = await supabase.from('boards').select('name').eq('id', targetRef.id).maybeSingle();
          if (!cancelled && data?.name) setEntityName(data.name);
        } else if (targetRef.kind === 'card' && targetRef.boardId && targetRef.cardId) {
          const { data } = await supabase.from('card_index').select('title').eq('board_id', targetRef.boardId).eq('card_id', targetRef.cardId).maybeSingle();
          if (!cancelled && data?.title) setEntityName(data.title);
        } else if ((targetRef.kind === 'doc' || targetRef.kind === 'docPos') && targetRef.docCardId) {
          const { data } = await supabase.from('card_index').select('title').eq('card_id', targetRef.docCardId).maybeSingle();
          if (!cancelled && data?.title) setEntityName(data.title);
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [targetRef && (targetRef.id || targetRef.cardId || targetRef.docCardId)]);

  // Fetch both backlink sources in parallel.
  useEffect(() => {
    if (!targetRef || !supabase) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [a, b] = await Promise.all([
          // 1. Explicit entity_links.
          supabase.rpc('get_entity_backlinks', {
            p_kind: targetRef.kind,
            p_id: targetRef.id || null,
            p_board_id: targetRef.boardId || (targetRef.kind === 'board' ? targetRef.id : null),
            p_card_id: targetRef.cardId || null,
            p_doc_card_id: targetRef.docCardId || null,
            p_url: targetRef.href || null,
            p_limit: 200,
          }),
          // 2. Text occurrences via the popover RPC. Only meaningful
          // if we know the entity's name (otherwise we'd be searching
          // for an empty string).
          (entityName && entityName.length >= 4 && workspaceId)
            ? supabase.rpc('get_entity_mentions', {
                p_term: entityName, p_workspace: workspaceId, p_limit: 50,
              })
            : Promise.resolve({ data: { appears_in: [] } }),
        ]);
        if (cancelled) return;
        setLinkRows(a.data || []);
        setMentionRows(b.data?.appears_in || []);
      } catch (e) {
        console.warn('EntityBacklinksPanel fetch', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [targetRef && (targetRef.id || targetRef.cardId || targetRef.docCardId || targetRef.href), entityName, workspaceId]);

  // Merge + dedupe by (kind, id, pageId).
  const rows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of linkRows) {
      const key = `${r.source_kind}:${r.source_id}:${r.source_page_id || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: r.source_kind,
        id: r.source_id,
        boardId: r.source_board_id,
        pageId: r.source_page_id,
        snippet: r.context_text ? String(r.context_text).slice(0, 200) : null,
        when: r.created_at,
        isExplicit: true,
      });
    }
    for (const r of mentionRows) {
      const key = `${r.source_kind}:${r.source_id}:${r.source_page_id || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: r.source_kind,
        id: r.source_id,
        title: r.source_title || null,
        pageId: r.source_page_id,
        snippet: r.snippet ? `…${r.snippet.trim()}…` : null,
        when: r.updated_at,
        isExplicit: false,
      });
    }
    out.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
    return out;
  }, [linkRows, mentionRows]);

  // Local pin state — per-target list of pinned source keys, persisted in
  // localStorage so the user's own pins survive across sessions without
  // needing a server-side table. (Server-side per-user pinning is a
  // future migration; this is the cheap-and-good MVP.)
  const targetKey = targetRef
    ? `${targetRef.kind}:${targetRef.cardId || targetRef.docCardId || targetRef.id || ''}`
    : '';
  const pinStorageKey = targetKey ? `soleil-backlink-pins:${targetKey}` : '';
  const [pinned, setPinned] = useState(() => {
    if (!pinStorageKey) return new Set();
    try {
      const raw = localStorage.getItem(pinStorageKey);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (_) { return new Set(); }
  });
  const persistPins = (next) => {
    setPinned(next);
    if (!pinStorageKey) return;
    try { localStorage.setItem(pinStorageKey, JSON.stringify([...next])); }
    catch (_) {}
  };
  const togglePin = (key) => {
    const next = new Set(pinned);
    if (next.has(key)) next.delete(key); else next.add(key);
    persistPins(next);
  };
  const sortedRows = useMemo(() => {
    if (pinned.size === 0) return rows;
    const keyOf = (r) => `${r.kind}:${r.id}:${r.pageId || ''}`;
    const isPinned = (r) => pinned.has(keyOf(r));
    return [...rows].sort((a, b) => {
      const pa = isPinned(a), pb = isPinned(b);
      if (pa !== pb) return pa ? -1 : 1;
      return new Date(b.when || 0) - new Date(a.when || 0);
    });
  }, [rows, pinned]);

  if (!targetRef) return null;

  return (
    <aside className="ent-backlinks-panel surface-frosted">
      <div className="ent-backlinks-head">
        {TitleIcon && <Icon as={TitleIcon} size={14} />}
        <span className="ent-backlinks-head-label">Linked from</span>
        {entityName && (
          <span className="ent-backlinks-head-target" title={entityName}>{entityName}</span>
        )}
        <button className="ent-backlinks-close" onClick={() => onClose?.()} title="Close">
          <Icon as={X} size={12} />
        </button>
      </div>
      <div className="ent-backlinks-body">
        {loading && <div className="ent-backlinks-empty">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="ent-backlinks-empty">
            Nothing links here yet. Mention this from a doc, message, or card.
          </div>
        )}
        {sortedRows.map((r, i) => {
          const ref = sourceToRef(r);
          const IconCmp = sourceIcon(r.kind);
          const rowKey = `${r.kind}:${r.id}:${r.pageId || ''}`;
          const isPinned = pinned.has(rowKey);
          return (
            <div key={`${r.kind}:${r.id}:${i}`}
                 className={`ent-backlinks-row-wrap ${isPinned ? 'is-pinned' : ''}`}>
              <button className="ent-backlinks-row"
                      onClick={() => { if (ref) navigate(ref); onClose?.(); }}>
                <span className="ent-backlinks-row-head">
                  <Icon as={IconCmp} size={12} />
                  <span className="ent-backlinks-row-kind">{labelFor(r.kind)}</span>
                  {r.title && <span className="ent-backlinks-row-title">{r.title}</span>}
                  {r.when && <span className="ent-backlinks-row-when">· {relativeTimeShort(r.when)}</span>}
                  {r.isExplicit && <span className="ent-backlinks-row-tag" title="Manual link">link</span>}
                </span>
                {r.snippet && <span className="ent-backlinks-row-snippet">{r.snippet}</span>}
              </button>
              <button className={`ent-backlinks-row-pin ${isPinned ? 'is-on' : ''}`}
                      title={isPinned ? 'Unpin from top' : 'Pin to top'}
                      onClick={(e) => { e.stopPropagation(); togglePin(rowKey); }}>
                <Icon as={Pin} size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function sourceToRef(r) {
  switch (r.kind) {
    case 'doc':       return { kind: 'docPos', docCardId: r.id, pageId: r.pageId || '' };
    case 'message':   return { kind: 'message', id: r.id };
    case 'card':
    case 'note':
    case 'card_title':
      return { kind: 'card', boardId: r.boardId || null, cardId: r.id };
    default:          return null;
  }
}
function sourceIcon(kind) {
  if (kind === 'doc')     return FileText;
  if (kind === 'message') return MessageSquare;
  return StickyNote;
}
function labelFor(kind) {
  switch (kind) {
    case 'doc':       return 'Doc';
    case 'message':   return 'Message';
    case 'card':      return 'Card';
    case 'note':      return 'Note';
    case 'card_title':return 'Card title';
    default:          return kind;
  }
}
