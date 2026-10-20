// What a key press in a message field does. The composer and the edit box
// both ask here, so Enter means the same thing in each.
//
//   'send'     Enter on a desktop keyboard; ⌘/Ctrl+Enter anywhere
//   'newline'  Shift+Enter (or Alt+Enter); plain Enter on a touch keyboard,
//              whose return key makes lines — the Send button sends there
//   null       any other key, and every key while an input method is still
//              composing: that Enter picks the word, it never sends

// Safari ends the composition before its keydown, so the flag is already
// false on the Enter that picks the word; keyCode 229 still marks it.
export function isComposingKey(e) {
  return !!(e?.isComposing || e?.nativeEvent?.isComposing || e?.keyCode === 229);
}

export function messageKeyAction(e, { touch = false } = {}) {
  if (e?.key !== 'Enter' || isComposingKey(e)) return null;
  if (e.metaKey || e.ctrlKey) return 'send';
  if (e.shiftKey || e.altKey) return 'newline';
  return touch ? 'newline' : 'send';
}

// A touch keyboard: the primary pointer is a finger. Asked on every press,
// so a tablet that gains or loses a trackpad answers for the moment.
export function touchKeyboard() {
  try { return !!globalThis.matchMedia?.('(pointer: coarse)').matches; } catch (_) { return false; }
}
