import { useState, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { Paperclip, Smile } from '../lib/icons.js';

// Bottom-of-thread input. Phase D wires attachments + paste-image; Phase E
// wires @-mentions + emoji palette. For Phase C this is just text + send.
export function MessageComposer({ onSend, onTyping, busy }) {
  const [body, setBody] = useState('');
  const inputRef = useRef(null);
  const lastTypingRef = useRef(0);
  const send = () => {
    const v = body.trim();
    if (!v) return;
    onSend?.({ body: v, attachments: [], mentions: [] });
    setBody('');
    inputRef.current?.focus();
  };
  return (
    <form className="msg-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea
        ref={inputRef}
        className="msg-composer-input"
        placeholder="Message…"
        rows={1}
        disabled={busy}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          const now = Date.now();
          if (now - lastTypingRef.current > 1500 && e.target.value.length > 0) {
            lastTypingRef.current = now;
            onTyping?.();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
      />
      <div className="msg-composer-actions">
        <button type="button" className="msg-composer-btn" title="Attach"><Icon as={Paperclip} size={14} /></button>
        <button type="button" className="msg-composer-btn" title="Emoji"><Icon as={Smile} size={14} /></button>
        <button type="submit" className="btn-primary" disabled={busy || !body.trim()}>Send</button>
      </div>
    </form>
  );
}
