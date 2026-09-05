// Saved grid layouts — the Templates library's data access (migration 0265).
//
// Deliberately thin: every function is a `from`/`rpc` call plus the house error
// shape (await, destructure { data, error }, throw on error, coerce to a safe
// default). The catalogue logic lives in gridLayoutLibrary.js and the geometry
// in gridLayout.js; nothing here knows what a fraction tree is.
//
// Reads and ordinary writes go straight through RLS rather than an RPC — the
// policies in 0265 already answer "may I see this / may I change this", and a
// SECURITY DEFINER wrapper around a question RLS can answer is exactly the layer
// that routed around RLS in the 0217 audit. Only the three share-link operations
// are RPCs, because each needs to do something the caller's own privileges
// deliberately cannot: mint a token, read a row by token while signed out, or
// copy someone else's row into your library.

import { supabase } from './supabase.js';

// Columns the panel needs. `body` is the payload; share_token drives the
// "Copy link" affordance. Never selects anything about other people.
const COLS = 'id, workspace_id, name, body, scope, share_token, created_by, origin, updated_at';

// Every template visible to me: my own (any scope) plus anything shared into a
// workspace I belong to. ONE query — the RLS SELECT policy is the union, so
// splitting this into "mine" and "workspace" would be two round-trips for the
// same rows. The caller partitions by scope/created_by.
export async function listGridLayouts() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('grid_layouts')
    .select(COLS)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// ONE row by id. Exists because claim_grid_layout_link and use_public_grid_layout
// both return a bare uuid, and the "you just added this — place it" prompt needs
// the geometry to draw a preview and arm the placer. Straight through RLS: the
// row was just copied into the caller's own library, so the SELECT policy already
// answers it. Returns null rather than throwing when it is gone.
export async function getGridLayout(id) {
  if (!supabase || !id) return null;
  const { data, error } = await supabase
    .from('grid_layouts')
    .select(COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// `body` comes from gridLayoutLibrary.bodyFromGrid (already sanitized).
// created_by is sent explicitly because the INSERT policy checks it against
// auth.uid() — there is no column default doing it for us.
export async function saveGridLayout({ name, body, scope = 'user', workspaceId = null, userId }) {
  if (!supabase) throw new Error('not signed in');
  const { data, error } = await supabase
    .from('grid_layouts')
    .insert({
      name,
      body,
      scope,
      workspace_id: scope === 'workspace' ? workspaceId : null,
      created_by: userId,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return data;
}

export async function renameGridLayout(id, name) {
  const { data, error } = await supabase
    .from('grid_layouts').update({ name }).eq('id', id).select(COLS).single();
  if (error) throw error;
  return data;
}

// Moving a personal template into the workspace and back. workspace_id is
// cleared on the way out so a personal row never keeps a stale pointer at a
// workspace it is no longer shared with.
export async function setGridLayoutScope(id, scope, workspaceId) {
  const { data, error } = await supabase
    .from('grid_layouts')
    .update({ scope, workspace_id: scope === 'workspace' ? workspaceId : null })
    .eq('id', id).select(COLS).single();
  if (error) throw error;
  return data;
}

// Soft delete — the house convention is an Undo toast, which needs the row to
// still exist when Undo is pressed. There is no DELETE policy on the table at
// all, so this is the only removal path.
export async function deleteGridLayout(id) {
  const { error } = await supabase
    .from('grid_layouts').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function restoreGridLayout(id) {
  const { error } = await supabase
    .from('grid_layouts').update({ deleted_at: null }).eq('id', id);
  if (error) throw error;
}

// ── share links ──────────────────────────────────────────────────────────────

// Reuse-before-mint: calling twice returns the same token rather than orphaning
// a link already pasted into a chat.
export async function createGridLayoutLink(id) {
  const { data, error } = await supabase.rpc('create_grid_layout_link', { p_id: id });
  if (error) throw error;
  return data || null;
}

// Anon-callable. Returns { name, body } or null — an unknown, revoked or deleted
// token is indistinguishable from never having existed, on purpose.
export async function getGridLayoutByToken(token) {
  const { data, error } = await supabase.rpc('get_grid_layout_by_token', { p_token: token });
  if (error) throw error;
  return data || null;
}

// Copies the shared template into my library and returns the new row's id.
// Idempotent per (token, claimer), so opening a link twice doesn't litter.
export async function claimGridLayoutLink(token) {
  const { data, error } = await supabase.rpc('claim_grid_layout_link', { p_token: token });
  if (error) throw error;
  return data || null;
}

// ── the public gallery (migration 0266) ──────────────────────────────────────
// Publishing is immediate — there is no review queue. The moderation surface is
// small enough to police after the fact: a template carries no images and no
// cell content, so the only author-controlled strings that reach a public page
// are its name, title and description.

export async function publishGridLayout(id, title, description) {
  const { data, error } = await supabase.rpc('submit_grid_layout_to_public', {
    p_id: id, p_title: title || null, p_description: description || null,
  });
  if (error) throw error;
  return data || null;   // { status, slug }
}

export async function unpublishGridLayout(id) {
  const { error } = await supabase.rpc('unpublish_grid_layout', { p_id: id });
  if (error) throw error;
}

// Which of MY templates are in the gallery, so a row offers Publish or Remove
// rather than both. Returns [] rather than throwing — publication state is
// decoration on the panel, and losing it should not cost the library.
export async function myGridLayoutPublications() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('my_grid_layout_publications');
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

// Anon-callable. Returns rows carrying `body`, because the gallery tile IS the
// geometry — rendering a preview needs no second round-trip and no thumbnail
// pipeline. Never returns who submitted it.
export async function listPublicGridLayouts(limit = 120) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_public_grid_layouts', { p_limit: limit });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// Copies a published template into my library. Same COPY semantics as a share
// link: a later takedown cannot reach into anyone's library.
export async function usePublicGridLayout(slug) {
  const { data, error } = await supabase.rpc('use_public_grid_layout', { p_slug: slug });
  if (error) throw error;
  return data || null;
}
