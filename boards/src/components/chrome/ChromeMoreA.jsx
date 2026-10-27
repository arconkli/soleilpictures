import { useLayoutEffect, useRef } from 'react';
import { MenuButton, MenuItem, MenuSep } from '../toolbar/Menu.jsx';
import { MoreHorizontal } from '../../lib/icons.js';

// ⋯ in the top islands (FloatingChrome.jsx): the toolbar look's menu
// (components/toolbar/Menu.jsx), portaled, under the button and lined up
// with its right edge, with the menu's keys (↓ ↑, Home, End, a letter;
// Escape gives the focus back to ⋯). A chunk of its own, warmed when the
// islands mount.
//
// items: [{ id, label, icon?, keys?, run } | { sep: true }], App's rows.
// focus: true when the stand-in this replaces went with the keyboard on it
// (FloatingChrome.jsx MoreStandIn), and ⋯ then takes it.
export function ChromeMoreA({ items, focus = null }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!focus?.current) return;
    focus.current = false;
    ref.current?.querySelector('.chrome-more-btn')?.focus();
  }, [focus]);
  return (
    <span className="chrome-more" ref={ref}>
      <MenuButton icon={MoreHorizontal} label="More" align="end" className="chrome-more-btn">
        {items.map((it, i) => (it.sep
          ? <MenuSep key={`sep-${i}`} />
          : <MenuItem key={it.id} icon={it.icon} label={it.label} keys={it.keys} onSelect={() => it.run?.()} />))}
      </MenuButton>
    </span>
  );
}
