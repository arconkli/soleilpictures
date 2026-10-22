import { forwardRef, useRef } from 'react';
import { Icon, IconWeightContext } from '../Icon.jsx';
import { useToolbarRoving } from '../../hooks/useToolbarRoving.js';
import { ariaKeys } from '../../lib/ariaKeys.js';
import { ChevronDown } from '../../lib/icons.js';
import { keyCaps, tlTip } from '../../lib/looks.js';
import './toolbar.css';

// The parts of a bar in the toolbar look (the owner's pick "A · Islands",
// 2026-10-21; toolbar.css is the look). A Toolbar is the WAI-ARIA toolbar
// (hooks/useToolbarRoving): one Tab stop, the arrows along it, and, for a bar
// that formats a text (`text`), ⌥F10 from the text to the bar and Escape
// back. Its icons are Phosphor's regular, the sidebar's weight.
//
//   <Toolbar label="Format">
//     <Group><Btn icon={TextB} label="Bold" keys="Mod+B" toggle on={bold} onClick={…} /></Group>
//     <Group><Btn text="Share" onClick={…} /></Group>
//   </Toolbar>
export function Toolbar({ label, vertical = false, text = null, surface = true, barRef, className = '', onKeyDown, children, ...rest }) {
  const own = useRef(null);
  const ref = barRef || own;
  const roving = useToolbarRoving(ref, { orientation: vertical ? 'vertical' : 'horizontal', text });
  const cls = ['tl-bar'];
  if (surface) cls.push('tl-surf');
  if (vertical) cls.push('tl-vert');
  if (className) cls.push(className);
  return (
    <IconWeightContext.Provider value="regular">
      <div ref={ref} role="toolbar" aria-label={label}
           aria-orientation={vertical ? 'vertical' : undefined}
           aria-keyshortcuts={text ? 'Alt+F10' : undefined}
           className={cls.join(' ')}
           onKeyDown={(e) => { onKeyDown?.(e); roving(e); }}
           {...rest}>
        {children}
      </div>
    </IconWeightContext.Provider>
  );
}

// Controls that go together, with a hairline before the next group.
export function Group({ label, className = '', children }) {
  return (
    <div className={className ? `tl-g ${className}` : 'tl-g'} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  );
}

// A button. An icon's is named by `label`, which its tooltip shows with the
// shortcut's keys (`keys`, aria-keyshortcuts' spec: "Mod+B"); one with words
// (`text`) is named by them, and has a tooltip only for its keys or `tip`.
// `toggle` makes it say whether it's on (aria-pressed); `on` lights it either
// way (a tool that's armed). `caret` adds ⌄ for a button that opens a menu,
// and `select` lays it out as a value to pick from (a font, a style).
export const Btn = forwardRef(function Btn({
  icon, label, text, keys, tip, tipSide, on = false, toggle = false, caret = false, select = false,
  className = '', children, type = 'button', ...rest
}, ref) {
  const cls = ['tl-btn'];
  if (text != null) cls.push(select ? 'is-select' : 'has-text');
  if (on) cls.push('is-on');
  if (className) cls.push(className);
  const tipWords = text == null ? (tip ?? label) : (tip ?? (keys ? (label ?? text) : null));
  return (
    <button ref={ref} type={type} className={cls.join(' ')}
            aria-label={text == null ? label : (label && label !== text ? label : undefined)}
            aria-pressed={toggle ? !!on : undefined}
            aria-keyshortcuts={keys ? ariaKeys(keys) : undefined}
            {...(tipWords ? tlTip(tipWords, keys, tipSide) : null)}
            {...rest}>
      {icon ? <Icon as={icon} size={18} /> : null}
      {text != null ? <span className="tl-bt">{text}</span> : null}
      {children}
      {caret ? <Icon as={ChevronDown} size={10} className="tl-caret" /> : null}
    </button>
  );
});

// A shortcut, each key in its own cap, for the eye: the control's
// aria-keyshortcuts says it to a screen reader.
export function Caps({ keys }) {
  const caps = keyCaps(keys);
  if (!caps.length) return null;
  return (
    <span className="tl-keys" aria-hidden="true">
      {caps.map((k, i) => <kbd key={i}>{k}</kbd>)}
    </span>
  );
}

// A colour to pick: `color` fills it, `on` rings it. `add` is the + that
// opens the custom colour.
export function Swatch({ color, label, on = false, add = false, icon, className = '', ...rest }) {
  const cls = ['tl-sw'];
  if (on) cls.push('is-on');
  if (add) cls.push('is-add');
  if (className) cls.push(className);
  return (
    <button type="button" className={cls.join(' ')} style={add ? undefined : { '--c': color }}
            aria-label={label} aria-pressed={add ? undefined : !!on} {...tlTip(label)} {...rest}>
      {add && icon ? <Icon as={icon} size={12} /> : null}
    </button>
  );
}
