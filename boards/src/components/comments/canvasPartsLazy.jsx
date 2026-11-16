import { Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useFeedback, warmFeedbackOverlay } from '../AppFeedback.jsx';
import { lazyWithReload } from '../../lib/lazyWithReload.js';
import {
  CommentPartsBoundary, commentPartsFrom, keepCommentPart, loadCommentFail, recoverCommentChunk, sayCommentsFailed,
} from './commentPartsLazy.jsx';

// The door to the comment parts of the canvas, a doc and a note that only a
// press needs: the open conversation (CommentCard, its rows, the box you
// write in and its @ list, the menus), the list behind the comments island,
// the look-ahead on a pin, a doc's panel and a note's card, and the styles
// only they use (commentsLook.css, canvasComments.css). They are one chunk
// (commentParts.js), fetched the first time one is wanted, so a cluster opens
// without them. The pins are a second chunk (CanvasCommentPins.jsx), fetched
// as the canvas mounts: further down.
//
// The boundary they are drawn behind, and what a chunk that cannot be had
// does, is commentPartsLazy.jsx, which a shared file's rail uses too. This
// file is only for the app (the canvas, a doc, a note): the shared-file page
// must not import it (see the note at the top of commentPartsLazy.jsx).
//
// A direct import of CommentCard.jsx or any of the others, of the pins, or
// of what they are built on (lib/commentPins.js, lib/commentModel.js,
// canvasThreads.js) from a file the app loads at once puts the whole set
// back into the app's first download (scripts/bundleBudget.mjs LAZY_IN_APP
// fails on it).
const loadParts = () => import('./commentParts.js');

// Ask for the parts ahead of the press: on pointing at, focusing or pressing
// a pin or the island, on "Add comment", and when a comment link is opened.
// A failure here is left for the press, which recovers from it.
export function preloadCommentParts() {
  loadParts().then(null, () => {});
  warmFeedbackOverlay();
}

// A doc's and a note's comment parts are made from the same door by the
// files that draw them (commentPartHost.jsx), which arrive with the doc or
// the note and so cost the app's first download nothing.
export const commentPart = commentPartsFrom(loadParts);

const PinPreviewPart = commentPart('PinPreview', true);
const CanvasCommentsListPart = commentPart('CanvasCommentsList');
const CanvasCommentCardPart = commentPart('CanvasCommentCard');

// The look-ahead on a pin (PinPreview.jsx has its props). It fails silently:
// nothing was pressed, and nothing shows.
export function PinPreview(props) {
  return (
    <CommentPartsBoundary>
      <Suspense fallback={null}>
        <PinPreviewPart {...props} />
      </Suspense>
    </CommentPartsBoundary>
  );
}

// The list behind the comments island (CanvasCommentsList.jsx has its props).
// Mounted only while the list is open. A list that cannot load says so and
// is closed, so the island can be pressed again.
export function CanvasCommentsList(props) {
  const { ui } = props;
  const feedback = useFeedback();
  const onFail = useCallback((_, { chunk }) => {
    ui.set({ listOpen: false, hoverId: null });
    sayCommentsFailed(feedback, chunk);
  }, [ui, feedback]);
  return (
    <CommentPartsBoundary onFail={onFail}>
      <Suspense fallback={null}>
        <CanvasCommentsListPart {...props} />
      </Suspense>
    </CommentPartsBoundary>
  );
}

// The pins (CanvasCommentPins.jsx has their props), a chunk of their own.
// Nobody presses for them: they are asked for as the canvas mounts
// (preloadCommentPins) and drawn when they and the comments are in, into a
// layer that floats over the cards, so their arriving moves nothing. Pins
// that cannot load (or that throw) show nothing and say nothing; the canvas
// and the island stay as they are. Their chunk follows the same reload rule
// as the parts (lib/commentChunkReload.js), and where that says no it is
// asked for again when the browser comes back online or the tab is looked at
// again.
//
// A browser answers a second import() of an address that failed with the
// same failure, without fetching it (lib/lazyWithReload.js), so the ask is
// made again at the chunk's own address with a query added
// (lib/commentChunkReload.js importAgain, which reads the address from the
// first failure). The pins have no stylesheet of their own (commentPins.css
// is in the first CSS), so nothing else is needed with it.
let pinsErr = null;   // the first failure to fetch them, until they are in
let pinsTry = 0;
const loadPins = () => (pinsTry
  ? loadCommentFail().then((m) => m.importAgain(pinsErr, pinsTry))
  : import('./CanvasCommentPins.jsx'));
// …with what a failure needs, which also asks for the toast's overlay once
// the canvas has painted
export function preloadCommentPins() {
  loadPins().then(null, () => {});
  loadCommentFail().then((m) => m.warmToast(), () => {});
}
const CanvasCommentPinsPart = keepCommentPart(lazyWithReload(() => loadPins().then((m) => {
  pinsErr = null;
  return { default: m.CanvasCommentPins };
}, (err) => {
  pinsErr = pinsErr || err;
  return recoverCommentChunk(err);
}), { reload: false }));
export function CanvasCommentPins(props) {
  const [tries, setTries] = useState(0);
  useEffect(() => {
    const again = () => {
      if (!pinsErr || document.hidden) return;
      pinsTry += 1;
      setTries(pinsTry);
    };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, []);
  return (
    <CommentPartsBoundary key={`${props.boardId || ''}:${tries}`}>
      <Suspense fallback={null}>
        <CanvasCommentPinsPart {...props} />
      </Suspense>
    </CommentPartsBoundary>
  );
}

// The open conversation on the canvas (CanvasCommentCard.jsx has its props).
// Nothing is drawn, and nothing fetched, until a conversation or a new
// comment is open. It floats over the canvas, so its arriving moves nothing.
// A conversation that cannot load says so and is no longer open, so its pin
// can be pressed again.
export function CanvasCommentCard(props) {
  const { ui } = props;
  const feedback = useFeedback();
  const onFail = useCallback((_, { chunk }) => {
    ui.set({ openId: null, draft: null, flashRowId: null, focusCard: null });
    sayCommentsFailed(feedback, chunk);
  }, [ui, feedback]);
  const wanted = useSyncExternalStore(ui.subscribe, () => { const s = ui.get(); return !!s.openId || !!s.draft; });
  if (!wanted) return null;
  return (
    <CommentPartsBoundary onFail={onFail}>
      <Suspense fallback={null}>
        <CanvasCommentCardPart {...props} />
      </Suspense>
    </CommentPartsBoundary>
  );
}
