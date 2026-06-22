// Shared "what does this tag look like?" fetch.
//
// Given a tag, gather the VISUAL payoff — image thumbs, palette strips,
// and a few other tagged things — across the whole workspace, including
// images pulled transitively from tagged groups/boards (the AI can't see
// image content, so directly-tagged images are rare; the container is the
// realistic path). This powers the rich doc popover (TagRangeHoverPopover)
// AND the generic name-hover (EntityHoverPopover) so hovering a character
// or setting anywhere shows its look — the headline of the tags rework.
//
// Returns { images, palettes, other, total }. A small in-memory TTL cache
// keeps hover snappy: with the popover's ~250ms open delay + this cache,
// a re-hover is instant (no lag vs. the cheap @mention hover).

import { supabase } from './supabase.js';

const MAX_IMAGES = 120;
const MAX_PALETTES = 3;
// A concept/topic tag (e.g. "Pricing") has no images/palettes — its payoff
// IS the list of docs/notes/boards/cards. Keep this generous so the hover
// actually shows "all the stuff," not a truncated handful.
const MAX_OTHER = 12;
const FETCH_LIMIT = 80;
const IMAGES_PER_CONTAINER = 60;

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // `${workspaceId}:${tagId}` → { at, data }

const EMPTY = { images: [], palettes: [], other: [], total: 0, entityType: null };

export function invalidateTagVisuals(tagId, workspaceId) {
  if (tagId && workspaceId) cache.delete(`${workspaceId}:${tagId}`);
}

