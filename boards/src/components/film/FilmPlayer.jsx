// The film player. One component, two sizes:
//   compact  on a video card on the board — play, ±1 frame, a frame-accurate
//            scrubber, timecode, mute, and ⤢ into the full player. It takes no
//            keys (the board owns those); its buttons don't take focus.
//   full     the review player (FilmReview) — everything above plus J/K/L
//            shuttle and reverse, frame stepping, in/out and loop, a zoomable
//            timeline with hover previews, typed timecode jumps, playback rate,
//            framing guides, full screen, and an A/B flip to another version.
//
// Frames are exact: the clip's own frame rate (lib/mediaProbe.js), or one
// measured from the first frames played; the frame on screen is read from the
// presented frame (useFilmClock), and every seek aims at a frame's centre
// (lib/timecode.js). Transport decisions live in lib/filmTransport.js.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { resolveSrc } from '../../lib/r2.js';
import * as audioBus from '../../lib/audioBus.js';
import { frameCentre, frameStart, frameCount, frameToTC, parseJump, rateValue, canDropFrame } from '../../lib/timecode.js';
import { shuttle, reverseStepFrames, clampFrame, normalizeRange, loopTarget, nextMarker } from '../../lib/filmTransport.js';
import { playerAction } from '../../lib/playerKeys.js';
import { containRect } from '../../lib/frameAnnotation.js';
import { FilmTimeline } from './FilmTimeline.jsx';
import './film.css';
import { useFilmClock } from './useFilmClock.js';
import { Icon } from '../Icon.jsx';
import {
  Play, Pause, SpeakerHigh, SpeakerSlash, Repeat, CornersOut, CornersIn, ChevronLeft, ChevronRight, ArrowsOutSimple,
} from '../../lib/icons.js';

export function useResolvedUrl(src) {
  const [url, setUrl] = useState(() => (src && !String(src).startsWith('r2:') ? src : null));
  useEffect(() => {
    let off = false;
    if (!src) { setUrl(null); return undefined; }
    if (!String(src).startsWith('r2:')) { setUrl(src); return undefined; }
    setUrl(null);
    resolveSrc(src).then((u) => { if (!off) setUrl(u || null); }).catch(() => {});
    return () => { off = true; };
  }, [src]);
  return url;
}

const TC_MODES = ['tc', 'frames', 'seconds'];
const TC_KEY = 'soleil.player.tcMode';
function readTcMode() { try { const m = localStorage.getItem(TC_KEY); return TC_MODES.includes(m) ? m : 'tc'; } catch (_) { return 'tc'; } }
function writeTcMode(m) { try { localStorage.setItem(TC_KEY, m); } catch (_) {} }

export const GUIDES = [
  { id: 'off', label: 'No guides' },
  { id: '2.39', label: '2.39:1', ar: 2.39 },
  { id: '1.85', label: '1.85:1', ar: 1.85 },
  { id: '16:9', label: '16:9', ar: 16 / 9 },
  { id: '4:3', label: '4:3', ar: 4 / 3 },
  { id: '1:1', label: '1:1', ar: 1 },
  { id: '9:16', label: '9:16', ar: 9 / 16 },
  { id: 'safe', label: 'Action & title safe' },
];
const RATES = [0.25, 0.5, 1, 1.5, 2];

