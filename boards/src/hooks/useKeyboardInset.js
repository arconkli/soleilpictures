// lib/keyboardInset.js, live: what the on-screen keyboard covers now.
import { useEffect, useState } from 'react';
import { keyboardInset } from '../lib/keyboardInset.js';

// `on`: only while it matters (a field is focused, a popover is open), so a
// closed surface isn't re-rendered by every scroll of the visual viewport.
export function useKeyboardInset(on = true) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = on && typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) { setInset(0); return undefined; }
    const apply = () => setInset(keyboardInset());
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [on]);
  return inset;
}
