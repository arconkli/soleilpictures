// Board templates API. Save the current board's Y.Doc snapshot as a
// template, list available templates (self + workspace-shared), and
// spawn a fresh board from a template by copying the doc.

import * as Y from 'yjs';
import { supabase } from './supabase.js';

// Bytes column round-trips as base64 over PostgREST. Helper to encode/
// decode Uint8Array <-> base64 transparently.
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// Save a snapshot of the given Y.Doc as a new template.
//   scope: 'user' | 'workspace'
export async function saveBoardTemplate({ ydoc, name, workspaceId, scope = 'user', cover = null, createdBy }) {
  if (!ydoc) throw new Error('ydoc required');
  if (!name?.trim()) throw new Error('Template name required');
  if (!createdBy) throw new Error('createdBy required');
  if (scope === 'workspace' && !workspaceId) {
    throw new Error('workspaceId required for workspace-scoped templates');
  }
  const update = Y.encodeStateAsUpdate(ydoc);
  const { data, error } = await supabase.from('board_templates').insert({
    workspace_id: scope === 'workspace' ? workspaceId : null,
    name: name.trim(),
    cover,
    scope,
    doc: bytesToBase64(update),
    created_by: createdBy,
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function listBoardTemplates(workspaceId) {
  // RLS filters this naturally — caller gets back self + any workspace-
  // shared templates from workspaces they're a member of. We pass
  // workspaceId only as a hint when present so the fetch is scoped.
  let q = supabase.from('board_templates')
    .select('id, workspace_id, name, cover, scope, created_by, created_at')
    .order('created_at', { ascending: false });
  if (workspaceId) {
    q = q.or(`workspace_id.eq.${workspaceId},workspace_id.is.null`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function deleteBoardTemplate(id) {
  const { error } = await supabase.from('board_templates').delete().eq('id', id);
  if (error) throw error;
}

// Rename a template. RLS already restricts who can update — owners /
// editors of the template's workspace, and the template's own
// creator. Surfaced from the SettingsPanel Templates tab.
export async function renameBoardTemplate(id, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Template name required');
  const { error } = await supabase.from('board_templates')
    .update({ name: trimmed })
    .eq('id', id);
  if (error) throw error;
}

// Fetch a template's Y.Doc bytes for spawning a new board.
export async function getTemplateDocBytes(id) {
  const { data, error } = await supabase
    .from('board_templates')
    .select('doc')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.doc) return null;
  return base64ToBytes(data.doc);
}
