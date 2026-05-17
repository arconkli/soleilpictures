// Per-thread message draft, persisted to localStorage.
//
// threadKey is the conversation id (optionally with a "r:<parentId>"
// suffix when composing a threaded reply). The draft lives in the
// user's browser; never synced. Cleared on successful send.

import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'soleil.boards.msg.draft.';

function readDraft(threadKey) {
  if (!threadKey || typeof localStorage === 'undefined') return '';
  try { return localStorage.getItem(PREFIX + threadKey) || ''; }
  catch (_) { return ''; }
}
function writeDraft(threadKey, value) {
  if (!threadKey || typeof localStorage === 'undefined') return;
  try {
    if (value && value.trim()) localStorage.setItem(PREFIX + threadKey, value);
    else                       localStorage.removeItem(PREFIX + threadKey);
  } catch (_) {}
}

export function useDraft(threadKey) {
  const [value, setValue] = useState(() => readDraft(threadKey));
  const flushTimer = useRef(null);
  const lastKeyRef = useRef(threadKey);

  // When the thread changes, swap to the new draft. Don't carry over
  // the previous in-memory value (which belongs to the old thread).
  useEffect(() => {
    if (lastKeyRef.current === threadKey) return;
    lastKeyRef.current = threadKey;
    setValue(readDraft(threadKey));
  }, [threadKey]);

  // Persist on every change (debounced 300ms so we don't thrash
  // localStorage while the user is typing).
  useEffect(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => writeDraft(threadKey, value), 300);
    return () => { if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, [threadKey, value]);

  const clear = useCallback(() => {
    setValue('');
    writeDraft(threadKey, '');
  }, [threadKey]);

  return [value, setValue, clear];
}
