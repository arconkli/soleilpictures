// All card kinds. Most accept onUpdate(patch) so they can self-edit inline.

import { useEffect, useRef, useState } from 'react';
import { ImagePlaceholder, Avatar, COVER_TINTS } from './primitives.jsx';
import { R2Image } from './R2Image.jsx';
import { EditableText } from './EditableText.jsx';
import { RichNoteEditor } from './RichNoteEditor.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { BoardThumbnail } from './BoardThumbnail.jsx';
import { useBoardPreview } from '../hooks/useBoardPreview.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { useEntityTrie } from '../hooks/useEntityNameTrie.js';
import { renderHtmlWithAutoLinks } from '../lib/renderHtmlWithAutoLinks.jsx';
import { EntityLink } from './EntityLink.jsx';

// Display-mode renderer for note cards: walks the saved HTML and
// wraps any text-node match against the workspace trie in an
// <EntityLink> chip. The same hover/click/popover behavior as docs +
// messages flows from there.
function NoteAutoLinkBody({ html }) {
  const { trie, workspaceId } = useEntityTrie();
  if (!html) return null;
  if (!trie) {
    return <div className="note-body" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <div className="note-body">{renderHtmlWithAutoLinks(html, { trie, workspaceId })}</div>;
}

// Map an arbitrary card from a list-view board into a clickable row entry.
// Returns null for kinds that don't make sense in a flat list (drawings, etc).
const KIND_DOTS = {
  image:    '#3b82f6',
  note:     '#f59e0b',
  link:     '#a78bfa',
  doc:      '#cbd5e1',
  palette:  '#34d399',
  shape:    '#94a3b8',
  schedule: '#f472b6',
  board:    '#52525b',
  boardlink:'#6b6b75',
};
function htmlToText(html, max = 80) {
  if (!html) return '';
  const tmp = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (!tmp) return html.slice(0, max);
  tmp.innerHTML = html;
  const txt = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
  return txt.length > max ? txt.slice(0, max - 1) + '…' : txt;
}
// Inline SVG icons used in list-board rows. Sized to fill a 24px tile.
function KindIcon({ kind }) {
  const C = { stroke: 'currentColor', strokeWidth: 1.4, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'board' || kind === 'list' || kind === 'boardlink') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22">
        <path d="M5 4 H17 V18 H5 Z M5 8 H17 M9 4 V8" {...C} />
      </svg>
    );
  }
  if (kind === 'image') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22">
        <rect x="4" y="5" width="14" height="12" rx="1.5" {...C} />
        <circle cx="9" cy="10" r="1.4" {...C} />
        <path d="M5 16 L10 12 L13 14 L17 10" {...C} />
      </svg>
    );
  }
  if (kind === 'note') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22">
        <path d="M5 4 H14 L17 7 V18 H5 Z M14 4 V7 H17 M7 11 H15 M7 14 H13" {...C} />
      </svg>
    );
  }
  if (kind === 'link') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22">
        <path d="M9 13 L13 9 M8 11 L6 13 A2.8 2.8 0 0 0 10 17 L12 15 M14 11 L16 9 A2.8 2.8 0 0 0 12 5 L10 7" {...C} />
      </svg>
    );
  }
  if (kind === 'palette') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22">
        <path d="M11 4 A7 7 0 1 0 11 18 A1.5 1.5 0 0 1 12.5 16.5 A1.5 1.5 0 0 0 14 15 H15.5 A2.5 2.5 0 0 0 18 12.5 A7 7 0 0 0 11 4 Z" {...C} />
        <circle cx="7" cy="9" r="1" fill="currentColor" />
        <circle cx="11" cy="6.5" r="1" fill="currentColor" />
        <circle cx="14.5" cy="9" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'doc') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22">
        <path d="M6 4 H13 L17 8 V18 H6 Z M13 4 V8 H17 M8 11 H15 M8 13.5 H15 M8 16 H12" {...C} />
      </svg>
    );
  }
  if (kind === 'schedule') {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22">
        <rect x="4" y="6" width="14" height="12" rx="1.5" {...C} />
        <path d="M4 10 H18 M8 4 V7 M14 4 V7" {...C} />
      </svg>
    );
  }
  if (kind === 'shape') {
    return <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="6" {...C} /></svg>;
  }
  return <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="2" fill="currentColor" /></svg>;
}

