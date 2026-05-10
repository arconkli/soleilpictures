import { useEffect, useState, useCallback } from 'react';
import { BoardCard, BoardLinkCard } from './cards.jsx';
import { ImagePlaceholder } from './primitives.jsx';
import { R2Image } from './R2Image.jsx';
import { TEAMMATES } from '../data.js';
import { INBOX_MIME, inboxItemToCard } from '../lib/dragMimes.js';
import { useFeedback } from './AppFeedback.jsx';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');

export function ListSurface({
  board, boards, cards, childBoards,
  onOpenBoard, onOpenPicker, onDropInboxItem,
  mutators = {},
  peersHereByBoard, peersBelowByBoard,
  // For nested list-mode previews — let inner BoardCards render
  // clickable peer dots in their preview rows.
  onJumpToPeer,
}) {
  const feedback = useFeedback();
  const subBoards = childBoards || [];
  const linkedCards = (cards || []).filter(c => c.kind === 'boardlink');
  const otherCards = (cards || []).filter(c => c.kind !== 'board' && c.kind !== 'boardlink');

  // Selection — strings: board ids and card ids share an id namespace.
  const [selectedBoards, setSelectedBoards] = useState(() => new Set());
  const [selectedCards, setSelectedCards] = useState(() => new Set());

  // Reset selection on board switch.
  useEffect(() => {
    setSelectedBoards(new Set());
    setSelectedCards(new Set());
  }, [board.id]);

  const toggle = useCallback((set, setSet, id, multi) => {
    setSet(prev => {
      if (multi) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      // single-select: clear OTHER selection set too
      return new Set([id]);
    });
  }, []);

  const onTileClick = (e, kind, id) => {
    if (e.target.closest && e.target.closest('.editable')) return;
    e.stopPropagation();
    const multi = e.metaKey || e.ctrlKey || e.shiftKey;
    if (kind === 'board') {
      if (multi) toggle(selectedBoards, setSelectedBoards, id, true);
      else { setSelectedBoards(new Set([id])); setSelectedCards(new Set()); }
    } else {
      if (multi) toggle(selectedCards, setSelectedCards, id, true);
      else { setSelectedCards(new Set([id])); setSelectedBoards(new Set()); }
    }
  };

  const onTileDoubleClick = (e, kind, id) => {
    if (e.target.closest && e.target.closest('.editable')) return;
    if (kind === 'board') onOpenBoard(id);
    else if (kind === 'boardlink') {
      const c = (cards || []).find(c => c.id === id);
      if (c && boards[c.target]) onOpenBoard(c.target);
    }
  };

  // Delete selected via Backspace/Delete.
  useEffect(() => {
    const onKey = async (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const total = selectedBoards.size + selectedCards.size;
      if (total === 0) return;
      e.preventDefault();
      const bIds = [...selectedBoards];
      const cIds = [...selectedCards];
      // Build human prompt
      const bn = bIds.length;
      const cn = cIds.length;
      let msg;
      if (bn > 0 && cn === 0) msg = bn === 1
        ? `Delete board "${boards[bIds[0]]?.name || ''}" and ALL its content? Cannot be undone.`
        : `Delete ${bn} boards and ALL their content? Cannot be undone.`;
      else if (bn === 0 && cn > 0) msg = cn === 1 ? 'Delete this card?' : `Delete ${cn} cards?`;
      else msg = `Delete ${total} items, including ${bn} board${bn > 1 ? 's' : ''} (their content will also be lost)? Cannot be undone.`;
      if (msg) {
        const ok = await feedback.confirm({
          title: 'Delete selection',
          message: msg,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
      }
      if (bIds.length) mutators.deleteBoardsById?.(bIds);
      if (cIds.length) mutators.deleteCards?.(cIds);
      setSelectedBoards(new Set());
      setSelectedCards(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feedback, selectedBoards, selectedCards, boards, mutators]);

  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = (e) => {
    if (!e.dataTransfer.types.includes(INBOX_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  };
  const handleDrop = (e) => {
    setDragOver(false);
    const raw = e.dataTransfer.getData(INBOX_MIME);
    if (!raw) return;
    e.preventDefault();
    let item;
    try { item = JSON.parse(raw); } catch (_) { return; }
    const card = inboxItemToCard(item, 0, 0);
    if (!card) return;
    onDropInboxItem && onDropInboxItem(item.id, card);
  };

  const totalSel = selectedBoards.size + selectedCards.size;
  const cmdKey = isMac ? '⌘' : 'Ctrl';

  return (
    <div className={`list-wrap ${dragOver ? 'is-drop-target' : ''}`}
         onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
         onClick={() => { setSelectedBoards(new Set()); setSelectedCards(new Set()); }}>
      <div className="list-inner" onClick={(e) => e.stopPropagation()}>
        {totalSel > 0 && (
          <div className="list-selbar">
            <span>{totalSel} selected</span>
            <span className="list-selbar-hint">⌫ to delete · {cmdKey}-click to multi-select</span>
          </div>
        )}

        {subBoards.length === 0 && linkedCards.length === 0 && otherCards.length === 0 && (
          <div className="list-empty">
            <div className="list-empty-title">Empty board</div>
            <div className="list-empty-sub">Add a sub-board, or link to one elsewhere.</div>
            <button className="tb-btn" onClick={onOpenPicker}>Link a board</button>
          </div>
        )}
        {subBoards.length > 0 && (
          <>
            <div className="list-section">Boards</div>
            <div className="list-grid">
              {subBoards.map(b => (
                <div key={b.id}
                     className={`list-tile ${selectedBoards.has(b.id) ? 'is-selected' : ''}`}
                     onClick={(e) => onTileClick(e, 'board', b.id)}
                     onDoubleClick={(e) => onTileDoubleClick(e, 'board', b.id)}>
                  <BoardCard board={b} boards={boards} teammates={TEAMMATES}
                             peersHere={peersHereByBoard?.get?.(b.id) || []}
                             peersBelow={peersBelowByBoard?.get?.(b.id) || []}
                             peersHereByBoard={peersHereByBoard}
                             peersBelowByBoard={peersBelowByBoard}
                             onJumpToPeer={onJumpToPeer}
                             onRename={(name) => mutators.renameBoardById?.(b.id, name)} />
                </div>
              ))}
            </div>
          </>
        )}
        {linkedCards.length > 0 && (
          <>
            <div className="list-section">Linked</div>
            <div className="list-grid">
              {linkedCards.map(c => {
                const t = boards[c.target];
                return (
                  <div key={c.id}
                       className={`list-tile ${selectedCards.has(c.id) ? 'is-selected' : ''}`}
                       onClick={(e) => onTileClick(e, 'boardlink', c.id)}
                       onDoubleClick={(e) => onTileDoubleClick(e, 'boardlink', c.id)}>
                    <BoardLinkCard targetBoard={t} note={c.note} onOpen={() => {}} />
                  </div>
                );
              })}
            </div>
          </>
        )}
        {otherCards.length > 0 && (
          <>
            <div className="list-section">Files</div>
            <div className="list-files">
              {otherCards.map(c => (
                <FileRow key={c.id}
                         card={c}
                         selected={selectedCards.has(c.id)}
                         onClick={(e) => onTileClick(e, 'file', c.id)}
                         onUpdate={(patch) => mutators.updateCard?.(c.id, patch)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FileRow({ card: c, selected, onClick, onUpdate }) {
  let thumb = null;
  let name = '';
  let meta = '';

  if (c.kind === 'image') {
    thumb = c.src
      ? <R2Image src={c.src} alt="" className="lf-thumb-img" draggable="false" />
      : <ImagePlaceholder tone={c.tone} aspect="1/1" />;
    name = c.title || c.label || 'image';
    meta = c.caption ? `· ${c.caption}` : 'IMAGE';
  } else if (c.kind === 'note') {
    thumb = <div className="lf-thumb-glyph" style={{ background: c.bgColor || 'var(--bg-3)' }}>¶</div>;
    // Notes: derive the display title from the first words of the body.
    // Manual `c.title` is intentionally ignored — the user asked for the
    // first line / header to win so the listing always reflects content.
    name = stripHTML(c.html, 80) || (c.body || '').toString().slice(0, 80) || 'Empty note';
    meta = 'NOTE';
  } else if (c.kind === 'link') {
    thumb = <div className="lf-thumb-glyph">↗</div>;
    name = c.title || c.source || 'Untitled link';
    meta = c.source || c.link || '';
  } else if (c.kind === 'doc') {
    thumb = <div className="lf-thumb-glyph">≡</div>;
    name = c.title || 'Untitled doc';
    meta = `${(c.lines || []).length} lines`;
  } else if (c.kind === 'palette') {
    thumb = (
      <div className="lf-thumb-pal">
        {(c.swatches || []).slice(0, 4).map((s, i) => (
          <div key={i} className="lf-thumb-sw" style={{ background: s.hex }} />
        ))}
      </div>
    );
    name = c.title || 'Palette';
    meta = `${(c.swatches || []).length} colors`;
  } else if (c.kind === 'shape') {
    thumb = <div className="lf-thumb-glyph">▢</div>;
    name = `Shape (${c.shape || 'rect'})`;
    meta = c.fill && c.fill !== 'transparent' ? c.fill : c.stroke;
  } else if (c.kind === 'schedule') {
    thumb = <div className="lf-thumb-glyph">▤</div>;
    name = c.title || 'Schedule';
    meta = `${(c.rows || []).length} rows`;
  } else {
    thumb = <div className="lf-thumb-glyph">·</div>;
    name = c.kind;
    meta = '';
  }

  return (
    <div className={`lf-row ${selected ? 'is-selected' : ''}`} onClick={onClick}>
      <div className="lf-thumb">{thumb}</div>
      <div className="lf-meta">
        <div className="lf-name" title={name}>{name}</div>
        <div className="lf-sub">{meta}</div>
      </div>
    </div>
  );
}

function stripHTML(s, max = 120) {
  if (!s) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = s;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim().slice(0, max);
}
