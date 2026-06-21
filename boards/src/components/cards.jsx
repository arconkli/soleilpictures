// All card kinds. Most accept onUpdate(patch) so they can self-edit inline.

import { memo, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlaceholder, Avatar, COVER_TINTS } from './primitives.jsx';
import { R2Image } from './R2Image.jsx';
import { Spinner } from './Spinner.jsx';
import { resolveSrc } from '../lib/r2.js';
import * as audioBus from '../lib/audioBus.js';
import { EditableText } from './EditableText.jsx';
import { RichNoteEditor, useNoteOverflow } from './RichNoteEditor.jsx';
import { tapIsDouble } from '../lib/doubleTap.js';
import './noteChecklist.css';
// Lazy so Tiptap + y-prosemirror stay out of the canvas chunk and only load
// when a note is actually opened for editing (mirrors how docs lazy-load).
const NoteTiptapSurface = lazy(() =>
  import('./NoteTiptapSurface.jsx').then(m => ({ default: m.NoteTiptapSurface })));
import { ColorPicker } from './ColorPicker.jsx';
import { BoardThumbnail } from './BoardThumbnail.jsx';
import { useBoardPreview } from '../hooks/useBoardPreview.js';
import { useThumbnailBackfill } from '../hooks/useThumbnailBackfill.js';
import { RENDER_VERSION as THUMB_RENDER_VERSION } from '../lib/renderThumbnail.js';
import { paletteLayout, readableInk, hasCustomName, surfaceTone } from '../lib/paletteLayout.js';
import { readableOn, remapHtmlColors } from '../lib/readableColor.js';
import { useThemeAttr } from '../lib/useThemeAttr.js';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { useEntityTrie } from '../hooks/useEntityNameTrie.js';
import { renderHtmlWithAutoLinks } from '../lib/renderHtmlWithAutoLinks.jsx';
import { EntityLink } from './EntityLink.jsx';
import {
  Folder as FolderIcon, Image as ImagePh, StickyNote, Link as LinkPh,
  Palette as PalettePh, FileText, Calendar as CalendarPh, Square as SquarePh,
  Circle as CirclePh, FilePdf, Paperclip,
} from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { PdfCard } from './cards/PdfCard.jsx';
import { FileCard } from './cards/FileCard.jsx';
export { ArtCanvasCard } from './cards/ArtCanvasCard.jsx';

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
  audio:    '#ffa500',
  video:    '#ef4444',
  pdf:      '#e2574c',
  file:     '#64748b',
};
function htmlToText(html, max = 80) {
  if (!html) return '';
  const tmp = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (!tmp) return html.slice(0, max);
  tmp.innerHTML = html;
  const txt = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
  return txt.length > max ? txt.slice(0, max - 1) + '…' : txt;
}
// Phosphor-thin glyphs used in list-board rows. Sized to fill a 22px tile.
function KindIcon({ kind }) {
  if (kind === 'board' || kind === 'list' || kind === 'boardlink') {
    return <Icon as={FolderIcon} size={22} />;
  }
  if (kind === 'image')    return <Icon as={ImagePh} size={22} />;
  if (kind === 'note')     return <Icon as={StickyNote} size={22} />;
  if (kind === 'link')     return <Icon as={LinkPh} size={22} />;
  if (kind === 'palette')  return <Icon as={PalettePh} size={22} />;
  if (kind === 'doc')      return <Icon as={FileText} size={22} />;
  if (kind === 'schedule') return <Icon as={CalendarPh} size={22} />;
  if (kind === 'shape')    return <Icon as={SquarePh} size={22} />;
  if (kind === 'pdf')      return <Icon as={FilePdf} size={22} />;
  if (kind === 'file')     return <Icon as={Paperclip} size={22} />;
  return <Icon as={CirclePh} size={22} />;
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
             name: card.title || card.label || 'image', meta: 'image' };
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
  if (card.kind === 'audio') {
    return { ...base, name: card.title || 'Audio', meta: 'audio' };
  }
  if (card.kind === 'video') {
    return { ...base, name: card.title || 'Video', meta: 'video' };
  }
  if (card.kind === 'pdf') {
    return { ...base, src: card.src || null,
             name: card.name || card.title || 'PDF',
             meta: (Number.isFinite(card.pageCount) && card.pageCount > 0)
               ? `${card.pageCount} ${card.pageCount === 1 ? 'page' : 'pages'}`
               : 'pdf' };
  }
  if (card.kind === 'file') {
    return { ...base, name: card.fileName || card.title || 'File',
             meta: card.ext ? card.ext.toUpperCase() : 'file' };
  }
  // shape / unknown — skip from the list
  return null;
}

