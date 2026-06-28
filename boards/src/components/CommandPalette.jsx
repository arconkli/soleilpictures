import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import {
  Search, X, LayoutGrid, FileText, StickyNote, Image as ImageIcon,
  Palette, Calendar, Link as LinkIcon, User, Tag as TagIcon, ChevronRight,
} from '../lib/icons.js';
import { searchEntities } from '../lib/entitySearch.js';
import { tagFallbackColor } from '../lib/tagColor.js';
import { useListboxNav } from '../hooks/useListboxNav.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// Global search + ⌘K command palette.
//
// One surface for: finding boards (instant, from the in-memory map) AND
// finding content inside boards (cards/notes/docs/tags via the entity_search
// backend, debounced) AND running app actions (commands). Selecting a result
// NAVIGATES — a board opens, a card opens its board and flashes the card, a tag
// opens its detail, a command runs. Distinct from BoardPicker, which stays the
// boards-only "link a board onto canvas" picker.
//
// Modeled on EntityPicker.jsx (debounced searchEntities + kind-grouping +
// useListboxNav + rowToTarget) with commands, recents, navigate-on-select and
// full-screen mobile chrome layered on.

const KIND_ICON = {
  board: LayoutGrid,
  doc: FileText,
  note: StickyNote,
  image: ImageIcon,
  palette: Palette,
  schedule: Calendar,
  url: LinkIcon,
  user: User,
  tag: TagIcon,
};

// Section caps keep the DOM small even on big workspaces.
const CAP = { localBoards: 8, asyncBoards: 8, cards: 8, tags: 6, docs: 6, recent: 5 };

// Map an entity_search row to a navigation ref the app's navigate() understands.
// Copied from EntityPicker.jsx so the two stay in lockstep.
function rowToTarget(row) {
  if (row.kind === 'board') return { kind: 'board', id: row.board_id };
  if (row.kind === 'doc')   return { kind: 'doc', docCardId: row.card_id };
  if (row.kind === 'user')  return { kind: 'user', id: row.id, title: row.title };
  if (row.kind === 'tag')   return { kind: 'tag', id: row.id, title: row.title };
  return { kind: 'card', boardId: row.board_id, cardId: row.card_id };
}

// Wrap the first case-insensitive occurrence of `q` in <mark>. Returns either a
// plain string (no match / empty query) or an array of [pre, <mark/>, post].
function highlightMatch(text, q) {
  const s = String(text || '');
  const needle = (q || '').trim();
  if (!needle) return s;
  const i = s.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return s;
  return [
    s.slice(0, i),
    <mark key="m" className="cmdk-mark">{s.slice(i, i + needle.length)}</mark>,
    s.slice(i + needle.length),
  ];
}

// exact > prefix > contains; ties broken by recency-boost then updated_at.
function boardRank(name, lq) {
  const t = (name || '').toLowerCase();
  if (t === lq) return 0;
  if (t.startsWith(lq)) return 1;
  if (t.includes(lq)) return 2;
  return 3;
}

