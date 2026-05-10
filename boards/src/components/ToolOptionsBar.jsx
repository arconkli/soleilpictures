// Bottom-of-canvas options bar. Renders different content based on the
// active tool or, when a note is being edited, rich-text controls that
// operate on the focused contenteditable.
//
// Note: rich-text formatting uses our editorSelection helpers — `withSelection`
// restores the saved selection before each command so the toolbar doesn't
// lose what the user had highlighted.

import { useState } from 'react';
import { withSelection, wrapSelectionStyle } from '../lib/editorSelection.js';
import { useRecentColors } from '../hooks/useRecentColors.js';
import { addRecentColor } from '../lib/recentColors.js';
import { useCustomFonts, useRecentFonts } from '../hooks/useCustomFonts.js';
import { CustomFontsModal } from './CustomFontsModal.jsx';
import { FontPickerDropdown } from './FontPickerDropdown.jsx';
import { combineAllFonts, ensureGoogleFontLoaded } from '../lib/googleFonts.js';
import { addRecentFont } from '../lib/customFonts.js';

const STROKE_COLORS = ['#f5f5f6', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const FILL_COLORS  = ['transparent', '#1c1c1f', '#fef3c7', '#fee2e2', '#dcfce7', '#dbeafe', '#f3e8ff', '#0a0a0c'];
const TEXT_COLORS  = ['#f5f5f6', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const BG_COLORS    = ['#1c1c1f', '#fef3c7', '#fee2e2', '#dcfce7', '#dbeafe', '#f3e8ff', '#fde68a', '#ffffff'];
const STROKE_WIDTHS = [1, 2, 4, 8];
const DRAW_THICKNESS = [2, 4, 8, 16];
const FONTS = [
  { id: 'sans', name: 'Sans', css: 'Inter, system-ui, sans-serif' },
  { id: 'serif', name: 'Serif', css: 'ui-serif, Georgia, "Times New Roman", serif' },
  { id: 'mono', name: 'Mono', css: 'JetBrains Mono, ui-monospace, monospace' },
];
const SIZES = [11, 13, 16, 20, 28, 40, 56];

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

export function ToolOptionsBar({
  selectedTool,
  drawOptions, setDrawOptions,
  shapeOptions, setShapeOptions,
  arrowOptions, setArrowOptions,
  editingNoteCard,
  onUpdateEditingNote,
  editingShapeCard,
  onUpdateEditingShape,
  paletteColors = [],
  openColorPicker,
  onOpenSketchpad,      // launch the fullscreen sketch pad from inside Draw tool
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
    return (
      <div {...tobProps}
           onPointerDown={(e) => e.stopPropagation()}>
        <FontPicker />
        <SizePicker />
        <span className="tob-sep" />
        <FormatBtn label="B" title="Bold (⌘B)" cmd="bold" bold />
        <FormatBtn label={<i>I</i>} title="Italic (⌘I)" cmd="italic" />
        <FormatBtn label={<u>U</u>} title="Underline (⌘U)" cmd="underline" />
        <FormatBtn label={<s>S</s>} title="Strike" cmd="strikeThrough" />
        <span className="tob-sep" />
        <FormatBtn label="•"  title="Bulleted list" cmd="insertUnorderedList" />
        <FormatBtn label="1." title="Numbered list" cmd="insertOrderedList" />
        <FormatBtn label="☐"  title="Checklist" cmd="insertHTML"
                   val={'<ul class="note-checklist"><li class="ck"><span class="ck-box" contenteditable="false" role="checkbox" aria-checked="false"></span><span class="ck-text">&#8203;</span></li></ul>'} />
        <span className="tob-sep" />
        <FormatBtn label="⇤" title="Align left"   cmd="justifyLeft" />
        <FormatBtn label="≡" title="Align center" cmd="justifyCenter" />
        <FormatBtn label="⇥" title="Align right"  cmd="justifyRight" />
        <span className="tob-sep" />
        <ColorBtn title="Text color" defaultColor="#f5f5f6"
                  swatches={TEXT_COLORS}
                  paletteColors={paletteColors}
                  onPick={(c) => applyStyle({ color: c })}
                  onCustom={(e) => openPickerAt(e, {
                    value: '#f5f5f6',
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

  // ── Drawing options ──────────────────────────────────────────────────────
  if (selectedTool === 'draw') {
    const allColors = [...new Set([...recentColors, ...paletteColors, ...STROKE_COLORS])];
    const isEraser = drawOptions.mode === 'eraser';
    return (
      <div {...tobProps} onPointerDown={(e) => e.stopPropagation()}>
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
        <select className="tob-select" value={opts.strokeWidth}
                onChange={(e) => setOpts({ ...opts, strokeWidth: Number(e.target.value) })}>
          {STROKE_WIDTHS.map(w => <option key={w} value={w}>{w}px</option>)}
        </select>
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

// ── Format buttons ────────────────────────────────────────────────────────

function FormatBtn({ label, title, cmd, val, bold }) {
  return (
    <button className="tob-btn"
            title={title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execCmd(cmd, val)}
            style={bold ? { fontWeight: 700 } : undefined}>
      {label}
    </button>
  );
}

function FontPicker() {
  const customFonts = useCustomFonts();
  const recentFonts = useRecentFonts();
  const allFonts = combineAllFonts(FONTS, customFonts);
  const [open, setOpen] = useState(false);

  // Preview-on-hover support. The contenteditable selection collapses every
  // time we wrap, so previewing across many fonts would nest spans. To keep
  // the DOM clean we snapshot the editable's innerHTML on first hover and
  // restore it on each subsequent preview before re-wrapping.
  let snapshot = null;
  let snapshotRoot = null;
  function takeSnapshot() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    let node = r.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    const editable = node.closest && node.closest('[contenteditable="true"]');
    if (!editable) return;
    snapshotRoot = editable;
    snapshot = editable.innerHTML;
  }
  function restoreSnapshot() {
    if (snapshot != null && snapshotRoot && document.contains(snapshotRoot)) {
      snapshotRoot.innerHTML = snapshot;
    }
    snapshot = null; snapshotRoot = null;
  }
  const handlePreview = (css) => {
    if (css == null) { restoreSnapshot(); return; }
    if (snapshot == null) takeSnapshot();
    else if (snapshotRoot) snapshotRoot.innerHTML = snapshot;  // reset before wrap
    applyStyle({ fontFamily: css });
  };
  const handleCommit = (entry) => {
    if (entry?.gfName) ensureGoogleFontLoaded(entry.gfName);
    if (snapshot != null && snapshotRoot) {
      // Use the snapshot as the baseline, then apply the picked font.
      snapshotRoot.innerHTML = snapshot;
    }
    snapshot = null; snapshotRoot = null;
    applyStyle({ fontFamily: entry.css });
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

function SizePicker() {
  return (
    <select className="tob-select"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v) applyStyle({ fontSize: v + 'px' });
              e.target.value = '';
            }}
            defaultValue="">
      <option value="" disabled>Size</option>
      {SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
    </select>
  );
}

function ColorBtn({ title, swatches, paletteColors = [], defaultColor, onPick, onCustom }) {
  const [open, setOpen] = useState(false);
  const recentColors = useRecentColors();
  const allSwatches = [...new Set([...recentColors, ...paletteColors, ...swatches])];
  return (
    <span className="tob-pop-wrap">
      <button className="tob-btn" title={title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(o => !o)}>
        <span className="tob-sw-dot" style={{ background: defaultColor }} />
      </button>
      {open && (
        <span className="tob-pop"
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
      )}
    </span>
  );
}
