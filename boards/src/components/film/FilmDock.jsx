// The review player's dock, under the picture (FilmPlayer mode="full"):
//
//   ┌ timeline ─────────────────────────────────────────────── [−][Fit][+] ┐
//   │ 00:00:03:23 / 00:00:10:00 [TC▾][24] [I–O · 72 fr ×]  [ ⟦ ◁| ▶ |▷ ⟧ ]  [↻][1×][▭] [A|B] [🔈━━][⛶] │
//
// Everything reads from `ctl` (the engine's state and actions). Buttons don't
// keep focus after a click, so the player's keys keep working; Tab still
// reaches them, with a gold ring.
import { useEffect, useRef } from 'react';
import { Icon } from '../Icon.jsx';
import { SpeakerHigh, SpeakerLow, SpeakerSlash, CornersOut, CornersIn, Repeat, X, ChevronDown } from '../../lib/icons.js';
import { PlayGlyph, PauseGlyph, FrameBack, FrameFwd, MarkIn, MarkOut, GuidesGlyph } from './glyphs.jsx';
import { formatFps } from '../../lib/cardInfo.js';

// Mouse clicks don't take focus (keys keep going to the player); keyboard
// focus still lands with :focus-visible.
const noFocus = (e) => { if (e.pointerType === 'mouse') e.preventDefault(); };

// Press and hold a frame step: one now, then repeating.
function useHoldRepeat(fn, fpsValue) {
  const t = useRef({ a: null, b: null });
  const stop = () => { clearTimeout(t.current.a); clearInterval(t.current.b); };
  useEffect(() => stop, []);
  return {
    onPointerDown: (e) => {
      noFocus(e);
      if (e.button !== 0) return;
      fn(e.shiftKey);
      stop();
      t.current.a = setTimeout(() => { t.current.b = setInterval(() => fn(false), Math.max(40, 1000 / (fpsValue || 24))); }, 350);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(e.shiftKey); } },
  };
}

function TcReadout({ ctl }) {
  const inputRef = useRef(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el || !ctl.tcEdit) return;
    el.focus();
    const n = el.value.length;
    if (ctl.tcEdit.seed) el.setSelectionRange(n, n); else el.select();
  }, [ctl.tcEdit]);
  // Shake on a jump that isn't one — the same field, still focused, text kept.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || !ctl.tcInvalid) return;
    el.classList.remove('is-invalid');
    void el.offsetWidth;   // restart the animation
    el.classList.add('is-invalid');
  }, [ctl.tcInvalid]);
  const fpsText = ctl.vfr ? 'VFR' : `${ctl.provisional ? '≈' : ''}${formatFps(ctl.fps).replace(' fps', '')}`;
  const chip = { tc: 'TC', clip: 'CLIP', frames: 'FR', seconds: 'SEC' }[ctl.effMode] || 'TC';
  return (
    <div className={`film-tcgroup${ctl.provisional ? ' is-provisional' : ''}`}>
      {ctl.tcEdit ? (
        <input ref={inputRef} className="film-tc film-tc-input"
               defaultValue={ctl.tcEdit.seed || ''} placeholder="01:00:10:12 · 240 · 10.5s · +12"
               aria-label="Go to a timecode, frame number or seconds" spellCheck={false} autoComplete="off"
               onKeyDown={(e) => {
                 e.stopPropagation();
                 if (e.key === 'Enter') { e.preventDefault(); ctl.commitTc(e.currentTarget.value); }
                 if (e.key === 'Escape') { e.preventDefault(); ctl.setTcEdit(null); }
               }}
               onBlur={() => ctl.setTcEdit(null)} />
      ) : (
        <button type="button" className="film-tc" data-tip="Type a timecode, frame or seconds to jump" data-key="0–9"
                onPointerDown={noFocus} onClick={() => ctl.setTcEdit({ seed: '' })}
                onContextMenu={(e) => { e.preventDefault(); ctl.openTcMode(e.currentTarget); }}
                aria-label="Current timecode — click to jump">
          <span ref={ctl.tcRef}>{ctl.format(0)}</span>
        </button>
      )}
      {ctl.tcEdit && ctl.tcInvalid > 0 && <span className="film-tc-hint" role="status">Try 01:00:10:12 · 240 · 10.5s · +12</span>}
      <button type="button" className="film-dur" onPointerDown={noFocus}
              data-tip={ctl.showRemaining ? 'Show the length' : 'Show the time left'}
              onClick={() => ctl.setShowRemaining((r) => !r)}>
        / {ctl.lengthText || '—'}
      </button>
      <button type="button" className="film-chip film-chip--btn" onPointerDown={noFocus} onClick={(e) => ctl.openTcMode(e.currentTarget)}
              data-tip="How the timecode reads" aria-haspopup="menu" aria-expanded={ctl.menuId === 'tcmode'}>
        {chip}<Icon as={ChevronDown} size={10} weight="bold" />
      </button>
      {ctl.fps && (
        <span className="film-chip film-fps"
              data-tip={ctl.vfr ? 'Variable frame rate — frame numbers are approximate' : ctl.provisional ? 'Frame rate not read yet — counting at 24 for now' : 'Frame rate'}>
          {fpsText}
        </span>
      )}
      {ctl.rangeLength && (
        <span className="film-inout">
          <button type="button" className="film-inout-main" onPointerDown={noFocus} onClick={(e) => ctl.openRange(e.currentTarget)}
                  aria-haspopup="menu" data-tip="In and out">
            <span className="film-inout-k">I–O</span> {ctl.rangeLength.frames} fr
          </button>
          <button type="button" className="film-inout-x" onPointerDown={noFocus} onClick={ctl.clearRange} aria-label="Clear in and out" data-tip="Clear in and out" data-key="⌥X">
            <Icon as={X} size={12} weight="bold" />
          </button>
        </span>
      )}
    </div>
  );
}