export async function fetchTagVisuals({ tagId, workspaceId } = {}) {
  if (!supabase || !workspaceId || !tagId) return EMPTY;

  const cacheKey = `${workspaceId}:${tagId}`;
  const hit = cache.get(cacheKey);
  if (hit && (performance.now() - hit.at) < CACHE_TTL_MS) return hit.data;

  try {
    const { data: links, count } = await supabase.from('entity_links')
      .select('source_kind, source_id, source_board_id, source_page_id', { count: 'exact' })
      .eq('source_workspace', workspaceId)
      .eq('target_kind', 'tag')
      .eq('target_id', tagId)
      .eq('link_kind', 'applied')
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT);

    const rows = links || [];
    const esIds = [];
    const pageIds = [];
    for (const r of rows) {
      if (r.source_kind === 'board') esIds.push(r.source_id);
      else if (r.source_kind === 'group') esIds.push(`${r.source_board_id}:g:${r.source_id}`);
      else if (r.source_kind === 'card' || r.source_kind === 'note') esIds.push(`${r.source_board_id}:${r.source_id}`);
      else if (r.source_kind === 'doc') {
        esIds.push(r.source_id);
        if (r.source_page_id) pageIds.push(r.source_page_id);
      }
    }

    const [esResp, pageResp, tagResp] = await Promise.all([
      esIds.length
        ? supabase.from('entity_search')
            .select('id, kind, title, body, meta, board_id, card_id')
            .eq('workspace_id', workspaceId)
            .in('id', esIds)
        : Promise.resolve({ data: [] }),
      pageIds.length
        ? supabase.from('doc_page_index')
            .select('doc_card_id, page_id, page_title')
            .in('page_id', pageIds)
        : Promise.resolve({ data: [] }),
      // The tag's semantic type (character/setting/concept/thing) so the
      // hover header can label it ("Topic", "Character", …).
      supabase.from('tags').select('entity_type').eq('id', tagId).maybeSingle(),
    ]);
    const byEs = new Map((esResp.data || []).map(r => [r.id, r]));
    const byPage = new Map((pageResp.data || []).map(r => [r.page_id, r]));
    const entityType = tagResp?.data?.entity_type || null;

    const seenKeys = new Set();
    // Dedup images by their card identity — the same image card might be
    // reachable directly AND via its tagged group; show it once.
    const seenImageCards = new Set();
    const seenPaletteCards = new Set();
    const images = [];
    const palettes = [];
    const other = [];
    const taggedGroups = []; // [{ boardId, groupId }]
    const taggedBoards = []; // [boardId]
    for (const r of rows) {
      if (r.source_kind === 'group' && r.source_board_id && r.source_id) {
        taggedGroups.push({ boardId: r.source_board_id, groupId: r.source_id });
      } else if (r.source_kind === 'board' && r.source_id) {
        taggedBoards.push(r.source_id);
      }
    }
    for (const r of rows) {
      let key, navTarget, hit2;
      if (r.source_kind === 'board') {
        hit2 = byEs.get(r.source_id);
        key = `board:${r.source_id}`;
        navTarget = { kind: 'board', id: r.source_id };
      } else if (r.source_kind === 'group') {
        hit2 = byEs.get(`${r.source_board_id}:g:${r.source_id}`);
        key = `group:${r.source_id}`;
        navTarget = { kind: 'board', id: r.source_board_id };
      } else if (r.source_kind === 'doc') {
        if (r.source_page_id) {
          const p = byPage.get(r.source_page_id);
          hit2 = { kind: 'doc', title: p?.page_title || 'Doc page', board_id: null, card_id: r.source_id, meta: null, body: null };
          key = `doc:${r.source_id}:${r.source_page_id}`;
          navTarget = { kind: 'doc', docCardId: r.source_id, pageId: r.source_page_id };
        } else {
          hit2 = byEs.get(r.source_id);
          key = `doc:${r.source_id}`;
          navTarget = { kind: 'doc', docCardId: r.source_id };
        }
      } else {
        hit2 = byEs.get(`${r.source_board_id}:${r.source_id}`);
        key = `${r.source_kind}:${r.source_board_id}:${r.source_id}`;
        navTarget = { kind: r.source_kind, boardId: r.source_board_id, cardId: r.source_id };
      }
      if (!hit2) continue;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const meta = hit2.meta || null;
      const title = (hit2.title || '').trim() || (hit2.body || '').trim().slice(0, 40);

      if (hit2.kind === 'image' && meta?.src) {
        const cardKey = `${hit2.board_id || r.source_board_id}:${hit2.card_id || r.source_id}`;
        if (!seenImageCards.has(cardKey) && images.length < MAX_IMAGES) {
          seenImageCards.add(cardKey);
          images.push({ src: meta.src, title, navTarget });
        }
        continue;
      }
      if (hit2.kind === 'palette' && Array.isArray(meta?.swatches) && meta.swatches.length) {
        if (palettes.length < MAX_PALETTES) {
          seenPaletteCards.add(`${hit2.board_id || r.source_board_id}:${hit2.card_id || r.source_id}`);
          palettes.push({ swatches: meta.swatches, title, navTarget });
        }
        continue;
      }
      if (!title) continue;
      if (other.length < MAX_OTHER) {
        // A short preview line for text-y "other" rows (docs/notes/cards) —
        // for a Topic tag this list IS the payoff, so a snippet beats a bare
        // title. Only when there's a real title (else `title` is already a
        // body slice and the snippet would just duplicate it).
        const snippet = (hit2.title || '').trim()
          ? (hit2.body || '').trim().slice(0, 90)
          : '';
        other.push({ kind: hit2.kind || r.source_kind, title, navTarget, snippet });
      }
    }

    // Transitive pass: tagged groups/boards pull in their image AND palette
    // cards. Direct tags on individual cards are rare, so the container is
    // the realistic path for BOTH — palettes previously had no recovery, so
    // the strip was almost always empty even when the tagged group/board was
    // full of palettes.
    if (taggedGroups.length || taggedBoards.length) {
      const imgQueries = [
        ...taggedGroups.map(g => supabase.from('card_index')
          .select('board_id, card_id, title, meta')
          .eq('workspace_id', workspaceId).eq('board_id', g.boardId).eq('kind', 'image')
          .filter('meta->>groupId', 'eq', g.groupId).limit(IMAGES_PER_CONTAINER)),
        ...taggedBoards.map(b => supabase.from('card_index')
          .select('board_id, card_id, title, meta')
          .eq('workspace_id', workspaceId).eq('board_id', b).eq('kind', 'image')
          .limit(IMAGES_PER_CONTAINER)),
      ];
      const needPalettes = palettes.length < MAX_PALETTES;
      const palQueries = !needPalettes ? [] : [
        ...taggedGroups.map(g => supabase.from('card_index')
          .select('board_id, card_id, title, meta')
          .eq('workspace_id', workspaceId).eq('board_id', g.boardId).eq('kind', 'palette')
          .filter('meta->>groupId', 'eq', g.groupId).limit(IMAGES_PER_CONTAINER)),
        ...taggedBoards.map(b => supabase.from('card_index')
          .select('board_id, card_id, title, meta')
          .eq('workspace_id', workspaceId).eq('board_id', b).eq('kind', 'palette')
          .limit(IMAGES_PER_CONTAINER)),
      ];
      const all = await Promise.all([...imgQueries, ...palQueries]);
      const imgResponses = all.slice(0, imgQueries.length);
      const palResponses = all.slice(imgQueries.length);
      const candidates = [];
      for (const resp of imgResponses) {
        for (const c of (resp.data || [])) candidates.push(c);
      }
      // Recover any missing meta.src in one batched lookup so the popover
      // works without first visiting the source board.
      const missingCardIds = candidates
        .filter(c => !c.meta?.src && c.card_id)
        .map(c => c.card_id);
      const srcByCardId = new Map();
      if (missingCardIds.length > 0) {
        try {
          const { data: imgRows } = await supabase.from('images')
            .select('card_id, board_id, storage_path')
            .eq('workspace_id', workspaceId)
            .in('card_id', missingCardIds);
          for (const r of (imgRows || [])) {
            if (r.card_id && r.storage_path) {
              srcByCardId.set(`${r.board_id}:${r.card_id}`, r.storage_path);
            }
          }
        } catch (_) { /* leave missing src as-is */ }
      }
      for (const c of candidates) {
        if (images.length >= MAX_IMAGES) break;
        let src = c.meta?.src;
        if (!src) {
          const sp = srcByCardId.get(`${c.board_id}:${c.card_id}`);
          if (sp) src = `r2:${sp}`;
        }
        if (!src) continue;
        const cardKey = `${c.board_id}:${c.card_id}`;
        if (seenImageCards.has(cardKey)) continue;
        seenImageCards.add(cardKey);
        images.push({
          src,
          title: c.title || '',
          navTarget: { kind: 'image', boardId: c.board_id, cardId: c.card_id },
        });
      }

      // Palette recovery from the same containers — same idea as images.
      for (const resp of palResponses) {
        for (const c of (resp.data || [])) {
          if (palettes.length >= MAX_PALETTES) break;
          if (!Array.isArray(c.meta?.swatches) || !c.meta.swatches.length) continue;
          const pcardKey = `${c.board_id}:${c.card_id}`;
          if (seenPaletteCards.has(pcardKey)) continue;
          seenPaletteCards.add(pcardKey);
          palettes.push({
            swatches: c.meta.swatches,
            title: c.title || '',
            navTarget: { kind: 'palette', boardId: c.board_id, cardId: c.card_id },
          });
        }
      }
    }

    const data = { images, palettes, other, total: count ?? rows.length, entityType };
    cache.set(cacheKey, { at: performance.now(), data });
    return data;
  } catch (_) {
    return EMPTY;
  }
}
