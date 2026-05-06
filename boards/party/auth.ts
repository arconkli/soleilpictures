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
  reason?: string;
}

// GET request that hits the Supabase REST endpoint with the user's token
// and the anon key. If RLS allows, we get back the row(s). Empty array =
// not a member (or the resource doesn't exist).
async function supabaseGet(path: string, accessToken: string): Promise<any[] | null> {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  return res.json();
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
  // the user is a workspace member.
  const rows = await supabaseGet(
    `boards?id=eq.${encodeURIComponent(boardId)}&select=id`,
    accessToken,
  );
  if (rows === null) return { ok: false, reason: "auth check failed" };
  if (rows.length === 0) return { ok: false, reason: "not a member of this board's workspace" };
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
