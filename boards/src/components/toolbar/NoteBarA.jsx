import { useLayoutEffect, useRef, useState } from 'react';
import { IconWeightContext } from '../Icon.jsx';
import { Btn, Group } from './Toolbar.jsx';
import { MenuButton, MenuHead, MenuItem, MenuSep } from './Menu.jsx';
import { ColourRows } from './Colours.jsx';
import { useIslandFit } from './useIslandFit.js';
import { SizeInput } from '../SizeInput.jsx';
import { CustomFontsModal } from '../CustomFontsModal.jsx';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { useCustomFonts, useRecentFonts } from '../../hooks/useCustomFonts.js';
import { combineAllFonts, ensureGoogleFontLoaded } from '../../lib/googleFonts.js';
import { BG_COLORS, FONTS, SIZES, TEXT_COLORS, swatchBg, useFontPick, useNoteComment } from '../ToolOptionsBar.jsx';
import {
  AlignCenter, AlignCenterVertical, AlignLeft, AlignRight, Bold, ChatCircleText, Italic, List, ListChecks, ListOrdered,
  Minus, MoreHorizontal, Plus, Strikethrough, TextAUnderline, TextTSlash, Type, Underline,
} from '../../lib/icons.js';

// The note bar in the toolbar look (the owner's pick "A · Islands",
// 2026-10-21; the toolbar canvas's A-note, A-ipad and A-phone frames), on a
// note being written and a grid's box:
//
//   desktop  Font ▾  − 15 + | B I U S Tx | • 1. ☑ | ⇤ ≡ ⇥ ▣ 💬 | A | ■
//   narrower Font ▾  − 15 + | B I U | • 1. ☑ | A | ■ | ⋯
//   iPad     Font 15 ▾ | B I U | • 1. ☑ | A | ⋯
//   phone    Aa ▾ | B I U | ≣ ▾ | A | ⋯
//
// A desktop window too narrow for the whole row folds it a step at a time:
// first Strikethrough, Clear formatting, the aligns, Center in the box and
// Comment go into ⋯, then the size into the font's menu and the background
// into ⋯, as under a finger, and last the font and the lists into a button
// each, as on a phone. A grid's box adds what a change applies to (All boxes
// | This box), on the bar but for a phone's, where it's ⋯'s. A box that's
// selected rather than written in has no emphasis or lists, and one that
// holds a picture only its background and that scope.
//
// ToolOptionsBar's NoteRichTextBar works it: the format state (fmt, display,
// fore), what each control does (act), where the bar sits and the keyboard's
// lift (.tob, barRef), and its keys (onKeyDown: one Tab stop, the arrows along
// it, ⌥F10 from the text and Escape back).
// This draws it. Nothing in it takes the focus from the text on a press, and
// its menus (MENU) are the note's edit session too (NoteTiptapSurface
// EDIT_SESSION_UI), so the note stays in edit while one is open.

const keep = (e) => e.preventDefault();
const MENU = 'tob-menu';
const ALIGNS = [
  { value: 'left', label: 'Align left', icon: AlignLeft },
  { value: 'center', label: 'Align center', icon: AlignCenter },
  { value: 'right', label: 'Align right', icon: AlignRight },
];
const LISTS = [
  { type: 'ul', label: 'Bulleted list', icon: List },
  { type: 'ol', label: 'Numbered list', icon: ListOrdered },
  { type: 'task', label: 'Checklist', icon: ListChecks },
];
// The font under the caret, by its first family as the CSS names it, in a
// name's case: the app's own face is "aileron" there.
const fontName = (family) => (/[A-Z]/.test(family) ? family : family.replace(/(^|[\s-])\w/g, (c) => c.toUpperCase()));

