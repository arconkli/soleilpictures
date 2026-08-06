// Scout — resolving a chat handle to a Soleil user, minting one if needed.
//
// This is the "invisible account creation" step: the first time someone texts
// the bot, a real auth.users row, a personal workspace and a Scout Bin board
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

// The staging board every text lands on until it's filed somewhere. "Bin" is
// the editorial term — in an NLE a bin is where unsorted media lives before the
// cut, which is exactly this. Note it is a LABEL, not an identity: the board is
// found by id (scout_accounts.bin_board_id), because a user who renames it in
// the app must keep the same board.
export const SCOUT_BIN_NAME = 'Scout Bin';
// What 0206 called it. Only used to adopt a board minted before the rename.
const LEGACY_BIN_NAME = 'Scout Inbox';

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
// Dialing codes for the countries film production actually happens in. Not a
// complete ITU table on purpose — this is a FALLBACK for the case where a
// provider hands us a national-format number, and a wrong guess is worse than
// an honest refusal (see below).
const DIALING_CODES = {
  US: '1', CA: '1', PR: '1', DO: '1', JM: '1',
  GB: '44', IE: '353', FR: '33', DE: '49', ES: '34', PT: '351', IT: '39',
  NL: '31', BE: '32', CH: '41', AT: '43', SE: '46', NO: '47', DK: '45',
  FI: '358', IS: '354', PL: '48', CZ: '420', SK: '421', HU: '36', RO: '40',
  BG: '359', GR: '30', HR: '385', RS: '381', UA: '380', TR: '90',
  AU: '61', NZ: '64', JP: '81', KR: '82', CN: '86', HK: '852', TW: '886',
  SG: '65', MY: '60', TH: '66', PH: '63', ID: '62', IN: '91', PK: '92',
  AE: '971', SA: '966', IL: '972', JO: '962', MA: '212', EG: '20',
  ZA: '27', NG: '234', KE: '254', GH: '233',
  MX: '52', BR: '55', AR: '54', CL: '56', CO: '57', PE: '51', UY: '598',
};

// Italy keeps the leading 0 as part of the subscriber number; almost everywhere
// else it's a national trunk prefix that must be dropped before the country
// code. NANP numbers have no trunk prefix at all.
const KEEPS_LEADING_ZERO = new Set(['IT']);

// Normalize a chat handle into the routing key stored in scout_identities.
//
// The (platform, handle) unique index IS the routing table, so the only thing
// that truly matters is that ONE person always produces ONE handle. A handle
// that's merely ugly is fine; a handle that varies between messages silently
// creates a second account for someone who already exists.
//
// `country` is the ISO code the provider reports alongside the sender. Photon
// documents it on the user object, and it's what makes non-US numbers safe:
// without it, a UK mobile in national form (7911123456) is indistinguishable
// from a US number and would normalize to +17911123456 — valid-looking,
// completely wrong, and impossible to notice until someone's board goes
// missing.
export function normalizeHandle(raw, country = null) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('@')) return s.toLowerCase();

  const cleaned = s.replace(/[^\d+]/g, '');
  if (!cleaned) return s.toLowerCase();

  // Already E.164 — the expected path. Providers send this; trust it.
  if (cleaned.startsWith('+')) return `+${cleaned.replace(/\D/g, '')}`;

  const digits = cleaned.replace(/\D/g, '');
  const cc = country ? DIALING_CODES[String(country).toUpperCase()] : null;

  if (cc) {
    const iso = String(country).toUpperCase();
    let national = digits;
    // Drop the national trunk prefix (a leading 0 nearly everywhere).
    if (!KEEPS_LEADING_ZERO.has(iso) && national.startsWith('0')) national = national.slice(1);
    // The number may ALREADY carry its country code — a provider can report
    // "15551234567" with country US. Prepending again yields +115551234567,
    // which is a second key for the same person. Only strip when what's left
    // is still a plausible subscriber number, so a genuine local number that
    // happens to begin with the dialing digits survives.
    if (national.startsWith(cc) && national.length - cc.length >= 6) {
      national = national.slice(cc.length);
    }
    return `+${cc}${national}`;
  }

  // No country hint. Only assume North America when the shape is unambiguously
  // NANP, and even then only because the line itself is US-registered.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  // Anything else: refuse to guess. A stable, obviously-not-E.164 key keeps the
  // user routed consistently and makes the gap visible in logs, instead of
  // minting a plausible wrong number that nobody catches.
  return `unknown:${digits}`;
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

