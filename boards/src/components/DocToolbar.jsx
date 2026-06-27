// Persistent top toolbar for the doc editor. Operates on whatever Tiptap
// editor instance the parent passes in; gracefully renders disabled buttons
// when no editor is mounted (e.g. between page switches).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DocExportMenu } from './DocExportMenu.jsx';
import { DocInsertMenu } from './DocInsertMenu.jsx';
import { CustomFontsModal } from './CustomFontsModal.jsx';
import { FontPickerDropdown } from './FontPickerDropdown.jsx';
import { SizeInput } from './SizeInput.jsx';
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
                               ydoc = null, scope = null, docMode = 'doc', authorName = '', onToggleScreenplay,
                               titlePageEnabled = false, onToggleTitlePage,
                               sceneNumbersShow = false, onSetSceneNumbersShow,
                               pageless = true, onTogglePageless,
                               zoom = 1, onZoomIn, onZoomOut, onZoomReset }) {
  // Subscribe to editor updates so the active-state of buttons stays accurate.
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const tick = () => force(n => n + 1);
    editor.on('selectionUpdate', tick);
    editor.on('transaction', tick);
    return () => {
      editor.off('selectionUpdate', tick);
      editor.off('transaction', tick);
    };
  }, [editor]);

  const disabled = !editor;
  const customFonts = useCustomFonts();
  const recentFonts = useRecentFonts();
  const allFonts = combineAllFonts(FONTS, customFonts);
  const [fontsModalOpen, setFontsModalOpen] = useState(false);
  const isActive = (name, attrs) => editor?.isActive(name, attrs) || false;

  const headingValue = (() => {
    for (let l = 1; l <= 6; l++) if (isActive('heading', { level: l })) return 'h' + l;
    // Don't claim "Body" when the caret is in a block this control can't
    // represent (code/quote/lists) — show a neutral placeholder instead.
    if (isActive('codeBlock') || isActive('blockquote')
        || isActive('bulletList') || isActive('orderedList') || isActive('taskList')) return '';
    return 'p';
  })();
  const setHeading = (val) => {
    if (!editor) return;
    if (val === 'p') editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: Number(val[1]) }).run();
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
  const currentFontCss = editor?.getAttributes('textStyle')?.fontFamily || '';
  const currentFontLabel = (() => {
    const all = [...recentFonts, ...allFonts];
    const hit = all.find(f => f.css === currentFontCss);
    return hit?.label || hit?.name || 'Font';
  })();
  // Screenplay element <select> (replaces the block-style picker in script mode).
  const screenplayElement = editor?.isActive('screenplayBlock')
    ? (editor.getAttributes('screenplayBlock')?.element || 'action')
    : '';
  const setScreenplayElement = (el) => editor?.chain().focus().setScreenplayElement(el).run();

  const setSize = (px) => editor?.chain().focus().setFontSize(`${px}px`).run();
  const setColor = (c) => editor?.chain().focus().setColor(c).run();
  const clearColor = () => editor?.chain().focus().unsetColor().run();

  // In screenplay mode the layout is element-driven; the prose formatting
  // controls (font/size/color/align/inline-marks/lists) are hidden because
  // they'd leak formatting that the Fountain/FDX/PDF exporters don't carry.
  const isScreenplay = docMode === 'screenplay';

  return (
    <div className="doc-tb" role="toolbar" aria-label="Document formatting" aria-orientation="horizontal">
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
        <select className="doc-tb-select" value={screenplayElement || 'action'} disabled={disabled || !editor?.isActive('screenplayBlock')}
                onChange={(e) => setScreenplayElement(e.target.value)}
                title="Screenplay element" aria-label="Screenplay element">
          {SP_ELEMENTS.map(el => <option key={el} value={el}>{SP_LABELS[el] || el}</option>)}
        </select>
      ) : (
        <select className="doc-tb-select" value={headingValue} disabled={disabled}
                onChange={(e) => setHeading(e.target.value)}
                title="Paragraph style" aria-label="Paragraph style">
          <option value="" disabled hidden>—</option>
          {HEADING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {!isScreenplay && onTogglePageless && (
        <button type="button"
                className={`doc-tb-pill doc-tb-pages-toggle${!pageless ? ' is-active' : ''}`}
                title={pageless ? 'Pageless — one continuous sheet. Click to switch to pages.' : 'Pages — real 8.5×11 pages. Click for a continuous (pageless) layout.'}
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
        <Btn title="Dual dialogue — pair this speech with the one above"
             active={isActive('screenplayBlock') && !!editor?.getAttributes('screenplayBlock')?.dual}
             disabled={disabled || !editor?.isActive('screenplayBlock')}
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
          value={(() => {
            const fs = editor?.getAttributes('textStyle')?.fontSize;
            const px = fs ? parseInt(fs, 10) : NaN;
            return Number.isFinite(px) ? px : null;
          })()}
          presets={SIZES}
          className="doc-tb-size-combo"
          disabled={disabled}
          onCommit={(px) => setSize(px)}
        />

        <span className="doc-tb-sep" aria-hidden="true" />

        <Btn title="Bold (⌘B)" active={isActive('bold')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Btn>
        <Btn title="Italic (⌘I)" active={isActive('italic')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></Btn>
        <Btn title="Underline (⌘U)" active={isActive('underline')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
        <Btn title="Strike" active={isActive('strike')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
        <Btn title="Inline code" active={isActive('code')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleCode().run()}><code style={{ fontSize: 11 }}>{'<>'}</code></Btn>
        <Btn title="Highlight (⌘⇧H)" active={isActive('highlight')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleHighlight().run()}><mark style={{ background: '#fff09a', color: '#222', padding: '0 3px', borderRadius: 2, fontSize: 11 }}>H</mark></Btn>

        <span className="doc-tb-sep" aria-hidden="true" />

        <ColorBtn title="Text color" disabled={disabled}
                  onPick={setColor} onClear={clearColor} />

        <span className="doc-tb-sep" aria-hidden="true" />

        <Btn title="Bulleted list (⌘⇧8)" active={isActive('bulletList')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleBulletList().run()}><Glyph as={List} size={14} /></Btn>
        <Btn title="Numbered list (⌘⇧7)" active={isActive('orderedList')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleOrderedList().run()}><Glyph as={ListOrdered} size={14} /></Btn>
        <Btn title="Task list (⌘⇧9)" active={isActive('taskList')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleTaskList().run()}><Glyph as={ListChecks} size={14} /></Btn>
        <Btn title="Quote" active={isActive('blockquote')} disabled={disabled}
             onClick={() => editor.chain().focus().toggleBlockquote().run()}><Glyph as={Quote} size={14} /></Btn>

        <span className="doc-tb-sep" aria-hidden="true" />

        <Btn title="Align left" active={isActive({ textAlign: 'left' }) || (!isActive({ textAlign: 'center' }) && !isActive({ textAlign: 'right' }) && !isActive({ textAlign: 'justify' }))} disabled={disabled}
             onClick={() => editor.chain().focus().setTextAlign('left').run()}><Glyph as={AlignLeft} size={14} /></Btn>
        <Btn title="Align center" active={isActive({ textAlign: 'center' })} disabled={disabled}
             onClick={() => editor.chain().focus().setTextAlign('center').run()}><Glyph as={AlignCenter} size={14} /></Btn>
        <Btn title="Align right" active={isActive({ textAlign: 'right' })} disabled={disabled}
             onClick={() => editor.chain().focus().setTextAlign('right').run()}><Glyph as={AlignRight} size={14} /></Btn>
      </>)}

      <span className="doc-tb-sep" aria-hidden="true" />

      <Btn title="Add link (⌘K)" disabled={disabled}
           onClick={() => onOpenLink?.(editor)}><Glyph as={LinkPh} size={14} /></Btn>
      <Btn title="Bookmark this spot" disabled={disabled}
           onClick={() => onInsertBookmark?.(editor)}><Glyph as={Bookmark} size={14} /></Btn>
      <Btn title={(!disabled && editor && !editor.state.selection.empty) ? 'Add comment (⌘⌥M)' : 'Select text to comment on'}
           disabled={disabled || !editor || editor.state.selection.empty}
           onClick={() => onAddComment?.()}><Glyph as={MessageCircle} size={14} /></Btn>
      <Btn title="Find (⌘F)" disabled={disabled}
           onClick={() => onOpenFind?.()}><Glyph as={Search} size={14} /></Btn>
      <DocExportMenu editor={editor} docName={docName} ydoc={ydoc} scope={scope} docMode={docMode} authorName={authorName} />

      <span className="doc-tb-spacer" />

      {onZoomIn && (
        <span className="doc-tb-zoom" title="Zoom (⌘+ / ⌘− / ⌘0)">
          <button className="doc-tb-btn" onClick={onZoomOut} title="Zoom out (⌘−)" aria-label="Zoom out">−</button>
          <button className="doc-tb-btn doc-tb-zoom-label"
                  onClick={onZoomReset}
                  title="Reset zoom (⌘0)" aria-label="Reset zoom">{Math.round((zoom || 1) * 100)}%</button>
          <button className="doc-tb-btn" onClick={onZoomIn} title="Zoom in (⌘+)" aria-label="Zoom in">+</button>
        </span>
      )}

      <Btn title="Undo (⌘Z)" disabled={disabled}
           onClick={() => editor.chain().focus().undo().run()}><Glyph as={Undo} size={14} /></Btn>
      <Btn title="Redo (⌘⇧Z)" disabled={disabled}
           onClick={() => editor.chain().focus().redo().run()}><Glyph as={Redo} size={14} /></Btn>

      <CustomFontsModal open={fontsModalOpen} onClose={() => setFontsModalOpen(false)} />
    </div>
  );
}

function Btn({ children, active, disabled, onClick, title }) {
  return (
    <button className={`doc-tb-btn ${active ? 'is-active' : ''}`}
            disabled={disabled}
            title={title}
            aria-label={title}
            aria-pressed={active ? true : undefined}
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
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const popRef = useRef(null);

  // Same fix as DocExportMenu: the toolbar clips inline absolute popups, so the
  // swatch grid is portaled to <body> and positioned (fixed) against the button.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const GAP = 6, PAD = 8;
    const measure = () => {
      const r = wrapRef.current.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const pw = popRef.current?.offsetWidth || 211;
      const ph = popRef.current?.offsetHeight || 0;
      const spaceBelow = vh - r.bottom - PAD;
      const placeAbove = ph > 0 && spaceBelow < ph && (r.top - PAD) > spaceBelow;
      const top = placeAbove ? Math.max(PAD, r.top - ph - GAP) : r.bottom + GAP;
      const left = Math.min(Math.max(PAD, r.left), vw - pw - PAD);
      setPos({ top, left });
    };
    measure();
    const id = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', measure); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
        <div className="doc-tb-colorpop" ref={popRef}
             style={{ position: 'fixed', top: pos.top, left: pos.left }}
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
