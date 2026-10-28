// Plain-text {title, body} -> note HTML the app's note editor schema accepts.
//
// The canvas draws a note from its `html` alone, so an AI that creates a note
// with a plain `title` and `body` (REST API / MCP) would get an invisible title
// and lists shown as raw text. composeNoteHtml writes the title as an <h2> and
// reads a small, forgiving markdown subset in the body. The output uses ONLY
// the schema's tags (h2 h3 p ul ol li strong em a, and the checklist's
// span/div; see components/noteExtensions/noteExtensions.js and
// NoteChecklist.js), with attributes href / start / class / role /
// aria-checked. Everything the caller writes is escaped first, so nothing it
// says can open any other tag or attribute.
//
// Pure, and no imports: the Cloudflare Worker uses it, so it stays tiny.

export const NOTE_HTML_MAX = 40000;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

// --- inline markdown (on already-escaped text) -------------------------------

const LINK_RE = /\[([^\[\]]+)\]\(([^()\s]+)\)/g;
const SAFE_URL = /^(?:https?:\/\/|mailto:)./i;

function emphasis(s) {
  return s
    // Bold. Not next to a `*` inside, so `***x***` reads as bold-in-italic.
    .replace(/\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![A-Za-z0-9_])__(?=[^\s_])(.+?)(?<=[^\s_])__(?![A-Za-z0-9_])/g, '<strong>$1</strong>')
    // Italic. May hold whole <strong>…</strong> groups, never half of one.
    .replace(/\*(?=[^\s*])((?:[^*<]|<strong>[^<]*<\/strong>)+?)(?<=[^\s*])\*/g, '<em>$1</em>')
    .replace(
      /(?<![A-Za-z0-9_])_(?=[^\s_])((?:[^_<]|<strong>[^<]*<\/strong>)+?)(?<=[^\s_])_(?![A-Za-z0-9_])/g,
      '<em>$1</em>',
    );
}

function inline(escaped) {
  // Links are lifted out first (atomic placeholders) so emphasis can't reach
  // into a URL and tags stay properly nested.
  const links = [];
  const lifted = escaped.replace(LINK_RE, (whole, label, url) => {
    if (!SAFE_URL.test(url) || url.includes('&quot;') || url.includes('&#39;')) return whole;
    links.push({ label, url });
    return `\u0001${links.length - 1}\u0002`;
  });
  return emphasis(lifted).replace(/\u0001(\d+)\u0002/g, (_, i) => {
    const { label, url } = links[Number(i)];
    return `<a href="${url}">${emphasis(label)}</a>`;
  });
}

// --- line classification -----------------------------------------------------

const RULE_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const HEADING_RE = /^#{1,3}\s+(.+)/;
const CK_RE_A = /^\s*(?:[-*•]\s+)?\[( |x|X)\]\s+(.*)/;
const CK_RE_B = /^\s*([☐☑✓✔])\s+(.*)/;
const BULLET_RE = /^\s*[-*•]\s+(.*)/;
const ORDERED_RE = /^\s*(\d{1,3})[.)]\s+(.*)/;