// Find this user's Scout Bin, creating it if it's missing (or was deleted).
//
// Resolution order, and why:
//   1. scout_accounts.bin_board_id — the identity. Survives a rename.
//   2. name lookup — only ever a MIGRATION path, for accounts minted before
//      bin_board_id existed. Matches the legacy name too.
//   3. create one.
//
// Whatever we land on gets written back to bin_board_id, so step 2 runs at most
// once per account. Keying by name was a real bug: renaming the board in the app
// made the next photo create a second Bin and silently strand the first.
export async function ensureScoutBin(env, userId, { binBoardId = null } = {}) {
  if (binBoardId) {
    const rows = await scoutSelect(
      env, 'boards', `id=eq.${binBoardId}&deleted_at=is.null&select=id,workspace_id`,
    ).catch(() => []);
    if (rows?.[0]?.id) return { workspaceId: rows[0].workspace_id, boardId: rows[0].id };
    // Deleted out from under us — fall through and make a new one.
  }

  const ws = await scoutRpc(env, 'get_or_create_personal_workspace', {
    p_user_id: userId, p_name: 'Personal',
  });
  const workspaceId = Array.isArray(ws) ? ws[0]?.id : ws?.id;
  if (!workspaceId) throw new Error('could not resolve personal workspace');

  const names = `(${[SCOUT_BIN_NAME, LEGACY_BIN_NAME].map((n) => `"${n}"`).join(',')})`;
  const existing = await scoutSelect(
    env, 'boards',
    `workspace_id=eq.${workspaceId}&name=in.${encodeURIComponent(names)}`
      + '&deleted_at=is.null&select=id&order=created_at.asc&limit=1',
  ).catch(() => []);

  const boardId = existing?.[0]?.id
    || await createBoard(env, { workspaceId, name: SCOUT_BIN_NAME, userId });

  // Pin the id so we never have to guess from a name again.
  await scoutRpc(env, 'scout_set_bin_board', {
    p_user_id: userId, p_board_id: boardId,
  }).catch(() => {});

  return { workspaceId, boardId };
}

// The hot path. Returns { userId, email, workspaceId, boardId, isNew, isShell,
// capWarnedAt } for an inbound message, minting the account on first contact.
export async function resolveOrCreateIdentity(env, { platform, handle, threadKey, service = null, country = null }) {
  const norm = normalizeHandle(handle, country);
  if (!norm) throw new Error('scout: empty handle');

  const found = await scoutRpc(env, 'scout_resolve_identity', {
    p_platform: platform, p_handle: norm, p_thread_key: threadKey || null,
  });
  const hit = Array.isArray(found) ? found[0] : found;

  if (hit?.user_id) {
    const userId = hit.user_id;

    // The Bin always exists — it's the staging collection and the fallback for
    // everything else.
    const bin = await ensureScoutBin(env, userId, { binBoardId: hit.bin_board_id || null });

    // An explicit sticky target (set by /board) means new cards bypass the Bin
    // and land straight on that board. It can be deleted out from under a
    // thread, so verify rather than trust; on a miss we fall back to the Bin
    // instead of dead-ending the user's next photo.
    let boardId = null;
    let workspaceId = bin.workspaceId;
    if (hit.target_board_id && hit.target_board_id !== bin.boardId) {
      const rows = await scoutSelect(
        env, 'boards', `id=eq.${hit.target_board_id}&deleted_at=is.null&select=id,workspace_id`,
      ).catch(() => []);
      if (rows?.[0]) {
        boardId = rows[0].id;
        workspaceId = rows[0].workspace_id;
      }
    }

    return {
      userId,
      email: await resolveEmail(env, userId),
      workspaceId,
      // Where new cards land.
      boardId: boardId || bin.boardId,
      // The staging board specifically — filing reads its runs.
      binBoardId: bin.boardId,
      isNew: false,
      isShell: !!hit.is_shell,
      capWarnedAt: hit.cap_warned_at || null,
      pendingMove: hit.pending_move || null,
      pendingMoveAt: hit.pending_move_at || null,
      lastMove: hit.last_move || null,
      lastMoveAt: hit.last_move_at || null,
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

  const { workspaceId, boardId } = await ensureScoutBin(env, userId);
  await scoutRpc(env, 'scout_bind_identity', {
    p_platform: platform, p_handle: norm, p_user_id: userId,
    p_service: service, p_is_shell: true,
  });

  return {
    userId, email, workspaceId, boardId, binBoardId: boardId,
    isNew: true, isShell: true, capWarnedAt: null,
    pendingMove: null, pendingMoveAt: null, lastMove: null, lastMoveAt: null,
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
