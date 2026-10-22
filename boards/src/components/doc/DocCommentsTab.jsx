import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { Icon } from '../Icon.jsx';
import { EntityPicker } from '../EntityPicker.jsx';
import { useFeedback } from '../AppFeedback.jsx';
import { Caps } from '../toolbar/Toolbar.jsx';
import {
  addCommentReply, resolveComment, pageContentMap, sheetContentMap, pagesArray,
} from '../../lib/docState.js';
import { commentAnchors } from '../../lib/docCommentAnchors.js';
import { deleteCommentThreadUndoably } from '../../lib/commentThreadDelete.js';
import { detectMentionToken, matchMentions } from '../../lib/commentMentionText.js';
import { notifyCommentMentions } from '../../lib/commentMentions.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { relativeTimeCompact } from '../../lib/relativeTime.js';
import { caretRect } from '../../lib/caretRect.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { ArrowUp, Check, Trash2 } from '../../lib/icons.js';

// The side panel's Comments (the owner's pick of 2026-10-21, mockup dx
// AC-comments): every thread of the doc, open and resolved, in the doc's
// order, each a card with the words it's on, who said what and when, a reply
// and Resolve, or who resolved it with Reopen. A card takes you to its words
// (DocSurface's onJump: the page opened, the words shown and lit); the caret
// in commented words picks their card.

const FILTERS = [['all', 'All'], ['open', 'Open'], ['resolved', 'Resolved']];

// What's typed in a card's reply and not sent, kept while the doc's open
// elsewhere (another tab of the panel, the panel shut) for this session.
const drafts = new Map();

