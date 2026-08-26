// Client half of self-serve account deletion.
//
// Two calls, deliberately separate. `getDeletionImpact` is read-only and is
// what lets the confirm screen state what will happen — how many clusters go,
// which shared workspaces change hands and to whom — instead of warning in the
// abstract. `deleteOwnAccount` is the irreversible one.
//
// The edge function takes NO user id: it derives the subject from the bearer
// token, so there is nothing here that could be pointed at another account.
// `confirmEmail` is re-checked server-side as well, so the endpoint cannot fire
// on an empty POST.

import { supabase } from './supabase.js';

const DELETE_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/delete-own-account';

async function authedToken() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return token;
}

// { workspaces_deleted: [{id,name}], workspaces_transferred: [{id,name,to_name}],
//   clusters_deleted, memberships_dropped, subscription_active }
export async function getDeletionImpact() {
  const { data, error } = await supabase.rpc('my_deletion_impact');
  if (error) throw error;
  return data || null;
}

export async function deleteOwnAccount({ confirmEmail }) {
  const token = await authedToken();
  const res = await fetch(DELETE_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ confirm_email: confirmEmail }),
  });
  let payload = null;
  try { payload = await res.json(); } catch (_) { /* non-JSON error page */ }
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error || `Deletion failed (${res.status}).`);
  }
  return payload;
}

// After a successful delete the session belongs to a user that no longer
// exists. Clear it locally and leave — a normal in-app navigation would just
// hit an auth error on the next query.
export async function signOutAfterDeletion() {
  try { await supabase.auth.signOut(); } catch (_) { /* the account is gone regardless */ }
  try { localStorage.removeItem('soleil.ui'); } catch (_) {}
  window.location.replace('/');
}