export function NoteBarA({ barRef, onKeyDown, label, text, show, fmt, display, fore, balanced, bg, cellPinned, paletteColors, act }) {
  const { isPhone, isTouch } = useBreakpoint();
  const input = isPhone ? 'phone' : isTouch ? 'touch' : 'desktop';
  const [fontsOpen, setFontsOpen] = useState(false);

  // On a desktop canvas the bar is the bottom row's middle island, between
  // the rail and the zoom, and folds a step at a time where the row doesn't
  // fit (useIslandFit): fold 1, 2, then 3.
  const fold = useIslandFit(barRef, { on: input === 'desktop', max: 3 });
  // How far the row is folded: a desktop's as it fits, a finger's to the
  // size in the font's menu (2), a phone's to a button for the font and one
  // for the lists (3).
  const phone = input === 'phone';
  const level = input === 'desktop' ? fold : phone ? 3 : 2;
  const tight = level >= 2;
  const compact = level === 3;
  // A phone's row shares its width among the controls, not the groups.
  const share = (n) => (phone ? { flexGrow: n } : undefined);

  const cell = show.cell;
  const align = cell ? (display.align || 'left') : fmt.align;
  const fontLabel = display.fontFamily ? fontName(display.fontFamily) : 'Font';
  const size = display.fontSize ?? null;
  const listNow = LISTS.find((l) => l.type === fmt.listType) || null;
  const bgLabel = cell ? 'Box background' : 'Card background';
  // No background of its own: a note shows the card's surface, a box the
  // swatch that puts it back (No background).
  const bgNow = bg || (cell ? 'transparent' : null);
  const bgChip = bgNow ? swatchBg(bgNow) : 'var(--bg-0)';

  const fmtBtn = (icon, name, cmd, on, keys) => (
    <Btn key={cmd} icon={icon} label={name} keys={keys} toggle on={on} onMouseDown={keep} onPointerDown={keep}
         onClick={() => act.toggle(cmd, !on)} />
  );
  const bold = fmtBtn(Bold, 'Bold', 'bold', fmt.bold, 'Mod+B');
  const italic = fmtBtn(Italic, 'Italic', 'italic', fmt.italic, 'Mod+I');
  const underline = fmtBtn(Underline, 'Underline', 'underline', fmt.underline, 'Mod+U');
  // ⌘⇧S is the note's (Tiptap's); a box's plain text has no such key.
  const strikeKeys = cell ? undefined : 'Mod+Shift+S';
  const listBtns = LISTS.map((l) => (
    <Btn key={l.type} icon={l.icon} label={l.label} toggle on={fmt.listType === l.type} onMouseDown={keep} onPointerDown={keep}
         onClick={() => act.list(l.type)} />
  ));
  const fontRows = (
    <FontRows current={display.fontFamily} onFont={act.font} onManage={() => setFontsOpen(true)} />
  );
  const colour = (
    <MenuButton keepFocus label="Text color" icon={TextAUnderline} className="nb-colour" side="above"
                menuClassName={`${MENU} nb-colour-menu`} style={{ '--nb-ink': fore }}>
      <ColourRows head="Text color" swatches={TEXT_COLORS} paletteColors={paletteColors} current={fore}
                  onPick={act.color} onCustom={act.customColor} />
    </MenuButton>
  );
  const bgRows = (
    <ColourRows head={bgLabel} swatches={BG_COLORS} paletteColors={paletteColors} current={bgNow}
                onPick={act.bg} onCustom={act.customBg} />
  );
  const background = (
    <MenuButton keepFocus label={bgLabel} className="nb-bg" side="above" align="end"
                menuClassName={`${MENU} nb-colour-menu`} style={{ '--nb-bg': bgChip }}>
      {bgRows}
    </MenuButton>
  );
  const scope = (
    <Group key="scope" label="Style scope">
      <Btn text="All boxes" toggle on={!cellPinned} tip="Changes apply to every box in this grid"
           onMouseDown={keep} onPointerDown={keep} onClick={() => act.scope('all')} />
      <Btn text="This box" toggle on={!!cellPinned} tip="Changes apply to only this box"
           onMouseDown={keep} onPointerDown={keep} onClick={() => act.scope('box')} />
    </Group>
  );

  const writes = show.typography || show.emphasis;
  // What a box's change applies to sits on the bar, but for a phone's (or a
  // row folded as far) that has ⋯ to hold it.
  const scopeOn = cell && (!compact || !writes);
  const groups = [];
  if (show.typography) {
    groups.push(tight ? (
      <Group key="type">
        <MenuButton keepFocus label={`Font: ${fontLabel}${size ? `, size ${size}` : ''}`} side="above"
                    {...(compact ? { icon: Type } : { text: `${fontLabel} ${size ?? ''}`.trim(), select: true })} caret
                    className="nb-font" menuClassName={`${MENU} nb-font-pop`}>
          <SizeRow size={size} onSize={act.size} />
          <MenuSep />
          {fontRows}
        </MenuButton>
      </Group>
    ) : (
      <Group key="type">
        <MenuButton keepFocus label={`Font: ${fontLabel}`} text={fontLabel} select caret side="above"
                    className="nb-font" menuClassName={`${MENU} nb-font-pop`}>
          {fontRows}
        </MenuButton>
        <span className="nb-step">
          <Btn icon={Minus} label="Decrease font size" onMouseDown={keep} onPointerDown={keep}
               onClick={() => act.size((size ?? 15) - 1)} />
          <SizeInput look value={size} placeholder="" presets={SIZES} className="nb-size-in" dropUp onCommit={act.size} />
          <Btn icon={Plus} label="Increase font size" onMouseDown={keep} onPointerDown={keep}
               onClick={() => act.size((size ?? 15) + 1)} />
        </span>
      </Group>
    ));
  }
  if (show.emphasis) {
    groups.push(level === 0 ? (
      <Group key="emph">
        {bold}{italic}{underline}
        {fmtBtn(Strikethrough, 'Strikethrough', 'strikeThrough', fmt.strike, strikeKeys)}
        <Btn icon={TextTSlash} label="Clear formatting" keys="Mod+\" onMouseDown={keep} onPointerDown={keep} onClick={act.clear} />
      </Group>
    ) : (
      <Group key="emph" style={share(3)}>{bold}{italic}{underline}</Group>
    ));
    groups.push(
      <Group key="lists">
        {compact ? (
          <MenuButton keepFocus label={listNow ? `Lists: ${listNow.label}` : 'Lists'} icon={listNow?.icon || List} caret
                      on={!!listNow} side="above" menuClassName={MENU}>
            {LISTS.map((l) => (
              <MenuItem key={l.type} icon={l.icon} label={l.label} checked={fmt.listType === l.type}
                        onSelect={() => act.list(l.type)} />
            ))}
          </MenuButton>
        ) : listBtns}
      </Group>,
    );
  }
  if (show.typography && level === 0) {
    groups.push(
      <Group key="align">
        {ALIGNS.map((a) => (
          <Btn key={a.value} icon={a.icon} label={a.label} toggle on={align === a.value} onMouseDown={keep} onPointerDown={keep}
               onClick={() => act.align(a.value)} />
        ))}
        <Btn icon={AlignCenterVertical} label="Center in the box" toggle on={balanced} onMouseDown={keep} onPointerDown={keep}
             onClick={act.balance} />
        {!cell && <CommentBtn />}
      </Group>,
    );
  }
  if (show.typography) groups.push(<Group key="colour">{colour}</Group>);
  if (show.card && (!tight || !writes)) groups.push(<Group key="bg">{background}</Group>);
  if (scopeOn) groups.push(scope);
  if (level > 0 && writes) {
    groups.push(
      <Group key="more">
        <MenuButton keepFocus label="More formatting" icon={MoreHorizontal} side="above" align="end"
                    menuClassName={`${MENU} nb-more`}>
          {show.emphasis && (
            <>
              <MenuItem icon={Strikethrough} label="Strikethrough" keys={strikeKeys} checked={fmt.strike}
                        onSelect={() => act.toggle('strikeThrough', !fmt.strike)} />
              <MenuItem icon={TextTSlash} label="Clear formatting" keys="Mod+\" onSelect={act.clear} />
            </>
          )}
          {show.typography && (
            <>
              {show.emphasis && <MenuSep />}
              <AlignRow align={align} onAlign={act.align} />
              <MenuItem icon={AlignCenterVertical} label="Center in the box" checked={balanced} onSelect={act.balance} />
            </>
          )}
          {!cell && <CommentRow />}
          {/* A phone has no room for a menu beside this one: its colours
              are ⋯'s own. */}
          {show.card && tight && (
            <>
              <MenuSep />
              {phone ? bgRows : (
                <MenuItem icon={BgChip} label={bgLabel} style={{ '--nb-bg': bgChip }}
                          submenu={bgRows} submenuClassName={`${MENU} nb-colour-menu`} />
              )}
            </>
          )}
          {cell && !scopeOn && (
            <>
              <MenuSep />
              <MenuHead>Changes apply to</MenuHead>
              <MenuItem label="All boxes" radio checked={!cellPinned} onSelect={() => act.scope('all')} />
              <MenuItem label="This box" radio checked={!!cellPinned} onSelect={() => act.scope('box')} />
            </>
          )}
        </MenuButton>
      </Group>,
    );
  }

  const cls = ['tob', 'tob-a', 'nb-a', `is-${input === 'desktop' ? 'desk' : input}`];
  if (tight) cls.push('is-tight');
  return (
    <IconWeightContext.Provider value="regular">
      <div ref={barRef} className={cls.join(' ')} role="toolbar" aria-label={label}
           aria-keyshortcuts={text ? 'Alt+F10' : undefined}
           onKeyDown={onKeyDown}
           onPointerDown={(e) => e.stopPropagation()}
           // A press on the bar's padding or a hairline would move focus to
           // <body>, which the note reads as leaving it (NOTES-14). Fields
           // still take focus.
           onMouseDown={(e) => { if (!e.target.closest?.('input, select, textarea')) e.preventDefault(); }}>
        {groups}
      </div>
      <CustomFontsModal open={fontsOpen} onClose={() => setFontsOpen(false)} />
    </IconWeightContext.Provider>
  );
}