function VolumeControl({ ctl }) {
  const v = ctl.muted ? 0 : ctl.volume;
  const icon = !ctl.hasAudio || ctl.muted || v === 0 ? SpeakerSlash : v < 0.5 ? SpeakerLow : SpeakerHigh;
  return (
    <div className={`film-volume${ctl.hasAudio ? '' : ' is-disabled'}`}>
      <button type="button" className="film-btn" onPointerDown={noFocus} onClick={ctl.toggleMute} disabled={!ctl.hasAudio}
              aria-label={!ctl.hasAudio ? 'No audio track' : ctl.muted ? 'Unmute' : 'Mute'}
              data-tip={!ctl.hasAudio ? 'This clip has no sound' : ctl.muted ? 'Unmute' : 'Mute'} data-key="M">
        <Icon as={icon} size={20} weight="regular" />
      </button>
      {ctl.hasAudio && (
        <input type="range" className="film-vol-slider" min={0} max={1} step={0.01} value={v}
               aria-label="Volume" style={{ '--v': `${v * 100}%` }}
               onPointerDown={(e) => e.stopPropagation()}
               onChange={(e) => ctl.setVolume(Number(e.target.value))}
               onWheel={(e) => ctl.setVolume(v + (e.deltaY < 0 ? 0.05 : -0.05))} />
      )}
    </div>
  );
}

