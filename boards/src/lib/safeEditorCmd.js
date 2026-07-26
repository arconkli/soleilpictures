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
