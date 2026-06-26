// Workspace tags surface in the sidebar.
//
// Sits between the Messages / shared-boards section and the BOARDS
// tree. Collapsible — expanded state persisted per-workspace in
// localStorage. Each row shows a color dot + name + workspace-wide
// count. Right-click opens a small management menu (Rename / Recolor
// / Delete). The `+` button opens an inline input for fast tag
// creation (use case: "I want to start tagging things with this
// label" without leaving the canvas).
//
// Tag rows are draggable: dragging one onto a canvas card / doc card
// (anywhere that listens to ENTITY_REF_MIME) applies the tag via the
// existing entity-ref drop handlers.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus, Tag as TagIcon } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { ensureTag, renameTag, recolorTag, deleteTag, listTagCounts, mergeTags, setTagEntityType } from '../lib/tagsApi.js';
import { supabase } from '../lib/supabase.js';
import { useFeedback } from './AppFeedback.jsx';
import { ENTITY_REF_MIME } from '../lib/dragMimes.js';
import { useCandidateNames } from '../hooks/useCandidateNames.js';
import { ENTITY_TYPES, entityTypeLabel, guessEntityType } from '../lib/entityTypes.js';
import { levenshtein } from '../lib/stringSim.js';
import { ColorPicker } from './ColorPicker.jsx';
import { tagFallbackColor } from '../lib/tagColor.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

const EXPAND_KEY = 'soleil.tags.sb.expanded';
function loadExpanded(workspaceId) {
  if (typeof localStorage === 'undefined') return true;
  try {
    const raw = localStorage.getItem(`${EXPAND_KEY}.${workspaceId}`);
    return raw === null ? true : raw === '1';
  } catch (_) { return true; }
}
function saveExpanded(workspaceId, open) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(`${EXPAND_KEY}.${workspaceId}`, open ? '1' : '0'); } catch (_) {}
}

