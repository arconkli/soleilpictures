// Pure helpers for the owner's "Share file" dialog
// (components/fileShare/FileShareDialog.jsx). No React, no network, so
// node --test can pin them.
import { FILE_SHARE_PEOPLE_PER_CALL } from './fileShares.js';

// The same shape add_file_share_people accepts (0421). Anything else the
// server would skip, so the dialog marks it before sending.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isEmailLike(s) {
  return EMAIL_RE.test(String(s || ''));
}

// Every distinct token in what was typed or pasted, in order, with whether it
// looks like an address. Comma, semicolon and any whitespace separate;
// lower-cased; "<a@x.com>" loses its brackets.
function tokens(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/[,;\s]+/)) {
    const t = raw.trim().replace(/^<|>$/g, '').toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push({ email: t, invalid: !isEmailLike(t) });
  }
  return out;
}

// "a@x.com, b@y.com c" → { emails: ['a@x.com','b@y.com'], invalid: ['c'] }.
export function parseEmails(text) {
  const all = tokens(text);
  return {
    emails: all.filter((t) => !t.invalid).map((t) => t.email),
    invalid: all.filter((t) => t.invalid).map((t) => t.email),
  };
}

// Adds whatever was typed or pasted to the chips already there. A chip is
// { email, invalid }. At most `max` chips; what doesn't fit is counted in
// `overflow` so the dialog can say so.
export function mergeChips(chips, text, max = FILE_SHARE_PEOPLE_PER_CALL) {
  const out = Array.isArray(chips) ? chips.slice() : [];
  const have = new Set(out.map((c) => c.email));
  let overflow = 0;
  for (const t of tokens(text)) {
    if (have.has(t.email)) continue;
    if (out.length >= max) { overflow += 1; continue; }
    out.push(t);
    have.add(t.email);
  }
  return { chips: out, overflow };
}

// The settings row the dialog renders, whatever the RPC handed back.
export function normalizeSettings(data) {
  const d = data && typeof data === 'object' ? data : {};
  const link = ['view', 'comment'].includes(d.link_access) ? d.link_access : 'none';
  return {
    exists: !!d.exists,
    token: d.token || null,
    linkAccess: link,
    allowDownload: d.allow_download == null ? true : !!d.allow_download,
    people: (Array.isArray(d.people) ? d.people : [])
      .filter((p) => p && p.email)
      .map((p) => ({
        email: String(p.email),
        role: p.role === 'view' ? 'view' : 'comment',
        pending: !!p.pending,
        name: p.name || null,
        avatarUrl: p.avatar_url || null,
      })),
    commentCount: Number.isFinite(Number(d.comment_count)) ? Number(d.comment_count) : 0,
  };
}

// "Shared with 2 · 1 skipped". `skipped` counts the server's skips plus the
// chips the dialog never sent because they weren't addresses.
export function sharedMessage(addedCount, skippedCount) {
  const a = Math.max(0, Number(addedCount) || 0);
  const s = Math.max(0, Number(skippedCount) || 0);
  const tail = s ? ` · ${s} skipped` : '';
  if (!a) return `Nobody was added${tail}`;
  return `Shared with ${a}${tail}`;
}

export function commentsLabel(n) {
  const c = Math.max(0, Number(n) || 0);
  return `${c} comment${c === 1 ? '' : 's'}`;
}

export function fileDisplayName(card) {
  const c = card || {};
  const pick = [c.title, c.fileName, c.name].find((v) => typeof v === 'string' && v.trim());
  return pick ? pick.trim() : 'File';
}
