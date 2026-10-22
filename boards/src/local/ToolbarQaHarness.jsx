import { useEffect, useState } from 'react';
import { Toolbar, Group, Btn, Swatch, Caps } from '../components/toolbar/Toolbar.jsx';
import { MenuButton, MenuItem, MenuHead, MenuSep } from '../components/toolbar/Menu.jsx';
import { installTipHost } from '../components/toolbar/tipHost.js';
import { Icon, IconWeightContext } from '../components/Icon.jsx';
import {
  Bold, Italic, Underline, Strikethrough, TextTSlash, List, ListOrdered, ListChecks,
  AlignLeft, AlignCenter, AlignRight, AlignCenterVertical, ChatCircleText, MoreHorizontal,
  Scribble, Square, Palette, Paperclip, FolderOpen, LinkSimple, ArrowSquareOut, MessageCircle,
  Minus, Plus,
} from '../lib/icons.js';

// Dev-only toolbar QA (?toolbarqa=1): the parts of the toolbar look (the
// owner's pick "A · Islands", 2026-10-21) laid out as the mockup's parts sheet
// (tb A-parts), dark on the left and light on the right, so a screenshot can
// sit beside it; and live, for tests/toolbar-primitives.spec.js: the bar's
// tooltips come from the real host, its toggles flip, and ⋯ opens a real menu.
// main.jsx mounts it behind import.meta.env.DEV.
const CSS = `
html, body { margin: 0; background: #0a0a0c; }
.tqa { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; font: 400 13px/1.35 var(--font-sans); }
.tqa-half { padding: 28px 32px 40px; background: var(--bg-0); color: var(--ink-0); }
.tqa-title { margin: 0 0 18px; font-size: 18px; font-weight: 700; }
.tqa-title small { margin-left: 8px; font-size: 12px; font-weight: 400; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.tqa-h { margin: 22px 0 10px; font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.tqa-row { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
.tqa-cell { display: grid; justify-items: center; gap: 6px; padding: 8px; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--line-1); font-size: 11px; color: var(--ink-3); }
.tqa-note { align-self: center; font-size: 11px; color: var(--ink-3); }
.tqa .is-hov { background: var(--tl-hov); color: var(--ink-0); }
.tqa .is-focus { outline: 2px solid var(--soleil); outline-offset: 1px; }
.tqa .tl-mi.is-hov svg { color: var(--ink-1); }
.tqa-touch { --tl-bs: 44px; --tl-is: 22px; --tl-br: 10px; --tl-rad: 14px; --tl-sep: 22px; --tl-fs: 15px; --tl-sws: 26px; --tl-mis: 20px; --tl-mrow: 44px; --tl-mfs: 15px; }
.tqa-two { display: grid; grid-template-columns: auto 1fr; gap: 28px; align-items: start; }
.tqa-tipdemo { position: relative; padding-top: 40px; }
.tqa-tipdemo .tl-tip { position: absolute; top: 0; left: 0; transform: none; opacity: 1; }
.tqa .tl-menu.tqa-static { position: static; width: 224px; }
.tqa-out { margin-top: 14px; font: 400 11px/1.4 ui-monospace, monospace; color: var(--ink-3); }
`;

function StateCell({ label, cls, icon = Bold, disabled = false, on = false }) {
  return (
    <div className="tqa-cell">
      <Btn icon={icon} label={`Bold, ${label}`} on={on} disabled={disabled} className={cls} tabIndex={-1} />
      {label}
    </div>
  );
}