// Score existing tags as candidates for "did you mean" against draft
// text. Returns up to 4 matches sorted best-first. Considers exact
// substring (highest), prefix match, and edit-distance-≤2.
function findSimilarTags(draft, existingTags, max = 4) {
  const q = (draft || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  for (const t of existingTags) {
    const name = (t.name || '').toLowerCase();
    if (!name || name === q) continue;
    let score = 0;
    if (name.startsWith(q)) score = 100 - (name.length - q.length);
    else if (name.includes(q)) score = 70 - (name.length - q.length);
    else {
      const d = levenshtein(name, q, 2);
      if (d <= 2) score = 50 - d * 10;
    }
    if (score > 0) out.push({ tag: t, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max).map(x => x.tag);
}

export function SidebarTags({
  workspaceId, userId,
  tags = [],
  activeTagId,
  onOpenTag,
  onWorkspaceTagsChanged,        // optional: nudge a refresh after rename/recolor/delete
}) {
  const feedback = useFeedback();
  const [open, setOpen] = useState(() => loadExpanded(workspaceId));
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [counts, setCounts] = useState(new Map());
  const [tagFilter, setTagFilter] = useState(''); // filter the main tag list when there are many
  const [menuFor, setMenuFor] = useState(null);  // { tag, x, y }
  // Merge picker — { fromTag, query } when user picks "Merge into…"
  const [mergePicker, setMergePicker] = useState(null);
  // Color picker for recolor — { tag, x, y } when active.
  const [colorPickerFor, setColorPickerFor] = useState(null);
  const inputRef = useRef(null);

  // ── Emerging entities ─────────────────────────────────────────────────
  // Ambient discovery: recurring proper nouns in prose that aren't tags yet
  // (get_candidate_names). Adopt in one tap → a real, typed entity. Replaces
  // the old accept/✕ AI "Suggested" inbox.
  const { names: candidateNames } = useCandidateNames(workspaceId);
  const existingSlugSet = useMemo(
    () => new Set((tags || []).map(t => (t.slug || t.name || '').toLowerCase())),
    [tags],
  );
  const emerging = useMemo(
    () => (candidateNames || [])
      .filter(c => c?.name && !existingSlugSet.has(String(c.name).toLowerCase()))
      .slice(0, 6),
    [candidateNames, existingSlugSet],
  );
  const [adopting, setAdopting] = useState('');
  const adoptCandidate = async (name) => {
    if (!workspaceId || !name || adopting) return;
    setAdopting(name);
    try {
      // Prefer the (AI-derived) type carried on the candidate row over the
      // local regex guess — the free Workers AI pass types these far better
      // (e.g. organization/setting/thing the regex can't reach).
      const cand = (candidateNames || []).find(c => String(c.name).toLowerCase() === String(name).toLowerCase());
      const suggestedType = cand?.entity_type || guessEntityType(name);
      const tag = await ensureTag({ workspaceId, name, kind: 'user', createdBy: userId });
      if (tag?.id) {
        // Only type a genuinely-untyped tag — ensureTag returns the existing
        // row when a matching slug exists, so don't clobber its real type.
        if (!tag.entity_type) { try { await setTagEntityType(tag.id, suggestedType); } catch (_) {} }
        try { logEvent(EV.TAG_CANDIDATE_PROMOTE, { entity_type: tag.entity_type || suggestedType, via: 'sidebar' }); } catch (_) {}
      }
      onWorkspaceTagsChanged?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Adopt failed: ' + (err.message || err) });
    } finally {
      setAdopting('');
      document.dispatchEvent(new CustomEvent('soleil-candidates-changed'));
    }
  };
  const dismissCandidate = async (name) => {
    if (!workspaceId || !name) return;
    try {
      await supabase.from('entity_ignore_terms').insert({
        workspace_id: workspaceId, scope: 'workspace', scope_id: null, term: name, created_by: userId || null,
      });
    } catch (err) {
      if (err?.code && err.code !== '23505') feedback.toast({ type: 'error', message: 'Dismiss failed' });
    } finally {
      try { logEvent(EV.TAG_CANDIDATE_DISMISS, { via: 'sidebar' }); } catch (_) {}
      document.dispatchEvent(new CustomEvent('soleil-candidates-changed'));
    }
  };

  // Reload counts on mount + whenever the entity_links → tag-applied
  // realtime sub fires. Use the same channel pattern as elsewhere.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    listTagCounts(workspaceId).then(c => { if (!cancelled) setCounts(c); }).catch(() => {});
    const sfx = Math.random().toString(36).slice(2, 9);
    const chan = supabase.channel(`sb-tag-counts:${workspaceId}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'entity_links',
        filter: `source_workspace=eq.${workspaceId}`,
      }, (payload) => {
        const n = payload?.new || {};
        const o = payload?.old || {};
        if ((n.target_kind === 'tag' && n.link_kind === 'applied')
         || (o.target_kind === 'tag' && o.link_kind === 'applied')) {
          listTagCounts(workspaceId).then(c => { if (!cancelled) setCounts(c); }).catch(() => {});
        }
      })
      .subscribe();
    return () => {
      cancelled = true;
      try { supabase.removeChannel(chan); } catch (_) {}
    };
  }, [workspaceId]);

  // Outside-click + Escape close the per-row menu.
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('.sb-tag-menu')) return;
      setMenuFor(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuFor(null); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const toggle = () => {
    setOpen(v => { const next = !v; saveExpanded(workspaceId, next); return next; });
  };

  const startCreate = () => {
    setOpen(true);
    saveExpanded(workspaceId, true);
    setCreating(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const finishCreate = async (name) => {
    setCreating(false);
    setDraftName('');
    const cleaned = (name || '').trim();
    if (!cleaned) return;
    try {
      await ensureTag({ workspaceId, name: cleaned, kind: 'user', createdBy: userId });
      onWorkspaceTagsChanged?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Tag create failed: ' + (err.message || err) });
    }
  };

  const onContextMenuRow = (e, tag) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuFor({ tag, x: e.clientX, y: e.clientY });
  };

  const promptRename = async (tag) => {
    setMenuFor(null);
    const name = await feedback.prompt({
      title: 'Rename tag', label: 'Name',
      defaultValue: tag.name || '', confirmLabel: 'Rename',
    });
    if (name == null) return;
    try {
      await renameTag(tag.id, name);
      onWorkspaceTagsChanged?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Rename failed: ' + (err.message || err) });
    }
  };
  const promptRecolor = (tag) => {
    // Anchor the color picker to where the menu was open so it
    // floats next to the tag row rather than centering on the page.
    const x = (menuFor?.x ?? 200) + 6;
    const y = (menuFor?.y ?? 200) + 6;
    setMenuFor(null);
    setColorPickerFor({ tag, x, y });
  };
  const applyColor = async (color) => {
    if (!colorPickerFor?.tag || !color) return;
    try {
      await recolorTag(colorPickerFor.tag.id, color);
      onWorkspaceTagsChanged?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Recolor failed: ' + (err.message || err) });
    }
  };
  const startMerge = (tag) => {
    setMenuFor(null);
    setMergePicker({ fromTag: tag, query: '' });
  };
  const finishMerge = async (intoTag) => {
    if (!mergePicker?.fromTag || !intoTag) return;
    if (intoTag.id === mergePicker.fromTag.id) { setMergePicker(null); return; }
    const fromCount = counts.get(mergePicker.fromTag.id) || 0;
    const ok = await feedback.confirm({
      title: 'Merge tags?',
      message: `Merge "${mergePicker.fromTag.name}" into "${intoTag.name}". ${fromCount} application${fromCount === 1 ? ' moves' : 's move'} over and "${mergePicker.fromTag.name}" is deleted.`,
      confirmLabel: 'Merge',
      danger: true,
    });
    if (!ok) { setMergePicker(null); return; }
    try {
      await mergeTags({ fromTagId: mergePicker.fromTag.id, intoTagId: intoTag.id });
      onWorkspaceTagsChanged?.();
      feedback.toast({ type: 'success', message: 'Merged into "' + intoTag.name + '".' });
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Merge failed: ' + (err.message || err) });
    } finally {
      setMergePicker(null);
    }
  };

  const promptDelete = async (tag) => {
    setMenuFor(null);
    const count = counts.get(tag.id) || 0;
    const ok = await feedback.confirm({
      title: 'Delete tag?',
      message: count > 0
        ? `${count} item${count === 1 ? '' : 's'} are tagged with "${tag.name}". Delete the tag and all of its applications?`
        : `Delete "${tag.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteTag(tag.id);
      onWorkspaceTagsChanged?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (err.message || err) });
    }
  };

  // One-tap entity type from the row menu — drag things out of "Untyped"
  // or fix a best-guess. Toggling the current type clears it.
  const setType = async (tag, value) => {
    setMenuFor(null);
    const next = value === tag.entity_type ? null : value;
    try {
      await setTagEntityType(tag.id, next);
      try { logEvent(EV.TAG_SET_TYPE, { tag_id: tag.id, entity_type: next }); } catch (_) {}
      onWorkspaceTagsChanged?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Could not set type' });
    }
  };

  // Drag a tag row → ENTITY_REF_MIME so existing drop handlers on
  // canvas / docs / messages know it's a tag and apply it. Also
  // exposes the tag's color via window.__soleilTagDrag so canvas
  // dragOver can highlight the hovered drop target in that color
  // (HTML5 drag-over can't read dataTransfer payload, only types,
  // so a side-channel is the cleanest read for in-window drags).
  const onDragStart = (e, tag) => {
    try {
      e.dataTransfer.setData(ENTITY_REF_MIME, JSON.stringify({ kind: 'tag', id: tag.id }));
      e.dataTransfer.effectAllowed = 'copyLink';
      const dot = tag.color || tagFallbackColor(tag.slug || tag.name);
      window.__soleilTagDrag = { id: tag.id, color: dot, name: tag.name };
    } catch (_) {}
  };
  const onDragEnd = () => { try { window.__soleilTagDrag = null; } catch (_) {} };

  // Order: most-applied first (workspace-wide popularity), with
  // alphabetical tie-break. Empty tags fall to the bottom.
  const sorted = [...tags].sort((a, b) => {
    const ca = counts.get(a.id) || 0;
    const cb = counts.get(b.id) || 0;
    if (ca !== cb) return cb - ca;
    return (a.name || '').localeCompare(b.name || '');
  });
  // Filter the visible list once a workspace has enough tags to be worth
  // searching — "find by tag" straight from the always-visible sidebar.
  const tagQuery = tagFilter.trim().toLowerCase();
  const filtered = tagQuery
    ? sorted.filter(t =>
        (t.name || '').toLowerCase().includes(tagQuery) ||
        (t.slug || '').toLowerCase().includes(tagQuery))
    : sorted;

  // Group the index by what each entity IS (Character/Setting/Organization/
  // Topic/Thing), with an Untyped bucket last — an "index of your world", not a
  // flat roster. Order mirrors ENTITY_TYPES in lib/entityTypes.js.
  const TYPE_ORDER = ['character', 'setting', 'organization', 'concept', 'thing'];
  const grouped = (() => {
    const buckets = new Map();
    for (const t of filtered) {
      const key = TYPE_ORDER.includes(t.entity_type) ? t.entity_type : '__untyped';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    const keys = TYPE_ORDER.filter(k => buckets.has(k));
    if (buckets.has('__untyped')) keys.push('__untyped');
    return keys.map(k => ({
      key: k,
      label: k === '__untyped' ? 'Untyped' : `${entityTypeLabel(k)}s`,
      rows: buckets.get(k),
    }));
  })();

  return (
    <div className="sb-tags">
      <div className="sb-eyebrow sb-tags-head"
           onClick={toggle}
           role="button" tabIndex={0}>
        <span className={`sb-tags-chev ${open ? 'is-open' : ''}`} aria-hidden="true">
          <Icon as={ChevronRight} size={11} />
        </span>
        <span className="sb-tags-head-label">TAGS</span>
        {tags.length > 0 && <span className="sb-tags-head-count">{tags.length}</span>}
        <button className="sb-tags-add"
                title="New tag"
                onClick={(e) => { e.stopPropagation(); startCreate(); }}>
          <Icon as={Plus} size={11} />
        </button>
      </div>

      {open && (
        <div className="sb-tags-body">
          {creating && (() => {
            const draftSuggestions = findSimilarTags(draftName, tags);
            return (
              <>
                <form className="sb-tag-row sb-tag-row-create"
                      onSubmit={(e) => { e.preventDefault(); finishCreate(draftName); }}>
                  <span className="sb-dot" style={{ background: tagFallbackColor(draftName) }} />
                  <input ref={inputRef}
                         className="sb-tag-create-input"
                         placeholder="New tag…"
                         value={draftName}
                         onChange={(e) => setDraftName(e.target.value)}
                         onBlur={(e) => {
                           // Defer commit so a click on a suggestion (which
                           // fires before blur) can win the race and use the
                           // existing tag instead of creating a new one.
                           const v = draftName;
                           setTimeout(() => {
                             if (creating) finishCreate(v);
                           }, 120);
                         }}
                         onKeyDown={(e) => {
                           if (e.key === 'Escape') { e.preventDefault(); setCreating(false); setDraftName(''); }
                         }} />
                </form>
                {draftSuggestions.length > 0 && (
                  <div className="sb-tag-suggest-list" role="listbox" aria-label="Did you mean">
                    <div className="sb-tag-suggest-head">Did you mean…</div>
                    {draftSuggestions.map(tag => {
                      const dot = tag.color || tagFallbackColor(tag.slug || tag.name);
                      return (
                        <button key={tag.id}
                                type="button"
                                className="sb-tag-suggest-row"
                                onMouseDown={(e) => {
                                  // Prevent input blur from firing first.
                                  e.preventDefault();
                                  setCreating(false);
                                  setDraftName('');
                                  onOpenTag?.(tag);
                                }}>
                          <span className="sb-dot" style={{ background: dot }} />
                          <span className="sb-tag-suggest-name">{tag.name}</span>
                          <span className="sb-tag-suggest-hint">use existing</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}

          {!creating && sorted.length >= 8 && (
            <input
              className="sb-tag-filter-input"
              placeholder="Filter tags…"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setTagFilter(''); e.currentTarget.blur(); } }}
            />
          )}

          {sorted.length === 0 && !creating && (
            <div className="sb-tags-empty">
              No tags yet — anything you tag will appear here.
            </div>
          )}

          {filtered.length === 0 && tagQuery && (
            <div className="sb-tags-empty">No tags match “{tagFilter.trim()}”.</div>
          )}

          {grouped.map(group => (
            <div key={group.key} className="sb-tags-group">
              <div className="sb-tags-group-head">{group.label}</div>
              {group.rows.map(tag => {
                const c = counts.get(tag.id) || 0;
                const isActive = tag.id === activeTagId;
                const dot = tag.color || tagFallbackColor(tag.slug || tag.name);
                return (
                  <div key={tag.id}
                       className={`sb-row sb-tag-row ${isActive ? 'active' : ''}`}
                       draggable
                       onDragStart={(e) => onDragStart(e, tag)}
                       onDragEnd={onDragEnd}
                       onClick={() => onOpenTag?.(tag)}
                       onContextMenu={(e) => onContextMenuRow(e, tag)}
                       title={`${tag.name}${c ? ` · ${c} applied` : ''} · right-click to manage`}>
                    <span className="sb-dot" style={{ background: dot }} />
                    <span className="sb-row-label sb-tag-row-label">{tag.name}</span>
                    {c > 0 && <span className="sb-tag-row-count">{c}</span>}
                  </div>
                );
              })}
            </div>
          ))}

          {emerging.length > 0 && (
            <div className="sb-tags-suggestions">
              <div className="sb-tags-suggestions-head">
                <span>Emerging</span>
                <span className="sb-tags-suggestions-counter">{emerging.length}</span>
              </div>
              {emerging.map(c => (
                <div key={c.name}
                     className="sb-tag-suggestion"
                     title={`“${c.name}” — seen ${c.n}× in your prose. Adopt as an entity.`}>
                  <span className="sb-dot is-emerging" style={{ background: tagFallbackColor(c.name) }} />
                  <span className="sb-tag-suggestion-name">{c.name}</span>
                  <span className="sb-tag-suggestion-count">{c.n}</span>
                  <button className="sb-tag-suggestion-add"
                          disabled={adopting === c.name}
                          onClick={() => adoptCandidate(c.name)}
                          title={`Adopt "${c.name}" as an entity`}>
                    <Icon as={Plus} size={11} />
                  </button>
                  <button className="sb-tag-suggestion-x"
                          onClick={() => dismissCandidate(c.name)}
                          title="Not a name — stop suggesting">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {menuFor && (
        <div className="sb-tag-menu"
             style={{ position: 'fixed', left: menuFor.x, top: menuFor.y }}
             role="menu">
          <button className="sb-tag-menu-item" onClick={() => promptRename(menuFor.tag)}>Rename</button>
          <button className="sb-tag-menu-item" onClick={() => promptRecolor(menuFor.tag)}>Recolor</button>
          <button className="sb-tag-menu-item" onClick={() => startMerge(menuFor.tag)}>Merge into…</button>
          <div className="sb-tag-menu-types" role="group" aria-label="Entity type">
            {ENTITY_TYPES.map(t => (
              <button key={t.value}
                      className={`sb-tag-menu-type ${menuFor.tag.entity_type === t.value ? 'is-on' : ''}`}
                      title={`Mark as ${t.label}`}
                      onClick={() => setType(menuFor.tag, t.value)}>
                <Icon as={t.Icon} size={11} />
              </button>
            ))}
          </div>
          <button className="sb-tag-menu-item danger" onClick={() => promptDelete(menuFor.tag)}>Delete tag</button>
        </div>
      )}

      {mergePicker && (
        <MergePicker
          fromTag={mergePicker.fromTag}
          tags={tags.filter(t => t.id !== mergePicker.fromTag.id)}
          counts={counts}
          onPick={finishMerge}
          onCancel={() => setMergePicker(null)}
        />
      )}

      {colorPickerFor && (
        <ColorPicker
          value={colorPickerFor.tag.color || tagFallbackColor(colorPickerFor.tag.slug || colorPickerFor.tag.name)}
          onChange={applyColor}
          onClose={() => setColorPickerFor(null)}
          position={{ x: colorPickerFor.x, y: colorPickerFor.y }}
        />
      )}
    </div>
  );
}

// Small modal: pick the tag that the from-tag should merge INTO. The
// from-tag's applications get re-pointed; the from-tag itself is
// deleted. Filterable, keyboard-navigable.
function MergePicker({ fromTag, tags = [], counts, onPick, onCancel }) {
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      onCancel?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);
  useEffect(() => {
    setTimeout(() => ref.current?.querySelector('input')?.focus({ preventScroll: true }), 0);
  }, []);
  const q = query.trim().toLowerCase();
  const matches = q
    ? tags.filter(t => (t.slug || t.name || '').toLowerCase().includes(q))
    : tags;
  const fromColor = fromTag.color || tagFallbackColor(fromTag.slug || fromTag.name);
  return (
    <div className="merge-picker-bg" onMouseDown={onCancel}>
      <div ref={ref}
           className="merge-picker"
           role="dialog"
           onMouseDown={(e) => e.stopPropagation()}>
        <div className="merge-picker-head">
          <span className="merge-picker-eyebrow">MERGE TAG</span>
          <span className="merge-picker-from">
            <span className="sb-dot" style={{ background: fromColor }} />
            <span>{fromTag.name}</span>
          </span>
          <span className="merge-picker-arrow">→</span>
          <span className="merge-picker-into-label">into…</span>
        </div>
        <input className="merge-picker-input"
               placeholder="Search tags…"
               value={query}
               onChange={(e) => { setQuery(e.target.value); setHover(0); }}
               onKeyDown={(e) => {
                 if (e.key === 'Enter') {
                   e.preventDefault();
                   const m = matches[hover];
                   if (m) onPick(m);
                 }
                 if (e.key === 'ArrowDown') { e.preventDefault(); setHover(h => Math.min(h + 1, matches.length - 1)); }
                 if (e.key === 'ArrowUp')   { e.preventDefault(); setHover(h => Math.max(h - 1, 0)); }
               }} />
        <div className="merge-picker-list">
          {matches.length === 0 && (
            <div className="merge-picker-empty">No other tags found.</div>
          )}
          {matches.map((t, i) => {
            const c = counts.get(t.id) || 0;
            const dot = t.color || tagFallbackColor(t.slug || t.name);
            return (
              <button key={t.id}
                      className={`merge-picker-row ${i === hover ? 'is-hover' : ''}`}
                      onMouseEnter={() => setHover(i)}
                      onClick={() => onPick(t)}>
                <span className="sb-dot" style={{ background: dot }} />
                <span className="merge-picker-row-name">{t.name}</span>
                {c > 0 && <span className="merge-picker-row-count">{c}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
