// Send to…: the words, the shapes and the server calls behind the sheet
// (components/SendSheet.jsx). The pure functions here are pinned by
// sendTo.test.mjs; the three server calls load the Supabase client on use, so
// node can import this file without a browser build around it.
//
// What goes in a message is a small snapshot of the card (or cluster) taken at
// send time, so the chat can draw its preview without opening the cluster:
// storage keys only (never a web address, so reading a chat makes no outside
// request), text cut short, no more than a few lines of anything.
import { t, plural } from '@lingui/core/macro';
import { namesList } from './intlFormat.js';
import { hiddenFromInbox, isDmConversation } from './conversationState.js';
import { storageKey } from './messageThing.js';
import { pickPresenceColor } from './presenceColor.js';
import { buildCardMeta, cardIndexTitle, htmlToText } from './cardIndexRow.js';

const db = async () => (await import('./supabase.js')).supabase;

export const RECENT_MAX = 6;
// Snapshots on a many-card message: the first few only.
export const SNAP_CARDS_MAX = 3;
const NOTE_TEXT_MAX = 600;
const HEADING_MAX = 120;

// ── Server calls ─────────────────────────────────────────────────────

// Who among the picked can't open the cluster yet, and whether the sender may
// let them in. null on any failure: the sheet then shows no claim at all.
export async function sendToStatus({ boardId, userIds = [], conversationIds = [] }) {
  try {
    const supabase = await db();
    const { data, error } = await supabase.rpc('send_to_status', {
      p_board_id: boardId, p_user_ids: userIds, p_conversation_ids: conversationIds,
    });
    if (error || !data || typeof data !== 'object') return null;
    return { canGrant: !!data.can_grant, closed: new Set(Array.isArray(data.closed) ? data.closed : []) };
  } catch (_) {
    return null;
  }
}

// Gives access where it is needed and finds or makes the conversations; the
// answer names who got in, who was invited and who was turned away. Throws the
// server's error, .code kept (42501, 22023).
export async function sendBoardTo({ boardId, workspaceId, userIds = [], emails = [], conversationIds = [] }) {
  const supabase = await db();
  const { data, error } = await supabase.rpc('send_board_to', {
    p_board_id: boardId, p_workspace_id: workspaceId,
    p_user_ids: userIds, p_emails: emails, p_conversation_ids: conversationIds,
  });
  if (error) throw error;
  return data || {};
}

// ── Snapshots ────────────────────────────────────────────────────────

export { storageKey };

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] == null || o[k] === '') delete o[k]; return o; };

// A web address worth keeping on a link card: http(s) only. Returns { url, host }.
function linkParts(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return {};
    return { url: u.href.slice(0, 500), host: u.hostname.replace(/^www\./, '') };
  } catch (_) {
    return {};
  }
}

// The plain words of a note: its body, else its caption, else its html, as the
// card index reads them (cardIndexBody), cut at 600.
function noteText(get) {
  const raw = get('body') || get('caption') || htmlToText(get('html') || '');
  return htmlToText(String(raw)).slice(0, NOTE_TEXT_MAX);
}

