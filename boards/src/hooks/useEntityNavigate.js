// Single navigation entry point for every entity kind.
//
// App.jsx publishes a `navHandlers` map (one function per kind) into
// the EntityNavigateContext. Surfaces call `useEntityNavigate()` and
// receive a single `navigate(ref)` callback that internally dispatches
// to the right handler. They never need to know which surface a ref
// opens into.

import { createContext, useContext, useCallback } from 'react';
import { coerceRef } from '../lib/entityRef.js';

export const EntityNavigateContext = createContext(null);

export function useEntityNavigate() {
  const handlers = useContext(EntityNavigateContext);
  return useCallback((ref, opts = {}) => {
    const r = coerceRef(ref);
    if (!r) { console.warn('useEntityNavigate: bad ref', ref); return; }
    const fn = handlers?.[r.kind];
    if (!fn) { console.warn('useEntityNavigate: no handler for', r.kind); return; }
    try { fn(r, opts); }
    catch (e) { console.warn('useEntityNavigate failed', r, e); }
  }, [handlers]);
}
