import { useEffect, useState, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { Paperclip, Smile, Link as LinkIcon, Reply, X } from '../lib/icons.js';
import { uploadMessageFile } from '../lib/messageAttachments.js';
import { publicAttachmentUrl } from '../lib/messageAttachmentUrls.js';
import { caretRect } from '../lib/caretRect.js';
import { EntityPicker } from './EntityPicker.jsx';
import { EmojiPalette } from './EmojiPalette.jsx';
import { GrowingTextarea } from './GrowingTextarea.jsx';
import { useDraft } from '../hooks/useDraft.js';
import { newItemKey, releaseItems, updateDraft } from '../lib/draftStore.js';
import { uploadQueue } from '../lib/uploadQueue.js';
import { isComposingKey, messageKeyAction, touchKeyboard } from '../lib/composerKeys.js';
import { ENTITY_REF_MIME, ENTITY_REF_LIST_MIME } from '../lib/dragMimes.js';
import { coerceRef } from '../lib/entityRef.js';

// What a pending entity attachment's chip says: its title when the drag or
// the picker carried one, else what kind of thing it is.
const REF_KIND_LABEL = { board: 'Cluster', card: 'Card', doc: 'Document', docPos: 'Document section', tag: 'Tag', url: 'Link', message: 'Message' };
function refChipLabel(ref) {
  return ref?.title || ref?.name || REF_KIND_LABEL[ref?.kind] || 'Attachment';
}

// Upload files into a conversation's draft, three at a time across the app.
// Each one is a chip from the moment it's dropped, and finishes into its own
// chip by key: one that lands while you're in another conversation is there
// when you come back, and one you removed while it uploaded stays removed.
function stageUploads(draftKey, files, ctx) {
  const staged = files.map((f) => ({
    key: newItemKey(),
    status: 'uploading',
    name: f.name || 'file',
    size: f.size,
    mime: f.type || '',
    file: f,
    previewUrl: /^image\//.test(f.type || '') ? objectUrl(f) : null,
  }));
  updateDraft(draftKey, (d) => ({ ...d, items: [...d.items, ...staged] }));
  staged.forEach((item) => runUpload(draftKey, item, ctx));
}

function runUpload(draftKey, item, { workspaceId, userId }) {
  uploadQueue.run(() => uploadMessageFile(item.file, { workspaceId, userId }))
    .then((att) => att, () => null)
    .then((att) => updateDraft(draftKey, (d) => {
      if (!d.items.some((i) => i.key === item.key)) return d;
      // A failed upload used to vanish: "Uploading…", then nothing (COMMS-19).
      // It stays as a chip that says so, with Retry.
      return { ...d, items: d.items.map((i) => (i.key !== item.key ? i
        : att ? { ...i, status: 'done', att, file: null } : { ...i, status: 'failed' })) };
    }));
}

function objectUrl(file) {
  try { return URL.createObjectURL(file); } catch (_) { return null; }
}

function chipThumb(item) {
  if (item.previewUrl) return item.previewUrl;
  const a = item.att;
  return a?.kind === 'image' && a.storage_path ? publicAttachmentUrl(a.storage_path) : null;
}

function chipLabel(item) {
  const a = item.att;
  if (!a) return item.name;
  return a.name || a.title || (a.kind === 'url' ? a.href : a.kind);
}

// Bottom-of-thread input. Detects @<query> tokens at the caret to fire the
// EntityPicker filtered to user/board/card/doc; resolved picks become
// pendingMentions[] (people, drives notifications) or pendingEntityRefs[]
// (entity attachments rendered as soleil pills).
//   replyTo / replyToName / onCancelReply — the message the next send answers:
//   shown above the field as "Replying to …"; Escape or × lets it go.
//
// Everything typed or staged here is the conversation's draft (useDraft): it's
// there when you come back, files still uploading included. The field grows
// with what you write and is never disabled; Send waits for the uploads.
export function MessageComposer({
  onSend, onTyping, busy, workspaceId, userId, draftKey, placeholder = 'Message…',
  replyTo = null, replyToName = '', onCancelReply,
}) {
  const key = draftKey || `tmp:${workspaceId || 'unknown'}`;
  const [draft, update] = useDraft(key);
  const { body, items, refs: pendingEntityRefs, mentions: pendingMentions } = draft;
  const setBody = (v) => update((d) => ({ ...d, body: typeof v === 'function' ? v(d.body) : v }));
  const setPendingEntityRefs = (fn) => update((d) => ({ ...d, refs: fn(d.refs) }));
  const setPendingMentions = (fn) => update((d) => ({ ...d, mentions: fn(d.mentions) }));
  const addLink = (href) => update((d) => ({
    ...d, items: [...d.items, { key: newItemKey(), status: 'done', att: { kind: 'url', href, title: href } }],
  }));
  // What goes with the message: finished uploads and links, in the order added.
  const attachments = items.filter((i) => i.status === 'done' && i.att).map((i) => i.att);
  const uploading = items.some((i) => i.status === 'uploading');
  const [mention, setMention] = useState(null); // { tokenStart, query, anchor }
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [emojiAnchor, setEmojiAnchor] = useState(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiBtnRef = useRef(null);
  // Starting a reply puts you in the field to write it (not a reply that was
  // already in the draft when the conversation opened).
  const replyId = replyTo?.id || null;
  const prevReplyRef = useRef(replyId);
  useEffect(() => {
    const prev = prevReplyRef.current;
    prevReplyRef.current = replyId;
    if (replyId && replyId !== prev) inputRef.current?.focus({ preventScroll: true });
  }, [replyId]);
  const lastTypingRef = useRef(0);
  // Drag-over state for the visual drop affordance. enterCount tracks
  // dragenter/leave nesting so the highlight doesn't flicker when the
  // cursor crosses internal element boundaries (textarea / buttons /
  // attachment chips all fire their own dragenter/leave).
  const [dragOver, setDragOver] = useState(false);
  const enterCountRef = useRef(0);

  const handleFiles = (files) => {
    if (!files?.length || !workspaceId || !userId) return;
    stageUploads(key, [...files], { workspaceId, userId });
  };
  const retryItem = (item) => {
    if (!item.file) return;
    update((d) => ({ ...d, items: d.items.map((i) => (i.key === item.key ? { ...i, status: 'uploading' } : i)) }));
    runUpload(key, item, { workspaceId, userId });
  };
  const removeItem = (item) => {
    releaseItems([item]);
    update((d) => ({ ...d, items: d.items.filter((i) => i.key !== item.key) }));
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
      handleFiles([file]);
    } catch (_) {
      // CORS blocked or 404 — attach the URL as a link instead.
      addLink(url);
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
        // Keep the title the drag carried, so the chip (and the recipient)
        // can name the thing rather than just its kind.
        const cleaned = refs
          .map(r => { const c = coerceRef(r); return c && (r?.title || r?.name) ? { ...c, title: r.title || r.name } : c; })
          .filter(Boolean);
        if (cleaned.length) {
          setPendingEntityRefs(prev => [...prev, ...cleaned]);
          return;
        }
      } catch (_) { /* fall through to file/url */ }
    }
    // 2. File drop.
    const files = [...e.dataTransfer?.files || []];
    if (files.length) { handleFiles(files); return; }
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

  // Dropped cards and clusters count as something to send on their own: they
  // used to attach invisibly, and only if you also typed (COMMS-19).
  const hasPayload = attachments.length > 0 || pendingEntityRefs.length > 0;

  const isBusy = busy || uploading;

  const send = async () => {
    const v = body.trim();
    if (!v && !hasPayload) return;
    if (isBusy) return; // Send waits for the files; its label says so
    const sent = items.filter((i) => i.status === 'done');
    // onSend resolves false when the send failed — keep the draft and
    // attachments so the user's message isn't silently lost.
    const ok = await onSend?.({
      body: v,
      attachments: [...attachments, ...pendingEntityRefs],
      mentions: pendingMentions,
    });
    if (ok === false) { inputRef.current?.focus(); return; }
    // What was sent leaves the draft, and the stored copy now, so a reload
    // can't bring it back. A file that failed stays for Retry or ×.
    releaseItems(sent);
    const sentKeys = new Set(sent.map((i) => i.key));
    update((d) => ({ ...d, body: '', items: d.items.filter((i) => !sentKeys.has(i.key)), refs: [], mentions: [] }), { now: true });
    inputRef.current?.focus();
  };

  // Insert a URL chip into the attachment row. Same `{ kind: 'url' }`
  // shape used by the CORS-fallback path when a dragged remote image
  // can't be fetched cross-origin (line 59 above) — the recipient sees
  // it as a soleil link pill.
  const commitLink = () => {
    let raw = linkDraft.trim();
    if (!raw) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
    if (!/^https?:\/\//i.test(raw)) { setLinkOpen(false); setLinkDraft(''); return; }
    addLink(raw);
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
      {replyTo && (
        <div className="msg-reply-bar">
          <Icon as={Reply} size={13} />
          <span className="msg-reply-bar-text">
            <span className="msg-reply-bar-who">Replying to {replyToName}</span>
            <span className="msg-reply-bar-body">{(replyTo.body || '').replace(/\s+/g, ' ').trim() || 'Attachment'}</span>
          </span>
          <button type="button" className="msg-reply-bar-x" aria-label="Cancel the reply" title="Cancel (Esc)"
                  onClick={() => { onCancelReply?.(); inputRef.current?.focus({ preventScroll: true }); }}>
            <Icon as={X} size={12} />
          </button>
        </div>
      )}
      {(items.length > 0 || pendingEntityRefs.length > 0) && (
        <div className="msg-composer-attachments">
          {items.map((item) => {
            const label = chipLabel(item);
            const thumb = chipThumb(item);
            return (
              <div key={item.key} className={`msg-composer-att-chip is-${item.status}`} title={label}>
                {thumb && <img className="msg-composer-att-thumb" src={thumb} alt="" draggable={false} />}
                <span className="msg-composer-att-name">{label}</span>
                {item.status === 'uploading' && <span className="msg-composer-att-state" role="status">Uploading…</span>}
                {item.status === 'failed' && (
                  <>
                    <span className="msg-composer-att-state" role="alert">Couldn't upload</span>
                    <button type="button" className="msg-composer-att-retry" onClick={() => retryItem(item)}>Retry</button>
                  </>
                )}
                <button type="button" className="msg-composer-att-x" aria-label="Remove attachment" onClick={() => removeItem(item)}>
                  <Icon as={X} size={11} />
                </button>
              </div>
            );
          })}
          {pendingEntityRefs.map((r, i) => (
            <div key={`ref-${i}`} className="msg-composer-att-chip is-done">
              <span className="msg-composer-att-name">{refChipLabel(r)}</span>
              <button type="button" className="msg-composer-att-x" aria-label="Remove attachment" onClick={() => setPendingEntityRefs(prev => prev.filter((_, idx) => idx !== i))}>
                <Icon as={X} size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <GrowingTextarea
        ref={inputRef}
        className="msg-composer-input"
        placeholder={placeholder}
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
          // Mid-composition (Japanese, Chinese, Korean…) keys belong to the IME.
          if (isComposingKey(e)) return;
          // Escape lets a reply go first; the panel stays open.
          if (e.key === 'Escape' && replyTo && !mention) { e.preventDefault(); onCancelReply?.(); return; }
          if (mention) return; // the picker takes Enter
          // Enter sends on a desktop keyboard; on a touch one it makes a line.
          if (messageKeyAction(e, { touch: touchKeyboard() }) === 'send') { e.preventDefault(); send(); }
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
        <button type="button" ref={emojiBtnRef}
                className={`msg-composer-btn ${emojiAnchor ? 'is-active' : ''}`}
                title="Emoji"
                onClick={(e) => setEmojiAnchor(emojiAnchor ? null : e.currentTarget.getBoundingClientRect())}>
          <Icon as={Smile} size={14} />
        </button>
        <button type="submit" className="msg-composer-send" disabled={isBusy || (!body.trim() && !hasPayload)}>
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
          trigger={emojiBtnRef.current}
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
