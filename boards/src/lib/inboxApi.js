// CRUD over the `inbox_items` table. The shape we serve up to the UI mirrors
// the prototype's INBOX_SEED items: top-level kind/source/when, payload merged
// in. The DB row stores the heavy stuff in `payload jsonb`.

import { supabase } from './supabase.js';

function rowToItem(row) {
  const p = row.payload || {};
  return {
    id: row.id,
    kind: row.kind,
    source: row.source || p.source || '',
    when: p.when || relativeTime(row.created_at),
    ...p,
  };
}

function relativeTime(iso) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  return `${d}d`;
}

export async function listInbox(workspaceId) {
  const { data, error } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToItem);
}

// `item` is the prototype-style object; we split off { kind, source } as
// columns and stuff the rest into payload jsonb.
export async function addInboxItem({ workspaceId, item, userId = null }) {
  const { id: _drop, ...payload } = item;
  const { data, error } = await supabase
    .from('inbox_items')
    .insert({
      workspace_id: workspaceId,
      kind: item.kind,
      source: item.source || null,
      from_user_id: userId,
      payload,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToItem(data);
}

export async function deleteInboxItem(id) {
  const { error } = await supabase.from('inbox_items').delete().eq('id', id);
  if (error) throw error;
}

// Bulk-seed a workspace's inbox from an array of prototype items. Used once
// during first-run bootstrap so the empty workspace has something draggable.
export async function seedInbox({ workspaceId, items, userId = null }) {
  if (!items || items.length === 0) return;
  const rows = items.map(item => {
    const { id: _drop, ...payload } = item;
    return {
      workspace_id: workspaceId,
      kind: item.kind,
      source: item.source || null,
      from_user_id: userId,
      payload,
    };
  });
  const { error } = await supabase.from('inbox_items').insert(rows);
  if (error) throw error;
}
