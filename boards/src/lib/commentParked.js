// Comments started on the canvas and left with words in them (this browser
// keeps the words, lib/commentDraft.js) each keep a pin where they were
// started. This looks for them and tells the comment UI store (`parked`),
// which the pins draw from. It arrives with the pins.
import { listCommentDraftTargets } from './commentDraft.js';
import { draftTargetId, anchorFromDraftTarget } from './commentPins.js';

//   ui  the comment UI store (lib/commentCanvas.js createCommentUi)
export function rescanParked(ui, userId, boardId) {
  const parked = userId && boardId
    ? listCommentDraftTargets({ userId, surface: 'canvas', scope: boardId }).map(anchorFromDraftTarget).filter((a) => a && a.kind !== 'board')
    : [];
  const sig = (l) => (l || []).map(draftTargetId).join('|');
  ui.set((s) => (sig(s.parked) === sig(parked) ? null : { parked }));
}
