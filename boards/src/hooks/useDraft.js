// A conversation's message draft (see lib/draftStore.js): text, staged files,
// dropped cards, mentions and the reply it answers. The composer and the
// thread both read it, so "Replying to …" comes back with the text when you
// return to the conversation.
//
//   const [draft, update] = useDraft(key);
//   update((d) => ({ ...d, body: 'hi' }));

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getDraft, subscribeDraft, updateDraft, flushDrafts } from '../lib/draftStore.js';

// One part of a draft, re-rendering only when that part changes: the thread
// watches the reply target without re-rendering on every keystroke.
export function useDraftValue(key, pick) {
  const subscribe = useCallback((fn) => subscribeDraft(key, fn), [key]);
  const get = () => pick(getDraft(key));
  return useSyncExternalStore(subscribe, get, get);
}

export function useDraft(key) {
  const subscribe = useCallback((fn) => subscribeDraft(key, fn), [key]);
  const draft = useSyncExternalStore(subscribe, () => getDraft(key), () => getDraft(key));
  const update = useCallback((fn, opts) => updateDraft(key, fn, opts), [key]);
  // Leaving the conversation writes the stored copy now, not 300ms later.
  useEffect(() => () => flushDrafts(key), [key]);
  return [draft, update];
}
