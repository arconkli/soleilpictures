import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Trash2, Edit, Smile, MessageSquare, Pin, Link as LinkIcon } from '../lib/icons.js';
import { EmojiPalette } from './EmojiPalette.jsx';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { renderMessageBody } from '../lib/renderMessageBody.jsx';
import { useEntityTrie } from '../hooks/useEntityNameTrie.js';
import { EntityLink } from './EntityLink.jsx';
import { coerceRef } from '../lib/entityRef.js';

// One message row in a thread.
//   msg              — full row from messages table
//   selfId           — current user
//   highlight        — optional substring to <mark> inside the body (search)
//   replyMeta        — { count, lastAt } for replies count badge
//   isFocused        — keyboard-nav highlight ring
//   onDelete, onEdit, onReact, onReply, onPin, onCopyLink — wired by parent
export function MessageBubble({
  msg, selfId, highlight, replyMeta, isFocused,
  onDelete, onEdit, onReact, onReply, onPin, onCopyLink,
  onAttachmentDragStart,
}) {
  const isMine = msg.sender_id === selfId;
  const within15min = msg.created_at && (Date.now() - new Date(msg.created_at).getTime()) < 15 * 60 * 1000;
  const [hover, setHover] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(msg.body);
  const [, force] = useState(0);
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);

  const { trie, workspaceId } = useEntityTrie();
  const profile = userProfiles.resolve(msg.sender_id);
  const senderName = profile?.name
    || profile?.email
    || msg.sender_name
    || (msg.sender_email ? emailToFriendly(msg.sender_email) : null)
    || 'Member';
  const senderColor = profile?.color || pickPresenceColor(msg.sender_id || '');

  const time = formatRelTime(msg.created_at);
  const fullTime = msg.created_at
    ? new Date(msg.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '';

  const submitEdit = async () => {
    const v = editBody.trim();
    if (!v) return;
    await onEdit?.(msg, v);
    setEditing(false);
  };

  return (
    <div className={`msg-bubble ${isMine ? 'msg-bubble--mine' : ''} ${msg.is_pinned ? 'msg-bubble--pinned' : ''} ${isFocused ? 'msg-bubble--focused' : ''}`}
         data-msg-id={msg.id}
         id={`msg-${msg.id}`}
         onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {msg.is_pinned && (
        <div className="msg-bubble-pinned-tag">
          <Icon as={Pin} size={10} /> Pinned
        </div>
      )}
      <div className="msg-bubble-head">
        <span className="msg-bubble-avatar"
              aria-hidden="true"
              style={{ background: senderColor }}>
          {senderName.charAt(0).toUpperCase()}
        </span>
        <span className="msg-bubble-author">{senderName}</span>
        <time className="msg-bubble-time" dateTime={msg.created_at} title={fullTime}>
          {time}{msg.edited_at ? ' · edited' : ''}
        </time>
        <span className={`msg-bubble-actions ${hover && !editing ? 'is-visible' : ''}`}>
          {onReply && <button title="Reply in thread" onClick={() => onReply(msg)}><Icon as={MessageSquare} size={12} /></button>}
          <button title="React" onClick={(e) => setEmojiAnchor(e.currentTarget.getBoundingClientRect())}><Icon as={Smile} size={12} /></button>
          {onPin && <button title={msg.is_pinned ? 'Unpin' : 'Pin'} onClick={() => onPin(msg)} className={msg.is_pinned ? 'is-active' : ''}><Icon as={Pin} size={12} /></button>}
          {onCopyLink && <button title="Copy link" onClick={() => onCopyLink(msg)}><Icon as={LinkIcon} size={12} /></button>}
          {isMine && within15min && <button title="Edit"   onClick={() => { setEditBody(msg.body); setEditing(true); }}><Icon as={Edit}   size={12} /></button>}
          {isMine               && <button title="Delete" onClick={() => onDelete?.(msg)}><Icon as={Trash2} size={12} /></button>}
        </span>
      </div>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); submitEdit(); }}>
          <textarea autoFocus value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="msg-composer-input" rows={2}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} />
          <div className="msg-bubble-edit-actions">
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="msg-composer-send">Save</button>
          </div>
        </form>
      ) : (
        <div className="msg-bubble-body">
          {renderMessageBody(msg.body, {
            mentions: msg.mentions || [],
            attachments: msg.attachments || [],
            highlight,
            trie,
            workspaceId,
          })}
        </div>
      )}
      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
        <div className="msg-bubble-attachments">
          {msg.attachments.map((att, i) => (
            <div key={i}
                 className="msg-attachment"
                 draggable
                 onDragStart={(e) => onAttachmentDragStart?.(e, att)}>
              {att.kind === 'image' && att.storage_path && (
                <img alt={att.name || ''} src={publicUrl(att.storage_path)} />
              )}
              {att.kind === 'file' && (
                <span className="msg-attachment-file">📎 {att.name || 'file'}</span>
              )}
              {att.kind === 'url' && (
                <a href={att.href} target="_blank" rel="noopener noreferrer">{att.title || att.href}</a>
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
      {/* Replies-count badge — visible when this message has replies. */}
      {replyMeta?.count > 0 && (
        <button className="msg-bubble-replies"
                onClick={() => onReply?.(msg)}
                title="Open thread">
          <Icon as={MessageSquare} size={11} />
          <span>{replyMeta.count} {replyMeta.count === 1 ? 'reply' : 'replies'}</span>
          {replyMeta.lastAt && (
            <span className="msg-bubble-replies-time">· last {formatRelTime(replyMeta.lastAt)}</span>
          )}
        </button>
      )}
      {emojiAnchor && (
        <EmojiPalette
          anchor={emojiAnchor}
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
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return '';
  return `${base}/storage/v1/object/public/message-attachments/${path}`;
}

function formatRelTime(iso) {
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
