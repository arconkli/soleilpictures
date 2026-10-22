import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { Reply, Copy, Link as LinkIcon, Pin, Edit, Trash2 } from '../lib/icons.js';
import { QUICK_EMOJIS } from './EmojiPalette.jsx';
import { withinEditWindow } from '../lib/messageEdit.js';

// A message's actions in one menu (the card look): the quick reactions along
// its top (yours lit), then Reply, Copy text, Copy link, Pin, and Edit and
// Delete for your own. The ⋯ beside a bubble opens it and so does a right
// click; under a finger the same actions are a press-and-hold sheet
// (MessageActionSheet). The arrow keys move through it, Escape shuts it.
//   anchor  — the rect it opens from: the ⋯ button, or the point clicked
//   trigger — the ⋯ button, whose press is its own toggle and not an outside
//             press that shuts the menu only for the click to reopen it
//   onClose(back) — back: true when it shut from inside (an action, Escape),
//             so focus goes home; false for a press elsewhere, which keeps it
export function MessageMenu({
  msg, selfId, anchor, trigger = null, onClose, onReact, onReply, onCopyText, onCopyLink, onPin, onEdit, onDelete,
}) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const isMine = msg.sender_id === selfId;
  const editable = isMine && withinEditWindow(msg.created_at) && !msg.sendState;
  const yours = new Set(Object.entries(msg.reactions || {})
    .filter(([, ids]) => Array.isArray(ids) && ids.includes(selfId))
    .map(([emoji]) => emoji));
  const run = (fn) => () => { onClose(true); fn?.(msg); };

  // Under the anchor, above it when there's no room below, opening over the
  // bubble (rightward from yours, whose ⋯ is on its left) and kept inside the
  // panel it belongs to.
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el || !anchor) return;
    const PAD = 8;
    const w = el.offsetWidth, h = el.offsetHeight;
    const panel = (trigger?.closest?.('.msg-panel') || document.querySelector('.msg-panel'))?.getBoundingClientRect();
    const minX = Math.max(PAD, (panel?.left ?? 0) + PAD);
    const maxX = Math.min(window.innerWidth, panel?.right ?? window.innerWidth) - w - PAD;
    const below = anchor.bottom + 4;
    const top = below + h <= window.innerHeight - PAD ? below : Math.max(PAD, anchor.top - 4 - h);
    const left = isMine ? anchor.left : anchor.right - w;
    setPos({ top, left: Math.max(minX, Math.min(left, maxX)) });
  }, [anchor, trigger, isMine]);

  // Into the menu once it has its place (hidden, it can't take focus), on its
  // first reaction.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!pos || focusedRef.current) return;
    focusedRef.current = true;
    popRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [pos]);

  useEffect(() => {
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || trigger?.contains?.(e.target)) return;
      onClose(false);
    };
    const onKey = (e) => {
      // Claimed, so the panel underneath stays open.
      if (e.key === 'Escape') { e.preventDefault(); onClose(true); return; }
      if (e.key === 'Tab') { onClose(true); return; }
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step && e.key !== 'Home' && e.key !== 'End') return;
      const items = [...(popRef.current?.querySelectorAll('button') || [])];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + step + items.length) % items.length;
      items[next].focus();
    };
    // It's placed where its message was: the thread moving under it, or a
    // resize, leaves it. The thread settling a few pixels doesn't (an image
    // landing, the view pinning to the newest, a scroll that finished just
    // before it opened).
    const thread = trigger?.closest?.('.msg-thread-body') || document.querySelector('.msg-pane-thread .msg-thread-body');
    const from = thread ? thread.scrollTop : 0;
    const onMove = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (e.type === 'scroll' && e.target === thread && Math.abs(thread.scrollTop - from) <= 24) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [onClose, trigger]);

  return createPortal((
    <div ref={popRef} className="msg-menu" role="menu" aria-label="Message actions"
         style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}>
      <div className="msg-menu-reacts" role="group" aria-label="React">
        {QUICK_EMOJIS.map((emoji) => (
          <button key={emoji} type="button" role="menuitemcheckbox" aria-checked={yours.has(emoji)}
                  className={`msg-menu-emoji${yours.has(emoji) ? ' is-on' : ''}`}
                  aria-label={`React with ${emoji}`}
                  onClick={() => { onClose(true); onReact?.(msg, emoji); }}>
            {emoji}
          </button>
        ))}
      </div>
      <div className="msg-menu-sep" role="separator" />
      {onReply && (
        <button type="button" role="menuitem" className="msg-menu-item" onClick={run(onReply)}>
          <Icon as={Reply} size={15} weight="regular" />Reply<span className="msg-menu-key">R</span>
        </button>
      )}
      {msg.body && onCopyText && (
        <button type="button" role="menuitem" className="msg-menu-item" onClick={run(onCopyText)}>
          <Icon as={Copy} size={15} weight="regular" />Copy text
        </button>
      )}
      {onCopyLink && (
        <button type="button" role="menuitem" className="msg-menu-item" onClick={run(onCopyLink)}>
          <Icon as={LinkIcon} size={15} weight="regular" />Copy link
        </button>
      )}
      {onPin && (
        <button type="button" role="menuitem" className="msg-menu-item" onClick={run(onPin)}>
          <Icon as={Pin} size={15} weight="regular" />{msg.is_pinned ? 'Unpin' : 'Pin'}
        </button>
      )}
      {editable && onEdit && (
        <button type="button" role="menuitem" className="msg-menu-item" onClick={run(onEdit)}>
          <Icon as={Edit} size={15} weight="regular" />Edit<span className="msg-menu-key">E</span>
        </button>
      )}
      {isMine && onDelete && (
        <>
          <div className="msg-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="msg-menu-item is-danger" onClick={run(onDelete)}>
            <Icon as={Trash2} size={15} weight="regular" />Delete
          </button>
        </>
      )}
    </div>
  ), document.body);
}
