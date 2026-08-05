// Scout — resolving a chat handle to a Soleil user, minting one if needed.
//
// This is the "invisible account creation" step: the first time someone texts
// the bot, a real auth.users row, a personal workspace and a Scout Inbox board
// all come into existence behind them. They never see a form.
//
// The account is REAL, not a placeholder — it just carries a synthetic email
// until the user attaches their own. scout_accounts.is_shell tracks that debt
// (0206). Every website account must eventually have a real address, because
// sharing and invites have nothing to address without one.

import * as Y from 'yjs';
import { bytesToB64 } from './yhelpers.js';
import {
  scoutRpc, scoutSelect, scoutInsert, scoutCreateUser,
} from './scoutDb.js';

export const SCOUT_INBOX_NAME = 'Scout Inbox';

// Synthetic address for a shell account. The handle is HASHED rather than
// embedded: a raw phone number in an email address would leak into admin
// tooling, Stripe, and any future email log.
async function syntheticEmail(platform, handle) {
  const data = new TextEncoder().encode(`scout:${platform}:${handle}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${platform}-${hex.slice(0, 20)}@scout.soleilpictures.com`;
}

// Phone numbers → E.164-ish, emails/Apple IDs → lowercase. Keeping this in one
// place matters: the (platform, handle) unique index is the routing key, so an
// inconsistently-formatted handle silently creates a SECOND account for a user
// who already exists.
export function normalizeHandle(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('@')) return s.toLowerCase();
  const digits = s.replace(/[^\d+]/g, '');
  if (!digits) return s.toLowerCase();
  if (digits.startsWith('+')) return digits;
  // Bare 10-digit US numbers are the common inbound shape; anything else we
  // leave alone rather than guessing a country code wrong.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

// Create a board the same way the app does: client-generated UUID + a seeded
// empty snapshot. The UUID is generated here on purpose — see the comment at
// boardsApi.js:684 for why INSERT…RETURNING trips the recursive SELECT policy.
async function createBoard(env, { workspaceId, name, userId }) {
  const id = crypto.randomUUID();
  await scoutInsert(env, 'boards', [{
    id,
    workspace_id: workspaceId,
    parent_board_id: null,
    name,
    view: 'canvas',
    created_by: userId,
  }]);
  const doc = new Y.Doc();
  const b64 = bytesToB64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  await scoutInsert(env, 'board_state', [{
    board_id: id, doc: b64, updated_at: new Date().toISOString(),
  }], { onConflict: 'board_id' });
  return id;
}

// Find this user's Scout Inbox, creating it if it's missing (or was deleted).
export async function ensureScoutInbox(env, userId) {
  const ws = await scoutRpc(env, 'get_or_create_personal_workspace', {
    p_user_id: userId, p_name: 'Personal',
  });
  const workspaceId = Array.isArray(ws) ? ws[0]?.id : ws?.id;
  if (!workspaceId) throw new Error('could not resolve personal workspace');

  const existing = await scoutSelect(
    env, 'boards',
    `workspace_id=eq.${workspaceId}&name=eq.${encodeURIComponent(SCOUT_INBOX_NAME)}`
      + '&deleted_at=is.null&select=id&order=created_at.asc&limit=1',
  ).catch(() => []);
  if (existing?.[0]?.id) return { workspaceId, boardId: existing[0].id };

  const boardId = await createBoard(env, { workspaceId, name: SCOUT_INBOX_NAME, userId });
  return { workspaceId, boardId };
}

// The hot path. Returns { userId, email, workspaceId, boardId, isNew, isShell,
// capWarnedAt } for an inbound message, minting the account on first contact.
export async function resolveOrCreateIdentity(env, { platform, handle, threadKey, service = null }) {
  const norm = normalizeHandle(handle);
  if (!norm) throw new Error('scout: empty handle');

  const found = await scoutRpc(env, 'scout_resolve_identity', {
    p_platform: platform, p_handle: norm, p_thread_key: threadKey || null,
  });
  const hit = Array.isArray(found) ? found[0] : found;

  if (hit?.user_id) {
    const userId = hit.user_id;
    // A targeted board can be deleted out from under a thread; fall back to the
    // Inbox rather than dead-ending the user's next photo.
    let boardId = hit.target_board_id || null;
    let workspaceId = null;
    if (boardId) {
      const rows = await scoutSelect(
        env, 'boards', `id=eq.${boardId}&deleted_at=is.null&select=id,workspace_id`,
      ).catch(() => []);
      if (rows?.[0]) workspaceId = rows[0].workspace_id;
      else boardId = null;
    }
    if (!boardId) ({ workspaceId, boardId } = await ensureScoutInbox(env, userId));

    return {
      userId,
      email: await resolveEmail(env, userId),
      workspaceId,
      boardId,
      isNew: false,
      isShell: !!hit.is_shell,
      capWarnedAt: hit.cap_warned_at || null,
    };
  }

  // ── First contact: mint the account. ──────────────────────────────────────
  const email = await syntheticEmail(platform, norm);
  const user = await scoutCreateUser(env, {
    email,
    metadata: {
      scout_platform: platform,
      // first_source is what derive_acquisition_channel normalizes on; tagging
      // it here means Scout signups show up as their own channel in the funnel
      // rather than as untracked direct traffic.
      first_source: JSON.stringify({ source: 'scout', medium: platform }),
    },
  });
  const userId = user?.id;
  if (!userId) throw new Error('scout: createUser returned no id');

  const { workspaceId, boardId } = await ensureScoutInbox(env, userId);
  await scoutRpc(env, 'scout_bind_identity', {
    p_platform: platform, p_handle: norm, p_user_id: userId,
    p_service: service, p_is_shell: true,
  });

  return {
    userId, email, workspaceId, boardId,
    isNew: true, isShell: true, capWarnedAt: null,
  };
}

// The magiclink session mint needs the account's current email address, which
// changes the moment a shell user attaches a real one — so read it live rather
// than caching it alongside the identity.
async function resolveEmail(env, userId) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u?.email || null;
}
