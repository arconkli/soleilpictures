import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { X } from '../lib/icons.js';
import { MessageFaces } from './MessageFaces.jsx';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { dayLabel } from '../lib/messageFeed.js';

// A conversation's pinned messages, from the pin count in its header (the
// card look): newest first, who and when, the words, and Unpin. A row goes to
// its message in the thread.
//   anchor  — the pin count's rect; trigger — the count itself (its own toggle)
//   pinned  — the pinned rows, oldest first, as listPinnedForConversation gives them
//   onClose(back) — back: true when it shut from inside, so focus goes home
export function MessagePinsPopover({ anchor, trigger = null, title, pinned, selfId, onJump, onUnpin, onClose }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  // Under the count, its right edge under the count's, kept inside the panel.
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el || !anchor) return;
    const PAD = 8;
    const w = el.offsetWidth;
    const panel = (trigger?.closest?.('.msg-panel') || document.querySelector('.msg-panel'))?.getBoundingClientRect();
    const minX = Math.max(PAD, (panel?.left ?? 0) + PAD);
    const maxX = Math.min(window.innerWidth, panel?.right ?? window.innerWidth) - w - PAD;
    setPos({ top: anchor.bottom + 6, left: Math.max(minX, Math.min(anchor.right - w, maxX)) });
  }, [anchor, trigger]);

  // Into it once it has its place, on its first message.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!pos || focusedRef.current) return;
    focusedRef.current = true;
    popRef.current?.querySelector('.msg-pins-go')?.focus({ preventScroll: true });
  }, [pos]);

  useEffect(() => {
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || trigger?.contains?.(e.target)) return;
      onClose(false);
    };
    // Claimed, so the panel underneath stays open.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(true); } };
    // It's placed under the count, which the thread scrolling doesn't move:
    // only a resize leaves it.
    const onResize = () => onClose(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose, trigger]);

  const rows = [...(pinned || [])].reverse();
  return createPortal((
    <div ref={popRef} className="msg-pins-pop" role="dialog" aria-label="Pinned messages"
         style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}>
      <div className="msg-pins-head">
        <span className="msg-pins-title">{title ? `Pinned in ${title}` : 'Pinned'}</span>
        <button type="button" className="msg-panel-icon" onClick={() => onClose(true)} aria-label="Close" title="Close (Esc)">
          <Icon as={X} size={14} weight="regular" />
        </button>
      </div>
      <div className="msg-pins-list">
        {rows.map((m) => {
          const mine = m.sender_id === selfId;
          const p = userProfiles.get(m.sender_id);
          const name = mine ? 'You' : (p?.name || p?.email || m.sender_name || 'Member');
          return (
            <div key={m.id} className="msg-pins-row">
              <button type="button" className="msg-pins-go" onClick={() => { onClose(true); onJump?.(m.id); }}
                      title="Go to the message">
                <MessageFaces people={[{ id: m.sender_id, name: mine ? (p?.name || 'You') : name, color: p?.color || pickPresenceColor(m.sender_id || '') }]} size={26} />
                <span className="msg-pins-text">
                  <span className="msg-pins-top">
                    <span className="msg-pins-who">{name}</span>
                    <span className="msg-pins-when">{whenLabel(m.created_at)}</span>
                  </span>
                  <span className="msg-pins-body">{String(m.body || '').replace(/\s+/g, ' ').trim() || 'Attachment'}</span>
                </span>
              </button>
              {onUnpin && (
                <button type="button" className="msg-pins-unpin" onClick={() => onUnpin(m)}>Unpin</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  ), document.body);
}

// "Today, 9:13 AM", "Yesterday, 4:12 PM", then the day alone.
function whenLabel(iso) {
  if (!iso) return '';
  const day = dayLabel(iso);
  if (day !== 'Today' && day !== 'Yesterday') return day;
  return `${day}, ${new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
