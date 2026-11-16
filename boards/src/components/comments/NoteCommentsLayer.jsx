import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { readComments } from '../../lib/docState.js';
import { commentMarkCss, markable } from '../../lib/commentMarkCss.js';
import { peekOpenComment, takeOpenComment, subscribeOpenComment, openCommentSynced } from '../../lib/commentOpen.js';
import { useFeedback } from '../AppFeedback.jsx';
import { t as tr } from '@lingui/core/macro';
import { CommentPartHost, NoteThreadCardPart } from './commentPartHost.jsx';

// The comments on the notes of a cluster. One layer for the whole canvas
// (it arrives with the pins), so a note that is only being read carries no
// comment code of its own:
//
//   how commented words look   a quiet tint for an open thread, gold for the
//                              one that is open, plain text for a resolved or
//                              deleted one (lib/commentMarkCss.js)
//   a press on those words     opens the thread, for anyone who can see the
//                              note: the shared card beside it
//   the list of a note's threads, and a link to one of them
//
// A note asks for its comments with a 'soleil-note-comments' event on the
// document: { cardId, threadId?, list?, byKey? } (the note editor once a new
// comment is posted, the note's menu for the list).
//
//   ydoc       the cluster's Y.Doc (threads are on each note's card map)
//   within     a selector the notes are under (the QA page has two copies)
export const NOTE_COMMENTS_EVENT = 'soleil-note-comments';
const KEY = 'docComments';

const commentsOf = (ydoc, cardId) => {
  const m = ydoc?.getMap('cards')?.get(cardId)?.get?.(KEY);
  return m && typeof m.forEach === 'function' ? m : null;
};
const noteEl = (within, cardId) => {
  try { return document.querySelector(`${within}[data-card-id="${cardId}"]`); } catch (_) { return null; }
};
// Is any of it on screen?
const inView = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
};

