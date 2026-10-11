// Paste scrubbing for the Tiptap note + doc editors.
//
// Text pasted from Google Docs, Word or a web page carries an inline style on
// nearly every span — Google Docs writes `font-size:11pt; font-family:Arial;
// color:#000000; background-color:transparent` on all of it. Both editor
// schemas include TextStyle + FontFamily + FontSize + Color, so every one of
// those became a stored mark: the pasted run showed up in 11pt Arial black
// next to 16px Georgia, overrode the note's own font and size, and — because
// TextStyle marks carry on to new typing — spread into everything typed after
// it. That was "text doesn't stay consistently formatted".
//
// Policy: keep the structure (headings, lists, links, tables, images) and the
// EMPHASIS (bold / italic / underline / strike / sub / sup / alignment); drop
// the TYPOGRAPHY (font family, size, line height, spacing, backgrounds); keep a
// color only when it is a real, chromatic colour — black, white and greys are
// just the source page's default ink and would fight this app's themes.
//
// A paste that came from a ProseMirror editor (data-pm-slice — i.e. another
// Clusters note or doc) is left alone: fonts and sizes the user chose here
// should survive copy-and-paste between our own surfaces.

const KEEP_PROPS = new Set([
  'font-weight', 'font-style', 'text-decoration', 'text-decoration-line',
  'vertical-align', 'text-align',
]);

// Parse a CSS colour into [r, g, b] (0–255), or null if it isn't one we can
// read (which we then drop — the safe direction).
const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], grey: [128, 128, 128],
  red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], orange: [255, 165, 0],
  purple: [128, 0, 128], yellow: [255, 255, 0], teal: [0, 128, 128], pink: [255, 192, 203],
  brown: [165, 42, 42], navy: [0, 0, 128], maroon: [128, 0, 0], olive: [128, 128, 0],
  magenta: [255, 0, 255], fuchsia: [255, 0, 255], cyan: [0, 255, 255], aqua: [0, 255, 255],
  lime: [0, 255, 0], silver: [192, 192, 192],
};
export function parseColor(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (NAMED[v]) return NAMED[v];
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    if (h.length === 8 && parseInt(h.slice(6, 8), 16) === 0) return null; // fully transparent
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] != null) {
      const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a === 0) return null;
    }
    return [m[1], m[2], m[3]].map(n => Math.max(0, Math.min(255, Math.round(parseFloat(n)))));
  }
  return null;
}

// A colour worth keeping: visibly hued, not a black/white/grey default ink.
export function isChromatic(raw) {
  const c = parseColor(raw);
  if (!c) return false;
  return Math.max(...c) - Math.min(...c) > 24;
}

// Reduce one inline style attribute to the properties we keep. Returns '' when
// nothing survives (the caller then drops the attribute).
export function cleanPastedStyle(style) {
  if (!style) return '';
  const out = [];
  for (const decl of String(style).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!prop || !val) continue;
    if (KEEP_PROPS.has(prop)) out.push(`${prop}: ${val}`);
    else if (prop === 'color' && isChromatic(val)) out.push(`color: ${val}`);
  }
  return out.join('; ');
}

// True for HTML copied out of a ProseMirror editor (ours).
export function isInternalPaste(html) {
  return /data-pm-slice/.test(String(html || ''));
}

// Browser-side: scrub a pasted HTML string. Used as Tiptap's
// editorProps.transformPastedHTML.
export function scrubPastedHtml(html) {
  if (!html || isInternalPaste(html) || typeof DOMParser === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style, meta, link, script').forEach(el => el.remove());
    doc.body.querySelectorAll('[style]').forEach(el => {
      const next = cleanPastedStyle(el.getAttribute('style'));
      if (next) el.setAttribute('style', next);
      else el.removeAttribute('style');
    });
    // <font face/size/color> from older Word / mail clients.
    doc.body.querySelectorAll('font').forEach(el => {
      el.removeAttribute('face');
      el.removeAttribute('size');
      const c = el.getAttribute('color');
      if (c && !isChromatic(c)) el.removeAttribute('color');
    });
    // Background highlights from the source page (<mark style=background…>
    // already lost its style above; a bare data-color is ours to keep only
    // when it came from us, which internal pastes skip this path for).
    doc.body.querySelectorAll('mark[data-color]').forEach(el => el.removeAttribute('data-color'));
    return doc.body.innerHTML;
  } catch (_) {
    return html;
  }
}
