// Persistent top toolbar for the doc editor. Operates on whatever Tiptap
// editor instance the parent passes in; gracefully renders disabled buttons
// when no editor is mounted (e.g. between page switches).

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorState } from '@tiptap/react';
import { DocExportMenu } from './DocExportMenu.jsx';
import { DocInsertMenu } from './DocInsertMenu.jsx';
import { CustomFontsModal } from './CustomFontsModal.jsx';
import { FontPickerDropdown } from './FontPickerDropdown.jsx';
import { SizeInput } from './SizeInput.jsx';
import { useAnchoredPopover } from '../hooks/useAnchoredPopover.js';
import { useToolbarRoving } from '../hooks/useToolbarRoving.js';
import { useCustomFonts, useRecentFonts } from '../hooks/useCustomFonts.js';
import { combineAllFonts, ensureGoogleFontLoaded } from '../lib/googleFonts.js';
import { addRecentFont } from '../lib/customFonts.js';
import {
  List, ListOrdered, ListChecks, Quote,
  AlignLeft, AlignCenter, AlignRight,
  Link as LinkPh, Bookmark, Search, Undo, Redo, MessageCircle, Clapperboard, FileText, Files, Hash, Columns2,
} from '../lib/icons.js';
import { Icon as Glyph } from './Icon.jsx';
import { ELEMENTS as SP_ELEMENTS, ELEMENT_LABELS as SP_LABELS } from './docExtensions/screenplay/screenplayFlow.js';
import { safeRun } from '../lib/safeEditorCmd.js';
import { ariaKeys } from '../lib/ariaKeys.js';

const HEADING_OPTIONS = [
  { value: 'p', label: 'Body' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'h4', label: 'Heading 4' },
  { value: 'h5', label: 'Heading 5' },
  { value: 'h6', label: 'Heading 6' },
];

const FONTS = [
  { id: 'sans', label: 'Sans', css: 'Inter, system-ui, sans-serif' },
  { id: 'serif', label: 'Serif', css: 'ui-serif, Georgia, "Iowan Old Style", serif' },
  { id: 'mono', label: 'Mono', css: 'JetBrains Mono, ui-monospace, monospace' },
];

const SIZES = [12, 14, 16, 18, 22, 28, 36];

