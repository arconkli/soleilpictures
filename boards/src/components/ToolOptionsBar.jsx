// Bottom-of-canvas options bar. Renders different content based on the
// active tool or, when a note is being edited, rich-text controls that
// operate on the focused contenteditable.
//
// Note: rich-text formatting uses our editorSelection helpers — `withSelection`
// restores the saved selection before each command so the toolbar doesn't
// lose what the user had highlighted.

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  withSelection, wrapSelectionStyle, toggleList,
  captureSelection, captureSelectionOffsets, restoreSelectionFromOffsets,
} from '../lib/editorSelection.js';
import { useRecentColors } from '../hooks/useRecentColors.js';
import { addRecentColor } from '../lib/recentColors.js';
import { useCustomFonts, useRecentFonts } from '../hooks/useCustomFonts.js';
import { CustomFontsModal } from './CustomFontsModal.jsx';
import { FontPickerDropdown } from './FontPickerDropdown.jsx';
import { SizeInput } from './SizeInput.jsx';
import { combineAllFonts, ensureGoogleFontLoaded } from '../lib/googleFonts.js';
import { addRecentFont } from '../lib/customFonts.js';

const STROKE_COLORS = ['#f5f5f6', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const FILL_COLORS  = ['transparent', '#1c1c1f', '#fef3c7', '#fee2e2', '#dcfce7', '#dbeafe', '#f3e8ff', '#0a0a0c'];
const TEXT_COLORS  = ['#f5f5f6', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const BG_COLORS    = ['#1c1c1f', '#fef3c7', '#fee2e2', '#dcfce7', '#dbeafe', '#f3e8ff', '#fde68a', '#ffffff'];
const STROKE_WIDTHS = [0, 1, 2, 4, 8];
const DRAW_THICKNESS = [2, 4, 8, 16];
const FONTS = [
  { id: 'sans', name: 'Sans', css: 'Inter, system-ui, sans-serif' },
  { id: 'serif', name: 'Serif', css: 'ui-serif, Georgia, "Times New Roman", serif' },
  { id: 'mono', name: 'Mono', css: 'JetBrains Mono, ui-monospace, monospace' },
];
const SIZES = [11, 13, 15, 18, 24, 32, 48, 64];

const SHAPES = [
  { id: 'rect', label: 'Rect' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'star', label: 'Star' },
];

const DASH_STYLES = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
];

// Format helpers — operate on the saved selection from RichNoteEditor.
function execCmd(cmd, val = null) {
  withSelection(() => {
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    document.execCommand(cmd, false, val);
  });
}
function applyStyle(style) {
  withSelection(() => wrapSelectionStyle(style));
}

// Parse "rgb(r, g, b)" / "rgba(r, g, b, a)" into "#rrggbb". Returns null on
// failure (e.g. unsupported color syntax). Used to round-trip computed
// styles back into the hex form our color swatches and picker expect.
function rgbToHex(rgb) {
  if (!rgb) return null;
  const m = rgb.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  const [, r, g, b] = m;
  return '#' + [r, g, b].map(n => Number(n).toString(16).padStart(2, '0')).join('');
}

// Reflect the actual foreground color at the caret inside a .note-body, so
// the text-color toolbar swatch shows the real color of the text (not a
// static default). Re-evaluates on `selectionchange` and after the caret
// moves between spans with different inline `color` styles. Idle / no
// editable selection → returns the last value.
function useNoteForeColor(active) {
  const [color, setColor] = useState('#f5f5f6');
  useEffect(() => {
    if (!active) return;
    let raf = null;
    const update = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        const sel = window.getSelection?.();
        if (!sel || sel.rangeCount === 0) return;
        let node = sel.getRangeAt(0).startContainer;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        if (!node || !node.closest?.('.note-body')) return;
        try {
          const hex = rgbToHex(window.getComputedStyle(node).color);
          if (hex) setColor(prev => (prev === hex ? prev : hex));
        } catch (_) {}
      });
    };
    document.addEventListener('selectionchange', update);
    update();
    return () => {
      document.removeEventListener('selectionchange', update);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active]);
  return color;
}

