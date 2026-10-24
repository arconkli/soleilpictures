import { Fragment } from 'react';
import { Icon } from './Icon.jsx';
import { ChevronRight } from '../lib/icons.js';
import { shortcutAria, shortcutCaps, toolbarLook } from '../lib/looks.js';

// Two parts of a row in the right-click menus (CardContextMenu.jsx,
// BackgroundContextMenu.jsx): its shortcut, and the › of a row that opens a
// submenu. In the toolbar look (lib/looks.js; styles/toolbarLook.css) the
// shortcut is a cap per key, and the row says it to a screen reader in its
// aria-keyshortcuts rather than in its name (rowKeys); the › is the look's
// caret. Today's look keeps the words and the glyph.

export function rowKeys(written, look = toolbarLook()) {
  return look && written ? { 'aria-keyshortcuts': shortcutAria(written) } : {};
}

// The caps keep the words' "+" between them, unseen (toolbarLook.css), so
// the shortcut's text is the menu's, "Ctrl+D" as it was.
export function CtxShortcut({ keys }) {
  if (!keys) return null;
  if (!toolbarLook()) return <span className="ctx-shortcut">{keys}</span>;
  const caps = shortcutCaps(keys);
  const plus = caps.length > 1 && caps.join('+') === String(keys).trim();
  return (
    <span className="ctx-shortcut is-caps" aria-hidden="true">
      {caps.map((k, i) => (
        <Fragment key={i}>
          {plus && i > 0 && <span className="ctx-kplus">+</span>}
          <kbd>{k}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function CtxChevron() {
  return toolbarLook()
    ? <Icon as={ChevronRight} size={12} weight="regular" className="ctx-chevron" aria-hidden="true" />
    : <span className="ctx-chevron" aria-hidden="true">›</span>;
}
