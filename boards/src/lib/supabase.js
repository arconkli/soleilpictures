// Supabase client singleton.
// If env vars are missing we return null so the rest of the app can fall back
// to local-only dev mode instead of crashing — this keeps Phase 0 prototypes
// working before the user has provisioned a Supabase project.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
// Prefer the modern publishable key; fall back to legacy anon JWT.
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
              || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (url && publicKey)
  ? createClient(url, publicKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

export const isSupabaseConfigured = !!supabase;
