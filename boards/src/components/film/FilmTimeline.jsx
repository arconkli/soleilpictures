// The film player's timeline. A scrubber that lands on whole frames, zooms
// around the pointer (⌘/Ctrl-scroll or pinch) until single frames are wide
// enough to see as ticks, scrubs at a tenth of the speed with ⇧ held, shades
// the in/out range, and marks comments (dots, or bars for a range). In the
// full player, hovering shows that frame in a small preview — a second muted
// <video> seeked there, so it works on a signed URL the page can't read pixels
// from.
//
// The playhead moves outside React: the player calls `api.setFrame(n)` for
// every presented frame and this writes a transform, no re-render.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { frameAtX, xOfFrame, zoomWindow, clampFrame } from '../../lib/filmTransport.js';
import { frameCentre } from '../../lib/timecode.js';

const MIN_TICK_PX = 6;

export const FilmTimeline = forwardRef(function FilmTimeline({
  frames, fps, t0 = 0, formatFrame, range = { in: null, out: null }, markers = [], ghostMarkers = [],
  previewUrl = null, compact = false, onScrubStart, onScrub, onScrubEnd, onMarker,
}, ref) {
  const trackRef = useRef(null);
  const headRef = useRef(null);
  const playedRef = useRef(null);
  const frameRef = useRef(0);
  const [view, setView] = useState({ viewStart: 0, viewEnd: Math.max(1, frames) });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);      // { frame, x }
  const previewRef = useRef(null);
  const previewBusy = useRef(false);
  const previewWant = useRef(null);

  // A new clip (or a frame count learnt late) resets the zoom.
  useEffect(() => { setView({ viewStart: 0, viewEnd: Math.max(1, frames) }); }, [frames]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const place = useCallback((f) => {
    frameRef.current = f;
    const v = viewRef.current;
    const w = trackRef.current?.clientWidth || 0;
    const x = xOfFrame(f + 0.5, { width: w, ...v });
    if (headRef.current) {
      headRef.current.style.transform = `translateX(${x}px)`;
      headRef.current.style.visibility = x < -1 || x > w + 1 ? 'hidden' : 'visible';
    }
    if (playedRef.current) playedRef.current.style.width = `${Math.max(0, Math.min(w, x))}px`;
  }, []);

  useImperativeHandle(ref, () => ({ setFrame: place }), [place]);
  useEffect(() => { place(frameRef.current); }, [view, width, place]);

  // ── Scrubbing ─────────────────────────────────────────────────────────────
  const geo = () => {
    const r = trackRef.current.getBoundingClientRect();
    return { left: r.left, width: r.width, ...viewRef.current, frames };
  };
  const onPointerDown = (e) => {
    if (e.button !== 0 || !frames) return;
    e.preventDefault();
    e.stopPropagation();
    const el = trackRef.current;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    const g = geo();
    let base = frameAtX(e.clientX, g);
    const startX = e.clientX;
    let startFrame = base;
    onScrubStart?.(base);
    onScrub?.(base);
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const gg = geo();
      let f;
      if (ev.shiftKey) {
        // Fine: a tenth of the speed, from where ⇧ was pressed.
        const perPx = (gg.viewEnd - gg.viewStart) / gg.width / 10;
        f = clampFrame(startFrame + (ev.clientX - startX) * perPx, frames);
      } else {
        f = frameAtX(ev.clientX, gg);
        startFrame = f;
      }
      if (f !== base) { base = f; onScrub?.(f); }
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onScrubEnd?.(base);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // ── Zoom and pan ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = trackRef.current;
    if (!el || compact) return undefined;
    const onWheel = (e) => {
      if (!frames) return;
      const g = geo();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const anchor = g.viewStart + ((e.clientX - g.left) / g.width) * (g.viewEnd - g.viewStart);
        setView((v) => zoomWindow({ ...v, frames }, anchor, Math.exp(e.deltaY * 0.01)));
      } else if (g.viewEnd - g.viewStart < frames && Math.abs(e.deltaX) + Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        const span = g.viewEnd - g.viewStart;
        const d = ((e.deltaX || e.deltaY) / g.width) * span;
        setView((v) => {
          const s = Math.max(0, Math.min(frames - span, v.viewStart + d));
          return { viewStart: s, viewEnd: s + span };
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [frames, compact]);

  // ── Hover preview ─────────────────────────────────────────────────────────
  const seekPreview = useCallback((f) => {
    const v = previewRef.current;
    if (!v || !fps) return;
    previewWant.current = f;
    if (previewBusy.current) return;
    previewBusy.current = true;
    v.currentTime = frameCentre(f, fps, t0, v.duration || Infinity);
  }, [fps, t0]);
  useEffect(() => {
    const v = previewRef.current;
    if (!v) return undefined;
    const onSeeked = () => {
      previewBusy.current = false;
      const want = previewWant.current;
      if (want != null && Math.abs(v.currentTime - frameCentre(want, fps, t0, v.duration || Infinity)) > 1e-3) seekPreview(want);
    };
    v.addEventListener('seeked', onSeeked);
    return () => v.removeEventListener('seeked', onSeeked);
  }, [fps, t0, seekPreview, previewUrl]);

  const onMove = (e) => {
    if (compact || !frames) return;
    const g = geo();
    const f = frameAtX(e.clientX, g);
    setHover({ frame: f, x: e.clientX - g.left });
    if (previewUrl) seekPreview(f);
  };

  const zoomed = view.viewEnd - view.viewStart < frames;
  const pxPerFrame = width && view.viewEnd > view.viewStart ? width / (view.viewEnd - view.viewStart) : 0;
  const ticks = [];
  if (!compact && pxPerFrame >= MIN_TICK_PX) {
    for (let f = Math.floor(view.viewStart); f <= Math.ceil(view.viewEnd) && ticks.length < 600; f++) ticks.push(f);
  }
  const xOf = (f) => xOfFrame(f, { width, ...view });
  const rangeIn = range?.in, rangeOut = range?.out;

  return (
    <div className={`ft-timeline${compact ? ' is-compact' : ''}${zoomed ? ' is-zoomed' : ''}`}>
      <div className="ft-track" ref={trackRef} role="slider" aria-label="Timeline"
           aria-valuemin={0} aria-valuemax={Math.max(0, frames - 1)} aria-valuenow={frameRef.current}
           aria-valuetext={formatFrame ? formatFrame(frameRef.current) : String(frameRef.current)}
           tabIndex={-1}
           onPointerDown={onPointerDown} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <div className="ft-rail" />
        <div className="ft-played" ref={playedRef} />
        {(rangeIn != null || rangeOut != null) && (
          <div className="ft-range" style={{
            left: `${Math.max(0, xOf(rangeIn ?? 0))}px`,
            width: `${Math.max(2, xOf((rangeOut ?? frames - 1) + 1) - Math.max(0, xOf(rangeIn ?? 0)))}px`,
          }} />
        )}
        {ticks.map((f) => (
          <span key={f} className={`ft-tick${fps && f % Math.round(fps[0] / fps[1]) === 0 ? ' is-second' : ''}`} style={{ transform: `translateX(${xOf(f)}px)` }} />
        ))}
        {ghostMarkers.map((m) => (
          <span key={`g-${m.id}`} className="ft-marker is-ghost" style={{ transform: `translateX(${xOf(m.frame + 0.5)}px)` }} title={m.label} />
        ))}
        {markers.map((m) => (
          m.endFrame != null && m.endFrame > m.frame ? (
            <button key={m.id} type="button" className={`ft-marker is-range${m.active ? ' is-active' : ''}`} tabIndex={-1}
                    style={{ left: `${xOf(m.frame)}px`, width: `${Math.max(4, xOf(m.endFrame + 1) - xOf(m.frame))}px` }}
                    title={m.label} onPointerDown={(e) => { e.stopPropagation(); onMarker?.(m); }} />
          ) : (
            <button key={m.id} type="button" className={`ft-marker${m.active ? ' is-active' : ''}`} tabIndex={-1}
                    style={{ transform: `translateX(${xOf(m.frame + 0.5)}px)` }}
                    title={m.label} onPointerDown={(e) => { e.stopPropagation(); onMarker?.(m); }} />
          )
        ))}
        <div className="ft-head" ref={headRef}><span className="ft-head-cap" /></div>
        {/* Mounted for the whole session, not per hover: its seeked listener
            is what lets the next preview seek go. */}
        {!compact && (
          <div className="ft-hover" hidden={!hover}
               style={{ transform: `translateX(${Math.max(64, Math.min(width - 64, hover?.x ?? 0))}px)` }}>
            {previewUrl && <video ref={previewRef} className="ft-preview" src={previewUrl} muted preload="auto" playsInline />}
            <span className="ft-hover-tc">{hover ? (formatFrame ? formatFrame(hover.frame) : hover.frame) : ''}</span>
          </div>
        )}
      </div>
      {zoomed && !compact && (
        <div className="ft-overview" aria-hidden="true">
          <span style={{ left: `${(view.viewStart / frames) * 100}%`, width: `${((view.viewEnd - view.viewStart) / frames) * 100}%` }} />
        </div>
      )}
    </div>
  );
});
