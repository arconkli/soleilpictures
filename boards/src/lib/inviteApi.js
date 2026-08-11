// Anon/authed invite RPCs, split out of boardsApi.js so the signed-out
// landing (AuthGate) can call them WITHOUT pulling boardsApi's heavy
// `import * as Y from 'yjs'` (+ yhelpers + perf) into the entry chunk.
// boardsApi re-exports these so existing/other callers are unaffected.
import { supabase } from './supabase.js';

// Anon-callable. AuthGate uses this to pre-fill the email field before
// the user has a session. Returns null if token is invalid/expired/claimed.
export async function peekPendingInviteEmail(token) {
  const { data, error } = await supabase
    .rpc('peek_pending_invite_email', { p_token: token });
  if (error) throw error;
  return data || null;
}

// Authed call. Returns { workspace_id, board_id } so the caller can
// redirect to the right place. Idempotent — the auth.users INSERT
// trigger already claims most invites on signup; this is the "land on
// the right board" helper.
export async function claimPendingInvite(token) {
  const { data, error } = await supabase
    .rpc('claim_pending_invite', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

// Anon-callable. Names the cluster behind a stashed ?join=<token> so the
// signed-out landing can say WHAT the visitor was invited to — the ?invite=
// path has had that context since 0086 (peekPendingInviteEmail) and the
// ?join= path never did, which is where invited people were bouncing.
//
// Reuses get_share_meta rather than adding a peek RPC: it is already granted
// to anon, and it returns nothing the same token doesn't already expose via
// get_share_bundle (the /share preview renders the whole cluster). Token
// possession is the trust boundary, exactly as with peekPendingInviteEmail.
// Returns null on any invalid/revoked/expired/deleted token — _resolve_share_target
// raises P0002 and the caller must degrade to the plain landing, never block.
export async function peekJoinBoardName(token) {
  const { data, error } = await supabase
    .rpc('get_share_meta', { p_token: token });
  if (error) throw error;
  const name = (Array.isArray(data) ? data[0] : data)?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

// Authed call — claim a multi-use invite LINK (?join=<token>, 0189).
// Returns { workspace_id, board_id, role, status } where status is
// 'joined' | 'upgraded' | 'already' | 'noop'. Idempotent; safe to call on
// every repeat click of the same link.
export async function claimCollabLink(token) {
  const { data, error } = await supabase
    .rpc('claim_collab_link', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}
