// In-app color picker — embedded saturation/value pad + hue slider, hex input,
// preset and palette swatches. No native browser dialog.
//
// Rendered into a portal on document.body so position:fixed actually pins to
// the viewport (cards live inside a transformed canvas which would otherwise
// re-anchor any "fixed" descendant).

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addRecentColor, addSavedColor, removeSavedColor, isColorSaved } from '../lib/recentColors.js';
import { useRecentColors, useSavedColors } from '../hooks/useRecentColors.js';

const PRESETS = [
  '#ffffff', '#0a0a0c', '#f5f5f6', '#5b5c61',
  '#ef4444', '#f59e0b', '#fbbf24', '#10b981',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
  '#fef3c7', '#dcfce7', '#dbeafe', '#fee2e2',
];
const PANEL_W = 252;
const PAD = 10;

// ── HSV ⇄ RGB ⇄ hex ─────────────────────────────────────────────────────────
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function hexToRgb(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 136, g: 136, b: 136 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex({ r, g, b }) {
  const t = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
}
function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}
function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh >= 0 && hh < 1)      { r = c; g = x; b = 0; }
  else if (hh < 2)            { r = x; g = c; b = 0; }
  else if (hh < 3)            { r = 0; g = c; b = x; }
  else if (hh < 4)            { r = 0; g = x; b = c; }
  else if (hh < 5)            { r = x; g = 0; b = c; }
  else                        { r = c; g = 0; b = x; }
  const m = v - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function ColorPicker({
  value, onChange, onClose,
  allowTransparent = false,
  position = null,
  paletteColors = [],
  palettes = null,
  // When true, picks made through this picker DON'T enter the recent list.
  // Use it for "tentative" picks like the stroke/fill of a shape that hasn't
  // been placed yet — we can call addRecentColor manually once the shape is
  // committed to the canvas.
  disableRecent = false,
}) {
  const ref = useRef(null);
  const hexInputRef = useRef(null);
  const initialHex = (value && value !== 'transparent') ? value : '#888888';
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(initialHex)));
  const [hexText, setHexText] = useState(initialHex.replace(/^#/, ''));
  const lastEmittedRef = useRef(initialHex.toLowerCase());

  // Sync HSV from external value, but skip echoes of our own emits — that
  // would round-trip through rgbToHsv and wipe the user's chosen hue when
  // s=0 or v=0 (e.g. dragging the SV pad to white loses the hue cursor).
  useEffect(() => {
    if (!value || value === 'transparent') return;
    if (lastEmittedRef.current === String(value).toLowerCase()) return;
    const next = rgbToHsv(hexToRgb(value));
    setHsv(next);
    setHexText(value.replace(/^#/, ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const currentHex = useMemo(() => rgbToHex(hsvToRgb(hsv)), [hsv]);

  // Sync hexText from currentHex (driven by SV pad / hue strip / preset clicks),
  // but NEVER while the user is mid-type in the hex field — that would
  // overwrite their partial entry on every commit.
  useEffect(() => {
    if (document.activeElement === hexInputRef.current) return;
    setHexText(currentHex.replace(/^#/, ''));
  }, [currentHex]);

  // Recent-colors policy: a session is one open→close cycle of the picker.
  // We don't add anything to the recent list while the user is exploring
  // (drag, preset clicks, hex typing) — only the FINAL color the picker
  // closes on. That way one open→close yields one new entry, regardless of
  // how many intermediate colors the user previewed.
  const dirtyRef = useRef(false);
  const lastPickedRef = useRef(null);
  const markDirty = (hx) => { dirtyRef.current = true; lastPickedRef.current = hx; };

  // Outside-click + Escape close. We attach exactly once on mount (and tear
  // down on unmount). Using a ref for onClose avoids re-attaching on every
  // parent re-render, which would otherwise reset our "first event" guard
  // and let the next outside click slip through.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const disableRecentRef = useRef(disableRecent);
  useEffect(() => { disableRecentRef.current = disableRecent; }, [disableRecent]);
  useEffect(() => {
    let armed = false;
    const t = setTimeout(() => { armed = true; }, 0);
    const onDocDown = (e) => {
      if (!armed) return;
      if (ref.current && !ref.current.contains(e.target)) onCloseRef.current?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    // Capture phase + both mouse and pointer so card stopPropagation can't
    // swallow it. Pointer events fire before mouse on most platforms.
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('mousedown', onDocDown, true);
      window.removeEventListener('keydown', onKey);
      // Commit ONE recent-color entry per open→close cycle, only if the
      // user actually picked something AND the consumer didn't ask us to
      // skip the recent list (e.g. tool options for an unplaced shape).
      if (!disableRecentRef.current && dirtyRef.current && lastPickedRef.current) {
        addRecentColor(lastPickedRef.current);
      }
    };
  }, []);

  // Live updates — onChange for visual feedback only. Recent list is touched
  // exclusively on unmount above.
  const commitHsv = (next) => {
    setHsv(next);
    const hx = rgbToHex(hsvToRgb(next));
    lastEmittedRef.current = hx.toLowerCase();
    onChange(hx);
    markDirty(hx);
  };

  const pickHex = (hx) => {
    setHsv(rgbToHsv(hexToRgb(hx)));
    setHexText(hx.replace(/^#/, ''));
    lastEmittedRef.current = hx.toLowerCase();
    onChange(hx);
    markDirty(hx);
  };

  const onHexInput = (e) => {
    let v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexText(v);
    // Commit ONLY on a full 6-char hex. We deliberately don't expand 3-char
    // shorthand mid-type — that turned "ffa" into "ffaffa" and made the hex
    // input feel like it was rewriting itself as the user typed.
    if (/^[0-9a-fA-F]{6}$/.test(v)) {
      const next = rgbToHsv(hexToRgb(v));
      setHsv(next);
      onChange('#' + v);
      markDirty('#' + v);
    }
  };

  // On blur: if user left a 3-char shorthand or partial entry, expand/snap
  // back to the current valid hex so the field never displays an incomplete
  // value once they've moved on.
  const onHexBlur = () => {
    if (/^[0-9a-fA-F]{3}$/.test(hexText)) {
      const full = hexText.split('').map(c => c + c).join('');
      setHexText(full);
      const next = rgbToHsv(hexToRgb(full));
      setHsv(next);
      onChange('#' + full);
      markDirty('#' + full);
      return;
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hexText)) {
      setHexText(currentHex.replace(/^#/, ''));
    }
  };

  // Latest hsv kept in a ref so the SV/hue drag handlers always read the
  // newest value (their closures otherwise capture the hsv at pointerdown).
  const hsvRef = useRef(hsv);
  useEffect(() => { hsvRef.current = hsv; }, [hsv]);

  // Native EyeDropper API — Chromium-only (Chrome, Edge, Arc, Opera). Hide
  // the button entirely on browsers that don't support it (Safari, Firefox)
  // rather than show a non-functional control.
  const eyeDropperSupported = typeof window !== 'undefined' && 'EyeDropper' in window;
  const pickFromScreen = async () => {
    if (!eyeDropperSupported) return;
    try {
      // The browser dims the page and shows a magnifier; resolves with the
      // sRGB hex the user clicked. AbortError fires if they hit Esc — that's
      // a normal cancellation, not a bug.
      const ed = new window.EyeDropper();
      const result = await ed.open();
      if (result?.sRGBHex) pickHex(result.sRGBHex);
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('[eyedropper]', err);
    }
  };

  const recentColors = useRecentColors();
  const savedColors = useSavedColors();

  // ── Saturation / Value pad ────────────────────────────────────────────────
  const onSvDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const update = (clientX, clientY) => {
      const r = el.getBoundingClientRect();
      const s = clamp((clientX - r.left) / r.width, 0, 1);
      const v = 1 - clamp((clientY - r.top) / r.height, 0, 1);
      commitHsv({ ...hsvRef.current, s, v });
    };
    update(e.clientX, e.clientY);
    const onMove = (ev) => update(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── Hue strip ─────────────────────────────────────────────────────────────
  const onHueDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const update = (clientX) => {
      const r = el.getBoundingClientRect();
      const h = clamp((clientX - r.left) / r.width, 0, 1) * 360;
      commitHsv({ ...hsvRef.current, h });
    };
    update(e.clientX);
    const onMove = (ev) => update(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Position the popover above the anchor when there's room, below otherwise.
  const PANEL_H = 308 + (paletteColors.length > 0 ? 38 : 0);
  const style = position ? (() => {
    const preferredLeft = position.x - PANEL_W / 2;
    const preferredTop = position.y - PANEL_H - 12;
    const top = preferredTop < PAD ? position.y + 36 : preferredTop;
    return {
      position: 'fixed',
      left: Math.max(PAD, Math.min(window.innerWidth - PANEL_W - PAD, preferredLeft)),
      top: Math.max(PAD, Math.min(window.innerHeight - PANEL_H - PAD, top)),
    };
  })() : undefined;

  const hueColor = `hsl(${hsv.h}, 100%, 50%)`;
  const cursorOnLight = hsv.v > 0.6 && hsv.s < 0.4;

  // Page through palettes one at a time. If the consumer passed structured
  // `palettes` (array of {name, swatches}), use that; else fall back to a
  // single synthetic palette of the flat `paletteColors` list.
  const palList = (palettes && palettes.length > 0)
    ? palettes
    : (paletteColors.length > 0
        ? [{ id: '_flat', name: 'Palette', swatches: paletteColors.map(hex => ({ hex })) }]
        : []);
  const [palIdx, setPalIdx] = useState(0);
  const [palSearchOpen, setPalSearchOpen] = useState(false);
  const safePalIdx = palList.length > 0 ? Math.min(palIdx, palList.length - 1) : 0;
  const currentPal = palList[safePalIdx];
  const cyclePal = (delta) => setPalIdx((i) => {
    const n = palList.length || 1;
    return ((i + delta) % n + n) % n;
  });

  const panel = (
    <div className="cp-pop" ref={ref} style={style}
         onPointerDown={(e) => e.stopPropagation()}
         onMouseDown={(e) => e.stopPropagation()}
         onClick={(e) => e.stopPropagation()}
         onDoubleClick={(e) => e.stopPropagation()}
         onContextMenu={(e) => e.stopPropagation()}>
      <div className="cp-head">
        <div>
          <div className="cp-kicker">Color</div>
          <div className="cp-title">{currentHex.toUpperCase()}</div>
        </div>
        <div className="cp-current" style={{ background: currentHex }} />
      </div>

      <div className="cp-sv" style={{ background: hueColor }} onPointerDown={onSvDown}>
        <div className="cp-sv-white" />
        <div className="cp-sv-black" />
        <div className={`cp-sv-cursor ${cursorOnLight ? 'on-light' : ''}`}
             style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>

      <div className="cp-hue" onPointerDown={onHueDown}>
        <div className="cp-hue-cursor" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      <div className="cp-row">
        <span className="cp-hex-prefix">#</span>
        <input type="text"
               className="cp-hex"
               ref={hexInputRef}
               value={hexText.toUpperCase()}
               maxLength={6}
               onChange={onHexInput}
               onBlur={onHexBlur}
               spellCheck={false}
               placeholder="FFFFFF" />
        {eyeDropperSupported && (
          <button className="cp-eyedropper-btn"
                  title="Pick a color from the screen"
                  aria-label="Pick a color from the screen"
                  onClick={pickFromScreen}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M11.5 1.5 L14.5 4.5 L12 7 L9 4 Z"
                    stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15" />
              <path d="M9 4 L3 10 L2 13 L5 12 L11 6"
                    stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        )}
        {allowTransparent && (
          <button className="cp-transparent-btn"
                  title="Transparent"
                  onClick={() => onChange('transparent')}>None</button>
        )}
        <button className={`cp-star-btn ${isColorSaved(currentHex) ? 'is-saved' : ''}`}
                title={isColorSaved(currentHex) ? 'Remove from Saved' : 'Save this color'}
                aria-label="Save color"
                onClick={() => {
                  if (isColorSaved(currentHex)) removeSavedColor(currentHex);
                  else addSavedColor(currentHex);
                }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1 L10 6 L15 6 L11 9 L13 14 L8 11 L3 14 L5 9 L1 6 L6 6 Z"
                  stroke="currentColor" strokeWidth="1.2"
                  fill={isColorSaved(currentHex) ? 'currentColor' : 'none'}
                  strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {savedColors.length > 0 && (
        <>
          <div className="cp-section">Saved</div>
          <div className="cp-presets">
            {savedColors.slice(0, 24).map(c => (
              <button key={'s' + c} className={`cp-sw ${currentHex.toLowerCase() === c.toLowerCase() ? 'is-active' : ''}`}
                      style={{ background: c }}
                      title={`${c.toUpperCase()} — right-click to remove`}
                      onClick={() => pickHex(c)}
                      onContextMenu={(e) => { e.preventDefault(); removeSavedColor(c); }} />
            ))}
          </div>
        </>
      )}
      {recentColors.length > 0 && (
        <>
          <div className="cp-section">Recent</div>
          <div className="cp-presets">
            {recentColors.slice(0, 16).map(c => (
              <button key={'r' + c} className={`cp-sw ${currentHex.toLowerCase() === c.toLowerCase() ? 'is-active' : ''}`}
                      style={{ background: c }}
                      onClick={() => pickHex(c)} />
            ))}
          </div>
        </>
      )}

      {currentPal && (
        <>
          <div className="cp-section cp-pal-head">
            <span className="cp-pal-kicker">Palette</span>
            <span className="cp-pal-name" title={currentPal.name}>{currentPal.name}</span>
            {palList.length > 1 && (
              <span className="cp-pal-pager">
                <button className="cp-pal-btn" title="Previous palette"
                        onClick={() => cyclePal(-1)}
                        onDoubleClick={() => setPalSearchOpen(true)}>↑</button>
                <span className="cp-pal-idx">{safePalIdx + 1}/{palList.length}</span>
                <button className="cp-pal-btn" title="Next palette (double-click to search)"
                        onClick={() => cyclePal(1)}
                        onDoubleClick={() => setPalSearchOpen(true)}>↓</button>
              </span>
            )}
            <button className="cp-pal-search-btn" title="Search all palettes"
                    onClick={() => setPalSearchOpen(true)}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M7 7 L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="cp-presets">
            {currentPal.swatches.slice(0, 16).map((s, i) => (
              <button key={'p' + i + s.hex}
                      className={`cp-sw ${currentHex.toLowerCase() === (s.hex || '').toLowerCase() ? 'is-active' : ''}`}
                      style={{ background: s.hex }}
                      title={s.name || s.hex}
                      onClick={() => pickHex(s.hex)} />
            ))}
          </div>
        </>
      )}

      {palSearchOpen && (
        <PaletteSearch palettes={palList}
                       currentHex={currentHex}
                       onPick={(hx) => { pickHex(hx); setPalSearchOpen(false); }}
                       onClose={() => setPalSearchOpen(false)} />
      )}

      <div className="cp-section">Presets</div>
      <div className="cp-presets">
        {PRESETS.map(c => (
          <button key={c} className={`cp-sw ${currentHex.toLowerCase() === c.toLowerCase() ? 'is-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => pickHex(c)} />
        ))}
      </div>
    </div>
  );

  // Portal to body so position:fixed actually pins to the viewport even when
  // the picker was opened from inside the transformed cards-layer.
  if (typeof document !== 'undefined') return createPortal(panel, document.body);
  return panel;
}

// Modal that lists every palette currently in scope, with a text filter.
// Click any swatch to apply it to the picker. Closes on outside-click or Esc.
function PaletteSearch({ palettes, currentHex, onPick, onClose }) {
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const filter = q.trim().toLowerCase();
  const matches = palettes
    .map(p => {
      const swatchMatch = p.swatches.filter(s =>
        !filter ||
        (s.name && s.name.toLowerCase().includes(filter)) ||
        (s.hex && s.hex.toLowerCase().includes(filter)));
      const nameMatch = !filter || p.name.toLowerCase().includes(filter);
      return { ...p, swatches: nameMatch ? p.swatches : swatchMatch, hide: !nameMatch && swatchMatch.length === 0 };
    })
    .filter(p => !p.hide);

  const panel = (
    <div className="cp-palsearch-back" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cp-palsearch" ref={ref}>
        <div className="cp-palsearch-head">
          <input autoFocus
                 className="cp-palsearch-input"
                 placeholder="Search palettes by name or hex…"
                 value={q}
                 onChange={(e) => setQ(e.target.value)} />
          <button className="cp-palsearch-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="cp-palsearch-list">
          {matches.length === 0 && <div className="cp-palsearch-empty">No matches</div>}
          {matches.map(p => (
            <div key={p.id} className="cp-palsearch-row">
              <div className="cp-palsearch-rowhead">{p.name}</div>
              <div className="cp-presets">
                {p.swatches.map((s, i) => (
                  <button key={i + s.hex}
                          className={`cp-sw ${currentHex.toLowerCase() === (s.hex || '').toLowerCase() ? 'is-active' : ''}`}
                          style={{ background: s.hex }}
                          title={s.name || s.hex}
                          onClick={() => onPick(s.hex)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(panel, document.body) : panel;
}
