// The film player's timeline.
//
// full     a 36px track: a ruler when zoomed in, the rail (buffered, played),
//          the in/out region with draggable bracket handles, a lane for
//          comment markers, the playhead with a timecode flag while you scrub,
//          and a hover preview of the frame under the pointer. Zoom with the
//          −/Fit/+ buttons, ⌥= ⌥− ⌥0, or ⌘/Ctrl-scroll (pinch) around the
//          pointer; scroll to move along; the overview strip above shows and
//          drags the window. ⇧ while dragging scrubs a frame per few pixels.
// compact  a full-bleed scrubber along a card's bottom edge.
//
// The playhead moves outside React: the player calls `api.setFrame(n)` for
// every presented frame and this writes transforms — no re-render.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  frameAtX, xOfFrame, zoomWindow, clampFrame, followView, scrubFrame, rulerTicks, previewSize, clampRegion,
} from '../../lib/filmTransport.js';
import { frameCentre } from '../../lib/timecode.js';
import { Icon } from '../Icon.jsx';
import { Plus, Minus } from '../../lib/icons.js';

const fmtSec = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};

export const FilmTimeline = forwardRef(function FilmTimeline({
  frames, fps, fpsValue, t0 = 0, format, mode = 'full', range = { in: null, out: null }, looping = false,
  onRangeChange, markers = [], ghostMarkers = [], onMarker, mediaEl = null, previewUrl = null, ar = 16 / 9,
  playerWidth = 0, resetKey, onScrubStart, onScrub, onScrubEnd,
  // Quick look: the scrubber and its hover preview only — no zoom, no ruler.
  bare = false,
}, ref) {
  const full = mode !== 'compact';
  const trackRef = useRef(null);
  const headRef = useRef(null);
  const flagRef = useRef(null);
  const playedRef = useRef(null);
  const hoverRef = useRef(null);
  const hoverTcRef = useRef(null);
  const hoverOffRef = useRef(null);
  const lineRef = useRef(null);
  const previewRef = useRef(null);
  const frameRef = useRef(0);
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState({ viewStart: 0, viewEnd: Math.max(1, frames) });
  const viewRef = useRef(view);
  viewRef.current = view;
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const [scrubbing, setScrubbing] = useState(false);
  const scrubbingRef = useRef(false);
  const [buffered, setBuffered] = useState([]);
  const [previewOn, setPreviewOn] = useState(false);
  const [markerCard, setMarkerCard] = useState(null);
  const offTimer = useRef(null);
  const previewBusy = useRef(false);
  const previewWant = useRef(null);

  // The whole clip, until the user zooms: a new clip resets the view; a
  // frame count learnt late only widens it if it was showing everything.
  useEffect(() => { setView({ viewStart: 0, viewEnd: Math.max(1, framesRef.current) }); }, [resetKey]);
  // A frame count learnt (or changed) later: a view of the whole clip grows
  // with it; a zoomed one stays put, kept inside the clip.
  const prevFrames = useRef(frames);
  useEffect(() => {
    const old = prevFrames.current;
    prevFrames.current = frames;
    setView((v) => {
      const n = Math.max(1, frames);
      if (v.viewStart <= 0 && v.viewEnd >= Math.max(1, old) - 1) return { viewStart: 0, viewEnd: n };
      const span = Math.min(n, v.viewEnd - v.viewStart);
      const st = Math.max(0, Math.min(n - span, v.viewStart));
      return st === v.viewStart && st + span === v.viewEnd ? v : { viewStart: st, viewEnd: st + span };
    });
  }, [frames]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => { widthRef.current = el.clientWidth; setWidth(el.clientWidth); });
    ro.observe(el);
    widthRef.current = el.clientWidth;
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const xOf = (f, v = viewRef.current) => xOfFrame(f, { width: widthRef.current, ...v });

  const ovHeadRef = useRef(null);
  // `follow` (the frame moved — not the view): keep the playhead in the
  // window, paging on while playing and recentring on a jump. A view you
  // panned or zoomed yourself is never pulled back to the playhead.
  const place = useCallback((frame, { pending = false, playing = false, follow = false } = {}) => {
    const n = framesRef.current;
    const f = n > 0 ? Math.max(0, Math.min(n - 1, frame)) : frame;
    frameRef.current = f;
    const v = viewRef.current;
    const w = widthRef.current;
    if (follow && full && n && v.viewEnd - v.viewStart < n && !scrubbingRef.current) {
      const nv = (playing || f < v.viewStart || f > v.viewEnd) ? followView(v, f, n) : null;
      if (nv && (nv.viewStart !== v.viewStart || nv.viewEnd !== v.viewEnd)) { viewRef.current = nv; setView(nv); return; }
    }
    if (ovHeadRef.current && n) ovHeadRef.current.style.left = `${(f / n) * 100}%`;
    const x = xOfFrame(f + 0.5, { width: w, ...v });
    if (headRef.current) {
      headRef.current.style.transform = `translateX(${x}px)`;
      headRef.current.style.visibility = x < -1 || x > w + 1 ? 'hidden' : 'visible';
      headRef.current.classList.toggle('is-pending', !!pending);
    }
    if (playedRef.current) playedRef.current.style.transform = `scaleX(${w > 0 ? Math.max(0, Math.min(1, x / w)) : 0})`;
    if (flagRef.current && format) flagRef.current.textContent = format(f);
    const t = trackRef.current;
    if (t) { t.setAttribute('aria-valuenow', String(f)); if (format) t.setAttribute('aria-valuetext', format(f)); }
  }, [full, format]);

  useEffect(() => { place(frameRef.current); setMarkerCard(null); }, [view, width, place]);

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const zoomAround = useCallback((anchor, factor) => {
    const n = framesRef.current;
    if (!n) return;
    setView((v) => zoomWindow({ ...v, frames: n }, anchor, factor));
  }, []);
  const fit = useCallback(() => setView({ viewStart: 0, viewEnd: Math.max(1, framesRef.current) }), []);
  const zoomToRange = useCallback(() => {
    const n = framesRef.current;
    if (!n) return;
    const v = viewRef.current;
    if (v.viewEnd - v.viewStart < n) { fit(); return; }
    const a = range?.in, b = range?.out;
    const sec = fpsValue || 24;
    const s = a != null || b != null ? (a ?? 0) : frameRef.current - 2 * sec;
    const e = a != null || b != null ? (b ?? n - 1) + 1 : frameRef.current + 2 * sec;
    const pad = Math.max(2, (e - s) * 0.05);
    const start = Math.max(0, s - pad), end = Math.min(n, e + pad);
    const span = Math.min(n, Math.max(Math.min(24, n), end - start));
    const s0 = Math.max(0, Math.min(n - span, start));
    setView({ viewStart: s0, viewEnd: s0 + span });
  }, [range?.in, range?.out, fpsValue, fit]);

  useImperativeHandle(ref, () => ({
    setFrame: (f, opts = {}) => place(f, { ...opts, follow: true }),
    zoomIn: () => zoomAround(frameRef.current + 0.5, 0.5),
    zoomOut: () => zoomAround(frameRef.current + 0.5, 2),
    fit,
    zoomToRange,
    isZoomed: () => viewRef.current.viewEnd - viewRef.current.viewStart < framesRef.current,
  }), [place, zoomAround, fit, zoomToRange]);

  const geo = () => {
    const r = trackRef.current.getBoundingClientRect();
    return { left: r.left, width: r.width, ...viewRef.current, frames: framesRef.current };
  };

  // ── Buffered ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const v = mediaEl;
    if (!v || !full) return undefined;
    let last = '';
    const read = () => {
      const out = [];
      try {
        for (let i = 0; i < v.buffered.length; i++) out.push([v.buffered.start(i), v.buffered.end(i)]);
      } catch (_) { /* detached */ }
      const key = out.map((r) => r.map((n) => n.toFixed(2)).join('-')).join(',');
      if (key !== last) { last = key; setBuffered(out); }
    };
    read();
    v.addEventListener('progress', read);
    v.addEventListener('loadeddata', read);
    v.addEventListener('seeked', read);
    return () => {
      v.removeEventListener('progress', read);
      v.removeEventListener('loadeddata', read);
      v.removeEventListener('seeked', read);
    };
  }, [mediaEl, full]);

  // ── Scrubbing ─────────────────────────────────────────────────────────────
  const onPointerDown = (e) => {
    if (e.button !== 0 || !framesRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const el = trackRef.current;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    let st = scrubFrame(null, { x: e.clientX, shift: e.shiftKey, geo: geo() });
    let last = st.frame;
    scrubbingRef.current = true;
    setScrubbing(true);
    hideHover();
    onScrubStart?.(last);
    onScrub?.(last);
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const g = geo();
      // Past either edge of a zoomed window: move the window along.
      const n = g.frames;
      const span = g.viewEnd - g.viewStart;
      if (span < n) {
        const over = ev.clientX < g.left ? ev.clientX - g.left : ev.clientX > g.left + g.width ? ev.clientX - (g.left + g.width) : 0;
        if (over) {
          const d = (over / g.width) * span * 0.25;
          const s = Math.max(0, Math.min(n - span, g.viewStart + d));
          const nv = { viewStart: s, viewEnd: s + span };
          viewRef.current = nv;
          setView(nv);
        }
      }
      const gg = geo();
      const cx = Math.max(gg.left, Math.min(gg.left + gg.width - 1, ev.clientX));
      st = scrubFrame(st, { x: cx, shift: ev.shiftKey, geo: gg });
      if (flagRef.current) flagRef.current.dataset.fine = st.fine ? '1' : '';
      if (st.frame !== last) { last = st.frame; onScrub?.(last); }
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      scrubbingRef.current = false;
      setScrubbing(false);
      if (flagRef.current) flagRef.current.dataset.fine = '';
      onScrubEnd?.(last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // Dragging an in or out bracket.
  const onHandleDown = (which) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // On the window: the handle can scroll out of the window (and unmount)
    // while it's dragged past the edge of a zoomed timeline.
    const el = window;
    scrubbingRef.current = true;
    setScrubbing(true);
    const n = framesRef.current;
    let cur = range;
    const move = (ev) => {
      const f = frameAtX(ev.clientX, geo());
      const next = { ...cur };
      if (which === 'in') next.in = Math.min(f, cur.out ?? n - 1);
      else next.out = Math.max(f, cur.in ?? 0);
      cur = next;
      onRangeChange?.(next, which === 'in' ? next.in : next.out);
      if (flagRef.current && format) flagRef.current.textContent = format(which === 'in' ? next.in : next.out);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      scrubbingRef.current = false;
      setScrubbing(false);
      place(frameRef.current);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // ── Zoom and pan with the wheel ───────────────────────────────────────────
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !full || bare) return undefined;
    const onWheel = (e) => {
      const n = framesRef.current;
      if (!n) return;
      const g = geo();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const anchor = g.viewStart + ((e.clientX - g.left) / g.width) * (g.viewEnd - g.viewStart);
        zoomAround(anchor, Math.exp(e.deltaY * 0.01));
      } else if (g.viewEnd - g.viewStart < n && Math.abs(e.deltaX) + Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        const span = g.viewEnd - g.viewStart;
        const d = ((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / g.width) * span;
        setView((v) => {
          const s = Math.max(0, Math.min(n - span, v.viewStart + d));
          return { viewStart: s, viewEnd: s + span };
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [full, bare, zoomAround]);

  // ── Hover: pointer line, frame preview ────────────────────────────────────
  const seekPreview = useCallback((f) => {
    const v = previewRef.current;
    if (!v || !fps) return;
    previewWant.current = f;
    hoverRef.current?.classList.add('is-stale');
    if (previewBusy.current || v.readyState < 1) return;
    previewBusy.current = true;
    v.currentTime = frameCentre(f, fps, t0, v.duration || Infinity);
  }, [fps, t0]);
  useEffect(() => {
    const v = previewRef.current;
    if (!v) return undefined;
    const onSeeked = () => {
      previewBusy.current = false;
      const want = previewWant.current;
      const box = hoverRef.current;
      if (box && want != null) box.classList.toggle('is-stale', Math.abs(v.currentTime - frameCentre(want, fps, t0, v.duration || Infinity)) > 1e-3);
      if (want != null && Math.abs(v.currentTime - frameCentre(want, fps, t0, v.duration || Infinity)) > 1e-3) seekPreview(want);
    };
    const onMeta = () => { if (previewWant.current != null) seekPreview(previewWant.current); };
    // A new source aborts a seek in flight without a `seeked`: don't wait for it.
    const onReset = () => { previewBusy.current = false; };
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('emptied', onReset);
    v.addEventListener('loadstart', onReset);
    return () => {
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('emptied', onReset);
      v.removeEventListener('loadstart', onReset);
      previewBusy.current = false;
    };
  }, [fps, t0, seekPreview, previewOn]);

  const hideHover = () => {
    hoverRef.current?.classList.remove('is-on');
    lineRef.current?.classList.remove('is-on');
  };
  const onEnter = () => {
    clearTimeout(offTimer.current);
    if (full && previewUrl && !previewOn) setPreviewOn(true);
  };
  const onLeave = () => {
    hideHover();
    clearTimeout(offTimer.current);
    // Let go of the preview's video a while after the pointer leaves.
    offTimer.current = setTimeout(() => setPreviewOn(false), 10000);
  };
  useEffect(() => () => clearTimeout(offTimer.current), []);
  const pv = previewSize(ar, playerWidth, { fine: width && view.viewEnd > view.viewStart && width / (view.viewEnd - view.viewStart) >= 6 });
  const onMove = (e) => {
    if (!full || !framesRef.current || scrubbingRef.current) return;
    const g = geo();
    const f = frameAtX(e.clientX, g);
    const x = e.clientX - g.left;
    if (lineRef.current) { lineRef.current.style.transform = `translateX(${x}px)`; lineRef.current.classList.add('is-on'); }
    const box = hoverRef.current;
    if (box) {
      // Kept inside the player, 8px from either side.
      const host = trackRef.current?.closest?.('.film') || null;
      const hr = host ? host.getBoundingClientRect() : { left: 0, width: window.innerWidth };
      const centre = e.clientX;
      const minC = hr.left + 8 + pv.w / 2, maxC = hr.left + hr.width - 8 - pv.w / 2;
      const c = Math.max(minC, Math.min(maxC, centre));
      box.style.transform = `translateX(${c - g.left - pv.w / 2}px)`;
      box.classList.add('is-on');
      if (hoverTcRef.current && format) hoverTcRef.current.textContent = format(f);
      if (hoverOffRef.current) {
        const d = f - frameRef.current;
        const s = Math.round(fpsValue || 24);
        const sign = d < 0 ? '−' : '+';
        const a = Math.abs(d);
        hoverOffRef.current.textContent = d === 0 ? 'Playhead' : `${sign}${a >= s ? `${Math.floor(a / s)}s ` : ''}${a % s}f`;
      }
    }
    if (previewUrl) seekPreview(f);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const n = frames || 0;
  const zoomed = n > 0 && view.viewEnd - view.viewStart < n - 0.5;
  const ruler = full && zoomed ? rulerTicks(view, fpsValue || 24, width) : { major: [], minor: [] };
  const region = full ? clampRegion(range, view, width, n) : null;
  const dur = mediaEl?.duration;
  const bufSegs = full && Number.isFinite(dur) && dur > 0 && fpsValue
    ? buffered.map(([s, e]) => {
      const x0 = xOf(s * fpsValue), x1 = xOf(e * fpsValue);
      const l = Math.max(0, x0), r = Math.min(width, x1);
      return r > l ? { l, w: r - l } : null;
    }).filter(Boolean) : [];
  const visible = (m) => m.frame >= view.viewStart - 1 && m.frame <= view.viewEnd + 1;

  if (!full) {
    return (
      <div className={`ft ft--compact${scrubbing ? ' is-scrubbing' : ''}`}>
        <div className="ft-track" ref={trackRef} role="slider" aria-label="Timeline"
             aria-valuemin={0} aria-valuemax={Math.max(0, n - 1)} tabIndex={-1}
             onPointerDown={onPointerDown}>
          <div className="ft-rail"><div className="ft-played" ref={playedRef} /></div>
          <div className="ft-head" ref={headRef}><span className="ft-knob" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`ft ft--full${bare ? ' ft--bare' : ''}${zoomed ? ' is-zoomed' : ''}${scrubbing ? ' is-scrubbing' : ''}${looping ? ' is-looping' : ''}`}>
      <div className="ft-main">
        <div className="ft-overview" aria-hidden={!zoomed}
             onPointerDown={(e) => {
               if (!zoomed) return;
               e.preventDefault();
               const el = e.currentTarget;
               const r = el.getBoundingClientRect();
               const span = view.viewEnd - view.viewStart;
               const toView = (cx) => {
                 const c = ((cx - r.left) / r.width) * n;
                 const s = Math.max(0, Math.min(n - span, c - span / 2));
                 return { viewStart: s, viewEnd: s + span };
               };
               setView(toView(e.clientX));
               try { el.setPointerCapture(e.pointerId); } catch (_) {}
               const move = (ev) => setView(toView(ev.clientX));
               const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
               el.addEventListener('pointermove', move);
               el.addEventListener('pointerup', up);
             }}
             onDoubleClick={fit}>
          {zoomed && (
            <>
              {region && (range.in != null || range.out != null) && (
                <span className="ft-ov-range" style={{ left: `${((range.in ?? 0) / n) * 100}%`, width: `${(((range.out ?? n - 1) + 1 - (range.in ?? 0)) / n) * 100}%` }} />
              )}
              {markers.map((m) => <span key={`o${m.id}`} className="ft-ov-marker" style={{ left: `${(m.frame / n) * 100}%` }} />)}
              <span className="ft-ov-window" style={{ left: `${(view.viewStart / n) * 100}%`, width: `${((view.viewEnd - view.viewStart) / n) * 100}%` }} />
              <span className="ft-ov-head" ref={ovHeadRef} style={{ left: `${(frameRef.current / n) * 100}%` }} />
            </>
          )}
        </div>
        <div className="ft-track" ref={trackRef} role="slider" aria-label="Timeline"
             aria-valuemin={0} aria-valuemax={Math.max(0, n - 1)} tabIndex={-1}
             onPointerDown={onPointerDown} onPointerEnter={onEnter} onPointerMove={onMove} onPointerLeave={onLeave}>
          <div className="ft-clip">
            {zoomed && (
              <div className="ft-ruler" aria-hidden="true">
                {ruler.minor.map((f) => <span key={`m${f}`} className="ft-tick" style={{ transform: `translateX(${xOf(f)}px)` }} />)}
                {ruler.major.map((t) => (
                  <span key={`M${t.frame}`} className="ft-tick is-major" style={{ transform: `translateX(${xOf(t.frame)}px)` }}>
                    <span className="ft-tick-label">{fmtSec(t.sec)}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="ft-rail">
              {bufSegs.map((b, i) => <span key={i} className="ft-buffered" style={{ left: b.l, width: b.w }} />)}
              <div className="ft-played" ref={playedRef} />
            </div>
            {region && (
              <>
                <span className="ft-dim" style={{ left: 0, width: region.left }} />
                <span className="ft-dim" style={{ left: region.left + region.width, right: 0 }} />
                <span className="ft-region" style={{ left: region.left, width: region.width }} />
              </>
            )}
            {ghostMarkers.filter(visible).map((m) => (
              <span key={`g-${m.id}`} className="ft-marker is-ghost" style={{ transform: `translateX(${xOf(m.frame + 0.5)}px)` }} />
            ))}
            {markers.filter((m) => m.endFrame != null ? m.endFrame >= view.viewStart && m.frame <= view.viewEnd : visible(m)).map((m) => {
              const isRange = m.endFrame != null && m.endFrame > m.frame;
              const style = isRange
                ? { left: `${xOf(m.frame)}px`, width: `${Math.max(4, xOf(m.endFrame + 1) - xOf(m.frame))}px` }
                : { transform: `translateX(${xOf(m.frame + 0.5)}px)` };
              return (
                <button key={m.id} type="button" tabIndex={-1} aria-label={m.label || 'Comment'}
                        className={`ft-marker${isRange ? ' is-range' : ''}${m.active ? ' is-active' : ''}`} style={style}
                        onPointerEnter={(e) => setMarkerCard({ m, x: e.currentTarget.getBoundingClientRect().left - trackRef.current.getBoundingClientRect().left })}
                        onPointerLeave={() => setMarkerCard(null)}
                        onPointerDown={(e) => { e.stopPropagation(); onMarker?.(m); }} />
              );
            })}
          </div>
          {region && range.in != null && region.inX >= -6 && region.inX <= width + 6 && (
            <span className="ft-handle is-in" style={{ transform: `translateX(${region.inX}px)` }}
                  onPointerDown={onHandleDown('in')} aria-hidden="true" />
          )}
          {region && range.out != null && region.outX >= -6 && region.outX <= width + 6 && (
            <span className="ft-handle is-out" style={{ transform: `translateX(${region.outX}px)` }}
                  onPointerDown={onHandleDown('out')} aria-hidden="true" />
          )}
          <span className="ft-line" ref={lineRef} aria-hidden="true" />
          <div className="ft-head" ref={headRef}>
            <span className="ft-head-cap" />
            <span className="ft-flag" ref={flagRef} />
          </div>
          {markerCard && (
            <div className="ft-marker-card" style={{ transform: `translateX(${Math.max(0, Math.min(width - 240, markerCard.x - 20))}px)` }}>
              {markerCard.m.author && <span className="ft-marker-author">{markerCard.m.author}</span>}
              {format && <span className="ft-marker-tc">{format(markerCard.m.frame)}</span>}
              {(markerCard.m.text || markerCard.m.label) && <span className="ft-marker-text">{markerCard.m.text || markerCard.m.label}</span>}
            </div>
          )}
          {previewUrl && (
            <div className="ft-hover" ref={hoverRef} style={{ width: pv.w }} aria-hidden="true">
              <div className="ft-preview-box" style={{ height: pv.h }}>
                {previewOn && <video ref={previewRef} className="ft-preview" src={previewUrl} muted preload="metadata" playsInline />}
                <span className="ft-hover-tc" ref={hoverTcRef} />
              </div>
              <span className="ft-hover-off" ref={hoverOffRef} />
            </div>
          )}
        </div>
      </div>
      <div className="ft-zoom" role="group" aria-label="Timeline zoom">
        <button type="button" className="film-btn film-btn--sm" data-tip="Zoom out" data-key="⌥−"
                onClick={() => zoomAround(frameRef.current + 0.5, 2)} disabled={!zoomed} aria-label="Zoom the timeline out">
          <Icon as={Minus} size={14} weight="regular" />
        </button>
        <button type="button" className="ft-zoom-chip" data-tip={zoomed ? 'Fit the whole clip' : 'Zoom to in and out'} data-key={zoomed ? '⌥0' : '⇧Z'}
                onClick={zoomed ? fit : zoomToRange}>
          {zoomed ? `×${Math.max(1, Math.round(n / (view.viewEnd - view.viewStart)))}` : 'Fit'}
        </button>
        <button type="button" className="film-btn film-btn--sm" data-tip="Zoom in" data-key="⌥="
                onClick={() => zoomAround(frameRef.current + 0.5, 0.5)} disabled={n <= 24 || (view.viewEnd - view.viewStart) <= 24.5} aria-label="Zoom the timeline in">
          <Icon as={Plus} size={14} weight="regular" />
        </button>
      </div>
    </div>
  );
});
