import { Sheet } from './shell/Sheet.jsx';
import { Icon } from './Icon.jsx';
import HapticTap from './HapticTap.jsx';
import { haptic } from '../lib/haptics.js';
import { menuIconNow, useMenuIcons } from '../lib/menuIconsLoad.js';
import { QUICK_EMOJIS } from './EmojiPalette.jsx';
import { withinEditWindow } from '../lib/messageEdit.js';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

// A message's actions under a finger, where there's no hover chip: press and
// hold the message (MessageThread) and they open here, a finger's size. The
// quick reactions run along the top (yours lit); then Reply, Copy text, Copy
// link, Pin, and Edit and Delete for your own.
export function MessageActionSheet({
  msg, selfId, onClose, onReact, onReply, onCopyText, onCopyLink, onPin, onEdit, onDelete,
}) {
  useMenuIcons();
  const isMine = msg.sender_id === selfId;
  const editable = isMine && withinEditWindow(msg.created_at) && !msg.sendState;
  const yours = new Set(Object.entries(msg.reactions || {})
    .filter(([, ids]) => Array.isArray(ids) && ids.includes(selfId))
    .map(([emoji]) => emoji));
  const quote = String(msg.body || '').replace(/\s+/g, ' ').trim() || t`Attachment`;
  const run = (fn) => () => { onClose(); fn?.(msg); };
  return (
    <Sheet open onClose={onClose} className="msg-sheet">
      <div className="msg-sheet-quote">{quote}</div>
      <div className="msg-sheet-reactions" role="group" aria-label={t`React`}>
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
        {onReply && <button type="button" onClick={run(onReply)}><Icon as={menuIconNow('ArrowBendUpLeft')} size={20} weight="regular" /><Trans>Reply</Trans></button>}
        {msg.body && <button type="button" onClick={run(onCopyText)}><Icon as={menuIconNow('Copy')} size={20} weight="regular" /><Trans>Copy text</Trans></button>}
        {onCopyLink && <button type="button" onClick={run(onCopyLink)}><Icon as={menuIconNow('LinkSimple')} size={20} weight="regular" /><Trans>Copy link</Trans></button>}
        {onPin && <button type="button" onClick={run(onPin)}><Icon as={menuIconNow(msg.is_pinned ? 'PushPinSlash' : 'PushPin')} size={20} weight="regular" />{msg.is_pinned ? t`Unpin` : t`Pin`}</button>}
        {editable && <button type="button" onClick={run(onEdit)}><Icon as={menuIconNow('PencilSimple')} size={20} weight="regular" /><Trans>Edit</Trans></button>}
        {isMine && onDelete && (
          <button type="button" className="is-danger" onClick={() => { haptic('delete'); run(onDelete)(); }}><Icon as={menuIconNow('Trash')} size={20} weight="regular" /><Trans>Delete</Trans><HapticTap /></button>
        )}
      </div>
    </Sheet>
  );
}