function formatSeconds(t) {
  if (!Number.isFinite(t)) return '0.000';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export const FilmPlayer = forwardRef(function FilmPlayer({
  src, poster = null, media = null, mode = 'full', title = '', markers = [], ghostMarkers = [],
  compareSrc = null, compareLabel = '', label = '', autoPlay = false, keyboard = false,
  onAction, onFrameChange, onExpand, overlay = null, className = '',
  // () => Promise<facts|null>: reads the clip's frame rate when the card
  // doesn't know it yet (hooks/useMediaFacts.probeCardVideo). Asked on first
  // use — a board full of clips never probes just by rendering.
  probe = null,
}, ref) {
  const full = mode === 'full';
  const [probed, setProbed] = useState(null);
  const askedRef = useRef(false);
  const ensureFacts = () => {
    if (askedRef.current || media?.fps || !probe) return;
    askedRef.current = true;
    Promise.resolve(probe()).then((f) => { if (f) setProbed(f); }).catch(() => {});
  };
  useEffect(() => { if (full) ensureFacts(); });   // eslint-disable-line react-hooks/exhaustive-deps
  media = media?.fps ? media : (probed ? { ...(media || {}), ...probed } : media);
  const url = useResolvedUrl(src);
  const posterUrl = useResolvedUrl(poster);
  const compareUrl = useResolvedUrl(compareSrc);
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const altRef = useRef(null);       // the other version, for A/B
  const tcRef = useRef(null);
  const timelineRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(media?.dur || 0);
  const [muted, setMuted] = useState(!full);
  const [rate, setRate] = useState(1);
  const [range, setRange] = useState({ in: null, out: null });
  const [looping, setLooping] = useState(false);
  const [tcMode, setTcMode] = useState(readTcMode);
  const [editingTc, setEditingTc] = useState(false);
  const [guide, setGuide] = useState('off');
  const [isFull, setIsFull] = useState(false);
  const [showB, setShowB] = useState(false);
  const [frameState, setFrameState] = useState(0);     // React's copy, updated when paused
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const frameRef = useRef(0);
  const wantRef = useRef(null);         // { frame, settledAt } — the frame a paused seek is for
  const touchedRef = useRef(false);     // someone has used the transport — no autoplay after that
  const targetRef = useRef(null);       // a seek in flight
  const pendingRef = useRef(null);      // the next one, coalesced
  const shuttleRef = useRef({ dir: 0, rate: 1 });
  const reverseRef = useRef({ active: false, last: 0 });
  const kHeld = useRef(false);

  const startFrames = media?.tc?.frame || 0;
  const df = !!media?.tc?.df;

  const editingTcRef = useRef(false);
  editingTcRef.current = editingTc;
  const onFrameChangeRef = useRef(onFrameChange);
  onFrameChangeRef.current = onFrameChange;
  const formatRef = useRef(null);

  const tick = useCallback((f, mt) => {
    if (f == null) {
      if (tcRef.current && !editingTcRef.current) tcRef.current.textContent = formatSeconds(mt);
      return;
    }
    // Paused on a frame we asked for: a presented-frame callback from the
    // previous seek can land after the next one starts. Taking it would count
    // the next step from a frame we've already left — a lost keypress.
    const want = wantRef.current;
    if (want && videoRef.current?.paused) {
      if (f !== want.frame && !(want.settledAt && performance.now() - want.settledAt > 150)) return;
      wantRef.current = null;
    }
    frameRef.current = f;
    if (tcRef.current && !editingTcRef.current) tcRef.current.textContent = formatRef.current(f, mt);
    timelineRef.current?.setFrame(f);
    onFrameChangeRef.current?.(f);
  }, []);
  const { fps, t0 } = useFilmClock(videoRef, { fps: media?.fps || null, url, onTick: tick });
  const frames = useMemo(() => (media?.frames && fps && media?.fps ? media.frames : frameCount(duration, fps)), [media?.frames, media?.fps, duration, fps]);

  const format = useCallback((f, mt) => {
    if (!fps) return formatSeconds(mt ?? 0);
    if (tcMode === 'frames') return String(f);
    if (tcMode === 'seconds') return formatSeconds(frameStart(f, fps, 0));
    return frameToTC(f, fps, { df: df && canDropFrame(fps), start: startFrames });
  }, [fps, tcMode, df, startFrames]);
  formatRef.current = format;
  useEffect(() => { if (tcRef.current && !editingTc) tcRef.current.textContent = format(frameRef.current, videoRef.current?.currentTime); }, [format, editingTc]);

  // ── Seeking ───────────────────────────────────────────────────────────────
  const seekFrame = useCallback((n) => {
    const v = videoRef.current;
    if (!v) return;
    const f = clampFrame(n, frames || Infinity);
    if (!fps) { v.currentTime = Math.max(0, n / 24); return; }
    if (v.seeking && targetRef.current != null) { pendingRef.current = f; return; }
    targetRef.current = f;
    frameRef.current = f;
    wantRef.current = { frame: f, settledAt: 0 };
    setFrameState(f);
    v.currentTime = frameCentre(f, fps, t0, v.duration || Infinity);
    timelineRef.current?.setFrame(f);
    if (tcRef.current && !editingTcRef.current) tcRef.current.textContent = formatRef.current(f);
    if (altRef.current && Number.isFinite(altRef.current.duration)) {
      altRef.current.currentTime = Math.min(altRef.current.duration - 1e-3, v.currentTime);
    }
  }, [fps, t0, frames]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const onSeeked = () => {
      targetRef.current = null;
      if (wantRef.current) wantRef.current.settledAt = performance.now();
      if (pendingRef.current != null) { const p = pendingRef.current; pendingRef.current = null; seekFrame(p); return; }
      if (reverseRef.current.active) reverseStep();
    };
    v.addEventListener('seeked', onSeeked);
    return () => v.removeEventListener('seeked', onSeeked);
  });

  // The frame to count from when stepping: where a seek is headed, if one is.
  const here = () => (pendingRef.current ?? targetRef.current ?? frameRef.current);

  // ── Transport ─────────────────────────────────────────────────────────────
  const stopReverse = () => { reverseRef.current.active = false; };
  const pause = useCallback(() => {
    touchedRef.current = true;
    stopReverse();
    shuttleRef.current = { dir: 0, rate: 1 };
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
  }, []);
  const play = useCallback((r = 1) => {
    touchedRef.current = true;
    stopReverse();
    wantRef.current = null;
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = r;
    setRate(r);
    // At the end (or past an out point): start from the top of the range.
    const rr = normalizeRange(range.in, range.out, frames);
    if (frames && here() >= (rr.out ?? frames - 1)) seekFrame(rr.in ?? 0);
    v.play().catch(() => {});
  }, [range, frames, seekFrame]);
  const toggle = useCallback(() => {
    ensureFacts();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused && !reverseRef.current.active) play(1); else pause();
  }, [play, pause]);
  const step = useCallback((delta) => {
    ensureFacts();
    pause();
    seekFrame(here() + delta);
  }, [pause, seekFrame]);
  function reverseStep() {
    const v = videoRef.current;
    const st = reverseRef.current;
    if (!v || !st.active) return;
    const now = performance.now();
    const n = reverseStepFrames(now - st.last, shuttleRef.current.rate, fps || [24, 1]);
    st.last = now;
    const rr = normalizeRange(range.in, range.out, frames);
    let target = here() - n;
    if (target < (rr.in ?? 0)) {
      if (looping) target = rr.out ?? frames - 1;
      else { st.active = false; seekFrame(rr.in ?? 0); return; }
    }
    seekFrame(target);
  }
  const doShuttle = useCallback((key) => {
    const next = shuttle(shuttleRef.current, key);
    shuttleRef.current = next;
    const v = videoRef.current;
    if (!v) return;
    if (next.dir === 0) { pause(); return; }
    if (next.dir > 0) { stopReverse(); play(next.rate); return; }
    if (!v.paused) v.pause();
    setPlaying(true);
    reverseRef.current = { active: true, last: performance.now() };
    reverseStep();
  }, [pause, play]);

  // Loop at the out point while playing forward.
  useEffect(() => {
    if (!looping || !playing) return undefined;
    let raf;
    const check = () => {
      const lt = loopTarget(frameRef.current, normalizeRange(range.in, range.out, frames), 1, frames);
      if (lt != null) seekFrame(lt);
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [looping, playing, range, frames, seekFrame]);

  // Autoplay, but not the attribute: a clip that finishes loading after you
  // pressed K or stepped a frame must not start under you.
  useEffect(() => {
    const v = videoRef.current;
    if (!autoPlay || !v || !url) return undefined;
    const go = () => { if (!touchedRef.current) v.play().catch(() => {}); };
    if (v.readyState >= 3) { go(); return undefined; }
    v.addEventListener('canplay', go, { once: true });
    return () => v.removeEventListener('canplay', go);
  }, [autoPlay, url]);

  // Video element state → React.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const stop = () => { try { v.pause(); } catch (_) {} };
    const onPlay = () => { setPlaying(true); if (!v.muted) audioBus.claim(stop, { source: 'film' }); };
    const onPause = () => { if (!reverseRef.current.active) setPlaying(false); setFrameState(frameRef.current); audioBus.release(stop); };
    const onMeta = () => { if (Number.isFinite(v.duration)) setDuration(v.duration); };
    const onVolume = () => setMuted(v.muted);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('volumechange', onVolume);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('volumechange', onVolume);
      stop();
      audioBus.release(stop);
    };
  }, [url]);

  // The picture's box inside the stage, for drawings and guides.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setStageBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pictureAr = media?.w && media?.h ? media.w / media.h : (videoRef.current?.videoWidth ? videoRef.current.videoWidth / videoRef.current.videoHeight : 16 / 9);
  const picture = containRect(stageBox.w, stageBox.h, pictureAr);

  // ── Full screen ───────────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setIsFull(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const markIn = () => setRange((r) => ({ ...r, in: here() }));
  const markOut = () => setRange((r) => ({ ...r, out: here() }));
  const clearRange = () => { setRange({ in: null, out: null }); setLooping(false); };
  const jumpMarker = (dir) => {
    const t = nextMarker(markers.map((m) => m.frame), here(), dir);
    if (t != null) { pause(); seekFrame(t); onAction?.('marker', markers.find((m) => m.frame === t)); }
  };
  const flip = () => {
    if (!compareUrl) return;
    pause();
    setShowB((b) => !b);
  };

  const api = useMemo(() => ({
    play, pause, toggle, step, seekFrame,
    getFrame: () => frameRef.current, getFps: () => fps, getT0: () => t0, getRange: () => normalizeRange(range.in, range.out, frames),
    getPicture: () => picture, element: () => videoRef.current, format: (f) => formatRef.current(f),
    markIn, markOut, clearRange, setRange,
  }), [play, pause, toggle, step, seekFrame, fps, t0, range, frames, picture]);
  useImperativeHandle(ref, () => api, [api]);

  // ── Keys (full player only; capture phase, so nothing behind it hears them) ─
  useEffect(() => {
    if (!keyboard) return undefined;
    const onDown = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      if (e.key === 'k' || e.key === 'K') kHeld.current = true;
      const a = playerAction(e, { kHeld: kHeld.current });
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      const sec = Math.max(1, Math.round(rateValue(fps) || 24));
      switch (a) {
        case 'toggle': toggle(); break;
        case 'stop': pause(); break;
        case 'shuttleFwd': doShuttle('l'); break;
        case 'shuttleBack': doShuttle('j'); break;
        case 'fwd1f': step(1); break;
        case 'back1f': step(-1); break;
        case 'fwd1s': step(sec); break;
        case 'back1s': step(-sec); break;
        case 'start': pause(); seekFrame(0); break;
        case 'end': pause(); seekFrame(frames - 1); break;
        case 'markIn': markIn(); break;
        case 'markOut': markOut(); break;
        case 'clearInOut': clearRange(); break;
        case 'loop': setLooping((l) => !l); break;
        case 'mute': if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; break;
        case 'fullscreen': toggleFull(); break;
        case 'guides': setGuide((g) => (g === 'off' ? '2.39' : 'off')); break;
        case 'compare': flip(); break;
        case 'nextComment': jumpMarker(1); break;
        case 'prevComment': jumpMarker(-1); break;
        default: onAction?.(a); break;      // comment, draw, escape
      }
    };
    const onUp = (e) => { if (e.key === 'k' || e.key === 'K') kHeld.current = false; };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  });

  // ── Timecode field: click to type a jump ────────────────────────────────
  const jumpTo = (text) => {
    setEditingTc(false);
    if (!fps) return;
    const f = parseJump(text, { fps, current: here(), startFrames, df, frames });
    if (f != null) { pause(); seekFrame(f); }
  };
  const cycleTcMode = () => {
    const next = TC_MODES[(TC_MODES.indexOf(tcMode) + 1) % TC_MODES.length];
    setTcMode(next);
    writeTcMode(next);
  };

  const scrubWasPlaying = useRef(false);
  const downAt = useRef(null);
  const btn = (props) => ({ type: 'button', tabIndex: full ? 0 : -1, onPointerDown: (e) => { e.stopPropagation(); if (!full) e.preventDefault(); }, ...props });
  const timeline = (
    <FilmTimeline ref={timelineRef} frames={frames} fps={fps} t0={t0} compact={!full}
                  formatFrame={(f) => format(f)} range={range}
                  markers={markers} ghostMarkers={ghostMarkers}
                  previewUrl={full ? url : null}
                  onScrubStart={() => { ensureFacts(); scrubWasPlaying.current = !videoRef.current?.paused; pause(); }}
                  onScrub={(f) => seekFrame(f)}
                  onScrubEnd={() => { if (scrubWasPlaying.current && full) play(rate); }}
                  onMarker={(m) => { pause(); seekFrame(m.frame); onAction?.('marker', m); }} />
  );

  if (!url) return <div className={`film film--${mode} is-loading ${className}`} aria-label="Loading video" />;

  const guideDef = GUIDES.find((g) => g.id === guide);
  return (
    <div ref={rootRef} className={`film film--${mode}${isFull ? ' is-fullscreen' : ''}${playing ? ' is-playing' : ''} ${className}`}
         data-frame={frameState} aria-label={title ? `Player: ${title}` : 'Player'}>
      <div className="film-stage" ref={stageRef}
           onPointerDown={full ? undefined : (e) => { downAt.current = { x: e.clientX, y: e.clientY }; }}
           onClick={full ? undefined : (e) => {
             // A click plays; a drag (moving the card) doesn't.
             const d = downAt.current;
             downAt.current = null;
             if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
             e.stopPropagation(); toggle();
           }}
           onDoubleClick={full ? toggleFull : undefined}>
        <video ref={videoRef} className={`film-video${showB ? ' is-hidden' : ''}`} src={url} poster={posterUrl || undefined}
               preload={full ? 'auto' : 'metadata'} playsInline muted={muted}
               aria-label={title || 'Video'} />
        {compareUrl && (
          <video ref={altRef} className={`film-video film-video--b${showB ? '' : ' is-hidden'}`} src={compareUrl}
                 preload="auto" playsInline muted aria-label={compareLabel || 'Other version'} />
        )}
        {full && guideDef && guideDef.id !== 'off' && picture.w > 0 && (
          <FramingGuide guide={guideDef} picture={picture} />
        )}
        {full && overlay && picture.w > 0 && (
          <div className="film-overlay" style={{ left: picture.x, top: picture.y, width: picture.w, height: picture.h }}>
            {overlay({ picture, frame: frameState })}
          </div>
        )}
        {full && (label || compareUrl) && (
          <span className="film-badge">{showB ? (compareLabel || 'B') : (label || 'A')}</span>
        )}
      </div>
      <div className="film-bar" onPointerDown={(e) => e.stopPropagation()}>
        <button {...btn({ className: 'film-btn film-play', onClick: toggle, 'aria-label': playing ? 'Pause' : 'Play', title: full ? (playing ? 'Pause (Space)' : 'Play (Space)') : undefined })}>
          <Icon as={playing ? Pause : Play} size={full ? 18 : 14} weight="fill" />
        </button>
        <button {...btn({ className: 'film-btn', onClick: () => step(-1), 'aria-label': 'Back one frame', title: 'Back one frame (←)' })}>
          <Icon as={ChevronLeft} size={14} />
        </button>
        <button {...btn({ className: 'film-btn', onClick: () => step(1), 'aria-label': 'Forward one frame', title: 'Forward one frame (→)' })}>
          <Icon as={ChevronRight} size={14} />
        </button>
        {full ? (
          editingTc ? (
            <input className="film-tc film-tc-input" autoFocus defaultValue={format(frameRef.current)} aria-label="Go to timecode, frame or seconds"
                   onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') jumpTo(e.currentTarget.value); if (e.key === 'Escape') setEditingTc(false); }}
                   onBlur={() => setEditingTc(false)} />
          ) : (
            <button {...btn({ className: 'film-tc', onClick: () => setEditingTc(true), onContextMenu: (e) => { e.preventDefault(); cycleTcMode(); }, title: 'Type a timecode, frame or seconds to jump · right-click to switch timecode / frames / seconds' })}>
              <span ref={tcRef}>{format(0, 0)}</span>
            </button>
          )
        ) : (
          <span className="film-tc" ref={tcRef}>{format(0, 0)}</span>
        )}
        <div className="film-timeline-slot">{timeline}</div>
        {full && (
          <>
            <button {...btn({ className: `film-btn${range.in != null ? ' is-set' : ''}`, onClick: markIn, 'aria-label': 'Set in point', title: 'Set in (I)' })}>I</button>
            <button {...btn({ className: `film-btn${range.out != null ? ' is-set' : ''}`, onClick: markOut, 'aria-label': 'Set out point', title: 'Set out (O)' })}>O</button>
            <button {...btn({ className: `film-btn${looping ? ' is-on' : ''}`, onClick: () => setLooping((l) => !l), 'aria-pressed': looping, 'aria-label': 'Loop', title: 'Loop between in and out (⌥L)' })}>
              <Icon as={Repeat} size={14} />
            </button>
            <select className="film-rate" value={rate} aria-label="Playback speed"
                    onChange={(e) => { const r = Number(e.target.value); setRate(r); if (videoRef.current) videoRef.current.playbackRate = r; }}>
              {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
            <select className="film-guides" value={guide} aria-label="Framing guides" onChange={(e) => setGuide(e.target.value)}>
              {GUIDES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </>
        )}
        <button {...btn({ className: 'film-btn', onClick: () => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }, 'aria-label': muted ? 'Unmute' : 'Mute', title: full ? 'Mute (M)' : undefined })}>
          <Icon as={muted ? SpeakerSlash : SpeakerHigh} size={14} />
        </button>
        {full ? (
          <button {...btn({ className: 'film-btn', onClick: toggleFull, 'aria-label': isFull ? 'Exit full screen' : 'Full screen', title: 'Full screen (F)' })}>
            <Icon as={isFull ? CornersIn : CornersOut} size={14} />
          </button>
        ) : onExpand && (
          <button {...btn({ className: 'film-btn', onClick: () => { pause(); onExpand(frameRef.current); }, 'aria-label': 'Open in the review player', title: 'Open in the review player' })}>
            <Icon as={ArrowsOutSimple} size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

// Aspect masks (what a 2.39 extraction from this frame keeps) and safe areas.
function FramingGuide({ guide, picture }) {
  if (guide.id === 'safe') {
    const box = (pct, cls) => {
      const w = picture.w * pct, h = picture.h * pct;
      return <span className={`film-safe ${cls}`} style={{ left: picture.x + (picture.w - w) / 2, top: picture.y + (picture.h - h) / 2, width: w, height: h }} />;
    };
    return <div className="film-guide" aria-hidden="true">{box(0.93, 'is-action')}{box(0.9, 'is-title')}</div>;
  }
  const inner = containRect(picture.w, picture.h, guide.ar);
  const L = picture.x + inner.x, T = picture.y + inner.y;
  return (
    <div className="film-guide" aria-hidden="true">
      <span className="film-mask" style={{ left: picture.x, top: picture.y, width: picture.w, height: inner.y }} />
      <span className="film-mask" style={{ left: picture.x, top: T + inner.h, width: picture.w, height: picture.h - inner.y - inner.h }} />
      <span className="film-mask" style={{ left: picture.x, top: T, width: inner.x, height: inner.h }} />
      <span className="film-mask" style={{ left: L + inner.w, top: T, width: picture.w - inner.x - inner.w, height: inner.h }} />
      <span className="film-guide-line" style={{ left: L, top: T, width: inner.w, height: inner.h }} />
    </div>
  );
}
