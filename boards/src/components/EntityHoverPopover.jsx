// Universal hover popover for any linked term.
//
// Two sections:
//   ENTITIES NAMED THIS — entity rows fetched by ref or by term match.
//                         Visual previews are pluggable per kind via
//                         the entityKinds registry.
//   APPEARS IN          — Phase 2 fills this with get_entity_mentions.
//                         Phase 1 hides the section if empty.
//
// Hover lifecycle: caller (EntityLink) decides when to mount us; we
// keep ourselves open while the cursor is over our portal so users
// can scroll through previews and click rows. Clicking outside, Esc,
// or scrolling the page closes via onClose.

import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { Copy, X, FileText, MessageSquare, StickyNote } from '../lib/icons.js';
import { supabase } from '../lib/supabase.js';
import { getKind, compareByPriority } from '../lib/entityKinds.js';
import { entityUrl } from '../lib/entityUrl.js';
import { useFeedback } from './AppFeedback.jsx';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { getEntityMentions } from '../lib/entityMentionsCache.js';
import { relativeTimeShort } from '../lib/relativeTime.js';

const PAD = 8;
const W = 380;
const MAX_H_VH = 0.7;

export function EntityHoverPopover({
  anchor,
  refs,           // optional — explicit list of refs to render
  term,           // optional — alternative: fetch by name match
  workspaceId,
  docScope,       // optional — { docCardId } for the per-doc ignore action
  onMouseEnter,
  onMouseLeave,
  onClose,
  onSeeAll,
}) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, placeAbove: false });
  const navigate = useEntityNavigate();
  const feedback = useFeedback();

  const [entityRows, setEntityRows] = useState([]);
  const [appearsIn, setAppearsIn] = useState([]);
  const [totalAppears, setTotalAppears] = useState(0);
  const [loading, setLoading] = useState(true);

  // Resolve the term: explicit prop wins, otherwise derive from the
  // first ref's title (we'll learn this via entity_search lookup
  // below if the ref is set without a term). For manual refs without
  // any name hint, we still fetch by id and skip the term-based
  // "Appears in" pass.
  const refIdsKey = JSON.stringify(refs?.map(r => r && (r.id || r.cardId || r.docCardId || r.href)) || []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // If we have explicit refs, hydrate them by id first so the
        // ENTITIES section shows the chosen targets even if their
        // titles aren't an exact name match for the term.
        let explicitRows = [];
        if (refs?.length && supabase) {
          const ids = refs.map(refToSearchId).filter(Boolean);
          if (ids.length) {
            const { data } = await supabase.from('entity_search')
              .select('id,kind,workspace_id,board_id,card_id,title,body,meta,updated_at')
              .in('id', ids);
            explicitRows = data || [];
          }
        }

        // Decide the term used for the "appears in" pass.
        const effectiveTerm = (term && term.trim())
          || explicitRows[0]?.title
          || '';

        let rpcEntities = [];
        let rpcApps = [];
        let rpcTotal = 0;
        if (effectiveTerm && workspaceId) {
          const data = await getEntityMentions({ term: effectiveTerm, workspaceId, limit: 6 });
          rpcEntities = data?.entities || [];
          rpcApps     = data?.appears_in || [];
          rpcTotal    = data?.total_appears || 0;
        }

        // Merge: explicit refs come first; rpc-discovered entities
        // are appended (deduped by id).
        const seen = new Set(explicitRows.map(r => r.id));
        const merged = [...explicitRows];
        for (const r of rpcEntities) {
          if (!seen.has(r.id)) { merged.push(r); seen.add(r.id); }
        }
        if (cancelled) return;
        setEntityRows(merged);
        setAppearsIn(rpcApps);
        setTotalAppears(rpcTotal);
      } catch (e) {
        if (!cancelled) console.warn('EntityHoverPopover fetch', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refIdsKey, term, workspaceId]);

  // Sort entities by registry kindPriority, then by recency.
  const sortedEntities = useMemo(() => {
    return [...entityRows].sort((a, b) => {
      const c = compareByPriority(a, b);
      if (c !== 0) return c;
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
  }, [entityRows]);

  // Partition: tags are the "concept" abstraction the user invoked
  // when they typed this word — they get a featured top block.
  // Everything else falls through to the existing flat ENTITIES section.
  const tagEntities = useMemo(
    () => sortedEntities.filter(r => r.kind === 'tag'),
    [sortedEntities],
  );
  const nonTagEntities = useMemo(
    () => sortedEntities.filter(r => r.kind !== 'tag'),
    [sortedEntities],
  );

  // Position the portal near the anchor — flip above when no room
  // below; clamp to viewport. Re-measure on scroll/resize so the
  // popover follows the line during reflow.
  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const popH = popRef.current?.scrollHeight || 240;
      const maxH = vh * MAX_H_VH;
      const popHClamped = Math.min(popH, maxH);
      const spaceBelow = vh - anchor.bottom - PAD;
      const placeAbove = spaceBelow < popHClamped + PAD && anchor.top - PAD > spaceBelow;
      const top = placeAbove
        ? Math.max(PAD, anchor.top - popHClamped - PAD)
        : Math.min(vh - popHClamped - PAD, anchor.bottom + PAD);
      const left = Math.min(Math.max(PAD, anchor.left), vw - W - PAD);
      setPos({ top, left, placeAbove });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchor, sortedEntities.length, appearsIn.length]);

  // Esc / click-outside close.
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

  const headingTerm = term || sortedEntities[0]?.title || '';
  const totalCount = sortedEntities.length + totalAppears;

  return createPortal(
    <div
      ref={popRef}
      className="ent-pop surface-frosted"
      style={{ top: pos.top, left: pos.left, width: W, maxHeight: `${MAX_H_VH * 100}vh` }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {headingTerm && (
        <div className="ent-pop-head">
          <span className="ent-pop-head-term">{headingTerm}</span>
          {totalCount > 0 && (
            <span className="ent-pop-head-count">— {totalCount} across workspace</span>
          )}
          <button className="ent-pop-close" title="Close" onClick={() => onClose?.()}>
            <Icon as={X} size={12} />
          </button>
        </div>
      )}

      <div className="ent-pop-scroll">
        {loading && <div className="ent-pop-empty">Looking up…</div>}
        {!loading && sortedEntities.length === 0 && appearsIn.length === 0 && (
          <div className="ent-pop-empty">Nothing linked here yet.</div>
        )}

        {tagEntities.length > 0 && (
          <div className="ent-pop-section ent-pop-tag-feature">
            <div className="ent-pop-section-head">
              {tagEntities.length === 1 ? 'TAG' : 'TAGS'}
            </div>
            {tagEntities.map(row => (
              <TagFeatureRow
                key={row.id}
                row={row}
                onClick={() => { navigate(rowToRef(row)); onClose?.(); }}
              />
            ))}
          </div>
        )}

        {nonTagEntities.length > 0 && (
          <div className="ent-pop-section">
            <div className="ent-pop-section-head">
              ENTITIES NAMED THIS <span className="ent-pop-section-count">({nonTagEntities.length})</span>
            </div>
            {nonTagEntities.slice(0, 6).map(row => (
              <EntityRow
                key={row.id}
                row={row}
                onClick={() => { navigate(rowToRef(row)); onClose?.(); }}
              />
            ))}
            {nonTagEntities.length > 6 && (
              <button className="ent-pop-more" onClick={() => onSeeAll?.()}>
                + {nonTagEntities.length - 6} more →
              </button>
            )}
          </div>
        )}

        {appearsIn.length > 0 && (
          <div className="ent-pop-section">
            <div className="ent-pop-section-head">
              APPEARS IN <span className="ent-pop-section-count">({totalAppears})</span>
            </div>
            {appearsIn.slice(0, 5).map((row, i) => (
              <AppearsRow
                key={`${row.source_kind}:${row.source_id}:${i}`}
                row={row}
                onClick={() => {
                  const ref = appearsRowToRef(row);
                  if (ref) navigate(ref);
                  onClose?.();
                }}
              />
            ))}
            {totalAppears > appearsIn.length && (
              <button className="ent-pop-more" onClick={() => onSeeAll?.()}>
                + {totalAppears - appearsIn.length} more →
              </button>
            )}
          </div>
        )}
      </div>

      <div className="ent-pop-foot">
        <button
          className="ent-pop-foot-btn"
          onClick={() => {
            const ref = refs?.[0] || rowToRef(sortedEntities[0]);
            if (!ref) return;
            const url = entityUrl(ref);
            if (!url) return;
            try {
              navigator.clipboard.writeText(url);
              feedback?.toast?.({ kind: 'success', title: 'Link copied' });
            } catch (_) {}
            onClose?.();
          }}
          disabled={!sortedEntities.length && !refs?.length}
        >
          <Icon as={Copy} size={11} /> Copy link
        </button>
        {/* Auto-detect kill switches. Only show for term-driven (auto)
            popovers — manual links shouldn't be killed via this menu.
            When docScope is set, also offer a per-doc ignore that
            scopes the suppression to just this doc. */}
        {term && !refs?.length && workspaceId && docScope?.docCardId && (
          <button
            className="ent-pop-foot-btn"
            onClick={async () => {
              try {
                await supabase.from('entity_ignore_terms').insert({
                  workspace_id: workspaceId,
                  scope: 'doc',
                  scope_id: docScope.docCardId,
                  term: term.trim(),
                });
                feedback?.toast?.({ kind: 'success', title: `Won't auto-link "${term}" in this doc` });
              } catch (_) {
                feedback?.toast?.({ kind: 'error', title: 'Could not save' });
              }
              onClose?.();
            }}
            title="Stop auto-linking this term in this doc only"
          >
            Don't here
          </button>
        )}
        {term && !refs?.length && workspaceId && (
          <button
            className="ent-pop-foot-btn"
            onClick={async () => {
              try {
                await supabase.from('entity_ignore_terms').insert({
                  workspace_id: workspaceId,
                  scope: 'workspace',
                  scope_id: null,
                  term: term.trim(),
                });
                feedback?.toast?.({ kind: 'success', title: `Won't auto-link "${term}" anywhere` });
              } catch (_) {
                feedback?.toast?.({ kind: 'error', title: 'Could not save' });
              }
              onClose?.();
            }}
            title="Stop auto-linking this term anywhere in the workspace"
          >
            Don't anywhere
          </button>
        )}
        {totalCount > 0 && (
          <button className="ent-pop-foot-btn ent-pop-foot-btn-primary"
                  onClick={() => onSeeAll?.()}>
            See all references
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Featured tag row. Shows a color dot + name with prominent visual
// weight — the user typed a word that maps to this concept, so we
// want it to feel like "this is the tag you're talking about."
function TagFeatureRow({ row, onClick }) {
  const color = row?.meta?.color || fallbackTagColor(row.title || row.id);
  return (
    <button className="ent-pop-tag-row" onClick={onClick} title={`Open ${row.title || 'tag'}`}>
      <span className="ent-pop-tag-dot" style={{ background: color }} />
      <span className="ent-pop-tag-name">{row.title || 'Untitled'}</span>
      <span className="ent-pop-tag-arrow">→</span>
    </button>
  );
}

const TAG_PALETTE = [
  '#4f8df8', '#22d3ee', '#10b981', '#84cc16', '#f59e0b',
  '#ef4444', '#ec4899', '#a78bfa', '#6366f1', '#0ea5e9',
];
function fallbackTagColor(s) {
  const str = (s || '').toString();
  let h = 0; for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

function EntityRow({ row, onClick }) {
  const def = getKind(row.kind);
  const IconCmp = def?.icon;
  const previewMini = def?.previewMini;
  return (
    <button className="ent-pop-row" onClick={onClick} title={`Open ${row.title || row.kind}`}>
      <div className="ent-pop-row-head">
        {IconCmp && <Icon as={IconCmp} size={13} />}
        <span className="ent-pop-row-kind">{def?.label || row.kind}</span>
        <span className="ent-pop-row-title">{row.title || 'Untitled'}</span>
      </div>
      {previewMini && (
        <div className="ent-pop-row-preview">{previewMini(row)}</div>
      )}
    </button>
  );
}

// One "appears in" row — text excerpt + source metadata.
function AppearsRow({ row, onClick }) {
  const IconCmp = row.source_kind === 'doc'     ? FileText
                 : row.source_kind === 'message' ? MessageSquare
                 : StickyNote;
  const when = row.updated_at ? relativeTimeShort(row.updated_at) : '';
  const title = row.source_title || (row.source_kind === 'message' ? 'Message' : 'Untitled');
  return (
    <button className="ent-pop-row" onClick={onClick} title="Open">
      <div className="ent-pop-row-head">
        <Icon as={IconCmp} size={13} />
        <span className="ent-pop-row-kind">{row.source_kind}</span>
        <span className="ent-pop-row-title">{title}</span>
        {when && <span className="ent-pop-row-when">· {when}</span>}
      </div>
      {row.snippet && (
        <div className="ent-pop-row-snippet">{row.snippet.trim()}…</div>
      )}
    </button>
  );
}

// "Appears in" row → navigable ref.
function appearsRowToRef(row) {
  if (!row) return null;
  switch (row.source_kind) {
    case 'doc':     return { kind: 'docPos', docCardId: row.source_id, pageId: row.source_page_id || '' };
    case 'message': return { kind: 'message', id: row.source_id };
    case 'note':
    case 'card':    return { kind: 'card', cardId: row.source_id }; // boardId resolved by navigate handler
    default:        return null;
  }
}

// entity_search id format → ref shape.
function rowToRef(row) {
  if (!row) return null;
  switch (row.kind) {
    case 'board':   return { kind: 'board', id: row.board_id || row.id };
    case 'doc':     return { kind: 'doc', docCardId: row.card_id, boardId: row.board_id };
    case 'user':    return { kind: 'user', id: row.id };
    case 'url':     return { kind: 'url', href: row.title };
    case 'group':   return { kind: 'group', id: row.card_id, boardId: row.board_id };
    case 'tag':     return { kind: 'tag', id: row.id };
    default:        return { kind: 'card', boardId: row.board_id, cardId: row.card_id };
  }
}

// ref shape → entity_search id (used to hydrate on open).
function refToSearchId(r) {
  if (!r) return null;
  switch (r.kind) {
    case 'board':   return r.id;
    case 'doc':     return r.boardId ? `${r.boardId}:${r.docCardId}` : null;
    case 'docPos':  return r.boardId ? `${r.boardId}:${r.docCardId}` : null;
    case 'card':    return `${r.boardId}:${r.cardId}`;
    case 'user':    return r.id;
    case 'group':   return r.boardId ? `${r.boardId}:g:${r.id}` : null;
    case 'tag':     return r.id;
    default:        return null;
  }
}
