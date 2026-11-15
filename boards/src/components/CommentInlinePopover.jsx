import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { commentsMap, addCommentReply, resolveComment, readThread } from '../lib/docState.js';
import { deleteCommentThreadUndoably } from '../lib/commentThreadDelete.js';
import { notifyCommentMentions } from '../lib/commentMentions.js';
import { EntityPicker } from './EntityPicker.jsx';
import { caretRect } from '../lib/caretRect.js';
import { placeCommentPopover } from '../lib/commentPopoverPlace.js';
import { useFeedback } from './AppFeedback.jsx';
import { isComposingKey } from '../lib/composerKeys.js';
import { detectMentionToken, matchMentions } from '../lib/commentMentionText.js';
import { shownAuthor } from '../lib/commentAuthor.js';
import { t as tr } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { PersonFace } from './PersonFace.jsx';
import { openProfile } from '../lib/openProfile.js';

const W = 320;

export function CommentInlinePopover({
  ydoc, scope, threadId, anchor, currentUser, onClose,
  // Optional. Present → replies can @-mention and the named people get
  // notified through notify_comment_mention. Absent (e.g. a legacy view='doc'
  // board with no board id in scope) → plain-text replies, as before.
  workspaceId = null, boardId = null, cardId = null,
  // False for a view-only reader. Their Y.Doc writes never leave the tab (the
  // board room marks their socket readOnly and drops them), so a reply,
  // resolve or delete would look saved and vanish on reload, and an
  // @-mention would notify someone about a reply that doesn't exist.
  editable = true,
}) {
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [replyMention, setReplyMention] = useState(null);   // { tokenStart, query, anchor }
  const [replyMentions, setReplyMentions] = useState([]);   // [{ id, name }]
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: W });
  const feedback = useFeedback();

  // Guard an in-progress reply: Escape / outside-click used to discard it
  // silently. Refs keep the dismiss handlers reading current state, and
  // confirmingRef stops the confirm dialog's own clicks from re-triggering
  // the outside-click close.
  const replyRef = useRef('');
  replyRef.current = reply;
  const confirmingRef = useRef(false);
  // Resolves true when the popover closed, false when it stayed open (the
  // person picked "Keep writing", or the confirm is already up).
  const requestClose = async () => {
    if (confirmingRef.current) return false;
    if (replyRef.current.trim()) {
      confirmingRef.current = true;
      const ok = await feedback.confirm({
        title: tr`Discard reply?`,
        message: tr`You have an unsent reply on this comment.`,
        confirmLabel: tr`Discard`,
        cancelLabel: tr`Keep writing`,
        danger: true,
      });
      confirmingRef.current = false;
      if (!ok) return false;
    }
    onClose?.();
    return true;
  };

  useEffect(() => {
    if (!ydoc || !threadId) return;
    const cm = commentsMap(ydoc, scope);
    if (!cm) return;
    // Its replies are filed beside it as well as in it (lib/commentKeys.js):
    // readThread puts them together.
    const refresh = () => setThread(readThread(ydoc, threadId, scope));
    refresh();
    cm.observeDeep(refresh);
    return () => cm.unobserveDeep(refresh);
  }, [ydoc, scope, threadId]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const popH = popRef.current?.scrollHeight || 240;
      setPos(placeCommentPopover(anchor, popH, window.innerWidth, window.innerHeight));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // `thread`: the first pass runs before the popover exists (240px guess);
    // re-place once it has its real height, and again as replies grow it.
  }, [anchor, thread]);

  useEffect(() => {
    // Claimed: an open doc is a layer (lib/modalGuard) that would close on
    // the same Escape at the window.
    const onKey = (e) => {
      if (isComposingKey(e)) return;
      if (e.key !== 'Escape' || confirmingRef.current) return;
      e.preventDefault();
      requestClose();
    };
    const onDown = (e) => {
      // Clicks inside the popover or the discard-confirm dialog don't close.
      if (e.target.closest?.('.feedback-bg')) return;
      if (popRef.current && !popRef.current.contains(e.target)) requestClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  if (!thread) return null;

  return createPortal(
    <div ref={popRef} className="comment-inline-pop surface-frosted" style={{ top: pos.top, left: pos.left, width: pos.width }}>
      <div className="comment-inline-head">
        {/* The picture is the author's current one, by id; the name and the
            colour stay what the thread recorded when it was written. On your
            own thread the face opens your profile, once this popover has
            closed: it sits above Settings, and would take the next press
            inside Settings for an outside press. */}
        <PersonFace userId={thread.authorId || null} name={shownAuthor(thread.author)}
                    color={thread.authorColor || 'var(--soleil)'}
                    className="comment-inline-author"
                    {...(thread.authorId && thread.authorId === currentUser?.id
                      ? { onClick: async () => { if (await requestClose()) openProfile('comment'); }, isolate: true, title: tr`Edit profile`, ariaLabel: tr`Edit profile` }
                      : { ariaHidden: true })} />
        <span className="comment-inline-name">{shownAuthor(thread.author)}</span>
        {editable ? (<>
        <button
          className="comment-inline-x"
          title={thread.resolved ? tr`Reopen` : tr`Resolve`}
          onClick={() => resolveComment(ydoc, threadId, !thread.resolved, scope, { by: currentUser?.id || null, byName: currentUser?.name || null })}
        >{thread.resolved ? '↺' : '✓'}</button>
        <button
          className="comment-inline-x"
          title={tr`Delete`}
          onClick={() => {
            // No confirm: the house delete → Undo toast (docs on their
            // structural undo, notes by putting back what was filed).
            deleteCommentThreadUndoably(ydoc, scope, threadId, feedback);
            onClose?.();
          }}
        >×</button>
        </>) : (
          <span className="comment-inline-viewonly"><Trans>View only</Trans></span>
        )}
      </div>
      <div className="comment-inline-body" dir="auto">{thread.body}</div>
      {thread.replies.map((r, i) => (
        <div key={r.id || i} className="comment-inline-reply">
          <div className="comment-inline-name">{shownAuthor(r.author)}</div>
          <div dir="auto">{r.body}</div>
        </div>
      ))}
      {editable && !thread.resolved && (
        <form className="comment-inline-replyform" onSubmit={(e) => {
          e.preventDefault();
          const body = reply.trim();
          if (!body) return;
          const mentions = matchMentions(body, replyMentions);
          addCommentReply(ydoc, threadId, {
            body,
            author: currentUser?.name || currentUser?.email || 'You',
            authorId: currentUser?.id || null,
            authorColor: currentUser?.color || 'var(--soleil)',
            mentions,
            scope,
          });
          notifyCommentMentions({ workspaceId, boardId, cardId, threadId, userIds: mentions, preview: body });
          setReply('');
          setReplyMentions([]);
        }}>
          <input value={reply}
                 onChange={(e) => {
                   const next = e.target.value;
                   setReply(next);
                   if (!workspaceId) return;
                   const tok = detectMentionToken(next, e.target.selectionStart ?? next.length);
                   setReplyMention(tok ? { ...tok, anchor: caretRect(e.target) } : null);
                 }}
                 onKeyDown={(e) => {
                   if (isComposingKey(e)) return;
                   if (e.key === 'Enter' && replyMention) e.preventDefault();
                 }}
                 placeholder={workspaceId ? tr`Reply… (@ to mention)` : tr`Reply…`} />
        </form>
      )}
      {editable && replyMention && workspaceId && (
        <EntityPicker
          workspaceId={workspaceId}
          anchor={replyMention.anchor}
          initialQuery={replyMention.query}
          filter={['user']}
          onCommit={(targets) => {
            const t = targets?.[0];
            if (!t) { setReplyMention(null); return; }
            const name = t.title || t.name || 'someone';
            const before = reply.slice(0, replyMention.tokenStart);
            const after = reply.slice(replyMention.tokenStart + 1 + replyMention.query.length);
            setReply(before + '@' + name + ' ' + after);
            setReplyMentions(p => [...p, { id: t.id, name }]);
            setReplyMention(null);
          }}
          onCancel={() => setReplyMention(null)}
        />
      )}
    </div>,
    document.body,
  );
}
