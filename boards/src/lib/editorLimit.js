// editorLimit.js — the 10-editor limit on Free and Creator (0520/0521), as the
// app reads it. A personal account can have at most EDITOR_LIMIT people who
// can edit, counted across every workspace it owns. A door that would add one
// more refuses with one of the hints below; an edit link lets the person in as
// a viewer instead. Pure, so it runs in node.

// public._editor_limit() in 0520 says the same number;
// editorLimitMigration.test.mjs reads the SQL and holds them together.
export const EDITOR_LIMIT = 10;

// _editor_refuse (0520) raises with one of these hints. The account's owner
// can make room; anyone else can ask the owner to.
export const EDITOR_LIMIT_HINT = 'editor_limit';
export const EDITOR_LIMIT_ASK_HINT = 'editor_limit_ask_owner';

// What a failed share, invite or role change means for the limit: null when
// it wasn't the limit, else { ask }, which is true when the caller isn't the
// account's owner and can only ask them. supabase-js keeps the hint on the
// error it hands back. A wrapper that re-threw a plain Error keeps only the
// message, and _editor_refuse starts that with "editor limit reached:".
export function editorLimitRefusal(err) {
  const hint = err?.hint;
  if (hint === EDITOR_LIMIT_HINT) return { ask: false };
  if (hint === EDITOR_LIMIT_ASK_HINT) return { ask: true };
  const msg = String(err?.message ?? '');
  if (!/^editor limit reached:/i.test(msg)) return null;
  return { ask: !/^editor limit reached: you have/i.test(msg) };
}

// get_editor_capacity's row (0520) in the app's words. null while unknown:
// callers treat unknown as room, because the server refuses anyway.
export function normalizeEditorCapacity(rowOrRows) {
  const r = Array.isArray(rowOrRows) ? rowOrRows[0] : rowOrRows;
  if (!r) return null;
  const limit = Number(r.editor_limit ?? EDITOR_LIMIT);
  const used = Number(r.used ?? 0);
  const pending = Number(r.pending ?? 0);
  return {
    enforced: Boolean(r.enforced),
    limit,
    used,
    pending,
    taken: used + pending,
    left: Math.max(0, limit - used - pending),
    full: Boolean(r.is_full),
    isAccountOwner: Boolean(r.i_am_account_owner),
    subject: r.subject || 'account',
  };
}

// Where an account stands against the limit: 'over' (more than the limit,
// after a transfer or a restore: everyone keeps editing, nobody new joins),
// 'full', 'near' (two places or fewer left), 'room', or null while unknown or
// off.
export function editorLimitStage(cap) {
  if (!cap || !cap.enforced) return null;
  if (cap.taken > cap.limit) return 'over';
  if (cap.full || cap.taken >= cap.limit) return 'full';
  if (cap.limit - cap.taken <= 2) return 'near';
  return 'room';
}

// No room for anyone new to edit: full, or over.
export function editorLimitFull(cap) {
  const s = editorLimitStage(cap);
  return s === 'full' || s === 'over';
}

// "Alex" out of "Alex Moreau", for "Alex’s plan". null for nothing, an
// address, or a stand-in that names nobody (the share panel says "Member"
// and "You" when it has no name).
export function firstName(name) {
  const s = String(name ?? '').trim();
  if (!s || s.includes('@') || s === 'Member' || s === 'You') return null;
  return s.split(/\s+/)[0];
}

// "Alex’s plan", or "the owner’s plan" when we don't know their name.
export function ownerPlan(ownerName, { start = false } = {}) {
  if (ownerName) return `${ownerName}’s plan`;
  return start ? 'The owner’s plan' : 'the owner’s plan';
}

