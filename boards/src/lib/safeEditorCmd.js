// Run a TipTap command chain defensively.
//
// Some commands reach ProseMirror's `clearNodes` internally (list toggles,
// setParagraph / toggleHeading when the block type can't be set directly).
// When the selection spans a `hardBreak` (a Shift-Enter soft break — a leaf
// node that can't hold content), clearNodes' `setNodeMarkup` throws
// "Invalid content for node type hardBreak" (a RangeError). Left uncaught in a
// toolbar click / keyboard-shortcut handler this crashes the whole editor
// surface. safeRun swallows + logs so the formatting simply no-ops instead.
//
// Returns the command's boolean result, or false if it threw.

import { logClientError } from './errorReporting.js';

export function safeRun(chain, label = 'editor-cmd') {
  try {
    return chain.run();
  } catch (e) {
    try { logClientError(e, { kind: 'editor-cmd', componentStack: label }); } catch (_) {}
    return false;
  }
}

// Same guarantee for a command that isn't a chain — `editor.commands.foo()`,
// or anything that runs a transaction directly. safeRun can't be used there
// because there is no chain to hold un-run; pass a thunk instead.
//
//   safeCall(() => editor.commands.convertProseToScreenplay(), 'doc:to-screenplay')
//
// Same reason it exists: these run from onCreate and from menu handlers, where
// an uncaught RangeError takes the whole editor surface down.
export function safeCall(fn, label = 'editor-cmd') {
  try {
    return fn();
  } catch (e) {
    try { logClientError(e, { kind: 'editor-cmd', componentStack: label }); } catch (_) {}
    return false;
  }
}
