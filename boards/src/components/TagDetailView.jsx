// "Tag detail" surface — a scroll-through preview of every board,
// group, and card carrying this tag. Layout is a HIERARCHY rather
// than a flat list:
//
//   [Pricing board]
//     ├─ Personal Pricing  (tagged group)
//     │   • Free / 10GB of space
//     │   • $10 mo / 100GB
//     │   • $25 mo / unlimited
//     ├─ Business Pricing  (tagged group)
//     │   • $8 / per user
//     │   • $20 / per user
//     └─ School Pricing  (tagged group)
//         • $12 / per user
//
// Every item title is clickable (navigates to the source) and
// right-clickable (Remove tag / Confirm / Don't suggest again).
// A filter pill at the top toggles between All / Auto / Manual.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { setTagDescription, setTagEntityType } from '../lib/tagsApi.js';
import { tagFallbackColor } from '../lib/tagColor.js';
import { Icon } from './Icon.jsx';
import { LayoutGrid, FileText, StickyNote, Image, Palette, Calendar, Link as LinkIcon } from '../lib/icons.js';
import { ENTITY_TYPES, entityTypeLabel } from '../lib/entityTypes.js';
import {
  untagCard, untagBoard, untagGroup,
  confirmAppliedTag, dismissAutotagSuggestion,
  tagCard, tagGroup, tagBoard, tagDocPage,
} from '../lib/tagsApi.js';
import { useFeedback } from './AppFeedback.jsx';
import { getKind } from '../lib/entityKinds.js';
import { ImageLightbox } from './ImageLightbox.jsx';
import { R2Image } from './R2Image.jsx';
import { fetchTagVisuals } from '../lib/tagVisuals.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// Patch missing meta.src on image-kind card_index rows by looking up
// `images.storage_path` via card_id. card_index.meta.src is populated
// by the board's Y.Doc sync, which only runs while the board is open
// — so for a tag detail view opened cold (without visiting the source
// board) the image thumbnails would otherwise be invisible until the
// next sync runs. The images table is the upload-of-record and has
// card_id post-migration 0042, so we can join at query time.
async function recoverImageSrc(rows, workspaceId) {
  if (!workspaceId || !Array.isArray(rows) || rows.length === 0) return rows;
  const missing = rows.filter(c => c?.kind === 'image' && !c?.meta?.src && c?.card_id);
  if (missing.length === 0) return rows;
  try {
    const { data: imgRows } = await supabase.from('images')
      .select('card_id, board_id, storage_path')
      .eq('workspace_id', workspaceId)
      .in('card_id', missing.map(c => c.card_id));
    if (!imgRows?.length) return rows;
    const byKey = new Map();
    for (const r of imgRows) {
      if (r.card_id && r.storage_path) byKey.set(`${r.board_id}:${r.card_id}`, r.storage_path);
    }
    return rows.map(c => {
      if (c?.kind !== 'image' || c?.meta?.src) return c;
      const sp = byKey.get(`${c.board_id}:${c.card_id}`);
      if (!sp) return c;
      return { ...c, meta: { ...(c.meta || {}), src: `r2:${sp}` } };
    });
  } catch (_) {
    return rows;
  }
}

const KIND_ICON = {
  board: LayoutGrid, doc: FileText, group: LayoutGrid,
  card: StickyNote, note: StickyNote, image: Image,
  palette: Palette, schedule: Calendar, link: LinkIcon,
};

function kindIcon(kind) { return KIND_ICON[kind] || StickyNote; }

function itemExcerpt(it) {
  const title = (it.title || '').trim();
  if (title) return title;
  const body = (it.body || it.card_body || '').trim();
  if (body) return body.length > 100 ? body.slice(0, 97) + '…' : body;
  return null;
}

// Inline editor for a tag's description. The AI tagger reads this when
// deciding whether the tag applies — gives workspaces a way to disambiguate
// tags whose names are too generic (e.g. "Cast" the film term vs "cast"
// the verb) without retraining anything.
function TagDescriptionRow({ tag }) {
  const [value, setValue] = useState(tag?.description || '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [editing, setEditing] = useState(false);
  useEffect(() => { setValue(tag?.description || ''); }, [tag?.id, tag?.description]);
  if (!tag?.id) return null;
  const commit = async () => {
    setEditing(false);
    if ((value || '').trim() === (tag.description || '').trim()) return;
    setSaving(true);
    try {
      await setTagDescription(tag.id, value);
      setSavedAt(Date.now());
    } catch (e) {
      console.warn('[tag] description save failed', e);
    } finally {
      setSaving(false);
    }
  };
  const placeholder = 'Describe what this tag means — the AI uses this to decide when to apply it.';
  return (
    <div className="tag-detail-description">
      {editing ? (
        <textarea
          autoFocus
          className="tag-detail-description-input"
          value={value}
          maxLength={500}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setValue(tag?.description || ''); setEditing(false); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
          }}
        />
      ) : (
        <button className={`tag-detail-description-display ${value ? '' : 'is-empty'}`}
                onClick={() => setEditing(true)}
                title="Click to edit (the AI reads this)">
          {value || placeholder}
        </button>
      )}
      <div className="tag-detail-description-meta">
        {saving ? 'Saving…' : (savedAt && Date.now() - savedAt < 2000 ? 'Saved' : `${value.length}/500`)}
      </div>
    </div>
  );
}

