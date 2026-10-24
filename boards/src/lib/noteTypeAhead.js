// Keys typed between placing a note and its editor taking the focus.
//
// A note placed to be written in gets its editor a beat later: the legacy
// editor (RichNoteEditor) focuses on the next tick, and the collaborative one
// (NoteTiptapSurface) is a chunk of its own, fetched at the session's first
// edit. Keys typed in between reached the page: lost, or worse, taken as the
// canvas's shortcuts (D is the draw tool, H is Pan). So addNote holds the
// typing in a field off screen from the moment the note is placed, and the
// note's editor takes what it holds as it focuses. A field the editor never
// takes goes after a few seconds, its keys with it, as they went before.
//
// The note tool places on the press, and the press then moves the focus as it
// goes down. The field takes it back on the next tick, but keys come before
// timers, so until then a key that lands on the page rather than somewhere you
// type is the field's too (window capture, ahead of the canvas's shortcuts).
// Escape, or the next press anywhere, ends the hold: you've moved on, and the
// canvas's keys are yours again.
//
// Not under a finger: a phone raises its keyboard for whichever field has the
// focus, and a note's touch entry focuses its editor inside the tap.

const HOLD_MS = 5000;

let field = null;
let heldFor = null;
let timer = 0;
let onKey = null;
let onPress = null;

const typesHere = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function holdNoteTypeAhead(cardId) {
  if (typeof document === 'undefined' || !document.body || !cardId) return;
  try { if (window.matchMedia?.('(pointer: coarse)').matches) return; } catch (_) { /* no media queries */ }
  dropNoteTypeAhead();
  const el = document.createElement('textarea');
  el.className = 'note-typeahead';
  // It has the focus for a beat, so a screen reader names it rather than
  // landing on nothing.
  el.setAttribute('aria-label', 'New note');
  el.setAttribute('autocomplete', 'off');
  el.tabIndex = -1;
  el.spellcheck = false;
  el.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  el.addEventListener('blur', () => {
    setTimeout(() => {
      if (field === el && !typesHere(document.activeElement)) el.focus({ preventScroll: true });
    }, 0);
  });
  onKey = (e) => {
    if (field !== el) return;
    if (e.key === 'Escape') { dropNoteTypeAhead(); return; }
    if (e.target === el || typesHere(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    if (e.key.length === 1) el.value += e.key;
    else if (e.key === 'Enter') el.value += '\n';
    else if (e.key === 'Backspace') el.value = el.value.slice(0, -1);
    else return;
    e.preventDefault();
    e.stopPropagation();
    el.focus({ preventScroll: true });
  };
  // Added inside the press that places the note, so it hears the next one.
  onPress = () => dropNoteTypeAhead();
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPress, true);
  document.body.appendChild(el);
  el.focus({ preventScroll: true });
  field = el;
  heldFor = cardId;
  timer = setTimeout(dropNoteTypeAhead, HOLD_MS);
}

// What was typed for this note while it waited ('' when nothing, or when the
// field holds another note's); taking it removes the field.
export function takeNoteTypeAhead(cardId) {
  if (!field || heldFor !== cardId) return '';
  const text = field.value;
  dropNoteTypeAhead();
  return text;
}

export function dropNoteTypeAhead() {
  clearTimeout(timer);
  timer = 0;
  heldFor = null;
  if (onKey) { window.removeEventListener('keydown', onKey, true); onKey = null; }
  if (onPress) { window.removeEventListener('pointerdown', onPress, true); onPress = null; }
  if (field) { field.remove(); field = null; }
}
