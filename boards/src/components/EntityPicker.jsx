import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { Search, X, Check, LayoutGrid, FileText, StickyNote, Image as ImageIcon, Palette, Calendar, Link as LinkIcon, User } from '../lib/icons.js';
import { searchEntities } from '../lib/entitySearch.js';
import { ENTITY_REF_MIME, ENTITY_REF_LIST_MIME } from '../lib/dragMimes.js';

const PAD = 8;
const WIDTH = 380;

const KIND_ICON = {
  board: LayoutGrid,
  doc: FileText,
  note: StickyNote,
  image: ImageIcon,
  palette: Palette,
  schedule: Calendar,
  url: LinkIcon,
  user: User,
};

const KIND_LABEL = {
  board: 'BOARDS',
  doc: 'DOCS',
  note: 'NOTES',
  image: 'IMAGES',
  palette: 'PALETTES',
  schedule: 'SCHEDULES',
  url: 'URLS',
  user: 'PEOPLE',
};

// Universal "what do you want to link?" picker.
// Props:
//   workspaceId, anchor (DOMRect), filter? (kinds[]), multi? (bool),
//   recents? (bool), initialQuery?, initialSelected? ([targets]),
//   onCommit(targets[]), onCancel(),
//   urlMode? (bool — show a Paste-URL row at the top when query starts with http(s)://)
export function EntityPicker({
  workspaceId,
  anchor,
  filter,
  multi = false,
  recents = true,
  initialQuery = '',
  initialSelected = [],
  onCommit,
  onCancel,
  urlMode = false,
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(initialSelected);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 480 });
  const popRef = useRef(null);
  const inputRef = useRef(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const spaceBelow = vh - anchor.bottom - PAD;
      const spaceAbove = anchor.top - PAD;
      const placeAbove = spaceBelow < 320 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(Math.max(placeAbove ? spaceAbove : spaceBelow, 240) - PAD, Math.round(vh * 0.7));
      const top = placeAbove
        ? Math.max(PAD, anchor.top - maxHeight - PAD)
        : Math.min(vh - maxHeight - PAD, anchor.bottom + PAD);
      const left = Math.min(Math.max(PAD, anchor.left), vw - WIDTH - PAD);
      setPos({ top, left, maxHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onCancel?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      const rows = await searchEntities({
        workspaceId, query,
        kinds: filter,
        limit: 30,
      });
      if (!cancelled) setResults(rows);
    }, 200);
    return () => { cancelled = true; clearTimeout(id); };
  }, [workspaceId, query, JSON.stringify(filter)]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const r of results) {
      const k = r.kind;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()];
  }, [results]);

  const isSelected = (row) => selected.some(t => sameTarget(t, rowToTarget(row)));
  const toggle = (row) => {
    const t = rowToTarget(row);
    if (multi) {
      setSelected(s => isSelected(row) ? s.filter(x => !sameTarget(x, t)) : [...s, t]);
    } else {
      onCommit?.([t]);
    }
  };

  return createPortal(
    <div
      ref={popRef}
      className="entity-picker surface-frosted"
      style={{ top: pos.top, left: pos.left, width: WIDTH, maxHeight: pos.maxHeight }}
    >
      <div className="entity-picker-search">
        <Icon as={Search} size={14} />
        <input
          ref={inputRef}
          placeholder="Search boards, docs, cards…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="entity-picker-clear" onClick={() => setQuery('')} aria-label="Clear">
            <Icon as={X} size={12} />
          </button>
        )}
      </div>

      <div className="entity-picker-body">
        {urlMode && query.match(/^https?:\/\//i) && (
          <button
            className="entity-picker-row entity-picker-url"
            onClick={() => onCommit?.([{ kind: 'url', href: query }])}
          >
            <Icon as={LinkIcon} size={14} />
            <span className="entity-picker-row-name">Link to {query}</span>
          </button>
        )}
        {grouped.length === 0 && (
          <div className="entity-picker-empty t-meta">{query ? 'No matches.' : 'Start typing.'}</div>
        )}
        {grouped.map(([kind, rows]) => (
          <div key={kind} className="entity-picker-group">
            <div className="entity-picker-group-label t-eyebrow">{KIND_LABEL[kind] || kind.toUpperCase()}</div>
            {rows.map(row => (
              <button
                key={row.id}
                className={`entity-picker-row ${isSelected(row) ? 'is-selected' : ''}`}
                onClick={() => toggle(row)}
                draggable
                onDragStart={(e) => onPickerRowDragStart(e, row)}
              >
                <Icon as={KIND_ICON[kind] || LayoutGrid} size={14} />
                <span className="entity-picker-row-name">{row.title || 'Untitled'}</span>
                {multi && isSelected(row) && <Icon as={Check} size={14} />}
              </button>
            ))}
          </div>
        ))}
      </div>

      {multi && (
        <div className="entity-picker-foot">
          <span className="entity-picker-count t-meta">
            {selected.length === 0 ? 'Pick one or more' : `${selected.length} selected`}
          </span>
          <button
            className="btn-primary"
            disabled={selected.length === 0}
            onClick={() => onCommit?.(selected)}
          >
            Done
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

function rowToTarget(row) {
  if (row.kind === 'board') return { kind: 'board', id: row.board_id };
  if (row.kind === 'doc')   return { kind: 'doc', docCardId: row.card_id };
  if (row.kind === 'user')  return { kind: 'user', id: row.id, title: row.title };
  return { kind: 'card', boardId: row.board_id, cardId: row.card_id };
}

// Drag handler for picker rows — sets the universal entity-ref mime
// types so any drop target (canvas, message composer, doc editor)
// can recognize the drag.
function onPickerRowDragStart(e, row) {
  try {
    const ref = rowToTarget(row);
    e.dataTransfer.setData(ENTITY_REF_MIME, JSON.stringify(ref));
    e.dataTransfer.setData(ENTITY_REF_LIST_MIME, JSON.stringify([ref]));
    if (row.title) e.dataTransfer.setData('text/plain', row.title);
    e.dataTransfer.effectAllowed = 'copyLink';
  } catch (_) {}
}

function sameTarget(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'board') return a.id === b.id;
  if (a.kind === 'doc')   return a.docCardId === b.docCardId && a.pageId === b.pageId;
  if (a.kind === 'card')  return a.boardId === b.boardId && a.cardId === b.cardId;
  if (a.kind === 'user')  return a.id === b.id;
  if (a.kind === 'url')   return a.href === b.href;
  if (a.kind === 'docPos') return a.docCardId === b.docCardId && a.pageId === b.pageId && a.anchor === b.anchor;
  return false;
}
