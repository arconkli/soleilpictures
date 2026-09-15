// SurfaceGallery — the admin-only browser for every popup, banner, toast,
// empty state and screen in the app.
//
// Two states, never both:
//   browsing   a searchable, grouped list of every entry in galleryIndex.js
//   previewing the list unmounts, the chosen surface renders over the real
//              app, and a small bar offers back / prev / next / Esc
//
// ── Why this does NOT render inside Settings ───────────────────────────────
// .settings-bg sits at z-index 2147483646 and .upgrade-backdrop at
// 2147483647 — the 32-bit maximum, with nothing left above it. A command
// palette (z-index 1200) previewed inside Settings would render BEHIND the
// settings backdrop and look broken for reasons that have nothing to do with
// the surface. So picking the Gallery tab closes Settings and this mounts at
// the app root instead, beside the Capture Mode surfaces and outside <main>.
//
// ── The bar has to win a tie it cannot win on z-index ──────────────────────
// The bar sits at the same 2147483647 as the modals it floats over, so DOM
// order decides — the convention styles.css:5977 already names. But portals
// append to document.body in MOUNT order, and a previewed modal portals itself
// after this component's own portal, which would put it on top. The fix is the
// effect keyed on entryId below: it re-appends the bar's container to the end
// of <body> on every entry change. React runs child effects before parent
// effects, so the preview's portal always exists by the time the re-append
// runs. A capture-phase Escape listener is the backstop, so a covered bar can
// never trap anyone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronLeft, ChevronUp, ChevronDown, Info } from '../../lib/icons.js';

import {
  GALLERY_ENTRIES, searchGallery, groupGallery, findEntry, routeUrl,
} from '../../lib/galleryIndex.js';
import { closeGallery, previewSurface } from '../../lib/galleryState.js';
import { useGalleryState } from '../../hooks/useGalleryState.js';
import { useListboxNav } from '../../hooks/useListboxNav.js';
import { useFeedback } from '../AppFeedback.jsx';
import { RENDERERS } from './entries.jsx';

const KIND_LABEL = {
  overlay: 'Overlay',
  toast: 'Toast',
  route: 'Screen',
  insitu: 'In situ',
};

export default function SurfaceGallery() {
  const { open, entryId } = useGalleryState();
  if (!open) return null;
  return entryId
    ? <GalleryPreview entryId={entryId} />
    : <GalleryList />;
}

// ── The list ───────────────────────────────────────────────────────────────