// Active inline-format state at the caret/selection, so the note toolbar can
// reflect what's already applied (bold/italic/etc. highlighted, current font
// size shown). Mirrors useNoteForeColor: subscribes to selectionchange while
// the note is being edited, rAF-debounced. Uses queryCommandState because the
// note editor formats via execCommand.
const EMPTY_FMT = { bold: false, italic: false, underline: false, strike: false, listType: null, fontSize: null, align: null };
function useNoteFormatState(active) {
  const [state, setState] = useState(EMPTY_FMT);
  useEffect(() => {
    if (!active) { setState(EMPTY_FMT); return; }
    let raf = null;
    const update = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        const sel = window.getSelection?.();
        if (!sel || sel.rangeCount === 0) return;
        let node = sel.getRangeAt(0).startContainer;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        if (!node || !node.closest?.('.note-body')) return;
        let bold = false, italic = false, underline = false, strike = false;
        let align = null;
        try {
          bold = document.queryCommandState('bold');
          italic = document.queryCommandState('italic');
          underline = document.queryCommandState('underline');
          strike = document.queryCommandState('strikeThrough');
          if (document.queryCommandState('justifyCenter')) align = 'center';
          else if (document.queryCommandState('justifyRight')) align = 'right';
          else if (document.queryCommandState('justifyLeft')) align = 'left';
        } catch (_) {}
        let listType = null;
        const li = node.closest?.('li');
        if (li) {
          const list = li.parentElement;
          if (list?.tagName === 'UL') listType = list.classList.contains('note-checklist') ? 'task' : 'ul';
          else if (list?.tagName === 'OL') listType = 'ol';
        }
        let fontSize = null;
        try { const fs = parseFloat(window.getComputedStyle(node).fontSize); if (fs) fontSize = Math.round(fs); } catch (_) {}
        setState(prev => (
          prev.bold === bold && prev.italic === italic && prev.underline === underline &&
          prev.strike === strike && prev.listType === listType && prev.fontSize === fontSize && prev.align === align
            ? prev
            : { bold, italic, underline, strike, listType, fontSize, align }
        ));
      });
    };
    document.addEventListener('selectionchange', update);
    update();
    return () => {
      document.removeEventListener('selectionchange', update);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active]);
  return state;
}

