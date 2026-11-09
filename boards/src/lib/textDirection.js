// Which direction people's words read in: dir="auto" on the right elements.
//
// One rule, shared by the editor plugin (ProseMirror node names) and the static
// pass over sanitized html (DOM tag names), so an Arabic or Hebrew paragraph
// reads right to left while editing and on every read-only render, and English
// is untouched (auto resolves to ltr for it).
//
// WHY THE OUTERMOST TEXT BLOCK. The HTML auto rule looks at an element's text
// and skips any descendant that carries its own dir. A list item whose
// paragraph had dir="auto" would find no text of its own and stay
// left-to-right. So the item (or the quote) takes dir="auto", and the
// paragraphs and headings inside it take nothing; they inherit.
//
// dir goes on: list items (listItem, taskItem, the note checklist item li.ck),
// blockquotes, and every paragraph and heading that is NOT inside one of those.
// ul/ol never get it (a marker follows the item it belongs to). Code blocks and
// screenplay blocks never get it.
//
// View-only: the editor draws it as a decoration and the static pass sets it on
// a DOM that is only displayed, so nothing here reaches getHTML(), Yjs, the
// schema or stored card html.

const ITEMS = new Set(['li', 'listitem', 'taskitem', 'notechecklistitem']);
const TEXT_BLOCKS = new Set(['p', 'paragraph', 'heading', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// Scripts written right to left (Unicode bidi class R or AL).
// An engine whose Unicode tables lack a script's name throws on it, which would stop
// this module (and the canvas) loading; a script it doesn't know is one its users can't type there anyway.
export function scriptClass(names, make = (src) => new RegExp(src, 'u')) {
  const ok = names.filter((n) => {
    try { make(`^[\\p{Script=${n}}]`); return true; } catch { return false; }
  });
  return make(`^[${ok.map((n) => `\\p{Script=${n}}`).join('')}]`);
}
const RTL_LETTER = scriptClass([
  'Arabic', 'Hebrew', 'Syriac', 'Thaana', 'Nko', 'Adlam', 'Samaritan', 'Mandaic',
  'Hanifi_Rohingya', 'Mende_Kikakui', 'Old_Hungarian', 'Nabataean', 'Palmyrene', 'Avestan',
  'Imperial_Aramaic', 'Phoenician', 'Lydian', 'Hatran', 'Inscriptional_Pahlavi',
  'Inscriptional_Parthian', 'Old_South_Arabian', 'Old_North_Arabian', 'Manichaean',
  'Psalter_Pahlavi', 'Elymaic', 'Chorasmian', 'Yezidi', 'Sogdian', 'Old_Sogdian',
  'Meroitic_Cursive', 'Kharoshthi', 'Old_Turkic', 'Cypriot',
]);
// A letter, or one of the three invisible direction marks (LRM, RLM, ALM).
const FIRST_STRONG = /[\p{L}‎‏؜]/u;

// The direction of the first strong letter in `text`: 'rtl', 'ltr', or null when
// it holds none (digits, punctuation and spaces are not strong).
export function strongDirection(text) {
  const m = FIRST_STRONG.exec(text || '');
  if (!m) return null;
  if (m[0] === '‎') return 'ltr';
  return m[0] === '‏' || m[0] === '؜' || RTL_LETTER.test(m[0]) ? 'rtl' : 'ltr';
}

// A list item or a blockquote: the elements that own the direction of what is in them.
export function ownsDirection(name) {
  const n = String(name || '').toLowerCase();
  return ITEMS.has(n) || n === 'blockquote';
}

// Should this node/element carry dir="auto"? `inside` is whether it sits within
// a list item or a blockquote. `name` is a ProseMirror node name or a tag name.
export function wantsDirAuto(name, inside) {
  const n = String(name || '').toLowerCase();
  if (ownsDirection(n)) return true;
  if (TEXT_BLOCKS.has(n)) return !inside;
  return false;
}

// Elements that can hold text straight in them, with no paragraph between:
// the legacy note editor's <div> lines and pasted table cells. The static pass
// marks one that does (the editor's schema has no such node).
const DIRECT_TEXT_HOLDERS = new Set(['div', 'td', 'th']);

const hasDirectText = (el) => Array.from(el.childNodes || [])
  .some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue || ''));

