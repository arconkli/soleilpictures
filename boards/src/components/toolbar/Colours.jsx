import { useRecentColors } from '../../hooks/useRecentColors.js';
import { addRecentColor } from '../../lib/recentColors.js';
import { swatchBg } from '../ToolOptionsBar.jsx';
import { MenuHead, useMenu } from './Menu.jsx';
import { Swatch } from './Toolbar.jsx';
import { Plus } from '../../lib/icons.js';

const keep = (e) => e.preventDefault();

// The colour a stroke, a line or a shape's outline paints as the theme's ink
// (dark on the light theme; CanvasSurface isDefaultInk): its swatch and its
// chip show it so (`ink`).
const THEME_INK = '#f5f5f6';
export const inkBg = (c) => (String(c || '').trim().toLowerCase() === THEME_INK ? 'var(--ink-0)' : swatchBg(c));

// The colours a bar of the toolbar look offers, `n` at most: none at all
// ('transparent', "No fill") first where the bar has it, then the recent
// ones it doesn't already show, the cluster's palette and the bar's own. A
// colour picked from a row stays where it was: only one from the picker (a
// recent one of no other row) comes in at the front.
export function colourChoices(recent, palette, own, n) {
  const base = [...palette, ...own.filter((c) => c !== 'transparent')];
  const lead = own.includes('transparent') ? ['transparent'] : [];
  return [...new Set([...lead, ...recent.filter((c) => !base.includes(c)), ...base])].slice(0, n);
}

// A colour to pick, in a menu of the toolbar look's canvas bars (the note's
// text and background, a drawing's ink, a shape's stroke and fill), sixteen
// at most, and + for any other (the colour picker). Rows of a menu to a
// screen reader and the arrow keys. 'transparent' is `clear` ("No
// background", "No fill"), and stays out of the recents, where it would be an
// invisible swatch on the rows that don't checkerboard it; `recent` false
// keeps every pick out of them (a shape's colour before there's a shape).
export function ColourRows({ head, swatches, paletteColors, current, onPick, onCustom, clear = 'No background', recent = true, ink = false }) {
  const menu = useMenu();
  const recentColors = useRecentColors();
  const all = colourChoices(recentColors, paletteColors, swatches, 16);
  return (
    <>
      <MenuHead>{head}</MenuHead>
      <div className="tl-swrow" role="group" aria-label={head}>
        {all.map((c) => (
          <Swatch key={c} color={ink ? inkBg(c) : swatchBg(c)} label={c === 'transparent' ? clear : `Color ${c}`}
                  className={c === 'transparent' ? 'is-clear' : undefined}
                  role="menuitemradio" aria-checked={current === c} aria-pressed={undefined} tabIndex={-1}
                  on={current === c} onMouseDown={keep}
                  onClick={() => { onPick(c); if (recent && c !== 'transparent') addRecentColor(c); menu?.close('select'); }} />
        ))}
        <Swatch add icon={Plus} label="Custom color" role="menuitem" tabIndex={-1} onMouseDown={keep}
                onClick={(e) => { menu?.close('select'); onCustom(e); }} />
      </div>
    </>
  );
}

// A colour in a button's face: a chip (a fill), a dot, or a ring (a stroke).
export function Chip({ color, shape = 'chip', ink = false }) {
  return (
    <span className={`tl-chip is-${shape}${color === 'transparent' ? ' is-none' : ''}`}
          style={{ '--chip': ink ? inkBg(color) : swatchBg(color) }} aria-hidden="true" />
  );
}