// The note at the top of the share panel's invite area (the owner's pick B,
// 2026-10-21), or null when there is nothing to say. Only the account's owner
// hears that places are running low; anyone else hears once there are none,
// and can ask the owner for room.
//   → { stage, lead, body, seeWho: 'link'|'button'|null, ask: label|null, done: line|null }
export function editorLimitNote(cap, { ownerName = null, asked = false } = {}) {
  const stage = editorLimitStage(cap);
  if (!stage || stage === 'room') return null;
  const { limit, taken } = cap;
  if (cap.isAccountOwner) {
    if (stage === 'over') {
      return {
        stage, lead: `${taken} people can edit, and your plan has room for ${limit}.`,
        body: `Everyone keeps editing. Nobody new can edit until you’re under ${limit}.`,
        seeWho: 'button', ask: null, done: null,
      };
    }
    if (stage === 'full') {
      return {
        stage, lead: 'No places left for people who can edit.',
        body: `Your plan has room for ${limit}, across all your workspaces. Invite people to view, or make room.`,
        seeWho: 'button', ask: null, done: null,
      };
    }
    const left = limit - taken;
    return {
      stage, lead: `${left} ${left === 1 ? 'place' : 'places'} left for people who can edit.`,
      body: `Your plan has room for ${limit}, across all your workspaces.`,
      seeWho: 'link', ask: null, done: null,
    };
  }
  if (stage === 'near') return null;
  const who = ownerName || 'the owner';
  return {
    stage,
    lead: 'No places left for people who can edit.',
    body: `${ownerPlan(ownerName, { start: true })} has room for ${limit}. Invite people to view, or ask ${who} to make room.`,
    seeWho: null,
    ask: asked ? null : `Ask ${who} for room`,
    done: asked ? `We told ${who} you’d like to add an editor.` : null,
  };
}

// A door's refusal (editorLimitRefusal) as one sentence for a toast.
export function editorLimitRefusalMessage(refusal, { ownerName = null, limit = EDITOR_LIMIT } = {}) {
  if (!refusal) return '';
  if (!refusal.ask) {
    return `No places left for people who can edit: your plan has room for ${limit}. Invite them to view, or make room.`;
  }
  return `No places left for people who can edit: ${ownerPlan(ownerName)} has room for ${limit}. Invite them to view, or ask ${ownerName || 'the owner'} to make room.`;
}

// A live notice as its toast says it: "title — body", except the person an
// edit link let in as a viewer, who reads two sentences (0520's copy).
export function noticeToastText(n) {
  const title = String(n?.title ?? '');
  const body = String(n?.body ?? '');
  if (!body) return title;
  return n?.kind === 'editors.joined_as_viewer' ? `${title}. ${body}` : `${title} — ${body}`;
}

