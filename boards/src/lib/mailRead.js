// An email read as one letter, whether it is an .eml (postal-mime) or an
// Outlook .msg (msgRead.js): subject, people, date, plain and HTML bodies,
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
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function readMail(bytes, ext) {
  let m;
  if (ext === 'msg') {
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

// The card's first paragraphs: blank-line separated, quoted lines dropped,
// whitespace collapsed.
export function letterParagraphs(text, max) {
  const out = [];
  for (const block of String(text || '').split(/\r?\n[ \t]*\r?\n/)) {
    const p = block.split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join(' ').replace(/\s+/g, ' ').trim();
    if (p) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
