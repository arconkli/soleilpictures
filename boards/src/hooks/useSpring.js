import { useEffect, useRef, useState } from 'react';
import { createSpring, dragSession, onDragSession } from '../lib/springLoad.js';

// A spring-loading timer for one component's drop targets (lib/springLoad.js).
// `armed` is the key being held over — for the target's blink. Only drags out
// of Files spring (a drag session is live); a file from the desktop doesn't.
// Everything is let go of when the drag ends.
export function useSpring() {
  const [armed, setArmed] = useState(null);
  const ref = useRef(null);
  if (!ref.current) ref.current = createSpring({ onArm: setArmed });
  useEffect(() => {
    const off = onDragSession((e) => { if (e.type === 'end') ref.current.cancel(); });
    return () => { off(); ref.current.cancel(); };
  }, []);
  const s = ref.current;
  return {
    armed,
    // Drag handlers: enter/over arm the key, leave (out of the target, not
    // into one of its children) lets go.
    enter: (key, fire) => { if (dragSession()) s.enter(key, fire); },
    leave: (key, e) => {
      if (e && e.currentTarget?.contains?.(e.relatedTarget)) return;
      s.leave(key);
    },
    cancel: () => s.cancel(),
  };
}