// The static pass: set dir="auto" on every element the rule picks under `root`
// (an Element or DocumentFragment), and on a div, td or th that holds
// non-whitespace text directly and is not inside a list item or quote, and on a
// name chip (span[data-entity-ref]) wherever it sits. Never
// overrides a dir already there; never looks inside <pre> (code). Every dir it
// adds is tagged data-dir-auto, so htmlWithoutDirection can take back exactly
// those and leave a dir the author stored. Returns root.
//
// A line with no strong letter of its own (only a chip, digits or punctuation)
// follows the editor's rule (textDirectionExtension.js): the direction of its
// first descendant owner that has a letter, else of the nearest earlier owner
// (document order) that has one. dir="auto" alone would read such a line left to
// right after an Arabic one, so when that direction is rtl the owner gets an
// explicit dir="rtl" (still tagged data-dir-auto). When it is ltr, or there is
// none, the owner keeps dir="auto", which reads ltr for a line with no letter.
// `settle: false` skips that last step (every owner keeps dir="auto"), for a DOM
// someone then types into: it is not re-marked while they type, so an explicit
// dir="rtl" would hold English typed into that line right to left.
export function markTextDirection(root, { settle = true } = {}) {
  if (!root) return root;
  const owners = [];
  const walk = (el, inside) => {
    for (const child of Array.from(el.children || [])) {
      const tag = String(child.tagName || '').toLowerCase();
      if (tag === 'pre') continue;
      const picked = wantsDirAuto(tag, inside)
        || (!inside && DIRECT_TEXT_HOLDERS.has(tag) && hasDirectText(child));
      // A name chip never decides its line's direction: with a dir of its own it
      // is skipped by the owner's dir="auto" and read, isolated, as itself.
      const chip = tag === 'span' && child.hasAttribute('data-entity-ref');
      const add = (picked || chip) && !child.hasAttribute('dir');
      if (add) {
        child.setAttribute('dir', 'auto');
        child.setAttribute('data-dir-auto', '');
      }
      const at = picked ? owners.length : -1;
      if (picked) owners.push({ el: child, mine: add, end: 0 });
      walk(child, inside || ownsDirection(tag));
      if (picked) owners[at].end = owners.length;
    }
  };
  walk(root, false);
  if (settle) settleOwnersWithoutLetters(owners);
  return root;
}

// Undo the settle step on a DOM someone is about to type into: only the settle
// step puts dir="rtl" on a data-dir-auto owner, so each goes back to dir="auto".
export function unsettleTextDirection(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return root;
  for (const el of root.querySelectorAll('[data-dir-auto][dir="rtl"]')) el.setAttribute('dir', 'auto');
  return root;
}

// The first strong letter in an element's own text, the way the browser's
// dir="auto" reads it: a descendant that carries a dir is skipped.
function ownStrong(node) {
  for (const c of Array.from(node.childNodes || node.children || [])) {
    if (c.nodeType === 3) {
      const d = strongDirection(c.nodeValue);
      if (d) return d;
    } else if (!(c.hasAttribute && c.hasAttribute('dir'))) {
      const d = ownStrong(c);
      if (d) return d;
    }
  }
  return null;
}

function settleOwnersWithoutLetters(owners) {
  const own = owners.map((o) => ownStrong(o.el));
  let last = null; // the letter direction of the nearest earlier owner that has one
  owners.forEach((o, i) => {
    if (!own[i] && o.mine) {
      let want = null;
      for (let j = i + 1; j < o.end && !want; j += 1) want = own[j];
      if ((want || last) === 'rtl') o.el.setAttribute('dir', 'rtl');
    }
    if (own[i]) last = own[i];
  });
}

// markTextDirection for a string of already-sanitized html (a <template> parse
// is inert: nothing loads or runs). Without a DOM it hands the string back.
// `markers: false` also drops the data-dir-auto tags, for html that leaves the
// app (the .html export, the print document): the dir attributes stay.
// `settle: false` is markTextDirection's, for an editable DOM.
export function directedHtml(html, { markers = true, settle = true } = {}) {
  if (!html || typeof document === 'undefined') return html;
  const t = document.createElement('template');
  t.innerHTML = html;
  markTextDirection(t.content, { settle });
  if (!markers) for (const el of t.content.querySelectorAll('[data-dir-auto]')) el.removeAttribute('data-dir-auto');
  return t.innerHTML;
}

// The same html as the DOM `root` holds it, minus the dir this file added, for
// the places an editable DOM is read back into stored html. Only an element
// carrying data-dir-auto loses its dir (and the marker): a dir the author
// stored, such as <p dir="rtl"> written through the API, survives. The sanitizer
// drops data-* attributes, so the marker never reaches stored html.
export function htmlWithoutDirection(root) {
  if (!root) return '';
  if (!root.querySelector('[data-dir-auto]')) return root.innerHTML;
  const copy = root.cloneNode(true);
  for (const el of copy.querySelectorAll('[data-dir-auto]')) {
    el.removeAttribute('dir');
    el.removeAttribute('data-dir-auto');
  }
  return copy.innerHTML;
}
