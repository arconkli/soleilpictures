// Authentication for PartyKit connections.
//
// Each WebSocket connection passes the Supabase access token as a query
// param (?access_token=...). We verify membership via Supabase REST with
// that token — RLS on the `boards` / `workspaces` tables already enforces
// who can read what, so a non-member's request returns 0 rows.
//
// We don't bother to verify the JWT signature ourselves because the
// Supabase REST call does it for us — if the token is invalid, the call
// returns 401 and we deny.
//
// Result is cached per-connection (we re-check on each new connection,
// not on each message — once a connection is open, the user is trusted
// for that session).

const SUPABASE_URL = "https://ehlhlmbpwwalmeisvmdp.supabase.co";

// Anon key — public, safe to embed. Used as the apikey header so PostgREST
// accepts the request; the real authorization happens via the access token.
const SUPABASE_ANON_KEY = "sb_publishable_djb-_42yVCKWTNTfhhVqTQ_9TVpSNAr";

export interface AuthCheckResult {
  ok: boolean;
  userId?: string;
  email?: string;
  workspaceId?: string;
  reason?: string;
}

// GET request that hits the Supabase REST endpoint with the user's token
// and the anon key. If RLS allows, we get back the row(s). Empty array =
// not a member (or the resource doesn't exist).
async function supabaseGet(path: string, accessToken: string): Promise<any[] | null> {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      // A hung Supabase request would otherwise stall the WS upgrade
      // indefinitely; fail the auth check instead and let the client retry.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (_) {
    return null;
  }
}

// Decode the Supabase JWT payload (without verifying — we only use this
// for the user_id; the membership check above is the real gate).
function decodeJwtSub(token: string): { sub?: string; email?: string } | null {
  try {
    const [, payload] = token.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

export async function authBoard(
  accessToken: string,
  boardId: string,
): Promise<AuthCheckResult> {
  if (!accessToken || !boardId) return { ok: false, reason: "missing token or board id" };
  const claims = decodeJwtSub(accessToken);
  if (!claims?.sub) return { ok: false, reason: "invalid token" };
  // Try fetching the board row — RLS on `boards` will return it only if
  // the user is a workspace member. Also pull workspace_id so the
  // anomaly detector (in opLog) can scope alerts correctly.
  const rows = await supabaseGet(
    `boards?id=eq.${encodeURIComponent(boardId)}&select=id,workspace_id`,
    accessToken,
  );
  if (rows === null) return { ok: false, reason: "auth check failed" };
  if (rows.length === 0) return { ok: false, reason: "not a member of this board's workspace" };
  return {
    ok: true,
    userId: claims.sub,
    email: claims.email,
    workspaceId: rows[0].workspace_id,
  };
}

// Write check via the can_write_board RPC. Returns false when the
// caller has only viewer-share access (or no access at all). Used by
// the board party to mark connections readOnly server-side, closing
// the loophole where viewers could broadcast Y.js updates that other
// tabs in the same room would render ephemerally before RLS rejects
// the snapshot upsert.
export async function canWriteBoard(
  accessToken: string,
  boardId: string,
): Promise<boolean> {
  if (!accessToken || !boardId) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/can_write_board`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ p_board_id: boardId }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const v = await res.json();
    return v === true;
  } catch (_) { return false; }
}

// authAdmin — verify that the bearer is an authenticated user whose
// profile carries tier='admin'. Used by the universe party to gate
// every endpoint to platform admins. Returns { ok, userId } so the
// caller can log who looked at the universe.
export async function authAdmin(accessToken: string): Promise<AuthCheckResult> {
  if (!accessToken) return { ok: false, reason: "missing token" };
  const claims = decodeJwtSub(accessToken);
  if (!claims?.sub) return { ok: false, reason: "invalid token" };
  // Users can read their own profile (workspace-member RLS) and admins
  // can read all profiles (added by 0070_admin_dashboard_rpcs.sql).
  // Either way this row appears for legitimate admin requests.
  const rows = await supabaseGet(
    `profiles?user_id=eq.${claims.sub}&select=tier`,
    accessToken,
  );
  if (rows === null) return { ok: false, reason: "auth check failed" };
  if (rows.length === 0 || rows[0]?.tier !== "admin") {
    return { ok: false, reason: "admin only" };
  }
  return { ok: true, userId: claims.sub, email: claims.email };
}

export async function authWorkspace(
  accessToken: string,
  workspaceId: string,
): Promise<AuthCheckResult> {
  if (!accessToken || !workspaceId) return { ok: false, reason: "missing token or workspace id" };
  const claims = decodeJwtSub(accessToken);
  if (!claims?.sub) return { ok: false, reason: "invalid token" };
  const rows = await supabaseGet(
    `workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${claims.sub}&select=user_id`,
    accessToken,
  );
  if (rows === null) return { ok: false, reason: "auth check failed" };
  if (rows.length === 0) return { ok: false, reason: "not a member of this workspace" };
  return { ok: true, userId: claims.sub, email: claims.email };
}