// One row inside a list-board card. Sub-board rows use useBoardPreview to
// surface a live "{n} cards" count without the parent having to fetch.
// Compact "table of contents" row. No card-shaped background, no oversized
// icon tile — just a tiny kind glyph, the name, and a muted right-aligned
// hint (count for sub-boards, kind label for everything else).
//
// HTML5-draggable so users can pull a row onto a canvas (drops as a board-
// link for boards, a link card for URLs, a re-add for canvas card kinds).
function ListBoardRow({ item, onClick, peersHere = [], peersBelow = [], onJumpToPeer }) {
  const subId = (item.kind === 'board' || item.kind === 'list' || item.kind === 'boardlink') ? item.boardId : null;
  const subPreview = useBoardPreview(subId);
  const isBoard = !!subId;
  const subCount = subPreview?.cards?.length;
  const meta = isBoard
    ? (subCount == null ? '' : String(subCount))
    : item.meta;
  // Dedupe peers by user.id, prefer "here" over "below" so the dot tag
  // reflects the closest match. Up to 3 dots, "+N" overflow.
  const presence = (() => {
    if (!isBoard || (!peersHere.length && !peersBelow.length)) return [];
    const seen = new Set();
    const out = [];
    for (const p of [...peersHere, ...peersBelow]) {
      const id = p?.user?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ ...p, exact: peersHere.some(x => x.user?.id === id) });
    }
    return out;
  })();
  const onDragStart = (e) => {
    if (subId) {
      // Sub-board → boardlink reference on the destination canvas.
      try {
        e.dataTransfer.setData('application/x-soleil-board-ref', JSON.stringify({ boardId: subId, name: item.name }));
        e.dataTransfer.effectAllowed = 'copy';
      } catch (_) {}
      return;
    }
    if (item.kind === 'link' && item.url) {
      // Link → URL drag (drop into a canvas creates a note containing the link).
      try {
        e.dataTransfer.setData('text/uri-list', item.url);
        e.dataTransfer.setData('text/plain', item.url);
        e.dataTransfer.effectAllowed = 'copy';
      } catch (_) {}
      return;
    }
    if (item.card) {
      // Anything else — pass the raw card so the canvas can re-add it.
      try {
        e.dataTransfer.setData('application/x-soleil-card', JSON.stringify({
          sourceBoardId: null, // not a true cross-pane move
          card: item.card,
        }));
        e.dataTransfer.effectAllowed = 'copy';
      } catch (_) {}
    }
  };
  return (
    <div className={`bc-toc-row bc-toc-row-${item.kind}`}
         onClick={(e) => { e.stopPropagation(); onClick(); }}
         draggable
         onDragStart={onDragStart}
         title={item.name + ' · drag onto a canvas to embed'}>
      <span className="bc-toc-icon" style={{ color: item.color || 'var(--ink-3)' }}>
        <KindIcon kind={item.kind} />
      </span>
      <span className="bc-toc-name">{item.name}</span>
      {presence.length > 0 && (
        <span className="bc-toc-peers">
          {presence.slice(0, 3).map(p => (
            <button key={p.user.id}
                    className={`bc-toc-peer ${p.exact ? 'is-exact' : 'is-nested'}`}
                    style={{ background: p.user.color || '#4f8df8' }}
                    title={p.exact
                      ? `${p.user.name || p.user.email} is here — click to jump`
                      : `${p.user.name || p.user.email} · in ${p.location?.boardName || 'a sub-board'} — click to jump`}
                    onClick={(e) => { e.stopPropagation(); onJumpToPeer?.(p.location); }} />
          ))}
          {presence.length > 3 && (
            <span className="bc-toc-peers-overflow"
                  title={`+${presence.length - 3} more`}>+{presence.length - 3}</span>
          )}
        </span>
      )}
      {meta && <span className="bc-toc-meta">{meta}</span>}
    </div>
  );
}

