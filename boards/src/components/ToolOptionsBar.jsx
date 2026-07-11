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
import { getActiveNoteEditor, subscribeActiveNoteEditor } from '../lib/noteEditorRegistry.js';

// Subscribe to the active collaborative-note Tiptap editor (set by
// NoteTiptapSurface while a note is being edited). When present, the note
// toolbar drives it with Tiptap commands instead of execCommand; when null,
// the legacy contenteditable note editor is active and the execCommand paths
// below run unchanged.
function useActiveNoteEditor() {
  const [editor, setEditor] = useState(() => getActiveNoteEditor());
  useEffect(() => subscribeActiveNoteEditor(setEditor), []);
  return editor;
}

const STROKE_COLORS = ['#f5f5f6', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const FILL_COLORS  = ['transparent', '#1c1c1f', '#fef3c7', '#fee2e2', '#dcfce7', '#dbeafe', '#f3e8ff', '#0a0a0c'];
const TEXT_COLORS  = ['#f5f5f6', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const BG_COLORS    = ['transparent', '#1c1c1f', '#fef3c7', '#fee2e2', '#dcfce7', '#dbeafe', '#f3e8ff', '#fde68a', '#ffffff'];
// Checkerboard stand-in for the 'transparent' swatch — same pattern the
// shape fill strip uses, so "no background" reads consistently everywhere.
const TRANSPARENT_SWATCH_BG = 'repeating-linear-gradient(45deg,#222 0 4px,#444 4px 8px)';
const swatchBg = (c) => (c === 'transparent' ? TRANSPARENT_SWATCH_BG : c);
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
//
// Every apply path dispatches FMT_EVT so the toolbar-state hooks re-sample
// immediately. `selectionchange` alone is not enough: applying a style can
// leave the range boundaries untouched (no selectionchange fires) while the
// computed styles under it changed — the bar then showed stale state until
// the next caret move ("what displays on the toolbar isn't always accurate").
const FMT_EVT = 'soleil-note-format-applied';
const notifyFormatChanged = () => { try { document.dispatchEvent(new Event(FMT_EVT)); } catch (_) {} };

function execCmd(cmd, val = null) {
  const editor = getActiveNoteEditor();
  if (editor) {
    const align = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right' }[cmd];
    if (align) editor.chain().focus().setTextAlign(align).run();
    notifyFormatChanged();
    return;
  }
  withSelection(() => {
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    document.execCommand(cmd, false, val);
  });
  notifyFormatChanged();
}

// Set horizontal alignment on EVERY block of the note (not just the caret's
// block), then restore the caret — used by the one-click "balance" button so a
// multi-paragraph note centers as a whole.
function setAlignAllBlocks(align) {
  const editor = getActiveNoteEditor();
  if (editor) {
    const caret = editor.state.selection.to;
    editor.chain().focus().selectAll().setTextAlign(align).setTextSelection(caret).run();
    notifyFormatChanged();
    return;
  }
  execCmd(align === 'center' ? 'justifyCenter' : 'justifyLeft');
}

// Deterministic B/I/U/S toggles. execCommand picks the toggle DIRECTION from
// the browser's own reading of the selection, which on a MIXED selection is
// sampled at the range start — it can disagree with the lit button the user
// just read. Clicking "unbold" could then re-bold the whole selection. Pass
// the user's intent (the inverse of the lit state) and re-run once if the
// post-state disagrees — idempotent in both directions.
function execToggle(cmd, wantOn) {
  const editor = getActiveNoteEditor();
  if (editor) {
    const fn = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', strikeThrough: 'toggleStrike' }[cmd];
    if (fn) editor.chain().focus()[fn]().run();
    notifyFormatChanged();
    return;
  }
  withSelection(() => {
    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    document.execCommand(cmd);
    try {
      if (document.queryCommandState(cmd) !== wantOn) document.execCommand(cmd);
    } catch (_) { /* leave the single-toggle result */ }
  });
  notifyFormatChanged();
}

// Apply an inline style object ({ color | fontFamily | fontSize }) to the
// active note Tiptap editor's selection via the matching mark command.
function applyEditorStyle(editor, style) {
  const chain = editor.chain().focus();
  if (style.color) chain.setColor(style.color);
  if (style.fontFamily) chain.setFontFamily(style.fontFamily);
  if (style.fontSize) chain.setFontSize(style.fontSize);
  chain.run();
}

// Toggle a list on the active editor (Tiptap) or the legacy contenteditable.
function applyToggleList(type) {
  const editor = getActiveNoteEditor();
  if (editor) {
    const c = editor.chain().focus();
    if (type === 'ul') c.toggleBulletList();
    else if (type === 'ol') c.toggleOrderedList();
    else if (type === 'task') c.toggleList('noteChecklist', 'noteChecklistItem');
    c.run();
    notifyFormatChanged();
    return;
  }
  withSelection(() => toggleList(type));
  notifyFormatChanged();
}

function applyStyle(style) {
  const editor = getActiveNoteEditor();
  if (editor) {
    applyEditorStyle(editor, style);
    notifyFormatChanged();
    return;
  }
  withSelection(() => wrapSelectionStyle(style));
  notifyFormatChanged();
}

// Selection → style the selection; collapsed caret → apply to the WHOLE note
// via its card-level props (the fallback callback). wrapSelectionStyle bails
// on collapsed ranges, so size/font/color picks with nothing selected used
// to silently do nothing while the input still displayed the typed value.
// The note-level default deliberately does NOT override existing inline
// spans — predictable contract: "selection styles selection; no selection
// sets the note's base".
function applyStyleOrNoteDefault(style, applyNoteDefault) {
  const editor = getActiveNoteEditor();
  if (editor) {
    // Selection → style the selection (inline mark); collapsed caret → set the
    // whole-note base via the card-level prop. Same contract as the legacy path.
    if (!editor.state.selection.empty) applyEditorStyle(editor, style);
    else applyNoteDefault?.();
    notifyFormatChanged();
    return;
  }
  let styledSelection = false;
  const restored = withSelection(() => {
    const sel = window.getSelection?.();
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (r && !r.collapsed) { wrapSelectionStyle(style); styledSelection = true; }
  });
  if (restored && !styledSelection) applyNoteDefault?.();
  notifyFormatChanged();
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
// Resolve the element whose computed style represents the range start.
// `startContainer` is often an ELEMENT right after wrapSelectionStyle
// reselects via setStartBefore(span) — reading the PARENT's computed style
// there showed the pre-apply value (the size box displayed the old size
// right after applying a new one). Descend to the child the range actually
// starts at before walking up from a text node.
function styleNodeAtRangeStart(range) {
  let node = range.startContainer;
  if (node && node.nodeType === Node.ELEMENT_NODE && node.childNodes.length) {
    node = node.childNodes[Math.min(range.startOffset, node.childNodes.length - 1)] || node;
  }
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  return node;
}

function useNoteForeColor(active) {
  const [color, setColor] = useState('#f5f5f6');
  const editor = useActiveNoteEditor();
  useEffect(() => {
    if (!active) return undefined;
    // Collaborative editor: read the inline color mark at the caret.
    if (editor) {
      const update = () => {
        const c = editor.getAttributes('textStyle')?.color;
        const hex = c ? (rgbToHex(c) || c) : null;
        if (hex) setColor(prev => (prev === hex ? prev : hex));
      };
      update();
      editor.on('selectionUpdate', update);
      editor.on('transaction', update);
      return () => { editor.off('selectionUpdate', update); editor.off('transaction', update); };
    }
    // Legacy contenteditable: read the computed color at the caret.
    let raf = null;
    const update = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        const sel = window.getSelection?.();
        if (!sel || sel.rangeCount === 0) return;
        const node = styleNodeAtRangeStart(sel.getRangeAt(0));
        if (!node || !node.closest?.('.note-body')) return;
        try {
          const hex = rgbToHex(window.getComputedStyle(node).color);
          if (hex) setColor(prev => (prev === hex ? prev : hex));
        } catch (_) {}
      });
    };
    document.addEventListener('selectionchange', update);
    document.addEventListener(FMT_EVT, update);
    update();
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener(FMT_EVT, update);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, editor]);
  return color;
}