const COLORS = ['#f5f5f6', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

export function DocToolbar({ editor, onInsertBookmark, onInsertImage, onInsertBoardEmbed, onOpenFind, docName, onOpenLink, onAddComment,
                               ydoc = null, scope = null, docMode = 'doc', onToggleScreenplay,
                               titlePageEnabled = false, onToggleTitlePage,
                               sceneNumbersShow = false, onSetSceneNumbersShow,
                               pageless = true, onTogglePageless,
                               // Paged doc, but a phone shows it continuous (DocSurface).
                               pagesShownContinuous = false,
                               zoom = 1, fitMode = false, onZoomIn, onZoomOut, onZoomReset,
                               // false → view-only member. Their Y.Doc writes never leave the
                               // tab (the board room drops them), so the bar keeps only what
                               // reads: Find, Export and zoom.
                               canEdit = true,
                               // false → no Export (a doc shared without "Allow exporting").
                               canExport = true }) {
  // What the bar lights, read on every transaction but re-rendered only when
  // it changes (useEditorState compares it key by key): this re-rendered the
  // whole bar on every keystroke and caret move. The editor comes from the
  // closure, not the snapshot, so a bar handed another sheet's editor reads
  // that one straight away.
  const lit = useEditorState({ editor, selector: () => readBar(editor) });

  // Wherever the bar still scrolls sideways (touch, and the narrow docked
  // panes — a full-size overlay on a mouse wraps instead, see .doc-tb in
  // styles.css), say so: a fade on each edge that has more controls past it,
  // and a vertical mouse wheel scrolls it. The scrollbar is hidden, so without
  // these Find, Export, Zoom, Undo and Redo sat off-screen with the bar
  // appearing to end at the bookmark icon.
  const barRef = useRef(null);
  const onBarKeys = useToolbarRoving(barRef);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    const sync = () => {
      const max = bar.scrollWidth - bar.clientWidth;
      bar.classList.toggle('has-more-start', max > 1 && bar.scrollLeft > 1);
      bar.classList.toggle('has-more-end', max > 1 && bar.scrollLeft < max - 1);
      // A wrapped bar is taller than one row: the find bar hangs below
      // wherever it actually ends (see .doc-find), not at a fixed 52px.
      bar.parentElement?.style.setProperty('--doc-tb-bottom', `${bar.offsetTop + bar.offsetHeight}px`);
    };
    const onWheel = (e) => {
      if (bar.scrollWidth - bar.clientWidth <= 1) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // trackpad pans natively
      e.preventDefault();
      bar.scrollLeft += e.deltaY;
    };
    sync();
    bar.addEventListener('scroll', sync, { passive: true });
    bar.addEventListener('wheel', onWheel, { passive: false });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(bar);
    // The bar's own box doesn't change when a control inside it does (the Font
    // label going from "Inter" to "Playfair Display", the zoom readout), but
    // its scrollWidth does — watch the controls too, or the fades go stale
    // until the next scroll. Re-observing an observed element is a no-op.
    const observeControls = () => { for (const el of bar.children) ro?.observe(el); };
    observeControls();
    // Controls come and go with the mode (screenplay, view-only) — re-measure.
    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => { observeControls(); sync(); }) : null;
    mo?.observe(bar, { childList: true });
    return () => {
      bar.removeEventListener('scroll', sync);
      bar.removeEventListener('wheel', onWheel);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);

  const disabled = !editor;
  const customFonts = useCustomFonts();
  const recentFonts = useRecentFonts();
  // The Google catalogue, merged and sorted: built when the custom fonts
  // change, not on every render (it was most of what a keystroke cost here).
  const allFonts = useMemo(() => combineAllFonts(FONTS, customFonts), [customFonts]);
  const [fontsModalOpen, setFontsModalOpen] = useState(false);
  const setHeading = (val) => {
    if (!editor) return;
    // setParagraph / toggleHeading route through clearNodes → can throw on a
    // hardBreak in the selection. Guard so the editor never crashes.
    if (val === 'p') safeRun(editor.chain().focus().setParagraph(), 'doc-setParagraph');
    else safeRun(editor.chain().focus().toggleHeading({ level: Number(val[1]) }), 'doc-toggleHeading');
  };

  const setFont = (css, gfName, label) => {
    if (gfName) ensureGoogleFontLoaded(gfName);
    editor?.chain().focus().setFontFamily(css).run();
    if (label) addRecentFont({ name: label, css, gfName });
  };

  // Hover-preview support: stash the font that was active when the picker
  // opened so we can revert if the user closes without picking.
  const previewBaseRef = useRef(null);
  const previewFont = (css) => {
    if (!editor) return;
    if (previewBaseRef.current === null) {
      previewBaseRef.current = editor.getAttributes('textStyle')?.fontFamily ?? '';
    }
    // Re-focus the editor on every preview tick so the selection stays
    // visually highlighted while the user hovers fonts. Without this,
    // the browser greys out the selection (focus is technically on the
    // popover row), making it hard to see what's being restyled.
    if (css == null) {
      const base = previewBaseRef.current;
      if (base) editor.chain().focus().setMeta('addToHistory', false).setFontFamily(base).run();
      else      editor.chain().focus().setMeta('addToHistory', false).unsetFontFamily().run();
    } else {
      editor.chain().focus().setMeta('addToHistory', false).setFontFamily(css).run();
    }
  };
  const cancelPreview = () => {
    const base = previewBaseRef.current;
    if (base !== null && editor) {
      if (base) editor.chain().setMeta('addToHistory', false).setFontFamily(base).run();
      else      editor.chain().setMeta('addToHistory', false).unsetFontFamily().run();
    }
    previewBaseRef.current = null;
  };
  const commitFont = (entry) => {
    previewBaseRef.current = null;
    setFont(entry.css, entry.gfName || null, entry.label || entry.name);
  };
  const currentFontLabel = (() => {
    const all = [...recentFonts, ...allFonts];
    const hit = all.find(f => f.css === lit.fontFamily);
    return hit?.label || hit?.name || 'Font';
  })();
  // setScreenplayElement routes through commands.setNode → clearNodes when the
  // block type can't be set directly, which is the same RangeError path the
  // list/heading toggles below are guarded against. This <select> is the last
  // clearNodes route a user can still reach unguarded.
  const setScreenplayElement = (el) =>
    editor ? safeRun(editor.chain().focus().setScreenplayElement(el), 'doc:screenplay-element') : false;

  const setSize = (px) => editor?.chain().focus().setFontSize(`${px}px`).run();
  const setColor = (c) => editor?.chain().focus().setColor(c).run();
  const clearColor = () => editor?.chain().focus().unsetColor().run();

  // In screenplay mode the layout is element-driven; the prose formatting
  // controls (font/size/color/align/inline-marks/lists) are hidden because
  // they'd leak formatting that the Fountain/FDX/PDF exporters don't carry.
  const isScreenplay = docMode === 'screenplay';

  return (
    <div className="doc-tb" ref={barRef} role="toolbar" aria-label="Document formatting" aria-orientation="horizontal"
         onKeyDown={onBarKeys}>
      {canEdit && (<>
      {/* Click-to-open insert menu — only the things with no other toolbar home
          (image, table, divider, code, embed). Doc mode only: in screenplay mode
          the element <select> covers everything, so no "+". Portaled so the
          toolbar's overflow doesn't clip it. */}
      {!isScreenplay && (
        <DocInsertMenu editor={editor} disabled={disabled}
                       onInsertImage={onInsertImage}
                       onInsertBoardEmbed={onInsertBoardEmbed} />
      )}
      {onToggleScreenplay && (
        <button type="button"
                className={`doc-tb-pill doc-tb-screenplay-toggle${isScreenplay ? ' is-active' : ''}`}
                title={isScreenplay ? 'Screenplay mode on — click for a normal document' : 'Switch to screenplay mode'}
                aria-pressed={isScreenplay}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onToggleScreenplay()}>
          <Glyph as={Clapperboard} size={14} />
          <span className="doc-tb-pill-label">Screenplay</span>
        </button>
      )}
      {docMode === 'screenplay' ? (
        <select className="doc-tb-select doc-tb-select--sp" value={lit.spElement || 'action'} disabled={disabled || !lit.spElement}
                onChange={(e) => setScreenplayElement(e.target.value)}
                title="Screenplay element" aria-label="Screenplay element">
          {SP_ELEMENTS.map(el => <option key={el} value={el}>{SP_LABELS[el] || el}</option>)}
        </select>
      ) : (
        <select className="doc-tb-select" value={lit.heading} disabled={disabled}
                onChange={(e) => setHeading(e.target.value)}
                title="Paragraph style" aria-label="Paragraph style">
          <option value="" disabled hidden>—</option>
          {HEADING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {!isScreenplay && onTogglePageless && (
        <button type="button"
                className={`doc-tb-pill doc-tb-pages-toggle${!pageless ? ' is-active' : ''}`}
                title={pageless ? 'Pageless — one continuous sheet. Click to switch to pages.'
                  : pagesShownContinuous ? 'Pages — real 8.5×11 pages in exports and on wider screens; a phone shows the text continuous. Click for pageless.'
                  : 'Pages — real 8.5×11 pages. Click for a continuous (pageless) layout.'}
                aria-pressed={!pageless}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onTogglePageless()}>
          <Glyph as={Files} size={14} />
          <span className="doc-tb-pill-label">Pages</span>
        </button>
      )}

      {isScreenplay && onToggleTitlePage && (
        <button type="button"
                className={`doc-tb-pill doc-tb-titlepage-toggle${titlePageEnabled ? ' is-active' : ''}`}
                title={titlePageEnabled ? 'Title page on — click to remove it' : 'Add a title page'}
                aria-pressed={titlePageEnabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onToggleTitlePage()}>
          <Glyph as={FileText} size={14} />
          <span className="doc-tb-pill-label">Title Page</span>
        </button>
      )}

      {isScreenplay && onSetSceneNumbersShow && (
        <SceneNumberToggle
          show={sceneNumbersShow}
          onSetShow={onSetSceneNumbersShow}
          disabled={disabled}
        />
      )}

      {isScreenplay && (
        <Btn title="Dual dialogue — pair this speech with the one above" label="Dual dialogue"
             active={lit.dual}
             disabled={disabled || !lit.spElement}
             onClick={() => editor.chain().focus().toggleDualDialogue().run()}>
          <Glyph as={Columns2} size={14} />
        </Btn>
      )}

      {!isScreenplay && (<>
        <FontPickerDropdown
          currentLabel={currentFontLabel}
          recentFonts={recentFonts}
          allFonts={allFonts}
          onPreview={previewFont}
          onCommit={commitFont}
          onCancel={cancelPreview}
          onManage={() => setFontsModalOpen(true)}
          disabled={disabled}
        />

        <SizeInput
          value={lit.fontSize}
          presets={SIZES}
          className="doc-tb-size-combo"
          disabled={disabled}
          onCommit={(px) => setSize(px)}
        />

        <span className="doc-tb-sep" aria-hidden="true" />

        <Btn title="Bold (⌘B)" label="Bold" keys="Mod+B" active={lit.bold} disabled={disabled}
             onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Btn>
        <Btn title="Italic (⌘I)" label="Italic" keys="Mod+I" active={lit.italic} disabled={disabled}
             onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></Btn>
        <Btn title="Underline (⌘U)" label="Underline" keys="Mod+U" active={lit.underline} disabled={disabled}
             onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
        <Btn title="Strike" active={lit.strike} disabled={disabled}
             onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
        <Btn title="Inline code" active={lit.code} disabled={disabled}
             onClick={() => editor.chain().focus().toggleCode().run()}><code style={{ fontSize: 11 }}>{'<>'}</code></Btn>
        <Btn title="Highlight (⌘⇧H)" label="Highlight" keys="Mod+Shift+H" active={lit.highlight} disabled={disabled}
             onClick={() => editor.chain().focus().toggleHighlight().run()}><mark style={{ background: '#fff09a', color: '#222', padding: '0 3px', borderRadius: 2, fontSize: 11 }}>H</mark></Btn>
        <Btn title="Clear formatting (⌘\)" label="Clear formatting" keys="Mod+\" disabled={disabled}
             onClick={() => editor.chain().focus().clearFormatting().run()}><span className="tb-clear-fmt">T<sub>x</sub></span></Btn>

        <span className="doc-tb-sep" aria-hidden="true" />

        <ColorBtn title="Text color" disabled={disabled}
                  onPick={setColor} onClear={clearColor} />

        <span className="doc-tb-sep" aria-hidden="true" />

        <Btn title="Bulleted list (⌘⇧8)" label="Bulleted list" keys="Mod+Shift+8" active={lit.bulletList} disabled={disabled}
             onClick={() => safeRun(editor.chain().focus().toggleBulletList(), 'doc-list:ul')}><Glyph as={List} size={14} /></Btn>
        <Btn title="Numbered list (⌘⇧7)" label="Numbered list" keys="Mod+Shift+7" active={lit.orderedList} disabled={disabled}
             onClick={() => safeRun(editor.chain().focus().toggleOrderedList(), 'doc-list:ol')}><Glyph as={ListOrdered} size={14} /></Btn>
        <Btn title="Task list (⌘⇧9)" label="Task list" keys="Mod+Shift+9" active={lit.taskList} disabled={disabled}
             onClick={() => safeRun(editor.chain().focus().toggleTaskList(), 'doc-list:task')}><Glyph as={ListChecks} size={14} /></Btn>
        <Btn title="Quote" active={lit.blockquote} disabled={disabled}
             onClick={() => safeRun(editor.chain().focus().toggleBlockquote(), 'doc-blockquote')}><Glyph as={Quote} size={14} /></Btn>

        <span className="doc-tb-sep" aria-hidden="true" />

        <Btn title="Align left" active={lit.align === 'left'} disabled={disabled}
             onClick={() => editor.chain().focus().setTextAlign('left').run()}><Glyph as={AlignLeft} size={14} /></Btn>
        <Btn title="Align center" active={lit.align === 'center'} disabled={disabled}
             onClick={() => editor.chain().focus().setTextAlign('center').run()}><Glyph as={AlignCenter} size={14} /></Btn>
        <Btn title="Align right" active={lit.align === 'right'} disabled={disabled}
             onClick={() => editor.chain().focus().setTextAlign('right').run()}><Glyph as={AlignRight} size={14} /></Btn>
      </>)}

      <span className="doc-tb-sep" aria-hidden="true" />

      <Btn title={(!disabled && lit.hasSelection) ? 'Add link (⌘K)' : 'Select text to link'}
           label="Add link" keys="Mod+K"
           disabled={disabled || !lit.hasSelection}
           onClick={() => onOpenLink?.(editor)}><Glyph as={LinkPh} size={14} /></Btn>
      <Btn title="Bookmark this spot" disabled={disabled}
           onClick={() => onInsertBookmark?.(editor)}><Glyph as={Bookmark} size={14} /></Btn>
      <Btn title={(!disabled && lit.hasSelection) ? 'Add comment (⌘⌥M)' : 'Select text to comment on'}
           label="Add comment" keys="Mod+Alt+M"
           disabled={disabled || !lit.hasSelection}
           onClick={() => onAddComment?.()}><Glyph as={MessageCircle} size={14} /></Btn>
      </>)}
      <Btn title="Find (⌘F)" label="Find" keys="Mod+F" disabled={disabled}
           onClick={() => onOpenFind?.()}><Glyph as={Search} size={14} /></Btn>
      {canExport && <DocExportMenu editor={editor} docName={docName} ydoc={ydoc} scope={scope} docMode={docMode} canEdit={canEdit} />}

      <span className="doc-tb-spacer" />

      {onZoomIn && (
        <span className="doc-tb-zoom" title="Zoom (⌘+ / ⌘− / ⌘0)" role="group" aria-label="Zoom">
          <button className="doc-tb-btn" onClick={onZoomOut} title="Zoom out (⌘−)" aria-label="Zoom out"
                  aria-keyshortcuts={ariaKeys('Mod+-')}>−</button>
          {/* In fit-to-width the percentage is an implementation detail (it
              tracks the viewport), so name the MODE instead. Tapping it from a
              manual zoom returns to fit. */}
          <button className={`doc-tb-btn doc-tb-zoom-label${fitMode ? ' is-active' : ''}`}
                  onClick={onZoomReset}
                  title={fitMode ? `Fit to width (${Math.round((zoom || 1) * 100)}%)` : 'Reset zoom (⌘0)'}
                  // What it shows, then what it does.
                  aria-label={fitMode ? 'Fit to width' : `${Math.round((zoom || 1) * 100)}% — reset zoom`}
                  aria-keyshortcuts={ariaKeys('Mod+0')}>{fitMode ? 'Fit' : `${Math.round((zoom || 1) * 100)}%`}</button>
          <button className="doc-tb-btn" onClick={onZoomIn} title="Zoom in (⌘+)" aria-label="Zoom in"
                  aria-keyshortcuts={ariaKeys('Mod+=')}>+</button>
        </span>
      )}

      {canEdit && (<>
      <Btn title="Undo (⌘Z)" label="Undo" keys="Mod+Z" disabled={disabled}
           onClick={() => editor.chain().focus().undo().run()}><Glyph as={Undo} size={14} /></Btn>
      <Btn title="Redo (⌘⇧Z)" label="Redo" keys="Mod+Shift+Z" disabled={disabled}
           onClick={() => editor.chain().focus().redo().run()}><Glyph as={Redo} size={14} /></Btn>
      </>)}

      <CustomFontsModal open={fontsModalOpen} onClose={() => setFontsModalOpen(false)} />
    </div>
  );
}

// Everything the bar lights, as one flat object. `heading` is '' (a neutral
// placeholder) when the caret is in a block the style picker can't name —
// code, a quote, a list — rather than claiming "Body".
const NO_BAR = {
  heading: 'p', spElement: '', dual: false, fontFamily: '', fontSize: null,
  bold: false, italic: false, underline: false, strike: false, code: false, highlight: false,
  bulletList: false, orderedList: false, taskList: false, blockquote: false,
  align: 'left', hasSelection: false,
};
function readBar(editor) {
  if (!editor || editor.isDestroyed) return NO_BAR;
  const on = (name, attrs) => editor.isActive(name, attrs) || false;
  let heading = '';
  for (let l = 1; l <= 6 && !heading; l++) if (on('heading', { level: l })) heading = 'h' + l;
  if (!heading) {
    heading = (on('codeBlock') || on('blockquote') || on('bulletList') || on('orderedList') || on('taskList')) ? '' : 'p';
  }
  const inSp = on('screenplayBlock');
  const sp = inSp ? (editor.getAttributes('screenplayBlock') || {}) : {};
  const style = editor.getAttributes('textStyle') || {};
  const px = style.fontSize ? parseInt(style.fontSize, 10) : NaN;
  return {
    heading,
    // Screenplay element <select> (replaces the block-style picker in script mode).
    spElement: inSp ? (sp.element || 'action') : '',
    dual: inSp && !!sp.dual,
    fontFamily: style.fontFamily || '',
    fontSize: Number.isFinite(px) ? px : null,
    bold: on('bold'),
    italic: on('italic'),
    underline: on('underline'),
    strike: on('strike'),
    code: on('code'),
    highlight: on('highlight'),
    bulletList: on('bulletList'),
    orderedList: on('orderedList'),
    taskList: on('taskList'),
    blockquote: on('blockquote'),
    align: on({ textAlign: 'center' }) ? 'center' : on({ textAlign: 'right' }) ? 'right'
      : on({ textAlign: 'justify' }) ? 'justify' : 'left',
    hasSelection: !editor.state.selection.empty,
  };
}

// `title` is the tooltip, with the shortcut in it for the eye. A screen reader
// says `label` (the title, when there's no other) and hears the shortcut from
// aria-keyshortcuts. A toggle, one given `active`, says whether it's on.
function Btn({ children, active, disabled, onClick, title, label = title, keys }) {
  return (
    <button className={`doc-tb-btn ${active ? 'is-active' : ''}`}
            disabled={disabled}
            title={title}
            aria-label={label}
            aria-keyshortcuts={keys ? ariaKeys(keys) : undefined}
            aria-pressed={active === undefined ? undefined : !!active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}>
      {children}
    </button>
  );
}

// Scene-number control: a plain on/off toggle. Numbers auto-number (1, 2, 3…)
// at each scene heading when shown; visibility lives in docMeta. (Revision
// A/B locking still rides on the scene blocks' sceneNumber attr — kept for FDX
// import — but is no longer a toolbar menu, which read as broken.)
function SceneNumberToggle({ show, onSetShow, disabled }) {
  return (
    <button type="button"
            className={`doc-tb-pill doc-tb-scenenum-toggle${show ? ' is-active' : ''}`}
            disabled={disabled}
            title={show ? 'Scene numbers — on' : 'Scene numbers — off'}
            aria-pressed={show}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSetShow(!show)}>
      <Glyph as={Hash} size={14} />
      <span className="doc-tb-pill-label">Scene #</span>
    </button>
  );
}

