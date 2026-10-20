import { Sheet } from './shell/Sheet.jsx';
import { Icon } from './Icon.jsx';
import { Reply, Copy, Link as LinkIcon, Pin, Edit, Trash2 } from '../lib/icons.js';
import { QUICK_EMOJIS } from './EmojiPalette.jsx';
import { withinEditWindow } from '../lib/messageEdit.js';

// A message's actions under a finger, where there's no hover chip: press and
// hold the message (MessageThread) and they open here, a finger's size. The
// quick reactions run along the top (yours lit); then Reply, Copy text, Copy
// link, Pin, and Edit and Delete for your own.
export function MessageActionSheet({
  msg, selfId, onClose, onReact, onReply, onCopyText, onCopyLink, onPin, onEdit, onDelete,
}) {
  const isMine = msg.sender_id === selfId;
  const editable = isMine && withinEditWindow(msg.created_at) && !msg.sendState;
  const yours = new Set(Object.entries(msg.reactions || {})
    .filter(([, ids]) => Array.isArray(ids) && ids.includes(selfId))
    .map(([emoji]) => emoji));
  const quote = String(msg.body || '').replace(/\s+/g, ' ').trim() || 'Attachment';
  const run = (fn) => () => { onClose(); fn?.(msg); };
  return (
    <Sheet open onClose={onClose} snap="half" className="msg-sheet">
      <div className="msg-sheet-quote">{quote}</div>
      <div className="msg-sheet-reactions" role="group" aria-label="React">
        {QUICK_EMOJIS.map((emoji) => (
          <button key={emoji} type="button"
                  className={`msg-sheet-emoji ${yours.has(emoji) ? 'is-on' : ''}`}
                  aria-pressed={yours.has(emoji)}
                  onClick={() => { onClose(); onReact?.(msg, emoji); }}>
            {emoji}
          </button>
        ))}
      </div>
      <div className="msg-sheet-actions">
        {onReply && <button type="button" onClick={run(onReply)}><Icon as={Reply} size={18} />Reply</button>}
        {msg.body && <button type="button" onClick={run(onCopyText)}><Icon as={Copy} size={18} />Copy text</button>}
        {onCopyLink && <button type="button" onClick={run(onCopyLink)}><Icon as={LinkIcon} size={18} />Copy link</button>}
        {onPin && <button type="button" onClick={run(onPin)}><Icon as={Pin} size={18} />{msg.is_pinned ? 'Unpin' : 'Pin'}</button>}
        {editable && <button type="button" onClick={run(onEdit)}><Icon as={Edit} size={18} />Edit</button>}
        {isMine && onDelete && (
          <button type="button" className="is-danger" onClick={run(onDelete)}><Icon as={Trash2} size={18} />Delete</button>
        )}
      </div>
    </Sheet>
  );
}