// Active inline-format state at the caret/selection, so the note toolbar can
// reflect what's already applied (bold/italic/etc. highlighted, current font
// size shown). Mirrors useNoteForeColor: subscribes to selectionchange while
// the note is being edited, rAF-debounced. Uses queryCommandState because the
// note editor formats via execCommand.
const EMPTY_FMT = { bold: false, italic: false, underline: false, strike: false, listType: null, fontSize: null, fontFamily: null, align: null };
function useNoteFormatState(active) {
  const [state, setState] = useState(EMPTY_FMT);
  const editor = useActiveNoteEditor();
  useEffect(() => {
    if (!active) { setState(EMPTY_FMT); return undefined; }
    // Collaborative editor: derive the active state from Tiptap.
    if (editor) {
      const update = () => {
        const ts = editor.getAttributes('textStyle') || {};
        const align = ['left', 'center', 'right'].find(a => editor.isActive({ textAlign: a })) || null;
        let listType = null;
        if (editor.isActive('noteChecklist')) listType = 'task';
        else if (editor.isActive('bulletList')) listType = 'ul';
        else if (editor.isActive('orderedList')) listType = 'ol';
        const fontSize = ts.fontSize ? Math.round(parseFloat(ts.fontSize)) || null : null;
        const fontFamily = ts.fontFamily
          ? ts.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '') : null;
        const next = {
          bold: editor.isActive('bold'),
          italic: editor.isActive('italic'),
          underline: editor.isActive('underline'),
          strike: editor.isActive('strike'),
          listType, fontSize, fontFamily, align,
        };
        setState(prev => (
          prev.bold === next.bold && prev.italic === next.italic && prev.underline === next.underline &&
          prev.strike === next.strike && prev.listType === next.listType && prev.fontSize === next.fontSize &&
          prev.fontFamily === next.fontFamily && prev.align === next.align ? prev : next
        ));
      };
      update();
      editor.on('selectionUpdate', update);
      editor.on('transaction', update);
      return () => { editor.off('selectionUpdate', update); editor.off('transaction', update); };
    }
    let raf = null;
    const update = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        const sel = window.getSelection?.();
        if (!sel || sel.rangeCount === 0) return;
        const node = styleNodeAtRangeStart(sel.getRangeAt(0));
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
        let fontSize = null, fontFamily = null;
        try {
          const cs = window.getComputedStyle(node);
          const fs = parseFloat(cs.fontSize);
          if (fs) fontSize = Math.round(fs);
          // First family of the computed stack, unquoted — drives the font
          // picker's trigger label so it names the font under the caret
          // instead of a static "Font".
          const fam = (cs.fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
          if (fam) fontFamily = fam;
        } catch (_) {}
        setState(prev => (
          prev.bold === bold && prev.italic === italic && prev.underline === underline &&
          prev.strike === strike && prev.listType === listType && prev.fontSize === fontSize &&
          prev.fontFamily === fontFamily && prev.align === align
            ? prev
            : { bold, italic, underline, strike, listType, fontSize, fontFamily, align }
        ));
      });
    };
    document.addEventListener('selectionchange', update);
    document.addEventListener(FMT_EVT, update);
    update();
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener(FMT_EVT, update);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, editor]);
  return state;
}

