import { useState, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { Paperclip, Smile } from '../lib/icons.js';
import { uploadMessageFile } from '../lib/messageAttachments.js';
import { caretRect } from '../lib/caretRect.js';
import { EntityPicker } from './EntityPicker.jsx';

// Bottom-of-thread input. Detects @<query> tokens at the caret to fire the
// EntityPicker filtered to user/board/card/doc; resolved picks become
// pendingMentions[] (people, drives notifications) or pendingEntityRefs[]
// (entity attachments rendered as soleil pills).
export function MessageComposer({ onSend, onTyping, busy, workspaceId, userId }) {
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [mention, setMention] = useState(null); // { tokenStart, query, anchor }
  const [pendingMentions, setPendingMentions] = useState([]);     // user ids
  const [pendingEntityRefs, setPendingEntityRefs] = useState([]); // entity targets
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastTypingRef = useRef(0);

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

  const handlePaste = (e) => {
    const files = [...e.clipboardData?.files || []];
    if (files.length) { e.preventDefault(); handleFiles(files); }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer?.files || []];
    if (files.length) handleFiles(files);
  };

  const detectMentionToken = (text, caret) => {
    let i = caret - 1;
    while (i >= 0 && /\S/.test(text[i]) && text[i] !== '@') i--;
    if (i < 0 || text[i] !== '@') return null;
    return { tokenStart: i, query: text.slice(i + 1, caret) };
  };

  const send = () => {
    const v = body.trim();
    if (!v && attachments.length === 0) return;
    onSend?.({
      body: v,
      attachments: [...attachments, ...pendingEntityRefs],
      mentions: pendingMentions,
    });
    setBody('');
    setAttachments([]);
    setPendingMentions([]);
    setPendingEntityRefs([]);
    inputRef.current?.focus();
  };

  const isBusy = busy || uploading;

  return (
    <form className="msg-composer"
          onSubmit={(e) => { e.preventDefault(); send(); }}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}>
      {attachments.length > 0 && (
        <div className="msg-composer-attachments">
          {attachments.map((a, i) => (
            <div key={i} className="msg-composer-att-chip">
              <span>{a.name || a.kind}</span>
              <button type="button" onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>×</button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        className="msg-composer-input"
        placeholder="Message…"
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
      <div className="msg-composer-actions">
        <button type="button" className="msg-composer-btn" title="Attach"
                onClick={() => fileInputRef.current?.click()}>
          <Icon as={Paperclip} size={14} />
        </button>
        <button type="button" className="msg-composer-btn" title="Emoji"><Icon as={Smile} size={14} /></button>
        <button type="submit" className="btn-primary" disabled={isBusy || (!body.trim() && attachments.length === 0)}>
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
    </form>
  );
}
