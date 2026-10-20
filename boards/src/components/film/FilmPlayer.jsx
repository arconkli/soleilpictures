// The film player. One engine, three faces:
//   compact  on a video card on the board — play, a scrubber along the
//            bottom edge, timecode, mute, and ⤢ into the review player. It
//            takes no keys (the board owns those).
//   preview  in Quick look — the picture with an overlaid bar; only , . and
//            J/K/L and M (Space, ←/→ and Esc stay Quick look's).
//   full     the review player (FilmReview): a two-row dock under the
//            picture — the timeline, then the timecode, transport, loop,
//            speed, guides, A/B and volume — the HUD, and every key in
//            lib/playerKeys.js.
//
// Frames are exact: the clip's own rate (lib/mediaProbe.js), a provisional
// 24 until it's known (marked ≈ and dimmed); the frame on screen is read from
// the presented frame (useFilmClock); every seek aims at a frame's centre
// (lib/timecode.js). Transport arithmetic is lib/filmTransport.js.
//
// Compare (A/B): both versions are loaded, one is on show. The clock, the
// transport and the sound always belong to the one on show; the other is
// paused, muted, and brought to the same frame whenever the picture settles,
// so \ flips to the same frame of the other version.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { resolveSrc, cachedUrl } from '../../lib/r2.js';
import * as audioBus from '../../lib/audioBus.js';
import * as modalGuard from '../../lib/modalGuard.js';
import { filmLayerOpen } from '../../lib/filmLayers.js';
import { frameCentre, frameStart, frameCount, frameToTC, parseJump, rateValue, canDropFrame, timeToFrame } from '../../lib/timecode.js';
import {
  shuttle, clampFrame, normalizeRange, nextMarker, reverseAdvance, playStartFrame, shouldLoopNow, stepRate,
} from '../../lib/filmTransport.js';
import { playerAction, shouldHandleKey, actionName } from '../../lib/playerKeys.js';
import { hudText, shuttleText } from '../../lib/filmHud.js';
import { readPrefs, writePrefs } from '../../lib/playerSession.js';
import { containRect } from '../../lib/frameAnnotation.js';
import { codecName } from '../../lib/cardInfo.js';
import { logEvent, logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { createWatch, watchPlay, watchTick, watchPause, watchEnded, watchSummary } from '../../lib/filmWatch.js';
import { FilmTimeline } from './FilmTimeline.jsx';
import { FilmDock } from './FilmDock.jsx';
import { FilmHud } from './FilmHud.jsx';
import { FilmMenu } from './FilmMenu.jsx';
import { ShortcutSheet } from './ShortcutSheet.jsx';
import { PlayGlyph, PauseGlyph, FrameBack, FrameFwd, AspectThumb } from './glyphs.jsx';
import './film.css';
import { useFilmClock } from './useFilmClock.js';
import { Icon } from '../Icon.jsx';
import { Spinner } from '../Spinner.jsx';
import { SpeakerHigh, SpeakerSlash, ArrowsOutSimple } from '../../lib/icons.js';

// An r2: key → a signed URL, from the cache when it's there (no black flash on
// a card that's already been seen), with the failure kept so the player can
// say so instead of spinning.
export function useResolvedMedia(src, nonce = 0) {
  const now = () => {
    if (!src) return null;
    const s = String(src);
    return s.startsWith('r2:') ? (cachedUrl(s) || null) : s;
  };
  const [state, setState] = useState(() => ({ src, url: now(), error: false }));
  useEffect(() => {
    let off = false;
    if (!src) { setState({ src, url: null, error: false }); return undefined; }
    const s = String(src);
    const c = s.startsWith('r2:') ? cachedUrl(s) : s;
    if (c) { setState({ src, url: c, error: false }); return undefined; }
    setState({ src, url: null, error: false });
    resolveSrc(s)
      .then((u) => { if (!off) setState({ src, url: u || null, error: !u }); })
      .catch(() => { if (!off) setState({ src, url: null, error: true }); });
    return () => { off = true; };
  }, [src, nonce]);
  return state.src === src ? state : { src, url: now(), error: false };
}
export function useResolvedUrl(src) { return useResolvedMedia(src).url; }

export const GUIDES = [
  { id: 'off', label: 'Off' },
  { id: '2.39', label: '2.39:1', ar: 2.39 },
  { id: '2.00', label: '2.00:1', ar: 2 },
  { id: '1.90', label: '1.90:1', ar: 1.9 },
  { id: '1.85', label: '1.85:1', ar: 1.85 },
  { id: '16:9', label: '16:9', ar: 16 / 9 },
  { id: '4:3', label: '4:3', ar: 4 / 3 },
  { id: '1:1', label: '1:1', ar: 1 },
  { id: '9:16', label: '9:16', ar: 9 / 16 },
  { id: 'safe', label: 'Action & title safe' },
];
const TC_MODES = [
  { id: 'tc', label: 'Source timecode', chip: 'TC' },
  { id: 'clip', label: 'Clip timecode', chip: 'CLIP' },
  { id: 'frames', label: 'Frames', chip: 'FR' },
  { id: 'seconds', label: 'Seconds', chip: 'SEC' },
];

function formatSeconds(t) {
  if (!Number.isFinite(t)) return '0:00.000';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// Codecs browsers outside Safari can't decode, to say so plainly.
const APPLE_ONLY = new Set(['apch', 'apcn', 'apcs', 'apco', 'ap4h', 'ap4x', 'AVdn', 'AVdh']);

let hudSeq = 0;
// film_fail is logged once per clip and reason a page load: a board of clips
// this browser can't decode would otherwise say so on every open.
const filmFailsLogged = new Set();

export const FilmPlayer = forwardRef(function FilmPlayer({
  src, poster = null, media: mediaProp = null, mode = 'full', title = '', markers = [], ghostMarkers = [],
  compareSrc = null, compareMedia = null, compareLabel = '', label = '', autoPlay = false, keyboard = false,
  onAction, onFrameChange, onExpand, overlay = null, overlayLive = false, className = '',
  // () => Promise<facts|null>: reads the clip's frame rate when the card
  // doesn't know it yet (hooks/useMediaFacts.probeCardVideo). Asked on first
  // use — a board full of clips never probes just by rendering.
  probe = null,
  initialFrame = null, initialTime = null, initialRange = null, initialLooping = false,
  // FilmReview's modal-guard registration (a ref to it): keys are taken only
  // while that layer is on top — a menu or a dialog above it owns them.
  modalHandle = null,
  onDownload = null, onUploadVersion = null, onSessionChange = null,
  // compact: whether a click on the picture plays (VideoCard: the first click
  // on a card selects it; the next one plays).
  clickGate = null,
  // preview: "Open in player" in the bar (Quick look).
  onOpenPlayer = null,
  // review: offer "Copy link to this frame" (FilmReview builds the link).
  canCopyLink = false,
  // Where this player is, for film_play / film_watch / film_fail: 'file_share'
  // on the /f/ page, 'shared_file' when that file opens inside the app;
  // otherwise the face says it (card, quicklook, review).
  surface = null,
}, ref) {
  const full = mode === 'full';
  const compact = mode === 'compact';
  const preview = mode === 'preview';
  const prefs = useMemo(() => readPrefs(), []);
  const [retryNonce, setRetryNonce] = useState(0);
  const { url, error: signError } = useResolvedMedia(src, retryNonce);
  const posterUrl = useResolvedUrl(poster);
  const { url: compareUrl } = useResolvedMedia(compareSrc);
  // Compare turned off while B is on show: B stays loaded until A takes over.
  const lastCompareUrl = useRef(compareUrl);
  if (compareUrl) lastCompareUrl.current = compareUrl;

  const rootRef = useRef(null);
  const [stageEl, setStageEl] = useState(null);
  const [elA, setElA] = useState(null);
  const [elB, setElB] = useState(null);
  const [side, setSide] = useState('A');
  const shownCompareUrl = compareUrl || (side === 'B' ? lastCompareUrl.current : null);
  const activeEl = side === 'B' && elB ? elB : elA;
  const vRef = useRef(null);
  vRef.current = activeEl;
  const hiddenRef = useRef(null);
  hiddenRef.current = side === 'B' ? elA : elB;
  const timelineRef = useRef(null);
  const tcRef = useRef(null);

  // ── Facts about the clip ─────────────────────────────────────────────────
  const [probed, setProbed] = useState(null);
  const askedRef = useRef(false);
  const ensureFacts = () => {
    if (askedRef.current || mediaProp?.fps || !probe) return;
    askedRef.current = true;
    Promise.resolve(probe()).then((f) => { if (f) setProbed(f); }).catch(() => {});
  };
  const media = mediaProp?.fps ? mediaProp : (probed ? { ...(mediaProp || {}), ...probed } : mediaProp);
  const sideMedia = side === 'B' ? (compareMedia || media) : media;

  // ── State ────────────────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false);
  const [durA, setDurA] = useState(mediaProp?.dur || 0);
  const [durB, setDurB] = useState(compareMedia?.dur || 0);
  const [natural, setNatural] = useState(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const [muted, setMuted] = useState(compact ? true : prefs.muted);
  const [volume, setVolumeState] = useState(prefs.volume);
  const [userRate, setUserRate] = useState(full ? prefs.rate : 1);
  const [range, setRangeState] = useState(() => initialRange || { in: null, out: null });
  const [looping, setLooping] = useState(!!initialLooping);
  const [tcMode, setTcModeState] = useState(prefs.tcMode);
  const [tcEdit, setTcEdit] = useState(null);         // { seed } while typing a jump
  const [tcInvalid, setTcInvalid] = useState(0);
  const [showRemaining, setShowRemaining] = useState(false);
  const [guide, setGuide] = useState('off');
  const [guideOpts, setGuideOpts] = useState({ thirds: false, cross: false });
  // Picture zoom (Z): fit, then 1:1 pixels, then double that; drag to look around.
  const [pz, setPz] = useState({ scale: 1, x: 0, y: 0, mode: 'fit' });
  const [isFull, setIsFull] = useState(false);
  const [menu, setMenu] = useState(null);             // { id, anchor, items, align }
  const [help, setHelp] = useState(false);
  const [hudT, setHudT] = useState(null);             // transient { text, id }
  const [hudP, setHudP] = useState(null);             // persistent text (shuttle, buffering)
  const [flash, setFlash] = useState(null);
  const [buffering, setBuffering] = useState(false);
  const [failure, setFailure] = useState(null);
  const [idle, setIdle] = useState(false);
  const [frameState, setFrameState] = useState(0);
  const [shuttleView, setShuttleView] = useState({ dir: 0, rate: 1 });
  const [tip, setTip] = useState(null);
  const [touchedState, setTouchedState] = useState(false);

  const frameRef = useRef(0);
  const wantRef = useRef(null);         // { frame, settledAt } — the frame a paused seek is for
  const targetRef = useRef(null);       // a seek in flight
  const pendingRef = useRef(null);      // the next one, coalesced
  const touchedRef = useRef(false);     // someone has used the transport — no autoplay after that
  const shuttleRef = useRef({ dir: 0, rate: 1 });
  const reverseRef = useRef({ active: false, last: 0, owed: 0, rate: 1, timer: null });
  const loopJumpRef = useRef(false);
  const stopAtOutRef = useRef(null);
  const slowRef = useRef({ timer: null, active: false });
  const keysDown = useRef(new Set());
  const scrubWasPlaying = useRef(false);
  const scrubbingRef = useRef(false);
  const overDockRef = useRef(false);

  // ── The clock ────────────────────────────────────────────────────────────
  const fmtRef = useRef((f) => String(f));
  const onFrameChangeRef = useRef(onFrameChange);
  onFrameChangeRef.current = onFrameChange;

  const writeDisplay = useCallback((f, { pending = false } = {}) => {
    const t = tcRef.current;
    if (t) { t.textContent = fmtRef.current(f); t.dataset.pending = pending ? '1' : ''; }
    timelineRef.current?.setFrame(f, { pending, playing: !vRef.current?.paused });
  }, []);

  // Every frame the video presents (or a paused seek lands on).
  const tick = useCallback((f, mt) => {
    if (f == null) {
      if (tcRef.current) tcRef.current.textContent = formatSeconds(mt);
      return;
    }
    const el = vRef.current;
    if (pendingRef.current != null) return;
    // While a seek is landing, a presented frame is from before it.
    if (el?.seeking) return;
    // Paused on a frame we asked for: a presented-frame callback from the
    // previous seek can land after the next one starts. Taking it would count
    // the next step from a frame we've already left — a lost keypress.
    const want = wantRef.current;
    if (want && el?.paused) {
      if (f !== want.frame && !(want.settledAt && performance.now() - want.settledAt > 150)) return;
      wantRef.current = null;
    }
    frameRef.current = f;
    writeDisplay(f);
    onFrameChangeRef.current?.(f);
    if (el && !el.paused && !loopJumpRef.current) {
      const st = S.current;
      const r = normalizeRange(st.range.in, st.range.out, st.frames);
      if (st.looping && r.out != null && shouldLoopNow({ frame: f, rate: el.playbackRate, outFrame: r.out })) loopJump(r.in ?? 0);
      else if (stopAtOutRef.current != null && f >= stopAtOutRef.current) {
        const o = stopAtOutRef.current;
        stopAtOutRef.current = null;
        stopTransport();
        seekFrame(o);
      }
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const { fps, t0 } = useFilmClock(activeEl, { fps: sideMedia?.fps || null, url: side === 'B' ? shownCompareUrl : url, onTick: tick });
  const provisional = !fps;
  const fpsEff = fps || [24, 1];
  const fpsV = rateValue(fpsEff);
  const activeDur = side === 'B' ? durB : durA;
  const frames = side === 'A' && media?.frames && fps && media?.fps ? media.frames : frameCount(activeDur, fpsEff);
  const startFrames = media?.tc?.frame || 0;
  const df = !!media?.tc?.df && canDropFrame(fpsEff);
  const effMode = tcMode === 'tc' && !media?.tc ? 'clip' : (tcMode || (media?.tc ? 'tc' : 'clip'));

  const format = useCallback((f) => {
    if (effMode === 'frames') return String(f);
    if (effMode === 'seconds') return formatSeconds(frameStart(f, fpsEff, 0));
    return frameToTC(f, fpsEff, { df, start: effMode === 'tc' ? startFrames : 0 });
  }, [effMode, fpsEff[0], fpsEff[1], df, startFrames]);   // eslint-disable-line react-hooks/exhaustive-deps
  fmtRef.current = format;
  // A length, not a clock: no start offset.
  const lengthText = frames ? (effMode === 'frames' ? `${frames}` : effMode === 'seconds' ? formatSeconds(activeDur) : frameToTC(frames, fpsEff, { df })) : '';

  // The latest of everything the stable handlers read.
  const S = useRef({});
  S.current = {
    frames, fpsEff, fpsV, t0, range, looping, userRate, side, muted, volume, guide, playing, menu, help, tcEdit,
    provisional, effMode, markers, keyboard, preview, full, compact, startFrames, df, isFull,
  };

  // Rewrite the readout when the format changes (mode, rate learnt).
  useEffect(() => { writeDisplay(frameRef.current); }, [format, writeDisplay, tcEdit]);
  // The real rate arrived while paused: the frame number was counted at the
  // provisional 24 — count it again from where the picture actually is.
  const fpsKey = fps ? `${fps[0]}/${fps[1]}` : '';
  useEffect(() => {
    const el = vRef.current;
    if (!fpsKey || !el || !el.paused || pendingRef.current != null || el.seeking || el.readyState < 1) return;
    const f = timeToFrame(el.currentTime, fps, t0);
    if (f === frameRef.current) return;
    frameRef.current = f;
    wantRef.current = null;
    writeDisplay(f);
    setFrameState(f);
  }, [fpsKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── HUD and flash ────────────────────────────────────────────────────────
  const hudTimer = useRef(null);
  const hud = useCallback((text) => {
    if (!text || S.current.compact) return;
    clearTimeout(hudTimer.current);
    setHudT({ text, id: ++hudSeq });
    hudTimer.current = setTimeout(() => setHudT(null), 1150);
  }, []);
  const hudPersist = useCallback((text) => setHudP(text || null), []);
  useEffect(() => () => clearTimeout(hudTimer.current), []);
  const flashTimer = useRef(null);
  const doFlash = (kind) => {
    clearTimeout(flashTimer.current);
    setFlash({ kind, id: ++hudSeq });
    flashTimer.current = setTimeout(() => setFlash(null), 500);
  };

  // ── Seeking ──────────────────────────────────────────────────────────────
  const here = () => (pendingRef.current ?? targetRef.current ?? frameRef.current);
  const seekFrame = useCallback((n) => {
    const el = vRef.current;
    if (!el) return;
    const st = S.current;
    const f = clampFrame(n, st.frames || Infinity);
    frameRef.current = f;
    // The readout and the playhead go there at once; the digits stay dim
    // until the picture catches up.
    writeDisplay(f, { pending: true });
    // Before the clip has loaded there's nothing to seek: hold the frame until
    // it has (onMeta), so keys pressed early aren't lost.
    if (el.readyState < 1) { pendingRef.current = f; targetRef.current = null; return; }
    if (el.seeking && targetRef.current != null) { pendingRef.current = f; return; }
    // A seek can finish a moment before its `seeked` arrives; this one
    // supersedes anything still queued, or the queued frame would shadow it.
    pendingRef.current = null;
    targetRef.current = f;
    wantRef.current = { frame: f, settledAt: 0 };
    el.currentTime = frameCentre(f, st.fpsEff, st.t0, el.duration || Infinity);
  }, [writeDisplay]);
  // { touch: true }: the frame was chosen (a card following the review's
  // close), so it counts as use — no autoplay, and the card keeps it.
  const seekTime = useCallback((t, opts) => {
    const el = vRef.current;
    if (!el || !Number.isFinite(t)) return;
    if (opts?.touch) touch();
    const st = S.current;
    seekFrame(timeToFrame(t, st.fpsEff, st.t0));
  }, [seekFrame]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The other version follows once the picture settles — never per scrub step.
  const syncHidden = () => {
    const el = vRef.current, h = hiddenRef.current;
    if (!el || !h || !el.paused || pendingRef.current != null) return;
    if (!Number.isFinite(h.duration) || h.readyState < 1) return;
    const t = Math.min(el.currentTime, h.duration - 0.001);
    if (Math.abs(h.currentTime - t) > 1e-4) h.currentTime = t;
  };

  // ── Transport ────────────────────────────────────────────────────────────
  const touch = () => { if (!touchedRef.current) { touchedRef.current = true; setTouchedState(true); } };
  const stopReverse = () => {
    const r = reverseRef.current;
    clearTimeout(r.timer);
    const was = r.active;
    r.active = false;
    return was;
  };
  // Everything that stops: pause, a step, a scrub, a flip, the end of a range.
  const stopTransport = useCallback(() => {
    const wasReverse = stopReverse();
    clearTimeout(slowRef.current.timer);
    slowRef.current.active = false;
    stopAtOutRef.current = null;
    // A stop during a loop's jump back stays stopped.
    loopJumpRef.current = false;
    shuttleRef.current = { dir: 0, rate: 1 };
    setShuttleView({ dir: 0, rate: 1 });
    setHudP(null);
    const el = vRef.current;
    if (el && !el.paused) el.pause();
    if (wasReverse) { setPlaying(false); setFrameState(frameRef.current); }
  }, []);
  const startPlayback = useCallback((rate) => {
    const el = vRef.current;
    if (!el) return;
    stopReverse();
    el.playbackRate = rate;
    const st = S.current;
    const start = playStartFrame({ here: here(), range: normalizeRange(st.range.in, st.range.out, st.frames), looping: st.looping, frames: st.frames });
    if (start != null) seekFrame(start);
    wantRef.current = null;
    const p = el.play();
    if (p && p.catch) {
      p.catch((err) => {
        // A browser that won't start sound without a gesture: play muted, say so.
        if (err?.name === 'NotAllowedError' && !el.muted) {
          setMuted(true);
          el.muted = true;
          el.play().then(() => hud(hudText('mutedAutoplay'))).catch(() => {});
        }
      });
    }
  }, [seekFrame, hud]);
  const play = useCallback((rate) => {
    touch();
    // A jump being typed is abandoned, or the readout would stay a text field.
    if (S.current.tcEdit) editTc(null);
    startPlayback(rate ?? S.current.userRate);
  }, [startPlayback]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pause = useCallback(() => {
    touch();
    const el = vRef.current;
    const wasPlaying = el && !el.paused;
    stopTransport();
    // Land on the frame that was on screen, at its centre, so the next step
    // counts from exactly there.
    if (wasPlaying) seekFrame(frameRef.current);
  }, [stopTransport, seekFrame]);
  const isRunning = () => !!(reverseRef.current.active || (vRef.current && !vRef.current.paused));
  const toggle = useCallback(() => { ensureFacts(); if (isRunning()) pause(); else play(); }, [pause, play]);   // eslint-disable-line react-hooks/exhaustive-deps
  const step = useCallback((delta) => {
    touch();
    ensureFacts();
    stopTransport();
    const st = S.current;
    const from = here();
    const to = from + delta;
    if (to < 0 && from === 0) { hud(hudText('firstFrame')); return; }
    if (st.frames && to > st.frames - 1 && from === st.frames - 1) { hud(hudText('lastFrame')); return; }
    seekFrame(to);
  }, [stopTransport, seekFrame, hud]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Reverse: browsers can't play backwards, so it's seeks paced by the clock.
  function reverseTick() {
    const r = reverseRef.current;
    const el = vRef.current;
    if (!r.active || !el) return;
    const st = S.current;
    const now = performance.now();
    const adv = reverseAdvance(r.owed, now - r.last, st.fpsV, r.rate);
    r.last = now;
    r.owed = adv.owed;
    if (adv.n < 1) {
      const wait = Math.max(4, ((1 - r.owed) / (st.fpsV * r.rate)) * 1000);
      r.timer = setTimeout(reverseTick, wait);
      return;
    }
    const rr = normalizeRange(st.range.in, st.range.out, st.frames);
    let target = here() - adv.n;
    // Looping backwards wraps at the in point; otherwise it runs to the start.
    const floor = st.looping ? (rr.in ?? 0) : 0;
    if (target < floor) {
      if (st.looping) target = rr.out ?? st.frames - 1;
      else { stopTransport(); seekFrame(0); hud(hudText('firstFrame')); return; }
    }
    seekFrame(target);
  }
  const startReverse = (rate) => {
    const el = vRef.current;
    if (!el) return;
    if (!el.paused) el.pause();
    stopReverse();
    setPlaying(true);
    reverseRef.current = { active: true, last: performance.now(), owed: 1, rate, timer: null };
    reverseTick();
  };
  const doShuttle = (key) => {
    touch();
    ensureFacts();
    clearTimeout(slowRef.current.timer);
    slowRef.current.active = false;
    const next = shuttle(shuttleRef.current, key);
    shuttleRef.current = next;
    setShuttleView(next);
    if (next.dir === 0) { pause(); return; }
    hudPersist(shuttleText(next));
    if (next.dir > 0) startPlayback(next.rate);
    else startReverse(next.rate);
  };
  // K held with J or L: a tap inches a frame; held past 250ms, plays slowly.
  const inch = (dir, keyName) => {
    step(dir);
    clearTimeout(slowRef.current.timer);
    slowRef.current.timer = setTimeout(() => {
      if (!keysDown.current.has('k') || !keysDown.current.has(keyName)) return;
      slowRef.current.active = true;
      hudPersist(hudText('slow', { dir }));
      if (dir > 0) startPlayback(0.25); else startReverse(0.25);
    }, 250);
  };

  // A loop's jump back: pause, seek, carry on once the in frame is there.
  function loopJump(to) {
    const el = vRef.current;
    if (!el) return;
    loopJumpRef.current = true;
    el.pause();
    seekFrame(to);
  }

  const setRate = (r) => {
    setUserRate(r);
    writePrefs({ rate: r });
    shuttleRef.current = { dir: 0, rate: 1 };
    setShuttleView({ dir: 0, rate: 1 });
    setHudP(null);
    const el = vRef.current;
    if (el && !el.paused && !reverseRef.current.active) el.playbackRate = r;
  };
  const setVolume = (v) => {
    const n = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
    setVolumeState(n);
    writePrefs({ volume: n });
    if (n > 0 && S.current.muted) { setMuted(false); writePrefs({ muted: false }); }
  };
  const toggleMute = () => {
    const m = !S.current.muted;
    setMuted(m);
    if (!compact) writePrefs({ muted: m });
    hud(m ? hudText('muted') : hudText('volume', { volume: S.current.volume }));
  };
  const setRange = (next) => {
    const r = normalizeRange(next.in, next.out, S.current.frames);
    setRangeState(r);
  };
  const markIn = () => {
    const f = here();
    setRange({ ...S.current.range, in: f });
    hud(hudText('in', { tc: fmtRef.current(f) }));
  };
  const markOut = () => {
    const f = here();
    const a = S.current.range.in;
    setRange({ ...S.current.range, out: f });
    hud(hudText('out', { tc: fmtRef.current(f), frames: a != null && f >= a ? f - a + 1 : null }));
  };
  const clearRange = () => { setRangeState({ in: null, out: null }); hud(hudText('cleared')); };
  const toggleLoop = () => {
    const on = !S.current.looping;
    setLooping(on);
    const r = S.current.range;
    hud(on ? hudText('loopOn', { whole: r.in == null && r.out == null }) : hudText('loopOff'));
  };
  const playInOut = () => {
    const st = S.current;
    const r = normalizeRange(st.range.in, st.range.out, st.frames);
    stopTransport();
    seekFrame(r.in ?? 0);
    stopAtOutRef.current = r.out ?? null;
    touch();
    startPlayback(st.userRate);
  };
  const cycleGuide = () => {
    const i = GUIDES.findIndex((g) => g.id === S.current.guide);
    const next = GUIDES[(i + 1) % GUIDES.length];
    setGuide(next.id);
    if (next.id !== 'off') writePrefs({ guide: next.id });
    hud(hudText('guide', { label: next.id === 'off' ? null : next.label }));
  };
  const setTcMode = (m) => { setTcModeState(m); writePrefs({ tcMode: m }); };
  const copyTc = () => {
    const tc = fmtRef.current(here());
    try { navigator.clipboard?.writeText(tc).then(() => hud(hudText('copied', { tc })), () => {}); } catch (_) {}
  };
  const jumpMarker = (dir) => {
    const t = nextMarker((S.current.markers || []).map((m) => m.frame), here(), dir);
    if (t == null) { hud(hudText(dir > 0 ? 'noNextComment' : 'noPrevComment')); return; }
    stopTransport();
    seekFrame(t);
    onAction?.('marker', (S.current.markers || []).find((m) => m.frame === t));
  };

  // ── Compare: flip to the other version on the same frame ─────────────────
  const flip = () => {
    const incoming = side === 'A' ? elB : elA;
    if (!incoming || (!compareUrl && side === 'A')) return;
    stopTransport();
    const st = S.current;
    const f = here();
    const t = frameCentre(f, st.fpsEff, st.t0, incoming.duration || Infinity);
    const next = side === 'A' ? 'B' : 'A';
    const swap = () => {
      pendingRef.current = null;
      targetRef.current = null;
      wantRef.current = null;
      setSide(next);
      hud(hudText('side', { side: next, label: next === 'B' ? (compareLabel || 'B') : (label || 'A') }));
    };
    if (Number.isFinite(incoming.duration) && frameCentre(f, st.fpsEff, st.t0) > incoming.duration) {
      hud(`${next} ends at ${fmtRef.current(Math.max(0, Math.floor(incoming.duration * st.fpsV) - 1))}`);
    }
    if (incoming.readyState >= 1 && Math.abs(incoming.currentTime - t) < 1e-3) { swap(); return; }
    const done = () => { incoming.removeEventListener('seeked', done); swap(); };
    incoming.addEventListener('seeked', done);
    try { incoming.currentTime = Number.isFinite(incoming.duration) ? Math.min(t, incoming.duration - 0.001) : t; } catch (_) { swap(); }
  };
  // Compare turned off while showing B: B stays loaded until A is on B's
  // frame, then A takes over (flip()), so the picture doesn't jump.
  const flipRef = useRef(null);
  flipRef.current = flip;
  useEffect(() => {
    if (!compareUrl && side === 'B') flipRef.current?.();
  }, [compareUrl, side]);

  // ── One viewing of this clip (lib/filmWatch.js) ──────────────────────────
  // film_play at its first play, film_watch when the player lets go of the
  // clip or the page goes away; film_fail once for whatever it couldn't do.
  const where = surface || (compact ? 'card' : preview ? 'quicklook' : 'review');
  const watchRef = useRef(null);
  const watchCtx = useRef(null);
  watchCtx.current = { where, autoPlay, compare: !!compareSrc };
  useEffect(() => {
    const w = createWatch();
    watchRef.current = w;
    const end = (send) => {
      const out = watchSummary(w, performance.now());
      if (out) { try { send(EV.FILM_WATCH, { surface: watchCtx.current.where, ...out }); } catch (_) {} }
    };
    const onHide = () => end(logEventNow);
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); end(logEvent); };
  }, [src]);
  const failReason = failure?.reason || (signError ? 'sign' : null);
  useEffect(() => {
    if (!failReason) return;
    const key = `${src}|${failReason}`;
    if (filmFailsLogged.has(key)) return;
    filmFailsLogged.add(key);
    const c = mediaProp?.codec;
    try {
      logEvent(EV.FILM_FAIL, { surface: where, reason: failReason, codec: typeof c === 'string' && /^[A-Za-z0-9.]{1,16}$/.test(c) ? c : null });
    } catch (_) {}
  }, [failReason, src]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Video element state → React (the one on show) ────────────────────────
  useEffect(() => {
    const v = activeEl;
    if (!v) return undefined;
    let bufTimer = null;
    const bufOn = () => { clearTimeout(bufTimer); bufTimer = setTimeout(() => { setBuffering(true); }, 250); };
    const bufOff = () => { clearTimeout(bufTimer); setBuffering(false); };
    const onPlay = () => {
      setPlaying(true);
      if (watchPlay(watchRef.current, performance.now())) {
        const c = watchCtx.current;
        try { logEvent(EV.FILM_PLAY, { surface: c.where, auto: !!c.autoPlay && !touchedRef.current, compare: c.compare, muted: !!v.muted }); } catch (_) {}
      }
    };
    const onTime = () => watchTick(watchRef.current, v.currentTime, v.duration);
    const onPause = () => {
      if (loopJumpRef.current) return;
      watchPause(watchRef.current, performance.now(), v.currentTime);
      if (!reverseRef.current.active) setPlaying(false);
      setFrameState(frameRef.current);
      bufOff();
    };
    const onEnded = () => {
      const st = S.current;
      if (st.looping) {
        const r = normalizeRange(st.range.in, st.range.out, st.frames);
        loopJumpRef.current = true;
        seekFrame(r.in ?? 0);
        return;
      }
      watchEnded(watchRef.current, v.duration);
      setPlaying(false);
      setFrameState(frameRef.current);
    };
    const onSeeked = () => {
      targetRef.current = null;
      if (wantRef.current) wantRef.current.settledAt = performance.now();
      if (pendingRef.current != null) { const p = pendingRef.current; pendingRef.current = null; seekFrame(p); return; }
      if (tcRef.current) tcRef.current.dataset.pending = '';
      timelineRef.current?.setFrame(frameRef.current, { playing: !v.paused });
      if (loopJumpRef.current) { loopJumpRef.current = false; v.play().catch(() => {}); return; }
      if (reverseRef.current.active) { reverseTick(); return; }
      if (v.paused) setFrameState(frameRef.current);
      syncHidden();
    };
    const onMeta = () => {
      if (Number.isFinite(v.duration)) (v === elB ? setDurB : setDurA)(v.duration);
      if (pendingRef.current != null && v.readyState >= 1 && !v.seeking) {
        const p = pendingRef.current;
        pendingRef.current = null;
        seekFrame(p);
      }
      if (v.videoWidth) setNatural({ w: v.videoWidth, h: v.videoHeight });
      else if (S.current && mediaProp?.w > 0) {
        setFailure({ reason: 'no_picture', title: `This browser can’t show this video`, body: 'Its sound may play, but there is no picture — download it, or upload a version in a common format.' });
      }
    };
    const onResize = () => { if (v.videoWidth) setNatural({ w: v.videoWidth, h: v.videoHeight }); };
    const onError = () => {
      const code = mediaProp?.codec;
      const name = codecName(code);
      setFailure(APPLE_ONLY.has(code)
        ? { reason: 'decode', title: `This browser can’t play ${name}`, body: 'Safari on a Mac plays it. Or upload an H.264 version — notes stay on this file.' }
        : { reason: 'decode', title: 'This video can’t be played here', body: name ? `It’s ${name}, which this browser doesn’t decode. Download it, or upload a version in a common format.` : 'Download it, or upload a version in a common format.' });
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('resize', onResize);
    v.addEventListener('error', onError);
    v.addEventListener('waiting', bufOn);
    v.addEventListener('playing', bufOff);
    v.addEventListener('canplay', bufOff);
    if (v.readyState >= 1) onMeta();
    return () => {
      clearTimeout(bufTimer);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('resize', onResize);
      v.removeEventListener('error', onError);
      v.removeEventListener('waiting', bufOn);
      v.removeEventListener('playing', bufOff);
      v.removeEventListener('canplay', bufOff);
    };
  }, [activeEl]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The other version's length, for the frame count when it's on show.
  useEffect(() => {
    const v = elB;
    if (!v) return undefined;
    const on = () => { if (Number.isFinite(v.duration)) setDurB(v.duration); };
    v.addEventListener('loadedmetadata', on);
    v.addEventListener('durationchange', on);
    on();
    return () => { v.removeEventListener('loadedmetadata', on); v.removeEventListener('durationchange', on); };
  }, [elB]);

  // A clip that never shows a frame is broken, not slow.
  useEffect(() => {
    const v = elA;
    if (!v || !url) return undefined;
    if (v.readyState >= 2) return undefined;
    const t = setTimeout(() => {
      if (v.readyState < 2 && !v.error) setFailure((f) => f || { reason: 'stalled', title: 'This video isn’t loading', body: 'The file may be very large or in a format this browser can’t read. Try again, or download it.' });
    }, compact ? 15000 : 8000);
    const ok = () => clearTimeout(t);
    v.addEventListener('loadeddata', ok);
    return () => { clearTimeout(t); v.removeEventListener('loadeddata', ok); };
  }, [elA, url, compact]);

  // Sound: one thing plays at a time across the app (lib/audioBus.js), and
  // only an audible player takes its turn.
  useEffect(() => {
    const a = elA, b = elB;
    for (const [el, isActive] of [[a, side === 'A'], [b, side === 'B']]) {
      if (!el) continue;
      el.muted = muted || !isActive;
      el.volume = volume;
    }
  }, [elA, elB, side, muted, volume]);
  const stopFnRef = useRef(null);
  if (!stopFnRef.current) stopFnRef.current = () => { try { stopTransport(); } catch (_) {} };
  useEffect(() => {
    const stop = stopFnRef.current;
    if (playing && !muted) audioBus.claim(stop, { source: 'film' });
    else audioBus.release(stop);
    return undefined;
  }, [playing, muted]);
  useEffect(() => () => { audioBus.release(stopFnRef.current); stopReverse(); clearTimeout(slowRef.current.timer); }, []);

  // Whole-clip loop is the element's own; a range loops in tick().
  useEffect(() => {
    const v = activeEl;
    if (v) v.loop = looping && range.in == null && range.out == null;
  }, [activeEl, looping, range.in, range.out]);

  // Autoplay — not the attribute: a clip that finishes loading after you
  // pressed K or stepped a frame must not start under you.
  useEffect(() => {
    const v = elA;
    if (!autoPlay || !v || !url) return undefined;
    const go = () => { if (!touchedRef.current) startPlayback(S.current.userRate); };
    if (v.readyState >= 3) { go(); return undefined; }
    v.addEventListener('canplay', go, { once: true });
    return () => v.removeEventListener('canplay', go);
  }, [autoPlay, elA, url]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Open on a given frame (⤢ from a card, a version switch, a frame link):
  // the poster stays up until the frame is there.
  const landedRef = useRef(false);
  useEffect(() => {
    const v = elA;
    if (!v || !url || landedRef.current || (initialFrame == null && initialTime == null)) return undefined;
    const land = () => {
      if (landedRef.current) return;
      landedRef.current = true;
      // Already stepping or scrubbing before the clip loaded: that wins.
      if (touchedRef.current || pendingRef.current != null) return;
      touchedRef.current = touchedRef.current || !autoPlay;
      if (initialFrame != null && (!provisional || initialTime == null)) seekFrame(initialFrame);
      else seekTime(initialTime);
    };
    if (v.readyState >= 1) { land(); return undefined; }
    v.addEventListener('loadedmetadata', land, { once: true });
    return () => v.removeEventListener('loadedmetadata', land);
  }, [elA, url]);   // eslint-disable-line react-hooks/exhaustive-deps

  // FilmReview keeps the frame and range across a version switch.
  const onSessionRef = useRef(onSessionChange);
  onSessionRef.current = onSessionChange;
  useEffect(() => { onSessionRef.current?.({ frame: frameState, time: vRef.current?.currentTime ?? null, range, looping }); }, [frameState, range, looping]);

  // ── The picture's box inside the stage ───────────────────────────────────
  useEffect(() => {
    const el = stageEl;
    if (!el || compact) return undefined;
    const ro = new ResizeObserver(() => setStageBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStageBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [stageEl, compact]);
  const rot = media?.rot === 90 || media?.rot === 270;
  const pictureAr = natural?.w ? natural.w / natural.h
    : media?.w && media?.h ? (rot ? media.h / media.w : media.w / media.h) : 16 / 9;
  const picture = containRect(stageBox.w, stageBox.h, pictureAr);

  // ── Full screen ──────────────────────────────────────────────────────────
  const canFull = typeof document !== 'undefined' && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  useEffect(() => {
    if (compact) return undefined;
    const on = () => setIsFull((document.fullscreenElement || document.webkitFullscreenElement) === rootRef.current);
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => { document.removeEventListener('fullscreenchange', on); document.removeEventListener('webkitfullscreenchange', on); };
  }, [compact]);
  const toggleFull = useCallback(() => {
    const el = rootRef.current;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    } else if (el) {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
    }
  }, []);

  // Full screen while playing: the chrome and the cursor go after 2.5s still.
  const idleTimer = useRef(null);
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      const st = S.current;
      if (st.isFull && st.playing && !st.menu && !st.help && !st.tcEdit && !scrubbingRef.current && !overDockRef.current) setIdle(true);
    }, 2500);
  }, []);
  useEffect(() => { if (isFull && playing) wake(); else { clearTimeout(idleTimer.current); setIdle(false); } }, [isFull, playing, wake]);
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  // A finger moves nothing between taps: in full screen, a tap while the
  // controls are away brings them back and doesn't pause, as a phone's own
  // player does. (The tap's click reads this; see onStageClick.)
  const tapWoke = useRef(false);
  const onRootPointerDown = (e) => {
    hideTip(e);
    tapWoke.current = isFull && idle && e.pointerType !== 'mouse';
    if (isFull && e.pointerType !== 'mouse') wake();
  };

  // ── Compact: sized to the card as it appears on screen ────────────────────
  // The canvas scales cards with its zoom; the controls shouldn't shrink to
  // nothing (or balloon) with it. --uis undoes the zoom for the bar, and the
  // tier picks what fits the card's on-screen width.
  const measureUi = useCallback(() => {
    const el = rootRef.current;
    if (!el || !el.offsetWidth) return;
    const r = el.getBoundingClientRect();
    const z = r.width / el.offsetWidth;
    el.style.setProperty('--uis', String(1 / Math.max(0.5, Math.min(1.5, z))));
    el.dataset.tier = r.width < 160 ? 'mini' : r.width < 250 ? 'mid' : 'full';
  }, []);
  useEffect(() => {
    if (!compact) return undefined;
    measureUi();
    const el = rootRef.current;
    if (!el) return undefined;
    let raf = 0;
    const onWheel = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measureUi); };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => { el.removeEventListener('wheel', onWheel); cancelAnimationFrame(raf); };
  }, [compact, measureUi]);
  const activeTimer = useRef(null);
  const onCompactMove = () => {
    const el = rootRef.current;
    if (!el) return;
    el.dataset.active = '1';
    clearTimeout(activeTimer.current);
    activeTimer.current = setTimeout(() => { if (rootRef.current) delete rootRef.current.dataset.active; }, 1500);
  };
  useEffect(() => () => clearTimeout(activeTimer.current), []);

  // ── Picture zoom ─────────────────────────────────────────────────────────
  const cyclePictureZoom = () => {
    const st = S.current;
    const nat = natural?.w || media?.w || 0;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const one = nat && picture.w ? nat / (picture.w * dpr) : 1;
    const steps = [{ mode: 'fit', scale: 1 }, { mode: '100%', scale: one }, { mode: '200%', scale: one * 2 }]
      .filter((x, i) => i === 0 || Math.abs(x.scale - 1) > 0.02);
    const i = steps.findIndex((x) => x.mode === pz.mode);
    const next = steps[(i + 1) % steps.length];
    setPz({ scale: next.scale, x: 0, y: 0, mode: next.mode });
    hud(next.mode === 'fit' ? 'Fit' : next.mode);
    void st;
  };
  const clampPan = (x, y, scale) => {
    const mx = Math.max(0, (picture.w * scale - stageBox.w) / 2);
    const my = Math.max(0, (picture.h * scale - stageBox.h) / 2);
    return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  const panRef = useRef(null);
  const onZoomPanDown = (e) => {
    if (pz.mode === 'fit' || e.button !== 0) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, x: pz.x, y: pz.y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const onZoomPanMove = (e) => {
    const p = panRef.current;
    if (!p) return;
    const c = clampPan(p.x + e.clientX - p.sx, p.y + e.clientY - p.sy, pz.scale);
    setPz((z) => ({ ...z, ...c }));
  };
  const onZoomPanUp = () => { panRef.current = null; };

  // ── Keys ─────────────────────────────────────────────────────────────────
  // Hints name a key only where it works: the review takes them all; Quick
  // look only , . J K L and M.
  const fullKeys = keyboard === true;
  const runRef = useRef(null);
  runRef.current = (a, e) => {
    const name = actionName(a);
    const st = S.current;
    if (st.isFull) wake();
    switch (name) {
      case 'toggle': toggle(); break;
      case 'stop': pause(); break;
      case 'shuttleFwd': doShuttle('l'); break;
      case 'shuttleBack': doShuttle('j'); break;
      case 'fwd1f': if (keysDown.current.has('k') && e?.key?.toLowerCase() === 'l') inch(1, 'l'); else step(1); break;
      case 'back1f': if (keysDown.current.has('k') && e?.key?.toLowerCase() === 'j') inch(-1, 'j'); else step(-1); break;
      case 'fwd1s': step(Math.max(1, Math.round(st.fpsV))); break;
      case 'back1s': step(-Math.max(1, Math.round(st.fpsV))); break;
      case 'start': touch(); stopTransport(); seekFrame(0); break;
      case 'end': touch(); stopTransport(); seekFrame(st.frames - 1); break;
      case 'markIn': markIn(); break;
      case 'markOut': markOut(); break;
      case 'goIn': if (st.range.in != null) { stopTransport(); seekFrame(st.range.in); } break;
      case 'goOut': if (st.range.out != null) { stopTransport(); seekFrame(st.range.out); } break;
      case 'playInOut': playInOut(); break;
      case 'clearInOut': clearRange(); break;
      case 'loop': toggleLoop(); break;
      case 'slower': case 'faster': {
        const r = stepRate(st.userRate, name === 'faster' ? 1 : -1);
        setRate(r);
        hud(hudText('speed', { rate: r }));
        break;
      }
      case 'mute': toggleMute(); break;
      case 'volUp': case 'volDown': {
        const v = Math.max(0, Math.min(1, st.volume + (name === 'volUp' ? 0.1 : -0.1)));
        setVolume(v);
        hud(hudText('volume', { volume: v }));
        break;
      }
      case 'fullscreen': if (canFull) toggleFull(); break;
      case 'guides': cycleGuide(); break;
      case 'compare': flip(); break;
      case 'zoomIn': timelineRef.current?.zoomIn(); break;
      case 'zoomOut': timelineRef.current?.zoomOut(); break;
      case 'zoomFit': timelineRef.current?.fit(); break;
      case 'zoomRange': timelineRef.current?.zoomToRange(); break;
      case 'pictureZoom': if (st.full) cyclePictureZoom(); break;
      case 'help': setHelp((h) => !h); break;
      case 'tcEntry': if (st.full) { stopTransport(); editTc({ seed: a.seed }); } break;
      case 'copyTc': copyTc(); break;
      case 'copyLink': { const n = stateNow(); onAction?.('copyLink', { frame: n.frame, time: n.time }); break; }
      case 'nextComment': jumpMarker(1); break;
      case 'prevComment': jumpMarker(-1); break;
      case 'escape': onAction?.('escape'); break;
      default: onAction?.(name); break;      // comment, draw — frame comments
    }
  };
  const modalHandleRef = useRef(modalHandle);
  modalHandleRef.current = modalHandle;
  useEffect(() => {
    if (!keyboard) return undefined;
    // Quick look keeps Space (it closes Quick look, as for any file), ←/→ and Esc.
    const PREVIEW = new Set(['shuttleFwd', 'shuttleBack', 'stop', 'mute']);
    const onDown = (e) => {
      const handle = modalHandleRef.current?.current ?? null;
      if (modalHandleRef.current && (!handle || (modalGuard.isTopModal && !modalGuard.isTopModal(handle)))) return;
      // One of the player's menus or its shortcut sheet is open: its keys.
      if (filmLayerOpen()) return;
      const k = String(e.key || '').toLowerCase();
      const jkl = k === 'k' || k === 'j' || k === 'l';
      // macOS drops the keyup of a key released while ⌘ is down: never track
      // a chord, or a stuck K turns every L into an inch.
      if (jkl && !e.metaKey && !e.ctrlKey && !e.altKey) keysDown.current.add(k);
      // K held: J/L's own key-repeat must not keep re-inching — that would
      // cancel the slow play the hold is asking for.
      if (e.repeat && (k === 'j' || k === 'l') && keysDown.current.has('k')) { e.preventDefault(); e.stopPropagation(); return; }
      const a = playerAction(e, { kHeld: keysDown.current.has('k') });
      if (!shouldHandleKey(e, a)) return;
      const name = actionName(a);
      if (keyboard === 'preview') {
        const ok = PREVIEW.has(name) || ((name === 'back1f' || name === 'fwd1f') && (e.key === ',' || e.key === '.'));
        if (!ok) return;
      }
      if ((name === 'copyTc' || name === 'copyLink') && String(window.getSelection?.() || '')) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      runRef.current(a, e);
    };
    const onUp = (e) => {
      const k = String(e.key || '').toLowerCase();
      if (!keysDown.current.has(k)) return;
      keysDown.current.delete(k);
      if (slowRef.current.active && (k === 'k' || k === 'j' || k === 'l')) { slowRef.current.active = false; pause(); }
      else clearTimeout(slowRef.current.timer);
    };
    const reset = () => {
      keysDown.current.clear();
      clearTimeout(slowRef.current.timer);
      // The keyup that would stop slow play is lost with the focus: stop it now.
      if (slowRef.current.active) { slowRef.current.active = false; runRef.current('stop'); }
    };
    const onVis = () => { if (document.hidden) reset(); };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [keyboard]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Typing a jump ────────────────────────────────────────────────────────
  // Opening or closing the field starts it clean: no error left over from
  // the last attempt.
  function editTc(next) {
    setTcInvalid(0);
    setTcEdit(next);
  }
  // Closed from the field itself (Enter, Esc): the field goes, so focus
  // goes back to the room the player is in — not to the page, where the
  // player's keys (and Quick look's, behind it) would act on the wrong layer.
  const closeTc = () => {
    editTc(null);
    const room = rootRef.current?.closest('[role="dialog"]');
    if (room) { try { room.focus({ preventScroll: true }); } catch (_) {} }
  };
  const commitTc = (text) => {
    const st = S.current;
    const f = parseJump(text, { fps: st.fpsEff, current: here(), startFrames: st.effMode === 'tc' ? st.startFrames : 0, df: st.df, frames: st.frames });
    if (f == null) { setTcInvalid((n) => n + 1); return false; }
    closeTc();
    touch();
    stopTransport();
    seekFrame(f);
    return true;
  };

  // ── Scrubbing ────────────────────────────────────────────────────────────
  const onScrubStart = () => {
    touch();
    ensureFacts();
    scrubbingRef.current = true;
    scrubWasPlaying.current = isRunning();
    stopTransport();
  };
  const onScrubEnd = () => {
    scrubbingRef.current = false;
    if (scrubWasPlaying.current && !compact) startPlayback(S.current.userRate);
  };

  // Where the player is: while paused, the frame asked for (its centre time),
  // not currentTime — a seek may still be landing, a frame or several behind.
  const stateNow = () => {
    const st = S.current;
    const el = vRef.current;
    const running = isRunning();
    const f = here();
    const time = !el ? null : running ? el.currentTime : frameCentre(f, st.fpsEff, st.t0, el.duration || Infinity);
    return { frame: f, time, playing: running, fps: st.fpsEff, provisional: st.provisional, touched: touchedRef.current };
  };

  // ── The ref API (FilmReview, frame comments) ─────────────────────────────
  const api = useMemo(() => ({
    play, pause, toggle, step, seekFrame, seekTime, hud,
    getFrame: () => frameRef.current,
    getFps: () => S.current.fpsEff,
    getT0: () => S.current.t0,
    getRange: () => normalizeRange(S.current.range.in, S.current.range.out, S.current.frames),
    getPicture: () => picture,
    getPlaying: () => isRunning(),
    getSide: () => S.current.side,
    getState: () => stateNow(),
    element: () => vRef.current,
    format: (f) => fmtRef.current(f),
    markIn, markOut, clearRange: () => setRangeState({ in: null, out: null }), setRange,
    toggleHelp: () => setHelp((h) => !h),
  }), [play, pause, toggle, step, seekFrame, seekTime, hud, picture]);   // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => api, [api]);

  // ── Tooltips: one, delegated, quick once one has shown ───────────────────
  const tipTimer = useRef(null);
  const tipLast = useRef(0);
  const hideTip = () => { clearTimeout(tipTimer.current); setTip(null); };
  const onTipOver = (e) => {
    const t = e.target.closest?.('[data-tip]');
    // Over something without a tip — or the one that had it went away
    // without a pointerout (the timecode turning into its field).
    if (!t || !rootRef.current?.contains(t)) { hideTip(); return; }
    clearTimeout(tipTimer.current);
    const show = () => {
      if (!t.isConnected || !rootRef.current) return;
      const r = t.getBoundingClientRect();
      const hr = rootRef.current.getBoundingClientRect();
      setTip({ text: t.dataset.tip, key: keyboard ? (t.dataset.key || '') : '', x: r.left + r.width / 2 - hr.left, y: r.top - hr.top });
      tipLast.current = performance.now();
    };
    if (performance.now() - tipLast.current < 400) show(); else tipTimer.current = setTimeout(show, 500);
  };
  const onTipOut = (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t && t.contains(e.relatedTarget)) return;
    if (tip) tipLast.current = performance.now();
    hideTip();
  };
  useEffect(() => () => clearTimeout(tipTimer.current), []);

  // ── Menus ────────────────────────────────────────────────────────────────
  // The rows are built on every render from the menu's id (menuItems,
  // below), so a row that stays open (Thirds, Centre cross) shows its new tick.
  const openMenu = (id, anchorEl, opts = {}) => {
    if (menu?.id === id) { setMenu(null); return; }
    hideTip();
    const isEl = typeof anchorEl?.getBoundingClientRect === 'function';
    const r = isEl ? anchorEl.getBoundingClientRect() : anchorEl;
    setMenu({ id, anchor: r, ignore: isEl ? anchorEl : null, ...opts });
  };
  const speedItems = () => [
    ...(shuttleRef.current.dir && shuttleRef.current.rate !== 1 ? [{ id: 'sh', label: `Shuttle ${shuttleText(shuttleRef.current)}`, disabled: true }, { divider: true }] : []),
    ...[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({
      id: `r${r}`, label: r === 1 ? 'Normal' : `${r}×`, checked: Math.abs(S.current.userRate - r) < 1e-6,
      hint: r === 1 ? '1×' : undefined, run: () => { setRate(r); hud(hudText('speed', { rate: r })); },
    })),
    { divider: true },
    { id: 'keys', label: 'Slower · faster', hint: '⇧< ⇧>', disabled: true },
  ];
  const guideItems = () => [
    ...GUIDES.map((g) => ({
      id: g.id, label: g.label, checked: S.current.guide === g.id,
      thumb: g.ar ? <AspectThumb ar={g.ar} /> : <span className="film-menu-thumb-empty" />,
      hint: S.current.guide === g.id && fullKeys ? 'G' : undefined,
      run: () => { setGuide(g.id); if (g.id !== 'off') writePrefs({ guide: g.id }); },
    })),
    { divider: true },
    { id: 'thirds', label: 'Thirds', checked: guideOpts.thirds, radio: false, keepOpen: true, run: () => setGuideOpts((o) => ({ ...o, thirds: !o.thirds })) },
    { id: 'cross', label: 'Centre cross', checked: guideOpts.cross, radio: false, keepOpen: true, run: () => setGuideOpts((o) => ({ ...o, cross: !o.cross })) },
  ];
  const tcItems = () => [
    ...TC_MODES.map((m) => ({
      id: m.id, label: m.id === 'tc' && media?.tc ? `${m.label} · from ${frameToTC(0, fpsEff, { df, start: startFrames })}` : m.label,
      checked: effMode === m.id, disabled: m.id === 'tc' && !media?.tc,
      sub: m.id === 'tc' && !media?.tc ? 'This file has no start timecode' : undefined,
      run: () => setTcMode(m.id),
    })),
    { divider: true },
    { id: 'copy', label: 'Copy timecode', hint: fullKeys ? '⌘C' : undefined, run: copyTc },
  ];
  const rangeItems = () => {
    const r = S.current.range;
    return [
      { id: 'gin', label: 'Go to in', hint: '⇧I', disabled: r.in == null, run: () => runRef.current('goIn') },
      { id: 'gout', label: 'Go to out', hint: '⇧O', disabled: r.out == null, run: () => runRef.current('goOut') },
      { id: 'pio', label: 'Play in to out', hint: '⇧Space', run: playInOut },
      { divider: true },
      { id: 'cin', label: 'Clear in', disabled: r.in == null, run: () => setRangeState((x) => ({ ...x, in: null })) },
      { id: 'cout', label: 'Clear out', disabled: r.out == null, run: () => setRangeState((x) => ({ ...x, out: null })) },
      { id: 'cboth', label: 'Clear both', hint: '⌥X', run: clearRange },
    ];
  };
  const stageItems = () => [
    { id: 'copy', label: 'Copy timecode', hint: fullKeys ? '⌘C' : undefined, run: copyTc },
    ...(canCopyLink ? [{ id: 'link', label: 'Copy link to this frame', hint: fullKeys ? '⇧⌘C' : undefined, run: () => runRef.current('copyLink') }] : []),
    { divider: true },
    { id: 'zoom', label: pz.mode === 'fit' ? 'Zoom the picture to 100%' : 'Fit the picture', hint: fullKeys ? 'Z' : undefined, run: cyclePictureZoom },
    { id: 'loop', label: 'Loop', checked: looping, radio: false, hint: fullKeys ? '⌥L' : undefined, run: toggleLoop },
    { id: 'guides', label: guide === 'off' ? 'Show framing guides' : 'Hide framing guides', hint: fullKeys ? 'G' : undefined,
      run: () => { if (guide === 'off') { setGuide(prefs.guide || '2.39'); } else setGuide('off'); } },
    { id: 'mute', label: muted ? 'Unmute' : 'Mute', hint: keyboard ? 'M' : undefined, run: toggleMute },
    ...(canFull ? [{ id: 'full', label: isFull ? 'Exit full screen' : 'Full screen', hint: fullKeys ? 'F' : undefined, run: toggleFull }] : []),
  ];
  const stageMenu = (e) => {
    if (compact) return;
    e.preventDefault();
    openMenu('stage', { left: e.clientX, top: e.clientY, width: 0, height: 0 }, { placement: 'below', align: 'start' });
  };
  const menuItems = { speed: speedItems, guides: guideItems, tcmode: tcItems, range: rangeItems, stage: stageItems };

  // ── Stage clicks ─────────────────────────────────────────────────────────
  const downAt = useRef(null);
  const downState = useRef(null);
  const onStagePointerDown = (e) => {
    downAt.current = { x: e.clientX, y: e.clientY };
    // Where it was before a double-click's first click toggled it.
    if (e.detail <= 1) downState.current = stateNow();
  };
  const onStageDoubleClick = (e) => {
    if (compact) {
      if (!onExpand) return;
      e.stopPropagation();
      const st = downState.current || api.getState();
      stopTransport();
      onExpand(st);
      return;
    }
    if (full && canFull) toggleFull();
  };
  const onStageClick = (e) => {
    const d = downAt.current;
    downAt.current = null;
    if (e.target.closest?.('button, input, .film-error, .film-sheet-scrim, .film-overlay.is-live')) return;
    // The tap that brought the controls back does only that.
    if (tapWoke.current) { tapWoke.current = false; return; }
    // A drag (moving the card, or a selection) isn't a click.
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    // The second click of a double-click doesn't toggle again.
    if (e.detail >= 2) return;
    if (failure) return;
    if (compact) {
      if (clickGate && !clickGate(e)) return;
      e.stopPropagation();
    }
    const wasRunning = isRunning();
    toggle();
    if (!compact) doFlash(wasRunning ? 'pause' : 'play');
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const loading = !url && !signError;
  const guideDef = GUIDES.find((g) => g.id === guide);
  const hasAudio = !(media?.probed && !media?.audio);
  const shuttleLabel = shuttleView.dir && !(shuttleView.dir > 0 && shuttleView.rate === 1) ? shuttleText(shuttleView) : null;
  const hudView = hudT ? { text: hudT.text, id: hudT.id } : (hudP ? { text: hudP, id: 'p', persist: true }
    : (buffering && !compact ? { text: hudText('buffering'), id: 'b', persist: true } : null));
  const err = failure || (signError ? { title: 'Couldn’t load the video', body: 'The link to the file couldn’t be made. Check your connection and try again.', retry: true } : null);

  const ctl = {
    full, preview, compact, keyboard, playing, muted, volume, hasAudio, userRate, shuttleLabel, range, looping,
    guide, guideDef, frames, fps: fpsEff, provisional, vfr: !!media?.vfr, effMode, lengthText, showRemaining, tcEdit, tcInvalid,
    isFull, canFull, compareOn: !!compareUrl, side, label: label || 'A', compareLabel: compareLabel || 'B', tcRef, menuId: menu?.id,
    disabled: !!err || loading,
    toggle, step, markIn, markOut, clearRange, toggleLoop, toggleMute, setVolume, toggleFull, flip,
    setShowRemaining, setTcEdit: editTc, closeTc, commitTc, format,
    openSpeed: (el) => openMenu('speed', el, { align: 'center' }),
    openGuides: (el) => openMenu('guides', el, { align: 'center' }),
    openTcMode: (el) => openMenu('tcmode', el, { align: 'start' }),
    openRange: (el) => openMenu('range', el, { align: 'start' }),
    onExpand: onExpand ? () => { const s = api.getState(); pause(); onExpand(s); } : null,
    rangeLength: range.in != null || range.out != null
      ? (() => { const r = normalizeRange(range.in, range.out, frames); return { frames: (r.out ?? frames - 1) - (r.in ?? 0) + 1 }; })() : null,
    onDockEnter: () => { overDockRef.current = true; },
    onDockLeave: () => { overDockRef.current = false; },
    onRetry: () => { setFailure(null); setRetryNonce((n) => n + 1); elA?.load?.(); },
    onOpenPlayer: onOpenPlayer ? () => { const st = api.getState(); pause(); onOpenPlayer(st); } : null,
    zoomMode: pz.mode,
    fitPicture: () => setPz({ scale: 1, x: 0, y: 0, mode: 'fit' }),
  };

  const timeline = (
    <FilmTimeline ref={timelineRef} frames={frames} fps={fpsEff} fpsValue={fpsV} t0={t0} format={format}
                  mode={compact ? 'compact' : 'full'} range={range} looping={looping}
                  onRangeChange={(r) => setRange(r)} markers={markers} ghostMarkers={ghostMarkers}
                  onMarker={(m) => { stopTransport(); seekFrame(m.frame); onAction?.('marker', m); }}
                  mediaEl={activeEl} previewUrl={!compact ? (side === 'B' ? shownCompareUrl : url) : null} ar={pictureAr}
                  playerWidth={stageBox.w} resetKey={url} bare={preview}
                  onScrubStart={onScrubStart} onScrub={(f) => seekFrame(f)} onScrubEnd={onScrubEnd} />
  );

  return (
    <div ref={rootRef}
         className={`film film--${mode}${isFull ? ' is-fullscreen' : ''}${playing ? ' is-playing' : ''}${idle ? ' is-idle' : ''}${loading ? ' is-loading' : ''}${err ? ' is-error' : ''}${touchedState ? ' is-touched' : ''} ${className}`}
         data-frame={frameState} data-side={side} data-zoom={pz.mode} aria-label={title ? `Player: ${title}` : 'Player'}
         style={{ '--ar': pictureAr }}
         onPointerMove={isFull ? wake : compact || preview ? onCompactMove : undefined}
         onPointerOver={compact ? undefined : onTipOver} onPointerOut={compact ? undefined : onTipOut}
         onPointerDownCapture={compact ? undefined : onRootPointerDown}
         onPointerEnter={compact ? () => { ensureFacts(); measureUi(); } : undefined}>
      <div className="film-stage" ref={setStageEl}
           onPointerDown={(e) => { onStagePointerDown(e); onZoomPanDown(e); }}
           onPointerMove={onZoomPanMove} onPointerUp={onZoomPanUp} onPointerCancel={onZoomPanUp}
           onClick={onStageClick}
           onDoubleClick={onStageDoubleClick}
           onContextMenu={compact ? undefined : stageMenu}>
        <div className="film-zoomwrap" style={pz.mode === 'fit' ? undefined : { transform: `translate(${pz.x}px, ${pz.y}px) scale(${pz.scale})` }}>
        {url && (
          <video ref={setElA} className={`film-video${side === 'B' ? ' is-hidden' : ''}`} src={url} poster={posterUrl || undefined}
                 preload={compact ? 'metadata' : 'auto'} playsInline muted={muted || side !== 'A'} aria-label={title || 'Video'} />
        )}
        {shownCompareUrl && (
          <video ref={setElB} className={`film-video film-video--b${side === 'B' ? '' : ' is-hidden'}`} src={shownCompareUrl}
                 preload="metadata" playsInline muted aria-label={compareLabel || 'Other version'} />
        )}
        {loading && posterUrl && <img className="film-poster" src={posterUrl} alt="" />}
        {(loading || (buffering && !compact)) && !err && <span className="film-spinner"><Spinner size={compact ? 20 : 28} tone="on-dark" label={loading ? 'Loading video' : 'Buffering'} /></span>}
        {!compact && guideDef && guideDef.id !== 'off' && picture.w > 0 && <FramingGuide guide={guideDef} picture={picture} />}
        {!compact && (guideOpts.thirds || guideOpts.cross) && picture.w > 0 && <GuideExtras opts={guideOpts} picture={picture} />}
        {!compact && overlay && picture.w > 0 && (
          <div className={`film-overlay${overlayLive ? ' is-live' : ''}`} style={{ left: picture.x, top: picture.y, width: picture.w, height: picture.h }}>
            {overlay({ picture, frame: frameState })}
          </div>
        )}
        </div>
        {!compact && compareUrl && picture.w > 0 && (
          <span className="film-side-badge" style={{ left: picture.x + picture.w - 12, top: picture.y + 12, transform: 'translateX(-100%)' }}>
            {side === 'B' ? `B · ${compareLabel || 'B'}` : `A · ${label || 'A'}`}
          </span>
        )}
        {!compact && <FilmHud hud={hudView} picture={picture.w ? picture : null} />}
        {flash && <span key={flash.id} className="film-flash" aria-hidden="true">{flash.kind === 'pause' ? <PauseGlyph size={30} /> : <PlayGlyph size={30} />}</span>}
        {err && (
          <div className="film-error" role="alert">
            <strong>{err.title}</strong>
            {!compact && <span>{err.body}</span>}
            {!compact && (
              <div className="film-error-actions">
                {err.retry && <button type="button" className="film-pill" onClick={ctl.onRetry}>Retry</button>}
                {onDownload && <button type="button" className="film-pill" onClick={onDownload}>Download</button>}
                {onUploadVersion && <button type="button" className="film-pill" onClick={onUploadVersion}>Upload a version</button>}
              </div>
            )}
          </div>
        )}
        {isFull && title && <div className="film-fs-title">{title}</div>}
        {help && <ShortcutSheet onClose={() => setHelp(false)} />}
        {compact && !err && <CompactCentre playing={playing} onToggle={() => { const w = isRunning(); toggle(); if (!w) touch(); }} />}
      </div>
      {compact ? (
        <CompactBar ctl={ctl} timeline={timeline} />
      ) : preview ? (
        <PreviewBar ctl={ctl} timeline={timeline} />
      ) : (
        <FilmDock ctl={ctl} timeline={timeline} />
      )}
      {menu && (
        <FilmMenu anchor={menu.anchor} container={rootRef.current} items={menuItems[menu.id]?.() || []} label={menu.id} ignore={menu.ignore}
                  placement={menu.placement || 'above'} align={menu.align || 'start'} onClose={() => setMenu(null)} />
      )}
      {tip && (
        <div className="film-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.text}{tip.key && <kbd>{tip.key}</kbd>}
        </div>
      )}
    </div>
  );
});

// The board card's controls: a centre play button while paused, and a bar
// along the bottom — play, timecode, mute, ⤢ — over a scrubber on the edge.
function CompactCentre({ playing, onToggle }) {
  if (playing) return null;
  return (
    <button type="button" className="film-centre-play" tabIndex={-1} aria-label="Play"
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <PlayGlyph size={20} />
    </button>
  );
}
function CompactBar({ ctl, timeline }) {
  const btn = (props) => ({
    type: 'button', tabIndex: -1,
    onPointerDown: (e) => { e.stopPropagation(); e.preventDefault(); },
    ...props,
  });
  return (
    <div className="film-cbar" onPointerDown={(e) => { if (e.target.closest('button, .ft-track')) e.stopPropagation(); }}>
      <div className="film-cbar-row">
        <button {...btn({ className: 'film-btn', onClick: (e) => { e.stopPropagation(); ctl.toggle(); }, 'aria-label': ctl.playing ? 'Pause' : 'Play' })}>
          {ctl.playing ? <PauseGlyph size={16} /> : <PlayGlyph size={16} />}
        </button>
        <button {...btn({ className: 'film-btn film-cbar-step', onClick: (e) => { e.stopPropagation(); ctl.step(-1); }, 'aria-label': 'Back one frame' })}>
          <FrameBack size={16} />
        </button>
        <button {...btn({ className: 'film-btn film-cbar-step', onClick: (e) => { e.stopPropagation(); ctl.step(1); }, 'aria-label': 'Forward one frame' })}>
          <FrameFwd size={16} />
        </button>
        <span className="film-tc" ref={ctl.tcRef}>{ctl.format(0)}</span>
        <span className="film-cbar-spacer" />
        <button {...btn({ className: 'film-btn', onClick: (e) => { e.stopPropagation(); ctl.toggleMute(); }, 'aria-label': ctl.muted ? 'Unmute' : 'Mute' })}>
          <Icon as={ctl.muted ? SpeakerSlash : SpeakerHigh} size={16} weight="regular" />
        </button>
        {ctl.onExpand && (
          <button {...btn({ className: 'film-btn', onClick: (e) => { e.stopPropagation(); ctl.onExpand(); }, 'aria-label': 'Open in the review player', title: 'Open in the review player' })}>
            <Icon as={ArrowsOutSimple} size={16} weight="regular" />
          </button>
        )}
      </div>
      {timeline}
    </div>
  );
}

// Quick look's controls: over the picture's bottom edge — the timeline, then
// play, frame steps, timecode and length, mute, and Open in player.
function PreviewBar({ ctl, timeline }) {
  const keep = (e) => { e.stopPropagation(); if (e.pointerType === 'mouse') e.preventDefault(); };
  return (
    <div className="film-pbar" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="film-pbar-timeline">{timeline}</div>
      <div className="film-pbar-row">
        <button type="button" className="film-btn" onPointerDown={keep} onClick={ctl.toggle} aria-label={ctl.playing ? 'Pause' : 'Play'}>
          {ctl.playing ? <PauseGlyph size={20} /> : <PlayGlyph size={20} />}
        </button>
        <button type="button" className="film-btn" onPointerDown={keep} onClick={() => ctl.step(-1)} aria-label="Back one frame" data-tip="Back one frame" data-key=",">
          <FrameBack size={18} />
        </button>
        <button type="button" className="film-btn" onPointerDown={keep} onClick={() => ctl.step(1)} aria-label="Forward one frame" data-tip="Forward one frame" data-key=".">
          <FrameFwd size={18} />
        </button>
        <span className="film-pbar-tc"><span ref={ctl.tcRef}>{ctl.format(0)}</span><span className="film-pbar-len"> / {ctl.lengthText}</span></span>
        <span className="film-cbar-spacer" />
        <button type="button" className="film-btn" onPointerDown={keep} onClick={ctl.toggleMute} disabled={!ctl.hasAudio}
                aria-label={!ctl.hasAudio ? 'No audio track' : ctl.muted ? 'Unmute' : 'Mute'}>
          <Icon as={!ctl.hasAudio || ctl.muted ? SpeakerSlash : SpeakerHigh} size={18} weight="regular" />
        </button>
        {ctl.onOpenPlayer && (
          <button type="button" className="film-pbar-open" onPointerDown={keep} onClick={ctl.onOpenPlayer}>
            <Icon as={ArrowsOutSimple} size={14} weight="regular" /><span>Open in player</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Aspect masks (what a 2.39 extraction from this frame keeps), labelled, and
// safe areas.
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
      <span className="film-guide-line" style={{ left: L, top: T, width: inner.w, height: inner.h }}>
        <span className="film-guide-label">{guide.label}</span>
      </span>
    </div>
  );
}
function GuideExtras({ opts, picture }) {
  const { x, y, w, h } = picture;
  return (
    <div className="film-guide" aria-hidden="true">
      {opts.thirds && (
        <>
          <span className="film-third" style={{ left: x + w / 3, top: y, height: h, width: 1 }} />
          <span className="film-third" style={{ left: x + (2 * w) / 3, top: y, height: h, width: 1 }} />
          <span className="film-third" style={{ left: x, top: y + h / 3, width: w, height: 1 }} />
          <span className="film-third" style={{ left: x, top: y + (2 * h) / 3, width: w, height: 1 }} />
        </>
      )}
      {opts.cross && (
        <>
          <span className="film-cross" style={{ left: x + w / 2 - 12, top: y + h / 2, width: 24, height: 1 }} />
          <span className="film-cross" style={{ left: x + w / 2, top: y + h / 2 - 12, width: 1, height: 24 }} />
        </>
      )}
    </div>
  );
}
