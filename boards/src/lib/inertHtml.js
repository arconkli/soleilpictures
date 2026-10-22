// Parse stored or pasted html only to read or rewrite it.
//
// The container belongs to a document of its own, made by
// document.implementation.createHTMLDocument: that document has no window, so
// nothing parsed into it loads or runs. DOMPurify parses the same way. Use this
// (or sanitizeNoteHtml, or a <template>) wherever card html is turned into
// nodes that are not going straight onto the page.
//
// The returned div behaves like any other: querySelectorAll, TreeWalkers and
// innerHTML all work, and nodes made by the page's document are adopted when
// appended to it.

let inertDoc = null;

export function inertContainer(html) {
  if (!inertDoc) inertDoc = document.implementation.createHTMLDocument('');
  const root = inertDoc.createElement('div');
  root.innerHTML = html || '';
  return root;
}