export function ToolOptionsBar({
  selectedTool,
  drawOptions, setDrawOptions,
  shapeOptions, setShapeOptions,
  arrowOptions, setArrowOptions,
  editingNoteCard,
  onUpdateEditingNote,
  editingShapeCard,
  onUpdateEditingShape,
  editingLineArrow,       // { idx, arrow } when a single line-arrow is selected
  onUpdateEditingLineArrow, // (patch) => updates that arrow
  paletteColors = [],
  openColorPicker,
  onOpenSketchpad,      // launch the fullscreen sketch pad from inside Draw tool
  onUndo,               // global Yjs undo — surfaced as a toolbar button on Draw
}) {
  const recentColors = useRecentColors();
  const openPickerAt = (e, opts) => {
    if (!openColorPicker) return;
    const r = e.currentTarget.getBoundingClientRect();
    openColorPicker({
      ...opts,
      x: r.left + r.width / 2,
      y: r.top,
      paletteColors,
    });
  };

  // Always render at the canvas bottom-center (CSS default in `.tob`).
  // Earlier the bar floated above the selected card; that constant
  // repositioning made the UI feel jumpy, so the bar stays put and any
  // contextual buttons swap in inline.
  const tobProps = { className: 'tob' };

  // ── Note rich text bar ──────────────────────────────────────────────────
  if (editingNoteCard) {
    return <NoteRichTextBar
      tobProps={tobProps}
      paletteColors={paletteColors}
      openPickerAt={openPickerAt}
      editingNoteCard={editingNoteCard}
      onUpdateEditingNote={onUpdateEditingNote}
    />;
  }

  // ── Drawing options ──────────────────────────────────────────────────────
  if (selectedTool === 'draw') {
    const allColors = [...new Set([...recentColors, ...paletteColors, ...STROKE_COLORS])];
    const isEraser = drawOptions.mode === 'eraser';
    return (
      <div {...tobProps} onPointerDown={(e) => e.stopPropagation()}>
        {onUndo && (
          <>
            <button className="tob-action tob-icon-btn"
                    title="Undo last stroke (⌘Z)"
                    aria-label="Undo"
                    onClick={onUndo}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 7 L1 4 L4 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M1 4 H10 C12.7614 4 15 6.23858 15 9 C15 11.7614 12.7614 14 10 14 H7"
                      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
              </svg>
            </button>
            <span className="tob-sep" />
          </>
        )}
        <span className="tob-label">Brush</span>
        <div className="tob-segmented">
          <button aria-label="Pen"
                  className={!isEraser ? 'is-active' : ''}
                  onClick={() => setDrawOptions({ ...drawOptions, mode: 'pen' })}>Pen</button>
          <button aria-label="Eraser"
                  className={isEraser ? 'is-active' : ''}
                  onClick={() => setDrawOptions({ ...drawOptions, mode: 'eraser' })}>Eraser</button>
        </div>
        {!isEraser && (
          <>
            <span className="tob-sep" />
            <span className="tob-label">Color</span>
            <div className="tob-swatches">
              {allColors.slice(0, 12).map(c => (
                <button key={c}
                        className={`tob-sw ${drawOptions.color === c ? 'is-active' : ''}`}
                        style={{ background: c }}
                        onClick={() => { setDrawOptions({ ...drawOptions, color: c }); addRecentColor(c); }} />
              ))}
              <button className="tob-sw tob-sw-custom" title="Custom hex…"
                      onClick={(e) => openPickerAt(e, {
                        value: drawOptions.color,
                        onChange: (col) => {
                          setDrawOptions({ ...drawOptions, color: col });
                          // Track the picked color in recents so the
                          // strip updates as the user explores hexes.
                          addRecentColor(col);
                        },
                      })}>+</button>
            </div>
          </>
        )}
        <span className="tob-sep" />
        <div className="tob-thickness">
          {DRAW_THICKNESS.map(w => (
            <button key={w}
                    title={isEraser ? `Eraser size ${w}px` : `Stroke ${w}px`}
                    className={`tob-thick ${(isEraser ? drawOptions.eraserWidth : drawOptions.width) === w ? 'is-active' : ''}`}
                    onClick={() => setDrawOptions(isEraser ? { ...drawOptions, eraserWidth: w } : { ...drawOptions, width: w })}>
              <span style={{ width: 24, height: w, background: isEraser ? '#ef4444' : drawOptions.color, borderRadius: w/2, display: 'block' }} />
            </button>
          ))}
        </div>
        {onOpenSketchpad && (
          <>
            <span className="tob-sep" />
            <button className="tob-action"
                    title="Open a fullscreen drawing canvas"
                    onClick={onOpenSketchpad}>
              <svg width="14" height="14" viewBox="0 0 20 20" style={{ marginRight: 6, verticalAlign: '-2px' }}>
                <rect x="3" y="3" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                <path d="M6 13 Q9 8 13 11 Q15 12 14 14" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
              </svg>
              Canvas
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Line-arrow options ──────────────────────────────────────────────────
  // A "line" is an arrow with head='none' created via the Shape tool's
  // Line option (see CanvasSurface.jsx). When one is selected, surface
  // color / width / dash AND a precise angle input here.
  if (editingLineArrow && onUpdateEditingLineArrow) {
    const a = editingLineArrow.arrow;
    const stroke = a.customStroke || '#f5f5f6';
    const strokeWidth = (typeof a.customStrokeWidth === 'number') ? a.customStrokeWidth : 2;
    const dash = a.customDash || 'solid';
    // Geometry helpers.
    const fx = a.from?.x ?? 0, fy = a.from?.y ?? 0;
    const tx = a.to?.x   ?? 0, ty = a.to?.y   ?? 0;
    const length = Math.hypot(tx - fx, ty - fy);
    // Angle in screen degrees: 0° = horizontal right, 90° = down,
    // -90° = up. Display normalized to [0, 360) so the user types a
    // familiar number like "92".
    const rawAng = Math.atan2(ty - fy, tx - fx) * 180 / Math.PI;
    const currentAngle = ((rawAng % 360) + 360) % 360;
    const setAngle = (degRaw) => {
      const deg = Number(degRaw);
      if (!Number.isFinite(deg)) return;
      const rad = deg * Math.PI / 180;
      const len = length || 1;
      const newTo = {
        x: Math.round(fx + Math.cos(rad) * len),
        y: Math.round(fy + Math.sin(rad) * len),
      };
      onUpdateEditingLineArrow({ to: newTo });
    };
    return (
      <div {...tobProps} onPointerDown={(e) => e.stopPropagation()}>
        <span className="tob-label">Line</span>
        <span className="tob-sep" />
        <span className="tob-label">Color</span>
        <div className="tob-swatches">
          {[...new Set([...recentColors, ...paletteColors, ...STROKE_COLORS])].slice(0, 8).map(c => (
            <button key={c} className={`tob-sw ${stroke === c ? 'is-active' : ''}`}
                    style={{ background: c }}
                    onClick={() => { onUpdateEditingLineArrow({ customStroke: c }); addRecentColor(c); }} />
          ))}
          <button className="tob-sw tob-sw-custom" title="Custom hex…"
                  onClick={(e) => openPickerAt(e, {
                    value: stroke,
                    onChange: (col) => onUpdateEditingLineArrow({ customStroke: col }),
                  })}>+</button>
        </div>
        <span className="tob-sep" />
        <span className="tob-label">Width</span>
        <LinePxInput
          value={strokeWidth}
          onCommit={(n) => onUpdateEditingLineArrow({ customStrokeWidth: n })}
        />
        <span className="tob-label" style={{ marginLeft: -4 }}>px</span>
        <span className="tob-sep" />
        <span className="tob-label">Style</span>
        <select className="tob-select" value={dash}
                onChange={(e) => {
                  const v = e.target.value;
                  onUpdateEditingLineArrow({ customDash: v === 'solid' ? null : v });
                }}>
          {DASH_STYLES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <span className="tob-sep" />
        <span className="tob-label">Angle</span>
        <LineAngleInput angle={currentAngle} onCommit={setAngle} />
        <span className="tob-label" style={{ marginLeft: -4 }}>°</span>
      </div>
    );
  }

  // ── Shape options ───────────────────────────────────────────────────────
  // The same panel serves two cases:
  //   - shape tool active (creating)        → reads/writes shapeOptions
  //   - one shape card selected (editing)   → reads/writes the card's fields
  // For the second case, color picks DO go to recents (the shape exists).
  if (selectedTool === 'shape' || editingShapeCard) {
    const editing = !!editingShapeCard;
    const opts = editing
      ? {
          shape: editingShapeCard.shape || 'rect',
          stroke: editingShapeCard.stroke || '#f5f5f6',
          fill: editingShapeCard.fill || 'transparent',
          strokeWidth: editingShapeCard.strokeWidth || 2,
          dash: editingShapeCard.dash || 'solid',
        }
      : shapeOptions;
    const setOpts = (next) => {
      if (editing) {
        // Diff against current to send a minimal patch.
        const patch = {};
        for (const k of Object.keys(next)) if (next[k] !== opts[k]) patch[k] = next[k];
        if (Object.keys(patch).length) onUpdateEditingShape?.(patch);
      } else {
        setShapeOptions(next);
      }
    };
    const strokeChoices = [...new Set([...recentColors, ...paletteColors, ...STROKE_COLORS])];
    const fillChoices   = ['transparent', ...new Set([...recentColors, ...paletteColors, ...FILL_COLORS.filter(c => c !== 'transparent')])];
    return (
      <div {...tobProps} onPointerDown={(e) => e.stopPropagation()}>
        <span className="tob-label">Shape</span>
        <select className="tob-select" value={opts.shape}
                onChange={(e) => setOpts({ ...opts, shape: e.target.value })}>
          {SHAPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className="tob-sep" />
        <span className="tob-label">Stroke</span>
        <div className="tob-swatches">
          {strokeChoices.slice(0, 12).map(c => (
            <button key={c} className={`tob-sw ${opts.stroke === c ? 'is-active' : ''}`}
                    style={{ background: c }}
                    onClick={() => { setOpts({ ...opts, stroke: c }); if (editing) addRecentColor(c); }} />
          ))}
          <button className="tob-sw tob-sw-custom" title="Custom hex…"
                  onClick={(e) => openPickerAt(e, {
                    value: opts.stroke,
                    onChange: (col) => setOpts({ ...opts, stroke: col }),
                    disableRecent: !editing,
                  })}>+</button>
        </div>
        <span className="tob-sep" />
        <span className="tob-label">Fill</span>
        <div className="tob-swatches">
          {fillChoices.slice(0, 12).map(c => (
            <button key={c} className={`tob-sw ${opts.fill === c ? 'is-active' : ''}`}
                    style={{ background: c === 'transparent' ? 'repeating-linear-gradient(45deg,#222 0 4px,#444 4px 8px)' : c }}
                    onClick={() => { setOpts({ ...opts, fill: c }); if (editing && c !== 'transparent') addRecentColor(c); }} />
          ))}
          <button className="tob-sw tob-sw-custom" title="Custom hex…"
                  onClick={(e) => openPickerAt(e, {
                    value: opts.fill === 'transparent' ? '#1c1c1f' : opts.fill,
                    onChange: (col) => setOpts({ ...opts, fill: col }),
                    allowTransparent: true,
                    disableRecent: !editing,
                  })}>+</button>
        </div>
        <span className="tob-sep" />
        <span className="tob-label">Width</span>
        <LinePxInput
          value={opts.strokeWidth ?? 2}
          onCommit={(n) => setOpts({ ...opts, strokeWidth: n })}
        />
        <span className="tob-label" style={{ marginLeft: -4 }}>px</span>
        <span className="tob-sep" />
        <span className="tob-label">Style</span>
        <select className="tob-select" value={opts.dash}
                onChange={(e) => setOpts({ ...opts, dash: e.target.value })}>
          {DASH_STYLES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </div>
    );
  }

  // ── Arrow options ───────────────────────────────────────────────────────
  if (selectedTool === 'arrow' && arrowOptions && setArrowOptions) {
    return (
      <div {...tobProps} onPointerDown={(e) => e.stopPropagation()}>
        <span className="tob-label">Path</span>
        <div className="tob-segmented">
          <button className={!arrowOptions.straight ? 'is-active' : ''}
                  onClick={() => setArrowOptions({ ...arrowOptions, straight: false })}>Curved</button>
          <button className={arrowOptions.straight ? 'is-active' : ''}
                  onClick={() => setArrowOptions({ ...arrowOptions, straight: true })}>Straight</button>
        </div>
        <span className="tob-sep" />
        <span className="tob-label">Style</span>
        <div className="tob-segmented">
          <button className={!arrowOptions.dashed ? 'is-active' : ''}
                  onClick={() => setArrowOptions({ ...arrowOptions, dashed: false })}>Solid</button>
          <button className={arrowOptions.dashed ? 'is-active' : ''}
                  onClick={() => setArrowOptions({ ...arrowOptions, dashed: true })}>Dashed</button>
        </div>
      </div>
    );
  }

  return null;
}

// Split out so we can call the `useNoteForeColor` hook (which subscribes to
// selectionchange while the note is being edited). Keeping it inside the
// main ToolOptionsBar function would mean the hook runs in every render of
// every tool's bar.
function NoteRichTextBar({ tobProps, paletteColors, openPickerAt, editingNoteCard, onUpdateEditingNote }) {
  const currentFore = useNoteForeColor(true);
  const fmt = useNoteFormatState(true);
  return (
    <div {...tobProps}
         onPointerDown={(e) => e.stopPropagation()}>
      <FontPicker />
      <SizePicker value={fmt.fontSize} />
      <span className="tob-sep" />
      <FormatBtn label="B" title="Bold (⌘B)" cmd="bold" bold active={fmt.bold} />
      <FormatBtn label={<i>I</i>} title="Italic (⌘I)" cmd="italic" active={fmt.italic} />
      <FormatBtn label={<u>U</u>} title="Underline (⌘U)" cmd="underline" active={fmt.underline} />
      <FormatBtn label={<s>S</s>} title="Strike" cmd="strikeThrough" active={fmt.strike} />
      <span className="tob-sep" />
      <ListBtn label="•"  title="Bulleted list" type="ul"   active={fmt.listType === 'ul'} />
      <ListBtn label="1." title="Numbered list" type="ol"   active={fmt.listType === 'ol'} />
      <ListBtn label="☐"  title="Checklist"     type="task" active={fmt.listType === 'task'} />
      <span className="tob-sep" />
      <FormatBtn label="⇤" title="Align left"   cmd="justifyLeft"   active={fmt.align === 'left'} />
      <FormatBtn label="≡" title="Align center" cmd="justifyCenter" active={fmt.align === 'center'} />
      <FormatBtn label="⇥" title="Align right"  cmd="justifyRight"  active={fmt.align === 'right'} />
      <span className="tob-sep" />
      <ColorBtn title="Text color" glyph="A" defaultColor={currentFore}
                swatches={TEXT_COLORS}
                paletteColors={paletteColors}
                onPick={(c) => applyStyle({ color: c })}
                onCustom={(e) => openPickerAt(e, {
                  value: currentFore,
                  onChange: (c) => applyStyle({ color: c }),
                })} />
      <ColorBtn title="Card background" defaultColor={editingNoteCard?.bgColor || '#1c1c1f'}
                swatches={BG_COLORS}
                paletteColors={paletteColors}
                onPick={(c) => onUpdateEditingNote && onUpdateEditingNote({ bgColor: c })}
                onCustom={(e) => openPickerAt(e, {
                  value: editingNoteCard?.bgColor || '#1c1c1f',
                  onChange: (c) => onUpdateEditingNote && onUpdateEditingNote({ bgColor: c }),
                })} />
    </div>
  );
}

// ── Format buttons ────────────────────────────────────────────────────────

// Display-helper: format an angle without a trailing ".0" — show
// the integer when the value rounds clean, otherwise one decimal.
function formatAngleForDisplay(n) {
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return String(Math.round(rounded));
  return rounded.toFixed(1);
}

// Decoupled text-style angle input so the user can type partial /
// decimal values without React rewriting the field on every keystroke.
// Only commits on blur or Enter; type=text + inputMode=decimal so
// no browser spinner arrows.
function LineAngleInput({ angle, onCommit }) {
  const [draft, setDraft] = useState(() => formatAngleForDisplay(angle));
  const [editing, setEditing] = useState(false);
  // Sync with external angle changes (e.g. user drags an endpoint)
  // only when the input isn't currently being edited.
  useEffect(() => {
    if (!editing) setDraft(formatAngleForDisplay(angle));
  }, [angle, editing]);
  const commit = () => {
    setEditing(false);
    const n = parseFloat(draft);
    if (Number.isFinite(n)) {
      onCommit(n);
      setDraft(formatAngleForDisplay(n));
    } else {
      setDraft(formatAngleForDisplay(angle));
    }
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className="tob-numinput tob-angle-input"
      value={draft}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onChange={(e) => { const v = e.target.value; if (v === '' || /^-?\d*\.?\d*$/.test(v)) setDraft(v); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.stopPropagation(); setDraft(formatAngleForDisplay(angle)); setEditing(false); e.currentTarget.blur(); }
      }}
      style={{ width: 56, textAlign: 'right' }}
      title="Line angle in degrees (0 = horizontal right, 90 = straight down)"
    />
  );
}

// Free-form pixel input for line stroke width. Same UX shape as
// LineAngleInput — no spinner arrows, no forced decimal display,
// commits on blur or Enter. Clamps to >= 0 (0 means "no line").
function LinePxInput({ value, onCommit }) {
  const [draft, setDraft] = useState(() => formatAngleForDisplay(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(formatAngleForDisplay(value));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const n = parseFloat(draft);
    if (Number.isFinite(n) && n >= 0) {
      const clamped = Math.min(200, n);
      onCommit(clamped);
      setDraft(formatAngleForDisplay(clamped));
    } else {
      setDraft(formatAngleForDisplay(value));
    }
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className="tob-numinput tob-px-input"
      value={draft}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setDraft(v); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.stopPropagation(); setDraft(formatAngleForDisplay(value)); setEditing(false); e.currentTarget.blur(); }
      }}
      style={{ width: 56, textAlign: 'right' }}
      title="Line width in pixels (0 = none)"
    />
  );
}

function FormatBtn({ label, title, cmd, val, bold, active = false }) {
  return (
    <button className={`tob-btn ${active ? 'is-active' : ''}`.trim()}
            title={title}
            aria-pressed={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execCmd(cmd, val)}
            style={bold ? { fontWeight: 700 } : undefined}>
      {label}
    </button>
  );
}

function ListBtn({ label, title, type, active = false }) {
  return (
    <button className={`tob-btn ${active ? 'is-active' : ''}`.trim()}
            title={title}
            aria-pressed={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => withSelection(() => toggleList(type))}>
      {label}
    </button>
  );
}

function FontPicker() {
  const customFonts = useCustomFonts();
  const recentFonts = useRecentFonts();
  const allFonts = combineAllFonts(FONTS, customFonts);
  const [open, setOpen] = useState(false);

  // Preview-on-hover support. To keep the DOM clean across many hovers we
  // snapshot the editable's innerHTML on first hover and restore that
  // baseline before each subsequent preview. The innerHTML reset destroys
  // the DOM nodes the user's selection Range points at, so we also
  // capture the selection as character offsets within the editable and
  // re-establish it from those offsets after every reset. Refs (not
  // closure vars) so the snapshot survives re-renders of FontPicker.
  const snapshotRef = useRef(null);
  const snapshotRootRef = useRef(null);
  const offsetsRef = useRef(null);

  function takeSnapshot() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    let node = r.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    const editable = node.closest && node.closest('[contenteditable="true"]');
    if (!editable) return;
    snapshotRootRef.current = editable;
    snapshotRef.current = editable.innerHTML;
    offsetsRef.current = captureSelectionOffsets(editable);
  }
  function clearSnapshot() {
    snapshotRef.current = null;
    snapshotRootRef.current = null;
    offsetsRef.current = null;
  }
  function restoreSnapshot() {
    const root = snapshotRootRef.current;
    if (snapshotRef.current != null && root && document.contains(root)) {
      root.innerHTML = snapshotRef.current;
    }
    clearSnapshot();
  }
  // Reset innerHTML to the snapshot AND re-establish the saved selection
  // (the Range stored in editorSelection.js's savedRange is now stale
  // because its nodes were destroyed — captureSelection() after the
  // offset-based restore refreshes it so applyStyle()'s withSelection
  // wrapper finds a live Range).
  function resetToSnapshotAndSelection() {
    const root = snapshotRootRef.current;
    if (snapshotRef.current == null || !root || !document.contains(root)) return false;
    root.innerHTML = snapshotRef.current;
    const off = offsetsRef.current;
    if (off && restoreSelectionFromOffsets(root, off.start, off.end)) {
      captureSelection();
      return true;
    }
    return false;
  }
  const handlePreview = (css) => {
    if (css == null) { restoreSnapshot(); return; }
    if (snapshotRef.current == null) takeSnapshot();
    else resetToSnapshotAndSelection();
    applyStyle({ fontFamily: css });
  };
  const handleCommit = (entry) => {
    if (entry?.gfName) ensureGoogleFontLoaded(entry.gfName);
    if (snapshotRef.current != null) resetToSnapshotAndSelection();
    applyStyle({ fontFamily: entry.css });
    clearSnapshot();
    if (entry?.label || entry?.name) {
      addRecentFont({ name: entry.label || entry.name, css: entry.css, gfName: entry.gfName || null });
    }
  };

  return (
    <>
      <FontPickerDropdown
        currentLabel="Font"
        recentFonts={recentFonts}
        allFonts={allFonts}
        onPreview={handlePreview}
        onCommit={handleCommit}
        onCancel={() => restoreSnapshot()}
        onManage={() => setOpen(true)}
      />
      <CustomFontsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SizePicker({ value = null }) {
  // Editable combobox: reflects the caret's current size, lets the user type
  // an exact px value, or pick a preset from the dropdown. The note apply path
  // (wrapSelectionStyle) already accepts arbitrary px, so any typed size works.
  return (
    <SizeInput
      value={value}
      presets={SIZES}
      className="tob-size-combo"
      onCommit={(px) => applyStyle({ fontSize: px + 'px' })}
    />
  );
}

function ColorBtn({ title, swatches, paletteColors = [], defaultColor, onPick, onCustom, glyph = null }) {
  const [open, setOpen] = useState(false);
  const [popStyle, setPopStyle] = useState(null);
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const recentColors = useRecentColors();
  const allSwatches = [...new Set([...recentColors, ...paletteColors, ...swatches])];

  // Position the swatch popover relative to its trigger, clamped to the
  // viewport so it never clips on the right/top edges of the screen.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !popRef.current) return;
    const place = () => {
      const wrap = wrapRef.current;
      const pop = popRef.current;
      if (!wrap || !pop) return;
      const wr = wrap.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const PAD = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const leftAbs = Math.max(PAD, Math.min(vw - w - PAD, wr.left));
      const preferTopAbs = wr.top - h - 6;
      const topAbs = preferTopAbs < PAD
        ? Math.min(vh - h - PAD, wr.bottom + 6)
        : preferTopAbs;
      const topClamped = Math.max(PAD, topAbs);
      setPopStyle(prev => {
        if (prev && prev.left === leftAbs && prev.top === topClamped) return prev;
        return {
          position: 'fixed',
          left: leftAbs,
          top: topClamped,
          bottom: 'auto',
          right: 'auto',
        };
      });
    };
    place();
    const id = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, allSwatches.length]);

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (wrapRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);

  // The bottom bar (.tob) has a translateX transform, which establishes a
  // containing block for position:fixed descendants. Portal to body so the
  // popover is anchored to the viewport instead of the (transformed) bar.
  const popNode = open && (
    <span className="tob-pop" ref={popRef}
          style={popStyle || { position: 'fixed', visibility: 'hidden' }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}>
      {allSwatches.slice(0, 16).map(c => (
        <button key={c} className="tob-sw" style={{ background: c }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(c); addRecentColor(c); setOpen(false); }} />
      ))}
      {onCustom && (
        <button className="tob-sw tob-sw-custom" title="Custom…"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { setOpen(false); onCustom(e); }}>+</button>
      )}
    </span>
  );

  return (
    <span className="tob-pop-wrap" ref={wrapRef}>
      <button className={`tob-btn ${glyph ? 'tob-color-btn' : ''}`} title={title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(o => !o)}>
        {glyph ? (
          <span className="tob-color-stack">
            <span className="tob-color-glyph">{glyph}</span>
            <span className="tob-color-bar" style={{ background: defaultColor }} />
          </span>
        ) : (
          <span className="tob-sw-dot" style={{ background: defaultColor }} />
        )}
      </button>
      {popNode && typeof document !== 'undefined'
        ? createPortal(popNode, document.body)
        : popNode}
    </span>
  );
}