export function TagDetailView({ tag, workspaceId, userId, onOpenItem, onClose }) {
  const feedback = useFeedback();
  const [rows, setRows] = useState([]);
  const [boardCards, setBoardCards] = useState(new Map());
  const [groupCards, setGroupCards] = useState(new Map());
  const [mentions, setMentions] = useState([]);   // [{ doc_card_id, page_id, page_title, context_text }]
  const [loading, setLoading] = useState(true);
  // Lightbox state — image clicks open it instead of navigating to
  // the source board. The index points into imageCardsFlat (derived
  // below) so arrow keys can flip through the tag's whole image set.
  const [lightboxIdx, setLightboxIdx] = useState(null);
  // Filter: 'all' | 'auto' | 'user' | 'suggested'. Stored in localStorage
  // so the user's choice persists across reloads / tab switches.
  // 'suggested' shows the per-tag inbox of middle-band cosine matches
  // pending accept/dismiss — see boards/supabase/migrations/0043.
  const [sourceFilter, setSourceFilter] = useState(() => {
    if (typeof localStorage === 'undefined') return 'all';
    try {
      const v = localStorage.getItem('soleil.tags.detail.filter');
      return (v === 'auto' || v === 'user') ? v : 'all';
    } catch (_) { return 'all'; }
  });
  const setFilter = (v) => {
    setSourceFilter(v);
    try { localStorage.setItem('soleil.tags.detail.filter', v); } catch (_) {}
  };

  // Pending suggestions for the per-tag inbox. Fetched on mount + whenever
  // the tag changes. Realtime keeps it fresh as the AI tagger writes new
  // rows and the user accepts/dismisses.
  const [suggestions, setSuggestions] = useState([]); // [{ tag_id, source_kind, source_id, board_id, distance, title?, ... }]
  // Type filter: 'all' or any card kind ('image', 'palette', 'note',
  // 'card', 'doc', 'link', 'schedule', 'board', 'group'). Stored per-tag
  // would be excessive — keep it per-tag-detail session as a single
  // global preference (matches the source filter behavior).
  const [typeFilter, setTypeFilter] = useState(() => {
    if (typeof localStorage === 'undefined') return 'all';
    try { return localStorage.getItem('soleil.tags.detail.typefilter') || 'all'; }
    catch (_) { return 'all'; }
  });
  const setTypeFilterPersist = (v) => {
    setTypeFilter(v);
    try { localStorage.setItem('soleil.tags.detail.typefilter', v); } catch (_) {}
  };
  // Right-click menu state.
  const [menu, setMenu] = useState(null); // { x, y, kind, id, boardId, source }
  useEffect(() => {
    if (!menu) return;
    const onAway = (e) => { if (!e.target.closest?.('.tag-detail-menu')) setMenu(null); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', onAway, { capture: true });
    window.addEventListener('mousedown', onAway, { capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onAway, { capture: true });
      window.removeEventListener('mousedown', onAway, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // ── Entity identity (hero) ────────────────────────────────────────────
  // The visual payoff (cross-board images + palettes) that makes a tag read
  // as an ENTITY, not a filtered list. Shares fetchTagVisuals with the hover
  // popover so they stay in lockstep. `entityType` is local+optimistic so the
  // one-tap type switch feels instant before the workspace tags refresh.
  const [vis, setVis] = useState(null);
  const [entityType, setEntityType] = useState(tag?.entity_type || null);
  const [manageOpen, setManageOpen] = useState(false);
  useEffect(() => { setEntityType(tag?.entity_type || null); }, [tag?.id, tag?.entity_type]);
  useEffect(() => {
    if (!tag?.id || !workspaceId) { setVis(null); return; }
    let cancelled = false;
    fetchTagVisuals({ tagId: tag.id, workspaceId }).then(r => { if (!cancelled) setVis(r); });
    return () => { cancelled = true; };
  }, [tag?.id, workspaceId]);
  const changeType = async (val) => {
    const prev = entityType;
    const next = val === entityType ? null : val; // tap the active type to clear it
    setEntityType(next);
    try {
      await setTagEntityType(tag.id, next);
      try { logEvent(EV.TAG_SET_TYPE, { tag_id: tag.id, entity_type: next }); } catch (_) {}
    } catch (err) {
      setEntityType(prev);
      feedback?.toast?.({ type: 'error', message: 'Could not set type' });
    }
  };

  useEffect(() => {
    if (!tag?.id) { setRows([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    supabase.rpc('get_things_tagged', { p_tag_id: tag.id, p_limit: 300 })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.warn('[tags] get_things_tagged failed', error); setRows([]); }
        else { setRows(Array.isArray(data) ? data : []); }
      })
      .catch(err => { console.warn('[tags] get_things_tagged failed', err); })
      .finally(() => { if (!cancelled) setLoading(false); });

    // Mentions: docs / pages that reference this tag in their body
    // text. Surfaced as a separate "Mentioned in" list under the
    // primary applied items so the tag page reads like connective
    // tissue across the workspace, not just an apply list.
    //
    // ALSO loads doc-page APPLIED rows (link_kind='applied' for doc
    // sources) so AI-applied doc pages appear here too — title +
    // snippet preview, distinct from card/group/board hierarchy.
    const loadMentions = () => {
      return supabase.from('entity_links')
        .select('source_kind, source_id, source_page_id, context_text, link_kind')
        .eq('target_kind', 'tag')
        .eq('target_id', tag.id)
        .in('link_kind', ['mention', 'applied'])
        .eq('source_kind', 'doc')
        .then(async ({ data, error }) => {
          if (cancelled) return;
          if (error) { console.warn('[tags] mentions fetch failed', error); setMentions([]); return; }
          const links = data || [];
          if (links.length === 0) { setMentions([]); return; }
          // Hydrate doc titles. Group page lookups by doc_card_id.
          const docIds = Array.from(new Set(links.filter(l => l.source_kind === 'doc').map(l => l.source_id)));
          const pageIds = links.filter(l => l.source_page_id).map(l => l.source_page_id);
          let pageTitleById = new Map();
          let docTitleById = new Map();
          if (pageIds.length > 0) {
            const { data: pages } = await supabase.from('doc_page_index')
              .select('doc_card_id, page_id, page_title')
              .in('page_id', pageIds);
            for (const p of (pages || [])) pageTitleById.set(p.page_id, p.page_title);
          }
          if (docIds.length > 0) {
            const { data: docs } = await supabase.from('card_index')
              .select('card_id, board_id, title')
              .in('card_id', docIds);
            for (const d of (docs || [])) docTitleById.set(d.card_id, { title: d.title, board_id: d.board_id });
          }
          // Dedupe by (doc, page) — a page with multiple AI word
          // applies for the same tag should show once, with the
          // snippets joined into a single preview.
          const groupedByPage = new Map();
          for (const l of links) {
            const k = `${l.source_id}::${l.source_page_id || ''}`;
            if (!groupedByPage.has(k)) {
              groupedByPage.set(k, {
                kind: l.source_kind,
                doc_card_id: l.source_id,
                page_id: l.source_page_id,
                page_title: l.source_page_id ? (pageTitleById.get(l.source_page_id) || '') : '',
                doc_title: docTitleById.get(l.source_id)?.title || '',
                board_id: docTitleById.get(l.source_id)?.board_id || null,
                contexts: [],
              });
            }
            const t = (l.context_text || '').trim();
            if (t) groupedByPage.get(k).contexts.push(t);
          }
          const hydrated = [...groupedByPage.values()].map(g => ({
            ...g,
            // Up to 2 distinct snippets per page, joined with a separator.
            context_text: [...new Set(g.contexts)].slice(0, 2).join('  ·  '),
          }));
          setMentions(hydrated);
        });
    };
    loadMentions();

    // Pending suggestions for this tag — the per-tag inbox in the
    // Suggested filter. dismissed_at IS NULL filters out tombstones.
    const loadSuggestions = async () => {
      const { data, error } = await supabase
        .from('tag_suggestions')
        .select('tag_id, source_kind, source_id, board_id, doc_card_id, distance, created_at')
        .eq('tag_id', tag.id)
        .is('dismissed_at', null)
        .order('distance', { ascending: true })
        .limit(200);
      if (cancelled) return;
      if (error) { console.warn('[tags] tag_suggestions load failed', error); setSuggestions([]); return; }
      // Hydrate titles for card sources (the common case) so the inbox
      // shows something readable rather than a bare uuid.
      const rows = data || [];
      const cardIds = rows.filter(r => r.source_kind === 'card').map(r => r.source_id);
      let cardTitleById = new Map();
      if (cardIds.length > 0) {
        const { data: idx } = await supabase.from('card_index')
          .select('card_id, board_id, kind, title, body, meta')
          .in('card_id', cardIds);
        for (const c of (idx || [])) cardTitleById.set(c.card_id, c);
      }
      if (cancelled) return;
      setSuggestions(rows.map(r => {
        const card = r.source_kind === 'card' ? cardTitleById.get(r.source_id) : null;
        return {
          ...r,
          title: card?.title || null,
          body: card?.body || null,
          card_kind: card?.kind || null,
          board_id: r.board_id || card?.board_id || null,
        };
      }));
    };
    loadSuggestions();

    const sfx = Math.random().toString(36).slice(2, 9);
    const chan = supabase.channel(`tag-detail:${tag.id}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'entity_links',
      }, (payload) => {
        const n = payload?.new || {};
        const o = payload?.old || {};
        const isApplied =
          (n.target_kind === 'tag' && n.target_id === tag.id && n.link_kind === 'applied') ||
          (o.target_kind === 'tag' && o.target_id === tag.id && o.link_kind === 'applied');
        const isMention =
          (n.target_kind === 'tag' && n.target_id === tag.id && (n.link_kind === 'mention' || (n.link_kind === 'applied' && n.source_kind === 'doc'))) ||
          (o.target_kind === 'tag' && o.target_id === tag.id && (o.link_kind === 'mention' || (o.link_kind === 'applied' && o.source_kind === 'doc')));
        if (isApplied) {
          supabase.rpc('get_things_tagged', { p_tag_id: tag.id, p_limit: 300 })
            .then(({ data }) => { if (!cancelled) setRows(Array.isArray(data) ? data : []); })
            .catch(() => {});
        }
        if (isMention) loadMentions();
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tag_suggestions',
      }, (payload) => {
        const n = payload?.new || {};
        const o = payload?.old || {};
        if (n.tag_id === tag.id || o.tag_id === tag.id) loadSuggestions();
      })
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(chan); } catch (_) {}
    };
  }, [tag?.id]);

  // Filtered rows by source. Filter applies to directly-tagged items
  // only — child previews are content, not tag applications.
  const filteredRows = useMemo(() => {
    if (sourceFilter === 'all') return rows;
    return rows.filter(r => {
      const src = r.applied_source || 'user';
      if (sourceFilter === 'user') return src === 'user';
      if (sourceFilter === 'auto') return src !== 'user';
      return true;
    });
  }, [rows, sourceFilter]);

  const direct = useMemo(() => {
    const out = { boards: [], groups: [], cards: [] };
    for (const r of filteredRows) {
      if (r.kind === 'board') out.boards.push(r);
      else if (r.kind === 'group') out.groups.push(r);
      else out.cards.push(r);
    }
    return out;
  }, [filteredRows]);

  const hasOwnText = (c) =>
    (c.title && c.title.trim().length > 0) ||
    (c.body  && c.body.trim().length  > 0);
  // Image and palette cards are visual — their content IS the
  // thumbnail / swatches — so they should pass the inclusion gate
  // even when they have no title or body. Without this check,
  // an image-heavy group tagged for a character would render as
  // empty in the tag detail view.
  const passesContentGate = (c) =>
    c.kind === 'image' || c.kind === 'palette' || hasOwnText(c);

  // Keep these queries on the UNFILTERED boards/groups so changing
  // the filter doesn't re-fetch. The filter is purely a render gate.
  const allBoards = useMemo(() => rows.filter(r => r.kind === 'board'), [rows]);
  const allGroups = useMemo(() => rows.filter(r => r.kind === 'group'), [rows]);

  useEffect(() => {
    if (allBoards.length === 0) return;
    let cancelled = false;
    const ids = allBoards.map(b => b.board_id || b.id).filter(Boolean);
    if (ids.length === 0) return;
    (async () => {
      const { data } = await supabase.from('card_index')
        .select('board_id, card_id, kind, title, body, meta, updated_at')
        .in('board_id', ids)
        .order('updated_at', { ascending: false });
      if (cancelled) return;
      const patched = await recoverImageSrc(data || [], workspaceId);
      if (cancelled) return;
      const m = new Map();
      for (const c of patched) {
        if (!passesContentGate(c)) continue;
        if (!m.has(c.board_id)) m.set(c.board_id, []);
        m.get(c.board_id).push(c);
      }
      setBoardCards(m);
    })();
    return () => { cancelled = true; };
  }, [allBoards, workspaceId]);

  useEffect(() => {
    if (allGroups.length === 0) return;
    let cancelled = false;
    const allBoardIds = allGroups.map(g => g.board_id).filter(Boolean);
    if (allBoardIds.length === 0) return;
    (async () => {
      const { data } = await supabase.from('card_index')
        .select('board_id, card_id, kind, title, body, meta, updated_at')
        .in('board_id', allBoardIds);
      if (cancelled) return;
      const patched = await recoverImageSrc(data || [], workspaceId);
      if (cancelled) return;
      const m = new Map();
      for (const c of patched) {
        if (!passesContentGate(c)) continue;
        const gid = c.meta?.groupId;
        if (!gid) continue;
        const key = `${c.board_id}::${gid}`;
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(c);
      }
      setGroupCards(m);
    })();
    return () => { cancelled = true; };
  }, [allGroups, workspaceId]);

  if (!tag) return null;
  const dot = tag.color || tagFallbackColor(tag.slug || tag.name);

  // Index for "is this card directly tagged" lookup — controls
  // whether the right-click menu offers Remove vs nothing.
  const directCardKey = (boardId, cardId) => `${boardId}:${cardId}`;
  const directCardSet = useMemo(() => {
    const s = new Map(); // key -> applied_source
    for (const c of (direct.cards || [])) {
      const k = directCardKey(c.board_id, c.card_id);
      s.set(k, c.applied_source || 'user');
    }
    return s;
  }, [direct.cards]);

  // ── Actions ─────────────────────────────────────────────────────────────
  // Remove always dismisses too. Otherwise the autotag triggers
  // re-apply the tag on the next card_index UPDATE if the text
  // word-matches — making "Remove tag" pointless. Dismissing on
  // remove makes the action stick. To bring the tag back, just
  // manually re-tag the item; the user-application path clears the
  // dismissal so it doesn't get filtered next round.
  const removeTag = async (target) => {
    try {
      const targetKind = target.kind === 'group' ? 'group' :
                         target.kind === 'board' ? 'board' : 'card';
      if (targetKind === 'card') {
        await untagCard({ boardId: target.boardId, cardId: target.id, tagId: tag.id });
      } else if (targetKind === 'board') {
        await untagBoard({ boardId: target.id, tagId: tag.id });
      } else if (targetKind === 'group') {
        await untagGroup({ boardId: target.boardId, groupId: target.id, tagId: tag.id });
      }
      await dismissAutotagSuggestion({
        workspaceId: workspaceId || tag.workspace_id,
        targetKind, targetId: target.id, tagId: tag.id, userId,
      });
    } catch (err) {
      feedback?.toast?.({ type: 'error', message: 'Remove failed: ' + (err.message || err) });
    }
  };

  // ── Suggestion inbox actions ────────────────────────────────────────────
  // Accept a suggestion → apply the tag via the right kind helper, then
  // delete the suggestion row (the entity_links INSERT becomes the
  // permanent record; the suggestion is consumed).
  const acceptSuggestion = async (s) => {
    try {
      if (s.source_kind === 'card') {
        await tagCard({
          workspaceId, boardId: s.board_id, cardId: s.source_id,
          tagId: tag.id, source: 'user',
        });
      } else if (s.source_kind === 'group') {
        await tagGroup({
          workspaceId, boardId: s.board_id, groupId: s.source_id,
          tagId: tag.id, source: 'user',
        });
      } else if (s.source_kind === 'board') {
        await tagBoard({
          workspaceId, boardId: s.source_id,
          tagId: tag.id, source: 'user',
        });
      } else if (s.source_kind === 'doc-page') {
        await tagDocPage({
          workspaceId, docCardId: s.doc_card_id, pageId: s.source_id,
          boardId: s.board_id || null, tagId: tag.id, source: 'user',
        });
      }
      await supabase.from('tag_suggestions')
        .delete()
        .eq('tag_id', tag.id)
        .eq('source_kind', s.source_kind)
        .eq('source_id', s.source_id);
      // Optimistic local update — realtime will catch up too.
      setSuggestions(prev => prev.filter(p => !(p.source_kind === s.source_kind && p.source_id === s.source_id)));
    } catch (err) {
      feedback?.toast?.({ type: 'error', message: 'Accept failed: ' + (err.message || err) });
    }
  };

  // Dismiss → tombstone forever. The (tag_id, source_kind, source_id)
  // row stays in the table with dismissed_at set so future scoring
  // passes skip it (the ignoreDuplicates upsert won't overwrite).
  const dismissSuggestion = async (s) => {
    try {
      await supabase.from('tag_suggestions')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('tag_id', tag.id)
        .eq('source_kind', s.source_kind)
        .eq('source_id', s.source_id);
      setSuggestions(prev => prev.filter(p => !(p.source_kind === s.source_kind && p.source_id === s.source_id)));
    } catch (err) {
      feedback?.toast?.({ type: 'error', message: 'Dismiss failed: ' + (err.message || err) });
    }
  };

  const confirmTag = async (target) => {
    try {
      const sourceKind = target.kind === 'group' ? 'group' :
                         target.kind === 'board' ? 'board' : 'card';
      const sourceBoardId = sourceKind === 'card' ? target.boardId :
                            sourceKind === 'group' ? target.boardId : null;
      await confirmAppliedTag({ sourceKind, sourceId: target.id, sourceBoardId, tagId: tag.id });
    } catch (err) {
      feedback?.toast?.({ type: 'error', message: 'Confirm failed: ' + (err.message || err) });
    }
  };

  const navigate = (target) => {
    onOpenItem?.(target);
  };

  const openMenu = (e, target) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ ...target, x: e.clientX, y: e.clientY });
  };

  // ── Render helpers ──────────────────────────────────────────────────────

  const renderCardPreview = (c) => {
    const Icn = kindIcon(c.kind);
    const excerpt = itemExcerpt(c);
    const dKey = directCardKey(c.board_id, c.card_id);
    const directSource = directCardSet.get(dKey); // undefined if not tagged
    const navTarget = {
      kind: c.kind, id: `${c.board_id}:${c.card_id}`,
      board_id: c.board_id, card_id: c.card_id,
    };
    const menuTarget = {
      kind: c.kind, id: c.card_id, boardId: c.board_id,
      source: directSource, // null if it's a child preview, not directly tagged
    };
    // Pull the registry's rich preview ONLY for visual kinds
    // (image, palette). Text kinds (note / card / doc) have a
    // previewMini that re-renders the body, which would duplicate
    // the meta-row excerpt below.
    const def = getKind(c.kind);
    const isVisualKind = c.kind === 'image' || c.kind === 'palette';
    const richPreview = isVisualKind ? (def?.previewMini?.(c) || null) : null;
    // Image cards open the fullscreen lightbox in-place instead of
    // navigating to the source board — the user is browsing the tag,
    // not trying to leave it. Other kinds (palette, doc, note...)
    // still navigate as before.
    const openLightboxAt = () => {
      const idx = imageCardsFlat.findIndex(
        x => x.board_id === c.board_id && x.card_id === c.card_id,
      );
      if (idx >= 0) setLightboxIdx(idx);
      else navigate(navTarget);
    };
    const onPreviewClick = (c.kind === 'image' && c.meta?.src)
      ? openLightboxAt
      : () => navigate(navTarget);
    return (
      <button key={`c:${c.board_id}:${c.card_id}`}
              className={`tag-detail-card-preview ${isVisualKind ? 'is-visual' : ''} ${richPreview ? 'has-rich' : ''}`}
              title={c.kind === 'image' && c.meta?.src
                ? 'Click to preview · right-click for actions'
                : 'Click to open · right-click for actions'}
              onClick={onPreviewClick}
              onContextMenu={(e) => openMenu(e, menuTarget)}>
        {richPreview && (
          <div className="tag-detail-card-preview-rich">{richPreview}</div>
        )}
        <div className="tag-detail-card-preview-meta">
          <span className="tag-detail-card-preview-kind">
            <Icon as={Icn} size={11} />
          </span>
          <span className="tag-detail-card-preview-text">
            {excerpt || (isVisualKind
              ? null
              : <span className="tag-detail-card-preview-empty">empty {c.kind}</span>)}
          </span>
          {directSource && directSource !== 'user' && (
            <span className="tag-detail-card-preview-badge">{directSource}</span>
          )}
        </div>
      </button>
    );
  };

  const renderGroupBlock = (g, opts = {}) => {
    const key = `${g.board_id}::${g.group_id || g.id}`;
    const cards = groupCards.get(key) || [];
    const sourceBadge = g.applied_source && g.applied_source !== 'user' ? g.applied_source : null;
    const navTarget = { kind: 'board', id: g.board_id, board_id: g.board_id };
    const menuTarget = {
      kind: 'group', id: g.group_id || g.id, boardId: g.board_id,
      source: g.applied_source || 'user',
    };
    return (
      <div key={`grp:${key}`} className="tag-detail-group-block">
        <div className="tag-detail-block-head">
          <Icon as={LayoutGrid} size={12} />
          <button className="tag-detail-block-title-link"
                  title="Click to open the parent board · right-click for actions"
                  onClick={() => navigate(navTarget)}
                  onContextMenu={(e) => openMenu(e, menuTarget)}>
            {g.title || 'Group'}
          </button>
          {opts.boardCrumb && g.board_name && (
            <span className="tag-detail-block-crumb">{g.board_name}</span>
          )}
          {g.member_count != null && (
            <span className="tag-detail-block-attr is-count">{g.member_count}</span>
          )}
          {sourceBadge && (
            <span className={`tag-detail-block-attr is-${sourceBadge}`}>{sourceBadge}</span>
          )}
        </div>
        {cards.length > 0 ? (
          <div className="tag-detail-card-grid">
            {cards.map(renderCardPreview)}
          </div>
        ) : (
          <div className="tag-detail-block-empty">No cards in this group yet.</div>
        )}
      </div>
    );
  };

  const renderBoardBlock = (b) => {
    const id = b.board_id || b.id;
    const allCards = boardCards.get(id) || [];
    const groupedHere = direct.groups.filter(g => g.board_id === id);
    const groupedHereKeys = new Set(groupedHere.map(g => `${g.board_id}::${g.group_id || g.id}`));
    const groupedCardKeys = new Set();
    for (const k of groupedHereKeys) {
      const arr = groupCards.get(k) || [];
      for (const c of arr) groupedCardKeys.add(`${c.board_id}::${c.card_id}`);
    }
    const looseCards = allCards.filter(c => !groupedCardKeys.has(`${c.board_id}::${c.card_id}`));
    const sourceBadge = b.applied_source && b.applied_source !== 'user' ? b.applied_source : null;
    const navTarget = { kind: 'board', id, board_id: id };
    const menuTarget = { kind: 'board', id, boardId: id, source: b.applied_source || 'user' };
    return (
      <div key={`brd:${id}`} className="tag-detail-board-block">
        <div className="tag-detail-block-head is-board">
          <Icon as={LayoutGrid} size={13} />
          <button className="tag-detail-block-title-link"
                  title="Click to open · right-click for actions"
                  onClick={() => navigate(navTarget)}
                  onContextMenu={(e) => openMenu(e, menuTarget)}>
            {b.title || 'Board'}
          </button>
          {sourceBadge && (
            <span className={`tag-detail-block-attr is-${sourceBadge}`}>{sourceBadge}</span>
          )}
        </div>
        {groupedHere.map(g => renderGroupBlock(g))}
        {looseCards.length > 0 && (
          <div className="tag-detail-card-grid">
            {looseCards.map(renderCardPreview)}
          </div>
        )}
      </div>
    );
  };

  const orphanGroups = direct.groups.filter(g => !direct.boards.some(b => (b.board_id || b.id) === g.board_id));
  const taggedBoardIds = new Set(direct.boards.map(b => b.board_id || b.id));
  const orphanCards = direct.cards.filter(c => !taggedBoardIds.has(c.board_id));

  // Quick counts for filter pills (raw counts, not filtered).
  const counts = useMemo(() => {
    let auto = 0, user = 0;
    for (const r of rows) {
      if ((r.applied_source || 'user') === 'user') user += 1;
      else auto += 1;
    }
    return { all: rows.length, auto, user };
  }, [rows]);

  // Flat list of every card that appears anywhere in this view —
  // direct-tagged cards + children of tagged boards + children of
  // tagged groups, deduped by (board_id, card_id). Used for:
  //   (a) computing which type-filter pills are available, and
  //   (b) the flat-grid render when a type filter is on.
  const allCardsFlat = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (c) => {
      if (!c?.card_id || !c?.board_id) return;
      const k = `${c.board_id}:${c.card_id}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(c);
    };
    for (const c of direct.cards) push({ ...c, _direct: true });
    for (const arr of boardCards.values()) for (const c of arr) push(c);
    for (const arr of groupCards.values()) for (const c of arr) push(c);
    return out;
  }, [direct.cards, boardCards, groupCards]);

  // Every image card the user can currently see, in display order.
  // Drives the click-to-lightbox jump (index lookup) and the
  // ArrowLeft/ArrowRight slideshow once the lightbox is open.
  const imageCardsFlat = useMemo(
    () => allCardsFlat.filter(c => c.kind === 'image' && c.meta?.src),
    [allCardsFlat],
  );

  // Capture-phase keyboard handler scoped to when the lightbox is
  // open. Escape closes it; ←/→ wrap-around through the image set.
  // stopPropagation prevents ImageLightbox's own Esc listener (which
  // would also call onClose) from running, so we don't double-close.
  useEffect(() => {
    if (lightboxIdx == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLightboxIdx(null);
        return;
      }
      if (imageCardsFlat.length === 0) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation();
        setLightboxIdx((i) => (i - 1 + imageCardsFlat.length) % imageCardsFlat.length);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        setLightboxIdx((i) => (i + 1) % imageCardsFlat.length);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [lightboxIdx, imageCardsFlat.length]);

  // Set of kinds that actually exist in the current rows + child cards.
  // We only show pills for types the user can realistically filter by.
  const typeCounts = useMemo(() => {
    const m = new Map();
    for (const c of allCardsFlat) m.set(c.kind, (m.get(c.kind) || 0) + 1);
    return m;
  }, [allCardsFlat]);

  // Apply both filters in sequence: source filter (handled by
  // filteredRows above for the hierarchy view) and type filter (here
  // for the flat-grid view).
  const typedFlat = useMemo(() => {
    if (typeFilter === 'all') return allCardsFlat;
    return allCardsFlat.filter(c => c.kind === typeFilter);
  }, [allCardsFlat, typeFilter]);

  // Pretty labels for the pill row. Order is intentional — visual
  // kinds (image / palette) first, then text-y kinds. Hidden if the
  // workspace has no items of that kind on this tag.
  const TYPE_PILL_ORDER = ['image', 'palette', 'note', 'card', 'doc', 'link', 'schedule'];
  const typeLabel = (k) => {
    const def = getKind(k);
    return def?.label || k;
  };

  return (
    <div className="tag-detail tag-profile">
      <div className="grain-surface" aria-hidden="true" />
      <div className="tag-detail-head" style={{ '--tag-color': dot }}>
        <span className="tag-detail-dot" style={{ background: dot }} />
        <h1 className="tag-detail-name">{tag.name}</h1>
        {entityTypeLabel(entityType) && (
          <span className="tag-pop-type">{entityTypeLabel(entityType)}</span>
        )}
        <span className="tag-detail-count">
          {filteredRows.length} {filteredRows.length === 1 ? 'item' : 'items'}
        </span>
        <span className="tag-detail-spacer" />
        <button className={`tag-detail-manage-btn ${manageOpen ? 'is-on' : ''}`}
                onClick={() => setManageOpen(o => !o)}
                title="Description, source filter, pending suggestions">
          Manage
        </button>
        {onClose && (
          <button className="tag-detail-close" onClick={onClose} aria-label="Close">×</button>
        )}
      </div>

      {/* Identity hero — what this entity IS + what it looks like, cross-board. */}
      <div className="tag-profile-hero" style={{ '--tag-color': dot }}>
        <div className="tag-profile-typeswitch" role="group" aria-label="Entity type">
          {ENTITY_TYPES.map(t => (
            <button key={t.value}
                    className={`tag-profile-type-chip ${entityType === t.value ? 'is-on' : ''}`}
                    onClick={() => changeType(t.value)}
                    title={entityType === t.value ? `Clear ${t.label}` : `Mark as ${t.label}`}>
              <Icon as={t.Icon} size={12} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        {vis && ((vis.images?.length || 0) > 0 || (vis.palettes?.length || 0) > 0) && (
          <div className="tag-profile-identity">
            {(vis.images?.length || 0) > 0 && (
              <div className="tag-profile-images">
                {vis.images.slice(0, 8).map((im, i) => (
                  <button key={i} className="tag-profile-thumb"
                          title={im.title || 'Image'}
                          onClick={() => navigate({
                            kind: 'image',
                            id: `${im.navTarget?.boardId}:${im.navTarget?.cardId}`,
                            board_id: im.navTarget?.boardId, card_id: im.navTarget?.cardId,
                          })}>
                    <R2Image src={im.src} alt="" />
                  </button>
                ))}
              </div>
            )}
            {(vis.palettes?.length || 0) > 0 && (
              <div className="tag-profile-palettes">
                {vis.palettes.slice(0, 3).map((p, i) => {
                  const colors = (p.swatches || [])
                    .map(c => (typeof c === 'string' ? c : c?.hex))
                    .filter(Boolean).slice(0, 12);
                  return (
                    <span key={i} className="tag-profile-palette" title={p.title || 'Palette'}>
                      {colors.map((c, j) => <span key={j} style={{ background: c }} />)}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manage — the demoted curation chrome (description, source filter,
          pending suggestions). Off the default view; opened on demand. */}
      {manageOpen && (
        <div className="tag-profile-manage">
          <TagDescriptionRow tag={tag} />
          {rows.length > 0 && (
            <div className="tag-detail-filter">
              <button className={`tag-detail-filter-pill ${sourceFilter === 'all' ? 'is-on' : ''}`}
                      onClick={() => setFilter('all')}>
                All <span className="tag-detail-filter-count">{counts.all}</span>
              </button>
              <button className={`tag-detail-filter-pill ${sourceFilter === 'user' ? 'is-on' : ''}`}
                      onClick={() => setFilter('user')}>
                Manual <span className="tag-detail-filter-count">{counts.user}</span>
              </button>
              <button className={`tag-detail-filter-pill ${sourceFilter === 'auto' ? 'is-on' : ''}`}
                      onClick={() => setFilter('auto')}>
                Auto <span className="tag-detail-filter-count">{counts.auto}</span>
              </button>
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="tag-profile-suggest">
              <div className="tag-detail-block-head">
                <Icon as={FileText} size={12} />
                <span className="tag-detail-block-title">Pending suggestions</span>
                <span className="tag-detail-block-attr is-count">{suggestions.length}</span>
              </div>
              <div className="tag-detail-suggestions">
                {suggestions.map(s => {
                  const kind = s.card_kind || s.source_kind;
                  const Icn = kindIcon(kind);
                  const titleText = (s.title || '').trim()
                    || ((s.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80))
                    || `${s.source_kind} ${String(s.source_id).slice(0, 8)}`;
                  const distPct = Math.max(0, Math.min(100, Math.round((1 - s.distance) * 100)));
                  const navTarget = s.source_kind === 'card' && s.board_id
                    ? { kind, id: `${s.board_id}:${s.source_id}`, board_id: s.board_id, card_id: s.source_id }
                    : null;
                  return (
                    <div key={`sug:${s.source_kind}:${s.source_id}`} className="tag-detail-suggestion-row">
                      <button className="tag-detail-suggestion-preview"
                              title={navTarget ? 'Click to open' : ''}
                              onClick={navTarget ? () => navigate(navTarget) : undefined}>
                        <Icon as={Icn} size={12} />
                        <span className="tag-detail-suggestion-title">{titleText}</span>
                        <span className="tag-detail-suggestion-score">{distPct}% match</span>
                      </button>
                      <div className="tag-detail-suggestion-actions">
                        <button className="tag-detail-suggestion-accept"
                                onClick={() => acceptSuggestion(s)} title="Apply this tag">Accept</button>
                        <button className="tag-detail-suggestion-dismiss"
                                onClick={() => dismissSuggestion(s)} title="Don't suggest this again">Dismiss</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Type filter — exploration ("show me all the images / palettes"). */}
      {allCardsFlat.length > 0 && (
        <div className="tag-detail-filter tag-detail-filter-type">
          <button className={`tag-detail-filter-pill ${typeFilter === 'all' ? 'is-on' : ''}`}
                  onClick={() => setTypeFilterPersist('all')}>
            All types <span className="tag-detail-filter-count">{allCardsFlat.length}</span>
          </button>
          {TYPE_PILL_ORDER.filter(k => typeCounts.get(k)).map(k => {
            const def = getKind(k);
            const Icn = def?.icon;
            return (
              <button key={k}
                      className={`tag-detail-filter-pill ${typeFilter === k ? 'is-on' : ''}`}
                      onClick={() => setTypeFilterPersist(k)}>
                {Icn && <Icon as={Icn} size={11} />}
                {typeLabel(k)}
                <span className="tag-detail-filter-count">{typeCounts.get(k)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="tag-detail-body">
        {loading && <div className="tag-detail-empty">Looking up…</div>}
        {!loading && rows.length === 0 && (
          <div className="tag-detail-empty">
            Nothing connected to <strong>{tag.name}</strong> yet.
            <div className="tag-detail-empty-hint">
              Right-click a card and choose Tag…, or drag this tag onto something.
            </div>
          </div>
        )}
        {!loading && rows.length > 0 && filteredRows.length === 0 && (
          <div className="tag-detail-empty">
            No {sourceFilter === 'auto' ? 'auto-applied' : 'manually applied'} items.
          </div>
        )}
        {!loading && filteredRows.length > 0 && (
          <div className="tag-profile-section-head">Everything connected</div>
        )}

        {typeFilter === 'all' ? (
          <>
            {direct.boards.map(renderBoardBlock)}
            {orphanGroups.map(g => renderGroupBlock(g, { boardCrumb: true }))}

            {orphanCards.length > 0 && (
              <div className="tag-detail-loose-cards">
                <div className="tag-detail-block-head">
                  <Icon as={StickyNote} size={12} />
                  <span className="tag-detail-block-title">Other items</span>
                  <span className="tag-detail-block-attr is-count">{orphanCards.length}</span>
                </div>
                <div className="tag-detail-card-grid">
                  {orphanCards.map(c => renderCardPreview({
                    board_id: c.board_id, card_id: c.card_id, kind: c.kind,
                    title: c.title, body: c.card_body || c.body, meta: c.meta,
                    applied_source: c.applied_source,
                  }))}
                </div>
              </div>
            )}
          </>
        ) : (
          // Type filter active: flatten everything into a single grid
          // for a clean "all the images for this tag" / "all the
          // palettes for this tag" view. Board/group context drops away
          // — the user is looking by content type now, not by location.
          typedFlat.length > 0 ? (
            <div className="tag-detail-typed-grid-wrap">
              <div className="tag-detail-block-head">
                <Icon as={getKind(typeFilter)?.icon || StickyNote} size={12} />
                <span className="tag-detail-block-title">
                  {typeLabel(typeFilter)}{typedFlat.length === 1 ? '' : 's'}
                </span>
                <span className="tag-detail-block-attr is-count">{typedFlat.length}</span>
              </div>
              <div className="tag-detail-card-grid">
                {typedFlat.map(renderCardPreview)}
              </div>
            </div>
          ) : (
            <div className="tag-detail-empty">
              No {typeLabel(typeFilter).toLowerCase()}s tagged.
            </div>
          )
        )}

        {mentions.length > 0 && (
          <div className="tag-detail-mentions">
            <div className="tag-profile-section-head">Appears in</div>
            <div className="tag-detail-mention-list">
              {mentions.map(m => {
                const navTarget = m.kind === 'doc'
                  ? { kind: 'doc', id: m.doc_card_id, board_id: m.board_id, card_id: m.doc_card_id, page_id: m.page_id }
                  : null;
                const title = m.page_title || m.doc_title || 'Untitled';
                return (
                  <button key={`mention:${m.doc_card_id}:${m.page_id || ''}`}
                          className="tag-detail-mention-row"
                          onClick={() => navTarget && navigate(navTarget)}
                          title={navTarget ? 'Open page' : ''}>
                    <span className="tag-detail-mention-head">
                      <Icon as={FileText} size={11} />
                      <span className="tag-detail-mention-title">{title}</span>
                      {m.page_title && m.doc_title && m.doc_title !== m.page_title && (
                        <span className="tag-detail-mention-crumb">{m.doc_title}</span>
                      )}
                    </span>
                    {m.context_text && (
                      <span className="tag-detail-mention-snippet">{m.context_text}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Related entities — wired in Phase 4 (board-level co-occurrence). */}
      </div>

      {menu && (
        <div className="tag-detail-menu" role="menu"
             style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 60 }}
             onMouseDown={(e) => e.stopPropagation()}>
          <button className="tag-detail-menu-item" role="menuitem"
                  onClick={() => {
                    const m = menu; setMenu(null);
                    navigate({
                      kind: m.kind === 'group' ? 'board' : m.kind,
                      id: m.kind === 'group' ? m.boardId
                          : (m.kind === 'board' ? m.id : `${m.boardId}:${m.id}`),
                      board_id: m.boardId, card_id: m.kind !== 'board' && m.kind !== 'group' ? m.id : undefined,
                    });
                  }}>
            Open
          </button>
          {menu.source && menu.source !== 'user' && (
            <button className="tag-detail-menu-item" role="menuitem"
                    onClick={() => { const m = menu; setMenu(null); confirmTag(m); }}>
              Confirm tag
            </button>
          )}
          {menu.source && (
            <button className="tag-detail-menu-item" role="menuitem"
                    title="Removes this tag and won't auto-apply it here again. Drag it back to undo."
                    onClick={() => { const m = menu; setMenu(null); removeTag(m); }}>
              Remove tag
            </button>
          )}
          {!menu.source && (
            <span className="tag-detail-menu-hint">
              This card isn't tagged directly — it shows here because its board/group is.
            </span>
          )}
        </div>
      )}

      {lightboxIdx != null && imageCardsFlat[lightboxIdx] && (
        <ImageLightbox
          src={imageCardsFlat[lightboxIdx].meta?.src}
          title={imageCardsFlat[lightboxIdx].title || ''}
          alt={imageCardsFlat[lightboxIdx].title || ''}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}
