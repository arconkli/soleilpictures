// Client-side helper for writing entity_links rows from any source
// (doc save, note save, card title rename). Messages are handled by
// the messages_record_entity_links trigger — don't call this from
// message inserts; that path is server-side.
//
// Usage:
//   await recordEntityLinks({
//     source: { kind:'doc', id: docCardId, workspace, boardId, pageId, linkId? },
//     refs: [{ ref: <EntityRef>, contextText? }, ...],
//     replaceForSource?: true   // wipe prior rows for (kind,id[,pageId,linkId]) first
//   });

import { supabase } from './supabase.js';

export async function recordEntityLinks({
  source, refs = [], replaceForSource = false,
  linkKind = 'mention',                  // 'mention' (default) | 'applied' | 'reply' | 'attached'
  attribution = 'user',                  // 'user' | 'auto' | 'ai'
  replaceTargetKind = null,              // narrow the replace-scope to one target kind
  replaceSourceAttribution = null,       // narrow the replace-scope by source attribution
}) {
  if (!supabase || !source?.kind || !source?.id || !source?.workspace) return;
  const filtered = (refs || []).filter(r => r && r.ref && r.ref.kind);

  // Wipe prior rows for this source so updates re-stamp cleanly.
  // Scope the delete by (kind, id, [pageId,linkId], link_kind) so
  // unrelated sources on the same doc card aren't touched. Optional
  // target-kind + attribution scoping lets two flows (manual links,
  // auto-detected tag mentions) coexist on the same (doc,page) without
  // one wiping the other.
  if (replaceForSource) {
    let q = supabase.from('entity_links').delete()
      .eq('source_kind', source.kind)
      .eq('source_id', String(source.id))
      .eq('link_kind', linkKind);
    if (source.pageId) q = q.eq('source_page_id', source.pageId);
    if (source.linkId) q = q.eq('source_link_id', source.linkId);
    if (replaceTargetKind) q = q.eq('target_kind', replaceTargetKind);
    if (replaceSourceAttribution) q = q.eq('source', replaceSourceAttribution);
    await q;
  }

  if (filtered.length === 0) return;

  const rows = filtered.map(({ ref, contextText }) => ({
    source_kind: source.kind,
    source_id: String(source.id),
    source_workspace: source.workspace,
    source_board_id: source.boardId || null,
    source_page_id: source.pageId || null,
    source_link_id: source.linkId || null,
    context_text: contextText ? String(contextText).slice(0, 500) : null,
    link_kind: linkKind,
    source: attribution,
    ...refToTargetCols(ref),
  })).filter(r => r.target_kind);

  if (rows.length === 0) return;
  const { error } = await supabase.from('entity_links').upsert(rows, {
    onConflict: 'source_kind,source_id,source_page_id,source_link_id,link_kind,target_kind,target_id,target_board_id,target_card_id,target_doc_card_id,target_page_id,target_url',
    ignoreDuplicates: true,
  });
  if (error && error.code !== '23505') {
    await supabase.from('entity_links').insert(rows).then(() => {}).catch(() => {});
  }
}

function refToTargetCols(ref) {
  switch (ref.kind) {
    case 'board':
      return { target_kind: 'board', target_id: ref.id || null, target_board_id: ref.id || null };
    case 'card':
      return { target_kind: 'card', target_board_id: ref.boardId || null, target_card_id: ref.cardId || null };
    case 'doc':
      return { target_kind: 'doc', target_doc_card_id: ref.docCardId || null };
    case 'docPos':
      return {
        target_kind: 'docPos',
        target_doc_card_id: ref.docCardId || null,
        target_page_id: ref.pageId || null,
        target_anchor: ref.anchor || null,
      };
    case 'message':
      return { target_kind: 'message', target_id: ref.id || null };
    case 'user':
      return { target_kind: 'user', target_id: ref.id || null };
    case 'url':
      return { target_kind: 'url', target_url: ref.href || null };
    case 'tag':
      // Tag id IS the uuid we stored; goes into target_id like board/user/message.
      return { target_kind: 'tag', target_id: ref.id || null };
    default:
      return {};
  }
}