export function ToolOptionsBar({
  selectedTool,
  drawOptions, setDrawOptions,
  shapeOptions, setShapeOptions,
  arrowOptions, setArrowOptions,
  editingNoteCard,
  onUpdateEditingNote,
  editingCellText,        // a grid TEXT cell is being edited (no backing note card)
  cellPinned = false,     // that cell is "pinned" to its own frozen text style
  onCellStyle,            // (patch) => write text style: shared family, or this cell if pinned
  onCellPinToggle,        // () => pin/unpin this cell ("only this box" vs shared)
  editingCellStyle = null, // effective {…, bg} of the edited cell — seeds the bg picker
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
  // Also shown for a grid TEXT cell (editingCellText) — same inline formatting,
  // driven against the focused contenteditable. With no backing note card the
  // two card-level controls (card background, vertical balance) are hidden.
  if (editingNoteCard || editingCellText) {
    return <NoteRichTextBar
      tobProps={tobProps}
      paletteColors={paletteColors}
      openPickerAt={openPickerAt}
      editingNoteCard={editingNoteCard}
      onUpdateEditingNote={onUpdateEditingNote}
      cardLevel={!!editingNoteCard}
      cellStyleMode={!editingNoteCard && !!editingCellText}
      cellPinned={cellPinned}
      onCellStyle={onCellStyle}
      onCellPinToggle={onCellPinToggle}
      editingCellStyle={editingCellStyle}
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
              <button className="tob-sw tob-sw-custom" title="Custom hex…" aria-label="Custom color"
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
          <button className="tob-sw tob-sw-custom" title="Custom hex…" aria-label="Custom color"
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
          <button className="tob-sw tob-sw-custom" title="Custom hex…" aria-label="Custom color"
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
          <button className="tob-sw tob-sw-custom" title="Custom hex…" aria-label="Custom color"
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
function NoteRichTextBar({ tobProps, paletteColors, openPickerAt, editingNoteCard, onUpdateEditingNote, cardLevel = true, cellStyleMode = false, cellPinned = false, onCellStyle, onCellPinToggle, editingCellStyle = null }) {
  const currentFore = useNoteForeColor(true);
  const fmt = useNoteFormatState(true);
  const barRef = useRef(null);
  // Mobile: lift the bar above the soft keyboard. In mobile Safari the keyboard
  // overlays the layout viewport (visualViewport shrinks, the page doesn't), so
  // a CSS `bottom` would sit the bar UNDER the keyboard. Track visualViewport
  // and set the bar's bottom to the keyboard height + a small gap. Desktop / no
  // keyboard → kb = 0 → no-op. The Capacitor app resizes natively, which the
  // same math also handles. Re-subscribes per edit (the bar mounts when a note
  // edit begins).
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const el = barRef.current;
    if (!vv || !el) return;
    // Lift on any touch device, not just phone width — an iPad in landscape is
    // wider than 640px but still raises a soft keyboard that would cover the
    // bar. The coarse+min-width:641px CSS block makes .tob position:fixed there
    // so this bottom math is viewport-relative (phone is already fixed ≤640px).
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (!narrow && !touch) return;
    const apply = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.bottom = `calc(${Math.round(kb)}px + 8px)`;
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, []);
  return (
    <div {...tobProps}
         ref={barRef}
         onPointerDown={(e) => e.stopPropagation()}>
      <FontPicker currentLabel={fmt.fontFamily || 'Font'}
                  onApplyFont={(css) => cellStyleMode
                    ? onCellStyle?.({ fontFamily: css })
                    : applyStyleOrNoteDefault({ fontFamily: css }, () => onUpdateEditingNote && onUpdateEditingNote({ fontFamily: css }))} />
      <SizePicker value={fmt.fontSize}
                  onApply={(px) => cellStyleMode
                    ? onCellStyle?.({ fontSize: px })
                    : applyStyleOrNoteDefault({ fontSize: px + 'px' }, () => onUpdateEditingNote && onUpdateEditingNote({ fontSize: px }))} />
      <span className="tob-sep" />
      <FormatBtn label="B" title="Bold (⌘B)" cmd="bold" bold toggle active={fmt.bold} />
      <FormatBtn label={<i>I</i>} title="Italic (⌘I)" cmd="italic" toggle active={fmt.italic} />
      <FormatBtn label={<u>U</u>} title="Underline (⌘U)" cmd="underline" toggle active={fmt.underline} />
      <FormatBtn label={<s>S</s>} title="Strike" cmd="strikeThrough" toggle active={fmt.strike} />
      <span className="tob-sep" />
      <ListBtn label="•"  title="Bulleted list" type="ul"   active={fmt.listType === 'ul'} />
      <ListBtn label="1." title="Numbered list" type="ol"   active={fmt.listType === 'ol'} />
      <ListBtn label="☐"  title="Checklist"     type="task" active={fmt.listType === 'task'} />
      <span className="tob-sep" />
      {cellStyleMode ? (
        <>
          {/* Cell alignment is container-level (part of the shared/pinned text style)
              so it propagates like the font — not baked per-content via execCommand. */}
          <button type="button" className={`tob-btn ${(!fmt.align || fmt.align === 'left') ? 'is-active' : ''}`.trim()}
            title="Align left" onMouseDown={(e) => e.preventDefault()} onClick={() => onCellStyle?.({ align: 'left' })}>⇤</button>
          <button type="button" className={`tob-btn ${fmt.align === 'center' ? 'is-active' : ''}`.trim()}
            title="Align center" onMouseDown={(e) => e.preventDefault()} onClick={() => onCellStyle?.({ align: 'center' })}>≡</button>
          <button type="button" className={`tob-btn ${fmt.align === 'right' ? 'is-active' : ''}`.trim()}
            title="Align right" onMouseDown={(e) => e.preventDefault()} onClick={() => onCellStyle?.({ align: 'right' })}>⇥</button>
        </>
      ) : (
        <>
          <FormatBtn label="⇤" title="Align left"   cmd="justifyLeft"   active={fmt.align === 'left'} />
          <FormatBtn label="≡" title="Align center" cmd="justifyCenter" active={fmt.align === 'center'} />
          <FormatBtn label="⇥" title="Align right"  cmd="justifyRight"  active={fmt.align === 'right'} />
        </>
      )}
      {(cardLevel || cellStyleMode) && (() => {
        // One-click "center" — text sits DEAD-CENTER of the box, both axes. For a
        // note it's a flat card field (vAlign) through the undo-aware path; for a
        // grid cell it's part of the cell's text style (shared or pinned) applied
        // as container flex + text-align, so it propagates like the font.
        const balanced = cellStyleMode
          ? (fmt.align === 'center')
          : (fmt.align === 'center' && editingNoteCard?.vAlign === 'center');
        return (
          <button type="button"
            className={`tob-btn ${balanced ? 'is-active' : ''}`.trim()}
            title="Center — put the text dead-center of the box"
            aria-pressed={balanced}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              if (cellStyleMode) {
                onCellStyle?.(balanced ? { align: 'left', vAlign: 'top' } : { align: 'center', vAlign: 'center' });
              } else if (balanced) {
                setAlignAllBlocks('left');
                onUpdateEditingNote && onUpdateEditingNote({ vAlign: null });
              } else {
                setAlignAllBlocks('center');
                onUpdateEditingNote && onUpdateEditingNote({ vAlign: 'center' });
              }
            }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1" />
              <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        );
      })()}
      <span className="tob-sep" />
      <ColorBtn title="Text color" glyph="A" defaultColor={currentFore}
                swatches={TEXT_COLORS}
                paletteColors={paletteColors}
                onPick={(c) => cellStyleMode
                  ? onCellStyle?.({ color: c })
                  : applyStyleOrNoteDefault({ color: c }, () => onUpdateEditingNote && onUpdateEditingNote({ textColor: c }))}
                onCustom={(e) => openPickerAt(e, {
                  value: currentFore,
                  onChange: (c) => cellStyleMode
                    ? onCellStyle?.({ color: c })
                    : applyStyleOrNoteDefault({ color: c }, () => onUpdateEditingNote && onUpdateEditingNote({ textColor: c })),
                })} />
      {(cardLevel || cellStyleMode) && (
        // Card background (note) / Box background (grid cell). The cell write
        // rides the same shared-vs-pinned onCellStyle path as font/size/color;
        // the 'transparent' swatch maps to bg:null = back to the default cell
        // surface (the renderer treats null/'transparent' as unset).
        <ColorBtn title={cellStyleMode ? 'Box background' : 'Card background'}
                defaultColor={(cellStyleMode ? editingCellStyle?.bg : editingNoteCard?.bgColor) || '#1c1c1f'}
                swatches={BG_COLORS}
                paletteColors={paletteColors}
                onPick={(c) => cellStyleMode
                  ? onCellStyle?.({ bg: c === 'transparent' ? null : c })
                  : onUpdateEditingNote && onUpdateEditingNote({ bgColor: c })}
                onCustom={(e) => openPickerAt(e, {
                  // Seed the picker pad with a real hex when the current bg
                  // is transparent (the pad can't represent 'transparent';
                  // its None button emits it instead) — mirrors shape fills.
                  value: cellStyleMode
                    ? ((editingCellStyle?.bg && editingCellStyle.bg !== 'transparent') ? editingCellStyle.bg : '#1c1c1f')
                    : ((editingNoteCard?.bgColor && editingNoteCard.bgColor !== 'transparent') ? editingNoteCard.bgColor : '#1c1c1f'),
                  onChange: (c) => cellStyleMode
                    ? onCellStyle?.({ bg: c === 'transparent' ? null : c })
                    : onUpdateEditingNote && onUpdateEditingNote({ bgColor: c }),
                  allowTransparent: true,
                })} />
      )}
      {cellStyleMode && (
        <>
          <span className="tob-sep" />
          {/* Shared vs. "only this box". Default = Shared: font/size/color/align set
              the grid's shared text style, live across every un-pinned cell. Pinned
              = this box keeps its own style and ignores later shared changes. */}
          <button type="button"
            className={`tob-btn tob-pin ${cellPinned ? 'is-active' : ''}`.trim()}
            title={cellPinned
              ? 'Only this box — its style is frozen. Click to rejoin the grid’s shared style.'
              : 'Shared style — changes apply to every box. Click to style only this box.'}
            aria-pressed={cellPinned}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onCellPinToggle?.()}>
            {cellPinned ? 'This box' : 'Shared'}
          </button>
        </>
      )}
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

function FormatBtn({ label, title, cmd, val, bold, active = false, toggle = false }) {
  return (
    <button className={`tob-btn ${active ? 'is-active' : ''}`.trim()}
            title={title}
            aria-pressed={active}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => e.preventDefault()}
            // Toggle buttons (B/I/U/S) act on the state the user SAW lit, so
            // the click always inverts it; align buttons stay plain commands.
            onClick={() => (toggle ? execToggle(cmd, !active) : execCmd(cmd, val))}
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
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => applyToggleList(type)}>
      {label}
    </button>
  );
}

