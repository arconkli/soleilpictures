import DOMPurify from 'dompurify';

// Sanitizer for card html (notes + grid text cells) on its way into the DOM.
//
// WHY. A note's `html` is rendered with dangerouslySetInnerHTML — cards.jsx's
// NoteAutoLinkBody and cards/gridCellShared.jsx's CellText — and that html
// arrives over the CRDT from board_state. PartyKit relays document updates
// without inspecting their content, so anything with write access to a board (a
// workspace member, an invited editor, anyone holding a collab link) could put
// arbitrary markup into every other viewer's DOM, on the app's own origin,
// where the Supabase session lives in localStorage.
//
// React's dangerouslySetInnerHTML will not run a <script> — innerHTML never
// does — which is exactly why this was easy to miss. The vector is handler
// ATTRIBUTES and javascript: URLs. tests/note-html-xss.spec.js demonstrated
// `<img onerror>`, `<iframe srcdoc>` and `<details ontoggle>` all executing, and
// a javascript: href surviving, before this existed.
//
// THE ALLOWLIST IS DERIVED, NOT GUESSED. Every tag, class and attribute below
// comes from something that actually produces note html:
//   • noteExtensions.js — StarterKit (codeBlock and horizontalRule explicitly
//     OFF, heading levels 1-3), BulletList, OrderedList, Underline, TextStyle,
//     Color, FontFamily, FontSize, TextAlign
//   • NoteChecklist.js  — ul.note-checklist > li.ck > span.ck-box + div.ck-text
//   • NoteMention.js    — span[data-entity-ref].tt-link.tt-link-manual
//   • CommentMark.js    — span[data-comment-id].tt-comment
//   • noteLinkify.js    — div.note-link-preview > .note-link-preview-meta
//                         (span/strong/small) + button.note-preview-remove
//
// Getting this wrong is not a cosmetic bug: dropping an attribute here silently
// eats content that is already saved. Two in particular are load-bearing —
// `data-comment-id` anchors every word-level note comment, and inline `style`
// carries the per-span colours that readableColor.js relies on to keep painted
// notes legible. Both are covered by tests/note-html-xss.spec.js.
//
// The list is deliberately WIDER than the current note schema, because notes
// predate that schema. The original note editor was a contentEditable
// (RichNoteEditor) that accepted pasted HTML wholesale, so saved notes in the
// wild contain tags Tiptap would never emit today — tables, <h4>, <pre>, images.
// renderHtmlWithAutoLinks' own header still documents the expected set as
// "div p span strong em u s b i br a code pre ul ol li h1-h4 blockquote img".
// Narrowing to just what noteExtensions produces would quietly delete years of
// pasted content on next render, so legacy structural tags are allowed through.
//
// Allowing <img> is not the risk it looks like: the exploit is the `onerror`
// ATTRIBUTE, and attributes are allowlisted separately below — no handler
// survives regardless of which tags are permitted.

const ALLOWED_TAGS = [
  // Block structure
  'p', 'div', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre',
  // Lists (plain + checklist + legacy definition lists)
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // Inline formatting
  'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'code', 'small', 'sub', 'sup', 'mark',
  // Links, and the link-preview block's remove button
  'a', 'button',
  // Legacy pasted content
  'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
];

const ALLOWED_ATTR = [
  'class', 'style', 'href', 'target', 'rel', 'type', 'aria-label',
  // Images + legacy table geometry.
  'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan',
  // Custom node/mark contracts — see the header.
  'data-comment-id', 'data-entity-ref', 'data-type', 'data-url',
];

const CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  // Everything data-* is NOT waved through; the three the app actually emits
  // are listed above. Keeps a future attribute from arriving unreviewed.
  ALLOW_DATA_ATTR: false,
  // Belt and braces. DOMPurify already drops these given the allowlist above,
  // but naming them means a later widening of ALLOWED_TAGS can't quietly
  // readmit them.
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form', 'input', 'textarea', 'select', 'svg', 'math', 'details'],
  // DOMPurify strips every on* handler and neutralises javascript:/data: URIs
  // in href by default; both are the actual exploit paths here.
  KEEP_CONTENT: true,
};

// Any anchor we hand back opens with target=_blank in places; without noopener
// the opened page gets a live window.opener handle back to the app.
let hookInstalled = false;
function installHook() {
  if (hookInstalled || typeof window === 'undefined') return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hookInstalled = true;
}

// Sanitize card html. Returns a string, safe to hand to dangerouslySetInnerHTML
// or innerHTML.
//
// SSR/worker safety: DOMPurify needs a DOM. Where there isn't one (the worker's
// SEO rendering, node-side tests) we return an empty string rather than the raw
// input — returning the input would defeat the point at exactly the moment we
// cannot check it.
export function sanitizeNoteHtml(html) {
  if (!html) return '';
  if (typeof window === 'undefined' || !DOMPurify.isSupported) return '';
  installHook();
  return DOMPurify.sanitize(String(html), CONFIG);
}
