// A shared file's comment parts, as a chunk of their own: the rail's
// conversations (FileThreads.jsx) over the card, its rows, the box you write
// in, the menus and their styles (commentsLook.css). Nothing imports this
// file but commentPartsLazy.jsx (with import()).
//
// The public /f/<token> page fetches this chunk, so nothing here may reach
// the canvas or a doc: no cards.jsx, CanvasSurface, lib/docState.js,
// lib/commentsApi.js, canvasThreads.js or docThreadOps.js, directly or
// through what it imports (lib/fileCommentParts.test.mjs walks the imports).
export { FileThreads } from './FileThreads.jsx';