export function FilmDock({ ctl, timeline }) {
  const back = useHoldRepeat((shift) => ctl.step(shift ? -Math.round(ctl.fps?.[0] / (ctl.fps?.[1] || 1) || 24) : -1), ctl.fps ? ctl.fps[0] / ctl.fps[1] : 24);
  const fwd = useHoldRepeat((shift) => ctl.step(shift ? Math.round(ctl.fps?.[0] / (ctl.fps?.[1] || 1) || 24) : 1), ctl.fps ? ctl.fps[0] / ctl.fps[1] : 24);
  const rateText = ctl.shuttleLabel || `${ctl.userRate}×`;
  const rateOn = !!ctl.shuttleLabel || Math.abs(ctl.userRate - 1) > 1e-6;
  return (
    <div className={`film-dock${ctl.disabled ? ' is-disabled' : ''}`} onPointerEnter={ctl.onDockEnter} onPointerLeave={ctl.onDockLeave}
         onContextMenu={(e) => e.preventDefault()}>
      <div className="film-dock-timeline">{timeline}</div>
      <div className="film-dock-row">
        <div className="film-dock-left">
          <TcReadout ctl={ctl} />
        </div>
        <div className="film-dock-centre" role="group" aria-label="Transport">
          <button type="button" className={`film-btn${ctl.range.in != null ? ' is-set' : ''}`} onPointerDown={noFocus} onClick={ctl.markIn}
                  aria-label="Set in point" data-tip="Set in" data-key="I"><MarkIn /></button>
          <button type="button" className="film-btn" {...back} aria-label="Back one frame" data-tip="Back one frame — hold to repeat" data-key="←">
            <FrameBack />
          </button>
          <button type="button" className="film-btn film-play" onPointerDown={noFocus} onClick={ctl.toggle}
                  aria-label={ctl.playing ? 'Pause' : 'Play'} data-tip={ctl.playing ? 'Pause' : 'Play'} data-key="Space">
            {ctl.playing ? <PauseGlyph size={24} /> : <PlayGlyph size={24} />}
          </button>
          <button type="button" className="film-btn" {...fwd} aria-label="Forward one frame" data-tip="Forward one frame — hold to repeat" data-key="→">
            <FrameFwd />
          </button>
          <button type="button" className={`film-btn${ctl.range.out != null ? ' is-set' : ''}`} onPointerDown={noFocus} onClick={ctl.markOut}
                  aria-label="Set out point" data-tip="Set out" data-key="O"><MarkOut /></button>
        </div>
        <div className="film-dock-right">
          <button type="button" className={`film-btn${ctl.looping ? ' is-on' : ''}`} onPointerDown={noFocus} onClick={ctl.toggleLoop}
                  aria-pressed={ctl.looping} aria-label="Loop"
                  data-tip={ctl.range.in != null || ctl.range.out != null ? 'Loop between in and out' : 'Loop the whole clip'} data-key="⌥L">
            <Icon as={Repeat} size={20} weight="regular" />
          </button>
          <button type="button" className={`film-btn film-rate${rateOn ? ' is-on' : ''}`} onPointerDown={noFocus}
                  onClick={(e) => ctl.openSpeed(e.currentTarget)} aria-haspopup="menu" aria-expanded={ctl.menuId === 'speed'}
                  aria-label={`Speed ${rateText}`} data-tip="Speed" data-key="⇧< ⇧>">
            {rateText}
          </button>
          <button type="button" className={`film-btn${ctl.guide !== 'off' ? ' is-on' : ''}`} onPointerDown={noFocus}
                  onClick={(e) => ctl.openGuides(e.currentTarget)} aria-haspopup="menu" aria-expanded={ctl.menuId === 'guides'}
                  aria-label="Framing guides" data-tip={ctl.guideDef && ctl.guide !== 'off' ? `Guides: ${ctl.guideDef.label}` : 'Framing guides'} data-key="G">
            <GuidesGlyph />
          </button>
          {ctl.compareOn && (
            <>
              <span className="film-sep" />
              <div className="film-ab" role="group" aria-label="Compare versions">
                <button type="button" className={`film-ab-seg${ctl.side === 'A' ? ' is-shown' : ''}`} onPointerDown={noFocus}
                        onClick={() => { if (ctl.side !== 'A') ctl.flip(); }} aria-pressed={ctl.side === 'A'} data-tip="Show A" data-key="\">
                  A <span>{ctl.label}</span>
                </button>
                <button type="button" className={`film-ab-seg${ctl.side === 'B' ? ' is-shown' : ''}`} onPointerDown={noFocus}
                        onClick={() => { if (ctl.side !== 'B') ctl.flip(); }} aria-pressed={ctl.side === 'B'} data-tip="Show B" data-key="\">
                  B <span>{ctl.compareLabel}</span>
                </button>
              </div>
            </>
          )}
          <span className="film-sep" />
          <VolumeControl ctl={ctl} />
          {ctl.canFull && (
            <button type="button" className="film-btn" onPointerDown={noFocus} onClick={ctl.toggleFull}
                    aria-label={ctl.isFull ? 'Exit full screen' : 'Full screen'} data-tip={ctl.isFull ? 'Exit full screen' : 'Full screen'} data-key="F">
              <Icon as={ctl.isFull ? CornersIn : CornersOut} size={20} weight="regular" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
