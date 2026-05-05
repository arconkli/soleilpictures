import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { Trash2, Edit, Smile } from '../lib/icons.js';

// One message row in a thread.
//   msg = full row from messages table
//   selfId = current user
//   onDelete, onEdit, onReact, onAttachmentDragStart  — wired by parent
export function MessageBubble({ msg, selfId, onDelete, onEdit, onReact, onAttachmentDragStart }) {
  const isMine = msg.sender_id === selfId;
  const within15min = msg.created_at && (Date.now() - new Date(msg.created_at).getTime()) < 15 * 60 * 1000;
  const [hover, setHover] = useState(false);
  const time = relTime(msg.created_at);

  return (
    <div className="msg-bubble" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="msg-bubble-head">
        <span className="msg-bubble-author">{msg.sender_name || 'Someone'}</span>
        <span className="msg-bubble-time t-meta">{time}{msg.edited_at ? ' · edited' : ''}</span>
        {hover && (
          <span className="msg-bubble-actions">
            <button title="React"  onClick={() => onReact?.(msg)}><Icon as={Smile} size={12} /></button>
            {isMine && within15min && <button title="Edit"   onClick={() => onEdit?.(msg)}><Icon as={Edit}   size={12} /></button>}
            {isMine               && <button title="Delete" onClick={() => onDelete?.(msg)}><Icon as={Trash2} size={12} /></button>}
          </span>
        )}
      </div>
      <div className="msg-bubble-body">{renderBody({ body: msg.body, mentions: msg.mentions, attachments: msg.attachments })}</div>
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
                <span className="msg-attachment-entity">{(att.title || att.name || att.kind).toString()}</span>
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
    </div>
  );
}

function renderBody({ body, mentions = [], attachments = [], userNamesById = {} }) {
  // Build a lookup of @<name> tokens to (kind, ref).
  const matchByName = new Map();
  for (const userId of mentions) {
    const name = userNamesById[userId];
    if (name) matchByName.set(name.toLowerCase(), { kind: 'user', id: userId });
  }
  for (const att of attachments) {
    if (att.title || att.name) {
      matchByName.set((att.title || att.name).toLowerCase(), { kind: att.kind, ref: att });
    }
  }
  const parts = [];
  let i = 0;
  const re = /@([a-zA-Z0-9_'’\- ]{1,40})/g;
  let m;
  while ((m = re.exec(body)) != null) {
    if (m.index > i) parts.push(body.slice(i, m.index));
    const tokenName = m[1].trim().toLowerCase();
    const hit = matchByName.get(tokenName);
    if (hit) {
      parts.push(<span key={`p${parts.length}`} className={`msg-pill msg-pill-${hit.kind}`}>{m[0]}</span>);
    } else {
      // Even with no resolved match, mentions[] non-empty implies *some* @ was a person —
      // pill it as a user mention so the visual cue still works pre-name-resolution.
      const looksLikeMention = mentions.length > 0 || attachments.length > 0;
      parts.push(looksLikeMention
        ? <span key={`p${parts.length}`} className="msg-pill msg-pill-user">{m[0]}</span>
        : m[0]);
    }
    i = m.index + m[0].length;
  }
  if (i < body.length) parts.push(body.slice(i));
  return parts;
}

function publicUrl(path) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return '';
  return `${base}/storage/v1/object/public/message-attachments/${path}`;
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60)    return 'just now';
  if (sec < 3600)  return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return d.toLocaleDateString();
}
