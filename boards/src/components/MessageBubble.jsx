import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Trash2, Edit, Smile, MessageSquare, Pin, Link as LinkIcon, Download } from '../lib/icons.js';
import { EmojiPalette } from './EmojiPalette.jsx';
import { GrowingTextarea } from './GrowingTextarea.jsx';
import { isComposingKey, messageKeyAction, touchKeyboard } from '../lib/composerKeys.js';
import { withinEditWindow } from '../lib/messageEdit.js';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { renderMessageBody } from '../lib/renderMessageBody.jsx';
import { useEntityTrie } from '../hooks/useEntityNameTrie.js';
import { EntityLink } from './EntityLink.jsx';
import { coerceRef } from '../lib/entityRef.js';
import { useOpenDm } from '../hooks/useOpenDm.js';
import { safeExternalHref } from '../lib/safeExternalHref.js';
import { attachmentMetaLabel, imageBoxStyle } from '../lib/messageAttachmentLinks.js';
import { publicAttachmentUrl } from '../lib/messageAttachmentUrls.js';

// One message row in a thread.
//   msg              — full row from messages table
//   selfId           — current user
//   highlight        — optional substring to <mark> inside the body (search)
//   parent           — when this message is a reply, the row it quotes
//                      (an iMessage-style preview chip above the bubble), or
//                      { id, unavailable: 'deleted' | 'missing' }. Null for
//                      a message that isn't a reply.
//   onJumpToMessage  — called with an id when the user clicks the parent
//                      preview chip; parent flashes/scrolls into view.
//   isFocused        — keyboard-nav highlight ring
//   onDelete, onEdit, onReact, onReply, onPin, onCopyLink — wired by parent
export function MessageBubble({
  msg, selfId, highlight, parent, onJumpToMessage, isFocused, seen = false,
  isContinuation = false, // consecutive message from the same sender — drop the header
  onDelete, onEdit, onReact, onReply, onPin, onCopyLink,
  onAttachmentDragStart,
  onRetrySend, onDiscardSend, // optimistic-send bubbles only
}) {
  const isMine = msg.sender_id === selfId;
  // 'sending' | 'failed' | null — optimistic messages that haven't been
  // confirmed by the server yet. They render dimmed with no actions.
  const sendState = msg.sendState || null;
  const inEditWindow = withinEditWindow(msg.created_at);
  const [hover, setHover] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState(null);
  const reactBtnRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(msg.body);
  const [, force] = useState(0);
  const openDm = useOpenDm();
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);

  const { trie, workspaceId } = useEntityTrie();
  const profile = userProfiles.resolve(msg.sender_id);
  const senderName = profile?.name
    || profile?.email
    || msg.sender_name
    || (msg.sender_email ? emailToFriendly(msg.sender_email) : null)
    || 'Member';
  const senderColor = profile?.color || pickPresenceColor(msg.sender_id || '');

  // Names the body's @mention pills match against. Without them a pill had
  // nothing to stop at and swallowed the rest of the sentence (COMMS-05).
  // Both the display name and the address: the composer inserts whichever
  // the picker showed. Re-renders on profile load via the subscribe above.
  const mentionNames = {};
  for (const id of (msg.mentions || [])) {
    const p = userProfiles.resolve(id);
    mentionNames[id] = [p?.name, p?.email].filter(Boolean);
  }

  const time = formatRelTime(msg.created_at);
  const fullTime = msg.created_at
    ? new Date(msg.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '';

  // The thread's `e` shortcut asks the focused message to edit itself; nothing
  // listened, so the advertised key did nothing (COMMS-24). Only your own
  // message, inside the edit window, the same rule as the button. ↑ in an
  // empty composer asks the same way (lib/messageEdit.js picks the message).
  const canEdit = isMine && inEditWindow && !sendState;
  useEffect(() => {
    if (!canEdit) return;
    const onEditRequest = (e) => {
      if (e.detail?.id !== msg.id) return;
      setEditBody(msg.body);
      setEditing(true);
    };
    document.addEventListener('soleil-msg-edit', onEditRequest);
    return () => document.removeEventListener('soleil-msg-edit', onEditRequest);
  }, [canEdit, msg.id, msg.body]);

  // The edit closes at once and shows (the thread applies it optimistically);
  // a save that fails reopens it with your text (onEdit resolves false).
  const savingRef = useRef(false);
  const submitEdit = async () => {
    const v = editBody.trim();
    if (!v || savingRef.current) return;
    if (v === msg.body) { setEditing(false); return; }
    savingRef.current = true;
    setEditing(false);
    const ok = await onEdit?.(msg, v);
    savingRef.current = false;
    if (ok === false) { setEditBody(v); setEditing(true); }
  };

  // iMessage-style parent preview shown on replies. Click → parent flashes
  // and scrolls into view in the same feed.
  const parentGone = parent?.unavailable || null;
  const parentProfile = parent && !parentGone ? userProfiles.resolve(parent.sender_id) : null;
  const parentName = parent
    ? (parentProfile?.name || parentProfile?.email || parent.sender_name
        || (parent.sender_email ? emailToFriendly(parent.sender_email) : null) || 'Member')
    : '';
  const parentColor = parent ? (parentProfile?.color || pickPresenceColor(parent.sender_id || '')) : '';
  const parentExcerpt = parent ? (parent.body || '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';

  return (
    <div className={`msg-bubble ${isMine ? 'msg-bubble--mine' : ''} ${isContinuation ? 'is-continuation' : ''} ${msg.is_pinned ? 'msg-bubble--pinned' : ''} ${isFocused ? 'msg-bubble--focused' : ''} ${parent ? 'msg-bubble--reply' : ''} ${sendState ? 'msg-bubble--pending' : ''}`}
         data-msg-id={msg.id}
         id={`msg-${msg.id}`}
         onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {parent && parentGone && (
        <div className="msg-reply-preview is-gone">
          <span className="msg-reply-preview-body">
            {parentGone === 'deleted' ? 'Original message deleted' : 'Original message unavailable'}
          </span>
        </div>
      )}
      {parent && !parentGone && (
        <button type="button"
                className="msg-reply-preview"
                title={`Go to ${parentName}'s message`}
                onClick={(e) => { e.stopPropagation(); onJumpToMessage?.(parent.id); }}>
          <span className="msg-reply-preview-line" style={{ background: parentColor }} aria-hidden="true" />
          <span className="msg-reply-preview-author" style={{ color: parentColor }}>{parentName}</span>
          <span className="msg-reply-preview-body">{parentExcerpt || '…'}</span>
        </button>
      )}
      {msg.is_pinned && (
        <div className="msg-bubble-pinned-tag">
          <Icon as={Pin} size={10} /> Pinned
        </div>
      )}
      <div className="msg-bubble-head">
        {isContinuation ? (
          // Continuation row: no avatar/name; a faint clock appears in the
          // reserved avatar gutter on hover so the time is still reachable.
          <time className="msg-bubble-gutter-time" dateTime={msg.created_at} title={fullTime}>
            {shortClock(msg.created_at)}
          </time>
        ) : (
          <>
            {!isMine && openDm ? (
              <button
                type="button"
                className="msg-bubble-avatar is-clickable"
                style={{ background: senderColor }}
                onClick={() => openDm(msg.sender_id)}
                title={`Message ${senderName}`}
              >
                {senderName.charAt(0).toUpperCase()}
              </button>
            ) : (
              <span className="msg-bubble-avatar"
                    aria-hidden="true"
                    style={{ background: senderColor }}>
                {senderName.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="msg-bubble-author">{senderName}</span>
            {sendState ? (
              <span className="msg-bubble-time">{sendState === 'sending' ? 'Sending…' : ''}</span>
            ) : (
              <time className="msg-bubble-time" dateTime={msg.created_at} title={fullTime}>
                {time}{msg.edited_at ? ' · edited' : ''}
              </time>
            )}
          </>
        )}
        <span className={`msg-bubble-actions ${hover && !editing && !sendState ? 'is-visible' : ''}`}>
          {onReply && <button title="Reply" onClick={() => onReply(msg)}><Icon as={MessageSquare} size={12} /></button>}
          <button title="React" ref={reactBtnRef} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setEmojiAnchor((a) => (a ? null : r)); }}><Icon as={Smile} size={12} /></button>
          {onPin && <button title={msg.is_pinned ? 'Unpin' : 'Pin'} onClick={() => onPin(msg)} className={msg.is_pinned ? 'is-active' : ''}><Icon as={Pin} size={12} /></button>}
          {onCopyLink && <button title="Copy link" onClick={() => onCopyLink(msg)}><Icon as={LinkIcon} size={12} /></button>}
          {isMine && inEditWindow && <button title="Edit"   onClick={() => { setEditBody(msg.body); setEditing(true); }}><Icon as={Edit}   size={12} /></button>}
          {isMine               && <button title="Delete" onClick={() => onDelete?.(msg)}><Icon as={Trash2} size={12} /></button>}
        </span>
      </div>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); submitEdit(); }}>
          <GrowingTextarea focusAtEnd value={editBody} maxLines={12}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="msg-composer-input"
                    onKeyDown={(e) => {
                      if (isComposingKey(e)) return;
                      if (e.key === 'Escape') { e.preventDefault(); setEditing(false); return; }
                      // The composer's rule: Enter saves on a desktop keyboard,
                      // Shift+Enter (or Enter on a touch one) makes a new line.
                      if (messageKeyAction(e, { touch: touchKeyboard() }) === 'send') { e.preventDefault(); submitEdit(); }
                    }} />
          <div className="msg-bubble-edit-actions">
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="msg-composer-send" disabled={!editBody.trim()}>Save</button>
          </div>
        </form>
      ) : (
        <div className="msg-bubble-body">
          {renderMessageBody(msg.body, {
            mentions: msg.mentions || [],
            userNamesById: mentionNames,
            attachments: msg.attachments || [],
            highlight,
            trie,
            workspaceId,
          })}
        </div>
      )}
      {sendState === 'failed' && (
        <div className="msg-bubble-failed" role="alert">
          <span>Couldn't send</span>
          <button type="button" onClick={() => onRetrySend?.(msg)}>Retry</button>
          <button type="button" onClick={() => onDiscardSend?.(msg)}>Discard</button>
        </div>
      )}
      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
        <div className="msg-bubble-attachments">
          {msg.attachments.map((att, i) => (
            <div key={i}
                 className="msg-attachment"
                 draggable
                 onDragStart={(e) => onAttachmentDragStart?.(e, att)}>
              {/* Both open: a file as a download under its own name, an image
                  full size in a new tab. A file used to be plain text with no
                  way to get at it but dragging it to a canvas (COMMS-07). */}
              {att.kind === 'image' && att.storage_path && (
                <a className="msg-attachment-image" href={publicUrl(att.storage_path)}
                   target="_blank" rel="noopener noreferrer" title={att.name ? `Open ${att.name}` : 'Open image'}>
                  <img alt={att.name || ''} src={publicUrl(att.storage_path)}
                       width={att.width || undefined} height={att.height || undefined}
                       style={imageBoxStyle(att) || undefined} />
                </a>
              )}
              {att.kind === 'file' && (att.storage_path ? (
                <a className="msg-attachment-file"
                   href={publicAttachmentUrl(att.storage_path, { download: att.name || 'file' })}
                   download={att.name || 'file'}
                   target="_blank" rel="noopener noreferrer"
                   title={`Download ${att.name || 'file'}`}>
                  <Icon as={Download} size={12} />
                  <span className="msg-attachment-file-name">{att.name || 'file'}</span>
                  {attachmentMetaLabel(att) && <span className="msg-attachment-file-meta">{attachmentMetaLabel(att)}</span>}
                </a>
              ) : (
                <span className="msg-attachment-file">{att.name || 'file'}</span>
              ))}
              {att.kind === 'url' && (
                <a href={safeExternalHref(att.href) || undefined} target="_blank" rel="noopener noreferrer">{att.title || att.href}</a>
              )}
              {(att.kind === 'board' || att.kind === 'card' || att.kind === 'doc' || att.kind === 'docPos') && (
                <EntityLink
                  refs={[coerceRef(att)].filter(Boolean)}
                  workspaceId={workspaceId}
                  asTag="span"
                  className="msg-attachment-entity"
                >
                  {(att.title || att.name || att.kind).toString()}
                </EntityLink>
              )}
            </div>
          ))}
        </div>
      )}
      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
        <div className="msg-bubble-reactions">
          {Object.entries(msg.reactions).map(([emoji, ids]) => (
            <button key={emoji} className={`msg-reaction ${ids?.includes(selfId) ? 'own' : ''}`} onClick={() => onReact?.(msg, emoji)}>
              <span>{emoji}</span>
              <span className="msg-reaction-count">{ids?.length || 0}</span>
            </button>
          ))}
        </div>
      )}
      {seen && <div className="msg-bubble-seen">Seen</div>}
      {emojiAnchor && (
        <EmojiPalette
          anchor={emojiAnchor}
          trigger={reactBtnRef.current}
          onPick={(emoji) => onReact?.(msg, emoji)}
          onClose={() => setEmojiAnchor(null)}
        />
      )}
    </div>
  );
}

function emailToFriendly(email) {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .map(p => p.replace(/\d+$/, ''))
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function publicUrl(path) {
  return publicAttachmentUrl(path);
}

// Bare wall-clock (e.g. "2:14 PM") shown in the gutter on grouped
// continuation rows, where the full "x ago" header is suppressed.
function shortClock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatRelTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 30)    return 'just now';
  if (sec < 60)    return `${sec}s ago`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
