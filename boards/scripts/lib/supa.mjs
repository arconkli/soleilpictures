// Service-role Supabase client for the seed script. Bypasses RLS so we can
// insert boards / board_state / card_index / images / public_boards for a
// showcase workspace without authenticating as a user. NEVER ship this key to
// a browser — it stays in scripts/.env (git-ignored) and this Node process.

import { createClient } from '@supabase/supabase-js';

export function makeSupabase({ url, serviceRoleKey }) {
  if (!url || !serviceRoleKey) {
    throw new Error('makeSupabase: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
