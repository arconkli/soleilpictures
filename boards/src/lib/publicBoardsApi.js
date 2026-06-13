// Public marketing boards — anon-callable read API (migration 0136).
//
// Deliberately yjs-free and imports only the supabase client, so the /explore
// index page and the public board meta lookups can be code-split into the
// signed-out chunk without dragging the editor's heavy deps along (mirrors the
// landing-CRO guardrail). The actual board snapshot for the live /c/<slug>
// canvas comes from the party /public-bundle endpoint, NOT from here.

import { supabase } from './supabase.js';

// Every published, non-deleted public board, ordered for the /explore index +
// used by the worker for the sitemap. SECURITY DEFINER RPC; safe for anon.
export async function getPublicBoards() {
  const { data, error } = await supabase.rpc('list_public_boards');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// Lightweight SEO/meta for a single published board (title sync, etc.).
// Throws (P0002) if the slug isn't a published, non-deleted public board.
export async function getPublicBoardMeta(slug) {
  const { data, error } = await supabase.rpc('get_public_board_meta', { p_slug: slug });
  if (error) throw error;
  return data || null;
}