function ColorBtn({ disabled, onPick, onClear, title }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Same fix as DocExportMenu: the toolbar clips inline absolute popups, so the
  // swatch grid is portaled to <body> and placed against the button
  // (hooks/useAnchoredPopover).
  const pop = useAnchoredPopover({ open, onClose: () => setOpen(false), anchorRef: wrapRef });

  return (
    <span className="doc-tb-colorwrap" ref={wrapRef}>
      <button className="doc-tb-btn" disabled={disabled} title={title}
              aria-label={title} aria-haspopup="true" aria-expanded={open}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(o => !o)}>
        <svg width="14" height="14" viewBox="0 0 14 14">
          <text x="7" y="9" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="ui-serif" fill="currentColor">A</text>
          <rect x="3" y="11" width="8" height="2" fill="currentColor" />
        </svg>
      </button>
      {open && createPortal(
        <div className="doc-tb-colorpop" ref={pop.popRef} style={pop.style}
             onMouseDown={(e) => e.preventDefault()}>
          {COLORS.map(c => (
            <button key={c} className="doc-tb-sw" style={{ background: c }}
                    title={c} aria-label={`Color ${c}`}
                    onClick={() => { onPick(c); setOpen(false); }} />
          ))}
          <button className="doc-tb-sw doc-tb-sw-x" title="Default" aria-label="Default color"
                  onClick={() => { onClear(); setOpen(false); }}>×</button>
        </div>,
        document.body
      )}
    </span>
  );
}
