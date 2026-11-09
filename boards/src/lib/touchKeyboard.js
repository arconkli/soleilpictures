// The keyboard keeper: holds a phone's on-screen keyboard while a note's
// editor loads.
//
// iOS raises the keyboard only for a focus() that runs inside the user's
// gesture (the tap's own pointerup). A note's editor is a chunk of its own and
// mounts a beat after the tap, so its focus came too late: the caret blinked
// and no keyboard came up. So the tap that opens a note focuses this hidden
// field at once, where the finger lifted, and iOS raises the keyboard for it.
// When the editor mounts it takes the focus straight from the field (a direct
// move from one editable to another keeps the keyboard up), the field goes,
// and what was typed meanwhile is replayed into the note (NoteTiptapSurface
// handOffTouchKeyboard). lib/noteTypeAhead.js does the same job for a
// keyboard and a mouse; this one is for a finger or a pen.
//
// It is a real textarea, so the platform's own typing, predictive text and
// autocorrect run in it and its value is simply what was typed. 16px type, or
// iOS zooms in on it. Drawn at the tap with opacity 0: not display:none (iOS
// won't focus it) and not off screen (iOS scrolls to it). pointer-events:none,
// so nothing can land on it, and elementFromPoint (the caret mapping) looks
// through it.
//
// It never lets the focus go on its own: a blur that leaves the focus nowhere
// (a tap's late mousedown on something that can't take focus) takes it back.
// It goes when the editor takes over (releaseTouchKeyboard), when editing ends
// or the note goes (dropTouchKeyboard), on a tap outside (abandonTouchKeyboard,
// which hands the note back to reading), when the card limit refuses the note
// it was raised for (dropUnclaimedTouchKeyboard), or, while no note has
// claimed it, on its timer. One held for a note has no timer: it waits for
// the editor however long it takes. A 10s timer once threw away what was typed
// into it, and the keys after that reached the canvas.

import { keeperCapitalsAt, noteTypingAttrs } from './noteTouchTyping.js';

const CLAIM_MS = 1500;   // a keeper for a note that doesn't exist yet (the note tool)

let field = null;
let heldFor = null;      // card id, or null: the next note that claims it
let onAbandon = null;
let timer = 0;

const typesHere = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function clear() {
  clearTimeout(timer);
  timer = 0;
  const el = field;
  field = null;
  heldFor = null;
  onAbandon = null;
  if (el) el.remove();
}

// Focus the keeper now, inside the gesture. `cardId` null: a note about to be
// placed, which claims it as it mounts. `abandon` runs when a tap outside ends
// the edit before the editor came.
export function holdTouchKeyboard(cardId = null, at = null, abandon = null) {
  if (typeof document === 'undefined' || !document.body) return false;
  clear();
  const el = document.createElement('textarea');
  el.className = 'note-touch-keeper';
  el.setAttribute('aria-label', 'Note');
  // The same typing as the note's editor (lib/noteTouchTyping.js).
  for (const [k, v] of Object.entries(noteTypingAttrs())) el.setAttribute(k, v);
  // A tap into a note's text: a capital only where a sentence starts there.
  if (cardId != null && at && el.hasAttribute('autocapitalize')) {
    el.setAttribute('autocapitalize', keeperCapitalsAt(document, at.x, at.y));
  }
  el.setAttribute('autocomplete', 'off');
  el.tabIndex = -1;
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  const x = clamp(Number.isFinite(at?.x) ? at.x : vw / 2, 0, Math.max(0, vw - 2));
  const y = clamp(Number.isFinite(at?.y) ? at.y : vh / 3, 0, Math.max(0, vh - 22));
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:1px;height:20px;margin:0;padding:0;`
    + 'border:0;outline:0;font-size:16px;line-height:20px;opacity:0;color:transparent;'
    + 'background:transparent;caret-color:transparent;resize:none;overflow:hidden;'
    + 'pointer-events:none;z-index:2147483647';
  el.addEventListener('blur', () => {
    setTimeout(() => {
      if (field === el && !typesHere(document.activeElement)) {
        try { el.focus({ preventScroll: true }); } catch (_) { /* gone */ }
      }
    }, 0);
  });
  document.body.appendChild(el);
  field = el;
  heldFor = cardId ?? null;
  onAbandon = abandon;
  try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
  if (heldFor == null) timer = setTimeout(clear, CLAIM_MS);
  return true;
}

// A keeper is waiting for this note (or for whichever note comes next).
export function touchKeyboardHeld(cardId) {
  return !!field && (heldFor == null || heldFor === cardId);
}

// The note the keeper was raised for (or, unclaimed, the note just placed)
// takes it: a tap outside now hands this note back to reading.
export function claimTouchKeyboard(cardId, abandon = null) {
  if (!touchKeyboardHeld(cardId)) return false;
  // Claimed, it waits for this note's editor however long it takes.
  clearTimeout(timer);
  timer = 0;
  heldFor = cardId;
  if (abandon) onAbandon = abandon;
  return true;
}

// The editor has the focus: what was typed into the keeper ('' when nothing),
// and the keeper is gone. Call only after the editor is focused (or once it
// can't be), or iOS drops the keyboard on the way.
export function releaseTouchKeyboard(cardId) {
  if (!touchKeyboardHeld(cardId)) return '';
  const text = field.value || '';
  clear();
  return text;
}

// Editing of this note ended (or it unmounted) before the editor took over.
export function dropTouchKeyboard(cardId) {
  if (field && heldFor === cardId) clear();
}

// The note the note tool's keeper was raised for was never placed: the card
// limit refused it. Let the keyboard go now, or the keeper takes the focus
// back from the wall that says why.
export function dropUnclaimedTouchKeyboard() {
  if (field && heldFor == null) clear();
}

// A tap outside while a note still waits for its editor: drop the keeper and
// hand the note back to reading. `except` is the note the tap landed on: its
// own pointerup may have raised this keeper a moment before the canvas heard
// the same tap, and that one stays.
export function abandonTouchKeyboard(except = null) {
  if (!field || (except != null && heldFor === except)) return false;
  const fn = onAbandon;
  clear();
  try { fn?.(); } catch (_) { /* the note is gone */ }
  return true;
}
