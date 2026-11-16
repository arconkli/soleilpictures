import { Component } from 'react';
import { warmFeedbackOverlay } from '../AppFeedback.jsx';
import { lazyWithReload, looksLikeStaleChunk } from '../../lib/lazyWithReload.js';
import { reportError } from '../../lib/errorReporting.js';
import { t } from '@lingui/core/macro';

// The one boundary every comment part is drawn behind, whichever chunk it
// comes in: what a part that cannot be had does (below), how it is asked for
// again, and when the page may reload for it. Two chunks hold the parts:
//
//   commentParts.js       the canvas's, a doc's and a note's: the open
//                         conversation, the list behind the comments island,
//                         the look-ahead on a pin, a doc's panel, a note's
//                         card. Its door is canvasPartsLazy.jsx.
//   fileCommentParts.js   a shared file's rail (/f/<token> and the app's
//                         shared-file view): the card, its rows, the box you
//                         write in, the menus, and nothing of the canvas or
//                         of docs. Its door is fileCommentPart, below.
//
// This file must never name the first chunk, the pins or anything they are
// built on, not even inside an import(): the shared-file page loads this
// file without the canvas, and a chunk it could ask for from here is one the
// bundler has to make loadable without the canvas, which splits what the
// comment parts share with the canvas out of the canvas's own chunk and puts
// canvas code on a public /f/ page (lib/fileCommentParts.test.mjs).
const loadFileParts = () => import('./fileCommentParts.js');

// When a chunk cannot be fetched: a part someone pressed for may reload the
// page, once in this tab and only when the site still answers; a reload is
// the one way a browser fetches a failed import again and what a deploy that
// replaced the chunk needs. Otherwise the failure is thrown to
// CommentPartsBoundary below, and the press says so. A part that shows
// unasked (`quiet`: the look-ahead) never reloads.
//
// All of that is only read by a failure, so it is a small chunk of its own
// (commentChunkFail.js, with the rule in lib/commentChunkReload.js), fetched
// as the canvas mounts (canvasPartsLazy.jsx preloadCommentPins) and kept.
// Where it could not be fetched either there is no network to reload over:
// the failure goes to the boundary and nothing is said.
//
// A chunk that failed once is asked for again on the next press, at its own
// address with a query added (a browser hands a second import() of a failed
// address the same failure without fetching: lib/commentChunkReload.js). If
// it still cannot be had, the press says so in plain words through the
// toast's overlay, when that is in.
let failMod = null;
let failErr = null;
let failTry = 0;
export const loadCommentFail = () => {
  if (failMod) return Promise.resolve(failMod);
  const at = failErr ? (/https?:\/\/[^\s?#]+/.exec(String(failErr.message || '')) || [''])[0] : '';
  const ask = at && at.startsWith(`${window.location.origin}/`)
    ? import(/* @vite-ignore */ `${at}?again=${failTry += 1}`)
    : import('./commentChunkFail.js');
  return ask.then((m) => { failMod = m; failErr = null; return m; }, (e) => { failErr = failErr || e; throw e; });
};
export const recoverCommentChunk = (err) => loadCommentFail().then((m) => m.recoverCommentChunk(err), () => { throw err; });
// Said once when two parts fail together, or a press is repeated at once
// (commentChunkFail.js keeps the same 1.5 s for its own words).
let saidPlainAt = 0;
export const sayCommentsFailed = (feedback, chunk) => {
  loadCommentFail().then((m) => m.sayFailed(feedback, chunk), () => {
    const now = Date.now();
    if (now - saidPlainAt < 1500) return;
    saidPlainAt = now;
    warmFeedbackOverlay().then((ok) => {
      if (ok) feedback?.toast?.({ type: 'error', code: 'comment_parts_failed', message: t`Comments couldn't load. Check your connection.` });
    });
  });
};

const made = [];
// A lazy component kept here is made again after a failure (resetParts).
export const keepCommentPart = (C) => { made.push(C); return C; };
// → part(name, quiet): the named export of the chunk `loadChunk` fetches, as
// a lazy component with the failure rule above.
export const commentPartsFrom = (loadChunk) => (name, quiet) => {
  const load = () => loadChunk().then((m) => ({ default: m[name] }));
  return keepCommentPart(lazyWithReload(quiet ? load : () => load().catch(recoverCommentChunk), { reload: false }));
};
// A part that failed is made again, so the next ask goes through the fetch
// (and its recovery) again instead of being handed the old failure.
const resetParts = () => { made.forEach((C) => C.reset?.()); };

// A shared file's parts (components/fileShare/FileComments.jsx draws them).
export const fileCommentPart = commentPartsFrom(loadFileParts);

// Around every place a comment part is drawn. A part that cannot be had (its
// chunk did not arrive) or that throws while drawing shows nothing here, and
// what is under it stays as it is: nothing of the comments reaches the
// cluster's own error boundary. It lives only while its part is wanted, so
// the next ask starts with a fresh one.
//   onFail(error, { chunk })   chunk: the fetch failed (the connection, not a bug)
export class CommentPartsBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    const chunk = looksLikeStaleChunk(error);
    if (!chunk) reportError(error, { kind: 'comment-parts', componentStack: info?.componentStack });
    resetParts();
    this.props.onFail?.(error, { chunk });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
