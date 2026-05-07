// Persistent top toolbar for the doc editor. Operates on whatever Tiptap
// editor instance the parent passes in; gracefully renders disabled buttons
// when no editor is mounted (e.g. between page switches).

import { useEffect, useRef, useState } from 'react';
import { DocExportMenu } from './DocExportMenu.jsx';
import { CustomFontsModal } from './CustomFontsModal.jsx';
import { FontPickerDropdown } from './FontPickerDropdown.jsx';
import { useCustomFonts, useRecentFonts } from '../hooks/useCustomFonts.js';
import { combineAllFonts, ensureGoogleFontLoaded } from '../lib/googleFonts.js';
import { addRecentFont } from '../lib/customFonts.js';

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

export function DocToolbar({ editor, onInsertBookmark, onOpenFind, docName, onOpenLink, onAddComment }) {
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
  const setSize = (px) => editor?.chain().focus().setFontSize(`${px}px`).run();
  const setColor = (c) => editor?.chain().focus().setColor(c).run();
  const clearColor = () => editor?.chain().focus().unsetColor().run();

  return (
    <div className="doc-tb">
      <select className="doc-tb-select" value={headingValue} disabled={disabled}
              onChange={(e) => setHeading(e.target.value)}
              title="Block style">
        {HEADING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

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

      <select className="doc-tb-select" disabled={disabled}
              value={(() => {
                const fs = editor?.getAttributes('textStyle')?.fontSize;
                if (!fs) return '';
                const px = parseInt(fs, 10);
                return SIZES.includes(px) ? String(px) : '';
              })()}
              onChange={(e) => setSize(e.target.value)}
              title="Font size">
        <option value="" disabled>Size</option>
        {SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
      </select>

      <span className="doc-tb-sep" />

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

      <span className="doc-tb-sep" />

      <ColorBtn title="Text color" disabled={disabled}
                onPick={setColor} onClear={clearColor} />

      <span className="doc-tb-sep" />

      <Btn title="Bulleted list (⌘⇧8)" active={isActive('bulletList')} disabled={disabled}
           onClick={() => editor.chain().focus().toggleBulletList().run()}><Icon.UlBars /></Btn>
      <Btn title="Numbered list (⌘⇧7)" active={isActive('orderedList')} disabled={disabled}
           onClick={() => editor.chain().focus().toggleOrderedList().run()}><Icon.OlBars /></Btn>
      <Btn title="Task list (⌘⇧9)" active={isActive('taskList')} disabled={disabled}
           onClick={() => editor.chain().focus().toggleTaskList().run()}><Icon.Task /></Btn>
      <Btn title="Quote" active={isActive('blockquote')} disabled={disabled}
           onClick={() => editor.chain().focus().toggleBlockquote().run()}><Icon.Quote /></Btn>

      <span className="doc-tb-sep" />

      <Btn title="Align left" active={isActive({ textAlign: 'left' })} disabled={disabled}
           onClick={() => editor.chain().focus().setTextAlign('left').run()}><Icon.AlignL /></Btn>
      <Btn title="Align center" active={isActive({ textAlign: 'center' })} disabled={disabled}
           onClick={() => editor.chain().focus().setTextAlign('center').run()}><Icon.AlignC /></Btn>
      <Btn title="Align right" active={isActive({ textAlign: 'right' })} disabled={disabled}
           onClick={() => editor.chain().focus().setTextAlign('right').run()}><Icon.AlignR /></Btn>

      <span className="doc-tb-sep" />

      <Btn title="Add link (⌘K)" disabled={disabled}
           onClick={() => onOpenLink?.(editor)}><Icon.Link /></Btn>
      <Btn title="Bookmark this spot" disabled={disabled}
           onClick={() => onInsertBookmark?.(editor)}><Icon.Bookmark /></Btn>
      <Btn title="Add comment (⌘⌥M)" disabled={disabled || !editor || editor.state.selection.empty}
           onClick={() => onAddComment?.()}><Icon.Comment /></Btn>
      <Btn title="Find (⌘F)" disabled={disabled}
           onClick={() => onOpenFind?.()}><Icon.Search /></Btn>
      <DocExportMenu editor={editor} docName={docName} />

      <span className="doc-tb-spacer" />

      <Btn title="Undo (⌘Z)" disabled={disabled}
           onClick={() => editor.chain().focus().undo().run()}><Icon.Undo /></Btn>
      <Btn title="Redo (⌘⇧Z)" disabled={disabled}
           onClick={() => editor.chain().focus().redo().run()}><Icon.Redo /></Btn>

      <CustomFontsModal open={fontsModalOpen} onClose={() => setFontsModalOpen(false)} />
    </div>
  );
}

const SVG = (children) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
const Icon = {
  UlBars:   () => SVG(<><circle cx="3" cy="4" r=".7" fill="currentColor" stroke="none" /><circle cx="3" cy="7" r=".7" fill="currentColor" stroke="none" /><circle cx="3" cy="10" r=".7" fill="currentColor" stroke="none" /><path d="M6 4 H12 M6 7 H12 M6 10 H12" /></>),
  OlBars:   () => SVG(<><text x="1.4" y="5.5" fontSize="3.2" fontFamily="ui-monospace" stroke="none" fill="currentColor">1</text><text x="1.4" y="9" fontSize="3.2" fontFamily="ui-monospace" stroke="none" fill="currentColor">2</text><text x="1.4" y="12.5" fontSize="3.2" fontFamily="ui-monospace" stroke="none" fill="currentColor">3</text><path d="M6 4 H12 M6 7 H12 M6 10 H12" /></>),
  Task:     () => SVG(<><rect x="2" y="2.5" width="4" height="4" rx="1" /><path d="M3 4.5 L4 5.5 L5.5 3.8" /><path d="M8 4.5 H12" /><rect x="2" y="8.5" width="4" height="4" rx="1" /><path d="M8 10.5 H12" /></>),
  Quote:    () => SVG(<><path d="M2 5 Q2 3 4 3 V6 H2 V5 Q2 7 4 8" /><path d="M8 5 Q8 3 10 3 V6 H8 V5 Q8 7 10 8" /></>),
  AlignL:   () => SVG(<><path d="M2 3 H12 M2 6 H8 M2 9 H12 M2 12 H8" /></>),
  AlignC:   () => SVG(<><path d="M2 3 H12 M4 6 H10 M2 9 H12 M4 12 H10" /></>),
  AlignR:   () => SVG(<><path d="M2 3 H12 M6 6 H12 M2 9 H12 M6 12 H12" /></>),
  Link:     () => SVG(<><path d="M5.5 8.5 L8.5 5.5" /><path d="M6 4 L4 4 A3 3 0 0 0 4 10 L6 10" /><path d="M8 4 L10 4 A3 3 0 0 1 10 10 L8 10" /></>),
  Bookmark: () => SVG(<><path d="M4 2 H10 V13 L7 10 L4 13 Z" /></>),
  Search:   () => SVG(<><circle cx="6" cy="6" r="3.5" /><path d="M9 9 L12 12" /></>),
  Undo:     () => SVG(<><path d="M3 6 H8.5 A3 3 0 0 1 8.5 12 H6.5" /><path d="M3 6 L5.5 3.5 M3 6 L5.5 8.5" /></>),
  Redo:     () => SVG(<><path d="M11 6 H5.5 A3 3 0 0 0 5.5 12 H7.5" /><path d="M11 6 L8.5 3.5 M11 6 L8.5 8.5" /></>),
  Comment:  () => SVG(<><path d="M2 4 A1 1 0 0 1 3 3 H11 A1 1 0 0 1 12 4 V9 A1 1 0 0 1 11 10 H6 L4 12 V10 H3 A1 1 0 0 1 2 9 Z" /></>),
};

function Btn({ children, active, disabled, onClick, title }) {
  return (
    <button className={`doc-tb-btn ${active ? 'is-active' : ''}`}
            disabled={disabled}
            title={title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}>
      {children}
    </button>
  );
}

function ColorBtn({ disabled, onPick, onClear, title }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="doc-tb-colorwrap">
      <button className="doc-tb-btn" disabled={disabled} title={title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(o => !o)}>
        <svg width="14" height="14" viewBox="0 0 14 14">
          <text x="7" y="9" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="ui-serif" fill="currentColor">A</text>
          <rect x="3" y="11" width="8" height="2" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="doc-tb-colorpop" onMouseDown={(e) => e.preventDefault()}>
          {COLORS.map(c => (
            <button key={c} className="doc-tb-sw" style={{ background: c }}
                    onClick={() => { onPick(c); setOpen(false); }} />
          ))}
          <button className="doc-tb-sw doc-tb-sw-x" title="Default"
                  onClick={() => { onClear(); setOpen(false); }}>×</button>
        </div>
      )}
    </span>
  );
}

function promptLink(editor) {
  const previous = editor.getAttributes('link').href || '';
  // eslint-disable-next-line no-alert
  const url = window.prompt('URL', previous);
  if (url === null) return;
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}
