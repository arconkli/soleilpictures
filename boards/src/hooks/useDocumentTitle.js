import { useEffect } from 'react';
import { setBaseTitle } from '../lib/documentTitle.js';

// Names the browser tab after whatever the user is actually looking at.
//
// Nothing in the signed-in app set document.title before this, so every tab
// read the same static marketing string from index.html — and someone working
// across four clusters, which split view and "Pin alongside" exist to
// encourage, had four indistinguishable tabs.
//
// Pass null for a surface with no name of its own; documentTitle falls back to
// the served title rather than blanking the tab.
export function useDocumentTitle(base) {
  useEffect(() => {
    setBaseTitle(base);
    return () => setBaseTitle(null);
  }, [base]);
}
