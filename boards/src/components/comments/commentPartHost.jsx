import { Suspense, useCallback } from 'react';
import { useFeedback } from '../AppFeedback.jsx';
import { CommentPartsBoundary, sayCommentsFailed } from './commentPartsLazy.jsx';
import { commentPart } from './canvasPartsLazy.jsx';

// Where a doc and a note draw a comment part (the panel's threads, the card
// beside a note, the card a new comment is written in). The parts are the
// lazy chunk every surface shares (commentParts.js), taken through the one
// door (canvasPartsLazy.jsx). A part that cannot be had shows nothing here,
// and the doc or the note under it stays as it is; since someone pressed for
// it, a toast says the comments could not load.
//
// This file is only for code that is itself loaded later (the doc surface,
// the note editor, the pins): nothing the app loads at once imports it.
export const DocThreadsPanelPart = commentPart('DocThreadsPanel');
export const NewDocCommentPart = commentPart('NewDocComment');
export const NoteThreadCardPart = commentPart('NoteThreadCard');

//   part     one of the parts above
//   onFail   it could not be shown: put away whatever asked for it
export function CommentPartHost({ part: Part, onFail, ...props }) {
  const feedback = useFeedback();
  const fail = useCallback((err, info) => {
    onFail?.(err, info);
    sayCommentsFailed(feedback, info?.chunk);
  }, [onFail, feedback]);
  return (
    <CommentPartsBoundary onFail={fail}>
      <Suspense fallback={null}>
        <Part {...props} />
      </Suspense>
    </CommentPartsBoundary>
  );
}