// The comment, while the note has its flow (only a collaborative note does).
function CommentBtn() {
  const comment = useNoteComment();
  if (!comment) return null;
  return (
    <Btn icon={ChatCircleText} label="Add comment" keys="Mod+Alt+M"
         tip={comment.hasSelection ? 'Comment on the selection' : 'Select text to comment on'}
         disabled={!comment.hasSelection} onMouseDown={keep} onPointerDown={keep} onClick={() => comment.open()} />
  );
}
function CommentRow() {
  const comment = useNoteComment();
  if (!comment) return null;
  return (
    <>
      <MenuSep />
      <MenuItem icon={ChatCircleText} label="Comment" keys="Mod+Alt+M"
                sub={comment.hasSelection ? undefined : 'Select text to comment on'}
                disabled={!comment.hasSelection} onSelect={() => comment.open()} />
    </>
  );
}

// The background a row stands for, in its icon's place.
function BgChip() {
  return <span className="nb-chip" aria-hidden="true" />;
}

// The size under a finger, at the top of the font's menu: − and + step it,
// and the menu stays open to see it change.
function SizeRow({ size, onSize }) {
  return (
    <div className="tl-mrow nb-size-row" role="group" aria-label="Font size">
      <span className="tl-mrow-l">Size</span>
      <span className="tl-seg">
        <Btn icon={Minus} label="Decrease font size" role="menuitem" tabIndex={-1} onMouseDown={keep}
             onClick={() => onSize((size ?? 15) - 1)} />
        <span className="nb-size-val" aria-live="polite">{size ?? '–'}</span>
        <Btn icon={Plus} label="Increase font size" role="menuitem" tabIndex={-1} onMouseDown={keep}
             onClick={() => onSize((size ?? 15) + 1)} />
      </span>
    </div>
  );
}

