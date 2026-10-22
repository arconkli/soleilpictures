import { createContext, useContext, useEffect, useState } from 'react';

// Keeps the Messages panel on screen for its exit once it's told to close:
// the panel reads 'closing' here and carries data-state="closing", the
// stylesheet plays the exit, and then it goes. At once under reduced
// motion. `children` is a function, so a closed panel costs whoever renders
// it nothing to describe.
export const PANEL_EXIT_MS = 180;

const PresenceContext = createContext('open');
export const usePanelPresence = () => useContext(PresenceContext);

function reducedMotion() {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}

export function MessagesPresence({ open, children }) {
  // Still on screen: open, or closed but not yet through its exit.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return undefined; }
    if (reducedMotion()) { setMounted(false); return undefined; }
    const t = setTimeout(() => setMounted(false), PANEL_EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);
  if (!open && (!mounted || reducedMotion())) return null;
  return (
    <PresenceContext.Provider value={open ? 'open' : 'closing'}>
      {children()}
    </PresenceContext.Provider>
  );
}
