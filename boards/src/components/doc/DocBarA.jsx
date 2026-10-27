import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { Btn, Group, Swatch, Toolbar } from '../toolbar/Toolbar.jsx';
import { Menu, MenuButton, MenuHead, MenuItem, MenuSep, useMenu } from '../toolbar/Menu.jsx';
import { Icon } from '../Icon.jsx';
import { SizeInput } from '../SizeInput.jsx';
import { CustomFontsModal } from '../CustomFontsModal.jsx';
import { insertItems } from '../DocInsertMenu.jsx';
import { useDocExport } from '../DocExportMenu.jsx';
import { useDocFont } from '../../hooks/useDocFont.js';
import { useCustomFonts, useRecentFonts } from '../../hooks/useCustomFonts.js';
import { useKeyboardInset } from '../../hooks/useKeyboardInset.js';
import { useMessagesUi } from '../../hooks/useOpenDm.js';
import { ELEMENTS, ELEMENT_LABELS } from '../docExtensions/screenplay/screenplayFlow.js';
import { combineAllFonts, ensureGoogleFontLoaded } from '../../lib/googleFonts.js';
import { safeRun } from '../../lib/safeEditorCmd.js';
import { DOC_BAR_SIZES, docBarFit, docBarGroups, docBarPhoneGroups } from '../../lib/docBarFold.js';
import { docCounts } from '../../lib/docCounts.js';
import { DOC_COLORS, FONTS, HEADING_OPTIONS, SIZES, readBar } from '../../lib/docBarState.js';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, BookmarkSimple, ChatCircleText, ChatsCircle, Clapperboard, Code,
  CodeBlock, DownloadSimple, Eraser, FileHtml, FilePdf, FileText, Files, HighlighterCircle, Image, Italic, Keyboard, LayoutGrid, Link,
  List, ListChecks, ListOrdered, MagnifyingGlassPlus, MarkdownLogo, Minus, MoreHorizontal, PanelRight, Plus, Printer, Quote,
  Search, Strikethrough, Table, TextAUnderline, TextHOne, Type, Underline, Undo, Redo,
} from '../../lib/icons.js';

// The doc's one row of tools in the look the owner picked on 2026-10-21
// (direction A, with C's side panel; the toolbar canvas's A-doc frame):
//
//   Doc ▾ | ↶ ↷ | Body ▾ Serif ▾ 16 ▾ | B I U S </> A▾ ⌫ | • 1. ☑ ≡▾ | 🔗 💬 | +▾ | 🔍 ⋯
//
// A screenplay's (AC-script) is shorter: its element, title page, scene
// numbers and dual dialogue are the side panel's Elements, so
//
//   Screenplay ▾ | ↶ ↷ | 🔗 💬 🔖 | ⋯
//
// It is always one row. As its room narrows (the side panel open, a pane
// beside another doc, docked) groups fold into ⋯, in lib/docBarFold.js's
// order (under a finger, its own: an iPad has no ⌘F, so Find stays longer),
// and ⋯ then lists them under Text, with Layout and Export as submenus. A
// reader's bar is Find, the zoom and Export.
//
// On a phone (`phone`; mockup A-phone) the row rides on the keyboard while
// the text has the focus, and scrolls sideways rather than fold:
//
//   Body ▾ | B I U | • 1. ☑ | 🔗 💬 | + ⋯ ‖ ⌨
//
// its ⋯ the text's other tools, and ⌨ putting the keyboard away. What the
// doc's ⋯ holds besides is the header's ⋯ there (DocMoreA, below).
//
// Every control runs an editor command on the bar's state
// (lib/docBarState.js), and keeps the caret in the text: a press doesn't take
// the focus, and nor do its menus (Menu's keepFocus).
// ⌥F10 in the text comes to the bar and Escape goes back (Toolbar's `text`).

const keep = (e) => e.preventDefault();

const HEADINGS = HEADING_OPTIONS.map((o, i) => ({ ...o, keys: `Mod+Alt+${i}` }));
const ALIGNS = [
  { value: 'left', label: 'Left', icon: AlignLeft, keys: 'Mod+Shift+L' },
  { value: 'center', label: 'Centre', icon: AlignCenter, keys: 'Mod+Shift+E' },
  { value: 'right', label: 'Right', icon: AlignRight, keys: 'Mod+Shift+R' },
  { value: 'justify', label: 'Justify', icon: AlignJustify, keys: 'Mod+Shift+J' },
];
const INSERT_ICONS = { image: Image, table: Table, divider: Minus, code: CodeBlock, embed: LayoutGrid };
// The size text has with no size of its own: its block's, in the editor's
// scale (styles.css .tt-editor h1–h6, and docTypography.js, its print twin).
// Code is 13.5px, which the whole-number field can't show, so it shows none.
const BLOCK_PX = { p: 16, h1: 32, h2: 24, h3: 20, h4: 18, h5: 16, h6: 16 };

