import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EntityPicker } from './EntityPicker.jsx';
import { caretRect } from '../lib/caretRect.js';

// Anchored popover for short-text input (comments, link rename, etc).
// Positioning is viewport-aware: prefer below the anchor, flip above when
// there's no room below, clamp to the viewport horizontally.
//
// Props:
//   anchor       — DOMRect-like { left, top, right, bottom } of the source element
//   placeholder
//   multiline    — boolean
//   initialValue
//   commitLabel  — text on the post button (default 'Post')
//   busy         — disable inputs while a parent async commit is in flight
//   workspaceId  — when set, typing "@" opens the people picker; picked users
//                  are collected and handed back so the caller can notify them
//   onCommit(text, { mentions: string[] })
//   onCancel()
const PAD = 8;
const WIDTH = 320;

export function InlineComposer({
  anchor,
  placeholder = '',
  multiline = false,
  initialValue = '',
  commitLabel = 'Post',
  busy = false,
  workspaceId = null,
  onCommit,
  onCancel,
}) {
  const [value, setValue] = useState(initialValue);
  // @-mention token at the caret → EntityPicker, same shape as MessageComposer.
  const [mention, setMention] = useState(null);   // { tokenStart, query, anchor }
  const [mentions, setMentions] = useState([]);   // user ids picked so far
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 240 });
  const popRef = useRef(null);
  const inputRef = useRef(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const popH = popRef.current?.scrollHeight || 120;
      const spaceBelow = vh - anchor.bottom - PAD;
      const spaceAbove = anchor.top - PAD;
      const placeAbove = spaceBelow < 140 && spaceAbove > spaceBelow;
      const top = placeAbove
        ? Math.max(PAD, anchor.top - popH - PAD)
        : Math.min(vh - popH - PAD, anchor.bottom + PAD);
      const left = Math.min(
        Math.max(PAD, anchor.left),
        vw - WIDTH - PAD,
      );
      setPos({ top, left, maxHeight: Math.min(spaceBelow, vh - 2 * PAD) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    // Only report mentions whose @name survived editing — a user can pick
    // someone and then delete the text again.
    const kept = mentions.filter(m => v.includes('@' + m.name));
    onCommit?.(v, { mentions: [...new Set(kept.map(m => m.id))] });
  };

  // Scan back from the caret to an unbroken "@word". Mirrors
  // MessageComposer.detectMentionToken.
  const detectMentionToken = (text, caret) => {
    let i = caret - 1;
    while (i >= 0 && /\S/.test(text[i]) && text[i] !== '@') i--;
    if (i < 0 || text[i] !== '@') return null;
    return { tokenStart: i, query: text.slice(i + 1, caret) };
  };

  const onValueChange = (e) => {
    const next = e.target.value;
    setValue(next);
    if (!workspaceId) return;
    const tok = detectMentionToken(next, e.target.selectionStart ?? next.length);
    setMention(tok ? { ...tok, anchor: caretRect(e.target) } : null);
  };

  const InputEl = multiline ? 'textarea' : 'input';

  return createPortal(
    <div
      ref={popRef}
      className="inline-composer surface-frosted"
      style={{ top: pos.top, left: pos.left, width: WIDTH }}
    >
      <InputEl
        ref={inputRef}
        className="inline-composer-input"
        placeholder={placeholder}
        value={value}
        disabled={busy}
        onChange={onValueChange}
        onKeyDown={(e) => {
          // While the picker is open ⏎ selects a person; it must not post.
          if (e.key === 'Enter' && mention) return;
          if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={multiline ? 3 : undefined}
      />
      <div className="inline-composer-foot">
        <span className="inline-composer-hint t-meta">
          {multiline ? 'Shift+⏎ for newline · ⏎ to post' : '⏎ to post · Esc to cancel'}
        </span>
        <button
          className="btn-primary"
          disabled={busy || !value.trim()}
          onClick={submit}
        >
          {busy ? '…' : commitLabel}
        </button>
      </div>
      {mention && workspaceId && (
        <EntityPicker
          workspaceId={workspaceId}
          anchor={mention.anchor}
          initialQuery={mention.query}
          filter={['user']}
          onCommit={(targets) => {
            const t = targets?.[0];
            if (!t) { setMention(null); return; }
            const name = t.title || t.name || 'someone';
            const before = value.slice(0, mention.tokenStart);
            const after = value.slice(mention.tokenStart + 1 + mention.query.length);
            setValue(before + '@' + name + ' ' + after);
            setMentions(p => [...p, { id: t.id, name }]);
            setMention(null);
            inputRef.current?.focus();
          }}
          onCancel={() => setMention(null)}
        />
      )}
    </div>,
    document.body,
  );
}