export function NoteCommentsLayer({
  ydoc, boardId = null, workspaceId = null, currentUser = null, canEdit = false, within = '',
}) {
  const feedback = useFeedback();
  // Bumped when any note's threads change (not when a card only moves).
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const cards = ydoc?.getMap('cards');
    if (!cards) return undefined;
    const on = (events) => {
      for (const e of events) {
        if (e.path.includes(KEY) || e.keysChanged?.has?.(KEY) || e.path.length === 0) { setRev((n) => n + 1); return; }
      }
    };
    cards.observeDeep(on);
    setRev((n) => n + 1);
    return () => cards.unobserveDeep(on);
  }, [ydoc]);

  const [open, setOpen] = useState(null);
  //   open = { cardId, threadId | null, list, flashRowId, byKey } | null
  const openRef = useRef(open);
  openRef.current = open;

  // Every note that has threads: [{ cardId, entries }]
  const notes = useMemo(() => {
    const out = [];
    ydoc?.getMap('cards')?.forEach((card, id) => {
      const m = card?.get?.(KEY);
      if (!m || typeof m.forEach !== 'function' || !m.size || !markable(id)) return;
      if (card.get('kind') === 'doc') return;   // a doc draws its own
      out.push({ cardId: id, entries: readComments(ydoc, { comments: m }) });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, rev]);

  const css = useMemo(() => {
    let rest = '';
    let lit = '';
    for (const n of notes) {
      const c = commentMarkCss({
        threads: n.entries, scope: `${within}[data-card-id="${n.cardId}"]`,
        openId: open && open.cardId === n.cardId && !open.list ? open.threadId : null,
      });
      rest += c.rest;
      lit += c.open;
    }
    return { rest, lit };
  }, [notes, open, within]);

  // A press on an open thread's words. (Capture: the note under it would
  // otherwise take the click for itself.) Words whose thread is resolved or
  // gone are plain text: the press is the note's.
  useEffect(() => {
    const onClick = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      let el = t.closest('.tt-comment[data-comment-id]');
      if (!el) return;
      const cardEl = el.closest(`${within}[data-card-id]`);
      const cardId = cardEl?.getAttribute('data-card-id');
      const map = cardId ? commentsOf(ydoc, cardId) : null;
      if (!map || ydoc.getMap('cards').get(cardId)?.get('kind') === 'doc') return;
      const threads = readComments(ydoc, { comments: map });
      let hit = null;
      while (el && cardEl.contains(el)) {
        const id = el.getAttribute('data-comment-id');
        hit = threads.find((x) => x.id === id && !x.resolved) || null;
        if (hit) break;
        el = el.parentElement?.closest('.tt-comment[data-comment-id]') || null;
      }
      if (!hit) return;
      // In the editor the click also puts the caret there; a note being read
      // has nothing else to do with it.
      if (!t.closest('[contenteditable="true"]')) { e.preventDefault(); e.stopPropagation(); }
      setOpen({ cardId, threadId: hit.id, list: false, flashRowId: null, byKey: false });
    };
    const onAsk = (e) => {
      const d = e.detail || {};
      if (!d.cardId) return;
      setOpen({ cardId: d.cardId, threadId: d.threadId || null, list: !!d.list || !d.threadId, flashRowId: null, byKey: !!d.byKey });
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener(NOTE_COMMENTS_EVENT, onAsk);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener(NOTE_COMMENTS_EVENT, onAsk);
    };
  }, [ydoc, within]);

  // A link to a comment on a card of this cluster (?board=&card=&comment=).
  // A doc opens and shows it in its own panel; a note's opens here.
  //
  // A doc's card that is off screen is not drawn and hears nothing, so it is
  // asked to open again, every second and a half, until the doc says it has
  // the request (lib/commentOpen.js `opened`); from there the doc says what
  // it finds. A doc that never opens is never called gone: the request is
  // dropped, unsaid, when it runs out.
  //
  // A note's comment that is not found is called gone only once the
  // cluster's server copy is in (`synced`), and a few seconds after: until
  // then it may simply not have arrived.
  //
  // A card outside the view the cluster opened on (a notice's row or toast,
  // which leaves only the request) is brought into view first, once per
  // request, the way a link to a card is: 'soleil-flash-card', which the
  // canvas answers by selecting the card and centring it (and which stops a
  // held open). A note's thread then opens once the note is on screen.
  const link = useSyncExternalStore(subscribeOpenComment, peekOpenComment, peekOpenComment);
  const askedDoc = useRef(0);
  const shown = useRef({ key: null, at: 0 });
  const bringIntoView = (l) => {
    const key = `${l.cardId} ${l.commentId} ${l.at}`;
    if (shown.current.key === key) return false;
    shown.current = { key, at: Date.now() };
    document.dispatchEvent(new CustomEvent('soleil-flash-card', { detail: { boardId, cardId: l.cardId } }));
    return true;
  };
  const [linkTick, setLinkTick] = useState(0);
  useEffect(() => {
    if (!link || !link.cardId || !boardId || link.boardId !== boardId || !ydoc) return undefined;
    const again = (ms) => {
      const w = setTimeout(() => setLinkTick((n) => n + 1), ms);
      return () => clearTimeout(w);
    };
    const card = ydoc.getMap('cards').get(link.cardId);
    if (card?.get?.('kind') === 'doc') {
      if (link.opened) return undefined;
      if (!noteEl(within, link.cardId)) {
        // not drawn: off screen, and it would never hear the ask below
        bringIntoView(link);
        return again(400);
      }
      if (Date.now() - askedDoc.current >= 1400) {
        askedDoc.current = Date.now();
        document.dispatchEvent(new CustomEvent('soleil-open-doc-card', { detail: { cardId: link.cardId } }));
      }
      return again(1500);
    }
    const map = card ? commentsOf(ydoc, link.cardId) : null;
    let hit = null;
    for (const t of map ? readComments(ydoc, { comments: map }) : []) {
      if (t.id === link.commentId) hit = { id: t.id, row: null };
      else if ((t.replies || []).some((r) => r.id === link.commentId)) hit = { id: t.id, row: link.commentId };
      if (hit) break;
    }
    if (!hit) {
      if (!openCommentSynced(link, ydoc)) return again(1000);
      const w = setTimeout(() => {
        if (takeOpenComment(boardId)) feedback.toast({ type: 'info', message: tr`That comment isn't here any more` });
      }, 4000);
      return () => clearTimeout(w);
    }
    // The note is off screen: bring it in, and open once it is there (the
    // card beside a note that cannot be seen is hidden, and the next press
    // would close it). Three seconds at most, then it opens regardless.
    if (!inView(noteEl(within, link.cardId))) {
      bringIntoView(link);
      if (Date.now() - shown.current.at < 3000) return again(250);
    }
    if (takeOpenComment(boardId)) setOpen({ cardId: link.cardId, threadId: hit.id, list: false, flashRowId: hit.row, byKey: false });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, boardId, ydoc, rev, feedback, linkTick]);

  const cardId = open?.cardId || null;
  const getRect = useCallback(() => {
    const el = cardId ? noteEl(within, cardId) : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return null;
    return r;
  }, [cardId, within]);
  // Are the thread's words still in the note? (A note not on screen: unknown,
  // so not called gone.)
  const hasWords = useCallback((id) => {
    const el = cardId ? noteEl(within, cardId) : null;
    if (!el || !markable(id)) return true;
    return !!el.querySelector(`.tt-comment[data-comment-id="${id}"]`);
  }, [cardId, within]);
  // The note went (deleted, another cluster): nothing is open.
  const map = cardId ? commentsOf(ydoc, cardId) : null;
  useEffect(() => { if (cardId && !ydoc?.getMap('cards')?.get(cardId)) setOpen(null); }, [cardId, ydoc, rev]);

  const entries = useMemo(
    () => notes.find((n) => n.cardId === cardId)?.entries || [],
    [notes, cardId],
  );
  const scope = useMemo(() => (map ? { comments: map } : null), [map]);

  return (
    <>
      {css.rest && <style>{css.rest}</style>}
      {css.lit && <style>{css.lit}</style>}
      {open && scope && (
        <CommentPartHost
          part={NoteThreadCardPart}
          onFail={() => setOpen(null)}
          ydoc={ydoc} scope={scope} entries={entries}
          openId={open.threadId} listOpen={open.list}
          getRect={getRect} hasWords={hasWords}
          currentUser={currentUser} canEdit={canEdit}
          workspaceId={workspaceId} boardId={boardId} cardId={cardId}
          flashRowId={open.flashRowId} takeFocus={open.byKey}
          onOpen={(id) => setOpen((o) => (id && o ? { ...o, threadId: id, list: false, flashRowId: null } : null))}
          onList={(on) => setOpen((o) => (o ? (on || o.threadId ? { ...o, list: !!on } : null) : null))}
        />
      )}
    </>
  );
}
