// Sharing one file on its own (/f/<token>). The limits below are enforced by
// supabase/migrations/0421_file_shares.sql; fileShareMigration.test.mjs fails
// the build when the SQL and these numbers disagree.
export const FILE_COMMENT_MAX_CHARS = 2000;
export const FILE_COMMENT_BURST = 20;          // per author …
export const FILE_COMMENT_BURST_MINUTES = 10;  // … in this many minutes
export const FILE_COMMENT_DAILY = 300;         // per author per day
export const FILE_SHARE_PEOPLE_PER_CALL = 20;
export const SHAREABLE_KINDS = Object.freeze(['image', 'video', 'audio', 'pdf', 'file']);
export const RISKY_EXTENSIONS = Object.freeze(['exe','msi','msp','mst','com','scr','pif','cpl','bat','cmd','ps1','psm1','vbs','vbe','js','jse','wsf','wsh','hta','jar','app','dmg','pkg','command','sh','apk','ipa','appx','msix','dll','lnk','reg','iso','html','htm','xhtml','shtml','svg','xml','docm','xlsm','pptm','xll']);
export const RISKY_MIMES = Object.freeze(['text/html','application/xhtml+xml','image/svg+xml','application/x-msdownload','application/x-msdos-program','application/java-archive','application/vnd.android.package-archive','application/x-sh','application/javascript','text/javascript']);

// ---------------------------------------------------------------------------
// Client library. The pure helpers come first (node --test imports this file,
// and supabase.js reads import.meta.env, so the client loads lazily below).
import { PARTY_ORIGIN } from './partyHost.js';

// Which card field holds the file: a PDF's original is pdfSrc (src is its
// page-1 image), a generic file is fileSrc, everything else is src.
export function fileRefOf(card) {
  if (!card) return '';
  const v = card.kind === 'pdf' ? card.pdfSrc : card.kind === 'file' ? card.fileSrc : card.src;
  return typeof v === 'string' ? v : '';
}

export function isShareableCard(card) {
  if (!card || card.pending) return false;
  if (!SHAREABLE_KINDS.includes(card.kind)) return false;
  return fileRefOf(card).startsWith('r2:');
}

// The same rule as SQL _file_risky: the extension, or the mime type.
export function isRiskyFile(name, mime) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  if (m && RISKY_EXTENSIONS.includes(m[1].toLowerCase())) return true;
  return RISKY_MIMES.includes(String(mime || '').toLowerCase());
}

export function fileShareUrl(token, origin = (typeof window !== 'undefined' ? window.location.origin : '')) {
  return `${origin}/f/${token}`;
}

export function formatAt(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Top-level comments carry their replies. Ordered by timecode when any has
// one (untimed last), else by page, else as written; replies as written.
export function groupComments(list) {
  const all = Array.isArray(list) ? list : [];
  const byCreated = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const replies = new Map();
  const tops = [];
  for (const c of all) {
    if (c.reply_to) {
      if (!replies.has(c.reply_to)) replies.set(c.reply_to, []);
      replies.get(c.reply_to).push(c);
    } else {
      tops.push(c);
    }
  }
  const has = (k) => tops.some((c) => c[k] != null);
  const key = has('at_ms') ? 'at_ms' : has('page') ? 'page' : null;
  const cmp = (a, b) => {
    if (key) {
      const av = a[key] ?? Infinity;
      const bv = b[key] ?? Infinity;
      if (av !== bv) return av < bv ? -1 : 1;
    }
    return byCreated(a, b);
  };
  const out = { open: [], resolved: [] };
  for (const c of [...tops].sort(cmp)) {
    const row = { ...c, replies: (replies.get(c.id) || []).slice().sort(byCreated) };
    (c.resolved ? out.resolved : out.open).push(row);
  }
  return out;
}

export function friendlyShareError(error) {
  const hint = error?.hint || '';
  const code = error?.code || '';
  switch (hint) {
    case 'invite_limit_reached': return "You've reached today's invite limit. Try again tomorrow.";
    case 'sending_on_hold': return 'Sharing is paused on your account.';
    case 'comment_rate_limited': return 'Slow down a little: try again in a few minutes.';
    case 'new_account_risky': return "New accounts can't open program files to anyone with the link yet.";
    case 'not_shareable': return "This file can't be shared.";
    default: break;
  }
  if (code === '42501') return "You can't do that on this file.";
  return 'Something went wrong. Try again.';
}

// ---------------------------------------------------------------------------
// API. Every rpc resolves { data, error } (never .catch() a builder).
async function client() {
  return (await import('./supabase.js')).supabase;
}

async function accessToken(sb) {
  try {
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token || '';
  } catch (_) { return ''; }
}

// The recipient page's one read: the party presigns the file for this viewer.
export async function fetchFileShare(token) {
  const sb = await client();
  const url = `${PARTY_ORIGIN}/parties/upload/share/file-share`;
  const post = async () => {
    const bearer = sb ? await accessToken(sb) : '';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ token }),
    });
    if (res.status >= 500) return { status: 'error' };
    return res.json();
  };
  try {
    let out = await post();
    if (out?.status === 'auth_expired' && sb) {
      try { await sb.auth.refreshSession(); } catch (_) { /* retry anyway */ }
      out = await post();
    }
    return out && typeof out === 'object' ? out : { status: 'error' };
  } catch (_) {
    return { status: 'error' };
  }
}

async function rpc(name, args) {
  const sb = await client();
  if (!sb) return { data: null, error: { message: 'offline' } };
  const { data, error } = await sb.rpc(name, args);
  return { data, error };
}

export const listFileComments = (token) => rpc('get_file_comments', { p_token: token });

export const addFileComment = (token, { body, atMs = null, page = null, replyTo = null } = {}) =>
  rpc('add_file_comment', { p_token: token, p_body: body, p_at_ms: atMs, p_page: page, p_reply_to: replyTo });

export const resolveFileComment = (id, resolved) => rpc('resolve_file_comment', { p_id: id, p_resolved: !!resolved });
export const deleteFileComment = (id) => rpc('delete_file_comment', { p_id: id });
export const restoreFileComment = (id) => rpc('restore_file_comment', { p_id: id });

export const getFileShareSettings = (boardId, cardId) =>
  rpc('get_file_share_settings', { p_board: boardId, p_card: cardId });

export const setFileShare = (boardId, cardId, { linkAccess, allowDownload = null } = {}) =>
  rpc('set_file_share', { p_board: boardId, p_card: cardId, p_link_access: linkAccess, p_allow_download: allowDownload });

export const addFileSharePeople = (boardId, cardId, emails, role) =>
  rpc('add_file_share_people', { p_board: boardId, p_card: cardId, p_emails: emails, p_role: role });

// role null removes the person.
export const setFileSharePerson = (boardId, cardId, email, role) =>
  rpc('set_file_share_person', { p_board: boardId, p_card: cardId, p_email: email, p_role: role ?? null });