function describeListItem(card, boards = {}) {
  if (!card || !card.id) return null;
  const dot = KIND_DOTS[card.kind] || '#52525b';
  const base = {
    key: card.id, card, boardId: null, color: dot,
    kind: card.kind, meta: card.kind,
    src: null, url: null,
  };
  if (card.kind === 'board') {
    const target = boards[card.id];
    return { ...base, boardId: card.id, name: target?.name || 'Untitled board',
             meta: target?.view === 'list' ? 'list' : 'board',
             color: COVER_TINTS[target?.cover || 'neutral'] || dot };
  }
  if (card.kind === 'boardlink') {
    const target = boards[card.target];
    return { ...base, boardId: card.target, name: target?.name || 'Linked board',
             meta: 'link', color: COVER_TINTS[target?.cover || 'neutral'] || dot };
  }
  if (card.kind === 'image') {
    return { ...base, src: card.src || null,
             name: card.title || card.label || 'Image', meta: 'image' };
  }
  if (card.kind === 'note') {
    const text = htmlToText(card.html, 80) || (card.body || '').toString().slice(0, 80);
    return { ...base, name: text || 'Empty note', meta: 'note' };
  }
  if (card.kind === 'link') {
    const url = card.link || card.source || null;
    return { ...base, url, name: card.title || url || 'Untitled link', meta: url || 'link' };
  }
  if (card.kind === 'palette') {
    return { ...base, name: card.title || 'Palette',
             meta: `${(card.swatches || []).length} colors` };
  }
  if (card.kind === 'doc') {
    return { ...base, name: card.title || 'Doc', meta: 'doc' };
  }
  if (card.kind === 'schedule') {
    return { ...base, name: card.title || 'Schedule', meta: 'schedule' };
  }
  // shape / unknown — skip from the list
  return null;
}

