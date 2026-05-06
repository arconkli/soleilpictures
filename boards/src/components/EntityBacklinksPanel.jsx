// "Linked from" side drawer for any entity. Phase 1: minimal shell
// driven by the existing card_index / entity_search infra (lists
// nothing useful yet because doc_backlinks is doc-scoped). Phase 2
// fills the body via the get_entity_backlinks RPC reading from the
// new entity_links table, grouped by source kind.

import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { X } from '../lib/icons.js';
import { getKind } from '../lib/entityKinds.js';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { supabase } from '../lib/supabase.js';

export function EntityBacklinksPanel({ ref: targetRef, onClose }) {
  const navigate = useEntityNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const def = targetRef ? getKind(targetRef.kind) : null;
  const TitleIcon = def?.icon;

  useEffect(() => {
    if (!targetRef || !supabase) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const params = {
          p_kind: targetRef.kind,
          p_id: targetRef.id || null,
          p_board_id: targetRef.boardId || (targetRef.kind === 'board' ? targetRef.id : null),
          p_card_id: targetRef.cardId || null,
          p_doc_card_id: targetRef.docCardId || null,
          p_url: targetRef.href || null,
          p_limit: 100,
        };
        const { data } = await supabase.rpc('get_entity_backlinks', params);
        if (cancelled) return;
        const backlinks = (data || []).map(r => ({
          ref: backlinkSourceToRef(r),
          title: backlinkSourceTitle(r),
          snippet: r.context_text ? String(r.context_text).slice(0, 200) : null,
          source_kind: r.source_kind,
        }));
        setRows(backlinks.filter(b => b.ref));
      } catch (e) {
        console.warn('EntityBacklinksPanel fetch', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [targetRef && (targetRef.id || targetRef.cardId || targetRef.docCardId || targetRef.href)]);

  if (!targetRef) return null;

  return (
    <aside className="ent-backlinks-panel surface-frosted">
      <div className="ent-backlinks-head">
        {TitleIcon && <Icon as={TitleIcon} size={14} />}
        <span className="ent-backlinks-head-label">{def?.label || targetRef.kind} · Linked from</span>
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
        {rows.map((r, i) => (
          <button key={i} className="ent-backlinks-row" onClick={() => { navigate(r.ref); onClose?.(); }}>
            <span className="ent-backlinks-row-title">{r.title}</span>
            {r.snippet && <span className="ent-backlinks-row-snippet">{r.snippet}</span>}
          </button>
        ))}
      </div>
    </aside>
  );
}

// Convert one entity_links row → ref the user can click to open.
function backlinkSourceToRef(r) {
  switch (r.source_kind) {
    case 'doc':
      return { kind: 'docPos', docCardId: r.source_id, pageId: r.source_page_id || '' };
    case 'message':
      return { kind: 'message', id: r.source_id };
    case 'card_title':
    case 'card':
    case 'note':
      return { kind: 'card', boardId: r.source_board_id || null, cardId: r.source_id };
    default:
      return null;
  }
}

function backlinkSourceTitle(r) {
  switch (r.source_kind) {
    case 'doc':       return 'Doc';
    case 'message':   return 'Message';
    case 'card':      return 'Card';
    case 'card_title':return 'Card title';
    case 'note':      return 'Note';
    default:          return r.source_kind;
  }
}
