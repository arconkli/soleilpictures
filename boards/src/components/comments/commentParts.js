// The comment parts of the canvas, a doc and a note that only a press needs,
// as one chunk. Nothing imports this file but canvasPartsLazy.jsx (with
// import()), which is where those surfaces take them from, and the dev-only
// gallery (local/CommentQaHarness.jsx); a static import of it from the app
// would put them back into the first download. A shared file's parts are a
// chunk of their own (fileCommentParts.js).
export { CanvasCommentCard } from './CanvasCommentCard.jsx';
export { CanvasCommentsList } from './CanvasCommentsList.jsx';
export { PinPreview } from './PinPreview.jsx';
export { CommentCard } from './CommentCard.jsx';
export { CommentRow } from './CommentRow.jsx';
export { CommentComposer } from './CommentComposer.jsx';
// A doc's and a note's (commentPartHost.jsx draws them)
export { DocThreadsPanel } from './DocThreadsPanel.jsx';
export { NewDocComment, NoteThreadCard } from './DocFloatCards.jsx';
