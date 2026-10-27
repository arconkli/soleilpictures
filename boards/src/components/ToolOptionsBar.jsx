// Bottom-of-canvas options bar. Renders different content based on the
// active tool or, when a note is being edited, rich-text controls that
// operate on the focused contenteditable.
//
// Note: rich-text formatting uses our editorSelection helpers — `withSelection`
// restores the saved selection before each command so the toolbar doesn't
// lose what the user had highlighted.

import { memo, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  withSelection, wrapSelectionStyle, toggleList,
  captureSelection, captureSelectionOffsets, restoreSelectionFromOffsets,
} from '../lib/editorSelection.js';
import { usePointerPolicy } from '../hooks/usePointerPolicy.js';
import { setDrawWithFinger } from '../lib/pointerPolicy.js';
import { useToolbarRoving } from '../hooks/useToolbarRoving.js';
import { ensureGoogleFontLoaded } from '../lib/googleFonts.js';
import { addRecentFont } from '../lib/customFonts.js';
import { getActiveNoteEditor, getActiveNoteActions, subscribeActiveNoteEditor } from '../lib/noteEditorRegistry.js';
import { safeRun } from '../lib/safeEditorCmd.js';
import { noteFontSizePatch } from '../lib/noteFontSize.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { tlTip } from '../lib/looks.js';

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

// The text the note bar formats: the collaborative editor, or the plain
// contenteditable a grid's cells and a canvas with no live room (?local,
// ?ttnotes=0) draw.
function noteText() {
  return getActiveNoteEditor() || document.querySelector('.note-body[contenteditable="true"]');
}

// One function for the component's whole life, calling the latest `fn` it was
// handed. The canvas passes the bar fresh callbacks on every card change, and
// a keystroke in a note is one, so the memoized note bar would redraw for each.
function useStableFn(fn) {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  const [stable] = useState(() => (...args) => ref.current?.(...args));
  return stable;
}

// The note bar (the toolbar look, the owner's pick "A · Islands", 2026-10-21)
// is drawn by components/toolbar/NoteBarA.jsx, a chunk of its own
// (scripts/bundleBudget.mjs LAZY_IN_APP) that the canvas fetches as it opens.
// NoteRichTextBar works the bar, and hands NoteBarA what to show and what each
// control does.
let noteBarA = null;
const loadNoteBarA = () => import('./toolbar/NoteBarA.jsx').then((m) => (noteBarA = m.NoteBarA));
function useNoteBarA() {
  const [Bar, setBar] = useState(() => noteBarA);
  useEffect(() => {
    if (Bar) return undefined;
    let live = true;
    loadNoteBarA().then((b) => { if (live) setBar(() => b); }).catch(() => {});
    return () => { live = false; };
  }, [Bar]);
  return Bar;
}
// The draw, shape, line and arrow bars are another chunk
// (components/toolbar/CanvasBarsA.jsx), fetched the same way; a picked
// arrow's bar is in it too (CanvasSurface).
let canvasBarsA = null;
const loadCanvasBarsA = () => import('./toolbar/CanvasBarsA.jsx').then((m) => (canvasBarsA = m));
export function useCanvasBarsA(on) {
  const [bars, setBars] = useState(() => canvasBarsA);
  useEffect(() => {
    if (!on || bars) return undefined;
    let live = true;
    loadCanvasBarsA().then((m) => { if (live) setBars(m); }).catch(() => {});
    return () => { live = false; };
  }, [on, bars]);
  return on ? bars : null;
}