// The joined-as-viewer notices a first load finds unseen: an edit link is
// claimed before the app subscribes to its pings. Unread, from the last day,
// not toasted already; newest first.
export function missedJoinedAsViewer(rows, { now = Date.now(), toasted = null } = {}) {
  const DAY = 24 * 3600 * 1000;
  return (Array.isArray(rows) ? rows : [])
    .filter((n) => n && n.kind === 'editors.joined_as_viewer' && !n.read_at
      && !(toasted && toasted.has(n.id))
      && now - Date.parse(n.created_at) < DAY)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

// Who holds a place, from the owner's list (list_my_account_editors). A
// viewer who edits somewhere else in the account can be made an editor here
// without taking another place, so the app keeps "Can edit" open for them.
export function accountHolders(rows) {
  const ids = new Set();
  const emails = new Set();
  for (const r of rows || []) {
    if (r?.user_id) ids.add(r.user_id);
    if (r?.email) emails.add(String(r.email).trim().toLowerCase());
  }
  return { ids, emails };
}

export function holdsPlace(holders, { userId = null, email = null } = {}) {
  if (!holders) return false;
  if (userId && holders.ids.has(userId)) return true;
  return !!email && holders.emails.has(String(email).trim().toLowerCase());
}

// ── The owner's list in Settings › Members ─────────────────────────────────
// A row is list_my_account_editors' (0520): { slot_key, user_id, email,
// display_name, source, grants: [{ source, role, workspace_id,
// workspace_name, board_id, board_name, invite_id, sent_at }] }.

const MEMBER_RANK = { owner: 0, coowner: 0, admin: 1, editor: 1 };
const grantRank = (g) => (g.source === 'member' ? (MEMBER_RANK[g.role] ?? 1) : g.source === 'share' ? 2 : 3);
const EDITING_MEMBER = ['coowner', 'admin', 'editor'];

function grantPhrase(g) {
  const ws = g.workspace_name || 'a workspace';
  const board = g.board_name ? `“${g.board_name}”` : 'a cluster';
  if (g.source === 'member') return g.role === 'coowner' || g.role === 'owner' ? `Co-owner of ${ws}` : `Edits ${ws}`;
  if (g.source === 'share') return `Can edit ${board} in ${ws}`;
  return g.board_id ? `Invited to edit ${board} in ${ws}` : `Invited to edit ${ws}`;
}

// The line under a person in "People who can edit": where they can edit, the
// widest place first, and for a waiting invite when it went and what it holds.
export function accountEditorSub(row) {
  if (!row) return '';
  if (row.source === 'owner') return `${row.email} · every workspace`;
  const grants = (row.grants || []).filter((g) => g && g.source !== 'owner')
    .slice().sort((a, b) => grantRank(a) - grantRank(b));
  if (grants.length === 0) return row.email || '';
  let s = grantPhrase(grants[0]);
  if (grants.length > 1) s += `, and ${grants.length - 1} more`;
  if (row.source === 'pending') {
    const sent = grants.map((g) => g.sent_at).filter(Boolean).sort()[0];
    if (sent) s += ` · sent ${new Date(sent).toLocaleDateString()}`;
    s += ' · holds a place until it’s accepted';
  }
  return s;
}

// What freeing one person's place does, as calls AccountEditorsCard makes.
// Make viewer: every place they can edit becomes one they can view, so they
// keep everything they could open.
export function makeViewerOps(row) {
  const ops = [];
  for (const g of row?.grants || []) {
    if (g.source === 'member' && EDITING_MEMBER.includes(g.role)) {
      ops.push({ op: 'member_role', workspaceId: g.workspace_id, userId: row.user_id, role: 'viewer' });
    } else if (g.source === 'share') {
      ops.push({ op: 'share_role', boardId: g.board_id, email: row.email, role: 'viewer' });
    }
  }
  return ops;
}

// Remove: their cluster shares first, then their memberships. Removing a
// member drops their shares in that workspace too (0318), so the other order
// would fail on rows already gone.
export function removeOps(row) {
  const grants = row?.grants || [];
  return [
    ...grants.filter((g) => g.source === 'share')
      .map((g) => ({ op: 'unshare', boardId: g.board_id, userId: row.user_id })),
    ...grants.filter((g) => g.source === 'member' && EDITING_MEMBER.includes(g.role))
      .map((g) => ({ op: 'remove_member', workspaceId: g.workspace_id, userId: row.user_id })),
  ];
}

// Revoke: every invite holding that address's place.
export function revokeOps(row) {
  return (row?.grants || []).filter((g) => g.source === 'pending' && g.invite_id)
    .map((g) => ({ op: 'revoke', inviteId: g.invite_id }));
}

// An admin's preview of the limit's states (Settings › Preview, on preview and
// dev only): the numbers say `state`, and in the admin's own account the
// owner's list gains example people up to them. Look only: the doors still
// count the real places. In someone else's workspace it's the non-owner's view.
export const EDITOR_LIMIT_PREVIEW_STATES = ['near', 'full', 'full_ask'];
export function applyEditorLimitPreview(cap, editors = [], state = null) {
  if (!cap || !EDITOR_LIMIT_PREVIEW_STATES.includes(state)) return { cap, editors, previewing: false };
  const limit = cap.limit || EDITOR_LIMIT;
  const owner = state !== 'full_ask' && !!cap.isAccountOwner;
  const real = owner ? editors : [];
  const taken = Math.max(state === 'near' ? limit - 2 : limit, real.length);
  const examples = [];
  for (let i = real.length + 1; owner && i <= taken; i += 1) {
    examples.push({
      slot_key: `preview:${i}`, user_id: null, email: `example${i}@example.com`,
      display_name: `Example person ${i}`, source: 'member', preview: true,
      grants: [{ source: 'member', role: 'editor', workspace_id: null, workspace_name: 'Example workspace',
                 board_id: null, board_name: null, invite_id: null, sent_at: null }],
    });
  }
  return {
    cap: { ...cap, enforced: true, used: taken, pending: 0, taken, left: Math.max(0, limit - taken),
           full: taken >= limit, isAccountOwner: owner },
    editors: owner ? [...real, ...examples] : [],
    previewing: true,
  };
}