export function CommandPalette({
  open,
  onClose,
  workspaceId,
  boards,
  rootId,
  recents = [],
  commands = [],
  onNavigateRef,
  onOpenBoard,
  mobileShell = false,
  // Boards-only "pick" mode — the link-a-board / split-view picker. Shows only
  // boards (no cards/tags/commands), and selecting one calls onPickBoard(board)
  // instead of navigating. Empty query lists every board for browse-and-pick.
  mode = 'search',
  onPickBoard,
  excludeIds = [],
  placeholder,
}) {
  const isPick = mode === 'pick';
  const [query, setQuery] = useState('');
  const [asyncRows, setAsyncRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const searchedRef = useRef(false);

  // Fresh query + focus on each open.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setAsyncRows([]);
    setLoading(false);
    searchedRef.current = false;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const q = query.trim();
  const lq = q.toLowerCase();

  // Debounced content search (cards/notes/docs/tags + boards-by-meta). Last
  // query wins via the cancelled flag. No-op without a workspace (local shell).
  useEffect(() => {
    if (!open) return;
    if (!workspaceId || !q) { setAsyncRows([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const id = setTimeout(async () => {
      const rows = await searchEntities({ workspaceId, query: q, limit: 30, kinds: isPick ? ['board'] : undefined });
      if (cancelled) return;
      setAsyncRows(rows || []);
      setLoading(false);
      // Intent signal: one "ran a search" event per open once results settle.
      if (!searchedRef.current) {
        searchedRef.current = true;
        try { logEvent(EV.SEARCH_RUN, { has_results: (rows || []).length > 0 }); } catch (_) {}
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [open, q, workspaceId, isPick]);

  // Instant local board-name matches from the in-memory map.
  const localBoards = useMemo(() => {
    if (!open || !q) return [];
    const recentSet = new Set(recents);
    return Object.values(boards || {})
      .filter(b => b.id !== rootId && !excludeIds.includes(b.id) && b.name && b.name.toLowerCase().includes(lq))
      .sort((a, b) => {
        const ra = boardRank(a.name, lq), rb = boardRank(b.name, lq);
        if (ra !== rb) return ra - rb;
        const rea = recentSet.has(a.id) ? 0 : 1, reb = recentSet.has(b.id) ? 0 : 1;
        if (rea !== reb) return rea - reb;
        return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
      })
      .slice(0, CAP.localBoards);
  }, [open, q, lq, boards, rootId, recents, excludeIds]);

  // Matching commands (label + keywords). Only when typing, never in pick mode.
  const commandHits = useMemo(() => {
    if (!open || !q || isPick) return [];
    return commands.filter(c => {
      if (c.available === false) return false;
      const hay = `${c.label} ${(c.keywords || []).join(' ')}`.toLowerCase();
      return hay.includes(lq);
    });
  }, [open, q, lq, commands, isPick]);

  // Recently-opened boards — the empty-state launcher.
  const recentBoards = useMemo(() => {
    if (!open || q) return [];
    return recents.map(id => boards?.[id]).filter(Boolean)
      // In pick mode (link/split picker) the workspace Home/root isn't a valid
      // link target — match localBoards/allBoardsList, which already drop it.
      // In nav mode, navigating to Home IS valid, so keep it there.
      .filter(b => !excludeIds.includes(b.id) && (!isPick || b.id !== rootId)).slice(0, CAP.recent);
  }, [open, q, recents, boards, excludeIds, isPick, rootId]);

  // Pick mode, empty query: every board (minus root / excluded / already-recent),
  // alphabetical — so the link picker is browseable without typing.
  const allBoardsList = useMemo(() => {
    if (!open || !isPick || q) return [];
    const recentSet = new Set(recents);
    return Object.values(boards || {})
      .filter(b => b.id !== rootId && !excludeIds.includes(b.id) && !recentSet.has(b.id))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .slice(0, 50);
  }, [open, isPick, q, boards, rootId, excludeIds, recents]);

  const localBoardIds = useMemo(() => new Set(localBoards.map(b => b.id)), [localBoards]);

  // Bucket the async rows; dedupe board rows already shown from the local map.
  const asyncGroups = useMemo(() => {
    const asyncBoards = [], cards = [], tags = [], docs = [];
    for (const r of asyncRows) {
      if (r.kind === 'board') { if (!localBoardIds.has(r.board_id)) asyncBoards.push(r); }
      else if (r.kind === 'tag') tags.push(r);
      else if (r.kind === 'doc') docs.push(r);
      else if (r.kind === 'user') { /* people are out of scope for the palette */ }
      else cards.push(r); // note / image / palette / schedule / url / card / group
    }
    return {
      asyncBoards: asyncBoards.slice(0, CAP.asyncBoards),
      cards: cards.slice(0, CAP.cards),
      tags: tags.slice(0, CAP.tags),
      docs: docs.slice(0, CAP.docs),
    };
  }, [asyncRows, localBoardIds]);

  // Build sections in render order; each item carries its own activate().
  const sections = useMemo(() => {
    const out = [];
    const close = () => onClose?.();

    // Boards-only pick mode: Recent + (matches | all boards). Select = pick.
    if (isPick) {
      const pick = (b) => { close(); onPickBoard?.(b); };
      if (recentBoards.length) out.push({
        id: 'recent', label: 'Recent',
        items: recentBoards.map(b => ({
          key: `recent:${b.id}`, kind: 'board', icon: LayoutGrid,
          title: b.name || 'Untitled', sub: b.meta || null,
          activate: () => pick(b),
        })),
      });
      const matched = [
        ...localBoards,
        ...asyncGroups.asyncBoards.map(r => boards?.[r.board_id]).filter(Boolean),
      ];
      const boardItems = q ? matched : allBoardsList;
      if (boardItems.length) out.push({
        id: 'boards', label: q ? 'Clusters' : 'All clusters',
        items: boardItems.map(b => ({
          key: `board:${b.id}`, kind: 'board', icon: LayoutGrid,
          title: b.name || 'Untitled', sub: b.meta || null,
          activate: () => pick(b),
        })),
      });
      return out;
    }

    if (commandHits.length) out.push({
      id: 'commands', label: 'Actions',
      items: commandHits.map(c => ({
        key: `cmd:${c.id}`, kind: 'command', icon: c.icon || LayoutGrid,
        title: c.label, sub: null,
        activate: () => { close(); c.run?.(); },
      })),
    });

    if (recentBoards.length) out.push({
      id: 'recent', label: 'Recent',
      items: recentBoards.map(b => ({
        key: `recent:${b.id}`, kind: 'board', icon: LayoutGrid,
        title: b.name || 'Untitled', sub: b.meta || null,
        activate: () => { close(); onOpenBoard?.(b.id); },
      })),
    });

    const boardItems = [...localBoards, ...asyncGroups.asyncBoards];
    if (boardItems.length) out.push({
      id: 'boards', label: 'Clusters',
      items: boardItems.map(b => {
        const id = b.id || b.board_id;
        return {
          key: `board:${id}`, kind: 'board', icon: LayoutGrid,
          title: b.name || b.title || 'Untitled', sub: b.meta || b.body || null,
          activate: () => { close(); onOpenBoard?.(id); },
        };
      }),
    });

    if (asyncGroups.cards.length) out.push({
      id: 'cards', label: 'Cards & notes',
      items: asyncGroups.cards.map(r => ({
        key: r.id, kind: r.kind, icon: KIND_ICON[r.kind] || FileText,
        title: r.title || 'Untitled', sub: r.body || null,
        activate: () => { close(); onNavigateRef?.(rowToTarget(r)); },
      })),
    });

    if (asyncGroups.tags.length) out.push({
      id: 'tags', label: 'Tags',
      items: asyncGroups.tags.map(r => ({
        key: r.id, kind: 'tag', accent: r.meta?.color || tagFallbackColor(r.title || r.id),
        title: r.title || 'Untitled', sub: null,
        activate: () => { close(); onNavigateRef?.(rowToTarget(r)); },
      })),
    });

    if (asyncGroups.docs.length) out.push({
      id: 'docs', label: 'Docs',
      items: asyncGroups.docs.map(r => ({
        key: r.id, kind: 'doc', icon: FileText,
        title: r.title || 'Untitled', sub: r.body || null,
        activate: () => { close(); onNavigateRef?.(rowToTarget(r)); },
      })),
    });

    return out;
  }, [isPick, allBoardsList, onPickBoard, boards, commandHits, recentBoards, localBoards, asyncGroups, q, onClose, onOpenBoard, onNavigateRef]);

  const flat = useMemo(() => sections.flatMap(s => s.items), [sections]);
  const flatIndexByKey = useMemo(() => {
    const m = new Map();
    flat.forEach((it, i) => m.set(it.key, i));
    return m;
  }, [flat]);

  const { active, setActive, onKeyDown, registerItem } = useListboxNav(flat.length, {
    onSelect: (i) => flat[i]?.activate(),
    resetKey: query,
  });

  if (!open) return null;

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
    onKeyDown(e);
  };

  const hasResults = flat.length > 0;
  const showEmpty = !!q && !hasResults && !loading;

  return createPortal(
    <div className="cmdk-bg" onClick={onClose}>
      <div
        className={`cmdk surface-frosted ${mobileShell ? 'is-mobile' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search and commands"
      >
        <div className="cmdk-search">
          <Icon as={Search} size={16} className="cmdk-search-icon" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder={placeholder || (isPick ? 'Search boards to link…' : 'Search boards, cards, tags — or run a command')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search"
          />
          {query ? (
            <button
              className="cmdk-clear"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              aria-label="Clear"
            >
              <Icon as={X} size={14} />
            </button>
          ) : null}
          {mobileShell ? (
            <button className="cmdk-close" onClick={onClose} aria-label="Close">
              <Icon as={X} size={18} />
            </button>
          ) : (
            <span className="cmdk-esc">esc</span>
          )}
        </div>

        <div className="cmdk-list">
          {showEmpty && (
            <div className="cmdk-empty">{isPick ? 'No clusters match.' : `No results for “${q}”.`}</div>
          )}
          {!q && !hasResults && !loading && (
            <div className="cmdk-empty">
              {isPick
                ? 'No boards to link yet.'
                : 'Search boards, cards, notes, docs and tags — or jump to an action.'}
            </div>
          )}
          {sections.map(section => (
            <div key={section.id} className="cmdk-group">
              <div className="cmdk-group-label">{section.label}</div>
              {section.items.map(item => {
                const i = flatIndexByKey.get(item.key);
                return (
                  <button
                    key={item.key}
                    ref={registerItem(i)}
                    className={`cmdk-row ${active === i ? 'is-active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => item.activate()}
                  >
                    {item.kind === 'tag' ? (
                      <span className="cmdk-tag-dot" aria-hidden="true" style={{ '--tag-c': item.accent }} />
                    ) : (
                      <span className="cmdk-row-icon"><Icon as={item.icon || LayoutGrid} size={16} /></span>
                    )}
                    <span className="cmdk-row-text">
                      <span className="cmdk-row-name">{highlightMatch(item.title, q)}</span>
                      {item.sub ? (
                        <span className="cmdk-row-sub">{highlightMatch(item.sub, q)}</span>
                      ) : null}
                    </span>
                    {item.kind === 'command' ? (
                      <span className="cmdk-row-badge">Action</span>
                    ) : (
                      <Icon as={ChevronRight} size={14} className="cmdk-row-arrow" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {!mobileShell && (
          <div className="cmdk-foot">
            <span className="cmdk-hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span className="cmdk-hint"><kbd>↵</kbd> {isPick ? 'link' : 'open'}</span>
            <span className="cmdk-hint"><kbd>esc</kbd> close</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