function GalleryList() {
  const feedback = useFeedback();
  const [q, setQ] = useState('');
  const [params, setParams] = useState({});      // route id -> typed param
  const inputRef = useRef(null);

  const results = useMemo(() => searchGallery(GALLERY_ENTRIES, q), [q]);
  const groups = useMemo(() => groupGallery(results), [results]);
  // The flat order the keyboard walks — must match render order exactly, which
  // is why it is derived from `groups` rather than from `results`.
  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);

  const activate = useCallback((entry) => {
    if (!entry) return;
    if (entry.kind === 'route') {
      const url = routeUrl(entry, params[entry.id]);
      if (!url) {
        feedback.toast({ type: 'info', message: `${entry.label} needs a ${entry.param} — type one in the row.` });
        return;
      }
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (entry.kind === 'insitu') return;          // the row IS the answer
    if (entry.kind === 'toast') {
      // Fires through the real useFeedback() API and leaves the list up, so a
      // whole family of toasts can be compared without reopening anything.
      try { RENDERERS[entry.id]?.(feedback); } catch (_) { /* never break the list */ }
      return;
    }
    previewSurface(entry.id);
  }, [feedback, params]);

  const { active, setActive, onKeyDown, registerItem } =
    useListboxNav(flat.length, { onSelect: (i) => activate(flat[i]), resetKey: q });

  useEffect(() => { inputRef.current?.focus(); }, []);

  return createPortal(
    <div className="gal-bg" onMouseDown={closeGallery}>
      <div className="gal-panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Surface gallery">
        <div className="gal-head">
          <Search size={16} className="gal-head-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            className="gal-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); closeGallery(); } else onKeyDown(e); }}
            placeholder="Search every surface — trial, cap wall, toast, 404…"
            aria-label="Search surfaces"
            spellCheck={false}
            autoComplete="off" />
          <button type="button" className="gal-x" onClick={closeGallery} aria-label="Close gallery">
            <X size={16} />
          </button>
        </div>

        <div className="gal-list">
          {flat.length === 0 && (
            <p className="gal-empty">Nothing matches “{q}”.</p>
          )}
          {groups.map((g) => (
            <div className="gal-group" key={g.id}>
              <div className="gal-group-label">{g.label}</div>
              {g.entries.map((e) => {
                const i = flat.indexOf(e);
                return (
                  <GalleryRow
                    key={e.id}
                    entry={e}
                    active={i === active}
                    innerRef={registerItem(i)}
                    onHover={() => setActive(i)}
                    onActivate={() => activate(e)}
                    param={params[e.id] || ''}
                    onParam={(v) => setParams((p) => ({ ...p, [e.id]: v }))} />
                );
              })}
            </div>
          ))}
        </div>

        <div className="gal-foot">
          <span>{flat.length} of {GALLERY_ENTRIES.length}</span>
          <span className="gal-foot-keys">↑↓ move · ↵ open · esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GalleryRow({ entry, active, innerRef, onHover, onActivate, param, onParam }) {
  const insitu = entry.kind === 'insitu';
  return (
    <div
      ref={innerRef}
      className={`gal-row${active ? ' is-active' : ''}${insitu ? ' is-insitu' : ''}`}
      onMouseMove={onHover}
      role="option"
      aria-selected={active}>
      <button type="button" className="gal-row-main" onClick={onActivate} disabled={insitu}>
        <span className="gal-row-label">{entry.label}</span>
        <span className={`gal-kind gal-kind-${entry.kind}`}>
          {insitu && <Info size={11} aria-hidden="true" />}
          {KIND_LABEL[entry.kind]}
        </span>
      </button>
      {entry.param && (
        <input
          className="gal-row-param"
          value={param}
          placeholder={entry.param}
          aria-label={`${entry.label} ${entry.param}`}
          spellCheck={false}
          onChange={(e) => onParam(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onActivate(); } e.stopPropagation(); }} />
      )}
      {insitu && <p className="gal-row-note">{entry.note}</p>}
    </div>
  );
}

// ── The preview ────────────────────────────────────────────────────────────

function GalleryPreview({ entryId }) {
  const entry = findEntry(entryId);
  const render = RENDERERS[entryId];
  const barRef = useRef(null);

  // Ordered the way the list shows them, so prev/next walks the group you were
  // looking at rather than the raw registry.
  const flat = useMemo(() => groupGallery(GALLERY_ENTRIES).flatMap((g) => g.entries)
    .filter((e) => e.kind === 'overlay'), []);
  const idx = flat.findIndex((e) => e.id === entryId);
  const step = useCallback((d) => {
    if (idx < 0 || flat.length === 0) return;
    previewSurface(flat[(idx + d + flat.length) % flat.length].id);
  }, [idx, flat]);

  const back = useCallback(() => previewSurface(null), []);

  // Escape always returns to the list, whatever the previewed surface does with
  // its own key handling. Capture phase so a modal's own Escape handler cannot
  // swallow it first and leave the gallery stuck behind its own preview.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      back();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [back]);

  // See the header: re-append the bar to the end of <body> whenever the
  // previewed surface changes, so it outranks a portal that mounted after us.
  useEffect(() => {
    const node = barRef.current;
    if (node && node.parentNode === document.body) document.body.appendChild(node);
  }, [entryId]);

  return (
    <>
      <div className="gal-stage" key={entryId}>
        {typeof render === 'function'
          ? render({ close: back })
          : <p className="gal-missing">No renderer for “{entryId}”.</p>}
      </div>
      {createPortal(
        <div className="gal-bar" ref={barRef}>
          <button type="button" className="gal-bar-btn" onClick={back}>
            <ChevronLeft size={14} aria-hidden="true" /> Gallery
          </button>
          <span className="gal-bar-name">{entry?.label || entryId}</span>
          <span className="gal-bar-spacer" />
          <button type="button" className="gal-bar-icon" onClick={() => step(-1)} aria-label="Previous surface">
            <ChevronUp size={14} />
          </button>
          <button type="button" className="gal-bar-icon" onClick={() => step(1)} aria-label="Next surface">
            <ChevronDown size={14} />
          </button>
          <button type="button" className="gal-bar-btn" onClick={closeGallery}>Close</button>
        </div>,
        document.body,
      )}
    </>
  );
}