// The snapshot of one card: { v:1, k:<kind>, cover?, …per kind }.
export function cardSnap(card, { cover = null } = {}) {
  const get = (k) => (card ? card[k] : undefined);
  const kind = get('kind') || 'note';
  const snap = { v: 1, k: kind };
  const meta = buildCardMeta(kind, get) || {};
  switch (kind) {
    case 'image':
      Object.assign(snap, clean({ key: storageKey(meta.src), w: num(meta.w), h: num(meta.h) }));
      break;
    case 'video':
      Object.assign(snap, clean({ key: storageKey(meta.poster), duration: num(meta.duration) }));
      break;
    case 'pdf':
      Object.assign(snap, clean({ key: storageKey(meta.src), name: meta.name ? String(meta.name).slice(0, 200) : null, pages: num(meta.pageCount) }));
      break;
    case 'note':
    case 'text':
      Object.assign(snap, clean({
        heading: get('title') ? String(get('title')).slice(0, HEADING_MAX) : null,
        text: noteText(get),
      }));
      break;
    case 'palette': {
      const swatches = (meta.swatches || [])
        .map((s) => (typeof s === 'string' ? s : s?.hex))
        .filter((s) => typeof s === 'string' && /^#[0-9a-f]{3,8}$/i.test(s))
        .slice(0, 12);
      if (swatches.length) snap.swatches = swatches;
      break;
    }
    case 'link':
      Object.assign(snap, clean({ ...linkParts(meta.url), key: storageKey(get('image')) }));
      break;
    case 'doc':
      Object.assign(snap, clean({ pages: num(meta.pageCount), lines: num(meta.lineCount) }));
      break;
    case 'file':
      Object.assign(snap, clean({
        name: meta.fileName ? String(meta.fileName).slice(0, 200) : null,
        mime: meta.mime ? String(meta.mime).slice(0, 100) : null,
        size: num(meta.sizeBytes),
      }));
      break;
    case 'audio':
      Object.assign(snap, clean({
        name: (get('fileName') || get('title') || get('name')) ? String(get('fileName') || get('title') || get('name')).slice(0, 200) : null,
        duration: num(meta.duration),
      }));
      break;
    default:
      break;
  }
  const c = storageKey(cover);
  if (c) snap.cover = c;
  return snap;
}

// One attachment per card, in pick order; the first three carry a snapshot.
export function cardAttachments({ boardId, boardTitle = '', cards = [], cover = null }) {
  return (cards || []).filter((c) => c && c.id).map((card, i) => {
    const get = (k) => card[k];
    const kind = card.kind || 'note';
    let title = cardIndexTitle(get, kind);
    if (!title && (kind === 'note' || kind === 'text')) title = noteText(get).split('\n')[0].slice(0, 80);
    return {
      kind: 'card', boardId, cardId: card.id, title, boardTitle,
      ...(i < SNAP_CARDS_MAX ? { snap: cardSnap(card, { cover }) } : {}),
    };
  });
}

// The snapshot of a whole cluster: up to four of its newest pictures, its card
// count and its cover, read as the sender (normal RLS). Never throws.
export async function clusterSnap({ boardId, workspaceName = '' }) {
  const fallback = { v: 1, k: 'cluster', keys: [], count: null, ws: workspaceName || '' };
  try {
    const supabase = await db();
    const [pics, board] = await Promise.all([
      supabase.from('card_index').select('meta')
        .eq('board_id', boardId).eq('kind', 'image')
        .order('updated_at', { ascending: false }).limit(12),
      supabase.from('boards').select('card_count, thumb_key').eq('id', boardId).maybeSingle(),
    ]);
    const keys = [];
    for (const row of pics?.data || []) {
      const k = storageKey(row?.meta?.src);
      if (k && !keys.includes(k)) keys.push(k);
      if (keys.length === 4) break;
    }
    const count = Number.isFinite(board?.data?.card_count) ? board.data.card_count : null;
    const cover = storageKey(board?.data?.thumb_key);
    return { ...fallback, keys, count, ...(cover ? { cover } : {}) };
  } catch (_) {
    return fallback;
  }
}

export function clusterAttachment({ boardId, title = '', snap }) {
  return { kind: 'board', id: boardId, boardId, title, snap };
}

// ── Who can be picked ────────────────────────────────────────────────

// Recent: my newest conversations (people and groups) that the inbox still
// shows. People: everyone I can message who is not already a DM up there.
//   conversations  conversation_summary rows        participants  my visible participant rows
//   people         list_messageable_users rows       me            my user id
//   hidden         optional Set of conversation ids to leave out as well
//   profileOf      optional (userId) → { name, email, color }, e.g. the app's name cache
export function recipientsFrom({ conversations = [], participants = [], people = [], me, hidden = null, profileOf = null }) {
  const byConv = new Map();
  for (const p of participants || []) {
    if (!byConv.has(p.conversation_id)) byConv.set(p.conversation_id, []);
    byConv.get(p.conversation_id).push(p);
  }
  const person = new Map((people || []).map((u) => [u.user_id, u]));
  const look = (id) => {
    const u = person.get(id) || {};
    const p = (typeof profileOf === 'function' ? profileOf(id) : null) || {};
    return {
      name: u.name || p.name || u.email || p.email || t`Member`,
      email: u.email || p.email || '',
      color: u.color || p.color || pickPresenceColor(id || ''),
    };
  };
  const newest = (c) => Date.parse(c.last_message_at || c.created_at || '') || 0;
  const mine = [...(conversations || [])].sort((a, b) => newest(b) - newest(a));

  const recent = [];
  const dmPeers = new Set();
  for (const c of mine) {
    if (recent.length >= RECENT_MAX) break;
    const id = c.conversation_id;
    const rows = byConv.get(id) || [];
    const myRow = rows.find((r) => r.user_id === me);
    if (!myRow || myRow.left_at) continue;
    if (hidden?.has?.(id)) continue;
    if (hiddenFromInbox({ conv: c, me: myRow, participants: rows })) continue;
    const others = rows.filter((r) => r.user_id !== me && !r.left_at).map((r) => r.user_id);
    if (!others.length) continue;
    if (isDmConversation(rows)) {
      const peer = others[0];
      const l = look(peer);
      recent.push({ type: 'dm', conversationId: id, userId: peer, memberIds: others, name: c.title || l.name, email: l.email, color: l.color });
    } else {
      const names = others.map((u) => look(u).name);
      recent.push({
        type: 'group', conversationId: id, memberIds: others,
        name: c.title || names.join(', ') || t`New conversation`,
        color: pickPresenceColor(id || ''),
      });
    }
  }
  for (const r of recent) if (r.type === 'dm') dmPeers.add(r.userId);

  const rest = (people || [])
    .filter((u) => u && u.user_id && u.user_id !== me && !dmPeers.has(u.user_id))
    .map((u) => {
      const l = look(u.user_id);
      return { type: 'person', userId: u.user_id, name: l.name, email: l.email, color: l.color };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  return { recent, people: rest };
}

// Whether a typed text can be offered as an email row.
export function isEmailish(text) {
  const s = String(text || '').trim();
  return s.length <= 254 && /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/.test(s);
}

// Does a row match what was typed? Every word has to be in the name or email.
export function rowMatches(row, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${row.name || ''} ${row.email || ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// ── Words ────────────────────────────────────────────────────────────

// "Lena will be able to view Night shoot." under the Send button. null when
// there is nothing to say. closedNames are the picked people who can't open
// the cluster yet; emails are the typed addresses (counted among those let in
// only when the sender can let people in).
export function accessLine({ canGrant, closedNames = [], emails = [], boardTitle = '' }) {
  const who = canGrant ? [...closedNames, ...emails] : [...closedNames];
  if (!who.length) return null;
  const title = boardTitle || '';
  const n = who.length;
  if (canGrant) {
    if (n <= 3) {
      const list = namesList(who);
      return t`${list} will be able to view ${title}.`;
    }
    return plural(n, {
      one: `# person will be able to view ${title}.`,
      other: `# people will be able to view ${title}.`,
    });
  }
  if (n <= 3) {
    const list = namesList(who);
    return t`${list} won't be able to open it: only its editors can let people in.`;
  }
  return plural(n, {
    one: `# person won't be able to open it: only its editors can let people in.`,
    other: `# people won't be able to open it: only its editors can let people in.`,
  });
}

// What the server's answer to a send amounts to, for the toast and the event.
// closedBy and refusedEmailsBy keep the server's reason for each person left
// out; afterSendNotes turns them into words.
export function tallySend(result) {
  const people = Array.isArray(result?.people) ? result.people : [];
  const convs = Array.isArray(result?.conversations) ? result.conversations : [];
  const out = {
    granted: 0, invited: 0, closed: 0, refused: 0,
    closedUserIds: [], refusedUserIds: [], invitedEmails: [],
    closedBy: { limit: [], viewer: [], other: [] },
    refusedEmailsBy: { viewer: [], limit: [], bad_email: [], self: [], other: [] },
  };
  const seen = new Set();
  const close = (id, group) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.closedUserIds.push(id);
    out.closedBy[group].push(id);
  };
  for (const p of people) {
    if (p.access === 'granted') out.granted += 1;
    else if (p.access === 'invited') { out.invited += 1; if (p.email) out.invitedEmails.push(p.email); }
    else if (p.access === 'closed') {
      out.closed += 1;
      close(p.user_id, p.why === 'limit' ? 'limit' : p.why === 'viewer' ? 'viewer' : 'other');
    } else if (p.access === 'refused') {
      out.refused += 1;
      if (p.email) {
        const group = Object.hasOwn(out.refusedEmailsBy, p.why) ? p.why : 'other';
        if (!out.refusedEmailsBy[group].includes(p.email)) out.refusedEmailsBy[group].push(p.email);
      } else if (p.user_id && !out.refusedUserIds.includes(p.user_id)) out.refusedUserIds.push(p.user_id);
    }
  }
  for (const c of convs) {
    if (c.refused) { out.refused += 1; continue; }
    out.granted += Array.isArray(c.granted) ? c.granted.length : 0;
    const closed = Array.isArray(c.closed) ? c.closed : [];
    const limited = Array.isArray(c.limited) ? c.limited : [];
    out.closed += closed.length;
    for (const u of limited) close(u, 'limit');
    for (const u of closed) close(u, result?.can_grant === false ? 'viewer' : 'other');
  }
  return out;
}

// One short sentence for each group of people the send did not reach the usual
// way, in a fixed order. nameOf(userId) names a person; posted is how many
// conversations got the message (an invite is only promised when one did).
export function afterSendNotes(tally, { nameOf = (id) => id, posted = 0 } = {}) {
  const notes = [];
  const closed = tally?.closedBy || {};
  const refused = tally?.refusedEmailsBy || {};
  const people = (ids) => namesList((ids || []).map(nameOf));
  if (closed.limit?.length) { const list = people(closed.limit); notes.push(t`${list} can't open it yet: today's sharing limit is reached.`); }
  if (closed.viewer?.length) { const list = people(closed.viewer); notes.push(t`${list} can't open it yet: only editors can let people in.`); }
  if (closed.other?.length) { const list = people(closed.other); notes.push(t`${list} can't open it yet.`); }
  if (refused.viewer?.length) { const list = namesList(refused.viewer); notes.push(t`${list} didn't get it: only editors can invite by email.`); }
  if (refused.limit?.length) { const list = namesList(refused.limit); notes.push(t`${list} didn't get it: today's sharing limit is reached.`); }
  if (refused.bad_email?.length) { const list = namesList(refused.bad_email); notes.push(t`${list} didn't get it: check the address.`); }
  if (refused.self?.length) notes.push(t`You can't send it to yourself.`);
  if (refused.other?.length) { const list = namesList(refused.other); notes.push(t`Couldn't send to ${list}. Try again.`); }
  if (tally?.refusedUserIds?.length) { const list = people(tally.refusedUserIds); notes.push(t`${list} didn't get it.`); }
  if (posted > 0 && tally?.invitedEmails?.length) { const list = namesList(tally.invitedEmails); notes.push(t`${list} will get an email invite.`); }
  return notes;
}

// "Sent to Mara and Lena" / "Sent to 4 people".
export function sentWords(names) {
  const n = names.length;
  if (n <= 3) {
    const list = namesList(names);
    return t`Sent to ${list}`;
  }
  return plural(n, { one: 'Sent to # person', other: 'Sent to # people' });
}