function classify(line) {
  if (!line.trim() || RULE_RE.test(line)) return { kind: 'blank' };
  let m = HEADING_RE.exec(line);
  if (m) return { kind: 'heading', tag: /^#\s/.test(line) ? 'h2' : 'h3', text: m[1] };
  m = CK_RE_A.exec(line);
  if (m) return { kind: 'ck', checked: m[1] !== ' ', text: m[2] };
  m = CK_RE_B.exec(line);
  if (m) return { kind: 'ck', checked: m[1] !== '☐', text: m[2] };
  m = BULLET_RE.exec(line);
  if (m) return { kind: 'ul', text: m[1] };
  m = ORDERED_RE.exec(line);
  if (m) return { kind: 'ol', num: Number(m[1]), text: m[2] };
  return { kind: 'p', text: line.trim() };
}

const ckItem = (text, checked) =>
  `<li class="ck"><span class="${checked ? 'ck-box is-checked' : 'ck-box'}" role="checkbox" aria-checked="${checked ? 'true' : 'false'}"></span><div class="ck-text"><p>${text}</p></div></li>`;
const plainItem = (text) => `<li><p>${text}</p></li>`;

// --- compose -----------------------------------------------------------------

// A block is { open, items, close }. A plain block carries its whole markup in
// `open`; a list carries its items separately so the length cap can cut a list
// short and still close it.
export function composeNoteHtml({ title, body } = {}, { maxLen = NOTE_HTML_MAX } = {}) {
  const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') : '');
  const t = clean(title).trim();
  const raw = clean(body).replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
  const lines = raw.split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (t && lines.length && lines[0].replace(/^[#\s]+/, '').trim().toLowerCase() === t.toLowerCase()) {
    lines.shift();
  }

  const blocks = [];
  if (t) blocks.push({ open: `<h2>${escapeHtml(t)}</h2>`, items: null, close: '', heading: true });

  let list = null; // { kind, block }
  let pendingBlank = false;
  const last = () => blocks[blocks.length - 1];
  const flushBlank = (nextIsList) => {
    const prev = last();
    if (pendingBlank && prev && !prev.heading && !prev.items && !nextIsList) {
      blocks.push({ open: '<p></p>', items: null, close: '' });
    }
    pendingBlank = false;
  };

  for (const line of lines) {
    const c = classify(line);
    if (c.kind === 'blank') {
      pendingBlank = true;
      continue;
    }
    if (c.kind === 'ul' || c.kind === 'ol' || c.kind === 'ck') {
      // A single blank between items of the same kind keeps the list going.
      if (!(list && list.kind === c.kind)) {
        pendingBlank = false;
        const open = c.kind === 'ck' ? '<ul class="note-checklist">'
          : c.kind === 'ul' ? '<ul>'
          : c.num !== 1 ? `<ol start="${c.num}">` : '<ol>';
        const block = { open, items: [], close: c.kind === 'ol' ? '</ol>' : '</ul>' };
        blocks.push(block);
        list = { kind: c.kind, block };
      }
      pendingBlank = false;
      const text = inline(escapeHtml(c.text.trim()));
      list.block.items.push(c.kind === 'ck' ? ckItem(text, c.checked) : plainItem(text));
      continue;
    }
    list = null;
    flushBlank(false);
    if (c.kind === 'heading') {
      const text = inline(escapeHtml(c.text.trim()));
      blocks.push({ open: `<${c.tag}>${text}</${c.tag}>`, items: null, close: '', heading: true });
    } else {
      blocks.push({ open: `<p>${inline(escapeHtml(c.text))}</p>`, items: null, close: '' });
    }
  }

  const cap = Number.isFinite(maxLen) ? maxLen : NOTE_HTML_MAX;
  let out = '';
  for (const b of blocks) {
    if (!b.items) {
      if (out.length + b.open.length > cap) break;
      out += b.open;
      continue;
    }
    let body = '';
    let cut = false;
    for (const it of b.items) {
      if (out.length + b.open.length + body.length + it.length + b.close.length > cap) { cut = true; break; }
      body += it;
    }
    if (!body) break;
    out += b.open + body + b.close;
    if (cut) break;
  }
  return out;
}

// --- reading a lead heading back ----------------------------------------------

const LEAD_RE = /^\s*<h([123])(?:\s[^>]*)?>([\s\S]*?)<\/h\1\s*>/i;
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&', '&nbsp;': ' ' };

export function noteHtmlLead(html) {
  if (typeof html !== 'string') return { title: null, rest: '' };
  const m = LEAD_RE.exec(html);
  if (!m) return { title: null, rest: html };
  const title = m[2]
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:lt|gt|quot|#39|amp|nbsp);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
  return { title, rest: html.slice(m[0].length) };
}