export const STROKE_COLORS = ['#f5f5f6', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
export const FILL_COLORS  = ['transparent', '#1c1c1f', '#fef3c7', '#fee2e2', '#dcfce7', '#dbeafe', '#f3e8ff', '#0a0a0c'];
export const TEXT_COLORS  = ['#f5f5f6', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
export const BG_COLORS    = ['transparent', '#1c1c1f', '#fef3c7', '#fee2e2', '#dcfce7', '#dbeafe', '#f3e8ff', '#fde68a', '#ffffff'];
// Checkerboard stand-in for the 'transparent' swatch — same pattern the
// shape fill strip uses, so "no background" reads consistently everywhere.
const TRANSPARENT_SWATCH_BG = 'repeating-linear-gradient(45deg,#222 0 4px,#444 4px 8px)';
export const swatchBg = (c) => (c === 'transparent' ? TRANSPARENT_SWATCH_BG : c);
export const DRAW_THICKNESS = [2, 4, 8, 16];
export const FONTS = [
  { id: 'sans', name: 'Sans', css: 'Inter, system-ui, sans-serif' },
  { id: 'serif', name: 'Serif', css: 'ui-serif, Georgia, "Times New Roman", serif' },
  { id: 'mono', name: 'Mono', css: 'JetBrains Mono, ui-monospace, monospace' },
];
export const SIZES = [11, 13, 15, 18, 24, 32, 48, 64];
// The fields of a note card that its bar shows or seeds a picker with.
const NOTE_LOOK = ['fontSize', 'fontSizeV', 'fontFamily', 'textColor', 'bgColor', 'vAlign'];
const NO_COLORS = [];


// Format helpers — operate on the saved selection from RichNoteEditor.
//
// Every apply path dispatches FMT_EVT so the toolbar-state hooks re-sample
// immediately. `selectionchange` alone is not enough: applying a style can
// leave the range boundaries untouched (no selectionchange fires) while the
// computed styles under it changed — the bar then showed stale state until
// the next caret move ("what displays on the toolbar isn't always accurate").
const FMT_EVT = 'soleil-note-format-applied';
const notifyFormatChanged = () => { try { document.dispatchEvent(new Event(FMT_EVT)); } catch (_) {} };

const JUSTIFY = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight' };
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
    // clearNodes (list fallback) throws on a hardBreak in the selection — guard it.
    safeRun(c, `note-list:${type}`);
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
    else {
      applyNoteDefault?.();
      // The card write never touches the editor, so focus stayed wherever the
      // control left it (the size box blurs to <body> on Enter) and the note,
      // which only leaves edit mode on its own blur, sat "editing" with
      // nothing focused (NOTES-13). Hand the caret back — unless the user is
      // still typing into a control (the custom colour pad's hex field
      // applies live, keystroke by keystroke).
      requestAnimationFrame(() => {
        if (getActiveNoteEditor() !== editor || editor.isDestroyed || editor.isFocused) return;
        const a = document.activeElement;
        if (a && a !== document.body && a.matches?.('input, textarea, select, [contenteditable="true"]')) return;
        editor.commands.focus();
      });
    }
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

// The computed style of the text at a Tiptap editor's caret (selection start).
// The textStyle mark only knows inline picks; a caret in unmarked text renders
// with the note's own base (card fontSize / fontFamily / textColor, or the
// theme), which only the computed style can tell us.
function editorCaretStyle(editor) {
  try {
    const { node, offset } = editor.view.domAtPos(editor.state.selection.from);
    const el = styleNodeAtRangeStart({ startContainer: node, startOffset: offset });
    if (!el || el.nodeType !== Node.ELEMENT_NODE || !editor.view.dom.contains(el)) return null;
    return window.getComputedStyle(el);
  } catch (_) { return null; }
}

// Runs `fn` at most once a frame while a Tiptap editor changes; returns the
// unsubscribe. Typing fires a transaction and a selection update for every
// key, and a computed-style read in the middle of one makes the browser
// restyle the page there and then, where the next frame does it anyway.
function onEditorChangeEachFrame(editor, fn) {
  let raf = 0;
  const run = () => { raf = 0; if (!editor.isDestroyed) fn(); };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(run); };
  editor.on('selectionUpdate', schedule);
  editor.on('transaction', schedule);
  return () => {
    editor.off('selectionUpdate', schedule);
    editor.off('transaction', schedule);
    if (raf) cancelAnimationFrame(raf);
  };
}

// `noteBase` changes when the note's card-level look does (a caret-only pick
// sets it), which moves the computed style without any editor transaction —
// so it is an effect dependency, to re-sample.
function useNoteForeColor(active, noteBase = '') {
  const [color, setColor] = useState('#f5f5f6');
  const editor = useActiveNoteEditor();
  useEffect(() => {
    if (!active) return undefined;
    // Collaborative editor: the inline colour mark at the caret, else the
    // colour the text there actually renders in. Reading only the mark kept
    // showing the last coloured span after the caret left it (NOTES-15).
    if (editor) {
      const sample = () => {
        const c = editor.getAttributes('textStyle')?.color;
        const hex = c ? (rgbToHex(c) || c) : rgbToHex(editorCaretStyle(editor)?.color);
        if (hex) setColor(prev => (prev === hex ? prev : hex));
      };
      sample();
      return onEditorChangeEachFrame(editor, sample);
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
  }, [active, editor, noteBase]);
  return color;
}

// Active inline-format state at the caret/selection, so the note toolbar can
// reflect what's already applied (bold/italic/etc. highlighted, current font
// size shown). Mirrors useNoteForeColor: subscribes to selectionchange while
// the note is being edited, rAF-debounced. Uses queryCommandState because the
// note editor formats via execCommand.
const EMPTY_FMT = { bold: false, italic: false, underline: false, strike: false, listType: null, fontSize: null, fontFamily: null, align: null };
function useNoteFormatState(active, noteBase = '') {
  const [state, setState] = useState(EMPTY_FMT);
  const editor = useActiveNoteEditor();
  useEffect(() => {
    if (!active) { setState(EMPTY_FMT); return undefined; }
    // Collaborative editor: derive the active state from Tiptap.
    if (editor) {
      const sample = () => {
        const ts = editor.getAttributes('textStyle') || {};
        const align = ['left', 'center', 'right'].find(a => editor.isActive({ textAlign: a })) || null;
        let listType = null;
        if (editor.isActive('noteChecklist')) listType = 'task';
        else if (editor.isActive('bulletList')) listType = 'ul';
        else if (editor.isActive('orderedList')) listType = 'ol';
        // Size and font from the inline mark when there is one, else from the
        // text as it renders (the note's own base). Mark-only left the size
        // box blank in unformatted text, so −/+ stepped from a hard-coded 15:
        // + stuck at 16 and shrank a 24px note (NOTES-05).
        const cs = (ts.fontSize && ts.fontFamily) ? null : editorCaretStyle(editor);
        // With nothing selected, − / + set the whole note's base size, so
        // show that, not a heading's scaled size: in an h1 on a 15px note the
        // box read 20 and + set the whole note to 21.
        let sizeSrc = ts.fontSize;
        if (!sizeSrc) {
          try {
            sizeSrc = editor.state.selection.empty
              ? window.getComputedStyle(editor.view.dom).fontSize
              : cs?.fontSize;
          } catch (_) { sizeSrc = cs?.fontSize; }
        }
        const familySrc = ts.fontFamily || cs?.fontFamily;
        const fontSize = sizeSrc ? Math.round(parseFloat(sizeSrc)) || null : null;
        const fontFamily = familySrc
          ? familySrc.split(',')[0].trim().replace(/^["']|["']$/g, '') || null : null;
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
      sample();
      return onEditorChangeEachFrame(editor, sample);
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
  }, [active, editor, noteBase]);
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
  selectedCellStyle = false, // a grid box is SELECTED (not text-editing) → box style bar
  cellKind = null,        // content type of the targeted box (text/empty/link/image/…)
  cellPinned = false,     // that cell is "pinned" to its own frozen text style
  onCellStyle,            // (patch) => write text style: shared family, or this cell if pinned
  onCellScope,            // (mode:'all'|'box') => set the scope: shared family vs only this box
  editingCellStyle = null, // effective {…, bg} of the edited cell — seeds the bg picker
  editingShapeCard,
  onUpdateEditingShape,
  editingLineArrow,       // { idx, arrow } when a single line-arrow is selected
  onUpdateEditingLineArrow, // (patch) => updates that arrow
  paletteColors = NO_COLORS,
  openColorPicker,
  onOpenSketchpad,      // launch the fullscreen sketch pad from inside Draw tool
  onUndo,               // global Yjs undo — surfaced as a toolbar button on Draw
}) {
  const pointerPolicy = usePointerPolicy();
  // The bars' chunks, before the first note opens or the first tool is
  // picked.
  const barsA = useCanvasBarsA(true);
  useEffect(() => { loadNoteBarA().catch(() => {}); }, []);
  const openPickerAt = useStableFn((e, opts) => {
    if (!openColorPicker) return;
    const r = e.currentTarget.getBoundingClientRect();
    openColorPicker({
      ...opts,
      x: r.left + r.width / 2,
      y: r.top,
      paletteColors,
    });
  });

  // The draw, line, shape and arrow bars are each a toolbar, one Tab stop
  // walked by the arrows (hooks/useToolbarRoving); the note bar has its own.
  const tobRef = useRef(null);
  const tobKeys = useToolbarRoving(tobRef);

  // The canvas re-renders this bar on every card change, and a keystroke in a
  // note is one: a new card object, palette list, cell style and callbacks
  // each time. The note bar is memoized and keeps the same ones until what
  // they hold changes, so it draws only when what it shows does.
  const noteLookKey = editingNoteCard ? JSON.stringify(NOTE_LOOK.map((k) => editingNoteCard[k] ?? null)) : '';
  const noteLook = useMemo(() => (editingNoteCard
    ? Object.fromEntries(NOTE_LOOK.map((k) => [k, editingNoteCard[k]]))
    : null), [noteLookKey]);
  const notePalette = useMemo(() => paletteColors, [paletteColors.join('|')]);
  const cellStyle = useMemo(() => editingCellStyle, [JSON.stringify(editingCellStyle)]);
  const updateNote = useStableFn(onUpdateEditingNote);
  const styleCell = useStableFn(onCellStyle);
  const scopeCell = useStableFn(onCellScope);

  // ── Note rich text bar ──────────────────────────────────────────────────
  // Also shown for a grid TEXT cell (editingCellText) — same inline formatting,
  // driven against the focused contenteditable. With no backing note card the
  // two card-level controls (card background, vertical balance) are hidden.
  if (editingNoteCard || editingCellText || selectedCellStyle) {
    return <MemoNoteRichTextBar
      paletteColors={notePalette}
      openPickerAt={openPickerAt}
      noteLook={noteLook}
      onUpdateEditingNote={onUpdateEditingNote ? updateNote : null}
      cardLevel={!!editingNoteCard}
      cellStyleMode={!editingNoteCard && (!!editingCellText || !!selectedCellStyle)}
      cellEditing={!!editingCellText}
      cellKind={cellKind}
      cellPinned={cellPinned}
      onCellStyle={onCellStyle ? styleCell : null}
      onCellScope={onCellScope ? scopeCell : null}
      editingCellStyle={cellStyle}
    />;
  }

  // ── Drawing options ──────────────────────────────────────────────────────
  if (selectedTool === 'draw') {
    if (!barsA) return null;
    return (
      <barsA.DrawBarA barRef={tobRef} onKeyDown={tobKeys} options={drawOptions} setOptions={setDrawOptions}
                      paletteColors={paletteColors} openPickerAt={openPickerAt}
                      onUndo={onUndo} onOpenSketchpad={onOpenSketchpad}
                      stylus={pointerPolicy.stylus} fingerDraws={pointerPolicy.fingerDraws}
                      onFinger={() => setDrawWithFinger(!pointerPolicy.fingerDraws)} />
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
      // To a hundredth: whole pixels turned a typed 45 into 44.9 on a
      // short line.
      const newTo = {
        x: Math.round((fx + Math.cos(rad) * len) * 100) / 100,
        y: Math.round((fy + Math.sin(rad) * len) * 100) / 100,
      };
      onUpdateEditingLineArrow({ to: newTo });
    };
    if (!barsA) return null;
    return (
      <barsA.LineBarA barRef={tobRef} onKeyDown={tobKeys} stroke={stroke} width={strokeWidth} dash={dash}
                      angle={currentAngle} onAngle={setAngle} onChange={onUpdateEditingLineArrow}
                      paletteColors={paletteColors} openPickerAt={openPickerAt} />
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
    if (!barsA) return null;
    return (
      <barsA.ShapeBarA barRef={tobRef} onKeyDown={tobKeys} opts={opts} setOpts={setOpts} editing={editing}
                       paletteColors={paletteColors} openPickerAt={openPickerAt} />
    );
  }

  // ── Arrow options ───────────────────────────────────────────────────────
  if (selectedTool === 'arrow' && arrowOptions && setArrowOptions) {
    if (!barsA) return null;
    return <barsA.ArrowBarA barRef={tobRef} onKeyDown={tobKeys} options={arrowOptions} setOptions={setArrowOptions} />;
  }

  return null;
}

// Split out so we can call the `useNoteForeColor` hook (which subscribes to
// selectionchange while the note is being edited). Keeping it inside the
// main ToolOptionsBar function would mean the hook runs in every render of
// every tool's bar.
function NoteRichTextBar({ paletteColors, openPickerAt, noteLook, onUpdateEditingNote, cardLevel = true, cellStyleMode = false, cellEditing = false, cellKind = null, cellPinned = false, onCellStyle, onCellScope, editingCellStyle = null }) {
  // The note's card-level look: when a caret-only pick changes it, the text
  // under the caret re-renders without an editor transaction, so the hooks
  // re-sample on this instead.
  const noteBase = noteLook
    ? [noteLook.fontSize, noteLook.fontSizeV, noteLook.fontFamily, noteLook.textColor, noteLook.bgColor].join('|')
    : '';
  const currentFore = useNoteForeColor(true, noteBase);
  const fmt = useNoteFormatState(true, noteBase);
  const barRef = useRef(null);
  // A box that's SELECTED but not being text-edited has no live editor, so the
  // execCommand controls (bold/italic/lists) are hidden and Font/Size/Align show
  // the box's effective style instead of the (empty) selection state. For an
  // image/video/file box, typography doesn't apply → only Box background + scope.
  const selectedBox = cellStyleMode && !cellEditing;
  // The text keeps Tab (two spaces): ⌥F10 in it comes to the bar, and Escape
  // here goes back to the caret. A selected box has no text to go back to.
  const barKeys = useToolbarRoving(barRef, { text: selectedBox ? null : noteText });
  const textish = !cellStyleMode || cellKind == null || cellKind === 'text' || cellKind === 'empty' || cellKind === 'link';
  const showTypography = textish;
  const showEmphasis = !selectedBox;
  const display = selectedBox
    ? { // Show the first family name (e.g. "Inter"), not the raw CSS stack the cell
        // stores ("Inter, system-ui, sans-serif") — matches the editing path's label.
        fontFamily: editingCellStyle?.fontFamily
          ? editingCellStyle.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
          : undefined,
        fontSize: editingCellStyle?.fontSize ? parseInt(editingCellStyle.fontSize, 10) : undefined,
        align: editingCellStyle?.align }
    : fmt;
  // The bar (NoteBarA), once its chunk is here.
  const Bar = useNoteBarA();
  // Mobile: lift the bar above the soft keyboard. In mobile Safari the keyboard
  // overlays the layout viewport (visualViewport shrinks, the page doesn't), so
  // a CSS `bottom` would sit the bar UNDER the keyboard. Track visualViewport
  // and set the bar's bottom to the keyboard height + a small gap. Desktop / no
  // keyboard → kb = 0 → the CSS bottom stands. The Capacitor app resizes
  // natively, which the same math also handles. Re-subscribes per edit (the
  // bar mounts when a note edit begins), and when the bar's chunk arrives.
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
      const kb = Math.round(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
      // Only override while a keyboard is up. With none, clear it so the
      // stylesheet's bottom applies: on the mobile shell that clears the
      // fixed bottom nav, and an inline 8px parked the bar behind the nav.
      el.style.bottom = kb > 0 ? `calc(${kb}px + 8px)` : '';
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [Bar]);

  // What the controls do. A grid's box keeps its text style
  // on the box (onCellStyle, shared or pinned); a note styles the selection,
  // or the whole note with none (applyStyleOrNoteDefault).
  const applyFont = (css) => (cellStyleMode
    ? onCellStyle?.({ fontFamily: css })
    : applyStyleOrNoteDefault({ fontFamily: css }, () => onUpdateEditingNote && onUpdateEditingNote({ fontFamily: css })));
  const applySize = (px) => (cellStyleMode
    ? onCellStyle?.({ fontSize: px })
    : applyStyleOrNoteDefault({ fontSize: px + 'px' }, () => onUpdateEditingNote && onUpdateEditingNote(noteFontSizePatch(px))));
  const applyColor = (c) => (cellStyleMode
    ? onCellStyle?.({ color: c })
    : applyStyleOrNoteDefault({ color: c }, () => onUpdateEditingNote && onUpdateEditingNote({ textColor: c })));
  const customColor = (e) => openPickerAt(e, { value: currentFore, onChange: applyColor });
  // The 'transparent' swatch maps a box's to bg:null, back to the default
  // cell surface (the renderer treats null/'transparent' as unset).
  const applyBg = (c) => (cellStyleMode
    ? onCellStyle?.({ bg: c === 'transparent' ? null : c })
    : onUpdateEditingNote && onUpdateEditingNote({ bgColor: c }));
  const customBg = (e) => openPickerAt(e, {
    // Seed the picker pad with a real hex when the current bg
    // is transparent (the pad can't represent 'transparent';
    // its None button emits it instead) — mirrors shape fills.
    value: cellStyleMode
      ? ((editingCellStyle?.bg && editingCellStyle.bg !== 'transparent') ? editingCellStyle.bg : '#1c1c1f')
      : ((noteLook?.bgColor && noteLook.bgColor !== 'transparent') ? noteLook.bgColor : '#1c1c1f'),
    onChange: applyBg,
    allowTransparent: true,
  });
  // One-click "center" — text sits DEAD-CENTER of the box, both axes. For a
  // note it's a flat card field (vAlign) through the undo-aware path; for a
  // grid cell it's part of the cell's text style (shared or pinned) applied
  // as container flex + text-align, so it propagates like the font.
  const balanced = cellStyleMode
    ? (display.align === 'center')
    : (fmt.align === 'center' && noteLook?.vAlign === 'center');
  const toggleBalanced = () => {
    if (cellStyleMode) {
      onCellStyle?.(balanced ? { align: 'left', vAlign: 'top' } : { align: 'center', vAlign: 'center' });
    } else if (balanced) {
      setAlignAllBlocks('left');
      onUpdateEditingNote && onUpdateEditingNote({ vAlign: null });
    } else {
      setAlignAllBlocks('center');
      onUpdateEditingNote && onUpdateEditingNote({ vAlign: 'center' });
    }
  };

  if (!Bar) return null;
  return (
    <Bar barRef={barRef} onKeyDown={barKeys}
         label={selectedBox ? 'Box style' : 'Text formatting'} text={!selectedBox}
         show={{ typography: showTypography, emphasis: showEmphasis, cell: cellStyleMode, card: cardLevel || cellStyleMode }}
         fmt={fmt} display={display} fore={currentFore} balanced={balanced} cellPinned={cellPinned}
         bg={(cellStyleMode ? editingCellStyle?.bg : noteLook?.bgColor) || null}
         paletteColors={paletteColors}
         act={{
           toggle: execToggle,
           clear: clearNoteFormatting,
           list: applyToggleList,
           align: (a) => (cellStyleMode ? onCellStyle?.({ align: a }) : execCmd(JUSTIFY[a])),
           balance: toggleBalanced,
           font: applyFont,
           // −/+ step past the ends; the field clamps what's typed itself.
           size: (px) => applySize(Math.min(200, Math.max(6, Math.round(px)))),
           color: applyColor,
           customColor,
           bg: applyBg,
           customBg,
           scope: (mode) => onCellScope?.(mode),
         }} />
  );
}
// Its own hooks redraw it when the caret's formatting changes; the canvas's
// re-renders reach it only when its props do (see ToolOptionsBar).
const MemoNoteRichTextBar = memo(NoteRichTextBar);

// ── What the bars share ───────────────────────────────────────────────────

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
// no browser spinner arrows (components/toolbar/CanvasBarsA.jsx).
export function LineAngleInput({ angle, onCommit }) {
  const [draft, setDraft] = useState(() => formatAngleForDisplay(angle));
  const [editing, setEditing] = useState(false);
  // Sync with external angle changes (e.g. user drags an endpoint)
  // only when the input isn't currently being edited.
  useEffect(() => {
    if (!editing) setDraft(formatAngleForDisplay(angle));
  }, [angle, editing]);
  // Escape → blur → this commit, still holding the typed draft: without the
  // flag Escape applied the angle it meant to revert (NOTES-11).
  const cancelRef = useRef(false);
  const commit = () => {
    setEditing(false);
    if (cancelRef.current) { cancelRef.current = false; setDraft(formatAngleForDisplay(angle)); return; }
    // Passed through, nothing typed (the arrows walk the bar through this
    // field): nothing to set. Setting the angle it shows, a tenth of a degree
    // rounded, moved the line's end and was one more thing to undo.
    if (draft === formatAngleForDisplay(angle)) return;
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
      className="tl-field tob-angle-input"
      value={draft}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onChange={(e) => { const v = e.target.value; if (v === '' || /^-?\d*\.?\d*$/.test(v)) setDraft(v); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (isComposingKey(e)) return;
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.stopPropagation(); cancelRef.current = true; e.currentTarget.blur(); }
      }}
      aria-label="Angle"
      {...tlTip('Angle in degrees: 0 is right, 90 straight down')}
    />
  );
}

// Free-form pixel input for line stroke width. Same UX shape as
// LineAngleInput — no spinner arrows, no forced decimal display,
// commits on blur or Enter. Clamps to >= 0 (0 means "no line").
export function LinePxInput({ value, onCommit, label = 'Width' }) {
  const [draft, setDraft] = useState(() => formatAngleForDisplay(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(formatAngleForDisplay(value));
  }, [value, editing]);
  const cancelRef = useRef(false); // see LineAngleInput
  const commit = () => {
    setEditing(false);
    if (cancelRef.current) { cancelRef.current = false; setDraft(formatAngleForDisplay(value)); return; }
    if (draft === formatAngleForDisplay(value)) return;   // nothing typed: see LineAngleInput
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
      className="tl-field tob-px-input"
      value={draft}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setDraft(v); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (isComposingKey(e)) return;
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.stopPropagation(); cancelRef.current = true; e.currentTarget.blur(); }
      }}
      aria-label={label}
    />
  );
}

// Clear formatting (⌘\): strips bold/italic/colour/font/size from the
// selection back to the note's own defaults; links and comments stay. The
// legacy contentEditable path falls back to the browser's removeFormat.
function clearNoteFormatting() {
  const editor = getActiveNoteEditor();
  if (editor) editor.chain().focus().clearFormatting().run();
  else withSelection(() => { try { document.execCommand('removeFormat'); } catch (_) {} });
  notifyFormatChanged();
}

// Comment on the selected words in a note — the same gesture as the doc
// editor's (and ⌘⌥M): NoteBarA's Comment asks this for the flow, when the note
// has one ({ hasSelection, open }), else null. The flow itself is owned by
// NoteTiptapSurface (it needs the note's Yjs card map for the thread store); it
// hands `openAddComment` to the registry when it mounts. Only the
// collaborative Tiptap note path registers it — the legacy contentEditable
// editor has no comment support, so the button hides there.
export function useNoteComment() {
  const editor = useActiveNoteEditor();
  // Enabled-ness tracks the live selection, so subscribe to the editor's own
  // updates — the toolbar's FMT_EVT only fires after a format command runs and
  // would leave this button stale while the user was merely selecting text.
  // Only whether there is a selection is kept, so typing doesn't redraw it.
  const [hasSelection, setHasSelection] = useState(() => !!editor && !editor.state.selection.empty);
  useEffect(() => {
    if (!editor) return undefined;
    const sample = () => setHasSelection(!editor.state.selection.empty);
    sample();
    return onEditorChangeEachFrame(editor, sample);
  }, [editor]);
  const openAddComment = getActiveNoteActions().openAddComment;
  return editor && openAddComment ? { hasSelection, open: openAddComment } : null;
}

// A font picked from NoteBarA's list: preview(css) on the pointer resting on
// one (null to put the text back), commit(entry) on a pick, cancel() on the
// list closing without one.
export function useFontPick(onApplyFont = null) {
  // Preview-on-hover support. To keep the DOM clean across many hovers we
  // snapshot the editable's innerHTML on first hover and restore that
  // baseline before each subsequent preview. The innerHTML reset destroys
  // the DOM nodes the user's selection Range points at, so we also
  // capture the selection as character offsets within the editable and
  // re-establish it from those offsets after every reset. Refs (not
  // closure vars) so the snapshot survives re-renders of the picker.
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
  return { preview: handlePreview, commit: handleCommit, cancel: () => restoreSnapshot() };
}
