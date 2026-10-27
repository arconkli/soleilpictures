// An email read as one letter, whether it is MIME (postal-mime) or an
// Outlook message (msgRead.js), told apart by its first bytes rather than
// its name (some apps save MIME as .msg): subject, people, date, plain and HTML bodies,
// its attachments, and the pictures its HTML shows from inside the message
// set apart from them. postal-mime 4.0.5: `PostalMime.parse` takes a
// Uint8Array; `date` is ISO or, when it can't be parsed, the original string
// (so it is re-parsed here); an attachment's `content` is an ArrayBuffer by
// default (a Uint8Array for calendar parts), both handled; `from` may be a
// group with no address, which reads as no address.
import PostalMime from 'postal-mime';
import { readMsg } from './msgRead.js';

const person = (p) => (p ? { name: p.name || '', address: p.address || '' } : null);
const people = (list) => (Array.isArray(list) ? list.map(person).filter((p) => p.name || p.address) : []);
const isoOrNull = (d) => {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
};
const cidKey = (id) => String(id || '').replace(/^<|>$/g, '').trim().toLowerCase();

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const entity = (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  }
  return ENTITIES[e.toLowerCase()] ?? m;
};
// An HTML-only letter's text, for its card: what a <blockquote> holds is
// quoted, as a plain-text reply's ">" lines are, so the card leaves it out.
function htmlToText(html) {
  let depth = 0;
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<blockquote\b[^>]*>/gi, '\n\n\u0001\n')
    .replace(/<\/blockquote\s*>/gi, '\n\u0002\n\n')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((l) => {
      if (l === '\u0001') { depth += 1; return ''; }
      if (l === '\u0002') { depth = Math.max(0, depth - 1); return ''; }
      return depth && l.trim() ? `${'>'.repeat(depth)} ${l}` : l;
    })
    .join('\n')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, entity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// An Outlook message is a compound file, whatever it's called.
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
export const isCfb = (bytes) => bytes.length >= 8 && CFB.every((b, i) => bytes[i] === b);