// Mouse or finger: the bar's sizes, and so how much fits (docLook.css gives
// the coarse ones under the same media query).
const COARSE = '(hover: none) and (pointer: coarse)';
function useCoarse() {
  const [coarse, setCoarse] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(COARSE).matches);
  useLayoutEffect(() => {
    const mq = window.matchMedia?.(COARSE);
    if (!mq) return undefined;
    const on = () => setCoarse(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return coarse;
}

export function DocBarA({
  editor, docName, ydoc = null, scope = null, docMode = 'doc', onToggleScreenplay,
  pageless = true, onTogglePageless, pagesShownContinuous = false,
  onInsertBookmark, onInsertImage, onInsertBoardEmbed, onOpenFind, onOpenLink, onAddComment,
  zoom = 1, fitEligible = false, onZoomIn, onZoomOut, onZoomReset,
  canEdit = true, canExport = true, onOpenElements, phone = false,
}) {
  const lit = useEditorState({ editor, selector: () => readBar(editor) });
  const disabled = !editor;
  const isScreenplay = docMode === 'screenplay';
  const kind = isScreenplay ? 'script' : 'doc';
  // On a phone the row is there while the text has the focus (the keyboard
  // is up), over the keyboard.
  const focused = useEditorState({
    editor, selector: ({ editor: ed }) => !!phone && !!ed && !ed.isDestroyed && ed.isFocused,
  });
  const kb = useKeyboardInset(phone && focused);

  // How much of the row fits: measured from the room the row has, not from
  // the row (which is what changes).
  const capRef = useRef(null);
  const input = useCoarse() ? 'touch' : 'desktop';
  const [level, setLevel] = useState(0);
  useLayoutEffect(() => {
    const cap = capRef.current;
    if (!cap) return undefined;
    const sizes = DOC_BAR_SIZES[input];
    const fit = () => {
      const cs = getComputedStyle(cap);
      const room = cap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setLevel(docBarFit(room, sizes, kind, input));
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(cap);
    return () => ro?.disconnect();
  }, [input, kind, phone]);

  // The phone's row scrolls sideways: its right edge fades while there's
  // more of it that way.
  const accRef = useRef(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const row = accRef.current;
    if (!row) return undefined;
    const check = () => setMore(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
    check();
    row.addEventListener('scroll', check, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    ro?.observe(row);
    return () => { row.removeEventListener('scroll', check); ro?.disconnect(); };
  }, [phone, focused, kind]);

  const customFonts = useCustomFonts();
  const recentFonts = useRecentFonts();
  const allFonts = useMemo(() => combineAllFonts(FONTS, customFonts), [customFonts]);
  const [fontsModalOpen, setFontsModalOpen] = useState(false);
  const font = useDocFont(editor);
  // The block the caret is in, as the style picker names it: a list's text
  // is body text, and a quote or code is named for what it is.
  const block = lit.heading || (lit.codeBlock ? 'code' : lit.blockquote ? 'quote' : 'p');
  const inCode = lit.code || block === 'code';
  // With no font of its own, text is in the doc's: serif, sans in a heading,
  // mono in code.
  const fontLabel = (() => {
    if (!lit.fontFamily) return inCode ? 'Mono' : block[0] === 'h' ? 'Sans' : 'Serif';
    const hit = [...recentFonts, ...allFonts].find((f) => f.css === lit.fontFamily);
    return hit?.label || hit?.name || 'Font';
  })();
  const size = lit.fontSize ?? (inCode ? null : BLOCK_PX[block] ?? BLOCK_PX.p);

  const ex = useDocExport({ editor, docName, ydoc, scope, docMode });

  const run = (chain) => editor && chain(editor.chain().focus()).run();
  const setHeading = (val) => {
    if (!editor) return;
    // setParagraph / toggleHeading route through clearNodes → can throw on a
    // hardBreak in the selection (lib/safeEditorCmd).
    if (val === 'p') safeRun(editor.chain().focus().setParagraph(), 'doc-setParagraph');
    else safeRun(editor.chain().focus().toggleHeading({ level: Number(val[1]) }), 'doc-toggleHeading');
  };
  const toggleQuote = () => editor && safeRun(editor.chain().focus().toggleBlockquote(), 'doc-blockquote');
  const setSize = (px) => run((c) => c.setFontSize(`${px}px`));
  const setColor = (c) => run((ch) => ch.setColor(c));
  const clearColor = () => run((ch) => ch.unsetColor());
  const toggleHighlight = () => run((c) => c.toggleHighlight());
  const setAlign = (a) => run((c) => c.setTextAlign(a));
  const setLayout = (wantPageless) => { if (wantPageless !== pageless) onTogglePageless?.(); };

  const pct = Math.round((zoom || 1) * 100);
  const zoomRow = (
    <ZoomRow pct={pct} fitEligible={fitEligible} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomReset={onZoomReset} />
  );
  const exportRows = (
    <ExportRows ex={ex} screenplay={isScreenplay} canEdit={canEdit} />
  );

  // A reader: Find, the zoom and Export (the toolbar canvas's G-viewer).
  if (!canEdit) {
    return (
      <div className="dl-cap" ref={capRef}>
        <Toolbar label="Formatting" className="dl-bar" text={() => editor}>
          <Group>
            <Btn icon={Search} label="Find" keys="Mod+F" disabled={disabled} onMouseDown={keep} onClick={() => onOpenFind?.()} />
          </Group>
          {onZoomIn && (
            <Group label="Zoom">
              <Btn icon={Minus} label="Zoom out" keys="Mod+-" onClick={onZoomOut} />
              <Btn text={`${pct}%`} label={`${fitEligible ? 'Fit to width' : 'Actual size'}, ${pct}%`} keys="Mod+0"
                   className="dl-zoom-pct" onClick={onZoomReset} />
              <Btn icon={Plus} label="Zoom in" keys="Mod+=" onClick={onZoomIn} />
            </Group>
          )}
          {canExport && (
            <Group>
              <MenuButton label="Export" icon={DownloadSimple} caret align="end" className="dl-w-caret" disabled={disabled}>
                {exportRows}
              </MenuButton>
            </Group>
          )}
        </Toolbar>
      </div>
    );
  }

  const groups = phone ? docBarPhoneGroups(kind) : docBarGroups(level, kind, input);
  const folded = new Set(phone ? docBarPhoneGroups.folded(kind) : docBarGroups.folded(level, kind, input));
  // On a phone the row is at the foot of the screen, over the keyboard: its
  // menus open up from it.
  const side = phone ? 'above' : 'below';
  const styleName = block === 'code' ? 'Code' : block === 'quote' ? 'Quote'
    : HEADINGS.find((o) => o.value === block)?.label;
  const align = ALIGNS.find((a) => a.value === lit.align) || ALIGNS[0];
  const styleRows = (
    <>
      {HEADINGS.map((o) => (
        <MenuItem key={o.value} label={o.label} keys={o.keys} radio checked={block === o.value}
                  className={`dl-style-${o.value}`} onSelect={() => setHeading(o.value)} />
      ))}
      <MenuSep />
      <MenuItem icon={Quote} label="Quote" keys="Mod+Shift+." checked={lit.blockquote} onSelect={toggleQuote} />
    </>
  );
  const docTypeRows = (
    <DocTypeRows screenplay={isScreenplay} onToggleScreenplay={onToggleScreenplay} />
  );
  const toggleList = (cmd, label) => editor && safeRun(editor.chain().focus()[cmd](), label);

  const fontRows = (
    <FontRows font={font} current={lit.fontFamily} recentFonts={recentFonts} allFonts={allFonts}
              onManage={() => setFontsModalOpen(true)} />
  );
  const colourRows = (
    <ColourRows color={lit.color} onPick={setColor} onClear={clearColor} />
  );
  const alignRows = ALIGNS.map((a) => (
    <MenuItem key={a.value} icon={a.icon} label={a.label} keys={a.keys} radio checked={lit.align === a.value}
              onSelect={() => setAlign(a.value)} />
  ));
  const layoutRows = (
    <>
      <MenuItem icon={FileText} label="Pageless" sub="One continuous sheet" radio checked={pageless}
                onSelect={() => setLayout(true)} />
      <MenuItem icon={Files} label="Pages"
                sub={pagesShownContinuous ? '8.5 × 11 when printed; a phone shows it continuous' : '8.5 × 11, as it prints'}
                radio checked={!pageless} onSelect={() => setLayout(false)} />
    </>
  );

  const item = (id) => {
    switch (id) {
      case 'doc':
      case 'docIcon':
      case 'script':
      case 'scriptIcon': {
        const named = id === 'doc' || id === 'script';
        return (
          <MenuButton key="doc" keepFocus label="Doc type" icon={isScreenplay ? Clapperboard : FileText}
                      text={named ? (isScreenplay ? 'Screenplay' : 'Doc') : undefined} select={named} caret side={side}
                      className={named ? `dl-w-${id}` : 'dl-w-docicon'} disabled={disabled || !onToggleScreenplay}>
            {docTypeRows}
          </MenuButton>
        );
      }
      case 'element': {
        // A screenplay's element on a phone, which has no Tab to step them:
        // the side panel's Elements, as a menu over the keyboard.
        const el = lit.spElement;
        const name = el ? (ELEMENT_LABELS[el] || el) : 'Element';
        return (
          <MenuButton key={id} keepFocus label={`Element: ${name}`} text={name} select caret side={side}
                      className="dl-w-element" disabled={disabled || !el}>
            {ELEMENTS.map((e) => (
              <MenuItem key={e} label={ELEMENT_LABELS[e] || e} radio checked={el === e}
                        onSelect={() => editor && safeRun(editor.chain().focus().setScreenplayElement(e), 'doc:screenplay-element')} />
            ))}
          </MenuButton>
        );
      }
      case 'undo':
        return <Btn key={id} icon={Undo} label="Undo" keys="Mod+Z" disabled={disabled} onMouseDown={keep} onClick={() => run((c) => c.undo())} />;
      case 'redo':
        return <Btn key={id} icon={Redo} label="Redo" keys="Mod+Shift+Z" disabled={disabled} onMouseDown={keep} onClick={() => run((c) => c.redo())} />;
      case 'style':
        return (
          <MenuButton key={id} keepFocus label={`Text style: ${styleName}`} text={styleName} select caret side={side}
                      className="dl-w-style" menuClassName="dl-style-menu" disabled={disabled}>
            {styleRows}
          </MenuButton>
        );
      case 'font':
        return (
          <MenuButton key={id} keepFocus label={`Font: ${fontLabel}`} text={fontLabel} select caret side={side}
                      className="dl-w-font" menuClassName="dl-font-pop" disabled={disabled}>
            {fontRows}
          </MenuButton>
        );
      case 'size':
        return (
          <SizeInput key={id} look value={size} placeholder="" presets={SIZES} className="dl-size-in" disabled={disabled}
                     onCommit={setSize} />
        );
      case 'bold':
        return <Btn key={id} icon={Bold} label="Bold" keys="Mod+B" toggle on={lit.bold} disabled={disabled} onMouseDown={keep} onClick={() => run((c) => c.toggleBold())} />;
      case 'italic':
        return <Btn key={id} icon={Italic} label="Italic" keys="Mod+I" toggle on={lit.italic} disabled={disabled} onMouseDown={keep} onClick={() => run((c) => c.toggleItalic())} />;
      case 'underline':
        return <Btn key={id} icon={Underline} label="Underline" keys="Mod+U" toggle on={lit.underline} disabled={disabled} onMouseDown={keep} onClick={() => run((c) => c.toggleUnderline())} />;
      case 'strike':
        return <Btn key={id} icon={Strikethrough} label="Strikethrough" keys="Mod+Shift+X" toggle on={lit.strike} disabled={disabled} onMouseDown={keep} onClick={() => run((c) => c.toggleStrike())} />;
      case 'code':
        return <Btn key={id} icon={Code} label="Inline code" keys="Mod+E" toggle on={lit.code} disabled={disabled} onMouseDown={keep} onClick={() => run((c) => c.toggleCode())} />;
      case 'color':
        return (
          <MenuButton key={id} keepFocus label="Colour and highlight" icon={TextAUnderline} className="dl-colour"
                      menuClassName="dl-colour-menu" disabled={disabled} side={side}
                      style={lit.color ? { '--dl-ink': lit.color } : undefined}>
            {colourRows}
            <MenuSep />
            <MenuItem icon={HighlighterCircle} label="Highlight" keys="Mod+Shift+H" checked={lit.highlight} onSelect={toggleHighlight} />
          </MenuButton>
        );
      case 'clear':
        return <Btn key={id} icon={Eraser} label="Clear formatting" keys="Mod+\" disabled={disabled} onMouseDown={keep} onClick={() => run((c) => c.clearFormatting())} />;
      case 'bullet':
        return <Btn key={id} icon={List} label="Bulleted list" keys="Mod+Shift+8" toggle on={lit.bulletList} disabled={disabled} onMouseDown={keep}
                    onClick={() => toggleList('toggleBulletList', 'doc-list:ul')} />;
      case 'ordered':
        return <Btn key={id} icon={ListOrdered} label="Numbered list" keys="Mod+Shift+7" toggle on={lit.orderedList} disabled={disabled} onMouseDown={keep}
                    onClick={() => toggleList('toggleOrderedList', 'doc-list:ol')} />;
      case 'task':
        return <Btn key={id} icon={ListChecks} label="Task list" keys="Mod+Shift+9" toggle on={lit.taskList} disabled={disabled} onMouseDown={keep}
                    onClick={() => toggleList('toggleTaskList', 'doc-list:task')} />;
      case 'align':
        return (
          <MenuButton key={id} keepFocus label={`Align: ${align.label}`} icon={align.icon} caret className="dl-w-caret" disabled={disabled} side={side}>
            {alignRows}
          </MenuButton>
        );
      case 'link':
        return <Btn key={id} icon={Link} label="Link" keys="Mod+K" tip={lit.hasSelection ? undefined : 'Select text to link'}
                    disabled={disabled || !lit.hasSelection} onMouseDown={keep}
                    onClick={() => onOpenLink?.(editor)} />;
      case 'comment':
        return <Btn key={id} icon={ChatCircleText} label="Comment" keys="Mod+Alt+M" tip={lit.hasSelection ? undefined : 'Select text to comment on'}
                    disabled={disabled || !lit.hasSelection} onMouseDown={keep}
                    onClick={() => onAddComment?.()} />;
      case 'insert':
        return (
          <MenuButton key={id} keepFocus label="Insert" icon={Plus} caret align="end" className="dl-w-caret"
                      menuClassName="dl-insert-menu" disabled={disabled} side={side}>
            {insertItems({ onInsertImage, onInsertBoardEmbed }).map((it) => (
              <MenuItem key={it.id} icon={INSERT_ICONS[it.id]} label={it.title} sub={it.subtitle}
                        onSelect={() => { if (editor) it.run(editor); }} />
            ))}
            <MenuSep />
            <MenuItem icon={BookmarkSimple} label="Bookmark this spot" sub="Find it again under Bookmarks"
                      onSelect={() => onInsertBookmark?.(editor)} />
          </MenuButton>
        );
      case 'bookmark':
        return <Btn key={id} icon={BookmarkSimple} label="Bookmark this spot" disabled={disabled || !onInsertBookmark} onMouseDown={keep}
                    onClick={() => onInsertBookmark?.(editor)} />;
      case 'find':
        return <Btn key={id} icon={Search} label="Find" keys="Mod+F" disabled={disabled} onMouseDown={keep} onClick={() => onOpenFind?.()} />;
      case 'more': {
        if (isScreenplay) {
          // What folded first, then the panel's Elements and Find, the zoom,
          // the script's exports and the counts. A screenplay is always
          // pages, so there's no Layout.
          const rows = [];
          if (folded.has('undo')) rows.push(<MenuItem key="undo" icon={Undo} label="Undo" keys="Mod+Z" onSelect={() => run((c) => c.undo())} />);
          if (folded.has('redo')) rows.push(<MenuItem key="redo" icon={Redo} label="Redo" keys="Mod+Shift+Z" onSelect={() => run((c) => c.redo())} />);
          if (folded.has('link')) rows.push(<MenuItem key="link" icon={Link} label="Link" keys="Mod+K" disabled={!lit.hasSelection} onSelect={() => onOpenLink?.(editor)} />);
          if (folded.has('bookmark') && onInsertBookmark) rows.push(<MenuItem key="bookmark" icon={BookmarkSimple} label="Bookmark this spot" sub="Find it again under Bookmarks" onSelect={() => onInsertBookmark(editor)} />);
          return (
            <MenuButton key={id} keepFocus label="More" icon={MoreHorizontal} align="end" menuClassName="dl-more" disabled={disabled}>
              {rows.length > 0 && <>{rows}<MenuSep /></>}
              {onOpenElements && (
                <MenuItem icon={PanelRight} label="Elements" sub="Scene heading, action, dialogue and the rest" onSelect={onOpenElements} />
              )}
              <MenuItem icon={Search} label="Find" keys="Mod+F" onSelect={() => onOpenFind?.()} />
              <MenuSep />
              {onZoomIn && <>{zoomRow}<MenuSep /></>}
              {canExport && <><MenuHead>Export</MenuHead>{exportRows}<MenuSep /></>}
              <Counts editor={editor} />
            </MenuButton>
          );
        }
        const text = [];
        if (folded.has('style')) text.push(<MenuItem key="style" icon={TextHOne} label="Style" value={styleName} submenu={styleRows} submenuClassName="dl-style-menu" />);
        if (folded.has('font')) text.push(<MenuItem key="font" icon={Type} label="Font" value={fontLabel} submenu={fontRows} submenuClassName="dl-font-pop" />);
        if (folded.has('size')) {
          text.push(
            <MenuItem key="size" label="Size" value={size ?? undefined} submenu={SIZES.map((px) => (
              <MenuItem key={px} label={String(px)} radio checked={size === px} onSelect={() => setSize(px)} />
            ))} />,
          );
        }
        if (folded.has('strike')) text.push(<MenuItem key="strike" icon={Strikethrough} label="Strikethrough" keys="Mod+Shift+X" checked={lit.strike} onSelect={() => run((c) => c.toggleStrike())} />);
        if (folded.has('code')) text.push(<MenuItem key="code" icon={Code} label="Inline code" keys="Mod+E" checked={lit.code} onSelect={() => run((c) => c.toggleCode())} />);
        if (folded.has('color')) {
          text.push(<MenuItem key="hl" icon={HighlighterCircle} label="Highlight" keys="Mod+Shift+H" checked={lit.highlight} onSelect={toggleHighlight} />);
          text.push(<MenuItem key="colour" icon={TextAUnderline} label="Text colour" submenu={colourRows} submenuClassName="dl-colour-menu" />);
        }
        if (folded.has('clear')) text.push(<MenuItem key="clear" icon={Eraser} label="Clear formatting" keys="Mod+\" onSelect={() => run((c) => c.clearFormatting())} />);
        if (folded.has('align')) text.push(<MenuItem key="align" icon={align.icon} label="Align" value={align.label} submenu={alignRows} />);
        if (folded.has('bullet')) text.push(<MenuItem key="bullet" icon={List} label="Bulleted list" keys="Mod+Shift+8" checked={lit.bulletList} onSelect={() => toggleList('toggleBulletList', 'doc-list:ul')} />);
        if (folded.has('ordered')) text.push(<MenuItem key="ordered" icon={ListOrdered} label="Numbered list" keys="Mod+Shift+7" checked={lit.orderedList} onSelect={() => toggleList('toggleOrderedList', 'doc-list:ol')} />);
        if (folded.has('task')) text.push(<MenuItem key="task" icon={ListChecks} label="Task list" keys="Mod+Shift+9" checked={lit.taskList} onSelect={() => toggleList('toggleTaskList', 'doc-list:task')} />);
        const edit = [];
        if (folded.has('undo')) edit.push(<MenuItem key="undo" icon={Undo} label="Undo" keys="Mod+Z" onSelect={() => run((c) => c.undo())} />);
        if (folded.has('redo')) edit.push(<MenuItem key="redo" icon={Redo} label="Redo" keys="Mod+Shift+Z" onSelect={() => run((c) => c.redo())} />);
        if (folded.has('link')) edit.push(<MenuItem key="link" icon={Link} label="Link" keys="Mod+K" disabled={!lit.hasSelection} onSelect={() => onOpenLink?.(editor)} />);
        if (folded.has('comment')) edit.push(<MenuItem key="comment" icon={ChatCircleText} label="Comment" keys="Mod+Alt+M" disabled={!lit.hasSelection} onSelect={() => onAddComment?.()} />);
        if (folded.has('find')) edit.push(<MenuItem key="find" icon={Search} label="Find" keys="Mod+F" onSelect={() => onOpenFind?.()} />);
        // On a phone it is the text's tools alone: the rest is the header's ⋯.
        if (phone) {
          return (
            <MenuButton key={id} keepFocus label="More formatting" icon={MoreHorizontal} align="end" side={side}
                        menuClassName="dl-more" disabled={disabled}>
              {text}
              {edit.length > 0 && <><MenuSep />{edit}</>}
            </MenuButton>
          );
        }
        const compact = text.length > 0 || edit.length > 0;
        return (
          <MenuButton key={id} keepFocus label="More" icon={MoreHorizontal} align="end" menuClassName="dl-more" disabled={disabled}>
            {text.length > 0 && <><MenuHead>Text</MenuHead>{text}</>}
            {edit.length > 0 && <>{text.length > 0 && <MenuSep />}{edit}</>}
            {compact ? (
              <>
                <MenuSep />
                {onZoomIn && zoomRow}
                {folded.has('doc') && onToggleScreenplay && (
                  <MenuItem icon={FileText} label="Doc type" value="Document" submenu={docTypeRows} />
                )}
                {onTogglePageless && (
                  <MenuItem icon={pageless ? FileText : Files} label="Layout" value={pageless ? 'Pageless' : 'Pages'}
                            submenu={layoutRows} />
                )}
                {canExport && <MenuItem icon={DownloadSimple} label="Export" submenu={exportRows} />}
              </>
            ) : (
              <>
                {onTogglePageless && <><MenuHead>Layout</MenuHead>{layoutRows}<MenuSep /></>}
                {onZoomIn && <>{zoomRow}<MenuSep /></>}
                {canExport && <><MenuHead>Export</MenuHead>{exportRows}<MenuSep /></>}
              </>
            )}
            {compact && <MenuSep />}
            <Counts editor={editor} />
          </MenuButton>
        );
      }
      default:
        return null;
    }
  };

  if (phone) {
    return (
      <>
        {focused && (
          <Toolbar label="Formatting" className="dl-bar dl-acc" surface={false} text={() => editor}
                   style={{ '--dl-kb': `${kb}px` }}>
            <div className={more ? 'dl-acc-row has-more' : 'dl-acc-row'} ref={accRef}>
              {groups.map((g) => <Group key={g.join(' ')}>{g.map(item)}</Group>)}
            </div>
            <Btn icon={Keyboard} label="Hide the keyboard" className="dl-acc-kb" onMouseDown={keep}
                 onClick={() => { try { editor?.commands.blur(); } catch (_) {} }} />
          </Toolbar>
        )}
        <CustomFontsModal open={fontsModalOpen} onClose={() => setFontsModalOpen(false)} />
      </>
    );
  }

  return (
    <div className="dl-cap" ref={capRef}>
      <Toolbar label="Formatting" className="dl-bar" text={() => editor}>
        {groups.map((g) => <Group key={g.join(' ')}>{g.map(item)}</Group>)}
      </Toolbar>
      <CustomFontsModal open={fontsModalOpen} onClose={() => setFontsModalOpen(false)} />
    </div>
  );
}

// The doc's two kinds, to pick from.
function DocTypeRows({ screenplay, onToggleScreenplay }) {
  return (
    <>
      <MenuItem icon={FileText} label="Document" sub="Headings, lists, pictures and tables" radio checked={!screenplay}
                onSelect={() => { if (screenplay) onToggleScreenplay?.(); }} />
      <MenuItem icon={Clapperboard} label="Screenplay" sub="Scenes, characters and dialogue, set as a script"
                radio checked={screenplay} onSelect={() => { if (!screenplay) onToggleScreenplay?.(); }} />
    </>
  );
}

// A phone's ⋯, in the window's header (mockup A-phone): the side panel's
// Comments and Find (a sheet there), Messages, and what the doc's own ⋯ holds
// that isn't the text's: its type, its layout, the zoom, Export and the
// counts. The same whether the keyboard is up or not, and for a reader too.
// The surface opens it against the header's button (lib/docFrame.js), so it
// is there only while it's open.
export function DocMoreA({
  open = true, byKey = false, anchorRef, onClose,
  editor, docName, ydoc = null, scope = null, docMode = 'doc',
  canEdit = true, canExport = true, isPublic = false,
  openComments = 0, onOpenComments, onOpenFind, onOpenElements, onToggleScreenplay,
  pageless = true, onTogglePageless, pagesShownContinuous = false,
  zoom = 1, fitEligible = false, onZoomIn, onZoomOut, onZoomReset,
}) {
  const ex = useDocExport({ editor, docName, ydoc, scope, docMode });
  const messagesUi = useMessagesUi();
  const isScreenplay = docMode === 'screenplay';
  const pct = Math.round((zoom || 1) * 100);
  const unread = messagesUi?.unread || 0;
  const setLayout = (wantPageless) => { if (wantPageless !== pageless) onTogglePageless?.(); };
  return (
    <Menu open={open} onClose={onClose} anchorRef={anchorRef} label="More" align="end" byKey={byKey}
          className="dl-more dl-pmore">
      {onOpenComments && (
        <MenuItem icon={ChatCircleText} label="Comments" value={openComments > 0 ? `${openComments} open` : undefined}
                  onSelect={onOpenComments} />
      )}
      <MenuItem icon={Search} label="Find" onSelect={() => onOpenFind?.()} />
      {isScreenplay && canEdit && onOpenElements && (
        <MenuItem icon={PanelRight} label="Elements" sub="Title page, scene numbers, dual dialogue" onSelect={onOpenElements} />
      )}
      {messagesUi && !isPublic && (
        <MenuItem icon={ChatsCircle} label="Messages" value={unread > 0 ? `${unread} unread` : undefined}
                  onSelect={() => messagesUi.toggle?.()} />
      )}
      <MenuSep />
      {canEdit && onToggleScreenplay && (
        <MenuItem icon={isScreenplay ? Clapperboard : FileText} label="Doc type" value={isScreenplay ? 'Screenplay' : 'Document'}
                  submenu={<DocTypeRows screenplay={isScreenplay} onToggleScreenplay={onToggleScreenplay} />} />
      )}
      {!isScreenplay && canEdit && onTogglePageless && (
        <MenuItem icon={pageless ? FileText : Files} label="Layout" value={pageless ? 'Pageless' : 'Pages'} submenu={(
          <>
            <MenuItem icon={FileText} label="Pageless" sub="One continuous sheet" radio checked={pageless}
                      onSelect={() => setLayout(true)} />
            <MenuItem icon={Files} label="Pages"
                      sub={pagesShownContinuous ? '8.5 × 11 when printed; a phone shows it continuous' : '8.5 × 11, as it prints'}
                      radio checked={!pageless} onSelect={() => setLayout(false)} />
          </>
        )} />
      )}
      {onZoomIn && (
        <ZoomRow pct={pct} fitEligible={fitEligible} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomReset={onZoomReset} />
      )}
      {canExport && (
        <MenuItem icon={DownloadSimple} label="Export"
                  submenu={<ExportRows ex={ex} screenplay={isScreenplay} canEdit={canEdit} />} />
      )}
      <MenuSep />
      <Counts editor={editor} />
    </Menu>
  );
}

// The font list, each in its own face, in a menu of its own or under ⋯'s
// Font: the pointer resting on one, or the keyboard on it, previews it on the
// selection (useDocFont), and the list closing without a pick puts it back.
function FontRows({ font, current, recentFonts, allFonts, onManage }) {
  const live = useRef(font);
  live.current = font;
  const picked = useRef(false);
  const previewed = useRef(false);
  useLayoutEffect(() => () => { if (!picked.current && previewed.current) live.current.cancel(); }, []);
  const preview = (f, focus) => {
    if (f.gfName) ensureGoogleFontLoaded(f.gfName);
    previewed.current = true;
    live.current.preview(f.css, { focus });
  };
  const row = (f, key) => (
    <MenuItem key={key} label={f.label} sub={f.sub} radio checked={f.css === (current || '')}
              style={f.css ? { fontFamily: f.css } : undefined}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') preview(f, true); }}
              onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) preview(f, false); }}
              onSelect={() => {
                picked.current = true;
                if (f.gfName) ensureGoogleFontLoaded(f.gfName);
                live.current.commit(f);
              }} />
  );
  return (
    <div className="dl-font-rows" onMouseLeave={() => { if (previewed.current) live.current.preview(null); }}>
      {recentFonts.length > 0 && (
        <>
          <MenuHead>Recent</MenuHead>
          {recentFonts.map((f) => row({ ...f, label: f.name }, `r:${f.css}`))}
          <MenuSep />
        </>
      )}
      <MenuHead>Fonts</MenuHead>
      {row({ label: 'Default', sub: 'Serif text, sans headings', css: '' }, 'default')}
      {allFonts.map((f) => row(f, f.key))}
      {onManage && (
        <>
          <MenuSep />
          <MenuItem icon={Plus} label="Add a custom font…" onSelect={() => { picked.current = true; onManage(); }} />
        </>
      )}
    </div>
  );
}

// The text colours as swatches, and the colour the text has by default.
// Rows of a menu to a screen reader and the arrow keys (menuitemradio).
function ColourRows({ color, onPick, onClear }) {
  const menu = useMenu();
  const pick = (fn) => () => { fn(); menu?.close('select'); };
  return (
    <>
      <MenuHead>Text colour</MenuHead>
      <div className="dl-swrow" role="group" aria-label="Text colour">
        {DOC_COLORS.map(({ c, name }) => (
          <Swatch key={c} color={c} label={name} role="menuitemradio" aria-checked={color === c} aria-pressed={undefined}
                  tabIndex={-1} on={color === c} onMouseDown={keep} onClick={pick(() => onPick(c))} />
        ))}
        <Swatch label="Default colour" className="is-none" role="menuitemradio" aria-checked={!color} aria-pressed={undefined}
                tabIndex={-1} on={!color} onMouseDown={keep} onClick={pick(onClear)} />
      </div>
    </>
  );
}

// A script's PDF is a file like its other formats, so it is a format here,
// first (the owner's pick); a document's is the browser's print.
function ExportRows({ ex, screenplay, canEdit }) {
  return (
    <>
      {screenplay && (
        <>
          <MenuItem icon={FilePdf} label="PDF" sub=".pdf" onSelect={ex.exportPDF} />
          <MenuItem icon={FileText} label="Fountain" sub=".fountain" onSelect={ex.exportFountain} />
          <MenuItem icon={FileText} label="Final Draft" sub=".fdx" onSelect={ex.exportFdx} />
          {canEdit && <MenuItem icon={DownloadSimple} label="Import Fountain or Final Draft…" onSelect={ex.importScript} />}
          <MenuSep />
        </>
      )}
      <MenuItem icon={FileHtml} label="HTML" onSelect={ex.exportHTML} />
      <MenuItem icon={MarkdownLogo} label="Markdown" onSelect={ex.exportMarkdown} />
      {!screenplay && (
        <MenuItem icon={Printer} label={ex.pdfLabel === 'Print / Save as PDF' ? 'Print or save as PDF' : ex.pdfLabel}
                  onSelect={ex.exportPDF} />
      )}
    </>
  );
}

// ⋯'s zoom: − the percentage + in a row, the percentage putting it back.
function ZoomRow({ pct, fitEligible, onZoomIn, onZoomOut, onZoomReset }) {
  return (
    <div className="tl-mrow" role="group" aria-label="Zoom">
      <Icon as={MagnifyingGlassPlus} size={16} className="dl-mrow-i" />
      <span className="tl-mrow-l">Zoom</span>
      <span className="tl-seg">
        <Btn icon={Minus} label="Zoom out" keys="Mod+-" onMouseDown={keep} onClick={onZoomOut} />
        <Btn text={`${pct}%`} label={`${fitEligible ? 'Fit to width' : 'Actual size'}, ${pct}%`} keys="Mod+0"
             className="dl-zoom-pct" onMouseDown={keep} onClick={onZoomReset} />
        <Btn icon={Plus} label="Zoom in" keys="Mod+=" onMouseDown={keep} onClick={onZoomIn} />
      </span>
    </div>
  );
}

// The page's words and characters, counted as ⋯ opens.
function Counts({ editor }) {
  if (!editor || editor.isDestroyed) return null;
  const { words, chars } = docCounts(editor.state.doc);
  return (
    <div className="dl-minfo" role="presentation">
      {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {chars.toLocaleString()} {chars === 1 ? 'character' : 'characters'}
    </div>
  );
}