export function DocCommentsTab({
  ydoc, scope, threads = [], editor = null, currentUser = null, canEdit = true,
  workspaceId = null, boardId = null, cardId = null,
  selectedId = null, onSelect, onJump,
}) {
  const anchors = useCommentAnchors(ydoc, scope);
  const [filter, setFilter] = useState('all');
  const listRef = useRef(null);

  // In the doc's order; a thread whose words are gone after, newest first.
  const ordered = useMemo(() => {
    const placed = threads.filter((t) => anchors.has(t.id))
      .sort((a, b) => anchors.get(a.id).order - anchors.get(b.id).order);
    return [...placed, ...threads.filter((t) => !anchors.has(t.id))];
  }, [threads, anchors]);
  const open = ordered.filter((t) => !t.resolved);
  const counts = { all: ordered.length, open: open.length, resolved: ordered.length - open.length };
  const shown = filter === 'open' ? open : filter === 'resolved' ? ordered.filter((t) => t.resolved) : ordered;

  // The caret in commented words picks their card.
  const atCaret = useEditorState({
    editor,
    selector: () => commentAtCaret(editor),
  });
  useEffect(() => { if (atCaret) onSelect?.(atCaret); }, [atCaret]); // eslint-disable-line react-hooks/exhaustive-deps

  // A card picked from outside the list (its words clicked, the caret moved
  // into them) is shown, under All if the filter would hide it.
  useEffect(() => {
    if (!selectedId) return;
    if (!shown.some((t) => t.id === selectedId) && ordered.some((t) => t.id === selectedId)) setFilter('all');
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-thread="${CSS.escape(selectedId)}"]`)?.scrollIntoView?.({ block: 'nearest' });
    });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFilterKey = (e) => {
    const at = FILTERS.findIndex(([k]) => k === filter);
    const to = e.key === 'ArrowRight' ? (at + 1) % FILTERS.length
      : e.key === 'ArrowLeft' ? (at - 1 + FILTERS.length) % FILTERS.length : null;
    if (to == null) return;
    e.preventDefault();
    setFilter(FILTERS[to][0]);
    const group = e.currentTarget;
    requestAnimationFrame(() => group.querySelector(`[data-filter="${FILTERS[to][0]}"]`)?.focus());
  };

  const ctx = { ydoc, scope, currentUser, canEdit, workspaceId, boardId, cardId, onSelect, onJump };
  return (
    <div className="dl-cmts">
      <div className="dl-cmts-f">
        <div className="dl-seg is-sm" role="radiogroup" aria-label="Show" onKeyDown={onFilterKey}>
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="radio" data-filter={k}
                    aria-checked={filter === k} tabIndex={filter === k ? 0 : -1}
                    onClick={() => setFilter(k)}>
              {label} <span className="dl-cnt">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <ul ref={listRef} className="dl-ths" aria-label="Comments">
          {shown.map((t) => (
            <li key={t.id}>
              <ThreadCard thread={t} anchor={anchors.get(t.id) || null} selected={t.id === selectedId} ctx={ctx} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="dl-cmts-none">
          {counts.all === 0 ? (
            <>
              <p className="dl-cmts-none-t">No comments yet</p>
              {canEdit && <p>Select some words, then Comment <Caps keys="Mod+Alt+M" /></p>}
            </>
          ) : filter === 'open' ? (
            <p className="dl-cmts-none-t">Nothing open: every comment is resolved</p>
          ) : (
            <p className="dl-cmts-none-t">Nothing resolved yet</p>
          )}
        </div>
      )}
    </div>
  );
}

// The thread whose words the caret is in (or just before), or null.
function commentAtCaret(editor) {
  if (!editor || editor.isDestroyed) return null;
  try {
    const $p = editor.state.doc.resolve(editor.state.selection.from);
    const marks = [...$p.marks(), ...($p.nodeAfter?.marks || [])];
    return marks.find((m) => m.type.name === 'comment' && m.attrs.id)?.attrs.id || null;
  } catch (_) { return null; }
}

// Where each thread sits (lib/docCommentAnchors.js), kept up to date as the
// doc changes, a few times a second at most while someone types.
function useCommentAnchors(ydoc, scope) {
  const [anchors, setAnchors] = useState(() => (ydoc ? commentAnchors(ydoc, scope) : new Map()));
  useEffect(() => {
    if (!ydoc) return undefined;
    const types = [pageContentMap(ydoc, scope), sheetContentMap(ydoc, scope), pagesArray(ydoc, scope)].filter(Boolean);
    let t = 0;
    const read = () => { t = 0; setAnchors(commentAnchors(ydoc, scope)); };
    const soon = () => { if (!t) t = setTimeout(read, 250); };
    read();
    types.forEach((y) => y.observeDeep(soon));
    return () => {
      clearTimeout(t);
      types.forEach((y) => y.unobserveDeep(soon));
    };
  }, [ydoc, scope]);
  return anchors;
}

// A face's colour: the one they comment in, unless that's the gold that marks
// what's yours on, or there isn't one.
const faceColor = (color, who) => (!color || /soleil|#ffa500/i.test(color) ? pickPresenceColor(who || '') : color);

const when = (ts) => {
  const s = relativeTimeCompact(ts);
  return s === 'Just now' ? 'just now' : s === 'Yesterday' ? 'yesterday' : /^\d+[mh]$/.test(s) ? `${s} ago` : s;
};
const fullDate = (ts) => {
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return ''; }
};

function ThreadCard({ thread, anchor, selected, ctx }) {
  const { ydoc, scope, currentUser, canEdit, onSelect, onJump } = ctx;
  const feedback = useFeedback();
  const me = currentUser?.id || null;
  const items = [
    { id: thread.id, author: thread.author, authorId: thread.authorId, authorColor: thread.authorColor, ts: thread.ts, body: thread.body },
    ...(thread.replies || []),
  ];
  const nameOf = (who) => (who.authorId && who.authorId === me ? 'You' : who.author || 'Someone');
  // A face is the person's own initial, yours too.
  const initialOf = (who) => (String(who.author || '').trim() || nameOf(who))[0].toUpperCase();
  const resolver = !thread.resolved ? null
    : thread.resolvedBy && thread.resolvedBy === me ? 'you'
      : thread.resolvedByName
        || (thread.resolvedBy && items.find((i) => i.authorId === thread.resolvedBy)?.author)
        || null;
  const go = () => { onSelect?.(thread.id); onJump?.(thread.id, anchor?.pageId || thread.pageId || null); };
  const quote = anchor?.quote || '';
  const cls = `dl-th${selected ? ' is-on' : ''}${thread.resolved ? ' is-res' : ''}`;
  return (
    <article className={cls} data-thread={thread.id}
             aria-label={`${thread.resolved ? 'Resolved comment' : 'Comment'} by ${nameOf(thread)}${quote ? ` on “${quote}”` : ''}`}
             onClick={(e) => {
               // Not from a control, nor from the mention picker (portaled
               // out, but its clicks still come up through here).
               if (e.currentTarget.contains(e.target) && !e.target.closest('button, input, a')) go();
             }}>
      {quote ? (
        <button type="button" className="dl-th-q" onClick={go} title="Show it in the doc">“{quote}”</button>
      ) : (
        <p className="dl-th-q is-gone">The words it was on are gone</p>
      )}
      {items.map((it, i) => (
        <div key={it.id || i} className="dl-cm">
          <span className="dl-face" aria-hidden="true" style={{ background: faceColor(it.authorColor, it.authorId || it.author) }}>
            {initialOf(it)}
          </span>
          <div className="dl-cm-b">
            <div className="dl-cm-h">
              <b>{nameOf(it)}</b>
              {it.ts ? <time dateTime={new Date(it.ts).toISOString()} title={fullDate(it.ts)}>{relativeTimeCompact(it.ts)}</time> : null}
              {/* The thread's delete, at the end of its first line, so the
                  words it's on keep the card's width. */}
              {i === 0 && canEdit && (
                <button type="button" className="dl-th-del" aria-label="Delete thread" title="Delete thread"
                        onClick={() => deleteCommentThreadUndoably(ydoc, scope, thread.id, feedback)}>
                  <Icon as={Trash2} size={14} />
                </button>
              )}
            </div>
            <div className="dl-cm-t">{it.body}</div>
          </div>
        </div>
      ))}
      {thread.resolved ? (
        <div className="dl-th-a">
          <span className="dl-th-by">
            {resolver ? `Resolved by ${resolver}` : 'Resolved'}
            {thread.resolvedAt ? <> · <time dateTime={new Date(thread.resolvedAt).toISOString()} title={fullDate(thread.resolvedAt)}>{when(thread.resolvedAt)}</time></> : null}
          </span>
          {canEdit && (
            <button type="button" className="dl-mini"
                    onClick={() => resolveComment(ydoc, thread.id, false, scope, { by: me, byName: currentUser?.name || null })}>
              Reopen
            </button>
          )}
        </div>
      ) : canEdit ? (
        <ReplyRow thread={thread} ctx={ctx} />
      ) : null}
    </article>
  );
}

// A reply, with @ to mention someone in the workspace, and Resolve.
function ReplyRow({ thread, ctx }) {
  const { ydoc, scope, currentUser, workspaceId, boardId, cardId } = ctx;
  const [text, setText] = useState(() => drafts.get(thread.id) || '');
  const [mention, setMention] = useState(null);   // { tokenStart, query, anchor }
  const pickedRef = useRef([]);                    // [{ id, name }]
  const inputRef = useRef(null);
  const put = (v) => {
    setText(v);
    if (v) drafts.set(thread.id, v); else drafts.delete(thread.id);
  };
  const send = () => {
    const body = text.trim();
    if (!body) return;
    const mentions = matchMentions(body, pickedRef.current);
    addCommentReply(ydoc, thread.id, {
      body,
      author: currentUser?.name || currentUser?.email || 'You',
      authorId: currentUser?.id || null,
      authorColor: currentUser?.color || null,
      mentions,
      scope,
    });
    notifyCommentMentions({ workspaceId, boardId, cardId, threadId: thread.id, userIds: mentions, preview: body });
    pickedRef.current = [];
    put('');
  };
  const resolve = () => resolveComment(ydoc, thread.id, true, scope, { by: currentUser?.id || null, byName: currentUser?.name || null });
  return (
    <div className="dl-th-a">
      <div className="dl-reply">
        <input ref={inputRef} value={text} placeholder="Reply" aria-label={`Reply to ${thread.author || 'this comment'}`}
               onChange={(e) => {
                 const v = e.target.value;
                 put(v);
                 if (!workspaceId) return;
                 const tok = detectMentionToken(v, e.target.selectionStart ?? v.length);
                 setMention(tok ? { ...tok, anchor: caretRect(e.target) } : null);
               }}
               onKeyDown={(e) => {
                 if (isComposingKey(e)) return;
                 if (e.key === 'Enter' && !mention) { e.preventDefault(); send(); }
                 else if (e.key === 'Enter') e.preventDefault();
               }} />
        {text.trim() && (
          <button type="button" className="dl-reply-send" aria-label="Send reply" title="Send reply" onClick={send}>
            <Icon as={ArrowUp} size={13} />
          </button>
        )}
      </div>
      <button type="button" className="dl-mini" onClick={resolve}><Icon as={Check} size={13} />Resolve</button>
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
            put(text.slice(0, mention.tokenStart) + '@' + name + ' ' + text.slice(mention.tokenStart + 1 + mention.query.length));
            pickedRef.current = [...pickedRef.current, { id: t.id, name }];
            setMention(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          onCancel={() => setMention(null)}
        />
      )}
    </div>
  );
}
