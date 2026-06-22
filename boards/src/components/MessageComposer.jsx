import { useState, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { Paperclip, Smile, Link as LinkIcon } from '../lib/icons.js';
import { uploadMessageFile } from '../lib/messageAttachments.js';
import { caretRect } from '../lib/caretRect.js';
import { EntityPicker } from './EntityPicker.jsx';
import { EmojiPalette } from './EmojiPalette.jsx';
import { useDraft } from '../hooks/useDraft.js';
import { ENTITY_REF_MIME, ENTITY_REF_LIST_MIME } from '../lib/dragMimes.js';
import { coerceRef } from '../lib/entityRef.js';

// Bottom-of-thread input. Detects @<query> tokens at the caret to fire the
// EntityPicker filtered to user/board/card/doc; resolved picks become
// pendingMentions[] (people, drives notifications) or pendingEntityRefs[]
// (entity attachments rendered as soleil pills).
export function MessageComposer({ onSend, onTyping, busy, workspaceId, userId, draftKey, placeholder = 'Message…' }) {
  const [body, setBody, clearDraft] = useDraft(draftKey || `tmp:${workspaceId || 'unknown'}`);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [mention, setMention] = useState(null); // { tokenStart, query, anchor }
  const [pendingMentions, setPendingMentions] = useState([]);     // user ids
  const [pendingEntityRefs, setPendingEntityRefs] = useState([]); // entity targets
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [emojiAnchor, setEmojiAnchor] = useState(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastTypingRef = useRef(0);
  // Drag-over state for the visual drop affordance. enterCount tracks
  // dragenter/leave nesting so the highlight doesn't flicker when the
  // cursor crosses internal element boundaries (textarea / buttons /
  // attachment chips all fire their own dragenter/leave).
  const [dragOver, setDragOver] = useState(false);
  const enterCountRef = useRef(0);

  const handleFiles = async (files) => {
    if (!files?.length || !workspaceId || !userId) return;
    setUploading(true);
    const uploaded = [];
    for (const f of files) {
      const att = await uploadMessageFile(f, { workspaceId, userId });
      if (att) uploaded.push(att);
    }
    setAttachments(prev => [...prev, ...uploaded]);
    setUploading(false);
  };

  // Try to fetch a remote URL and treat the bytes as a file upload.
  // Most cross-origin servers refuse this with CORS; if that fails,
  // fall back to attaching the URL as a link attachment so the user
  // still gets something useful out of the drag.
  const handleDroppedUrl = async (url, name = 'image') => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const ext = (blob.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8);
      const file = new File([blob], `${name}.${ext}`, { type: blob.type || 'application/octet-stream' });
      await handleFiles([file]);
    } catch (_) {
      // CORS blocked or 404 — attach the URL as a link instead.
      setAttachments(prev => [...prev, { kind: 'url', href: url, title: url }]);
    }
  };

  const handlePaste = (e) => {
    const files = [...e.clipboardData?.files || []];
    if (files.length) { e.preventDefault(); handleFiles(files); }
  };

  const handleDragEnter = (e) => {
    if (!hasDragData(e)) return;
    e.preventDefault();
    enterCountRef.current++;
    setDragOver(true);
  };
  const handleDragLeave = (e) => {
    enterCountRef.current = Math.max(0, enterCountRef.current - 1);
    if (enterCountRef.current === 0) setDragOver(false);
  };
  const handleDrop = async (e) => {
    e.preventDefault();
    enterCountRef.current = 0;
    setDragOver(false);
    // 1. Universal entity refs (dragged from EntityLink chip, picker
    //    row, or canvas card). Push into pendingEntityRefs[].
    const refListJson = e.dataTransfer?.getData(ENTITY_REF_LIST_MIME);
    const refJson     = e.dataTransfer?.getData(ENTITY_REF_MIME);
    if (refListJson || refJson) {
      try {
        const refs = refListJson ? JSON.parse(refListJson)
                                 : [JSON.parse(refJson)];
        const cleaned = refs.map(r => coerceRef(r)).filter(Boolean);
        if (cleaned.length) {
          setPendingEntityRefs(prev => [...prev, ...cleaned]);
          return;
        }
      } catch (_) { /* fall through to file/url */ }
    }
    // 2. File drop.
    const files = [...e.dataTransfer?.files || []];
    if (files.length) { await handleFiles(files); return; }
    // 3. Dragged from another browser tab / canvas image card → URL.
    const uri = e.dataTransfer?.getData('text/uri-list')
              || e.dataTransfer?.getData('text/plain') || '';
    const firstUrl = (uri.split(/\r?\n/).find(line => /^https?:\/\//i.test(line.trim())) || '').trim();
    if (firstUrl) await handleDroppedUrl(firstUrl);
  };

  const detectMentionToken = (text, caret) => {
    let i = caret - 1;
    while (i >= 0 && /\S/.test(text[i]) && text[i] !== '@') i--;
    if (i < 0 || text[i] !== '@') return null;
    return { tokenStart: i, query: text.slice(i + 1, caret) };
  };

  const send = async () => {
    const v = body.trim();
    if (!v && attachments.length === 0) return;
    // onSend resolves false when the send failed — keep the draft and
    // attachments so the user's message isn't silently lost.
    const ok = await onSend?.({
      body: v,
      attachments: [...attachments, ...pendingEntityRefs],
      mentions: pendingMentions,
    });
    if (ok === false) { inputRef.current?.focus(); return; }
    clearDraft();
    setAttachments([]);
    setPendingMentions([]);
    setPendingEntityRefs([]);
    inputRef.current?.focus();
  };

  const isBusy = busy || uploading;

  // Insert a URL chip into the attachment row. Same `{ kind: 'url' }`
  // shape used by the CORS-fallback path when a dragged remote image
  // can't be fetched cross-origin (line 59 above) — the recipient sees
  // it as a soleil link pill.
  const commitLink = () => {
    let raw = linkDraft.trim();
    if (!raw) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
    if (!/^https?:\/\//i.test(raw)) { setLinkOpen(false); setLinkDraft(''); return; }
    setAttachments(prev => [...prev, { kind: 'url', href: raw, title: raw }]);
    setLinkOpen(false);
    setLinkDraft('');
    inputRef.current?.focus();
  };
  const cancelLink = () => { setLinkOpen(false); setLinkDraft(''); inputRef.current?.focus(); };

  // Insert a picked emoji at the caret (or end), then restore focus + caret.
  // Reads el.value directly so rapid picks don't fight a stale `body` closure.
  const insertEmoji = (emoji) => {
    if (!emoji) return;
    const el = inputRef.current;
    if (!el) { setBody((b) => (b || '') + emoji); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setBody(el.value.slice(0, start) + emoji + el.value.slice(end));
    const pos = start + emoji.length;
    requestAnimationFrame(() => {
      el.focus();
      try { el.setSelectionRange(pos, pos); } catch (_) {}
    });
  };

  return (
    <form className={`msg-composer ${dragOver ? 'is-drop-target' : ''}`}
          onSubmit={(e) => { e.preventDefault(); send(); }}
          onDragEnter={handleDragEnter}
          onDragOver={(e) => { if (hasDragData(e)) e.preventDefault(); }}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}>
      {dragOver && <div className="msg-composer-drop">Drop to attach</div>}
      {attachments.length > 0 && (
        <div className="msg-composer-attachments">
          {attachments.map((a, i) => (
            <div key={i} className="msg-composer-att-chip">
              <span>{a.name || a.title || (a.kind === 'url' ? a.href : a.kind)}</span>
              <button type="button" onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>×</button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        className="msg-composer-input"
        placeholder={placeholder}
        rows={1}
        disabled={isBusy}
        value={body}
        onPaste={handlePaste}
        onChange={(e) => {
          const v = e.target.value;
          setBody(v);
          const tok = detectMentionToken(v, e.target.selectionEnd);
          setMention(tok ? { ...tok, anchor: caretRect(e.target) } : null);
          const now = Date.now();
          if (now - lastTypingRef.current > 1500 && v.length > 0) {
            lastTypingRef.current = now;
            onTyping?.();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !mention) { e.preventDefault(); send(); }
        }}
      />
      <input ref={fileInputRef} type="file" hidden multiple
             onChange={(e) => { handleFiles([...e.target.files]); e.target.value = ''; }} />
      {linkOpen && (
        <div className="msg-composer-link">
          <input
            className="msg-composer-link-input"
            type="url"
            autoFocus
            placeholder="https://…"
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitLink(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelLink(); }
            }}
          />
          <button type="button" className="msg-composer-btn" onClick={commitLink}>Add</button>
          <button type="button" className="msg-composer-btn" onClick={cancelLink}>Cancel</button>
        </div>
      )}
      <div className="msg-composer-actions">
        <button type="button" className="msg-composer-btn" title="Attach"
                onClick={() => fileInputRef.current?.click()}>
          <Icon as={Paperclip} size={14} />
        </button>
        <button type="button"
                className={`msg-composer-btn ${linkOpen ? 'is-active' : ''}`}
                title="Link"
                onClick={() => { setLinkOpen(o => !o); setLinkDraft(''); }}>
          <Icon as={LinkIcon} size={14} />
        </button>
        <button type="button"
                className={`msg-composer-btn ${emojiAnchor ? 'is-active' : ''}`}
                title="Emoji"
                onClick={(e) => setEmojiAnchor(emojiAnchor ? null : e.currentTarget.getBoundingClientRect())}>
          <Icon as={Smile} size={14} />
        </button>
        <button type="submit" className="msg-composer-send" disabled={isBusy || (!body.trim() && attachments.length === 0)}>
          {uploading ? 'Uploading…' : 'Send'}
        </button>
      </div>

      {mention && (
        <EntityPicker
          workspaceId={workspaceId}
          anchor={mention.anchor}
          initialQuery={mention.query}
          filter={['user','board','card','doc']}
          onCommit={(targets) => {
            const t = targets?.[0];
            if (!t) { setMention(null); return; }
            const before = body.slice(0, mention.tokenStart);
            const after  = body.slice(mention.tokenStart + 1 + mention.query.length);
            const name   = t.title || t.name || (t.kind === 'user' ? 'someone' : t.kind);
            setBody(before + '@' + name + ' ' + after);
            if (t.kind === 'user') setPendingMentions(p => [...p, t.id]);
            else                   setPendingEntityRefs(p => [...p, t]);
            setMention(null);
          }}
          onCancel={() => setMention(null)}
        />
      )}

      {emojiAnchor && (
        <EmojiPalette
          anchor={emojiAnchor}
          onPick={(emoji) => { insertEmoji(emoji); setEmojiAnchor(null); }}
          onClose={() => setEmojiAnchor(null)}
        />
      )}
    </form>
  );
}

// Only show the drop overlay for drags that look like files or URLs —
// not, e.g., a plain text selection.
function hasDragData(e) {
  const types = e.dataTransfer?.types || [];
  for (const t of types) {
    if (t === 'Files' || t === 'text/uri-list' || t === 'text/plain') return true;
    if (t === ENTITY_REF_MIME || t === ENTITY_REF_LIST_MIME) return true;
  }
  return false;
}
