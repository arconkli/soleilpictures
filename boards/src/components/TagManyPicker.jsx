// Tagging several cards at once (the owner's direction A): opened from the
// selection bar's Tag, above it. Each row says how many of the selected cards
// carry the tag — ✓ all, – some, empty none — and a click makes it all or
// nothing: ✓ takes it off every card, – and empty put it on every card.
// "On these N cards" stays while you search; matches and Create follow.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside.js';
import { resolveTagColor } from '../lib/tagColor.js';
import { entityTypeLabel } from '../lib/entityTypes.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { Icon } from './Icon.jsx';
import { Check, Minus, Plus, Search } from '../lib/icons.js';
import { ensureTag } from '../lib/tagsApi.js';
import { tagCards, untagCards, restoreCardTagRows } from '../lib/tagCardsBatch.js';
import { undoToast } from '../lib/undoToast.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

const POP_W = 320;

export function TagManyPicker({
  open, anchorRect, onClose,
  tags = [],            // workspace tags
  counts = new Map(),   // tagId → how many of the selected cards carry it
  total = 0,            // how many cards are selected
  onApply,              // (tag, 'add' | 'remove') => void
  onCreate,             // (name) => void — a new tag on every selected card
}) {
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState(0);
  const ref = useRef(null);
  const inputRef = useRef(null);
  // The selection bar's Tag closes it itself, on its click.
  useDismissOnOutside(ref, open, onClose, { ignore: '[data-tag-many-trigger]' });
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const q = query.trim().toLowerCase();
  const onCards = useMemo(() => tags
    .filter(t => (counts.get(t.id) || 0) > 0)
    .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || (a.name || '').localeCompare(b.name || '')),
  [tags, counts]);
  const matching = useMemo(() => (q
    ? tags.filter(t => !(counts.get(t.id) > 0) && (t.name || '').toLowerCase().includes(q)).slice(0, 8)
    : []), [tags, counts, q]);
  const hasExact = q.length > 0 && tags.some(t => (t.name || '').trim().toLowerCase() === q);
  const rows = [
    ...onCards.map(t => ({ kind: 'tag', tag: t })),
    ...matching.map(t => ({ kind: 'tag', tag: t })),
    ...(q && !hasExact ? [{ kind: 'create' }] : []),
  ];
  const at = Math.min(hover, Math.max(0, rows.length - 1));

  if (!open) return null;
  const stateOf = (t) => {
    const n = counts.get(t.id) || 0;
    return n >= total && total > 0 ? 'all' : n > 0 ? 'some' : 'none';
  };
  const act = (row) => {
    if (!row) return;
    if (row.kind === 'create') { onCreate?.(query.trim()); return; }
    onApply?.(row.tag, stateOf(row.tag) === 'all' ? 'remove' : 'add');
  };
  const onKey = (e) => {
    if (isComposingKey(e)) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHover(Math.min(rows.length - 1, at + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHover(Math.max(0, at - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); act(rows[at]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose?.(); }
  };
  // Above the selection bar it opened from.
  const bottom = Math.max(8, window.innerHeight - (anchorRect?.top ?? window.innerHeight - 80) + 10);
  const left = Math.max(8, Math.min(window.innerWidth - POP_W - 8,
    (anchorRect ? (anchorRect.left + anchorRect.right) / 2 : window.innerWidth / 2) - POP_W / 2));

  let i = -1;
  const rowEl = (row) => {
    i += 1;
    const idx = i;
    if (row.kind === 'create') {
      return (
        <button key="create" type="button" className={`tag-many-row is-create ${idx === at ? 'is-hover' : ''}`}
                onMouseEnter={() => setHover(idx)} onClick={() => act(row)}>
          <span className="tag-many-plus"><Icon as={Plus} size={12} /></span>
          Create “{query.trim()}”
          <span className="tag-many-meta tag-many-push">new tag on all {total}</span>
        </button>
      );
    }
    const t = row.tag;
    const st = stateOf(t);
    return (
      <button key={t.id} type="button" className={`tag-many-row ${idx === at ? 'is-hover' : ''}`}
              aria-pressed={st === 'all' ? 'true' : st === 'some' ? 'mixed' : 'false'}
              onMouseEnter={() => setHover(idx)} onClick={() => act(row)}>
        <span className={`tag-many-cb is-${st}`} aria-hidden="true">
          {st === 'all' && <Icon as={Check} size={11} weight="bold" />}
          {st === 'some' && <Icon as={Minus} size={11} weight="bold" />}
        </span>
        <span className="tag-many-dot" style={{ background: resolveTagColor(t) }} />
        <span className="tag-many-name">{t.name}</span>
        {t.entity_type && <span className="tag-many-meta">{entityTypeLabel(t.entity_type)}</span>}
        <span className="tag-many-meta tag-many-count">{counts.get(t.id) || 0}/{total}</span>
      </button>
    );
  };

  return createPortal(
    <div ref={ref} className="tag-many" role="dialog" aria-label={`Tag ${total} cards`}
         style={{ left, bottom, width: POP_W }}
         onPointerDown={(e) => e.stopPropagation()}>
      <div className="tag-many-search">
        <label className="tag-many-field">
          <Icon as={Search} size={14} />
          <span className="tag-many-sr">Find or create a tag</span>
          <input ref={inputRef} type="text" value={query} placeholder="Find or create a tag"
                 onChange={(e) => { setQuery(e.target.value); setHover(0); }}
                 onKeyDown={onKey} />
        </label>
      </div>
      <div className="tag-many-list">
        {onCards.length > 0 && <div className="tag-many-eb">On these {total} cards</div>}
        {onCards.map(t => rowEl({ kind: 'tag', tag: t }))}
        {q && (onCards.length > 0) && <div className="tag-many-rule" />}
        {q && <div className="tag-many-eb">Matching “{query.trim()}”</div>}
        {matching.map(t => rowEl({ kind: 'tag', tag: t }))}
        {q && !hasExact && rowEl({ kind: 'create' })}
        {!q && onCards.length === 0 && (
          <div className="tag-many-empty">None of these cards has a tag yet. Type to find one or make one.</div>
        )}
      </div>
      <div className="tag-many-foot">
        <span><kbd>↵</kbd>Apply</span>
        <span><kbd>↑</kbd><kbd>↓</kbd>Move</span>
        <span><kbd>Esc</kbd>Close</span>
        <span className="tag-many-push">Click – to add to all</span>
      </div>
    </div>,
    document.body,
  );
}

// The writes behind the picker, and behind a tag dropped on a selected card.
// ctx: { workspaceId, boardId, userId, tagsByCard, refreshTags, feedback }.
// One write each way and one undo: an add's undo takes the tag back off
// without a "keep it off" row (nobody removed it); a removal writes those
// rows and its undo lifts them.
export async function applyTagToCards({ cardIds, tag, mode, via, ctx }) {
  const { workspaceId, boardId, userId, tagsByCard, refreshTags, feedback } = ctx;
  const has = (id) => (tagsByCard.get(id) || []).some(t => t.id === tag.id);
  const n = (k) => `${k} ${k === 1 ? 'card' : 'cards'}`;
  try {
    if (mode === 'add') {
      const missing = cardIds.filter(id => !has(id));
      if (!missing.length) return;
      await tagCards({ workspaceId, boardId, cardIds: missing, tagId: tag.id });
      try { logEvent(EV.TAG_MANUAL_APPLY, { target_kind: 'card', via, tag_id: tag.id, n: missing.length }); } catch (_) {}
      refreshTags?.();
      undoToast(feedback, {
        message: `Tagged ${n(missing.length)} “${tag.name || 'tag'}”`,
        onUndo: async () => {
          try {
            await untagCards({ workspaceId, boardId, cardIds: missing, tagId: tag.id, keepOff: false });
            refreshTags?.();
          } catch (err) {
            feedback.toast({ type: 'error', code: 'tag_restore_failed', message: 'Undo failed: ' + (err.message || err) });
          }
        },
      });
      return;
    }
    const having = cardIds.filter(has);
    if (!having.length) return;
    const removed = await untagCards({ workspaceId, boardId, cardIds: having, tagId: tag.id, userId });
    refreshTags?.();
    undoToast(feedback, {
      message: `Removed “${tag.name || 'tag'}” from ${n(having.length)}`,
      onUndo: async () => {
        try {
          await restoreCardTagRows({ workspaceId, tagId: tag.id, rows: removed });
          refreshTags?.();
        } catch (err) {
          feedback.toast({ type: 'error', code: 'tag_restore_failed', message: 'Restore failed: ' + (err.message || err) });
        }
      },
    });
  } catch (err) {
    feedback.toast({ type: 'error', code: 'tag_apply_failed', message: 'Tag failed: ' + (err.message || err) });
  }
}

export async function createTagOnCards({ name, cardIds, ctx }) {
  try {
    const tag = await ensureTag({ workspaceId: ctx.workspaceId, name, kind: 'user', createdBy: ctx.userId });
    await applyTagToCards({ cardIds, tag, mode: 'add', via: 'selection_create', ctx });
  } catch (err) {
    ctx.feedback.toast({ type: 'error', code: 'tag_apply_failed', message: 'Tag failed: ' + (err.message || err) });
  }
}