export async function readMail(bytes) {
  let m;
  if (isCfb(bytes)) {
    m = readMsg(bytes);
  } else {
    const p = await PostalMime.parse(bytes);
    m = {
      subject: p.subject || '', from: person(p.from), to: people(p.to), cc: people(p.cc), date: p.date,
      text: p.text || '', html: p.html || '',
      attachments: (p.attachments || []).map((a) => ({
        filename: a.filename || '', mimeType: a.mimeType || '', contentId: a.contentId || '',
        content: a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content || 0),
      })),
    };
  }
  // A picture the HTML names as cid:<id> is part of the letter, not an attachment.
  const html = m.html || '';
  const wanted = new Set([...html.matchAll(/cid:([^"'\s>)]+)/gi)].map((x) => cidKey(safeDecode(x[1]))));
  const inline = new Map();
  const attachments = [];
  for (const a of m.attachments) {
    const key = cidKey(a.contentId);
    if (key && wanted.has(key)) inline.set(key, { mimeType: a.mimeType, content: a.content });
    else attachments.push({ ...a, size: a.content.byteLength });
  }
  return {
    subject: m.subject || '', from: m.from || null, to: m.to || [], cc: m.cc || [], date: isoOrNull(m.date),
    text: m.text || htmlToText(html), html, attachments, inline,
  };
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// The picture a cid: URL in the HTML names, from inside the message, or null.
export function inlinePart(letter, src) {
  const m = /^\s*cid:(.+)$/i.exec(String(src || ''));
  return (m && letter.inline.get(cidKey(safeDecode(m[1])))) || null;
}

// A picture's type, by what it says or, when it says nothing useful (an
// Outlook message often doesn't), by its first bytes; null if it isn't one.
const SNIFF = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  ['image/bmp', [0x42, 0x4d]],
];
export function pictureType(part) {
  if (/^image\/[\w.+-]+$/i.test(part.mimeType || '')) return part.mimeType.toLowerCase();
  const b = part.content;
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  const hit = SNIFF.find(([, sig]) => b.length > sig.length && sig.every((x, i) => b[i] === x));
  return hit ? hit[0] : null;
}

// An attachment's name to save it under, which has to carry its extension:
// its own, or "Attachment 2.pdf" by its type when it came without one.
const EXT_OF = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'text/plain': 'txt', 'text/html': 'html', 'text/csv': 'csv', 'text/calendar': 'ics', 'message/rfc822': 'eml', 'application/zip': 'zip',
};
export function attachmentName(a, i) {
  if (a.filename) return a.filename;
  const ext = EXT_OF[String(a.mimeType || '').toLowerCase()];
  return `Attachment ${i + 1}${ext ? `.${ext}` : ''}`;
}

// Plain text as the letter's own paragraphs (line breaks kept) and what it
// quotes: a run of ">" lines is one quote, blank quoted lines breaking its
// paragraphs, and the "On … wrote:" line that brings it in goes with it.
export function letterBlocks(text) {
  const out = [];
  let para = [];
  let quote = null;
  const endPara = () => {
    const t = para.join('\n').trim();
    if (t) out.push({ quote: false, text: t });
    para = [];
  };
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^\s*>/.test(line)) {
      if (!quote) {
        const last = out[out.length - 1];
        let lead = null;
        if (para.length && para[para.length - 1].trim().endsWith(':')) lead = para.pop().trim();
        else if (!para.length && last && !last.quote && last.text.endsWith(':') && !last.text.includes('\n')) lead = out.pop().text;
        endPara();
        quote = { quote: true, paras: lead ? [lead, ''] : [''] };
        out.push(quote);
      }
      const t = line.replace(/^\s*>\s?/, '');
      const at = quote.paras.length - 1;
      if (!t.trim()) { if (quote.paras[at]) quote.paras.push(''); } else quote.paras[at] += (quote.paras[at] ? '\n' : '') + t;
    } else if (!line.trim()) {
      if (quote) { if (quote.paras[quote.paras.length - 1]) quote.paras.push(''); } else endPara();
    } else {
      quote = null;
      para.push(line);
    }
  }
  endPara();
  for (const b of out) if (b.quote) b.paras = b.paras.filter((x) => x.trim());
  return out.filter((b) => !b.quote || b.paras.length);
}

// The card's first paragraphs: blank-line separated, whitespace collapsed,
// up to the letter's own end: what it quotes (">" lines, and the "On …
// wrote:" line that brings them in), a signature after "-- ", and the
// message an Outlook reply carries under its rule are not the letter.
const ENDS = /^(-- ?|-{2,} ?Original Message ?-{2,}|_{10,})$/i;
export function letterParagraphs(text, max) {
  const out = [];
  for (const block of String(text || '').split(/\r?\n[ \t]*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const end = lines.findIndex((l) => ENDS.test(l.trim()));
    const own = (end < 0 ? lines : lines.slice(0, end)).filter((l) => !/^\s*>/.test(l));
    const quotes = own.length < (end < 0 ? lines : lines.slice(0, end)).length;
    let p = own.join(' ').replace(/\s+/g, ' ').trim();
    if (quotes && p.endsWith(':')) p = '';
    if (quotes && !p && out.length && out[out.length - 1].endsWith(':')) out.pop();
    if (p) out.push(p);
    if (end >= 0 || out.length >= max) break;
  }
  return out.slice(0, max);
}

// What a card shows of a letter: no attachment's bytes, only its name, type
// and size, and no attachments at all from a message read in part (they come
// after its text, so how many there are isn't known). Not a letter (nothing
// says who it's from or to, when, or what about): null.
export function letterCard(m, { complete = true, paragraphs = 6 } = {}) {
  if (!m.subject && !m.from && !m.date && !m.to.length) return null;
  return {
    subject: m.subject, from: m.from, to: m.to, date: m.date,
    paragraphs: letterParagraphs(m.text, paragraphs),
    attachments: complete ? m.attachments.map((a, i) => ({ filename: attachmentName(a, i), mimeType: a.mimeType, size: a.size })) : null,
  };
}