export function BoardCard({ board, boards = {}, teammates = [], mode = 'tile',
                           onOpen, onOpenChild, onRename, autoFocus = false,
                           clickToOpen = false,
                           onOpenItem,
                           peersHere = [],         // peers exactly on this board
                           peersBelow = [],        // peers nested somewhere under
                           // Full presence maps so list-mode previews can
                           // render per-row dots for nested boards. Both are
                           // optional — board-thumbnail mode doesn't need them.
                           peersHereByBoard,
                           peersBelowByBoard,
                           onJumpToPeer }) {
  if (!board) {
    // Either the board was deleted, OR the viewer doesn't have read
    // access to it (per-board sharing didn't include it). Both cases
    // render the same placeholder — a leaked or stale reference is
    // indistinguishable from a removed one from the client's POV.
    return (
      <div className="bc bc-locked" title="No access — ask the workspace owner to share this board">
        <div className="bc-locked-icon">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="5" y="9" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 9 V6 a3 3 0 0 1 6 0 V9" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </div>
        <div className="bc-locked-label">No access</div>
      </div>
    );
  }
  const presenceDots = (() => {
    if (!peersHere.length && !peersBelow.length) return null;
    // Show up to 3 stacked avatars; the rest are summarized as "+N".
    const all = [...peersHere, ...peersBelow];
    const seen = new Set();
    const dedup = [];
    for (const p of all) {
      if (!p?.user?.id || seen.has(p.user.id)) continue;
      seen.add(p.user.id);
      // Tag whether this peer is at this exact board or nested deeper, so
      // the dot can render slightly muted for "below."
      const exact = peersHere.some(x => x.user?.id === p.user.id);
      dedup.push({ ...p, exact });
    }
    return dedup;
  })();
  const team = (board.members || []).map(id => teammates.find(t => t.id === id)).filter(Boolean);
  const isList = (board.view === 'list');
  const children = Object.values(boards).filter(b => b.parent_board_id === board.id);
  const childCount = children.length;

  const preview = useBoardPreview(board.id);
  const hasPreview = !isList && preview && (preview.cards?.length > 0 || preview.strokes?.length > 0);

  const itemCount = preview?.cards?.length ?? 0;
  const updatedLabel = relativeTimeShort(board.updated_at || board.created_at);

  const outerClick = clickToOpen && onOpen ? () => onOpen() : undefined;

  // List mode: no thumbnail. Centered serif header with breakdown subtitle,
  // then a stack of card-like rows for every item INSIDE this board.
  // Click a sub-board to jump straight in; non-board items get a kind-aware
  // action via onOpenItem (image lightbox, link open, etc.) or fall back to
  // opening the parent list.
  if (isList) {
    const previewCards = preview?.cards || [];
    const cardItems = previewCards.map(card => describeListItem(card, boards)).filter(Boolean);
    const referenced = new Set(cardItems.map(it => it.boardId).filter(Boolean));
    const orphanChildren = children.filter(b => !referenced.has(b.id));
    const items = [
      ...cardItems,
      ...orphanChildren.map(b => ({
        key: 'orphan-' + b.id,
        boardId: b.id,
        kind: b.view === 'list' ? 'list' : 'board',
        name: b.name || 'Untitled',
        meta: b.view === 'list' ? 'list' : 'board',
        color: COVER_TINTS[b.cover || 'neutral'] || COVER_TINTS.neutral,
        card: null,
      })),
    ];
    const boardCount = items.filter(it => it.kind === 'board' || it.kind === 'list' || it.kind === 'boardlink').length;
    const cardCount = items.length - boardCount;
    const subParts = [];
    if (boardCount > 0) subParts.push(`${boardCount} ${boardCount === 1 ? 'board' : 'boards'}`);
    if (cardCount > 0) subParts.push(`${cardCount} ${cardCount === 1 ? 'card' : 'cards'}`);
    const handleItemClick = (it) => {
      if (onOpenItem && onOpenItem(it) === true) return;
      if (it.boardId && onOpenChild) { onOpenChild(it.boardId); return; }
      if (it.kind === 'link' && it.url) {
        const u = it.url.startsWith('http') ? it.url : 'https://' + it.url;
        window.open(u, '_blank', 'noopener');
        return;
      }
      if (onOpen) onOpen();
    };
    return (
      <div className={`bc bc-list ${mode === 'compact' ? 'bc-compact' : ''}`}
           onClick={outerClick}>
        <div className="bc-list-head">
          {onRename
            ? <EditableText className="bc-list-title" value={board.name}
                            onChange={onRename}
                            placeholder="Untitled list"
                            autoFocus={autoFocus}
                            selectAllOnFocus={autoFocus} />
            : <div className="bc-list-title">{board.name}</div>}
          {subParts.length > 0 && (
            <div className="bc-list-subtitle">{subParts.join(', ')}</div>
          )}
        </div>
        {items.length > 0 ? (
          <div className="bc-list-rows bc-children-scroll">
            {items.map(it => {
              // For board rows, look up peer presence so we can render
              // colored dots inline — completes the breadcrumb trail
              // through the list-board preview.
              const rowPeersHere  = it.boardId ? (peersHereByBoard?.get?.(it.boardId)  || []) : [];
              const rowPeersBelow = it.boardId ? (peersBelowByBoard?.get?.(it.boardId) || []) : [];
              return (
                <ListBoardRow key={it.key} item={it}
                              peersHere={rowPeersHere}
                              peersBelow={rowPeersBelow}
                              onJumpToPeer={onJumpToPeer}
                              onClick={() => handleItemClick(it)} />
              );
            })}
          </div>
        ) : (
          <div className="bc-list-empty">{preview ? 'No items yet' : 'Loading…'}</div>
        )}
        {updatedLabel && (
          <div className="bc-list-foot">Updated {updatedLabel}</div>
        )}
      </div>
    );
  }

  const subLabel = board.meta || 'Board';

  return (
    <div className={`bc ${mode === 'compact' ? 'bc-compact' : ''}`}
         onClick={outerClick}>
      <div className="bc-cover">
        {hasPreview ? (
          <div className="bc-thumb-wrap"
               style={{ background: board.bg_color || 'var(--bg-2)' }}>
            <BoardThumbnail cards={preview.cards} strokes={preview.strokes} boards={boards} />
          </div>
        ) : (
          <ImagePlaceholder tone={board.cover || 'neutral'} aspect="16/9" />
        )}
        <div className="bc-cover-ovl">
          <span className="bc-tag">BOARD</span>
          {presenceDots && presenceDots.length > 0 && (
            <BoardCardPresence peers={presenceDots} />
          )}
        </div>
      </div>
      <div className="bc-meta"
           style={board.cover && COVER_TINTS[board.cover]
             ? { borderTopColor: COVER_TINTS[board.cover], borderTopWidth: 3 }
             : undefined}>
        {onRename
          ? <EditableText className="bc-name" value={board.name}
                          onChange={onRename}
                          placeholder="Untitled board"
                          autoFocus={autoFocus}
                          selectAllOnFocus={autoFocus} />
          : <div className="bc-name">{board.name}</div>}
        <div className="bc-row">
          <span className="bc-sub">
            {itemCount > 0 && <span>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>}
            {itemCount > 0 && updatedLabel && <span className="bc-sub-dot">·</span>}
            {updatedLabel && <span>{updatedLabel}</span>}
            {!itemCount && !updatedLabel && <span>{subLabel}</span>}
          </span>
          {team.length > 0 && (
            <div className="bc-team">
              {team.slice(0, 3).map(t => <Avatar key={t.id} name={t.name} color={t.color} size={16} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BoardLinkCard({ targetBoard, note, onOpen }) {
  if (!targetBoard) {
    // Linked board the viewer can't access (or that no longer exists).
    return (
      <div className="blc blc-locked" title="No access — ask the workspace owner to share this board">
        <div className="bc-locked-icon">
          <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
            <rect x="5" y="9" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 9 V6 a3 3 0 0 1 6 0 V9" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </div>
        <div className="bc-locked-label">Linked board · no access</div>
      </div>
    );
  }
  return (
    <div className="blc" onClick={onOpen}>
      <div className="blc-hd">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M4 7 L7 4 M3 5 L2 6 A2 2 0 0 0 5 9 L6 8 M8 6 L9 5 A2 2 0 0 0 6 2 L5 3"
                stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round"/>
        </svg>
        <span className="blc-eyebrow">LINKED BOARD</span>
      </div>
      <div className="blc-name">{targetBoard.name}</div>
      {note && <div className="blc-note">{note}</div>}
      <div className="blc-foot">
        <span className="blc-meta-text">{targetBoard.meta || 'Board'}</span>
        <span className="blc-arrow">→</span>
      </div>
    </div>
  );
}

export function ImageCard({ src, label, title, link, tone, aspect, caption,
                            onUpdate, autoFocus = false,
                            editTitleAt = 0, editCaptionAt = 0,
                            onAfterEdit,
                            pending = false, uploadProgress = null }) {
  // Caption + title are hidden until a value exists OR the user opts in to
  // edit. Double-click on the image area focuses the title editor (creating
  // it on the fly). Hover affordance for adding a caption. Right-click in
  // canvas can also remote-trigger inline edit via editTitleAt / editCaptionAt
  // monotonic-counter signals — same UX as board-name editing, no popup.
  const [editingTitle, setEditingTitle] = useState(autoFocus);
  const [editingCaption, setEditingCaption] = useState(false);

  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);
  useEffect(() => { if (editCaptionAt > 0) setEditingCaption(true); }, [editCaptionAt]);

  // When either inline editor closes (blur, Enter, Escape), tell the parent.
  // Canvas uses this to drop selection so the image returns to a quiet state
  // instead of staying highlighted with a blinking caret nearby.
  const prevEditTitle = useRef(editingTitle);
  const prevEditCaption = useRef(editingCaption);
  useEffect(() => {
    if (prevEditTitle.current && !editingTitle) onAfterEdit?.();
    prevEditTitle.current = editingTitle;
  }, [editingTitle]);
  useEffect(() => {
    if (prevEditCaption.current && !editingCaption) onAfterEdit?.();
    prevEditCaption.current = editingCaption;
  }, [editingCaption]);

  const onImgDblClick = (e) => {
    e.stopPropagation();
    setEditingTitle(true);
  };

  const showTitle = !!title || editingTitle;
  const showCaption = !!caption || editingCaption;

  return (
    <div className="ic">
      <div className="ic-imgwrap" onDoubleClick={onImgDblClick}>
        {src
          ? <R2Image src={src} alt={title || label || ''} className="ic-img" draggable="false" />
          : <ImagePlaceholder label={label} tone={tone} aspect={aspect} />}
        {pending && (
          <div className="ic-upload-overlay" aria-label="Uploading image">
            <div className="ic-upload-spinner" />
            {uploadProgress != null && (
              <div className="ic-upload-progress">{Math.round(uploadProgress * 100)}%</div>
            )}
          </div>
        )}
        {showCaption && onUpdate && (
          <EditableText
            className="ic-cap editable-overlay"
            value={caption || ''}
            placeholder="Caption"
            editing={editingCaption}
            setEditing={setEditingCaption}
            onChange={(v) => onUpdate({ caption: v || null })}
          />
        )}
        {showCaption && !onUpdate && (
          <div className="ic-cap editable-overlay">{caption}</div>
        )}
        {!showCaption && onUpdate && (
          <button className="ic-add-caption"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setEditingCaption(true); }}>
            + caption
          </button>
        )}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="ic-link" title={link}
             onPointerDown={(e) => e.stopPropagation()}
             onClick={(e) => e.stopPropagation()}>
            <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
              <path d="M4 7 L7 4 M3 5 L2 6 A2 2 0 0 0 5 9 L6 8 M8 6 L9 5 A2 2 0 0 0 6 2 L5 3" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round"/>
            </svg>
          </a>
        )}
      </div>
      {showTitle && onUpdate && (
        <EditableText
          className="ic-title editable"
          value={title || ''}
          placeholder="Title"
          editing={editingTitle}
          setEditing={setEditingTitle}
          onChange={(v) => onUpdate({ title: v || null, label: null })}
          selectAllOnFocus={autoFocus}
        />
      )}
      {showTitle && !onUpdate && <div className="ic-title">{title}</div>}
    </div>
  );
}

// Video card — short clips uploaded to R2. The R2Image presign helper
// is image-only, so video src is treated as a sentinel "r2:<key>" and
// playback uses a <video> element with a presigned read URL fetched
// the same way images are. For brevity, this component plays whatever
// `src` was stamped on the card (works for r2: and external https).
export function VideoCard({ src, title, onUpdate, autoFocus = false }) {
  const [editingTitle, setEditingTitle] = useState(autoFocus);
  const showTitle = !!title || editingTitle;
  const onDbl = (e) => { e.stopPropagation(); setEditingTitle(true); };
  return (
    <div className="vc">
      <div className="vc-vidwrap" onDoubleClick={onDbl}>
        {src
          ? <video className="vc-video" src={src.startsWith('r2:') ? '' : src}
                   data-r2={src.startsWith('r2:') ? src.slice(3) : undefined}
                   controls preload="metadata" playsInline />
          : <ImagePlaceholder label="VIDEO" tone="neutral" />}
      </div>
      {showTitle && onUpdate && (
        <EditableText
          className="vc-title editable"
          value={title || ''}
          placeholder="Title"
          editing={editingTitle}
          setEditing={setEditingTitle}
          onChange={(v) => onUpdate({ title: v || null })}
          selectAllOnFocus={autoFocus}
        />
      )}
      {showTitle && !onUpdate && <div className="vc-title">{title}</div>}
    </div>
  );
}

export function NoteCard({ body, html, bgColor, textColor, onUpdate, onEditingChange, autoFocus = false,
                           manuallyResized = false,
                           awareness = null, cardId = null, boardId = null, peerLiveHtml = null }) {
  if (!onUpdate) {
    const display = peerLiveHtml ?? (html || (body ? `<div>${body}</div>` : ''));
    return <div className="note" style={{ background: bgColor || undefined, color: textColor || undefined }}>
      <NoteAutoLinkBody html={display} />
    </div>;
  }
  return (
    <RichNoteEditor
      html={html} body={body}
      bgColor={bgColor} textColor={textColor}
      onChangeHTML={(h) => onUpdate({ html: h, body: null })}
      onChangeBg={(c) => onUpdate({ bgColor: c })}
      onChangeColor={(c) => onUpdate({ textColor: c })}
      onEditingChange={onEditingChange}
      onAutoSize={(h) => onUpdate({ h: Math.round(h) })}
      manuallyResized={manuallyResized}
      autoFocus={autoFocus}
      awareness={awareness} cardId={cardId} boardId={boardId}
      peerLiveHtml={peerLiveHtml}
    />
  );
}

export function LinkCard({ title, source, target, onUpdate, autoFocus = false, editTitleAt = 0 }) {
  // Title editing is controlled here (not by EditableText's internal state) so
  // dbl-click ANYWHERE on the card body — not just on the title text — can
  // re-enter edit mode. Bumped via editTitleAt from the canvas.
  const [editingTitle, setEditingTitle] = useState(autoFocus);
  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);
  const onBodyDouble = (e) => {
    if (!onUpdate) return;
    if (e.target.closest && e.target.closest('.editable')) return; // let inner editors win
    e.stopPropagation();
    setEditingTitle(true);
  };

  // Polymorphic target: when `target` is an EntityRef the card behaves
  // like a chip pointing at any board / card / doc / message / user
  // instead of a raw URL. The hover/click open the universal popover.
  if (target && typeof target === 'object' && target.kind && target.kind !== 'url') {
    return (
      <div className="lc lc-entity">
        <div className="lc-entity-chip">
          <EntityLink
            refs={[target]}
            asTag="div"
            className="lc-entity-link"
          >
            <span className="lc-entity-title">{title || target.title || target.kind}</span>
            <span className="lc-entity-kind">{target.kind}</span>
          </EntityLink>
        </div>
      </div>
    );
  }

  return (
    <div className="lc" onDoubleClick={onBodyDouble}>
      <div className="lc-meta">
        {onUpdate
          ? <EditableText className="lc-title" value={title || ''} placeholder="Untitled link"
                          onChange={(v) => onUpdate({ title: v })}
                          editing={editingTitle}
                          setEditing={setEditingTitle}
                          autoFocus={autoFocus}
                          selectAllOnFocus={autoFocus || editTitleAt > 0} />
          : <div className="lc-title">{title}</div>}
        <div className="lc-src">
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path d="M5 1 H9 V5 M9 1 L4 6 M2 3 H1 V9 H7 V8" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
          {onUpdate
            ? <EditableText className="lc-src-text" value={source || ''} placeholder="https://…" onChange={(v) => onUpdate({ source: v, link: v })} />
            : <span>{source}</span>}
        </div>
      </div>
    </div>
  );
}


