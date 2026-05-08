// Universal chip used by every render surface (docs, messages, note
// cards, card titles, canvas chip cards). Wraps the displayed text in
// a hairline span and manages hover → popover, click → navigate.
//
// Two modes:
//   refs={[ref, ...]}   — manually inserted links (one or more known
//                         targets). Visual variant: tt-link-manual.
//   term="text"         — auto-detected match (Phase 2+). Lookup
//                         happens on first hover. Visual: tt-link-auto.
//
// Either mode produces the same popover; the only difference at rest
// is the hairline opacity.

import { useState, useRef, useCallback } from 'react';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { EntityHoverPopover } from './EntityHoverPopover.jsx';
import { entityKindColor } from '../lib/entityKindColor.js';
import { ENTITY_REF_MIME, ENTITY_REF_LIST_MIME } from '../lib/dragMimes.js';
import { entityUrl } from '../lib/entityUrl.js';
import { prefetchEntity } from '../lib/prefetchKinds.js';

const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 200;

export function EntityLink({
  refs,
  term,
  workspaceId,
  manual,                 // true → tt-link-manual, false → tt-link-auto. Defaults inferred.
  children,
  className = '',
  asTag = 'span',
  onSeeAll,
  ...rest
}) {
  const navigate = useEntityNavigate();
  const isManual = manual ?? Boolean(refs?.length);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const elRef = useRef(null);
  const openTimer = useRef(null);
  const closeTimer = useRef(null);

  const cancelTimers = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  // Broadcast a window-level hover signal so any rendered surface
  // (canvas cards, sidebar rows, doc pages) can self-highlight when it
  // matches the hovered link's targets. The detail is the refs array
  // (or null on hover-out). Fired immediately, separate from the 250ms
  // popover-open delay — the highlight should feel instant.
  const broadcastHover = useCallback((refsOrNull) => {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('soleil:link-hover', { detail: refsOrNull }));
    } catch (_) { /* ignore */ }
  }, []);

  const scheduleOpen = useCallback(() => {
    cancelTimers();
    if (refs?.length) {
      broadcastHover(refs);
      // Hover-prefetch the first ref's target so a click navigates
      // against an already-warm cache. Fires immediately (no
      // debounce) — prefetchEntity is idempotent and dedups against
      // any prior hover.
      try { prefetchEntity(refs[0], { lane: 'high' }); } catch (_) {}
    }
    openTimer.current = setTimeout(() => {
      const r = elRef.current?.getBoundingClientRect();
      if (r) {
        setAnchor(r);
        setOpen(true);
      }
    }, HOVER_OPEN_MS);
  }, [refs, broadcastHover]);

  const scheduleClose = useCallback(() => {
    cancelTimers();
    broadcastHover(null);
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  }, [broadcastHover]);

  const closeNow = useCallback(() => { cancelTimers(); setOpen(false); }, []);

  const handleClick = (e) => {
    // ⌘-click / Ctrl-click → always open the popover (chooser).
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const r = elRef.current?.getBoundingClientRect();
      setAnchor(r); setOpen(true);
      return;
    }
    // Single-target manual link → navigate directly.
    if (refs?.length === 1) {
      e.preventDefault();
      navigate(refs[0]);
      closeNow();
      return;
    }
    // Otherwise open the popover so the user picks.
    e.preventDefault();
    const r = elRef.current?.getBoundingClientRect();
    setAnchor(r); setOpen(true);
  };

  const handleDragStart = (e) => {
    if (!refs?.length) return;
    try {
      // Single-ref payload (most common — backwards compat for drop
      // handlers that only know one mime).
      e.dataTransfer.setData(ENTITY_REF_MIME, JSON.stringify(refs[0]));
      // Multi-ref payload — for drops that want the full set.
      e.dataTransfer.setData(ENTITY_REF_LIST_MIME, JSON.stringify(refs));
      // Plain-text fallback so external apps (Slack, Notion) get a
      // permalink they can render.
      const url = entityUrl(refs[0]);
      if (url) e.dataTransfer.setData('text/plain', url);
      e.dataTransfer.effectAllowed = 'copyLink';
    } catch (_) { /* ignore */ }
  };

  const Tag = asTag;
  const variantClass = isManual ? 'tt-link tt-link-manual' : 'tt-link tt-link-auto';
  // Tint by kind on hover. The kind comes from the first manual ref or
  // is left blank for auto-detected links (which can match many kinds at
  // once). CSS reads --tt-link-tint to color the text + underline.
  const linkKind = refs?.[0]?.kind || null;
  const kindStyle = linkKind ? { '--tt-link-tint': entityKindColor(linkKind) } : undefined;

  return (
    <>
      <Tag
        ref={elRef}
        className={`${variantClass} ${linkKind ? `tt-link-kind-${linkKind}` : ''} ${className}`.trim()}
        draggable={!!refs?.length}
        onClick={handleClick}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onDragStart={handleDragStart}
        style={kindStyle}
        {...rest}
      >
        {children}
      </Tag>
      {open && anchor && (
        <EntityHoverPopover
          anchor={anchor}
          refs={refs}
          term={term}
          workspaceId={workspaceId}
          onMouseEnter={cancelTimers}
          onMouseLeave={scheduleClose}
          onClose={closeNow}
          onSeeAll={() => { closeNow(); onSeeAll?.(); }}
        />
      )}
    </>
  );
}