function BoardCard({ board, boards = {}, teammates = [], mode = 'tile',
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

  // Viewport-gate the preview load for canvas-mode parents. A parent
  // board with 10+ sub-board tiles used to fire 10 parallel Y.Doc
  // decodes on mount even for tiles scrolled off-screen — that was the
  // dominant cost on the Marketing board. List-mode boards stay eager
  // because their rows can't be lazy-loaded the same way (the list
  // layout needs preview data to figure out which items to show).
  const rootRef = useRef(null);
  const [thumbVisible, setThumbVisible] = useState(false);
  useEffect(() => {
    if (isList || thumbVisible) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setThumbVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setThumbVisible(true);
          io.disconnect();
          return;
        }
      }
    }, { rootMargin: '100%' });
    io.observe(el);
    return () => io.disconnect();
  }, [isList, thumbVisible]);

  // Stored preview (Round 23): a board with a thumb_key shows a static R2
  // image — no Y.Doc decode, no Canvas2D re-render. The LIVE preview decode
  // only runs when there's NO stored thumb yet (backfill window / brand-new
  // boards) and the tile is visible, or for list mode (which needs the card
  // list to enumerate items). When a stored thumb exists, useBoardPreview is
  // disabled and returns null instantly — zero network/decode for the grid.
  const hasStoredThumb = !isList && !!board.thumb_key;
  // Version gate: a stored thumb from an older renderer keeps DISPLAYING
  // (no flash back to placeholder) but re-enables the preview decode +
  // backfill below so it self-heals to the current look in the background.
  const thumbCurrent = hasStoredThumb && board.thumb_version === THUMB_RENDER_VERSION;
  const needsRegen = !isList && (!hasStoredThumb || !thumbCurrent);
  const preview = useBoardPreview(board.id, isList || (needsRegen && thumbVisible));
  const liveHasPreview = !isList && !hasStoredThumb && preview &&
    (preview.cards?.length > 0 || preview.strokes?.length > 0);

  // Self-heal: a visible tile-mode board with no stored thumbnail (or a
  // stale-version one) has its already-decoded preview persisted to R2
  // (writers only) so the next load is a cheap static image. No-ops for
  // list mode, current thumbs, empty boards, and viewers (presign 403).
  useThumbnailBackfill({ board, preview, boards, enabled: needsRegen && thumbVisible });

  // Item count survives without a decode thanks to boards.card_count; fall
  // back to the live preview's count (list mode / pre-backfill tiles).
  const itemCount = board.card_count ?? preview?.cards?.length ?? 0;
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
      <div ref={rootRef}
           className={`bc bc-list ${mode === 'compact' ? 'bc-compact' : ''}`}
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
    <div ref={rootRef}
         className={`bc ${mode === 'compact' ? 'bc-compact' : ''}`}
         onClick={outerClick}>
      <div className="bc-cover">
        {hasStoredThumb ? (
          <div className="bc-thumb-wrap"
               style={{ background: board.bg_color || 'var(--bg-2)' }}>
            {/* key on thumb_updated_at so a regen remounts → fresh resolveSrc.
                v2 renders are opaque mini-screenshots → edge-to-edge cover;
                legacy transparent renders keep the inset/contain framing. */}
            <R2Image src={board.thumb_key} key={board.thumb_updated_at || board.thumb_key}
                     className={thumbCurrent ? 'bc-thumb bc-thumb--cover' : 'bc-thumb'}
                     alt="" draggable={false} />
          </div>
        ) : liveHasPreview ? (
          <div className="bc-thumb-wrap"
               style={{ background: board.bg_color || 'var(--bg-2)' }}>
            <BoardThumbnail cards={preview.cards} strokes={preview.strokes}
                            arrows={preview.arrows} boards={boards}
                            bgColor={board.bg_color || null} />
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

function BoardLinkCard({ targetBoard, note, onOpen }) {
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

function ImageCard({ src, label, title, link, tone, aspect, caption,
                            w, h,
                            onUpdate, autoFocus = false,
                            editTitleAt = 0, editCaptionAt = 0,
                            onAfterEdit, onExpand,
                            pending = false, uploadProgress = null,
                            backfillEnabled = false, boardId = null, cardId = null }) {
  // Caption + title are hidden until a value exists OR the user opts in to
  // edit. Double-click on the image area focuses the title editor (creating
  // it on the fly). Hover affordance for adding a caption. Right-click in
  // canvas can also remote-trigger inline edit via editTitleAt / editCaptionAt
  // monotonic-counter signals — same UX as board-name editing, no popup.
  // Do NOT auto-open the title editor on paste/drop. Paste creates the
  // card with autoFocus=true, which used to flip editingTitle on and
  // mount the (empty, opacity-0) .ic-title row below the image —
  // invisibly stealing ~30px of vertical layout. That made object-fit:
  // cover crop the top/bottom of the image. Title editor now only
  // opens via explicit user action (double-click image, editTitleAt
  // signal from right-click) or when the card already has a title.
  const [editingTitle, setEditingTitle] = useState(false);
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
    // Don't hijack a double-click that lands on the caption / an inner editor
    // into "edit title" — mirrors LinkCard's guard.
    if (e.target.closest && e.target.closest('.editable')) return;
    e.stopPropagation();
    setEditingTitle(true);
  };

  const showTitle = !!title || editingTitle;
  const showCaption = !!caption || editingCaption;

  return (
    <div className="ic">
      <div className="ic-imgwrap" onDoubleClick={onImgDblClick}>
        {src
          ? <R2Image src={src} alt={title || label || ''} w={w} h={h} className="ic-img" draggable="false"
                     progressive backfillEnabled={backfillEnabled} boardId={boardId} cardId={cardId} />
          : <ImagePlaceholder label={label} tone={tone} aspect={aspect} />}
        {pending && (
          <div className="ic-upload-overlay" aria-label="Uploading image">
            <Spinner size={22} tone="on-dark" label="Uploading image" />
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
        {src && onExpand && (
          <button type="button" className="ic-expand" title="View full size"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onExpand(); }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"
                 stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5 V2 H5 M12 5 V2 H9 M2 9 V12 H5 M12 9 V12 H9" />
            </svg>
          </button>
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
function VideoCard({ src, title, onUpdate, autoFocus = false, editTitleAt = 0 }) {
  // Same fix as ImageCard: don't auto-open the title row on paste; it
  // silently eats vertical layout and makes object-fit:cover crop the
  // video. Double-click to edit instead.
  const [editingTitle, setEditingTitle] = useState(false);
  // Canvas context menu "Edit title" remote-trigger (same as Image/Link).
  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);
  // Resolve an r2:<key> src → signed read URL (mirrors AudioCard). The signed
  // GET supports HTTP Range, so large videos stream + seek inline. No
  // crossOrigin — that breaks playback against R2's CORS.
  const [resolvedUrl, setResolvedUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!src) { setResolvedUrl(null); return; }
    if (!src.startsWith('r2:')) { setResolvedUrl(src); return; }  // external https / blob (local QA)
    resolveSrc(src).then(u => {
      if (cancelled) return;
      setResolvedUrl(u);
      if (!u) console.warn('[VideoCard] no signed URL for', src);
    });
    return () => { cancelled = true; };
  }, [src]);
  const showTitle = !!title || editingTitle;
  const onDbl = (e) => { e.stopPropagation(); setEditingTitle(true); };
  return (
    <div className="vc">
      <div className="vc-vidwrap" onDoubleClick={onDbl}>
        {resolvedUrl
          ? <video className="vc-video" src={resolvedUrl}
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

// Rollout gate for the collaborative (Tiptap + Y.XmlFragment) note editor.
// Default ON (true co-typing). Opt OUT with ?ttnotes=0 or window.__NOTE_COLLAB
// === false to fall back to the legacy single-writer editor (kept for rollback
// + no-ydoc contexts like ?local). Only takes effect where a live ydoc +
// cardYMap exist (the editable canvas) — read-only/public render paths are
// separate and unchanged.
function noteCollabOn() {
  try {
    if (/[?&]ttnotes=0/.test(window.location.search)) return false;
    if (typeof window !== 'undefined' && window.__NOTE_COLLAB === false) return false;
    return true;
  } catch (_) { return true; }
}

// Collaborative note card. Renders the derived card.html read-only by default
// and mounts the live Tiptap editing surface only when THIS note is being
// edited (one at a time on the canvas), so there is never a Tiptap instance per
// note. The fragment is the collaborative source of truth; card.html is its
// write-through cache feeding every read-only consumer.
// Exported so the ?noteqa harness can mount it directly against an in-memory
// Y.Doc (the canvas wires it via NoteCard's gate).
export function NoteCardCollab({ html, body, bgColor, textColor, fontFamily, fontSize,
                          vAlign = null,
                          onUpdate, onEditingChange, autoFocus = false,
                          manuallyResized = false, ydoc = null, cardYMap = null,
                          cardId = null, boardId = null, awareness = null }) {
  const [editing, setEditing] = useState(autoFocus);
  useEffect(() => { onEditingChange?.(editing); }, [editing]);

  const ref = useRef(null);
  const overflowing = useNoteOverflow(ref, [html, body, fontSize, fontFamily, editing, manuallyResized]);
  const lastTapRef = useRef({});
  const theme = useThemeAttr();

  const fontStyle = {};
  if (fontFamily) fontStyle.fontFamily = fontFamily;
  if (fontSize) fontStyle.fontSize = `${fontSize}px`;
  const hasBg = !!bgColor && bgColor !== 'transparent';
  const isTransparent = bgColor === 'transparent';
  // Luminance-based surface tone (theme-independent for an explicitly painted
  // note); unpainted notes follow the app theme via CSS. effBg is the surface
  // the text sits on, used to make the user's colors readable.
  const tone = surfaceTone(bgColor);
  const isLightBg = tone === 'light';
  const isDarkBg = tone === 'dark';
  const effBg = hasBg ? bgColor : (theme === 'light' ? '#f5f5f7' : '#0a0a0c');
  const noteStyle = { background: bgColor || undefined, color: textColor ? readableOn(textColor, effBg) : undefined, ...fontStyle };
  if (bgColor) noteStyle['--has-bg-color'] = bgColor;
  const cls = `note ${editing ? 'is-editing' : ''} ${isLightBg ? 'is-light-bg' : ''} ${isDarkBg ? 'is-dark-bg' : ''} ${hasBg ? 'has-bg' : ''} ${isTransparent ? 'is-transparent' : ''} ${overflowing ? 'is-overflowing' : ''} ${vAlign === 'center' ? 'is-balanced' : ''}`;

  // Read-only display html with every run made readable on this note's surface
  // (per-span colors + highlights). Memoized so it only recomputes on edits or
  // a theme flip. The live editing surface uses the ReadableColors plugin.
  const display = html || (body ? `<div>${body}</div>` : '');
  const safeDisplay = useMemo(() => remapHtmlColors(display, effBg), [display, effBg]);

  if (editing) {
    return (
      <div ref={ref} className={cls} style={noteStyle}>
        <Suspense fallback={<div className="note-body" />}>
          <NoteTiptapSurface
            ydoc={ydoc} cardYMap={cardYMap} html={html}
            cardId={cardId} boardId={boardId} awareness={awareness}
            manuallyResized={manuallyResized} autoFocus={autoFocus}
            onExitEdit={() => setEditing(false)}
          />
        </Suspense>
      </div>
    );
  }

  // Read-only display + edit affordances (double-click / touch double-tap to
  // edit; checklist toggle without entering edit). `safeDisplay` (computed
  // above) is `display` with colors made readable on this surface.
  const startEdit = (e) => { e?.stopPropagation?.(); setEditing(true); };
  const onBodyClick = (e) => {
    const box = e.target.closest?.('.ck-box');
    if (!box || !ref.current) return;
    e.preventDefault();
    e.stopPropagation();
    const checked = !box.classList.contains('is-checked');
    box.classList.toggle('is-checked', checked);
    box.setAttribute('aria-checked', checked ? 'true' : 'false');
    const bodyEl = ref.current.querySelector('.note-body');
    const newHtml = bodyEl ? bodyEl.innerHTML : html;
    // Write the html cache + keep the fragment (source of truth) in step with
    // the toggle, both under NOTE_ORIGIN (off the board undo stack). Lazy import
    // keeps the heavy serializer off the canvas chunk until a box is toggled.
    if (ydoc && cardYMap) {
      import('../lib/noteDocState.js').then((m) => {
        m.setNoteCacheFields(ydoc, cardYMap, { html: newHtml, body: null });
        m.applyHtmlToNoteFragment(ydoc, cardYMap, newHtml);
      }).catch(() => {});
    } else {
      onUpdate({ html: newHtml, body: null });
    }
  };
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') return;
    if (e.target.closest?.('a, .note-preview-remove, .ck-box')) return;
    if (!tapIsDouble(lastTapRef, e)) return;
    setEditing(true);
  };
  return (
    <div ref={ref} className={cls} style={noteStyle}
         onDoubleClick={startEdit} onPointerUp={onPointerUp} onClick={onBodyClick}>
      <NoteAutoLinkBody html={safeDisplay} />
      {overflowing && (
        <button type="button" className="note-more-chip"
                title="Show all text — fit the note to its content"
                aria-label="Fit note height to its text"
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const bodyEl = ref.current?.querySelector('.note-body');
                  if (bodyEl) onUpdate({ h: Math.round(Math.min(1600, bodyEl.scrollHeight + 30)), manuallyResized: false });
                }}>
          Show all
        </button>
      )}
    </div>
  );
}

function NoteCard({ body, html, bgColor, textColor, fontFamily, fontSize,
                           vAlign = null,
                           onUpdate, onEditingChange, autoFocus = false,
                           manuallyResized = false,
                           awareness = null, cardId = null, boardId = null, peerLiveHtml = null,
                           ydoc = null, cardYMap = null }) {
  // Workspace defaults can pin a fontFamily/fontSize at create time —
  // pass them through as inline styles so existing notes that didn't
  // capture them keep falling back to the page default.
  const fontStyle = {};
  if (fontFamily) fontStyle.fontFamily = fontFamily;
  if (fontSize) fontStyle.fontSize = `${fontSize}px`;
  // Read-only path still shows the clipped-text fade (no chip — viewers
  // can't resize). Hooks run unconditionally; the ref stays null on the
  // editable path so the hook is inert there.
  const roNoteRef = useRef(null);
  const roOverflowing = useNoteOverflow(roNoteRef, [html, body, peerLiveHtml, fontSize, fontFamily, manuallyResized]);
  const roTheme = useThemeAttr();
  const roHasBg = !!bgColor && bgColor !== 'transparent';
  const roTone = surfaceTone(bgColor);
  const roEffBg = roHasBg ? bgColor : (roTheme === 'light' ? '#f5f5f7' : '#0a0a0c');
  const roDisplay = peerLiveHtml ?? (html || (body ? `<div>${body}</div>` : ''));
  const roSafeDisplay = useMemo(() => remapHtmlColors(roDisplay, roEffBg), [roDisplay, roEffBg]);
  if (!onUpdate) {
    // Same surface-tone + readable-color treatment as the editable paths, so
    // the read-only render (share, list, off-screen) matches what editing shows.
    return <div ref={roNoteRef}
                className={`note ${roTone === 'light' ? 'is-light-bg' : ''} ${roTone === 'dark' ? 'is-dark-bg' : ''} ${roHasBg ? 'has-bg' : ''} ${bgColor === 'transparent' ? 'is-transparent' : ''} ${roOverflowing ? 'is-overflowing' : ''} ${vAlign === 'center' ? 'is-balanced' : ''}`}
                style={{ background: bgColor || undefined, color: textColor ? readableOn(textColor, roEffBg) : undefined, ...fontStyle }}>
      <NoteAutoLinkBody html={roSafeDisplay} />
    </div>;
  }
  // Collaborative (Tiptap + Y.XmlFragment) path — gated during rollout. Needs
  // the live ydoc + this card's Y.Map to bind the editor to the note fragment.
  if (noteCollabOn() && ydoc && cardYMap) {
    return (
      <NoteCardCollab
        html={html} body={body}
        bgColor={bgColor} textColor={textColor}
        fontFamily={fontFamily} fontSize={fontSize}
        vAlign={vAlign}
        onUpdate={onUpdate} onEditingChange={onEditingChange}
        autoFocus={autoFocus} manuallyResized={manuallyResized}
        ydoc={ydoc} cardYMap={cardYMap}
        cardId={cardId} boardId={boardId} awareness={awareness}
      />
    );
  }
  return (
    <RichNoteEditor
      html={html} body={body}
      bgColor={bgColor} textColor={textColor}
      fontFamily={fontFamily} fontSize={fontSize}
      vAlign={vAlign}
      onChangeHTML={(h) => onUpdate({ html: h, body: null })}
      onChangeBg={(c) => onUpdate({ bgColor: c })}
      onChangeColor={(c) => onUpdate({ textColor: c })}
      onEditingChange={onEditingChange}
      onAutoSize={(h) => onUpdate({ h: Math.round(h) })}
      onFitHeight={(h) => onUpdate({ h: Math.round(h), manuallyResized: false })}
      manuallyResized={manuallyResized}
      autoFocus={autoFocus}
      awareness={awareness} cardId={cardId} boardId={boardId}
      peerLiveHtml={peerLiveHtml}
    />
  );
}

function LinkCard({ title, source, target, image, description, favicon, embed, isSelected = false, onUpdate, autoFocus = false, editTitleAt = 0 }) {
  // Title editing is controlled here (not by EditableText's internal state) so
  // dbl-click ANYWHERE on the card body — not just on the title text — can
  // re-enter edit mode. Bumped via editTitleAt from the canvas.
  const [editingTitle, setEditingTitle] = useState(autoFocus);
  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);
  // Embed activation: iframes (Spotify/YouTube/…) consume pointer events
  // natively, which blocks dragging the card. Default state is INACTIVE —
  // a transparent overlay sits on top of the iframe so pointerdown bubbles
  // to the canvas drag handler. Double-click activates the iframe; deselecting
  // the card on the canvas locks it again.
  const [embedActive, setEmbedActive] = useState(false);
  useEffect(() => { if (!isSelected) setEmbedActive(false); }, [isSelected]);
  // Escape deactivates the embed iframe (mirrors AudioCard's cover mode). Capture
  // phase + stopPropagation so it doesn't also trigger the canvas Escape.
  useEffect(() => {
    if (!embedActive) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setEmbedActive(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [embedActive]);
  const onBodyDouble = (e) => {
    if (!onUpdate) return;
    if (e.target.closest && e.target.closest('.editable')) return; // let inner editors win
    e.stopPropagation();
    setEditingTitle(true);
  };

  // Embed scale-to-fit: render the iframe at its provider NATURAL pixel size and
  // CSS-scale it to *contain* the frame (centered), so the player never shows its
  // own scrollbars and is never clipped at any card size. Aspect-locked resize
  // (CanvasSurface) keeps the frame on the provider ratio, so the common
  // title-less case fills exactly with no bands; a title bar shortens the frame,
  // where contain leaves a minimal centered margin instead of clipping. A
  // ResizeObserver on the frame tracks live drag-resize. Inert for non-embeds
  // (natW===0 → early return), so it's safe to declare unconditionally here.
  const embedFrameRef = useRef(null);
  const [embedFit, setEmbedFit] = useState({ s: 1, tx: 0, ty: 0 });
  const natW = embed?.defaultW || 0;
  const natH = embed?.defaultH || 0;
  useEffect(() => {
    const el = embedFrameRef.current;
    if (!el || !natW || !natH) return;
    const measure = () => {
      const fw = el.clientWidth, fh = el.clientHeight;
      if (!fw || !fh) return;
      const s = Math.min(fw / natW, fh / natH);
      setEmbedFit({ s, tx: (fw - natW * s) / 2, ty: (fh - natH * s) / 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [natW, natH]);

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

  // Resolve a click-friendly URL (prefix bare hostnames so window.open
  // doesn't treat them as a relative path).
  const openHref = (() => {
    if (!source) return null;
    return source.startsWith('http://') || source.startsWith('https://')
      ? source
      : `https://${source}`;
  })();
  const openLink = (e) => {
    if (!openHref) return;
    e.stopPropagation();
    window.open(openHref, '_blank', 'noopener,noreferrer');
  };
  // Embed mode: a known provider (YouTube, Spotify, TikTok, Vimeo, IG, X)
  // renders an iframe full-bleed. The meta bar only appears when the user
  // has set a title (or is currently editing one) — otherwise the card is
  // JUST the embed. A tiny hover-revealed "title" pill lets them add one.
  if (embed && embed.embedUrl) {
    const hasTitle = !!(title && title.trim());
    const showMeta = hasTitle || editingTitle;
    return (
      <div className={`lc lc-embed ${embedActive ? 'is-embed-active' : ''}`} data-provider={embed.provider} onDoubleClick={onBodyDouble}>
        <div
          className="lc-embed-frame"
          ref={embedFrameRef}
          onPointerDown={(e) => { if (embedActive) e.stopPropagation(); }}
        >
          <iframe
            src={embed.embedUrl}
            title={title || embed.provider}
            allow={embed.allow || 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'}
            allowFullScreen
            loading="lazy"
            scrolling="no"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox allow-forms"
            className="lc-embed-iframe"
            style={{
              width: natW || '100%',
              height: natH || '100%',
              transform: natW ? `translate(${embedFit.tx}px, ${embedFit.ty}px) scale(${embedFit.s})` : undefined,
            }}
          />
          {!embedActive && (
            <div
              className="lc-embed-overlay"
              title="Double-click to interact"
              onDoubleClick={(e) => { e.stopPropagation(); setEmbedActive(true); }}
            />
          )}
          {!showMeta && onUpdate && (
            <button
              type="button"
              className="lc-embed-title-add"
              title="Add title"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
            >
              + Title
            </button>
          )}
        </div>
        {showMeta && (
          <div className="lc-meta lc-embed-meta">
            {onUpdate
              ? <EditableText className="lc-title" value={title || ''} placeholder={embed.provider || 'Embed'}
                              onChange={(v) => onUpdate({ title: v })}
                              editing={editingTitle}
                              setEditing={setEditingTitle}
                              autoFocus={autoFocus}
                              selectAllOnFocus={autoFocus || editTitleAt > 0} />
              : <div className="lc-title">{title || embed.provider}</div>}
            <div className="lc-src">
              <span className="lc-provider-badge">{embed.provider}</span>
              {openHref && (
                <button type="button" className="lc-open" title="Open original"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={openLink}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M5 2 H10 V7 M10 2 L5 7 M3 4 V9 H8 V8" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const hasPreview = !!(image || description);
  return (
    <div className={`lc ${hasPreview ? 'lc-has-preview' : ''}`} onDoubleClick={onBodyDouble}>
      {hasPreview && (
        <div className="lc-preview" onPointerDown={(e) => e.stopPropagation()} onClick={openLink} title={openHref || ''}>
          {image && (
            // No native loading="lazy" on canvas imagery — the browser's
            // lazy-loader doesn't re-evaluate when the canvas's ancestor
            // transform (zoom/pan) moves a card on-screen, leaving the image
            // unfetched until an unrelated style invalidation (see R2Image).
            <img className="lc-preview-img" src={image} alt=""
                 onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          )}
          {onUpdate && (
            <button type="button" className="lc-preview-x" title="Remove preview"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate({ image: null, description: null, favicon: null });
                    }}>×</button>
          )}
        </div>
      )}
      <div className="lc-meta">
        {onUpdate
          ? <EditableText className="lc-title" value={title || ''} placeholder="Untitled link"
                          onChange={(v) => onUpdate({ title: v })}
                          editing={editingTitle}
                          setEditing={setEditingTitle}
                          autoFocus={autoFocus}
                          selectAllOnFocus={autoFocus || editTitleAt > 0} />
          : <div className="lc-title">{title}</div>}
        {description && <div className="lc-desc">{description}</div>}
        <div className="lc-src">
          {favicon
            ? <img className="lc-favicon" src={favicon} alt="" width="11" height="11"
                   onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <path d="M5 1 H9 V5 M9 1 L4 6 M2 3 H1 V9 H7 V8" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
            )}
          {onUpdate
            ? <EditableText className="lc-src-text" value={source || ''} placeholder="https://…" onChange={(v) => onUpdate({ source: v, link: v })} />
            : <span>{source}</span>}
          {openHref && (
            <button type="button" className="lc-open" title="Open link"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={openLink}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M5 2 H10 V7 M10 2 L5 7 M3 4 V9 H8 V8" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


function PaletteCard({ title, swatches = [], hideHex = false, hideLabels = false, chipsOnly = false, onUpdate, autoFocus = false, editTitleAt = 0, w = 280, h = 130 }) {
  // Canvas context menu "Edit title" remote-trigger — parity with the
  // other titled card kinds.
  const [editingTitle, setEditingTitle] = useState(autoFocus);
  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);
  const [pickerIdx, setPickerIdx] = useState(null);
  const [pickerPos, setPickerPos] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const isEditable = !!onUpdate;
  // One toggle — "pure color" — hides every label (hex, names, title) for a
  // full-bleed palette. Legacy hideHex/hideLabels are still honored on old
  // cards so nothing regresses; the eye button writes chipsOnly.
  const pureColor = chipsOnly || (hideHex && hideLabels);
  const L = paletteLayout(w, h, swatches.length, { pureColor });
  const headerShown = L.showHead && !hideLabels;
  const hexShown = L.showHex && !hideHex;
  const nameShown = hexShown && L.showName;

  // Black/white ink + a tone-matched shadow so overlaid labels stay legible
  // on any swatch color, including borderline mid-tones.
  const labelStyle = (hex) => {
    const ink = readableInk(hex);
    return {
      color: ink,
      textShadow: ink === '#f5f5f7'
        ? '0 1px 3px rgba(0,0,0,.45)'
        : '0 1px 2px rgba(255,255,255,.55)',
    };
  };

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
  const reorderSwatches = (from, to) => {
    if (from === to || from == null || to == null) return;
    const next = swatches.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onUpdate({ swatches: next });
  };
  const onCellDragStart = (i, e) => {
    e.stopPropagation();
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (_) {}
    setDragIdx(i);
  };
  const onCellDragOver = (i, e) => {
    if (dragIdx == null) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    if (dragOverIdx !== i) setDragOverIdx(i);
  };
  const onCellDrop = (i, e) => {
    e.preventDefault();
    e.stopPropagation();
    reorderSwatches(dragIdx, i);
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const onCellDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  if (!isEditable) {
    return (
      <div className={`pc pc-${L.mode}${pureColor ? ' pc-pure' : ''}`}>
        {headerShown && (
          <div className="pc-head">
            <div className="pc-title">{title || 'Palette'}</div>
          </div>
        )}
        <div className={`pc-strip pc-${L.orient}`}>
          {swatches.map((s, i) => {
            const named = nameShown && hasCustomName(s.name);
            const hx = (s.hex || '').toUpperCase();
            return (
              <div key={i} className="pc-cell" title={hx}>
                <div className="pc-chip" style={{ background: s.hex }} />
                {(named || hexShown) && (
                  <div className="pc-cell-label">
                    {named && <div className="pc-name" style={labelStyle(s.hex)}>{s.name}</div>}
                    {hexShown && <div className="pc-hex" style={labelStyle(s.hex)}>{hx}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const eyeBtn = (
    <button className="pc-eye-float"
            title={pureColor ? 'Show labels' : 'Hide labels'}
            aria-pressed={pureColor}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onUpdate({ chipsOnly: !pureColor }); }}>
      {pureColor ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 2 L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M2 8 C4 4.5 5.7 3 8 3 C10.3 3 12 4.5 14 8 C12 11.5 10.3 13 8 13 C5.7 13 4 11.5 2 8 Z"
                stroke="currentColor" strokeWidth="1.2" fill="none" />
          <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 8 C4 4.5 5.7 3 8 3 C10.3 3 12 4.5 14 8 C12 11.5 10.3 13 8 13 C5.7 13 4 11.5 2 8 Z"
                stroke="currentColor" strokeWidth="1.2" fill="none" />
          <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      )}
    </button>
  );

  return (
    <div className={`pc pc-editable pc-${L.mode}${pureColor ? ' pc-pure' : ''}`}>
      {eyeBtn}
      {headerShown && (
        <div className="pc-head">
          <EditableText className="pc-title" value={title || ''} placeholder="Palette"
                        onChange={(v) => onUpdate({ title: v })}
                        editing={editingTitle}
                        setEditing={setEditingTitle}
                        selectAllOnFocus={autoFocus} />
        </div>
      )}
      <div className={`pc-strip pc-${L.orient}`}>
        {swatches.map((s, i) => {
          const named = nameShown && hasCustomName(s.name);
          const hx = (s.hex || '').toUpperCase();
          return (
            <div key={i}
                 className={`pc-cell ${dragIdx === i ? 'pc-cell-dragging' : ''} ${dragOverIdx === i && dragIdx !== null && dragIdx !== i ? 'pc-cell-drop-target' : ''}`}
                 draggable={isEditable}
                 onDragStart={(e) => onCellDragStart(i, e)}
                 onDragOver={(e) => onCellDragOver(i, e)}
                 onDrop={(e) => onCellDrop(i, e)}
                 onDragEnd={onCellDragEnd}>
              <button className="pc-chip" style={{ background: s.hex }}
                      title={`${hx} — click to edit · drag to reorder`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => openPicker(i, e)} />
              {(named || hexShown) && (
                <div className="pc-cell-label">
                  {named && <div className="pc-name" style={labelStyle(s.hex)}>{s.name}</div>}
                  {hexShown && (
                    <button className="pc-hex pc-hex-btn" style={labelStyle(s.hex)}
                            title="Click to copy"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => copyHex(i, hx, e)}>
                      {copiedIdx === i ? 'COPIED' : hx}
                    </button>
                  )}
                </div>
              )}
              <button className="pc-cell-x" title="Remove"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => removeSwatch(i, e)}>×</button>
            </div>
          );
        })}
        {!pureColor && (
          <button className="pc-add" title="Add color"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={addSwatch}>
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 3 V15 M3 9 H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <span className="pc-add-label">Add</span>
          </button>
        )}
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

function DocCard({ title, lines, author, date, onUpdate, autoFocus = false }) {
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

function ScheduleCard({ title, rows, onUpdate = null, editTitleAt = 0 }) {
  // Title is editable like every other card kind (double-click or
  // right-click → Edit title); the rows stay read-only for now.
  const [editingTitle, setEditingTitle] = useState(false);
  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);
  return (
    <div className="sched">
      {onUpdate ? (
        <EditableText className="sched-title" value={title || ''} placeholder="Schedule"
                      editing={editingTitle}
                      setEditing={setEditingTitle}
                      onChange={(v) => onUpdate({ title: v || null })} />
      ) : (
        <div className="sched-title">{title}</div>
      )}
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
function ShapeCard({ shape = 'rect', stroke = '#f5f5f6', fill = 'transparent', strokeWidth = 2, dash = 'solid',
                     label = null, onUpdate = null, editLabelAt = 0 }) {
  // strokeWidth: 0 = "No Border" for fillable shapes (rect, ellipse, etc.).
  // Line/arrow shapes have no fill, so 0 would make them invisible — clamp
  // to 1 in that case so the user can still see what they're editing.
  const isStrokeOnly = shape === 'line' || shape === 'arrow';
  const sw = strokeWidth === 0 && isStrokeOnly ? 1 : strokeWidth;
  const dashArray = dash === 'dashed' ? '6,4' : dash === 'dotted' ? '2,3' : undefined;
  const common = sw === 0
    ? { stroke: 'none', fill, vectorEffect: 'non-scaling-stroke' }
    : { stroke, fill, strokeWidth: sw, vectorEffect: 'non-scaling-stroke', strokeDasharray: dashArray };
  // Optional centered label — double-click the shape (or right-click →
  // Add label) to edit, matching the dblclick-to-edit convention every
  // other card kind follows. Line/arrow shapes skip it (no interior).
  const [editingLabel, setEditingLabel] = useState(false);
  useEffect(() => { if (editLabelAt > 0 && !isStrokeOnly) setEditingLabel(true); }, [editLabelAt, isStrokeOnly]);
  const showLabel = !!onUpdate && !isStrokeOnly && (!!label || editingLabel);
  return (
    <div className="shape"
         onDoubleClick={onUpdate && !isStrokeOnly ? (e) => { e.stopPropagation(); setEditingLabel(true); } : undefined}>
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
      {showLabel && (
        <EditableText className="shape-label" value={label || ''} placeholder="Label"
                      editing={editingLabel}
                      setEditing={setEditingLabel}
                      onChange={(v) => onUpdate({ label: v || null })} />
      )}
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

function formatTime(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Deterministic-but-musical-looking peaks seeded from a string so each
// track gets a stable, unique-ish waveform without needing the audio
// bytes (R2 signed URLs aren't CORS-readable, so real decoding is out).
function generatePeaks(seed, count = 56) {
  const s = String(seed || 'audio');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const peaks = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1664525 + 1013904223) | 0;
    const r = ((h >>> 0) / 4294967296);
    // Mix random + sinusoid so it reads as music, not noise.
    const sine = Math.sin(i * 0.42 + (h >>> 24) * 0.01) * 0.5 + 0.5;
    const env = Math.sin((i / (count - 1)) * Math.PI) * 0.4 + 0.6; // soft envelope
    const p = (0.35 + 0.65 * (0.55 * r + 0.45 * sine)) * env;
    peaks.push(p);
  }
  return peaks;
}

// Audio card — native <audio> for playback (no crossOrigin so it works
// regardless of R2 CORS), decorative waveform rendered as SVG bars that
// fill as playback progresses. Right-click → "Set cover image" puts
// the card into drop-zone mode so the user can drag an image onto it
// or click to file-pick.
function AudioCard({ src, title, duration, cover,
                            onUpdate, autoFocus = false,
                            coverPickAt = 0, editTitleAt = 0,
                            onPickCover = null }) {
  const audioElRef = useRef(null);
  const rootRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [decodedDuration, setDecodedDuration] = useState(duration || 0);
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [coverUrl, setCoverUrl] = useState(null);
  const [coverDropMode, setCoverDropMode] = useState(false);
  const [coverDragOver, setCoverDragOver] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const stopFnRef = useRef(null);

  const peaks = useMemo(() => generatePeaks(src || title || 'audio'), [src, title]);

  // Right-click signal from canvas → open cover drop-zone.
  useEffect(() => {
    if (coverPickAt > 0) setCoverDropMode(true);
  }, [coverPickAt]);
  // Right-click "Edit title" signal — previously dispatched by the menu but
  // never received here, so the action silently did nothing.
  useEffect(() => { if (editTitleAt > 0) setEditingTitle(true); }, [editTitleAt]);

  // Exit cover-drop mode when the user clicks anywhere outside the
  // card or presses Escape — the dashed outline shouldn't linger.
  useEffect(() => {
    if (!coverDropMode) return;
    const onDocDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setCoverDropMode(false);
        setCoverDragOver(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // Isolate from the canvas Escape so it only exits cover-drop, then
        // return focus to the card.
        e.stopPropagation();
        setCoverDropMode(false);
        setCoverDragOver(false);
        rootRef.current?.focus?.();
      }
    };
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [coverDropMode]);

  // Resolve audio src → signed URL.
  useEffect(() => {
    let cancelled = false;
    if (!src) { setResolvedUrl(null); return; }
    resolveSrc(src).then(u => {
      if (cancelled) return;
      setResolvedUrl(u);
      if (!u) console.warn('[AudioCard] no signed URL for', src);
    });
    return () => { cancelled = true; };
  }, [src]);

  // Resolve cover → signed URL.
  useEffect(() => {
    let cancelled = false;
    if (!cover) { setCoverUrl(null); return; }
    resolveSrc(cover).then(u => { if (!cancelled) setCoverUrl(u); });
    return () => { cancelled = true; };
  }, [cover]);

  // Wire the native audio element to React state.
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    const stop = () => { try { audio.pause(); } catch (_) {} };
    stopFnRef.current = stop;
    const onPlay = () => { setIsPlaying(true); audioBus.claim(stop); };
    const onPause = () => { setIsPlaying(false); audioBus.release(stop); };
    const onEnded = () => { setIsPlaying(false); setPosition(0); audioBus.release(stop); };
    const onTime = () => setPosition(audio.currentTime || 0);
    const onMeta = () => setDecodedDuration(audio.duration || decodedDuration || 0);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    return () => {
      audioBus.release(stop);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
    };
  }, []);

  const togglePlay = (e) => {
    e.stopPropagation();
    const audio = audioElRef.current;
    if (!audio) return;
    if (audio.paused) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(err => console.warn('[AudioCard] play failed', err));
    } else {
      audio.pause();
    }
  };

  const seekByFraction = (frac) => {
    const audio = audioElRef.current;
    const dur = decodedDuration || audio?.duration || 0;
    if (!audio || !dur) return;
    audio.currentTime = Math.max(0, Math.min(dur, frac * dur));
  };
  const onWaveClick = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    seekByFraction((e.clientX - rect.left) / rect.width);
  };

  const handleCoverFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    onPickCover?.(file);
    setCoverDropMode(false);
    setCoverDragOver(false);
  };

  const onCoverDragOver = (e) => {
    if (!coverDropMode) return;
    e.preventDefault();
    e.stopPropagation();
    if (!coverDragOver) setCoverDragOver(true);
  };
  const onCoverDragLeave = (e) => {
    if (!coverDropMode) return;
    e.stopPropagation();
    setCoverDragOver(false);
  };
  const onCoverDrop = (e) => {
    if (!coverDropMode) return;
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    handleCoverFile(f);
  };
  const openCoverPicker = (e) => {
    e?.stopPropagation();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => handleCoverFile(input.files?.[0]);
    input.click();
  };

  const dur = decodedDuration || duration || 0;
  const fillPct = dur > 0 ? Math.min(100, (position / dur) * 100) : 0;
  const showTitle = !!title || editingTitle;
  const onTitleDouble = (e) => { e.stopPropagation(); setEditingTitle(true); };

  const playButton = (
    <button type="button" className="ac-play"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}>
      {isPlaying ? (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="4" y="3" width="3" height="10" rx="0.8" fill="currentColor" />
          <rect x="9" y="3" width="3" height="10" rx="0.8" fill="currentColor" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 3.3 L12 8 L5 12.7 Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );

  const timeDisplay = (
    <span className="ac-time">{formatTime(position)} <span className="ac-time-sep">/</span> {formatTime(dur)}</span>
  );

  const titleEl = onUpdate ? (
    <EditableText
      className="ac-title editable"
      value={title || ''}
      placeholder="Audio"
      editing={editingTitle}
      setEditing={setEditingTitle}
      onChange={(v) => onUpdate({ title: v || null })}
      selectAllOnFocus={autoFocus}
    />
  ) : <div className="ac-title">{title}</div>;

  // Hidden audio element drives playback. No crossOrigin — that would
  // require R2 to return CORS preflight on signed URLs, and a missing
  // header silently blocks playback. Without it, audio just plays.
  const audioEl = (
    <audio ref={audioElRef}
           src={resolvedUrl || undefined}
           preload="metadata"
           style={{ display: 'none' }} />
  );

  // SVG bar waveform. Bars left of the playhead fill with the accent
  // color; bars to the right stay muted. Click anywhere on the strip
  // to seek to that point.
  const barCount = peaks.length;
  const filledIdx = Math.round(fillPct / 100 * barCount);
  const waveBox = (
    <div className="ac-wave-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={onWaveClick}>
      <svg className="ac-wave" viewBox={`0 0 ${barCount * 4} 40`} preserveAspectRatio="none">
        {peaks.map((p, i) => {
          const h = Math.max(2, p * 36);
          const x = i * 4 + 0.5;
          const y = (40 - h) / 2;
          const isFilled = i < filledIdx;
          return (
            <rect key={i} x={x} y={y} width={3} height={h} rx={1.2}
                  className={isFilled ? 'ac-bar ac-bar-on' : 'ac-bar ac-bar-off'} />
          );
        })}
      </svg>
    </div>
  );

  // Split layout (with cover): cover left, waveform + controls right.
  if (cover || coverDropMode) {
    return (
      <div ref={rootRef}
           className={`ac ac-with-cover ${coverDropMode ? 'ac-cover-mode' : ''} ${coverDragOver ? 'ac-cover-drop-hover' : ''}`}>
        {audioEl}
        <div className="ac-cover-wrap"
             onDoubleClick={onTitleDouble}
             onDragOver={onCoverDragOver}
             onDragLeave={onCoverDragLeave}
             onDrop={onCoverDrop}
             onClick={coverDropMode ? openCoverPicker : undefined}>
          {coverUrl
            ? <img className="ac-cover-img" src={coverUrl} alt="" draggable="false" />
            : <div className="ac-cover-fallback">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                  <path d="M5 16 L5 6 L17 4 L17 14" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <ellipse cx="5" cy="16" rx="2.4" ry="1.8" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                  <ellipse cx="17" cy="14" rx="2.4" ry="1.8" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                </svg>
              </div>}
          {coverDropMode && <div className="ac-cover-hint">Drop image or click</div>}
        </div>
        <div className="ac-body">
          <div className="ac-title-row" onDoubleClick={onTitleDouble}>
            {showTitle ? titleEl : <span className="ac-title ac-title-placeholder">Audio</span>}
          </div>
          {waveBox}
          <div className="ac-controls">
            {playButton}
            {timeDisplay}
          </div>
        </div>
      </div>
    );
  }

  // Default layout: title + waveform + controls.
  return (
    <div ref={rootRef} className={`ac ${coverDropMode ? 'ac-cover-mode' : ''}`}>
      {audioEl}
      <div className="ac-title-row" onDoubleClick={onTitleDouble}>
        {showTitle ? titleEl : <span className="ac-title ac-title-placeholder">Audio</span>}
      </div>
      {waveBox}
      <div className="ac-controls">
        {playButton}
        {timeDisplay}
      </div>
    </div>
  );
}

// ── Memoized exports ──────────────────────────────────────────────────────
// Every card component is wrapped in React.memo. Combined with the stable
// card identities from readCards (yhelpers.js), a card whose data didn't
// change does zero render work on pan/zoom/drag/presence ticks.
//
// Custom comparator ignores function identity: every per-card callback
// passed in from CanvasSurface.renderCard is a fresh inline closure, but
// each one closes only over the card object `c` (stable) and parent-side
// handlers (themselves stable refs to current state). So identity churn
// in the function props does NOT reflect a behavior change — ignoring it
// lets the memo actually short-circuit. Any non-function prop change
// still busts the memo (selection flip, drag flag, card data edit, etc.).
function shallowEqualIgnoreFns(prev, next) {
  if (prev === next) return true;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(prev).length) return false;
  for (const k of keys) {
    const a = prev[k], b = next[k];
    if (a === b) continue;
    if (typeof a === 'function' && typeof b === 'function') continue;
    return false;
  }
  return true;
}

const MemoBoardCard      = memo(BoardCard,      shallowEqualIgnoreFns);
const MemoBoardLinkCard  = memo(BoardLinkCard,  shallowEqualIgnoreFns);
const MemoImageCard      = memo(ImageCard,      shallowEqualIgnoreFns);
const MemoVideoCard      = memo(VideoCard,      shallowEqualIgnoreFns);
const MemoNoteCard       = memo(NoteCard,       shallowEqualIgnoreFns);
const MemoLinkCard       = memo(LinkCard,       shallowEqualIgnoreFns);
const MemoPaletteCard    = memo(PaletteCard,    shallowEqualIgnoreFns);
const MemoDocCard        = memo(DocCard,        shallowEqualIgnoreFns);
const MemoScheduleCard   = memo(ScheduleCard,   shallowEqualIgnoreFns);
const MemoShapeCard      = memo(ShapeCard,      shallowEqualIgnoreFns);
const MemoAudioCard      = memo(AudioCard,      shallowEqualIgnoreFns);
const MemoPdfCard        = memo(PdfCard,        shallowEqualIgnoreFns);
const MemoFileCard       = memo(FileCard,       shallowEqualIgnoreFns);

export {
  MemoBoardCard     as BoardCard,
  MemoBoardLinkCard as BoardLinkCard,
  MemoImageCard     as ImageCard,
  MemoVideoCard     as VideoCard,
  MemoNoteCard      as NoteCard,
  MemoLinkCard      as LinkCard,
  MemoPaletteCard   as PaletteCard,
  MemoDocCard       as DocCard,
  MemoScheduleCard  as ScheduleCard,
  MemoShapeCard     as ShapeCard,
  MemoAudioCard     as AudioCard,
  MemoPdfCard       as PdfCard,
  MemoFileCard      as FileCard,
};
