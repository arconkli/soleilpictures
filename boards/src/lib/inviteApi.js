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