function Half({ theme }) {
  const [bold, setBold] = useState(false);
  const [align, setAlign] = useState('left');
  const [picked, setPicked] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const colors = [['White', '#f5f5f7'], ['Black', '#0a0a0c'], ['Red', '#e5484d'], ['Orange', '#f59e0b'], ['Green', '#10b981'], ['Blue', '#3b82f6'], ['Purple', '#8b5cf6'], ['Pink', '#ec4899']];
  return (
    <div className="tqa-half" data-theme={theme} data-qa-half={theme}>
      <h1 className="tqa-title">A · Islands<small>{theme}</small></h1>

      <div className="tqa-h">Buttons</div>
      <IconWeightContext.Provider value="regular">
        <div className="tqa-row">
          <StateCell label="Rest" />
          <StateCell label="Hover" cls="is-hov" />
          <StateCell label="Active" on />
          <StateCell label="Focus" cls="is-focus" />
          <StateCell label="Off" disabled />
          <span className="tqa-note">desktop</span>
        </div>
        <div className="tqa-row tqa-touch" style={{ marginTop: 14 }}>
          <StateCell label="Rest" />
          <StateCell label="Hover" cls="is-hov" />
          <StateCell label="Active" on />
          <StateCell label="Focus" cls="is-focus" />
          <StateCell label="Off" disabled />
          <span className="tqa-note">under a finger</span>
        </div>
      </IconWeightContext.Provider>

      <div className="tqa-h">A bar, its groups and a tooltip</div>
      <div className="tqa-tipdemo">
        <div className="tl-tip is-shown" aria-hidden="true"><span>Bold</span><Caps keys="Mod+B" /></div>
        <Toolbar label="Format" data-qa="format-bar">
          <Group>
            <Btn icon={Bold} label="Bold" keys="Mod+B" toggle on={bold} onClick={() => setBold((b) => !b)} />
            <Btn icon={Italic} label="Italic" keys="Mod+I" toggle />
            <Btn icon={Underline} label="Underline" keys="Mod+U" toggle />
            <Btn icon={Strikethrough} label="Strikethrough" toggle />
            <Btn icon={TextTSlash} label="Clear formatting" keys="Mod+\" />
          </Group>
          <Group>
            <Btn icon={List} label="Bulleted list" toggle />
            <Btn icon={ListOrdered} label="Numbered list" toggle />
            <Btn icon={ListChecks} label="Checklist" toggle />
          </Group>
          <Group>
            <Btn icon={AlignLeft} label="Align left" toggle on={align === 'left'} onClick={() => setAlign('left')} />
            <Btn icon={AlignCenter} label="Align center" toggle on={align === 'center'} onClick={() => setAlign('center')} />
            <Btn icon={AlignRight} label="Align right" toggle on={align === 'right'} onClick={() => setAlign('right')} />
            <Btn icon={AlignCenterVertical} label="Center in the box" toggle />
            <Btn icon={ChatCircleText} label="Comment" keys="Mod+Alt+M" />
          </Group>
        </Toolbar>
      </div>

      <div className="tqa-two">
        <div>
          <div className="tqa-h">The + menu</div>
          <IconWeightContext.Provider value="regular">
            <div className="tl-menu tqa-static" role="menu" aria-label="Add, as drawn">
              <MenuHead>Tools</MenuHead>
              <MenuItem icon={Scribble} label="Draw" keys="d" className="is-hov" />
              <MenuItem icon={Square} label="Shape" />
              <MenuItem icon={Palette} label="Palette" />
              <MenuHead>Create</MenuHead>
              <MenuItem icon={Paperclip} label="File" />
              <MenuItem icon={FolderOpen} label="Folder" />
              <MenuItem icon={LinkSimple} label="Link" />
              <MenuItem icon={ArrowSquareOut} label="Linked cluster" />
              <MenuHead>Annotate</MenuHead>
              <MenuItem icon={MessageCircle} label="Comment" />
              <MenuItem icon={ListChecks} label="Vote" />
            </div>
          </IconWeightContext.Provider>
        </div>
        <div>
          <div className="tqa-h">Colours</div>
          <Toolbar label="Colours">
            <Group>
              {colors.map(([name, c]) => (
                <Swatch key={name} label={name} color={c} on={color === c} onClick={() => setColor(c)} />
              ))}
              <Swatch add label="Custom colour" icon={Plus} />
            </Group>
          </Toolbar>

          <div className="tqa-h">Fields</div>
          <Toolbar label="Font">
            <Group>
              <Btn select text="Aileron" label="Font: Aileron" caret style={{ width: 108 }} />
              <Btn icon={Minus} label="Decrease font size" />
              <input className="tl-field" aria-label="Font size" defaultValue="15" size={2} />
              <Btn icon={Plus} label="Increase font size" />
            </Group>
          </Toolbar>

          <div className="tqa-h">Overflow</div>
          <Toolbar label="Lists" data-qa="overflow-bar">
            <Group>
              <Btn icon={List} label="Bulleted list" toggle />
              <Btn icon={ListOrdered} label="Numbered list" toggle />
            </Group>
            <Group>
              <MenuButton icon={MoreHorizontal} label="More" align="end">
                <MenuHead>Text</MenuHead>
                <MenuItem label="Strikethrough" keys="Mod+Shift+X" onSelect={() => setPicked('Strikethrough')} />
                <MenuItem label="Clear formatting" keys="Mod+\" onSelect={() => setPicked('Clear formatting')} />
                <MenuSep />
                <MenuItem label="Font" value="Serif" submenu={false} onSelect={() => setPicked('Font')} />
                <MenuItem label="Align" value="Left" onSelect={() => setPicked('Align')} />
                <MenuItem label="Spellcheck" checked onSelect={() => setPicked('Spellcheck')} />
              </MenuButton>
            </Group>
          </Toolbar>
          <div className="tqa-out" data-qa="picked">picked: {picked || '—'}</div>
        </div>
      </div>
    </div>
  );
}

export function ToolbarQaHarness() {
  useEffect(() => {
    installTipHost();
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);
  return (
    <div className="tqa">
      <style>{CSS}</style>
      <Half theme="dark" />
      <Half theme="light" />
    </div>
  );
}
