import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Trash2, Edit, Smile } from '../lib/icons.js';
import { EmojiPalette } from './EmojiPalette.jsx';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';

// One message row in a thread.
//   msg = full row from messages table
//   selfId = current user
//   highlight = optional substring to <mark> inside the body (for search)
//   onDelete, onEdit, onReact, onAttachmentDragStart  — wired by parent
export function MessageBubble({ msg, selfId, highlight, onDelete, onEdit, onReact, onAttachmentDragStart }) {
  const isMine = msg.sender_id === selfId;
  const within15min = msg.created_at && (Date.now() - new Date(msg.created_at).getTime()) < 15 * 60 * 1000;
  const [hover, setHover] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(msg.body);
  // userProfiles cache emits change events; subscribe so a name that
  // resolves async after the bubble first paints triggers a re-render.
  const [, force] = useState(0);
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);

  // Resolution order: cache → persisted sender_email column → broadcast
  // payload's transient sender_name → "Member" placeholder.
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
    <div className={`msg-bubble ${isMine ? 'msg-bubble--mine' : ''}`}
         data-msg-id={msg.id}
         onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
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
          <button title="React"  onClick={(e) => setEmojiAnchor(e.currentTarget.getBoundingClientRect())}><Icon as={Smile} size={12} /></button>
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
            <button type="submit" className="btn-primary">Save</button>
          </div>
        </form>
      ) : (
        <div className="msg-bubble-body">{renderBody({ body: msg.body, mentions: msg.mentions, attachments: msg.attachments, highlight })}</div>
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

// Friendly display from email — "andrew.conklin@x.com" → "Andrew Conklin".
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

function renderBody({ body = '', mentions = [], attachments = [], userNamesById = {}, highlight }) {
  // Pass 1: extract @mentions / entity attachments as React nodes.
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
      const looksLikeMention = mentions.length > 0 || attachments.length > 0;
      parts.push(looksLikeMention
        ? <span key={`p${parts.length}`} className="msg-pill msg-pill-user">{m[0]}</span>
        : m[0]);
    }
    i = m.index + m[0].length;
  }
  if (i < body.length) parts.push(body.slice(i));

  // Pass 2: highlight every literal substring match in the remaining
  // text spans (search results). Skips already-rendered React nodes
  // (like mention pills) to avoid breaking their styling.
  const q = (highlight || '').trim();
  if (!q) return parts;
  const out = [];
  for (const p of parts) {
    if (typeof p !== 'string') { out.push(p); continue; }
    const re2 = new RegExp(escapeReg(q), 'gi');
    let last = 0; let mm;
    let counter = 0;
    while ((mm = re2.exec(p)) != null) {
      if (mm.index > last) out.push(p.slice(last, mm.index));
      out.push(<mark key={`hl-${out.length}-${counter++}`} className="msg-bubble-mark">{mm[0]}</mark>);
      last = mm.index + mm[0].length;
    }
    if (last < p.length) out.push(p.slice(last));
  }
  return out;
}

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function publicUrl(path) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return '';
  return `${base}/storage/v1/object/public/message-attachments/${path}`;
}

// Compact, human-friendly relative time. Falls back to short absolute
// date for old messages so the bubble label is always meaningful.
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
