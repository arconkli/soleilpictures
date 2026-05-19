import { useEffect, useState } from 'react';

// Canonical breakpoints for the boards app. Keep in sync with
// src/styles/breakpoints.css — both files must move together.
const PHONE_MAX = 640;
const TABLET_MAX = 1024;

const PHONE_Q = `(max-width: ${PHONE_MAX}px)`;
const TABLET_Q = `(min-width: ${PHONE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`;
const DESKTOP_Q = `(min-width: ${TABLET_MAX + 1}px)`;
const TOUCH_Q = '(hover: none) and (pointer: coarse)';

function readState() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { isPhone: false, isTablet: false, isDesktop: true, isTouch: false };
  }
  return {
    isPhone: window.matchMedia(PHONE_Q).matches,
    isTablet: window.matchMedia(TABLET_Q).matches,
    isDesktop: window.matchMedia(DESKTOP_Q).matches,
    isTouch: window.matchMedia(TOUCH_Q).matches,
  };
}

// Single source of truth for responsive decisions in JS. Always
// prefer this over scattered window.innerWidth reads — that pattern
// races with React renders and ignores the coarse-pointer dimension.
//
// Returns { isPhone, isTablet, isDesktop, isTouch } where the size
// flags are mutually exclusive and isTouch is orthogonal (an iPad
// in landscape is isDesktop && isTouch).
export function useBreakpoint() {
  const [state, setState] = useState(readState);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mqs = [
      window.matchMedia(PHONE_Q),
      window.matchMedia(TABLET_Q),
      window.matchMedia(DESKTOP_Q),
      window.matchMedia(TOUCH_Q),
    ];
    const onChange = () => setState(readState());
    for (const mq of mqs) {
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else mq.addListener(onChange);
    }
    setState(readState());
    return () => {
      for (const mq of mqs) {
        if (mq.removeEventListener) mq.removeEventListener('change', onChange);
        else mq.removeListener(onChange);
      }
    };
  }, []);

  return state;
}

export const BREAKPOINTS = { PHONE_MAX, TABLET_MAX };