function FontPicker({ currentLabel = 'Font', onApplyFont = null }) {
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
    // The hover-preview uses a contenteditable innerHTML snapshot, which a
    // ProseMirror-managed note editor can't take. Skip live preview when the
    // collaborative editor is active (commit still applies the font).
    if (getActiveNoteEditor()) return;
    if (css == null) { restoreSnapshot(); return; }
    if (snapshotRef.current == null) takeSnapshot();
    else resetToSnapshotAndSelection();
    applyStyle({ fontFamily: css });
  };
  const handleCommit = (entry) => {
    if (entry?.gfName) ensureGoogleFontLoaded(entry.gfName);
    if (snapshotRef.current != null) resetToSnapshotAndSelection();
    // Caret-only commits fall back to the whole-note font (card prop) via
    // onApplyFont — picking a font with nothing selected used to no-op.
    if (onApplyFont) onApplyFont(entry.css);
    else applyStyle({ fontFamily: entry.css });
    clearSnapshot();
    if (entry?.label || entry?.name) {
      addRecentFont({ name: entry.label || entry.name, css: entry.css, gfName: entry.gfName || null });
    }
  };

  return (
    <>
      <FontPickerDropdown
        currentLabel={currentLabel}
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

function SizePicker({ value = null, onApply }) {
  // Editable combobox flanked by −/+ steppers: reflects the caret's current
  // size, steps by 1, lets the user type an exact px value, or pick a preset
  // from the dropdown. Apply goes through onApply (selection-or-whole-note
  // semantics — see applyStyleOrNoteDefault).
  const commit = (px) => onApply?.(Math.min(200, Math.max(6, Math.round(px))));
  const pd = (e) => e.preventDefault(); // keep editor focus, like FormatBtn
  return (
    <span className="tob-size-group">
      <button className="tob-btn tob-size-step" title="Decrease font size"
              aria-label="Decrease font size"
              onMouseDown={pd} onPointerDown={pd}
              onClick={() => commit((value ?? 15) - 1)}>−</button>
      <SizeInput
        value={value}
        presets={SIZES}
        className="tob-size-combo"
        dropUp
        onCommit={commit}
      />
      <button className="tob-btn tob-size-step" title="Increase font size"
              aria-label="Increase font size"
              onMouseDown={pd} onPointerDown={pd}
              onClick={() => commit((value ?? 15) + 1)}>+</button>
    </span>
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
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
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
        <button key={c} className="tob-sw" style={{ background: swatchBg(c) }}
                title={c === 'transparent' ? 'No background' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                // 'transparent' stays out of recents — in the recents strip it
                // would render as an invisible swatch on color rows that don't
                // checkerboard it (draw stroke colors, text color).
                onClick={() => { onPick(c); if (c !== 'transparent') addRecentColor(c); setOpen(false); }} />
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
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setOpen(o => !o)}>
        {glyph ? (
          <span className="tob-color-stack">
            <span className="tob-color-glyph">{glyph}</span>
            <span className="tob-color-bar" style={{ background: swatchBg(defaultColor) }} />
          </span>
        ) : (
          <span className="tob-sw-dot" style={{ background: swatchBg(defaultColor) }} />
        )}
      </button>
      {popNode && typeof document !== 'undefined'
        ? createPortal(popNode, document.body)
        : popNode}
    </span>
  );
}
