import { useEffect, useState } from 'react';
import { fingerShouldDraw, stylusSeen, subscribe } from '../lib/pointerPolicy.js';

// Re-renders when a stylus is first detected or the finger preference changes,
// so the draw options can reveal the "Draw with finger" toggle the moment it
// becomes meaningful rather than only after a remount.
export function usePointerPolicy() {
  const read = () => ({ stylus: stylusSeen(), fingerDraws: fingerShouldDraw() });
  const [state, setState] = useState(read);
  useEffect(() => subscribe(() => setState(read())), []);
  return state;
}
