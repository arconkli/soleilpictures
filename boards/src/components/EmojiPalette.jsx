import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const EMOJIS = ['👍', '❤️', '🎉', '😂', '🙏', '🔥', '👀', '✨'];

// A row of quick emoji under the button that opened it, or above it when
// there's no room below (the composer sits at the bottom of the screen).
//   trigger — the opening button: pressing it again is its own toggle, not an
//   outside press that closes the palette only for the click to reopen it.
export function EmojiPalette({ anchor, trigger = null, onPick, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const PAD = 8;
    const W = popRef.current?.offsetWidth || 280;
    const H = popRef.current?.offsetHeight || 44;
    const below = anchor.bottom + PAD;
    const top = below + H <= window.innerHeight - PAD ? below : Math.max(PAD, anchor.top - PAD - H);
    const left = Math.min(Math.max(PAD, anchor.left), window.innerWidth - W - PAD);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (trigger?.contains?.(e.target)) return;
      onClose?.();
    };
    // Claim Escape (preventDefault) so whatever the palette opened over (the
    // Messages panel, a comment) doesn't close on the same press.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, trigger]);

  return createPortal(
    <div ref={popRef} className="emoji-palette surface-frosted"
         style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {EMOJIS.map(e => (
        <button key={e} className="emoji-palette-btn" onClick={() => { onPick?.(e); onClose?.(); }}>{e}</button>
      ))}
    </div>,
    document.body,
  );
}
