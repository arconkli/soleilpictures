import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const EMOJIS = ['👍', '❤️', '🎉', '😂', '🙏', '🔥', '👀', '✨'];

export function EmojiPalette({ anchor, onPick, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const W = 280, PAD = 8;
    const top = Math.min(window.innerHeight - 60 - PAD, anchor.bottom + PAD);
    const left = Math.min(Math.max(PAD, anchor.left), window.innerWidth - W - PAD);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div ref={popRef} className="emoji-palette surface-frosted" style={{ top: pos.top, left: pos.left }}>
      {EMOJIS.map(e => (
        <button key={e} className="emoji-palette-btn" onClick={() => { onPick?.(e); onClose?.(); }}>{e}</button>
      ))}
    </div>,
    document.body,
  );
}