// The aligns as one row of ⋯, picked in place.
function AlignRow({ align, onAlign }) {
  return (
    <div className="tl-mrow nb-align-row" role="group" aria-label="Align">
      <span className="nb-mind" />
      <span className="tl-mrow-l">Align</span>
      <span className="tl-seg">
        {ALIGNS.map((a) => (
          <Btn key={a.value} icon={a.icon} label={a.label} role="menuitemradio" aria-checked={align === a.value}
               tabIndex={-1} on={align === a.value} onMouseDown={keep} onClick={() => onAlign(a.value)} />
        ))}
      </span>
    </div>
  );
}

// The fonts, each in its own face, the recent ones first. Resting the pointer
// on one previews it where the text can show it (useFontPick), and the menu
// closing without a pick puts the text back.
function FontRows({ current, onFont, onManage }) {
  const customFonts = useCustomFonts();
  const recentFonts = useRecentFonts();
  const allFonts = combineAllFonts(FONTS, customFonts);
  const pick = useFontPick(onFont);
  const live = useRef(pick);
  live.current = pick;
  const picked = useRef(false);
  const previewed = useRef(false);
  useLayoutEffect(() => () => { if (!picked.current && previewed.current) live.current.cancel(); }, []);
  // The font under the caret is named by its first family ("Inter").
  const isCurrent = (f) => !!current && (f.label === current
    || (f.css || '').split(',')[0].trim().replace(/^["']|["']$/g, '') === current);
  const row = (f, key) => (
    <MenuItem key={key} label={f.label} radio checked={isCurrent(f)} style={{ fontFamily: f.css }}
              onPointerEnter={(e) => {
                if (e.pointerType !== 'mouse') return;
                if (f.gfName) ensureGoogleFontLoaded(f.gfName);
                previewed.current = true;
                live.current.preview(f.css);
              }}
              onSelect={() => { picked.current = true; live.current.commit(f); }} />
  );
  return (
    <div className="nb-font-rows" onMouseLeave={() => { if (previewed.current) live.current.preview(null); }}>
      {recentFonts.length > 0 && (
        <>
          <MenuHead>Recent</MenuHead>
          {recentFonts.map((f) => row({ ...f, label: f.name }, `r:${f.css}`))}
          <MenuSep />
        </>
      )}
      <MenuHead>Fonts</MenuHead>
      {allFonts.map((f) => row(f, f.key))}
      <MenuSep />
      <MenuItem icon={Plus} label="Add a custom font…" onSelect={() => { picked.current = true; live.current.cancel(); onManage(); }} />
    </div>
  );
}
