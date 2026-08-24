// contextMenuGuard — one rule for "a floating panel swallows the right-click".
//
// Every popover on the canvas has to stop a contextmenu from reaching the card
// or background menu behind it: opening "Duplicate / Delete / Bring to front"
// for the card *underneath* a colour picker is never what anyone meant.
//
// Six of them stopped propagation and forgot preventDefault, so the OS menu
// opened in the app menu's place — and which menu you got depended on where in
// the panel you clicked. That inconsistency is the bug this module exists to
// end; it is also the one a competitor's users reported, word for word, as
// "sometimes it brings up the computer's menu and sometimes the app's".
//
// The rule is NOT "always suppress". Over a real text field the browser's own
// menu is the right answer — pasting a hex into the colour picker, copying a
// selection, Look Up, Emoji & Symbols. Those are the whole reason anyone
// right-clicks in text, and no app menu offers them. So: swallow on chrome,
// defer on anything editable.
//
// isEditablePointerTarget, not isEditableTarget: a contextmenu carries a precise
// target, and where the caret happens to be parked is none of its business.
// See the header of isEditableTarget.js for why that distinction matters.
import { isEditablePointerTarget } from './isEditableTarget.js';

// Decide what a popover should do with a contextmenu, from the event alone.
// Split out from the handler so it is node-testable without a DOM.
//   'defer'    — let it through untouched; the browser menu is correct here
//   'swallow'  — stop propagation AND preventDefault; neither menu should open
export function contextMenuAction(e) {
  return isEditablePointerTarget(e) ? 'defer' : 'swallow';
}

// Drop-in `onContextMenu` handler for popover roots.
export function swallowContextMenu(e) {
  // stopPropagation happens either way: the panel is on top, so the card menu
  // behind it must never open, whether or not we also suppress the OS menu.
  e.stopPropagation();
  if (contextMenuAction(e) === 'swallow') e.preventDefault();
}
