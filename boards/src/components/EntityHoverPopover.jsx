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
import { R2Image } from './R2Image.jsx';
import { ImageLightbox } from './ImageLightbox.jsx';
import { fetchTagVisuals } from '../lib/tagVisuals.js';
import { tagFallbackColor } from '../lib/tagColor.js';
import { entityTypeLabel } from '../lib/entityTypes.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

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
  // Container entities (boards, groups) can be expanded inline to show
  // their actual contents. The set is keyed by entity_search id.
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const toggleExpanded = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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
      // Cap width to the viewport so a 380px popover doesn't overflow a ~375px
      // phone (the left-clamp alone would just push it off the left edge).
      const w = Math.min(W, vw - 2 * PAD);
      const left = Math.min(Math.max(PAD, anchor.left), vw - w - PAD);
      setPos({ top, left, placeAbove, w });
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
      if (!popRef.current) return;
      if (popRef.current.contains(e.target)) return;
      // A thumb lightbox is a sibling portal — clicks inside it (incl. its
      // backdrop) must not close the popover behind it.
      if (e.target.closest?.('.lightbox')) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKey);
    // pointerdown (capture) too so a tap-away closes it on touch.
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose]);

  const headingTerm = term || sortedEntities[0]?.title || '';
  const totalCount = sortedEntities.length + totalAppears;

  return createPortal(
    <div
      ref={popRef}
      className="ent-pop surface-frosted"
      style={{ top: pos.top, left: pos.left, width: pos.w ?? W, maxHeight: `${MAX_H_VH * 100}vh` }}
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
              <TagFeatureCard
                key={row.id}
                row={row}
                workspaceId={workspaceId}
                onOpenTag={() => { navigate(rowToRef(row)); onClose?.(); }}
                onNavigate={(target) => { onClose?.(); navigate(target); }}
              />
            ))}
          </div>
        )}

        {nonTagEntities.length > 0 && (
          <div className="ent-pop-section">
            <div className="ent-pop-section-head">
              ENTITIES NAMED THIS <span className="ent-pop-section-count">({nonTagEntities.length})</span>
            </div>
            {nonTagEntities.slice(0, 6).map(row => {
              // Boards (and groups, conceptually) hold contents — let the
              // user expand them inline so the popover surfaces what's
              // actually in there without forcing a navigation. Other
              // kinds (doc / card / note / user) just navigate on click.
              const isExpandable = row.kind === 'board';
              const isExpanded = expandedIds.has(row.id);
              return (
                <div key={row.id} className="ent-pop-row-wrap">
                  <EntityRow
                    row={row}
                    onClick={() => { navigate(rowToRef(row)); onClose?.(); }}
                    expandable={isExpandable}
                    expanded={isExpanded}
                    onToggleExpand={(e) => {
                      e.stopPropagation();
                      toggleExpanded(row.id);
                    }}
                  />
                  {isExpandable && isExpanded && (
                    <BoardInlineExpansion
                      boardId={row.board_id || row.id}
                      onNavigate={(target) => { navigate(target); onClose?.(); }}
                    />
                  )}
                </div>
              );
            })}
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

// Featured tag "card" — the headline of the tags rework. When a hovered
// name maps to a tag (a character, a setting, a concept), show what it
// LOOKS like: a few image thumbs + palette strips pulled cross-board,
// not just a dot. Clicking the header opens the full collection; a thumb
// or palette jumps to its source. Same shared fetch (lib/tagVisuals) the
// doc popover uses, so this stays in lockstep and the cache is shared.
function TagFeatureCard({ row, workspaceId, onOpenTag, onNavigate }) {
  const color = row?.meta?.color || tagFallbackColor(row.title || row.id);
  const [vis, setVis] = useState(null); // null = still loading
  // Clicking a thumb opens a fullscreen lightbox that pages through the
  // whole tag's image set (←/→) instead of navigating away — matching the
  // doc tag popover. A capturing key handler owns Escape/arrows while it's
  // open so they don't also close the hover popover behind it.
  const [lightboxIdx, setLightboxIdx] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchTagVisuals({ tagId: row.id, workspaceId }).then(res => {
      if (cancelled) return;
      setVis(res);
      if (res.images.length || res.palettes.length) {
        try { logEvent(EV.TAG_HOVER_OPEN, { tag_id: row.id, surface: 'entity_popover' }); } catch (_) {}
      }
    });
    return () => { cancelled = true; };
  }, [row.id, workspaceId]);

  const allImages = vis?.images || [];
  useEffect(() => {
    if (lightboxIdx == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setLightboxIdx(null); return; }
      if (!allImages.length) return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); setLightboxIdx(i => (i - 1 + allImages.length) % allImages.length); }
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setLightboxIdx(i => (i + 1) % allImages.length); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [lightboxIdx, allImages.length]);

  const thumbs = allImages.slice(0, 9);
  const palettes = vis?.palettes?.slice(0, 2) || [];
  // Non-visual payoff — docs/notes/boards/cards. For a concept/Topic tag
  // (e.g. "Pricing") this IS the content; for a character it's extra.
  const others = vis?.other || [];
  const typeLabel = entityTypeLabel(vis?.entityType);
  const hasAny = thumbs.length || palettes.length || others.length;

  return (
    <div className="ent-pop-tag-card" style={{ '--tag-color': color }}>
      <button className="tag-pop-header" onClick={onOpenTag} title={`Open ${row.title || 'tag'}`}>
        <span className="tag-pop-stamp" aria-hidden="true" />
        <span className="tag-pop-name">{row.title || 'Untitled'}</span>
        {typeLabel && <span className="tag-pop-type">{typeLabel}</span>}
        {vis?.total > 0 && (
          <span className="tag-pop-count">{vis.total} {vis.total === 1 ? 'item' : 'items'}</span>
        )}
        <span className="ent-pop-tag-arrow" aria-hidden="true">→</span>
      </button>

      {!vis && (
        <div className="tag-pop-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => <span key={i} />)}
        </div>
      )}
      {vis && !hasAny && (
        <div className="tag-pop-empty">No other items tagged.</div>
      )}

      {thumbs.length > 0 && (
        <div className="tag-pop-images">
          {thumbs.map((im, i) => (
            <button key={i} className="tag-pop-thumb" title={im.title || 'Image'}
                    onClick={() => setLightboxIdx(i)}>
              <R2Image src={im.src} alt="" />
            </button>
          ))}
        </div>
      )}
      {palettes.length > 0 && (
        <div className="tag-pop-palettes">
          {palettes.map((p, i) => {
            const colors = (p.swatches || [])
              .map(c => (typeof c === 'string' ? c : c?.hex))
              .filter(Boolean).slice(0, 10);
            return (
              <button key={i} className="tag-pop-palette" title={p.title || 'Palette'}
                      onClick={() => onNavigate?.(p.navTarget)}>
                <span className="tag-pop-palette-swatches">
                  {colors.map((c, j) => <span key={j} style={{ background: c }} />)}
                </span>
                {p.title && <span className="tag-pop-palette-title">{p.title}</span>}
              </button>
            );
          })}
        </div>
      )}
      {others.length > 0 && (
        <div className="tag-pop-list">
          {others.map((o, i) => {
            const IcnCmp = getKind(o.kind)?.icon || StickyNote;
            return (
              <button key={i} className="tag-pop-row" title={o.title}
                      onClick={() => onNavigate?.(o.navTarget)}>
                <span className="tag-pop-row-icon"><Icon as={IcnCmp} size={12} /></span>
                <span className="tag-pop-row-title">{o.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {lightboxIdx != null && allImages[lightboxIdx] && (
        <ImageLightbox
          src={allImages[lightboxIdx].src}
          title={allImages[lightboxIdx].title || ''}
          alt={allImages[lightboxIdx].title || ''}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}

function EntityRow({ row, onClick, expandable = false, expanded = false, onToggleExpand }) {
  const def = getKind(row.kind);
  const IconCmp = def?.icon;
  const previewMini = def?.previewMini;
  return (
    <div className={`ent-pop-row ${expandable ? 'is-expandable' : ''}`}>
      <button className="ent-pop-row-main"
              onClick={onClick}
              title={`Open ${row.title || row.kind}`}>
        <div className="ent-pop-row-head">
          {IconCmp && <Icon as={IconCmp} size={13} />}
          <span className="ent-pop-row-kind">{def?.label || row.kind}</span>
          <span className="ent-pop-row-title">{row.title || 'Untitled'}</span>
        </div>
        {previewMini && (
          <div className="ent-pop-row-preview">{previewMini(row)}</div>
        )}
      </button>
      {expandable && (
        <button className={`ent-pop-row-expand ${expanded ? 'is-on' : ''}`}
                onClick={onToggleExpand}
                title={expanded ? 'Hide contents' : 'Show contents'}>
          {expanded ? 'Hide' : 'Expand'}
        </button>
      )}
    </div>
  );
}

// Inline contents preview for a board referenced from the popover.
// Lazy-loads the most-recent ~12 cards via card_index, renders them
// using the same rich previews the tag detail view uses (image thumbs,
// palette swatches, text excerpts). Click a card → navigate to it.
function BoardInlineExpansion({ boardId, onNavigate }) {
  const [cards, setCards] = useState(null); // null = loading; [] = empty
  useEffect(() => {
    let cancelled = false;
    if (!boardId || !supabase) { setCards([]); return; }
    supabase.from('card_index')
      .select('board_id, card_id, kind, title, body, meta, updated_at')
      .eq('board_id', boardId)
      .order('updated_at', { ascending: false })
      .limit(12)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setCards([]); return; }
        const filtered = (data || []).filter(c => {
          // Skip empty cards — they're noise in this compact view.
          return (c.title && c.title.trim()) || (c.body && c.body.trim()) || c.meta?.src || c.meta?.swatches?.length;
        });
        setCards(filtered);
      });
    return () => { cancelled = true; };
  }, [boardId]);

  if (cards === null) {
    return <div className="ent-pop-expand-empty">Loading…</div>;
  }
  if (cards.length === 0) {
    return <div className="ent-pop-expand-empty">This board is empty.</div>;
  }
  return (
    <div className="ent-pop-expand">
      <div className="ent-pop-expand-grid">
        {cards.map(c => {
          const def = getKind(c.kind);
          const Icn = def?.icon;
          // Rich preview only for visual kinds — for text-y cards the
          // registry previewMini just re-renders the body, which then
          // duplicates whatever ends up in the meta row below.
          const isVisual = c.kind === 'image' || c.kind === 'palette';
          const rich = isVisual ? (def?.previewMini?.(c) || null) : null;
          return (
            <button key={`${c.board_id}:${c.card_id}`}
                    className={`ent-pop-expand-card ${isVisual ? 'is-visual' : ''}`}
                    title={c.title || c.kind}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate?.({ kind: c.kind, boardId: c.board_id, cardId: c.card_id });
                    }}>
              {rich && <div className="ent-pop-expand-card-rich">{rich}</div>}
              <div className="ent-pop-expand-card-meta">
                {Icn && <Icon as={Icn} size={10} />}
                <span className="ent-pop-expand-card-text">
                  {c.title?.trim() || (c.body || '').slice(0, 60) || c.kind}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <button className="ent-pop-expand-foot"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.({ kind: 'board', id: boardId });
              }}>
        Open full board →
      </button>
    </div>
  );
}

// One "appears in" row — text excerpt + source metadata. Notes and
// messages often have no real title (just body text), so we suppress
// the placeholder "Untitled" / "Message" line when there's a snippet
// — the snippet already carries the only meaningful content.
function AppearsRow({ row, onClick }) {
  const IconCmp = row.source_kind === 'doc'     ? FileText
                 : row.source_kind === 'message' ? MessageSquare
                 : StickyNote;
  const when = row.updated_at ? relativeTimeShort(row.updated_at) : '';
  const rawTitle = (row.source_title || '').trim();
  const snippet = (row.snippet || '').trim();
  const hasRealTitle = rawTitle.length > 0;
  const title = hasRealTitle
    ? rawTitle
    : (row.source_kind === 'message' ? 'Message' : 'Untitled');
  // Skip rendering a redundant title row when:
  //   - there's no real title AND
  //   - the snippet conveys the entity (notes/messages without titles)
  const showTitleLine = hasRealTitle || !snippet;
  return (
    <button className="ent-pop-row" onClick={onClick} title="Open">
      {showTitleLine ? (
        <div className="ent-pop-row-head">
          <Icon as={IconCmp} size={13} />
          <span className="ent-pop-row-kind">{row.source_kind}</span>
          <span className="ent-pop-row-title">{title}</span>
          {when && <span className="ent-pop-row-when">· {when}</span>}
        </div>
      ) : (
        <div className="ent-pop-row-snippet-inline">
          <Icon as={IconCmp} size={13} />
          <span className="ent-pop-row-snippet-text">{snippet}…</span>
          {when && <span className="ent-pop-row-when">· {when}</span>}
        </div>
      )}
      {snippet && showTitleLine && (
        <div className="ent-pop-row-snippet">{snippet}…</div>
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