export function PaletteCard({ title, swatches = [], hideHex = false, hideLabels = false, onUpdate, autoFocus = false }) {
  const [pickerIdx, setPickerIdx] = useState(null);
  const [pickerPos, setPickerPos] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const isEditable = !!onUpdate;

  const updateSwatch = (i, patch) => {
    const next = swatches.map((s, idx) => idx === i ? { ...s, ...patch } : s);
    onUpdate({ swatches: next });
  };
  const addSwatch = (e) => {
    e.stopPropagation();
    onUpdate({ swatches: [...swatches, { name: 'Color', hex: '#888888' }] });
  };
  const removeSwatch = (i, e) => {
    e.stopPropagation();
    onUpdate({ swatches: swatches.filter((_, idx) => idx !== i) });
  };
  const openPicker = (i, e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setPickerPos({ x: r.left + r.width / 2, y: r.top });
    setPickerIdx(i);
  };
  const copyHex = (i, hex, e) => {
    e.stopPropagation();
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(hex).then(() => {
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((cur) => (cur === i ? null : cur)), 900);
    }).catch(() => {});
  };

  const count = swatches.length;
  const countLabel = `${count} ${count === 1 ? 'color' : 'colors'}`;

  if (!isEditable) {
    return (
      <div className={`pc ${hideHex ? 'pc-no-hex' : ''} ${hideLabels ? 'pc-no-labels' : ''}`}>
        {!hideLabels && (
          <div className="pc-head">
            <div className="pc-title">{title || 'Palette'}</div>
            <div className="pc-count">{countLabel}</div>
          </div>
        )}
        <div className="pc-strip">
          {swatches.map((s, i) => (
            <div key={i} className="pc-cell" title={`${s.hex}`}>
              <div className="pc-chip" style={{ background: s.hex }} />
              {!hideHex && <div className="pc-hex">{(s.hex || '').toUpperCase()}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pc pc-editable">
      <div className="pc-head">
        <EditableText className="pc-title" value={title || ''} placeholder="Palette"
                      onChange={(v) => onUpdate({ title: v })}
                      autoFocus={autoFocus}
                      selectAllOnFocus={autoFocus} />
        <div className="pc-count">{countLabel}</div>
      </div>
      <div className="pc-strip">
        {swatches.map((s, i) => (
          <div key={i} className="pc-cell">
            <button className="pc-chip" style={{ background: s.hex }}
                    title="Click to edit color"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => openPicker(i, e)} />
            <button className="pc-hex pc-hex-btn"
                    title="Click to copy"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => copyHex(i, (s.hex || '').toUpperCase(), e)}>
              {copiedIdx === i ? 'COPIED' : (s.hex || '').toUpperCase()}
            </button>
            <button className="pc-cell-x" title="Remove"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => removeSwatch(i, e)}>×</button>
          </div>
        ))}
        <button className="pc-add" title="Add color"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={addSwatch}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1 V11 M1 6 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      {pickerIdx != null && (
        <ColorPicker
          value={swatches[pickerIdx]?.hex || '#888888'}
          onChange={(c) => updateSwatch(pickerIdx, { hex: c })}
          onClose={() => setPickerIdx(null)}
          position={pickerPos}
        />
      )}
    </div>
  );
}

export function DocCard({ title, lines, author, date, onUpdate, autoFocus = false }) {
  return (
    <div className="doc">
      <div className="doc-hd">
        <svg width="11" height="13" viewBox="0 0 12 14" fill="none">
          <path d="M2 1 H8 L10 3 V13 H2 Z" stroke="currentColor" strokeWidth="1" fill="none" />
          <path d="M8 1 V3 H10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
        {onUpdate
          ? <EditableText className="doc-title" value={title || ''} placeholder="Untitled"
                          onChange={(v) => onUpdate({ title: v })}
                          autoFocus={autoFocus}
                          selectAllOnFocus={autoFocus} />
          : <div className="doc-title">{title}</div>}
      </div>
      <div className="doc-body">
        {(lines || []).map((l, i) => (
          <div key={i} className={`doc-line ${l.h ? `doc-h${l.h}` : ''}`}>
            {l.bullet && <span className="doc-bullet">·</span>}
            {l.text}
          </div>
        ))}
      </div>
      <div className="doc-ft">
        <span>{author}</span><span className="doc-dot">·</span><span>{date}</span>
      </div>
    </div>
  );
}

export function ScheduleCard({ title, rows }) {
  return (
    <div className="sched">
      <div className="sched-title">{title}</div>
      <div className="sched-rows">
        {(rows || []).map((r, i) => (
          <div key={i} className="sched-row">
            <span className="sched-day">{r.day}</span>
            <span className="sched-what">{r.what}</span>
            <span className="sched-loc">{r.loc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shape card ──────────────────────────────────────────────────────────────
// Supports rect, ellipse, line, arrow, diamond, triangle, hexagon, star.
// `dash`: 'solid' (default) | 'dashed' | 'dotted'.
// No inline text — shapes are just shapes; edit colors / stroke / etc. via
// the toolbar (revealed when a shape is selected).
export function ShapeCard({ shape = 'rect', stroke = '#f5f5f6', fill = 'transparent', strokeWidth = 2, dash = 'solid' }) {
  const sw = strokeWidth;
  const dashArray = dash === 'dashed' ? '6,4' : dash === 'dotted' ? '2,3' : undefined;
  const common = { stroke, fill, strokeWidth: sw, vectorEffect: 'non-scaling-stroke', strokeDasharray: dashArray };
  return (
    <div className="shape">
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {shape === 'rect' && <rect x={sw/2} y={sw/2} width={100 - sw} height={100 - sw} {...common} />}
        {shape === 'ellipse' && <ellipse cx="50" cy="50" rx={50 - sw/2} ry={50 - sw/2} {...common} />}
        {shape === 'line' && <line x1="0" y1="0" x2="100" y2="100" stroke={stroke} strokeWidth={sw} strokeDasharray={dashArray} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {shape === 'arrow' && (
          <g>
            <line x1="2" y1="50" x2="92" y2="50" stroke={stroke} strokeWidth={sw} strokeDasharray={dashArray} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <polyline points="80,30 95,50 80,70" stroke={stroke} fill="none" strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
        )}
        {shape === 'diamond' && <polygon points="50,3 97,50 50,97 3,50" {...common} />}
        {shape === 'triangle' && <polygon points="50,5 95,90 5,90" {...common} />}
        {shape === 'hexagon' && <polygon points="25,7 75,7 95,50 75,93 25,93 5,50" {...common} />}
        {shape === 'star' && (
          <polygon
            points="50,5 61,38 95,38 67,58 78,92 50,72 22,92 33,58 5,38 39,38"
            {...common} />
        )}
      </svg>
    </div>
  );
}

// Tiny clustered avatars on the corner of a BoardCard cover, signaling
// peers who are working in this board or somewhere below it. Solid dot =
// peer is exactly here; faded = peer is in a descendant. Tooltip lists
// names + their leaf board so you can chase them down.
function BoardCardPresence({ peers = [] }) {
  if (!peers.length) return null;
  const visible = peers.slice(0, 3);
  const overflow = peers.length - visible.length;
  return (
    <div className="bc-presence" aria-label={`${peers.length} ${peers.length === 1 ? 'person' : 'people'} here`}>
      {visible.map(p => {
        const initial = (p.user.name || p.user.email || '?')[0].toUpperCase();
        const where = p.location?.boardName || 'this board';
        const tip = p.exact
          ? `${p.user.name || p.user.email} is here`
          : `${p.user.name || p.user.email} · in ${where}`;
        return (
          <span key={p.user.id}
                className={`bc-presence-dot ${p.exact ? 'exact' : 'nested'}`}
                style={{ background: p.user.color || '#4f8df8' }}
                title={tip}>
            {initial}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="bc-presence-dot bc-presence-overflow" title={`+${overflow} more`}>
          +{overflow}
        </span>
      )}
    </div>
  );
}
