import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { X, CheckCircle, MoreHorizontal, LinkSimple, Trash2, Loader2 } from '../../lib/icons.js';
import { CommentRow } from './CommentRow.jsx';
import { authorIn } from '../../lib/commentAuthor.js';
import { CommentTime } from './CommentTime.jsx';
import { CommentMenu } from './CommentMenu.jsx';
import { CommentComposer } from './CommentComposer.jsx';
import { replyHint, startHint } from '../../lib/commentRules.js';
import { holdThreadOpen } from '../../lib/openThreads.js';
import { t as tr } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import './commentsLook.css';

// One conversation: where it is, the comments, and the box to reply in. The
// same part floats over the canvas, sits in a doc's side panel, rises as a
// sheet on a phone and lists in a shared file's dark room. With no thread it
// is the start of a new one.
//
// A surface may keep one card mounted and hand it one thread after another
// (or a new comment, then the thread it became). The box is keyed by what it
// writes to, and the card forgets its own state when the thread changes, so
// no words, open menu or waiting button are carried from one to the next.
//
//   thread        a Thread (lib/commentModel.js), or null for a new comment
//   me            { id, name } or null
//   powers        fn(row | null) -> powers, or one powers object (lib/commentRules.js)
//   people        who "@" can find
//   title, thumb  what the conversation is about (thumb: a picture address or a node)
//   variant       'float' (320px glass) | 'panel' | 'sheet' | 'dark'
//   draftKey      where the unsent reply (or new comment) is kept
//   maxLength     the most characters a comment may hold on this surface
//   onReply({ body, mentions }), onStart({ body, mentions })   may return a promise
//   onEdit(rowId, { body, mentions }), onDelete(rowId), onDeleteThread()
//   onResolve(), onReopen()               may return a promise; the button waits
//   onCopyLink(rowId), onClose()
//   onOwnFace()   your own face beside your comment was pressed (the surface
//                 opens your profile, putting the card away first where the
//                 card would sit over Settings). None: faces are only faces.
//   rowExtra(row)   what the surface adds under a row's words
//   headerExtra     what it adds to the header (a timecode chip, a quote)
//   onDirtyChange(bool)   there are unsent words somewhere in the card
//   readOnlyNote  the quiet line shown in place of the box to someone who
//                 may read the conversation and not write in it
//   takeFocus     it was opened from the keyboard: the card takes the caret
//                 when it shows (Tab then walks the card, Esc closes it)
export function CommentCard({
  thread = null,
  me = null,
  powers = null,
  people = null,
  title = '',
  thumb = null,
  variant = 'float',
  draftKey = null,
  maxLength = null,
  onReply,
  onStart,
  onEdit,
  onDelete,
  onDeleteThread,
  onResolve,
  onReopen,
  onCopyLink,
  onClose,
  onOwnFace = null,
  rowExtra,
  headerExtra = null,
  onDirtyChange,
  takeFocus = false,
  readOnlyNote = null,
  // what a screen reader calls the card, when its title is not what it is about
  label: named = null,
  // the title is a way to what the conversation is about (a doc's words)
  onTitle = null,
}) {
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const menuRef = useRef(null);
  const [menu, setMenu] = useState(false);
  const [waiting, setWaiting] = useState('');   // 'resolve' | 'reopen' while the surface answers
  const dirt = useRef(new Set());
  const dirtyCb = useRef(onDirtyChange);
  dirtyCb.current = onDirtyChange;
  const markDirty = (key) => (on) => {
    const before = dirt.current.size > 0;
    if (on) dirt.current.add(key); else dirt.current.delete(key);
    const after = dirt.current.size > 0;
    if (before !== after) dirtyCb.current?.(after);
  };

  // One card, another thread: nothing of the last one stays.
  const tid = thread?.id ?? null;
  const [forId, setForId] = useState(tid);
  if (forId !== tid) { setForId(tid); setWaiting(''); setMenu(false); }
  // While this card shows a conversation, a notice about it stays out of the
  // toasts (lib/openThreads.js).
  useEffect(() => holdThreadOpen(tid), [tid]);
  const lastTid = useRef(tid);
  const want = useRef(null);       // { what: 'resolve' | 'reopen', at } until the caret has followed
  const started = useRef(false);   // the first comment was sent from this card
  // The caret may be moved only from inside the card (or from nowhere).
  const mayTakeFocus = () => {
    const a = document.activeElement;
    return !a || a === document.body || !!rootRef.current?.contains(a);
  };
  const focusIn = (sel) => {
    const el = (sel && rootRef.current?.querySelector(sel)) || rootRef.current;
    el?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (lastTid.current === tid) return;
    const was = lastTid.current;
    lastTid.current = tid;
    want.current = null;
    if (dirt.current.size) { dirt.current.clear(); dirtyCb.current?.(false); }
    // the first comment became a thread: the caret goes on to the reply box
    if (started.current && was == null && tid != null && mayTakeFocus()) focusIn('.cmt-foot .cmt-input');
    started.current = false;
  }, [tid]);

  const powersFor = (row) => (typeof powers === 'function' ? powers(row) : powers) || {};
  const rows = thread ? [thread.root, ...(thread.replies || [])].filter(Boolean) : [];
  const top = thread ? powersFor(thread.root) : powersFor(null);
  const resolved = !!thread?.resolved;
  const count = rows.length;
  const mine = (r) => r.meta?.mine === true || (me != null && r.authorId != null && r.authorId === me.id);
  // the dot sits on the newest words that aren't your own
  const unreadId = thread?.unread ? [...rows].reverse().find((r) => !r.deleted && !mine(r))?.id : null;

  // open on the newest words, and follow a new one in
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.id, count]);

  useEffect(() => {
    // a sheet takes focus when it opens, unless its box already has the caret
    if (variant === 'sheet' && !rootRef.current?.contains(document.activeElement)) rootRef.current?.focus({ preventScroll: true });
  }, [variant]);

  useEffect(() => {
    if (takeFocus && !rootRef.current?.contains(document.activeElement)) focusIn(null);
  }, [takeFocus, tid]);

  const wait = async (what, fn) => {
    if (!fn || waiting) return;
    setWaiting(what);
    want.current = { what, at: Date.now() };
    try { await fn(); } catch (_) { want.current = null; /* the surface says what went wrong */ }
    setWaiting('');
  };
  // The pressed button goes away once the surface answers. The caret follows:
  // Resolve -> Reopen, Reopen -> the reply box; never left on nothing.
  useEffect(() => {
    const w = want.current;
    if (!w || waiting) return;
    if ((w.what === 'resolve') !== resolved) return;
    want.current = null;
    if (Date.now() - w.at > 10000 || !mayTakeFocus()) return;
    focusIn(w.what === 'resolve' ? '.cmt-go' : '.cmt-foot .cmt-input');
  }, [resolved, waiting]);

  const start = onStart && (async (next) => {
    started.current = true;
    try { return await onStart(next); } catch (e) { started.current = false; throw e; }
  });
  // A deleted comment takes its menu with it: the caret goes to the card.
  const del = onDelete && ((rowId) => {
    const r = onDelete(rowId);
    const a = document.activeElement;
    if (mayTakeFocus() || a?.closest?.('.cmt-pop')) focusIn(null);
    return r;
  });

  const menuItems = [];
  if (thread && top.copyLink && onCopyLink) menuItems.push({ key: 'copy', label: tr`Copy link`, icon: LinkSimple, onSelect: () => onCopyLink(thread.root.id) });
  if (thread && top.delete && onDeleteThread) {
    if (menuItems.length) menuItems.push({ sep: true });
    menuItems.push({ key: 'delete-thread', label: tr`Delete conversation`, icon: Trash2, danger: true, refocus: false, onSelect: () => onDeleteThread() });
  }
  const showResolve = !!thread && !resolved && !!top.resolve && !!onResolve;
  const framed = variant === 'float' || variant === 'sheet';
  const hasWhere = !!title || !!thumb;
  const showHead = framed || hasWhere || headerExtra != null || showResolve || menuItems.length > 0 || !!onClose;
  const big = variant === 'sheet';
  const hint = !!(people && people.length);   // "@" finds someone here
  const canWrite = thread ? top.reply !== false && !!onReply : top.start !== false && !!onStart;
  const label = named ? named : title ? tr`Comments on ${title}` : (thread ? tr`Comments` : tr`New comment`);
  // "Resolved by Ana" for a real name; "Resolved by you" and plain "Resolved"
  // are whole messages of their own (lib/commentAuthor.js authorIn)
  const resolverIs = thread?.resolvedBy ? authorIn(thread.resolvedBy.name, me != null && thread.resolvedBy.id != null && thread.resolvedBy.id === me.id) : 'none';
  const resolver = resolverIs === 'name' ? thread.resolvedBy.name : '';

  return (
    <section
      ref={rootRef}
      className={`cmt-card cmt-card--${variant}${variant === 'dark' ? ' cmt-dark' : ''}${resolved ? ' is-resolved' : ''}`}
      role={framed ? 'dialog' : 'group'}
      aria-label={label}
      tabIndex={-1}
      data-cmt-card={thread?.id || 'new'}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented && onClose) { e.stopPropagation(); onClose(); }
      }}
    >
      {variant === 'sheet' && <div className="cmt-grab" aria-hidden="true" />}
      {showHead && (
        <header className="cmt-head">
          <div className="cmt-where">
            {thumb && (
              <span className="cmt-thumb" aria-hidden="true">
                {typeof thumb === 'string' ? <img src={thumb} alt="" draggable={false} /> : thumb}
              </span>
            )}
            {title && (onTitle
              ? <button type="button" className="cmt-title cmt-title--go" aria-label={tr`Show ${title} in the text`} onClick={() => onTitle()}>{title}</button>
              : <span className="cmt-title">{title}</span>)}
            {headerExtra != null && <span className="cmt-headx">{headerExtra}</span>}
          </div>
          {showResolve && (
            <button type="button" className="cmt-ib" aria-label={tr`Resolve`} aria-busy={waiting === 'resolve' || undefined} disabled={!!waiting} onClick={() => wait('resolve', onResolve)}>
              {waiting === 'resolve'
                ? <Icon as={Loader2} size={big ? 20 : 18} weight="regular" className="cmt-spin" />
                : <Icon as={CheckCircle} size={big ? 20 : 18} weight="regular" />}
            </button>
          )}
          {menuItems.length > 0 && (
            <button ref={menuRef} type="button" className="cmt-ib" aria-label={tr`More`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <Icon as={MoreHorizontal} size={big ? 20 : 18} weight="regular" />
            </button>
          )}
          {onClose && (
            <button type="button" className="cmt-ib" aria-label={tr`Close`} onClick={() => onClose()}>
              <Icon as={X} size={big ? 18 : 16} weight="regular" />
            </button>
          )}
        </header>
      )}
      {menu && <CommentMenu anchor={menuRef.current} label={tr`Conversation`} items={menuItems} onClose={() => setMenu(false)} />}

      {thread && (
        <div ref={scrollRef} className="cmt-scroll">
          {rows.map((row) => (
            <CommentRow
              key={row.id}
              row={row}
              powers={powersFor(row)}
              people={people}
              unread={row.id === unreadId}
              extra={rowExtra ? rowExtra(row) : null}
              draftKey={draftKey ? `${draftKey}.edit.${row.id}` : null}
              maxLength={maxLength}
              onEdit={onEdit}
              onDelete={del}
              onCopyLink={onCopyLink}
              onDirtyChange={markDirty(`edit.${row.id}`)}
              onProfile={onOwnFace && !row.deleted && mine(row) ? onOwnFace : null}
            />
          ))}
        </div>
      )}

      {resolved && (
        <div className="cmt-resolved">
          <Icon as={CheckCircle} size={14} weight="regular" />
          <span>
            {resolver ? <Trans>Resolved by <b>{resolver}</b></Trans>
              : resolverIs === 'me' ? <Trans>Resolved by you</Trans>
                : tr({ message: 'Resolved', context: 'this conversation is resolved' })}
            {thread.resolvedAt != null && <> · <CommentTime at={thread.resolvedAt} midLine /></>}
          </span>
          {top.reopen && onReopen && (
            <button type="button" className="cmt-go" disabled={!!waiting} aria-busy={waiting === 'reopen' || undefined} onClick={() => wait('reopen', onReopen)}><Trans>Reopen</Trans></button>
          )}
        </div>
      )}

      {canWrite && (
        <div className="cmt-foot">
          <CommentComposer
            key={draftKey || (thread ? `reply:${thread.id}` : 'new')}
            mode={thread ? 'reply' : 'new'}
            draftKey={draftKey}
            maxLength={maxLength}
            people={people}
            autoFocus={!thread}
            placeholder={thread ? replyHint({ resolved, canReopen: !!top.reopen, hint }) : startHint({ hint })}
            onSubmit={thread ? onReply : start}
            onCancel={onClose}
            onDirtyChange={markDirty('reply')}
          />
        </div>
      )}
      {!canWrite && thread && readOnlyNote && <p className="cmt-readonly">{readOnlyNote}</p>}
    </section>
  );
}
